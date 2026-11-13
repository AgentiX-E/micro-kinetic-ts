/**
 * The console entry for the gate rejector.
 *
 * One dump, one term, and three readings: the frontier over every reach bound, that frontier priced as a loss
 * ladder, and the out-of-fold Chow bound. Every number either one means lives in `gate-rejector.ts`, which is where
 * the tests are.
 *
 * Usage: `tsx benchmarks/src/run-gate-rejector.ts --terms <dump.ndjson> [--term failedEdge] [--folds 5] [--rate 1]
 * [--budget 0 --budget 4 …] [--delta 0.05]`
 */

import {
  budgetScanOf,
  cheapestOf,
  chowReport,
  formatBudgets,
  formatChow,
  formatFrontier,
  frontierOf,
  parseRejectorArgs,
  rejectorCasesOf,
  runTotalOf,
} from './gate-rejector.js';
import { certifyOf, floorOf, formatCertified, populationOf, thresholdOf } from './risk-control.js';
import { readTermsDump } from './terms-dump.js';

function main(): void {
  const args = parseRejectorArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const rows = rejectorCasesOf(cases, args.term);
  // The frontier is read once: the ladder prices the same points, and two derivations of one statistic is how a
  // report starts disagreeing with itself.
  const frontier = frontierOf(rows);
  const runTotal = runTotalOf(rows);
  const population = populationOf(rows);
  process.stdout.write(
    `THE REACH FRONTIER (term ${args.term})\n${formatFrontier(frontier, runTotal)}\n`,
  );
  process.stdout.write(
    `\nTHE ACCEPTANCE CONDITION, PRICED\n${formatBudgets(
      budgetScanOf(frontier, args.budgets),
      runTotal,
      cheapestOf(frontier),
    )}\n`,
  );
  process.stdout.write(
    `\nTHE SAME LADDER, CERTIFIED (level ${args.delta})\n${formatCertified(
      certifyOf(population, frontier, args.budgets, args.delta),
      population.n,
      args.delta,
      population.families.length,
      thresholdOf(population, frontier, args.delta),
    )}\n`,
  );
  // The floor is a property of the COUNT rather than of this corpus, so it is printed once per loss depth the frontier
  // reaches: it is the answer to "would more cases make this cheaper", and the answer is no.
  const depths = [
    ...new Set(
      frontier.map((point) =>
        point.regressed.reduce((deep, loss) => Math.max(deep, -loss.delta), 0),
      ),
    ),
  ].sort((a, b) => a - b);
  process.stdout.write(
    `floors at ${args.delta} (any corpus size): ${depths
      .map((lost) => `${lost} cases -> k ${floorOf(lost, args.delta)}`)
      .join(', ')}\n`,
  );
  process.stdout.write(
    `\nTHE OUT-OF-FOLD CHOW BOUND\n${formatChow(chowReport(rows, args.folds, args.rate))}\n`,
  );
}

main();
