import type {
  CallEdge,
  MetricMap,
  RankingWeights,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  classifyTermZero,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_POOLING,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  isPrismPooling,
  ONSET_SHAPES,
  POOL_METRIC_PREFIX,
  PRISM_POOLINGS,
  sumScoreTerms,
  toRankingWeights,
  TreePruner,
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

    it("reports the graph's fault-TYPE hypothesis, keeping the descriptor's severity", () => {
      // Two questions, two answers, one object: the descriptor says how SEVERE the node is and
      // whether it is local or cascaded (`subType`), and the hypothesis says WHICH KIND of fault its
      // dominant metric names (`category`). Only the category is replaced — the benchmark scores that
      // as `TA`, and the descriptor's own vocabulary could never match a ground-truth label.
      const pruner = new TreePruner({ defaultTopK: 3 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 10, 10, 10, 10],
      });

      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze(graph, 3);

      expect(graph.faultHypotheses?.get('A')?.category).toBe('CPU');
      expect(results[0]!.serviceId).toBe('A');
      expect(results[0]!.faultType.category).toBe('CPU');
      expect(results[0]!.faultType.subType).toContain('anomaly');
    });

    it('falls back to the severity descriptor when the graph carries no hypotheses', () => {
      // A graph built by another engine, or by an older one, has no hypotheses — and the fallback has
      // to be the descriptor rather than a default category, because a default would be a claim about
      // a series the engine never saw.
      const pruner = new TreePruner({ defaultTopK: 3 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      const metrics = makeMetrics({
        A: [10, 11, 12, 10, 100],
        B: [10, 10, 10, 10, 10],
      });

      const graph = pruner.buildFaultGraph(callGraph, metrics);
      const results = pruner.analyze({ ...graph, faultHypotheses: undefined }, 3);

      // The descriptor's whole vocabulary, `UNKNOWN` included: the fallback's job is to answer with
      // what the ranking knows, not to invent a category the series never supported.
      expect(['CPU', 'MEMORY', 'CONNECTION_POOL', 'CODE_ERROR', 'UNKNOWN']).toContain(
        results[0]!.faultType.category,
      );
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
        stabilityWeight: 0,
        selfTimeWeight: 0.9,
        victimWeight: 0.9,
        dualFamilyWeight: 0.7,
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
        stabilityWeight: 0,
        selfTimeWeight: 0.9,
        victimWeight: 0.9,
        dualFamilyWeight: 0.7,
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

  describe('topological discount (multiplicative, scale-free)', () => {
    // `a → b` means a CALLS b, so `a` is the caller of an anomalous callee: its own anomaly is the
    // symptom's. `a`'s self-anomaly is the larger of the two, which is exactly the situation the
    // discount exists for — magnitude favours the symptom.
    const callGraph = makeCallGraph(['a', 'b'], [['a', 'b']]);
    const metrics = makeMetrics({
      a: [1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3],
      b: [1, 1, 1, 1, 1, 1, 2.8, 2.8, 2.8, 2.8, 2.8, 2.8],
    });

    it('is off by default and changes nothing when off', () => {
      // Bit-identity, asserted on the OBSERVABLE rather than on an internal: the shipped pruner and a
      // pruner whose discount is 0 must produce the same ranking and the same scores.
      const shipped = new TreePruner();
      const explicitZero = new TreePruner({ topoDiscount: 0 });
      const graph = shipped.buildFaultGraph(callGraph, metrics);

      const a = shipped.analyze(graph, 2);
      const b = explicitZero.analyze(graph, 2);

      expect(a.map((r) => r.serviceId)).toEqual(b.map((r) => r.serviceId));
      expect(a.map((r) => r.finalScore)).toEqual(b.map((r) => r.finalScore));
      // …and the shipped ranking is the one magnitude picks: the larger self-anomaly first.
      expect(a[0]!.serviceId).toBe('a');
    });

    it('demotes the explained caller and leaves the unexplained callee where it is', () => {
      // `b` has no callee, so nothing explains it and the multiplier is 1: its score is unchanged. `a`
      // is explained by `b`, keeps (1 − ρ·(1 − topoSource(a))) of its anomaly, and loses rank 1 for a
      // full discount. This is the behaviour the additive term could not express on a rank scale:
      // the shape of the change is a RATIO, not a constant.
      const shipped = new TreePruner();
      const discounted = new TreePruner({ topoDiscount: 1 });
      const graph = shipped.buildFaultGraph(callGraph, metrics);

      const before = shipped.analyze(graph, 2);
      const after = discounted.analyze(graph, 2);

      expect(before[0]!.serviceId).toBe('a');
      expect(after[0]!.serviceId).toBe('b');
      const bBefore = before.find((r) => r.serviceId === 'b')!.finalScore!;
      const bAfter = after.find((r) => r.serviceId === 'b')!.finalScore!;
      expect(bAfter).toBeCloseTo(bBefore, 12);
      expect(after.find((r) => r.serviceId === 'a')!.finalScore!).toBeLessThan(
        before.find((r) => r.serviceId === 'a')!.finalScore!,
      );
    });

    it("returns the graph's own map when the graph carries no topological scores at all", () => {
      // A graph assembled by another engine — or by an older one — has anomalies and no `topoScores`. The
      // discount is a function OF that map, so with nothing to consult the honest answer is no discount,
      // and it must be no discount rather than a throw: a missing optional is not a configuration error.
      const pruner = new TreePruner({ topoDiscount: 0.5 });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze({ ...graph, topoScores: undefined }, 2);

      expect(results).toHaveLength(2);
      expect(results[0]!.serviceId).toBe('a');
    });

    it('treats a node with no topological score as a source — nothing explains it, so nothing discounts it', () => {
      // The `?? 1` in the multiplier, asserted on the OBSERVABLE instead of on the internals: with a full
      // discount the explained caller `a` loses rank 1, but if `a` is ABSENT from the map there is no
      // explanation to charge it, so it keeps its anomaly entire and keeps rank 1. A default of `0` here
      // would silently erase every node the map does not mention.
      const graph = new TreePruner().buildFaultGraph(callGraph, metrics);
      const partial = new Map(graph.topoScores!);
      partial.delete('a');

      const results = new TreePruner({ topoDiscount: 1 }).analyze(
        { ...graph, topoScores: partial },
        2,
      );

      expect(results[0]!.serviceId).toBe('a');
    });

    it('rejects a discount outside [0, 1] rather than clamping it', () => {
      // A fraction outside the unit interval is a different QUANTITY, not a different setting: `2` would
      // invert the node's anomaly's sign. Failing here is the point; a silent fallback would answer a
      // question nobody asked.
      const pruner = new TreePruner({ topoDiscount: 2 });
      const graph = pruner.buildFaultGraph(callGraph, metrics);
      expect(() => pruner.analyze(graph, 2)).toThrow(/topoDiscount/);
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

    it('stores topological-source scores with the deepest CALLEE highest', () => {
      // The convention, now written down because it is the whole content of this signal: `A → B`
      // means A CALLS B, so a fault at B makes A wait and A's anomaly is the symptom. The chain
      // A → B → C therefore leaves C unexplained — it has no callee — while A and B are explained by
      // the node downstream of them.
      //
      // The test used to assert the opposite (`A` scores 1 because it has no PARENT) for the whole
      // life of the term, which is the direction that costs 24.8 pp at weight 0.5 on RCAEval.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      expect(graph.topoScores?.get('C')).toBe(1);
      expect(graph.topoScores?.get('A')).toBeLessThan(1);
      expect(graph.topoScores?.get('B')).toBeLessThan(1);
    });

    it('lifts the unexplained callee to rank first when enabled', () => {
      const pruner = new TreePruner({ topoWeight: 5.0 });
      const graph = pruner.buildFaultGraph(callGraph, metrics);

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('C');
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
  const GATEWAY = 'ts-gateway';
  const failedTraceEdges = [{ caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 }];
  // The gate's second half needs an INBOUND rise on the rank-1 service, and the
  // dashboard is the root of the fixture's topology — so a third service calls
  // it. 400 / 1 = 400, inside the measured plateau ([240, 360] is where the
  // corpus's criterion holds; the constant is its midpoint, 300).
  const inboundLatency = [{ caller: GATEWAY, callee: CALLER, preMeanMs: 1, postMeanMs: 400 }];

  const makeCase = (
    /**
     * The rank-1 service's dominant metric. The gate reads it, so a fixture that
     * leaves it a resource series is a fixture of a case the term is REFUSED on —
     * which is the second half of this block rather than a variation of the first.
     */
    rankOneMetricLabel = 'http.server.request.duration',
  ): [ServiceCallGraph, MetricMap] => [
    makeCallGraph(
      [GATEWAY, CALLER, CALLEE],
      [
        [GATEWAY, CALLER],
        [CALLER, CALLEE],
      ],
    ),
    new Map<string, readonly TimeSeries[]>([
      // Both of these deviate after injection, so both are rankable candidates
      // and the ONLY thing that can separate their scores is the new term.
      [GATEWAY, [makeTimeSeries('cpu_usage', [1, 1, 1, 1, 2, 2, 2, 2])]],
      [CALLER, [makeTimeSeries(rankOneMetricLabel, [1, 1, 1, 1, 4, 4, 4, 4])]],
      [CALLEE, [makeTimeSeries('cpu_usage', [1, 1, 1, 1, 3, 3, 3, 3])]],
    ]),
  ];

  const scores = (
    pruner: TreePruner,
    options?: {
      failedTraceEdges: typeof failedTraceEdges;
      edgeLatency?: typeof inboundLatency;
    },
    rankOneMetricLabel?: string,
  ) => {
    const [callGraph, metrics] = makeCase(rankOneMetricLabel);
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
    //
    // The case is the one the term is ADMITTED on: its rank-1 carries a duration
    // dominant metric and an inbound rise of 400. Both halves are the fixture's,
    // and the two tests below are what make them load-bearing rather than
    // decoration.
    // The term-OFF pole, stated rather than inherited: the shipped default became 3 in iteration 125, so
    // `new TreePruner()` is no longer "without this term".
    const base = new TreePruner({ failedEdgeWeight: 0 });
    const enabled = new TreePruner({ failedEdgeWeight: 1 });
    const before = scores(base, { failedTraceEdges, edgeLatency: inboundLatency }).byService;
    const after = scores(enabled, { failedTraceEdges, edgeLatency: inboundLatency }).byService;

    expect(after.get(CALLEE)! - before.get(CALLEE)!).toBeCloseTo(1, 10);
    expect(after.get(CALLER)!).toBeCloseTo(before.get(CALLER)!, 12);
  });

  it('refuses the term on a rank-1 whose dominant metric is a RESOURCE series, whatever the rise', () => {
    // The oracle mutation, at the engine's own boundary: the same failures, the
    // same topology and a rise of 400 — an observably enormous one — and the term
    // must contribute NOTHING, because the only thing that changed is the name of
    // the metric that won the rank-1's anomaly. A gate that admitted this would
    // be reading the injected fault CLASS rather than an observable, which is the
    // defect that kept the term out of the engine for six iterations.
    // The term-OFF pole, stated rather than inherited: the shipped default became 3 in iteration 125, so
    // `new TreePruner()` is no longer "without this term".
    const base = new TreePruner({ failedEdgeWeight: 0 });
    const enabled = new TreePruner({ failedEdgeWeight: 1 });
    const before = scores(
      base,
      { failedTraceEdges, edgeLatency: inboundLatency },
      'cpu_usage',
    ).byService;
    const after = scores(
      enabled,
      { failedTraceEdges, edgeLatency: inboundLatency },
      'cpu_usage',
    ).byService;

    expect(after.get(CALLEE)!).toBeCloseTo(before.get(CALLEE)!, 12);
    expect(after.get(CALLER)!).toBeCloseTo(before.get(CALLER)!, 12);
  });

  it('refuses the term on a duration-dominant rank-1 whose rise is below the floor', () => {
    // The other half, isolated: the name admits and the MAGNITUDE does not. 40 is
    // below the plateau's lower bound (240) as well as below the constant (300),
    // so the case is refused at every point a reader could plausibly reconstruct
    // the rule from — the harmful types' median rise is 9.0, an order of magnitude
    // under even the smallest floor the corpus admits.
    // The term-OFF pole, stated rather than inherited: the shipped default became 3 in iteration 125, so
    // `new TreePruner()` is no longer "without this term".
    const base = new TreePruner({ failedEdgeWeight: 0 });
    const enabled = new TreePruner({ failedEdgeWeight: 1 });
    const slow = [{ caller: GATEWAY, callee: CALLER, preMeanMs: 10, postMeanMs: 400 }];
    const before = scores(base, { failedTraceEdges, edgeLatency: slow }).byService;
    const after = scores(enabled, { failedTraceEdges, edgeLatency: slow }).byService;

    expect(after.get(CALLEE)!).toBeCloseTo(before.get(CALLEE)!, 12);
  });

  it('reads the RANK-1 rise, not the term target’s — the subject is the engine’s own answer', () => {
    // A case where the two roles differ: the rank-1 (the dashboard) is slow by 400
    // and the term's own target (the order service) has NO inbound measurement at
    // all. Admitting on the target's rise would make the gate unobservable here;
    // admitting on the rank-1's is what the benchmark measured, and it is the only
    // subject that exists before the term is applied.
    // The term-OFF pole, stated rather than inherited: the shipped default became 3 in iteration 125, so
    // `new TreePruner()` is no longer "without this term".
    const base = new TreePruner({ failedEdgeWeight: 0 });
    const enabled = new TreePruner({ failedEdgeWeight: 1 });
    const before = scores(base, { failedTraceEdges, edgeLatency: inboundLatency });
    const after = scores(enabled, { failedTraceEdges, edgeLatency: inboundLatency });

    expect(after.graph.edgeLatencyByCallee?.get(CALLEE)).toBeUndefined();
    expect(after.byService.get(CALLEE)! - before.byService.get(CALLEE)!).toBeCloseTo(1, 10);
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
      stabilityWeight: 0,
      selfTimeWeight: 0.9,
      victimWeight: 0.9,
      dualFamilyWeight: 0.7,
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
      stabilityWeight: 0,
      selfTimeWeight: 0.9,
      victimWeight: 0.9,
      dualFamilyWeight: 0.7,
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
      stabilityWeight: 0,
      selfTimeWeight: 0.9,
      victimWeight: 0.9,
      dualFamilyWeight: 0.7,
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

    it('ships the term OFF, which is the recorded point after the golden rejected it', () => {
      // The pair SHIPPED once — at `0.036552` with `earliest-only` — and was reverted: it
      // gained 4 cases of 1422 on FSE'26 with zero regressed fault types and moved six of
      // the nine RCAEval golden cells, two of them by ~41pp (`fse26-onset-verdict.md` §8).
      // So the default is the ablation, and that is a MEASUREMENT rather than an absence.
      expect(DEFAULT_TEMPORAL_WEIGHT).toBe(0);
      expect([...scores(undefined)]).toEqual([...scores(OFF)]);
      expect([
        ...scores({ temporalWeight: DEFAULT_TEMPORAL_WEIGHT, onsetShape: DEFAULT_ONSET_SHAPE }),
      ]).toEqual([...scores(OFF)]);
      // The candidate is MEASURABLE, not erased: at its recorded weight the first mover
      // gains exactly that weight, which is the arithmetic the FSE'26 +4 was a consequence
      // of. A test that only asserted "0 is 0" would leave the rejection unverifiable.
      const candidate = scores({ temporalWeight: 0.036552, onsetShape: 'earliest-only' });
      expect(candidate.get('A')! - scores(OFF).get('A')!).toBeCloseTo(0.036552, 12);
      // And at the shipped weight the ranking is pure self-anomaly again, which is what the
      // golden suite requires.
      expect(scores(undefined).get('B')!).toBeGreaterThan(scores(undefined).get('A')!);
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

describe('TreePruner — decisive-stability prior', () => {
  // Two candidates that differ ONLY in the dispersion of their dominant series: the steadier one is
  // the service the term is about, and the other exists so "no other service moves" is a
  // measurement rather than a claim. The series are deliberately UNEVEN in spread — a fixture with
  // two equally noisy series would make the rank term trivially equal to any magnitude term.
  const STABLE = 'ts-consign-service';
  const NOISY = 'ts-order-service';

  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      // Both series RISE after the injection (so both are candidates at all) and differ only in how
      // evenly: cv ≈ 0.33, below the 0.5 threshold the bonus is gated at, so this bonus is exactly 0.
      [STABLE, [makeTimeSeries('cpu_usage', [1, 1, 1, 1, 2, 2, 2, 2])]],
      // cv ≈ 1.33, above it, so its bonus is `min(cv, 1.5) × 0.05` and the term ranks it last.
      [NOISY, [makeTimeSeries('cpu_usage', [1, 1, 1, 1, 7, 11, 7, 11])]],
    ]);
    return [makeCallGraph([STABLE, NOISY], [[NOISY, STABLE]]), metrics];
  };

  const scores = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    const graph = pruner.buildFaultGraph(callGraph, metrics);
    return {
      graph,
      byService: new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!])),
    };
  };

  /** The same graph with the term's own field removed, so "inert" is against its ABSENCE. */
  const withoutField = (): ReadonlyMap<string, number> => {
    const [callGraph, metrics] = makeCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics);
    return new Map(
      new TreePruner()
        .analyze({ ...graph, stabilityScores: undefined })
        .map((r) => [r.serviceId, r.finalScore!]),
    );
  };

  it('carries the RANK of the decisive dispersion bonus in the graph it builds', () => {
    // Credit is attributed to the right service: the one whose dominant metric is the steadier.
    const { graph } = scores(new TreePruner());

    expect(graph.stabilityScores?.get(STABLE)).toBe(1);
    expect(graph.stabilityScores?.get(NOISY)).toBe(0);
  });

  it('ships the measured point, and the constructor default IS that point', () => {
    // Read from the exported constant: the number has one owner and a literal here would be a
    // second copy. Asserted rather than merely used, because the whole class of tests that used
    // `new TreePruner()` as their "term off" arm silently stops testing anything the day the
    // default flips — this is the assertion that says which side of that day we are on.
    expect(DEFAULT_STABILITY_WEIGHT).toBe(0.007352);
    const shipped = scores(new TreePruner()).byService;
    const ablated = scores(new TreePruner({ stabilityWeight: 0 })).byService;

    // So `new TreePruner()` is the SHIPPED arm now, not the ablation: a test that inherited the
    // constructor default as its "term off" would silently have both arms carrying the term.
    expect(shipped.get(STABLE)!).not.toBeCloseTo(ablated.get(STABLE)!, 12);
    expect(shipped.get(STABLE)! - ablated.get(STABLE)!).toBeCloseTo(DEFAULT_STABILITY_WEIGHT, 10);
    expect(shipped.get(NOISY)!).toBeCloseTo(ablated.get(NOISY)!, 12);
  });

  it('is inert at weight 0 even with the field present, against a pruner that never mentions it', () => {
    // Against the graph WITHOUT the map, not against another spelling of the same default: the
    // second would pass while both spellings drifted together.
    const zero = scores(new TreePruner({ stabilityWeight: 0 })).byService;
    const absent = withoutField();

    expect(zero.get(STABLE)!).toBeCloseTo(absent.get(STABLE)!, 12);
    expect(zero.get(NOISY)!).toBeCloseTo(absent.get(NOISY)!, 12);
  });

  it('RAISES the steadier service by exactly the weight and moves nobody else', () => {
    // A new axis, not a re-weighting. The weight is stated explicitly rather than inherited, so
    // this keeps testing the property after the default is flipped.
    const weight = 0.25;
    const before = scores(new TreePruner({ stabilityWeight: 0 })).byService;
    const after = scores(new TreePruner({ stabilityWeight: weight })).byService;

    expect(after.get(STABLE)! - before.get(STABLE)!).toBeCloseTo(weight, 10);
    expect(after.get(NOISY)!).toBeCloseTo(before.get(NOISY)!, 12);
  });
});

describe('TreePruner — the PRISM pooling axis', () => {
  // The option exists to make PRISM's SECOND combination function reachable from the engine.
  // `combinePrismScore` implemented both poolings and the standalone evaluator dispatched them
  // (`run-prism.ts --pooling conjunctive`), but the engine's single call site omitted the argument
  // — so `conjunctive`, the only pooling that resolves the code-level block in the controlled
  // head-to-head, could not be selected by any engine configuration, any ablation row or any
  // dispatch. These assertions are the reach, and they are exact rather than directional.
  const BOTH = 'ts-order-service';
  const EXT_ONLY = 'ts-ui-dashboard';

  // Eight points at one-minute spacing, injected halfway: the first four are the clean baseline and
  // the last four the post-fault window, which is the split `deviationZScore` needs.
  const INJECT_MS = 4 * 60000;

  /**
   * One candidate anomalous in BOTH channels and one in the EXTERNAL channel alone.
   *
   * The asymmetry PRISM is built on, and the fixture is chosen so the two poolings cannot agree:
   * with a constant baseline the z-score falls back to the relative change, so `BOTH` reads
   * S^I = S^E = 3 and `EXT_ONLY` reads S^I = 0, S^E = 4. Additive gives 6 − log1p(6) against
   * 4 − log1p(4) — the external-only symptom is still a candidate. Conjunctive gates it to
   * min(0, 4) = 0, so it is not.
   */
  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      [
        BOTH,
        [
          makeTimeSeries('cpu_usage', [1, 1, 1, 1, 4, 4, 4, 4]),
          makeTimeSeries('latency', [1, 1, 1, 1, 4, 4, 4, 4]),
        ],
      ],
      [
        EXT_ONLY,
        [
          makeTimeSeries('cpu_usage', [1, 1, 1, 1, 1, 1, 1, 1]),
          makeTimeSeries('latency', [1, 1, 1, 1, 5, 5, 5, 5]),
        ],
      ],
    ]);
    return [makeCallGraph([BOTH, EXT_ONLY], [[EXT_ONLY, BOTH]]), metrics];
  };

  const build = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    return pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: INJECT_MS });
  };

  const scores = (pruner: TreePruner): Map<string, number> => {
    const graph = build(pruner);
    return new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!]));
  };

  it('ships the additive pooling, and the option default IS that value', () => {
    // Read from the owner constant rather than restated: the value is quoted by the engine's option
    // surface and by the reported configuration line, and a literal here would be a second copy.
    expect(isPrismPooling(DEFAULT_PRISM_POOLING)).toBe(true);
    expect(DEFAULT_PRISM_POOLING).toBe('additive');
    // And the map the engine builds without naming a pooling is the map the constant names.
    expect([...build(new TreePruner()).prismScores!]).toEqual([
      ...build(new TreePruner({ prismPooling: DEFAULT_PRISM_POOLING })).prismScores!,
    ]);
  });

  it('FORWARDS the option to the primitive, which is the defect this axis repairs', () => {
    // The reach assertion, and the one that fails on the pre-repair engine: the call site omitted
    // the argument, so `prismWeight` carried a score built ADDITIVELY whatever the pruner was
    // configured with, and both maps below were identical.
    const additive = build(new TreePruner({ prismPooling: 'additive' })).prismScores!;
    const conjunctive = build(new TreePruner({ prismPooling: 'conjunctive' })).prismScores!;

    // The both-channel service is the maximum under either pooling, so it pins the normalisation.
    expect(additive.get(BOTH)).toBe(1);
    expect(conjunctive.get(BOTH)).toBe(1);
    // The external-only symptom: a candidate additively, and gated to zero conjunctively. The exact
    // zero is the asymmetry stated as a hard prior, and it is why the two maps cannot be equal.
    expect(additive.get(EXT_ONLY)).toBeGreaterThan(0);
    expect(conjunctive.get(EXT_ONLY)).toBe(0);
    expect(conjunctive.get(EXT_ONLY)).not.toBe(additive.get(EXT_ONLY));
  });

  it('moves the cited candidate by exactly the weight when the pooling flips', () => {
    // A behavioural reading of the same reach, base-independent: `finalScore` carries an
    // unweighted `log1p(selfAnomaly)` term, so the delta is measured rather than the absolute
    // value. Weight 1 makes the delta the difference of the two normalised PRISM scores.
    const weight = 1;
    const before = scores(new TreePruner({ prismWeight: weight, prismPooling: 'additive' }));
    const after = scores(new TreePruner({ prismWeight: weight, prismPooling: 'conjunctive' }));
    const prismAdditive = build(new TreePruner({ prismPooling: 'additive' })).prismScores!;
    const prismConjunctive = build(new TreePruner({ prismPooling: 'conjunctive' })).prismScores!;

    expect(after.get(EXT_ONLY)! - before.get(EXT_ONLY)!).toBeCloseTo(
      weight * (prismConjunctive.get(EXT_ONLY)! - prismAdditive.get(EXT_ONLY)!),
      10,
    );
    expect(after.get(BOTH)! - before.get(BOTH)!).toBeCloseTo(0, 10);
    // And the moved one really moved down by the whole of its score, so the assertion is not a
    // tautology over two equal numbers.
    expect(Math.abs(after.get(EXT_ONLY)! - before.get(EXT_ONLY)!)).toBeGreaterThan(0.1);
  });

  it('is inert while the signal is off, which is why it cannot move a published number', () => {
    // `prismWeight` ships at 0, so the pooling is inert at the shipped configuration — the property
    // that makes enrolling this axis a change to the option surface rather than to any measurement.
    // The shipped side is read from the DEFAULT map the engine builds without naming a pooling.
    expect([...build(new TreePruner()).prismScores!].length).toBeGreaterThan(0);
    const additive = scores(new TreePruner({ prismPooling: 'additive' }));
    const conjunctive = scores(new TreePruner({ prismPooling: 'conjunctive' }));
    const shipped = scores(new TreePruner());
    expect([...conjunctive.entries()]).toEqual([...additive.entries()]);
    expect([...shipped.entries()]).toEqual([...additive.entries()]);
  });

  it('states the pooling on the vocabulary the union owns, not a second spelling', () => {
    // The option's own type is the union, and the vocabulary it is read against is the core census
    // — so a runner cannot describe a pooling the primitive does not implement. The reach is
    // exercised above; this asserts the NAME, because `--onset-shape` and `--log-signal-mode` both
    // once parsed against hand-written pairs that were subsets of the engine's union.
    expect(Object.keys(PRISM_POOLINGS).sort()).toEqual(['additive', 'conjunctive']);
    for (const member of Object.keys(PRISM_POOLINGS) as (keyof typeof PRISM_POOLINGS)[]) {
      expect(isPrismPooling(member)).toBe(true);
      // Building with each member is accepted rather than falling back, which is what "the union
      // is the accepted set" means for an option with no runtime guard of its own.
      expect(() => build(new TreePruner({ prismPooling: member }))).not.toThrow();
    }
  });
});

