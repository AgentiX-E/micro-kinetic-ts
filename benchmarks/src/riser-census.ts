/**
 * The trace-riser census: WHY the rule did not choose the truth, case by case.
 *
 * ## The question this instrument exists for
 *
 * The trace term pays a binary unit to the unique service that rose. On TrainTicket RE3 it votes on 20 of 30
 * cases and is right on 15; **all five wrong votes became the top-1**. Three earlier instruments narrowed this
 * down and then stopped:
 *
 * - `term-gap-census.ts` charges the term a full unit on 5 of the cell's 11 misses — and a removal arm prices the
 *   pin at +10 cases over the suite, so the term wins more than it loses;
 * - `[trace-vote]`'s rank histogram (`atMax=2/2, rank2-3=0/0, rank4-10=3/0, rank11+=15/13`) kills every
 *   rank-shaped explanation, including `traceSkipsLeader` (the mask's population is two votes and both are
 *   correct) and `traceTailOnly` (the non-tail votes are 2 of 2 right);
 * - what remains is a property of the CANDIDATE, not of its standing: a riser that is a SOURCE does more work per
 *   request, and a riser that is a VICTIM is re-routed traffic or a retry storm.
 *
 * So this census prints the evidence the rule had beside the rise and did not read, for the vote AND for the
 * truth, and then attributes every wrong vote to the guard that excluded the truth.
 *
 * ## The attribution, and the invariant in it
 *
 * The rule's candidate test is three conditions in a fixed order: `pre >= minPreCount`, then `post/pre >=
 * riseThreshold`, then uniqueness (and a case-level `logicExceptionServices` gate). A wrong vote means the truth
 * failed one of the first two — if the truth had passed both it would have been a candidate, so either it would
 * have been the vote (a hit) or there would have been two candidates and no vote at all.
 *
 * The census therefore walks the SAME two guards in the SAME order, and prints a bucket for each, plus
 * `truth-qualified`: wrong votes whose truth met both. That bucket **must be zero**, and printing it is how the
 * two implementations stay tied — a non-zero value would mean the rule and this census disagree about what the
 * rule accepts, which is a defect in one of them and not a finding about the corpus.
 *
 * The thresholds are imported rather than written into the labels, so a change to the rule's own default cannot
 * leave this artifact naming a number the rule no longer uses.
 *
 * @module benchmarks/riser-census
 */

import { DEFAULT_TRACE_ACTIVITY_OPTIONS } from '@agentix-e/micro-kinetic-tree';

import type {
  CasePrediction,
  RiserVector,
} from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** How one wrong vote's truth was excluded by the rule, in the rule's own order. */
export interface RiserCensus {
  /** Cases where the term cast a vote. */
  votes: number;
  /** Votes that named the ground truth. */
  hits: number;
  /** Wrong votes whose truth carries no span measurement at all — nothing can be said about why. */
  truthUnmeasured: number;
  /** Wrong votes whose truth failed the rule's `pre` guard. */
  truthBelowPre: number;
  /** Wrong votes whose truth passed `pre` and failed the `rise` guard, or whose rise is not measurable. */
  truthBelowRise: number;
  /** Wrong votes whose truth passed BOTH guards — the invariant, which must stay zero. */
  truthQualified: number;
}

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateRiser}.
 */
export function createRiserCensus(): RiserCensus {
  return {
    votes: 0,
    hits: 0,
    truthUnmeasured: 0,
    truthBelowPre: 0,
    truthBelowRise: 0,
    truthQualified: 0,
  };
}

/**
 * Fold one case's prediction into the census.
 *
 * @param census - The running totals, mutated in place.
 * @param prediction - The runner's record for one case. Cases without a vote are skipped: the term did not speak,
 *   and a silence is already counted by the trace-vote census rather than being re-counted here as an absence.
 */
