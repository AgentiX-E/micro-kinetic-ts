/**
 * The fault-free surprise: the observation priced in the units the profile counts.
 *
 * The tests are written against the SPECIFICATION rather than the arithmetic of the implementation: a window
 * inside its band must read `0` and be present; a window outside must read the surprisal of its own channel's
 * smoothed rate; a candidate the profile cannot speak about must be ABSENT rather than zero; and the two
 * properties a consumer depends on — that the measure is per candidate, and that a rare channel's fire is worth
 * more than a common one's — are pinned as separate cases rather than as one aggregate.
 *
 * @module __tests__/unit/fault-free-surprise
 */

import type { MetricMap, TimeSeries } from '@agentix-e/micro-kinetic-core';
import type { FaultFreeProfile } from '@agentix-e/micro-kinetic-tree';
import { channelSurprise, smoothedFiringRate } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

/** Ten samples at one-minute spacing, so the injection at index 5 splits them into two equal halves. */
const INJECT = 5 * 60_000;

function series(label: string, values: readonly number[], stepMs = 60_000): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * stepMs),
    values: new Float64Array(values),
    unit: 'ms',
  };
}

interface Entry {
  readonly service: string;
  readonly label: string;
  readonly centre: number;
  readonly scale: number;
  readonly rate?: number;
  readonly windows?: number;
}

function profileOf(entries: readonly Entry[]): FaultFreeProfile {
  const byService = new Map<
    string,
    Map<string, { label: string; centre: number; scale: number; rate: number; windows: number }>
  >();
  for (const entry of entries) {
    const channels = byService.get(entry.service) ?? new Map();
    channels.set(entry.label, {
      label: entry.label,
      centre: entry.centre,
      scale: entry.scale,
      rate: entry.rate ?? 0,
      windows: entry.windows ?? 5,
    });
    byService.set(entry.service, channels);
  }
  return byService as unknown as FaultFreeProfile;
}

function metricsOf(
  entries: readonly (readonly [service: string, series: TimeSeries])[],
): MetricMap {
  const metrics = new Map<string, TimeSeries[]>();
  for (const [service, one] of entries) {
    const list = metrics.get(service) ?? [];
    list.push(one);
    metrics.set(service, list);
  }
  return metrics as unknown as MetricMap;
}

/** Five clean samples then five at `level`, which is the simplest shifted window there is. */
function flatThen(level: number, clean = 100): TimeSeries {
  return series('container.cpu.usage', [
    clean,
    clean,
    clean,
    clean,
    clean,
    level,
    level,
    level,
    level,
    level,
  ]);
}

function surpriseOf(
  metrics: MetricMap,
  profile: FaultFreeProfile | undefined,
  injectTimeMs = INJECT,
  sigma?: number,
): Map<string, number> {
  return channelSurprise({
    metrics,
    profile,
    injectTimeMs,
    ...(sigma === undefined ? {} : { sigma }),
  });
}

// ── smoothedFiringRate ────────────────────────────────────

describe('smoothedFiringRate', () => {
  it('recovers the count from the rate and smooths it with one pseudo-count each way', () => {
    // Two fires in five windows: (2 + 1) / (5 + 2).
    expect(smoothedFiringRate(0.4, 5)).toBeCloseTo(3 / 7, 12);
  });

  it('keeps a channel that never fired finite', () => {
    // The maximum-likelihood rate is 0, and `log(1/0)` would make the cleanest channel infinitely surprising.
    expect(smoothedFiringRate(0, 5)).toBeCloseTo(1 / 7, 12);
  });

  it('keeps a channel that always fired below one', () => {
    expect(smoothedFiringRate(1, 5)).toBeCloseTo(6 / 7, 12);
  });

  it('rounds a rate back to the integer count it was published as', () => {
    // 3/5 and 2/5 both survive the round trip, which is what makes the count recoverable from the artifact.
    expect(smoothedFiringRate(3 / 5, 5)).toBeCloseTo(4 / 7, 12);
    expect(smoothedFiringRate(2 / 5, 5)).toBeCloseTo(3 / 7, 12);
  });
});

// ── The three refusals ────────────────────────────────────

describe('channelSurprise refusals', () => {
  it('is empty without a profile', () => {
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), undefined).size).toBe(0);
  });

  it('is empty for an empty profile', () => {
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profileOf([])).size).toBe(0);
  });

  it('is empty when the anchor is unknown', () => {
    const profile = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1 },
    ]);
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profile, 0).size).toBe(0);
  });

  it('omits a service the profile has no entry for', () => {
    const profile = profileOf([
      { service: 'b', label: 'container.cpu.usage', centre: 100, scale: 1 },
    ]);
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profile).size).toBe(0);
  });

  it('omits a service whose channels are all unpublished', () => {
    const profile = profileOf([{ service: 'a', label: 'other.channel', centre: 100, scale: 1 }]);
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profile).size).toBe(0);
  });

  it('omits a channel with a degenerate band, because a band of zero width flags every window', () => {
    const profile = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 0 },
    ]);
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profile).size).toBe(0);
  });

  it('omits a channel with no published window', () => {
    const profile = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1, windows: 0 },
    ]);
    expect(surpriseOf(metricsOf([['a', flatThen(200)]]), profile).size).toBe(0);
  });

  it('omits a series that does not reach the injection', () => {
    const profile = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1 },
    ]);
    // Every sample is before the anchor, so the case cannot say what its own fault looked like.
    const metrics = metricsOf([['a', series('container.cpu.usage', [200, 200, 200, 200, 200])]]);
    expect(surpriseOf(metrics, profile).size).toBe(0);
  });

  it('omits a channel carrying a non-finite post-injection sample', () => {
    const profile = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1 },
    ]);
    const metrics = metricsOf([
      [
        'a',
        series('container.cpu.usage', [100, 100, 100, 100, 100, 200, Number.NaN, 200, 200, 200]),
      ],
    ]);
    expect(surpriseOf(metrics, profile).size).toBe(0);
  });
});

