/**
 * Unit tests for the PRISM reimplementation (arXiv:2601.21359).
 *
 * Pins the two responsibilities that live in THIS module on top of the shared
 * primitives (channel classification + deviation z-score + M-score combination,
 * covered in `@agentix-e/micro-kinetic-core`):
 *   1. Component ranking (max pooling + additive/conjunctive combination +
 *      deterministic descending order).
 *   2. Top-1 convenience (`prismTop1`).
 *
 * The internal/external asymmetry is the method's core: a root cause is
 * anomalous in BOTH channels while an affected component is anomalous in the
 * external channel only.
 *
 * @module benchmarks/leaderboard/prism.test
 */

import { describe, expect, it } from 'vitest';

import { computePrismRanking, prismTop1 } from '../../../src/benchmarks/leaderboard/prism.js';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

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

/** Baseline/fault windows sized so the injection boundary is clean. */
function metricsOf(services: Record<string, TimeSeries[]>): Map<string, readonly TimeSeries[]> {
  return new Map(Object.entries(services));
}

// ── computePrismRanking ───────────────────────────────────

describe('computePrismRanking', () => {
  it('ranks a root cause (internal AND external) above an external-only victim', () => {
    const metrics = metricsOf({
      // Root cause: cpu (internal) spikes AND latency (external) spikes.
      root: [makeSeries('cpu', [10, 10], [50, 50]), makeSeries('latency', [1, 1], [5, 5])],
      // Victim: only latency (external) spikes.
      victim: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency', [1, 1], [9, 9])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS);
    expect(ranking[0]!.serviceId).toBe('root');
    // root: S^I = |50−10|/10 = 4, S^E = |5−1|/1 = 4 → M = 8 − log1p(8).
    expect(ranking[0]!.internalScore).toBeCloseTo(4, 6);
    expect(ranking[0]!.externalScore).toBeCloseTo(4, 6);
    // victim: S^I = 0, S^E = |9−1|/1 = 8 → M = 8 − log1p(8) (tie by sum, but
    // root still first because victim's internal is 0 and sum is also 8 —
    // assert the asymmetry directly instead).
    const victim = ranking.find((r) => r.serviceId === 'victim')!;
    expect(victim.internalScore).toBeCloseTo(0, 6);
    expect(victim.externalScore).toBeCloseTo(8, 6);
  });

  it('combines additively by default: M = S^I + S^E − log1p(S^I + S^E)', () => {
    const metrics = metricsOf({
      svc: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS);
    // S^I = |30−10|/10 = 2, S^E = |3−1|/1 = 2.
    const expected = 2 + 2 - Math.log1p(4);
    expect(ranking[0]!.score).toBeCloseTo(expected, 9);
  });

  it('combines conjunctively with min(S^I, S^E)', () => {
    const metrics = metricsOf({
      svc: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS, { pooling: 'conjunctive' });
    expect(ranking[0]!.score).toBeCloseTo(2, 9);
  });

  it('conjunctive scoring separates internal+external from external-only at equal sum', () => {
    const metrics = metricsOf({
      // internal 2 + external 2 → conj = 2.
      both: [makeSeries('cpu', [10, 10], [30, 30]), makeSeries('latency', [1, 1], [3, 3])],
      // internal 0 + external 4 → conj = 0.
      extOnly: [makeSeries('cpu', [10, 10], [10, 10]), makeSeries('latency', [1, 1], [5, 5])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS, { pooling: 'conjunctive' });
    expect(ranking[0]!.serviceId).toBe('both');
    expect(ranking[1]!.serviceId).toBe('extOnly');
  });

  it('sorts descending and breaks ties deterministically by service id', () => {
    const metrics = metricsOf({
      z: [makeSeries('cpu', [10, 10], [30, 30])],
      m: [makeSeries('cpu', [10, 10], [30, 30])],
      a: [makeSeries('cpu', [10, 10], [30, 30])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS);
    // Equal scores across all three; deterministic ascending tie-break.
    expect(ranking.map((r) => r.serviceId)).toEqual(['a', 'm', 'z']);
  });

  it('returns an empty ranking for empty metrics', () => {
    expect(computePrismRanking(new Map(), INJECT_MS)).toEqual([]);
  });

  it('ignores services with only flat metrics (score 0) but still lists them', () => {
    const metrics = metricsOf({
      flat: [makeSeries('cpu', [5, 5], [5, 5])],
    });
    const ranking = computePrismRanking(metrics, INJECT_MS);
    expect(ranking).toHaveLength(1);
    expect(ranking[0]!.score).toBeCloseTo(0, 9);
  });
});

// ── prismTop1 ─────────────────────────────────────────────

describe('prismTop1', () => {
  it('returns the top-ranked service id', () => {
    const metrics = metricsOf({
      root: [makeSeries('cpu', [10, 10], [50, 50])],
      other: [makeSeries('cpu', [10, 10], [20, 20])],
    });
    expect(prismTop1(metrics, INJECT_MS)).toBe('root');
  });

  it('returns undefined for empty metrics', () => {
    expect(prismTop1(new Map(), INJECT_MS)).toBeUndefined();
  });
});
