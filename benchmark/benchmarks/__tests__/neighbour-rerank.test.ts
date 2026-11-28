/**
 * The neighbour rerank probe, asserted clause by clause.
 *
 * Three things are load-bearing and each is asserted rather than trusted: the arm at `α = 0` IS the engine (so a
 * gain at any other `α` is a gain against the published order and not against a re-derivation of it), the blend
 * cannot pay for degree (so the refused `topoWeight` mechanism cannot return through this door), and the decision
 * rule refuses as loudly as it adopts (so a sweep of seven arms cannot report its own maximum as a finding).
 */
import { describe, expect, it } from 'vitest';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import type { CellScore } from '../src/cloudopsbench-score.js';
import type { CellTruth } from '../src/cloudopsbench-suite.js';
import {
  ALPHA_GRID,
  MIRROR_GRID,
  asPrediction,
  blendedScores,
  decide,
  directionSplit,
  formatDirectionSplit,
  formatSweep,
  mcnemarExact,
  movementOf,
  neighbourNull,
  orderByScores,
  poissonBinomialPmf,
  rerankCase,
  sweep,
  tailAtLeast,
  tailAtMost,
  undirectedNeighbourhood,
  unitScores,
  type ArmRow,
  type Movement,
  type ProbeCase,
} from '../src/neighbour-rerank.js';

/**
 * A straight chain `a → b → c` with scores 0.9, 0.5, 0.1.
 *
 * The chain is the smallest graph on which "a partner's mean" differs from "the loudest partner": `b` has two
 * partners whose mean is 0.5, so an arm that paid the maximum would move `b` up and one that pays the mean leaves it
 * exactly where it was.
 */
function chainCase(over: Partial<ProbeCase> = {}): ProbeCase {
  return {
    caseId: 'chain',
    ranking: [
      { serviceId: 'a', score: 0.9 },
      { serviceId: 'b', score: 0.5 },
      { serviceId: 'c', score: 0.1 },
    ],
    edges: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ],
    accepted: ['c'],
    ...over,
  };
}

/** One cell row, for the decision rule. */
function cell(top1: number, cases: number, system = 's', category = 'c'): CellScore {
  return {
    system,
    category,
    cases,
    top1,
    top3: top1,
    top5: top1,
    ranked: cases,
    jointComparable: false,
  };
}

/** An arm row whose overall cell hits `top1` of `cases`. */
function armRow(alpha: number, top1: number, cases = 10): ArmRow {
  return { alpha, cells: [cell(top1, cases, 's', 'c'), cell(top1, cases, 'all', 'all')] };
}

/** A movement with a given discordant pair and no interest in the p-value's provenance. */
function movement(gained: number, lost: number): Movement {
  return { gained, lost, p: mcnemarExact(gained, lost) };
}

/** A prediction record, for the paired comparison. */
function prediction(caseId: string, correct: boolean): CasePrediction {
  return { caseId, truth: 'c', top1: correct ? 'c' : 'a', correct };
}

describe('the within-case scale', () => {
  it('maps the extremes to 0 and 1 and keeps every gap between them', () => {
    const scores = unitScores(chainCase().ranking);
    expect(scores.get('a')).toBe(1);
    expect(scores.get('c')).toBe(0);
    expect(scores.get('b')).toBeCloseTo(0.5, 12);
  });

  it('maps a ranking with one score to zero everywhere, because a span of nothing has no scale', () => {
    const scores = unitScores([
      { serviceId: 'a', score: 3 },
      { serviceId: 'b', score: 3 },
    ]);
    expect([...scores.values()]).toEqual([0, 0]);
  });

  it('answers an empty ranking with an empty map rather than an Infinity', () => {
    expect(unitScores([]).size).toBe(0);
  });

  it('is monotone, so it cannot change the engine’s order by itself', () => {
    const ranking = [
      { serviceId: 'x', score: -4 },
      { serviceId: 'y', score: -1 },
      { serviceId: 'z', score: 7 },
    ];
    const scores = unitScores(ranking);
    expect(scores.get('x')!).toBeLessThan(scores.get('y')!);
    expect(scores.get('y')!).toBeLessThan(scores.get('z')!);
    expect(scores.get('x')).toBe(0);
    expect(scores.get('z')).toBe(1);
  });
});

