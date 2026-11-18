import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PROMOTION_THRESHOLD,
  PROMOTION_OFF,
  PROMOTION_OUTCOMES,
  formatPromotionCensus,
  gatePromotion,
  type PromotionOutcome,
} from '../../src/agent/promotion.js';

/** One published candidate: a service and the score the engine gave it. */
interface Published {
  readonly service: string;
  readonly score: number;
}

/** Build a published order from `[service, score]` pairs, in publication order. */
function published(pairs: readonly (readonly [string, number])[]): readonly Published[] {
  return pairs.map(([service, score]) => ({ service, score }));
}

/**
 * A committee of five with a decided leader: `relGap = (6.0 - 2.0) / (6.0 - 0.5) = 0.727`.
 *
 * The engine has said what it thinks; a promotion here would be arguing with a settled case.
 */
const DECIDED = published([
  ['mysql', 6.0],
  ['cache', 2.0],
  ['gateway', 1.5],
  ['auth', 1.0],
  ['billing', 0.5],
]);

/**
 * The same committee with an undecided top: `relGap = (3.0 - 2.95) / (3.0 - 0.0) = 0.0167`.
 *
 * This is the population the gate exists for — the engine's first two candidates are within a few per cent of
 * each other, so "the leader" is a statement about rounding.
 */
const UNDECIDED = published([
  ['mysql', 3.0],
  ['cache', 2.95],
  ['gateway', 1.0],
  ['auth', 0.5],
  ['billing', 0.0],
]);