describe('the score breakdown — the total IS its terms', () => {
  /**
   * A graph with several terms live at once, so the identity below is asserted on a breakdown that is really
   * a sum rather than on a single-term array that any implementation would satisfy.
   */
  const ranked = () => {
    const pruner = new TreePruner({
      defaultTopK: 4,
      temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
      logWeight: 0.4,
      topoWeight: 0.2,
      collisionWeight: 0.3,
      stabilityWeight: DEFAULT_STABILITY_WEIGHT,
      latWeight: DEFAULT_LAT_WEIGHT,
      latMinRise: DEFAULT_LAT_MIN_RISE,
      poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
      prismPooling: DEFAULT_PRISM_POOLING,
    });
    const callGraph = makeCallGraph(
      ['A', 'B', 'C', 'D'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['A', 'D'],
      ],
    );
    const metrics = makeMetrics({
      A: [10, 11, 10, 100, 140],
      B: [10, 11, 12, 60, 70],
      C: [10, 10, 11, 40, 42],
      D: [10, 10, 10, 10, 11],
    });
    return pruner.analyze(pruner.buildFaultGraph(callGraph, metrics), 4);
  };

  it('sums to `finalScore` EXACTLY, to the last bit, on every result', () => {
    // `toBe` and not `toBeCloseTo`: the terms and the total come from one assembly, so any difference at all
    // is the two drifting apart rather than a rounding artefact — and a breakdown that adds up approximately
    // is a description of a different score. This is the invariant the field exists to carry.
    const results = ranked();
    expect(results.length).toBeGreaterThan(1);
    for (const r of results) {
      expect(r.finalScore, `${r.serviceId} must carry a score`).toBeDefined();
      expect(r.terms, `${r.serviceId} must carry its terms`).toBeDefined();
      expect(sumScoreTerms(r.terms!), `${r.serviceId}: terms must sum to finalScore`).toBe(
        r.finalScore,
      );
    }
  });

  it('breaks the score into MORE than one live term, so the identity is not trivially satisfied', () => {
    // Non-vacuity, and it is the failure mode a single-term array would hide: an implementation that emitted
    // only the base term would pass the identity above on every graph, for the wrong reason.
    const nonZero = new Set<string>();
    for (const r of ranked()) {
      for (const t of r.terms!) if (t.contribution !== 0) nonZero.add(t.name);
    }
    expect(nonZero.size).toBeGreaterThan(2);
    expect([...nonZero]).toContain('selfAnomalyLog1p');
  });

  it('names every term, and carries NEGATIVE contributions where the formula subtracts', () => {
    // The formula subtracts two terms (collision ratio share, pool-metric penalty). A breakdown that reported
    // magnitudes would sum to something else, so a negative contribution is evidence the sign convention
    // travelled with the term rather than being re-applied by a reader.
    const results = ranked();
    const names = results[0]!.terms!.map((t) => t.name);
    for (const n of names) expect(typeof n).toBe('string');
    expect(new Set(names).size).toBe(names.length);
    const all = results.flatMap((r) => r.terms!);
    expect(all.some((t) => t.contribution < 0)).toBe(true);
  });

  it('emits the breakdown on EVERY result, not only the winner', () => {
    // The attribution a benchmark needs compares the truth's terms with the WINNER's, and the winner is by
    // definition not the miss — so a breakdown carried only on the top-1 would make the comparison impossible
    // on exactly the cases it exists for.
    const results = ranked();
    expect(results.every((r) => r.terms !== undefined && r.terms.length > 0)).toBe(true);
  });

  it('names the term set EXACTLY, so a term added to the formula cannot go missing from the breakdown', () => {
    // The identity above is satisfied by any array whose sum is the total, including one that silently DROPPED
    // a term from both sides — and that is the failure the identity alone cannot see. So the population is
    // enumerated: these are the sixteen terms `finalScore(v)` is made of, in the formula's order, and a
    // seventeenth added to the ranking weights without a line here fails this test rather than entering the
    // total unaccounted for.
    expect(ranked()[0]!.terms!.map((t) => t.name)).toEqual([
      'selfAnomalyLog1p',
      'source',
      'temporal',
      'collision',
      'topo',
      'log',
      'rise',
      'trace',
      'prism',
      'failedEdge',
      'lat',
      'pool',
      'stability',
      'selfTime',
      'victim',
      'dualFamily',
    ]);
  });
});

