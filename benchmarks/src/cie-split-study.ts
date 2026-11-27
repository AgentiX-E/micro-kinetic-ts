/**
 * CIE's internal/external axiom, priced with the channels it actually names.
 *
 * ## Why this module exists: a contaminated probe
 *
 * §1.28.4 of `SOTA_LANDSCAPE_VERIFICATION.md` reported that 103 of 204 engine misses had the "CIE propagated-victim
 * shape": the published winner's external excursion was at least the truth's while its "internal surprise" was
 * lower. That reading called the containment row's `surprises` map the internal axis. It is not. `channelSurprise`
 * takes the max log(1/q) over EVERY published channel that left its band, and latency — CIE's external channel —
 * is among them. The same latency excursion that made the winner win externally also inflated its "internal"
 * number, so the two axes of that probe were not independent. The 103 was an upper bound on a shape that was
 * measured with one channel on both sides.
 *
 * CIE (arXiv:2601.21359v2) makes a different statement. A ROOT deviates in its own internal properties (CPU,
 * memory, disk, sockets — things its neighbours cannot observe) AND in the external ones they observe; a
 * propagated VICTIM deviates externally only. The classifier that already ships in this engine
 * (`classifyMetricChannel`) draws exactly that line. This module re-reads the artifact through it, so the internal
 * axis contains ONLY cpu/mem/disk/socket channels and the external axis contains latency/error/throughput. The
 * two axes are then disjoint by construction, which is the precondition CIE's theorem needs and the §1.28.4 probe
 * lacked.
 *
 * ## Why this is read-only, and what it can and cannot decide
 *
 * This is a measurement of the PROBE, not an engine arm. It does not re-rank anything and spends no tokens. The
 * thing it can decide is narrow and important: whether the lopsidedness that motivated pre-registering item 5
 * survives correcting the channel that contaminated it. Both the genuine split and the contaminated one are
 * counted over the SAME misses, so the difference between them is the contamination and nothing else. A global
 * conjunction over these axes was already refused under four specifications (`closed-axes-register.md` §338);
 * this reading says whether the per-pair signal that survived that refusal was itself an artifact.
 *
 * ## What a channel contributes
 *
 * A channel is measured in band widths exactly as `latencyExcursions` measures latency: the post-injection median's
 * departure past the fault-free band, divided by the band's width. A family that carried no channel, or only
 * channels whose band was unusable, is ABSENT (`hasInternal`/`hasExternal` false) rather than zero — zero means
 * measured and inside the band, which is a different statement and is the distinction the classifier's own
 * `hasInternal` flag draws in `prism-signal.ts`.
 *
 * @module benchmarks/cie-split-study
 */

import { classifyMetricChannel } from '@agentix-e/micro-kinetic-core';

/** One candidate channel as the fingerprint artifact carries it. */
export interface FingerprintChannel {
  readonly label: string;
  readonly post: number;
  readonly band: readonly [number, number];
}

/** One candidate's excursions, split by CIE's channel families. */
export interface SplitExcursions {
  /** Worst internal-channel excursion in band widths; 0 when measured and in band, or when absent. */
  readonly internal: number;
  /** Worst external-channel excursion in band widths. */
  readonly external: number;
  /** Whether at least one usable internal channel was measured (an absent family is not a zero). */
  readonly hasInternal: boolean;
  /** Whether at least one usable external channel was measured. */
  readonly hasExternal: boolean;
}

/**
 * Split one candidate's channels into CIE's two families, each in band widths.
 *
 * The band is inclusive at both ends, so a post median sitting exactly on an edge has zero departure — the same
 * strict reading `channelSurprise` and `latencyExcursions` give the boundary. A band of non-positive width, a
 * non-finite endpoint, or a non-finite post is not a measurement and contributes nothing.
 *
 * @param channels - The candidate's fingerprint channels, exactly as the artifact wrote them.
 */
export function splitChannelExcursions(channels: readonly FingerprintChannel[]): SplitExcursions {
  let internal = 0;
  let external = 0;
  let hasInternal = false;
  let hasExternal = false;
  for (const channel of channels) {
    const [low, high] = channel.band;
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    const width = high - low;
    if (!(width > 0) || !Number.isFinite(channel.post)) continue;
    const post = channel.post;
    const departure = post < low ? low - post : post > high ? post - high : 0;
    const normalized = departure / width;
    if (classifyMetricChannel(channel.label) === 'internal') {
      hasInternal = true;
      if (normalized > internal) internal = normalized;
    } else {
      hasExternal = true;
      if (normalized > external) external = normalized;
    }
  }
  return { internal, external, hasInternal, hasExternal };
}

/** Whether the pair can be compared on a given axis at all. */
function measured(a: SplitExcursions, b: SplitExcursions): boolean {
  return a.hasInternal && a.hasExternal && b.hasInternal && b.hasExternal;
}

/** CIE's shape: the winner leads externally but trails internally, i.e. it propagated the fault. */
export type VictimShape = 'victim-shape' | 'no-shape' | 'unmeasured';