describe('gatePromotion', () => {
  it('is the identity on the published order when the gate is off', () => {
    // The control arm rests on this being exact rather than approximate: an off gate must return the engine's
    // order element for element, so a delta against it is a delta against the engine.
    const decision = gatePromotion(DECIDED, ['cache'], PROMOTION_OFF);
    expect(decision.outcome).toBe('off');
    expect(decision.order).toEqual(DECIDED.map((row) => row.service));
    expect(decision.promote).toBe(false);
    expect(decision.promotedService).toBeNull();
    // A switched-off gate reports no gap, because it did not look at one. A number here would be a measurement
    // of something the caller asked not to measure.
    expect(decision.relGap).toBeNull();
    expect(decision.spread).toBeNull();
  });

  it('is the identity when the model already names the engine leader', () => {
    const decision = gatePromotion(UNDECIDED, ['mysql', 'cache'], { threshold: 0.03 });
    expect(decision.outcome).toBe('agrees');
    expect(decision.promote).toBe(false);
    expect(decision.order).toEqual(UNDECIDED.map((row) => row.service));
    // The band is still measured, because "the model agreed in an undecided case" and "the model agreed in a
    // decided one" are different statements about the arm and the table prints them apart.
    expect(decision.relGap).toBeCloseTo(0.05 / 3.0, 12);
  });

  it('refuses when there is nothing to compare', () => {
    // Three ways for a comparison to have no operands, each named rather than folded into one arm: an empty
    // nomination, an empty order, and an order of one are different defects in three different callers.
    expect(gatePromotion(UNDECIDED, [], { threshold: 0.03 }).outcome).toBe('unranked');
    expect(gatePromotion([], ['mysql'], { threshold: 0.03 }).outcome).toBe('unranked');
    expect(gatePromotion([], ['mysql'], { threshold: 0.03 }).order).toEqual([]);
  });

  it('refuses a leader the published order does not carry', () => {
    const decision = gatePromotion(UNDECIDED, ['nobody'], { threshold: 0.03 });
    expect(decision.outcome).toBe('unranked');
    expect(decision.promote).toBe(false);
    expect(decision.order).toEqual(UNDECIDED.map((row) => row.service));
  });

  it('refuses when the published order is not score-sorted, however small the gap', () => {
    // The containment pass moves adjacent caller/callee pairs AFTER scoring, so the published leader can score
    // below the second candidate. A margin rule read on such a pair measures the rule that already acted, not the
    // engine's uncertainty — `docs/agentic-promotion-gate.md` §2.
    const reversed = published([
      ['cache', 2.95],
      ['mysql', 3.0],
      ['gateway', 1.0],
      ['auth', 0.5],
      ['billing', 0.0],
    ]);
    const decision = gatePromotion(reversed, ['cache'], { threshold: 0.03 });
    // The model names the published leader, so it agrees: nothing to promote and nothing to refuse on the order.
    expect(decision.outcome).toBe('agrees');

    const argues = gatePromotion(reversed, ['mysql'], { threshold: 0.03 });
    expect(argues.outcome).toBe('reversed');
    expect(argues.promote).toBe(false);
    expect(argues.order).toEqual(reversed.map((row) => row.service));
    // The gap is reported as the negative number it is, so a reader of the census can see the pair is reversed
    // rather than merely tight.
    expect(argues.relGap).toBeLessThan(0);
  });

  it('refuses when the case has no spread to measure a gap against', () => {
    // Three candidates on the same score: `spread = 0` and every ratio is unbounded. A made-up floor here would
    // be a threshold that exists because the code accepted it.
    const flat = published([
      ['mysql', 1.0],
      ['cache', 1.0],
      ['gateway', 1.0],
    ]);
    const decision = gatePromotion(flat, ['cache'], { threshold: 0.03 });
    expect(decision.outcome).toBe('degenerate');
    expect(decision.promote).toBe(false);
    expect(decision.relGap).toBeNull();
    expect(decision.spread).toBe(0);
  });

  it('refuses a single-candidate case, where there is no second score to compare', () => {
    const alone = published([['mysql', 4.0]]);
    const decision = gatePromotion(alone, ['mysql'], { threshold: 0.03 });
    // One candidate is `agrees` and it is also unmeasurable; the gate states which one it is by not promoting.
    expect(decision.promote).toBe(false);
    expect(decision.relGap).toBeNull();
  });

  it('promotes the model leader when the engine is undecided', () => {
    const decision = gatePromotion(UNDECIDED, ['cache', 'mysql'], { threshold: 0.03 });
    expect(decision.outcome).toBe('promoted');
    expect(decision.promote).toBe(true);
    expect(decision.promotedService).toBe('cache');
    // The promoted service leads and every other service keeps the engine's relative order — a promotion moves
    // one candidate and invents no opinion about the rest.
    expect(decision.order).toEqual(['cache', 'mysql', 'gateway', 'auth', 'billing']);
  });

  it('does not promote when the engine has decided', () => {
    const decision = gatePromotion(DECIDED, ['cache'], { threshold: 0.03 });
    expect(decision.outcome).toBe('band-miss');
    expect(decision.promote).toBe(false);
    expect(decision.order).toEqual(DECIDED.map((row) => row.service));
    expect(decision.relGap).toBeGreaterThan(0.03);
  });

  it('treats the threshold as exclusive at the boundary', () => {
    // Chosen so the ratio is exact in binary: `(4 - 3) / (4 - 0) = 0.25`. A quarter is representable, so this
    // asserts the comparison and not the arithmetic.
    const quarter = published([
      ['mysql', 4.0],
      ['cache', 3.0],
      ['gateway', 1.0],
      ['auth', 0.0],
    ]);
    const decision = gatePromotion(quarter, ['cache'], { threshold: 0.25 });
    expect(decision.relGap).toBe(0.25);
    // `>=` and not `>`: a gap exactly at the threshold is a gap the engine has decided on.
    expect(decision.outcome).toBe('band-miss');
    expect(gatePromotion(quarter, ['cache'], { threshold: 0.2500001 }).outcome).toBe('promoted');
  });

  it('takes the spread from the lowest score in the order, not from the last row', () => {
    // The published order is not score-sorted, so its last row is not its minimum. `c` scores -1.00 and stands
    // third; `d` scores 0.50 and stands last. A spread read off the last row is 2.50 and the 0.006 threshold would
    // miss; read off the minimum it is 4.00 and the pair is inside the band.
    const unsorted = published([
      ['a', 3.0],
      ['b', 2.98],
      ['c', -1.0],
      ['d', 0.5],
    ]);
    expect(gatePromotion(unsorted, ['b'], { threshold: 0.006 }).outcome).toBe('promoted');
    expect(gatePromotion(unsorted, ['b'], { threshold: 0.006 }).spread).toBeCloseTo(4.0, 12);
  });

  it('is monotone in the threshold: a wider band never promotes fewer cases', () => {
    // Ranks the order by nothing in particular — the point is the lattice, not the numbers.
    const thresholds = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.3];
    const promoted = thresholds.map(
      (threshold) => gatePromotion(UNDECIDED, ['cache'], { threshold }).promote,
    );
    const firstTrue = promoted.indexOf(true);
    expect(firstTrue).toBeGreaterThanOrEqual(0);
    // Once true, always true: a threshold is a cut on one number, so it cannot promote at 0.05 and refuse at 0.10.
    expect(promoted.slice(firstTrue).every((flag) => flag)).toBe(true);
  });

  it('keeps the order a permutation of the published one', () => {
    const decision = gatePromotion(UNDECIDED, ['billing', 'auth'], { threshold: 0.03 });
    expect(decision.promote).toBe(true);
    expect([...decision.order].sort()).toEqual(UNDECIDED.map((row) => row.service).sort());
    expect(new Set(decision.order).size).toBe(decision.order.length);
  });

  it('never promotes a service that is already leading', () => {
    // A promotion of the leader to the leader is not a promotion, and counting it as one would inflate the arm's
    // override count with cases where it agreed.
    for (const threshold of [0.001, 0.03, 0.5, 10]) {
      const decision = gatePromotion(UNDECIDED, ['mysql'], { threshold });
      expect(decision.outcome).toBe('agrees');
      expect(decision.promote).toBe(false);
    }
  });

  it('publishes the default threshold the pre-registration fixed', () => {
    expect(DEFAULT_PROMOTION_THRESHOLD).toBe(0.03);
  });

  it('names every outcome, so a census can be exhaustive', () => {
    expect([...PROMOTION_OUTCOMES]).toEqual([
      'off',
      'unranked',
      'agrees',
      'reversed',
      'degenerate',
      'band-miss',
      'promoted',
    ]);
  });

  it('accepts a threshold of zero, which is not the same value as null', () => {
    // Zero is a legal threshold: it means "promote only on a top-two tie that is exactly zero apart", and because
    // the band is a strict `<` it promotes nothing. The point of the test is that the two spellings do not
    // collapse into one code path — a zero threshold still MEASURES, so its gap is reported, while `null` does not.
    const zero = gatePromotion(UNDECIDED, ['cache'], { threshold: 0 });
    expect(zero.outcome).toBe('band-miss');
    expect(zero.relGap).toBeCloseTo(0.05 / 3.0, 12);
    expect(gatePromotion(UNDECIDED, ['cache'], PROMOTION_OFF).relGap).toBeNull();

    // And an exact tie really is zero apart, which is what makes the reading above a statement about the strict
    // comparison rather than about the arithmetic.
    const tied = published([
      ['mysql', 3.0],
      ['cache', 3.0],
      ['gateway', 1.0],
      ['auth', 0.5],
      ['billing', 0.0],
    ]);
    expect(gatePromotion(tied, ['cache'], { threshold: 0 }).relGap).toBe(0);
  });
});

