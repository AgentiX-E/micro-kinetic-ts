/**
 * The gate that holds the nine published cells to a recorded reading — tested on fixtures, one branch at a time.
 *
 * The module under test is deliberately dependency-free so it can run in the one job that has three suites'
 * artifacts and no install, which means every one of its inputs is a file path and every one of its decisions is a
 * return code. Both are injected, so the cases below are the whole surface: a baseline that would make the
 * comparison vacuous, a census that is not a census, an arm that must NOT be compared, and the one verdict that
 * matters — a cell that moved.
 *
 * @module benchmarks/__tests__/cell-baseline.test
 */

import { describe, expect, it } from 'vitest';

import {
  compareCells,
  configDigest,
  countCells,
  findSignalLine,
  formatComparison,
  isEntryPoint,
  main,
  parseBaseline,
} from '../src/cell-baseline.js';

const BASELINE_TEXT = JSON.stringify({
  battery: '42343505202',
  revision: 'bd17912c',
  configuration: '74cb161840a2',
  cells: { 'RE1:SockShop': 119, 'RE3:TrainTicket': 22 },
  total: 141,
});

const BASELINE = parseBaseline(BASELINE_TEXT);

/** A census line, in the shape the runner writes. */
const census = (cell: string, correct: boolean): string =>
  JSON.stringify({ caseId: `c-${cell}-${correct}`, cell, faultType: 'cpu', correct });

/** Run `main` over an in-memory filesystem. */
function run(files: Record<string, string>, argv: string[]): { code: number; out: string } {
  const written: string[] = [];
  const code = main(
    argv,
    (path) => {
      const found = files[path];
      if (found === undefined) throw new Error(`no such file: ${path}`);
      return found;
    },
    (text) => written.push(text),
  );
  return { code, out: written.join('') };
}

describe('a baseline that cannot be compared against is refused', () => {
  it('accepts the recorded reading and keeps its own arithmetic', () => {
    expect(BASELINE.total).toBe(141);
    expect(Object.keys(BASELINE.cells)).toHaveLength(2);
  });

  it('refuses a baseline with no run behind it', () => {
    expect(() => parseBaseline('{}')).toThrow(/`battery` and `revision`/);
    expect(() =>
      parseBaseline(
        JSON.stringify({
          battery: '1',
          revision: 'x',
          configuration: 'abc',
          cells: { a: 1 },
          total: 1,
        }),
      ),
    ).toThrow(/twelve-hex digest/);
  });

  it('refuses a total that is not a number, which is the shape a hand-edited file takes', () => {
    expect(() =>
      parseBaseline(
        JSON.stringify({
          battery: '1',
          revision: 'x',
          configuration: '74cb161840a2',
          cells: { a: 1 },
          total: '1',
        }),
      ),
    ).toThrow(/`total` must be the sum/);
  });

  it('refuses an empty cell set, because an empty baseline compares equal to every run', () => {
    expect(() =>
      parseBaseline(
        JSON.stringify({
          battery: '1',
          revision: 'x',
          configuration: '74cb161840a2',
          cells: {},
          total: 0,
        }),
      ),
    ).toThrow(/compares equal to nothing/);
  });

  it('refuses a count that is not a count, and a total that disagrees with its cells', () => {
    expect(() =>
      parseBaseline(
        JSON.stringify({
          battery: '1',
          revision: 'x',
          configuration: '74cb161840a2',
          cells: { a: -1 },
          total: -1,
        }),
      ),
    ).toThrow(/not a case count/);
    expect(() =>
      parseBaseline(
        JSON.stringify({
          battery: '1',
          revision: 'x',
          configuration: '74cb161840a2',
          cells: { a: 1 },
          total: 2,
        }),
      ),
    ).toThrow(/the cells sum to 1 and `total` says 2/);
  });
});

describe('the census is counted from cases rather than from a summary', () => {
  it('counts the correct cases per cell and skips blank lines', () => {
    const counts = countCells([
      census('RE1:SockShop', true),
      '',
      census('RE1:SockShop', false),
      census('RE3:TrainTicket', true),
    ]);
    expect(counts).toEqual({ 'RE1:SockShop': 1, 'RE3:TrainTicket': 1 });
  });

  it('refuses a line that is not a case record, so a truncated artifact cannot read as zero', () => {
    expect(() => countCells(['{"caseId":"x"}'])).toThrow(/not a case record/);
  });
});

describe('the comparison names every direction a cell can move or vanish', () => {
  it('reports nothing when the run matches', () => {
    expect(compareCells(BASELINE, { ...BASELINE.cells })).toEqual({
      movements: [],
      absent: [],
      unexpected: [],
      actualTotal: 141,
    });
  });

  it('reports a movement in both directions, and it does not care which is an improvement', () => {
    // The defect this gate exists for was a FIX — `112 -> 113`. A comparison that fired only on regressions would
    // have let it through, which is why the two directions are one list here.
    const comparison = compareCells(BASELINE, { 'RE1:SockShop': 120, 'RE3:TrainTicket': 21 });
    expect(comparison.movements).toEqual([
      { cell: 'RE1:SockShop', baseline: 119, actual: 120 },
      { cell: 'RE3:TrainTicket', baseline: 22, actual: 21 },
    ]);
    expect(comparison.actualTotal).toBe(141);
  });

  it('reports a cell the run did not report, and a cell the baseline does not name', () => {
    const comparison = compareCells(BASELINE, { 'RE1:SockShop': 119, 'RE1:OnlineBoutique': 113 });
    expect(comparison.absent).toEqual(['RE3:TrainTicket']);
    expect(comparison.unexpected).toEqual(['RE1:OnlineBoutique']);
    expect(comparison.movements).toEqual([]);
  });
});

