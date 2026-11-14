/**
 * `run-term-weight-screen` — read a TERM dump and print what a weight is worth, without running the engine.
 *
 * The measurement behind `docs/term-weight-landscape.md`: the default grid is 28 points, every one of them
 * printed, and `--grid` takes a JSON file so a new set of questions needs no edit to the tree. The identity at
 * `Δw = 0` is computed by the screen itself rather than trusted from a caller, so a row's `delta` is always
 * against the run it came from.
 *
 * The second table is the **selective certificate**: the same rows, priced in the one currency the screen's own gate
 * does not have. The gate is a veto (no family above the floor may lose a case) and it returns "the admissible set is
 * empty" for this corpus; the certificate says what each row's claim would cost, and what the best of them is worth
 * per unit conceded. `--delta` sets the level and `--correction` the rule the level is split by, so the pair can be
 * ablated without editing the tree.
 *
 * It reads files and writes to the console: no corpus, no engine, so a table cannot be an accident of the data a
 * run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-term-weight-screen.ts --terms fse26-terms.ndjson [--grid grid.json]
 *     [--delta 0.05] [--correction holm]
 *
 * @module benchmarks/run-term-weight-screen
 */

import { readFileSync } from 'node:fs';

import { formatSelection, selectCertified } from './certified-selection.js';
import {
  DEFAULT_GRID,
  formatScreenReport,
  parseGridFile,
  parseScreenArgs,
  screenGrid,
  shippedWeightsOf,
} from './term-weight-screen.js';
import { readTermsDump } from './terms-dump.js';

const args = parseScreenArgs(process.argv.slice(2));
const cases = readTermsDump(args.terms);
const points = args.grid === '' ? DEFAULT_GRID : parseGridFile(readFileSync(args.grid, 'utf8'));

if (points.length === 0) {
  // A grid file with no points prints a report whose verdict is about nothing, and "the admissible set is empty"
  // over an empty grid is a sentence a reader would take for a result.
  throw new Error(`the grid at ${args.grid} carries no points`);
}

const report = screenGrid(cases, points);
console.log(formatScreenReport(report, shippedWeightsOf(cases)));

if (report.cases === 0) {
  // Every case was refused, which means the dump's terms are not the terms its scores were built from — a report
  // over zero cases is not a landscape, and printing it without a failure is how an artifact defect reads as an
  // empty result.
  throw new Error(
    'no case in the dump rebuilds its own score, so no row of this screen is about it',
  );
}

// The shipped row is the screen's own baseline, so its ledger is empty by construction: it loses nothing against
// itself. Taking it from the report rather than from the shipped weights is the same measurement every row's `before`
// came from, and a second reading of one corpus is the defect the screen's own docstring refuses.
const selection = selectCertified(
  { n: report.cases, families: report.families },
  { label: 'shipped', cases: report.baseline, losses: [] },
  report.rows.map((row) => ({ label: row.label, cases: row.after, losses: row.ledger })),
  { delta: args.delta, correction: args.correction },
);
console.log('');
console.log(formatSelection(selection));
