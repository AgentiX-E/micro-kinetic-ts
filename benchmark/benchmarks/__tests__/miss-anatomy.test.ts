/**
 * Unit tests for the miss decomposition.
 *
 * The module's whole claim is that a `Top@1` miss is DECOMPOSABLE from rows the engine already emits, and the
 * tests hold the three statements that claim needs to be checkable rather than merely informative:
 *
 *  1. the differences SUM to the score gap the miss is made of, so the table is a decomposition and not a
 *     description;
 *  2. an absent truth is named rather than decomposed, because "the winner had more of everything" is what a
 *     set decision looks like when it is written as arithmetic;
 *  3. a tie is named rather than resolved, because the two remaining explanations for it — an order outside the
 *     sum, and two candidates the formula could not separate — are not distinguishable from the rows.
 *
 * @module benchmarks/__tests__/miss-anatomy
 */

import { describe, expect, it } from 'vitest';

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import {
  SCORED_TIE,
  TRUTH_NOT_RANKED,
  decompose,
  tableOf,
  type TermTable,
} from '../src/miss-anatomy.js';

/**
 * Build a term row.
 *
 * @param name - The formula's name for the term.
 * @param contribution - Its contribution, weight already applied.
 * @returns The row.
 */
function term(name: string, contribution: number): ScoreTerm {
  return { name, contribution };
}

describe('tableOf', () => {
  it('reads an absent breakdown as an empty table rather than as undefined', () => {
    // `undefined` would force every caller to branch on a producer's capability, and the branch would be one
    // more place a missing breakdown could be mistaken for a zero score.
    expect(tableOf(undefined)).toEqual({});
  });

  it('reads an empty breakdown as an empty table', () => {
    expect(tableOf([])).toEqual({});
  });

  it('SUMS two rows under one name rather than keeping the last', () => {
    // The formula may contribute twice under one name (a term applied once per channel, for instance). Keeping
    // the last would report a number that appears in no sum, and the differences below would then not add up to
    // the score gap — the one invariant this module publishes.
    expect(tableOf([term('log', 0.4), term('log', 0.1)])).toEqual({ log: 0.5 });
  });

  it('keeps a negative contribution, because a penalty is a term', () => {
    expect(tableOf([term('pool', -0.25)])).toEqual({ pool: -0.25 });
  });

  it('keeps a zero row, so a live term that contributed nothing is still named', () => {
    // The table is what the formula said, not what it said that was non-zero: dropping zeros here would make
    // `decompose`'s omission of equal terms indistinguishable from a term the producer never emitted.
    expect(tableOf([term('topo', 0)])).toEqual({ topo: 0 });
  });
});

