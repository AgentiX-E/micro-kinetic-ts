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

  it('renders a member a caller forgot as zero, and still reports the population', () => {
    // The typed census cannot omit a member, and a census built by concatenating partial tallies can. The guard is
    // tested rather than trusted: without it a missing key sums `undefined` into the total and the census reports
    // the whole population as unaccounted for, which is a wrong explanation of a real omission.
    const partial = { off: 3 } as unknown as Record<PromotionOutcome, number>;
    const text = formatPromotionCensus(partial, 5);
    expect(text).toMatch(/^ {2}evidence-behind +0 +0\.0%$/m);
    expect(text).toContain('unaccounted      2');
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
      'evidence-none',
      'evidence-tie',
      'evidence-behind',
      'rarity-miss',
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
      'evidence-none': 0,
      'evidence-tie': 0,
      'evidence-behind': 0,
      'rarity-miss': 0,
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

  it('aligns every row, including the longest outcome name', () => {
    // The vocabulary grew to include `evidence-behind` (fifteen characters) and the pad was eleven: every row after
    // it became a column out of line. A reader sees that before a test does, so the test states the invariant rather
    // than the padding — one width for every line.
    const text = formatPromotionCensus({ ...empty(), 'evidence-behind': 44 }, 1422);
    const rows = text.split('\n').filter((line) => !line.includes('unaccounted'));
    expect(new Set(rows.map((line) => line.length)).size).toBe(1);
    expect(text).toMatch(/^ {2}evidence-behind +44 +3\.1%$/m);
  });

  it('says nothing extra when they do add up', () => {
    expect(formatPromotionCensus({ ...empty(), off: 5 }, 5)).not.toContain('unaccounted');
  });

  it('does not divide by a zero population', () => {
    expect(formatPromotionCensus(empty(), 0)).toContain('0.0%');
  });
});

/**
 * The evidence admission rule, tested on fixtures whose counts are computable by hand.
 *
 * The rule is `preregistration-307.md`'s arm A: admit the model's first choice when it owns **strictly more**
 * out-of-band channels than the leader, counting only channels whose fault-free rate is below the case's median.
 * The main fixtures carry the SAME sixteen rates in every case and move only the in-band/out-of-band flags, so the
 * median is one number for the whole block (the lower median of `0.05 … 0.80` over sixteen channels is `0.40`) and a
 * count that changes cannot be the median moving underneath it.
 */
