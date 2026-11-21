/**
 * The term-gap census: which ranking term costs the truth its place, per cell.
 *
 * ## Why this exists
 *
 * The failure diagnostics print the truth's ANOMALY breakdown and the winner's, which is one half of the story:
 * it says which metric out-scored which, and nothing about the ranking that the metrics were fed into. A miss at
 * rank 2 of 68 and a miss at rank 40 of 68 can have identical anomaly breakdowns and be lost to completely
 * different terms — and no artifact in this repository has ever said WHICH term was responsible, in aggregate,
 * over a cell.
 *
 * The runner already records both sides of every case it predicts: the truth's own `terms` (inside
 * `truthEvidence`) and the winner's (`top1Terms`). Those two arrays are the whole input. This module subtracts
 * them, term by term, and sums the difference over the failing cases of a cell — so the question "what would we
 * have to change to win here" is answered by an arithmetic identity rather than by reading eleven blocks by eye.
 *
 * ## What it distinguishes
 *
 * - **costs** — terms on which the winner out-scored the truth, summed. A term at the top of this list is where
 *   the truth loses, and a term with a large sum over many cases is the one a lever has to touch.
 * - **helps** — terms on which the truth out-scored the winner. A term here is already doing its job; a lever
 *   that strengthens it changes nothing.
 * - **unmeasured** — a failing case where either side carries no `terms`, so the subtraction has no meaning. It
 *   is reported as UNMEASURED rather than as a zero gap, the rule the dual-family census established: "the term
 *   did not run" and "the term contributed nothing" are the same number and different findings.
 *
 * ## Why a name that is absent on one side is a ZERO and not a skip
 *
 * A term missing from one array is one the formula did not build for that candidate — most often a gate that
 * zeroed it (`cause` present) or an optional source the case did not carry. Treating it as a skip would silently
 * drop the largest possible gap: a winner paid by a term the truth never received. It is read as `0` and counted,
 * which is what the score did.
 *
 * @module benchmarks/term-gap-census
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** One term's aggregate gap over a cell's failing cases. */
export interface TermGapEntry {
  /** The term's name, as the ranking formula spells it. */
  readonly name: string;
  /** Sum of `winner − truth` over the cases this term was seen in. Positive means it cost the truth. */
  readonly sum: number;
  /** How many failing cases contributed a non-zero gap to this term. */
  readonly cases: number;
}

/** The running totals for one cell. */
export interface TermGapCensus {
  /** Cases that were correct; the census is about the ones that were not. */
  correct: number;
  /** Failing cases where both sides carried `terms`, i.e. the cases the subtraction is defined on. */
  compared: number;
  /** Failing cases where a side carried no `terms`, so nothing can be said about the gap. */
  unmeasured: number;
  /** Per-term signed gap, keyed by the term's name. */
  readonly gaps: Map<string, { sum: number; cases: number }>;
}

/**
 * How many term names each list prints.
 *
 * Bounded for the reason every census line here is: the ranking carries sixteen terms and the line is read by a
 * human and by a diff, so the head of each list is what decides the question and the tail is noise.
 */
export const TERM_GAP_TOP = 5;

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateTermGap}.
 */
export function createTermGapCensus(): TermGapCensus {
  return { correct: 0, compared: 0, unmeasured: 0, gaps: new Map() };
}

/**
 * Fold one case's prediction into the census.
 *
 * Correct cases are counted and dropped: a term that helps the winner WIN is not a term that costs the truth its
 * place, and mixing the two would make every list a wash of the cell's successes.
 *
 * @param census - The running totals, mutated in place.
 * @param prediction - The runner's record for one case, carrying both sides' terms.
 */
export function accumulateTermGap(census: TermGapCensus, prediction: CasePrediction): void {
  if (prediction.correct) {
    census.correct += 1;
    return;
  }
  const truthTerms = prediction.truthEvidence?.terms;
  const winnerTerms = prediction.top1Terms;
  if (truthTerms === undefined || winnerTerms === undefined) {
    census.unmeasured += 1;
    return;
  }
  census.compared += 1;
  const truth = contributionsOf(truthTerms);
  const winner = contributionsOf(winnerTerms);
  // The UNION, so a term paid to one side only is still read — as the whole of its contribution, against 0.
  for (const name of new Set([...truth.keys(), ...winner.keys()])) {
    const gap = (winner.get(name) ?? 0) - (truth.get(name) ?? 0);
    if (gap === 0) continue;
    const running = census.gaps.get(name) ?? { sum: 0, cases: 0 };
    running.sum += gap;
    running.cases += 1;
    census.gaps.set(name, running);
  }
}

/**
 * Total per name.
 *
 * A name can appear more than once in one candidate's terms — the ranking adds a term per contributing edge in
 * some families — so the map holds the SUM, not the last value. Recording the last would make the census disagree
 * with the score on exactly the candidates whose score was built from the most evidence.
 *
 * @param terms - One candidate's terms, as the ranking emitted them.
 */
function contributionsOf(terms: readonly ScoreTerm[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const term of terms) out.set(term.name, (out.get(term.name) ?? 0) + term.contribution);
  return out;
}

/**
 * The census as a line, or `undefined` when it has no failing case to speak about.
 *
 * `undefined` rather than a zeroed line: a cell that lost nothing has no gap, and printing `costs:` with an empty
 * list would put a claim where there is no measurement.
 *
 * @param census - The running totals.
 */
export function formatTermGapLine(census: TermGapCensus): string | undefined {
  if (census.compared === 0 && census.unmeasured === 0) return undefined;
  const entries = [...census.gaps.entries()].map(([name, one]) => ({
    name,
    sum: one.sum,
    cases: one.cases,
  }));
  const costs = rank(
    entries.filter((e) => e.sum > 0),
    1,
  );
  const helps = rank(
    entries.filter((e) => e.sum < 0),
    -1,
  );
  const parts = [
    `[term-gap] failing=${census.compared + census.unmeasured} compared=${census.compared}`,
  ];
  if (census.unmeasured > 0) parts.push(`unmeasured=${census.unmeasured}`);
  parts.push(`costs: ${list(costs)}`);
  parts.push(`helps: ${list(helps)}`);
  return parts.join(' | ');
}

/**
 * Order one list: by magnitude descending, then by name ascending.
 *
 * The name arm has no equality branch because the names are `Map` keys and therefore distinct — the rule the
 * unclassified-class census records; a `? -1 : 1` on a unique key is a branch no input can reach.
 *
 * @param entries - The terms with a gap in this direction.
 * @param sign - `1` for costs (positive gaps), `-1` for help (negative ones).
 */
function rank(entries: readonly TermGapEntry[], sign: 1 | -1): TermGapEntry[] {
  return [...entries]
    .sort((a, b) => sign * (b.sum - a.sum) || (a.name < b.name ? -1 : 1))
    .slice(0, TERM_GAP_TOP);
}

/**
 * Render one ranked list as `name=+0.412(11)`, or `none` when it is empty.
 *
 * @param entries - The already-ranked slice.
 */
function list(entries: readonly TermGapEntry[]): string {
  if (entries.length === 0) return 'none';
  return entries
    .map((e) => `${e.name}=${e.sum >= 0 ? '+' : ''}${e.sum.toFixed(3)}(${e.cases})`)
    .join(' ');
}
