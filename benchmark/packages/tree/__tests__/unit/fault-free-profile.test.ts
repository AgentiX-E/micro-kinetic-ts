/**
 * Unit tests for the fault-free frequency profile — the EOB channel.
 *
 * The profile answers one question the engine could not previously ask: *how often does this channel
 * look anomalous when nothing is wrong?* It is estimated ACROSS cases, because a case carries only the
 * samples around its own injection, while the same (service, channel) pair re-appears in every other
 * case's pre-segment — which is, by construction, fault-free.
 *
 * Two properties are the reason this is a separate module rather than another term computed from one
 * case's samples:
 *
 * 1. **The rate is counted, not fitted.** Lee et al. (arXiv 2611.02416) define the EOB as the fraction
 *    of fault-free windows whose anomaly score exceeds a threshold, and they are explicit that counting
 *    without assuming a distribution is what puts KPIs of different σ and logs on one scale.
 * 2. **A case cannot profile itself.** The profile needs at least `minWindows` windows before it
 *    publishes a rate, so a corpus of one case yields nothing rather than a leak.
 *
 * @module pruning/fault-free-profile.test
 */

import type { ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  buildFaultFreeProfile,
  computeFaultFreeScores,
  DEFAULT_FAULT_FREE_MIN_SAMPLES,
  DEFAULT_FAULT_FREE_MIN_WINDOWS,
  DEFAULT_FAULT_FREE_SIGMA,
  FAULT_FREE_SELECTIONS,
  isFaultFreeSelection,
  type FaultFreeChannel,
  type FaultFreeObservation,
  type FaultFreeProfile,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

const INJECT_MS = 1_000;

/** One channel whose pre-segment is `pre` and whose post-segment is `post`. */
function seriesOf(label: string, pre: readonly number[], post: readonly number[] = []): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  pre.forEach((v, i) => {
    timestamps.push(i);
    values.push(v);
  });
  post.forEach((v, i) => {
    timestamps.push(INJECT_MS + i);
    values.push(v);
  });
  return { label, timestamps, values: new Float64Array(values), unit: 'u' };
}

/** One observation: a service's channels and the instant the fault was injected. */
function observationOf(
  channels: Record<string, readonly number[]>,
  injectTimeMs: number = INJECT_MS,
  post: Record<string, readonly number[]> = {},
): FaultFreeObservation {
  const metrics = new Map<string, readonly TimeSeries[]>();
  const list: TimeSeries[] = [];
  for (const [label, pre] of Object.entries(channels)) {
    list.push(seriesOf(label, pre, post[label] ?? [0]));
  }
  metrics.set('svc', list);
  return { metrics, injectTimeMs };
}

/** `n` copies of `value` — a channel that holds a level exactly. */
function flat(value: number, n = 5): number[] {
  return Array.from({ length: n }, () => value);
}

/** The rate the profile publishes for `(service, label)`, or `undefined` when it published none. */
function rateOf(
  profile: FaultFreeProfile,
  service: string,
  label: string,
): { rate: number; windows: number; centre: number; scale: number } | undefined {
  const channel = profile.get(service as ServiceId)?.get(label);
  return channel === undefined
    ? undefined
    : {
        rate: channel.rate,
        windows: channel.windows,
        centre: channel.centre,
        scale: channel.scale,
      };
}

// ── The defaults ──────────────────────────────────────────

describe('the fault-free profile defaults', () => {
  it('thresholds a window at three robust standard deviations', () => {
    expect(DEFAULT_FAULT_FREE_SIGMA).toBe(3);
  });

  it('refuses a window narrower than five samples', () => {
    expect(DEFAULT_FAULT_FREE_MIN_SAMPLES).toBe(5);
  });

  it('refuses to publish a rate counted over fewer than three windows', () => {
    expect(DEFAULT_FAULT_FREE_MIN_WINDOWS).toBe(3);
  });
});

describe('the aggregation vocabulary', () => {
  it('names the two readings, in the order the docblock argues them', () => {
    expect([...FAULT_FREE_SELECTIONS]).toEqual(['rarest', 'dominant']);
  });

  it('accepts each member and refuses anything else', () => {
    for (const member of FAULT_FREE_SELECTIONS) expect(isFaultFreeSelection(member)).toBe(true);
    expect(isFaultFreeSelection('')).toBe(false);
    expect(isFaultFreeSelection('Rarest')).toBe(false);
    expect(isFaultFreeSelection('dominant ')).toBe(false);
  });
});

