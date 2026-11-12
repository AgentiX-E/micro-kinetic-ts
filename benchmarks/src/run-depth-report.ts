/**
 * `run-depth-report` — read a depth artifact and print the split it exists to state.
 *
 * Two tables, both from the same rows and both joinable to the corpus:
 *
 * - the **ladder**, cumulative `recall@K` over the full order, with the two miss families printed beneath it
 *   (`beyond@K` and `absent`) so the population adds up;
 * - the **family table**, one row per fault type: how many cases it has, how many are correct at the shipped
 *   `Top@1`, how many are deeper than five, and how many are absent.
 *
 * The second table is the one that decides a roadmap. A family whose misses are all *deep* is a ranking question
 * in that family; a family whose misses are all *absent* is a graph or label question, and no amount of scoring
 * work moves it. An average cannot tell them apart, which is why the artifact carries the split and this program
 * prints it per family rather than once for the corpus.
 *
 * It reads ONE file and writes to the console: no corpus, no engine, so a table cannot be an accident of the data
 * a run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-depth-report.ts --depth artifacts/agentic/depth.ndjson
 *
 * @module benchmarks/run-depth-report
 */

import { pathToFileURL } from 'node:url';

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { formatDepthLadder, readDepthDump, type DepthRow } from './ranking-depth.js';

/** One family's four counts. */
export interface FamilyDepth {
  readonly faultType: string;
  readonly cases: number;
  /** Cases at depth 0: the shipped answer. */
  readonly correctAt1: number;
  /** Cases at depth 1–4: a miss a re-ranking of the reported five could fix. */
  readonly fixableAt5: number;
  readonly absent: number;
}

/**
 * Count each family's misses by the family they belong to.
 *
 * Every count comes from the row's `depth` alone, so the four columns partition each family exactly once. Reading
 * "correct" from the answer (`top[0]`) and "reachable" from the depth would count a depth-0 case twice.
 *
 * @param rows - The depth rows.
 * @returns One entry per fault type, in descending case count then name order.
 */
export function summariseFamilies(rows: readonly DepthRow[]): FamilyDepth[] {
  const cells = new Map<
    string,
    { cases: number; correctAt1: number; fixableAt5: number; absent: number }
  >();
  for (const row of rows) {
    const cell = cells.get(row.faultType) ?? { cases: 0, correctAt1: 0, fixableAt5: 0, absent: 0 };
    cell.cases += 1;
    // Every case lands in EXACTLY one column, read from the depth alone. Counting "correct" from the answer and
    // "reachable" from the depth would double-count a case at depth 0 — it is both — and a table whose columns
    // sum to more than its population is a table a roadmap gets read off incorrectly.
    if (row.depth === null) cell.absent += 1;
    else if (row.depth === 0) cell.correctAt1 += 1;
    else if (row.depth < 5) cell.fixableAt5 += 1;
    cells.set(row.faultType, cell);
  }
  return (
    [...cells.entries()]
      .map(([faultType, cell]) => ({ faultType, ...cell }))
      // `compareCasePaths` rather than a locale comparison: a family table's order has to be a property of the
      // corpus, not of the machine's ICU version, or two runs over the same artifact print two different tables.
      .sort(
        (left, right) =>
          right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
      )
  );
}

/**
 * Render the family table.
 *
 * Columns are padded to a fixed width and percentages carry two decimals, so two runs' tables diff line by line.
 *
 * @param families - The per-family counts.
 * @returns The table, newline-separated with no trailing newline.
 */
export function formatFamilyTable(families: readonly FamilyDepth[]): string {
  const percent = (part: number, whole: number): string =>
    whole === 0 ? '  -' : `${((part / whole) * 100).toFixed(1)}%`.padStart(6);
  const header =
    `  ${'faultType'.padEnd(26)}${'cases'.padStart(6)}${'@1'.padStart(6)}${'@1%'.padStart(8)}` +
    `${'<=5'.padStart(6)}${'absent'.padStart(8)}`;
  const lines = families.map((family) => {
    return (
      `  ${family.faultType.padEnd(26)}${String(family.cases).padStart(6)}` +
      `${String(family.correctAt1).padStart(6)}${percent(family.correctAt1, family.cases)}` +
      `${String(family.fixableAt5).padStart(6)}${String(family.absent).padStart(8)}`
    );
  });
  return [header, ...lines].join('\n');
}

/**
 * Parse the arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The depth path.
 * @throws Error on an unknown flag or a missing value, so a typo cannot print a table over the wrong artifact.
 */
export function parseDepthReportArgs(argv: readonly string[]): { depth: string } {
  let depth = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--depth') depth = value;
    else throw new Error(`unrecognised argument ${arg}`);
    index += 1;
  }
  if (depth === '') throw new Error('--depth is required');
  return { depth };
}

/** Entry point. */
function main(): void {
  const args = parseDepthReportArgs(process.argv.slice(2));
  const rows = readDepthDump(args.depth);
  console.log(formatDepthLadder(rows));
  console.log('');
  console.log(formatFamilyTable(summariseFamilies(rows)));
}

// Run only when executed, not when imported.
//
// This is the defect `fse26-engine-options.ts` records from the other side: a module that calls `main()` on import
// cannot be imported by a test, so none of the arithmetic above could be checked — and the tables it prints are
// exactly the arithmetic a roadmap is read from.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
