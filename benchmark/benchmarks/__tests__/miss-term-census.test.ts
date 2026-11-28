/**
 * The miss-term census: which term decided each miss, counted.
 *
 * The three statements that make it a census rather than a description are asserted here by name: a HIT is not filed
 * under any term (or every term's count would be inflated by the population the engine already gets right), an
 * UNRANKED truth is `truth-not-ranked` rather than a decomposition of a difference that does not exist, and a case
 * with no cell throws instead of shrinking the population a share is printed over.
 */
import { describe, expect, it } from 'vitest';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import type { CellTruth } from '../src/cloudopsbench-suite.js';
import { SCORED_TIE, TRUTH_NOT_RANKED } from '../src/miss-anatomy.js';
import { ALL_CELLS, censusByCell, formatCensus, median, missOf } from '../src/miss-term-census.js';

/** One term row, as the engine publishes it. */
function term(name: string, contribution: number): { name: string; contribution: number } {
  return { name, contribution };
}

/**
 * A miss whose winner leads by `gap` on `winnerTerm` only.
 *
 * The truth sits at rank 2 unless a test says otherwise, so `rankedTerms[1]` is its side of the decomposition.
 */
function missCase(over: Partial<CasePrediction> = {}): CasePrediction {
  return {
    caseId: 'c1',
    truth: 'truth',
    top1: 'winner',
    correct: false,
    truthRank: 2,
    rankedTerms: [
      [term('selfAnomalyLog1p', 0.6), term('dualFamily', 0.25)],
      [term('selfAnomalyLog1p', 0.1), term('dualFamily', 0.0)],
    ],
    ...over,
  };
}

const CELLS = new Map<string, CellTruth>([['c1', { system: 's', category: 'c' }]]);

describe('the median', () => {
  it('is the middle of an odd list, in whatever order it arrives', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('is the mean of the two middles of an even list', () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('is zero for an empty list, because a cell with no miss has no middle', () => {
    expect(median([])).toBe(0);
  });
});

describe('one miss', () => {
  it('names the term that favoured the winner most, and its size', () => {
    const one = missOf(missCase(), 's/c')!;
    expect(one.decisiveTerm).toBe('selfAnomalyLog1p');
    expect(one.decisiveDelta).toBeCloseTo(0.5, 12);
    expect(one.truthRank).toBe(2);
    expect(one.cell).toBe('s/c');
  });

  it('files a hit under nothing at all', () => {
    expect(missOf(missCase({ correct: true }), 's/c')).toBeNull();
  });

  it('names an unranked truth instead of decomposing a difference that does not exist', () => {
    const one = missOf(missCase({ truthRank: undefined }), 's/c')!;
    expect(one.decisiveTerm).toBe(TRUTH_NOT_RANKED);
    expect(one.decisiveDelta).toBe(0);
    expect(one.truthRank).toBeUndefined();
  });

  it('names an unranked truth when the artifact carries no term rows at all', () => {
    const one = missOf(missCase({ rankedTerms: undefined }), 's/c')!;
    expect(one.decisiveTerm).toBe(TRUTH_NOT_RANKED);
  });

  it('names a tie when the two sides contributed identically to every term', () => {
    const one = missOf(
      missCase({
        rankedTerms: [[term('selfAnomalyLog1p', 0.4)], [term('selfAnomalyLog1p', 0.4)]],
      }),
      's/c',
    )!;
    expect(one.decisiveTerm).toBe(SCORED_TIE);
  });

  it('reads a rank past the rows it was given as an absent truth rather than crashing', () => {
    const one = missOf(missCase({ truthRank: 9 }), 's/c')!;
    expect(one.decisiveTerm).toBe(TRUTH_NOT_RANKED);
  });

  it('sums two rows under one name, because the formula wrote two contributions', () => {
    const one = missOf(
      missCase({
        rankedTerms: [
          [term('dualFamily', 0.1), term('dualFamily', 0.15)],
          [term('dualFamily', 0.0)],
        ],
      }),
      's/c',
    )!;
    expect(one.decisiveTerm).toBe('dualFamily');
    expect(one.decisiveDelta).toBeCloseTo(0.25, 12);
  });
});

describe('the census', () => {
  it('counts by decisive term and prints the share of the cell’s misses', () => {
    const rows = censusByCell([missCase(), missCase({ caseId: 'c1' })], CELLS);
    const cell = rows[0]!;
    expect(cell).toMatchObject({ cell: 's/c', cases: 2, misses: 2 });
    expect(cell.terms).toEqual([{ term: 'selfAnomalyLog1p', count: 2, medianDelta: 0.5 }]);
  });

  it('adds the all-cells row last, so a reader can check the parts against the whole', () => {
    const rows = censusByCell([missCase()], CELLS);
    expect(rows.map((one) => one.cell)).toEqual(['s/c', ALL_CELLS]);
    expect(rows[rows.length - 1]!.misses).toBe(1);
  });

  it('breaks a count tie by name rather than by insertion order', () => {
    const first = missCase({
      caseId: 'c1',
      rankedTerms: [[term('zeta', 0.9)], [term('zeta', 0)]],
    });
    const second = missCase({
      caseId: 'c1',
      rankedTerms: [[term('alpha', 0.9)], [term('alpha', 0)]],
    });
    expect(censusByCell([first, second], CELLS)[0]!.terms.map((one) => one.term)).toEqual([
      'alpha',
      'zeta',
    ]);
  });

  it('throws on a case with no cell rather than printing a share over a smaller population', () => {
    expect(() => censusByCell([missCase()], new Map())).toThrow(/no cell recorded/);
  });

  it('reports a cell whose cases are all hits as zero misses with no term rows', () => {
    const rows = censusByCell([missCase({ correct: true })], CELLS);
    expect(rows[0]).toMatchObject({ cases: 1, misses: 0, terms: [] });
  });
});

describe('the table', () => {
  it('prints one line per term with the share and the median delta', () => {
    const text = formatCensus(censusByCell([missCase()], CELLS));
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toContain('decisive term');
    expect(lines[2]).toContain('selfAnomalyLog1p');
    expect(lines[2]).toContain('1.0000');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('prints a cell with no miss as a row rather than omitting it', () => {
    const text = formatCensus(censusByCell([missCase({ correct: true })], CELLS));
    expect(text).toContain('(no miss)');
    expect(text).toContain('n/a');
  });
});