/** Which side carried more internal evidence. */
export type InternalDirection = 'truth-higher' | 'winner-higher' | 'tie' | 'unmeasured';

/**
 * Whether (winner, truth) is CIE's propagated-victim pair.
 *
 * Both axes must be measured on both sides: an absent internal family is not a zero, because a candidate with no
 * resource telemetry is exactly the one about which the axiom cannot speak.
 */
export function victimShapeOf(winner: SplitExcursions, truth: SplitExcursions): VictimShape {
  if (!measured(winner, truth)) return 'unmeasured';
  return winner.external >= truth.external && winner.internal < truth.internal
    ? 'victim-shape'
    : 'no-shape';
}

/** The direction of the internal comparison, on the genuine split only. */
export function internalDirectionOf(
  winner: SplitExcursions,
  truth: SplitExcursions,
): InternalDirection {
  if (!winner.hasInternal || !truth.hasInternal) return 'unmeasured';
  if (winner.internal > truth.internal) return 'winner-higher';
  if (winner.internal < truth.internal) return 'truth-higher';
  return 'tie';
}

/** The axis counts one measurement reports. */
export interface AxisCounts {
  readonly victimShape: number;
  readonly noShape: number;
  readonly unmeasured: number;
  readonly truthHigher: number;
  readonly winnerHigher: number;
  readonly tie: number;
}

/** One case as the study needs it: the published head, the accepted set, and the two measurements. */
export interface CieCaseInput {
  readonly datapack: string;
  readonly winner: string;
  readonly accepted: readonly string[];
  /** The row's latency excursion in band widths, keyed by service — used ONLY to reproduce the contaminated probe. */
  readonly external: Readonly<Record<string, number>>;
  /** The contaminated axis: the row's all-channel surprise in nats; absent when the dump had no map. */
  readonly surprise: Readonly<Record<string, number>> | undefined;
  /** Fingerprint channels per candidate, keyed by service. */
  readonly channels: Readonly<Record<string, readonly FingerprintChannel[]>>;
}

/** The whole reading over the corpus. */
export interface CieReading {
  readonly cases: number;
  readonly hits: number;
  readonly misses: number;
  /** Misses where at least one accepted answer and the winner had both families measurable. */
  readonly scored: number;
  /** The genuine disjoint-channel split. */
  readonly genuine: AxisCounts;
  /** The contaminated all-channel proxy, for the same misses. */
  readonly contaminated: AxisCounts;
  /** Scored misses where the two axes disagree on the shape. */
  readonly contamination: number;
}

/** A mutable count block; the reading freezes it into {@link AxisCounts} on the way out. */
type MutableCounts = { -readonly [K in keyof AxisCounts]: number };

/** A zeroed count block. */
function emptyCounts(): MutableCounts {
  return { victimShape: 0, noShape: 0, unmeasured: 0, truthHigher: 0, winnerHigher: 0, tie: 0 };
}

/**
 * A finite external excursion, or `undefined` when the dump could not measure it.
 *
 * `NaN` reaching a `>=` comparison would silently read as false and report a victim shape that was never observed;
 * refusing it here keeps a broken measurement out of the census.
 */
