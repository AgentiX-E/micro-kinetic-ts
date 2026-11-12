import { describe, expect, it } from 'vitest';

import type { MetricMap, RootCauseResult, TimeSeries } from '../../packages/core/src/index.js';
import type { FaultFreeProfile } from '../../packages/tree/src/index.js';

import {
  DEFAULT_FINGERPRINT_OPTIONS,
  buildCandidateFingerprints,
} from '../src/agentic-fingerprint.js';

const T0 = 1_000_000;

/** A channel whose pre-segment holds `pre` and whose post-segment holds `post`, one sample per second. */
function series(label: string, pre: readonly number[], post: readonly number[]): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  pre.forEach((value, index) => {
    timestamps.push(T0 - (pre.length - index) * 1000);
    values.push(value);
  });
  post.forEach((value, index) => {
    timestamps.push(T0 + (index + 1) * 1000);
    values.push(value);
  });
  return { label, timestamps, values: Float64Array.from(values), unit: 'count' };
}

/** A profile stating one channel at `centre` with `scale`, so the band is `centre ± 3·scale`. */
function profileOf(
  channels: Record<string, { centre: number; scale: number; rate: number }>,
): FaultFreeProfile {
  const inner = new Map<
    string,
    { label: string; centre: number; scale: number; rate: number; windows: number }
  >();
  for (const [label, spec] of Object.entries(channels)) {
    inner.set(label, {
      label,
      centre: spec.centre,
      scale: spec.scale,
      rate: spec.rate,
      windows: 5,
    });
  }
  return new Map([['svc', inner]]);
}

/** The fault type every synthetic result carries. Only its presence is asserted; the builder never reads it. */
const FAULT: RootCauseResult['faultType'] = { category: 'CPU', subType: 'cpu', severity: 'major' };

/** One ranked result, at 1-based rank `rank`. */
function result(service: string, rank: number, score: number): RootCauseResult {
  return {
    serviceId: service,
    faultType: FAULT,
    confidence: score,
    rank,
    finalScore: score,
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: false,
  };
}

/** A map of one service to its channels. */
function metricsOf(service: string, channels: readonly TimeSeries[]): MetricMap {
  return new Map([[service, channels]]);
}

