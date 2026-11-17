/**
 * ρ, the AUC, and the attribution rule: each one checked against a hand-computed number.
 *
 * @module benchmarks/__tests__/containment-residual.test
 */

import { describe, expect, it } from 'vitest';

import {
  DISCRIMINATION_BAR,
  MIN_POPULATION,
  attributeInversion,
  averageRanks,
  discriminate,
  discriminationAuc,
  edgeCounts,
  edgeEndpoints,
  edgeKeyOf,
  indicatorsOf,
  labelledPoints,
  populationCensus,
  residuals,
  top1Correct,
  verdictOf,
  type EdgeCounts,
} from '../src/containment-residual.js';
import type { ContainmentCaseRow, ContainmentPairRow } from '../src/containment-rows.js';

/** One case row, with the shapes the residual reads. */
function caseRow(input: {
  datapack?: string;
  fusionTop1?: string | null;
  gatedTop1?: string | null;
  ungatedTop1?: string | null;
  pairs?: ContainmentPairRow[];
  ungatedPairs?: ContainmentPairRow[];
}): ContainmentCaseRow {
  return {
    datapack: input.datapack ?? 'dp',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    fusionTop1: input.fusionTop1 ?? null,
    gatedTop1: input.gatedTop1 ?? null,
    ungatedTop1: input.ungatedTop1 ?? null,
    shippedTop1: input.gatedTop1 ?? null,
    replay: 'identical',
    pairs: input.pairs ?? [],
    ungatedPairs: input.ungatedPairs ?? input.pairs ?? [],
  };
}

/** An inverted pair with two measured excursions. */
function inverted(
  upper: string,
  lower: string,
  upperExcursion: number,
  lowerExcursion: number,
): ContainmentPairRow {
  return { upper, lower, decision: 'inverted', upperExcursion, lowerExcursion };
}

describe('edgeKeyOf / edgeEndpoints', () => {
  it('gives one key to an edge however the sweep ordered it', () => {
    expect(edgeKeyOf('a', 'b')).toBe(edgeKeyOf('b', 'a'));
  });

  it('splits a key back into the smaller endpoint first', () => {
    expect(edgeEndpoints(edgeKeyOf('zeta', 'alpha'))).toEqual({ a: 'alpha', b: 'zeta' });
  });

  it('reads a malformed key as an endpoint with no partner, rather than as a crash', () => {
    // The reader is total on purpose: a key without the separator is a corrupt artifact, and a `split` that threw
    // would take the whole census down instead of surfacing one bad row.
    expect(edgeEndpoints('nolabel')).toEqual({ a: 'nolabel', b: '' });
    expect(edgeEndpoints('')).toEqual({ a: '', b: '' });
    expect(edgeEndpoints(edgeKeyOf('', 'b'))).toEqual({ a: '', b: 'b' });
  });
});

describe('top1Correct', () => {
  it('is null when the arm produced no answer, rather than false', () => {
    expect(top1Correct(null, ['a'])).toBeNull();
  });

  it('accepts any member of a multi-label accepted set', () => {
    expect(top1Correct('b', ['a', 'b'])).toBe(true);
    expect(top1Correct('c', ['a', 'b'])).toBe(false);
  });
});

describe('edgeCounts', () => {
  it('counts only the arm’s inversions', () => {
    const rows = [
      caseRow({
        pairs: [
          {
            upper: 'a',
            lower: 'b',
            decision: 'no-failed-interface',
            upperExcursion: 1,
            lowerExcursion: 2,
          },
        ],
        ungatedPairs: [inverted('a', 'b', 1, 2)],
      }),
    ];
    expect(edgeCounts(rows, 'gated').size).toBe(0);
    const ungated = edgeCounts(rows, 'ungated');
    expect(ungated.get(edgeKeyOf('a', 'b'))).toEqual({ measured: 1, bothOut: 1, aOut: 1, bOut: 1 });
  });

  it('refuses an observation whose either side is unmeasured', () => {
    const rows = [
      caseRow({
        ungatedPairs: [{ upper: 'a', lower: 'b', decision: 'inverted', lowerExcursion: 2 }],
      }),
    ];
    expect(edgeCounts(rows, 'ungated').size).toBe(0);
  });

  it('assigns the out-of-band indicators to the canonical endpoints, not to the sweep positions', () => {
    // `zeta` is the UPPER side here and also the canonical `b`; an implementation that read the excursions
    // positionally would swap the two marginals and the residual would be right for the wrong reason.
    const rows = [caseRow({ ungatedPairs: [inverted('zeta', 'alpha', 3, 0)] })];
    const counts = edgeCounts(rows, 'ungated').get(edgeKeyOf('alpha', 'zeta'))!;
    expect(counts.aOut).toBe(0);
    expect(counts.bOut).toBe(1);
    expect(counts.bothOut).toBe(0);
  });

  it('treats a measured zero as a measurement, not as absence', () => {
    const rows = [caseRow({ ungatedPairs: [inverted('a', 'b', 0, 0)] })];
    expect(edgeCounts(rows, 'ungated').get(edgeKeyOf('a', 'b'))).toEqual({
      measured: 1,
      bothOut: 0,
      aOut: 0,
      bOut: 0,
    });
  });
});

