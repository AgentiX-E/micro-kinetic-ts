/**
 * Weight reachability, pinned to the theorem it implements and the certificates it refuses to skip.
 *
 * The module turns "is there a weight vector that answers this case" into a convex-hull question, and the tests are
 * written against the ways a plausible implementation answers it wrongly:
 *
 * - calling a case separable because the LINEAR PROGRAM said the margin was positive, without re-ranking the case
 *   with the vector it returned — a solver that is wrong in the last digit would then publish a promotion the
 *   engine never makes;
 * - accepting a combination that rebuilds the answer only approximately, which turns "inside the hull" into a
 *   statement about the solver's tolerance rather than about the corpus;
 * - counting a TIE as a separation, when the engine's stable sort keeps the earlier candidate and the answer was
 *   not the earlier one;
 * - letting a case whose answer the ranking never listed fall through to `in-hull`, which blames the weights for a
 *   retrieval failure;
 * - fitting one weight vector and reporting only the half it was fitted on, which is the number that always rises.
 */

import { describe, expect, it } from 'vitest';

import { prepareCases } from '../src/term-weight-screen.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';
import type { FitReading, ReachCase } from '../src/weight-reachability.js';
import {
  DEFAULT_FIT,
  EMPTY_REACH_REPORT,
  combinationError,
  familyOfVector,
  familyReach,
  formatFamilyFit,
  formatFitReport,
  formatReachReport,
  heldOutFit,
  maximise,
  namesOf,
  parseReachArgs,
  reachCaseOf,
  reachabilityOf,
  reachabilityTable,
  separates,
  summariseReach,
} from '../src/weight-reachability.js';

/** One candidate, scored from its triples so the fixture is exact by construction. */
function candidate(
  id: string,
  triples: ReadonlyArray<readonly [string, number, number]>,
): ParsedTermCandidate {
  const terms: TermDumpTriple[] = triples.map(
    ([name, weight, slope]) => [name, weight, slope] as const,
  );
  let score = 0;
  for (const [, weight, slope] of triples) score += weight * slope;
  return { id, score, terms };
}

/** One case over one term, with the answers it declares. */
function kase(
  datapack: string,
  accepted: readonly string[],
  rows: ReadonlyArray<readonly [string, number]>,
  faultType = 'NetworkDelay',
): ParsedTermCase {
  return {
    datapack,
    faultType,
    accepted,
    candidates: rows.map(([id, slope]) => candidate(id, [['selfAnomalyLog1p', 1, slope]])),
  };
}

/** A prepared corpus of one case, which is what every reading below is taken on. */
function corpusOf(...cases: ParsedTermCase[]): ReturnType<typeof prepareCases> {
  const prepared = prepareCases(cases);
  expect(prepared.refused).toBe(0);
  return prepared;
}

/** The single case's reading. */
function readOf(kaseValue: ParsedTermCase): ReturnType<typeof reachabilityOf> {
  const corpus = corpusOf(kaseValue);
  return reachabilityOf(reachCaseOf(corpus.cases[0]!, namesOf(corpus)));
}

