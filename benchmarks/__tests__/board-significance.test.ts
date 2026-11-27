/**
 * The significance layer: every number here is either hand-checkable or cross-checked against an independent
 * implementation.
 *
 * The exact p-values are asserted against `scipy.stats.fisher_exact(..., alternative='two-sided')` 1.17.0, run on
 * the tables written out beside each expectation, so a test failing here means this module and an independent
 * implementation disagree — not that this module changed its mind. The Hoeffding values are closed-form and are
 * asserted against the arithmetic in the comment that states them.
 */

import { describe, expect, it } from 'vitest';

import {
  boundedMeanClaim,
  fisherLogTwoSided,
  fisherTwoSided,
  formatClaim,
  hoeffdingBound,
  hoeffdingHalfWidth,
  minimumIndependentCases,
  newcombeDifference,
  normalQuantile,
  proportionClaim,
  requiredExtraHits,
  wilson,
} from '../src/board-significance.js';

/** Compare two tiny probabilities by ratio, which is the only scale on which `1e-71` has digits. */
function expectRatio(actual: number, expected: number, digits = 6): void {
  expect(actual / expected).toBeCloseTo(1, digits);
}

describe('fisherTwoSided', () => {
  it('matches the independent implementation on five small tables', () => {
    // scipy: [[3,7],[7,3]] -> 0.1788954079975752
    expect(fisherTwoSided(3, 7, 10)).toBeCloseTo(0.1788954, 6);
    // scipy: [[10,0],[0,10]] -> 1.082508822446903e-05
    expect(fisherTwoSided(10, 0, 10)).toBeCloseTo(1.0825088e-5, 10);
    // scipy: [[9,1],[1,9]] -> 0.001093333910671372
    expect(fisherTwoSided(9, 1, 10)).toBeCloseTo(0.0010933339, 8);
    // scipy: [[2,8],[8,2]] -> 0.023014137565221155
    expect(fisherTwoSided(2, 8, 10)).toBeCloseTo(0.0230141, 6);
  });

  it('returns one for a table with no difference at all', () => {
    // scipy: [[5,5],[5,5]] -> 1.0
    expect(fisherTwoSided(5, 5, 10)).toBe(1);
  });

  it('is symmetric in its two counts, because the table is', () => {
    expect(fisherTwoSided(3, 7, 10)).toBeCloseTo(fisherTwoSided(7, 3, 10), 12);
    expect(fisherTwoSided(1186, 748, 1422)).toBeCloseTo(fisherTwoSided(748, 1186, 1422), 12);
  });

  it('matches the independent implementation on the four board pairs this project publishes', () => {
    // scipy: [[1186,236],[748,674]] -> 3.32507851386216e-71  (Top@1 against MicroRCA)
    expectRatio(fisherTwoSided(1186, 748, 1422), 3.32507851386216e-71);
    // scipy: [[1260,162],[1065,357]] -> 1.856051409711397e-21  (Top@3 against MicroDig)
    expectRatio(fisherTwoSided(1260, 1065, 1422), 1.856051409711397e-21);
    // scipy: [[1282,140],[1272,150]] -> 0.5771131207737277  (Top@5 against SimpleRCA: the ten-case margin)
    expect(fisherTwoSided(1282, 1272, 1422)).toBeCloseTo(0.5771131, 6);
    // scipy: [[1374,48],[1272,150]] -> 2.8471644919763693e-14  (the arm's Top@5)
    expectRatio(fisherTwoSided(1374, 1272, 1422), 2.8471644919763693e-14);
  });

  it('keeps the exponent when the probability is below the smallest double', () => {
    // [[1422,0],[0,1422]] -> 1 / C(2844,1422) = e^-1967.1082188600194 in EACH tail, and the two-sided value is the
    // sum of both: e^-1966.415... The gap between the two exponents is ln 2, which is the second tail — so this
    // number is also the assertion that the test is two-sided and not one. No double holds either, so the value is
    // 0 by arithmetic and the exponent is the answer. scipy returns 0.0 here.
    expect(fisherLogTwoSided(1422, 0, 1422)).toBeCloseTo(-1966.4150717, 5);
    expect(fisherLogTwoSided(1422, 0, 1422) + 1967.1082189).toBeCloseTo(Math.LN2, 5);
    expect(fisherTwoSided(1422, 0, 1422)).toBe(0);
  });

  it('returns one for two zero counts, which carry no evidence either way', () => {
    // scipy: [[0,1422],[0,1422]] -> 1.0
    expect(fisherTwoSided(0, 0, 1422)).toBe(1);
  });

  it('refuses a population of zero, a negative population or a fractional one', () => {
    expect(() => fisherTwoSided(1, 0, 0)).toThrow(/cases must be a positive integer/);
    expect(() => fisherTwoSided(1, 0, -5)).toThrow(/cases must be a positive integer/);
    expect(() => fisherTwoSided(1, 0, 10.5)).toThrow(/cases must be a positive integer/);
  });

  it('refuses a count outside the population it counts', () => {
    expect(() => fisherTwoSided(11, 0, 10)).toThrow(/our hits: 11 is not a count of at most 10/);
    expect(() => fisherTwoSided(0, -1, 10)).toThrow(/their hits: -1 is not a count of at most 10/);
    expect(() => fisherTwoSided(2.5, 0, 10)).toThrow(/our hits/);
  });

  it('is V-shaped in one count: it falls to the rival, then rises past it', () => {
    // A difference is a difference in either direction, so the two-sided p is smallest at both ends and exactly 1
    // where the counts meet. Asserted rather than assumed, because `requiredExtraHits` scans this whole shape and a
    // one-sided implementation would make the scan return 0 for an engine that is behind.
    let previous = 0;
    for (let ours = 0; ours <= 14; ours++) {
      const p = fisherTwoSided(ours, 14, 20);
      expect(p, `ours=${String(ours)}`).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = p;
    }
    // One up to the rounding of twenty-one hypergeometric terms, which is the only thing between a sum of exact
    // probabilities and the integer it equals.
    expect(fisherTwoSided(14, 14, 20)).toBeCloseTo(1, 12);
    let falling = 1;
    for (let ours = 15; ours <= 17; ours++) {
      const p = fisherTwoSided(ours, 14, 20);
      expect(p, `ours=${String(ours)}`).toBeLessThanOrEqual(falling + 1e-12);
      falling = p;
    }
  });
});

