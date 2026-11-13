/**
 * The risk-control module's specification, on a corpus whose every count was chosen by hand and whose every reference
 * value came from an implementation that is not this one (`scipy.stats.beta.ppf`, exact to twelve decimals).
 *
 * The fixture is 1 052 cases over three families, built so that losses and gains coexist — a corpus where every bound
 * only ever loses cases would let a test pass while the module preferred the narrowest point.
 *
 * | family | breakers | fixers | reach |
 * | --- | ---: | ---: | ---: |
 * | alpha | 4 | 2 | 0.05 |
 * | beta | 8 | 4 | 0.20 |
 * | gamma | 0 | 30 at 0.05, 40 at 0.20 | 0.05 and 0.20 |
 * | gamma | 0 | 964 unreachable | ∞ |
 *
 * The run answers 976. A bound of 0.05 answers **1 004** and loses **two** alpha cases; a bound of 0.20 answers
 * **1 040** and loses two alpha cases and **four** beta ones. Three families means each is held to `δ/3`, and at
 * `δ = 0.05` that is 1/60.
 *
 * | bound | cases | delta | alpha lost | beta lost | certifiable at |
 * | ---: | ---: | ---: | ---: | ---: | ---: |
 * | 0.05 | 1 004 | +28 | 2 | 0 | k ≥ 8 |
 * | 0.20 | 1 040 | +64 | 2 | 4 | k ≥ 11 |
 *
 * The two numbers that make this module worth existing are **8** and **11**, not 2 and 4: a family observed losing
 * two cases of a thousand is only certifiable at a budget of eight, because 2/1 052 is an estimate and
 * `0.007349597846` is the smallest loss proportion consistent with it at 95 %. Every assertion below is one term of
 * that statement, or the arithmetic that turns it into a budget.
 *
 * @module benchmarks/__tests__/risk-control
 */

import { describe, expect, it } from 'vitest';

import type { FrontierPoint, RejectorCase } from '../src/gate-rejector.js';
import { frontierOf, parseRejectorArgs } from '../src/gate-rejector.js';
import {
  DEFAULT_DELTA,
  binomCdfUpTo,
  certifyOf,
  exactUpperOf,
  floorOf,
  formatCertified,
  populationOf,
  risksAt,
  thresholdOf,
} from '../src/risk-control.js';

/** One case, spelled out: the fixture only ever varies reach, outcome and shipment. */
function row(
  faultType: string,
  reach: number,
  off: boolean,
  on: boolean,
  shipped = false,
): RejectorCase {
  return { datapack: 'fixture', faultType, lead: 1, reach, shipped, off, on };
}

/** A case a bound can break: answered with the term off, missed with it on, and not the run's own admission. */
function breaker(faultType: string, reach: number): RejectorCase {
  return row(faultType, reach, true, false);
}

/** A case a bound can fix: missed with the term off, answered with it on. */
function fixer(faultType: string, reach: number): RejectorCase {
  return row(faultType, reach, false, true);
}

/** A case no bound can touch: one candidate, so the reach is infinite and the answer never moves. */
function filler(faultType: string): RejectorCase {
  return row(faultType, Number.POSITIVE_INFINITY, true, true);
}

/** The corpus: 6 alpha, 12 beta and 1 034 gamma cases, 1 052 in all. */
const ROWS: readonly RejectorCase[] = [
  ...Array.from({ length: 4 }, () => breaker('alpha', 0.05)),
  ...Array.from({ length: 2 }, () => fixer('alpha', 0.05)),
  ...Array.from({ length: 8 }, () => breaker('beta', 0.2)),
  ...Array.from({ length: 4 }, () => fixer('beta', 0.2)),
  ...Array.from({ length: 30 }, () => fixer('gamma', 0.05)),
  ...Array.from({ length: 40 }, () => fixer('gamma', 0.2)),
  ...Array.from({ length: 964 }, () => filler('gamma')),
];

/** The two bounds the fixture separates, plus one that changes nothing beyond the second. */
const BOUNDS: readonly number[] = [0.05, 0.2, 0.9];

