/**
 * The weight screen, pinned to the arithmetic it claims to be.
 *
 * A screen is only worth having if it can be wrong, so every case below is a shape where a plausible
 * implementation reports a number the engine would not have reported:
 *
 * - the score is reconstructed from the TRIPLES, so a dump whose `Σ (weight × slope)` misses its own
 *   `finalScore` is REFUSED rather than re-scored — a screen that re-scores a case it cannot rebuild is
 *   describing a different engine, and the promotion it reports would be one it cannot make;
 * - ties keep the engine's order, because a screen that sorted a tie by id would report flips the engine's own
 *   sort never produces;
 * - a move that gains cases and takes one from a family of 20+ is INADMISSIBLE even though `Top@1` rose, which
 *   is the gate the pre-registration fixed and the reason the honest answer to the landscape is "the admissible
 *   set is empty" rather than "+13 cases";
 * - `Δw = 0` must reproduce the shipped run exactly, which is the only thing that entitles any other row.
 *
 * The 40 MB dump the real landscape is read from is a dispatch artifact and cannot live in the tree, so the
 * fixtures here are small enough to check by hand: two terms, one weight, and the flip it does or does not
 * cause.
 */

import { MIN_FAMILY_CASES, RESIDUAL_TOLERANCE } from '../src/term-decomposition.js';
import {
  DEFAULT_GRID,
  evaluateWeights,
  formatScreenReport,
  parseGridFile,
  parseScreenArgs,
  screenGrid,
  shippedWeightsOf,
} from '../src/term-weight-screen.js';
import type { GridPoint, WeightMove } from '../src/term-weight-screen.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';

/**
 * One candidate, scored from its triples.
 *
 * The score is the sum the producer would have written, so a fixture is exact by construction and the only
 * thing under test is the screen's arithmetic.
 */
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

/** One case whose accepted answer is a single service. */
function kase(
  datapack: string,
  faultType: string,
  accepted: string,
  candidates: readonly ParsedTermCandidate[],
): ParsedTermCase {
  return { datapack, faultType, accepted: [accepted], candidates };
}

/**
 * A case no move of `stability` can reorder: the control.
 *
 * `root` leads on `source` alone, so a screen that reports a gain on a corpus of these is reporting an
 * arithmetic error rather than an effect.
 */
function stableCase(datapack: string, faultType = 'HTTPRequestDelay'): ParsedTermCase {
  return kase(datapack, faultType, 'root', [
    candidate('root', [
      ['source', 1, 2],
      ['stability', 0.1, 0],
    ]),
    candidate('symptom', [
      ['source', 1, 1],
      ['stability', 0.1, 0],
    ]),
  ]);
}

/**
 * A case `stability → 0.5` wins and the shipped weights lose: the truth carries the stability signal.
 *
 * At the shipped `0.1` the truth scores `0.3 + 0.6 = 0.9` against the symptom's `1.0`; at `0.5` it scores
 * `0.3 + 3.0 = 3.3`. The flip is entirely the moved term, so the row's `+1` is attributable by hand.
 */
function promotedCase(datapack: string, faultType = 'HTTPResponseReplaceCode'): ParsedTermCase {
  return kase(datapack, faultType, 'root', [
    candidate('symptom', [['source', 1, 1]]),
    candidate('root', [
      ['source', 1, 0.3],
      ['stability', 0.1, 6],
    ]),
  ]);
}

/**
 * The mirror: a case the shipped weights win and `stability → 0.5` loses.
 *
 * The symptom, not the truth, carries the stability signal, so the same weight that recovers
 * `HTTPResponseReplaceCode` costs this one. Two populations pointing opposite ways is the shape that makes the
 * admissible set empty, and it is reproduced here at n = 20 rather than asserted in prose.
 */
function demotedCase(datapack: string, faultType = 'HTTPRequestDelay'): ParsedTermCase {
  return kase(datapack, faultType, 'root', [
    candidate('root', [['source', 1, 1]]),
    candidate('symptom', [
      ['source', 1, 0.3],
      ['stability', 0.1, 6],
    ]),
  ]);
}

/** `MIN_FAMILY_CASES` cases from `build`, numbered so the accepted answer differs per case. */
function family(
  build: (datapack: string, faultType?: string) => ParsedTermCase,
  prefix: string,
  faultType?: string,
): ParsedTermCase[] {
  return Array.from({ length: MIN_FAMILY_CASES }, (_, index) =>
    build(`${prefix}${index}`, faultType),
  );
}

