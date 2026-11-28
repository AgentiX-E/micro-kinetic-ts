import { describe, expect, it } from 'vitest';
import {
  caseWeightedMean,
  meanOverFaultTypes,
  rollupSuiteAccuracy,
} from '../../../src/benchmarks/runners/suite-accuracy.js';

describe('suite-accuracy — the one owner of the per-fault-type → suite fold', () => {
  // The defect this module repairs, stated as a test: RCAEval's `AVERAGE` column is the mean over
  // FAULT TYPES, and the study's instruments had implemented the mean over CASES. They are different
  // statistics with different answers, and nothing on either artifact named which one it was.
  //
  // The fixture is deliberately UNBALANCED (cells of 9, 3 and 6 cases instead of three equal cells),
  // because that is the only regime in which the two folds differ — and it is the regime every suite
  // but RE1 is in. The same shape as the recorded disagreement: RE1 (all cells 25 cases) agreed
  // exactly between the two paths, and RE2/RE3 did not.
  const UNBALANCED = [
    { accuracy: 3 / 9, cases: 9 },
    { accuracy: 3 / 3, cases: 3 },
    { accuracy: 5 / 6, cases: 6 },
  ];

  it('folds by fault type, not by case, and the two disagree on an unbalanced population', () => {
    // (0.3333 + 1 + 0.8333) / 3 = 0.7222 — the published convention.
    expect(meanOverFaultTypes(UNBALANCED.map((c) => c.accuracy))).toBeCloseTo(13 / 18, 12);
    // (3 + 3 + 5) / 18 = 0.6111 — the study's convention, and a different number.
    expect(caseWeightedMean(UNBALANCED)).toBeCloseTo(11 / 18, 12);
    // The assertion that makes this a test of a DEFECT rather than of two functions: the gap is
    // large enough to move a published cell, and it is signed.
    expect(meanOverFaultTypes(UNBALANCED.map((c) => c.accuracy))).toBeGreaterThan(
      caseWeightedMean(UNBALANCED) + 0.1,
    );
  });

  it('coincides exactly when every cell holds the same number of cases — which is RE1', () => {
    // The property that explains why RE1 agreed between the two paths and RE2/RE3 did not: with equal
    // weights the two folds are the same arithmetic. If this ever fails, one of the two is not what it
    // says it is.
    const BALANCED = [
      { accuracy: 23 / 25, cases: 25 },
      { accuracy: 22 / 25, cases: 25 },
      { accuracy: 21 / 25, cases: 25 },
    ];
    expect(meanOverFaultTypes(BALANCED.map((c) => c.accuracy))).toBe(caseWeightedMean(BALANCED));
  });

  it('returns both conventions from one call, so the published one cannot be taken alone', () => {
    // The refusal: a caller who wants the published statistic gets the case-weighted one in the same
    // object, which is what stops the two from being confused on an artifact a reader cannot re-derive.
    const r = rollupSuiteAccuracy(UNBALANCED);
    expect(r.faultTypeMean).toBeCloseTo(13 / 18, 12);
    expect(r.caseWeighted).toBeCloseTo(11 / 18, 12);
    expect(r.cases).toBe(18);
    expect(r.faultTypes).toBe(3);
    expect(r.faultTypeMean).not.toBe(r.caseWeighted);
  });

  it('is unit-agnostic, which is why the golden table folds percentages and the study folds fractions', () => {
    // Both callers exist: `run-rcaeval.ts` accumulates the printed percentages and `run-ablation.ts`
    // the raw fractions. A fold that imposed a unit would have changed one of the two artifacts by
    // rounding alone, so the unit is the caller's and the arithmetic is the owner's.
    expect(meanOverFaultTypes([80, 90, 100])).toBe(90);
    expect(meanOverFaultTypes([0.8, 0.9, 1])).toBeCloseTo(0.9, 12);
  });

  it('answers zero for an empty population rather than NaN, so no caller reports a NaN cell', () => {
    expect(meanOverFaultTypes([])).toBe(0);
    expect(caseWeightedMean([])).toBe(0);
    expect(caseWeightedMean([{ accuracy: 1, cases: 0 }])).toBe(0);
    expect(rollupSuiteAccuracy([])).toEqual({
      faultTypeMean: 0,
      caseWeighted: 0,
      cases: 0,
      faultTypes: 0,
    });
  });

  it('is exactly the arithmetic the golden table used inline, to the last bit', () => {
    // The property that makes swapping the inline expression for this call a REFACTOR and not a
    // re-measurement: `averages.reduce((s, v) => s + v, 0) / averages.length` accumulates in input
    // order, and so does this. A change here would move the nine published cells by float dust, which
    // the byte-pinned golden fence would catch but which no reviewer should have to.
    const values = [92.0, 88.0, 84.0, 44.0, 92.0];
    let sum = 0;
    for (const v of values) sum += v;
    expect(meanOverFaultTypes(values)).toBe(sum / values.length);
    expect(meanOverFaultTypes(values)).toBe(values.reduce((s, v) => s + v, 0) / values.length);
  });
});