describe('classifyTermZero — the six mechanisms, and the order they are tested in', () => {
  it('names a zero WEIGHT first, because it is the only cause that licenses no inference', () => {
    // The order is the design rather than a preference: a zero weight forces the zero on its own, so reporting
    // an absence instead would send a reader to the graph for a fact that lives in the configuration — and
    // reporting an ENTRY absence for a source that is not there at all would send them to a map that does not
    // exist. Every combination collapses to WEIGHT_ZERO, including the three source states.
    expect(classifyTermZero(0, 'PRESENT', false)).toBe('WEIGHT_ZERO');
    expect(classifyTermZero(0, 'MAP_ABSENT', false)).toBe('WEIGHT_ZERO');
    expect(classifyTermZero(0, 'MAP_EMPTY', false)).toBe('WEIGHT_ZERO');
    expect(classifyTermZero(0, 'ENTRY_ABSENT', false)).toBe('WEIGHT_ZERO');
    expect(classifyTermZero(0, 'PRESENT', true)).toBe('WEIGHT_ZERO');
  });

  it('separates the three levels an absence can happen at', () => {
    // "The producer never ran" against "the producer ran and emitted nothing" against "the producer emitted a
    // tier and this candidate is not in it". Same field, three different pieces of work, and a record that
    // merged any two of them could not be split later without another run — which is why the EMPTY tier is
    // reported as its own cause rather than as an entry absence: an entry absence asserts the map carries
    // OTHER candidates, and an empty map carries none.
    expect(classifyTermZero(0.5, 'MAP_ABSENT', false)).toBe('INPUT_MAP_ABSENT');
    expect(classifyTermZero(0.5, 'MAP_EMPTY', false)).toBe('INPUT_MAP_EMPTY');
    expect(classifyTermZero(0.5, 'ENTRY_ABSENT', false)).toBe('INPUT_ENTRY_ABSENT');
  });

  it('names a gate separately, because a masked zero had a non-zero value behind it', () => {
    // `MASKED` is not `VALUE_ZERO` with a different label: the input was present and non-zero and the formula
    // declined it, which is a fact about the formula rather than about the evidence.
    expect(classifyTermZero(0.5, 'PRESENT', true)).toBe('MASKED');
    expect(classifyTermZero(0.5, 'PRESENT', false)).toBe('VALUE_ZERO');
  });
});