/** The frontier the certification reads; every loss below comes from it rather than from a second admission rule. */
const POINTS: readonly FrontierPoint[] = frontierOf(ROWS, BOUNDS);

/** The claim the corpus supports: its size and its three families. */
const POP = populationOf(ROWS);

/** Three families, so every family is held to a third of the family-wise level. */
const FAMILIES = 3;

/** The family-wise level the fixture is read at. */
const DELTA = 0.05;

describe('exactUpperOf', () => {
  it('closes the zero-loss case in form: 1 − δ^(1/n)', () => {
    // The closed form is the one case where the answer is arithmetic rather than a root, so it is the one place a
    // quantile implementation can be checked without a table.
    expect(exactUpperOf(0, 10, 0.05)).toBeCloseTo(1 - Math.pow(0.05, 1 / 10), 12);
    expect(exactUpperOf(0, 10, 0.05)).toBeCloseTo(0.258865550893, 12);
  });

  it('matches Clopper–Pearson at a mid count, both levels', () => {
    expect(exactUpperOf(5, 10, 0.05)).toBeCloseTo(0.777558898992, 12);
    expect(exactUpperOf(5, 10, 0.025)).toBeCloseTo(0.812913971553, 12);
  });

  it('matches the reference the fixture is built on', () => {
    expect(exactUpperOf(2, 1052, 1 / 60)).toBeCloseTo(0.007349597846, 12);
    expect(exactUpperOf(4, 1052, 1 / 60)).toBeCloseTo(0.010283637149, 12);
    expect(exactUpperOf(0, 1052, 1 / 60)).toBeCloseTo(0.003884398641, 12);
  });

  it('is 1 when every case was lost, because nothing rules out a rate of one', () => {
    expect(exactUpperOf(10, 10, 0.05)).toBe(1);
    expect(exactUpperOf(11, 10, 0.05)).toBe(1);
  });

  it('is 1 for a corpus with no cases, rather than dividing by nothing', () => {
    expect(exactUpperOf(0, 0, 0.05)).toBe(1);
  });

  it('reads a negative count as none and a malformed one as no information', () => {
    expect(exactUpperOf(-3, 10, 0.05)).toBeCloseTo(exactUpperOf(0, 10, 0.05), 12);
    expect(exactUpperOf(Number.NaN, 10, 0.05)).toBe(1);
  });

  it('rises with the count, falls with the corpus and rises as the level tightens', () => {
    expect(exactUpperOf(3, 1000, 0.05)).toBeGreaterThan(exactUpperOf(2, 1000, 0.05));
    expect(exactUpperOf(2, 1000, 0.05)).toBeGreaterThan(exactUpperOf(2, 2000, 0.05));
    expect(exactUpperOf(2, 1000, 0.005)).toBeGreaterThan(exactUpperOf(2, 1000, 0.05));
  });

  it('keeps a level it cannot use at the default rather than certifying everything', () => {
    // A level of zero would demand certainty, a level of one would demand nothing; both are malformed, and the module
    // reads them at the default instead of at the end of the interval a typo happens to name.
    expect(exactUpperOf(2, 1000, 0)).toBeCloseTo(exactUpperOf(2, 1000, 0.05), 12);
    expect(exactUpperOf(2, 1000, 1)).toBeCloseTo(exactUpperOf(2, 1000, 0.05), 12);
    expect(exactUpperOf(2, 1000, Number.NaN)).toBeCloseTo(exactUpperOf(2, 1000, 0.05), 12);
  });
});