describe('wilson', () => {
  it('brackets a zero count without touching zero nowhere', () => {
    const [lower, upper] = wilson(0, 10);
    expect(lower).toBe(0);
    expect(upper).toBeCloseTo(0.2775328, 6);
  });

  it('brackets a perfect count against the ceiling', () => {
    const [lower, upper] = wilson(10, 10);
    expect(lower).toBeCloseTo(0.7224672, 6);
    expect(upper).toBeLessThanOrEqual(1);
  });

  it('brackets the published Top@5 rate', () => {
    const [lower, upper] = wilson(1282, 1422);
    expect(lower).toBeCloseTo(0.8849635, 6);
    expect(upper).toBeCloseTo(0.915967, 6);
  });

  it('refuses an inadmissible count or population', () => {
    expect(() => wilson(11, 10)).toThrow(/not a count/);
    expect(() => wilson(0, 0)).toThrow(/cases must be a positive integer/);
  });
});

describe('newcombeDifference', () => {
  it('centres the interval on the difference and keeps the point estimate inside it', () => {
    const [lower, upper] = newcombeDifference(1282, 1272, 1422);
    const delta = 10 / 1422;
    expect(lower).toBeLessThan(delta);
    expect(upper).toBeGreaterThan(delta);
  });

  it('contains zero exactly when the exact test calls the difference indistinguishable', () => {
    // A sweep rather than one case: the interval and the p-value must agree everywhere, because a table that
    // prints both and derives two different verdicts is worse than a table that prints neither.
    for (const [ours, theirs] of [
      [1282, 1272],
      [1186, 748],
      [1260, 1065],
      [1374, 1272],
      [800, 800],
      [740, 748],
    ] as const) {
      const [lower, upper] = newcombeDifference(ours, theirs, 1422);
      const significant = fisherTwoSided(ours, theirs, 1422) < 0.05;
      expect(lower > 0 || upper < 0, `${ours} vs ${theirs}`).toBe(significant);
    }
  });

  it('is symmetric in sign when the two counts swap', () => {
    const [lower, upper] = newcombeDifference(1282, 1272, 1422);
    const [swappedLower, swappedUpper] = newcombeDifference(1272, 1282, 1422);
    expect(swappedLower).toBeCloseTo(-upper, 12);
    expect(swappedUpper).toBeCloseTo(-lower, 12);
  });

  it('refuses an inadmissible count', () => {
    expect(() => newcombeDifference(1282, 1500, 1422)).toThrow(/not a count/);
  });
});