// ── The measurement ───────────────────────────────────────

describe('channelSurprise measurement', () => {
  const profile = profileOf([
    { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1, rate: 0, windows: 5 },
  ]);

  it('reads zero, and is present, for a window that stayed inside its band', () => {
    const surprises = surpriseOf(metricsOf([['a', flatThen(101)]]), profile);
    expect(surprises.get('a')).toBe(0);
  });

  it('treats a window exactly on the band edge as clean, because the profile counts strictly', () => {
    // Band at σ = 3 is [97, 103]; a window whose extreme is exactly 103 did not leave it.
    const surprises = surpriseOf(metricsOf([['a', flatThen(103)]]), profile);
    expect(surprises.get('a')).toBe(0);
  });

  it('prices a fire at the surprisal of its own smoothed rate', () => {
    // No fire in five fault-free windows: q = 1/7, so a fire is worth log 7 nats.
    const surprises = surpriseOf(metricsOf([['a', flatThen(200)]]), profile);
    expect(surprises.get('a')).toBeCloseTo(Math.log(7), 12);
  });

  it('prices the same excursion lower on a channel that does this anyway', () => {
    const common = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1, rate: 1, windows: 5 },
    ]);
    const surprises = surpriseOf(metricsOf([['a', flatThen(200)]]), common);
    expect(surprises.get('a')).toBeCloseTo(Math.log(7 / 6), 12);
    expect(surprises.get('a')!).toBeLessThan(Math.log(7));
  });

  it('reads the widest band width the caller asked for', () => {
    // At σ = 1 the band is [99, 101], so a window at 102 fires; at σ = 10 it does not.
    const narrow = surpriseOf(metricsOf([['a', flatThen(102)]]), profile, INJECT, 1);
    const wide = surpriseOf(metricsOf([['a', flatThen(102)]]), profile, INJECT, 10);
    expect(narrow.get('a')).toBeCloseTo(Math.log(7), 12);
    expect(wide.get('a')).toBe(0);
  });

  it('ignores the pre-injection half, which is the very window the profile was built from', () => {
    // A huge excursion BEFORE the anchor and a flat window after it: the fault is not this candidate's.
    const metrics = metricsOf([
      ['a', series('container.cpu.usage', [900, 900, 900, 900, 900, 100, 100, 100, 100, 100])],
    ]);
    expect(surpriseOf(metrics, profile).get('a')).toBe(0);
  });

  it('takes the strongest channel rather than their sum, so that a wide channel set is not a term', () => {
    const two = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1, rate: 0, windows: 5 },
      { service: 'a', label: 'container.memory.rss', centre: 100, scale: 1, rate: 0.4, windows: 5 },
    ]);
    const metrics = metricsOf([
      ['a', flatThen(200)],
      ['a', series('container.memory.rss', [100, 100, 100, 100, 100, 200, 200, 200, 200, 200])],
    ]);
    const surprises = surpriseOf(metrics, two);
    // The rarer channel's fire is worth log 7; the commoner one's log(7/3); the sum would be neither.
    expect(surprises.get('a')).toBeCloseTo(Math.log(7), 12);
  });

  it('measures each candidate on its own channels and its own rate, never on another candidate', () => {
    const two = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1, rate: 0, windows: 5 },
      { service: 'b', label: 'container.cpu.usage', centre: 100, scale: 1, rate: 1, windows: 5 },
    ]);
    const metrics = metricsOf([
      ['a', flatThen(200)],
      ['b', flatThen(200)],
    ]);
    const surprises = surpriseOf(metrics, two);
    expect(surprises.get('a')).toBeCloseTo(Math.log(7), 12);
    expect(surprises.get('b')).toBeCloseTo(Math.log(7 / 6), 12);
  });

  it('reports a candidate whose only available channel is clean as measured and zero', () => {
    // The distinction the containment pass depends on: measured-clean is a number, unmeasured is an absence.
    const two = profileOf([
      { service: 'a', label: 'container.cpu.usage', centre: 100, scale: 1 },
      { service: 'b', label: 'container.cpu.usage', centre: 100, scale: 1 },
    ]);
    const metrics = metricsOf([
      ['a', flatThen(200)],
      ['b', flatThen(100)],
    ]);
    const surprises = surpriseOf(metrics, two);
    expect(surprises.has('b')).toBe(true);
    expect(surprises.get('b')).toBe(0);
    expect(surprises.get('a')).toBeCloseTo(Math.log(7), 12);
  });
});
