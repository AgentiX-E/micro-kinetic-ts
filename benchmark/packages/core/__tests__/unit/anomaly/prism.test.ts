/**
 * Unit tests for the PRISM graph-free scoring primitives (arXiv:2601.21359).
 *
 * Pins three responsibilities:
 *   1. Metric-channel classification (internal vs external).
 *   2. Deviation-based z-score (standardized mean shift, with the three
 *      degenerate-scale fallbacks).
 *   3. Component score combination (additive / conjunctive).
 *
 * The internal/external asymmetry is the method's core: a root cause is
 * anomalous in BOTH channels while an affected component is anomalous in the
 * external channel only.
 *
 * @module anomaly/prism.test
 */

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  classifyMetricChannel,
  combinePrismScore,
  DEFAULT_PRISM_POOLING,
  deviationZScore,
  isPrismPooling,
  PRISM_POOLINGS,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

/** Injection time used by the helpers: every timestamp is < 1000 or >= 1000. */
const INJECT_MS = 1000;

/**
 * Build a time series whose first `baseline.length` points fall before the
 * injection time (timestamps 0, 1, 2, …) and whose remaining points fall at
 * or after it (timestamps INJECT_MS, INJECT_MS+1, …).
 */
function makeSeries(label: string, baseline: number[], fault: number[], unit = ''): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  baseline.forEach((v, i) => {
    timestamps.push(i);
    values.push(v);
  });
  fault.forEach((v, i) => {
    timestamps.push(INJECT_MS + i);
    values.push(v);
  });
  return { label, timestamps, values: new Float64Array(values), unit };
}

// ── classifyMetricChannel ─────────────────────────────────

describe('classifyMetricChannel', () => {
  it.each([
    ['cpu', 'internal'],
    ['cpu_usage', 'internal'],
    ['cpu_usage_percent', 'internal'],
    ['mem', 'internal'],
    ['memory', 'internal'],
    ['memory_rss_bytes', 'internal'],
    ['disk', 'internal'],
    ['diskio', 'internal'],
    ['disk_write_iops', 'internal'],
    ['socket', 'internal'],
    ['socket_count', 'internal'],
  ])('classifies %s as internal', (name, channel) => {
    expect(classifyMetricChannel(name)).toBe(channel);
  });

  it.each([
    ['latency', 'external'],
    ['latency-50', 'external'],
    ['latency-90', 'external'],
    ['latency_ms', 'external'],
    ['delay', 'external'],
    ['error', 'external'],
    ['error_rate', 'external'],
    ['throughput', 'external'],
    ['workload', 'external'],
    ['loss', 'external'],
  ])('classifies %s as external', (name, channel) => {
    expect(classifyMetricChannel(name)).toBe(channel);
  });

  it('is case-insensitive', () => {
    expect(classifyMetricChannel('CPU_USAGE')).toBe('internal');
    expect(classifyMetricChannel('Error_Rate')).toBe('external');
  });

  it('defaults unknown metric names to external', () => {
    expect(classifyMetricChannel('request_count')).toBe('external');
    expect(classifyMetricChannel('response_time')).toBe('external');
  });
});

// ── deviationZScore ───────────────────────────────────────

describe('deviationZScore', () => {
  it('computes a standardized mean shift when the baseline has variance', () => {
    // baseline [0, 2] → mean 1, std 1; fault [4, 4] → mean 4.
    const s = deviationZScore(makeSeries('cpu', [0, 2], [4, 4]), INJECT_MS);
    // |4 − 1| / 1 = 3.
    expect(s).toBeCloseTo(3, 6);
  });

  it('falls back to a relative change when the baseline is constant', () => {
    // baseline [10, 10] → mean 10, std 0; fault [30, 30] → mean 30.
    const s = deviationZScore(makeSeries('mem', [10, 10], [30, 30]), INJECT_MS);
    // scale = |10|, S = |30 − 10| / 10 = 2.
    expect(s).toBeCloseTo(2, 6);
  });

  it('falls back to an absolute change when the baseline is exactly zero', () => {
    // baseline [0, 0] → mean 0, std 0; fault [5, 5] → mean 5.
    const s = deviationZScore(makeSeries('diskio', [0, 0], [5, 5]), INJECT_MS);
    // scale = 1, S = |5 − 0| / 1 = 5.
    expect(s).toBeCloseTo(5, 6);
  });

  it('returns 0 when there is no fault window', () => {
    const s = deviationZScore(makeSeries('cpu', [1, 2], []), INJECT_MS);
    expect(s).toBe(0);
  });

  it('returns 0 when there is no baseline window', () => {
    // Every timestamp >= INJECT_MS.
    const ts: TimeSeries = {
      label: 'cpu',
      timestamps: [1000, 1100],
      values: new Float64Array([1, 2]),
      unit: '',
    };
    expect(deviationZScore(ts, INJECT_MS)).toBe(0);
  });

  it('returns 0 when the fault mean equals the baseline mean', () => {
    const s = deviationZScore(makeSeries('cpu', [1, 2, 3], [1, 2, 3]), INJECT_MS);
    expect(s).toBeCloseTo(0, 9);
  });
});

// ── The pooling vocabulary ────────────────────────────────

