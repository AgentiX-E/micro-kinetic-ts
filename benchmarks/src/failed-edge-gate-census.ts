/**
 * The failed-edge gate census: what the direction term's gate actually DECIDED, per cell.
 *
 * ## Why this exists
 *
 * The `direction-gate[...]` line reports, on the two cells whose traces carry a status column, that "the gate
 * CAN fire, so a change, or its absence, is attributable to the term" — 1080 latency rows on RE2-OnlineBoutique
 * and 6781 on RE2-TrainTicket. That is a true statement about the VIEW and it is not a statement about the gate:
 * `failedEdge` reads `WEIGHT_ZERO` on **734 of 735** golden cases, so the gate fired **once**, on a case whose
 * `failedEdgeScores` map was empty (`INPUT_MAP_EMPTY`). A reader meeting an unmoved cell was told the mechanism
 * had been tested when the mechanism had been refused on every case but one.
 *
 * That is this repository's oldest defect family — prose asserting a property of code the code does not have —
 * in the one form a paragraph cannot fix, because the missing quantity is not a sentence but a count. This module
 * prints the count.
 *
 * ## Why `WEIGHT_ZERO` is the label a REFUSAL wears
 *
 * The pruner computes a baseline ranking with the term's weight forced to 0 (`performTreeRCA` is called with
 * `{ ...options, failedEdgeWeight: 0 }`) because the gate's subject is the service the ungated engine answers
 * with; a refused case returns that baseline unchanged. So `WEIGHT_ZERO` on a refused case means "the answer is
 * the weight-0 pass", not "the configuration set the weight to zero" — **two different facts wearing one label**,
 * and the one the term-gap table prints is the first. This census separates them by construction: it counts the
 * predicate's decisions, not the label they leave behind.
 *
 * ## What it distinguishes
 *
 * - **champion** — the case's own largest measured inbound rise (`maxInboundRise`), the quantity the fleet bar is
 *   a share of. Its absence is a different finding from "the rank-1 happened not to be among the rises", so it is
 *   the first thing counted and the only exclusion.
 * - **rank-1 measured** — the final answer carries an inbound rise, so the second half of the predicate has a
 *   value to judge. This is the population the bar is applied to and the denominator of every column below it.
 * - **name refused** — the rank-1's dominant metric is missing or outside the duration family: the FIRST half
 *   refused. Counted apart from the bar's refusals, because the two halves close different residues and a single
 *   "refused" would report one for the other — the same distinction the `INPUT_*` family makes one field over.
 * - **bar refused** — the first half passed and the run's own bar refused the rise. Read through
 *   `admitsFailedEdgeTerm`, i.e. the gate's own predicate, so a census cannot disagree with the engine about the
 *   bar; the line states which bar it used and its value.
 * - **acted** — the term actually moved a candidate's score, read off the breakdown the score was assembled from
 *   (`contribution !== 0`, the rule `buildTerm` itself follows). No second walk re-derives "did it act": a census
 *   that recomputed the decision would agree with the engine until one of them was edited.
 * - **mismatch** — `acted` and the admissible count disagree. Two effects produce it and both are worth seeing: a
 *   case whose only admissible candidate was the BASELINE rank-1 while the final rank-1 is someone else, and a
 *   case the gate let through into an empty `failedEdgeScores` (the one `INPUT_MAP_EMPTY` case). Printed only
 *   when non-zero, because a zero here is the normal reading and must not look like a measurement.
 * - **fleet@share** — the same predicate handed a fleet bar, applied to the same subject. A what-if, labelled as
 *   one: it is the number that says whether an arm at that share has a population worth dispatching, before any
 *   dispatch exists. Omitted when the run's own bar IS a fleet bar, since it would then restate the bar and read
 *   as a second, agreeing measurement where there is one.
 *
 * ## What it does NOT claim
 *
 * The subject is the rank-1 of the FINAL ranking. On a refused case the final ranking is the baseline, so the two
 * coincide; on an admitted case it is the second pass's. `mismatch` is what makes that visible rather than silent.
 *
 * @module benchmarks/failed-edge-gate-census
 */

