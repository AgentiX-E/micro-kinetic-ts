/**
 * Unit tests for the dual-family membership grid: the instrument that says whether the flag paid the RIGHT candidate.
 *
 * `dual-family-census.ts` prints how wide the family is. Iteration 364's finding — 15 of 76 misses decided by a term
 * whose every δ is exactly its weight — needed the other quantity, and a weight sweep alone could not supply it: a
 * mispriced term has one value that pays everywhere, a mis-fired one selects the wrong components at every price, and
 * a density cannot separate the two. These assertions cover the four cells, the flip weight, the budget split, the
 * offline repricing and the paired test, each by the way it could lie rather than by its happy path.
 *
 * @module benchmarks/__tests__/dual-family-membership
 */

import type { RootCauseResult, ScoreTerm } from '../../packages/core/src/types/faults.js';
import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  flipBudget,
  isHit,
  mcnemarExact,
  movementOf,
  readMembership,
  reprice,
  toFlagCase,
  weightToFlip,
  type FlagCandidate,
  type FlagCase,
} from '../src/dual-family-membership.js';

const SHIPPED = 0.25;

/**
 * A candidate.
 *
 * @param serviceId - Its id.
 * @param score - Its `finalScore`.
 * @param member - Whether the flag paid it.
 * @returns The candidate, with the contribution a member carries at the shipped weight.
 */
function candidate(serviceId: string, score: number, member = false): FlagCandidate {
  return { serviceId, score, dual: member ? SHIPPED : 0, member };
}

/**
 * A case.
 *
 * @param order - The ranking, best first.
 * @param accepted - The accepted root causes; defaults to the last-ranked candidate, so a test that wants a miss says
 *   nothing about it.
 * @returns The case.
 */
function flagCase(order: readonly FlagCandidate[], accepted?: readonly string[]): FlagCase {
  return {
    caseId: 'c',
    cell: 'boutique/codedefect',
    accepted: accepted ?? [order[order.length - 1]!.serviceId],
    order,
  };
}