/** The move `stability → 0.5`, which is the one every fixture above is written against. */
const RAISE_STABILITY: readonly WeightMove[] = [{ name: 'stability', weight: 0.5 }];

/** A grid carrying one point per argument, labelled by nobody so the module has to derive it. */
function grid(...moves: ReadonlyArray<readonly WeightMove[]>): GridPoint[] {
  return moves.map((point) => ({ label: '', moves: point }));
}

describe('re-scoring a case set', () => {
  it('reproduces the shipped order when nothing is moved', () => {
    const evaluated = evaluateWeights([stableCase('a'), promotedCase('b'), demotedCase('c')], []);
    expect(evaluated.cases).toBe(3);
    expect(evaluated.refused).toBe(0);
    // `promotedCase` is a MISS under the shipped weights — that is what makes it the case the move recovers —
    // so a corpus of the three fixtures answers two and the third is the one the next test flips.
    expect(evaluated.hits).toBe(2);
    expect(evaluated.outcomes.map((outcome) => outcome.hit)).toEqual([true, false, true]);
  });

  it('moves the score by exactly the moved weight times the slope', () => {
    const evaluated = evaluateWeights([promotedCase('b')], RAISE_STABILITY);
    // `root` gains `(0.5 − 0.1) × 6 = 2.4`, which takes it past the symptom's 1.0.
    expect(evaluated.outcomes[0]!.winner).toBe('root');
    expect(evaluated.outcomes[0]!.hit).toBe(true);
  });

  it('refuses a case whose triples do not rebuild its score', () => {
    const broken: ParsedTermCase = {
      datapack: 'broken',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      // The recorded score is 9 while the triples sum to 1 — a dump defect the screen must not absorb.
      candidates: [{ id: 'root', score: 9, terms: [['source', 1, 1]] }],
    };
    const evaluated = evaluateWeights([broken, stableCase('a')], []);
    expect(evaluated.refused).toBe(1);
    expect(evaluated.cases).toBe(1);
    expect(evaluated.outcomes.map((outcome) => outcome.datapack)).toEqual(['a']);
  });

  it('refuses a case whose producer recorded no score at all', () => {
    const scoreless: ParsedTermCase = {
      datapack: 'scoreless',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      candidates: [{ id: 'root', score: null, terms: [['source', 1, 1]] }],
    };
    expect(evaluateWeights([scoreless], []).refused).toBe(1);
  });

  it('treats a term with no weight or no slope as a zero in the sum', () => {
    const half: ParsedTermCase = {
      datapack: 'half',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      candidates: [
        { id: 'root', score: 1, terms: [['source', 1, 1], ['lat', null, 4], ['pool', 2, null]] },
      ],
    };
    const evaluated = evaluateWeights([half], [{ name: 'lat', weight: 9 }]);
    expect(evaluated.refused).toBe(0);
    expect(evaluated.hits).toBe(1);
  });

  it('keeps the engine order on a tie, so a tie cannot read as a promotion', () => {
    // Both candidates score 1.0 and the accepted one is SECOND: the engine put it second, and a screen that
    // sorted a tie by id would call this a hit the engine never reported.
    const tied = kase('tied', 'HTTPRequestDelay', 'aaa', [
      candidate('zzz', [['source', 1, 1]]),
      candidate('aaa', [['source', 1, 1]]),
    ]);
    expect(evaluateWeights([tied], []).hits).toBe(0);
    // Raising `source` scales both sides equally, so the tie survives the move and so does the verdict.
    expect(evaluateWeights([tied], [{ name: 'source', weight: 2 }]).hits).toBe(0);
  });

  it('sums a name carried twice, because the score it must reproduce did', () => {
    const twice = kase('twice', 'HTTPRequestDelay', 'root', [
      candidate('symptom', [['source', 1, 2]]),
      candidate('root', [
        ['source', 1, 1.4],
        ['stability', 0.1, 0.6],
        ['stability', 0.1, 0.6],
      ]),
    ]);
    // The two halves of `stability` sum to 1.2 of slope, so at 0.5 the truth still trails the symptom: the
    // refusal to keep only the last triple is what makes the verdict checkable.
    expect(evaluateWeights([twice], []).refused).toBe(0);
    expect(evaluateWeights([twice], []).hits).toBe(0);
    expect(evaluateWeights([twice], RAISE_STABILITY).hits).toBe(0);
  });

  it('reports the depth of the accepted answer, not just the hit', () => {
    const deep = kase('deep', 'HTTPRequestDelay', 'third', [
      candidate('first', [['source', 1, 3]]),
      candidate('second', [['source', 1, 2]]),
      candidate('third', [['source', 1, 1]]),
    ]);
    expect(evaluateWeights([deep], []).outcomes[0]!.depth).toBe(2);
  });
});

