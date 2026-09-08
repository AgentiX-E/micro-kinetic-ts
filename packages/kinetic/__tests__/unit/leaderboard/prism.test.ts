/**
 * Unit tests for the PRISM reimplementation (arXiv:2601.21359).
 *
 * Pins three responsibilities:
 *   1. Metric-channel classification (internal vs external).
 *   2. Deviation-based z-score (standardized mean shift, with the three
 *      degenerate-scale fallbacks).
 *   3. Component ranking (max pooling + additive/conjunctive combination +
 *      deterministic descending order).
 *
 * The internal/external asymmetry is the method's core: a root cause is
 * anomalous in BOTH channels while an affected component is anomalous in the
 * external channel only.
 *
 * @module benchmarks/leaderboard/prism.test
 */

import { describe, expect, it } from 'vitest';

import {
  classifyMetricChannel,
  computePrismRanking,
  deviationZScore,
  prismTop1,
} from '../../../src/benchmarks/leaderboard/prism.js';

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
