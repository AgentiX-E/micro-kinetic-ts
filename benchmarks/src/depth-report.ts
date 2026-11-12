/**
 * The depth report's LOGIC: the argument parser and the two tables a depth artifact is read through — the
 * cumulative ladder and the per-family split.
 *
 * Pure functions over rows, with the IO and the console in `run-depth-report.ts`. The split is the same one
 * `fse26-engine-options.ts` records from the other side — a runner that calls `main()` on import cannot be
 * imported by a test, so the arithmetic a roadmap is read from would be the one part of the tool nothing checks.
 *
 * @module benchmarks/depth-report
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { type DepthRow } from './ranking-depth.js';

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
  // Column widths are fixed AND wide enough for the widest cell each can hold: `@1%` reaches `100.0%`, and a
  // six-wide column with a six-wide neighbour renders `1` beside `100.0%` as `1100.0%` — a table a reader cannot
  // split into fields, which is a formatting defect that looks like a data defect.
  const percent = (part: number, whole: number): string =>
    whole === 0 ? '       -' : `${((part / whole) * 100).toFixed(1)}%`.padStart(8);
  const header =
    `  ${'faultType'.padEnd(26)}${'cases'.padStart(6)}${'@1'.padStart(6)}${'@1%'.padStart(8)}` +
    `${'2-5'.padStart(6)}${'absent'.padStart(8)}`;
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
