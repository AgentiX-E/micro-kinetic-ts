/**
 * Unit tests for StaticTopologyProvider.
 *
 * Tests cover:
 * - YAML file loading and caching
 * - Service discovery with namespace matching
 * - Edge construction with type normalization
 * - Ring-connect for unmatched services
 * - Empty graph for no matching config
 * - All edge type normalizations (gRPC, REST, MQ, CALLBACK, ASYNC)
 * - Service ID resolution (case-insensitive)
 * - isAvailable checks
 *
 * @module causal/__tests__/unit/static-topology
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { StaticTopologyProvider } from '../../src/providers/static-topology';

const TEST_CONFIG_DIR = join(__dirname, '..', '..', '__fixtures__', 'topology-test');

// ── Test YAML Templates ──────────────────────────────────

const MINIMAL_YAML = `
version: "1.0"
system: TestSystem
description: "Minimal test system"

services:
  - id: service-a
    namespace: test
    labels:
      tier: backend
      language: go
  - id: service-b
    namespace: test
    labels:
      tier: backend
      language: java

edges:
  - { from: service-a, to: service-b, type: gRPC, callRate: 100, p99Latency: 20, errorRate: 0.01 }
`;

const FULL_YAML = `
version: "1.0"
system: FullSystem
description: "Full test system with all edge types"
source: "https://example.com/topology"

services:
  - id: frontend
    namespace: fullsys
    labels:
      tier: web
      description: "Frontend service"
  - id: backend-a
    namespace: fullsys
    labels:
      tier: backend
      description: "Backend service A"
  - id: backend-b
    namespace: fullsys
    labels:
      tier: backend
      description: "Backend service B"
  - id: queue-handler
    namespace: fullsys
    labels:
      tier: worker
  - id: async-worker
    namespace: fullsys
    labels:
      tier: worker
      description: "Async processing"
  - id: callback-relay
    namespace: fullsys
    labels:
      tier: infrastructure

edges:
  - { from: frontend, to: backend-a, type: REST, callRate: 500, p99Latency: 30, errorRate: 0.01 }
  - { from: frontend, to: backend-b, type: gRPC, callRate: 300, p99Latency: 20, errorRate: 0.02 }
  - { from: backend-a, to: queue-handler, type: Kafka, callRate: 200, p99Latency: 10, errorRate: 0.01 }
  - { from: queue-handler, to: async-worker, type: async, callRate: 100, p99Latency: 50, errorRate: 0.03 }
  - { from: backend-b, to: callback-relay, type: callback, callRate: 50, p99Latency: 100, errorRate: 0.01 }
`;

// ── Setup / Teardown ─────────────────────────────────────

function setupConfigDir(...yamlContents: string[]): void {
  const dir = TEST_CONFIG_DIR;
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(dir, { recursive: true });
  yamlContents.forEach((content, i) => {
    writeFileSync(join(dir, `topology-${i + 1}.yaml`), content, 'utf-8');
  });
}

function cleanup(): void {
  if (existsSync(TEST_CONFIG_DIR)) {
    rmSync(TEST_CONFIG_DIR, { recursive: true });
  }
}

// ── Tests ────────────────────────────────────────────────

describe('StaticTopologyProvider', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  describe('isAvailable', () => {
    it('should return false when config directory is empty', async () => {
      setupConfigDir();
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(await provider.isAvailable()).toBe(false);
    });

    it('should return true when config directory has valid YAML', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(await provider.isAvailable()).toBe(true);
    });

    it('should return false when config directory does not exist', async () => {
      const provider = new StaticTopologyProvider('/nonexistent/path/12345');
      expect(await provider.isAvailable()).toBe(false);
    });
  });

  describe('discover — basic', () => {
    it('should return empty graph for no matching configs', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['unknown-svc-1', 'unknown-svc-2'],
      });

      expect(graph.nodes.size).toBe(2);
      expect(graph.edges).toHaveLength(0);
    });

    it('should return empty graph with empty known services', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: [] });
      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe('discover — service matching', () => {
    it('should match service IDs from YAML config', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'service-b'],
      });

      expect(graph.nodes.size).toBe(2);
      const a = graph.nodes.get('service-a')!;
      expect(a.name).toBeDefined();
      expect(a.namespace).toBe('test');
    });

    it('should include edges when both endpoints are known', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'service-b'],
      });

      expect(graph.edges).toHaveLength(1);
      const edge = graph.edges[0]!;
      expect(edge.from).toBe('service-a');
      expect(edge.to).toBe('service-b');
      expect(edge.type).toBe('gRPC');
      expect(edge.callRate).toBe(100);
      expect(edge.p99Latency).toBe(20);
      expect(edge.errorRate).toBe(0.01);
    });

    it('should not include edges when one endpoint is missing', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'unknown-svc'],
      });

      // Topology edge service-a → service-b not applicable (service-b missing)
      // Ring-connect adds edges for unmatched 'unknown-svc'
      // But the original topology edge should NOT be present
      const topologyEdges = graph.edges.filter(
        (e) => e.from === 'service-a' && e.to === 'service-b',
      );
      expect(topologyEdges).toHaveLength(0);
    });
  });

  describe('discover — case insensitivity', () => {
    it('should match case-insensitively', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['SERVICE-A', 'service-B'],
      });

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]!.from).toBe('SERVICE-A');
      expect(graph.edges[0]!.to).toBe('service-B');
    });
  });

  describe('discover — edge type normalization', () => {
    it('should normalize Kafka to MQ', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['backend-a', 'queue-handler', 'frontend', 'backend-b', 'async-worker', 'callback-relay'],
      });

      const mqEdge = graph.edges.find((e) => e.from === 'backend-a' && e.to === 'queue-handler');
      expect(mqEdge!.type).toBe('MQ');
    });

    it('should normalize async to ASYNC', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['queue-handler', 'async-worker', 'frontend', 'backend-a', 'backend-b', 'callback-relay'],
      });

      const asyncEdge = graph.edges.find((e) => e.from === 'queue-handler' && e.to === 'async-worker');
      expect(asyncEdge!.type).toBe('ASYNC');
    });

    it('should normalize callback to CALLBACK', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['backend-b', 'callback-relay', 'frontend', 'backend-a', 'queue-handler', 'async-worker'],
      });

      const cbEdge = graph.edges.find((e) => e.from === 'backend-b' && e.to === 'callback-relay');
      expect(cbEdge!.type).toBe('CALLBACK');
    });

    it('should normalize REST and gRPC', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['frontend', 'backend-a', 'backend-b'],
      });

      const restEdge = graph.edges.find((e) => e.to === 'backend-a');
      const grpcEdge = graph.edges.find((e) => e.to === 'backend-b');
      expect(restEdge!.type).toBe('REST');
      expect(grpcEdge!.type).toBe('gRPC');
    });
  });

  describe('discover — ring-connect', () => {
    it('should ring-connect single unmatched service', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'service-b', 'orphan-svc'],
      });

      const orphanEdge = graph.edges.find(
        (e) => e.from === 'orphan-svc' || e.to === 'orphan-svc',
      );
      expect(orphanEdge).toBeDefined();
    });

    it('should ring-connect multiple unmatched services', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'orphan-1', 'orphan-2'],
      });

      // service-a → service-b edge won't exist (service-b not present)
      // But orphan-1 and orphan-2 should be ring-connected
      const allEdges = graph.edges.map((e) => `${e.from}→${e.to}`);
      // Check at least one direction exists in the ring
      const hasOrphan1to2 = allEdges.includes('orphan-1→orphan-2') || allEdges.includes('orphan-2→orphan-1');
      expect(hasOrphan1to2).toBe(true);
    });

    it('should not add ring edges when all services are matched', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'service-b'],
      });

      // Only the topology edge should exist, no ring edges
      expect(graph.edges).toHaveLength(1);
    });
  });

  describe('discover — namespace filtering', () => {
    it('should use namespace hint to filter configs', async () => {
      setupConfigDir(MINIMAL_YAML, FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['frontend', 'backend-a', 'backend-b'],
        namespace: 'fullsys',
      });

      // Should match FullSystem config
      expect(graph.nodes.has('frontend')).toBe(true);
      expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    });

    it('should fall back to best match without namespace', async () => {
      setupConfigDir(MINIMAL_YAML, FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['frontend', 'backend-a', 'backend-b'],
      });

      // Should still match FullSystem (best overlap)
      expect(graph.nodes.has('frontend')).toBe(true);
    });
  });

  describe('config management', () => {
    it('should cache configs on first load', () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(provider.configCount).toBe(1);
    });

    it('should reload configs', () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(provider.configCount).toBe(1);

      // Add another config
      writeFileSync(join(TEST_CONFIG_DIR, 'topology-extra.yaml'), FULL_YAML, 'utf-8');
      provider.reload();
      expect(provider.configCount).toBe(2);
    });

    it('should handle zero config files', () => {
      setupConfigDir();
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(provider.configCount).toBe(0);
    });
  });

  describe('edge attributes', () => {
    it('should preserve edge attributes from YAML', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['frontend', 'backend-a'],
      });

      const edge = graph.edges[0]!;
      expect(edge.callRate).toBe(500);
      expect(edge.p99Latency).toBe(30);
      expect(edge.errorRate).toBe(0.01);
    });

    it('should not add duplicate edges', async () => {
      const dupYaml = `
version: "1.0"
system: DupSystem
description: "System with duplicate edges"
services:
  - id: svc-a
    namespace: test
    labels: {}
  - id: svc-b
    namespace: test
    labels: {}
edges:
  - { from: svc-a, to: svc-b, type: REST, callRate: 100, p99Latency: 20, errorRate: 0.01 }
  - { from: svc-a, to: svc-b, type: gRPC, callRate: 200, p99Latency: 10, errorRate: 0.02 }
      `;
      setupConfigDir(dupYaml);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['svc-a', 'svc-b'],
      });

      // Only first edge should be added (duplicate key guard)
      expect(graph.edges).toHaveLength(1);
    });
  });

  describe('nodes metadata', () => {
    it('should include topology metadata in node labels', async () => {
      setupConfigDir(FULL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['frontend', 'backend-a'],
      });

      const node = graph.nodes.get('frontend')!;
      expect(node.labels._topology_system).toBe('FullSystem');
      expect(node.labels._topology_source).toContain('example.com/topology');
      expect(node.labels.tier).toBe('web');
    });
  });

  describe('YAML parsing', () => {
    it('should skip invalid YAML files gracefully', () => {
      const badYaml = `invalid: [unclosed`;
      setupConfigDir(badYaml, MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      // Should load at least the valid one
      expect(provider.configCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle YAML with comments', async () => {
      const commentedYaml = `
# This is a comment
version: "1.0"
system: CommentSystem  # inline comment
description: "System with comments"
# Another comment
services:
  - id: svc-x
    namespace: test
    labels:
      tier: backend  # inline
edges:
  - { from: svc-x, to: svc-y, type: REST, callRate: 100, p99Latency: 20, errorRate: 0.01 }
      `;
      setupConfigDir(commentedYaml);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['svc-x', 'svc-y'],
      });

      expect(graph.edges).toHaveLength(1);
    });

    it('should handle .yml extension files', async () => {
      setupConfigDir(); // Empty dir
      writeFileSync(join(TEST_CONFIG_DIR, 'topology.yml'), MINIMAL_YAML, 'utf-8');
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(provider.configCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle YAML without source field', async () => {
      const noSourceYaml = `
version: "1.0"
system: NoSourceSys
description: "No source field"
services:
  - id: svc-1
    namespace: test
    labels: {}
edges:
  - { from: svc-1, to: svc-2, type: REST, callRate: 100, p99Latency: 20, errorRate: 0.01 }
      `;
      setupConfigDir(noSourceYaml);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['svc-1', 'svc-2'],
      });

      expect(graph.edges).toHaveLength(1);
      const node = graph.nodes.get('svc-1')!;
      expect(node.labels._topology_source).toBe('yaml-config');
    });

    it('should handle unreadable directory gracefully', () => {
      const provider = new StaticTopologyProvider('/root/protected-dir-nope');
      expect(() => provider.configCount).not.toThrow();
      expect(provider.configCount).toBe(0);
    });
  });

  describe('caching behavior', () => {
    it('should not re-read files on subsequent loads', () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const count1 = provider.configCount;

      // Delete the file
      cleanup();
      // Cache should still return the original count
      const count2 = provider.configCount;
      expect(count2).toBe(count1);
    });

    it('should invalidate cache on reload', () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      expect(provider.configCount).toBe(1);

      // Delete and reload
      cleanup();
      setupConfigDir(); // Empty dir
      provider.reload();
      expect(provider.configCount).toBe(0);
    });
  });

  describe('discover — unconnected ring edge case', () => {
    it('should handle single service with no topology matches', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['lonely-service'],
      });

      // Lonely service has no topology match → edges empty
      // Actually: no config match at all → empty
      // But ringConnect runs even for empty — if no connectedSvcs and unmatched 1 → no ring
      expect(graph.nodes.has('lonely-service')).toBe(true);
    });

    it('should handle namespace filter with zero services matched', async () => {
      setupConfigDir(MINIMAL_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({
        knownServiceIds: ['service-a', 'service-b'],
        namespace: 'nonexistent-ns',
      });

      // No namespace match → fall back to best config by overlap (TestSystem)
      expect(graph.nodes.has('service-a')).toBe(true);
      expect(graph.edges.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('edge type normalization — remaining variants', () => {
    const EXTRA_TYPES_YAML = `
version: "1.0"
system: ExtraTypes
services:
  - id: a
    namespace: test
  - id: b
    namespace: test
  - id: c
    namespace: test
  - id: d
    namespace: test
edges:
  - { from: a, to: b, type: mq, callRate: 1, p99Latency: 1, errorRate: 0 }
  - { from: b, to: c, type: rabbitmq, callRate: 1, p99Latency: 1, errorRate: 0 }
  - { from: c, to: d, type: websocket, callRate: 1, p99Latency: 1, errorRate: 0 }
`;

    it('should normalize mq to MQ', async () => {
      setupConfigDir(EXTRA_TYPES_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a', 'b', 'c', 'd'] });
      const edge = graph.edges.find((e) => e.from === 'a' && e.to === 'b');
      expect(edge!.type).toBe('MQ');
    });

    it('should normalize rabbitmq to MQ', async () => {
      setupConfigDir(EXTRA_TYPES_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a', 'b', 'c', 'd'] });
      const edge = graph.edges.find((e) => e.from === 'b' && e.to === 'c');
      expect(edge!.type).toBe('MQ');
    });

    it('should fall back to REST for unknown edge types', async () => {
      setupConfigDir(EXTRA_TYPES_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a', 'b', 'c', 'd'] });
      const edge = graph.edges.find((e) => e.from === 'c' && e.to === 'd');
      expect(edge!.type).toBe('REST');
    });
  });

  describe('inline edge attribute defaults', () => {
    const MINIMAL_EDGE_YAML = `
version: "1.0"
system: MinimalEdge
services:
  - id: a
    namespace: test
  - id: b
    namespace: test
edges:
  - { from: a, to: b }
`;

    it('should apply default type/callRate/p99Latency/errorRate', async () => {
      setupConfigDir(MINIMAL_EDGE_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a', 'b'] });

      expect(graph.edges).toHaveLength(1);
      const edge = graph.edges[0]!;
      expect(edge.type).toBe('REST');
      expect(edge.callRate).toBe(100);
      expect(edge.p99Latency).toBe(50);
      expect(edge.errorRate).toBe(0.01);
    });

    it('should coerce non-numeric numeric attributes to 0', async () => {
      const nonNumeric = `
version: "1.0"
system: NonNumeric
services:
  - id: a
    namespace: test
  - id: b
    namespace: test
edges:
  - { from: a, to: b, type: REST, callRate: abc, p99Latency: xyz, errorRate: n/a }
`;
      setupConfigDir(nonNumeric);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a', 'b'] });
      const edge = graph.edges[0]!;
      expect(edge.callRate).toBe(0);
      expect(edge.p99Latency).toBe(0);
      expect(edge.errorRate).toBe(0);
    });

    it('should ignore edges missing a from or to endpoint', async () => {
      const missingEndpoint = `
version: "1.0"
system: MissingEndpoint
services:
  - id: a
    namespace: test
edges:
  - { from: a }
`;
      setupConfigDir(missingEndpoint);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['a'] });
      // Malformed edge (missing `to`) is dropped; single unmatched service has
      // no connected neighbours, so no ring edge is added either.
      expect(graph.edges).toHaveLength(0);
    });
  });

  describe('service block parsing variants', () => {
    const SEPARATE_LINE_YAML = `
version: "1.0"
system: SeparateLines
services:
  - namespace: test
    id: svc-a
    labels:
      tier: backend
  - id: svc-b
    namespace: test
edges:
  - { from: svc-a, to: svc-b, type: REST, callRate: 1, p99Latency: 1, errorRate: 0 }
`;

    it('should parse service blocks with id/namespace on separate lines', async () => {
      setupConfigDir(SEPARATE_LINE_YAML);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['svc-a', 'svc-b'] });
      expect(graph.nodes.get('svc-a')!.namespace).toBe('test');
      expect(graph.nodes.get('svc-b')!.namespace).toBe('test');
      expect(graph.edges).toHaveLength(1);
    });

    it('should treat direct key-value lines (not id/namespace) as labels', async () => {
      const directLabel = `
version: "1.0"
system: DirectLabel
services:
  - id: svc-a
    namespace: test
    tier: backend
  - id: svc-b
    namespace: test
edges:
  - { from: svc-a, to: svc-b, type: REST, callRate: 1, p99Latency: 1, errorRate: 0 }
`;
      setupConfigDir(directLabel);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['svc-a', 'svc-b'] });
      expect(graph.nodes.get('svc-a')!.labels.tier).toBe('backend');
    });

    it('should skip service blocks missing a required field', async () => {
      const missingNamespace = `
version: "1.0"
system: MissingNs
services:
  - id: svc-a
  - id: svc-b
    namespace: test
edges:
  - { from: svc-b, to: svc-b, type: REST, callRate: 1, p99Latency: 1, errorRate: 0 }
`;
      setupConfigDir(missingNamespace);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['svc-a', 'svc-b'] });
      // svc-a lacks a namespace → dropped; svc-b is valid.
      expect(graph.nodes.has('svc-a')).toBe(false);
      expect(graph.nodes.has('svc-b')).toBe(true);
    });

    it('should tolerate blank lines inside a service block', async () => {
      const blankLine = `
version: "1.0"
system: BlankLine
services:
  - id: svc-a
    namespace: test

    labels:
      tier: backend
  - id: svc-b
    namespace: test
edges:
  - { from: svc-a, to: svc-b, type: REST, callRate: 1, p99Latency: 1, errorRate: 0 }
`;
      setupConfigDir(blankLine);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      const graph = await provider.discover({ knownServiceIds: ['svc-a', 'svc-b'] });
      // The blank line between `namespace` and `labels` is skipped, not treated
      // as a block terminator.
      expect(graph.nodes.get('svc-a')!.namespace).toBe('test');
      expect(graph.nodes.get('svc-a')!.labels.tier).toBe('backend');
      expect(graph.edges).toHaveLength(1);
    });
  });

  describe('YAML loading error handling', () => {
    it('should skip a directory masquerading as a .yaml file', () => {
      setupConfigDir(MINIMAL_YAML);
      mkdirSync(join(TEST_CONFIG_DIR, 'bad.yaml'));
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      // Valid file loads; the directory entry throws EISDIR on read and is skipped.
      expect(provider.configCount).toBe(1);
    });

    it('should tolerate a configDir path that is a file, not a directory', () => {
      setupConfigDir();
      const filePath = join(TEST_CONFIG_DIR, 'not-a-dir.yaml');
      writeFileSync(filePath, 'not a directory', 'utf-8');
      const provider = new StaticTopologyProvider(filePath);
      // readdirSync on a file throws ENOTDIR → swallowed by the outer catch.
      expect(provider.configCount).toBe(0);
    });

    it('should reject YAML whose edges section precedes services', () => {
      const edgesFirst = `
version: "1.0"
system: EdgeFirst
edges:
  - { from: a, to: b, type: REST, callRate: 1, p99Latency: 1, errorRate: 0 }
services:
  - id: a
    namespace: test
`;
      setupConfigDir(edgesFirst);
      const provider = new StaticTopologyProvider(TEST_CONFIG_DIR);
      // The parser switches to the edges section before parsing any service, so
      // services end up empty and the config is rejected.
      expect(provider.configCount).toBe(0);
    });
  });
});