describe('the hull, read through the program', () => {
  it('calls a case separable when its answer is outside the hull, and hands back the vector', () => {
    // Three collinear points with the answer at the far end: no convex combination of the others reaches it.
    const reading = readOf(
      kase(
        'separable',
        ['truth'],
        [
          ['wrong', 0],
          ['nearer', 1],
          ['truth', 3],
        ],
      ),
    );
    expect(reading.kind).toBe('separable');
    expect(reading.answer).toBe('truth');
    expect(reading.witness).not.toBeNull();
    expect(reading.witness!.selfAnomalyLog1p).toBeGreaterThan(0);
    expect(reading.margin).toBeGreaterThan(0);
    // The combination is the OTHER certificate and must not be reported alongside this one.
    expect(reading.combination).toBeNull();
  });

  it('calls a case in-hull when its answer is a combination of the competitors', () => {
    // Two terms, so the answer can sit strictly between two competitors: `0.5·(2,0) + 0.5·(0,2)`.
    const entry: ParsedTermCase = {
      datapack: 'sandwich',
      faultType: 'NetworkDelay',
      accepted: ['truth'],
      candidates: [
        candidate('left', [
          ['a', 1, 2],
          ['b', 1, 0],
        ]),
        candidate('right', [
          ['a', 1, 0],
          ['b', 1, 2],
        ]),
        candidate('truth', [
          ['a', 1, 1],
          ['b', 1, 1],
        ]),
      ],
    };
    const reading = readOf(entry);
    expect(reading.kind).toBe('in-hull');
    expect(reading.answer).toBe('truth');
    // The certificate is the combination, and it has to name both competitors and sum to one.
    expect(reading.combination).not.toBeNull();
    const shares = Object.values(reading.combination!);
    expect(shares).toHaveLength(2);
    expect(shares.reduce((total, share) => total + share, 0)).toBeCloseTo(1, 9);
    expect(reading.witness).toBeNull();
  });

  it('does not call a case separable when the answer is only level with a competitor', () => {
    // Two identical competitors and an answer level with them: the margin is zero, and a zero margin is a tie.
    const entry: ParsedTermCase = {
      datapack: 'tie',
      faultType: 'NetworkDelay',
      accepted: ['truth'],
      candidates: [candidate('rival', [['a', 1, 1]]), candidate('truth', [['a', 1, 1]])],
    };
    const reading = readOf(entry);
    expect(reading.kind).not.toBe('separable');
    expect(reading.kind).toBe('in-hull');
  });

  it('blames the weights for nothing when the answer was never ranked', () => {
    // The accepted id is not in the ranking at all: that is a retrieval failure, and `in-hull` would be a claim
    // about the weights that the dump cannot support.
    const reading = readOf(
      kase(
        'ghost',
        ['never-ranked'],
        [
          ['wrong', 0],
          ['other', 1],
        ],
      ),
    );
    expect(reading.kind).toBe('undecided');
    expect(reading.answer).toBeNull();
  });

  it('counts a case whose answer leads the ranking as a hit, whatever the weights', () => {
    const reading = readOf(
      kase(
        'hit',
        ['truth'],
        [
          ['truth', 2],
          ['wrong', 1],
        ],
      ),
    );
    expect(reading.kind).toBe('hit');
    expect(reading.answer).toBe('truth');
  });

  it('takes the SECOND accepted answer when the first is unreachable', () => {
    // A case may declare two endpoints. The first is a sandwich of the others; the second is outside; the case is
    // recoverable, so the verdict has to be read over the whole accepted set rather than its first entry.
    const entry: ParsedTermCase = {
      datapack: 'two-answers',
      faultType: 'NetworkDelay',
      accepted: ['first', 'second'],
      candidates: [
        candidate('left', [
          ['a', 1, 2],
          ['b', 1, 0],
        ]),
        candidate('right', [
          ['a', 1, 0],
          ['b', 1, 2],
        ]),
        candidate('first', [
          ['a', 1, 1],
          ['b', 1, 1],
        ]),
        candidate('second', [
          ['a', 1, 4],
          ['b', 1, 4],
        ]),
      ],
    };
    const reading = readOf(entry);
    expect(reading.kind).toBe('separable');
    expect(reading.answer).toBe('second');
  });
});

