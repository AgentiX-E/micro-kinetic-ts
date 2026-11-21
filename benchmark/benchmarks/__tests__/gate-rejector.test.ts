/**
 * The rejector's specification, stated on a corpus whose every number was computed by hand.
 *
 * The fixture is twelve cases over four families. The gated term is `dir`, configured at **3**; the other name,
 * `base`, is unconditional at 1. A near case leads by 0.1 and a far one by 0.8, so their reaches are exactly `1/30`
 * and `4/15` of the term's own span, and `0.05` and `0.30` separate them.
 *
 * | case | family | accepts | off | on | reach | run admits | acting |
 * | --- | --- | --- | --- | --- | ---: | --- | --- |
 * | `a/help/near` | alpha | y | miss | answer | 1/30 | no | **fixes** |
 * | `b/help/near` | delta | y | miss | answer | 1/30 | no | **fixes** |
 * | `c/hurt/far` | beta | x | answer | miss | 4/15 | no | **breaks** |
 * | `d/help/near` | beta | y | miss | answer | 1/30 | no | **fixes** |
 * | `e/admitted` | gamma | x | answer | answer | 1.033 | **yes** | nothing |
 * | `f/single` | gamma | x | the only candidate | same | ∞ | no | cannot |
 * | `g/hurt/far` | alpha | x | answer | miss | 4/15 | no | **breaks** |
 * | `i/hurt/far` | alpha | x | answer | miss | 4/15 | no | **breaks** |
 * | `j/hurt/far` | gamma | x | answer | miss | 4/15 | **yes** | **breaks** |
 * | `h1…h4/help/far` | delta | y | miss | answer | 4/15 | no | **fixes** |
 *
 * The run answers alpha 2, beta 1, delta 0, gamma 2 — **five**, and the term held off would answer six, because `j`
 * shipped and broke a case. That difference is what makes the baseline a thing a test can get wrong.
 *
 * A bound of 0.05 admits only the near cases: alpha 3, beta 2, delta 1, gamma 2 = **eight**, with no family below the
 * run. A bound of 0.30 also admits the far ones: alpha falls to **one** while delta reaches five, so the corpus
 * answers **nine** — one more case, one family short. That pair is the whole finding, and every assertion below is
 * one of its terms.
 *
 * @module benchmarks/__tests__/gate-rejector
 */

import { describe, expect, it } from 'vitest';

import type { FrontierPoint, RejectorCase } from '../src/gate-rejector.js';
import {
  DEFAULT_LOSS_BUDGETS,
  DEFAULT_REACH_BOUNDS,
  boundOf,
  budgetScanOf,
  calibrationOf,
  cheapestOf,
  chowReport,
  constrainedOf,
  formatBudgets,
  formatChow,
  formatFrontier,
  frontierOf,
  parseRejectorArgs,
  rejectorCasesOf,
  runTotalOf,
} from '../src/gate-rejector.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';

/** The gated term. */
const TERM = 'dir';
/** The unconditional term every case carries. */
const BASE = 'base';

/**
 * One candidate row.
 *
 * @param id - The service.
 * @param base - The unconditional term's slope.
 * @param dir - The gated term's slope.
 * @param recorded - The gated term's recorded coefficient.
 * @returns The parsed candidate.
 */
function candidate(id: string, base: number, dir: number, recorded: number): ParsedTermCandidate {
  const terms: TermDumpTriple[] = [
    [BASE, 1, base],
    [TERM, recorded, dir],
  ];
  return { id, score: 0, terms };
}

/**
 * One case.
 *
 * @param datapack - Its id, which the fold assignment hashes.
 * @param faultType - Its family.
 * @param accepted - The accepted answers.
 * @param rows - Its candidates.
 * @returns The parsed case.
 */
function kase(
  datapack: string,
  faultType: string,
  accepted: readonly string[],
  rows: readonly ParsedTermCandidate[],
): ParsedTermCase {
  return { datapack, faultType, accepted, candidates: rows };
}

/**
 * A case whose baseline leads by 0.1: acting moves the lead and nothing else.
 *
 * @param datapack - Its id.
 * @param faultType - Its family.
 * @param accepted - The accepted answers.
 * @returns The case, refused by the run.
 */
function near(datapack: string, faultType: string, accepted: readonly string[]): ParsedTermCase {
  return kase(datapack, faultType, accepted, [
    candidate('x', 0.5, 0, 0),
    candidate('y', 0.4, 1, 0),
  ]);
}

/**
 * A case whose baseline leads by 0.8: acting still overturns it, but only because the term reaches three points.
 *
 * @param datapack - Its id.
 * @param faultType - Its family.
 * @param accepted - The accepted answers.
 * @returns The case, refused by the run.
 */
function far(datapack: string, faultType: string, accepted: readonly string[]): ParsedTermCase {
  return kase(datapack, faultType, accepted, [
    candidate('x', 0.9, 0, 0),
    candidate('y', 0.1, 1, 0),
  ]);
}

