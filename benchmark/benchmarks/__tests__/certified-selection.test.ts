/**
 * The selective certificate's specification: a certificate read off a *selection* is not the certificate of its parts.
 *
 * ## The defect this module exists to remove
 *
 * A screen prints every row and a reader ships the best one. Certifying that row at the level the table was built at
 * is certifying it as though it had been named in advance — the winner's curse, in the one place a ranking table
 * cannot see it. The arithmetic is the same as the family multiplicity already in `risk-control.ts`, on a second axis:
 * a claim made about the best of `M` candidates has to pay for `M` looks, and paying for them with the level (`δ/M`)
 * is Bonferroni's answer — valid, exact, and about as tight as the union bound was before Holm. Benjamini & Yekutieli,
 * *False discovery rate-adjusted multiple confidence intervals for selected parameters* (JRSS-B 67, 2005), is the same
 * adjustment applied to intervals rather than to tests, and it is the reference this module's level split follows.
 *
 * ## The fixture
 *
 * 500 cases over four families (`alpha`, `beta`, `delta`, `gamma`), level 0.05, and five candidates plus the shipped
 * row. Every expected budget below came from `scipy.stats.binom.cdf`, searched for the smallest `k` whose tail clears
 * the level — not from this implementation, and not from a table the implementation could have been fitted to:
 *
 * | candidate | cases | worst family lost | budget at M = 1 | M = 4 | M = 5 |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | shipped | 400 | 0 | 5 | 6 | 6 |
 * | cleanPlus | 402 | 0 | 5 | 6 | 6 |
 * | plusFive | 405 | 1 (`beta`) | 5 | 7 | 7 |
 * | plusTen | 412 | 2 (`alpha`) | 7 | 9 | 9 |
 * | costly | 420 | 5 (`delta`) | 11 | 13 | 14 |
 * | minusTwo | 398 | 0 | 5 | 6 | 6 |
 *
 * The table is the whole argument for the module: **the order of the candidates by cases is not the order by price**.
 * `costly` answers twenty more cases than the shipped row for seven budget units (2.86 cases each) while `plusFive`
 * answers five more for one (5.00 each), so a tuner that maximizes cases and a tuner that maximizes cases per unit of
 * claim buy different rows — and only the second one can say what it bought.
 *
 * @module benchmarks/__tests__/certified-selection
 */

import { describe, expect, it } from 'vitest';

import {
  formatSelection,
  selectCertified,
  type CandidateReading,
  type Certification,
  type CertifiedSelection,
} from '../src/certified-selection.js';
import type { FrontierPoint } from '../src/gate-rejector.js';
import {
  certifyLosses,
  lossesOf,
  thresholdOf,
  type Correction,
  type LossCount,
  type RiskPopulation,
} from '../src/risk-control.js';

/** The corpus the fixture is about: 500 cases, four families. */
const POP: RiskPopulation = { n: 500, families: ['alpha', 'beta', 'delta', 'gamma'] };

/** A candidate, spelled out: what it answers and which family it pays. */
function reading(
  label: string,
  cases: number,
  losses: readonly LossCount[] = [],
): CandidateReading {
  return { label, cases, losses };
}

const SHIPPED = reading('shipped', 400);
const CLEAN_PLUS = reading('cleanPlus', 402);
const PLUS_FIVE = reading('plusFive', 405, [{ faultType: 'beta', lost: 1 }]);
const PLUS_TEN = reading('plusTen', 412, [{ faultType: 'alpha', lost: 2 }]);
const COSTLY = reading('costly', 420, [{ faultType: 'delta', lost: 5 }]);
const MINUS_TWO = reading('minusTwo', 398);

const CANDIDATES = [CLEAN_PLUS, PLUS_FIVE, PLUS_TEN, COSTLY, MINUS_TWO];

/** The selection the screen's own reader makes: all five rows were looked at. */
const SELECTION: CertifiedSelection = selectCertified(POP, SHIPPED, CANDIDATES, {
  correction: 'holm',
});

/** One reading by label, so an assertion names the row it is about. */
function row(selection: CertifiedSelection, label: string): Certification {
  const found = selection.readings.find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`no reading for ${label}`);
  return found;
}

/** The budget of one loss vector, read the way the module states it. */
function budgetOf(
  losses: readonly LossCount[],
  delta = 0.05,
  correction: Correction = 'holm',
  examined = 1,
): number | null {
  const claim = certifyLosses(losses, POP, delta, correction, examined);
  return claim === null ? null : claim.budget;
}