describe('the pooling vocabulary', () => {
  // The union, the census over it and the guard are what make the second pooling
  // REACHABLE by name: the engine's one call site omitted the argument for several
  // iterations, so `conjunctive` was implemented, measured by the standalone
  // evaluator, and unselectable from every runner built on the engine. A vocabulary
  // that is not the union is the defect; these assertions are the census.

  it('is EXHAUSTIVE over the union, so a new member is a compile error', () => {
    // `Record<PrismPooling, true>` is the mechanism: adding a member to the union
    // without naming it here does not compile. The keys are asserted so the
    // vocabulary is also checkable at runtime rather than only under `tsc`.
    expect(Object.keys(PRISM_POOLINGS).sort()).toEqual(['additive', 'conjunctive']);
    expect(Object.values(PRISM_POOLINGS).every((v) => v === true)).toBe(true);
  });

  it('defaults to a member of the union, and the primitive honours that default', () => {
    // The default is a CONSTANT rather than a literal at the call site: it is
    // quoted by the option surface, by the reported configuration line and by the
    // primitive's own parameter, and three copies of one shipped value is the
    // shape that has already published a number 24.2pp below the best-measured one.
    expect(isPrismPooling(DEFAULT_PRISM_POOLING)).toBe(true);
    // Read behaviourally, so the constant cannot describe a default the function
    // does not apply: passing it and omitting it must be the same call.
    for (const [i, e] of [
      [2, 2],
      [0, 4],
      [4, 0],
      [0, 0],
      [3.5, 1.25],
    ] as const) {
      expect(combinePrismScore(i, e, DEFAULT_PRISM_POOLING)).toBe(combinePrismScore(i, e));
    }
  });

  it('accepts every member and rejects everything else', () => {
    for (const member of Object.keys(PRISM_POOLINGS)) {
      expect(isPrismPooling(member), `${member} is a member`).toBe(true);
    }
    for (const token of ['', ' additive', 'additive ', 'Additive', 'ADDITIVE', 'conj', 'both']) {
      expect(isPrismPooling(token), `${JSON.stringify(token)} is not a member`).toBe(false);
    }
  });

  it('rejects the prototype chain, which `in` would have accepted', () => {
    // THE REASON THE GUARD IS NOT `value in PRISM_POOLINGS`. A `Record` is an
    // object literal, so `toString`, `constructor` and `__proto__` are reachable
    // through its prototype — and `toString` is a token a dispatch can really send.
    // A guard that accepted it would hand `combinePrismScore` a value it treats as
    // `additive`, so a dispatch asking for a typo would silently reproduce the
    // shipped run and print a confident number.
    for (const token of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
      expect(isPrismPooling(token), `${token} is on the prototype, not in the census`).toBe(false);
    }
    // Positive control for the arm: the same tokens ARE reachable by `in`, so the
    // assertion above is measuring `hasOwnProperty.call` and not an absent object.
    expect('toString' in PRISM_POOLINGS).toBe(true);
  });

  it('is the vocabulary the combination function dispatches on, member by member', () => {
    // A vocabulary that named a member the function did not implement would be a
    // list, not a dispatch: every member must select its OWN formula. Asserted as
    // a partition over the population so a new member has to be decided here.
    const formula = (p: string): number =>
      combinePrismScore(2, 4, p as typeof DEFAULT_PRISM_POOLING);
    expect(formula('additive')).toBeCloseTo(6 - Math.log1p(6), 12);
    expect(formula('conjunctive')).toBe(2);
    // And the two really do differ on this input, so the partition is not vacuous.
    expect(formula('additive')).not.toBeCloseTo(formula('conjunctive'), 6);
  });
});

// ── combinePrismScore ─────────────────────────────────────

describe('combinePrismScore', () => {
  it('combines additively by default: M = S^I + S^E − log1p(S^I + S^E)', () => {
    expect(combinePrismScore(2, 2)).toBeCloseTo(2 + 2 - Math.log1p(4), 12);
  });

  it('additive dampens a single-channel score via the −log1p term', () => {
    // external-only: M = 4 − log1p(4), strictly below the raw 4.
    const m = combinePrismScore(0, 4);
    expect(m).toBeCloseTo(4 - Math.log1p(4), 12);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(4);
  });

  it('additive maps the degenerate zero-sum to exactly 0', () => {
    expect(combinePrismScore(0, 0)).toBe(0);
  });

  it('additive is monotone in each channel', () => {
    // Raising either channel must never lower M.
    expect(combinePrismScore(3, 2)).toBeGreaterThan(combinePrismScore(2, 2));
    expect(combinePrismScore(2, 3)).toBeGreaterThan(combinePrismScore(2, 2));
  });

  it('combines conjunctively with min(S^I, S^E)', () => {
    expect(combinePrismScore(2, 2, 'conjunctive')).toBe(2);
  });

  it('conjunctive gates an external-only symptom to 0', () => {
    // A symptom is anomalous in the external channel only → min(0, 4) = 0.
    expect(combinePrismScore(0, 4, 'conjunctive')).toBe(0);
  });

  it('conjunctive is symmetric', () => {
    expect(combinePrismScore(2, 4, 'conjunctive')).toBe(2);
    expect(combinePrismScore(4, 2, 'conjunctive')).toBe(2);
  });
});