const CORPUS: readonly ParsedTermCase[] = [
  near('a/help/near', 'alpha', ['y']),
  near('b/help/near', 'delta', ['y']),
  far('c/hurt/far', 'beta', ['x']),
  near('d/help/near', 'beta', ['y']),
  kase('e/admitted', 'gamma', ['x'], [candidate('x', 3.5, 0.2, 3), candidate('y', 0.4, 1, 3)]),
  kase('f/single', 'gamma', ['x'], [candidate('x', 1, 0.5, 0)]),
  far('g/hurt/far', 'alpha', ['x']),
  far('i/hurt/far', 'alpha', ['x']),
  far('h1/help/far', 'delta', ['y']),
  far('h2/help/far', 'delta', ['y']),
  far('h3/help/far', 'delta', ['y']),
  far('h4/help/far', 'delta', ['y']),
  kase('j/hurt/far', 'gamma', ['x'], [candidate('x', 0.9, 0, 3), candidate('y', 0.1, 1, 3)]),
];

const ROWS = rejectorCasesOf(CORPUS, TERM);

/** One rejector row, built directly for the tests that are about the tally rather than about reading a dump. */
function row(
  datapack: string,
  faultType: string,
  off: boolean,
  on: boolean,
  reach = 1 / 30,
): RejectorCase {
  return { datapack, faultType, lead: 0, reach, shipped: false, off, on };
}

