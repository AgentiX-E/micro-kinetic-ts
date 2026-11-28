/**
 * The Cloud-OpsBench cell table: counts in, rates out, and a throw on a case nobody mapped.
 */
import { describe, expect, it } from 'vitest';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import {
  ALL_SYSTEMS,
  formatCellTable,
  formatRate,
  scoreByCell,
} from '../src/cloudopsbench-score.js';
import type { CellTruth } from '../src/cloudopsbench-suite.js';

/** One verdict, with only the fields the scorer reads. */
function verdict(
  caseId: string,
  truthRank: number | undefined,
  correct = truthRank === 1,
): CasePrediction {
  return {
    caseId,
    truth: 'adservice',
    top1: correct ? 'adservice' : 'cartservice',
    correct,
    truthRank,
  };
}

const CELLS = new Map<string, CellTruth>([
  ['cloudopsbench_boutique_codedefect_1', { system: 'boutique', category: 'codedefect' }],
  ['cloudopsbench_boutique_codedefect_2', { system: 'boutique', category: 'codedefect' }],
  ['cloudopsbench_boutique_performance_1', { system: 'boutique', category: 'performance' }],
  ['cloudopsbench_trainticket_performance_1', { system: 'trainticket', category: 'performance' }],
]);

describe('counting a cell', () => {
  it('counts top-1, top-3, top-5 and ranked separately, then aggregates over all of them', () => {
    const cells = scoreByCell(
      [
        verdict('cloudopsbench_boutique_codedefect_1', 1),
        verdict('cloudopsbench_boutique_codedefect_2', 4),
        verdict('cloudopsbench_boutique_performance_1', 12),
        verdict('cloudopsbench_trainticket_performance_1', undefined),
      ],
      CELLS,
    );
    expect(cells.map((one) => `${one.system}/${one.category}`)).toEqual([
      'boutique/codedefect',
      'boutique/performance',
      'trainticket/performance',
      `${ALL_SYSTEMS}/${ALL_SYSTEMS}`,
    ]);
    const codedefect = cells[0]!;
    expect(codedefect).toMatchObject({ cases: 2, top1: 1, top3: 1, top5: 2, ranked: 2 });
    expect(cells[1]).toMatchObject({ cases: 1, top1: 0, top3: 0, top5: 0, ranked: 1 });
    // A truth the engine never ranked is not a rank of zero: it stays out of every Top@k numerator.
    expect(cells[2]).toMatchObject({ cases: 1, top1: 0, top3: 0, top5: 0, ranked: 0 });
    expect(cells[3]).toMatchObject({ cases: 4, top1: 1, top3: 1, top5: 2, ranked: 3 });
    expect(cells[3]!.jointComparable).toBe(false);
  });

  it('reads the runner’s verdict rather than recomputing it from top-1', () => {
    // The two are the same statement with one label and NOT with an accepted set, so the verdict is the one
    // authority — a scorer that recomputed `top1 === truth` here would disagree with `avgTop1` on the same run.
    const twoLabels = scoreByCell(
      [
        {
          caseId: 'cloudopsbench_boutique_codedefect_1',
          truth: 'a',
          top1: 'b',
          correct: true,
          truthRank: 2,
        },
      ],
      CELLS,
    );
    expect(twoLabels[0]!.top1).toBe(1);
  });

  it('refuses a case nobody mapped instead of scoring a smaller cell', () => {
    expect(() => scoreByCell([verdict('unknown_case', 1)], CELLS)).toThrow(/no cell recorded/);
  });

  it('reports an empty suite as an all-row of zero cases rather than a missing row', () => {
    const cells = scoreByCell([], CELLS);
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ cases: 0, top1: 0, ranked: 0 });
    expect(formatRate(cells[0]!.top1, cells[0]!.cases)).toBe('n/a');
  });
});

describe('the printed table', () => {
  it('pads counts right and labels left, so two runs print the same bytes', () => {
    const cells = scoreByCell(
      [
        verdict('cloudopsbench_boutique_codedefect_1', 1),
        verdict('cloudopsbench_boutique_codedefect_2', 2),
      ],
      CELLS,
    );
    const text = formatCellTable(cells);
    const lines = text.split('\n');
    expect(lines[0]).toBe('system    category    cases    CA@1   Top@3   Top@5  ranked');
    expect(lines[1]).toMatch(/^-+  -+  -+  -+  -+  -+  -+$/);
    // One of the two is at rank 2: `CA` is the FIRST-ranked entity, so it is 1/2 while Top@3 is 2/2.
    expect(lines[2]).toBe('boutique  codedefect      2  0.5000  1.0000  1.0000  1.0000');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('formats a rate at four decimals and an empty denominator as n/a', () => {
    expect(formatRate(1, 3)).toBe('0.3333');
    expect(formatRate(0, 0)).toBe('n/a');
  });
});
