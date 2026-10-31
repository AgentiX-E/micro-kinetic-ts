/**
 * The standing document states ONE reading, and this fence holds its tables to the battery that produced it.
 *
 * ## The defect that produced this file
 *
 * `docs/sota-comparison.md` carried the reading of the run BEFORE the boundary gate was enrolled, in the table a
 * reader meets first, while recording the enrolment and its certified number eight hundred lines below in the same
 * file. Four claims were one enrolment behind, and the fourth ran AGAINST us: it read RE2-TrainTicket as
 * `71.1% (64/90)` — which is `64/90`, the RE3 SUITE average before the gate, and not an RE2 cell at all — and
 * declared a two-case deficit to a published ASE'26 method where the current cell is a nine-case LEAD. That
 * sentence carried a roadmap item: a candidate said to close the deficit "exactly", which on the corrected cell is
 * a nine-case regression.
 *
 * ## Why the document needs an anchor rather than a proofreader
 *
 * The same three-cell reading is written in four places (\u00a70's standing table, \u00a71's per-system table, \u00a72a's
 * leaderboard row and \u00a72b's ours row), and three of the four went stale together because nothing joined them. The
 * anchor block in \u00a70p is that join: one fenced block, one line per population, and the assertions below read the
 * TABLES against it.
 *
 * ## What is deliberately not asserted
 *
 * Prose. Claim 4 above was a paragraph rather than a table, and no table fence can see a paragraph that names the
 * wrong population. What replaces it is stated in \u00a70p as a reading rule — cite the run, and cite the fraction as
 * well as the percentage, because `71.1%` is a number three populations share and `64/90` is not — and this file
 * asserts the part a test can hold: the tables, the arithmetic, and the absence of the readings the correction
 * retired.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const DOC = readFileSync(resolve(REPO_ROOT, 'docs/sota-comparison.md'), 'utf8');

/** One population's reading: `correct` of `total`, keyed by the name the anchor block uses. */
interface Reading {
  readonly key: string;
  readonly correct: number;
  readonly total: number;
}

/**
 * The anchor block, parsed.
 *
 * @returns One reading per line of the fenced block that follows the `standing-anchor` marker.
 */
function anchor(): Reading[] {
  const marker = DOC.indexOf('<!-- standing-anchor:');
  expect(marker, 'the document carries an anchor marker').toBeGreaterThanOrEqual(0);
  const open = DOC.indexOf('```text', marker);
  const close = DOC.indexOf('```', open + 7);
  expect(open, 'the anchor block is fenced').toBeGreaterThan(marker);
  expect(close, 'the anchor block is closed').toBeGreaterThan(open);
  return DOC.slice(open + 7, close)
    .trim()
    .split('\n')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      expect(parts.length, `anchor line '${line}' is \`key correct total\``).toBe(3);
      return { key: parts[0]!, correct: Number(parts[1]), total: Number(parts[2]) };
    });
}

/** A section of the document, by its opening heading and the heading that ends it. */
function section(from: string, to: string): string {
  const start = DOC.indexOf(from);
  const end = DOC.indexOf(to, start + from.length);
  expect(start, `${from} is in the document`).toBeGreaterThanOrEqual(0);
  expect(end, `${to} follows ${from}`).toBeGreaterThan(start);
  return DOC.slice(start, end);
}

const readings = anchor();
const byKey = (key: string): Reading => {
  const found = readings.find((r) => r.key === key);
  expect(found, `the anchor carries ${key}`).toBeDefined();
  return found!;
};

/**
 * The readings the correction retired, in BOTH forms the document prints them — the fraction and the percentage.
 *
 * Both, because this record quotes each reading twice and a correction that retires only one form is a correction a
 * later edit can undo by writing the other. The set is one list rather than an inline array so that the assertion
 * below can join it to \u00a70p's correction table in the other direction: a reading named there and absent here is a
 * retirement that was announced and not enforced.
 */
const RETIRED = [
  // The overall total, both forms.
  '631/735',
  '85.85',
  // RE1 and its two cells, both forms.
  '327/375',
  '87.20',
  // RE2: the OnlineBoutique cell, the SockShop cell and the suite total it summed to.
  '80/90',
  '88.9',
  '85/90',
  '240/270',
  // RE1-SockShop, count and percentage.
  '116',
  '92.8',
  // FSE'26, both forms.
  '798/1422',
  '56.12',
  // The cell that was read as a deficit rather than a lead, both forms.
  '64/90',
  '71.1',
] as const;

