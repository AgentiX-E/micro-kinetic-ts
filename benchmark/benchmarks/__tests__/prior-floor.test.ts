/**
 * The prior floor — the baseline that is a property of the corpus rather than of the engine.
 *
 * Every assertion here is about a CLOSED FORM, so each one can be recomputed by hand from the case counts it
 * is given. That is the point of the module: a floor nobody can recompute is an opinion about a benchmark, and
 * the claim it supports ("this rate is above what the corpus gives away") has to be arithmetic.
 */

import { describe, expect, it } from 'vitest';

import {
  accumulatePriorFloor,
  createPriorFloorCensus,
  formatPriorFloorLine,
  formatPriorFloorSummary,
  priorFloor,
  type PriorFloorCensus,
} from '../src/prior-floor.js';

/**
 * Build a census from a truth histogram, in the order the histogram is written.
 *
 * `correct` is the number of cases the engine got right **in the whole cell**, distributed forwards over the
 * histogram: a helper that marked each service's first `correct` cases would make the engine's rate a function
 * of how many services the cell has, which is the class of defect these tests exist to catch.
 */
function censusOf(support: Readonly<Record<string, number>>, correct = 0): PriorFloorCensus {
  const census = createPriorFloorCensus();
  let seen = 0;
  for (const [truth, count] of Object.entries(support)) {
    for (let i = 0; i < count; i += 1) {
      accumulatePriorFloor(census, { truth, correct: seen < correct });
      seen += 1;
    }
  }
  return census;
}

describe('priorFloor — the uniform baseline', () => {
  it('is the closed form on a five-candidate cell', () => {
    // RCAEval RE1:OnlineBoutique: five injected services, 25 cases each. AC@k = min(k, 5)/5, so the mean over
    // the first five cutoffs is (1+2+3+4+5)/25 = 0.60 and the top five is saturated.
    const floor = priorFloor(censusOf({ a: 25, b: 25, c: 25, d: 25, e: 25 }))!;
    expect(floor.candidates).toBe(5);
    expect(floor.uniform.ac1).toBeCloseTo(0.2, 12);
    expect(floor.uniform.avg5).toBeCloseTo(0.6, 12);
    expect(floor.uniform.top5).toBe(1);
  });

  it('is 3/S while the candidate pool does not fit inside five', () => {
    // Six candidates: (1+2+3+4+5)/(5·6) = 0.50, and the top five can no longer be everything.
    const floor = priorFloor(censusOf({ a: 15, b: 15, c: 15, d: 15, e: 15, f: 15 }))!;
    expect(floor.candidates).toBe(6);
    expect(floor.uniform.ac1).toBeCloseTo(1 / 6, 12);
    expect(floor.uniform.avg5).toBeCloseTo(0.5, 12);
    expect(floor.uniform.top5).toBeCloseTo(5 / 6, 12);
  });

  it('degenerates to a certainty on a single-candidate cell', () => {
    // A cell with one injected service is a cell where reading nothing is always right; the floor has to say
    // so rather than divide by a zero-width range.
    const floor = priorFloor(censusOf({ only: 12 }))!;
    expect(floor.candidates).toBe(1);
    expect(floor.uniform.ac1).toBe(1);
    expect(floor.uniform.avg5).toBe(1);
    expect(floor.uniform.top5).toBe(1);
  });

  it('has no value for an empty census, rather than a zero', () => {
    // `0` would read as "the prior scores nothing here", which is the opposite of the truth: an empty cell has
    // no floor at all.
    expect(priorFloor(createPriorFloorCensus())).toBeUndefined();
  });
});

describe('priorFloor — the frequency-ordered baseline', () => {
  it('equals the uniform baseline on a balanced cell', () => {
    // The two differ only by what the LABELS give away, so a balanced cell must make them identical to the
    // last digit — otherwise the "frequency" reading would be importing something that is not support.
    const floor = priorFloor(censusOf({ a: 25, b: 25, c: 25, d: 25, e: 25 }))!;
    expect(floor.ordered.ac1).toBeCloseTo(floor.uniform.ac1, 12);
    expect(floor.ordered.avg5).toBeCloseTo(floor.uniform.avg5, 12);
    expect(floor.ordered.top5).toBeCloseTo(floor.uniform.top5, 12);
  });

  it('is the majority class on an unbalanced cell', () => {
    // RCAEval RE3:SockShop, as the corpus actually is: carts 12, orders 9, front-end 9 of 30 cases. A ranker
    // that lists `carts` first and reads no telemetry is right on 12 of them — 40 %, against the 33.3 % the
    // uniform baseline assumes.
    const floor = priorFloor(censusOf({ carts: 12, orders: 9, 'front-end': 9 }))!;
    expect(floor.candidates).toBe(3);
    expect(floor.uniform.ac1).toBeCloseTo(1 / 3, 12);
    expect(floor.uniform.avg5).toBeCloseTo(0.8, 12);
    expect(floor.ordered.ac1).toBeCloseTo(12 / 30, 12);
    expect(floor.ordered.order[0]).toBe('carts');
  });

  it('breaks a support tie by service id, so the baseline is a function of the cell', () => {
    // Insertion order is the runner's, not the corpus's: two runs that visit the same cases in a different order
    // must not produce two different baselines.
    const forwards = priorFloor(censusOf({ orders: 9, 'front-end': 9 }))!;
    const backwards = priorFloor(censusOf({ 'front-end': 9, orders: 9 }))!;
    expect(forwards.ordered.order).toEqual(['front-end', 'orders']);
    expect(backwards.ordered.order).toEqual(['front-end', 'orders']);
  });

  it('saturates AC@k below the candidate count, and only there', () => {
    const floor = priorFloor(censusOf({ a: 12, b: 9, c: 9 }))!;
    // Three candidates and five cutoffs: every case is inside the top three, so the ordered top five is 1 —
    // but the run of cutoffs above the pool is not flat before it gets there: AC@1 is the majority class,
    // AC@2 is everything but the last service, and only AC@3 onwards is saturated.
    expect(floor.ordered.top5).toBe(1);
    expect(floor.ordered.avg5).toBeCloseTo((12 / 30 + 21 / 30 + 1 + 1 + 1) / 5, 12);
  });
});