describe('residuals', () => {
  /** The counts of `n` observations with the given joint and marginal totals. */
  function counts(measured: number, bothOut: number, aOut: number, bOut: number): EdgeCounts {
    return { measured, bothOut, aOut, bOut };
  }

  it('reproduces the hand-computed residual', () => {
    // bothOut/n − (aOut/n)(bOut/n) = 5/10 − 0.6 × 0.7 = 0.5 − 0.42
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(10, 5, 6, 7)]]));
    expect(result[0]!.rho).toBeCloseTo(0.08, 12);
  });

  it('is zero when the joint frequency equals the product of the marginals', () => {
    // 3/10 − (5/10)(6/10) = 0.3 − 0.3, exactly, with every count non-trivial: a residual computed as
    // `bothOut/n` alone would read 0.3 here and the test would pass for the wrong reason.
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(10, 3, 5, 6)]]));
    expect(result[0]!.rho).toBeCloseTo(0, 12);
  });

  it('is null below the population floor rather than a number', () => {
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(MIN_POPULATION - 1, 5, 5, 5)]]));
    expect(result[0]!.rho).toBeNull();
  });

  it('is a number at exactly the floor', () => {
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(MIN_POPULATION, 5, 5, 5)]]));
    expect(result[0]!.rho).not.toBeNull();
  });

  it('reports phi beside rho, on the scale that removes the marginal ceiling', () => {
    // n=10 with 9 out each side and 10 joint: rho = 1 − 0.81 = 0.19, and phi = 0.19 / (0.3 × 0.3) = 2.111…
    // The same coupling at p = q = 0.5 would read rho = 0.25, phi = 1 — so phi is the statistic that does not
    // depend on where the marginals sit, which is why it is printed beside the pre-registered one.
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(10, 10, 9, 9)]]));
    expect(result[0]!.rho).toBeCloseTo(0.19, 12);
    expect(result[0]!.phi).toBeCloseTo(0.19 / 0.09, 12);
  });

  it('leaves phi undefined at a degenerate marginal rather than reporting independence', () => {
    // `p = 1`: the correlation has no denominator. Reading it as 0 would say "these two are independent" about an
    // edge whose upper side is out of band in every observation.
    const result = residuals(new Map([[edgeKeyOf('a', 'b'), counts(10, 5, 10, 5)]]));
    expect(result[0]!.rho).not.toBeNull();
    expect(result[0]!.phi).toBeNull();
  });

  it('orders its output by edge key so two runs build the same table', () => {
    const result = residuals(
      new Map([
        [edgeKeyOf('z', 'y'), counts(10, 1, 1, 1)],
        [edgeKeyOf('a', 'b'), counts(10, 1, 1, 1)],
      ]),
    );
    expect(result.map((entry) => `${entry.a}<${entry.b}`)).toEqual(['a<b', 'y<z']);
  });
});