describe('hoeffdingBound', () => {
  it('is one for a delta of zero, because no evidence is not evidence', () => {
    expect(hoeffdingBound(0, 1422)).toBe(1);
  });

  it('bounds the MRR margin at 7.6e-17 on 1 422 cases', () => {
    // 4·exp(−1422·0.2327²/2) = 4·exp(−38.49) = 7.614815457824947e-17
    expectRatio(hoeffdingBound(0.2327, 1422), 7.614815457824947e-17);
  });

  it('reports the ten-case margin as no evidence at all, which is the point of the bound', () => {
    // 4·exp(−1422·0.007031²/2) = 3.86, clamped: a margin this small is not distinguishable at any level.
    expect(hoeffdingBound(0.007031, 1422)).toBe(1);
  });

  it('refuses a delta outside the unit interval and a non-positive population', () => {
    expect(() => hoeffdingBound(1.5, 1422)).toThrow(/outside \[-1, 1\]/);
    expect(() => hoeffdingBound(0.1, 0)).toThrow(/cases must be a positive integer/);
  });
});

describe('hoeffdingHalfWidth', () => {
  it('resolves to 7.85 points on 1 422 cases at 95 %', () => {
    // √(2·ln(80)/1422) = 0.07850597399642795
    expect(hoeffdingHalfWidth(1422)).toBeCloseTo(0.078506, 6);
  });

  it('widens at the 99 % level, as a stricter level must', () => {
    expect(hoeffdingHalfWidth(1422, 0.01)).toBeCloseTo(0.0917977, 6);
  });

  it('refuses an alpha outside (0, 1)', () => {
    expect(() => hoeffdingHalfWidth(1422, 0)).toThrow(/not a significance level/);
    expect(() => hoeffdingHalfWidth(1422, 1)).toThrow(/not a significance level/);
    expect(() => hoeffdingHalfWidth(0)).toThrow(/cases must be a positive integer/);
  });
});

describe('proportionClaim', () => {
  it('calls the ten-case Top@5 margin indistinguishable, which is why this module exists', () => {
    const claim = proportionClaim(1282, 1272, 1422);
    expect(claim.kind).toBe('fisher-exact');
    expect(claim.defensible).toBe(false);
    expect(claim.delta).toBeCloseTo(10 / 1422, 12);
    expect(claim.lower).toBeLessThan(0);
    expect(claim.p).toBeCloseTo(0.5771131, 6);
  });

  it('calls the head margins defensible', () => {
    expect(proportionClaim(1186, 748, 1422).defensible).toBe(true);
    expect(proportionClaim(1260, 1065, 1422).defensible).toBe(true);
    expect(proportionClaim(1374, 1272, 1422).defensible).toBe(true);
  });

  it('honours a stricter level', () => {
    // Top@5 at 0.05 is already indistinguishable; at 0.001 nothing changes for the head either.
    expect(proportionClaim(1186, 748, 1422, 0.001).defensible).toBe(true);
  });

  it('refuses an alpha outside (0, 1)', () => {
    expect(() => proportionClaim(1282, 1272, 1422, 0)).toThrow(/not a significance level/);
  });
});

describe('boundedMeanClaim', () => {
  it('calls the MRR margin defensible on a distribution-free bound', () => {
    const claim = boundedMeanClaim(0.8688, 0.6360753912441687, 1422);
    expect(claim.kind).toBe('hoeffding-bounded');
    expect(claim.defensible).toBe(true);
    expect(claim.p).toBeLessThan(1e-15);
    expect(claim.lower).toBeGreaterThan(0);
  });

  it('calls a two-point mean margin indistinguishable', () => {
    const claim = boundedMeanClaim(0.7, 0.68, 1422);
    expect(claim.defensible).toBe(false);
  });

  it('refuses a mean outside [0, 1]', () => {
    expect(() => boundedMeanClaim(1.2, 0.5, 1422)).toThrow(/outside \[0, 1\]/);
    expect(() => boundedMeanClaim(0.5, Number.NaN, 1422)).toThrow(/outside \[0, 1\]/);
  });

  it('clips the interval to the range the metric can occupy', () => {
    const claim = boundedMeanClaim(0.02, 0.99, 100);
    expect(claim.lower).toBeGreaterThanOrEqual(-1);
    expect(claim.upper).toBeLessThanOrEqual(1);
  });
});