describe('the cause a zero term carries — and the ones it cannot carry', () => {
  /** A four-node chain with several weight families live, so more than one cause kind appears. */
  const build = (over: Partial<ConstructorParameters<typeof TreePruner>[0]> = {}) => {
    const pruner = new TreePruner({
      defaultTopK: 4,
      logWeight: 0.4,
      topoWeight: 0.2,
      ...over,
    });
    const callGraph = makeCallGraph(
      ['A', 'B', 'C', 'D'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['A', 'D'],
      ],
    );
    const metrics = makeMetrics({
      A: [10, 11, 10, 100, 140],
      B: [10, 11, 12, 60, 70],
      C: [10, 10, 11, 40, 42],
      D: [10, 10, 10, 10, 11],
    });
    return pruner.analyze(pruner.buildFaultGraph(callGraph, metrics), 4);
  };
  const term = (name: string, results = build()) =>
    results[0]!.terms!.find((t) => t.name === name)!;

  it('carries a cause if and only if the contribution is zero, on every term of every result', () => {
    // The partition, asserted rather than assumed: a cause on a live term would invite a reader to treat a term
    // that decided something as a term that did not, and a zero WITHOUT one is precisely the case this whole
    // field exists to eliminate.
    const results = build();
    let zeros = 0;
    for (const r of results) {
      for (const t of r.terms!) {
        if (t.contribution === 0) {
          expect(t.cause, `${t.name} is zero and must say why`).toBeDefined();
          zeros += 1;
        } else {
          expect(
            t.cause,
            `${t.name} contributed ${t.contribution} and must not claim a cause`,
          ).toBeUndefined();
          expect(t.source).toBeUndefined();
          expect(t.mask).toBeUndefined();
        }
      }
    }
    // Non-vacuity: a graph where nothing is zero would satisfy the loop by never entering either branch.
    expect(zeros).toBeGreaterThan(0);
  });

  it('reports WEIGHT_ZERO for a term whose configured weight is 0, whatever the graph holds', () => {
    // `topoWeight` is 0 here and the graph DOES carry `topoScores` (the builder computes them), so the zero is
    // a configuration fact and is reported as one even though an absence would have been a plausible story.
    const t = term('topo', build({ topoWeight: 0 }));
    expect(t.contribution).toBe(0);
    expect(t.cause).toBe('WEIGHT_ZERO');
    // And it names no source: the field a reader would go and look at is not the reason.
    expect(t.source).toBeUndefined();
  });

  it('reports the LEVEL of the absence, and names the field', () => {
    // With a non-zero weight and no injected map, the term reads `topoScores` and the whole map is missing —
    // which is `INPUT_MAP_ABSENT`, not an entry absence and not a zero weight.
    const graph = (() => {
      const pruner = new TreePruner({ defaultTopK: 4, traceWeight: 1 });
      const callGraph = makeCallGraph(['A', 'B'], [['A', 'B']]);
      return pruner.buildFaultGraph(callGraph, makeMetrics({ A: [1, 1, 9, 9], B: [1, 1, 2, 2] }));
    })();
    const pruner = new TreePruner({ defaultTopK: 4, traceWeight: 1 });
    // `traceActivityScores` is removed rather than emptied: an absent map, an EMPTY one and a non-empty one
    // that simply does not carry this candidate are the same thing to the LOOKUP and three different things to
    // the record, which is the distinction this test is about.
    const stripped: typeof graph = { ...graph, traceActivityScores: undefined };
    const t = pruner.analyze(stripped, 2)[0]!.terms!.find((x) => x.name === 'trace')!;
    expect(t.contribution).toBe(0);
    expect(t.cause).toBe('INPUT_MAP_ABSENT');
    expect(t.source).toBe('traceActivityScores');
    // An EMPTY map is a producer that RAN and had nothing, which is a fact about the whole tier rather than
    // about this candidate. Filing it as an entry absence would assert that the map carries other candidates —
    // a statement an empty map contradicts, and one that sends the reader to the per-candidate measurement
    // when the missing thing is the tier itself.
    const emptied: typeof graph = { ...graph, traceActivityScores: new Map() };
    const e = pruner.analyze(emptied, 2)[0]!.terms!.find((x) => x.name === 'trace')!;
    expect(e.cause).toBe('INPUT_MAP_EMPTY');
    expect(e.source).toBe('traceActivityScores');
    // And a NON-EMPTY map that does not carry this candidate is the only thing `INPUT_ENTRY_ABSENT` means: the
    // tier was emitted, it carries other services, and this one is absent from it. Without this arm the new
    // member would have replaced the old one instead of joining it.
    const partial: typeof graph = { ...graph, traceActivityScores: new Map([['B', 1]]) };
    const a = pruner.analyze(partial, 2).find((r) => r.serviceId === 'A')!;
    const p = a.terms!.find((x) => x.name === 'trace')!;
    expect(p.contribution).toBe(0);
    expect(p.cause).toBe('INPUT_ENTRY_ABSENT');
    expect(p.source).toBe('traceActivityScores');
  });

  it('reports a MASKED zero when the gate declined a value that was not zero', () => {
    // `rise` is the only term gated INSIDE the score: a collapse is penalised only when the service emitted no
    // logic exception. Injected directly because the gate is a property of the formula's composition rather
    // than of the graph builder, and this test is about the RECORD the composition produces.
    const pruner = new TreePruner({ defaultTopK: 3, riseWeight: 0.6, logWeight: 0.4 });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(['A', 'B'], [['A', 'B']]),
      // Both nodes deviate, so A is a SCORED candidate: a flat series would leave it out of the ranking
      // entirely and the test would be asking about a term on a result that does not exist.
      makeMetrics({ A: [10, 10, 10, 10, 20], B: [10, 10, 10, 10, 12] }),
    );
    const injected: typeof graph = {
      ...graph,
      // A direction BELOW the neutral 0.5 is a collapse; the log signal fires on the same service, which is
      // exactly the condition the gate turns on.
      riseScores: new Map([
        ['A', 0.2],
        ['B', 0.9],
      ]),
      logScores: new Map([
        ['A', 5],
        ['B', 0],
      ]),
    };
    const t = pruner
      .analyze(injected, 2)
      .find((r) => r.serviceId === 'A')!
      .terms!.find((x) => x.name === 'rise')!;
    expect(t.contribution).toBe(0);
    expect(t.cause).toBe('MASKED');
    expect(t.mask).toBe('logicExceptionGate');
    // The value behind the mask was NOT zero: `2 × (0.2 − 0.5) = −0.6`. A record that called this `VALUE_ZERO`
    // would be describing evidence that never existed.
    expect(2 * (0.2 - 0.5)).not.toBe(0);
  });

  it('reports VALUE_ZERO for a source that is present and carries a genuine zero', () => {
    const pruner = new TreePruner({ defaultTopK: 3, prismWeight: 0.5 });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(['A', 'B'], [['A', 'B']]),
      makeMetrics({ A: [1, 1, 9, 9], B: [1, 1, 2, 2] }),
    );
    const injected: typeof graph = {
      ...graph,
      prismScores: new Map([
        ['A', 0],
        ['B', 0.7],
      ]),
    };
    const results = pruner.analyze(injected, 2);
    const a = results.find((r) => r.serviceId === 'A')!.terms!.find((x) => x.name === 'prism')!;
    expect(a.contribution).toBe(0);
    expect(a.cause).toBe('VALUE_ZERO');
    expect(a.source).toBeUndefined();
    // The other side of the same map is live, which is what makes this a value and not a field absence.
    const b = results.find((r) => r.serviceId === 'B')!.terms!.find((x) => x.name === 'prism')!;
    expect(b.contribution).toBe(0.5 * 0.7);
    expect(b.cause).toBeUndefined();
  });

  it('never reports an absence on the base term, so its zero can only be a real one', () => {
    // `selfAnomalyLog1p` has no configurable weight and its source carries every scored node, so two of the
    // five causes are unreachable by construction — asserted so that a later edit making one of them reachable
    // fails here rather than silently filing a base-term zero under a configuration or a graph fact.
    const pruner = new TreePruner({ defaultTopK: 3 });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(['A', 'B'], [['A', 'B']]),
      makeMetrics({
        A: [0, 0, 0, 0, 0],
        B: [1, 1, 9, 9, 9],
      }),
    );
    const base = pruner
      .analyze(graph, 3)
      .map((r) => r.terms!.find((t) => t.name === 'selfAnomalyLog1p')!);
    expect(base.length).toBeGreaterThan(0);
    for (const t of base) {
      expect(t.cause === 'INPUT_MAP_ABSENT' || t.cause === 'INPUT_ENTRY_ABSENT').toBe(false);
      expect(t.cause === 'WEIGHT_ZERO').toBe(false);
    }
  });
});

