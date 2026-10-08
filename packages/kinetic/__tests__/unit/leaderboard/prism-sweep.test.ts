import { describe, expect, it } from 'vitest';

import {
  analyzePrismSweep,
  axisPoint,
  DEFAULT_PRISM_POOLING,
  type AxisPoint,
  type PrismSweepAnalysis,
  type SweepCell,
} from '../../../src/benchmarks/leaderboard/prism-sweep.js';

/** Build a sweep cell with a given case count and per-column accuracy. */
function cell(key: string, cases: number, accuracy: readonly number[]): SweepCell {
  return { key, cases, accuracy };
}

/** The additive-only ladder: the sweep this module was written for, as a special case. */
function additiveLadder(weights: readonly number[]): AxisPoint[] {
  return weights.map((w) => axisPoint(w, DEFAULT_PRISM_POOLING));
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
  expect(a.bestZeroRegression!.point.weight).toBe(weight);
  if (overall !== undefined) expect(a.bestZeroRegression!.overall).toBeCloseTo(overall);
  if (gain !== undefined) expect(a.bestZeroRegression!.gain).toBeCloseTo(gain);
}

describe('analyzePrismSweep', () => {
  it('returns an empty analysis for an empty axis', () => {
    const a = analyzePrismSweep([], [cell('c', 25, [])]);
    expect(a.axis).toEqual([]);
    expect(a.overall).toEqual([]);
    expect(a.readings).toEqual([]);
    expect(a.zeroRegressionPoints).toEqual([]);
    expectBest(a, null);
  });

  it('returns zero overall and null best for empty cells', () => {
    const axis = additiveLadder([0, 0.5, 1.0]);
    const a = analyzePrismSweep(axis, []);
    expect(a.overall).toEqual([0, 0, 0]);
    expect(a.zeroRegressionPoints).toEqual(axis);
    expectBest(a, null);
  });

  it('treats the FIRST axis point as the zero-regression reference', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.5, 1.0]), [cell('c', 25, [0.5, 0.6, 0.7])]);
    expect(a.overall[0]).toBeCloseTo(0.5);
    expect(a.overall[1]).toBeCloseTo(0.6);
    expect(a.overall[2]).toBeCloseTo(0.7);
    expect(a.zeroRegressionPoints.map((p) => p.weight)).toEqual([0, 0.5, 1.0]);
    expectBest(a, 1.0, 0.7, 0.2);
  });

  it('computes the weighted overall from per-cell case counts', () => {
    // 75 cases at 100% dominate 25 cases at 0% → (75*1 + 25*0) / 100 = 0.75.
    const a = analyzePrismSweep(additiveLadder([0, 0.5]), [
      cell('big', 75, [1.0, 1.0]),
      cell('small', 25, [0.0, 1.0]),
    ]);
    expect(a.overall[0]).toBeCloseTo(0.75);
    expect(a.overall[1]).toBeCloseTo(1.0);
  });

  it('detects a regressing cell at one point but not another', () => {
    const axis = additiveLadder([0, 0.25, 0.5]);
    const a = analyzePrismSweep(axis, [
      cell('stable', 25, [0.8, 0.8, 0.8]),
      cell('flip', 25, [1.0, 1.0, 0.6]),
    ]);
    expect(a.readings[1]!.regressingCells).toEqual([]);
    expect(a.readings[2]!.regressingCells).toEqual(['flip']);
    expect(a.zeroRegressionPoints).toEqual([axis[0]!, axis[1]!]);
  });

  it('excludes a point where any cell falls below its baseline', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.5, 1.0]), [
      cell('a', 25, [0.9, 0.9, 0.85]),
      cell('b', 25, [0.5, 0.8, 0.8]),
    ]);
    expect(a.zeroRegressionPoints.map((p) => p.weight)).toEqual([0, 0.5]);
    expect(a.readings[2]!.regressingCells).toEqual(['a']);
  });

  it('picks the best zero-regression point by overall, not by weight', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.25, 0.5]), [
      cell('a', 25, [0.8, 0.9, 0.9]),
      cell('b', 25, [0.5, 0.7, 0.4]),
    ]);
    expect(a.zeroRegressionPoints.map((p) => p.weight)).toEqual([0, 0.25]);
    expectBest(a, 0.25, 0.8, 0.15);
  });

  it('falls back to the baseline when only the first point has zero regression', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.5]), [
      cell('a', 25, [0.8, 0.7]),
      cell('b', 25, [0.9, 0.6]),
    ]);
    expect(a.zeroRegressionPoints.map((p) => p.weight)).toEqual([0]);
    expectBest(a, 0, 0.85, 0);
  });

  it('tolerates float noise with a small epsilon (no spurious regression)', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.5]), [cell('a', 25, [0.3, 0.3 + 1e-12])]);
    expect(a.zeroRegressionPoints.map((p) => p.weight)).toEqual([0, 0.5]);
  });

  it('throws when a cell accuracy length mismatches the axis length', () => {
    expect(() => analyzePrismSweep(additiveLadder([0, 0.5]), [cell('a', 25, [0.8])])).toThrow();
  });

  it('reports gain relative to the FIRST point overall', () => {
    const a = analyzePrismSweep(additiveLadder([0, 0.5]), [
      cell('a', 50, [0.5, 0.6]),
      cell('b', 50, [0.5, 0.6]),
    ]);
    expectBest(a, 0.5, 0.6, 0.1);
  });
});