describe('formatPromotionCensus', () => {
  /** A census with every outcome at zero, so a test states only the cells it means. */
  function empty(): Record<PromotionOutcome, number> {
    return {
      off: 0,
      unranked: 0,
      agrees: 0,
      reversed: 0,
      degenerate: 0,
      'band-miss': 0,
      promoted: 0,
    };
  }

  it('prints every outcome, including the ones at zero', () => {
    // A census that omitted its empty cells would leave a reader unable to tell "no case was reversed" from "the
    // run never counted reversals".
    const text = formatPromotionCensus({ ...empty(), promoted: 56 }, 122);
    for (const outcome of PROMOTION_OUTCOMES) expect(text).toContain(outcome);
    expect(text).toContain('56');
    expect(text).toContain('45.9%');
  });

  it('says so when the counts do not add up to the population', () => {
    // Not an exception: a census that lost cases is a reading, and the reading is what a caller needs to see.
    expect(formatPromotionCensus({ ...empty(), off: 3 }, 5)).toContain('unaccounted      2');
  });

  it('says nothing extra when they do add up', () => {
    expect(formatPromotionCensus({ ...empty(), off: 5 }, 5)).not.toContain('unaccounted');
  });

  it('does not divide by a zero population', () => {
    expect(formatPromotionCensus(empty(), 0)).toContain('0.0%');
  });
});