describe('certifyLosses', () => {
  it('prices a loss vector at the level it is given, count by count', () => {
    // Four families and one candidate: the level is split four ways and no selection is paid for.
    expect(budgetOf([{ faultType: 'alpha', lost: 0 }])).toBe(5);
    expect(budgetOf([{ faultType: 'alpha', lost: 2 }])).toBe(7);
    expect(budgetOf([{ faultType: 'delta', lost: 5 }])).toBe(11);
  });

  it('charges the union bound for every family, which is what makes it loose', () => {
    expect(budgetOf([{ faultType: 'alpha', lost: 2 }], 0.05, 'union')).toBe(9);
    expect(budgetOf([{ faultType: 'delta', lost: 5 }], 0.05, 'union')).toBe(13);
  });

  it('charges one more look per candidate examined, and the count is what pays', () => {
    expect(budgetOf([{ faultType: 'alpha', lost: 0 }], 0.05, 'holm', 4)).toBe(6);
    expect(budgetOf([{ faultType: 'alpha', lost: 0 }], 0.05, 'holm', 11)).toBe(7);
    expect(budgetOf([{ faultType: 'alpha', lost: 2 }], 0.05, 'holm', 4)).toBe(9);
    expect(budgetOf([{ faultType: 'alpha', lost: 2 }], 0.05, 'holm', 11)).toBe(10);
    expect(budgetOf([{ faultType: 'alpha', lost: 5 }], 0.05, 'holm', 11)).toBe(15);
  });

  it('reads a malformed number of looks as one, not as zero', () => {
    // Zero looks is a selection nobody made, and dividing by it would certify everything — the same class of defect the
    // empty-family guard in `risk-control.ts` was written for.
    for (const examined of [0, -3, Number.NaN, 0.4]) {
      expect(budgetOf([{ faultType: 'alpha', lost: 2 }], 0.05, 'holm', examined)).toBe(7);
    }
  });

  it('counts a family the population does not list rather than dropping the loss', () => {
    // A caller whose population is wrong must not be able to certify a claim by omission. Under the union bound the
    // extra family also costs budget, which is where the omission would have shown up.
    const listed = certifyLosses([{ faultType: 'delta', lost: 5 }], POP, 0.05, 'union', 1);
    const extra = certifyLosses([{ faultType: 'extra', lost: 5 }], POP, 0.05, 'union', 1);
    expect(listed?.budget).toBe(13);
    expect(extra?.budget).toBe(14);
    expect(extra?.risks).toHaveLength(5);
    expect(extra?.worst.faultType).toBe('extra');
  });

  it('states no claim when there is no population, rather than a claim about nothing', () => {
    expect(
      certifyLosses([{ faultType: 'alpha', lost: 0 }], { n: 0, families: [] }, 0.05),
    ).toBeNull();
    expect(
      certifyLosses([{ faultType: 'alpha', lost: 0 }], { n: 500, families: [] }, 0.05),
    ).toBeNull();
  });
});

describe('certifyLosses against the frontier reader', () => {
  it('agrees with thresholdOf on the same losses, because there is one definition of the claim', () => {
    const point: FrontierPoint = {
      bound: 0.1,
      cases: 412,
      delta: 12,
      admitted: 12,
      helps: 14,
      hurts: 2,
      regressed: [{ faultType: 'alpha', delta: -2 }],
      loss: 2,
    };
    const threshold = thresholdOf(POP, [point], 0.05, 'holm');
    expect(threshold).not.toBeNull();
    expect(certifyLosses(lossesOf(point), POP, 0.05, 'holm', 1)?.budget).toBe(threshold!.budget);
  });

  it('reads a point that regressed nothing as the clean family it is', () => {
    const point: FrontierPoint = {
      bound: 0.1,
      cases: 400,
      delta: 0,
      admitted: 0,
      helps: 0,
      hurts: 0,
      regressed: [],
      loss: 0,
    };
    expect(lossesOf(point)).toEqual([]);
    expect(certifyLosses(lossesOf(point), POP, 0.05, 'holm', 1)?.budget).toBe(5);
  });
});

