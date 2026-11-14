/**
 * The console entry for weight reachability.
 *
 * Argument parsing and one pass over the dump: everything the number means lives in `weight-reachability.ts`,
 * which is where the tests are.
 */

import { prepareCases, shippedWeightsOf } from './term-weight-screen.js';
import { readTermsDump } from './terms-dump.js';
import type { FitReport } from './weight-reachability.js';
import {
  DEFAULT_FIT,
  familyOfVector,
  familyReach,
  formatFamilyFit,
  formatFitReport,
  formatReachReport,
  heldOutFit,
  namesOf,
  parseReachArgs,
  reachabilityTable,
  summariseReach,
} from './weight-reachability.js';

function main(): void {
  const args = parseReachArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const corpus = prepareCases(cases);
  const names = namesOf(corpus);
  const readings = reachabilityTable(corpus, names, args.basis);
  process.stdout.write(
    `${formatReachReport(summariseReach(readings), familyReach(readings), args.basis)}\n`,
  );
  if (args.fit) {
    const shipped: Record<string, number> = {};
    for (const move of shippedWeightsOf(cases)) shipped[move.name] = move.weight;
    // Six independent fits, three seeds by two orientations: one fit is an anecdote, and a gain that only shows
    // up on the split it was trained on is a property of the split.
    let first: FitReport | null = null;
    for (const orientation of [0, 1] as const) {
      for (const seed of [0, 1, 2]) {
        const fit = heldOutFit(
          corpus,
          names,
          shipped,
          { ...DEFAULT_FIT, seed, orientation },
          args.basis,
        );
        first ??= fit;
        process.stdout.write(`\n${formatFitReport(fit)}\n`);
      }
    }
    if (first !== null) {
      process.stdout.write(
        `\nFAMILY (seed 0, orientation 0)\n${formatFamilyFit(familyOfVector(corpus, names, first.weights, args.basis))}\n`,
      );
    }
  }
}

main();