describe('the two bases, which answer different questions', () => {
  /** A case where the answer carries a term the shipped formula pays nothing for. */
  const dormant: ParsedTermCase = {
    datapack: 'dormant',
    faultType: 'NetworkDelay',
    accepted: ['truth'],
    candidates: [
      // `topo` is recorded at weight zero on both, so its PAID column is identically zero and only its SLOPE
      // column separates them. That is the whole difference between the two bases.
      {
        id: 'rival',
        score: 1,
        terms: [
          ['selfAnomalyLog1p', 1, 1],
          ['topo', 0, 1],
        ],
      },
      {
        id: 'truth',
        score: 1,
        terms: [
          ['selfAnomalyLog1p', 1, 1],
          ['topo', 0, 4],
        ],
      },
    ],
  };

  it('finds the answer reachable by turning the dormant term on, in the weight basis', () => {
    const corpus = corpusOf(dormant);
    const reading = reachabilityOf(reachCaseOf(corpus.cases[0]!, namesOf(corpus), 'slope'));
    expect(reading.kind).toBe('separable');
    expect(reading.witness!.topo).toBeGreaterThan(0);
  });

  it('finds the same case unreachable when the support is frozen, and proves it', () => {
    const corpus = corpusOf(dormant);
    const reading = reachabilityOf(reachCaseOf(corpus.cases[0]!, namesOf(corpus), 'paid'));
    // With `topo` paid at zero on both candidates the two paid vectors are identical, so no re-weighting of the
    // paying terms can separate them, and the combination that rebuilds the answer is the rival itself.
    expect(reading.kind).toBe('in-hull');
    expect(reading.combination!.rival).toBeCloseTo(1, 9);
  });

  it('builds the vector from the column the basis names', () => {
    const corpus = corpusOf(dormant);
    const names = namesOf(corpus);
    const slope = reachCaseOf(corpus.cases[0]!, names, 'slope');
    const paid = reachCaseOf(corpus.cases[0]!, names, 'paid');
    const topo = names.indexOf('topo');
    expect(slope.vectors[1]![topo]).toBe(4);
    // `paid` is the product, and a zero weight makes it zero however large the slope is.
    expect(paid.vectors[1]![topo]).toBe(0);
  });

  it('defaults to the weight basis', () => {
    const corpus = corpusOf(dormant);
    const names = namesOf(corpus);
    expect(reachCaseOf(corpus.cases[0]!, names).vectors[1]![names.indexOf('topo')]).toBe(4);
  });
});

describe('the name order', () => {
  it('is sorted, so two reports of one dump list the weights identically', () => {
    const corpus = corpusOf(kase('a', ['t'], [['t', 1]]));
    expect(namesOf(corpus)).toEqual(['selfAnomalyLog1p']);
  });
});

