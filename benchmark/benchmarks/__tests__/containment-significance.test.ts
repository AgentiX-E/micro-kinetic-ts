/**
 * The exact test for an edge's independence, and the multiplicity it exposes.
 *
 * Every expected value here is a **fraction computed by hand**, written into the test as the decimal it converts
 * to, so the implementation is being checked against arithmetic rather than against itself: `n = 8, a = b = x = 4`
 * is the tea-tasting table (`1/70`), `n = 10, a = b = x = 5` is `1/C(10,5) = 1/252`, `n = 8, a = b = 4, x = 3` is
 * `17/70` (a tail that is a sum, where an off-by-one in the loop shows up), and `n = 20, a = b = 10, x = 8` is
 * `1063/92378`. A test that only asserted "smaller than 0.05" would pass on an implementation that returned the
 * wrong tail, the wrong table, or a Monte Carlo estimate with the wrong seed.
 *
 * The numerical requirements are asserted as properties rather than as values, because they are the ones that fail
 * silently: the tail must **decrease** in `x`, and it must stay finite and nonzero at populations the corpus
 * actually reaches (`n = 191`), where the binomial coefficients involved exceed 10⁴⁹ and a direct computation
 * overflows to `NaN`.
 *
 * @module benchmarks/__tests__/containment-significance
 */

import { describe, expect, it } from 'vitest';

import type { EdgeCounts } from '../src/containment-residual.js';
import {
  DEFAULT_LEVEL,
  benjaminiHochberg,
  exactUpperTail,
  independenceP,
  significanceEntries,
} from '../src/containment-significance.js';

/** An `EdgeCounts` with only the fields the test reads, so a fixture states its own table. */
function countsOf(measured: number, aOut: number, bOut: number, bothOut: number): EdgeCounts {
  return { measured, aOut, bOut, bothOut };
}

// ── The tail ──────────────────────────────────────────────

describe('the exact upper tail', () => {
  it('reproduces the tea-tasting table', () => {
    // 1/70. This is the canonical Fisher table; an enumeration off by one term reads 1/35.
    expect(exactUpperTail(8, 4, 4, 4)).toBeCloseTo(1 / 70, 12);
  });

  it('reproduces 1/C(10,5) when both sides move together in every balanced observation', () => {
    expect(exactUpperTail(10, 5, 5, 5)).toBeCloseTo(1 / 252, 12);
  });

  it('reproduces a tail that is a sum rather than a single term', () => {
    expect(exactUpperTail(8, 4, 4, 3)).toBeCloseTo(17 / 70, 12);
  });

  it('reproduces a table whose margins share observations', () => {
    // 1063/92378, because a table with a shared margin is not a single binomial coefficient.
    expect(exactUpperTail(20, 10, 10, 8)).toBeCloseTo(1063 / 92_378, 12);
  });

  it('refuses a skewed but perfectly coupled edge at n = 10, which is the point of the test', () => {
    // Margins at 0.9 leave one free observation, so perfect coupling is worth p = 0.1 and no more.
    expect(exactUpperTail(10, 9, 9, 9)).toBeCloseTo(0.1, 12);
  });

  it('is exactly 1 when no joint count is excluded', () => {
    expect(exactUpperTail(6, 2, 3, 0)).toBe(1);
  });

  it('is exactly 1 at the smallest count the margins allow, which is a certainty rather than a sum', () => {
    // n = 5, margins 4/4: at most one observation can hold a single side, so X ≥ 3 always.
    expect(exactUpperTail(5, 4, 4, 3)).toBe(1);
  });

  it('is 4/5 at the first joint count the margins allow', () => {
    // P(X = 0) = C(4,3)/C(6,3) = 1/5, so the upper tail from 1 is 4/5 — the complement, computed as a sum.
    expect(exactUpperTail(6, 2, 3, 1)).toBeCloseTo(0.8, 12);
  });

  it('decreases strictly in the joint count', () => {
    let previous = 1;
    for (let x = 2; x <= 10; x++) {
      const p = exactUpperTail(20, 10, 10, x);
      expect(p).toBeLessThan(previous);
      previous = p;
    }
  });

  it('is symmetric in the two sides', () => {
    // The table does not know which of its margins is the caller.
    expect(exactUpperTail(30, 7, 19, 6)).toBeCloseTo(exactUpperTail(30, 19, 7, 6), 12);
  });

  it('stays finite and correct at the population the corpus actually reaches', () => {
    // n = 191 is the longest edge in the corpus. C(191,50) is about 10^49; computed directly this is Infinity.
    const p = exactUpperTail(191, 50, 50, 50);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(0);
    expect(Math.log10(p)).toBeCloseTo(-46.51, 1);
  });

  it('keeps its arithmetic at the thin end of the corpus', () => {
    // One observation with both sides out of band: the tail is 1, and at two observations it is 1/2.
    expect(exactUpperTail(1, 1, 1, 1)).toBe(1);
    expect(exactUpperTail(2, 1, 1, 1)).toBeCloseTo(0.5, 12);
  });

  it('rejects a joint count the margins cannot support', () => {
    expect(() => exactUpperTail(10, 5, 5, 6)).toThrow(RangeError); // X ≤ min(a,b)
    expect(() => exactUpperTail(5, 4, 4, 0)).toThrow(RangeError); // X ≥ a + b − n
    expect(() => exactUpperTail(10, 11, 5, 5)).toThrow(RangeError); // a ≤ n
    expect(() => exactUpperTail(10, 5, 11, 5)).toThrow(RangeError); // b ≤ n
  });

  it('rejects a negative or fractional count', () => {
    expect(() => exactUpperTail(-1, 0, 0, 0)).toThrow(RangeError);
    expect(() => exactUpperTail(10, -1, 5, 0)).toThrow(RangeError);
    expect(() => exactUpperTail(10, 5, 5.5, 0)).toThrow(RangeError);
  });
});

