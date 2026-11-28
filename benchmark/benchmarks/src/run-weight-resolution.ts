/**
 * The console entry for the resolution floor.
 *
 * Kept to argument parsing and one pass over the dump: everything the number means lives in
 * `weight-resolution.ts`, which is where the tests are.
 */

import { evaluateWeights, prepareCases, shippedWeightsOf } from './term-weight-screen.js';
import { readTermsDump } from './terms-dump.js';
import {
  formatResolutionReport,
  parseResolutionArgs,
  resolutionTablePrepared,
  termsOf,
} from './weight-resolution.js';

function main(): void {
  const args = parseResolutionArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const corpus = prepareCases(cases);
  const baseline = evaluateWeights(cases, []);
  const names = args.names ?? termsOf(cases);
  const readings = resolutionTablePrepared(corpus, names, args.weights);
  process.stdout.write(
    `${formatResolutionReport(readings, {
      cases: corpus.cases.length,
      refused: corpus.refused,
      baseline: baseline.hits,
      shipped: shippedWeightsOf(cases),
    })}\n`,
  );
}

main();
