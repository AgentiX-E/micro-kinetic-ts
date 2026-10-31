/**
 * The window's own census — what the anchored arm did to every series, per case.
 *
 * §187.7 recorded the defect and §188.5 ruled out the cheap fix. The anchored arm can decline a series
 * silently in five different ways, and until this file existed no artifact said how often: a cell that did not
 * move was indistinguishable from a cell where every series was refused, which is the entire question on
 * RE2:SockShop. Re-deriving the guard from `metrics.json` answered a different question, because the loader
 * aligns and reshapes the series before the engine sees them.
 *
 * **This module does not re-derive anything.** It calls {@link probePreInjectionWindow} — the same function
 * the engine calls to place the window, with the same guard record, on the same `TimeSeries` the engine
 * receives — and counts its answers. A second copy of `drift <= tolerance` here would be a boundary that moves
 * without the engine's moving, which is the defect `docs/term-gap.md` was written about.
 *
 * The three decision columns exist because one dispatch should price every value of the axis, not just the one
 * it ran: the drift is a property of the series, so `stationary` and `non-rising` are two readings of the same
 * number, and a run under `pre-injection` therefore carries the population the guarded values would act on.
 *
 * @module benchmarks/anchor-census
 */

import {
  judgePreWindowDrift,
  PRE_WINDOW_GUARDS,
  probePreInjectionWindow,
  type AnchorRefusal,
  type BaselineAnchor,
  type PreWindowGuard,
} from '../../packages/tree/src/causal/topology-fault-graph.js';

/** The readings the census prices on every series: no guard, and the two guard KINDS. */
export type AnchorReading = 'unguarded' | 'stationary' | 'non-rising';

/** How many series each reading would anchor, and how many it would refuse. */
export interface AnchorDecisionCounts {
  /** Series whose window the reading places. */
  readonly anchored: number;
  /** Series the reading sends back to the shipped window, for any reason. */
  readonly refused: number;
}

/**
 * What happened to one series under the configured anchor.
 *
 * `no-window-by-config` is a THIRD kind of absence and it is not a refusal: `whole-file` places no window by
 * definition, so a shipped run's census must not report its series as `drift`-refused — that would attribute a
 * guard's decision to a configuration that never asked the question, and shipped runs are most of the artifacts.
 */
export type AnchorOutcome = AnchorRefusal | 'placed' | 'no-window-by-config';

/** The truth's own series, one entry per metric, so a moved case can be read rather than guessed at. */
export interface AnchorTruthEntry {
  /** The metric's label, as the corpus names it. */
  readonly label: string;
  /** Whether the configured anchor placed a window for this series. */
  readonly anchored: boolean;
  /** Which reading of the drift placed it, which mechanism refused it, or that the configuration asks nothing. */
  readonly outcome: AnchorOutcome;
  /**
   * The signed drift, or `null` when the segment is too short to halve.
   *
   * `null` rather than `undefined` because this record is WRITTEN AS JSON, and `JSON.stringify` DROPS an
   * undefined property: an artifact would then lose the key for exactly the series whose drift could not be
   * read, and a reader would see a well-formed file with a field silently missing. That is the same failure the
   * latency census' fence names, caught here by the first analysis that read the field back.
   */
  readonly drift: number | null;
}

/** One case's census. */
export interface AnchorCensus {
  /** The anchor the run was configured with, which selects the column a reader compares against. */
  readonly anchor: BaselineAnchor;
  /** Every (service, metric) series in the case, which is the population all the counts share. */
  readonly series: number;
  /** How many series carry a positive baseline over a pre-segment, i.e. could be anchored at all. */
  readonly measurable: number;
  /** Anchored and refused under each reading. */
  readonly decisions: Readonly<Record<AnchorReading, AnchorDecisionCounts>>;
  /**
   * Why a window could not be placed AT ALL, one key per mechanism, zeros included.
   *
   * **Guard-independent, and that is why it is not called "refusals under the configured anchor":** these four
   * mechanisms belong to the SERIES — no `t₀`, no sample reaching it, a narrow side, a baseline that is not a
   * denominator — and the two guard kinds answer a different question about the series that survived them. A
   * census that merged the two could not say whether a cell is a corpus of short series or a corpus of ramps.
   *
   * Zeros included because a missing key and a measured zero are different statements, and the census exists
   * to tell them apart.
   */
  readonly unplaceable: Readonly<Record<AnchorRefusal, number>>;
  /**
   * The drift population of the measurable series, defined by the two PREDICATES rather than by a threshold
   * copied here: `level` is what `stationary` admits, `rising` is what only `non-rising` admits, and `settling`
   * is what both refuse.
   */
  readonly drift: {
    /** Series whose drift could be computed at all (the pre-segment can be halved). */
    readonly judged: number;
    /** Series whose pre-segment was still climbing by more than the tolerance. */
    readonly rising: number;
    /** Series whose pre-segment had settled by more than the tolerance, i.e. opened high and fell. */
    readonly settling: number;
    /** Series whose pre-segment is a level within the tolerance. */
    readonly level: number;
    /** The largest `|drift|` seen, which is 0 when nothing is judgeable. */
    readonly maxAbs: number;
  };
  /** The truth's own series: the population a moved case has to be explained by. */
  readonly truth: readonly AnchorTruthEntry[];
}

/** Every refusal mechanism, in the order a probe checks them. */
export const ANCHOR_REFUSALS: readonly AnchorRefusal[] = [
  'no-injection-time',
  'no-boundary',
  'narrow-segment',
  'non-positive-baseline',
  'undecidable-drift',
  'drift',
];