describe('binomCdfUpTo', () => {
  it('is the tail the quantile is a root of', () => {
    // This identity is the definition of the bound: plugging the bound back into the tail returns the level.
    for (const lost of [0, 1, 2, 7]) {
      const upper = exactUpperOf(lost, 400, 0.05);
      expect(binomCdfUpTo(lost, 400, upper)).toBeCloseTo(0.05, 9);
    }
  });

  it('sums a case small enough to check by hand: 1 and 4 of 16 at a half', () => {
    expect(binomCdfUpTo(1, 4, 0.5)).toBeCloseTo(5 / 16, 12);
  });

  it('sums a rate below one case per corpus, where the terms fall rather than rise', () => {
    // The recurrence walks up to the mode and back down, and every bound this module solves for sits at the mode, so
    // the falling half is only reached when the rate is far below the count — which is exactly the case a bisection
    // step above the answer produces. The value is the definition written out: q^n + n·p·q^(n−1).
    const q = 1 - 0.001;
    expect(binomCdfUpTo(1, 100, 0.001)).toBeCloseTo(
      Math.pow(q, 100) + 100 * 0.001 * Math.pow(q, 99),
      12,
    );
  });

  it('is certain at a rate of zero and empty at a rate of one, below the last case', () => {
    expect(binomCdfUpTo(0, 10, 0)).toBe(1);
    expect(binomCdfUpTo(10, 10, 1)).toBe(1);
    expect(binomCdfUpTo(9, 10, 1)).toBe(0);
  });

  it('is 0 for a rate above one, which no observation can be consistent with', () => {
    expect(binomCdfUpTo(2, 10, 1.5)).toBe(0);
  });

  it('is 0 below no cases and 1 from the last one on', () => {
    expect(binomCdfUpTo(-1, 10, 0.5)).toBe(0);
    expect(binomCdfUpTo(10, 10, 0.5)).toBe(1);
    expect(binomCdfUpTo(12, 10, 0.5)).toBe(1);
  });

  it('is 0 over an empty corpus below its own size, and certain above it', () => {
    expect(binomCdfUpTo(-1, 0, 0.5)).toBe(0);
    expect(binomCdfUpTo(0, 0, 0.5)).toBe(1);
  });

  it('reads a corpus size it cannot use as no corpus at all', () => {
    expect(binomCdfUpTo(0, Number.NaN, 0.5)).toBe(1);
    expect(binomCdfUpTo(-1, Number.NaN, 0.5)).toBe(0);
  });

  it('reads a rate it cannot place as no evidence against any rate', () => {
    expect(binomCdfUpTo(2, 10, Number.NaN)).toBe(1);
  });
});

describe('populationOf', () => {
  it('states the size and every family, sorted', () => {
    expect(POP).toEqual({ n: 1052, families: ['alpha', 'beta', 'gamma'] });
  });

  it('counts a family the frontier never charges, because the claim is about all of them', () => {
    // `gamma` loses nothing at any bound and is still in the population: it is one of the claims that has to hold, and
    // a population read off the regressions would certify the corpus by testing only its failures.
    expect(POP.families).toContain('gamma');
    expect(frontierOf(ROWS, [0.2])[0]?.regressed.map((loss) => loss.faultType)).not.toContain(
      'gamma',
    );
  });

  it('is empty for a corpus with no cases', () => {
    expect(populationOf([])).toEqual({ n: 0, families: [] });
  });
});

describe('risksAt', () => {
  /** The point at a named bound, so a test names a bound rather than an index. */
  function at(bound: number): FrontierPoint {
    const point = POINTS.find((candidate) => Math.abs(candidate.bound - bound) < 1e-12);
    if (point === undefined) throw new Error(`fixture has no bound ${bound}`);
    return point;
  }

  it('prices what the bound loses in every family, including the ones it does not touch', () => {
    const risks = risksAt(at(0.05), POP, DELTA / FAMILIES);
    const byName = new Map(risks.map((risk) => [risk.faultType, risk]));
    expect(risks).toHaveLength(FAMILIES);
    expect(byName.get('alpha')?.lost).toBe(2);
    expect(byName.get('beta')?.lost).toBe(0);
    expect(byName.get('gamma')?.lost).toBe(0);
    // A clean family is not unpriced: zero losses of a thousand is a rate bounded away from zero, and that bound is
    // what a budget has to clear before its owner can claim anything at all.
    expect(byName.get('gamma')?.upper).toBeCloseTo(exactUpperOf(0, 1052, DELTA / FAMILIES), 12);
  });

  it('charges the widest bound with every family it breaks', () => {
    const lost = new Map(risksAt(at(0.2), POP, DELTA / FAMILIES).map((r) => [r.faultType, r.lost]));
    expect(lost.get('alpha')).toBe(2);
    expect(lost.get('beta')).toBe(4);
    expect(lost.get('gamma')).toBe(0);
  });

  it('reads the loss from the frontier rather than from an admission of its own', () => {
    // The count is `-delta` of the frontier's own regression, and the two modules cannot disagree because there is one
    // computation: a certification row describing a different gate from the frontier above it is the failure this
    // sharing exists to prevent.
    const point = at(0.2);
    const beta = point.regressed.find((loss) => loss.faultType === 'beta');
    const risk = risksAt(point, POP, DELTA).find((entry) => entry.faultType === 'beta');
    expect(risk?.lost).toBe(-(beta?.delta ?? Number.NaN));
  });
});

