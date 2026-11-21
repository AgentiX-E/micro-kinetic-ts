/**
 * Unit tests for {@link mergeRunResults}.
 *
 * The property under test is the one that makes memory slicing legitimate: folding a cell's slices must produce
 * the SAME result a single pass over the whole cell would have produced. That is not a stylistic preference — the
 * RCAEval runner slices cells because a case there is 47–86 MB of parsed telemetry and its container ceiling is
 * 8 GiB, so if the fold were not exact the published nine cells would silently become a function of the slice
 * size, and every arm measured against them would be measuring a different corpus.
 *
 * The fixture below is the runner's own arithmetic restated for a hand-written set of cases: each field is
 * computed from the per-case facts, so `fixture(all)` is what one `runSuite` over all of them produces. The
 * assertions then compare `mergeRunResults` of uneven slices against it, field by field.
 *
 * @module __tests__/unit/runners/merge-run-results
 */

import { describe, expect, it } from 'vitest';

import type {
  CasePrediction,
  FaultTypeMetric,
  RunResult,
} from '../../../src/benchmarks/runners/benchmark-runner.js';
import { mergeRunResults } from '../../../src/benchmarks/runners/benchmark-runner.js';

/** One case's facts, in the terms every `RunResult` field is a fold of. */
interface CaseFact {
  readonly id: string;
  readonly faultType: string;
  /** Whether the top-1 service is accepted. */
  readonly top1: boolean;
  /** Whether the truth is inside the first five. */
  readonly top5: boolean;
  /** Whether the top-1 names the ground-truth fault type. */
  readonly type: boolean;
  /** RCAEval's `Avg@5` for this case: `(1/5)·Σ_{k≤5} Acc@k`. */
  readonly avg5: number;
}

/**
 * The result one `runSuite` over these cases produces.
 *
 * Written as the runner's arithmetic rather than as a literal so the test cannot pass by agreeing with a
 * hard-coded number: `totalCases`, each ratio and each `perFaultType` entry are derived from the facts above,
 * and the two per-case arrays are derived from the facts too. `duration` is passed in because it is the one field
 * with no per-case source.
 */
function fixture(facts: readonly CaseFact[], duration = 0): RunResult {
  const n = facts.length;
  const per = new Map<
    string,
    { cases: number; correct: number; top5: number; type: number; avg5: number }
  >();
  for (const f of facts) {
    const seen = per.get(f.faultType) ?? { cases: 0, correct: 0, top5: 0, type: 0, avg5: 0 };
    per.set(f.faultType, {
      cases: seen.cases + 1,
      correct: seen.correct + (f.top1 ? 1 : 0),
      top5: seen.top5 + (f.top5 ? 1 : 0),
      type: seen.type + (f.type ? 1 : 0),
      avg5: seen.avg5 + f.avg5,
    });
  }

  const perFaultType = new Map<string, FaultTypeMetric>();
  for (const [faultType, t] of per) {
    perFaultType.set(faultType, {
      cases: t.cases,
      correct: t.correct,
      accuracy: t.correct / t.cases,
      top5Correct: t.top5,
      acc5: t.top5 / t.cases,
      avg5: t.avg5 / t.cases,
      typeCorrect: t.type,
      typeAccuracy: t.type / t.cases,
    });
  }

  const correct = facts.filter((f) => f.top1).length;
  const avg5 = n > 0 ? facts.reduce((s, f) => s + f.avg5, 0) / n : 0;

  const casePredictions: CasePrediction[] = facts.map((f) => ({
    caseId: f.id,
    truth: `svc-${f.id}`,
    top1: f.top1 ? `svc-${f.id}` : `other-${f.id}`,
    correct: f.top1,
  }));

  return {
    suiteName: 'SockShop-RE2-cpu',
    totalCases: n,
    avgTop1: n > 0 ? correct / n : 0,
    // The fixture's facts do not distinguish Top-3 from Top-5, so both are the top5 fact. What the merge has to
    // preserve is the FOLD, not the fixture's realism about ranks 3 and 5.
    avgTop3: n > 0 ? facts.filter((f) => f.top5).length / n : 0,
    avgTop5: avg5,
    locationAccuracy: n > 0 ? correct / n : 0,
    typeAccuracy: n > 0 ? facts.filter((f) => f.type).length / n : 0,
    perFaultType,
    failures: facts
      .filter((f) => !f.top1)
      .map((f) => ({
        caseId: f.id,
        expectedService: `svc-${f.id}`,
        expectedFaultType: f.faultType,
        actualTop: `other-${f.id}`,
        reason: 'Top prediction does not match ground truth',
      })),
    casePredictions,
    duration,
  };
}