describe('the neighbourhood', () => {
  it('is undirected and deduplicated, so a reciprocal pair is ONE partner each', () => {
    const neighbourhood = undirectedNeighbourhood(
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
      new Set(['a', 'b']),
    );
    expect(neighbourhood.get('a')).toEqual(['b']);
    expect(neighbourhood.get('b')).toEqual(['a']);
  });

  it('drops a self-loop, because averaging a node with itself is not a transfer', () => {
    const neighbourhood = undirectedNeighbourhood([{ from: 'a', to: 'a' }], new Set(['a']));
    expect(neighbourhood.get('a')).toEqual([]);
  });

  it('drops an edge to a service the ranking does not contain, at either end', () => {
    const neighbourhood = undirectedNeighbourhood(
      [
        { from: 'a', to: 'ghost' },
        { from: 'ghost', to: 'b' },
        { from: 'a', to: 'b' },
      ],
      new Set(['a', 'b']),
    );
    expect(neighbourhood.get('a')).toEqual(['b']);
    expect(neighbourhood.get('b')).toEqual(['a']);
    expect(neighbourhood.has('ghost')).toBe(false);
  });

  it('gives every ranked candidate an entry, including the isolated ones', () => {
    const neighbourhood = undirectedNeighbourhood([], new Set(['a', 'b']));
    expect([...neighbourhood.keys()]).toEqual(['a', 'b']);
    expect(neighbourhood.get('a')).toEqual([]);
  });
});

describe('the blend', () => {
  it('reproduces the own score at α = 0 for every node, partnered or not', () => {
    const one = chainCase();
    const neighbourhood = undirectedNeighbourhood(one.edges, new Set(['a', 'b', 'c']));
    const own = unitScores(one.ranking);
    const blended = blendedScores(one.ranking, neighbourhood, 0);
    for (const candidate of one.ranking) {
      expect(blended.get(candidate.serviceId)).toBe(own.get(candidate.serviceId));
    }
  });

  it('pays the MEAN of the partners and not their maximum, which is the degree confound refused', () => {
    // `b` sits between 1 and 0, so the mean of its partners is exactly its own value and it must not move; a
    // maximum would have dragged it to 1 and a sum would have made it 1.5.
    const one = chainCase();
    const neighbourhood = undirectedNeighbourhood(one.edges, new Set(['a', 'b', 'c']));
    const blended = blendedScores(one.ranking, neighbourhood, 1);
    expect(blended.get('b')).toBeCloseTo(0.5, 12);
    expect(blended.get('a')).toBeCloseTo(0.5, 12);
    expect(blended.get('c')).toBeCloseTo(0.5, 12);
  });

  it('treats a candidate the neighbourhood map forgot as isolated, rather than throwing at it', () => {
    const one = chainCase();
    const blended = blendedScores(one.ranking, new Map([['a', ['b']]]), 1);
    // `b` and `c` carry no entry, so they keep their own unit score; `a` takes its partner's.
    expect(blended.get('b')).toBeCloseTo(0.5, 12);
    expect(blended.get('c')).toBe(0);
  });

  it('counts a partner with no score of its own as nothing, because absence is not a measurement', () => {
    const one = chainCase();
    const blended = blendedScores(one.ranking, new Map([['a', ['b', 'ghost']]]), 1);
    expect(blended.get('a')).toBeCloseTo(0.25, 12);
  });

  it('leaves an isolated candidate exactly where the engine put it at every α', () => {
    const one = chainCase({ edges: [] });
    for (const alpha of ALPHA_GRID) {
      const neighbourhood = undirectedNeighbourhood(one.edges, new Set(['a', 'b', 'c']));
      const blended = blendedScores(one.ranking, neighbourhood, alpha);
      expect(blended.get('a')).toBe(1);
      expect(blended.get('c')).toBe(0);
    }
  });

  it('carries a negative weight, which is the mirror arm', () => {
    const one = chainCase();
    const neighbourhood = undirectedNeighbourhood(one.edges, new Set(['a', 'b', 'c']));
    const blended = blendedScores(one.ranking, neighbourhood, -0.5);
    // `a` keeps 1.5 of its own unit score and pays half of its only partner's 0.5.
    expect(blended.get('a')).toBeCloseTo(1.5 - 0.25, 12);
  });
});

