/**
 * The decomposition of a miss, pinned to the pre-registration it implements.
 *
 * Every case below is a shape the measurement can actually meet on the corpus, and every one of them is a place
 * where a plausible implementation reports a number that is not the one the document fixed:
 *
 * - a term paid to the WINNER only is the largest gap a case has, and a reader that iterated the truth's list
 *   would score that case as if the term were absent;
 * - a name carried twice (one term per contributing edge) must SUM, or the decomposition disagrees with the
 *   score on exactly the candidates built from the most evidence;
 * - a tie is not a win: excluding ties from the denominator is the statistic, and counting them as wins would
 *   let a term that decides nothing clear a 65 % bar;
 * - a family below `n = 20` has no verdict, and its share must still be printed so the withholding is visible;
 * - the split is `hashId % 2`, so the same corpus lands the same way on every machine.
 *
 * The module is measured on its own reading of the population (correct / absent / too deep / miss), because the
 * table's denominator is the population statement and not a count beside it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hashId } from '../src/agentic-sampling.js';
import type { MissDecomposition } from '../src/term-decomposition.js';
import {
  BONFERRONI_ALPHA,
  DECLARED_TERMS,
  MIN_FAMILY_CASES,
  RESIDUAL_TOLERANCE,
  breakdownOf,
  contributionsOf,
  decomposeCase,
  depthDisagreements,
  formatTermReport,
  parseTermReportArgs,
  splitTerm,
  summariseTerms,
  termVerdict,
  undeclaredTerms,
} from '../src/term-decomposition.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';

/** One candidate whose score is the exact sum its triples produce. */
function candidate(
  id: string,
  contributions: ReadonlyArray<readonly [string, number]>,
): ParsedTermCandidate {
  const terms: TermDumpTriple[] = contributions.map(([name, value]) => [name, 1, value] as const);
  let score = 0;
  for (const [, value] of contributions) score += value;
  return { id, score, terms };
}

/** One case. */
function kase(
  datapack: string,
  faultType: string,
  accepted: readonly string[],
  candidates: readonly ParsedTermCandidate[],
): ParsedTermCase {
  return { datapack, faultType, accepted, candidates };
}

/**
 * A miss at depth 1 on which `term` pays the TRUTH `advantage` more than the winner.
 *
 * The base term pays the winner nine, so the order is consistent with the scores whatever `advantage` is — a
 * fixture whose truth scored HIGHER than its leader would be a case the engine could not have produced, and the
 * statistic is about the cases it did produce. The `selfAnomalyLog1p` gap is therefore a loss for every case
 * here, and `term`'s sign is the one under test.
 */
function twoWayMiss(
  datapack: string,
  term: string,
  advantage: number,
  faultType = 'Kill',
): ParsedTermCase {
  return kase(
    datapack,
    faultType,
    ['truth'],
    [
      candidate('winner', [
        ['selfAnomalyLog1p', 10],
        [term, 0],
      ]),
      candidate('truth', [
        ['selfAnomalyLog1p', 1],
        [term, advantage],
      ]),
    ],
  );
}

/** The miss a fixture case decomposes into, refusing a classification the test did not intend. */
function missOf(testCase: ParsedTermCase): MissDecomposition {
  const decomposed = decomposeCase(testCase);
  if (decomposed.kind !== 'miss') throw new Error(`expected a miss, got ${decomposed.kind}`);
  return decomposed.miss;
}

/** Names whose `hashId % 2` is `parity`, enough of them for one family half. */
function namesWithParity(prefix: string, parity: number, count: number): string[] {
  const names: string[] = [];
  for (let index = 0; names.length < count; index += 1) {
    const name = `${prefix}${index}`;
    if (hashId(name) % 2 === parity) names.push(name);
  }
  return names;
}

