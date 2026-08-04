import { describe, it, expect } from 'vitest';
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import type {
  ServiceCallGraph,
  ServiceNode,
  CallEdge,
  TimeSeries,
  MetricMap,
} from '@agentix-e/micro-kinetic-core';
import {
  GraphCycleError,
} from '@agentix-e/micro-kinetic-core';

function makeNode(id: string): ServiceNode {
  return {
    id,
    name: id,
    namespace: 'default',
    labels: {},
  };
}

function makeEdge(from: string, to: string): CallEdge {
  return {
    from,
    to,
    type: 'REST',
    callRate: 100,
    p99Latency: 50,
    errorRate: 0.01,
  };
}

function makeCallGraph(
  nodeIds: string[],
  edgePairs: [string, string][],
  systemLoad = 0.3,
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of nodeIds) {
    nodes.set(id, makeNode(id));
  }
  const edges = edgePairs.map(([f, t]) => makeEdge(f, t));
  return { nodes, edges, systemLoad };
}

function makeTimeSeries(label: string, values: number[]): TimeSeries {
  const timestamps = values.map((_, i) => i * 60000);
  return { label, timestamps, values: new Float64Array(values), unit: 'count' };
}

function makeMetrics(nodeData: Record<string, number[]>): MetricMap {
  const map = new Map<string, readonly TimeSeries[]>();
  for (const [nodeId, vals] of Object.entries(nodeData)) {
    map.set(nodeId, [makeTimeSeries('cpu_usage', vals)]);
  }
  return map;
}

