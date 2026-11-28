import { describe, expect, it } from 'vitest';

import { certifiedBudgetOf, type HeadroomCase } from '../src/agentic-headroom.js';

/** A population of `count` cases spread over three families, with no candidates: only the family split matters here. */
function population(sizes: Readonly<Record<string, number>>): HeadroomCase[] {
  const cases: HeadroomCase[] = [];
  for (const [faultType, count] of Object.entries(sizes)) {
    for (let index = 0; index < count; index++) {
      cases.push({ datapack: `${faultType}-${index}`, faultType, accepted: ['a'], candidates: [] });
    }
  }
  return cases;
}

describe('certifiedBudgetOf', () => {
  // Reference budgets from `scipy.stats.binom.cdf` under Holm at delta = 0.05 over three families: the same
  // arithmetic `risk-control.ts` implements, computed independently.
  const cases = population({ a: 20, b: 10, c: 10 });
  const control = { a: 20, b: 10, c: 10 };

  it('prices an arm that answers everything the control answered at the corpus floor', () => {
    expect(certifiedBudgetOf(cases, control, { a: 20, b: 10, c: 10 }, 0.05)).toEqual({
      budget: 4,
      worst: 'a −0',
    });
  });

  it('prices a regression in one family at the budget that family demands', () => {
    expect(certifiedBudgetOf(cases, control, { a: 12, b: 10, c: 10 }, 0.05)).toMatchObject({
      budget: 14,
      worst: 'a −8',
    });
    expect(certifiedBudgetOf(cases, control, { a: 16, b: 10, c: 10 }, 0.05)).toMatchObject({
      budget: 9,
    });
  });

  it('reads an arm that gains as a zero loss rather than as a negative one', () => {
    // A family the arm answers MORE cases for cannot have lost cases; the ledger clamps at zero, so a gain cannot
    // buy a smaller budget by being subtracted.
    expect(certifiedBudgetOf(cases, control, { a: 20, b: 10, c: 10 }, 0.05).budget).toBe(4);
  });

  it('names the family that binds the claim, so a reader knows where the price comes from', () => {
    expect(certifiedBudgetOf(cases, control, { a: 20, b: 2, c: 10 }, 0.05).worst).toBe('b −8');
  });

  it('states no budget at all when the corpus is the family the arm lost', () => {
    // One family of 20 cases, the control answering all 20 and the arm none: no rate below one is consistent with
    // that, so the ceiling of the bisection is checked rather than reported as the corpus's own size.
    const only = population({ a: 20 });
    expect(certifiedBudgetOf(only, { a: 20 }, { a: 0 }, 0.05)).toEqual({
      budget: null,
      worst: 'unprovable',
    });
  });

  it('splits the level across every family in the population, not only the ones that moved', () => {
    // Two corpora of 40 cases, both answered perfectly, differing only in how many families they hold: the wider
    // claim pays one more unit, because the level is divided across families rather than across the ones that moved.
    const three = certifiedBudgetOf(
      population({ a: 20, b: 10, c: 10 }),
      { a: 20, b: 10, c: 10 },
      { a: 20, b: 10, c: 10 },
      0.05,
    ).budget!;
    const fiveSizes = { a: 8, b: 8, c: 8, d: 8, e: 8 };
    const five = certifiedBudgetOf(population(fiveSizes), fiveSizes, fiveSizes, 0.05).budget!;
    expect(three).toBe(4);
    expect(five).toBe(5);
  });
});
