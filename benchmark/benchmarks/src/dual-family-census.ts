/**
 * The dual-family census: how much of a fleet the ranking's `dualFamily` term actually covers.
 *
 * ## Why this exists
 *
 * `dualFamilyWeight` (iteration 144) is a 0/1 membership paid at a fixed weight, so it can only re-order a
 * cell in which the family is a STRICT SUBSET of the candidates. The enrolment's own numbers say the family is
 * selective on one cell and not on another — RE3-SockShop 15 → 18 on 14 candidates, RE3-TrainTicket unchanged
 * on 68, FSE'26 byte-identical at every weight — and **none of the artifacts printed the quantity that explains
 * the difference**. A reader could see which cells moved and not how crowded the family was where they did not.
 *
 * This module prints it. It reads the term's own `contribution` out of the ranking the correctness checks are
 * already counted from — one array, two readings, the rule the `GT rank=` instrument set — so the census cannot
 * disagree with the score about who was paid: a second walk over the metrics would be a second implementation of
 * the membership.
 *
 * ## What it distinguishes
 *
 * - **family** — the mean number of members and candidates per case, and their share. A share near 1 means the
 *   bonus is near-uniform and cannot re-order anything, which is the mechanism, not a guess about it.
 * - **truth** — how often the ground truth was itself a member. A gate can only help where the truth is in the
 *   family, so this count is what separates "the population is too wide" from "the truth is not in it".
 * - **absent** — the truth is not a candidate at all, i.e. a RETRIEVAL failure. Counted apart, never averaged in:
 *   the instrument of iteration 143 established that six of a hundred sampled misses are of this kind and that no
 *   reweighting addresses them.
 * - **unmeasured** — the term was `WEIGHT_ZERO` on the case, so the family was never built. Reported as
 *   UNMEASURED rather than as an empty family, because "nothing passed the shape test" and "the shape test did
 *   not run" are the same number and different findings.
 *
 * @module benchmarks/dual-family-census
 */

import type { RootCauseResult } from '../../packages/core/src/types/faults.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** The running totals for one cell. */
export interface DualFamilyCensus {
  /** Records handed over, i.e. cases the runner analysed. */
  cases: number;
  /** Cases in which the truth was a candidate at all. */
  scored: number;
  /** Cases in which the truth was NOT a candidate — retrieval failures, counted apart. */
  absent: number;
  /** Sum of family sizes over the measured cases. */
  members: number;
  /** Sum of ranking sizes over the measured cases. */
  candidates: number;
  /** Cases in which the truth's own term was paid. */
  truthInFamily: number;
  /** Cases where the term was not built, so the family could not be read. */
  unmeasured: number;
}

/** The term's name in the breakdown, as the formula spells it. */
const TERM = 'dualFamily';

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateDualFamilyCensus}.
 */
export function createDualFamilyCensus(): DualFamilyCensus {
  return {
    cases: 0,
    scored: 0,
    absent: 0,
    members: 0,
    candidates: 0,
    truthInFamily: 0,
    unmeasured: 0,
  };
}

/**
 * Read one case's family off its ranking and add it to the totals.
 *
 * Mutates `census` rather than returning a new object: the sink the runner hands over is called once per
 * case, and a fold that copied the totals per case would allocate 735 objects to produce one line.
 *
 * @param census - The totals to add to.
 * @param record - The case, the graph, and the ranking the runner scored.
 */
export function accumulateDualFamilyCensus(
  census: DualFamilyCensus,
  record: DiagnosedCaseRecord,
): void {
  census.cases++;
  let paid = 0;
  let weightZero = false;
  let termsSeen = false;
  for (const result of record.ranking) {
    const term = termOf(result);
    if (term === undefined) continue;
    termsSeen = true;
    // `!== 0` rather than a truthiness test, the rule `buildTerm` itself follows: a `-0` contribution is a
    // zero and must not be counted as a member, and a `NaN` must not be able to hide as one either.
    if (term.contribution !== 0) paid++;
    else if (term.cause === 'WEIGHT_ZERO') weightZero = true;
  }

  // No paid term anywhere, and the reason is the weight: the family was never built. A case whose terms are
  // missing entirely is unmeasured for the same reason — nothing was reported, so nothing can be read.
  if (paid === 0 && (weightZero || !termsSeen)) {
    census.unmeasured++;
    return;
  }

  census.members += paid;
  census.candidates += record.ranking.length;

  const truthIds = record.case.groundTruth.serviceIds ?? [record.case.groundTruth.serviceId];
  const isScored = record.ranking.some((r) => truthIds.includes(r.serviceId));
  if (!isScored) {
    census.absent++;
    return;
  }
  census.scored++;
  if (record.ranking.some((r) => truthIds.includes(r.serviceId) && isPaid(r))) {
    census.truthInFamily++;
  }
}

/**
 * Render the census as one line, or nothing when there is nothing to report.
 *
 * The means are printed as `mean/mean` rather than as a bare share, because the share alone cannot distinguish
 * "2 of 3" from "45 of 68" and the two call for different work: the first is a small fleet where a gate has few
 * members to choose between, the second is a large one where the same gate is decisive.
 *
 * @param census - The totals to render.
 * @returns The line, indented like the cell's other census lines; `undefined` when no case was handed over.
 */
export function formatDualFamilyCensusLine(census: DualFamilyCensus): string | undefined {
  if (census.cases === 0) return undefined;
  const measured = census.cases - census.unmeasured;
  if (measured === 0) {
    return `  [dual-family] unmeasured: the term is WEIGHT_ZERO on all ${census.cases} cases`;
  }
  const family = `${(census.members / measured).toFixed(1)}/${(census.candidates / measured).toFixed(1)}`;
  // `Math.max(1, ·)` rather than a ternary: a MEASURED case carries at least one candidate by construction —
  // a paid term is a candidate's term — so the floor is unreachable and exists only to keep `0/0` out of the
  // string. A branch that no input can reach is a branch no test can cover, and one that would read as a
  // measured zero if it ever did fire.
  const density = ((100 * census.members) / Math.max(1, census.candidates)).toFixed(1);
  const truth =
    census.scored === 0
      ? 'none scored'
      : `${census.truthInFamily}/${census.scored} (${((100 * census.truthInFamily) / census.scored).toFixed(1)}%)`;
  const absent = census.absent === 0 ? '' : ` absent=${census.absent}`;
  const skipped = census.unmeasured === 0 ? '' : ` unmeasured=${census.unmeasured}`;
  return `  [dual-family] family=${family} (${density}%) truth=${truth}${absent}${skipped}`;
}

/**
 * The term's entry in one candidate's breakdown, if it carries one.
 *
 * @param result - One ranked candidate.
 * @returns The term, or `undefined` for a producer that does not compute this sum.
 */
function termOf(
  result: RootCauseResult,
): { readonly contribution: number; readonly cause?: string } | undefined {
  return result.terms?.find((t) => t.name === TERM);
}

/**
 * Whether a candidate's dual-family term was actually paid.
 *
 * @param result - One ranked candidate.
 * @returns True when the term exists and its contribution is non-zero.
 */
function isPaid(result: RootCauseResult): boolean {
  const term = termOf(result);
  return term !== undefined && term.contribution !== 0;
}