describe('the swept axis, and why its first point is not a parameter', () => {
  // The sweep's whole output is "no cell fell below the baseline". The baseline is therefore not a
  // configuration among others — it is the DEFINITION of the comparison, and it has exactly one value:
  // the shipped configuration. An axis that starts anywhere else reports a frontier against a run
  // nobody ships, which is indistinguishable in the artifact from a frontier against the shipped one.

  it('refuses an axis whose first point is not the shipped configuration', () => {
    // A positive weight first: every "regression" would be measured against a configuration that is
    // not what ships, and the frontier would be reported as if it were.
    expect(() =>
      analyzePrismSweep(
        [axisPoint(0.5, DEFAULT_PRISM_POOLING), axisPoint(1, DEFAULT_PRISM_POOLING)],
        [cell('a', 25, [0.8, 0.9])],
      ),
    ).toThrow(/first/i);
    // The shipped POOLING is part of the shipped configuration too: `conjunctive` at weight 0 is the
    // other pooling of a term whose weight is zero, so it is a valid COLUMN but not a baseline.
    expect(() =>
      analyzePrismSweep(
        [axisPoint(0, 'conjunctive'), axisPoint(1, 'conjunctive')],
        [cell('a', 25, [0.8, 0.9])],
      ),
    ).toThrow(/first/i);
  });

  it('refuses a duplicated point, so a column cannot be counted twice', () => {
    // Two identical points are two columns of one measurement: the weighted overall would count the
    // same cell twice and the frontier would name the same configuration twice.
    expect(() =>
      analyzePrismSweep(
        [axisPoint(0, 'additive'), axisPoint(0.5, 'additive'), axisPoint(0.5, 'additive')],
        [cell('a', 25, [0.8, 0.9, 0.9])],
      ),
    ).toThrow(/duplicate/i);
  });

  it('refuses a label that disagrees with the point it labels', () => {
    // A point IS its configuration, and its label must be that configuration's name: a hand-written
    // label that differs prints a column as a configuration it was not measured at — the same defect as
    // naming the wrong column, one step earlier and harder to see. Found by COVERAGE, not by reading:
    // the rule was documented and untested, and the test is what makes the throw a measurement.
    const forged = { ...axisPoint(0.5, 'conjunctive'), label: 'w=0.5/additive' };
    expect(() =>
      analyzePrismSweep([axisPoint(0, 'additive'), forged], [cell('a', 25, [0.8, 0.9])]),
    ).toThrow(/label/i);
    // Positive control: the same point with the label it derives is accepted, so the refusal is
    // measuring the disagreement rather than the presence of a label.
    expect(() =>
      analyzePrismSweep(
        [axisPoint(0, 'additive'), axisPoint(0.5, 'conjunctive')],
        [cell('a', 25, [0.8, 0.9])],
      ),
    ).not.toThrow();
  });

  it('accepts the shipped configuration as the baseline of a two-pooling axis', () => {
    const axis = [
      axisPoint(0, 'additive'),
      axisPoint(0, 'conjunctive'),
      axisPoint(1, 'additive'),
      axisPoint(1, 'conjunctive'),
    ];
    const a = analyzePrismSweep(axis, [cell('a', 25, [0.8, 0.8, 0.7, 0.9])]);
    expect(a.axis).toEqual(axis);
    expect(a.readings.map((r) => r.point.pooling)).toEqual([
      'additive',
      'conjunctive',
      'additive',
      'conjunctive',
    ]);
  });
});

