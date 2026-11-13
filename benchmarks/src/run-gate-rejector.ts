/**
 * The console entry for the gate rejector.
 *
 * One dump, one term, and two readings: the frontier over every reach bound, and the out-of-fold Chow bound. Every
 * number either one means lives in `gate-rejector.ts`, which is where the tests are.
 *
 * Usage: `tsx benchmarks/src/run-gate-rejector.ts --terms <dump.ndjson> [--term failedEdge] [--folds 5] [--rate 1]`
 */

import {
  chowReport,
  formatChow,
  formatFrontier,
  frontierOf,
  parseRejectorArgs,
  rejectorCasesOf,
  runTotalOf,
} from './gate-rejector.js';
import { readTermsDump } from './terms-dump.js';

function main(): void {
  const args = parseRejectorArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const rows = rejectorCasesOf(cases, args.term);
  process.stdout.write(
    `THE REACH FRONTIER (term ${args.term})\n${formatFrontier(frontierOf(rows), runTotalOf(rows))}\n`,
  );
  process.stdout.write(
    `\nTHE OUT-OF-FOLD CHOW BOUND\n${formatChow(chowReport(rows, args.folds, args.rate))}\n`,
  );
}

main();