// ── The p-value over an edge ──────────────────────────────

describe('the p-value of an edge', () => {
  it('reads the counts in the order the accumulator stores them', () => {
    expect(independenceP(countsOf(8, 4, 4, 4))).toBeCloseTo(1 / 70, 12);
  });

  it('is null when nothing was measured, which is not a p-value of 1', () => {
    // A missing observation is not a failed rejection; an edge nobody measured has no evidence either way.
    expect(independenceP(countsOf(0, 0, 0, 0))).toBeNull();
  });

  it('is 1 when an edge never moved on either side', () => {
    expect(independenceP(countsOf(12, 0, 0, 0))).toBe(1);
  });

  it('is 1 when one side is always out of band — the degenerate cell the residual also refuses', () => {
    // δa ≡ 1 forces P(both) = P(δb) at every coupling, so the table carries no information about dependence.
    expect(independenceP(countsOf(12, 12, 5, 5))).toBe(1);
  });
});

// ── The multiplicity ──────────────────────────────────────

describe('Benjamini–Hochberg', () => {
  it('returns nothing for no hypotheses', () => {
    expect(benjaminiHochberg([])).toEqual([]);
  });

  it('adjusts a single hypothesis to itself', () => {
    const [entry] = benjaminiHochberg([0.01]);
    expect(entry).toEqual({ p: 0.01, q: 0.01, admitted: true });
  });

  it('matches the textbook four-hypothesis table', () => {
    // p = 0.01, 0.02, 0.03, 0.04, m = 4, level 0.05. Thresholds are k·0.05/4 = 0.0125 … 0.05, all four pass,
    // and every adjusted value is pulled down to the largest j's 0.04 by the monotonicity step.
    const adjusted = benjaminiHochberg([0.01, 0.02, 0.03, 0.04]);
    for (const entry of adjusted) expect(entry.q).toBeCloseTo(0.04, 12);
    expect(adjusted.every((entry) => entry.admitted)).toBe(true);
  });

  it('refuses what the level cannot afford in a map of this size', () => {
    // m = 64: the smallest threshold is 0.05/64 = 7.8e-4, so a balanced n = 10 edge at p = 1/252 is refused —
    // and its adjusted value is 64 · p, because the remaining 63 hypotheses are nulls and do not lower the minimum.
    const pValues = [1 / 252, ...Array.from({ length: 63 }, () => 0.99)];
    const [first] = benjaminiHochberg(pValues);
    expect(first!.admitted).toBe(false);
    expect(first!.q).toBeCloseTo(64 / 252, 6);
  });

  it('admits the same edge when the map is small enough to afford it', () => {
    // m = 4, and the same 1/252 is now the smallest of four: 0.00397 ≤ 0.05/4 → admitted.
    const pValues = [1 / 252, 0.99, 0.99, 0.99];
    expect(benjaminiHochberg(pValues)[0]!.admitted).toBe(true);
  });

  it('never reports an adjusted value below its own p, and never above 1', () => {
    const pValues = [0.001, 0.004, 0.02, 0.5, 0.9];
    for (const entry of benjaminiHochberg(pValues)) {
      expect(entry.q).toBeGreaterThanOrEqual(entry.p);
      expect(entry.q).toBeLessThanOrEqual(1);
    }
  });

  it('gives ties one adjusted value', () => {
    // Two edges at the same p are the same evidence; reporting different q's would make the answer depend on the
    // order the file listed them in.
    const adjusted = benjaminiHochberg([0.02, 0.02, 0.4]);
    expect(adjusted[0]!.q).toBe(adjusted[1]!.q);
  });

  it('answers in the order it was asked', () => {
    const adjusted = benjaminiHochberg([0.5, 0.01, 0.2]);
    expect(adjusted.map((entry) => entry.p)).toEqual([0.5, 0.01, 0.2]);
    expect(adjusted[1]!.admitted).toBe(true);
    expect(adjusted[0]!.admitted).toBe(false);
  });

  it('rejects a level outside (0, 1] and a p-value outside [0, 1]', () => {
    expect(() => benjaminiHochberg([0.1], 0)).toThrow(RangeError);
    expect(() => benjaminiHochberg([0.1], 1.5)).toThrow(RangeError);
    expect(() => benjaminiHochberg([1.5])).toThrow(RangeError);
    expect(() => benjaminiHochberg([-0.1])).toThrow(RangeError);
    expect(() => benjaminiHochberg([Number.NaN])).toThrow(RangeError);
  });

  it('defaults to 0.05', () => {
    expect(DEFAULT_LEVEL).toBe(0.05);
    expect(benjaminiHochberg([0.04])).toEqual(benjaminiHochberg([0.04], DEFAULT_LEVEL));
  });
});