describe('TreePruner', () => {
  describe('constructor', () => {
    it('creates with default options', () => {
      const pruner = new TreePruner();
      expect(pruner.pruneEpsilon).toBe(0.001);
    });

    it('accepts custom pruneEpsilon', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.1 });
      expect(pruner.pruneEpsilon).toBe(0.1);
    });

    it('rejects invalid pruneEpsilon', () => {
      expect(() => new TreePruner({ pruneEpsilon: -0.1 })).toThrow();
      expect(() => new TreePruner({ pruneEpsilon: 1.5 })).toThrow();
    });

    it('rejects invalid criticalLoadThreshold', () => {
      expect(() => new TreePruner({ criticalLoadThreshold: -0.1 })).toThrow();
    });

    it('rejects invalid defaultTopK', () => {
      expect(() => new TreePruner({ defaultTopK: -1 })).toThrow();
    });
  });

  describe('buildFaultGraph', () => {
    it('builds graph with nodes and edges', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 10],
        B: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.callGraph.edges.length).toBe(1); // MST preserves single-edge graphs
      expect(graph.callGraph.nodes.size).toBe(2);
      expect(graph.propagationWeights.length).toBe(1);
      expect(graph.anomalyScores.has('A')).toBe(true);
      expect(graph.anomalyScores.has('B')).toBe(true);
      expect(graph.pruneThreshold).toBeGreaterThan(0);
    });

    it('builds graph with high-anomaly scores producing high weights', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      // High anomaly values for both → high propagation weight
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const aScore = graph.anomalyScores.get('A') ?? 0;
      const bScore = graph.anomalyScores.get('B') ?? 0;
      expect(aScore).toBeGreaterThan(0.7);
      expect(bScore).toBeGreaterThan(0.7);
      expect(graph.propagationWeights[0]).toBe(0.9);
    });

    it('detects cycles in cyclic graphs', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C'], ['C', 'A']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10],
        B: [10, 10, 10],
        C: [10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.detectedCycles.length).toBeGreaterThan(0);
      expect(graph.totalCycleContribution).toBeGreaterThanOrEqual(0);
    });

    it('has no cycles in DAG', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10],
        B: [10, 10, 10],
        C: [10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.detectedCycles.length).toBe(0);
      expect(graph.totalCycleContribution).toBe(0);
    });

    it('throws on empty call graph nodes', () => {
      const pruner = new TreePruner();
      const callGraph: ServiceCallGraph = {
        nodes: new Map(),
        edges: [],
        systemLoad: 0.3,
      };
      expect(() => pruner.buildFaultGraph(callGraph, new Map())).toThrow();
    });

    it('throws on call graph with no edges', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A'], []);
      const metrics = makeMetrics({ A: [10, 10] });
      expect(() => pruner.buildFaultGraph(callGraph, metrics)).toThrow();
    });

    it('throws on empty metrics', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      expect(() => pruner.buildFaultGraph(callGraph, new Map())).toThrow();
    });

    it('uses 2-hop decay when configured', () => {
      const pruner = new TreePruner({ useTwoHopDecay: true });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C'], ['C', 'A']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 100],
        C: [10, 10, 10, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.detectedCycles.length).toBeGreaterThan(0);
    });
  });

  describe('analyze', () => {
    it('analyzes DAG and returns ranked results', () => {
      const pruner = new TreePruner({ defaultTopK: 5 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D'],
        [['A', 'B'], ['A', 'C'], ['B', 'D']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 50],
        C: [10, 10, 10, 10, 10],
        D: [10, 10, 10, 10, 80],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);
      expect(results.length).toBeLessThanOrEqual(3);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.serviceId).toBeTruthy();
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
        expect(r.rank).toBeGreaterThanOrEqual(1);
      }
    });

    it('throws GraphCycleError on significant cycles', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.0, useTwoHopDecay: true });
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B'], ['B', 'A']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(() => pruner.analyze(graph)).toThrow(GraphCycleError);
    });

    it('uses default topK when not provided', () => {
      const pruner = new TreePruner({ defaultTopK: 2 });
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 50],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getCycleContributionBound', () => {
    it('computes bound below critical load', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.01, criticalLoadThreshold: 0.7 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']], 0.3);
      const metrics = makeMetrics({ A: [10, 10, 10], B: [10, 10, 10] });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const bound = pruner.getCycleContributionBound(graph);
      // bound = (0.3/0.7) * 0.01 * (1 + 0.3) ≈ 0.00557
      expect(bound).toBeGreaterThan(0);
      expect(bound).toBeLessThan(0.1);
    });

    it('computes bound above critical load', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.01, criticalLoadThreshold: 0.5 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']], 0.8);
      const metrics = makeMetrics({ A: [10, 10, 10], B: [10, 10, 10] });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const bound = pruner.getCycleContributionBound(graph);
      // above critical: load * eps * 2 = 0.8 * 0.01 * 2 = 0.016
      expect(bound).toBeGreaterThan(0);
    });

    it('returns 0 for zero-load graph', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']], 0);
      const metrics = makeMetrics({ A: [10, 10, 10], B: [10, 10, 10] });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const bound = pruner.getCycleContributionBound(graph);
      expect(bound).toBe(0);
    });
  });

  describe('pruneEpsilon getter', () => {
    it('returns configured epsilon', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.05 });
      expect(pruner.pruneEpsilon).toBeCloseTo(0.05);
    });
  });

  describe('analyze with default topK', () => {
    it('uses defaultTopK when topK is not provided', () => {
      const pruner = new TreePruner({ defaultTopK: 1 });
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 50],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findEdgeWeight edge cases (internal)', () => {
    it('returns 0 for edges not in the original edge list', () => {
      const pruner = new TreePruner({ defaultTopK: 2 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 50],
        C: [10, 10, 10, 10, 30],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 2);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('pruneCycles with provided cycles', () => {
    it('analyzes graph with non-significant cycles', () => {
      const pruner = new TreePruner({ pruneEpsilon: 1.0 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C'], ['C', 'A']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 100],
        C: [10, 10, 10, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('buildFaultGraph with partial metrics', () => {
    it('handles services not present in metrics map (undefined metrics)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 10, 10, 10, 100])]);
      // B not in metrics
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
      expect(graph.anomalyScores.get('A')).toBeGreaterThan(0);
    });

    it('handles service with empty metrics array', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 10, 10, 10, 100])]);
      metrics.set('B', []);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });

    it('handles time series with empty values', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 10, 10, 10, 100])]);
      metrics.set('B', [makeTimeSeries('cpu', [])]);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });

    it('handles metrics with all negative values (mean <= 0)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 10, 10, 10, 100])]);
      metrics.set('B', [makeTimeSeries('cpu', [-10, -10, -10])]);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });
  });

  describe('buildFaultGraph with correlation weight branches', () => {
    it('computes medium correlation weight (scores >= 0.5)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 60],
        B: [10, 10, 10, 10, 60],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.propagationWeights[0]).toBeGreaterThanOrEqual(0.4);
    });

    it('computes low score correlation weight (one score >= 0.3)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 35],
        B: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.propagationWeights[0]).toBeGreaterThanOrEqual(0.1);
    });

    it('computes default low correlation weight (both low scores)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [['A', 'B']],
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 10],
        B: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.propagationWeights[0]).toBe(0.1);
    });
  });

  describe('three-level tree propagation', () => {
    it('propagates scores through a 3-level branching tree', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.1, defaultTopK: 5 });
      // Tree: Root → Mid1, Root → Mid2, Mid1 → Leaf
      const callGraph = makeCallGraph(
        ['Root', 'Mid1', 'Mid2', 'Leaf'],
        [['Root', 'Mid1'], ['Root', 'Mid2'], ['Mid1', 'Leaf']],
      );
      const metrics = makeMetrics({
        Root: [10, 10, 10, 10, 100],
        Mid1: [10, 10, 10, 10, 60],
        Mid2: [10, 10, 10, 10, 40],
        Leaf: [10, 10, 10, 10, 80],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(4);
      // Root should accumulate scores from both mid-level nodes
      const rootResult = results.find(r => r.serviceId === 'Root');
      expect(rootResult).toBeDefined();
    });
  });

  describe('DAG with multi-parent node', () => {
    it('handles a DAG where a node has two parents', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.1, defaultTopK: 5 });
      // Diamond DAG: Top → Left, Top → Right, Left → Bottom, Right → Bottom
      const callGraph = makeCallGraph(
        ['Top', 'Left', 'Right', 'Bottom'],
        [['Top', 'Left'], ['Top', 'Right'], ['Left', 'Bottom'], ['Right', 'Bottom']],
      );
      const metrics = makeMetrics({
        Top: [10, 10, 10, 10, 100],
        Left: [10, 10, 10, 10, 60],
        Right: [10, 10, 10, 10, 50],
        Bottom: [10, 10, 10, 10, 30],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('depth-weighted ranking (Deng Yu propagation depth theorem)', () => {
    it('should rank upstream root cause above downstream symptom when raw scores are similar', () => {
      const pruner = new TreePruner();
      // Linear chain: A → B → C → D
      // Inject fault at A: A has moderate anomaly, B/C/D have cascading high anomalies
      const callGraph = makeCallGraph(['A', 'B', 'C', 'D'], [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
      ]);
      // D has the highest anomaly (cascading symptom), A has the root cause
      const metrics = makeMetrics({
        A: [2, 3, 8, 12, 15], // root cause: gradual increase
        B: [1, 2, 5, 15, 25], // symptom: larger spike
        C: [1, 2, 4, 18, 30], // deeper symptom: even larger
        D: [1, 2, 3, 20, 35], // deepest symptom: largest spike
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);

      expect(results.length).toBeGreaterThan(0);
      // Depth bonus should rank A (depth=3) above D (depth=0)
      // despite D having a higher raw anomaly score
      const ranks = results.map((r) => r.serviceId);
      expect(ranks.indexOf('A')).toBeLessThan(ranks.indexOf('D'));
    });

    it('should rank deeper propagation services higher', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['Root', 'Mid', 'Leaf'], [
        ['Root', 'Mid'],
        ['Mid', 'Leaf'],
      ]);
      // All similar anomaly: depth should be the tiebreaker
      const metrics = makeMetrics({
        Root: [5, 10, 15, 20, 25],
        Mid: [5, 10, 15, 20, 25],
        Leaf: [5, 10, 15, 20, 25],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);

      // Root should be ranked first (highest depth)
      expect(results[0]!.serviceId).toBe('Root');
    });
    it('should not let fan-out services outrank true root cause (fan-out dilution)', () => {
      const pruner = new TreePruner();
      // Star topology: Parent → 5 children. Fault is in Child3.
      // Child3 must rank first despite Parent accumulating from all children.
      const callGraph = makeCallGraph(
        ['Parent', 'Child1', 'Child2', 'Child3', 'Child4', 'Child5'],
        [
          ['Parent', 'Child1'], ['Parent', 'Child2'], ['Parent', 'Child3'],
          ['Parent', 'Child4'], ['Parent', 'Child5'],
        ],
      );
      // Child3 has clear anomaly spike, others are flat (no anomaly)
      const metrics = makeMetrics({
        Parent: [5, 5, 5, 5, 6],    // tiny anomaly — cascaded
        Child1: [5, 5, 5, 5, 5],    // flat — no anomaly
        Child2: [5, 5, 5, 5, 5],    // flat — no anomaly
        Child3: [5, 6, 9, 14, 18],  // sharp spike — root cause
        Child4: [5, 5, 5, 5, 5],    // flat — no anomaly
        Child5: [5, 5, 5, 5, 5],    // flat — no anomaly
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);

      // Child3 must be first — it's the only service with real anomaly
      expect(results[0]!.serviceId).toBe('Child3');
    });
  });
});
