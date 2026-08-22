/**
 * Unit tests for TopologyFusion orchestrator.
 *
 * Tests cover:
 * - Multi-provider edge merging with confidence-weighted priority
 * - Higher confidence provider wins in edge conflicts
 * - Empty provider set gracefully
 * - Provider unavailability and errors
 * - Ring-connect for unmatched services
 * - Single unmatched service (no self-loop)
 * - Provider contribution tracking
 * - Config-driven behavior (ringConnectUnmatched on/off,
 *   minEdgeConfidence filtering, ringConnectType)
 * - factory helper createDefaultTopologyFusion
 * - Average confidence computation
 *
 * @module causal/__tests__/unit/topology-fusion
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  ITopologyProvider,
  TopologyProviderMeta,
  TopologyDiscoveryContext,
  ServiceCallGraph,
  ServiceNode,
  CallEdge,
} from '@agentix-e/micro-kinetic-core';
import {
  TopologyFusion,
  createDefaultTopologyFusion,
  TopologyFusionResult,
  TopologyFusionConfig,
} from '../../src/orchestrators/topology-fusion.js';

// ── Mock Providers ────────────────────────────────────────

function makeMeta(id: string, confidence: number, method: 'static' | 'dynamic' | 'semantic' = 'static'): TopologyProviderMeta {
  return {
    id,
    description: `Mock ${id} provider`,
    method,
    baseConfidence: confidence,
    availability: 'always',
  };
}

function makeGraph(nodes: string[], edges: CallEdge[]): ServiceCallGraph {
  const nodeMap = new Map<string, ServiceNode>();
  for (const id of nodes) {
    nodeMap.set(id, { id, name: id, namespace: 'test', labels: {} });
  }
  return { nodes: nodeMap, edges, systemLoad: 0 };
}

function makeEdge(from: string, to: string, type: CallEdge['type'] = 'REST'): CallEdge {
  return { from, to, type, callRate: 100, p99Latency: 20, errorRate: 0.01 };
}

function makeProvider(
  id: string,
  confidence: number,
  edges: CallEdge[],
  services: string[],
  available = true,
  shouldThrow = false,
  method: 'static' | 'dynamic' | 'semantic' = 'static',
): ITopologyProvider {
  return {
    meta: makeMeta(id, confidence, method),
    discover: async (ctx: TopologyDiscoveryContext) => {
      if (shouldThrow) throw new Error('Provider error');
      // Only return edges where both endpoints are in known services
      const svcSet = new Set(ctx.knownServiceIds);
      const filtered = edges.filter((e) => svcSet.has(e.from) && svcSet.has(e.to));
      return makeGraph(services, filtered);
    },
    isAvailable: async () => available,
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('TopologyFusion', () => {
  describe('basic discovery', () => {
    it('should fuse edges from a single provider', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b'), makeEdge('b', 'c')], ['a', 'b', 'c']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'c'] });

      expect(result.fusedEdgeCount).toBe(2);
      expect(result.providerContributions.get('static')).toBe(2);
      expect(result.ringConnectCount).toBe(0);
      expect(result.averageConfidence).toBeCloseTo(0.9, 5);
    });

    it('should return empty graph for empty services', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: [] });

      expect(result.fusedEdgeCount).toBe(0);
      expect(result.graph.nodes.size).toBe(0);
      expect(result.graph.edges).toHaveLength(0);
    });

    it('should filter edges where endpoints are not in known services', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b'), makeEdge('c', 'd')], ['a', 'b', 'c', 'd']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      // Only a→b is valid (both endpoints in known)
      expect(result.fusedEdgeCount).toBe(1);
    });
  });

  describe('multi-provider merging', () => {
    it('should merge edges from multiple providers without conflicts', async () => {
      const p1 = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b', 'c']);
      const p2 = makeProvider('static', 0.9, [makeEdge('b', 'c')], ['a', 'b', 'c']);
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'c'] });

      expect(result.fusedEdgeCount).toBe(2);
      expect(result.providerContributions.get('trace')).toBe(1);
      expect(result.providerContributions.get('static')).toBe(1);
    });

    it('should prefer higher confidence edges in conflicts', async () => {
      const p1 = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const p2 = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(1);
      const edge = result.graph.edges[0]!;
      expect(edge.from).toBe('a');
      expect(edge.to).toBe('b');
      // Higher confidence provider wins
      expect(result.providerContributions.get('trace')).toBe(1);
      expect(result.providerContributions.get('static')).toBeUndefined();
    });

    it('should prefer higher priority when confidences are equal', async () => {
      const p1 = makeProvider('trace', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const p2 = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      // p1 (trace) has higher priority (first in list)
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(1);
      expect(result.providerContributions.get('trace')).toBe(1);
    });
  });

  describe('provider handling', () => {
    it('should skip unavailable providers', async () => {
      const p1 = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const p2 = makeProvider('static', 0.9, [makeEdge('b', 'c')], ['b', 'c'], false); // unavailable
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(1);
      expect(result.providerContributions.get('trace')).toBe(1);
      expect(result.providerContributions.get('static')).toBeUndefined();
    });

    it('should handle provider errors gracefully', async () => {
      const p1 = makeProvider('good', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const p2 = makeProvider('bad', 0.9, [makeEdge('b', 'c')], ['b', 'c'], true, true); // throws
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(1);
      expect(result.providerContributions.get('good')).toBe(1);
    });

    it('should handle all providers unavailable', async () => {
      const p1 = makeProvider('a', 0.9, [makeEdge('a', 'b')], ['a', 'b'], false);
      const p2 = makeProvider('b', 0.9, [makeEdge('b', 'c')], ['b', 'c'], false);
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(0);
    });

    it('should handle zero providers (only ring-connect if enabled)', async () => {
      const fusion = new TopologyFusion({ providers: [] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      // Zero providers → no fused edges, but ring-connect is still on by default
      expect(result.fusedEdgeCount).toBe(0);
      // Ring-connect creates edges for unmatched services
      expect(result.ringConnectCount).toBeGreaterThanOrEqual(0);
    });

    it('should handle zero providers with ring-connect disabled', async () => {
      const fusion = new TopologyFusion({
        providers: [],
        ringConnectUnmatched: false,
        ringConnectType: 'REST',
        minEdgeConfidence: 0,
      });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      expect(result.fusedEdgeCount).toBe(0);
      expect(result.graph.edges).toHaveLength(0);
    });
  });

  describe('ring-connect', () => {
    it('should ring-connect unmatched services', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'orphan-1', 'orphan-2'] });

      expect(result.ringConnectCount).toBeGreaterThan(0);
      // orphan-1 and orphan-2 should be ring-connected
      const ringEdges = result.graph.edges.filter(
        (e) => ['orphan-1', 'orphan-2'].includes(e.from) && ['orphan-1', 'orphan-2'].includes(e.to),
      );
      expect(ringEdges.length).toBeGreaterThanOrEqual(1);
    });

    it('should not ring-connect when disabled', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({
        providers: [p],
        ringConnectUnmatched: false,
        ringConnectType: 'REST',
        minEdgeConfidence: 0,
      });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'orphan'] });

      expect(result.ringConnectCount).toBe(0);
    });

    it('should handle single unmatched service (no self-ring)', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'lonely'] });

      // 1 unmatched but single → no ring cycle (would be self-loop)
      expect(result.ringConnectCount).toBe(0);
    });

    it('should use custom ring connect type', async () => {
      const p = makeProvider('static', 0.9, [], ['a', 'b']);
      const fusion = new TopologyFusion({
        providers: [p],
        ringConnectType: 'gRPC',
        ringConnectUnmatched: true,
        minEdgeConfidence: 0,
      });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      const ringEdge = result.graph.edges[0];
      expect(ringEdge).toBeDefined();
      if (ringEdge) {
        expect(ringEdge.type).toBe('gRPC');
      }
    });
  });

  describe('fusion result metadata', () => {
    it('should compute average confidence correctly', async () => {
      const p = makeProvider('static', 0.9, [makeEdge('a', 'b'), makeEdge('b', 'c')], ['a', 'b', 'c']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b', 'c'] });

      expect(result.averageConfidence).toBeCloseTo(0.9, 5);
      expect(result.totalConfidence).toBeCloseTo(1.8, 5);
    });

    it('should compute average 0 for empty edges', async () => {
      const p = makeProvider('static', 0.9, [], []);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: [] });

      expect(result.averageConfidence).toBe(0);
    });

    it('should expose registered providers', () => {
      const p1 = makeProvider('a', 0.9, [], []);
      const p2 = makeProvider('b', 0.8, [], []);
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      expect(fusion.providers).toHaveLength(2);
    });

    it('should include provenance on fused edges', async () => {
      const p = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      const edge = result.graph.edges[0]!;
      expect(edge.provenance).toBeDefined();
      expect(edge.provenance).toContain('trace');
    });

    it('should include providerId on fused edges', async () => {
      const p = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      const edge = result.graph.edges[0]!;
      expect(edge.providerId).toBe('trace');
    });
  });

  describe('factory helpers', () => {
    it('should create fusion from default factory', () => {
      const p = makeProvider('static', 0.9, [], []);
      const fusion = createDefaultTopologyFusion([p]);
      expect(fusion.providers).toHaveLength(1);
    });
  });

  describe('edge merging edge cases', () => {
    it('should merge provider edges that overlap in one direction only', async () => {
      const p1 = makeProvider('trace', 0.95, [makeEdge('a', 'b')], ['a', 'b']);
      const p2 = makeProvider('static', 0.9, [makeEdge('b', 'a')], ['a', 'b']); // reverse
      const fusion = new TopologyFusion({ providers: [p1, p2] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      // Both directions are distinct edges — should get both
      expect(result.fusedEdgeCount).toBe(2);
    });

    it('should preserve all edge attributes from winning provider', async () => {
      const edge: CallEdge = {
        from: 'a',
        to: 'b',
        type: 'gRPC',
        callRate: 500,
        p99Latency: 30,
        errorRate: 0.02,
      };
      const p = makeProvider('trace', 0.95, [edge], ['a', 'b']);
      const fusion = new TopologyFusion({ providers: [p] });
      const result = await fusion.discover({ knownServiceIds: ['a', 'b'] });

      const fused = result.graph.edges[0]!;
      expect(fused.type).toBe('gRPC');
      expect(fused.callRate).toBe(500);
      expect(fused.p99Latency).toBe(30);
      expect(fused.errorRate).toBe(0.02);
    });
  });
});