describe('the standing document is anchored to one battery', () => {
  it('carries nine cells, three suites and a total, and the arithmetic closes', () => {
    // Non-vacuity first: a block that parsed to nothing would satisfy every sum below.
    expect(readings.filter((r) => r.key.includes(':'))).toHaveLength(9);
    expect(readings.filter((r) => /^RE\d$/.test(r.key))).toHaveLength(3);
    expect(readings.filter((r) => r.key === 'TOTAL')).toHaveLength(1);
    for (const suite of ['RE1', 'RE2', 'RE3']) {
      const cells = readings.filter((r) => r.key.startsWith(`${suite}:`));
      const sum = cells.reduce((acc, r) => acc + r.correct, 0);
      expect(sum, `${suite}'s cells sum to its suite reading`).toBe(byKey(suite).correct);
      // …and the denominator is the cells' own, so a cell recorded against the wrong case count cannot hide
      // behind a suite that was computed some other way.
      expect(cells.reduce((acc, r) => acc + r.total, 0)).toBe(byKey(suite).total);
    }
    const total = readings.find((r) => r.key === 'TOTAL')!;
    expect(['RE1', 'RE2', 'RE3'].reduce((acc, k) => acc + byKey(k).correct, 0)).toBe(total.correct);
    expect(['RE1', 'RE2', 'RE3'].reduce((acc, k) => acc + byKey(k).total, 0)).toBe(total.total);
  });

  it('prints the anchor\u2019s total in the standing table, the leaderboard and the verdict', () => {
    const fraction = `${byKey('TOTAL').correct}/${byKey('TOTAL').total}`;
    const standing = section('## 0. STANDING', '### 0p.');
    const leaderboard = section('### 2a. Full-benchmark', '### 2b.');
    expect(standing, 'the standing table quotes the anchored total').toContain(`(${fraction})`);
    expect(leaderboard, 'the leaderboard quotes the anchored total').toContain(`(${fraction})`);
    // And §1's own table, whose overall row is the one a reader checks against the table above it.
    expect(section('## 1. Our result', '## 2.')).toContain(
      `**87.21%** (${byKey('TOTAL').correct})`,
    );
  });

  it('prints the anchor\u2019s three suite readings and all nine cells in §1', () => {
    const perSystem = section('## 1. Our result', '## 2.');
    for (const suite of ['RE1', 'RE2', 'RE3']) {
      const r = byKey(suite);
      expect(
        perSystem,
        `${suite} is printed as a fraction of the anchor's own denominator`,
      ).toContain(`(${r.correct}/${r.total})`);
    }
    for (const r of readings.filter((one) => one.key.includes(':'))) {
      expect(perSystem, `${r.key}'s correctness is printed`).toContain(`(${r.correct})`);
    }
  });

  it('does not print any of the readings the correction retired', () => {
    // The regions are TABLES, and only tables: \u00a70p, \u00a71's explanation and \u00a72b-ii's retraction box NAME the
    // retired numbers on purpose \u2014 a correction that cannot name what it corrected is not one. What a table
    // prints as a reading is the thing that has to be current, and an explanatory COLUMN is not an exemption:
    // a basis cell saying "\u006071.1\u0060 before iteration 129" is a table printing 71.1, and a reader skimming the row
    // sees the number without the clause. That is how this defect survived four earlier readings.
    const current = [
      section('| evaluation                              | metric', '**Ranking: first on RCAEval'),
      section('| suite                         | OnlineBoutique', '**Every number above'),
      section('| method                     | Top-1', '> Two traps avoided here'),
      section(
        '| method                       | AC@1 / R@1',
        '> **The rows above whose populations',
      ),
      section('| population                     | GALA+ AC@1', '> **This table was wrong'),
    ].join('\n');
    // Non-vacuity: five tables, and each one carries at least one of our own readings.
    expect(current).toContain('641/735');
    expect(current).toContain('330/375');
    expect(current).toContain('75/90');
    // The two directions of the same fact. Above: no table prints a retired reading. Below: \u00a70p names every
    // reading it retires, so the list cannot grow past the correction or the correction past the list.
    const correction = section('### 0p. THE ANCHOR', '### 0a.');
    for (const retired of RETIRED) {
      expect(current, `${retired} is retired and may not appear in a table`).not.toContain(retired);
      expect(correction, `${retired} is retired, and \u00a70p does not say so`).toContain(retired);
    }
  });

  it('reports the GALA+ cell as a lead with our own fraction beside it', () => {
    // The specific sentence the correction exists for. Asserted on the FRACTION because `73.3%` and `71.1%` are
    // numbers this document uses for three different populations; `75/90` is not.
    const gala = section('### 2b-ii. GALA+', '**What is NOT claimed');
    expect(gala).toContain('83.3%');
    expect(gala).toContain('+10.0pp');
    expect(gala, 'the retraction of the "exact closure" is stated rather than deleted').toMatch(
      /RETRACTED/,
    );
  });
});