// ── buildFaultFreeProfile ─────────────────────────────────

describe('buildFaultFreeProfile', () => {
  it('publishes nothing from a single window, because a case cannot profile itself', () => {
    const profile = buildFaultFreeProfile([observationOf({ cpu: flat(10) })]);
    expect(rateOf(profile, 'svc', 'cpu')).toBeUndefined();
  });

  it('counts a window as flagged when its extreme leaves the sigma band', () => {
    // Three windows of a channel that holds 10. The third departs by 100 robust σ.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: [10, 10, 11, 9, 10] }),
      observationOf({ cpu: [10, 10, 11, 9, 10] }),
      observationOf({ cpu: [110, 110, 111, 109, 110] }),
    ]);
    const channel = rateOf(profile, 'svc', 'cpu');
    expect(channel?.windows).toBe(3);
    expect(channel?.rate).toBeCloseTo(1 / 3, 12);
  });

  it('counts a window with no departure as clean', () => {
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: [10, 10, 11, 9, 10] }),
      observationOf({ cpu: [10, 11, 10, 10, 9] }),
      observationOf({ cpu: [10, 10, 10, 10, 11] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')?.rate).toBe(0);
  });

  it('reads the level from the per-window medians, not from the pooled samples', () => {
    // The pooled median of these eleven values is 1; the median of the three window medians is 100.
    // A profile that pooled would place the band at 1 and flag eight of nine samples.
    const profile = buildFaultFreeProfile(
      [
        observationOf({ cpu: [1, 1, 1, 1, 1, 1, 1, 1, 9] }),
        observationOf({ cpu: [100] }),
        observationOf({ cpu: [100] }),
      ],
      { minSamples: 1 },
    );
    expect(rateOf(profile, 'svc', 'cpu')?.centre).toBe(100);
  });

  it('reads the scale between the windows when each window holds a level', () => {
    // Three windows that each sit perfectly still, at 1, 10 and 100. Every within-window σ is zero, so the
    // band has to come from the disagreement BETWEEN them — median |median − centre| = 9 — and the window
    // at 100 is then ten bands away.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: flat(1) }),
      observationOf({ cpu: flat(10) }),
      observationOf({ cpu: flat(100) }),
    ]);
    const channel = rateOf(profile, 'svc', 'cpu');
    expect(channel?.windows).toBe(3);
    expect(channel?.centre).toBe(10);
    expect(channel?.scale).toBe(9);
    expect(channel?.rate).toBeCloseTo(1 / 3, 12);
  });

  it('publishes a channel that never moved as perfectly clean', () => {
    // Every window holds the same level exactly. There is no σ to build a band from, and none is needed:
    // no window left the level, so the strict `departure > σ · scale` comparison flags none of them. A
    // channel that has never once moved is the cleanest evidence there is, not an unmeasurable one.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: flat(7) }),
      observationOf({ cpu: flat(7) }),
      observationOf({ cpu: flat(7) }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')?.rate).toBe(0);
    expect(rateOf(profile, 'svc', 'cpu')?.windows).toBe(3);
  });

  it('ignores a window with fewer samples than the floor', () => {
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: [10, 10] }),
      observationOf({ cpu: [10, 10] }),
      observationOf({ cpu: [10, 10] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')).toBeUndefined();
  });

  it('ignores an observation whose injection time is unknown', () => {
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: flat(10) }, 0),
      observationOf({ cpu: flat(10) }, 0),
      observationOf({ cpu: flat(10) }, 0),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')).toBeUndefined();
  });

  it('counts only the samples before the injection', () => {
    // The post-segment is violent in every window, and none of it may reach the rate.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: flat(10) }, INJECT_MS, { cpu: [1e6, 1e6] }),
      observationOf({ cpu: flat(10) }, INJECT_MS, { cpu: [1e6, 1e6] }),
      observationOf({ cpu: flat(10) }, INJECT_MS, { cpu: [1e6, 1e6] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')?.rate).toBe(0);
  });

  it('keeps the last sample before the injection and drops the first at it', () => {
    // The sample stamped exactly at t₀ belongs to the fault; if it were counted, its 10⁶ would flag.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: [10, 10, 10, 10, 10] }, INJECT_MS, { cpu: [1e6] }),
      observationOf({ cpu: [10, 10, 10, 10, 10] }, INJECT_MS, { cpu: [1e6] }),
      observationOf({ cpu: [10, 10, 10, 10, 10] }, INJECT_MS, { cpu: [1e6] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')?.rate).toBe(0);
  });

  it('refuses a window that carries a non-finite sample', () => {
    // A window with a NaN in it is not a level; reading its median would silently drop the sample and
    // report a band the corpus never held.
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: [10, Number.NaN, 10, 10, 10] }),
      observationOf({ cpu: [10, 10, 10, 10, 10] }),
      observationOf({ cpu: [10, 10, 10, 10, 10] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')).toBeUndefined();
  });

  it('refuses an observation whose first sample is already at the injection', () => {
    // A pre-segment of zero samples is not a window, and the floor must say so.
    const profile = buildFaultFreeProfile([
      { metrics: new Map([['svc', [seriesOf('cpu', [], [1, 2, 3])]]]), injectTimeMs: 0 },
      { metrics: new Map([['svc', [seriesOf('cpu', [], [1, 2, 3])]]]), injectTimeMs: 0 },
      { metrics: new Map([['svc', [seriesOf('cpu', [], [1, 2, 3])]]]), injectTimeMs: 0 },
    ]);
    expect(rateOf(profile, 'svc', 'cpu')).toBeUndefined();
  });

  it('publishes each service separately', () => {
    const profile = buildFaultFreeProfile([
      {
        metrics: new Map([
          ['a', [seriesOf('cpu', [10, 10, 10, 10, 10], [0])]],
          ['b', [seriesOf('cpu', [200, 200, 200, 200, 200], [0])]],
        ]),
        injectTimeMs: INJECT_MS,
      },
      {
        metrics: new Map([
          ['a', [seriesOf('cpu', [10, 10, 10, 10, 10], [0])]],
          ['b', [seriesOf('cpu', [200, 200, 200, 200, 200], [0])]],
        ]),
        injectTimeMs: INJECT_MS,
      },
      {
        metrics: new Map([
          ['a', [seriesOf('cpu', [10, 10, 10, 10, 10], [0])]],
          // `b` departs in this window only.
          ['b', [seriesOf('cpu', [900, 900, 900, 900, 900], [0])]],
        ]),
        injectTimeMs: INJECT_MS,
      },
    ]);
    expect(rateOf(profile, 'a', 'cpu')?.windows).toBe(3);
    // `a` never departs; the band for `b` is wide because its own windows disagree by 700.
    expect(rateOf(profile, 'a', 'cpu')?.rate).toBe(0);
  });

  it('does not let one channel departure flag another channel', () => {
    const profile = buildFaultFreeProfile([
      observationOf({ cpu: flat(10), mem: flat(10) }),
      observationOf({ cpu: flat(10), mem: flat(10) }),
      observationOf({ cpu: flat(10), mem: [900, 900, 900, 900, 900] }),
    ]);
    expect(rateOf(profile, 'svc', 'cpu')?.rate).toBe(0);
  });

  it('is invariant to the order the observations arrive in', () => {
    const windows = [flat(10), flat(10), flat(11), [50, 50, 50, 50, 50]];
    const forward = buildFaultFreeProfile(windows.map((w) => observationOf({ cpu: w })));
    const reverse = buildFaultFreeProfile(
      [...windows].reverse().map((w) => observationOf({ cpu: w })),
    );
    expect(rateOf(forward, 'svc', 'cpu')).toEqual(rateOf(reverse, 'svc', 'cpu'));
  });

  it('is empty for a corpus that carries no metrics', () => {
    const profile = buildFaultFreeProfile([{ metrics: new Map(), injectTimeMs: INJECT_MS }]);
    expect(profile.size).toBe(0);
  });

  it('counts a channel that appears in only some of the cases over those cases', () => {
    const sparse: FaultFreeObservation[] = [
      observationOf({ cpu: flat(10), mem: flat(10) }),
      observationOf({ cpu: flat(10), mem: flat(10) }),
      observationOf({ cpu: flat(10) }),
    ];
    const profile = buildFaultFreeProfile(sparse);
    expect(rateOf(profile, 'svc', 'cpu')?.windows).toBe(3);
    // Two windows is below the floor, so the rate is not published at all.
    expect(rateOf(profile, 'svc', 'mem')).toBeUndefined();
  });
});

// ── computeFaultFreeScores ────────────────────────────────

describe('computeFaultFreeScores', () => {
  /** A profile that publishes `rate` for each named channel of one service. */
  function profileOf(rates: Record<string, number>): FaultFreeProfile {
    const channels = new Map<string, FaultFreeChannel>();
    for (const [label, rate] of Object.entries(rates)) {
      channels.set(label, { label, centre: 1, scale: 1, rate, windows: 5 });
    }
    return new Map([['svc', channels]]);
  }

  function metricsOf(
    channels: Record<string, readonly number[]>,
  ): Map<string, readonly TimeSeries[]> {
    const metrics = new Map<string, readonly TimeSeries[]>();
    metrics.set(
      'svc',
      Object.entries(channels).map(([label, pre]) => seriesOf(label, pre)),
    );
    return metrics;
  }

  it('scores a node as the complement of its rate', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 0.25 }),
    );
    expect(scores.get('svc')).toBeCloseTo(0.75, 12);
  });

  it('scores a channel that never fires in the fault-free period at one', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 0 }),
    );
    expect(scores.get('svc')).toBe(1);
  });

  it('scores a channel that always fires in the fault-free period at zero', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 1 }),
    );
    expect(scores.get('svc')).toBe(0);
  });

  it('reads the dominant channel when the selection asks for it', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10), mem: flat(10) }),
      new Map([['svc', { label: 'mem' }]]),
      profileOf({ cpu: 0.9, mem: 0.1 }),
      'dominant',
    );
    expect(scores.get('svc')).toBeCloseTo(0.9, 12);
  });

  it('reads the rarest channel by default', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10), mem: flat(10) }),
      new Map([['svc', { label: 'mem' }]]),
      profileOf({ cpu: 0.9, mem: 0.1 }),
    );
    expect(scores.get('svc')).toBeCloseTo(0.9, 12);
  });

  it('is empty when the profile is absent', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      undefined,
    );
    expect(scores.size).toBe(0);
  });

  it('is absent for a node the profile does not carry', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      new Map([['other', profileOf({ cpu: 0.5 }).get('svc')!]]),
    );
    expect(scores.has('svc')).toBe(false);
  });

  it('is absent when the dominant label carries no profile', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'mem' }]]),
      profileOf({ cpu: 0.5 }),
      'dominant',
    );
    expect(scores.has('svc')).toBe(false);
  });

  it('is absent when no dominant metric was measured', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      undefined,
      profileOf({ cpu: 0.5 }),
      'dominant',
    );
    expect(scores.has('svc')).toBe(false);
  });

  it('ignores a profiled channel the node does not carry', () => {
    // The rarest reading is over the channels BOTH the profile and the case can speak about; a channel
    // the case never emitted is not evidence about this node.
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 0.4, mem: 0.0 }),
    );
    expect(scores.get('svc')).toBeCloseTo(0.6, 12);
  });

  it('is absent when every channel a node carries sits outside the profile', () => {
    const scores = computeFaultFreeScores(
      metricsOf({ disk: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 0.4 }),
    );
    expect(scores.has('svc')).toBe(false);
  });

  it('refuses a rate outside the unit interval rather than scoring past the corners', () => {
    // A hand-built profile can hold anything; a score that left [0, 1] would outvote every measured term.
    const scores = computeFaultFreeScores(
      metricsOf({ cpu: flat(10) }),
      new Map([['svc', { label: 'cpu' }]]),
      profileOf({ cpu: 1.5 }),
    );
    expect(scores.has('svc')).toBe(false);
  });

  it('scores every node of a multi-service case', () => {
    const metrics = new Map<string, readonly TimeSeries[]>([
      ['a', [seriesOf('cpu', flat(10))]],
      ['b', [seriesOf('cpu', flat(10))]],
    ]);
    const profile: FaultFreeProfile = new Map([
      ['a', new Map([['cpu', { label: 'cpu', centre: 1, scale: 1, rate: 0, windows: 5 }]])],
      ['b', new Map([['cpu', { label: 'cpu', centre: 1, scale: 1, rate: 0.5, windows: 5 }]])],
    ]);
    const scores = computeFaultFreeScores(
      metrics,
      new Map([
        ['a', { label: 'cpu' }],
        ['b', { label: 'cpu' }],
      ]),
      profile,
    );
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeCloseTo(0.5, 12);
  });
});