describe('certifyOf', () => {
  it('refuses the budget the point estimate suggests and takes the one the interval demands', () => {
    // alpha loses 2 of 1 000, so the budget a reader expects is 2. The interval says 0.0077, and 7/1 000 is below
    // that: the first rung that certifies anything is 8, and it buys the near bound.
    const rungs = certifyOf(POP, POINTS, [2, 7, 8], DELTA);
    expect(rungs.map((rung) => rung.point?.bound ?? null)).toEqual([null, null, 0.05]);
  });

  it('carries the cases a rung buys and what it costs', () => {
    const [rung] = certifyOf(POP, POINTS, [8], DELTA);
    expect(rung?.alpha).toBeCloseTo(8 / 1052, 12);
    expect(rung?.point?.cases).toBe(1004);
    expect(rung?.point?.delta).toBe(28);
    expect(rung?.point?.worst.faultType).toBe('alpha');
    expect(rung?.point?.worst.lost).toBe(2);
  });

  it('certifies the wider bound only at the budget its own worst family demands', () => {
    const rungs = certifyOf(POP, POINTS, [10, 11], DELTA);
    expect(rungs[0]?.point?.bound).toBe(0.05);
    expect(rungs[1]?.point?.bound).toBe(0.2);
    expect(rungs[1]?.point?.cases).toBe(1040);
    expect(rungs[1]?.point?.worst.lost).toBe(4);
  });

  it('prefers the point that answers more cases when two are inside the budget', () => {
    // The third bound breaks nothing the second does not, so both are certifiable at 11 and answer the same 994
    // cases; the rule is cases first, then order, which is the rule every other reader here uses.
    const rungs = certifyOf(POP, POINTS, [11], DELTA);
    expect(rungs[0]?.point?.bound).toBe(0.2);
  });

  it('certifies nothing at a budget zero, however clean the corpus is', () => {
    // This is the rule of three and the reason the standing acceptance condition is descriptive: zero losses of
    // 1 000 only rules out a rate above 0.0041, which is four cases per thousand, not none.
    const clean = ROWS.map((kase) =>
      kase.off ? row(kase.faultType, kase.reach, true, true) : kase,
    );
    const rungs = certifyOf(populationOf(clean), frontierOf(clean, BOUNDS), [0, 1, 2, 3, 4], DELTA);
    expect(rungs.every((rung) => rung.point === null)).toBe(true);
    expect(
      certifyOf(populationOf(clean), frontierOf(clean, BOUNDS), [5], DELTA)[0]?.point?.bound,
    ).toBe(0.2);
  });

  it('reports nothing for a corpus with no cases', () => {
    expect(certifyOf(populationOf([]), frontierOf([]), [8], DELTA)).toEqual([
      { budget: 8, alpha: 0, point: null },
    ]);
  });

  it('reports a rung per budget for a grid with no bounds', () => {
    expect(certifyOf(POP, [], [8], DELTA)).toEqual([{ budget: 8, alpha: 8 / 1052, point: null }]);
  });

  it('reads a budget it cannot place as the strictest one', () => {
    const rungs = certifyOf(POP, POINTS, [-4, Number.NaN], DELTA);
    expect(rungs.map((rung) => rung.budget)).toEqual([0, 0]);
    expect(rungs.every((rung) => rung.point === null)).toBe(true);
  });

  it('holds every family to a share of the level, so more families demand more budget', () => {
    // Splitting beta in two is not free: each half is held to a smaller level, so the same two losses cost one case
    // more of budget — 0.007698 against 0.007350 at the same count. A module that ignored multiplicity would certify
    // both corpora at eight and quietly drop a claim it was making.
    const split = ROWS.map((kase, index) =>
      kase.faultType === 'beta' && index % 2 === 0 ? { ...kase, faultType: 'beta2' } : kase,
    );
    const four = populationOf(split);
    const rungs = certifyOf(four, frontierOf(split, BOUNDS), [8, 9], DELTA);
    expect(four.families).toHaveLength(4);
    expect(rungs[0]?.point).toBeNull();
    expect(rungs[1]?.point?.bound).toBe(0.2);
    expect(certifyOf(POP, POINTS, [8], DELTA)[0]?.point?.bound).toBe(0.05);
  });
});

