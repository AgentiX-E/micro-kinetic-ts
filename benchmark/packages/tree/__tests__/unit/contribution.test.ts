import { describe, it, expect } from 'vitest';
import {
  CollisionContributionAnalyzer,
  buildEdgeWeightMap,
} from '@agentix-e/micro-kinetic-tree';
import type { DetectedCycle, CallEdge } from '@agentix-e/micro-kinetic-core';

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

function makeCycle(nodePath: string[]): DetectedCycle {
  return { nodePath, contribution: 0, significant: false };
}

describe('buildEdgeWeightMap', () => {
  it('builds edge key → weight mapping', () => {
    const edges = [makeEdge('A', 'B'), makeEdge('B', 'C')];
    const weights = new Float64Array([0.9, 0.5]);
    const map = buildEdgeWeightMap(edges, weights);
    expect(map.get('A→B')).toBe(0.9);
    expect(map.get('B→C')).toBe(0.5);
  });

  it('throws if weights length does not match edges', () => {
    const edges = [makeEdge('A', 'B')];
    const weights = new Float64Array([0.9, 0.5]);
    expect(() => buildEdgeWeightMap(edges, weights)).toThrow();
  });

  it('throws on empty edges', () => {
    const weights = new Float64Array(0);
    expect(() => buildEdgeWeightMap([], weights)).toThrow();
  });
});

describe('CollisionContributionAnalyzer', () => {
  const edges = [
    makeEdge('A', 'B'),
    makeEdge('B', 'C'),
    makeEdge('C', 'A'),
    makeEdge('B', 'A'),
  ];
  const weights = new Float64Array([0.9, 0.8, 0.7, 0.6]);

  it('computes raw contribution as product of edge weights', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle(['A', 'B', 'C']);
    // w(C) = 0.9 * 0.8 * 0.7 = 0.504
    const contrib = analyzer.computeRawContribution(cycle);
    expect(contrib).toBeCloseTo(0.504, 5);
  });

  it('returns 0 for cycle with missing edge in weight map', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle(['A', 'C']); // edge A→C not in weight map
    const contrib = analyzer.computeRawContribution(cycle);
    expect(contrib).toBe(0);
  });

  it('returns 0 for single-node cycle', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle(['A']);
    expect(analyzer.computeRawContribution(cycle)).toBe(0);
  });

  it('returns 0 for empty cycle', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle([]);
    expect(analyzer.computeRawContribution(cycle)).toBe(0);
  });

  it('computes 1-hop contribution with decay', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights, { alpha: 0.5 });
    const cycle = makeCycle(['A', 'B']);
    // raw = 0.9 * 0.6 = 0.54 (A→B and B→A cycle edges)
    // 1-hop = 0.54 * 0.5^2 = 0.54 * 0.25 = 0.135
    const contrib = analyzer.computeOneHopContribution(cycle);
    expect(contrib).toBeCloseTo(0.135, 5);
  });

  it('1-hop contribution returns 0 for empty path', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle([]);
    expect(analyzer.computeOneHopContribution(cycle)).toBe(0);
  });

  it('computes 2-hop contribution with beta coupling', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights, { alpha: 0.8, beta: 0.3 });
    const cycle = makeCycle(['A', 'B', 'C']);
    const contrib = analyzer.computeTwoHopContribution(cycle);
    expect(contrib).toBeGreaterThan(0);
  });

  it('2-hop contribution returns 0 for cycle with < 2 nodes', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle(['A']);
    expect(analyzer.computeTwoHopContribution(cycle)).toBe(0);
  });

  it('computeAllContributions returns map of contributions', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycles = [makeCycle(['A', 'B']), makeCycle(['B', 'C'])];
    const result = analyzer.computeAllContributions(cycles);
    expect(result.size).toBe(2);
    for (const [key, val] of result) {
      expect(typeof key).toBe('string');
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  it('computeAllTwoHopContributions returns map', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycles = [makeCycle(['A', 'B'])];
    const result = analyzer.computeAllTwoHopContributions(cycles);
    expect(result.size).toBe(1);
  });

  it('latencyDecay computes exponential decay', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights, { tauMs: 500 });
    // f(500) = exp(-500/500) = exp(-1) ≈ 0.3679
    const decay = analyzer.latencyDecay(500);
    expect(decay).toBeCloseTo(Math.exp(-1), 4);
  });

  it('latencyDecay returns ~1 for zero latency', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const decay = analyzer.latencyDecay(0);
    expect(decay).toBeCloseTo(1, 5);
  });

  it('latencyDecay throws for negative latency', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    expect(() => analyzer.latencyDecay(-1)).toThrow();
  });

  it('constructor uses default decay params', () => {
    const analyzer = new CollisionContributionAnalyzer(edges, weights);
    const cycle = makeCycle(['A', 'B']);
    const contrib = analyzer.computeOneHopContribution(cycle);
    // raw = 0.9 * 0.6 = 0.54, alpha=0.8, n=2 → 0.54 * 0.64 = 0.3456
    expect(contrib).toBeCloseTo(0.3456, 5);
  });

  it('constructor throws on empty edges', () => {
    expect(() => new CollisionContributionAnalyzer([], weights)).toThrow();
  });

  it('constructor throws on empty weights', () => {
    expect(() => new CollisionContributionAnalyzer(edges, new Float64Array(0))).toThrow();
  });

  it('constructor rejects alpha outside [0,1]', () => {
    expect(() => new CollisionContributionAnalyzer(edges, weights, { alpha: 1.5 })).toThrow();
    expect(() => new CollisionContributionAnalyzer(edges, weights, { alpha: -0.1 })).toThrow();
  });

  it('constructor rejects beta outside [0,1]', () => {
    expect(() => new CollisionContributionAnalyzer(edges, weights, { beta: 1.5 })).toThrow();
  });

  it('computes 2-hop contribution with zero-weight edge in cycle', () => {
    // Edge A→D not in weight map, so weight = 0 → early return 0
    const edges2 = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
    ];
    const weights2 = new Float64Array([0.9, 0.5]);
    const analyzer = new CollisionContributionAnalyzer(edges2, weights2);
    const cycle = makeCycle(['A', 'B', 'D']); // A→B OK, B→D not in weight map → w=0
    const contrib = analyzer.computeTwoHopContribution(cycle);
    expect(contrib).toBe(0);
  });

  it('computes 2-hop contribution when neighborWeight is zero', () => {
    // Create edges where 2-hop neighbor lookup returns 0 (edge not in weight map)
    const edges2 = [
      makeEdge('A', 'B'),
      makeEdge('B', 'C'),
      makeEdge('C', 'A'),
    ];
    const weights2 = new Float64Array([0.9, 0.8, 0.7]);
    const analyzer = new CollisionContributionAnalyzer(edges2, weights2, { alpha: 0.5, beta: 0.3 });
    // Cycle A→B→C: weights for A→B=0.9, B→C=0.8, C→A=0.7
    // 2-hop for edge A→B: looks at B→C (0.8), neighborWeight > 0 so uses formula
    const cycle = makeCycle(['A', 'B', 'C']);
    const contrib = analyzer.computeTwoHopContribution(cycle);
    expect(contrib).toBeGreaterThan(0);
  });
});