describe('priorFloor — the baseline the margin is taken against', () => {
  it('is the ordered rule object itself, so the two cannot drift', () => {
    // Not a copy and not a recomputation: a "stronger baseline" computed twice is two numbers with one name,
    // which is the defect class this package records as a term that silently stopped agreeing with itself.
    const floor = priorFloor(censusOf({ carts: 12, orders: 9, 'front-end': 9 }))!;
    expect(floor.baseline).toBe(floor.ordered);
  });

  it('dominates the uniform rule at both cutoffs it is compared on, over random label spaces', () => {
    // The claim the module's docblock makes in prose — "the top `k` services hold at least `k/S` of the cases,
    // so the ordered rule dominates the uniform one at every cutoff" — checked as arithmetic rather than
    // asserted. A deterministic generator, because a law that holds on a random draw is not a law.
    let seed = 0x2f6e2b1;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 0x80000000;
      return seed % bound;
    };
    let checked = 0;
    for (let trial = 0; trial < 240; trial += 1) {
      const candidates = 1 + next(8);
      const support: Record<string, number> = {};
      for (let i = 0; i < candidates; i += 1) support[`svc-${i}`] = 1 + next(40);
      const floor = priorFloor(censusOf(support))!;
      expect(floor.baseline.ac1).toBeGreaterThanOrEqual(floor.uniform.ac1 - 1e-12);
      expect(floor.baseline.avg5).toBeGreaterThanOrEqual(floor.uniform.avg5 - 1e-12);
      expect(floor.baseline.top5).toBeGreaterThanOrEqual(floor.uniform.top5 - 1e-12);
      checked += 1;
    }
    // Non-vacuity: a generator that produced no trials would pass every assertion above.
    expect(checked).toBe(240);
  });
});

describe('accumulatePriorFloor', () => {
  it('counts cases, correct cases and support together', () => {
    const census = createPriorFloorCensus();
    accumulatePriorFloor(census, { truth: 'a', correct: true });
    accumulatePriorFloor(census, { truth: 'a', correct: false });
    accumulatePriorFloor(census, { truth: 'b', correct: true });
    expect(census.cases).toBe(3);
    expect(census.engineCorrect).toBe(2);
    expect([...census.support.entries()].sort()).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });
});