// ── The map ───────────────────────────────────────────────

describe('the entries of a count map', () => {
  it('returns one per measurable edge, in key order, with the unmeasured ones absent', () => {
    const entries = significanceEntries(
      new Map([
        ['b\u0000c', countsOf(8, 4, 4, 4)],
        ['a\u0000b', countsOf(0, 0, 0, 0)],
        ['a\u0000c', countsOf(30, 15, 15, 14)],
      ]),
    );
    expect(entries.map((entry) => entry.key)).toEqual(['a\u0000c', 'b\u0000c']);
    // The level is applied over the two that could be tested, not over the three that were listed.
    expect(entries[0]!.q).toBeLessThanOrEqual(entries[1]!.q);
  });

  it('refuses every edge when nothing in the map can be measured', () => {
    expect(significanceEntries(new Map([['a\u0000b', countsOf(0, 0, 0, 0)]]))).toEqual([]);
  });

  it('carries the multiplicity of the map into the refusal', () => {
    // The same table is admitted alone and refused beside 63 nulls — which is the entire reason a floor is not a
    // test: a count of observations cannot know how many other edges were asked.
    const table = countsOf(10, 5, 5, 5);
    expect(significanceEntries(new Map([['a\u0000b', table]]))[0]!.admitted).toBe(true);

    const crowd = new Map<string, EdgeCounts>([['a\u0000b', table]]);
    // A table at the mode of its own hypergeometric: p ≈ 0.67, i.e. an edge that co-moves exactly as often as
    // independence predicts. 63 of those are what a corpus of nulls looks like.
    for (let i = 0; i < 63; i++) crowd.set(`n${i}\u0000z${i}`, countsOf(20, 10, 10, 5));
    const crowded = significanceEntries(crowd).find((entry) => entry.key === 'a\u0000b');
    expect(crowded!.p).toBeCloseTo(1 / 252, 12);
    expect(crowded!.admitted).toBe(false);
  });
});
