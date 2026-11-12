/**
 * The bounded view of a ranking that an elimination step is allowed to read.
 *
 * ## What this module is, and the one thing it must not be
 *
 * The layer this file feeds (`docs/agentic-layer-plan.md`) may not see the corpus. It may not read a telemetry
 * table, a datapack, or a ground-truth label — it reads **one fingerprint per case**: at most five ranked
 * candidates, at most eight channels each, and five numbers per channel. That is ~1 600 tokens against the
 * 1 500 000 a top-band agent spends re-reading a dump, and it is the entire reason a three-round loop can be
 * contemplated on 1 422 cases at all.
 *
 * The bound is only worth anything if every number in it is **re-derivable**, so the builder's job is not
 * summarising — it is *attesting*. Each channel it emits carries
 *
 * - `pre` / `post`, the case's own medians either side of the injection;
 * - `band`, the fault-free interval the profile artifact published for that `(service, channel)`;
 * - `rate`, the fraction of fault-free windows in which that channel left its band anyway;
 * - `onset`, when this case's channel first left that band, in milliseconds after `t0`.
 *
 * and the claim verifier re-checks the first four against the same array before a ranking is allowed to move.
 * A summariser that rounded, smoothed or re-derived any of them would make the verification a check of the
 * summariser against itself.
 *
 * ## Why the medians, and why the engine's own split
 *
 * The band's centre is a **median** of per-window medians (`pruning/fault-free-profile.ts`). Comparing a mean
 * against it would compare two different location estimators and would let one post-injection spike carry a
 * channel out of a band that its typical value never left — which is precisely the mistake the expected-outlier
 * baseline exists to prevent. So `pre` and `post` are medians over the same split the engine uses
 * ({@link injectionSplitIndex}), read through the same median function ({@link medianOfRange}): one definition of
 * "before the fault", and one definition of "the middle of these samples".
 *
 * ## Why channels the profile cannot speak about are dropped and COUNTED
 *
 * A channel with no profile entry has no band, and a claim citing it cannot be verified — so it cannot be
 * offered. That is a refusal, and a refusal nobody counts reads as a clean bill: a corpus where 90 % of channels
 * are unprofiled would produce fingerprints that look sparse for no stated reason. The census returned beside the
 * candidates is the count of every channel that was seen and why it is absent, so the layer's coverage is a
 * published quantity rather than an inference from an empty list.
 *
 * Zero IO, no clock, no randomness: a pure function of `(metrics, ranking, t0, profile, options)`.
 *
 * @module benchmarks/agentic-fingerprint
 */

import type { MetricMap, RootCauseResult } from '../../packages/core/src/index.js';

import type {
  CandidateFingerprint,
  ChannelFingerprint,
} from '../../packages/ai/src/agent/index.js';
import {
  DEFAULT_FAULT_FREE_SIGMA,
  injectionSplitIndex,
  medianOfRange,
  type FaultFreeProfile,
} from '../../packages/tree/src/index.js';

/**
 * How much of a ranking one fingerprint may carry.
 *
 * Five candidates because five is the deepest `At-K` this suite reports and the deepest posterior any published
 * arm has re-ordered; eight channels because a candidate's decisive evidence is concentrated — the FSE'26
 * diagnostic dumps carry a median of four metric families per service — and a tenth channel is a token the
 * model reads instead of one of the first nine.
 */
export const DEFAULT_FINGERPRINT_OPTIONS = {
  maxCandidates: 5,
  maxChannels: 8,
  sigma: DEFAULT_FAULT_FREE_SIGMA,
} as const;

/** How the fingerprint is sized and how wide the band it reads is. */
export interface FingerprintOptions {
  /** Ranked candidates to carry. Default {@link DEFAULT_FINGERPRINT_OPTIONS.maxCandidates}. */
  readonly maxCandidates?: number;
  /** Channels per candidate to carry, the most decisive first. Default `8`. */
  readonly maxChannels?: number;
  /**
   * Band half-width in robust standard deviations, matching the profile's own `sigma`.
   *
   * A fingerprint built at a different `sigma` than the profile was built at would attribute to the model a
   * disagreement about band width, so the default is the profile's own constant rather than a literal.
   */
  readonly sigma?: number;
}

