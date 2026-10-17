import { describe, expect, it } from 'vitest';

import {
  computeFusionCeiling,
  computeFusionCeilingByCell,
  type FusionCasePrediction,
} from '../../../src/benchmarks/leaderboard/fusion-ceiling.js';

/** Build a prediction record with the given top-1 predictions. */
function rec(
  caseId: string,
  cell: string,
  truth: string,
  engineTop1: string | undefined,
  prismTop1: string | undefined,
): FusionCasePrediction {
  return { caseId, cell, truth, engineTop1, prismTop1 };
}

describe('computeFusionCeiling', () => {
  it('returns zeros for empty input', () => {
    const c = computeFusionCeiling([]);
    expect(c.total).toBe(0);
    expect(c.engineCorrect).toBe(0);
    expect(c.prismCorrect).toBe(0);
    expect(c.bothCorrect).toBe(0);
    expect(c.engineOnly).toBe(0);
    expect(c.prismOnly).toBe(0);
    expect(c.bothWrong).toBe(0);
    expect(c.union).toBe(0);
    expect(c.unionRate).toBe(0);
  });

  it('counts both-correct cases', () => {
    const c = computeFusionCeiling([rec('a', 'c', 's1', 's1', 's1')]);
    expect(c.total).toBe(1);
    expect(c.bothCorrect).toBe(1);
    expect(c.engineOnly).toBe(0);
    expect(c.prismOnly).toBe(0);
    expect(c.bothWrong).toBe(0);
    expect(c.union).toBe(1);
    expect(c.unionRate).toBe(1);
  });

  it('counts engine-only cases', () => {
    const c = computeFusionCeiling([rec('a', 'c', 's1', 's1', 's2')]);
    expect(c.engineCorrect).toBe(1);
    expect(c.prismCorrect).toBe(0);
    expect(c.engineOnly).toBe(1);
    expect(c.prismOnly).toBe(0);
    expect(c.union).toBe(1);
  });

  it('counts prism-only cases', () => {
    const c = computeFusionCeiling([rec('a', 'c', 's1', 's2', 's1')]);
    expect(c.engineCorrect).toBe(0);
    expect(c.prismCorrect).toBe(1);
    expect(c.engineOnly).toBe(0);
    expect(c.prismOnly).toBe(1);
    expect(c.union).toBe(1);
  });

  it('counts both-wrong cases', () => {
    const c = computeFusionCeiling([rec('a', 'c', 's1', 's2', 's3')]);
    expect(c.engineCorrect).toBe(0);
    expect(c.prismCorrect).toBe(0);
    expect(c.bothWrong).toBe(1);
    expect(c.union).toBe(0);
    expect(c.unionRate).toBe(0);
  });

  it('treats an undefined top-1 as incorrect', () => {
    const c = computeFusionCeiling([
      rec('a', 'c', 's1', undefined, 's1'),
      rec('b', 'c', 's1', 's1', undefined),
    ]);
    expect(c.engineCorrect).toBe(1); // only case b
    expect(c.prismCorrect).toBe(1); // only case a
    expect(c.bothCorrect).toBe(0);
    expect(c.union).toBe(2);
  });

  it('aggregates a mixed set correctly', () => {
    const c = computeFusionCeiling([
      rec('1', 'c', 's1', 's1', 's1'), // both
      rec('2', 'c', 's1', 's1', 's2'), // engine only
      rec('3', 'c', 's1', 's2', 's1'), // prism only
      rec('4', 'c', 's1', 's2', 's3'), // both wrong
    ]);
    expect(c.total).toBe(4);
    expect(c.engineCorrect).toBe(2);
    expect(c.prismCorrect).toBe(2);
    expect(c.bothCorrect).toBe(1);
    expect(c.engineOnly).toBe(1);
    expect(c.prismOnly).toBe(1);
    expect(c.bothWrong).toBe(1);
    expect(c.union).toBe(3);
    expect(c.unionRate).toBeCloseTo(0.75);
  });
});

describe('computeFusionCeilingByCell', () => {
  it('groups records by cell and aggregates each independently', () => {
    const byCell = computeFusionCeilingByCell([
      rec('1', 'RE2:OB', 's1', 's1', 's1'), // both
      rec('2', 'RE2:OB', 's1', 's1', 's2'), // engine only
      rec('3', 'RE3:TT', 's1', 's2', 's1'), // prism only
    ]);
    expect(byCell.size).toBe(2);

    const re2 = byCell.get('RE2:OB')!;
    expect(re2.total).toBe(2);
    expect(re2.union).toBe(2);
    expect(re2.unionRate).toBe(1);

    const re3 = byCell.get('RE3:TT')!;
    expect(re3.total).toBe(1);
    expect(re3.union).toBe(1);
    expect(re3.prismOnly).toBe(1);
  });

  it('returns an empty map for empty input', () => {
    expect(computeFusionCeilingByCell([]).size).toBe(0);
  });
});