import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import type { FailedEdgeGateMode } from '../../packages/tree/src/index.js';
import {
  admitsFailedEdgeTerm,
  FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR,
  maxInboundRise,
  namesDurationChannel,
} from '../../packages/tree/src/index.js';

/** The term's name in the breakdown, as the formula spells it. */
const TERM = 'failedEdge';

/** The running totals for one cell, plus the bar they were counted against. */
export interface FailedEdgeGateCensus {
  /** Which bar the run reads: the shipped constant, or a share of each case's own champion. */
  readonly mode: FailedEdgeGateMode;
  /** The share, read only at `mode: 'fleet'`. */
  readonly share: number;
  /** The share the what-if column is computed at, or `undefined` when the column is omitted. */
  readonly whatIfShare: number | undefined;
  /** Records handed over, i.e. cases the runner analysed. */
  cases: number;
  /** Cases that carried no per-edge measurement at all — no champion, no bar. */
  noChampion: number;
  /** Cases whose final rank-1 has a measured inbound rise, i.e. the bar's own population. */
  rankOneMeasured: number;
  /** Of those, cases the DURATION half refused. */
  nameRefused: number;
  /** Of those, cases that passed the name half and that the run's bar refused. */
  barRefused: number;
  /** Cases in which the term actually moved a candidate's score. */
  acted: number;
  /** Of the population, cases a fleet bar at `whatIfShare` would admit; 0 when no column was asked for. */
  whatIfAdmit: number;
  /** Cases whose INPUT carried at least one failed call (`failedTraceEdges` non-empty). */
  failedInputCases: number;
  /** Failed-call rows across the cell, summed before the engine's `max(0, failed − baseline)` filter. */
  failedInputRows: number;
  /** Cases where the term has at least one scoring subject, i.e. `failedEdgeScores` is non-empty. */
  termFed: number;
  /**
   * Of the cases the bar ADMITTED, how many carry a term score for their final rank-1.
   *
   * The population `acted` is a subset of, and the quantity that separates the two ways an admission can fail to
   * pay: no input for the service the gate let through, versus input that the scoring layer then diluted.
   */
  admittedFed: number;
  /** Every measured rank-1 rise, for the quantiles. */
  rises: number[];
}

/**
 * A census with nothing in it.
 *
 * @param mode - The bar the run reads. Passed in rather than read from the engine's defaults so the line states
 *   the bar it judged against instead of the bar the build happened to ship.
 * @param share - The share, read only at `fleet`.
 * @param whatIfShare - The share to compute the what-if column at, or `undefined` to omit it.
 * @returns Zeroed totals, ready for {@link accumulateFailedEdgeGateCensus}.
 */
export function createFailedEdgeGateCensus(
  mode: FailedEdgeGateMode,
  share: number,
  whatIfShare?: number,
): FailedEdgeGateCensus {
  return {
    mode,
    share,
    whatIfShare,
    cases: 0,
    noChampion: 0,
    rankOneMeasured: 0,
    nameRefused: 0,
    barRefused: 0,
    acted: 0,
    whatIfAdmit: 0,
    failedInputCases: 0,
    failedInputRows: 0,
    termFed: 0,
    admittedFed: 0,
    rises: [],
  };
}

/**
 * Read one case's gate outcome off its graph and ranking, and add it to the totals.
 *
 * Mutates `census` rather than returning a new object: the sink is called once per case and a fold that copied
 * 735 totals to produce one line would allocate a cell's worth of objects for nothing.
 *
 * @param census - The totals to add to.
 * @param record - The case, the graph it was ranked over, and the ranking.
 */