describe('the membership grid', () => {
  it('files a paid winner and an unpaid truth as the harmful cell, and only that cell can blame the flag', () => {
    const reading = readMembership([flagCase([candidate('w', 1, true), candidate('t', 0.5)])]);

    expect(reading.misses.winnerOnly).toBe(1);
    expect(reading.misses.truthOnly).toBe(0);
    expect(reading.misses.bothIn).toBe(0);
    expect(reading.misses.neither).toBe(0);
    expect(reading.hits.cases).toBe(0);
    expect(reading.misses.cases).toBe(1);
  });

  it('files a paid truth under an unpaid winner as the cell the term exists for', () => {
    // The winner is a symptom the flag did NOT pay, and the truth is in the family but still lost to it. This is the
    // cell the term was designed for — and the reading it gives is that the flag was RIGHT and the rest of the score
    // outvoted it, which is a different repair from the harmful cell one column over.
    const reading = readMembership([
      flagCase([candidate('w', 1), candidate('t', 0.5, true)], ['t']),
    ]);

    expect(reading.misses.truthOnly).toBe(1);
    expect(reading.misses.winnerOnly).toBe(0);
    expect(
      weightToFlip(flagCase([candidate('w', 1), candidate('t', 0.5, true)], ['t'])),
    ).toBeUndefined();
  });

  it('cannot file a single-label HIT in the two asymmetric cells, because a hit’s winner IS the truth', () => {
    // The corruption check the grid's docblock claims: with one accepted service, a hit means `winner === truth`, so
    // `winnerOnly` and `truthOnly` are unreachable and a non-zero count would mean the grid is reading the wrong row.
    const reading = readMembership([
      flagCase([candidate('t', 1, true), candidate('w', 0.5)], ['t']),
      flagCase([candidate('t', 1), candidate('w', 0.5)], ['t']),
    ]);

    expect(reading.hits.cases).toBe(2);
    expect(reading.hits.winnerOnly).toBe(0);
    expect(reading.hits.truthOnly).toBe(0);
    expect(reading.hits.bothIn).toBe(1);
    expect(reading.hits.neither).toBe(1);
  });

  it('calls a family that paid both FLAT, because no price can separate two candidates paid alike', () => {
    const reading = readMembership([
      flagCase([candidate('w', 1, true), candidate('t', 0.5, true)]),
    ]);

    expect(reading.misses.bothIn).toBe(1);
    // And the flag cannot close this one at any weight, which is the difference between "flat" and "repairable".
    expect(
      weightToFlip(
        reading.misses.bothIn === 1
          ? flagCase([candidate('w', 1, true), candidate('t', 0.5, true)])
          : flagCase([]),
      ),
    ).toBeUndefined();
  });

  it('counts an empty family once, and files the case under neither', () => {
    const reading = readMembership([flagCase([candidate('w', 1), candidate('t', 0.5)])]);

    expect(reading.emptyFamilies).toBe(1);
    expect(reading.medianMembers).toBe(0);
    expect(reading.misses.neither).toBe(1);
  });

  it('reports the median family size over the non-empty families only, not over every case', () => {
    // Three cases: families of 1, 5 and none. A median over all three would be 1 and would describe a third of the
    // population as a member of nothing — the density error `dual-family-census.ts` exists to avoid.
    const sizes = [[true], [true, true, true, true, true], []];
    const reading = readMembership(
      sizes.map((flags, index) =>
        flagCase(
          [
            ...flags.map((member, i) => candidate(`m${i}`, 10 - i, member)),
            candidate(`t${index}`, 0),
          ],
          [`t${index}`],
        ),
      ),
    );

    expect(reading.emptyFamilies).toBe(1);
    expect(reading.medianMembers).toBe(1);
  });

  it('counts a truth the engine never ranked as unanswerable rather than as a measured exclusion', () => {
    // The truth is not in the ranking at all. Membership cannot be read, and `neither` would claim the flag measured
    // it and said no.
    const reading = readMembership([
      flagCase([candidate('w', 1, true), candidate('x', 0.5)], ['absent-service']),
    ]);

    expect(reading.misses.truthAbsent).toBe(1);
    expect(reading.misses.neither).toBe(0);
    expect(reading.misses.winnerOnly).toBe(0);
  });

  it('answers NaN for precision when no winner was a member, because a share of nothing is not zero', () => {
    const reading = readMembership([flagCase([candidate('w', 1), candidate('t', 0.5)])]);
    expect(reading.precision).toBeNaN();
  });

  it('reads precision as the share of paid winners whose truth is also paid', () => {
    // Two paid winners with the truth paid (flat, harmless), one paid winner with the truth unpaid (harmful).
    const cases = [
      flagCase([candidate('w1', 1, true), candidate('t1', 0.5, true)]),
      flagCase([candidate('w2', 1, true), candidate('t2', 0.5, true)]),
      flagCase([candidate('w3', 1, true), candidate('t3', 0.5)]),
    ];
    expect(readMembership(cases).precision).toBeCloseTo(2 / 3, 12);
  });

  it('reads the hit from the corpus’s whole accepted set, so an alias is a hit', () => {
    const one = flagCase([candidate('alias', 1), candidate('x', 0.5)], ['alias', 'canonical']);
    expect(isHit(one)).toBe(true);
  });

  it('calls an empty ranking a miss and not a crash', () => {
    const one = flagCase([], ['t']);
    expect(isHit(one)).toBe(false);
    expect(weightToFlip(one)).toBeUndefined();
  });

  it('reads a case with no accepted label at all as unanswerable rather than as a miss', () => {
    // A corpus that names no root cause cannot have its membership read, and both the grid and the flip weight have to
    // say so instead of indexing `accepted[0]` and calling the resulting `undefined` a miss.
    const one: FlagCase = {
      caseId: 'c',
      cell: 'x/y',
      accepted: [],
      order: [candidate('w', 1, true)],
    };
    const reading = readMembership([one]);

    expect(reading.misses.truthAbsent).toBe(1);
    expect(weightToFlip(one)).toBeUndefined();
    // And the budget cannot charge it either: a case with no truth has no harmful cell to be in.
    expect(flipBudget([one], SHIPPED).harmful).toBe(0);
  });
});

