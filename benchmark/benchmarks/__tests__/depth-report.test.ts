/**
 * The family table: which families' misses are a RANKING question and which are a GRAPH question.
 *
 * The corpus total is a single number, and a single number cannot say what to work on next: a family whose misses
 * sit at depth 6–20 is one a re-ranking could recover, while a family whose misses never appear in the order at
 * all is one where the graph does not carry the answer and scoring is irrelevant. The tests below pin both
 * readings, plus the two ways a table like this usually goes wrong: counting a case twice (a correct case is
 * neither deep nor absent) and printing a percentage of a denominator it does not state.
 */

import { describe, expect, it } from 'vitest';

import { formatFamilyTable, parseDepthReportArgs, summariseFamilies } from '../src/depth-report.js';
import type { DepthRow } from '../src/ranking-depth.js';

/**
 * A depth row.
 *
 * @param faultType - The family.
 * @param depth - First-hit depth, or null when absent.
 * @param answer - The service the run answered first, which the table reads as `@1`.
 * @param accepted - The corpus's label set.
 * @returns A row carrying what the table reads.
 */
function row(
  faultType: string,
  depth: number | null,
  answer = 'a',
  accepted: readonly string[] = ['a'],
): DepthRow {
  return {
    datapack: `${faultType}-${depth}-${answer}`,
    faultType,
    accepted,
    depth,
    candidates: 12,
    top: answer === '' ? [] : [[answer, 1]],
  };
}

describe('summariseFamilies', () => {
  it('counts a correct case as correct and as NEITHER deep nor absent', () => {
    const [family] = summariseFamilies([row('F', 0, 'a')]);
    expect(family).toEqual({
      faultType: 'F',
      cases: 1,
      correctAt1: 1,
      // NOT counted as reachable: at depth 0 the answer is already the reported one, so a re-ranking has nothing
      // to recover here. Counting it in both columns is how a table's parts stop summing to its whole.
      fixableAt5: 0,
      absent: 0,
    });
  });

  it('counts a case answered wrong but reachable within five as reachable, not correct', () => {
    const [family] = summariseFamilies([row('F', 2, 'b', ['a'])]);
    expect(family!.correctAt1).toBe(0);
    expect(family!.fixableAt5).toBe(1);
    expect(family!.absent).toBe(0);
  });

  it('counts a case whose answer is nowhere in the order as absent, and only as absent', () => {
    const [family] = summariseFamilies([row('F', null, 'b', ['a'])]);
    expect(family!.absent).toBe(1);
    expect(family!.fixableAt5).toBe(0);
    expect(family!.correctAt1).toBe(0);
  });

  it('does not count a case deeper than five as reachable — that is the whole point of the split', () => {
    const [family] = summariseFamilies([row('F', 9, 'b', ['a'])]);
    expect(family!.fixableAt5).toBe(0);
    expect(family!.absent).toBe(0);
  });

  it('partitions every family: correct + reachable + deep + absent is the case count', () => {
    const rows = [
      row('F', 0),
      row('F', 1, 'b', ['a']),
      row('F', 40, 'b', ['a']),
      row('F', null, 'b', ['a']),
    ];
    const [family] = summariseFamilies(rows);
    const deep = rows.filter((entry) => entry.depth !== null && entry.depth >= 5).length;
    expect(family!.correctAt1 + family!.fixableAt5 + family!.absent + deep).toBe(family!.cases);
  });

  it('orders families by case count, then by name, so two runs diff line by line', () => {
    const families = summariseFamilies([
      row('B', 0),
      row('A', null, 'b', ['a']),
      row('A', 0),
      row('C', 0, 'b', ['a']),
    ]);
    expect(families.map((family) => family.faultType)).toEqual(['A', 'B', 'C']);
    expect(families.map((family) => family.cases)).toEqual([2, 1, 1]);
  });

  it('counts an EMPTY order as absent rather than as correct', () => {
    const empty: DepthRow = {
      datapack: 'x',
      faultType: 'F',
      accepted: ['a'],
      depth: null,
      candidates: 0,
      top: [],
    };
    expect(summariseFamilies([empty])[0]!.correctAt1).toBe(0);
  });

  it('counts a case whose label set holds several services as correct when the answer is any of them', () => {
    expect(summariseFamilies([row('F', 0, 'b', ['a', 'b'])])[0]!.correctAt1).toBe(1);
  });
});

describe('formatFamilyTable', () => {
  it('prints a header naming every column, and one row per family', () => {
    const text = formatFamilyTable(
      summariseFamilies([row('NetworkDelay', 0), row('JVMReturn', null, 'b', ['a'])]),
    );
    const lines = text.split('\n');
    expect(lines[0]).toContain('faultType');
    expect(lines[0]).toContain('absent');
    expect(lines).toHaveLength(3);
    // Both families have one case, so the tie is broken by NAME — the rule the ordering test pins.
    expect(lines[1]).toContain('JVMReturn');
    expect(lines[2]).toContain('NetworkDelay');
  });

  it('keeps every column separable at the widest cell, so `1` beside `100.0%` is two fields', () => {
    // The defect this pins was found by running the report rather than by reading it: a six-wide `@1` beside a
    // six-wide `@1%` rendered a family at 100 % as `10100.0%`, one token that is neither number.
    const text = formatFamilyTable(
      summariseFamilies([
        { ...row('F', 0), faultType: 'AFamilyWhoseNameIsLong' },
        { ...row('F', 0), faultType: 'AFamilyWhoseNameIsLong' },
      ]),
    );
    for (const line of text.split('\n')) {
      expect(line.trim().split(/\s+/)).toHaveLength(6);
    }
    expect(text).toContain('100.0%');
  });

  it('prints percentages as shares of the family, and a dash when the family is empty', () => {
    const text = formatFamilyTable(summariseFamilies([row('F', 0), row('F', null, 'b', ['a'])]));
    expect(text).toContain('50.0%');
    expect(
      formatFamilyTable([{ faultType: 'Z', cases: 0, correctAt1: 0, fixableAt5: 0, absent: 0 }]),
    ).toContain('  -');
  });
});

describe('parseDepthReportArgs', () => {
  it('reads the depth path', () => {
    expect(parseDepthReportArgs(['--depth', 'd.ndjson'])).toEqual({ depth: 'd.ndjson' });
  });

  it('refuses a missing path and an unknown flag, rather than printing over nothing', () => {
    expect(() => parseDepthReportArgs([])).toThrow(/--depth is required/);
    expect(() => parseDepthReportArgs(['--depth'])).toThrow(/needs a value/);
    expect(() => parseDepthReportArgs(['--depth', 'd', '--nope', 'x'])).toThrow(
      /unrecognised argument/,
    );
  });
});
