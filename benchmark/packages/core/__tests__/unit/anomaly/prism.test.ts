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
  deviationZScore,
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
