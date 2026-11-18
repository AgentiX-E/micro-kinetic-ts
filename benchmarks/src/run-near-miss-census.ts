/**
 * `run-near-miss-census` — read a depth artifact and print what its `Top@1` misses are made of.
 *
 * One file in, one table and optionally one per-case dump out: no corpus, no engine and no labels beyond the ones
 * the depth artifact already carries. That boundary is what makes the census comparable between two commits — a
 * reading that re-ran the engine could differ from the published artifact for a reason the table would not name.
 *
 * `near-miss-census.ts` owns the arithmetic and `depth-report.ts` owns the argument parser this reuses, so a
 * second spelling of `--depth` cannot drift from the first one.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-near-miss-census.ts --depth artifacts/agentic/depth.ndjson \
 *     [--cases-out artifacts/agentic/near-misses.ndjson]
 *
 * @module benchmarks/run-near-miss-census
 */

import { writeFileSync } from 'node:fs';

import { parseDepthReportArgs } from './depth-report.js';
import { censusNearMisses, formatNearMissCensus, formatNearMissRow } from './near-miss-census.js';
import { readDepthDump } from './ranking-depth.js';

/**
 * Split the arguments into the ones the depth parser owns and the one this runner adds.
 *
 * `--cases-out` is extracted BEFORE the shared parser sees the vector, because that parser rejects every flag it
 * does not know — which is the property that keeps it honest for its own caller, and the reason a second option
 * has to be removed rather than passed through.
 *
 * @param argv - `process.argv.slice(2)`.
 * @returns The depth path and the optional per-case output path.
 */
function parseArgs(argv: readonly string[]): { depth: string; casesOut: string } {
  let casesOut = '';
  const remaining: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--cases-out') {
      const value = argv[index + 1];
      // Checked here rather than left to `writeFileSync('')`, which fails with an `ENOENT` naming the working
      // directory instead of the missing flag.
      if (value === undefined) throw new Error('--cases-out needs a value');
      casesOut = value;
      index += 1;
      continue;
    }
    remaining.push(arg);
  }
  return { depth: parseDepthReportArgs(remaining).depth, casesOut };
}

const args = parseArgs(process.argv.slice(2));
const rows = readDepthDump(args.depth);
const census = censusNearMisses(rows);
console.log(formatNearMissCensus(census));
if (args.casesOut !== '') {
  writeFileSync(
    args.casesOut,
    census.nearMisses.map((miss) => `${formatNearMissRow(miss)}\n`).join(''),
  );
  console.log(`\n  per-case dump: ${args.casesOut} (${census.nearMisses.length} rows)`);
}