describe('the population reading', () => {
  it('counts the four verdicts and the ceiling they imply', () => {
    const readings = [
      {
        datapack: 'a',
        faultType: 'X',
        kind: 'hit' as const,
        answer: 'a',
        witness: null,
        margin: null,
        combination: null,
      },
      {
        datapack: 'b',
        faultType: 'X',
        kind: 'separable' as const,
        answer: 'b',
        witness: {},
        margin: 1,
        combination: null,
      },
      {
        datapack: 'c',
        faultType: 'Y',
        kind: 'in-hull' as const,
        answer: 'c',
        witness: null,
        margin: null,
        combination: {},
      },
      {
        datapack: 'd',
        faultType: 'Y',
        kind: 'undecided' as const,
        answer: null,
        witness: null,
        margin: null,
        combination: null,
      },
    ];
    expect(summariseReach(readings)).toEqual({
      cases: 4,
      hits: 1,
      separable: 1,
      inHull: 1,
      undecided: 1,
      ceiling: 2,
    });
  });

  it('reads nothing off no cases', () => {
    expect(summariseReach([])).toEqual(EMPTY_REACH_REPORT);
  });

  it('splits by family, largest first and alphabetically inside a size', () => {
    const readings = [
      {
        datapack: 'a',
        faultType: 'Zeta',
        kind: 'hit' as const,
        answer: 'a',
        witness: null,
        margin: null,
        combination: null,
      },
      {
        datapack: 'b',
        faultType: 'Alpha',
        kind: 'hit' as const,
        answer: 'b',
        witness: null,
        margin: null,
        combination: null,
      },
      {
        datapack: 'c',
        faultType: 'Alpha',
        kind: 'separable' as const,
        answer: 'c',
        witness: {},
        margin: 1,
        combination: null,
      },
    ];
    const families = familyReach(readings);
    expect(families.map((family) => family.faultType)).toEqual(['Alpha', 'Zeta']);
    expect(families[0]!.ceiling).toBe(2);
    expect(families[1]!.ceiling).toBe(1);
  });

  it('takes the verdicts off a real corpus, in the dump order', () => {
    const corpus = corpusOf(
      kase(
        'one',
        ['truth'],
        [
          ['truth', 2],
          ['wrong', 1],
        ],
      ),
      kase(
        'two',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const readings = reachabilityTable(corpus, namesOf(corpus));
    expect(readings.map((reading) => reading.kind)).toEqual(['hit', 'separable']);
  });
});

describe('the report', () => {
  it('prints the population and the families, with the basis named', () => {
    const readings = [
      {
        datapack: 'a',
        faultType: 'Zeta',
        kind: 'hit' as const,
        answer: 'a',
        witness: null,
        margin: null,
        combination: null,
      },
      {
        datapack: 'b',
        faultType: 'Zeta',
        kind: 'separable' as const,
        answer: 'b',
        witness: {},
        margin: 1,
        combination: null,
      },
    ];
    const text = formatReachReport(summariseReach(readings), familyReach(readings), 'paid');
    expect(text).toContain('basis paid');
    expect(text).toContain('CEILING       2 (100.00%)');
    expect(text).toContain('Zeta');
  });

  it('prints a zero share rather than dividing by zero', () => {
    const text = formatReachReport(EMPTY_REACH_REPORT, [], 'slope');
    expect(text).toContain('CEILING       0 (0.00%)');
  });

  it('prints a family with no cases as zero rather than as a NaN', () => {
    const text = formatReachReport(
      EMPTY_REACH_REPORT,
      [
        {
          faultType: 'Empty',
          cases: 0,
          hits: 0,
          separable: 0,
          inHull: 0,
          undecided: 0,
          ceiling: 0,
        },
      ],
      'slope',
    );
    expect(text).toContain('Empty');
    expect(text).toContain('0.0');
    expect(text).not.toContain('NaN');
  });
});

describe('the held-out fit', () => {
  /** A corpus where one term decides every case, half of them in each direction. */
  function splitCorpus(): ReturnType<typeof prepareCases> {
    const cases: ParsedTermCase[] = [];
    for (let index = 0; index < 8; index += 1) {
      // Even cases are answered by the term with the weight the fit starts at; odd ones need it turned negative,
      // so one vector cannot answer them all and the fit has to trade.
      const sign = index % 2 === 0 ? 1 : -1;
      cases.push(
        kase(
          `case-${index}`,
          ['truth'],
          [
            ['wrong', 0],
            ['truth', sign],
          ],
        ),
      );
    }
    return corpusOf(...cases);
  }

  it('reads the recorded column off the dump rather than off the vector', () => {
    const corpus = splitCorpus();
    const report = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 2 },
    );
    // Every fixture puts the answer second, so the recorded reading is zero on both halves whatever the fit does.
    expect(report.train.recorded).toBe(0);
    expect(report.held.recorded).toBe(0);
  });

  it('trains on one alternating half and reads the other', () => {
    const corpus = splitCorpus();
    const report = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 2 },
    );
    expect(report.train.cases).toBe(4);
    expect(report.held.cases).toBe(4);
    expect(Object.keys(report.weights)).toEqual(['selfAnomalyLog1p']);
  });

  it('swaps the halves when the orientation flips', () => {
    const corpus = splitCorpus();
    const even = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 2 },
    );
    const odd = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 2, orientation: 1 },
    );
    expect(odd.train.cases).toBe(4);
    expect(odd.held.cases).toBe(4);
    // The two orientations partition the same eight cases, so neither can be a subset of the other.
    expect(even.train.cases + odd.train.cases).toBe(8);
  });

  it('is deterministic, so a reader with the same seed reads the same vector', () => {
    const corpus = splitCorpus();
    const names = namesOf(corpus);
    const once = heldOutFit(corpus, names, { selfAnomalyLog1p: 1 }, { ...DEFAULT_FIT, epochs: 3 });
    const twice = heldOutFit(corpus, names, { selfAnomalyLog1p: 1 }, { ...DEFAULT_FIT, epochs: 3 });
    expect(once.weights).toEqual(twice.weights);
    expect(once.held.after).toBe(twice.held.after);
  });

  it('keeps the epoch that improved the training half, which is what the fit reports', () => {
    // The start vector is the WRONG SIGN: every case is answered by an increasing slope and the fit begins at
    // `-1`, so the first passes have something to gain and the best-epoch branch has to fire.
    const cases: ParsedTermCase[] = [];
    for (let index = 0; index < 6; index += 1) {
      cases.push(
        kase(
          `learn-${index}`,
          ['truth'],
          [
            ['wrong', 0],
            ['truth', 1],
          ],
        ),
      );
    }
    const corpus = corpusOf(...cases);
    const report = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: -1 },
      // `0.6` rather than `0.5`: at exactly `0.5` the three passes land the weight on `0`, where the two candidates
      // are level, the update has no violator to step away from, and the fit stalls on a tie it cannot see out of.
      { ...DEFAULT_FIT, epochs: 4, learningRate: 0.6, shrinkage: 0 },
    );
    expect(report.train.after).toBeGreaterThan(report.train.before);
    expect(report.weights.selfAnomalyLog1p).toBeGreaterThan(0);
  });

  it('starts from the vector it is given, so a zero step leaves it where it was', () => {
    const corpus = splitCorpus();
    const report = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 0 },
      { ...DEFAULT_FIT, epochs: 1, learningRate: 0, shrinkage: 0 },
    );
    // With no step and no pull, every score stays zero and the earlier candidate wins every case: the answer is
    // second everywhere, so nothing is answered on either half.
    expect(report.train.after).toBe(0);
    expect(report.held.after).toBe(0);
    expect(report.weights.selfAnomalyLog1p).toBe(0);
  });

  it('formats both halves against the recorded column', () => {
    const reading: FitReading = { recorded: 10, before: 9, after: 12, cases: 20 };
    const text = formatFitReport({ train: reading, held: reading, weights: {} });
    expect(text).toContain('HELD-OUT FIT');
    expect(text).toContain('recorded    10');
    expect(text).toContain('vs recorded +2');
  });

  it('formats a negative delta with its sign', () => {
    const reading: FitReading = { recorded: 10, before: 9, after: 8, cases: 20 };
    expect(formatFitReport({ train: reading, held: reading, weights: {} })).toContain(
      'vs recorded -2',
    );
  });
});