describe('the shipped weights read off a dump', () => {
  it('names every term the dump carries, in first-appearance order', () => {
    expect(shippedWeightsOf([promotedCase('b')])).toEqual([
      { name: 'source', weight: 1 },
      { name: 'stability', weight: 0.1 },
    ]);
  });

  it('reports the first weight it sees for a repeated name rather than the last', () => {
    const weights = shippedWeightsOf([
      kase('a', 'HTTPRequestDelay', 'root', [
        candidate('root', [
          ['source', 1, 1],
          ['stability', 0.1, 1],
          ['stability', 0.1, 1],
        ]),
      ]),
    ]);
    expect(weights.filter((move) => move.name === 'stability')).toEqual([
      { name: 'stability', weight: 0.1 },
    ]);
  });

  it('breaks a tie on magnitude by name, so two runs print one order', () => {
    // The real dump ships `log 1` and `selfAnomalyLog1p 1`: equal magnitude, and a sort without a tie-break would
    // print them in whichever order the dump happened to record, which is a header that diffs between runs.
    const weights = shippedWeightsOf([
      kase('a', 'HTTPRequestDelay', 'root', [
        candidate('root', [
          ['selfAnomalyLog1p', 1, 1],
          ['log', 1, 1],
          ['lat', -1, 1],
        ]),
      ]),
    ]);
    expect(weights.map((move) => move.name)).toEqual(['lat', 'log', 'selfAnomalyLog1p']);
  });

  it('skips a triple with no weight, because a term with no weight is not a shipped weight', () => {
    const weights = shippedWeightsOf([
      {
        datapack: 'a',
        faultType: 'HTTPRequestDelay',
        accepted: ['root'],
        candidates: [{ id: 'root', score: 0, terms: [['lat', null, 4], ['source', 1, 0]] }],
      },
    ]);
    expect(weights).toEqual([{ name: 'source', weight: 1 }]);
  });
});