describe('the constants the pre-registration fixes', () => {
  it('tests exactly the terms the ranking formula builds, at the corrected level', () => {
    // The denominator is the CLAIM: `α = 0.05 / 18`. A formula that grew a term without this list growing with it
    // would leave every `p` in the table described by a correction that no longer bounds the family — so the list
    // is checked against the only file that produces the names.
    const source = readFileSync(
      fileURLToPath(new URL('../../packages/tree/src/pruning/pruner.ts', import.meta.url)),
      'utf8',
    );
    const built = [...source.matchAll(/buildTerm\('([^']+)'/g)].map((match) => match[1]);
    expect(built).toEqual([...DECLARED_TERMS]);
    expect(BONFERRONI_ALPHA).toBeCloseTo(0.05 / DECLARED_TERMS.length, 12);
    expect(MIN_FAMILY_CASES).toBe(20);
  });
});

describe('one candidate’s breakdown', () => {
  it('sums a name carried twice, in first-appearance order', () => {
    // One term per contributing edge is a real shape: keeping the last value would disagree with the score on
    // exactly the candidates built from the most evidence.
    const breakdown = breakdownOf({
      id: 'a',
      score: 5,
      terms: [
        ['temporal', 1, 1],
        ['log', 2, 1],
        ['temporal', 1, 2],
      ],
    });
    expect(breakdown.contributions).toEqual([
      { name: 'temporal', value: 3 },
      { name: 'log', value: 2 },
    ]);
    expect(breakdown.total).toBe(5);
    expect(breakdown.residual).toBe(0);
  });

  it('reads a triple with no weight or no slope as the zero the formula computed', () => {
    // The producer emits the pair only where it read a measurement, and a term it did not read is a zero in the
    // sum rather than an unknown — so `null` contributes nothing and the residual still closes.
    const breakdown = breakdownOf({
      id: 'a',
      score: 1,
      terms: [
        ['lat', null, null],
        ['log', 1, null],
        ['selfAnomalyLog1p', 1, 1],
      ],
    });
    expect(contributionsOf({ id: 'a', score: 1, terms: [['lat', null, null]] })).toEqual([
      { name: 'lat', value: 0 },
    ]);
    expect(breakdown.total).toBe(1);
    expect(breakdown.residual).toBe(0);
  });

  it('reports the residual that says the dump and the score disagree, and `undefined` with no score', () => {
    const broken = breakdownOf({ id: 'a', score: 5, terms: [['log', 1, 4]] });
    expect(broken.residual).toBeCloseTo(1, 12);
    const unrecorded = breakdownOf({ id: 'a', score: null, terms: [['log', 1, 4]] });
    expect(unrecorded.residual).toBeUndefined();
    expect(unrecorded.score).toBeNull();
  });
});

describe('one case, decomposed', () => {
  it('reads a case answered at rank one as correct, not as a miss', () => {
    const correct = kase('c1', 'Kill', ['winner'], [candidate('winner', [['log', 1]])]);
    expect(decomposeCase(correct)).toEqual({ kind: 'correct' });
  });

  it('reads a case with no accepted candidate anywhere as absent', () => {
    const absent = kase('c1', 'Kill', ['mysql'], [candidate('a', [['log', 1]])]);
    expect(decomposeCase(absent)).toEqual({ kind: 'absent' });
  });

  it('refuses a miss deeper than the widest rung a presentation can carry', () => {
    const ranking = Array.from({ length: 22 }, (_unused, index) =>
      candidate(`c${index}`, [['log', 1]]),
    );
    expect(decomposeCase(kase('c1', 'Kill', ['c21'], ranking))).toEqual({ kind: 'tooDeep' });
    // …and the rung itself is inside the population, because the ladder's last rung is inclusive.
    expect(decomposeCase(kase('c1', 'Kill', ['c20'], ranking.slice(0, 21))).kind).toBe('miss');
  });

  it('subtracts the two sides over the union, so a term paid to the winner alone is the largest gap', () => {
    const decomposition = missOf(
      kase(
        'c1',
        'Kill',
        ['truth'],
        [
          candidate('winner', [
            ['selfAnomalyLog1p', 3],
            ['lat', 2],
          ]),
          candidate('truth', [
            ['selfAnomalyLog1p', 4],
            ['pool', 0.5],
          ]),
        ],
      ),
    );
    expect(decomposition.leader).toBe('winner');
    expect(decomposition.truth).toBe('truth');
    expect(decomposition.depth).toBe(1);
    // `lat` is paid to the winner and absent from the truth's list: it reads as minus its whole contribution
    // rather than as a skip, which is the difference between a term that cost the case and a term never built.
    expect(decomposition.deltas).toEqual([
      { name: 'selfAnomalyLog1p', value: 1 },
      { name: 'pool', value: 0.5 },
      { name: 'lat', value: -2 },
    ]);
    expect(decomposition.deltaScore).toBeCloseTo(-0.5, 12);
    expect(decomposition.exact).toBe(true);
    expect(decomposition.residual).toBe(0);
  });

  it('records a side that carries no score without inventing a margin', () => {
    const decomposition = missOf(
      kase(
        'c1',
        'Kill',
        ['truth'],
        [{ id: 'winner', score: null, terms: [['log', 1, 2]] }, candidate('truth', [['log', 2]])],
      ),
    );
    expect(decomposition.deltaScore).toBeUndefined();
    expect(decomposition.residual).toBe(0);
  });

  it('reads a side with no score as no residual at all, rather than as an exact identity', () => {
    const decomposition = missOf(
      kase(
        'c1',
        'Kill',
        ['truth'],
        [candidate('winner', [['log', 2]]), { id: 'truth', score: null, terms: [['log', 1, 1]] }],
      ),
    );
    // The residual is the WORST of the two sides and `0` where a side recorded nothing, so a case whose truth
    // carries no score is exact-looking on the residual it does not have — which is why the report prints the
    // count of cases it could decompose exactly beside the population.
    expect(decomposition.residual).toBe(0);
    expect(decomposition.exact).toBe(true);
    expect(decomposition.deltaScore).toBeUndefined();
  });

  it('carries the worst of the two residuals, and calls only a closed identity exact', () => {
    const exact = missOf(twoWayMiss('c1', 'log', 1));
    expect(exact.exact).toBe(true);
    const inexact = missOf(
      kase(
        'c1',
        'Kill',
        ['truth'],
        [{ id: 'winner', score: 4, terms: [['log', 1, 2]] }, candidate('truth', [['log', 2]])],
      ),
    );
    expect(inexact.residual).toBeCloseTo(2, 12);
    expect(inexact.exact).toBe(false);
    expect(inexact.residual).toBeGreaterThan(RESIDUAL_TOLERANCE);
  });
});

describe('one term over one half', () => {
  it('counts a tie as neither win nor loss and keeps it out of the denominator', () => {
    const splits = [
      missOf(twoWayMiss('c1', 'log', 1)),
      missOf(twoWayMiss('c2', 'log', 1)),
      missOf(twoWayMiss('c3', 'log', -1)),
      missOf(twoWayMiss('c4', 'lat', 1)),
    ];
    expect(splitTerm(splits, 'log')).toMatchObject({
      wins: 2,
      losses: 1,
      ties: 1,
      measurable: 3,
    });
    expect(splitTerm(splits, 'log').share).toBeCloseTo(2 / 3, 12);
    // A term the case never carried is a term paid zero on both sides, so the case is a TIE rather than a skip:
    // dropping it would shrink the denominator to the cases where the term was live, which flatters it.
    expect(splitTerm(splits, 'pool').ties).toBe(4);
    expect(splitTerm(splits, 'pool').share).toBeUndefined();
    expect(splitTerm(splits, 'pool').p).toBeUndefined();
  });

  it('tests the share against one half by an exact binomial', () => {
    const allWins = Array.from({ length: 10 }, (_unused, index) =>
      missOf(twoWayMiss(`w${index}`, 'log', 1)),
    );
    expect(splitTerm(allWins, 'log').p).toBeCloseTo(2 * 0.5 ** 10, 12);
    const even = Array.from({ length: 10 }, (_unused, index) =>
      missOf(twoWayMiss(`e${index}`, 'log', index % 2 === 0 ? 1 : -1)),
    );
    expect(splitTerm(even, 'log').p).toBeCloseTo(1, 12);
  });
});

describe('the report', () => {
  it('states the population it counted, with each exclusion named', () => {
    const ranking = Array.from({ length: 22 }, (_unused, index) =>
      candidate(`s${index}`, [['log', 1]]),
    );
    const cases = [
      kase('c1', 'Kill', ['winner'], [candidate('winner', [['log', 1]])]),
      kase('c2', 'Kill', ['mysql'], [candidate('winner', [['log', 1]])]),
      kase('c3', 'Kill', ['s21'], ranking),
      ...Array.from({ length: 4 }, (_unused, index) => twoWayMiss(`m${index}`, 'log', 1)),
    ];
    const report = summariseTerms(cases);
    expect(report.cases).toBe(7);
    expect(report.correctAt1).toBe(1);
    expect(report.absent).toBe(1);
    expect(report.tooDeep).toBe(1);
    expect(report.misses).toBe(4);
    expect(report.exactMisses).toBe(4);
    expect(report.worstResidual).toBe(0);
    expect(report.undeclared).toEqual([]);
  });

  it('partitions each family by the pre-registered split, and withholds a verdict below the floor', () => {
    // The halves are named by the hash so the fixture cannot drift from the split it tests: five `in`, four
    // `out`, one family of nine — below the floor, so no verdict, and a share that is still printed.
    const cases = [
      ...namesWithParity('k', 0, 5).map((name) => twoWayMiss(name, 'log', 1)),
      ...namesWithParity('k', 1, 4).map((name) => twoWayMiss(name, 'log', 1)),
    ];
    const [family] = summariseTerms(cases).families;
    expect(family!.cases).toBe(9);
    expect(family!.inCases).toBe(5);
    expect(family!.outCases).toBe(4);
    expect(family!.belowFloor).toBe(true);
    // The share is printed even when the bar is not applied, because a withheld verdict over a hidden number is
    // indistinguishable from a number nobody computed.
    expect(family!.terms[0]!.inHalf.share).toBe(1);
    expect(family!.terms[0]!.cleared).toBe(false);
    expect(family!.terms[0]!.confirmed).toBe(false);
  });

  it('orders two families of equal size by name, so the table is a property of the corpus', () => {
    const cases = [
      ...Array.from({ length: 3 }, (_unused, index) =>
        twoWayMiss(`p${index}`, 'log', 1, 'Partition'),
      ),
      ...Array.from({ length: 3 }, (_unused, index) => twoWayMiss(`q${index}`, 'log', 1, 'Kill')),
    ];
    expect(summariseTerms(cases).families.map((family) => family.faultType)).toEqual([
      'Kill',
      'Partition',
    ]);
  });

  it('orders terms by the in-sample share, and families by their population', () => {
    const cases = [
      ...Array.from({ length: 25 }, (_unused, index) => twoWayMiss(`a${index}`, 'log', 1, 'Kill')),
      ...Array.from({ length: 5 }, (_unused, index) => twoWayMiss(`b${index}`, 'lat', 1, 'Delay')),
    ];
    const report = summariseTerms(cases);
    expect(report.families.map((family) => family.faultType)).toEqual(['Kill', 'Delay']);
    const kill = report.families[0]!;
    expect(kill.cases).toBe(25);
    expect(kill.terms[0]!.name).toBe('log');
    // The base term loses every case here, so it is a measured ZERO and sorts above the terms that decided
    // nothing at all: `0` and `undefined` are the same printed emptiness and different findings.
    expect(kill.terms[1]!.name).toBe('selfAnomalyLog1p');
    expect(kill.terms[1]!.inHalf.share).toBe(0);
    expect(kill.terms.slice(2).every((term) => term.inHalf.share === undefined)).toBe(true);
    expect(kill.terms.map((term) => term.name)).toHaveLength(DECLARED_TERMS.length);
  });

  it('applies no bar to a term that decided nothing, however large the family', () => {
    // `measurable === 0` is a live state on a family of any size: a term the formula built on neither side of any
    // case has no share, and `p` is undefined rather than 1 — the bar is refused by the absence of a reading.
    const cases = Array.from({ length: 24 }, (_unused, index) =>
      kase(
        `n${index}`,
        'Kill',
        ['truth'],
        [candidate('winner', [['log', 2]]), candidate('truth', [['log', 1]])],
      ),
    );
    const report = summariseTerms(cases);
    const term = report.families[0]!.terms.find((entry) => entry.name === 'collision')!;
    expect(term.inHalf.measurable).toBe(0);
    expect(term.inHalf.p).toBeUndefined();
    expect(term.cleared).toBe(false);
    expect(term.confirmed).toBe(false);
  });

  it('drops an inexact case only when asked, and counts it either way', () => {
    const inexact = kase(
      'x1',
      'Kill',
      ['truth'],
      [
        { id: 'winner', score: 4, terms: [['log', 1, 2]] },
        { id: 'truth', score: 1, terms: [['log', 1, 1]] },
      ],
    );
    const cases = [inexact, twoWayMiss('ok1', 'log', 1)];
    const keeping = summariseTerms(cases);
    expect(keeping.misses).toBe(2);
    expect(keeping.exactMisses).toBe(1);
    expect(keeping.worstResidual).toBeCloseTo(2, 12);
    const filtering = summariseTerms(cases, { exactOnly: true });
    expect(filtering.misses).toBe(1);
    expect(filtering.exactMisses).toBe(1);
  });

  it('names a term the pre-registration does not count, in name order', () => {
    const cases = [
      kase(
        'c1',
        'Kill',
        ['winner'],
        [
          candidate('winner', [
            ['log', 1],
            ['zzz', 1],
            ['aaa', 1],
          ]),
        ],
      ),
    ];
    expect(undeclaredTerms(cases)).toEqual(['aaa', 'zzz']);
    expect(undeclaredTerms([twoWayMiss('c1', 'log', 1)])).toEqual([]);
  });

  it('renders the population, the families and the verdict as fixed-width lines', () => {
    const cases = [
      ...namesWithParity('r', 0, 12).map((name) => twoWayMiss(name, 'log', 1)),
      ...namesWithParity('r', 1, 12).map((name) => twoWayMiss(name, 'log', 1)),
    ];
    const report = summariseTerms(cases);
    const text = formatTermReport(report, termVerdict(report));
    const lines = text.split('\n');
    expect(lines[0]).toBe('Term decomposition of the re-rankable misses');
    expect(text).toContain('population: 24 misses at depth 1..20 of 24 cases');
    expect(text).toContain('alpha = 0.002778 over 18 terms, n >= 20');
    expect(text).toContain('Kill (n=24, in=12, out=12)');
    const row = lines.find((line) => line.trimStart().startsWith('log '));
    expect(row).toBeDefined();
    // Eight whitespace-separated fields — the name, six numbers and the verdict — so the table can be split by a
    // reader or a diff rather than read by eye.
    expect(row!.trim().split(/\s+/)).toHaveLength(8);
    expect(row).toContain('confirmed');
    expect(text).toContain('H1 SURVIVES');
  });

  it('renders a `p` below the printed precision as a bound, not as zero', () => {
    // Twenty wins in-sample is `2 × 0.5²⁰ ≈ 1.9e-6`, which `toFixed(4)` would print as `0.0000` — a p-value of
    // exactly zero is one a reader cannot tell from a rounding, so the cell states the bound instead.
    const cases = [
      ...namesWithParity('t', 0, 20).map((name) => twoWayMiss(name, 'log', 1)),
      ...namesWithParity('t', 1, 4).map((name) => twoWayMiss(name, 'log', 1)),
    ];
    const report = summariseTerms(cases);
    const text = formatTermReport(report, termVerdict(report));
    expect(text).toContain('<1e-4');
    expect(text).not.toContain('0.0000');
  });

  it('says a below-floor family carries no verdict, and prints an undeclared term rather than hiding it', () => {
    const cases = [
      kase(
        'c1',
        'Kill',
        ['truth'],
        [
          candidate('winner', [
            ['zzz', 1],
            ['log', 2],
          ]),
          candidate('truth', [['log', 1]]),
        ],
      ),
    ];
    const report = summariseTerms(cases);
    const text = formatTermReport(report, termVerdict(report));
    expect(text).toContain('[below floor: no verdict]');
    expect(text).toContain('UNDECLARED: zzz');
  });
});

describe('the verdict', () => {
  it('confirms a term whose sign the held-out half keeps, and survives', () => {
    const cases = [
      ...namesWithParity('v', 0, 12).map((name) => twoWayMiss(name, 'log', 1)),
      ...namesWithParity('v', 1, 12).map((name) => twoWayMiss(name, 'log', 1)),
    ];
    const verdict = termVerdict(summariseTerms(cases));
    expect(verdict.survives).toBe(true);
    expect(verdict.confirmed).toContain('log @ Kill');
    expect(verdict.inverted).toEqual([]);
  });

  it('calls a term that clears in-sample and inverts held out a fitted artifact, not an effect', () => {
    // The halves are named by the pre-registered hash so the fixture cannot drift from the split it tests.
    const inNames = namesWithParity('i', 0, 10);
    const outNames = namesWithParity('o', 1, 10);
    const cases = [
      ...inNames.map((name) => twoWayMiss(name, 'log', 1)),
      ...outNames.map((name) => twoWayMiss(name, 'log', -1)),
    ];
    const report = summariseTerms(cases);
    const verdict = termVerdict(report);
    expect(verdict.survives).toBe(false);
    expect(verdict.inverted).toContain('log @ Kill');
    expect(verdict.confirmed).toEqual([]);
    expect(formatTermReport(report, verdict)).toContain('H1 REFUSED');
  });

  it('applies no bar to a family below the floor, however lopsided its half', () => {
    const cases = Array.from({ length: 6 }, (_unused, index) => twoWayMiss(`s${index}`, 'log', 1));
    expect(termVerdict(summariseTerms(cases))).toEqual({
      confirmed: [],
      inverted: [],
      survives: false,
    });
  });
});

describe('the depth cross-check', () => {
  it('orders the disagreements, so two runs print the same list', () => {
    const derived = new Map<string, number | null>([
      ['z', 3],
      ['a', 5],
    ]);
    const recorded = new Map<string, number | null>([
      ['z', 1],
      ['a', 2],
    ]);
    const { mismatched } = depthDisagreements(derived, recorded);
    expect(mismatched.map((row) => row.datapack)).toEqual(['a', 'z']);
  });

  it('names every disagreement and every id one artifact has and the other does not', () => {
    const derived = new Map<string, number | null>([
      ['a', 0],
      ['b', 2],
      ['c', null],
    ]);
    const recorded = new Map<string, number | null>([
      ['a', 0],
      ['b', 3],
      ['d', 1],
    ]);
    const { mismatched, missing } = depthDisagreements(derived, recorded);
    expect(mismatched).toEqual([{ datapack: 'b', derived: 2, recorded: 3 }]);
    expect(missing).toEqual(['c', 'd']);
  });
});

describe('the argument parser', () => {
  it('reads both flags, and requires the terms path', () => {
    expect(parseTermReportArgs(['--terms', 't.ndjson'])).toEqual({ terms: 't.ndjson', depth: '' });
    expect(parseTermReportArgs(['--depth', 'd.ndjson', '--terms', 't.ndjson'])).toEqual({
      terms: 't.ndjson',
      depth: 'd.ndjson',
    });
    expect(() => parseTermReportArgs([])).toThrow('--terms is required');
  });

  it('refuses a typo and a flag with no value, so a table is never printed over a guessed artifact', () => {
    expect(() => parseTermReportArgs(['--term', 't.ndjson'])).toThrow(
      'unrecognised argument --term',
    );
    expect(() => parseTermReportArgs(['--terms'])).toThrow('--terms needs a value');
    expect(() => parseTermReportArgs(['--terms', 't.ndjson', '--depth'])).toThrow(
      '--depth needs a value',
    );
  });
});