describe('buildCandidateFingerprints', () => {
  it('summarises a channel with its own medians, the published band, and the published rate', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.1, 0.2, 0.3], [0.9, 1.0, 1.1])]),
      ranking: [result('svc', 1, 2)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });

    expect(built.candidates).toHaveLength(1);
    expect(built.candidates[0]).toMatchObject({ service: 'svc', rank: 0, score: 2 });
    // Medians, not means: the band's centre is a median of window medians, so the statistic compared against it
    // has to be one too.
    const channel = built.candidates[0]!.channels[0]!;
    expect(channel).toMatchObject({ label: 'cpu', pre: 0.2, post: 1.0, rate: 0 });
    // `0.2 - 3 × 0.05` in binary floating point is not `0.05`; the band is asserted to the tolerance the
    // arithmetic that produced it actually has.
    expect(channel.band[0]).toBeCloseTo(0.05, 12);
    expect(channel.band[1]).toBeCloseTo(0.35, 12);
  });

  it('dates the onset at the first post-injection sample outside the band', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.2, 0.2, 0.2], [0.2, 0.9, 0.9])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    // The first post sample sits inside the band; the second is the first that left it, at `t0 + 2 s`.
    expect(built.candidates[0]!.channels[0]!.onset).toBe(2000);
  });

  it('omits the onset entirely when the channel never left its band', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.2, 0.2, 0.2], [0.21, 0.2, 0.22])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    // Absent rather than zero: a zero onset asserts the channel left the band at the injection instant.
    expect(built.candidates[0]!.channels[0]).not.toHaveProperty('onset');
  });

  it('returns no fingerprint at all when the injection time is unknown', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.1, 0.2, 0.3], [0.9, 1.0, 1.1])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: 0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    expect(built.candidates).toEqual([]);
    // …and it says so by counting nothing rather than by reporting every channel as unmeasurable: the absence is
    // a property of the RUN, and the census is a property of the corpus.
    expect(built.census).toEqual({
      considered: 0,
      offered: 0,
      unmeasurable: 0,
      unprofiled: 0,
      shadowed: 0,
      capped: 0,
    });
  });

  it('counts a channel whose case cannot be split at the injection as unmeasurable', () => {
    // Two pre-injection samples: below the splitter's floor of three, so the case cannot say what "before" was.
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.1, 0.2], [0.9, 1.0, 1.1])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    expect(built.candidates[0]!.channels).toEqual([]);
    expect(built.census).toMatchObject({ considered: 1, offered: 0, unmeasurable: 1 });
  });

  it('counts a channel with a non-finite sample as unmeasurable rather than publishing a median of it', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [0.1, Number.NaN, 0.3], [0.9, 1.0, 1.1])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    expect(built.candidates[0]!.channels).toEqual([]);
    expect(built.census).toMatchObject({ unmeasurable: 1 });
  });

  it('counts a channel the profile cannot speak about as unprofiled', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('mem', [0.1, 0.2, 0.3], [0.9, 1.0, 1.1])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    // A channel with no band cannot support a verifiable claim, so offering it would produce refusals that read
    // as the model's fault.
    expect(built.candidates[0]!.channels).toEqual([]);
    expect(built.census).toMatchObject({ considered: 1, unprofiled: 1 });
  });

  it('counts a second series carrying a label already published as shadowed, keeping the first', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [
        series('cpu', [0.2, 0.2, 0.2], [0.9, 0.9, 0.9]),
        series('cpu', [0.2, 0.2, 0.2], [0.1, 0.1, 0.1]),
      ]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    expect(built.candidates[0]!.channels).toHaveLength(1);
    expect(built.candidates[0]!.channels[0]!.post).toBe(0.9);
    expect(built.census).toMatchObject({ considered: 2, offered: 1, shadowed: 1 });
  });

  it('orders channels by how far they left their band and caps at the documented width', () => {
    const channels = [
      series('a_near', [1, 1, 1], [1.2, 1.2, 1.2]),
      series('b_far', [1, 1, 1], [9, 9, 9]),
      series('c_mid', [1, 1, 1], [3, 3, 3]),
    ];
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', channels),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({
        a_near: { centre: 1, scale: 0.1, rate: 0 },
        b_far: { centre: 1, scale: 0.1, rate: 0 },
        c_mid: { centre: 1, scale: 0.1, rate: 0 },
      }),
      options: { maxChannels: 2 },
    });
    expect(built.candidates[0]!.channels.map((channel) => channel.label)).toEqual([
      'b_far',
      'c_mid',
    ]);
    expect(built.census).toMatchObject({ offered: 2, capped: 1 });
  });

  it('reads a channel that collapsed BELOW its band as a departure, not as no evidence', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [1, 1, 1], [0.1, 0.1, 0.1])]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.5, scale: 0.05, rate: 0 } }),
    });
    const channel = built.candidates[0]!.channels[0]!;
    expect(channel.post).toBeCloseTo(0.1, 12);
    // The band is [0.35, 0.65]; the onset is the first post sample, one second after `t0`.
    expect(channel.onset).toBe(1000);
  });

  it('breaks a departure tie by label, so the cap is not a property of the case directory', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [
        series('zeta', [1, 1, 1], [5, 5, 5]),
        series('alpha', [1, 1, 1], [5, 5, 5]),
      ]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({
        zeta: { centre: 1, scale: 0.1, rate: 0 },
        alpha: { centre: 1, scale: 0.1, rate: 0 },
      }),
      options: { maxChannels: 1 },
    });
    expect(built.candidates[0]!.channels.map((channel) => channel.label)).toEqual(['alpha']);
  });

  it('orders a tie by label whichever way the case listed the channels', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [
        series('b_channel', [1, 1, 1], [5, 5, 5]),
        series('c_channel', [1, 1, 1], [5, 5, 5]),
        series('a_channel', [1, 1, 1], [5, 5, 5]),
      ]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({
        a_channel: { centre: 1, scale: 0.1, rate: 0 },
        b_channel: { centre: 1, scale: 0.1, rate: 0 },
        c_channel: { centre: 1, scale: 0.1, rate: 0 },
      }),
    });
    expect(built.candidates[0]!.channels.map((channel) => channel.label)).toEqual([
      'a_channel',
      'b_channel',
      'c_channel',
    ]);
  });

  it('carries only the first `maxCandidates` of the posterior, keeping the engine order and 0-based ranks', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [1, 1, 1], [2, 2, 2])]),
      ranking: [result('svc', 1, 3), result('other', 2, 2), result('third', 3, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 1, scale: 0.1, rate: 0 } }),
      options: { maxCandidates: 2 },
    });
    expect(built.candidates.map((candidate) => [candidate.service, candidate.rank])).toEqual([
      ['svc', 0],
      ['other', 1],
    ]);
  });

  it('falls back to confidence when the producer did not populate a final score', () => {
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [series('cpu', [1, 1, 1], [2, 2, 2])]),
      ranking: [
        {
          serviceId: 'svc',
          faultType: FAULT,
          confidence: 0.4,
          rank: 1,
          evidenceMetrics: [],
          propagationDepth: 0,
          propagationErrorBound: 0,
          viaTreeSearch: false,
        },
      ],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 1, scale: 0.1, rate: 0 } }),
    });
    expect(built.candidates[0]!.score).toBe(0.4);
  });

  it('leaves the onset undated when the crossing sample carries no usable timestamp', () => {
    const raw = series('cpu', [0.2, 0.2, 0.2], [0.2, 0.9, 0.9]);
    // The crossing sample is the second post sample; giving it a non-finite timestamp makes it an instant that
    // cannot date anything, and the dump must not write `null` there.
    const timestamps = [...raw.timestamps];
    timestamps[4] = Number.NaN;
    const built = buildCandidateFingerprints({
      metrics: metricsOf('svc', [{ ...raw, timestamps }]),
      ranking: [result('svc', 1, 1)],
      injectTimeMs: T0,
      profile: profileOf({ cpu: { centre: 0.2, scale: 0.05, rate: 0 } }),
    });
    expect(built.candidates[0]!.channels[0]).not.toHaveProperty('onset');
  });

  it('publishes the documented defaults, the band width being the profile own constant', () => {
    expect(DEFAULT_FINGERPRINT_OPTIONS).toEqual({ maxCandidates: 5, maxChannels: 8, sigma: 3 });
  });
});