describe('the ordering', () => {
  it('breaks a tie the way the engine did rather than by id', () => {
    const ranking = [
      { serviceId: 'zeta', score: 1 },
      { serviceId: 'alpha', score: 1 },
    ];
    const order = orderByScores(
      ranking,
      new Map([
        ['zeta', 1],
        ['alpha', 1],
      ]),
    );
    // A string comparison would answer `alpha` first; the engine's order says `zeta`.
    expect(order).toEqual(['zeta', 'alpha']);
  });

  it('reproduces the engine’s order at α = 0, which is the identity the whole probe rests on', () => {
    const one = chainCase({ accepted: ['a'] });
    expect(rerankCase(one, 0)).toEqual(['a', 'b', 'c']);
  });

  it('lifts a middle candidate when its partner is louder than it is', () => {
    // `b`'s only partner is `a` at 1.0 and `b` is at 0.5, so at α = 0.9 `b` overtakes nothing but closes to 0.95
    // while `a` falls to 0.55 — the order becomes b, a, c.
    const one = chainCase({ edges: [{ from: 'a', to: 'b' }] });
    expect(rerankCase(one, 0.9)).toEqual(['b', 'a', 'c']);
  });
});

describe('an arm’s record', () => {
  it('reads `correct` as top1 ∈ accepted, so a multi-label case is not a miss', () => {
    const one = chainCase({ accepted: ['a', 'c'] });
    const record = asPrediction(one, ['c', 'b', 'a']);
    expect(record.correct).toBe(true);
    expect(record.truthRank).toBe(1);
  });

  it('reports an unranked accepted answer as `undefined` rather than as rank 0', () => {
    const record = asPrediction(chainCase(), ['a', 'b']);
    expect(record.truthRank).toBeUndefined();
    expect(record.correct).toBe(false);
    expect(record.pool).toBe(2);
  });

  it('refuses a case that states no accepted answer', () => {
    expect(() => asPrediction(chainCase({ accepted: [] }), ['a'])).toThrow(/no accepted answer/);
  });

  it('carries an empty order as a record with no top-1', () => {
    const record = asPrediction(chainCase(), []);
    expect(record.top1).toBeUndefined();
    expect(record.correct).toBe(false);
  });
});

describe('the sweep', () => {
  const truths = new Map<string, CellTruth>([['chain', { system: 's', category: 'c' }]]);

  it('prints one row per weight, in the grid’s order, ending at the neighbour-only arm', () => {
    const rows = sweep([chainCase()], truths);
    expect(rows.map((one) => one.alpha)).toEqual([...ALPHA_GRID]);
    expect(rows[rows.length - 1]!.alpha).toBe(1);
  });

  it('scores the mirror grid on the same cases', () => {
    const rows = sweep([chainCase()], truths, MIRROR_GRID);
    expect(rows.map((one) => one.alpha)).toEqual([...MIRROR_GRID]);
  });

  it('adopts nothing at α = 0 on a case it already gets right', () => {
    const rows = sweep([chainCase({ accepted: ['a'] })], truths);
    for (const row of rows) expect(row.cells[0]!.top1).toBe(1);
  });
});

