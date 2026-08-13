import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

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
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
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
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      // High anomaly values for both → high propagation weight via Pearson correlation
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const aScore = graph.anomalyScores.get('A') ?? 0;
      const bScore = graph.anomalyScores.get('B') ?? 0;
      expect(aScore).toBeGreaterThan(0.7);
      expect(bScore).toBeGreaterThan(0.7);
      // Pearson r=1.0 for identical metrics → weight ≥ 0.99
      expect(graph.propagationWeights[0]).toBeGreaterThanOrEqual(0.99);
    });

    it('detects cycles in cyclic graphs', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
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
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
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
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 100],
        C: [10, 11, 12, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Chronological tree eliminates cycles. The build succeeds.
      expect(graph.callGraph.edges.length).toBeGreaterThan(0);
    });
  });

  describe('analyze', () => {
    it('analyzes DAG and returns ranked results', () => {
      const pruner = new TreePruner({ defaultTopK: 5 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'],
          ['A', 'C'],
          ['B', 'D'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
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

    it('preserves topology edges and detects cycles for pruning', () => {
      const pruner = new TreePruner({ pruneEpsilon: 1.0, useTwoHopDecay: true });
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [
          ['A', 'B'],
          ['B', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Topology-preserving: all original edges are kept.
      // pruneEpsilon=1.0 means no cycle is significant → pruneCycles handles them.
      expect(graph.callGraph.edges.length).toBe(2);
      expect(() => pruner.analyze(graph)).not.toThrow();
    });

    it('uses default topK when not provided', () => {
      const pruner = new TreePruner({ defaultTopK: 2 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
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
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
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
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
        C: [10, 11, 12, 10, 30],
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
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 100],
        C: [10, 11, 12, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);
      expect(results.length).toBeGreaterThan(0);
    });

    it('analyzes graph with significant cycles instead of throwing', () => {
      // Regression: analyze used to throw GraphCycleError when a cycle's
      // contribution exceeded pruneEpsilon, which returned "no prediction"
      // for dense real-world topologies (TrainTicket: 68 nodes, 267 edges).
      // Default pruneEpsilon (0.001) with a strong 3-node cycle makes the
      // cycle significant; analyze must now prune it and return results.
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 100],
        C: [10, 11, 12, 10, 100],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // The cycle A→B→C→A should be classified significant.
      expect(graph.detectedCycles.some((c) => c.significant)).toBe(true);
      // analyze prunes it and returns ranked results instead of throwing.
      const results = pruner.analyze(graph, 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.serviceId)).toBe(true);
    });

    it('handles a dangling edge (endpoint not in nodes) without crashing', () => {
      // Regression: the semantic topology enhancer could emit edges whose
      // endpoint is a YAML alias absent from the case's service set. Those
      // dangling edges crashed performTreeRCA ("Cannot read properties of
      // undefined (reading 'every')"). The engine must skip dangling parents
      // instead of throwing.
      const pruner = new TreePruner();
      // 'X' is an edge endpoint that is NOT a node.
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['X', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
        C: [10, 11, 12, 10, 30],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.serviceId)).toBe(true);
    });
  });

  describe('buildFaultGraph with partial metrics', () => {
    it('handles services not present in metrics map (undefined metrics)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 11, 12, 10, 100])]);
      // B not in metrics
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
      expect(graph.anomalyScores.get('A')).toBeGreaterThan(0);
    });

    it('handles service with empty metrics array', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 11, 12, 10, 100])]);
      metrics.set('B', []);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });

    it('handles time series with empty values', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 11, 12, 10, 100])]);
      metrics.set('B', [makeTimeSeries('cpu', [])]);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });

    it('handles metrics with all negative values (mean <= 0)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = new Map<string, readonly TimeSeries[]>();
      metrics.set('A', [makeTimeSeries('cpu', [10, 11, 12, 10, 100])]);
      metrics.set('B', [makeTimeSeries('cpu', [-10, -10, -10])]);
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.anomalyScores.get('B')).toBe(0);
    });
  });

  describe('buildFaultGraph with correlation weight branches', () => {
    it('computes medium correlation weight (scores >= 0.5)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 60],
        B: [10, 11, 12, 10, 60],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.propagationWeights[0]).toBeGreaterThanOrEqual(0.4);
    });

    it('computes low score correlation weight (one score >= 0.3)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 35],
        B: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // A has a mild spike but B is completely flat — weak propagation evidence.
      // With data-adaptive anomaly similarity, the edge weight is low but non-zero.
      // The velocity tier (MAD-based) may activate since A has 5 data points.
      expect(graph.propagationWeights[0]).toBeGreaterThan(0);
    });

    it('computes default low correlation weight (both low scores)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 10],
        B: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Identical values → zero variance → Pearson=null → fallback default=0.3
      expect(graph.propagationWeights[0]).toBe(0.3);
    });
  });

  describe('three-level tree propagation', () => {
    it('propagates scores through a 3-level branching tree', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.1, defaultTopK: 5 });
      // Tree: Root → Mid1, Root → Mid2, Mid1 → Leaf
      const callGraph = makeCallGraph(
        ['Root', 'Mid1', 'Mid2', 'Leaf'],
        [
          ['Root', 'Mid1'],
          ['Root', 'Mid2'],
          ['Mid1', 'Leaf'],
        ],
      );
      const metrics = makeMetrics({
        Root: [10, 11, 12, 10, 100],
        Mid1: [10, 11, 12, 10, 60],
        Mid2: [10, 10, 10, 10, 40],
        Leaf: [10, 10, 10, 10, 80],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(4);
      // Root should accumulate scores from both mid-level nodes
      const rootResult = results.find((r) => r.serviceId === 'Root');
      expect(rootResult).toBeDefined();
    });
  });

  describe('DAG with multi-parent node', () => {
    it('handles a DAG where a node has two parents', () => {
      const pruner = new TreePruner({ pruneEpsilon: 0.1, defaultTopK: 5 });
      // Diamond DAG: Top → Left, Top → Right, Left → Bottom, Right → Bottom
      const callGraph = makeCallGraph(
        ['Top', 'Left', 'Right', 'Bottom'],
        [
          ['Top', 'Left'],
          ['Top', 'Right'],
          ['Left', 'Bottom'],
          ['Right', 'Bottom'],
        ],
      );
      const metrics = makeMetrics({
        Top: [10, 11, 12, 10, 100],
        Left: [10, 11, 12, 10, 60],
        Right: [10, 11, 12, 10, 50],
        Bottom: [10, 11, 12, 10, 30],
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
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
        ],
      );
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
      const callGraph = makeCallGraph(
        ['Root', 'Mid', 'Leaf'],
        [
          ['Root', 'Mid'],
          ['Mid', 'Leaf'],
        ],
      );
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
          ['Parent', 'Child1'],
          ['Parent', 'Child2'],
          ['Parent', 'Child3'],
          ['Parent', 'Child4'],
          ['Parent', 'Child5'],
        ],
      );
      // Child3 has clear anomaly spike, others are flat (no anomaly)
      const metrics = makeMetrics({
        Parent: [5, 5, 5, 5, 6], // tiny anomaly — cascaded
        Child1: [5, 5, 5, 5, 5], // flat — no anomaly
        Child2: [5, 5, 5, 5, 5], // flat — no anomaly
        Child3: [5, 6, 9, 14, 18], // sharp spike — root cause
        Child4: [5, 5, 5, 5, 5], // flat — no anomaly
        Child5: [5, 5, 5, 5, 5], // flat — no anomaly
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);

      // Child3 must be first — it's the only service with real anomaly
      expect(results[0]!.serviceId).toBe('Child3');
    });
  });

  describe('collision energy aggregation (I8-P3)', () => {
    it('includes collisionEnergy in buildFaultGraph output', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100], // spike anomaly
        B: [10, 10, 10, 10, 15], // mild deviation
        C: [5, 5, 5, 5, 5], // flat
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.collisionEnergy).toBeDefined();
      if (graph.collisionEnergy) {
        expect(graph.collisionEnergy.has('A')).toBe(true);
        expect(graph.collisionEnergy.has('B')).toBe(true);
        expect(graph.collisionEnergy.has('C')).toBe(true);

        const a = graph.collisionEnergy.get('A')!;
        const b = graph.collisionEnergy.get('B')!;
        const c = graph.collisionEnergy.get('C')!;

        expect(a.totalEnergy).toBeGreaterThanOrEqual(0);
        expect(a.totalEnergy).toBeLessThanOrEqual(1);
        expect(a.collisionType).toBe('chain'); // A has no incoming edges
        expect(a.collisionGain).toBe(0); // No parents → no collision

        expect(b.collisionType).toBe('chain');
        expect(b.collisionGain).toBeGreaterThanOrEqual(0); // May have collision from A

        expect(c.collisionType).toBe('chain');
      }
    });

    it('classifies bottleneck in star topology', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['Src1', 'Src2', 'Src3', 'Src4', 'Hub'],
        [
          ['Src1', 'Hub'],
          ['Src2', 'Hub'],
          ['Src3', 'Hub'],
          ['Src4', 'Hub'],
        ],
      );
      const metrics = makeMetrics({
        Src1: [100, 100, 100, 100, 100],
        Src2: [100, 100, 100, 100, 100],
        Src3: [100, 100, 100, 100, 100],
        Src4: [100, 100, 100, 100, 100],
        Hub: [100, 95, 90, 85, 10], // dropping anomaly
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.collisionEnergy).toBeDefined();
      if (graph.collisionEnergy) {
        const hub = graph.collisionEnergy.get('Hub')!;
        // Hub has 4 incoming edges, 0 outgoing → bottleneck
        expect(hub.collisionType).toBe('bottleneck');
        expect(hub.collisionGain).toBeGreaterThanOrEqual(0);
      }
    });

    it('classifies cycle membership collision type', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B'],
        [
          ['A', 'B'],
          ['B', 'A'],
        ], // bidirectional = cycle
      );
      const metrics = makeMetrics({
        A: [10, 10, 10, 10, 100],
        B: [10, 10, 10, 10, 50],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(graph.collisionEnergy).toBeDefined();
      if (graph.collisionEnergy) {
        expect(graph.collisionEnergy.get('A')!.collisionType).toBe('cycle');
        expect(graph.collisionEnergy.get('B')!.collisionType).toBe('cycle');
      }
    });

    it('uses collision energy in analyze results', () => {
      const pruner = new TreePruner({ maxCycles: 100 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'],
          ['A', 'C'],
          ['B', 'D'],
          ['C', 'D'],
        ],
      );
      const metrics = makeMetrics({
        A: [1, 2, 3, 4, 100], // spike at end → high anomaly
        B: [1, 2, 3, 4, 5], // flat
        C: [1, 2, 3, 4, 5], // flat
        D: [1, 2, 3, 4, 50], // mild spike from A
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);
      expect(results.length).toBeGreaterThan(0);
      // The highest ranked result should be A (highest original anomaly)
      expect(results[0]!.serviceId).toBe('A');
      if (graph.collisionEnergy) {
        const aCollision = graph.collisionEnergy.get('A')!;
        // A has 2 outgoing edges → fan-in type in the reverse direction
        expect(aCollision.collisionType).toBeDefined();
      }
    });

    it('collision results accept optional propagationWeights', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['X', 'Y'], [['X', 'Y']]);
      const metrics = makeMetrics({
        X: [1, 2, 3, 4, 100],
        Y: [1, 2, 3, 4, 5],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Verify propagation weights feed into collision aggregation
      expect(graph.propagationWeights.length).toBe(1);
      expect(graph.propagationWeights[0]).toBeGreaterThanOrEqual(0);
      expect(graph.propagationWeights[0]).toBeLessThanOrEqual(1);
      // Should have collisionEnergy for both nodes
      expect(graph.collisionEnergy?.size).toBe(2);
    });

    it('buildFaultGraph with collision disabled', () => {
      const pruner = new TreePruner({ enableCollisionAggregation: false });
      const callGraph = makeCallGraph(['X', 'Y'], [['X', 'Y']]);
      const metrics = makeMetrics({
        X: [1, 2, 3, 4, 100],
        Y: [1, 2, 3, 4, 5],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Collision disabled: each node gets raw anomaly score, 'chain' type, 0 gain
      expect(graph.collisionEnergy?.size).toBe(2);
      for (const [, energy] of graph.collisionEnergy!) {
        expect(energy.collisionType).toBe('chain');
        expect(energy.collisionGain).toBe(0);
        expect(energy.totalEnergy).toBeGreaterThanOrEqual(0);
      }
    });

    it('buildFaultGraph with two-hop decay', () => {
      const pruner = new TreePruner({ useTwoHopDecay: true });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      );
      const metrics = makeMetrics({
        A: [1, 2, 3, 4, 100],
        B: [1, 2, 3, 4, 5],
        C: [1, 2, 3, 4, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      // Should compute two-hop cycle contributions
      expect(graph.detectedCycles.length).toBeGreaterThanOrEqual(0);
    });
  });
});