/**
 * What the builder looked at, and why each channel it did not offer is absent.
 *
 * Five exclusive counters over one population (`considered`), so a reader can tell a sparse fingerprint caused
 * by an unprofiled corpus from one caused by a cap:
 *
 * - `unmeasurable` — the case's own samples cannot be split at `t0` (no boundary, or fewer than three samples
 *   on a side), or a value is not finite;
 * - `unprofiled` — the profile has no entry for this `(service, channel)`, so there is no band;
 * - `shadowed` — a second series carried a label this candidate already published; the first one wins because a
 *   name with two owners is a name whose claim cannot be checked against "the" value;
 * - `capped` — measured and profiled, but past `maxChannels`;
 * - `offered` — in the fingerprint.
 */
export interface FingerprintCensus {
  readonly considered: number;
  readonly offered: number;
  readonly unmeasurable: number;
  readonly unprofiled: number;
  readonly shadowed: number;
  readonly capped: number;
}

/** The fingerprint of one case, with the census that says what it left out. */
export interface FingerprintBuild {
  readonly candidates: readonly CandidateFingerprint[];
  readonly census: FingerprintCensus;
}

/** What the builder reads. */
export interface FingerprintInput {
  /** The case's channels, exactly as the engine was given them. */
  readonly metrics: MetricMap;
  /** The engine's posterior, best first. `rank` and `score` are copied from it, never recomputed. */
  readonly ranking: readonly RootCauseResult[];
  /** Fault injection time in Unix ms. `<= 0` means unknown, and an unknown boundary yields no fingerprint. */
  readonly injectTimeMs: number;
  /**
   * The corpus profile the band comes from.
   *
   * Required rather than optional: a fingerprint without bands is a fingerprint every claim would be refused
   * against, and the refusal would be attributed to the model. The shipped configuration has no profile and
   * runs no layer at all, so the absence is expressible by not calling this function.
   */
  readonly profile: FaultFreeProfile;
  readonly options?: FingerprintOptions;
}

/**
 * How far a value sits outside a band, zero when inside.
 *
 * Total over the values this module can produce: every sample is checked finite before a median is taken, and the
 * band's two bounds are finite because the profile's centre and scale are. The finiteness guard that used to
 * stand here could not fire, which this repository counts as dead rather than defensive.
 */
function departureFromBand(post: number, band: readonly [number, number]): number {
  if (post < band[0]) return band[0] - post;
  if (post > band[1]) return post - band[1];
  return 0;
}

/**
 * Summarise one channel of one candidate, or say why it cannot be summarised.
 *
 * @returns The channel fingerprint, or the census bucket it belongs in.
 */
function summariseChannel(
  label: string,
  values: Float64Array,
  timestamps: readonly number[],
  injectTimeMs: number,
  profile: FaultFreeProfile,
  service: string,
  sigma: number,
): { readonly channel: ChannelFingerprint } | { readonly drop: 'unmeasurable' | 'unprofiled' } {
  const sampleCount = Math.min(values.length, timestamps.length);
  const split = injectionSplitIndex(timestamps, sampleCount, injectTimeMs);
  if (split === undefined) return { drop: 'unmeasurable' };
  for (let i = 0; i < sampleCount; i++) {
    if (!Number.isFinite(values[i]!)) return { drop: 'unmeasurable' };
  }

  const published = profile.get(service)?.get(label);
  if (published === undefined) return { drop: 'unprofiled' };

  const pre = medianOfRange(values, 0, split);
  const post = medianOfRange(values, split, sampleCount);
  const halfWidth = sigma * published.scale;
  const band: readonly [number, number] = [
    published.centre - halfWidth,
    published.centre + halfWidth,
  ];

  // The first sample after `t0` that left the band, measured from `t0`. Absent rather than zero when the
  // channel never left it: a zero onset means "left it at the injection instant", which is a different and
  // much stronger statement than "never left it".
  let onset: number | undefined;
  for (let i = split; i < sampleCount; i++) {
    if (departureFromBand(values[i]!, band) > 0) {
      const elapsed = timestamps[i]! - injectTimeMs;
      // A non-finite timestamp is not an instant, so it cannot date an onset. Skipped rather than written,
      // because `JSON` renders `NaN` as `null` and a dump that silently carries `null` where a number belongs
      // is a dump whose reader has to guess.
      if (Number.isFinite(elapsed)) onset = elapsed;
      break;
    }
  }

  return {
    channel:
      onset === undefined
        ? { label, pre, post, band, rate: published.rate }
        : { label, pre, post, band, rate: published.rate, onset },
  };
}