describe('the exact paired test', () => {
  it('matches the textbook value for 2 against 11 discordant pairs', () => {
    expect(mcnemarExact(2, 9)).toBeCloseTo(0.0654, 4);
  });

  it('is symmetric in its two arguments', () => {
    expect(mcnemarExact(3, 11)).toBe(mcnemarExact(11, 3));
  });

  it('answers a comparison with no discordant pair with 1, not with 0', () => {
    expect(mcnemarExact(0, 0)).toBe(1);
  });

  it('caps at 1 rather than reporting a probability above it', () => {
    expect(mcnemarExact(5, 5)).toBeLessThanOrEqual(1);
  });

  it('cannot fall below the double-precision floor on a large discordant population', () => {
    expect(mcnemarExact(0, 200)).toBeGreaterThanOrEqual(0);
    expect(mcnemarExact(0, 200)).toBeLessThan(1e-50);
  });
});

describe('the movement of one arm', () => {
  it('counts a gain and a loss and neither for an untouched case', () => {
    const base = [prediction('1', true), prediction('2', false)];
    const arm = [prediction('1', false), prediction('2', false)];
    expect(movementOf(base, arm)).toMatchObject({ gained: 0, lost: 1 });
  });

  it('counts a case the arm repaired as a gain, which is the other half of the pair', () => {
    const base = [prediction('1', false), prediction('2', true)];
    const arm = [prediction('1', true), prediction('2', true)];
    expect(movementOf(base, arm)).toMatchObject({ gained: 1, lost: 0 });
  });

  it('refuses two lists of different lengths instead of comparing what they share', () => {
    expect(movementOf([prediction('1', true)], [])).toBeNull();
  });

  it('refuses two lists that are not the same cases in the same order', () => {
    expect(movementOf([prediction('1', true)], [prediction('2', true)])).toBeNull();
  });
});

describe('the null a neighbour share is read against', () => {
  it('is the Poisson-binomial and not the binomial, because each miss carries its own probability', () => {
    const pmf = poissonBinomialPmf([0.5, 0.5]);
    expect(Array.from(pmf)).toEqual([0.25, 0.5, 0.25]);
    expect(tailAtMost(pmf, 1)).toBeCloseTo(0.75, 12);
    expect(tailAtLeast(pmf, 1)).toBeCloseTo(0.75, 12);
  });

  it('sums to one over any probability list', () => {
    const pmf = poissonBinomialPmf([0.2, 0.4, 0.6, 0.8]);
    expect(Array.from(pmf).reduce((sum, one) => sum + one, 0)).toBeCloseTo(1, 12);
  });

  it('handles the degenerate probabilities without a special case', () => {
    expect(Array.from(poissonBinomialPmf([0, 1]))).toEqual([0, 1, 0]);
  });

  it('answers an empty draw with certainty at zero successes', () => {
    expect(Array.from(poissonBinomialPmf([]))).toEqual([1]);
  });

  it('reads a share above the null as a finding, and a count it could have produced by chance as none', () => {
    // Four misses in a pool of four: the truth of each has ONE partner among the three other candidates, so the
    // null is 4 × 1/3 = 1.33 and a count of 4 is loud. Three cases would give p = 0.074, which is why the
    // population matters and why the grid's Bonferroni bar exists.
    const build = (): ProbeCase => ({
      caseId: 'x',
      ranking: [
        { serviceId: 'p', score: 1 },
        { serviceId: 'truth', score: 0.5 },
        { serviceId: 'r', score: 0.1 },
        { serviceId: 's', score: 0.05 },
      ],
      edges: [{ from: 'truth', to: 'p' }],
      accepted: ['truth'],
    });
    const cases = Array.from({ length: 4 }, build);
    const base = cases.map((one) =>
      asPrediction(
        one,
        one.ranking.map((c) => c.serviceId),
      ),
    );
    const reading = neighbourNull(cases, base)!;
    expect(reading.misses).toBe(4);
    expect(reading.observed).toBe(4);
    expect(reading.expected).toBeCloseTo(4 / 3, 12);
    expect(reading.p).toBeLessThan(0.05);
  });

  it('skips a hit when it builds the null, because a hit is not a miss', () => {
    const hit = chainCase({ accepted: ['a'] });
    const miss = chainCase({ accepted: ['b'] });
    const reading = neighbourNull(
      [hit, miss],
      [prediction('chain', true), prediction('chain', false)],
    )!;
    expect(reading.misses).toBe(1);
    expect(reading.observed).toBe(1);
  });

  it('refuses to read a population that is not the one it was given', () => {
    expect(neighbourNull([], [prediction('1', false)])).toBeNull();
  });

  it('cannot let a one-candidate pool contribute a probability', () => {
    const one: ProbeCase = {
      caseId: 'solo',
      ranking: [{ serviceId: 'truth', score: 1 }],
      edges: [{ from: 'truth', to: 'truth' }],
      accepted: ['nobody'],
    };
    const reading = neighbourNull([one], [prediction('solo', false)])!;
    expect(reading.expected).toBe(0);
    expect(reading.observed).toBe(0);
    expect(reading.p).toBe(1);
  });

  it('skips a miss with no ranking rather than scoring it as a neighbour', () => {
    const empty: ProbeCase = { caseId: 'e', ranking: [], edges: [], accepted: ['truth'] };
    expect(neighbourNull([empty], [prediction('e', false)])!.misses).toBe(0);
  });
});