describe('rejectorCasesOf', () => {
  it('reads the configured coefficient as the recorded maximum, so a recorded zero is a refusal', () => {
    expect(ROWS.map((entry) => entry.shipped)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('reads the lead off the arm with the term OFF, so the ordering is the baseline the gate decided about', () => {
    // `j` shipped AND the term reordered it: its off-arm scores are 0.9 against 0.1 and its on-arm scores 0.9
    // against 3.1. Only the off arm names the lead the gate saw; a reader that took the gap off the run's own order
    // would report 2.2, which is the gap the term CREATED.
    const admitted = ROWS[12]!;
    expect(admitted.shipped).toBe(true);
    expect(admitted.off).toBe(true);
    expect(admitted.on).toBe(false);
    expect(admitted.lead).toBeCloseTo(0.8, 12);
    expect(admitted.reach).toBeCloseTo(4 / 15, 12);
  });

  it('reads a champion the term cannot reach as a reach above one, not as a missing measurement', () => {
    // `e` shipped and its lead is 3.1 against a span of 3, so no bound can overturn it — which is a fact about the
    // case, and `admitted: true` at every bound comes from the coefficient rather than from the reach.
    const neutral = ROWS[4]!;
    expect(neutral.reach).toBeCloseTo(3.1 / 3, 12);
    expect(neutral.off).toBe(true);
    expect(neutral.on).toBe(true);
  });

  it("divides by the term's own span, so a term that moves at most half a point is reached twice as fast", () => {
    const rows = rejectorCasesOf(
      [
        ...CORPUS,
        kase('x/half', 'alpha', ['x'], [candidate('x', 0.5, 0, 0), candidate('y', 0.4, 0.5, 0)]),
      ],
      TERM,
    );
    // Read against the same configured weight of 3, the half-span term needs only `lead / 1.5` reaches to overturn.
    expect(rows[rows.length - 1]!.reach).toBeCloseTo(0.1 / 1.5, 12);
  });

  it('reports a lead of infinity for a case with no rival, which no finite bound can overturn', () => {
    const single = ROWS[5]!;
    expect(single.lead).toBe(Infinity);
    expect(single.reach).toBe(Infinity);
    // `Infinity < Infinity` is false, so even an unbounded reach is refused: the statement is "cannot be reordered",
    // not "must be reordered last".
    expect(frontierOf([single], [0.5, Infinity]).map((point) => point.admitted)).toEqual([0, 0]);
    expect(frontierOf([single], [0.5]).map((point) => point.cases)).toEqual([1]);
  });

  it('reports a reach of infinity when no candidate measured the term', () => {
    const mixed = rejectorCasesOf(
      [...CORPUS, kase('z/none', 'alpha', ['x'], [{ id: 'x', score: 0, terms: [[BASE, 1, 1]] }])],
      TERM,
    );
    expect(mixed[mixed.length - 1]!.reach).toBe(Infinity);
    expect(mixed[mixed.length - 1]!.off).toBe(true);
    expect(mixed[mixed.length - 1]!.on).toBe(true);
  });

  it('throws when no case records the term', () => {
    expect(() => rejectorCasesOf([CORPUS[0]!], 'absent')).toThrow(/no case records absent/);
  });

  it('reads the lead over the whole ranking, not over the first two candidates', () => {
    // A third candidate between the two leaders changes nothing, and one below both exercises the other arm of the
    // scan: the lead is a property of the pool, and a reader that stopped at two would miss the second maximum
    // whenever the dump's order is not the score order.
    const three = rejectorCasesOf(
      [
        ...CORPUS,
        kase(
          'n/three',
          'alpha',
          ['x'],
          [
            {
              id: 'x',
              score: 0,
              terms: [
                [BASE, 1, 0.5],
                [TERM, 0, 0],
              ],
            },
            {
              id: 'y',
              score: 0,
              terms: [
                [BASE, 1, 0.4],
                [TERM, 0, 1],
              ],
            },
            {
              id: 'z',
              score: 0,
              terms: [
                [BASE, 1, 0.1],
                [TERM, 0, 0.2],
              ],
            },
          ],
        ),
      ],
      TERM,
    );
    const parsed = three[three.length - 1]!;
    expect(parsed.lead).toBeCloseTo(0.1, 12);
    expect(parsed.reach).toBeCloseTo(1 / 30, 12);
  });

  it('reads a case with no candidate at all as having no lead to overturn', () => {
    const empty = rejectorCasesOf([...CORPUS, kase('o/empty', 'alpha', [], [])], TERM);
    expect(empty[empty.length - 1]!.lead).toBe(Infinity);
    expect(empty[empty.length - 1]!.reach).toBe(Infinity);
  });

  it('reads an arm strictly, so a level case is not an answer', () => {
    const level = rejectorCasesOf(
      [
        ...CORPUS,
        kase('l/level', 'alpha', ['y'], [candidate('x', 0.5, 0, 0), candidate('y', 0.5, 1, 0)]),
      ],
      TERM,
    );
    // Read against the corpus's configuration of 3: `y` moves to 3.5 while `x` stays at 0.5.
    // The baseline's two candidates are level, so the off arm answers optimistically and NOT strictly; the on arm
    // moves the accepted one clear of the rival.
    const parsed = level[level.length - 1]!;
    expect(parsed.off).toBe(false);
    expect(parsed.on).toBe(true);
  });
});

describe('frontierOf', () => {
  const frontier = frontierOf(ROWS, [0.05, 0.3]);

  it("keeps the run's own admissions at every bound, so a gate change is read on the deployed population", () => {
    expect(frontier.map((point) => point.admitted)).toEqual([5, 12]);
    expect(ROWS[4]!.shipped).toBe(true);
  });

  it('counts only the admissions the run did not already make', () => {
    expect(frontier[0]!.helps).toBe(3);
    expect(frontier[0]!.hurts).toBe(0);
    expect(frontier[1]!.helps).toBe(7);
    expect(frontier[1]!.hurts).toBe(3);
  });

  it('answers eight cases at the near bound and nine at the far one, which costs alpha a case', () => {
    expect(frontier[0]).toMatchObject({ cases: 8, delta: 3, regressed: [], loss: 0 });
    expect(frontier[1]).toMatchObject({
      cases: 9,
      delta: 4,
      regressed: [{ faultType: 'alpha', delta: -1 }],
      loss: 1,
    });
  });

  it("reads the run's total off the shipped coefficients rather than off the term held off", () => {
    // `j` shipped and broke a case, so the run answers five where the term held off answers six. A reader that used
    // the off arm as the baseline would print every delta one case low and call a 9 a 8.
    expect(runTotalOf(ROWS)).toBe(5);
    expect(frontier.map((point) => point.delta)).toEqual([3, 4]);
  });

  it('reads the default ladder when the caller names no bounds', () => {
    expect(frontierOf(ROWS).map((point) => point.bound)).toEqual([...DEFAULT_REACH_BOUNDS]);
  });

  it('orders regressed families by magnitude and then by name', () => {
    // Two alpha hurts and one each in beta and gamma, all admitted at every bound: the tie between beta and gamma is
    // what the name clause is for, and `Map` insertion order would otherwise decide it.
    const rows: RejectorCase[] = [
      row('a1', 'alpha', true, false),
      row('a2', 'alpha', true, false),
      row('b1', 'gamma', true, false),
      row('c1', 'beta', true, false),
    ];
    const point = frontierOf(rows, [0.05])[0]!;
    expect(point.regressed).toEqual([
      { faultType: 'alpha', delta: -2 },
      { faultType: 'beta', delta: -1 },
      { faultType: 'gamma', delta: -1 },
    ]);
    // Inserted in the other order, the tie is still resolved by name: the comparator's second arm is what a reader
    // of the table never sees and could not otherwise check.
    const reversed: RejectorCase[] = [
      row('b1', 'gamma', true, false),
      row('c1', 'beta', true, false),
    ];
    expect(frontierOf(reversed, [0.05])[0]!.regressed).toEqual([
      { faultType: 'beta', delta: -1 },
      { faultType: 'gamma', delta: -1 },
    ]);
    // And a name that sorts AFTER the one it is compared against reaches the comparator's other arm, which no table
    // printed in name order would ever exercise.
    const descending: RejectorCase[] = [
      row('d1', 'delta', true, false),
      row('e1', 'gamma', true, false),
    ];
    expect(frontierOf(descending, [0.05])[0]!.regressed).toEqual([
      { faultType: 'delta', delta: -1 },
      { faultType: 'gamma', delta: -1 },
    ]);
    expect(point.loss).toBe(4);
  });

  it('counts an admitted case neither as a fix nor as a break when both arms agree', () => {
    const points = frontierOf([row('a', 'alpha', true, true, 0)], [0.05]);
    expect(points[0]).toMatchObject({ admitted: 1, helps: 0, hurts: 0, cases: 1, delta: 0 });
  });

  it('reads a bound that loses a case as a negative delta with no sign', () => {
    const rows = [row('a', 'alpha', true, false), row('b', 'beta', true, true)];
    const lines = formatFrontier(frontierOf(rows, [0.05]), 2).split('\n');
    expect(lines[3]).toContain('    -1');
    expect(lines[5]).toBe('no bound clears the standing condition (no regressed fault type)');
  });

  it('reports an empty frontier for no bounds', () => {
    expect(frontierOf(ROWS, [])).toEqual([]);
  });
});

describe('constrainedOf', () => {
  it('separates the admissible point from the best one', () => {
    const { allowed, best } = constrainedOf(frontierOf(ROWS, [0.05, 0.3]));
    expect(allowed?.bound).toBe(0.05);
    expect(allowed?.cases).toBe(8);
    expect(best?.bound).toBe(0.3);
    expect(best?.cases).toBe(9);
  });

  it('reports no admissible point rather than an empty grid', () => {
    const { allowed, best } = constrainedOf(frontierOf(ROWS, [0.3]));
    expect(allowed).toBeNull();
    expect(best?.bound).toBe(0.3);
  });

  it('keeps the earlier point when two answer the same number of cases', () => {
    const { allowed } = constrainedOf(frontierOf(ROWS, [0.04, 0.05]));
    expect(allowed?.bound).toBe(0.04);
  });

  it('reports nothing at all for an empty frontier', () => {
    expect(constrainedOf([])).toEqual({ allowed: null, best: null });
  });
});

describe('the acceptance condition as a budget', () => {
  // "No regressed fault type" is the condition at budget zero. Every rung above it states a trade in the corpus's
  // own unit — cases — so a reader can price the condition instead of reading a veto as a fact about the statistic.
  const frontier = frontierOf(ROWS, [0.05, 0.3]);

  it('reproduces the veto at zero and the peak at one, on the same frontier', () => {
    const [vetoed, one] = budgetScanOf(frontier, [0, 1]);
    expect(vetoed!.budget).toBe(0);
    expect(vetoed!.point?.bound).toBeCloseTo(0.05, 12);
    expect(vetoed!.point?.cases).toBe(8);
    expect(vetoed!.point?.regressed).toEqual([]);
    // The rung that costs exactly one case buys the whole peak: nine cases, alpha one short of the run.
    expect(one!.point?.bound).toBeCloseTo(0.3, 12);
    expect(one!.point?.cases).toBe(9);
    expect(one!.point?.regressed).toEqual([{ faultType: 'alpha', delta: -1 }]);
  });

  it('agrees with the veto at zero, so the two are one rule rather than two', () => {
    // `constrainedOf` is budget zero with a name. If these could disagree, a caller would have to know which of the
    // two spellings of the standing condition a report was written against.
    expect(budgetScanOf(frontier, [0])[0]!.point).toEqual(constrainedOf(frontier).allowed);
  });

  it('reports an unsatisfiable budget as null, not as an empty list', () => {
    // A budget no point meets is a MEASUREMENT of the frontier — the condition cannot be bought that cheaply — and
    // the distinction from "the grid was empty" is the whole reason the field is nullable.
    const point: FrontierPoint = {
      bound: 0.1,
      cases: 9,
      delta: 4,
      admitted: 6,
      helps: 5,
      hurts: 1,
      regressed: [{ faultType: 'zeta', delta: -2 }],
      loss: 2,
    };
    expect(budgetScanOf([point], [0, 1, 2]).map((rung) => rung.point)).toEqual([null, null, point]);
  });

  it('reads the deepest SINGLE family loss, not the summed one', () => {
    // The condition is per family: three families one case short each is a different failure from one family three
    // short, and the summed loss cannot tell them apart.
    const point: FrontierPoint = {
      bound: 0.2,
      cases: 9,
      delta: 3,
      admitted: 7,
      helps: 6,
      hurts: 3,
      regressed: [
        { faultType: 'a', delta: -1 },
        { faultType: 'b', delta: -1 },
        { faultType: 'c', delta: -1 },
      ],
      loss: 3,
    };
    expect(budgetScanOf([point], [0, 1, 2]).map((rung) => rung.point === null)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('breaks a tie on cases toward the earliest rung of the ladder', () => {
    const early = { ...frontierOf(ROWS, [0.3])[0]!, loss: 1 };
    const late = { ...frontierOf(ROWS, [0.5])[0]!, loss: 1 };
    const scan = budgetScanOf([early, late], [1]);
    expect(scan[0]!.point?.bound).toBeCloseTo(0.3, 12);
  });

  it('reads a budget the arithmetic cannot place as the strictest rung', () => {
    // A negative budget is unsatisfiable and a NaN compares false against everything, so reading either as "no
    // limit" would turn a typo into the widest condition the module can state. The rung is normalised instead, and
    // the echo says which rung was actually read.
    for (const budget of [Number.NaN, -1, Number.NEGATIVE_INFINITY]) {
      const [rung] = budgetScanOf(frontier, [budget]);
      expect(rung!.budget).toBe(0);
      expect(rung!.point).toEqual(constrainedOf(frontier).allowed);
    }
    // A fractional budget is legal and means what it says: no family may lose more than 0.5 cases, i.e. none.
    expect(budgetScanOf(frontier, [0.5])[0]!.point?.cases).toBe(8);
  });

  it('reads no rung at all from an empty ladder', () => {
    expect(budgetScanOf(frontier, [])).toEqual([]);
  });
});

describe('cheapestOf', () => {
  it('finds a free point when the frontier has one', () => {
    // The fixture's bound 0.05 loses no family, so the standing condition IS met somewhere and the cheapest rung is
    // zero — the number that says the condition costs nothing on this corpus, which is what the real archive denies.
    const cheapest = cheapestOf(frontierOf(ROWS));
    expect(cheapest?.budget).toBe(0);
    expect(cheapest?.point.regressed).toEqual([]);
  });

  it('names the smallest budget when every cheap rung is empty', () => {
    // The archive's shape: no point is free, so the question is not "which rung" but "how cheap can compliance get".
    const cheapest = cheapestOf(frontierOf(ROWS, [0.3]));
    expect(cheapest?.budget).toBe(1);
    expect(cheapest?.point.bound).toBeCloseTo(0.3, 12);
    expect(cheapest?.point.regressed).toEqual([{ faultType: 'alpha', delta: -1 }]);
  });

  it('keeps the earliest point when two are equally cheap, and takes a later cheaper one', () => {
    const [near, far] = frontierOf(ROWS, [0.05, 0.3]);
    const deep = { ...near!, regressed: [{ faultType: 'x', delta: -2 }] };
    const alsoDeep = { ...far!, regressed: [{ faultType: 'y', delta: -2 }] };
    expect(cheapestOf([deep, alsoDeep])?.budget).toBe(2);
    expect(cheapestOf([deep, alsoDeep])?.point.bound).toBeCloseTo(0.05, 12);
    // A later point can be the cheaper one: the scan must not stop at the first point it can price.
    const shallow = { ...far!, regressed: [{ faultType: 'y', delta: -1 }] };
    expect(cheapestOf([deep, shallow])?.budget).toBe(1);
    expect(cheapestOf([deep, shallow])?.point.bound).toBeCloseTo(0.3, 12);
  });

  it('reports nothing for an empty frontier', () => {
    expect(cheapestOf([])).toBeNull();
  });
});

describe('formatBudgets', () => {
  it('prints the price of each rung and the families that pay it', () => {
    const text = formatBudgets(
      budgetScanOf(frontierOf(ROWS, [0.05, 0.3]), [0, 1]),
      runTotalOf(ROWS),
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('run 5   budgets 0, 1');
    expect(lines[2]).toContain('budget');
    expect(lines[2]).toContain('buy/loss');
    expect(lines[3]).toContain('0.05');
    expect(lines[3]).toContain('8');
    expect(lines[4]).toContain('0.30');
    expect(lines[4]).toContain('alpha -1');
  });

  it('says so when the corpus buys nothing per case lost', () => {
    // A rung whose delta is zero or negative buys nothing, and a ratio printed as `0.0` would read as "cheap".
    const point = { ...frontierOf(ROWS, [0.3])[0]!, cases: 5, delta: 0 };
    const text = formatBudgets([{ budget: 1, point }], 5);
    expect(text.split('\n')[3]).toContain('—');
  });

  it('names an unsatisfiable rung rather than printing a blank row', () => {
    const text = formatBudgets(budgetScanOf(frontierOf(ROWS, [0.3]), [0]), runTotalOf(ROWS));
    expect(text.split('\n')[3]).toContain('no bound');
  });

  it('adds the cheapest rung the frontier offers when the caller read one', () => {
    // Without this line a ladder whose bottom two rungs are empty says nothing about how cheap compliance can get,
    // and "no bound" then reads as "impossible" rather than "not at this budget".
    const frontier = frontierOf(ROWS, [0.05, 0.3]);
    const text = formatBudgets(budgetScanOf(frontier, [0]), runTotalOf(ROWS), cheapestOf(frontier));
    expect(text.split('\n').at(-1)).toBe('cheapest rung: 0 — reach < 0.05 answers 8 (+3), price 0');
  });

  it('prints a header for an empty ladder', () => {
    expect(formatBudgets([], 5).split('\n')[0]).toBe('run 5   budgets none');
  });
});

describe('calibrationOf', () => {
  it('reads the two reaches the corpus carries and nothing else', () => {
    const blocks = calibrationOf(ROWS);
    // Three near cases, all fixed; eight far cases, four of them fixed — `c`, `g`, `i` and the shipped `j` break.
    expect(blocks.map((block) => block.p)).toEqual([1, 0.5]);
    expect(blocks.map((block) => block.cases)).toEqual([3, 8]);
    expect(blocks[0]!.lo).toBeCloseTo(1 / 30, 12);
    expect(blocks[1]!.hi).toBeCloseTo(0.8 / 3, 12);
  });

  it('leaves out the cases whose outcome does not depend on the term', () => {
    expect(calibrationOf(ROWS.filter((entry) => entry.off === entry.on))).toEqual([]);
    expect(calibrationOf(ROWS.filter((entry) => entry.datapack === 'f/single'))).toEqual([]);
  });

  it('keeps a monotone calibration as one block per reach', () => {
    const blocks = calibrationOf([
      row('a', 'f', false, true, 0.1),
      row('b', 'f', false, true, 0.2),
      row('c', 'f', true, false, 0.3),
    ]);
    expect(blocks.map((block) => block.p)).toEqual([1, 1, 0]);
    expect(blocks.map((block) => block.cases)).toEqual([1, 1, 1]);
  });

  it('pools exactly the violating pair, and leaves a block that is already above it alone', () => {
    // `p` rises from 0 to 1 between the second and third reach, so those two pool to 1/2; the first block at `p = 1`
    // is above the pooled value and is not dragged down with them. Pool-adjacent-violators, not a moving average.
    const blocks = calibrationOf([
      row('a', 'f', false, true, 0.1),
      row('b', 'f', true, false, 0.2),
      row('c', 'f', false, true, 0.3),
    ]);
    expect(blocks).toEqual([
      { lo: 0.1, hi: 0.1, p: 1, cases: 1 },
      { lo: 0.2, hi: 0.3, p: 0.5, cases: 2 },
    ]);
  });

  it('carries a pooled block back over the block it now equals', () => {
    // `p` runs 1, 0, 0.5. The second and third pool to a third, and the walk steps BACK to compare the merged block
    // with the first — which is where a pool-adjacent violator that moved forward only would stop.
    const blocks = calibrationOf([
      row('a', 'f', false, true, 0.1),
      row('b', 'f', true, false, 0.2),
      row('c', 'f', false, true, 0.3),
      row('d', 'f', true, false, 0.3),
    ]);
    expect(blocks).toEqual([
      { lo: 0.1, hi: 0.1, p: 1, cases: 1 },
      { lo: 0.2, hi: 0.3, p: 1 / 3, cases: 3 },
    ]);
  });

  it('pools a violation in the first block without stepping back off the start of the list', () => {
    const blocks = calibrationOf([
      row('a', 'f', true, false, 0.1),
      row('b', 'f', false, true, 0.2),
    ]);
    expect(blocks).toEqual([{ lo: 0.1, hi: 0.2, p: 0.5, cases: 2 }]);
  });

  it('aggregates ties by reach, so a block is a set of cases and not of rows', () => {
    const blocks = calibrationOf([
      { ...row('a', 'f', false, true), reach: 0.1 },
      { ...row('b', 'f', true, false), reach: 0.1 },
      { ...row('c', 'f', false, true), reach: 0.1 },
    ]);
    expect(blocks).toEqual([{ lo: 0.1, hi: 0.1, p: 2 / 3, cases: 3 }]);
  });

  it('leaves an unbounded reach out, because it is not a reach any bound can compare', () => {
    expect(calibrationOf([{ ...row('a', 'f', false, true), reach: Infinity }])).toEqual([]);
  });
});

describe('boundOf', () => {
  const blocks = [
    { lo: 0.1, hi: 0.1, p: 0.9, cases: 10 },
    { lo: 0.2, hi: 0.2, p: 0.6, cases: 10 },
    { lo: 0.3, hi: 0.3, p: 0.4, cases: 10 },
    { lo: 0.4, hi: 0.4, p: 0.05, cases: 10 },
  ];

  it('takes the largest reach whose posterior clears the symmetric bar', () => {
    expect(boundOf(blocks, 1)).toBeCloseTo(0.2, 12);
  });

  it('demands more confidence as a broken case gets dearer than a fixed one', () => {
    expect(boundOf(blocks, 0.6)).toBeCloseTo(0.3, 12);
    expect(boundOf(blocks, 3)).toBeCloseTo(0.1, 12);
    expect(boundOf(blocks, 20)).toBe(-1);
  });

  it('admits everything at a rate of zero', () => {
    expect(boundOf(blocks, 0)).toBeCloseTo(0.4, 12);
  });

  it('refuses the term everywhere when the first block already fails the bar', () => {
    expect(boundOf([{ lo: 0.1, hi: 0.1, p: 0.4, cases: 5 }], 1)).toBe(-1);
    expect(boundOf([], 1)).toBe(-1);
  });

  it('reads a malformed rate as the symmetric bar', () => {
    expect(boundOf(blocks, Number.NaN)).toBeCloseTo(0.2, 12);
    expect(boundOf(blocks, -3)).toBeCloseTo(0.2, 12);
  });
});

describe('chowReport', () => {
  it("spends the calibration's own bound on the corpus it was fitted on, as the frontier's peak", () => {
    // The near block is perfect and the far block is 4/8, which clears Chow's symmetric bar of 1/2 — so the calibrated
    // bound is the far reach, and the corpus answers nine against the run's five.
    const bound = boundOf(calibrationOf(ROWS), 1);
    expect(bound).toBeCloseTo(4 / 15, 12);
    const [point] = frontierOf(ROWS, [bound]);
    expect(point).toMatchObject({ cases: 9, delta: 4, loss: 1 });
  });

  it('refuses the far plays when a broken case is worth three fixed ones', () => {
    const bound = boundOf(calibrationOf(ROWS), 3);
    expect(bound).toBeCloseTo(1 / 30, 12);
    expect(frontierOf(ROWS, [bound])[0]).toMatchObject({ cases: 8, delta: 3, loss: 0 });
  });

  it('learns nothing from a single training case, which is what a two-case fold has', () => {
    // `foldOf` puts the help in fold 1 and the hurt in fold 0, and `k/neutral` rides in fold 0 so the corpus records a
    // configuration at all — a corpus of refusals has no recoverable weight, which is the theorem `conditional-weight`
    // states. The hurt teaches refusal and the help's bound is a thirties of the span, too short to reach a hurt that
    // needs four fifteenths, so neither fold moves a case.
    const split = [
      near('a/help/near', 'alpha', ['y']),
      far('c/hurt/far', 'beta', ['x']),
      kase('k/neutral', 'gamma', ['x'], [candidate('x', 3.5, 0.2, 3), candidate('y', 0.4, 1, 3)]),
    ];
    const report = chowReport(rejectorCasesOf(split, TERM), 2);
    // Fold 0 holds the hurt and the neutral, so it trains on the help and spends a thirties of the span; fold 1 holds
    // the help, trains on the hurt, and refuses. The far hurt is out of the first bound's reach and the near help is
    // the answer either way, so both folds read the run.
    expect(report.folds.map((fold) => fold.bound)[0]).toBeCloseTo(1 / 30, 12);
    expect(report.folds.map((fold) => fold.bound)[1]).toBe(-1);
    expect(report.baseline).toBe(2);
    expect(report.heldOut).toBe(2);
    expect(report.delta).toBe(0);
  });

  it('loses a case out of fold when the training side taught it the wrong thing', () => {
    // Both cases sit a thirties of the span from their baseline, one a help and one a hurt. The fold that trains on
    // the help therefore admits the hurt at its own bound and breaks it — the cost an out-of-fold reading exists to
    // expose, and the reason a bound is never reported on the corpus that chose it.
    const split = [
      near('p/near/help', 'alpha', ['y']),
      near('q/near/hurt', 'beta', ['x']),
      kase('k/neutral', 'gamma', ['x'], [candidate('x', 3.5, 0.2, 3), candidate('y', 0.4, 1, 3)]),
    ];
    const report = chowReport(rejectorCasesOf(split, TERM), 2);
    // Fold 0 refuses (it trained on the hurt) and answers its own pair; fold 1 trained on the help, admits the hurt at
    // its own bound, and loses it — one case, one family, one loss.
    expect(report.folds.map((fold) => fold.bound)[0]).toBe(-1);
    expect(report.folds.map((fold) => fold.bound)[1]).toBeCloseTo(1 / 30, 12);
    expect(report.baseline).toBe(2);
    expect(report.heldOut).toBe(1);
    expect(report.delta).toBe(-1);
    expect(report.loss).toBe(1);
  });

  it('sums the folds and reports one bound per fold', () => {
    const report = chowReport(ROWS, 5);
    expect(report.folds).toHaveLength(5);
    expect(report.bounds).toHaveLength(5);
    expect(report.heldOut).toBe(report.folds.reduce((sum, fold) => sum + fold.heldOut, 0));
    expect(report.baseline).toBe(report.folds.reduce((sum, fold) => sum + fold.baseline, 0));
    expect(report.delta).toBe(report.heldOut - report.baseline);
    expect(report.loss).toBe(report.folds.reduce((sum, fold) => sum + fold.loss, 0));
  });
});

describe('the formatters', () => {
  it('renders the frontier and both verdicts', () => {
    const lines = formatFrontier(frontierOf(ROWS, [0.05, 0.3]), 5).split('\n');
    expect(lines[0]).toBe('run 5   bounds 2');
    expect(lines[2]).toBe('  reach  cases   delta  admitted  helps  hurts  loss  regressed');
    expect(lines[3]).toContain('0.05');
    expect(lines[3]).toContain('+3');
    expect(lines[4]).toContain('alpha -1');
    expect(lines[6]).toBe('admissible best: reach < 0.05 answers 8 (+3)');
    expect(lines[7]).toBe('unconstrained best: reach < 0.3 answers 9 (+4), price 1');
  });

  it('prints one verdict when the admissible point is also the best one', () => {
    const lines = formatFrontier(frontierOf(ROWS, [0.05]), 5).split('\n');
    expect(lines[5]).toBe('admissible best: reach < 0.05 answers 8 (+3)');
    expect(lines).toHaveLength(6);
  });

  it('says so when no bound clears the condition', () => {
    const lines = formatFrontier(frontierOf(ROWS, [0.3]), 5).split('\n');
    expect(lines[5]).toBe('no bound clears the standing condition (no regressed fault type)');
    expect(lines[6]).toBe('unconstrained best: reach < 0.3 answers 9 (+4), price 1');
  });

  it('renders the out-of-fold table and names a refused bound as none', () => {
    const report = chowReport(ROWS, 2);
    const lines = formatChow(report).split('\n');
    expect(lines[0]).toBe(
      `folds 2   held-out ${report.heldOut}   run ${report.baseline}   ` +
        `delta ${report.delta >= 0 ? '+' : ''}${report.delta}   loss ${report.loss}`,
    );
    expect(lines[1]).toMatch(/^bounds chosen: (none|\d\.\d{3})(, (none|\d\.\d{3}))?$/);
    expect(lines[3]).toBe('  fold  bound  held-out   run  delta  loss  regressed');
    // A corpus the term never changes leaves the calibration empty, and an empty calibration refuses everywhere: the
    // formatter must print `none` rather than a bound of zero, which would admit the reach-zero cases.
    const silent = chowReport(rejectorCasesOf([CORPUS[4]!], TERM), 2);
    expect(silent.bounds).toEqual([-1, -1]);
    expect(formatChow(silent).split('\n')[1]).toBe('bounds chosen: none, none');
  });
});

describe('parseRejectorArgs', () => {
  it('reads every flag', () => {
    expect(
      parseRejectorArgs([
        '--terms',
        'd.ndjson',
        '--term',
        'x',
        '--folds',
        '3',
        '--rate',
        '0.25',
        '--budget',
        '2',
      ]),
    ).toEqual({
      terms: 'd.ndjson',
      term: 'x',
      folds: 3,
      rate: 0.25,
      budgets: [2],
      // The level the certified ladder is read at: a flag of the same command, so it is parsed here and nowhere else.
      delta: 0.05,
    });
  });

  it('defaults to the shipped term, five folds, the symmetric verdict and the whole ladder', () => {
    expect(parseRejectorArgs(['--terms', 'd.ndjson'])).toEqual({
      terms: 'd.ndjson',
      term: 'failedEdge',
      folds: 5,
      rate: 1,
      budgets: DEFAULT_LOSS_BUDGETS,
      delta: 0.05,
    });
  });

  it('accumulates a repeated budget flag in the order given', () => {
    // One rung per flag rather than a comma list: a comma list has to state what an empty field means, and this
    // command already carries three single-valued flags.
    expect(parseRejectorArgs(['--terms', 'd', '--budget', '3', '--budget', '0']).budgets).toEqual([
      3, 0,
    ]);
    expect(() => parseRejectorArgs(['--terms', 'd', '--budget'])).toThrow(
      /--budget needs a number/,
    );
    expect(() => parseRejectorArgs(['--terms', 'd', '--budget', '-1'])).toThrow(/non-negative/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--budget', 'x'])).toThrow(/non-negative/);
  });

  it('refuses a missing path, an unknown flag and a malformed number', () => {
    expect(() => parseRejectorArgs([])).toThrow(/--terms is required/);
    expect(() => parseRejectorArgs(['--nope'])).toThrow(/unknown argument --nope/);
    expect(() => parseRejectorArgs(['--terms'])).toThrow(/--terms needs a path/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--term'])).toThrow(/--term needs a name/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--folds'])).toThrow(/--folds needs a number/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--folds', '0'])).toThrow(/positive integer/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--folds', 'x'])).toThrow(/positive integer/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--rate'])).toThrow(/--rate needs a number/);
    expect(() => parseRejectorArgs(['--terms', 'd', '--rate', '-1'])).toThrow(/non-negative/);
  });
});