describe('the gated term — a decline, a neutral direction and a missing map are three answers', () => {
  /** A two-node graph whose `rise` and `log` sources are injected, so the gate's inputs are exact. */
  const withRise = (
    rise: ReadonlyMap<string, number> | undefined,
    logs: ReadonlyMap<string, number>,
  ) => {
    const pruner = new TreePruner({ defaultTopK: 2, riseWeight: 0.5, logWeight: 0.4 });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(['A', 'B'], [['A', 'B']]),
      makeMetrics({ A: [10, 10, 10, 10, 20], B: [10, 10, 10, 10, 12] }),
    );
    return pruner
      .analyze({ ...graph, riseScores: rise, logScores: logs }, 2)
      .find((r) => r.serviceId === 'A')!
      .terms!.find((t) => t.name === 'rise')!;
  };

  it('separates a DECLINED value from a NEUTRAL one, which the gate alone cannot do', () => {
    // Both contribute zero and only one of them is the gate's doing. The directions differ — a collapse the
    // gate declined against the exactly-neutral 0.5 — and reporting the second as `MASKED` would describe a
    // value the engine never had.
    const declined = withRise(new Map([['A', 0.2]]), new Map([['A', 5]]));
    expect(declined).toMatchObject({
      contribution: 0,
      cause: 'MASKED',
      mask: 'logicExceptionGate',
    });
    const neutral = withRise(new Map([['A', 0.5]]), new Map([['A', 5]]));
    expect(neutral.contribution).toBe(0);
    expect(neutral.cause).toBe('VALUE_ZERO');
    expect(neutral.mask).toBeUndefined();
  });

  it('reports a missing MAP even though the formula substitutes a neutral direction for it', () => {
    // The substitution keeps the RANKING identical to a case with no rise field, and it must not keep the
    // RECORD identical: "the field is absent" and "the field is present and neutral" are different facts about
    // the case, and only the first one is about the data tier.
    const absent = withRise(undefined, new Map([['A', 5]]));
    expect(absent.contribution).toBe(0);
    expect(absent.cause).toBe('INPUT_MAP_ABSENT');
    expect(absent.source).toBe('riseScores');
  });

  it('leaves a RISE live, with no cause at all', () => {
    const risen = withRise(new Map([['A', 0.9]]), new Map([['A', 0]]));
    expect(risen.contribution).toBe(0.5 * 2 * (0.9 - 0.5));
    expect(risen.cause).toBeUndefined();
  });
});

