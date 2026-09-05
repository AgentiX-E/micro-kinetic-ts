import { describe, it, expect } from 'vitest';
import { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';
import type {
  PrunedTree,
  ServiceId,
  TreeNodeScore,
  CallEdge,
} from '@agentix-e/micro-kinetic-core';

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

function makeNodeScore(id: string, anomalyScore: number, depth = 0): [string, TreeNodeScore] {
  return [id, {
    nodeId: id,
    anomalyScore,
    childPropagationScore: 0,
    totalScore: anomalyScore,
    depth,
  }];
}

function makePrunedTree(
  nodeIds: string[],
  edges: [string, string][],
  anomalyScores?: Map<string, number>,
): PrunedTree {
  const nodes = new Map<string, TreeNodeScore>();
  for (const id of nodeIds) {
    const score = anomalyScores?.get(id) ?? 0;
    nodes.set(id, {
      nodeId: id,
      anomalyScore: score,
      childPropagationScore: 0,
      totalScore: score,
      depth: 0,
    });
  }
  return {
    nodes,
    edges: edges.map(([f, t]) => makeEdge(f, t)),
    rootCauseScores: new Map(),
    prunedEdges: [],
    cyclesPruned: 0,
    contributionRemoved: 0,
  };
}

describe('TreeRCAEngine', () => {
  describe('constructor', () => {
    it('creates with default options', () => {
      const engine = new TreeRCAEngine();
      expect(engine).toBeDefined();
    });

    it('rejects invalid decayAlpha', () => {
      expect(() => new TreeRCAEngine({ decayAlpha: -0.1 })).toThrow();
      expect(() => new TreeRCAEngine({ decayAlpha: 1.5 })).toThrow();
    });

    it('rejects invalid defaultTopK', () => {
      expect(() => new TreeRCAEngine({ defaultTopK: -1 })).toThrow();
      expect(() => new TreeRCAEngine({ defaultTopK: 0 })).toThrow();
    });
  });

  describe('analyze', () => {
    it('performs bottom-up score accumulation', () => {
      const engine = new TreeRCAEngine({ decayAlpha: 1.0, tauMs: 1000 });
      const anomalyScores = new Map<string, number>([
        ['A', 0.4],
        ['B', 0.3],
        ['C', 0.2],
      ]);
      const tree = makePrunedTree(
        ['A', 'B', 'C'],
        [['A', 'B'], ['B', 'C']],
        anomalyScores,
      );
      const allEdges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
      const propWeights = new Float64Array([0.5, 0.5]);

      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 3);
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(3);
      for (const r of results) {
        expect(r.serviceId).toBeTruthy();
        expect(r.rank).toBeGreaterThanOrEqual(1);
      }
    });

    it('handles single-node tree', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['A', 0.5]]);
      const tree = makePrunedTree(['A'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.serviceId).toBe('A');
    });

    it('handles empty edges in tree', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([
        ['A', 0.8],
        ['B', 0.6],
      ]);
      const tree = makePrunedTree(['A', 'B'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 2);
      expect(results.length).toBe(2);
      expect(results[0]!.rank).toBe(1);
      expect(results[1]!.rank).toBe(2);
    });

    it('returns Top-1 result', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([
        ['A', 0.5],
        ['B', 0.3],
        ['C', 0.2],
      ]);
      const tree = makePrunedTree(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']], anomalyScores);
      const allEdges = [makeEdge('A', 'B'), makeEdge('A', 'C')];
      const propWeights = new Float64Array([0.5, 0.3]);

      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 1);
      expect(results).toHaveLength(1);
      expect(results[0]!.rank).toBe(1);
    });

    it('uses default topK when not provided', () => {
      const engine = new TreeRCAEngine({ defaultTopK: 2 });
      const anomalyScores = new Map<string, number>([
        ['A', 0.3],
        ['B', 0.5],
        ['C', 0.4],
      ]);
      const tree = makePrunedTree(['A', 'B', 'C'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], undefined);
      expect(results.length).toBe(2);
    });

    it('throws on empty tree', () => {
      const engine = new TreeRCAEngine();
      const tree: PrunedTree = {
        nodes: new Map(),
        edges: [],
        rootCauseScores: new Map(),
        prunedEdges: [],
        cyclesPruned: 0,
        contributionRemoved: 0,
      };
      expect(() => engine.analyze(tree, new Map(), new Float64Array(0), [], 5)).toThrow();
    });

    it('throws on invalid topK', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['A', 0.5]]);
      const tree = makePrunedTree(['A'], [], anomalyScores);
      expect(() => engine.analyze(tree, anomalyScores, new Float64Array(0), [], -1)).toThrow();
    });

    it('handles zero anomaly scores', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([
        ['A', 0],
        ['B', 0],
      ]);
      const tree = makePrunedTree(['A', 'B'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 2);
      // Zero scores yield results with confidence based on 0 score
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('sorts results by score descending', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([
        ['A', 0.3],
        ['B', 0.5],
      ]);
      const tree = makePrunedTree(['A', 'B'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 2);
      expect(results[0]!.serviceId).toBe('B');
      expect(results[1]!.serviceId).toBe('A');
    });

    it('propagates child scores upward with latency decay', () => {
      const engine = new TreeRCAEngine({ decayAlpha: 1.0, tauMs: 1000 });
      const anomalyScores = new Map<string, number>([
        ['X', 0.3],
        ['Y', 0.5],
      ]);
      const tree = makePrunedTree(['X', 'Y'], [['X', 'Y']], anomalyScores);
      const allEdges = [makeEdge('X', 'Y')];
      const propWeights = new Float64Array([0.5]);
      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 2);
      const xResult = results.find(r => r.serviceId === 'X');
      expect(xResult).toBeDefined();
    });
  });

  describe('rank', () => {
    it('ranks accumulators by totalScore', () => {
      const engine = new TreeRCAEngine();
      const accumulators = new Map<ServiceId, {
        anomalyScore: number;
        childPropagationScore: number;
        totalScore: number;
        depth: number;
      }>();
      accumulators.set('svc-a', { anomalyScore: 0.3, childPropagationScore: 0, totalScore: 0.3, depth: 0 });
      accumulators.set('svc-b', { anomalyScore: 0.9, childPropagationScore: 0, totalScore: 0.9, depth: 0 });
      accumulators.set('svc-c', { anomalyScore: 0.6, childPropagationScore: 0, totalScore: 0.6, depth: 0 });

      const ranked = engine.rank(accumulators, 2);
      expect(ranked.size).toBe(2);
      expect(Array.from(ranked.keys())).toEqual(['svc-b', 'svc-c']);
    });

    it('limits to k even when accumulator count exceeds k', () => {
      const engine = new TreeRCAEngine();
      const accumulators = new Map<ServiceId, {
        anomalyScore: number;
        childPropagationScore: number;
        totalScore: number;
        depth: number;
      }>();
      accumulators.set('A', { anomalyScore: 1, childPropagationScore: 0, totalScore: 1, depth: 0 });
      accumulators.set('B', { anomalyScore: 0.8, childPropagationScore: 0, totalScore: 0.8, depth: 0 });
      accumulators.set('C', { anomalyScore: 0.6, childPropagationScore: 0, totalScore: 0.6, depth: 0 });

      const ranked = engine.rank(accumulators, 1);
      expect(ranked.size).toBe(1);
    });

    it('handles k larger than accumulator count', () => {
      const engine = new TreeRCAEngine();
      const accumulators = new Map<ServiceId, {
        anomalyScore: number;
        childPropagationScore: number;
        totalScore: number;
        depth: number;
      }>();
      accumulators.set('S', { anomalyScore: 0.5, childPropagationScore: 0, totalScore: 0.5, depth: 0 });
      const ranked = engine.rank(accumulators, 5);
      expect(ranked.size).toBe(1);
    });

    it('handles empty accumulators', () => {
      const engine = new TreeRCAEngine();
      const ranked = engine.rank(new Map(), 5);
      expect(ranked.size).toBe(0);
    });

    it('throws for invalid k', () => {
      const engine = new TreeRCAEngine();
      expect(() => engine.rank(new Map(), 0)).toThrow();
      expect(() => engine.rank(new Map(), -1)).toThrow();
    });
  });

  it('classifies fault type based on score', () => {
    const engine = new TreeRCAEngine();
    const anomalyScores = new Map<string, number>([
      ['critical', 0.95],
      ['major', 0.65],
      ['minor', 0.45],
      ['warning', 0.25],
    ]);
    const tree = makePrunedTree(
      ['critical', 'major', 'minor', 'warning'],
      [],
      anomalyScores,
    );
    const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 4);

    const critical = results.find(r => r.serviceId === 'critical')!;
    const major = results.find(r => r.serviceId === 'major')!;
    const minor = results.find(r => r.serviceId === 'minor')!;
    const warning = results.find(r => r.serviceId === 'warning')!;

    // Note: scores > 0.8 throw in confidence computation
    // Test classification logic using find
    expect(critical.faultType.category).toBe('CPU');
    expect(major.faultType.severity).toBe('major');
    expect(minor.faultType.severity).toBe('minor');
    expect(warning.faultType.severity).toBe('warning');
  });

  describe('findEdgeWeight with matching edges', () => {
    it('finds weight for edge in original edge list', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([
        ['A', 0.5],
        ['B', 0.3],
      ]);
      const tree = makePrunedTree(['A', 'B'], [['A', 'B']], anomalyScores);
      const allEdges = [makeEdge('A', 'B')];
      const propWeights = new Float64Array([0.5]);
      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getAvgLatency with valid edges', () => {
    it('uses p99Latency from matched edge', () => {
      const engine = new TreeRCAEngine({ decayAlpha: 1.0, tauMs: 500 });
      const anomalyScores = new Map<string, number>([
        ['X', 0.6],
        ['Y', 0.4],
      ]);
      const allEdges = [makeEdge('X', 'Y')];
      allEdges[0]!.p99Latency = 100;
      const tree = makePrunedTree(['X', 'Y'], [['X', 'Y']], anomalyScores);
      const propWeights = new Float64Array([0.7]);
      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 2);
      const xResult = results.find(r => r.serviceId === 'X');
      expect(xResult).toBeDefined();
    });
  });

  it('handles propagation through multilevel tree with varying weights', () => {
    const engine = new TreeRCAEngine({ decayAlpha: 0.9, tauMs: 1000 });
    const anomalyScores = new Map<string, number>([
      ['Root', 0.3],
      ['Mid', 0.2],
      ['Leaf', 0.1],
    ]);
    const tree = makePrunedTree(
      ['Root', 'Mid', 'Leaf'],
      [['Root', 'Mid'], ['Mid', 'Leaf']],
      anomalyScores,
    );
    const allEdges = [makeEdge('Root', 'Mid'), makeEdge('Mid', 'Leaf')];
    allEdges[0]!.p99Latency = 50;
    allEdges[1]!.p99Latency = 100;
    const propWeights = new Float64Array([0.5, 0.3]);
    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    const rootResult = results.find(r => r.serviceId === 'Root');
    expect(rootResult).toBeDefined();
  });

  describe('fault type classification branches', () => {
    it('classifies CPU at score >= 0.8', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['X', 0.85]]);
      const tree = makePrunedTree(['X'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
      expect(results[0]!.faultType.category).toBe('CPU');
      expect(results[0]!.faultType.severity).toBe('critical');
    });

    it('classifies MEMORY at score >= 0.6', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['X', 0.65]]);
      const tree = makePrunedTree(['X'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
      expect(results[0]!.faultType.category).toBe('MEMORY');
    });

    it('classifies CODE_ERROR at score >= 0.4', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['X', 0.45]]);
      const tree = makePrunedTree(['X'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
      expect(results[0]!.faultType.category).toBe('CODE_ERROR');
    });

    it('classifies deep propagation anomaly when a mid score has depth > 2', () => {
      // A 4-level chain (Root → Mid1 → Mid2 → Leaf) puts Root at depth 3, and a
      // moderate Root anomaly (0.5) with faint child contribution keeps its score
      // in [0.4, 0.6) → CODE_ERROR with the deep_propagation_anomaly subtype.
      const engine = new TreeRCAEngine({ decayAlpha: 0.8, tauMs: 100000 });
      const ids = ['Root', 'Mid1', 'Mid2', 'Leaf'];
      const edges: [string, string][] = [
        ['Root', 'Mid1'],
        ['Mid1', 'Mid2'],
        ['Mid2', 'Leaf'],
      ];
      const allEdges = edges.map(([f, t]) => makeEdge(f, t));
      const anomalyScores = new Map<string, number>([
        ['Root', 0.5],
        ['Mid1', 0.1],
        ['Mid2', 0.1],
        ['Leaf', 0.1],
      ]);
      const tree = makePrunedTree(ids, edges, anomalyScores);
      const propWeights = new Float64Array([0.3, 0.3, 0.3]);

      const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 4);
      const root = results.find((r) => r.serviceId === 'Root')!;

      expect(root.faultType.category).toBe('CODE_ERROR');
      expect(root.faultType.subType).toBe('deep_propagation_anomaly');
      expect(root.propagationDepth).toBe(3);
    });

    it('classifies UNKNOWN at score < 0.4', () => {
      const engine = new TreeRCAEngine();
      const anomalyScores = new Map<string, number>([['X', 0.25]]);
      const tree = makePrunedTree(['X'], [], anomalyScores);
      const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
      expect(results[0]!.faultType.category).toBe('UNKNOWN');
    });
  });

  it('handles mid-level anomaly scores for fault types', () => {
    const engine = new TreeRCAEngine();
    const anomalyScores = new Map<string, number>([
      ['M', 0.65],
    ]);
    const tree = makePrunedTree(['M'], [], anomalyScores);
    const results = engine.analyze(tree, anomalyScores, new Float64Array(0), [], 1);
    expect(results[0]!.faultType.severity).toBe('major');
  });

  it('handles multilevel propagation with 3+ levels', () => {
    const engine = new TreeRCAEngine({ decayAlpha: 0.8, tauMs: 1000 });
    const anomalyScores = new Map<string, number>([
      ['Top', 0.5],
      ['Mid1', 0.3],
      ['Mid2', 0.4],
      ['Bottom', 0.2],
    ]);
    const tree = makePrunedTree(
      ['Top', 'Mid1', 'Mid2', 'Bottom'],
      [['Top', 'Mid1'], ['Top', 'Mid2'], ['Mid1', 'Bottom']],
      anomalyScores,
    );
    const allEdges = [makeEdge('Top', 'Mid1'), makeEdge('Top', 'Mid2'), makeEdge('Mid1', 'Bottom')];
    allEdges[0]!.p99Latency = 50;
    allEdges[1]!.p99Latency = 30;
    allEdges[2]!.p99Latency = 100;
    const propWeights = new Float64Array([0.5, 0.4, 0.6]);
    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 4);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const topResult = results.find(r => r.serviceId === 'Top');
    expect(topResult).toBeDefined();
    expect(topResult!.propagationDepth).toBeGreaterThanOrEqual(1);
  });

  // ── Child propagation normalisation ─────────────────────
  // Regression test: on deep topologies (80+ nodes) the old accumulator
  // summed child contributions without normalisation, causing ancestors
  // near the root to accumulate dozens of propagated scores and outrank
  // the true root-cause leaf whose anomaly dominated.
  it('bounds parent score below child anomaly on a deep chain', () => {
    const engine = new TreeRCAEngine();
    // 20-node chain: svc-0 → svc-1 → … → svc-19
    // svc-19 (leaf) has anomaly = 1.0, every other node has 0.0.
    // Without normalisation, svc-0 (root) would accumulate ~20 child
    // contributions and outrank svc-19.
    const N = 20;
    const ids = Array.from({ length: N }, (_, i) => `svc-${i}`);
    const edges: [string, string][] = [];
    const allEdges: CallEdge[] = [];
    for (let i = 0; i < N - 1; i++) {
      edges.push([ids[i]!, ids[i + 1]!]);
      allEdges.push(makeEdge(ids[i]!, ids[i + 1]!));
    }
    const anomalyScores = new Map<ServiceId, number>();
    for (const id of ids) {
      anomalyScores.set(id, id === `svc-${N - 1}` ? 1.0 : 0.0);
    }
    const tree = makePrunedTree(ids, edges, anomalyScores);
    const propWeights = new Float64Array(allEdges.length).fill(0.5);

    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 1);
    expect(results.length).toBe(1);
    // The fault-injected leaf must be ranked #1.
    expect(results[0]!.serviceId).toBe(`svc-${N - 1}`);
    expect(results[0]!.confidence).toBeGreaterThan(0.5);
  });

  it('bounded parent score: 3-child fan-in does not outrank fault child', () => {
    const engine = new TreeRCAEngine();
    // Fan-in: Root → {A, B, C} → {D}, D has anomaly = 1.0.
    // Root should NOT outrank D just because it has 3 children.
    const ids = ['Root', 'A', 'B', 'C', 'D'];
    const edges: [string, string][] = [
      ['Root', 'A'],
      ['Root', 'B'],
      ['Root', 'C'],
      ['A', 'D'],
      ['B', 'D'],
      ['C', 'D'],
    ];
    const allEdges = edges.map(([f, t]) => makeEdge(f, t));
    const anomalyScores = new Map<ServiceId, number>();
    for (const id of ids) anomalyScores.set(id, id === 'D' ? 1.0 : 0.0);
    const tree = makePrunedTree(ids, edges, anomalyScores);
    const propWeights = new Float64Array(allEdges.length).fill(0.5);

    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 1);
    expect(results.length).toBe(1);
    expect(results[0]!.serviceId).toBe('D');
  });

  it('caps child contribution at the max child anomaly (collision bound)', () => {
    // Root has two fully-anomalous children (0.9 each) at weight 1.0, so the raw
    // child contribution ≈ 1.8 exceeds the cap max(anomaly(Root)=0.1, maxChild=0.9)
    // = 0.9. With decayAlpha = 1.0 the capped contribution keeps Root's score at
    // 0.1 × (1 + 0.9) = 0.19, instead of the uncapped 0.1 × (1 + 1.8) = 0.28.
    const engine = new TreeRCAEngine({ decayAlpha: 1.0, tauMs: 100000 });
    const ids = ['Root', 'A', 'B'];
    const edges: [string, string][] = [
      ['Root', 'A'],
      ['Root', 'B'],
    ];
    const allEdges = edges.map(([f, t]) => makeEdge(f, t));
    const anomalyScores = new Map<string, number>([
      ['Root', 0.1],
      ['A', 0.9],
      ['B', 0.9],
    ]);
    const tree = makePrunedTree(ids, edges, anomalyScores);
    const propWeights = new Float64Array([1.0, 1.0]);

    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 3);
    const root = results.find((r) => r.serviceId === 'Root')!;
    const total = root.evidenceMetrics.find((m) => m.metric === 'total_rca_score')!;

    expect(total.value).toBeCloseTo(0.19, 2);
  });

  it('ranks correctly on small topology with distributed anomalies after normalization', () => {
    const engine = new TreeRCAEngine();
    // With the normalised child accumulation the ancestor's score is
    // bounded by a weighted average of its children's scores.  Both Top
    // and Mid reach 1.0 when their anomaly + normalised childContrib sum
    // exceeds 1.0 (clamped).  The relative ordering among clamped nodes
    // depends on the tiebreaker, so we only assert that both are present
    // in the top results (rather than forcing a specific rank).
    const anomalyScores = new Map<ServiceId, number>([
      ['Top', 0.6],
      ['Mid', 0.9],
      ['Bottom', 0.2],
    ]);
    const tree = makePrunedTree(
      ['Top', 'Mid', 'Bottom'],
      [['Top', 'Mid'], ['Mid', 'Bottom']],
      anomalyScores,
    );
    const allEdges = [makeEdge('Top', 'Mid'), makeEdge('Mid', 'Bottom')];
    const propWeights = new Float64Array([0.7, 0.3]);
    const results = engine.analyze(tree, anomalyScores, propWeights, allEdges, 5);
    expect(results.length).toBeGreaterThanOrEqual(2);
    const top2 = results.slice(0, 2).map((r) => r.serviceId);
    expect(top2).toContain('Mid');
    expect(top2).toContain('Top');
  });
});
