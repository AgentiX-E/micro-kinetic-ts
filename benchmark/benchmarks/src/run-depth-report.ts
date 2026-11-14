/**
 * `run-depth-report` — read a depth artifact and print the split it exists to state.
 *
 * Two tables, both from the same rows and both joinable to the corpus: the cumulative `recall@K` ladder with the
 * two miss families beneath it, and the per-family table that says which families' misses are a RANKING question
 * and which are a GRAPH question. `depth-report.ts` owns the arithmetic and the parser and `ranking-depth.ts` owns the format;
 * this file owns nothing but the console, which is why it is the one part of the tool a test cannot import — the
 * same boundary every runner in this directory keeps.
 *
 * It reads ONE file and writes to the console: no corpus, no engine, so a table cannot be an accident of the data
 * a run happened to load.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-depth-report.ts --depth artifacts/agentic/depth.ndjson
 *
 * @module benchmarks/run-depth-report
 */

import { formatFamilyTable, parseDepthReportArgs, summariseFamilies } from './depth-report.js';
import { formatDepthLadder, readDepthDump } from './ranking-depth.js';

const args = parseDepthReportArgs(process.argv.slice(2));
const rows = readDepthDump(args.depth);
console.log(formatDepthLadder(rows));
console.log('');
console.log(formatFamilyTable(summariseFamilies(rows)));