describe('formatPriorFloorLine', () => {
  it('prints the floor beside the reading, and names a saturated top five', () => {
    const line = formatPriorFloorLine('OnlineBoutique', 'RE1', censusOf({ a: 25, b: 25 }, 40))!;
    expect(line).toContain('[prior-floor] OnlineBoutique/RE1:');
    expect(line).toContain('S=2');
    expect(line).toContain('telemetry-free AC@1 50.0%');
    expect(line).toContain('Top@5 100.0%');
    expect(line).toContain('engine AC@1 80.0%');
    expect(line).toContain('SATURATED');
  });

  it('does not claim saturation when the pool exceeds five candidates', () => {
    const support = Object.fromEntries('abcdef'.split('').map((k) => [k, 15]));
    const line = formatPriorFloorLine('TrainTicket', 'RE3', censusOf(support, 30))!;
    expect(line).toContain('Top@5 83.3%');
    expect(line).not.toContain('SATURATED');
  });

  it('reports the lift as a share of the margin the prior left', () => {
    // S=2: the prior takes half the unit interval, so an engine at 80 % holds 60 % of the reachable margin.
    const line = formatPriorFloorLine('X', 'Y', censusOf({ a: 25, b: 25 }, 40))!;
    expect(line).toContain('lift 60.0% of the reachable margin above the 50.0% frequency prior');
  });

  it('takes the margin against the FREQUENCY prior, not the uniform one it also prints', () => {
    // The defect this test was written for, measured on the cell that exposed it: RE3:SockShop is 12 / 9 / 9,
    // so the uniform floor is 33.3 % and a majority-class answer scores 40.0 %. The line printed both and then
    // divided by the weaker one — `(63.3 - 33.3)/66.7 = 45.0 %` instead of `(63.3 - 40.0)/60.0 = 38.9 %` — so
    // on exactly the cells where the labels give the most away the claim was the most flattering. Both numbers
    // are asserted, in opposite directions, so a reader cannot get the old one back by accident.
    const line = formatPriorFloorLine(
      'SockShop',
      'RE3',
      censusOf({ carts: 12, orders: 9, 'front-end': 9 }, 19),
    )!;
    expect(line).toContain('telemetry-free AC@1 33.3% (uniform) 40.0% (frequency)');
    expect(line).toContain('lift 38.9% of the reachable margin above the 40.0% frequency prior');
    expect(line).not.toContain('45.0%');
  });

  it('prints both Avg@5 floors, because on an unbalanced cell they are not the same number', () => {
    // The uniform mean is `(1 + 2 + 3 + 1 + 1)/15`… here: `(12 + 21 + 30)/30` over the first three cutoffs then
    // saturation — 0.82 against the uniform 0.80. One number would leave the reader unable to tell which
    // baseline the rate is above, which is the whole reason the line carries a floor at all.
    const line = formatPriorFloorLine(
      'SockShop',
      'RE3',
      censusOf({ carts: 12, orders: 9, 'front-end': 9 }, 19),
    )!;
    expect(line).toContain('Avg@5 80.0% (uniform) 82.0% (frequency)');
  });

  it('says a single-candidate cell has no margin rather than reporting a zero lift', () => {
    // The prior already takes the whole interval, so `(engine − prior)/(1 − prior)` is `0/0`. Printing `0.0 %`
    // would read as a failure of an engine that cannot be wrong on this cell.
    const line = formatPriorFloorLine('X', 'Y', censusOf({ only: 12 }, 12))!;
    expect(line).toContain('engine AC@1 100.0%');
    expect(line).toContain('lift n/a');
    expect(line).not.toContain('0.0% of the reachable margin');
  });

  it('has nothing to say about a cell with no cases', () => {
    expect(formatPriorFloorLine('X', 'Y', createPriorFloorCensus())).toBeUndefined();
  });
});

describe('formatPriorFloorSummary', () => {
  it('pools by cases rather than by cell rates', () => {
    // A 30-case cell at a 1/3 floor and a 125-case cell at a 1/5 floor: the pooled floor is the case-weighted
    // mixture, not the mean of 33.3 % and 20 %. Averaging rates is the defect `accuracy-aggregation` records at
    // the published level, and this line must not repeat it one level down.
    const small = censusOf({ a: 10, b: 10, c: 10 }, 0);
    const large = censusOf({ a: 25, b: 25, c: 25, d: 25, e: 25 }, 0);
    const line = formatPriorFloorSummary([small, large])!;
    const expected = (30 * (1 / 3) + 125 * (1 / 5)) / 155;
    expect(line).toContain('155 cases');
    expect(line).toContain(`telemetry-free AC@1 ${(expected * 100).toFixed(1)}%`);
  });

  it('pools the FREQUENCY prior, so an unbalanced cell is not counted at its weakest baseline', () => {
    // The same 30-case RE3 cell beside a balanced five-way one: `(30·0.40 + 125·0.20)/155 = 23.9 %` against the
    // uniform mixture's 22.6 %. Nine cells of this corpus include three unbalanced ones, so a pooled margin
    // taken against the uniform mixture would be the sum of nine flattering per-cell choices rather than one
    // decision applied nine times.
    const unbalanced = censusOf({ carts: 12, orders: 9, 'front-end': 9 }, 0);
    const balanced = censusOf({ a: 25, b: 25, c: 25, d: 25, e: 25 }, 0);
    const line = formatPriorFloorSummary([unbalanced, balanced])!;
    expect(line).toContain('155 cases');
    const pooledPrior = ((30 * 0.4 + 125 * 0.2) / 155) * 100;
    expect(line).toContain('telemetry-free AC@1 ' + pooledPrior.toFixed(1) + '% (frequency)');
    expect(line).not.toContain('22.6%');
  });

  it('is undefined when no cell held a case', () => {
    expect(formatPriorFloorSummary([createPriorFloorCensus()])).toBeUndefined();
  });

  it('carries the degenerate single-candidate cell into the pool', () => {
    // One cell with one candidate: the pooled prior is 1, so the pool has no reachable margin either, and the
    // summary has to say so instead of dividing by zero.
    const line = formatPriorFloorSummary([censusOf({ only: 5 }, 5)])!;
    expect(line).toContain('telemetry-free AC@1 100.0%');
    expect(line).toContain('lift n/a');
  });
});