describe('the second pooling is a column, and the frontier must say which one won', () => {
  // THE TEST THIS GENERALISATION EXISTS FOR. The record's frontier was `{0} only` — measured with the
  // engine's single call site hard-coded to `additive`, so it is a statement about ONE slice of a
  // two-dimensional space. These cases hold the shape of the experiment that re-takes it.

  it('keeps a point with a DIFFERENT pooling on the frontier when only the shipped pooling regresses', () => {
    // The mechanism, exactly: a cell whose accuracy falls under `additive` at weight 1 but rises under
    // `conjunctive` at the same weight. Under the old signature this cell could only be reported as a
    // regression, because there was one column per weight and it was additive.
    const axis = [axisPoint(0, 'additive'), axisPoint(1, 'additive'), axisPoint(1, 'conjunctive')];
    const a = analyzePrismSweep(axis, [
      cell('delay/OB', 25, [0.88, 0.4, 0.96]),
      cell('cpu/TT', 25, [0.8, 0.96, 0.96]),
    ]);
    // The additive column is excluded by the delay cell; the conjunctive column is not.
    expect(a.readings[1]!.regressingCells).toEqual(['delay/OB']);
    expect(a.readings[2]!.regressingCells).toEqual([]);
    expect(a.zeroRegressionPoints).toEqual([axis[0]!, axis[2]!]);
    // And the winner NAMES its pooling: a report that printed only `weight=1` would be ambiguous
    // between two configurations, one of which regresses and one of which does not.
    expect(a.bestZeroRegression!.point.pooling).toBe('conjunctive');
    expect(a.bestZeroRegression!.point.weight).toBe(1);
    // Baseline = (25×0.88 + 25×0.80)/50 = 0.84; the conjunctive column = (25×0.96 + 25×0.96)/50 = 0.96.
    expect(a.bestZeroRegression!.gain).toBeCloseTo(0.12);
  });

  it('names the pooling even when both are on the frontier', () => {
    const axis = [axisPoint(0, 'additive'), axisPoint(1, 'additive'), axisPoint(1, 'conjunctive')];
    const a = analyzePrismSweep(axis, [cell('a', 25, [0.8, 0.9, 0.9])]);
    expect(a.zeroRegressionPoints).toHaveLength(3);
    // Ties resolve in AXIS order — the earlier column wins, so the choice is a property of the
    // measured list rather than of an iteration order nobody stated.
    expect(a.bestZeroRegression!.point.pooling).toBe('additive');
  });

  it('treats the weight-0 point of the OTHER pooling as a valid, inert control column', () => {
    // `prismWeight = 0` multiplies the signal away whatever the pooling, so this column must equal the
    // baseline in every cell. It is the sweep's no-op control: if it ever differs, the pooling is
    // reaching the ranking at weight zero and the measurement is not the one the label claims.
    const axis = [
      axisPoint(0, 'additive'),
      axisPoint(0, 'conjunctive'),
      axisPoint(1, 'conjunctive'),
    ];
    const a = analyzePrismSweep(axis, [cell('a', 25, [0.8, 0.8, 0.9])]);
    expect(a.readings[1]!.overall).toBeCloseTo(a.readings[0]!.overall);
    expect(a.readings[1]!.regressingCells).toEqual([]);
  });

  it('labels every point so a column cannot be reported without its configuration', () => {
    const axis = [axisPoint(0, 'additive'), axisPoint(0.5, 'conjunctive')];
    expect(axis[0]!.label).toBe('w=0/additive');
    expect(axis[1]!.label).toBe('w=0.5/conjunctive');
    const a = analyzePrismSweep(axis, [cell('a', 25, [0.8, 0.9])]);
    expect(a.readings.map((r) => r.point.label)).toEqual(['w=0/additive', 'w=0.5/conjunctive']);
    expect(a.bestZeroRegression!.point.label).toBe('w=0.5/conjunctive');
  });
});