/**
 * Three cases whose slices CANNOT be averaged as blocks.
 *
 * Slice A is one correct case (rate 1.0) and slice B is two wrong ones (rate 0.0). An unweighted mean of the two
 * rates is 0.5 and the case-weighted answer is 1/3; any implementation that averages blocks fails here.
 */
const FACTS: readonly CaseFact[] = [
  { id: 'a', faultType: 'cpu', top1: true, top5: true, type: true, avg5: 1.0 },
  { id: 'b', faultType: 'cpu', top1: false, top5: true, type: true, avg5: 0.6 },
  { id: 'c', faultType: 'mem', top1: false, top5: false, type: false, avg5: 0.2 },
];

describe('mergeRunResults — a cell sliced for memory is the cell', () => {
  it('reproduces the whole-cell result from two uneven slices, field by field', () => {
    const whole = fixture(FACTS, 90);

    const merged = mergeRunResults([fixture(FACTS.slice(0, 1), 30), fixture(FACTS.slice(1), 60)]);

    expect(merged.suiteName).toBe(whole.suiteName);
    expect(merged.totalCases).toBe(3);
    expect(merged.avgTop1).toBeCloseTo(whole.avgTop1, 12);
    expect(merged.avgTop3).toBeCloseTo(whole.avgTop3, 12);
    expect(merged.avgTop5).toBeCloseTo(whole.avgTop5, 12);
    expect(merged.locationAccuracy).toBeCloseTo(whole.locationAccuracy, 12);
    expect(merged.typeAccuracy).toBeCloseTo(whole.typeAccuracy, 12);
    expect(merged.duration).toBe(90);
    expect([...merged.perFaultType.entries()]).toEqual([...whole.perFaultType.entries()]);
    expect(merged.casePredictions.map((p) => p.caseId)).toEqual(['a', 'b', 'c']);
    expect(merged.failures.map((f) => f.caseId)).toEqual(['b', 'c']);
  });

  it('folds RATES by case count, which an unweighted mean of blocks would not', () => {
    // 1 correct of 1, then 0 correct of 2. The block mean is 0.5; the case-weighted rate is 1/3.
    const merged = mergeRunResults([fixture(FACTS.slice(0, 1)), fixture(FACTS.slice(1))]);

    expect(merged.avgTop1).toBeCloseTo(1 / 3, 12);
    expect(merged.avgTop1).not.toBeCloseTo(0.5, 6);
  });

  it('recovers Avg@5 from its own count rather than averaging the blocks', () => {
    // Slice A: 1.0 over one case. Slice B: (0.6 + 0.2)/2 = 0.4 over two. The case-weighted fold is
    // (1.0×1 + 0.4×2)/3 = 0.6; the block mean would be 0.7.
    const merged = mergeRunResults([fixture(FACTS.slice(0, 1)), fixture(FACTS.slice(1))]);

    expect(merged.avgTop5).toBeCloseTo(0.6, 12);
    expect(merged.avgTop5).not.toBeCloseTo(0.7, 6);
  });

  it('merges a fault type that appears in BOTH slices into one entry', () => {
    // `cpu` is carried by case a in slice 1 and case b in slice 2, so the merged entry spans both slices. Its
    // `avg5` is a mean over two cases, and this is the field whose sum has to be recovered before the fold.
    const merged = mergeRunResults([fixture(FACTS.slice(0, 1)), fixture(FACTS.slice(1))]);
    const cpu = merged.perFaultType.get('cpu')!;

    expect(cpu.cases).toBe(2);
    expect(cpu.correct).toBe(1);
    expect(cpu.accuracy).toBeCloseTo(0.5, 12);
    expect(cpu.top5Correct).toBe(2);
    expect(cpu.acc5).toBe(1);
    expect(cpu.avg5).toBeCloseTo(0.8, 12);
    expect(cpu.typeCorrect).toBe(2);
  });

  it('keeps every slice order, so the merged records are the single-pass records', () => {
    const merged = mergeRunResults([
      fixture(FACTS.slice(0, 1)),
      fixture(FACTS.slice(1, 2)),
      fixture(FACTS.slice(2)),
    ]);

    expect(merged.casePredictions.map((p) => p.caseId)).toEqual(['a', 'b', 'c']);
    expect(merged.failures.map((f) => f.caseId)).toEqual(['b', 'c']);
  });

  it('is a no-op on a single slice', () => {
    const only = fixture(FACTS, 12);
    const merged = mergeRunResults([only]);

    expect(merged.totalCases).toBe(only.totalCases);
    expect(merged.avgTop1).toBe(only.avgTop1);
    expect(merged.avgTop5).toBe(only.avgTop5);
    expect([...merged.perFaultType.entries()]).toEqual([...only.perFaultType.entries()]);
  });

  it('refuses to fold nothing, because a cell with no slice is a caller defect', () => {
    expect(() => mergeRunResults([])).toThrow(/at least one slice/);
  });
});