describe('the direction of a miss', () => {
  it('separates a blame on what the truth calls from one on what calls it', () => {
    const down = chainCase({ accepted: ['b'], edges: [{ from: 'b', to: 'a' }] });
    const up = chainCase({ accepted: ['b'], edges: [{ from: 'a', to: 'b' }] });
    const split = directionSplit(
      [down, up],
      [prediction('chain', false), prediction('chain', false)],
    );
    expect(split).toEqual({ misses: 2, downstream: 1, upstream: 1, both: 0, neither: 0 });
  });

  it('names a reciprocal edge as its own branch, because neither direction explains the miss', () => {
    const both = chainCase({
      accepted: ['b'],
      edges: [
        { from: 'b', to: 'a' },
        { from: 'a', to: 'b' },
      ],
    });
    const split = directionSplit([both], [prediction('chain', false)]);
    expect(split.both).toBe(1);
    expect(split.neither).toBe(0);
  });

  it('counts an unrelated winner as unrelated, and a hit as none of the four', () => {
    const unrelated = chainCase({ accepted: ['b'], edges: [] });
    const hit = chainCase({ accepted: ['a'] });
    const split = directionSplit(
      [unrelated, hit],
      [prediction('chain', false), prediction('chain', true)],
    );
    expect(split.misses).toBe(1);
    expect(split.neither).toBe(1);
    expect(split.downstream + split.upstream + split.both).toBe(0);
  });

  it('counts a miss with no ranking as unrelated rather than dropping it', () => {
    const empty: ProbeCase = { caseId: 'e', ranking: [], edges: [], accepted: ['truth'] };
    expect(directionSplit([empty], [prediction('e', false)]).neither).toBe(1);
  });

  it('refuses two lists of different lengths', () => {
    expect(() => directionSplit([chainCase()], [])).toThrow(/cannot be joined/);
  });

  it('prints the sum, so a line about another population is visible as one', () => {
    const line = formatDirectionSplit({
      misses: 2,
      downstream: 1,
      upstream: 1,
      both: 0,
      neither: 0,
    });
    expect(line).toContain('misses 2:');
    expect(line).toContain('(sum 2)');
  });
});

