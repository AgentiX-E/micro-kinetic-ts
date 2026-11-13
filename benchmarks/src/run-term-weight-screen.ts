/**
 * `run-term-weight-screen` — read a TERM dump and print what a weight is worth, without running the engine.
 *
 * The measurement behind `docs/term-weight-landscape.md`: the default grid is 28 points, every one of them
 * printed, and `--grid` takes a JSON file so a new set of questions needs no edit to the tree. The identity at
 * `Δw = 0` is computed by the screen itself rather than trusted from a caller, so a row's `delta` is always
 * against the run it came from.
 *
 * It reads files and writes to the console: no corpus, no engine, so a table cannot be an accident of the data a
 * run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-term-weight-screen.ts --terms fse26-terms.ndjson [--grid grid.json]
 *
 * @module benchmarks/run-term-weight-screen
 */

import { readFileSync } from 'node:fs';

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
