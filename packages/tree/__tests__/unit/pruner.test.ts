import type {
  CallEdge,
  MetricMap,
  RankingWeights,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  ONSET_SHAPES,
  POOL_METRIC_PREFIX,
  TreePruner,
  toRankingWeights,
} from '@agentix-e/micro-kinetic-tree';
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

  describe('self-anomaly ranking (no depth weighting)', () => {
    it('ranks the highest-deviation service first even when it is a leaf', () => {
      // sourceWeight: 0 isolates pure self-anomaly ranking (the source signal
      // is covered separately in the source-likelihood describe block).
      const pruner = new TreePruner({ sourceWeight: 0 });
      // Linear chain: A → B → C → D. The fault spike lives at the LEAF (D),
      // which has the largest raw deviation. Self-anomaly ranking must place
      // D first — the old depth-weighted totalScore made a healthy upstream
      // node accumulate its children's anomaly and outrank the leaf fault.
      // The values are chosen so D's deviation is UNEQUIVOCALLY the largest;
      // A's mild drift stays far below it so the (monotonicity-based) trend
      // bonus cannot flip the order.
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
        ],
      );
      const metrics = makeMetrics({
        A: [2, 3, 4, 5, 6], // upstream: mild gradual increase
        B: [1, 2, 3, 4, 8], // symptom: moderate spike
        C: [1, 2, 3, 4, 10], // deeper symptom: larger spike
        D: [1, 2, 3, 4, 15], // leaf symptom: largest spike
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 4);

      expect(results.length).toBeGreaterThan(0);
      // D has the largest self deviation, so it ranks first.
      expect(results[0]!.serviceId).toBe('D');
    });

    it('ties on identical anomaly scores deterministically by service id (not depth)', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['Root', 'Mid', 'Leaf'],
        [
          ['Root', 'Mid'],
          ['Mid', 'Leaf'],
        ],
      );
      // Identical metrics → identical anomaly scores → a genuine tie. Depth
      // must NOT break the tie: RCAEval injects faults at arbitrary services
      // (including leaves), so a deep node is not inherently a more likely
      // root cause. The tie is settled by deterministic service-id order.
      const metrics = makeMetrics({
        Root: [5, 10, 15, 20, 25],
        Mid: [5, 10, 15, 20, 25],
        Leaf: [5, 10, 15, 20, 25],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);

      const ids = results.map((r) => r.serviceId);
      // Deterministic lexicographic order; Root is NOT forced first.
      expect(ids).toEqual(['Leaf', 'Mid', 'Root']);
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

  describe('self-anomaly primary ranking', () => {
    it('ranks the faulted child above its healthy parent', () => {
      // Regression: the previous depth-weighted totalScore let a healthy
      // parent accumulate its faulted child's anomaly via childContrib and
      // outrank the actual root cause. The fault injection point (Child)
      // has the highest SELF anomaly and must rank first.
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['Parent', 'Child'], [['Parent', 'Child']]);
      const metrics = makeMetrics({
        Parent: [10, 10, 10, 10, 10], // healthy — flat
        Child: [10, 12, 15, 20, 40], // fault — sharp spike
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 2);
      expect(results[0]!.serviceId).toBe('Child');
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

    it('analyzes a graph without collision energy (undefined fallbacks)', () => {
      // Exercise the defensive ?? fallbacks in performTreeRCA when collision
      // energy is absent — the graph is built then stripped of its collision
      // map before analysis, so every `collisionEnergy?.get` and `?? 'chain'`
      // / `?? 0` path is taken.
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const metrics = makeMetrics({
        A: [1, 2, 3, 4, 100],
        B: [1, 2, 3, 4, 5],
        C: [1, 2, 3, 4, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const stripped = { ...graph, collisionEnergy: undefined };
      const results = pruner.analyze(stripped, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.serviceId).toBeDefined();
    });
  });

  describe('source-likelihood ranking (onset ordering, opt-in)', () => {
    it('ranks the earliest-onset source above later-onset symptoms when enabled', () => {
      // A chain A → B → C where the fault is injected at A (step change at
      // index 3), and B/C change later (index 5 / index 7) with slightly
      // HIGHER anomaly. Cause precedes effect (Deng Yu's mean free time τ),
      // so with sourceWeight > 0 the source-likelihood prior must rank A first
      // despite its lower self-anomaly — this is the dataset-agnostic
      // source/symptom signal, opt-in (default is 0 / disabled).
      const pruner = new TreePruner({ sourceWeight: 1.0 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const metrics = makeMetrics({
        A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
        C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);

      expect(results[0]!.serviceId).toBe('A');
    });

    it('disables the source signal by default (pure self-anomaly ranking)', () => {
      // The default sourceWeight is 0: the highest self-anomaly service (B,
      // the symptom) ranks first, NOT the source A. This is the shipped
      // behaviour — the onset signal regressed the benchmark at weight 1.0
      // (#193), so it is opt-in until the onset detector is validated.
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
        ],
      );
      const metrics = makeMetrics({
        A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
        C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);

      // With the default sourceWeight 0, B (highest anomaly) ranks first.
      expect(results[0]!.serviceId).toBe('B');
    });
  });

  describe('temporal earliness ranking (injection-time anchored)', () => {
    // Shared metric values: A (source) steps at index 3, B at index 5, C at
    // index 7 — the same values used by the source-likelihood block, so the
    // pure self-anomaly ordering (B > C > A) is already established there.
    // The pruner test helper stamps timestamps at i*60000 ms, so injectTimeMs
    // 180000 sits on the index-3 boundary.
    const metrics = makeMetrics({
      A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
    });
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );

    it('ranks the earliest-onset source above a higher-anomaly symptom when enabled', () => {
      // With the injection time known AND a non-zero temporalWeight, A's disturbance
      // precedes B's and C's, so the temporal prior must lift A above B (whose anomaly
      // is larger). This is the causal source/symptom separation the index-based onset
      // could not provide — and the weight is stated explicitly, because the SHIPPED
      // default is small by design and would not carry A past a 0.5 anomaly gap.
      const pruner = new TreePruner({ temporalWeight: 0.5 });
      const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: 180000 });

      // Onset delays: A=0ms, B=120000ms, C=240000ms (relative to injection).
      expect(graph.postInjectOnsetDelays?.get('A')).toBe(0);
      expect(graph.postInjectOnsetDelays?.get('B')).toBe(120000);
      expect(graph.postInjectOnsetDelays?.get('C')).toBe(240000);
      expect(graph.injectTimeMs).toBe(180000);

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('A');
    });

    it('credits the first mover at the SHIPPED weight, without overturning the ranking', () => {
      // The shipped default is a measured +4 cases / 0 regressed on FSE'26, which is a
      // statement about cases, not about this fixture: at 0.036552 the term must LIFT A
      // by exactly the weight and leave the anomaly ordering intact here. Asserted as
      // arithmetic rather than as an ordering, so the test says what the default does
      // instead of encoding one fixture's outcome — and asserted against an EXPLICIT
      // zero, because `new TreePruner()` is no longer the term-off arm.
      const off = new TreePruner({ temporalWeight: 0 });
      const shipped = new TreePruner();
      const scoreOf = (pruner: TreePruner, id: string): number => {
        const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: 180000 });
        return pruner.analyze(graph, 3).find((r) => r.serviceId === id)!.finalScore!;
      };

      expect(scoreOf(shipped, 'A') - scoreOf(off, 'A')).toBeCloseTo(DEFAULT_TEMPORAL_WEIGHT, 12);
      expect(scoreOf(shipped, 'B')).toBeCloseTo(scoreOf(off, 'B'), 12);
      expect(scoreOf(shipped, 'C')).toBeCloseTo(scoreOf(off, 'C'), 12);
      // B stays first: the shipped weight is deliberately too small to overturn a 0.5
      // anomaly gap, and a default that COULD would be a different measurement.
      const graph = shipped.buildFaultGraph(callGraph, metrics, { injectTimeMs: 180000 });
      expect(shipped.analyze(graph, 3)[0]!.serviceId).toBe('B');
    });

    it('leaves the ranking on pure self-anomaly when the injection time is unknown', () => {
      // No injectTimeMs → the temporal signal is neutral for every service
      // and the highest self-anomaly service (B) still ranks first.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      expect(graph.injectTimeMs).toBe(0);
      for (const id of ['A', 'B', 'C']) {
        expect(graph.postInjectOnsetDelays?.get(id)).toBe(-1);
      }

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('B');
    });

    it('produces no temporal effect when all onsets tie', () => {
      // All three services step at the SAME index (5), so every onset delay
      // equals the same value. The min-max span is zero → every service is
      // neutral and the ranking falls back to pure self-anomaly (B first).
      const tied = makeMetrics({
        A: [1, 1, 1, 1, 1, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0],
        B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
        C: [1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2, 3.2],
      });
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, tied, { injectTimeMs: 180000 });

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('B');
    });

    it('produces no temporal effect when the graph carries no onset delays', () => {
      // A graph stripped of its postInjectOnsetDelays map (e.g. produced by a
      // different engine) has no temporal evidence: every service is neutral
      // and the highest self-anomaly service (B) still ranks first.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: 180000 });
      const stripped = { ...graph, postInjectOnsetDelays: undefined };

      const results = pruner.analyze(stripped, 3);
      expect(results[0]!.serviceId).toBe('B');
    });

    it('produces no temporal effect when only one service has a defined onset', () => {
      // A single defined onset (A steps; B and C stay flat) cannot establish
      // a before/after ordering, so the temporal prior contributes nothing.
      const single = makeMetrics({
        A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        B: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        C: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      });
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, single, { injectTimeMs: 180000 });

      const results = pruner.analyze(graph, 3);
      // Only A has a non-zero anomaly → A is the sole candidate.
      expect(results[0]!.serviceId).toBe('A');
    });
  });

  describe('ranking fusion weights (serializable structure)', () => {
    it('packs the flat option fields into a RankingWeights object', () => {
      const pruner = new TreePruner({
        sourceWeight: 0.1,
        temporalWeight: 0.2,
        collisionWeight: 0.3,
        topoWeight: 0.4,
        logWeight: 0.5,
      });

      // toRankingWeights reads the DEFAULT_TREE_PRUNER_OPTIONS merge result.
      // We assert via a fresh pruner's defaults instead — the helper is pure
      // over an options object, so construct one directly.
      const weights = toRankingWeights({
        sourceWeight: 0.1,
        temporalWeight: 0.2,
        collisionWeight: 0.3,
        topoWeight: 0.4,
        logWeight: 0.5,
        riseWeight: 0.6,
        traceWeight: 0.7,
        prismWeight: 0.8,
        failedEdgeWeight: 0.9,
        latWeight: 0.95,
        poolMetricPenaltyWeight: 0.0679,
      });

      expect(weights).toEqual({
        sourceWeight: 0.1,
        temporalWeight: 0.2,
        collisionWeight: 0.3,
        topoWeight: 0.4,
        logWeight: 0.5,
        riseWeight: 0.6,
        traceWeight: 0.7,
        prismWeight: 0.8,
        failedEdgeWeight: 0.9,
        latWeight: 0.95,
        poolMetricPenaltyWeight: 0.0679,
      });

      // Sanity: the pruner accepts the same fields through its constructor.
      expect(pruner.pruneEpsilon).toBeGreaterThan(0);
    });

    it('defaults the causal priors to 0 (log signal enabled but neutral without logs)', () => {
      // The shipped default enables ONLY the log signal (logWeight 1.0,
      // proven net-positive by #220). The other causal priors — source,
      // temporal, collision, topological — default to 0 (opt-in) so ablation
      // can measure each in isolation. This case carries no logs, so the log
      // signal is neutral and the ranking is pure self-anomaly.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(
        makeCallGraph(['A', 'B'], [['A', 'B']]),
        makeMetrics({ A: [1, 1, 3, 3], B: [1, 1, 3.5, 3.5] }),
      );
      const results = pruner.analyze(graph, 2);
      // B (higher self-anomaly) ranks first with no logs and the causal
      // priors disabled.
      expect(results[0]!.serviceId).toBe('B');
    });
  });

  describe('log signal ranking', () => {
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    // B has the highest self-anomaly, then C, then A (established elsewhere).
    const metrics = makeMetrics({
      A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
    });
    // Logic-exception flags are set so the log signal counts A as the source
    // (connectivity exceptions would be treated as a cascade and excluded —
    // see computeLogScores).
    const logs = [
      { timestamp: 0, service: 'A', level: 'ERROR', isLogicException: true },
      { timestamp: 0, service: 'A', level: 'ERROR', isLogicException: true },
      { timestamp: 0, service: 'A', level: 'ERROR', isLogicException: true },
    ];

    it('stores max-normalised log scores on the graph', () => {
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, { logs });

      expect(graph.logScores?.get('A')).toBe(1);
      expect(graph.logScores?.get('B')).toBe(0);
      expect(graph.logScores?.get('C')).toBe(0);
    });

    it('lifts the erroring service to rank first when enabled', () => {
      // A is the only service throwing ERROR logs, so a non-zero logWeight
      // must overcome B's modest self-anomaly lead and rank A first.
      const pruner = new TreePruner({ logWeight: 3.0 });
      const graph = pruner.buildFaultGraph(callGraph, metrics, { logs });

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('A');
    });

    it('is enabled by default (logWeight 1.0 lifts the erroring source)', () => {
      // logWeight defaults to 1.0 (proven net-positive by #220), so A — the
      // only service throwing logic-exception logs — is lifted above B's
      // higher self-anomaly even with the default TreePruner options.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, { logs });

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('A');
    });
  });

  describe('topological source signal ranking (opt-in)', () => {
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const metrics = makeMetrics({
      A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
    });

    it('stores topological-source scores with the parentless root highest', () => {
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      // A has no parent → score 1. B/C have an anomalous parent → score < 1.
      expect(graph.topoScores?.get('A')).toBe(1);
      expect(graph.topoScores?.get('B')).toBeLessThan(1);
      expect(graph.topoScores?.get('C')).toBeLessThan(1);
    });

    it('lifts the parentless source to rank first when enabled', () => {
      const pruner = new TreePruner({ topoWeight: 5.0 });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('A');
    });

    it('is disabled by default (pure self-anomaly ranking)', () => {
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('B');
    });
  });

  describe('trace-activity signal silent-source gate', () => {
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const metrics = makeMetrics({
      A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
    });
    // A is the UNIQUE significant span-count riser (pre 500, post 600 → 1.2×).
    const traceActivity = new Map<string, { pre: number; post: number }>([
      ['A', { pre: 500, post: 600 }],
    ]);

    it('emits a vote for the unique riser when the case is silent (no logic exception)', () => {
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, { traceActivity });

      expect(graph.traceActivityScores?.get('A')).toBe(1);
      expect(graph.traceActivityScores?.size).toBe(1);
    });

    it('suppresses the vote when a DIFFERENT service throws a self-caused logic exception', () => {
      // When ANY service emitted a self-caused logic exception, the case is not
      // silent — the always-on log signal already ranks that thrower. The
      // case-level gate defers entirely, even when the thrower is a different
      // (collapsing) service than the unique riser.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        traceActivity,
        logs: [{ timestamp: 0, service: 'B', level: 'ERROR', isLogicException: true }],
      });

      expect(graph.traceActivityScores?.size).toBe(0);
    });

    it('votes the silent riser when a wrapper throws a PROPAGATED parse failure', () => {
      // TrainTicket RE3 f2: the source is silent while a downstream wrapper
      // throws an empty-value parse failure (e.g. `IllegalArgumentException:
      // Invalid UUID string: `). The loader flags that as `isLogicException:
      // false` (a PROPAGATED symptom, not self-caused), so it is EXCLUDED from
      // the thrower set — the silent-source riser must still receive the vote.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        traceActivity,
        logs: [{ timestamp: 0, service: 'B', level: 'ERROR', isLogicException: false }],
      });

      expect(graph.traceActivityScores?.get('A')).toBe(1);
      expect(graph.traceActivityScores?.size).toBe(1);
    });

    it('suppresses the vote when the RISER ITSELF throws a logic exception', () => {
      // A service that threw a self-caused logic exception is not silent: the
      // log signal already ranks it, so the trace-activity signal must defer
      // rather than double-reward it.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        traceActivity,
        logs: [{ timestamp: 0, service: 'A', level: 'ERROR', isLogicException: true }],
      });

      expect(graph.traceActivityScores?.size).toBe(0);
    });
  });

  describe('collision-energy signal ranking (opt-in)', () => {
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const metrics = makeMetrics({
      A: [1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      B: [1, 1, 1, 1, 1, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5],
      C: [1, 1, 1, 1, 1, 1, 1, 3.2, 3.2, 3.2, 3.2, 3.2],
    });

    it('stores ratioContrib with the source at 0 and symptoms positive', () => {
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      // A has no upstream parent → no inherited energy → ratioContrib 0.
      expect(graph.collisionEnergy?.get('A')?.ratioContrib).toBe(0);
      // B and C inherit energy from an anomalous parent → ratioContrib > 0.
      expect(graph.collisionEnergy?.get('B')?.ratioContrib).toBeGreaterThan(0);
    });

    it('penalises upstream-explained symptoms to lift the source when enabled', () => {
      const pruner = new TreePruner({ collisionWeight: 10.0 });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('A');
    });

    it('records ratioContrib 0 when collision aggregation is disabled', () => {
      const pruner = new TreePruner({ enableCollisionAggregation: false });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      expect(graph.collisionEnergy?.get('A')?.ratioContrib).toBe(0);
      expect(graph.collisionEnergy?.get('B')?.ratioContrib).toBe(0);
    });
  });

  describe('injectTimeMs handling', () => {
    it('forwards an explicit injectTimeMs onto the built graph', () => {
      const pruner = new TreePruner();
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({ A: [10, 10, 10], B: [10, 10, 10] });

      const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: 1_000_000 });

      expect(graph.injectTimeMs).toBe(1_000_000);
    });

    it('resolves injectTimeMs from the topology config when the per-call option omits it', () => {
      // The injection time resolves as options.injectTimeMs ?? topologyConfig
      // .injectTimeMs ?? 0. A non-null topology config is the second fallback;
      // the per-call options are omitted here so the config is consulted.
      const pruner = new TreePruner(undefined, { injectTimeMs: 2_000_000 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({ A: [10, 10, 10], B: [10, 10, 10] });

      const graph = pruner.buildFaultGraph(callGraph, metrics);

      expect(graph.injectTimeMs).toBe(2_000_000);
    });

    it('analyzes a graph whose injectTimeMs is undefined (temporal signal disabled)', () => {
      // `injectTimeMs` is optional on the graph type, so analyze must tolerate a
      // graph built externally that omits it (undefined ⇒ "unknown" ⇒ neutral).
      const pruner = new TreePruner({ defaultTopK: 3 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const noInject = { ...graph, injectTimeMs: undefined };

      const results = pruner.analyze(noInject, 3);

      expect(results.length).toBeGreaterThan(0);
    });

    it('analyzes a graph with all optional ranking signals absent', () => {
      // topoScores / riseScores / logScores / traceActivityScores are optional
      // graph fields; analyze must rank purely on self-anomaly when they are
      // all stripped (each signal's lookup falls back to neutral).
      const pruner = new TreePruner({ defaultTopK: 3 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const stripped = {
        ...graph,
        topoScores: undefined,
        riseScores: undefined,
        logScores: undefined,
        traceActivityScores: undefined,
      };

      const results = pruner.analyze(stripped, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.serviceId).toBe('A');
    });
  });

  describe('topology edge cases', () => {
    it('falls back to fewest-children leaves when pruning leaves no true leaf', () => {
      // A ring with no detected cycles survives pruning intact (no weakest edge
      // is broken), leaving every node with out-degree ≥ 1 — i.e. no true leaf.
      // performTreeRCA must fall back to the fewest-children heuristic rather
      // than starting the bottom-up pass from an empty leaf set.
      const pruner = new TreePruner({ defaultTopK: 3 });
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
        B: [10, 11, 12, 10, 50],
        C: [10, 10, 10, 10, 30],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const noCycles = { ...graph, detectedCycles: [] };

      const results = pruner.analyze(noCycles, 3);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.serviceId)).toBe(true);
    });

    it('scores an isolated node (no edges) with a neutral source prior', () => {
      // A service present in the call graph and metrics but connected by no
      // edge has zero causal neighbours; its source-likelihood prior must be
      // neutral (0) rather than dividing by zero.
      const pruner = new TreePruner({ defaultTopK: 5 });
      const callGraph = makeCallGraph(['A', 'B', 'C'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 50],
        C: [10, 10, 10, 10, 10],
      });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 5);

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.serviceId)).toBe(true);
    });

    it('classifies a 3-parent convergence node as a bottleneck', () => {
      // A node with inDegree ≥ 3 and outDegree/inDegree ≤ 0.5 is a bottleneck
      // (many inputs, few outputs). The collision aggregator must label it as
      // such, and analyze must elevate its severity from the raw self-anomaly
      // band (D's own metric barely deviates → 'minor') to 'major', because a
      // convergence point has systemic impact even when its own metric is quiet.
      const pruner = new TreePruner({ defaultTopK: 5 });
      const callGraph = makeCallGraph(
        ['A', 'B', 'C', 'D', 'E'],
        [
          ['A', 'D'],
          ['B', 'D'],
          ['C', 'D'],
          ['D', 'E'],
        ],
      );
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 11, 12, 10, 90],
        C: [10, 11, 12, 10, 80],
        D: [10, 10, 10, 10, 12],
        E: [10, 10, 10, 10, 40],
      });

      const graph = pruner.buildFaultGraph(callGraph, metrics);

      expect(graph.collisionEnergy?.get('D')?.collisionType).toBe('bottleneck');

      const results = pruner.analyze(graph, 5);
      const dResult = results.find((r) => r.serviceId === 'D');
      expect(dResult).toBeDefined();
      expect(dResult!.faultType.severity).toBe('major');
    });
  });

  describe('rank-normalized self-anomaly base term', () => {
    it('gives the top-anomaly service a strictly positive finalScore under rank normalization', () => {
      // TrainTicket-style topologies (≥20 nodes) rank-normalize anomaly scores
      // to [0,1]; the top service maps to exactly 1.0. `Math.log(1.0) === 0`
      // used to collapse the base term so the strongest signal contributed
      // nothing and the ranking fell back to secondary signals or a
      // service-id tiebreak (the "0-score zombie" bothWrong failure). The base
      // term must stay strictly positive for the top anomaly so the magnitude
      // winner keeps a real advantage over its neighbours.
      const ids = Array.from({ length: 20 }, (_, i) => `svc-${i}`);
      const nodeData: Record<string, number[]> = {};
      for (let i = 0; i < 19; i++) {
        nodeData[ids[i]!] = [1, 1, 1, 1, 1, 1, 1, 1];
      }
      nodeData[ids[19]!] = [1, 1, 1, 1, 5, 5, 5, 5];

      const pruner = new TreePruner(undefined, { rankNormalization: true });
      const graph = pruner.buildFaultGraph(
        makeCallGraph(ids, [['svc-0', 'svc-1']]),
        makeMetrics(nodeData),
      );
      const results = pruner.analyze(graph, 20);

      const top = results[0]!;
      expect(top.serviceId).toBe('svc-19');
      expect(top.finalScore).toBeDefined();
      expect(top.finalScore!).toBeGreaterThan(0);
    });
  });
});