describe('the weight that would flip a case', () => {
  it('is the score gap when the winner is paid and the truth is not', () => {
    // At weight W the winner holds 1 + W and the truth 0.5; the truth overtakes once W > 0.5.
    const one = flagCase([candidate('w', 1, true), candidate('t', 0.5)]);
    expect(weightToFlip(one)).toBeCloseTo(0.5, 12);
  });

  it('is undefined when both are paid, because no weight separates equals', () => {
    expect(
      weightToFlip(flagCase([candidate('w', 1, true), candidate('t', 0.5, true)])),
    ).toBeUndefined();
  });

  it('is undefined when only the truth is paid, because the flag already helps', () => {
    expect(weightToFlip(flagCase([candidate('w', 1), candidate('t', 0.5, true)]))).toBeUndefined();
  });

  it('is undefined when the truth was never ranked, rather than reading an absent candidate as a zero gap', () => {
    const one = flagCase([candidate('w', 1, true), candidate('x', 0.5)], ['absent']);
    expect(weightToFlip(one)).toBeUndefined();
  });

  it('agrees with the budget’s own arithmetic on every harmful case', () => {
    // The budget inlines the division because in the harmful cell the membership difference is exactly −1. That is an
    // optimisation only while the two agree, so the agreement is asserted rather than assumed.
    const cases = [
      flagCase([candidate('w1', 1, true), candidate('t1', 0.9)]),
      flagCase([candidate('w2', 2, true), candidate('t2', 0.4)]),
    ];
    const budget = flipBudget(cases, SHIPPED);
    expect(budget.gaps).toEqual(cases.map((one) => weightToFlip(one)));
  });

  it('is undefined for a hit, since there is nothing to flip', () => {
    const hit = flagCase([candidate('t', 1, true), candidate('w', 0.5)], ['t']);
    expect(weightToFlip(hit)).toBeUndefined();
  });
});

describe('the flip budget', () => {
  it('splits the harmful cell by whether the needed weight is inside the shipped one', () => {
    // Three harmful cases needing 0.1, 0.25 and 0.9. At the shipped 0.25 two are covered — turning the term off
    // repairs the first two — and the third is a case the flag touches without deciding.
    const cases = [
      flagCase([candidate('w1', 1, true), candidate('t1', 0.9)]),
      flagCase([candidate('w2', 1, true), candidate('t2', 0.75)]),
      flagCase([candidate('w3', 1, true), candidate('t3', 0.1)]),
    ];
    const budget = flipBudget(cases, SHIPPED);

    expect(budget.harmful).toBe(3);
    expect(budget.withinWeight).toBe(2);
    expect(budget.beyondWeight).toBe(1);
    expect(budget.gaps).toHaveLength(3);
    // Ascending, so a reader can see WHERE the weight sits in the distribution rather than only how many fit.
    expect([...budget.gaps]).toEqual([...budget.gaps].sort((a, b) => a - b));
  });

  it('ignores every case outside the harmful cell, including a hit whose winner is paid', () => {
    const cases = [
      flagCase([candidate('t', 1, true), candidate('w', 0.5)], ['t']),
      flagCase([candidate('w', 1, true), candidate('t', 0.5, true)]),
      flagCase([candidate('w', 1), candidate('t', 0.5)]),
    ];
    const budget = flipBudget(cases, SHIPPED);

    expect(budget.harmful).toBe(0);
    expect(budget.gaps).toEqual([]);
  });
});

describe('the offline repricing', () => {
  it('is the identity at the shipped weight, so an arm that reports movement there is measuring its own bug', () => {
    const cases = [
      flagCase([candidate('w', 1, true), candidate('t', 0.5)]),
      flagCase([candidate('t', 1, true), candidate('w', 0.5)], ['t']),
    ];
    const arm = reprice(cases, SHIPPED);
    expect(arm.correct).toEqual(cases.map(isHit));
  });

  it('turns the term off at weight 0 and flips only the cases whose gap it covered', () => {
    const covered = flagCase([candidate('w', 1, true), candidate('t', 0.9)]);
    const uncovered = flagCase([candidate('w', 1, true), candidate('t', 0.1)]);
    const arm = reprice([covered, uncovered], 0);

    expect(arm.correct).toEqual([true, false]);
    expect(arm.overall).toBe(0.5);
  });

  it('discounts a member at a negative weight, which no command line can state', () => {
    // The mirror arm: a member is a symptom. At −0.25 the paid winner drops by 0.5 relative to the shipped ordering.
    const one = flagCase([candidate('w', 1, true), candidate('t', 1)], ['t']);
    // Shipped, the bonus puts the member first and the case is a miss; discounting it by 0.5 hands the case to the truth.
    expect(reprice([one], SHIPPED).correct).toEqual([false]);
    expect(reprice([one], -SHIPPED).correct).toEqual([true]);
  });

  it('breaks a reprice tie in the engine’s own order rather than by service id', () => {
    // Two candidates whose scores the reprice equalises; the engine put `z` first, and `z` must stay first. A
    // comparator on the id would put `a` first and report a movement that is the sort's, not the weight's.
    // `finalScore` ALREADY contains the bonus, so the member's 1.25 is 1.00 of its own plus the 0.25 the flag paid.
    const one = flagCase([candidate('z', 1.25, true), candidate('a', 1.25)], ['a']);
    // At the shipped weight the two ARE tied at 1.25, the engine's own order (`z` first) decides, and the case is a
    // miss. At weight 0 the member's 0.25 is gone and `a` wins on its own score, which is not a tie at all.
    expect(reprice([one], SHIPPED).correct).toEqual([false]);
    expect(reprice([one], 0).correct).toEqual([true]);
  });

  it('answers NaN for an empty population instead of a rate it did not measure', () => {
    expect(reprice([], SHIPPED).overall).toBeNaN();
  });
});