/** The guard each reading applies — the same record the engine indexes, so the two cannot disagree. */
const READING_GUARDS: Readonly<Record<AnchorReading, PreWindowGuard | undefined>> = {
  unguarded: PRE_WINDOW_GUARDS['pre-injection'],
  stationary: PRE_WINDOW_GUARDS['pre-injection-stationary'],
  'non-rising': PRE_WINDOW_GUARDS['pre-injection-non-rising'],
};

/** Which reading each anchor value applies: `whole-file` applies none, because it places no window. */
const READING_OF: Readonly<Record<BaselineAnchor, AnchorReading>> = {
  'whole-file': 'unguarded',
  'pre-injection': 'unguarded',
  'pre-injection-stationary': 'stationary',
  'pre-injection-non-rising': 'non-rising',
};

/** The minimum shape this module needs from a case: the series the engine receives and where the truth is. */
export interface AnchorCensusInput {
  /** Metric series keyed by service id, exactly as the loader assembled them. */
  readonly metrics: ReadonlyMap<
    string,
    readonly {
      readonly label: string;
      readonly values: Float64Array;
      readonly timestamps: readonly number[];
    }[]
  >;
  /** Fault injection time in Unix ms (`<= 0` = unknown). */
  readonly injectTime: number;
  /** Ground-truth root-cause service id. */
  readonly truth: string;
}

/**
 * Count what the anchored arm would do to one case.
 *
 * Every `(service, metric)` pair is one series and is counted exactly once, which is the invariant the tests
 * fence: the counts are a partition of `series` under each reading, so `anchored + refused === series` and no
 * series can be counted twice by appearing in two services' maps.
 *
 * @param input - The case's series, injection time, and the truth's service id.
 * @param anchor - The anchor the run was configured with; `whole-file` places nothing by definition.
 * @returns The case's census, with every counter present even when it is zero.
 */
export function deriveAnchorCensus(input: AnchorCensusInput, anchor: BaselineAnchor): AnchorCensus {
  const unplaceable: Record<AnchorRefusal, number> = {
    'no-injection-time': 0,
    'no-boundary': 0,
    'narrow-segment': 0,
    'non-positive-baseline': 0,
    'undecidable-drift': 0,
    drift: 0,
  };
  const decisions: Record<AnchorReading, { anchored: number; refused: number }> = {
    unguarded: { anchored: 0, refused: 0 },
    stationary: { anchored: 0, refused: 0 },
    'non-rising': { anchored: 0, refused: 0 },
  };
  let seriesCount = 0;
  let measurable = 0;
  let judged = 0;
  let rising = 0;
  let settling = 0;
  let level = 0;
  let maxAbs = 0;
  const truth: AnchorTruthEntry[] = [];

  for (const [serviceId, metrics] of input.metrics) {
    for (const metric of metrics) {
      seriesCount++;
      // ONE probe of the unguarded window answers both questions this module has: whether a window exists at
      // all (a placement failure is guard-independent and belongs to the series) and what the drift reads.
      const base = probePreInjectionWindow(metric.values, metric.timestamps, input.injectTime);
      const drift = base.placed ? base.drift : undefined;

      // Every reading on this series, derived from the ONE number by the SAME predicate the engine uses — and
      // conjoined with `base.placed`, which is not redundant: `judgePreWindowDrift(undefined, undefined)` is
      // `true` because "no guard admits everything" is a statement about the GUARD, not about the window, so a
      // series with no boundary at all would otherwise be counted as anchored by the unguarded reading.
      const anchoredUnder: Record<AnchorReading, boolean> = {
        unguarded: base.placed && judgePreWindowDrift(drift, READING_GUARDS.unguarded),
        stationary: base.placed && judgePreWindowDrift(drift, READING_GUARDS.stationary),
        'non-rising': base.placed && judgePreWindowDrift(drift, READING_GUARDS['non-rising']),
      };
      for (const reading of Object.keys(anchoredUnder) as AnchorReading[]) {
        if (anchoredUnder[reading]) decisions[reading].anchored++;
        else decisions[reading].refused++;
      }

      // The configured column: `whole-file` places nothing, and a placement failure is reported with its own
      // reason rather than folded into `drift` — that separation is the whole point of the six-key record.
      const placed = anchor !== 'whole-file' && anchoredUnder[READING_OF[anchor]];
      const reason: AnchorRefusal = base.placed
        ? drift === undefined
          ? 'undecidable-drift'
          : 'drift'
        : base.reason;
      if (base.placed) measurable++;
      else unplaceable[reason]++;

      if (drift !== undefined) {
        judged++;
        // The three buckets are the two PREDICATES read against each other rather than a re-spelled threshold:
        // a series is `level` when `stationary` admits it, `rising` when `stationary` refuses but `non-rising`
        // admits, and `settling` when both refuse. A local `drift > tolerance` here would be the second
        // boundary the module docblock forbids — and it would be the one that silently disagrees the day the
        // engine's guard changes.
        if (anchoredUnder.stationary) level++;
        else if (anchoredUnder['non-rising']) rising++;
        else settling++;
        const abs = Math.abs(drift);
        if (abs > maxAbs) maxAbs = abs;
      }

      if (serviceId === input.truth) {
        truth.push({
          label: metric.label,
          anchored: placed,
          outcome: anchor === 'whole-file' ? 'no-window-by-config' : placed ? 'placed' : reason,
          // `?? null` at the point of writing, because this record is serialised: `undefined` would be dropped
          // and the field would be missing for exactly the series whose drift could not be read.
          drift: drift ?? null,
        });
      }
    }
  }

  return {
    anchor,
    series: seriesCount,
    measurable,
    decisions,
    unplaceable,
    drift: { judged, rising, settling, level, maxAbs },
    truth,
  };
}