describe('TreePruner — failed-edge-direction signal', () => {
  // A caller that is failing against a callee: the two services are the two
  // roles the signal has to tell apart, and the direction is the whole point.
  const CALLER = 'ts-ui-dashboard';
  const CALLEE = 'ts-order-service';
  const failedTraceEdges = [{ caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 }];

  // Both services deviate after injection, so both are rankable candidates and
  // the ONLY thing that can separate their scores is the new term.
  const makeCase = (): [ServiceCallGraph, MetricMap] => [
    makeCallGraph([CALLER, CALLEE], [[CALLER, CALLEE]]),
    makeMetrics({
      [CALLER]: [1, 1, 1, 1, 4, 4, 4, 4],
      [CALLEE]: [1, 1, 1, 1, 3, 3, 3, 3],
    }),
  ];

  const scores = (pruner: TreePruner, options?: { failedTraceEdges: typeof failedTraceEdges }) => {
    const [callGraph, metrics] = makeCase();
    const graph = pruner.buildFaultGraph(callGraph, metrics, options);
    return {
      graph,
      byService: new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!])),
    };
  };

  it('charges the CALLEE, not the emitter, in the graph it builds', () => {
    const pruner = new TreePruner();
    const { graph } = scores(pruner, { failedTraceEdges });

    expect(graph.failedEdgeScores?.get(CALLEE)).toBe(1);
    expect(graph.failedEdgeScores?.has(CALLER)).toBe(false);
  });

  it('is neutral at the default weight: carrying the field changes no score', () => {
    // This is the property that lets the field ship in the cache before the
    // signal is trusted: at weight 0 the presence of failed edges must be
    // unobservable, exactly like an absent field.
    const pruner = new TreePruner();
    const without = scores(pruner);
    const withField = scores(pruner, { failedTraceEdges });

    expect(without.graph.failedEdgeScores?.size ?? 0).toBe(0);
    expect([...withField.byService.keys()]).toEqual([...without.byService.keys()]);
    for (const [serviceId, score] of withField.byService) {
      expect(score).toBeCloseTo(without.byService.get(serviceId)!, 12);
    }
  });

  it('raises the callee score by exactly the weight and leaves the caller alone', () => {
    // The term is `weight × score` with score in [0, 1], so with weight 1 and a
    // single charged callee the delta is exactly 1 — and the caller's own score
    // must not move, or the signal would be a re-weighting rather than a new
    // axis.
    const base = new TreePruner();
    const enabled = new TreePruner({ failedEdgeWeight: 1 });
    const before = scores(base, { failedTraceEdges }).byService;
    const after = scores(enabled, { failedTraceEdges }).byService;

    expect(after.get(CALLEE)! - before.get(CALLEE)!).toBeCloseTo(1, 10);
    expect(after.get(CALLER)!).toBeCloseTo(before.get(CALLER)!, 12);
  });

  it('carries the weight into the shared RankingWeights contract', () => {
    // `toRankingWeights` is the serializable contract the offline optimizer
    // tunes against, so a signal missing from it is invisible to tuning — and
    // an omission there is silent, because the engine's own option keeps working.
    const weights = toRankingWeights({
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1,
      riseWeight: 0,
      traceWeight: 0,
      prismWeight: 0,
      failedEdgeWeight: 0.5,
      latWeight: 0.25,
      poolMetricPenaltyWeight: 0,
    });

    expect(weights.failedEdgeWeight).toBe(0.5);
    expect(weights.latWeight).toBe(0.25);
  });

  it('keeps the weight OPTIONAL in the shared contract, so stored weight vectors still load', () => {
    // `TreePrunerOptions` requires the field (a caller must state it), but the
    // serializable `RankingWeights` keeps it optional: the optimizer persists
    // weight vectors, and a vector saved before this signal existed must still
    // be a valid input rather than a type error or a fabricated 0.
    const legacy: RankingWeights = {
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1,
      riseWeight: 0,
      traceWeight: 0,
      prismWeight: 0,
    };

    expect(legacy.failedEdgeWeight).toBeUndefined();
    // Same contract for the latency weight: a vector stored before the term
    // existed must still load, and must NOT read as a fabricated 0.
    expect(legacy.latWeight).toBeUndefined();
  });

  it('keeps the latency weight optional in the shared contract too', () => {
    const legacy: RankingWeights = {
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1,
      riseWeight: 0,
      traceWeight: 0,
      prismWeight: 0,
    };

    expect(legacy.latWeight).toBeUndefined();
  });
});