describe('decompose', () => {
  const winner: TermTable = {
    selfAnomalyLog1p: 0.62,
    dualFamily: 0.25,
    lat: 0.31,
    log: 0,
  };

  it('names the base term when the winner is louder in the metric channel', () => {
    const truth: TermTable = { selfAnomalyLog1p: 0.18, dualFamily: 0.25, lat: 0.4, log: 0 };
    const result = decompose(truth, winner);
    expect(result.decisiveTerm).toBe('selfAnomalyLog1p');
    expect(result.decisiveDelta).toBeCloseTo(0.44, 12);
  });

  it('names a prior when the prior out-weighs the base term difference', () => {
    const truth: TermTable = { selfAnomalyLog1p: 0.6, dualFamily: 0, lat: 0.31, log: 0 };
    const result = decompose(truth, winner);
    // base is +0.02 for the winner, so the bonus that actually decided it is the family membership.
    expect(result.decisiveTerm).toBe('dualFamily');
    expect(result.decisiveDelta).toBeCloseTo(0.25, 12);
  });

  it('does not name a term the TRUTH contributed more of', () => {
    // `lat` favours the truth here. A decomposition that named the largest ABSOLUTE difference would report the
    // truth's own advantage as the cause of its loss.
    const truth: TermTable = { selfAnomalyLog1p: 0.1, dualFamily: 0.25, lat: 5, log: 0 };
    const result = decompose(truth, winner);
    expect(result.decisiveTerm).toBe('selfAnomalyLog1p');
    expect(result.deltas.lat).toBeCloseTo(0.31 - 5, 12);
    expect(result.deltas.lat).toBeLessThan(0);
  });

  it('omits a term the two contributed identically to', () => {
    // `lat` is 0.31 on both sides here, so it is the term the omission rule applies to — the case's own
    // direction signal said the same thing about both candidates and therefore decided nothing.
    const truth: TermTable = { selfAnomalyLog1p: 0.1, dualFamily: 0.25, lat: 0.31, log: 0 };
    const result = decompose(truth, winner);
    expect(Object.keys(result.deltas)).toEqual(['selfAnomalyLog1p']);
  });

  it("treats a term only ONE side carries as that side's contribution", () => {
    const truth: TermTable = { selfAnomalyLog1p: 0.1 };
    const result = decompose(truth, winner);
    expect(result.deltas.dualFamily).toBeCloseTo(0.25, 12);
    // `log` is 0 on the winner and absent on the truth, so the difference is 0 and the row is omitted: a term
    // both sides scored at zero is a term that decided nothing, whichever side failed to carry it.
    expect('log' in result.deltas).toBe(false);
  });

  it("reads a term only the TRUTH carries as the truth's advantage", () => {
    // The other direction of the same rule, and it is the one that makes a decomposition honest about losses: a
    // term the truth was paid and the winner was not shows up NEGATIVE, so a reader scanning `deltas` for the
    // cause of a miss can see where the truth was ahead instead of only where it fell behind.
    const truth: TermTable = { selfAnomalyLog1p: 0.1, podState: 8 };
    const result = decompose(truth, winner);
    expect(result.deltas.podState).toBeCloseTo(-8, 12);
    // A NEGATIVE difference is never the decisive term, because `decisive` answers "what favoured the winner".
    expect(result.decisiveTerm).toBe('selfAnomalyLog1p');
  });

  it('SUMS to the score gap, term for term', () => {
    // The invariant that makes this a decomposition. If it ever fails, the rows are a description of a different
    // score and every report built on them is off by the difference.
    const truth: TermTable = { selfAnomalyLog1p: 0.18, dualFamily: 0, lat: 0.9, log: -0.1 };
    const result = decompose(truth, winner);
    const gap =
      Object.values(winner).reduce((a, b) => a + b, 0) -
      Object.values(truth).reduce((a, b) => a + b, 0);
    const summed = Object.values(result.deltas).reduce((a, b) => a + b, 0);
    expect(summed).toBeCloseTo(gap, 12);
  });

  it("names an ABSENT truth rather than decomposing the winner's whole score", () => {
    const result = decompose(null, winner);
    expect(result.decisiveTerm).toBe(TRUTH_NOT_RANKED);
    expect(result.decisiveDelta).toBe(0);
    // Not `winner`'s terms: a miss whose cause is that the truth was never scored has no term-level cause.
    expect(result.deltas).toEqual({});
  });

  it('names a TIE rather than resolving it', () => {
    const result = decompose(
      { selfAnomalyLog1p: 0.62, dualFamily: 0.25, lat: 0.31, log: 0 },
      winner,
    );
    expect(result.decisiveTerm).toBe(SCORED_TIE);
    expect(result.decisiveDelta).toBe(0);
    expect(result.deltas).toEqual({});
  });

  it("breaks a tie between two terms on the FIRST one in the formula's order", () => {
    // Two terms each favouring the winner by the same amount. `Object.entries` order would decide it, and that
    // order is the construction order of a table this module builds from two others — so the tie is broken by
    // the strict comparison instead, and the first name in the winner's table wins.
    const result = decompose({}, { alpha: 0.3, beta: 0.3 });
    expect(result.decisiveTerm).toBe('alpha');
    expect(result.decisiveDelta).toBeCloseTo(0.3, 12);
  });
});