describe('requiredExtraHits', () => {
  it('names twenty-two cases for the Top@5 margin', () => {
    // 1 282 + 22 = 1 304 of 1 422 against 1 272: p = 0.0465, the first count that clears 0.05. This is the number
    // the depth work has to buy, and it is a command rather than an estimate.
    expect(requiredExtraHits(1282, 1272, 1422)).toBe(22);
    expect(fisherTwoSided(1303, 1272, 1422)).toBeGreaterThan(0.05);
    expect(fisherTwoSided(1304, 1272, 1422)).toBeLessThan(0.05);
  });

  it('returns zero when the claim is already defensible', () => {
    expect(requiredExtraHits(1186, 748, 1422)).toBe(0);
  });

  it('returns null when the rival row is perfect, because no count can beat it', () => {
    expect(requiredExtraHits(20, 20, 20)).toBeNull();
    expect(requiredExtraHits(1422, 1422, 1422)).toBeNull();
  });

  it('honours a stricter level', () => {
    // p < 0.01 needs 31 cases, not 22: scipy confirms 1 313 against 1 272 -> 0.0090.
    expect(requiredExtraHits(1282, 1272, 1422, 0.01)).toBe(31);
  });

  it('refuses an inadmissible population or count', () => {
    expect(() => requiredExtraHits(1282, 1272, 0)).toThrow(/cases must be a positive integer/);
    expect(() => requiredExtraHits(1500, 1272, 1422)).toThrow(/not a count/);
  });
});

describe('formatClaim', () => {
  it('prints an exact p with an equals sign and the verdict', () => {
    expect(formatClaim(proportionClaim(1186, 748, 1422))).toContain('p = ');
    expect(formatClaim(proportionClaim(1186, 748, 1422))).toContain('defensible');
    expect(formatClaim(proportionClaim(1186, 748, 1422))).toContain('Fisher exact');
  });

  it('prints an indistinguishable margin as exactly that, with the level named', () => {
    const text = formatClaim(proportionClaim(1282, 1272, 1422));
    expect(text).toContain('NOT distinguishable from zero at 0.05');
    expect(text).toContain('p = 0.577');
  });

  it('prints a bound with a less-than sign, because a bound is not an equality', () => {
    const text = formatClaim(boundedMeanClaim(0.8688, 0.6360753912441687, 1422));
    expect(text).toContain('p ≤ ');
    expect(text).toContain('Hoeffding bound');
  });

  it('prints a tiny p in scientific notation rather than as zero', () => {
    expect(formatClaim(proportionClaim(1186, 748, 1422))).toContain('e-71');
  });

  it('carries the interval in percentage points', () => {
    expect(formatClaim(proportionClaim(1282, 1272, 1422))).toContain('95 % [');
  });
});

describe('normalQuantile', () => {
  it('returns the two-sided 95 % quantile', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
  });

  it('returns zero at the median, by antisymmetry', () => {
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.025)).toBeCloseTo(-normalQuantile(0.975), 5);
  });

  it('refuses a probability outside (0, 1)', () => {
    expect(() => normalQuantile(0)).toThrow(/not a probability in \(0, 1\)/);
    expect(() => normalQuantile(1)).toThrow(/not a probability in \(0, 1\)/);
    expect(() => normalQuantile(Number.NaN)).toThrow(/not a probability/);
  });
});

describe('minimumIndependentCases', () => {
  it('says the head margin holds if the corpus is worth as few as sixteen independent cases', () => {
    // The design effect the Top@1 margin survives is (0.3080 / (1.96 · 0.016511))² = 90.6, so 1 422 / 90.6 = 15.7
    // — and the corpus holds sixteen fault-type families, so the head conclusion survives even perfect within-family
    // correlation, which is the most pessimistic model the corpus can support.
    expect(minimumIndependentCases(1186, 748, 1422)).toBe(16);
  });

  it('says the Top@3 margin holds at fifty-nine', () => {
    expect(minimumIndependentCases(1260, 1065, 1422)).toBe(59);
  });

  it('returns null for the ten-case margin, because no effective size makes it hold', () => {
    // Its implied design effect is 0.10 — below one — so it fails on an INDEPENDENT corpus, before any correlation
    // is assumed. `null` rather than a small number: the answer is "no such corpus", not "a tiny one".
    expect(minimumIndependentCases(1282, 1272, 1422)).toBeNull();
  });

  it('returns null for two equal counts, which carry no margin at all', () => {
    expect(minimumIndependentCases(800, 800, 1422)).toBeNull();
  });

  it('returns zero when the two arms sit at opposite extremes, where no correlation can hide the gap', () => {
    expect(minimumIndependentCases(1422, 0, 1422)).toBe(0);
  });

  it('demands more independent cases at a stricter level, which is the direction a floor must move', () => {
    expect(minimumIndependentCases(1186, 748, 1422, 0.01)).toBeGreaterThan(16);
  });

  it('refuses an inadmissible population or count', () => {
    expect(() => minimumIndependentCases(1282, 1272, 0)).toThrow(
      /cases must be a positive integer/,
    );
    expect(() => minimumIndependentCases(1500, 1272, 1422)).toThrow(/not a count/);
  });
});