describe('the grid', () => {
  it('returns no row for no point', () => {
    expect(screenGrid([stableCase('a')], []).rows).toEqual([]);
  });

  it('counts the gain, names the family that took the loss, and refuses the move', () => {
    const cases = [...family(promotedCase, 'p'), ...family(demotedCase, 'd')];
    const [row] = screenGrid(cases, grid(RAISE_STABILITY)).rows;
    expect(row!.before).toBe(MIN_FAMILY_CASES);
    expect(row!.after).toBe(MIN_FAMILY_CASES);
    expect(row!.delta).toBe(0);
    expect(row!.gained.length).toBe(MIN_FAMILY_CASES);
    expect(row!.lost.length).toBe(MIN_FAMILY_CASES);
    // The losing family sits at the floor, so the loss counts against the move although Top@1 did not fall —
    // and the gaining family is not on the list, because the list is what the row COST.
    expect(row!.losses.map((loss) => loss.faultType)).toEqual(['HTTPRequestDelay']);
    expect(row!.admissible).toBe(false);
  });

  it('admits a move whose only losses are in families below the floor', () => {
    const cases = [...family(promotedCase, 'p'), demotedCase('d0')];
    const [row] = screenGrid(cases, grid(RAISE_STABILITY)).rows;
    expect(row!.delta).toBe(MIN_FAMILY_CASES - 1);
    expect(row!.lost).toEqual(['d0']);
    expect(row!.losses).toEqual([]);
    expect(row!.admissible).toBe(true);
  });

  it('refuses a move that only loses, because no gain is not a licence to lose a case', () => {
    const [row] = screenGrid(family(demotedCase, 'd'), grid(RAISE_STABILITY)).rows;
    expect(row!.delta).toBe(-MIN_FAMILY_CASES);
    expect(row!.admissible).toBe(false);
  });

  it('labels a point by its moves when the point does not carry a label', () => {
    const [row] = screenGrid(
      [promotedCase('b')],
      grid([
        { name: 'stability', weight: 0.3 },
        { name: 'log', weight: 1.2 },
      ]),
    ).rows;
    expect(row!.label).toBe('stability 0.3 + log 1.2');
  });

  it('keeps a label the point carries, so a grid file can name its own points', () => {
    const [row] = screenGrid(
      [promotedCase('b')],
      [{ label: 'the recorded candidate', moves: [...RAISE_STABILITY] }],
    ).rows;
    expect(row!.label).toBe('the recorded candidate');
  });

  it('keeps the refused cases out of the denominator, so it cannot move between rows', () => {
    const broken: ParsedTermCase = {
      datapack: 'broken',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      candidates: [{ id: 'root', score: 9, terms: [['source', 1, 1]] }],
    };
    const rows = screenGrid([broken, promotedCase('b')], grid(RAISE_STABILITY)).rows;
    expect(rows[0]!.before).toBe(0);
    expect(rows[0]!.after).toBe(1);
  });

  it('prints the rows in the grid order, so two runs diff line by line', () => {
    const cases = [...family(promotedCase, 'p'), ...family(demotedCase, 'd')];
    const rows = screenGrid(cases, [
      { label: 'second', moves: [{ name: 'log', weight: 0.5 }] },
      { label: 'first', moves: [...RAISE_STABILITY] },
    ]).rows;
    expect(rows.map((row) => row.label)).toEqual(['second', 'first']);
  });

  it('carries a default grid over exactly the three weights the landscape prices', () => {
    expect(new Set(DEFAULT_GRID.flatMap((point) => point.moves.map((move) => move.name)))).toEqual(
      new Set(['stability', 'lat', 'log']),
    );
  });

  it('carries no default point that moves nothing, because that row is the baseline', () => {
    for (const point of DEFAULT_GRID) {
      expect(point.moves.length).toBeGreaterThan(0);
      for (const move of point.moves) expect(Number.isFinite(move.weight)).toBe(true);
    }
  });

  it('carries no duplicated default point, because a grid is a set of questions', () => {
    const labels = DEFAULT_GRID.map((point) => point.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('the report', () => {
  const cases = [...family(promotedCase, 'p'), ...family(demotedCase, 'd')];
  const report = screenGrid(cases, grid(RAISE_STABILITY));

  it('states the population, the baseline and the gate before any row', () => {
    const text = formatScreenReport(report);
    expect(text).toContain(`population: ${cases.length} cases scored, 0 refused`);
    expect(text).toContain(`baseline:   ${MIN_FAMILY_CASES} / ${cases.length}`);
    expect(text).toContain(`no family with n >= ${MIN_FAMILY_CASES}`);
  });

  it('states the baseline as a rate, so a denominator of 40 reads differently from one of 1 422', () => {
    expect(formatScreenReport({ ...report, cases: 40, baseline: 30 })).toContain('75.00%');
  });

  it('prints a move with the families that lost against it and their size', () => {
    const text = formatScreenReport(report);
    expect(text).toContain('stability 0.5');
    // The count AND the family's size: a loss of one in three reads differently from one in forty.
    expect(text).toContain(`HTTPRequestDelay -${MIN_FAMILY_CASES} (n=${MIN_FAMILY_CASES})`);
  });

  it('says the admissible set is empty rather than printing nothing', () => {
    expect(formatScreenReport(report)).toContain('ADMISSIBLE SET: EMPTY');
  });

  it('names the admissible points when there are any', () => {
    const admissible = screenGrid(family(promotedCase, 'p'), grid(RAISE_STABILITY));
    expect(formatScreenReport(admissible)).toContain('ADMISSIBLE SET: stability 0.5');
  });

  it('marks the row itself, so a reader scanning thirty rows does not have to wait for the verdict', () => {
    const admissible = screenGrid(family(promotedCase, 'p'), grid(RAISE_STABILITY));
    expect(formatScreenReport(admissible)).toContain('ADMISSIBLE');
  });

  it('prints a dash rather than NaN when the screen refused every case', () => {
    // A denominator of zero is a real state: every case refused for not rebuilding its own score. `0/0` is NaN,
    // and a NaN in a rate column is a number a reader would try to interpret.
    expect(
      formatScreenReport({ cases: 0, refused: 4, baseline: 0, rows: [] }),
    ).toContain('0 / 0 = -');
  });

  it('names the shipped weights it read off the dump', () => {
    expect(formatScreenReport(report, shippedWeightsOf(cases))).toContain(
      'source 1, stability 0.1',
    );
  });

  it('prints the gross counts, so a net zero that is really +20 against −20 is visible', () => {
    // The row's `delta` is 0 and its cost is two families' worth of cases: a reader who saw only the net would
    // read this as the identity, and it is the opposite of one.
    expect(formatScreenReport(report)).toContain('20/20');
  });

  it('calls a point that changes nothing a no-op rather than admissible', () => {
    const text = formatScreenReport(screenGrid([stableCase('a')], grid(RAISE_STABILITY)));
    expect(text).toContain('NO-OP');
    // And says so under the verdict, because "must not fall" is satisfied by doing nothing at all.
    expect(text).toContain('pass the gate by changing nothing');
    expect(text).toContain('stability 0.5');
  });
});

describe('the arguments', () => {
  it('requires --terms', () => {
    expect(() => parseScreenArgs([])).toThrow('--terms is required');
  });

  it('rejects an unknown flag', () => {
    expect(() => parseScreenArgs(['--term', 'a'])).toThrow('unrecognised argument --term');
  });

  it('rejects a flag with no value', () => {
    expect(() => parseScreenArgs(['--terms'])).toThrow('--terms needs a value');
  });

  it('reads both flags in either order', () => {
    expect(parseScreenArgs(['--grid', 'g.json', '--terms', 't.ndjson'])).toEqual({
      terms: 't.ndjson',
      grid: 'g.json',
    });
    expect(parseScreenArgs(['--terms', 't.ndjson', '--grid', 'g.json'])).toEqual({
      terms: 't.ndjson',
      grid: 'g.json',
    });
  });

  it('leaves the grid empty when the caller wants the default', () => {
    expect(parseScreenArgs(['--terms', 't.ndjson'])).toEqual({ terms: 't.ndjson', grid: '' });
  });
});

describe('a grid file', () => {
  it('reads label and weights', () => {
    expect(parseGridFile('[{"label":"probe","weights":{"stability":0.3,"log":1.2}}]')).toEqual([
      {
        label: 'probe',
        moves: [
          { name: 'stability', weight: 0.3 },
          { name: 'log', weight: 1.2 },
        ],
      },
    ]);
  });

  it('derives the label when the file does not give one', () => {
    expect(parseGridFile('[{"weights":{"log":1.2}}]')[0]!.label).toBe('log 1.2');
  });

  it('refuses a file that is not an array', () => {
    expect(() => parseGridFile('{}')).toThrow('the grid is not an array of points');
  });

  it('refuses a point that is not an object', () => {
    expect(() => parseGridFile('[3]')).toThrow('grid point 0 is not an object');
  });

  it('refuses a point with no weights', () => {
    expect(() => parseGridFile('[{"label":"x"}]')).toThrow('grid point 0 has no weights object');
  });

  it('refuses a point that moves nothing', () => {
    expect(() => parseGridFile('[{"weights":{}}]')).toThrow('grid point 0 moves nothing');
  });

  it('refuses a file that is not JSON', () => {
    expect(() => parseGridFile('[')).toThrow('the grid is not JSON');
  });

  it('refuses a weight that is not a finite number', () => {
    expect(() => parseGridFile('[{"weights":{"log":"1.2"}}]')).toThrow(
      'the weight of log is not a finite number',
    );
  });

  it('names the point it refused, so a grid of thirty is a location rather than a file', () => {
    expect(() => parseGridFile('[{"weights":{"log":1}},3]')).toThrow('grid point 1 is not an object');
  });
});

describe('the residual the screen refuses on', () => {
  it('accepts a residual inside the tolerance', () => {
    // Half the tolerance rather than the tolerance itself: `1 + 1e-9` is not representable, so the difference a
    // reader computes from it is 1.0000000827e-9 and a test written against the boundary would be measuring
    // IEEE-754 rounding rather than the screen. The two tests bracket the constant instead of landing on it.
    const edge: ParsedTermCase = {
      datapack: 'edge',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      candidates: [
        { id: 'root', score: 1 + RESIDUAL_TOLERANCE / 2, terms: [['source', 1, 1]] },
      ],
    };
    expect(evaluateWeights([edge], []).refused).toBe(0);
  });

  it('refuses a residual just past it', () => {
    const past: ParsedTermCase = {
      datapack: 'edge',
      faultType: 'HTTPRequestDelay',
      accepted: ['root'],
      candidates: [{ id: 'root', score: 1 + RESIDUAL_TOLERANCE * 2, terms: [['source', 1, 1]] }],
    };
    expect(evaluateWeights([past], []).refused).toBe(1);
  });
});