describe('gatePromotion — evidence admission', () => {
  /** One channel: does it sit outside its fault-free band after the injection, and how often does it swing anyway? */
  function channel(label: string, rate: number, outside: boolean) {
    return { label, pre: 1, post: outside ? 10 : 1, band: [0, 5] as const, rate };
  }

  /** One candidate. `rank` and `score` are explicit because a fixture states its own order. */
  function candidate(
    service: string,
    rank: number,
    score: number,
    channels: ReturnType<typeof channel>[],
  ) {
    return { service, rank, score, channels };
  }

  /**
   * The committee, with flags as the only variable.
   *
   * Rates are `0.05 0.10 | 0.15 0.20 0.25 0.70 | 0.30 0.35 0.40 0.45 | 0.50 0.55 0.60 0.65 | 0.75 0.80` over four
   * candidates — sixteen channels — so the lower median is `0.40` and "rarer than the median" is `rate < 0.40`.
   *
   * `mysql` owns two qualifying channels (`0.05`, `0.10`) in every fixture; only `cache`'s flags move, which is
   * what makes the four readings different answers to the same question rather than four different questions.
   */
  function committee(cacheFlags: readonly boolean[]) {
    const [c0, c1, c2, c3] = cacheFlags as [boolean, boolean, boolean, boolean];
    return [
      candidate('mysql', 0, 3.0, [
        channel('a', 0.05, true),
        channel('b', 0.1, true),
        channel('c', 0.75, false),
        channel('d', 0.8, false),
      ]),
      candidate('cache', 1, 2.9, [
        channel('e', 0.15, c0),
        channel('f', 0.2, c1),
        channel('g', 0.25, c2),
        channel('h', 0.7, c3),
      ]),
      candidate('auth', 2, 1.0, [
        channel('i', 0.3, false),
        channel('j', 0.35, false),
        channel('k', 0.4, false),
        channel('l', 0.45, false),
      ]),
      candidate('billing', 3, 0.5, [
        channel('m', 0.5, false),
        channel('n', 0.55, false),
        channel('o', 0.6, false),
        channel('p', 0.65, false),
      ]),
    ];
  }

  /** Three qualifying channels on the pick against the leader's two. */
  const AHEAD = committee([true, true, true, true]);
  /** Two against two: equal, which the strict rule must refuse. */
  const TIED = committee([true, true, false, false]);
  /** One against two. */
  const BEHIND = committee([true, false, false, false]);

  const COUNT = 'count' as const;
  const RARITY = 'count-and-rarity' as const;

  /** Gate with the evidence rule, over the scores the band would have read. */
  function evidence(
    candidates: ReturnType<typeof committee>,
    nomination: readonly string[],
    variant: 'count' | 'count-and-rarity',
  ) {
    return gatePromotion(
      candidates.map((row) => ({ service: row.service, score: row.score })),
      nomination,
      { threshold: 0.03, evidence: { variant, candidates } },
    );
  }

  it('promotes when the pick owns strictly more out-of-band channels', () => {
    const decision = evidence(AHEAD, ['cache'], COUNT);
    expect(decision.outcome).toBe('promoted');
    expect(decision.promotedService).toBe('cache');
    // The rule's own arithmetic is reported, so a census can say WHY and not only what.
    expect(decision.evidence).toEqual({
      pick: 3,
      leader: 2,
      median: 0.4,
      rarestPick: 0.15,
      rarestLeader: 0.05,
    });
    // And the order applied is one move to the front: the challenger first, everything else in the engine's order.
    expect(decision.order.slice(0, 2)).toEqual(['cache', 'mysql']);
    expect(decision.order).toHaveLength(4);
  });

  it('refuses a tie, and says the counts were equal rather than that nothing was measured', () => {
    const decision = evidence(TIED, ['cache'], COUNT);
    expect(decision.outcome).toBe('evidence-tie');
    expect(decision.promote).toBe(false);
    expect(decision.evidence).toMatchObject({ pick: 2, leader: 2 });
  });

  it('refuses when the pick is behind, which is a different refusal from a tie', () => {
    const decision = evidence(BEHIND, ['cache'], COUNT);
    expect(decision.outcome).toBe('evidence-behind');
    expect(decision.evidence).toMatchObject({ pick: 1, leader: 2 });
  });

  it('reports evidence-none when no channel survives the median filter', () => {
    // Every channel rated at the median or above: the population yields nothing to count, for a reason that is
    // about the FILTER and not about the two candidates being equally evidenced.
    const flat = [
      candidate('mysql', 0, 3.0, [channel('a', 0.5, true), channel('b', 0.5, true)]),
      candidate('cache', 1, 2.9, [channel('c', 0.5, true), channel('d', 0.5, true)]),
    ];
    const decision = evidence(flat, ['cache'], COUNT);
    expect(decision.outcome).toBe('evidence-none');
    expect(decision.evidence).toEqual({
      pick: 0,
      leader: 0,
      median: 0.5,
      rarestPick: null,
      rarestLeader: null,
    });
  });

  it('does not count a channel that is out of band but not below the median', () => {
    // AHEAD's pick has four out-of-band channels and only three of them are rarer than 0.40, so a rule that
    // counted "moved" would read 4-2 instead of 3-2 on the same case.
    const pick = AHEAD[1]!;
    expect(pick.channels.filter((c) => c.post > 5)).toHaveLength(4);
    expect(evidence(AHEAD, ['cache'], COUNT).evidence).toMatchObject({ pick: 3 });
  });

  it('does not count a channel that is below the median but inside its band', () => {
    // The other half of the conjunction, tested separately: a rule that counted "rare" alone would admit on almost
    // every candidate in the corpus, because most channels are rare.
    const silent = committee([false, false, false, false]);
    const decision = evidence(silent, ['cache'], COUNT);
    expect(silent[1]!.channels.filter((c) => c.rate < 0.4)).toHaveLength(3);
    expect(decision.evidence).toMatchObject({ pick: 0 });
    expect(decision.outcome).toBe('evidence-behind');
  });

  it('takes the median over EVERY candidate, not over the two being compared', () => {
    // The discriminating fixture: a third candidate whose channels are all inside their bands but rated low drags
    // the population's median from 0.25 down to 0.20, and `cache`'s 0.20 channel therefore stops qualifying. Read
    // over the pair the same case PROMOTES; read over the population it is `evidence-none`. Only the population
    // reading is arm A.
    const withThird = [
      candidate('mysql', 0, 3.0, [channel('a', 0.25, true), channel('b', 0.8, true)]),
      candidate('cache', 1, 2.9, [channel('c', 0.2, true), channel('d', 0.7, true)]),
      candidate('auth', 2, 1.0, [channel('e', 0.05, false), channel('f', 0.06, false)]),
    ];
    const population = evidence(withThird, ['cache'], COUNT);
    expect(population.evidence?.median).toBe(0.2);
    expect(population.outcome).toBe('evidence-none');

    const pairOnly = evidence(withThird.slice(0, 2), ['cache'], COUNT);
    expect(pairOnly.evidence?.median).toBe(0.25);
    expect(pairOnly.outcome).toBe('promoted');
  });

  it('takes the LOWER of two middle rates, so the threshold is always a rate a channel carries', () => {
    // With an even population an interpolating median is a number no channel carries. `0.1 0.2 0.3 0.4` has the
    // lower median 0.2 and the interpolated one 0.25; the assertion on the number is what separates them, because
    // both readings refuse this case.
    const four = [
      candidate('mysql', 0, 3.0, [channel('a', 0.1, true), channel('b', 0.2, true)]),
      candidate('cache', 1, 2.9, [channel('c', 0.3, true), channel('d', 0.4, true)]),
    ];
    const decision = evidence(four, ['cache'], COUNT);
    expect(decision.evidence?.median).toBe(0.2);
    expect(decision.evidence).toMatchObject({ pick: 0, leader: 1 });
    expect(decision.outcome).toBe('evidence-behind');
  });

  it('A2 refuses a win whose rarest channel is not rarer than the leader', () => {
    // AHEAD is A1's promotion with the pick's rarest qualifying channel at 0.15 against the leader's 0.05, so the
    // count rule admits and the rarity rule must not: A2 is strictly narrower by construction.
    expect(evidence(AHEAD, ['cache'], COUNT).outcome).toBe('promoted');
    const narrow = evidence(AHEAD, ['cache'], RARITY);
    expect(narrow.outcome).toBe('rarity-miss');
    expect(narrow.evidence).toEqual({
      pick: 3,
      leader: 2,
      median: 0.4,
      rarestPick: 0.15,
      rarestLeader: 0.05,
    });
  });

  it('A2 promotes when the pick wins the count AND its rarest channel is rarer', () => {
    // Its own population, because the comparison needs the pick's rarest rate below the leader's: the median here
    // is 0.20, `mysql` qualifies on 0.15, `cache` on 0.05 and 0.10.
    const rarer = [
      candidate('mysql', 0, 3.0, [channel('a', 0.15, true), channel('b', 0.8, true)]),
      candidate('cache', 1, 2.9, [channel('c', 0.05, true), channel('d', 0.1, true)]),
      candidate('auth', 2, 1.0, [channel('e', 0.2, false), channel('f', 0.3, false)]),
      candidate('billing', 3, 0.5, [channel('g', 0.4, false), channel('h', 0.5, false)]),
    ];
    const decision = evidence(rarer, ['cache'], RARITY);
    expect(decision.evidence).toEqual({
      pick: 2,
      leader: 1,
      median: 0.2,
      rarestPick: 0.05,
      rarestLeader: 0.15,
    });
    expect(decision.outcome).toBe('promoted');
  });

  it('reads no score at all, and reports that it did not', () => {
    // The rule is a property of the CASE, not of the pair: that is the whole claim arm A rests on. Permuting every
    // score — while keeping the order, which is what names the leader — must not move the decision, and the two
    // margin fields must be null rather than a number the rule never used.
    const base = evidence(AHEAD, ['cache'], COUNT);
    const permuted = AHEAD.map((row, index) => ({ ...row, score: index === 0 ? 0.5 : 99 }));
    const other = gatePromotion(
      permuted.map((row) => ({ service: row.service, score: row.score })),
      ['cache'],
      { threshold: 0.03, evidence: { variant: COUNT, candidates: permuted } },
    );
    expect(other.outcome).toBe(base.outcome);
    expect(other.order).toEqual(base.order);
    expect(other.evidence).toEqual(base.evidence);
    expect(base.relGap).toBeNull();
    expect(base.spread).toBeNull();
  });

  it('ignores the threshold, because the evidence rule has none', () => {
    // `null` is the band's control and means nothing to a rule without a dial: a caller that switches the band off
    // and asks for the evidence rule gets the evidence rule, which is why the two do not share a setting.
    for (const threshold of [null, 0, 0.03, 1]) {
      const decision = gatePromotion(
        AHEAD.map((row) => ({ service: row.service, score: row.score })),
        ['cache'],
        { threshold, evidence: { variant: COUNT, candidates: AHEAD } },
      );
      expect(decision.outcome).toBe('promoted');
    }
  });

  it('keeps the three shared refusals ahead of the rule', () => {
    const options = { threshold: 0.03, evidence: { variant: COUNT, candidates: AHEAD } };
    const rows = AHEAD.map((row) => ({ service: row.service, score: row.score }));
    // The model named the leader: `agrees`, and the rule is never consulted.
    expect(gatePromotion(rows, ['mysql'], options).outcome).toBe('agrees');
    // The model named something the order does not carry: `unranked`.
    expect(gatePromotion(rows, ['nobody'], options).outcome).toBe('unranked');
    // A case with no candidate has no leader to compare against.
    expect(gatePromotion([], ['cache'], options).outcome).toBe('unranked');
    // And a one-candidate case cannot disagree, which is the same branch the band reports as `agrees`.
    expect(gatePromotion([rows[0]!], ['mysql'], options).outcome).toBe('agrees');
  });

  it('refuses a case whose candidates carry no channel at all', () => {
    // The median's population is empty, so there is no threshold to count against. `null` rather than a default,
    // because a default of zero would silently make every channel "not rare enough" and turn a missing artifact
    // into a reading about the engine.
    const bare = [candidate('mysql', 0, 3.0, []), candidate('cache', 1, 2.9, [])];
    const decision = evidence(bare, ['cache'], COUNT);
    expect(decision.outcome).toBe('evidence-none');
    expect(decision.evidence).toEqual({
      pick: 0,
      leader: 0,
      median: null,
      rarestPick: null,
      rarestLeader: null,
    });
  });

  it('refuses a case whose leader the fingerprint list does not carry', () => {
    // The two are projections of one artifact, so this cannot happen in a well-formed run. It is a refusal rather
    // than an empty side, because "the pick's opponent is absent" must not read as "the pick has more evidence".
    const rows = AHEAD.map((row) => ({ service: row.service, score: row.score }));
    const decision = gatePromotion(rows, ['cache'], {
      threshold: 0.03,
      evidence: { variant: COUNT, candidates: [AHEAD[1]!] },
    });
    expect(decision.outcome).toBe('evidence-none');
    expect(decision.evidence).toMatchObject({ pick: 0, leader: 0 });
  });

  it('never returns a band outcome, and never returns an evidence outcome from the band', () => {
    // The two rules share a vocabulary and must not share a verdict: this is the fence that keeps a reader from
    // attributing an evidence refusal to the margin, or the other way round.
    const BAND_ONLY = ['reversed', 'degenerate', 'band-miss', 'off'];
    const EVIDENCE_ONLY = ['evidence-none', 'evidence-tie', 'evidence-behind', 'rarity-miss'];
    for (const candidates of [AHEAD, TIED, BEHIND]) {
      for (const variant of [COUNT, RARITY]) {
        const decision = evidence(candidates, ['cache'], variant);
        for (const outcome of BAND_ONLY) expect(decision.outcome).not.toBe(outcome);
        if (decision.outcome !== 'promoted') expect(EVIDENCE_ONLY).toContain(decision.outcome);
      }
      // And the band over the same case reads only the scores it was given, so its evidence reading is null.
      const band = gatePromotion(
        candidates.map((row) => ({ service: row.service, score: row.score })),
        ['cache'],
        { threshold: 0.03 },
      );
      expect(band.evidence).toBeNull();
      for (const outcome of EVIDENCE_ONLY) expect(band.outcome).not.toBe(outcome);
    }
  });

  it('does not let the band read a channel, even when the rows carry one', () => {
    // A runtime fence rather than a type-level one: `PublishedCandidate` has no `channels`, and this asserts that
    // nothing on the band's path reaches for a property the type does not declare.
    const withChannels = AHEAD.map((row) => ({ ...row }));
    const decision = gatePromotion(withChannels, ['cache'], { threshold: 0.03 });
    const plain = gatePromotion(
      AHEAD.map((row) => ({ service: row.service, score: row.score })),
      ['cache'],
      { threshold: 0.03 },
    );
    expect(decision).toEqual(plain);
  });
});