describe('the family reading of one vector', () => {
  it('compares the vector against what the dump recorded, family by family', () => {
    const corpus = corpusOf(
      kase(
        'keep',
        ['truth'],
        [
          ['truth', 3],
          ['wrong', 0],
        ],
        'NetworkDelay',
      ),
      kase(
        'lose',
        ['truth'],
        [
          ['truth', 3],
          ['wrong', 0],
        ],
        'JVMMemoryStress',
      ),
    );
    const names = namesOf(corpus);
    // The shipped weight of 1 answers both; a weight of −1 answers neither.
    const kept = familyOfVector(corpus, names, { selfAnomalyLog1p: 1 });
    expect(kept.map((row) => row.delta)).toEqual([0, 0]);
    const flipped = familyOfVector(corpus, names, { selfAnomalyLog1p: -1 });
    expect(flipped.map((row) => row.delta)).toEqual([-1, -1]);
    expect(flipped.map((row) => row.faultType)).toEqual(['JVMMemoryStress', 'NetworkDelay']);
  });

  it('reads a name the vector does not mention as zero', () => {
    const corpus = corpusOf(
      kase(
        'one',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const rows = familyOfVector(corpus, namesOf(corpus), {});
    expect(rows[0]!.after).toBe(0);
  });

  it('formats the table with signed deltas', () => {
    const text = formatFamilyFit([
      { faultType: 'NetworkDelay', cases: 3, recorded: 2, after: 1, delta: -1 },
    ]);
    expect(text).toContain('NetworkDelay');
    expect(text).toContain('-1');
  });
});

describe('the arguments', () => {
  it('requires a dump path', () => {
    expect(() => parseReachArgs([])).toThrow('--terms is required');
  });

  it('rejects a flag it does not know', () => {
    expect(() => parseReachArgs(['--nope'])).toThrow('unknown argument: --nope');
  });

  it('rejects a --terms with no value', () => {
    expect(() => parseReachArgs(['--terms'])).toThrow('--terms expects a dump path');
  });

  it('rejects a basis that is neither slope nor paid', () => {
    expect(() => parseReachArgs(['--terms', 'dump.ndjson', '--basis', 'both'])).toThrow(
      '--basis expects slope or paid',
    );
  });

  it('reads the defaults, and every flag', () => {
    expect(parseReachArgs(['--terms', 'dump.ndjson'])).toEqual({
      terms: 'dump.ndjson',
      fit: false,
      basis: 'slope',
    });
    expect(parseReachArgs(['--terms', 'd', '--basis', 'paid', '--fit'])).toEqual({
      terms: 'd',
      fit: true,
      basis: 'paid',
    });
  });
});

describe('the case the program is asked about', () => {
  it('carries the name order so a witness can be printed by name', () => {
    const corpus = corpusOf(
      kase(
        'one',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const reach: ReachCase = reachCaseOf(corpus.cases[0]!, namesOf(corpus));
    expect(reach.names).toEqual(['selfAnomalyLog1p']);
    expect(reach.ids).toEqual(['wrong', 'truth']);
    expect(reach.accepted.has('truth')).toBe(true);
  });

  it('reads a term the candidate never carried as a zero rather than as a gap', () => {
    const corpus = corpusOf(
      kase(
        'one',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const names = ['missing', 'selfAnomalyLog1p'];
    const reach = reachCaseOf(corpus.cases[0]!, names);
    expect(reach.vectors[1]![0]).toBe(0);
    expect(reach.vectors[1]![1]).toBe(3);
  });
});

describe('the solver, pinned on its own contract', () => {
  it('maximises a program with a slacked basis, and reports the duals it claims', () => {
    // `max x₁ + x₂` with `x₁ ≤ 1`, `x₂ ≤ 2`: the optimum is 3 and both constraints are worth one unit.
    const solved = maximise(
      [1, 1],
      [
        [1, 0],
        [0, 1],
      ],
      [1, 2],
    );
    expect(solved.value).toBeCloseTo(3, 12);
    expect([...solved.solution]).toEqual([1, 2]);
    expect([...solved.duals]).toEqual([1, 1]);
  });

  it('throws rather than answering when the program is unbounded', () => {
    // Nothing constrains `x₁`, so there is no optimum — and a solver that returned one would be inventing it.
    expect(() => maximise([1, 0], [[0, 1]], [1])).toThrow('the program is unbounded');
  });

  it('breaks a degenerate ratio tie on the smallest basis index, which is what forbids a cycle', () => {
    // Two identical rows: the ratio tie is exact, and Bland's rule has to pick one deterministically.
    const solved = maximise(
      [1, 0],
      [
        [1, 0],
        [1, 0],
      ],
      [1, 1],
    );
    expect(solved.value).toBeCloseTo(1, 12);
    expect(solved.solution[0]).toBeCloseTo(1, 12);
  });
});

describe('the two certificates, read on their own', () => {
  it('separates only when the target is strictly ahead', () => {
    const target = Float64Array.from([3]);
    const others = [Float64Array.from([0]), Float64Array.from([1])];
    expect(separates(target, others, Float64Array.from([1]))).toBeCloseTo(2, 12);
    // A direction that leaves the target level with a competitor separates nothing.
    expect(separates(target, others, Float64Array.from([0]))).toBeNull();
    // And one that puts a competitor ahead is not a witness at all.
    expect(separates(target, others, Float64Array.from([-1]))).toBeNull();
  });

  it('refuses a combination with a negative weight, which is not a convex combination', () => {
    const target = Float64Array.from([1]);
    const others = [Float64Array.from([0])];
    expect(combinationError(target, others, Float64Array.from([-1]))).toBeNull();
  });

  it('refuses a combination that sums to nothing, which rebuilds nothing', () => {
    const target = Float64Array.from([1]);
    const others = [Float64Array.from([0])];
    expect(combinationError(target, others, Float64Array.from([0]))).toBeNull();
  });

  it('reports the largest coordinate error of a combination', () => {
    const target = Float64Array.from([1, 1]);
    const others = [Float64Array.from([2, 0]), Float64Array.from([0, 2])];
    // Equal halves rebuild the target exactly; the `3:1` split puts `0.75·(2,0) + 0.25·(0,2)` on the target, which
    // misses by `0.5` on both coordinates.
    expect(combinationError(target, others, Float64Array.from([1, 1]))).toBeCloseTo(0, 12);
    expect(combinationError(target, others, Float64Array.from([3, 1]))).toBeCloseTo(0.5, 12);
  });
});

describe('the corners of a case', () => {
  it('marks the case unproven when one endpoint is separable-blocked and another was never ranked', () => {
    // The first endpoint is a sandwich of the competitors, the second is not in the ranking at all: neither
    // certificate covers the case, so neither verdict may be published.
    const entry: ParsedTermCase = {
      datapack: 'half-known',
      faultType: 'NetworkDelay',
      accepted: ['sandwich', 'never-ranked'],
      candidates: [
        candidate('left', [
          ['a', 1, 2],
          ['b', 1, 0],
        ]),
        candidate('right', [
          ['a', 1, 0],
          ['b', 1, 2],
        ]),
        candidate('sandwich', [
          ['a', 1, 1],
          ['b', 1, 1],
        ]),
      ],
    };
    expect(readOf(entry).kind).toBe('undecided');
  });

  it('takes the separable endpoint even when another endpoint is a sandwich', () => {
    const entry: ParsedTermCase = {
      datapack: 'one-of-two',
      faultType: 'NetworkDelay',
      accepted: ['sandwich', 'outside'],
      candidates: [
        candidate('left', [
          ['a', 1, 2],
          ['b', 1, 0],
        ]),
        candidate('right', [
          ['a', 1, 0],
          ['b', 1, 2],
        ]),
        candidate('sandwich', [
          ['a', 1, 1],
          ['b', 1, 1],
        ]),
        candidate('outside', [
          ['a', 1, 5],
          ['b', 1, 5],
        ]),
      ],
    };
    const reading = readOf(entry);
    expect(reading.kind).toBe('separable');
    expect(reading.answer).toBe('outside');
  });
});

describe('the branches a family table and a fit have to take', () => {
  it('orders two equally sized families by name, because a size tie is not an order', () => {
    const readings = [
      {
        datapack: 'a',
        faultType: 'Zeta',
        kind: 'hit' as const,
        answer: 'a',
        witness: null,
        margin: null,
        combination: null,
      },
      {
        datapack: 'b',
        faultType: 'Alpha',
        kind: 'hit' as const,
        answer: 'b',
        witness: null,
        margin: null,
        combination: null,
      },
    ];
    // Equal counts, so the tie-break is the name and not the insertion order.
    expect(familyReach(readings).map((family) => family.faultType)).toEqual(['Alpha', 'Zeta']);
  });

  it('counts a recorded hit and a recorded miss in the same half', () => {
    const corpus = corpusOf(
      kase(
        'answered',
        ['truth'],
        [
          ['truth', 2],
          ['wrong', 1],
        ],
      ),
      kase(
        'missed',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const report = heldOutFit(
      corpus,
      namesOf(corpus),
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 1 },
    );
    expect(report.train.recorded + report.held.recorded).toBe(1);
  });

  it('reads a starting vector that names only some of the terms', () => {
    const corpus = corpusOf(
      kase(
        'one',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
      kase(
        'two',
        ['truth'],
        [
          ['wrong', 0],
          ['truth', 3],
        ],
      ),
    );
    const names = [...namesOf(corpus), 'aTermTheVectorOmits'];
    const report = heldOutFit(
      corpus,
      names,
      { selfAnomalyLog1p: 1 },
      { ...DEFAULT_FIT, epochs: 1 },
    );
    // The omitted name starts at zero and stays there: nothing in the corpus carries it.
    expect(report.weights.aTermTheVectorOmits).toBe(0);
    expect(report.train.cases + report.held.cases).toBe(2);
  });

  it('weighs two accepted answers and one competitor without losing either kind', () => {
    // Three candidates, two of them accepted: the loop has to keep the best accepted AND the best competitor, and
    // the second accepted answer exercises the arm where an accepted candidate does not beat the running best.
    const entry: ParsedTermCase = {
      datapack: 'two-accepted',
      faultType: 'NetworkDelay',
      accepted: ['first', 'second'],
      candidates: [
        candidate('rival', [['a', 1, 0]]),
        candidate('first', [['a', 1, 2]]),
        candidate('second', [['a', 1, 1]]),
      ],
    };
    const corpus = corpusOf(entry);
    const report = heldOutFit(corpus, namesOf(corpus), { a: 1 }, { ...DEFAULT_FIT, epochs: 1 });
    expect(report.train.cases + report.held.cases).toBe(1);
  });

  it('prints a positive delta with its sign', () => {
    const text = formatFamilyFit([
      { faultType: 'NetworkDelay', cases: 3, recorded: 1, after: 3, delta: 2 },
    ]);
    expect(text).toContain('+2');
  });

  it('accepts the slope basis on the command line, which is the default spelled out', () => {
    expect(parseReachArgs(['--terms', 'd', '--basis', 'slope']).basis).toBe('slope');
  });
});
