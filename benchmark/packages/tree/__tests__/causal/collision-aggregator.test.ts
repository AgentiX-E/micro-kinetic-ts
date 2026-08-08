/**
 * Unit tests for Collision Node Fault Aggregator.
 *
 * Tests the Boltzmann Q(f,f) nonlinear fault aggregation for
 * collision types: chain, fan-in, bottleneck, and cycle nodes.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyCollisionType,
  computeBoltzmannCollisionGain,
  aggregateCollisionEnergy,
  aggregateFaultEnergy,
  buildIncomingEdgeMap,
  computeTopologicalOrder,
} from '../../src/causal/collision-aggregator.js';
import type {
  FaultGraphEdge,
  CollisionNode,
  CollisionAggregatorConfig,
} from '../../src/causal/collision-aggregator.js';

function makeEdge(from: string, to: string, weight: number): FaultGraphEdge {
  return { from, to, weight };
}

describe('classifyCollisionType', () => {
  it('classifies 0-degree node as chain', () => {
    expect(classifyCollisionType(0, 0, 0)).toBe('chain');
  });

  it('classifies single-input node as chain', () => {
    expect(classifyCollisionType(1, 2, 0)).toBe('chain');
  });

  it('classifies multi-input low out-degree as bottleneck', () => {
    // inDegree=4, outDegree=1, capacity=0.25 ≤ 0.5 → bottleneck
    expect(classifyCollisionType(4, 1, 0)).toBe('bottleneck');
  });

  it('classifies multi-input high out-degree as fan-in', () => {
    // inDegree=4, outDegree=3, capacity=0.75 > 0.5 → fan-in
    expect(classifyCollisionType(4, 3, 0)).toBe('fan-in');
  });

  it('classifies cycle-participating node as cycle (takes precedence)', () => {
    // Even though inDegree=4 suggests fan-in, cycleCount > 0 → cycle
    expect(classifyCollisionType(4, 3, 2)).toBe('cycle');
  });

  it('respects custom fan-in threshold', () => {
    const config: CollisionAggregatorConfig = { alpha: 0.4, bottleneckCapacity: 0.5, fanInThreshold: 5 };
    // inDegree=4 < threshold=5 → chain
    expect(classifyCollisionType(4, 1, 0, config)).toBe('chain');
  });
});

describe('buildIncomingEdgeMap', () => {
  it('groups edges by target', () => {
    const edges = [
      makeEdge('A', 'C', 0.8),
      makeEdge('B', 'C', 0.6),
      makeEdge('A', 'D', 0.5),
    ];
    const map = buildIncomingEdgeMap(edges);
    expect(map.get('C')).toHaveLength(2);
    expect(map.get('D')).toHaveLength(1);
    expect(map.get('A') ?? []).toHaveLength(0); // No incoming edges to A
  });

  it('returns empty map for empty edges', () => {
    const map = buildIncomingEdgeMap([]);
    expect(map.size).toBe(0);
  });

  it('handles single target with many sources', () => {
    const edges = [
      makeEdge('A', 'Hub', 0.9),
      makeEdge('B', 'Hub', 0.7),
      makeEdge('C', 'Hub', 0.5),
      makeEdge('D', 'Hub', 0.3),
      makeEdge('E', 'Hub', 0.1),
    ];
    const map = buildIncomingEdgeMap(edges);
    expect(map.get('Hub')).toHaveLength(5);
  });
});

describe('computeBoltzmannCollisionGain', () => {
  it('returns 0 for no incoming edges', () => {
    const parentEnergies = new Map<string, number>();
    const gain = computeBoltzmannCollisionGain([], parentEnergies, 'chain');
    expect(gain).toBe(0);
  });

  it('returns 0 when no parent has energy', () => {
    const edges = [makeEdge('A', 'B', 0.9)];
    const parentEnergies = new Map<string, number>();
    const gain = computeBoltzmannCollisionGain(edges, parentEnergies, 'chain');
    expect(gain).toBe(0);
  });

  it('computes collision gain from single parent with full energy', () => {
    // Q = 1 - (1 - 0.9 × 1.0) = 1 - 0.1 = 0.9, scaled by chain Φ=1.0
    const edges = [makeEdge('A', 'B', 0.9)];
    const parentEnergies = new Map([['A', 1.0]]);
    const gain = computeBoltzmannCollisionGain(edges, parentEnergies, 'chain');
    expect(gain).toBeCloseTo(0.9, 2);
  });

  it('computes collision gain from two independent parents', () => {
    // Q = 1 - (1 - 0.8×1) × (1 - 0.7×1) = 1 - 0.2 × 0.3 = 1 - 0.06 = 0.94
    const edges = [makeEdge('A', 'C', 0.8), makeEdge('B', 'C', 0.7)];
    const parentEnergies = new Map([['A', 1.0], ['B', 1.0]]);
    const gain = computeBoltzmannCollisionGain(edges, parentEnergies, 'chain');
    expect(gain).toBeCloseTo(0.94, 2);
  });

  it('applies cycle amplification (Φ=1.8)', () => {
    // Same as above but cycle amplification: Q = 1.8 × 0.94^(1/1.8)
    const edges = [makeEdge('A', 'C', 0.8), makeEdge('B', 'C', 0.7)];
    const parentEnergies = new Map([['A', 1.0], ['B', 1.0]]);
    const chainGain = computeBoltzmannCollisionGain(edges, parentEnergies, 'chain');
    const cycleGain = computeBoltzmannCollisionGain(edges, parentEnergies, 'cycle');
    expect(cycleGain).toBeGreaterThan(chainGain);
  });

  it('ignores parents with zero energy', () => {
    const edges = [
      makeEdge('A', 'B', 0.9),
      makeEdge('C', 'B', 0.5),
    ];
    const parentEnergies = new Map([['A', 1.0], ['C', 0]]);
    const gain = computeBoltzmannCollisionGain(edges, parentEnergies, 'chain');
    // Only A contributes: Q = 1 - (1 - 0.9×1) = 0.9
    expect(gain).toBeCloseTo(0.9, 2);
  });
});

describe('aggregateCollisionEnergy', () => {
  it('uses only local score when no incoming edges', () => {
    const node: CollisionNode = {
      serviceId: 'A',
      localScore: 0.7,
      incomingEdges: [],
      cycleCount: 0,
      processed: false,
    };
    // With alpha=0.4: E = 0.4 × localScore + 0.6 × 0 = 0.4 × 0.7 = 0.28
    const result = aggregateCollisionEnergy(node, new Map());
    expect(result.totalEnergy).toBeCloseTo(0.28, 1);
    expect(result.collisionGain).toBe(0);
    expect(result.collisionType).toBe('chain');
  });

  it('blends local score and collision gain', () => {
    // Local=0.5, one parent E=1.0 with w=1.0 → collision gain = 1.0
    // E = 0.4 × 0.5 + 0.6 × 1.0 = 0.2 + 0.6 = 0.8
    const node: CollisionNode = {
      serviceId: 'B',
      localScore: 0.5,
      incomingEdges: [makeEdge('A', 'B', 1.0)],
      cycleCount: 0,
      processed: false,
    };
    const result = aggregateCollisionEnergy(node, new Map([['A', 1.0]]));
    expect(result.totalEnergy).toBeCloseTo(0.8, 1);
  });

  it('classifies bottleneck correctly from inDegree', () => {
    const edges = [
      makeEdge('A', 'Hub', 0.5),
      makeEdge('B', 'Hub', 0.5),
      makeEdge('C', 'Hub', 0.5),
      makeEdge('D', 'Hub', 0.5),
    ];
    const node: CollisionNode = {
      serviceId: 'Hub',
      localScore: 0.2,
      incomingEdges: edges,
      cycleCount: 0,
      processed: false,
    };
    const result = aggregateCollisionEnergy(node, new Map([
      ['A', 1.0], ['B', 1.0], ['C', 1.0], ['D', 1.0],
    ]));
    // inDegree=4, outDegree=0 → capacity=0 → bottleneck
    expect(result.collisionType).toBe('bottleneck');
  });

  it('clamps total energy to [0, 1]', () => {
    const node: CollisionNode = {
      serviceId: 'X',
      localScore: 1.5, // Overshoot
      incomingEdges: [],
      cycleCount: 0,
      processed: false,
    };
    const result = aggregateCollisionEnergy(node, new Map());
    expect(result.totalEnergy).toBeLessThanOrEqual(1);
    expect(result.totalEnergy).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTopologicalOrder', () => {
  it('returns topological order for a DAG', () => {
    // A → B → C  (simple chain)
    const edges = [makeEdge('A', 'B', 1.0), makeEdge('B', 'C', 1.0)];
    const nodeIds = new Set(['A', 'B', 'C']);
    const order = computeTopologicalOrder(edges, nodeIds);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
    expect(order).toHaveLength(3);
  });

  it('returns only reachable nodes', () => {
    // A → B, C isolated
    const edges = [makeEdge('A', 'B', 1.0)];
    const nodeIds = new Set(['A', 'B', 'C']);
    const order = computeTopologicalOrder(edges, nodeIds);
    expect(order).toContain('A');
    expect(order).toContain('B');
    expect(order).toContain('C');
  });

  it('handles empty edge set', () => {
    const order = computeTopologicalOrder([], new Set(['X', 'Y']));
    expect(order).toHaveLength(2);
  });
});

describe('aggregateFaultEnergy (end-to-end)', () => {
  it('computes total energy for a 3-node chain', () => {
    // A (root) → B → C
    // Local: A=0.6, B=0.3, C=0.1
    // Alpha=0.4: energy = 0.4 × local + 0.6 × collision
    const edges = [makeEdge('A', 'B', 0.8), makeEdge('B', 'C', 0.7)];
    const localScores = new Map([['A', 0.6], ['B', 0.3], ['C', 0.1]]);
    const result = aggregateFaultEnergy(edges, localScores);
    expect(result.size).toBe(3);

    // A has no incoming → total = 0.4 × 0.6 + 0.6 × 0 = 0.24
    expect(result.get('A')!.totalEnergy).toBeCloseTo(0.24, 1);
    expect(result.get('A')!.collisionType).toBe('chain');

    // B gets collision gain from A
    expect(result.get('B')!.collisionGain).toBeGreaterThan(0);

    // C gets collision gain from B (which itself got boosted by A)
    expect(result.get('C')!.collisionGain).toBeGreaterThan(0);
  });

  it('detects bottleneck and fan-in types in a diamond topology', () => {
    // A → D, B → D, C → D → E
    const edges = [
      makeEdge('A', 'D', 0.9),
      makeEdge('B', 'D', 0.8),
      makeEdge('C', 'D', 0.7),
      makeEdge('D', 'E', 0.6),
    ];
    const localScores = new Map([
      ['A', 0.8], ['B', 0.7], ['C', 0.6],
      ['D', 0.2], ['E', 0.1],
    ]);
    const result = aggregateFaultEnergy(edges, localScores);

    // D: inDegree=3, outDegree=1 → capacity=0.33 ≤ 0.5 → bottleneck
    expect(result.get('D')!.collisionType).toBe('bottleneck');
    expect(result.get('D')!.inDegree).toBe(3);
  });

  it('handles cycle membership classification', () => {
    const edges = [
      makeEdge('A', 'B', 0.9),
      makeEdge('B', 'A', 0.3), // Cycle
    ];
    const localScores = new Map([['A', 0.5], ['B', 0.5]]);
    const cycleMembership = new Map([['A', 1], ['B', 1]]);
    const result = aggregateFaultEnergy(edges, localScores, cycleMembership);

    expect(result.get('A')!.collisionType).toBe('cycle');
    expect(result.get('B')!.collisionType).toBe('cycle');
  });

  it('handles isolated nodes with no edges', () => {
    const localScores = new Map([['X', 0.5], ['Y', 0.7]]);
    const result = aggregateFaultEnergy([], localScores);
    expect(result.size).toBe(2);
    // Alpha=0.4: E = 0.4 × local = 0.4 × 0.5 = 0.2, 0.4 × 0.7 = 0.28
    expect(result.get('X')!.totalEnergy).toBeCloseTo(0.2, 1);
    expect(result.get('Y')!.totalEnergy).toBeCloseTo(0.28, 1);
  });
});
