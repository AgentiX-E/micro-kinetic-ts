import { describe, expect, it } from 'vitest';

import {
  analyzePrismSweep,
  type PrismSweepAnalysis,
  type SweepCell,
} from '../../../src/benchmarks/leaderboard/prism-sweep.js';

/** Build a sweep cell with a given case count and per-weight accuracy. */
function cell(key: string, cases: number, accuracy: readonly number[]): SweepCell {
  return { key, cases, accuracy };
}

/** Assert a best-zero-regression result with float-tolerant fields. */
function expectBest(
  a: PrismSweepAnalysis,
  weight: number | null,
  overall?: number,
  gain?: number,
): void {
  if (weight === null) {
    expect(a.bestZeroRegression).toBeNull();
    return;
  }
  expect(a.bestZeroRegression).not.toBeNull();
  expect(a.bestZeroRegression!.weight).toBe(weight);
  if (overall !== undefined) expect(a.bestZeroRegression!.overall).toBeCloseTo(overall);
  if (gain !== undefined) expect(a.bestZeroRegression!.gain).toBeCloseTo(gain);
}

describe('analyzePrismSweep', () => {
  it('returns an empty analysis for empty weights', () => {
    const a = analyzePrismSweep([], [cell('c', 25, [])]);
    expect(a.weights).toEqual([]);
    expect(a.overall).toEqual([]);
    expect(a.points).toEqual([]);
    expect(a.zeroRegressionWeights).toEqual([]);
    expectBest(a, null);
  });

  it('returns zero overall and null best for empty cells', () => {
    const a = analyzePrismSweep([0, 0.5, 1.0], []);
    expect(a.overall).toEqual([0, 0, 0]);
    expect(a.zeroRegressionWeights).toEqual([0, 0.5, 1.0]);
    expectBest(a, null);
  });

  it('treats the weight-0 baseline as the zero-regression reference', () => {
    const a = analyzePrismSweep([0, 0.5, 1.0], [cell('c', 25, [0.5, 0.6, 0.7])]);
    expect(a.overall[0]).toBeCloseTo(0.5);
    expect(a.overall[1]).toBeCloseTo(0.6);
    expect(a.overall[2]).toBeCloseTo(0.7);
    expect(a.zeroRegressionWeights).toEqual([0, 0.5, 1.0]);
    expectBest(a, 1.0, 0.7, 0.2);
  });

  it('computes the weighted overall from per-cell case counts', () => {
    // 75 cases at 100% dominate 25 cases at 0% → (75*1 + 25*0) / 100 = 0.75.
    const a = analyzePrismSweep(
      [0, 0.5],
      [cell('big', 75, [1.0, 1.0]), cell('small', 25, [0.0, 1.0])],
    );
    expect(a.overall[0]).toBeCloseTo(0.75);
    expect(a.overall[1]).toBeCloseTo(1.0);
  });

  it('detects a regressing cell at one weight but not another', () => {
    const a = analyzePrismSweep(
      [0, 0.25, 0.5],
      [cell('stable', 25, [0.8, 0.8, 0.8]), cell('flip', 25, [1.0, 1.0, 0.6])],
    );
    expect(a.points[1]!.regressingCells).toEqual([]);
    expect(a.points[2]!.regressingCells).toEqual(['flip']);
    expect(a.zeroRegressionWeights).toEqual([0, 0.25]);
  });

  it('excludes a weight where any cell falls below its baseline', () => {
    const a = analyzePrismSweep(
      [0, 0.5, 1.0],
      [cell('a', 25, [0.9, 0.9, 0.85]), cell('b', 25, [0.5, 0.8, 0.8])],
    );
    expect(a.zeroRegressionWeights).toEqual([0, 0.5]);
    expect(a.points[2]!.regressingCells).toEqual(['a']);
  });

  it('picks the best zero-regression weight by overall, not by weight', () => {
    const a = analyzePrismSweep(
      [0, 0.25, 0.5],
      [cell('a', 25, [0.8, 0.9, 0.9]), cell('b', 25, [0.5, 0.7, 0.4])],
    );
    expect(a.zeroRegressionWeights).toEqual([0, 0.25]);
    expectBest(a, 0.25, 0.8, 0.15);
  });

  it('falls back to the baseline when only weight 0 has zero regression', () => {
    const a = analyzePrismSweep([0, 0.5], [cell('a', 25, [0.8, 0.7]), cell('b', 25, [0.9, 0.6])]);
    expect(a.zeroRegressionWeights).toEqual([0]);
    expectBest(a, 0, 0.85, 0);
  });

  it('tolerates float noise with a small epsilon (no spurious regression)', () => {
    const a = analyzePrismSweep([0, 0.5], [cell('a', 25, [0.3, 0.3 + 1e-12])]);
    expect(a.zeroRegressionWeights).toEqual([0, 0.5]);
  });

  it('throws when a cell accuracy length mismatches the weight count', () => {
    expect(() => analyzePrismSweep([0, 0.5], [cell('a', 25, [0.8])])).toThrow();
  });

  it('reports gain relative to the weight-0 overall', () => {
    const a = analyzePrismSweep([0, 0.5], [cell('a', 50, [0.5, 0.6]), cell('b', 50, [0.5, 0.6])]);
    expectBest(a, 0.5, 0.6, 0.1);
  });
});