/**
 * Build the fingerprint of one case from the posterior the engine already produced.
 *
 * Candidates keep the engine's order, and their `rank` and `score` are **copied** rather than recomputed: the
 * layer's claim is about the ranking that was published, and a fingerprint carrying a re-sorted list would let
 * an elimination be credited for a reordering the engine never made.
 *
 * Within a candidate the channels are ordered by how far `post` sits outside its band, largest first, ties broken
 * by label. The order is deterministic because it is what the `maxChannels` cap truncates — a cap applied to an
 * order the filesystem or a `Map`'s insertion produced would make the fingerprint a property of the case
 * directory rather than of the case.
 *
 * @param input - The case's channels, the engine's ranking, its injection time and the corpus profile.
 * @returns At most `maxCandidates` fingerprints and the census of what was left out.
 */
export function buildCandidateFingerprints(input: FingerprintInput): FingerprintBuild {
  const maxCandidates = input.options?.maxCandidates ?? DEFAULT_FINGERPRINT_OPTIONS.maxCandidates;
  const maxChannels = input.options?.maxChannels ?? DEFAULT_FINGERPRINT_OPTIONS.maxChannels;
  const sigma = input.options?.sigma ?? DEFAULT_FINGERPRINT_OPTIONS.sigma;

  let considered = 0;
  let offered = 0;
  let unmeasurable = 0;
  let unprofiled = 0;
  let shadowed = 0;
  let capped = 0;

  // An unknown boundary is not a boundary: every channel of every candidate would be `unmeasurable`, and
  // reporting a fingerprint of empty lists would attribute that to the corpus rather than to the run.
  if (!(input.injectTimeMs > 0)) {
    return {
      candidates: [],
      census: { considered, offered, unmeasurable, unprofiled, shadowed, capped },
    };
  }

  const candidates: CandidateFingerprint[] = [];
  const cappedAt = Math.max(0, Math.min(maxCandidates, input.ranking.length));
  for (let rank = 0; rank < cappedAt; rank++) {
    const result = input.ranking[rank]!;
    const measurements: Array<{
      readonly channel: ChannelFingerprint;
      readonly departure: number;
    }> = [];
    const labels = new Set<string>();

    for (const series of input.metrics.get(result.serviceId) ?? []) {
      considered += 1;
      if (labels.has(series.label)) {
        shadowed += 1;
        continue;
      }
      labels.add(series.label);
      const summarised = summariseChannel(
        series.label,
        series.values,
        series.timestamps,
        input.injectTimeMs,
        input.profile,
        result.serviceId,
        sigma,
      );
      if ('drop' in summarised) {
        if (summarised.drop === 'unmeasurable') unmeasurable += 1;
        else unprofiled += 1;
        continue;
      }
      measurements.push({
        channel: summarised.channel,
        departure: departureFromBand(summarised.channel.post, summarised.channel.band),
      });
    }

    // Every departure here is finite (see `departureFromBand`), so the comparison is a total order and the label
    // breaks the ties — the property that makes the `maxChannels` cap a property of the case rather than of the
    // order the channels happened to arrive in.
    measurements.sort((a, b) => {
      if (a.departure !== b.departure) return b.departure - a.departure;
      // Labels are unique within a candidate by construction — a repeat is refused above as `shadowed` — so
      // there is no equality arm to write.
      return a.channel.label < b.channel.label ? -1 : 1;
    });

    const kept = measurements.slice(0, maxChannels);
    capped += measurements.length - kept.length;
    offered += kept.length;

    candidates.push({
      service: result.serviceId,
      rank: result.rank - 1,
      score: result.finalScore ?? result.confidence,
      channels: kept.map((entry) => entry.channel),
    });
  }

  return {
    candidates,
    census: { considered, offered, unmeasurable, unprofiled, shadowed, capped },
  };
}