export function accumulateRiser(census: RiserCensus, prediction: CasePrediction): void {
  const vote = prediction.traceVote;
  if (vote === undefined) return;
  census.votes += 1;
  if (vote === prediction.truth) {
    census.hits += 1;
    return;
  }
  const truth = prediction.traceRiser?.truth;
  if (truth === undefined) {
    census.truthUnmeasured += 1;
    return;
  }
  // The rule's own order, reproduced: the pre guard is tested first, so a truth with no baseline at all is
  // attributed to the guard that actually rejected it rather than to a ratio it never had.
  if (truth.pre < DEFAULT_TRACE_ACTIVITY_OPTIONS.minPreCount) {
    census.truthBelowPre += 1;
    return;
  }
  const growth = truth.growth;
  if (growth === undefined || growth < DEFAULT_TRACE_ACTIVITY_OPTIONS.riseThreshold) {
    census.truthBelowRise += 1;
    return;
  }
  census.truthQualified += 1;
}

/**
 * Render a signed failure count, or `-`.
 *
 * The sign is explicit so `+0` cannot be read as an absence. The producer clamps the net at zero, so a negative
 * value cannot arise from a case — the arm is kept because this function is total over the record it is handed,
 * and a malformed record should print its sign rather than lose it.
 */
function signed(value: number | undefined): string {
  if (value === undefined) return '-';
  return value < 0 ? String(value) : `+${String(value)}`;
}

/** Render a ratio to two places, or `-` when it does not exist. */
function ratio(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(2);
}

/**
 * One vote as a line, with the truth beside it when the vote was wrong.
 *
 * The truth's own vector is omitted on a hit **because it is the vote's vector**: printing the same numbers twice
 * would suggest two measurements were taken, and the two sides are only a comparison when they differ.
 *
 * @param prediction - The runner's record for one case.
 * @returns The line, or `undefined` when the case carried no vote.
 */
export function formatRiserCaseLine(prediction: CasePrediction): string | undefined {
  const vote = prediction.traceVote;
  if (vote === undefined) return undefined;
  const verdict = vote === prediction.truth ? 'HIT' : 'MISS';
  const voted = prediction.traceRiser?.vote;
  const parts = [
    `[trace-riser] ${prediction.caseId} ${verdict} vote=${vote}`,
    voted === undefined
      ? 'pre=- growth=- failedIn=- failedOut=-'
      : `pre=${voted.pre} growth=${ratio(voted.growth)} ` +
        `failedIn=${signed(voted.failedIn)} failedOut=${signed(voted.failedOut)}`,
  ];
  const truth = prediction.traceRiser?.truth;
  if (truth !== undefined && vote !== prediction.truth) {
    parts.push(
      `|| truth=${truth.service} pre=${truth.pre} growth=${ratio(truth.growth)} ` +
        `failedIn=${signed(truth.failedIn)} failedOut=${signed(truth.failedOut)}`,
    );
  }
  return parts.join(' ');
}

/**
 * The whole cell as one line, or `undefined` when the term never voted.
 *
 * @param census - The running totals.
 */
export function formatRiserCensusLine(census: RiserCensus): string | undefined {
  if (census.votes === 0) return undefined;
  // Four exclusive buckets that must SUM to the wrong votes, and the last of them is the invariant: a truth that
  // passed both guards would have been a candidate, so a non-zero `qualified` means this census and the rule
  // disagree rather than that the corpus is strange.
  return (
    `[trace-riser] total votes=${census.votes} hits=${census.hits} ` +
    `wrong=${census.votes - census.hits} | truth-unmeasured=${census.truthUnmeasured} ` +
    `truth-pre<${DEFAULT_TRACE_ACTIVITY_OPTIONS.minPreCount}=${census.truthBelowPre} ` +
    `truth-rise<${DEFAULT_TRACE_ACTIVITY_OPTIONS.riseThreshold}=${census.truthBelowRise} ` +
    `truth-qualified=${census.truthQualified}`
  );
}

/** Re-exported so a reader of the artifact can name the vector's fields without importing the runner. */
export type { RiserVector };