describe('thresholdOf', () => {
  it('names the budget the ladder would have had to reach', () => {
    // The default ladder stops at ten and this corpus needs eight, so the answer here is on the ladder; the point of
    // the function is the corpus where it is not, and the assertion is the same arithmetic either way.
    expect(thresholdOf(POP, POINTS, DELTA)?.budget).toBe(8);
    expect(thresholdOf(POP, POINTS, DELTA)?.point.bound).toBe(0.05);
  });

  it('prices the cheapest budget at the share a split level leaves', () => {
    // Four families instead of three: the same two losses now cost nine, which is exactly the rung that came back
    // empty on the three-family corpus at eight.
    const split = ROWS.map((kase, index) =>
      kase.faultType === 'beta' && index % 2 === 0 ? { ...kase, faultType: 'beta2' } : kase,
    );
    expect(thresholdOf(populationOf(split), frontierOf(split, BOUNDS), DELTA)?.budget).toBe(9);
  });

  it('is null when there is nothing to make a claim about', () => {
    expect(thresholdOf(populationOf([]), frontierOf([]), DELTA)).toBeNull();
    expect(thresholdOf(POP, [], DELTA)).toBeNull();
  });

  it('reports the corpus as its own ceiling when every case is lost', () => {
    // A family that loses every case has an upper end of one, so the budget it demands is the whole corpus — the
    // honest statement, and the reason the arithmetic ceilings rather than truncating.
    const all = [breaker('alpha', 0.05)];
    expect(thresholdOf(populationOf(all), frontierOf(all, [0.05]), DELTA)?.budget).toBe(1);
  });
});

describe('floorOf', () => {
  it('is the rule of three for a family that loses nothing', () => {
    // Any corpus, any size: zero observed failures certify a rate of −ln δ / n, so the budget floor is 3 at 95 % and
    // no amount of data moves it. That is a fact about counting, and it is why the next two numbers matter.
    expect(floorOf(0, 0.05)).toBe(3);
    expect(floorOf(0, 0.005)).toBe(6);
  });

  it('prices the losses the frontier actually has', () => {
    expect(floorOf(2, 0.05)).toBe(7);
    expect(floorOf(7, 0.05)).toBe(14);
  });

  it('rises with the count, one case at a time', () => {
    const floors = [0, 1, 2, 3, 4, 7].map((lost) => floorOf(lost, 0.05));
    expect(floors).toEqual([3, 5, 7, 8, 10, 14]);
    for (let index = 1; index < floors.length; index += 1) {
      expect(floors[index]!).toBeGreaterThanOrEqual(floors[index - 1]!);
    }
  });

  it('reads a negative count as none and a malformed level at the default', () => {
    expect(floorOf(-1, 0.05)).toBe(3);
    expect(floorOf(Number.NaN, 0.05)).toBe(3);
    expect(floorOf(2, Number.NaN)).toBe(floorOf(2, 0.05));
  });
});