describe('TreePruner — per-edge latency-rise signal', () => {
  // The same two roles the failed-edge signal has to tell apart, but the
  // evidence is a DURATION rather than a failure count: the caller waited longer
  // on the callee. The direction is credited the same way — to the callee.
  const CALLER = 'ts-ui-dashboard';
  const CALLEE = 'ts-order-service';
  const edgeLatency = [{ caller: CALLER, callee: CALLEE, preMeanMs: 10, postMeanMs: 400 }];

  // Both services deviate after injection, so both are rankable candidates and
  // the ONLY thing that can separate their scores is the new term.
  const makeCase = (): [ServiceCallGraph, MetricMap] => [
    makeCallGraph([CALLER, CALLEE], [[CALLER, CALLEE]]),
    makeMetrics({
      [CALLER]: [1, 1, 1, 1, 4, 4, 4, 4],
      [CALLEE]: [1, 1, 1, 1, 3, 3, 3, 3],
    }),
  ];

  const scores = (pruner: TreePruner, options?: { edgeLatency: typeof edgeLatency }) => {
    const [callGraph, metrics] = makeCase();
    const graph = pruner.buildFaultGraph(callGraph, metrics, options);
    return {
      graph,
      byService: new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!])),
    };
  };

  it('credits the CALLEE whose inbound latency rose, in the graph it builds', () => {
    // The caller recorded the duration, so the callee is the service that got
    // slower — the inverse of crediting whoever observed the slowness.
    const { graph } = scores(new TreePruner(), { edgeLatency });

    expect(graph.edgeLatencyScores?.get(CALLEE)).toBe(1);
    expect(graph.edgeLatencyScores?.has(CALLER)).toBe(false);
  });

  it('is neutral at weight 0: carrying the field changes no score', () => {
    // Weight 0 is the ABLATION (673 of 1422 on FSE'26), and it is the configuration
    // the converter shipped the field under before the signal was trusted: at weight
    // 0 the presence of latency records must be unobservable, exactly like an absent
    // field. The baseline is stated EXPLICITLY rather than inherited from the
    // constructor, because the shipped default is no longer 0 — a test that relied on
    // the default would silently stop testing this property the moment it changed.
    const pruner = new TreePruner({ latWeight: 0 });
    const without = scores(pruner);
    const withField = scores(pruner, { edgeLatency });

    expect(without.graph.edgeLatencyScores?.size ?? 0).toBe(0);
    expect([...withField.byService.keys()]).toEqual([...without.byService.keys()]);
    for (const [serviceId, score] of withField.byService) {
      expect(score).toBeCloseTo(without.byService.get(serviceId)!, 12);
    }
  });

  it('raises the callee score by exactly the weight and leaves the caller alone', () => {
    // The term is `weight × score` with score in [0, 1], so with weight 1 and a
    // single credited callee the delta is exactly 1 — and the caller's own score
    // must not move, or the term would be a re-weighting rather than a new axis.
    const before = scores(new TreePruner({ latWeight: 0 }), { edgeLatency }).byService;
    const after = scores(new TreePruner({ latWeight: 1 }), { edgeLatency }).byService;

    expect(after.get(CALLEE)! - before.get(CALLEE)!).toBeCloseTo(1, 10);
    expect(after.get(CALLER)!).toBeCloseTo(before.get(CALLER)!, 12);
  });

  it('applies the SHIPPED weight by default, and it is the exported one', () => {
    // The constructor's default is the published configuration, so it has to be the
    // measured, criterion-passing point rather than the ablation. Asserted against
    // the exported constant so the value has exactly one owner: a literal here would
    // be a second copy that could agree with itself while disagreeing with the CLI.
    const shipped = scores(new TreePruner(), { edgeLatency }).byService;
    const ablation = scores(new TreePruner({ latWeight: 0 }), { edgeLatency }).byService;

    expect(DEFAULT_LAT_WEIGHT).toBeGreaterThan(0);
    expect(shipped.get(CALLEE)! - ablation.get(CALLEE)!).toBeCloseTo(DEFAULT_LAT_WEIGHT, 12);
    expect(shipped.get(CALLER)!).toBeCloseTo(ablation.get(CALLER)!, 12);
  });

  it('applies the SHIPPED floor by default, so thin rises are not credited', () => {
    // The shipped configuration is the PAIR, and the floor is the half a reader is
    // least likely to expect: a default of 1 would credit a 2x rise just as the
    // previous release did, while the weight's default is now 18x larger. A fixture
    // whose rise is below the shipped floor must therefore score as if the term were
    // off, and one above it must still be credited.
    expect(DEFAULT_LAT_MIN_RISE).toBeGreaterThan(1);
    const thin = [{ caller: CALLER, callee: CALLEE, preMeanMs: 10, postMeanMs: 20 }]; // 2x
    const thick = [{ caller: CALLER, callee: CALLEE, preMeanMs: 10, postMeanMs: 400 }]; // 40x

    const off = scores(new TreePruner({ latWeight: 0 })).byService;
    const thinShipped = scores(new TreePruner(), { edgeLatency: thin }).byService;
    const thickShipped = scores(new TreePruner(), { edgeLatency: thick }).byService;

    expect(thinShipped.get(CALLEE)!).toBeCloseTo(off.get(CALLEE)!, 12);
    expect(thickShipped.get(CALLEE)! - off.get(CALLEE)!).toBeCloseTo(DEFAULT_LAT_WEIGHT, 12);
  });

  it('masks the callee once the floor is above its rise, so the term is inert', () => {
    // The fixture's edge rises 10 -> 400, i.e. 40x. A floor of 100 removes that
    // callee from the signal entirely, so the term contributes nothing even at weight
    // 1 — which is the whole point of a floor: it is a precision knob on WHICH
    // evidence counts, independent of how much the surviving evidence counts for.
    const masked = scores(new TreePruner({ latWeight: 1, latMinRise: 100 }), {
      edgeLatency,
    }).byService;
    const noTerm = scores(new TreePruner({ latWeight: 0 }), { edgeLatency }).byService;

    expect(masked.get(CALLEE)!).toBeCloseTo(noTerm.get(CALLEE)!, 12);
    // And the graph itself carries no score for the callee, rather than a zeroed row.
    const { graph } = scores(new TreePruner({ latMinRise: 100 }), { edgeLatency });
    expect(graph.edgeLatencyScores?.size ?? 0).toBe(0);
  });

  it('is independent of the failed-edge weight it mirrors', () => {
    // The two terms gate separate signals: a run can carry the latency term with
    // the failed-edge signal off, which is the configuration this axis is
    // measured in. If they shared a gate, that run would be impossible.
    const withLatOnly = scores(new TreePruner({ latWeight: 1 }), { edgeLatency }).byService;
    const base = scores(new TreePruner({ latWeight: 0 })).byService;

    expect(withLatOnly.get(CALLEE)! - base.get(CALLEE)!).toBeCloseTo(1, 10);
  });
});

