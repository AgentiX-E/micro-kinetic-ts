/**
 * The trace-share census: the vote's rise measured against the FLEET's own move, and the floors that would gate it.
 *
 * ## The question this instrument exists for
 *
 * The trace term pays a binary unit to the unique service whose span count rose (`pre >= 500`, `post/pre >= 1.15`).
 * Five refinements have been refused by measurement, and every refusal was a statement about the SHAPE of the
 * evidence: a weight, a leader mask, a tail-only restriction, a materiality floor, and a Poisson-significance
 * axis. The riser census then printed what the rule had beside the rise and did not read, and the reading is
 * sharper than any of those five:
 *
 * ```
 * 15 hits   vote=ts-auth-service  growth 1.17-2.22   fleet drift 0.05-0.11
 *  5 misses vote=ts-station-service / ts-order-other-service  growth 1.16-1.47   fleet drift 0.79-0.99
 * ```
 *
 * The absolute rise is the SAME in both populations — 1.16 against 1.17 — and the difference is what the rest of
 * the system was doing. On the fifteen hits the fleet lost ~92% of its spans and the candidate kept its count; on
 * the five misses the fleet was stable and the candidate rose a fifth. Those are not two readings of one quantity,
 * so no threshold on the rise can separate them, which is why five thresholds failed.
 *
 * ## The axis
 *
 * `share = growth / drift`, where `drift` is the fleet's common-mode move — the unweighted median of the
 * per-service `post / pre` ratios (`traceSignificanceOf`). Under the kinetic reading the drift is the change every
 * service would show if none of them changed its work per request, so the quotient is the change in the
 * candidate's SHARE of the system's work. A service that rises exactly with its fleet scores 1.0 whatever the
 * fleet did; a service that holds its count while the fleet collapses scores `1 / drift`, which is where the
 * fifteen hits live (10.7-36.3).
 *
 * ## Why the floors are swept rather than chosen
 *
 * A single floor would be a number picked out of a range, which is the defect the weight search was corrected for.
 * Four are simulated instead, and the decision is read off the pair `withdrawn` against `surrendered`: a floor that
 * withdraws votes and gives up none of them is free, and the widest gap between the highest non-source share
 * (4.3 on this corpus) and the lowest source share (10.7) is where a floor should sit. This census produces that
 * arithmetic, and the four floors came back byte-identical — `withdrawn=5 surrendered=0` on TrainTicket and
 * `withdrawn=1 surrendered=0` on OnlineBoutique at 2, 3, 5 and 8 alike — which is what made the floor shippable:
 * the choice inside the interval is not a fit, because there is no interval left to fit.
 *
 * ## What it does not claim
 *
 * `withdrawn` is an UPPER bound on what a floor can win. Withdrawing the unit does not make a case correct — it
 * hands the case back to the rest of the ranking, which may or may not name the truth. The bound is the honest
 * statement available from the record, and it was resolved from the LOSS CENSUS rather than from a second
 * instrument: of the six withdrawn votes, the truth stood at rank 2 of 68 on two TrainTicket cases, so withdrawing
 * the unit promotes it — and stayed at rank 6, 13 and 20 on the other three and at rank 2 of 9 on the
 * OnlineBoutique case, where the fleet is un-normalised at nine nodes and a unit does not move the order. Two to
 * three cases, then, and the arm that flips the mode is what measures which.
 *
 * @module benchmarks/trace-share-census
 */

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/**
 * The floors simulated, in ascending order.
 *
 * The corpus's own gap is 4.3 (the largest non-source share measured over the two RE3 cells' top-ranked services)
 * to 10.7 (the smallest source share), so this sweep brackets the empty interval from below, from inside, and from
 * above: `2` is below every miss and above nothing, `5` sits inside the gap, `8` sits inside it too, and `3` is a
 * step between. Four points, one interval — a reader can see whether a choice inside it is stable or lucky.
 *
 * `2` is now the SHIPPED floor (`DEFAULT_TRACE_ACTIVITY_OPTIONS.minFleetShare`) and the sweep is kept: the
 * instrument's value is that it can still report what a floor this corpus has never been asked about would do, and
 * a census that hard-coded its own shipped value could not say whether that value was load-bearing.
 */
