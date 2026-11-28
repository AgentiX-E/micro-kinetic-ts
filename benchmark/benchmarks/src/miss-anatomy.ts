/**
 * What decided a `Top@1` miss, in the ranking formula's own terms.
 *
 * The probe that used this module's first draft read the per-case artifact and could only say WHICH service won.
 * The question a next arm needs answered is which of the formula's terms did it, and every result the engine
 * returns already carries rows that sum exactly to its `finalScore`. The difference between the winner's row set
 * and the truth's row set is therefore a decomposition of the miss, term by term, with no re-derivation anywhere.
 *
 * Three answers are distinguishable and they imply different work:
 *
 *  - `selfAnomalyLog1p` decides: the winner is louder in the metric channel. Every other term is a correction
 *    applied to this one, so no weight can repair it — the work is to the anomaly itself.
 *  - a PRIOR decides: the corpus handed the engine a signal that pointed at the winner, and both the sign and the
 *    size of that misdirection are in `deltas`.
 *  - the truth is ABSENT: it never reached a result, which is a set decision taken before any score, and no
 *    weight reaches it. `deltas` is then empty and the term is `truth-not-ranked`, because a decomposition of a
 *    difference that does not exist would be a list of zeros presented as a measurement.
 *
 * @module benchmarks/miss-anatomy
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';

/** One candidate's named contributions, as the formula spelled them. */
export type TermTable = Readonly<Record<string, number>>;

/** The name `decompose` reports when the truth never reached a result. */
export const TRUTH_NOT_RANKED = 'truth-not-ranked';

/** The name `decompose` reports when the winner and the truth contributed identically to every term. */
export const SCORED_TIE = 'scored-tie';

/**
 * Flatten a result's term rows into name to contribution.
 *
 * A name that appears twice is SUMMED rather than overwritten: the breakdown is a list because the formula is a
 * list, and two rows under one name are two contributions the formula made, not a collision. Overwriting would
 * report the last of them as the whole of it — a number that appears in no sum.
 *
 * @param terms - The result's rows, or `undefined` when the producer does not compute a breakdown.
 * @returns The table; empty when there were no rows, and never `undefined`, because an absent breakdown and an
 * empty one are the same statement for this module's arithmetic.
 */
export function tableOf(terms: readonly ScoreTerm[] | undefined): TermTable {
  const table: Record<string, number> = {};
  for (const term of terms ?? []) table[term.name] = (table[term.name] ?? 0) + term.contribution;
  return table;
}

/** The decomposition of one miss. */
export interface Decomposition {
  /**
   * Every term, `winner − truth`, for the terms where the two differ.
   *
   * A term contributing the same on both sides is omitted rather than written as `0`: a table of differences is
   * read to find where the miss came from, and a row of zeros would be as long as the formula and say nothing.
   */
  readonly deltas: TermTable;
  /** The term whose contribution favoured the winner most; see {@link TRUTH_NOT_RANKED} and {@link SCORED_TIE}. */
  readonly decisiveTerm: string;
  /** That term's difference, or `0` when there is no difference to name. */
  readonly decisiveDelta: number;
}

/**
 * Decompose the gap between a case's winner and its truth.
 *
 * @param truthTerms - The truth's contributions, or `null` when it never reached a result.
 * @param winnerTerms - The winner's contributions.
 * @returns The differences, the term that decided the miss, and its size.
 */
export function decompose(truthTerms: TermTable | null, winnerTerms: TermTable): Decomposition {
  // The absence is answered FIRST and not as a table of the winner's whole score: a decomposition of "everything
  // the winner had and the truth did not" would name the winner's largest term as the cause of a miss whose
  // actual cause is that the truth was never scored.
  if (truthTerms === null) return { deltas: {}, decisiveTerm: TRUTH_NOT_RANKED, decisiveDelta: 0 };
  const deltas: Record<string, number> = {};
  for (const name of new Set([...Object.keys(winnerTerms), ...Object.keys(truthTerms)])) {
    const delta = (winnerTerms[name] ?? 0) - (truthTerms[name] ?? 0);
    if (delta !== 0) deltas[name] = delta;
  }
  let decisiveTerm = SCORED_TIE;
  let decisiveDelta = 0;
  for (const [name, delta] of Object.entries(deltas)) {
    // STRICTLY greater, so a tie between two terms names the first in the formula's order rather than depending
    // on the insertion order of an object — the same value would otherwise produce different reports per engine.
    if (delta > decisiveDelta) {
      decisiveTerm = name;
      decisiveDelta = delta;
    }
  }
  return { deltas, decisiveTerm, decisiveDelta };
}
