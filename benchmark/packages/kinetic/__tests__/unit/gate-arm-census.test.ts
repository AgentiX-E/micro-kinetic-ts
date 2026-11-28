/**
 * One arm's two tables are two descriptions of one artifact, and this fence joins them.
 *
 * ## The claim the tables make
 *
 * `docs/topo-discount-gate.md` §7.1 reads the `topoDiscountGate = 0.5` arm at the CELL level — nine cells, four
 * down and two up, `639` against an anchored `641`. §7.2 reads the same arm at the CASE level, and its finding is
 * a symmetry: in all five gains the truth's own post-deduction anomaly does not fall, and in all seven losses it
 * does. The arm is therefore one action — a charge landing on one node — whose sign is decided by whether that node
 * is the culprit.
 *
 * That is a falsifiable statement about an artifact outside this repository, and what a test can hold is its
 * ARITHMETIC: the per-case table's row count per cell must equal the cell table's delta, a gain must not be a row
 * whose Δ fell, and a loss must not be a row whose Δ rose. If either table is edited without the other, one of
 * those three joins goes red.
 *
 * ## Why this is a fence rather than a proofreader
 *
 * The two tables were written from the same two artifacts (`41205151091` and `41212474116`) and nothing joined them
 * until this file. The repository has met the failure before: `docs/sota-comparison.md` carried a reading one
 * enrolment behind in four places at once because the tables were prose that agreed by hand.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DOC = readFileSync(resolve(REPO_ROOT, 'docs/topo-discount-gate.md'), 'utf8');

/** The minus sign these tables print, folded to ASCII so a sign test cannot depend on which one was typed. */
function signed(text: string): number {
  return Number(text.replace(/[*\s]/g, '').replace(/\u2212/g, '-'));
}

/** A cell's delta as §7.1 prints it: the anchored value, the arm's value, and the difference. */
interface CellDelta {
  readonly cell: string;
  readonly anchored: number;
  readonly arm: number;
  readonly delta: number;
}

/** A case's flip as §7.2 prints it. */
interface CaseFlip {
  readonly caseId: string;
  readonly cell: string;
  readonly delta: number;
  readonly fromRank: number;
  readonly toRank: number;
  readonly landing: string;
}

/**
 * The slice between two headings, so a table is read from the section that owns it rather than from the document.
 *
 * @param start - The heading to begin after.
 * @param end - The heading to stop before, or an empty string for the end of the file.
 * @returns The text between them.
 */
function section(start: string, end: string): string {
  const open = DOC.indexOf(start);
  expect(open, `the document carries the heading ${start}`).toBeGreaterThanOrEqual(0);
  const from = open + start.length;
  const close = end === '' ? DOC.length : DOC.indexOf(end, from);
  if (end !== '') {
    expect(close, `the document carries the heading ${end} after ${start}`).toBeGreaterThan(from);
  }
  return DOC.slice(from, close);
}

const CASE_TABLE = section('### 7.2 ', 'The column that decides the case');
const CELL_TABLE = section(
  '### 7.1 ',
  '**The mechanism, and why it is not the one §6 predicted.**',
);

/**
 * The twelve rows of §7.2's table.
 *
 * @returns One flip per table row, in document order.
 */
function flips(): CaseFlip[] {
  const rows: CaseFlip[] = [];
  for (const line of CASE_TABLE.split('\n')) {
    const m =
      /^\| `([a-z0-9_-]+)` \| (RE\d:[A-Za-z]+) \| (\S+) → (\S+) \| (\S+) \| (\d+) → (\d+) \| (.*) \|$/.exec(
        line.trim(),
      );
    if (m === null) continue;
    rows.push({
      caseId: m[1]!,
      cell: m[2]!,
      delta: signed(m[5]!),
      fromRank: Number(m[6]),
      toRank: Number(m[7]),
      landing: m[8]!,
    });
  }
  return rows;
}

/**
 * The nine-cell table of §7.1, plus its three suite rows and its total, keyed by the first column.
 *
 * @returns One entry per row whose first column is a cell name or a suite name.
 */
function cells(): CellDelta[] {
  const rows: CellDelta[] = [];
  for (const line of CELL_TABLE.split('\n')) {
    const m =
      /^\| (\*{0,2}RE\d:[A-Za-z]+\*{0,2}) \| (\d+) \| (\*{0,2}\d+\*{0,2}) \| (\S+) \|$/.exec(
        line.trim(),
      );
    if (m === null) continue;
    rows.push({
      cell: m[1]!.replace(/\*/g, ''),
      anchored: Number(m[2]),
      arm: Number(m[3]!.replace(/\*/g, '')),
      delta: signed(m[4]!),
    });
  }
  return rows;
}

describe('the gate arm’s case table and its cell table', () => {
  it('prints twelve flips, five gained and seven lost', () => {
    const rows = flips();
    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => r.caseId)).size, 'every row is a distinct case').toBe(12);

    const gains = rows.filter((r) => r.toRank === 1);
    const losses = rows.filter((r) => r.fromRank === 1);
    expect(gains, 'five cases gained a rank-1').toHaveLength(5);
    expect(losses, 'seven cases lost one').toHaveLength(7);
    expect(gains.length + losses.length, 'no row is both').toBe(12);
  });

  it('reads a gain as a row whose truth did not fall, and a loss as one whose truth did', () => {
    // The finding, stated as an assertion: the SIGN of Δ is the outcome. A gain whose truth's own anomaly fell
    // would break the symmetry §7.2 claims, and this is where that would surface.
    for (const row of flips()) {
      if (row.toRank === 1) {
        expect(
          row.delta,
          `${row.caseId} gained and its truth's anomaly must not have fallen`,
        ).toBeGreaterThanOrEqual(0);
      } else {
        expect(
          row.delta,
          `${row.caseId} lost and its truth's anomaly must have fallen`,
        ).toBeLessThan(0);
      }
    }
  });

  it('agrees with §7.1 cell for cell, and names the cells §7.1 leaves unmoved not at all', () => {
    const rows = flips();
    // Without this the loop below would pass on an empty table, which is the failure mode every join of this
    // shape has: a parse that matches nothing agrees with every claim it is asked to check.
    expect(cells(), 'the cell table has nine rows').toHaveLength(9);
    for (const cell of cells()) {
      const mine = rows.filter((r) => r.cell === cell.cell);
      const gained = mine.filter((r) => r.toRank === 1).length;
      const lost = mine.filter((r) => r.fromRank === 1).length;
      expect(
        gained - lost,
        `${cell.cell}: the case table must reproduce the cell table’s delta`,
      ).toBe(cell.delta);
      if (cell.delta === 0) {
        expect(mine, `${cell.cell} is unmoved, so no case row may name it`).toHaveLength(0);
      }
    }
  });

  it('reaches every cell the cell table moves, and no other', () => {
    const moved = new Set(
      cells()
        .filter((c) => c.delta !== 0)
        .map((c) => c.cell),
    );
    const named = new Set(flips().map((r) => r.cell));
    expect([...named].sort()).toEqual([...moved].sort());
  });

  it('attributes every gain to a competitor and every loss to the culprit', () => {
    for (const row of flips()) {
      if (row.toRank === 1) {
        expect(row.landing, `${row.caseId} is a gain, so the charge landed elsewhere`).toMatch(
          /^a competitor/,
        );
      } else {
        expect(row.landing, `${row.caseId} is a loss, so the charge landed on the truth`).toMatch(
          /^the culprit/,
        );
      }
    }
  });
});