export function accumulateFailedEdgeGateCensus(
  census: FailedEdgeGateCensus,
  record: DiagnosedCaseRecord,
): void {
  census.cases++;

  // The INPUT side, counted for every case and before any exclusion. These numbers are the chain §10 of
  // `docs/failed-edge-gate.md` could only SAMPLE: the corpus's own failed-call records, and the term's subjects
  // after the engine's `max(0, failed − baseline)` filter. Two populations one filter apart, so both are counted —
  // a non-zero row count with zero subjects is a corpus whose failures all fell before the injection, which is a
  // different finding from a corpus that never recorded one.
  const failedRows = record.case.failedTraceEdges?.length ?? 0;
  if (failedRows > 0) {
    census.failedInputCases++;
    census.failedInputRows += failedRows;
  }
  if ((record.graph.failedEdgeScores?.size ?? 0) > 0) census.termFed++;

  // The engine's own answer, counted before any exclusion: whether the term moved SOMETHING is a fact about the
  // run, not about the subject this census happens to judge. Reading `!== 0` rather than a truthiness test keeps
  // a `-0` from counting as a payment and a `NaN` from hiding as one — the rule `buildTerm` follows.
  if (
    record.ranking.some(
      (r) => r.terms?.some((t) => t.name === TERM && t.contribution !== 0) === true,
    )
  ) {
    census.acted++;
  }

  const champion = maxInboundRise(record.graph.edgeLatencyByCallee);
  if (champion === undefined) {
    census.noChampion++;
    return;
  }
  const rankOne = record.ranking[0];
  if (rankOne === undefined) return;
  const rise = record.graph.edgeLatencyByCallee?.get(rankOne.serviceId)?.rise;
  if (rise === undefined || !Number.isFinite(rise)) return;
  census.rankOneMeasured++;
  census.rises.push(rise);

  // The FIRST half, asked through its own owner so its refusals are not folded into the bar's.
  const label = record.graph.dominantMetrics?.get(rankOne.serviceId)?.label;
  if (!namesDurationChannel(label)) {
    census.nameRefused++;
    return;
  }
  if (
    !admitsFailedEdgeTerm(label, rise, {
      mode: census.mode,
      share: census.share,
      fleetMax: champion,
    })
  ) {
    census.barRefused++;
  } else if (record.graph.failedEdgeScores?.has(rankOne.serviceId) === true) {
    // Only on the admitted side: a refused case's answer is already the bar, and counting it here would let a bar
    // refusal read as a missing input — the exact confusion this module exists to undo, one layer down.
    census.admittedFed++;
  }
  if (
    census.whatIfShare !== undefined &&
    admitsFailedEdgeTerm(label, rise, {
      mode: 'fleet',
      share: census.whatIfShare,
      fleetMax: champion,
    })
  ) {
    census.whatIfAdmit++;
  }
}

/**
 * The `p`-quantile of a sorted sample, nearest-rank.
 *
 * Nearest-rank rather than interpolated because every number it is applied to is one case's measurement: an
 * interpolated p90 on 88 observations reports a rise no case produced, and the column exists to be compared
 * against real rises and against the bar.
 *
 * **The sample is non-empty and `p` is in `(0, 1]`, and both are preconditions rather than hopes.** The only
 * caller passes 0.1/0.5/0.9/1, and it prints the distribution only when a case was measured — every measured case
 * pushed its rise. A clamp for a sample that cannot be empty would be a branch no input can reach, and a branch no
 * test can cover reads as covered on one engine and untaken on another; the `!` states the precondition instead.
 *
 * @param sorted - The sample, ascending and non-empty.
 * @param p - The quantile in `(0, 1]`.
 * @returns The sample's value at that rank.
 */
function quantile(sorted: readonly number[], p: number): number {
  return sorted[Math.ceil(p * sorted.length) - 1]!;
}

/**
 * The bar's own name, with the number it is: the constant at `absolute`, the share at `fleet`.
 *
 * A fleet bar is per case (`share × that case's champion`), so no single number can stand for it and printing one
 * would be a measurement of a bar the gate never used. The share is what the mode is parameterised by, so the
 * share is what the label carries.
 *
 * @param census - The totals, for the mode and share.
 * @returns The label, e.g. `absolute@300` or `fleet@0.50`.
 */
function barLabel(census: FailedEdgeGateCensus): string {
  return census.mode === 'absolute'
    ? `absolute@${FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR}`
    : `fleet@${census.share.toFixed(2)}`;
}

