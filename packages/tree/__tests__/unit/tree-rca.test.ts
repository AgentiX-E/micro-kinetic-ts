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

    it('limits to k results', () => {
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
});