export const TRACE_SHARE_FLOORS: readonly number[] = [2, 3, 5, 8];

/** One floor's tally, over the same votes as every other floor. */
export interface SharePolicyTally {
  /** Votes the floor KEEPS. */
  votes: number;
  /** Kept votes that named the ground truth. */
  hits: number;
  /** Votes the floor withholds. */
  withdrawn: number;
  /** Withheld votes that WOULD have named the ground truth — the cost side of the same decision. */
  surrendered: number;
}

/** The whole cell's share evidence, at every simulated floor. */
export interface TraceShareCensus {
  /** Votes whose share could be computed. */
  measured: number;
  /** Votes whose share could not be computed, because either side of the quotient was absent. */
  unmeasured: number;
  /** One tally per entry of {@link TRACE_SHARE_FLOORS}, in the same order. */
  readonly policies: readonly SharePolicyTally[];
}

/**
 * Compute the share axis for one vote.
 *
 * @param input - The vote's rise and the fleet's drift.
 * @returns `growth / drift`, or `undefined` when the drift is not a positive number: a fleet that emitted nothing
 *   after the injection is not a yardstick, and a negative drift is not a ratio any count can have.
 */
export function shareOf(input: { growth: number; drift: number }): number | undefined {
  if (!(input.drift > 0)) return undefined;
  return input.growth / input.drift;
}

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals with one independent tally per floor.
 */
export function createTraceShareCensus(): TraceShareCensus {
  return {
    measured: 0,
    unmeasured: 0,
    policies: TRACE_SHARE_FLOORS.map(() => ({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 })),
  };
}

/**
 * Fold one case's vote into the census.
 *
 * @param census - The running totals, mutated in place.
 * @param prediction - The runner's record for one case. A case the term did not vote on is skipped entirely: the
 *   census is about the DECISION, and a silence has no share.
 */
export function accumulateTraceShare(census: TraceShareCensus, prediction: CasePrediction): void {
  const vote = prediction.traceVote;
  if (vote === undefined) return;

  const growth = prediction.traceRiser?.vote?.growth;
  const drift = prediction.traceSignificance?.drift;
  const share =
    growth === undefined || drift === undefined ? undefined : shareOf({ growth, drift });
  if (share === undefined) {
    // Not a zero: a vote with no fleet measurement says nothing about its share, and a floor that read it as zero
    // would withdraw every vote on a cell whose traces it could not measure.
    census.unmeasured += 1;
    return;
  }

  census.measured += 1;
  const hit = vote === prediction.truth;
  for (let i = 0; i < TRACE_SHARE_FLOORS.length; i += 1) {
    const tally = census.policies[i]!;
    if (share >= TRACE_SHARE_FLOORS[i]!) {
      tally.votes += 1;
      if (hit) tally.hits += 1;
    } else {
      tally.withdrawn += 1;
      if (hit) tally.surrendered += 1;
    }
  }
}

/**
 * The whole cell as one line, or `undefined` when the term never voted.
 *
 * @param census - The running totals.
 */
export function formatTraceShareCensusLine(census: TraceShareCensus): string | undefined {
  const seen = census.measured + census.unmeasured;
  if (seen === 0) return undefined;
  const floors = TRACE_SHARE_FLOORS.map((floor, i) => {
    const tally = census.policies[i]!;
    return (
      `f${String(floor)} votes=${tally.votes} hits=${tally.hits} ` +
      `withdrawn=${tally.withdrawn} surrendered=${tally.surrendered} ` +
      // `withdrawn - surrendered` is the number of WRONG votes the floor removes, i.e. the cases it could win.
      // Printed rather than left to the reader: it is the only quantity the decision is read on. It carries no
      // sign because it CANNOT be negative — every surrendered vote is by construction one of the withdrawn ones,
      // so the subtraction is over a subset. A sign arm here would be an arm no case can reach, and clamping
      // would hide the defect that produced it.
      `net=${String(tally.withdrawn - tally.surrendered)}`
    );
  });
  return (
    `[trace-share] measured=${census.measured} unmeasured=${census.unmeasured} | ` +
    floors.join(' | ')
  );
}