describe('formatCertified', () => {
  it('states the corpus, the level and the share each family is held to', () => {
    // The share is the number a reader needs to see, because it is the whole reason a clean family still costs budget.
    const text = formatCertified(certifyOf(POP, POINTS, [8], DELTA), 1052, DELTA, FAMILIES);
    expect(text.split('\n')[0]).toBe('n 1052   delta 0.05   families 3 (0.016667 each)');
  });

  it('prints an impossible rung as an impossibility rather than a blank line', () => {
    const text = formatCertified(certifyOf(POP, POINTS, [2], DELTA), 1052, DELTA, FAMILIES);
    const line = text.split('\n').find((candidate) => candidate.trimStart().startsWith('2 '));
    expect(line).toContain('no bound');
  });

  it('prints the certified rung with its worst family and the interval that bought it', () => {
    const text = formatCertified(certifyOf(POP, POINTS, [8], DELTA), 1052, DELTA, FAMILIES);
    const line = text.split('\n').find((candidate) => candidate.trimStart().startsWith('8 '))!;
    expect(line).toContain('alpha');
    expect(line).toContain('1004');
    expect(line).toContain('0.007350');
  });

  it('names the cheapest rung that certifies anything, which is the whole point of the table', () => {
    const text = formatCertified(certifyOf(POP, POINTS, [2, 7, 8], DELTA), 1052, DELTA, FAMILIES);
    expect(text).toContain('cheapest certifiable: 8');
  });

  it('names the smallest budget that certifies when the ladder itself is too short', () => {
    // The default ladder stops at ten; a corpus with enough families needs more. A table that came back empty would
    // read as a refusal, so the footer states the budget that would have certified instead of leaving the question.
    const text = formatCertified(
      certifyOf(POP, POINTS, [2], DELTA),
      1052,
      DELTA,
      FAMILIES,
      thresholdOf(POP, POINTS, DELTA),
    );
    expect(text).toContain('smallest budget that does is 8');
    expect(text).toContain('reach < 0.050 answers 1004');
  });

  it('prints a negative delta, because a certified point can still cost cases', () => {
    // The fixture is two cases, one of which the bound breaks; a budget wide enough to certify it leaves the corpus
    // one case short of the run, and the table has to say so with a sign rather than as an unsigned 1.
    const tiny = [breaker('alpha', 0.05), filler('alpha')];
    const text = formatCertified(
      certifyOf(populationOf(tiny), frontierOf(tiny, [0.05]), [2], DELTA),
      2,
      DELTA,
      1,
    );
    expect(text).toContain('(-1)');
  });

  it('names the cheapest rung even when the ladder is given widest first', () => {
    const text = formatCertified(certifyOf(POP, POINTS, [11, 8], DELTA), 1052, DELTA, FAMILIES);
    expect(text).toContain('cheapest certifiable: 8');
    // And the other order, where the cheaper rung is seen first and the later one is not cheaper: the footer must keep
    // the first rather than the last.
    expect(
      formatCertified(certifyOf(POP, POINTS, [8, 11], DELTA), 1052, DELTA, FAMILIES),
    ).toContain('cheapest certifiable: 8');
  });

  it('says there is nothing to name when no rung certifies', () => {
    const text = formatCertified(certifyOf(POP, POINTS, [0], DELTA), 1052, DELTA, FAMILIES);
    expect(text).toContain('cheapest certifiable: none');
  });

  it('prints a header alone for an empty ladder', () => {
    expect(formatCertified([], 1052, DELTA, FAMILIES).split('\n')[0]).toBe(
      'n 1052   delta 0.05   families 3 (0.016667 each)',
    );
  });

  it('does not divide by no families in its own header', () => {
    expect(formatCertified([], 0, DELTA, 0).split('\n')[0]).toBe('n 0   delta 0.05   families 0');
  });
});

describe('parseRejectorArgs with a level', () => {
  it('defaults the level to the one the table is built on', () => {
    expect(parseRejectorArgs(['--terms', 'd.ndjson']).delta).toBe(DEFAULT_DELTA);
  });

  it('reads a level and refuses one that is not a level', () => {
    expect(parseRejectorArgs(['--terms', 'd.ndjson', '--delta', '0.005']).delta).toBe(0.005);
    expect(() => parseRejectorArgs(['--terms', 'd.ndjson', '--delta'])).toThrow('--delta needs');
    expect(() => parseRejectorArgs(['--terms', 'd.ndjson', '--delta', '0'])).toThrow(
      '--delta must be',
    );
    expect(() => parseRejectorArgs(['--terms', 'd.ndjson', '--delta', '1'])).toThrow(
      '--delta must be',
    );
  });
});