describe('TreePruner — self-time prior', () => {
  // The failure this term exists for, in its smallest form: a CALLEE breaks and a CALLER's own response
  // time rises with it, because a caller's latency CONTAINS its callees'. The two services carry the
  // same channel and differ only in how much of the rise is theirs — the callee created all of it, the
  // caller created none, and a maximum-over-metrics anomaly cannot tell those apart.
  const CALLER = 'ts-food-service';
  const SOURCE = 'ts-consign-service';

  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      // 10 → 30 ms: 3×, entirely inherited from the callee below.
      [CALLER, [makeTimeSeries('latency-90', [10, 10, 10, 10, 30, 30, 30, 30])]],
      // 10 → 50 ms: 5×, and it has no callee at all — nothing downstream can have created it.
      [SOURCE, [makeTimeSeries('latency-90', [10, 10, 10, 10, 50, 50, 50, 50])]],
    ]);
    return [makeCallGraph([CALLER, SOURCE], [[CALLER, SOURCE]]), metrics];
  };

  const scores = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    const graph = pruner.buildFaultGraph(callGraph, metrics);
    return {
      graph,
      byService: new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!])),
    };
  };

  /** The same graph with the term's own field removed, so "inert" is measured against its ABSENCE. */
  const withoutField = (): ReadonlyMap<string, number> => {
    const [callGraph, metrics] = makeCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics);
    return new Map(
      new TreePruner()
        .analyze({ ...graph, selfTimeScores: undefined })
        .map((r) => [r.serviceId, r.finalScore!]),
    );
  };

  it('carries the SHARE in the graph it builds: all of it at the leaf, none of it at the caller', () => {
    const { graph } = scores(new TreePruner({ selfTimeWeight: 1 }));

    expect(graph.selfTimeScores?.get(SOURCE)).toBe(1);
    // The caller's rise is smaller than its callee's, so nothing it has is self-created.
    expect(graph.selfTimeScores?.get(CALLER)).toBe(0);
  });

  it('builds NO map at weight 0 — the shipped path does not pay for a term it does not use', () => {
    // Not merely "the term contributes 0": at the shipped weight the map is never constructed, which is
    // what makes the shipped ranking bit-identical by construction rather than by arithmetic.
    const { graph } = scores(new TreePruner({ selfTimeWeight: 0 }));

    expect(graph.selfTimeScores).toBeUndefined();
  });

  it('is inert at weight 0 against a pruner that never mentions it', () => {
    const zero = scores(new TreePruner({ selfTimeWeight: 0 })).byService;
    const absent = withoutField();

    expect(zero.get(SOURCE)!).toBeCloseTo(absent.get(SOURCE)!, 12);
    expect(zero.get(CALLER)!).toBeCloseTo(absent.get(CALLER)!, 12);
  });

  it('RAISES the service whose transport rise it created by exactly the weight, and nobody else', () => {
    // A new axis rather than a re-weighting, and stated at an explicit weight so the property survives any
    // future enrolment of a shipped default.
    const weight = 0.3;
    const before = scores(new TreePruner({ selfTimeWeight: 0 })).byService;
    const after = scores(new TreePruner({ selfTimeWeight: weight })).byService;

    expect(after.get(SOURCE)! - before.get(SOURCE)!).toBeCloseTo(weight, 10);
    expect(after.get(CALLER)!).toBeCloseTo(before.get(CALLER)!, 12);
  });

  it('names the term in the breakdown, with the weight already applied', () => {
    // The attribution a benchmark reads: the contribution is `weight × share`, so a reader of a dump can
    // reconstruct the total without knowing the term's shape.
    const weight = 0.4;
    const [callGraph, metrics] = makeCase();
    const pruner = new TreePruner({ selfTimeWeight: weight });
    const results = pruner.analyze(pruner.buildFaultGraph(callGraph, metrics));
    const source = results.find((r) => r.serviceId === SOURCE)!;
    const term = source.terms!.find((t) => t.name === 'selfTime')!;

    expect(term.contribution).toBeCloseTo(weight, 10);
    expect(term.cause).toBeUndefined();
    expect(term.source).toBeUndefined();
  });
});