describe('the paired movement', () => {
  it('counts a gain and a loss and neither for an untouched case', () => {
    expect(movementOf([true, false], [false, false])).toMatchObject({ gained: 0, lost: 1 });
    // Both directions, because a movement counter that only ever adds `lost` reports an arm as harmful by construction.
    expect(movementOf([true, false], [true, true])).toMatchObject({ gained: 1, lost: 0 });
    expect(movementOf([true, false], [true, false])).toMatchObject({ gained: 0, lost: 0 });
  });

  it('refuses to pair two populations of different sizes', () => {
    expect(movementOf([true], [true, false])).toBeUndefined();
  });

  it('reads the exact two-sided McNemar p, and 1 when nothing moved', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
    // 8 gains against 2 losses: 2 × P(X ≤ 2 | n = 10, p = ½) = 2 × 56/1024.
    expect(mcnemarExact(8, 2)).toBeCloseTo((2 * 56) / 1024, 12);
    // Symmetric in its arguments, because the test is two-sided.
    expect(mcnemarExact(2, 8)).toBeCloseTo(mcnemarExact(8, 2), 12);
    // One gain against one loss is the least surprising outcome there is.
    expect(mcnemarExact(1, 1)).toBe(1);
  });
});

describe('the reading off a runner record', () => {
  const generator = new SyntheticBenchmarkGenerator(11);

  /**
   * A record whose terms carry the flag on the named positions.
   *
   * @param members - Positions in the ranking the flag paid.
   * @param finalScore - Whether the producer set `finalScore`; `false` leaves only `confidence`.
   * @returns The record.
   */
  function recordOf(members: readonly number[], finalScore = true): DiagnosedCaseRecord {
    const benchCase = generator.generateRCAEvalCase('cpu', 5);
    const ids = [...benchCase.callGraph.nodes.keys()];
    const ranking: RootCauseResult[] = ids.map((serviceId, index) => {
      const terms: readonly ScoreTerm[] = [
        { name: 'dualFamily', contribution: members.includes(index) ? SHIPPED : 0 },
      ];
      return {
        serviceId,
        faultType: 'cpu' as never,
        confidence: 1 - index / 100,
        rank: index + 1,
        evidenceMetrics: [],
        propagationDepth: 0,
        propagationErrorBound: 0,
        viaTreeSearch: false,
        ...(finalScore ? { finalScore: ids.length - index } : {}),
        terms,
      };
    });
    return {
      case: benchCase,
      graph: { callGraph: benchCase.callGraph, detectedCycles: [] },
      ranking,
      callGraph: benchCase.callGraph,
    } as unknown as DiagnosedCaseRecord;
  }

  it('reads membership off the term’s contribution, and the score off finalScore', () => {
    const one = toFlagCase(recordOf([0]), 'boutique/codedefect');
    expect(one.order[0]!.member).toBe(true);
    expect(one.order[0]!.score).toBe(5);
    expect(one.order[1]!.member).toBe(false);
  });

  it('falls back to confidence for a producer that sets no finalScore, rather than reading undefined', () => {
    const one = toFlagCase(recordOf([0], false), 'boutique/codedefect');
    expect(one.order[0]!.score).toBe(1);
    expect(Number.isFinite(one.order[1]!.score)).toBe(true);
  });

  it('treats a candidate with no breakdown as unpaid, because an absent term is not a paid one', () => {
    const record = recordOf([0]);
    const stripped: DiagnosedCaseRecord = {
      ...record,
      ranking: record.ranking.map((one, index) =>
        index === 0 ? { ...one, terms: undefined } : one,
      ),
    };
    expect(toFlagCase(stripped, 'boutique/codedefect').order[0]!.member).toBe(false);
  });
});
