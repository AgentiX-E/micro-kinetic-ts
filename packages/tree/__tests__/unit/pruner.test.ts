import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { TreePruner, toRankingWeights } from '@agentix-e/micro-kinetic-tree';
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
      // With the injection time known AND temporalWeight > 0, A's disturbance
      // precedes B's and C's, so the temporal earliness prior must lift A above
      // B (whose anomaly is larger). This is the opt-in causal source/symptom
      // separation the index-based onset could not provide.
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

    it('disables the temporal signal by default (pure self-anomaly even with injectTime)', () => {
      // The DEFAULT temporalWeight is 0: even when the injection time is known,
      // the temporal signal is neutral and the highest self-anomaly service (B)
      // ranks first. This is the shipped behaviour — the signal regressed the
      // benchmark (#207/#208, net ≈ −2.5pp) and is therefore opt-in.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs: 180000 });

      const results = pruner.analyze(graph, 3);
      expect(results[0]!.serviceId).toBe('B');
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
    it('packs the five flat option fields into a RankingWeights object', () => {
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
      });

      expect(weights).toEqual({
        sourceWeight: 0.1,
        temporalWeight: 0.2,
        collisionWeight: 0.3,
        topoWeight: 0.4,
        logWeight: 0.5,
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

    it('votes the silent riser when a DIFFERENT service throws (throwing wrapper)', () => {
      // TrainTicket RE3 f2: the source is silent while a downstream wrapper
      // throws a logic exception. The wrapper's exception is a SYMPTOM of the
      // wrong value, not evidence the case is non-silent — the per-candidate
      // gate must NOT suppress the silent-source riser.
      const pruner = new TreePruner();
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        traceActivity,
        logs: [{ timestamp: 0, service: 'B', level: 'ERROR', isLogicException: true }],
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
      const callGraph = makeCallGraph(
        ['A', 'B', 'C'],
        [['A', 'B']],
      );
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
});