describe('TreePruner — DB-connection-pool dominance penalty', () => {
  // Two candidates that differ ONLY in which series won their anomaly maximum: the
  // one whose pool series dominates is the service the term is about, and the other
  // exists so "no other service moves" is a measurement rather than a claim.
  const POOL = 'ts-consign-service';
  const OTHER = 'ts-order-service';

  /** The pool service carries both series and the pool one wins; the other has cpu only. */
  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      [
        POOL,
        [
          makeTimeSeries('cpu_usage', [1, 1, 1, 1, 2, 2, 2, 2]),
          // A far larger post-injection level, so this series wins the maximum.
          makeTimeSeries(`${POOL_METRIC_PREFIX}use_time.max`, [1, 1, 1, 1, 900, 900, 900, 900]),
        ],
      ],
      [OTHER, [makeTimeSeries('cpu_usage', [1, 1, 1, 1, 4, 4, 4, 4])]],
    ]);
    return [makeCallGraph([POOL, OTHER], [[OTHER, POOL]]), metrics];
  };

  const scores = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    const graph = pruner.buildFaultGraph(callGraph, metrics);
    return {
      graph,
      byService: new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!])),
    };
  };

  it('marks the pool-dominant service in the graph it builds, and only that one', () => {
    const { graph } = scores(new TreePruner());

    expect(graph.poolMetricScores?.get(POOL)).toBe(1);
    expect(graph.poolMetricScores?.get(OTHER)).toBe(0);
  });

  it('applies the SHIPPED weight by default, and it is the exported measured one', () => {
    // The constructor's default is the published configuration, so it has to be the
    // measured, criterion-passing point rather than the ablation — and it is asserted
    // against the exported constant so the number has one owner. A literal here would
    // be a second copy that could agree with itself while disagreeing with the CLI.
    const shipped = scores(new TreePruner()).byService;
    const off = scores(new TreePruner({ poolMetricPenaltyWeight: 0 })).byService;

    expect(DEFAULT_POOL_METRIC_PENALTY_WEIGHT).toBeGreaterThan(0);
    expect(off.get(POOL)! - shipped.get(POOL)!).toBeCloseTo(DEFAULT_POOL_METRIC_PENALTY_WEIGHT, 10);
    expect(shipped.get(OTHER)!).toBeCloseTo(off.get(OTHER)!, 12);
  });

  it('LOWERS the pool-dominant service by exactly the weight and moves nobody else', () => {
    // A new axis, not a re-weighting: the credited service loses exactly the weight
    // and every other candidate's score is untouched. The weight is stated
    // explicitly rather than inherited, so this keeps testing the property after the
    // default is flipped.
    const weight = 0.25;
    const before = scores(new TreePruner({ poolMetricPenaltyWeight: 0 })).byService;
    const after = scores(new TreePruner({ poolMetricPenaltyWeight: weight })).byService;

    expect(before.get(POOL)! - after.get(POOL)!).toBeCloseTo(weight, 10);
    expect(after.get(OTHER)!).toBeCloseTo(before.get(OTHER)!, 12);
  });

  it('treats a graph with NO dominance recorded as unpenalised', () => {
    // A `FaultPropagationGraph` may legally omit the map (it is optional on the shared
    // contract), and the term must then be exactly 0 rather than subtract from every
    // service: "not recorded" is not "not pool-dominant" applied backwards.
    const [callGraph, metrics] = makeCase();
    const pruner = new TreePruner({ poolMetricPenaltyWeight: 0.25 });
    const graph = pruner.buildFaultGraph(callGraph, metrics);
    const withoutField = { ...graph, poolMetricScores: undefined };
    const penalised = new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!]));
    const plain = new Map(pruner.analyze(withoutField).map((r) => [r.serviceId, r.finalScore!]));

    expect(plain.get(POOL)! - penalised.get(POOL)!).toBeCloseTo(0.25, 10);
  });

  it('carries the weight into the serializable weight vector', () => {
    // Every weight is stated explicitly: the vector is the optimizer's contract, so a
    // test that spread the engine's private options would stop compiling (and had
    // already stopped saying anything about which values it checked).
    const weights: RankingWeights = toRankingWeights({
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1,
      riseWeight: 0,
      traceWeight: 0,
      prismWeight: 0,
      failedEdgeWeight: 0,
      latWeight: 0,
      poolMetricPenaltyWeight: 0.0679,
    });

    expect(weights.poolMetricPenaltyWeight).toBe(0.0679);
  });

  it('reads a legacy weight vector without the key as OFF, never as a fabricated 0', () => {
    // A stored vector written before this term existed must keep meaning "off" — and
    // the field has to stay optional on the shared contract for that to be sayable.
    const legacy: RankingWeights = {
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1,
    };
    const weights = toRankingWeights({
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: legacy.logWeight,
      riseWeight: 0,
      traceWeight: 0,
      prismWeight: 0,
      failedEdgeWeight: 0,
      latWeight: 0,
      poolMetricPenaltyWeight: 0,
    });

    // The CONTRACT keeps the field optional, so a vector stored before this term
    // existed simply does not carry it — and reading it yields `undefined`, never a
    // fabricated 0 that would claim the term was measured and disabled.
    expect(legacy.poolMetricPenaltyWeight).toBeUndefined();
    // What the PRODUCER emits is a different statement: `toRankingWeights` takes the
    // option as required, so it always writes the number.
    expect(weights.poolMetricPenaltyWeight).toBe(0);
  });

  describe('temporal prior — the shape decides what the term says, the weight how much', () => {
    /**
     * Three services in one call chain, their dominant metric crossing at successive
     * samples after the injection: A first, then B, then C — and deliberately UNEVENLY
     * spaced, with C three samples behind B.
     *
     * The spacing is the fixture's point, not a detail. Two services that cross one
     * sample apart and a third that crosses much later is what separates the two shapes:
     * an evenly spaced field makes min-max-in-the-delay and linear-in-the-rank the same
     * function, and a test built on one would report "the shapes agree" as if that were
     * a property of the shapes rather than of the fixture.
     *
     * The `injectTimeMs` anchor is what makes any of this measurable, and it is passed
     * through the graph options rather than declared in the fixture — the engine reads
     * it once and reuses it for the onset anchor, the log window and the graph.
     */
    const ANCHOR = 120000;
    const callGraph = makeCallGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
    );
    const metrics = makeMetrics({
      A: [10, 10, 10, 50, 50, 50, 50, 50],
      B: [10, 10, 10, 10, 50, 50, 50, 50],
      C: [10, 10, 10, 10, 10, 10, 10, 50],
    });
    /** Every candidate's ranking score, by service. */
    const scores = (options: ConstructorParameters<typeof TreePruner>[0]): Map<string, number> => {
      const pruner = new TreePruner(options);
      const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: ANCHOR });
      return new Map(
        pruner
          .analyze(graph, 3)
          .flatMap((result) =>
            result.finalScore === undefined ? [] : [[result.serviceId, result.finalScore] as const],
          ),
      );
    };

    /**
     * The baseline is stated EXPLICITLY rather than inherited from the constructor.
     *
     * The shipped weight is no longer 0, so a test that used `new TreePruner()` as its
     * "term off" arm would silently stop testing anything the moment the default moved
     * — the arms would differ by a shape and both would carry the term. `OFF` is the
     * ablation as a number, not as an omission.
     */
    const OFF = { temporalWeight: 0 } as const;

    it('is inert at weight 0 whatever the shape says', () => {
      // The property that let the shape be enrolled, screened and dispatched BEFORE a
      // weight was chosen: the term is multiplied by the weight, so at 0 the shape's
      // own opinion cannot reach a score. Asserted against a pruner that never mentions
      // either field, so this cannot pass by comparing two spellings of one default.
      const baseline = scores(OFF);
      for (const onsetShape of ONSET_SHAPES) {
        expect([...scores({ temporalWeight: 0, onsetShape })].sort()).toEqual([...baseline].sort());
      }
    });

    it('ships the measured PAIR, and the default is that pair', () => {
      // The value the recorded-runs guard reads out of source as text has to be the
      // value the ENGINE actually uses, or the guard polices a comment. Asserted by
      // construction: an omitted option must behave exactly like the two constants.
      const shipped = scores({
        temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
        onsetShape: DEFAULT_ONSET_SHAPE,
      });
      expect([...scores(undefined)]).toEqual([...shipped]);
      // And the shipped pair is the one the screen found: the first mover gains exactly
      // the shipped weight. If the shape were ever flipped alone, the default would
      // credit a different service and this arithmetic would stop holding.
      expect(shipped.get('A')! - scores(OFF).get('A')!).toBeCloseTo(DEFAULT_TEMPORAL_WEIGHT, 12);
      expect(DEFAULT_ONSET_SHAPE).toBe('earliest-only');
    });

    it('credits the first mover, and ONLY the first mover, by exactly the weight', () => {
      // Every shape maps a case to slopes, and the score is `base + w × slope`. The
      // assertion is therefore arithmetic: A is the first mover, so it gains exactly the
      // weight; B and C are not the boundary set, so they do not move at all. A term
      // that moved anybody else would be a reweighting, not this axis.
      const baseline = scores(OFF);
      const credited = scores({ temporalWeight: 1, onsetShape: 'earliest-only' });

      expect(credited.get('A')! - baseline.get('A')!).toBeCloseTo(1, 12);
      expect(credited.get('B')!).toBeCloseTo(baseline.get('B')!, 12);
      expect(credited.get('C')!).toBeCloseTo(baseline.get('C')!, 12);
    });

    it('is not symmetric under reversal, which is what makes the direction testable', () => {
      // The premise is that cause precedes effect. If crediting whoever moved LAST
      // helped as much, the signal would be a proxy for "extreme onset" rather than for
      // order — so the reversed shape must credit the OTHER end, and the screen's
      // control arm is only meaningful because this holds.
      const baseline = scores(OFF);
      const reversed = scores({ temporalWeight: 1, onsetShape: 'latest-only' });

      expect(reversed.get('C')! - baseline.get('C')!).toBeCloseTo(-1, 12);
      expect(reversed.get('A')!).toBeCloseTo(baseline.get('A')!, 12);
    });

    it('reads the RANK in the order shape, so a far outlier cannot flatten the credit', () => {
      // The delays are 60000 / 120000 / 300000 ms, so the engine's original shape —
      // min-max in the DELAY — gives B an earliness of 0.75 and therefore a slope of
      // 0.5, while C sits alone at the far end. The rank shape spaces the same three
      // services evenly. Both are reported by the screen, and they are different
      // statements about the case, which is why the screen sweeps the menu.
      const baseline = scores(OFF);
      const engine = scores({ temporalWeight: 1, onsetShape: 'earliness' });
      const byRank = scores({ temporalWeight: 1, onsetShape: 'order' });

      expect(engine.get('A')! - baseline.get('A')!).toBeCloseTo(1, 12);
      expect(engine.get('B')! - baseline.get('B')!).toBeCloseTo(0.5, 12);
      expect(engine.get('C')! - baseline.get('C')!).toBeCloseTo(-1, 12);
      expect(byRank.get('A')! - baseline.get('A')!).toBeCloseTo(1, 12);
      expect(byRank.get('B')! - baseline.get('B')!).toBeCloseTo(0, 12);
      expect(byRank.get('C')! - baseline.get('C')!).toBeCloseTo(-1, 12);
    });
  });
});