describe('TreePruner — the internal/external symmetry mask', () => {
  // PRISM's axiom (arXiv:2601.21359) as a MASK rather than a score. A fault propagates through
  // observable interfaces and does not penetrate a component's internal state, so a component with an
  // external anomaly and NO internal one is downstream of something. The measurement that fixes the form
  // is iteration 140's six-arm sweep: PRISM's own conjunctive score, ADDED at a weight that can reorder
  // everything, takes RE3-TrainTicket from 15 to 24 of 30 cases and costs RE1 37 — it trades one
  // population for another. A bounded multiplier on a candidate's own evidence cannot do that.
  const SOURCE = 'ts-consign-service';
  const VICTIM = 'ts-food-service';

  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      // Both channels move: 3σ internal, 1σ external → symmetry 0.5.
      [
        SOURCE,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 40, 40, 40, 40]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 20, 20, 20, 20]),
        ],
      ],
      // External only: cpu flat, latency 5σ → symmetry 0. This is the victim signature, and its latency
      // rise is deliberately the LARGEST in the case, because a victim's anomaly is amplified by
      // propagation — the fact that makes the maximum-anomaly heuristic fail.
      [
        VICTIM,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 60, 60, 60, 60]),
        ],
      ],
    ]);
    return [makeCallGraph([SOURCE, VICTIM], [[VICTIM, SOURCE]]), metrics];
  };

  const INJECT = 4 * 60000;

  const build = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    return pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: INJECT });
  };

  const scores = (pruner: TreePruner): Map<string, number> => {
    const graph = build(pruner);
    return new Map(pruner.analyze(graph).map((r) => [r.serviceId, r.finalScore!]));
  };

  it('carries the symmetry in the graph it builds: none at the victim, half at the source', () => {
    const graph = build(new TreePruner({ victimWeight: 1 }));

    expect(graph.channelSymmetry?.get(VICTIM)).toBe(0);
    expect(graph.channelSymmetry?.get(SOURCE)).toBeCloseTo(0.5, 12);
  });

  it('builds NO map at weight 0 — the shipped path does not pay for a term it does not use', () => {
    expect(build(new TreePruner({ victimWeight: 0 })).channelSymmetry).toBeUndefined();
  });

  it('is inert at weight 0 against a pruner that never mentions it', () => {
    const zero = scores(new TreePruner({ victimWeight: 0 }));
    const graph = build(new TreePruner());
    const absent = new Map(
      new TreePruner()
        .analyze({ ...graph, channelSymmetry: undefined })
        .map((r) => [r.serviceId, r.finalScore!]),
    );

    expect(zero.get(VICTIM)!).toBeCloseTo(absent.get(VICTIM)!, 12);
    expect(zero.get(SOURCE)!).toBeCloseTo(absent.get(SOURCE)!, 12);
  });

  it('charges the discount as a SHARE of the candidate own evidence, and nothing else', () => {
    // `−victimWeight × (1 − symmetry) × log1p(selfAnomaly)`, so the term at weight 1 removes exactly the
    // base term of a component that failed the axiom, and exactly half of it from one that is balanced.
    const weight = 0.4;
    const graph = build(new TreePruner({ victimWeight: weight }));
    const pruner = new TreePruner({ victimWeight: weight });
    const results = new Map(pruner.analyze(graph).map((r) => [r.serviceId, r]));

    const baseOf = (id: string) => Math.log1p(graph.anomalyScores.get(id)!);
    const victimTerm = results.get(VICTIM)!.terms!.find((t) => t.name === 'victim')!;
    const sourceTerm = results.get(SOURCE)!.terms!.find((t) => t.name === 'victim')!;

    expect(victimTerm.contribution).toBeCloseTo(-weight * baseOf(VICTIM), 10);
    expect(sourceTerm.contribution).toBeCloseTo(-weight * 0.5 * baseOf(SOURCE), 10);
    // A discount is a penalty: it can never pay.
    expect(victimTerm.contribution).toBeLessThan(0);
    expect(sourceTerm.contribution).toBeLessThan(0);
  });

  it('hands the case to the component that passed the axiom', () => {
    // The whole point. At weight 0 the victim ranks first because its propagated rise is the largest
    // anomaly in the case; at weight 1 its own-evidence term is cancelled while the source keeps half of
    // its own, and the ranking flips — which is the sentence "an external-only component is downstream of
    // something" expressed as a decision.
    const before = scores(new TreePruner({ victimWeight: 0 }));
    const after = scores(new TreePruner({ victimWeight: 1 }));

    expect(before.get(VICTIM)!).toBeGreaterThan(before.get(SOURCE)!);
    expect(after.get(SOURCE)!).toBeGreaterThan(after.get(VICTIM)!);
  });

  it('leaves a case where EVERY candidate is external-only alone', () => {
    // The neutrality that a score would not have. A pure delay fault moves latency everywhere and no
    // internal channel anywhere: every candidate fails the axiom, every one is discounted, and the ORDER
    // is unchanged — which is why this form is expected to be nearly free on RE1 while an added score is
    // not (the sweep measured −37 cases there).
    const metrics = new Map<string, readonly TimeSeries[]>([
      [
        SOURCE,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 20, 20, 20, 20]),
        ],
      ],
      [
        VICTIM,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 60, 60, 60, 60]),
        ],
      ],
    ]);
    const callGraph = makeCallGraph([SOURCE, VICTIM], [[VICTIM, SOURCE]]);
    const rankOf = (weight: number) => {
      const pruner = new TreePruner({ victimWeight: weight });
      const r = pruner.analyze(
        pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: INJECT }),
      );
      return r.map((x) => x.serviceId);
    };

    expect(rankOf(0.2)).toEqual(rankOf(0));
  });
});