describe('selectCertified', () => {
  it('prices every row, the shipped one included', () => {
    expect(SELECTION.readings.map((entry) => entry.label)).toEqual([
      'shipped',
      'cleanPlus',
      'plusFive',
      'plusTen',
      'costly',
      'minusTwo',
    ]);
    expect(row(SELECTION, 'shipped').budget).toBe(6);
    expect(row(SELECTION, 'plusFive').budget).toBe(7);
    expect(row(SELECTION, 'plusTen').budget).toBe(9);
    expect(row(SELECTION, 'costly').budget).toBe(14);
  });

  it('calls a row that buys cases without widening the claim an improvement', () => {
    expect(row(SELECTION, 'cleanPlus').verdict).toBe('improvement');
    expect(row(SELECTION, 'cleanPlus').price).toBeNull();
  });

  it('prices a concession in cases per budget unit', () => {
    expect(row(SELECTION, 'plusFive').verdict).toBe('concession');
    expect(row(SELECTION, 'plusFive').price).toBeCloseTo(5, 12);
    expect(row(SELECTION, 'plusTen').price).toBeCloseTo(4, 12);
    expect(row(SELECTION, 'costly').price).toBeCloseTo(20 / 8, 12);
  });

  it('refuses to call a row an improvement when it answers fewer cases', () => {
    expect(row(SELECTION, 'minusTwo').verdict).toBe('regress');
    expect(row(SELECTION, 'minusTwo').price).toBeNull();
  });

  it('calls a row that answers the same cases for a wider claim flat', () => {
    // The real corpus has one of these — `log 1.2` answers 1 073 against the shipped 1 073 and costs four budget units
    // instead of one — and a rule that filed it as `unchanged` would hide the only row that gives something up for
    // nothing in return.
    const flat = reading('flat', 400, [{ faultType: 'alpha', lost: 2 }]);
    const selection = selectCertified(POP, SHIPPED, [flat], { correction: 'holm' });
    expect(row(selection, 'flat').budget).toBe(7);
    expect(row(selection, 'flat').verdict).toBe('flat');
    expect(row(selection, 'flat').price).toBeNull();
  });

  it('leaves the shipped row unpriced and unqualified', () => {
    expect(row(SELECTION, 'shipped').verdict).toBe('unchanged');
    expect(row(SELECTION, 'shipped').delta).toBe(0);
  });

  it('names the row with the most cases, the cheapest claim, and the best price', () => {
    expect(SELECTION.pointBest?.label).toBe('costly');
    // A tie on budget goes to the row answering more cases, so the tightest claim is also the best one inside it.
    expect(SELECTION.tightest?.label).toBe('cleanPlus');
    expect(SELECTION.bestValue?.label).toBe('plusFive');
  });

  it('says nothing is certifiable when the population states no families', () => {
    const empty = selectCertified({ n: 0, families: [] }, SHIPPED, CANDIDATES);
    expect(empty.readings.every((entry) => entry.budget === null)).toBe(true);
    expect(empty.readings.every((entry) => entry.verdict === 'unclaimed')).toBe(true);
    expect(empty.pointBest).toBeNull();
    expect(empty.tightest).toBeNull();
    expect(empty.bestValue).toBeNull();
  });

  it('returns the shipped row alone for an empty selection', () => {
    const alone = selectCertified(POP, SHIPPED, [], { correction: 'holm' });
    expect(alone.readings).toHaveLength(1);
    expect(alone.pointBest?.label).toBe('shipped');
    expect(alone.tightest?.label).toBe('shipped');
    expect(alone.bestValue).toBeNull();
    expect(alone.examined).toBe(1);
  });

  it('defaults the number of looks to the number of candidates', () => {
    expect(SELECTION.examined).toBe(5);
    expect(selectCertified(POP, SHIPPED, CANDIDATES, { examined: 2 }).examined).toBe(2);
    expect(selectCertified(POP, SHIPPED, CANDIDATES, { examined: 0 }).examined).toBe(1);
  });

  it('prices a selection against a shipped row that already lost cases', () => {
    // The real case: the row that ships is not clean, so an improvement is a row that buys cases at no wider claim
    // than the claim the shipped row itself costs.
    const dirty = reading('dirty', 400, [{ faultType: 'alpha', lost: 2 }]);
    const better = reading('better', 410, [{ faultType: 'alpha', lost: 2 }]);
    const worse = reading('worse', 410, [{ faultType: 'alpha', lost: 4 }]);
    const selection = selectCertified(POP, dirty, [better, worse], { correction: 'holm' });
    expect(row(selection, 'dirty').budget).toBe(8);
    expect(row(selection, 'better').verdict).toBe('improvement');
    expect(row(selection, 'worse').verdict).toBe('concession');
    // Eleven budget units against eight, for ten more cases.
    expect(row(selection, 'worse').price).toBeCloseTo(10 / 3, 12);
  });

  it('refuses to price a row that loses the whole corpus, and does not let it win on budget', () => {
    // A family that loses every case has no rate below one consistent with it, so no budget this corpus can express
    // certifies the row. It is priced as `unclaimed` rather than as the corpus's own size — the ceiling the bisection's
    // upper end would otherwise have reported — and it does not take the `tightest` slot from a row that can be priced.
    const wiped = reading('wiped', 0, [{ faultType: 'alpha', lost: 500 }]);
    const selection = selectCertified(POP, SHIPPED, [wiped, PLUS_TEN], { correction: 'holm' });
    expect(row(selection, 'wiped').budget).toBeNull();
    expect(row(selection, 'wiped').verdict).toBe('unclaimed');
    expect(selection.tightest?.label).toBe('shipped');
    expect(selection.tightest?.budget).not.toBeNull();
  });

  it('states no claim at all when the row that ships is the one no corpus can price', () => {
    // Every other row's verdict is read against the shipped row, so a shipped row with no certificate leaves nothing to
    // be relative to: the clean row below is reported as unclaimed rather than as an improvement on nothing.
    const wiped = reading('wiped', 0, [{ faultType: 'alpha', lost: 500 }]);
    const selection = selectCertified(POP, wiped, [CLEAN_PLUS], { correction: 'holm' });
    expect(row(selection, 'wiped').budget).toBeNull();
    expect(row(selection, 'cleanPlus').verdict).toBe('unclaimed');
    expect(selection.bestValue).toBeNull();
  });

  it('breaks a tie on price by the cases it buys', () => {
    // Two rows at the same price are not the same buy: five cases for one budget unit against ten for two. The tie goes
    // to the more cases, which is the rule every other reader here uses, so the footer cannot name the smaller one.
    const selection = selectCertified(
      POP,
      SHIPPED,
      [PLUS_FIVE, reading('twice', 410, [{ faultType: 'alpha', lost: 2 }])],
      {
        correction: 'holm',
        examined: 3,
      },
    );
    expect(row(selection, 'plusFive').price).toBeCloseTo(5, 12);
    expect(row(selection, 'twice').price).toBeCloseTo(5, 12);
    expect(selection.bestValue?.label).toBe('twice');
  });

  it('orders its winners independently of the order the rows arrived in', () => {
    const reversed = selectCertified(POP, SHIPPED, [...CANDIDATES].reverse(), {
      correction: 'holm',
    });
    expect(reversed.pointBest?.label).toBe(SELECTION.pointBest?.label);
    expect(reversed.tightest?.label).toBe(SELECTION.tightest?.label);
    expect(reversed.bestValue?.label).toBe(SELECTION.bestValue?.label);
  });

  it('reads the level it was given rather than the default', () => {
    const strict = selectCertified(POP, SHIPPED, CANDIDATES, { delta: 0.01, correction: 'holm' });
    expect(strict.delta).toBe(0.01);
    expect(row(SELECTION, 'shipped').budget).toBe(6);
    expect(row(strict, 'shipped').budget).toBe(8);
    expect(row(strict, 'plusTen').budget).toBe(11);
  });
});

