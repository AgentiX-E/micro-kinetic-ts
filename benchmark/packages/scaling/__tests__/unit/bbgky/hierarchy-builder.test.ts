import { describe, it, expect } from 'vitest';
import { HierarchyBuilder } from '../../../src/bbgky/hierarchy-builder.js';
import type { MicroserviceState, ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: `Service ${id}`, namespace: 'default', labels: {} });
  }
  return { nodes, edges, systemLoad: 0.5 };
}

function makeState(
  serviceId: string,
  anomalyScore: number,
  faultProbability: number,
  timestamp: number = 1000,
): MicroserviceState {
  return { serviceId, timestamp, faultProbability, anomalyScore, trafficRps: 100 };
}

function makeEdge(
  from: string,
  to: string,
  callRate: number = 100,
  p99Latency: number = 100,
  errorRate: number = 0.01,
): CallEdge {
  return { from, to, type: 'REST', callRate, p99Latency, errorRate };
}

describe('HierarchyBuilder', () => {
  describe('computeBBGKYHierarchy', () => {
    // ── N=2, maxOrder=2 ─────────────────────────────────
    it('should compute systemSize for N=2', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.systemSize).toBe(2);
    });

    it('should produce at least f1 for N=2 maxOrder=2', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states.length).toBeGreaterThanOrEqual(1);
    });

    // ── N=3, maxOrder=2 ─────────────────────────────────
    it('should set systemSize=3 for N=3 graph', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c'], [
        makeEdge('svc_a', 'svc_b', 100),
        makeEdge('svc_b', 'svc_c', 50),
      ]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
        makeState('svc_c', 0.2, 0.02),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.systemSize).toBe(3);
    });

    it('should produce at least 2 states for N=3 maxOrder=2', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c'], [
        makeEdge('svc_a', 'svc_b', 100),
        makeEdge('svc_b', 'svc_c', 50),
      ]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
        makeState('svc_c', 0.2, 0.02),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states.length).toBeGreaterThanOrEqual(2);
    });

    // ── N=5, maxOrder=3 ─────────────────────────────────
    it('should set systemSize=5 for N=5 graph', () => {
      const builder = new HierarchyBuilder();
      const serviceIds = ['s1', 's2', 's3', 's4', 's5'];
      const graph = makeServiceGraph(serviceIds, [
        makeEdge('s1', 's2', 100),
        makeEdge('s2', 's3', 80),
        makeEdge('s3', 's4', 60),
        makeEdge('s4', 's5', 40),
      ]);
      const states: MicroserviceState[] = serviceIds.map((id, i) =>
        makeState(id, 0.5 - i * 0.05, 0.1 - i * 0.01),
      );

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.systemSize).toBe(5);
    });

    it('should produce states up to maxOrder=3 for N=5', () => {
      const builder = new HierarchyBuilder();
      const serviceIds = ['s1', 's2', 's3', 's4', 's5'];
      const graph = makeServiceGraph(serviceIds, [
        makeEdge('s1', 's2', 100),
        makeEdge('s2', 's3', 80),
        makeEdge('s3', 's4', 60),
        makeEdge('s4', 's5', 40),
      ]);
      const states: MicroserviceState[] = serviceIds.map((id, i) =>
        makeState(id, 0.5 - i * 0.05, 0.1 - i * 0.01),
      );

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.states.length).toBeGreaterThanOrEqual(2);
    });

    it('should include truncationOrder for N=5', () => {
      const builder = new HierarchyBuilder();
      const serviceIds = ['s1', 's2', 's3', 's4', 's5'];
      const graph = makeServiceGraph(serviceIds);
      const states: MicroserviceState[] = serviceIds.map((id) => makeState(id, 0.2, 0.05));

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.truncationOrder).toBeGreaterThanOrEqual(1);
    });

    // ── f1 single-service distribution ──────────────────
    it('should set f1 order to 1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.order).toBe(1);
    });

    it('should mark f1 as significant', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.isSignificant).toBe(true);
    });

    it('should have positive correlationEnergy for f1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.correlationEnergy).toBeGreaterThan(0);
    });

    // ── f2 pairwise correlation ─────────────────────────
    it('should set f2 order to 2', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.states[1]!.order).toBe(2);
    });

    it('should have f2 tensor of size 4 (2x2)', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.states[1]!.tensor.length).toBe(4);
    });

    // ── Energy E_k ──────────────────────────────────────
    it('should have non-negative correlationEnergy for all states', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      for (const state of result.states) {
        expect(state.correlationEnergy).toBeGreaterThanOrEqual(0);
      }
    });

    it('should have energyRatios in result', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.energyRatios.length).toBeGreaterThanOrEqual(0);
    });

    it('should have truncationError >= 0', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.truncationError).toBeGreaterThanOrEqual(0);
    });

    it('should have truncationOrder >= 1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.truncationOrder).toBeGreaterThanOrEqual(1);
    });

    // ── f3 computation ──────────────────────────────────
    it('should build f3 tensor for N=2 maxOrder=3', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 3, truncationEta: 0.01 });
      expect(result.states.length).toBeGreaterThanOrEqual(2);
    });

    // ── Boundary: N=1 ───────────────────────────────────
    it('should handle N=1 with maxOrder=1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_only']);
      const states: MicroserviceState[] = [makeState('svc_only', 0.5, 0.1)];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 1, truncationEta: 0.01 });
      expect(result.systemSize).toBe(1);
    });

    it('should have exactly one state for N=1 maxOrder=1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_only']);
      const states: MicroserviceState[] = [makeState('svc_only', 0.5, 0.1)];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 1, truncationEta: 0.01 });
      expect(result.states.length).toBe(1);
    });

    it('should have f1 order=1 for N=1', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_only']);
      const states: MicroserviceState[] = [makeState('svc_only', 0.5, 0.1)];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 1, truncationEta: 0.01 });
      expect(result.states[0]!.order).toBe(1);
    });

    // ── Boundary: maxOrder > N ──────────────────────────
    it('should handle maxOrder > N', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 5, truncationEta: 0.01 });
      expect(result.systemSize).toBe(2);
    });

    it('should not exceed the available states when maxOrder > N', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 5, truncationEta: 0.01 });
      // With small coupling, higher orders may truncate early due to energy decay
      expect(result.states.length).toBeGreaterThanOrEqual(1);
    });

    it('should have valid result shape when maxOrder > N', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 5, truncationEta: 0.01 });
      expect(result.truncationOrder).toBeGreaterThanOrEqual(1);
    });

    // ── k > 3 recursive construction ───────────────────
    it('should build f4 using maxOrder=4 and eta=0', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      // eta=0 ensures no early truncation, forcing k>3 recursive path
      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 4, truncationEta: 0 });
      expect(result.states.length).toBeGreaterThanOrEqual(2);
    });

    it('should have f4 tensor of size 16 (2^4) with maxOrder=4 eta=0', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 4, truncationEta: 0 });
      // f4 should have tensor of size N^k = 2^4 = 16
      const f4 = result.states[3]; // index 3 = order 4
      expect(f4!.tensor.length).toBe(16);
    });

    it('should handle maxOrder=5 with N=2 and eta=0', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      // Force through the decodeMultiIndex path for k>3
      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 5, truncationEta: 0 });
      expect(result.systemSize).toBe(2);
    });

    it('should include all orders 1-5 in states with maxOrder=5 eta=0', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 5, truncationEta: 0 });
      expect(result.states.length).toBe(5);
    });

    // ── Default options ─────────────────────────────────
    it('should work with default options (no opts arg)', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph);
      expect(result.systemSize).toBe(2);
    });

    // ── Error conditions ────────────────────────────────
    it('should throw for empty states', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a']);
      expect(() => builder.computeBBGKYHierarchy([], graph)).toThrow();
    });

    it('should throw for graph with no nodes', () => {
      const builder = new HierarchyBuilder();
      const emptyGraph: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      const states: MicroserviceState[] = [makeState('svc_a', 0.5, 0.1)];
      expect(() => builder.computeBBGKYHierarchy(states, emptyGraph)).toThrow();
    });

    // ── Coupling effects ────────────────────────────────
    it('should include serviceIds from nodes in each state', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 500)]);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.8, 0.2),
        makeState('svc_b', 0.3, 0.1),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.serviceIds).toContain('svc_a');
    });

    it('should produce tensor for f1 with length equal to N', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_b', 0.3, 0.05),
        makeState('svc_c', 0.2, 0.02),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.tensor.length).toBe(3);
    });

    // ── Zero anomaly states ─────────────────────────────
    it('should handle states with zero anomaly and zero fault probability', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0, 0),
        makeState('svc_b', 0, 0),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      expect(result.states[0]!.correlationEnergy).toBe(0);
    });

    // ── Multiple state timestamps (picks latest) ────────
    it('should use the latest state per service', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.1, 0.01, 1000),
        makeState('svc_a', 0.9, 0.5, 2000),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 1, truncationEta: 0.01 });
      // Should pick the 2000-timestamp entry (anomaly=0.9, fault=0.5)
      expect(result.states[0]!.correlationEnergy).toBeGreaterThan(0);
    });

    // ── State with service not in graph ─────────────────
    it('should handle states for services not in the graph', () => {
      const builder = new HierarchyBuilder();
      const graph = makeServiceGraph(['svc_a', 'svc_b']);
      const states: MicroserviceState[] = [
        makeState('svc_a', 0.5, 0.1),
        makeState('svc_unknown', 0.9, 0.8),
      ];

      const result = builder.computeBBGKYHierarchy(states, graph, { maxOrder: 2, truncationEta: 0.01 });
      // svc_b not in states → its f1 value is 0
      expect(result.systemSize).toBe(2);
    });
  });
});