describe('TreePruner — the dual-family presence bonus', () => {
  // The audit `docs/re3-quiet-truth.md` §6 puts a number on the blocking cell's defect: the truth sits at
  // MEDIAN RANK 33 of 68, i.e. the engine calls it an average component, while the same engine puts the same
  // corpus's truth at rank 2 and rank 9 on the other two suites. Every MAGNITUDE lever failed there; the one
  // thing that reaches the truth is a SHAPE test — PRISM's `min(Sⁱ,Sᵉ)`, 23 of 30 — and every attempt to
  // import that shape as a SCORE failed too, because it brought its own z-scale into a tuned ranking.
  //
  // So the shape is imported as PRESENCE: a bounded 0/1 indicator that a component carries a moving channel
  // in BOTH families, added at a small weight. It cannot explode, it cannot re-weight by an unbounded ratio,
  // and it says exactly what the shape test says — this component is anomalous where a source is anomalous.
  const DUAL = 'ts-consign-service';
  const EXTERNAL_ONLY = 'ts-food-service';

  const makeCase = (): [ServiceCallGraph, MetricMap] => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      [
        DUAL,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 40, 40, 40, 40]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 30, 30, 30, 30]),
        ],
      ],
      [
        EXTERNAL_ONLY,
        [
          makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10]),
          makeTimeSeries('latency-90', [10, 10, 10, 10, 60, 60, 60, 60]),
        ],
      ],
    ]);
    return [makeCallGraph([DUAL, EXTERNAL_ONLY], [[EXTERNAL_ONLY, DUAL]]), metrics];
  };

  const INJECT = 4 * 60000;

  const build = (pruner: TreePruner) => {
    const [callGraph, metrics] = makeCase();
    return pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: INJECT });
  };

  it('marks the component with a moving channel in BOTH families, and only that one', () => {
    const graph = build(new TreePruner({ dualFamilyWeight: 1 }));

    expect(graph.dualFamilyServices?.has(DUAL)).toBe(true);
    expect(graph.dualFamilyServices?.has(EXTERNAL_ONLY)).toBe(false);
  });

  it('builds NO set at weight 0 — the shipped path does not pay for a term it does not use', () => {
    expect(build(new TreePruner({ dualFamilyWeight: 0 })).dualFamilyServices).toBeUndefined();
  });

  it('adds exactly the weight to the dual-family component and nothing to the other', () => {
    // Bounded by construction: the value is 0 or 1, so the term can never claim more than its weight — the
    // property every imported SCORE this month lacked.
    const weight = 0.25;
    const before = new Map(
      new TreePruner({ dualFamilyWeight: 0 })
        .analyze(build(new TreePruner({ dualFamilyWeight: 0 })))
        .map((r) => [r.serviceId, r.finalScore!]),
    );
    const pruner = new TreePruner({ dualFamilyWeight: weight });
    const after = new Map(pruner.analyze(build(pruner)).map((r) => [r.serviceId, r.finalScore!]));

    expect(after.get(DUAL)! - before.get(DUAL)!).toBeCloseTo(weight, 10);
    expect(after.get(EXTERNAL_ONLY)!).toBeCloseTo(before.get(EXTERNAL_ONLY)!, 12);
  });

  it('names the term in the breakdown with its weight already applied', () => {
    const weight = 0.3;
    const pruner = new TreePruner({ dualFamilyWeight: weight });
    const results = pruner.analyze(build(pruner));
    const dual = results
      .find((r) => r.serviceId === DUAL)!
      .terms!.find((t) => t.name === 'dualFamily')!;

    expect(dual.contribution).toBeCloseTo(weight, 10);
    // A present, non-zero term reports no CAUSE: `source` and `cause` exist to explain a zero, and a term that
    // was paid has nothing to explain. The assertion is the convention's, taken from the self-time term beside it.
    expect(dual.cause).toBeUndefined();
    expect(dual.source).toBeUndefined();
  });

  it('is inert at weight 0 against a pruner that never mentions it', () => {
    const zero = new TreePruner({ dualFamilyWeight: 0 });
    const zeroScores = new Map(zero.analyze(build(zero)).map((r) => [r.serviceId, r.finalScore!]));
    const graph = build(new TreePruner());
    const absent = new Map(
      new TreePruner()
        .analyze({ ...graph, dualFamilyServices: undefined })
        .map((r) => [r.serviceId, r.finalScore!]),
    );

    expect(zeroScores.get(DUAL)!).toBeCloseTo(absent.get(DUAL)!, 12);
    expect(zeroScores.get(EXTERNAL_ONLY)!).toBeCloseTo(absent.get(EXTERNAL_ONLY)!, 12);
  });
});