/**
 * Render the cell's line, or nothing when no case was handed over.
 *
 * **A cell with no per-edge measurement gets a sentence, not a silence and not a row of zeros.** It was silence
 * first, on the reasoning that the `direction-gate` verdict already says `CANNOT FIRE`; the local arms showed why
 * that is not enough. Six of the nine cells are this case (`edgeLatencyByCallee` is empty on every RE1 and RE3
 * case, because those corpora carry no traces), so the ABSENCE is the finding on two thirds of the grid — and a
 * missing line is indistinguishable from a census that did not run, while `no champion 125` inside a row of zeros
 * would read as "the gate refused every case". The sentence names the count and the reason the count is that
 * number, which is the whole of what this cell can say.
 *
 * @param census - The cell's totals.
 * @returns One line — a verdict or a measurement — or `undefined` when the runner handed over nothing.
 */
export function formatFailedEdgeGateCensusLine(census: FailedEdgeGateCensus): string | undefined {
  if (census.cases === 0) return undefined;
  if (census.cases === census.noChampion) {
    return (
      `  [failed-edge-gate] no measurement: ${census.cases} of ${census.cases} cases carried no per-edge ` +
      `latency, so neither bar had a subject and this cell says nothing about the term either way`
    );
  }
  const sorted = [...census.rises].sort((a, b) => a - b);
  const q = (p: number): string => quantile(sorted, p).toFixed(2);
  const admissible = census.rankOneMeasured - census.nameRefused - census.barRefused;
  const mismatch = admissible - census.acted;
  const whatIf =
    census.whatIfShare === undefined
      ? ''
      : ` | fleet@${census.whatIfShare.toFixed(2)} admissible ${census.whatIfAdmit}`;
  return (
    `  [failed-edge-gate] cases=${census.cases} | no champion ${census.noChampion} | ` +
    `rank-1 measured ${census.rankOneMeasured} | name refused ${census.nameRefused} | ` +
    `bar(${barLabel(census)}) refused ${census.barRefused} | admissible ${admissible} | ` +
    `acted ${census.acted}${mismatch === 0 ? '' : ` (mismatch ${mismatch})`} | ` +
    // A cell can have cases, a champion, and no MEASURED rank-1 — the rank-1 was not among the rises. That is a
    // different state from "the gate refused it", so the column prints `none measured` rather than a quantile of
    // an empty sample or a zero that no case produced.
    (census.rankOneMeasured === 0
      ? 'rise none measured'
      : `rise p10/p50/p90/max ${q(0.1)}/${q(0.5)}/${q(0.9)}/${q(1)}`) +
    whatIf
  );
}

/**
 * Render the term's INPUT supply beside the gate's decisions — a second line, not more columns.
 *
 * ## Why it is a line of its own
 *
 * The gate line reports what the predicate decided on a subject the corpus supplied (`edgeLatencyByCallee`). This
 * line reports whether the term had anything to ADD once those decisions were made (`failedTraceEdges` →
 * `failedEdgeScores`). The two are different questions about different maps, and appending them to one row made a
 * single string carry two subjects — the reading §10 of `docs/failed-edge-gate.md` had to reconstruct by hand
 * because no artifact printed the second one at all.
 *
 * ## Why the absence gets a word
 *
 * `failed records 0 cases / 0 rows` is indistinguishable from a corpus that carried failed calls and contributed
 * none, and it is not that: on a text corpus this branch means no ERROR span was ever observed on a comparable
 * edge. `none` states the absence and a number states a measurement, which is the rule the `no measurement`
 * sentence already follows one function up.
 *
 * ## Why the last column is a fraction
 *
 * `admitted rank-1 with entry 0 of 25` is the population `acted` is a subset of. A bare `0` would be true of a
 * cell that admitted nothing as well, and those two cells mean opposite things: one has a term that cannot reach
 * what the gate let through, the other has no gate output to reach.
 *
 * @param census - The cell's totals.
 * @returns One line, or `undefined` when the runner handed over no case.
 */
export function formatFailedEdgeInputLine(census: FailedEdgeGateCensus): string | undefined {
  if (census.cases === 0) return undefined;
  const records =
    census.failedInputCases === 0
      ? 'none'
      : `${census.failedInputCases} cases / ${census.failedInputRows} rows`;
  const admitted = census.rankOneMeasured - census.nameRefused - census.barRefused;
  return (
    `  [failed-edge-input] cases=${census.cases} | failed records ${records} | ` +
    `term subjects ${census.termFed} cases | ` +
    `admitted rank-1 with entry ${census.admittedFed} of ${admitted}`
  );
}