describe('formatSelection', () => {
  it('prints the claim first, because a budget without its level is a number', () => {
    expect(formatSelection(SELECTION).split('\n')[0]).toBe(
      'selective certificate — n 500   families 4   delta 0.05   correction holm   examined 5',
    );
  });

  it('prints one row per candidate with its verdict', () => {
    const text = formatSelection(SELECTION);
    expect(text).toContain('plusFive');
    expect(text).toContain('concession');
    expect(text).toContain('improvement');
    expect(text).toContain('regress');
  });

  it('names the row it can certify as an improvement, and what it cost', () => {
    expect(formatSelection(SELECTION)).toContain(
      'certified improvement: cleanPlus answers +2 at the shipped claim of 6 — nothing was conceded',
    );
  });

  it('names the larger of two certified improvements, in either order', () => {
    // Two rows concede nothing; the footer names the one that buys more, which is the comparison the reduce exists for.
    // Both orders are asserted because a reduce that kept the first row it saw would pass one of them.
    const smaller = reading('smaller', 401);
    const larger = reading('larger', 403);
    for (const rows of [
      [smaller, larger],
      [larger, smaller],
    ]) {
      const selection = selectCertified(POP, SHIPPED, rows, { correction: 'holm' });
      expect(formatSelection(selection)).toContain('certified improvement: larger answers +3');
    }
  });

  it('names the three winners in the footer, and the price that decided the third', () => {
    const text = formatSelection(SELECTION);
    expect(text).toContain('most cases: costly');
    expect(text).toContain('tightest claim: cleanPlus');
    expect(text).toContain('best price: plusFive');
  });

  it('says no row is certified to improve on what ships, when none is', () => {
    const none = selectCertified(POP, SHIPPED, [MINUS_TWO, COSTLY], { correction: 'holm' });
    expect(formatSelection(none)).toContain('no certified improvement');
  });

  it('renders an unclaimed row without inventing a budget', () => {
    const text = formatSelection(selectCertified({ n: 0, families: [] }, SHIPPED, CANDIDATES));
    expect(text).toContain('unclaimed');
    expect(text).toContain('no claim can be stated');
    expect(text).not.toContain('NaN');
  });
});