describe('the run is identified by its own banner, which is what makes the skip honest', () => {
  it('reads the first `signals:` line, and answers undefined when there is none', () => {
    expect(findSignalLine('header\nsignals: a=1 b=2\nsignals: c=3\n')).toBe('signals: a=1 b=2');
    expect(findSignalLine('header only\n')).toBeUndefined();
  });

  it('digests the line to twelve hex characters, and a different line is a different configuration', () => {
    expect(configDigest('signals: transientGuardTest=hump')).toMatch(/^[0-9a-f]{12}$/);
    expect(configDigest('signals: a=1')).not.toBe(configDigest('signals: a=2'));
  });
});

describe('the job answers with a code rather than with an opinion', () => {
  const files = {
    'baseline.json': BASELINE_TEXT,
    'match-re1.txt': 'signals: shipped\n',
    'match-re1.jsonl': `${census('RE1:SockShop', true)}\n`,
    'arm.txt': 'signals: some arm\n',
    'noline.txt': 'no banner here\n',
  };

  it('refuses to guess when it is not given the three paths', () => {
    const { code, out } = run(files, ['--baseline', 'baseline.json', '--results', 'match-re1.txt']);
    expect(code).toBe(2);
    expect(out).toMatch(/usage/);
  });

  it('skips an ARM, because a dispatch exists to move cells', () => {
    // The arm's digest differs from the baseline's, so no cell is compared and the job stays green. Without this
    // the gate would fail every experiment, and a gate that fails experiments gets removed.
    const { code, out } = run(files, [
      '--baseline',
      'baseline.json',
      '--results',
      'arm.txt',
      '--census',
      'match-re1.jsonl',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/an ARM, so its cells are not compared/);
  });

  it('skips a run whose banner names no configuration at all', () => {
    const { code, out } = run(files, [
      '--baseline',
      'baseline.json',
      '--results',
      'noline.txt',
      '--census',
      'match-re1.jsonl',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/cannot be identified/);
  });

  it('fails when a cell moved, and prints the block the reader has to re-read', () => {
    const shipped = {
      ...files,
      'baseline.json': BASELINE_TEXT.replace(/74cb161840a2/, configDigest('signals: shipped')),
    };
    // The fixture baseline now names the shipped configuration, which is the only way this file's own digest can
    // reach the comparison. Its cells still do not match the census below, so the verdict must be a failure.
    const { code, out } = run(
      { ...shipped, 'match-re1.jsonl': `${census('RE1:SockShop', true)}\n` },
      ['--baseline', 'baseline.json', '--results', 'match-re1.txt', '--census', 'match-re1.jsonl'],
    );
    expect(code).toBe(1);
    expect(out).toContain('THE NINE CELLS MOVED');
    expect(out).toMatch(/RE1:SockShop\s+119 -> 1\b/);
    expect(out).toMatch(/RE3:TrainTicket\s+absent from this run/);
    expect(out).toContain('A movement is not automatically a defect');
  });

  it('passes when the run reproduces the baseline, and says which battery it matched', () => {
    const digest = configDigest('signals: shipped');
    const matches = JSON.stringify({
      battery: '1',
      revision: 'abcdef12',
      configuration: digest,
      cells: { 'RE1:SockShop': 1 },
      total: 1,
    });
    const { code, out } = run({ ...files, 'baseline.json': matches }, [
      '--baseline',
      'baseline.json',
      '--results',
      'match-re1.txt',
      '--census',
      'match-re1.jsonl',
    ]);
    expect(code).toBe(0);
    expect(out).toMatch(/all nine cells match battery 1 at abcdef12/);
    expect(out).toContain('total 1 -> 1 (unchanged)');
  });

  it('sums the three suites before comparing, so a per-suite file is one third of a cell', () => {
    const digest = configDigest('signals: shipped');
    const matches = JSON.stringify({
      battery: '1',
      revision: 'abcdef12',
      configuration: digest,
      cells: { 'RE1:SockShop': 2 },
      total: 2,
    });
    const { code } = run(
      { ...files, 'baseline.json': matches, 'second.jsonl': `${census('RE1:SockShop', true)}\n` },
      [
        '--baseline',
        'baseline.json',
        '--results',
        'match-re1.txt',
        '--census',
        'match-re1.jsonl',
        '--census',
        'second.jsonl',
      ],
    );
    expect(code).toBe(0);
  });
});

describe('the entry-point predicate is a predicate', () => {
  it('answers false without an argv1 and false for another file', () => {
    expect(isEntryPoint(undefined, 'file:///a.ts')).toBe(false);
    expect(isEntryPoint('/somewhere/else.ts', 'file:///a.ts')).toBe(false);
  });

  it('answers true for its own url', () => {
    expect(isEntryPoint('/a.ts', 'file:///a.ts')).toBe(true);
  });
});

describe('the rendered report is readable in a log', () => {
  it('prints one line per movement with a signed delta and a verdict first', () => {
    const comparison = formatComparison(
      compareCells(BASELINE, { 'RE1:SockShop': 120, 'RE3:TrainTicket': 22 }),
      BASELINE,
    );
    expect(comparison.split('\n')[0]).toContain('THE NINE CELLS MOVED');
    expect(comparison).toContain('(+1)');
    expect(comparison).toContain('total 141 -> 142 (moved)');
  });

  it('names a cell the run invented, which is how a tenth cell announces itself', () => {
    const comparison = formatComparison(
      compareCells(BASELINE, { 'RE1:SockShop': 119, 'RE3:TrainTicket': 22, 'RE4:Nowhere': 3 }),
      BASELINE,
    );
    expect(comparison).toMatch(/RE4:Nowhere\s+not in the baseline/);
  });
});