describe('averageRanks', () => {
  it('assigns ties the mean of the ranks they span', () => {
    expect(averageRanks([1, 2, 2, 3])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('handles an all-tied vector', () => {
    expect(averageRanks([7, 7, 7])).toEqual([2, 2, 2]);
  });

  it('is independent of the input order', () => {
    const forward = averageRanks([0.1, 0.2, 0.2]);
    const backward = averageRanks([0.2, 0.2, 0.1]);
    expect(forward).toEqual([1, 2.5, 2.5]);
    expect(backward).toEqual([2.5, 2.5, 1]);
  });
});

describe('discriminationAuc', () => {
  it('is 1 when every positive outscores every negative', () => {
    expect(
      discriminationAuc([
        { rho: 0.5, positive: 1 },
        { rho: 0.4, positive: 1 },
        { rho: 0.2, positive: 0 },
        { rho: 0.1, positive: 0 },
      ]),
    ).toBe(1);
  });

  it('is 0 when the ordering is exactly reversed', () => {
    expect(
      discriminationAuc([
        { rho: 0.1, positive: 1 },
        { rho: 0.9, positive: 0 },
      ]),
    ).toBe(0);
  });

  it('counts a tie as half', () => {
    expect(
      discriminationAuc([
        { rho: 0.3, positive: 1 },
        { rho: 0.3, positive: 0 },
      ]),
    ).toBe(0.5);
  });

  it('is null with one class, not 0.5', () => {
    expect(discriminationAuc([{ rho: 0.3, positive: 1 }])).toBeNull();
    expect(discriminationAuc([])).toBeNull();
  });
});

describe('attributeInversion', () => {
  it('labels a gain when the arm answered a case the control missed, on one inversion', () => {
    const row = caseRow({
      fusionTop1: 'frontend',
      ungatedTop1: 'cart',
      ungatedPairs: [inverted('frontend', 'cart', 0, 2)],
    });
    expect(attributeInversion(row, ['cart'])).toEqual({ kind: 'gain' });
  });

  it('labels a loss when the arm lost a case the control answered', () => {
    const row = caseRow({
      fusionTop1: 'cart',
      ungatedTop1: 'frontend',
      ungatedPairs: [inverted('cart', 'frontend', 0, 2)],
    });
    expect(attributeInversion(row, ['cart'])).toEqual({ kind: 'loss' });
  });

  it('is unchanged when both orders answer or both miss', () => {
    const row = caseRow({ fusionTop1: 'cart', ungatedTop1: 'db' });
    expect(attributeInversion(row, ['cart', 'db'])).toEqual({ kind: 'unchanged' });
    expect(attributeInversion(row, ['other'])).toEqual({ kind: 'unchanged' });
  });

  it('reports a dump that moved its answer with no recorded inversion as unattributable', () => {
    // This is a self-contradictory artifact rather than a case: a top-1 cannot move without a pair moving. The
    // label is `ambiguous` with zero candidates so the census counts it as a refusal, and the run's own replay
    // count is what a reader turns to when it is not zero.
    const row = caseRow({ fusionTop1: 'cart', ungatedTop1: 'db' });
    expect(attributeInversion(row, ['cart'])).toEqual({ kind: 'ambiguous', candidates: 0 });
  });

  it('is unanswered when either order produced no candidate', () => {
    expect(attributeInversion(caseRow({ fusionTop1: null, ungatedTop1: 'a' }), ['a'])).toEqual({
      kind: 'unanswered',
    });
    expect(attributeInversion(caseRow({ fusionTop1: 'a', ungatedTop1: null }), ['a'])).toEqual({
      kind: 'unanswered',
    });
  });

  it('refuses to attribute a move to one of several inversions', () => {
    const row = caseRow({
      fusionTop1: 'frontend',
      ungatedTop1: 'cart',
      ungatedPairs: [inverted('frontend', 'cart', 0, 2), inverted('cart', 'db', 0, 3)],
    });
    expect(attributeInversion(row, ['cart'])).toEqual({ kind: 'ambiguous', candidates: 2 });
  });

  it('reads the requested arm’s trace, so the two arms can be labelled from one dump', () => {
    const row = caseRow({
      fusionTop1: 'frontend',
      gatedTop1: 'frontend',
      ungatedTop1: 'cart',
      pairs: [
        {
          upper: 'frontend',
          lower: 'cart',
          decision: 'no-failed-interface',
          upperExcursion: 0,
          lowerExcursion: 2,
        },
      ],
      ungatedPairs: [inverted('frontend', 'cart', 0, 2)],
    });
    expect(attributeInversion(row, ['cart'], 'gated')).toEqual({ kind: 'unchanged' });
    expect(attributeInversion(row, ['cart'], 'ungated')).toEqual({ kind: 'gain' });
  });
});

/**
 * Ten cases that all invert the SAME pair, `both` of which have both sides out.
 *
 * The arm always promotes `lower` past `upper`, so the pair the sweep recorded is the fusion adjacency and the
 * move is one place — which is the only configuration `attributeInversion` will label.
 */
function sameEdgeCorpus(input: {
  readonly prefix: string;
  readonly both: number;
  readonly total?: number;
  readonly upper: string;
  readonly lower: string;
  readonly accepted: string;
}): { rows: ContainmentCaseRow[]; answers: Map<string, readonly string[]> } {
  const total = input.total ?? 10;
  const rows: ContainmentCaseRow[] = [];
  const answers = new Map<string, readonly string[]>();
  for (let i = 0; i < total; i++) {
    const out = i < input.both ? 1 : 0;
    rows.push(
      caseRow({
        datapack: `${input.prefix}-${i}`,
        fusionTop1: input.upper,
        ungatedTop1: input.lower,
        gatedTop1: input.upper,
        ungatedPairs: [inverted(input.upper, input.lower, out, out)],
      }),
    );
    answers.set(`${input.prefix}-${i}`, [input.accepted]);
  }
  return { rows, answers };
}

describe('labelledPoints', () => {
  it('pairs each label with the residual of the edge it was taken on', () => {
    // Five observations with both sides out and five with neither: the joint frequency is 0.5 against marginals
    // of 0.5 each, so ρ = 0.5 − 0.25. A corpus where every observation has both sides out would give ρ = 0 —
    // the estimator's ceiling at high marginals, recorded in `docs/containment-order.md` §14.
    const { rows, answers } = sameEdgeCorpus({
      prefix: 'a',
      both: 5,
      upper: 'frontend',
      lower: 'cart',
      accepted: 'cart',
    });
    const { points, census } = labelledPoints(rows, answers, 'ungated');
    expect(census.gains).toBe(10);
    expect(census.scoredGains).toBe(10);
    expect(points).toHaveLength(10);
    expect(points[0]!.positive).toBe(1);
    expect(points[0]!.rho).toBeCloseTo(0.25, 12);
  });

  it('drops a label whose edge is below the population floor, and says so in the census', () => {
    const rows = [
      caseRow({
        datapack: 'a',
        fusionTop1: 'frontend',
        ungatedTop1: 'cart',
        ungatedPairs: [inverted('cart', 'frontend', 0, 2)],
      }),
    ];
    const { points, census } = labelledPoints(rows, new Map([['a', ['cart']]]), 'ungated');
    expect(points).toHaveLength(0);
    expect(census.gains).toBe(1);
    expect(census.scoredGains).toBe(0);
  });

  it('counts the cases an arm touched but did not move, and the cases with no answer', () => {
    const rows = [
      // The arm inverted nothing and the answer is the same either way.
      caseRow({ datapack: 'still', fusionTop1: 'cart', ungatedTop1: 'cart' }),
      // The arm produced no candidate at all.
      caseRow({ datapack: 'silent', fusionTop1: 'cart', ungatedTop1: null }),
    ];
    const answers = new Map([
      ['still', ['cart']],
      ['silent', ['cart']],
    ]);
    const { points, census } = labelledPoints(rows, answers, 'ungated');
    expect(points).toEqual([]);
    expect(census.unchanged).toBe(1);
    expect(census.unanswered).toBe(1);
  });

  it('skips a case the acceptance file did not carry instead of counting it as wrong', () => {
    const rows = [
      caseRow({
        datapack: 'missing',
        fusionTop1: 'frontend',
        ungatedTop1: 'cart',
        ungatedPairs: [inverted('cart', 'frontend', 0, 2)],
      }),
    ];
    const { census } = labelledPoints(rows, new Map(), 'ungated');
    expect(census.gains + census.losses + census.unchanged + census.ambiguous).toBe(0);
  });
});

describe('discriminate / verdictOf', () => {
  it('reports the bar as a value rather than a sentence', () => {
    expect(DISCRIMINATION_BAR).toBe(0.8);
    expect(verdictOf({ arm: 'gated', score: 'rho', census: censusOf(), auc: 0.81 })).toBe('pass');
    expect(verdictOf({ arm: 'gated', score: 'rho', census: censusOf(), auc: 0.8 })).toBe('fail');
    expect(verdictOf({ arm: 'gated', score: 'rho', census: censusOf(), auc: null })).toBe(
      'unmeasured',
    );
  });

  it('names the reason a population could not support an estimate', () => {
    const empty = discriminate([], new Map(), 'gated');
    expect(empty.auc).toBeNull();
    expect(empty.unavailable).toBe('no labelled inversion had a residual');
  });

  it('names the empty class when only one label survived', () => {
    const { rows, answers } = sameEdgeCorpus({
      prefix: 'a',
      both: 5,
      upper: 'frontend',
      lower: 'cart',
      accepted: 'cart',
    });
    const oneClass = discriminate(rows, answers, 'ungated');
    expect(oneClass.census.gains).toBe(10);
    expect(oneClass.auc).toBeNull();
    expect(oneClass.unavailable).toBe('one class is empty (gains=10, losses=0)');
  });

  it('reads a perfect separation as an AUC of 1', () => {
    // Gains on one edge (both sides out half the time → ρ = 0.25) against losses on another (only the callee out
    // every time → ρ = 0). Two edges are needed because ρ lives on an edge and one case contributes one
    // observation to it, so a ten-observation population is ten cases.
    // A gain: the arm promotes `cart` past `frontend` and `cart` is the answer.
    const gains = sameEdgeCorpus({
      prefix: 'gain',
      both: 5,
      upper: 'frontend',
      lower: 'cart',
      accepted: 'cart',
    });
    // A loss on a DIFFERENT edge: the arm promotes `gamma` past `beta`, and `beta` was the answer. Two edges are
    // required rather than two labels on one — ρ is a property of an edge, so a gain and a loss taken on the same
    // pair would pool into one estimate and the separation would be invisible by construction.
    const losses = sameEdgeCorpus({
      prefix: 'loss',
      both: 0,
      upper: 'beta',
      lower: 'gamma',
      accepted: 'beta',
    });
    const rows = [...gains.rows, ...losses.rows];
    const answers = new Map([...gains.answers, ...losses.answers]);
    const result = discriminate(rows, answers, 'ungated');
    expect(result.census.gains).toBe(10);
    expect(result.census.losses).toBe(10);
    expect(result.auc).toBe(1);
  });

  it('scores phi on request, over the same labelled population', () => {
    const { rows, answers } = sameEdgeCorpus({
      prefix: 'a',
      both: 5,
      upper: 'frontend',
      lower: 'cart',
      accepted: 'cart',
    });
    const rho = discriminate(rows, answers, 'ungated', 'rho');
    const phi = discriminate(rows, answers, 'ungated', 'phi');
    expect(phi.score).toBe('phi');
    expect(phi.census).toEqual(rho.census);
    // p = q = 0.5, both = 0.5 → rho = 0.25 and phi = 0.25 / 0.25 = 1.
    expect(rho.auc).toBeNull();
    expect(phi.auc).toBeNull();
  });

  it('refuses an ambiguous case rather than attributing its move to a guess', () => {
    const rows = [
      caseRow({
        datapack: 'gain',
        fusionTop1: 'frontend',
        ungatedTop1: 'cart',
        ungatedPairs: [inverted('frontend', 'cart', 0, 2), inverted('cart', 'db', 0, 3)],
      }),
    ];
    const result = discriminate(rows, new Map([['gain', ['cart']]]), 'ungated');
    expect(result.census.ambiguous).toBe(1);
    expect(result.census.gains).toBe(0);
  });
});

describe('populationCensus', () => {
  it('reports an empty corpus as zeros rather than dividing by nothing', () => {
    expect(populationCensus(new Map())).toEqual({
      edges: 0,
      scoredEdges: 0,
      observations: 0,
      largest: 0,
      median: 0,
    });
  });

  it('takes the middle observation for an odd count and the mean of the two for an even one', () => {
    const map = new Map<string, EdgeCounts>([
      [edgeKeyOf('a', 'b'), { measured: 3, bothOut: 0, aOut: 0, bOut: 0 }],
      [edgeKeyOf('a', 'c'), { measured: 5, bothOut: 0, aOut: 0, bOut: 0 }],
      [edgeKeyOf('a', 'd'), { measured: 20, bothOut: 0, aOut: 0, bOut: 0 }],
    ]);
    expect(populationCensus(map)).toEqual({
      edges: 3,
      scoredEdges: 1,
      observations: 28,
      largest: 20,
      median: 5,
    });
    map.set(edgeKeyOf('a', 'e'), { measured: 4, bothOut: 0, aOut: 0, bOut: 0 });
    expect(populationCensus(map).median).toBe(4.5);
  });
});

describe('indicatorsOf', () => {
  it('reads a measured zero as "in band" and an absent side as unmeasurable', () => {
    expect(indicatorsOf(inverted('a', 'b', 0, 1))).toEqual({ upperOut: false, lowerOut: true });
    expect(
      indicatorsOf({ upper: 'a', lower: 'b', decision: 'unmeasured', lowerExcursion: 1 }),
    ).toBeNull();
  });
});

/** A census with every counter at zero, for the verdict table. */
function censusOf(): {
  gains: number;
  losses: number;
  unchanged: number;
  unanswered: number;
  ambiguous: number;
  scoredGains: number;
  scoredLosses: number;
} {
  return {
    gains: 0,
    losses: 0,
    unchanged: 0,
    unanswered: 0,
    ambiguous: 0,
    scoredGains: 0,
    scoredLosses: 0,
  };
}