describe('the decision rule', () => {
  it('adopts an interior arm that gains, halves nothing and clears the Bonferroni bar', () => {
    const rows = [armRow(0, 5), armRow(0.1, 8), armRow(0.5, 6)];
    const verdict = decide(rows, [movement(0, 0), movement(8, 0), movement(3, 2)]);
    expect(verdict).toMatchObject({ adopted: true, alpha: 0.1 });
    expect(verdict.reason).toMatch(/gained 8, lost 0/);
  });

  it('refuses when no arm beats the engine, which is the arm that has to survive most often', () => {
    const rows = [armRow(0, 5), armRow(0.1, 4), armRow(0.5, 3)];
    expect(decide(rows, [movement(0, 0), movement(1, 2), movement(1, 3)])).toMatchObject({
      adopted: false,
      alpha: null,
    });
  });

  it('refuses an arm a single cell pays for, however much the total gains', () => {
    const rows: ArmRow[] = [
      { alpha: 0, cells: [cell(5, 10, 's', 'c'), cell(5, 10, 'all', 'all')] },
      {
        alpha: 0.1,
        cells: [cell(4, 10, 's', 'c'), cell(8, 10, 'all', 'all')],
      },
    ];
    const verdict = decide(rows, [movement(0, 0), movement(8, 0)]);
    expect(verdict.adopted).toBe(false);
    expect(verdict.reason).toMatch(/s\/c falls by 1 case/);
  });

  it('refuses an arm that sits on the last weight of the grid, because that is a different method', () => {
    const rows = [armRow(0, 5), armRow(0.1, 5), armRow(0.5, 9)];
    const verdict = decide(rows, [movement(0, 0), movement(0, 0), movement(8, 0)]);
    expect(verdict.adopted).toBe(false);
    expect(verdict.reason).toMatch(/last arm/);
  });

  it('refuses an arm whose p-value does not clear the bar the number of arms set', () => {
    const rows = [armRow(0, 5), armRow(0.1, 6), armRow(0.5, 5), armRow(1, 5)];
    // Three discordant pairs one way and none the other: p = 0.25, against a bar of 0.05 / 4.
    const verdict = decide(rows, [movement(0, 0), movement(3, 0), movement(1, 0), movement(0, 0)]);
    expect(verdict.adopted).toBe(false);
    expect(verdict.reason).toMatch(/does not clear/);
  });

  it('refuses a sweep that is empty rather than returning an arm', () => {
    expect(decide([], [])).toMatchObject({ adopted: false, alpha: null });
  });

  it('refuses an arm whose movement is missing, instead of assuming it moved nothing', () => {
    const rows = [armRow(0, 5), armRow(0.1, 8)];
    expect(decide(rows, [movement(0, 0)]).adopted).toBe(false);
  });

  it('throws when a row carries no overall cell, because no arm could then be ranked', () => {
    const rows: ArmRow[] = [armRow(0, 5), { alpha: 0.1, cells: [cell(8, 10, 's', 'c')] }];
    expect(() => decide(rows, [movement(0, 0), movement(8, 0)])).toThrow(/no overall cell/);
  });

  it('throws when two arms were scored over different cells', () => {
    const rows: ArmRow[] = [
      { alpha: 0, cells: [cell(5, 10, 's', 'c'), cell(5, 10, 'all', 'all')] },
      { alpha: 0.1, cells: [cell(8, 10, 'other', 'c'), cell(8, 10, 'all', 'all')] },
    ];
    expect(() => decide(rows, [movement(0, 0), movement(8, 0)])).toThrow(/different cells/);
  });

  it('keeps α = 0 when every arm scores the same, because the smallest move is the one to prefer', () => {
    const rows = [armRow(0, 5), armRow(0, 5), armRow(0.1, 5)];
    const verdict = decide(rows, [movement(0, 0), movement(0, 0), movement(0, 0)]);
    expect(verdict.alpha).toBeNull();
  });
});

describe('the sweep table', () => {
  it('prints a row per arm with its weight, its cells and its movement', () => {
    const rows = [armRow(0, 5), armRow(0.1, 8)];
    const text = formatSweep(rows, [movement(0, 0), movement(8, 0)]);
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toContain('alpha');
    expect(lines[0]).toContain('gained');
    expect(lines[2]).toContain('0.00');
    expect(lines[3]).toContain('0.10');
    expect(lines[3]).toContain('8');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('prints zeros rather than blank cells when an arm carries no movement', () => {
    const text = formatSweep([armRow(0, 5)], []);
    expect(text.trimEnd().split('\n')[2]).toMatch(/0\s+0\s+1\.0000$/);
  });

  it('prints a header even for an empty sweep, rather than printing nothing at all', () => {
    const text = formatSweep([], []);
    expect(text).toContain('alpha');
    expect(text.trimEnd().split('\n')).toHaveLength(2);
  });
});