function externalOf(
  external: Readonly<Record<string, number>>,
  service: string,
): number | undefined {
  const value = external[service];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

/**
 * Price both axes over the corpus, on the same misses.
 *
 * For a case with several accepted answers, each is compared and the strongest evidence for the claim wins: a
 * case is a victim shape if ANY accepted answer makes it one, and a truth-higher direction if any does. That is an
 * upper bound, which is the right reading for a probe whose job is to decide whether the mechanism is worth an
 * engine arm — a lower bound here could hide the signal the question was asked to find.
 *
 * @param cases - One entry per containment row that could be joined to its fingerprint and verdict.
 */
export function readCieSplit(cases: readonly CieCaseInput[]): CieReading {
  const genuine = emptyCounts();
  const contaminated = emptyCounts();
  let hits = 0;
  let misses = 0;
  let scored = 0;
  let contamination = 0;

  for (const one of cases) {
    if (one.accepted.includes(one.winner)) {
      hits += 1;
      continue;
    }
    misses += 1;
    const winnerExternal = externalOf(one.external, one.winner);
    const winnerChannels = one.channels[one.winner];
    const winnerSurprise = one.surprise?.[one.winner];
    const winnerSplit =
      winnerChannels === undefined ? undefined : splitChannelExcursions(winnerChannels);

    let genuineBest: VictimShape = 'unmeasured';
    let contaminatedBest: VictimShape = 'unmeasured';
    let directionBest: InternalDirection = 'unmeasured';
    let contaminatedDirectionBest: InternalDirection = 'unmeasured';

    for (const truth of one.accepted) {
      const truthExternal = externalOf(one.external, truth);

      // The genuine axis needs BOTH channel families on both sides, and a fingerprint channel list for each.
      // A pair that fails that precondition is unmeasurable here, not a silent `no-shape`.
      const truthChannels = one.channels[truth];
      if (winnerSplit !== undefined && truthChannels !== undefined && truthExternal !== undefined) {
        const truthSplit = splitChannelExcursions(truthChannels);
        if (measured(winnerSplit, truthSplit)) {
          const shape = victimShapeOf(winnerSplit, truthSplit);
          if (shape === 'victim-shape') genuineBest = 'victim-shape';
          else if (shape === 'no-shape' && genuineBest === 'unmeasured') genuineBest = 'no-shape';
          const direction = internalDirectionOf(winnerSplit, truthSplit);
          if (direction === 'truth-higher') directionBest = 'truth-higher';
          else if (direction === 'winner-higher' && directionBest !== 'truth-higher')
            directionBest = 'winner-higher';
          else if (direction === 'tie' && directionBest === 'unmeasured') directionBest = 'tie';
        }
      }

      // The contaminated axis needs ONLY the two external excursions and the two all-channel surprises — the row
      // carries these for the whole pool, including truths the fingerprint never listed. That is exactly the
      // population §1.28.4 counted; coupling it to the fingerprint would under-report the very reading it corrects.
      const truthSurprise = one.surprise?.[truth];
      if (
        winnerExternal !== undefined &&
        truthExternal !== undefined &&
        winnerSurprise !== undefined &&
        truthSurprise !== undefined &&
        Number.isFinite(winnerSurprise) &&
        Number.isFinite(truthSurprise) &&
        contaminatedBest === 'unmeasured'
      ) {
        contaminatedBest =
          winnerExternal >= truthExternal && winnerSurprise < truthSurprise
            ? 'victim-shape'
            : 'no-shape';
        contaminatedDirectionBest =
          winnerSurprise > truthSurprise
            ? 'winner-higher'
            : winnerSurprise < truthSurprise
              ? 'truth-higher'
              : 'tie';
      }
    }

    if (genuineBest === 'unmeasured') {
      genuine.unmeasured += 1;
    } else {
      scored += 1;
      genuine[genuineBest === 'victim-shape' ? 'victimShape' : 'noShape'] += 1;
      genuine[
        directionBest === 'truth-higher'
          ? 'truthHigher'
          : directionBest === 'winner-higher'
            ? 'winnerHigher'
            : 'tie'
      ] += 1;
    }
    contaminated[
      contaminatedBest === 'victim-shape'
        ? 'victimShape'
        : contaminatedBest === 'no-shape'
          ? 'noShape'
          : 'unmeasured'
    ] += 1;
    if (contaminatedBest !== 'unmeasured')
      contaminated[
        contaminatedDirectionBest === 'truth-higher'
          ? 'truthHigher'
          : contaminatedDirectionBest === 'winner-higher'
            ? 'winnerHigher'
            : 'tie'
      ] += 1;
    // Contamination is a measured disagreement: the genuine axis called the shape and the contaminated one,
    // reading the shared channel, did not. A contaminated `unmeasured` is a missing map, not a disagreement.
    if (genuineBest === 'victim-shape' && contaminatedBest === 'no-shape') contamination += 1;
  }

  return { cases: cases.length, hits, misses, scored, genuine, contaminated, contamination };
}

/** The minimum number of genuine victim-shape misses before the signal is worth an engine arm. */
export const MIN_GENUINE_VICTIM_SHAPE = 15;

/** What the corrected probe concluded. */
export type CieSplitVerdict = 'signal' | 'no-signal' | 'unmeasured';

/**
 * Judge the corrected probe.
 *
 * `unmeasured` is for an artifact on which nothing could be scored — a smaller population that looks like a weak
 * signal is the same mistake the gate's other studies refuse. A signal needs BOTH a lopsided internal direction
 * (more truth-higher than winner-higher, CIE's own prediction) and at least MIN_GENUINE_VICTIM_SHAPE genuine
 * victim-shape misses. Meeting one without the other is no signal: the shape without the direction is noise, and
 * the direction without the shape is a different mechanism.
 */
export function cieSplitVerdict(
  reading: CieReading,
  floor = MIN_GENUINE_VICTIM_SHAPE,
): { verdict: CieSplitVerdict; reason: string } {
  if (reading.cases === 0) return { verdict: 'unmeasured', reason: 'the artifact carried no rows' };
  if (reading.scored === 0)
    return { verdict: 'unmeasured', reason: 'no miss had both channel families measurable' };
  const lopsided = reading.genuine.truthHigher > reading.genuine.winnerHigher;
  if (reading.genuine.victimShape < floor) {
    return {
      verdict: 'no-signal',
      reason: `${reading.genuine.victimShape} genuine victim-shape misses are below the ${floor} floor`,
    };
  }
  if (!lopsided) {
    return {
      verdict: 'no-signal',
      reason: `internal direction is not lopsided (${reading.genuine.truthHigher} truth-higher vs ${reading.genuine.winnerHigher} winner-higher)`,
    };
  }
  return {
    verdict: 'signal',
    reason: `${reading.genuine.victimShape} genuine victim-shape misses, ${reading.genuine.truthHigher}:${reading.genuine.winnerHigher} lopsided`,
  };
}
