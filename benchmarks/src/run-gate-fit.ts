/**
 * The console entry for the gate fit.
 *
 * Argument parsing and two readings of one dump: what the shipped weights do to the gate, and what a vector fitted
 * under it does. Everything either number means lives in `gate-fit.ts`, which is where the tests are.
 */

import {
  DEFAULT_GATE_FIT,
  countUnder,
  fitUnderGate,
  formatGateFit,
  formatGateReading,
  gateReading,
  parseGateArgs,
  readUnder,
} from './gate-fit.js';
import { prepareCases, shippedWeightsOf } from './term-weight-screen.js';
import { readTermsDump } from './terms-dump.js';
import { namesOf, reachCaseOf } from './weight-reachability.js';

function main(): void {
  const args = parseGateArgs(process.argv.slice(2));
  const cases = readTermsDump(args.terms);
  const corpus = prepareCases(cases);
  const names = namesOf(corpus);
  const reach = corpus.cases.map((kase) => reachCaseOf(kase, names));
  const shipped: Record<string, number> = {};
  for (const move of shippedWeightsOf(cases)) shipped[move.name] = move.weight;
  const start = Float64Array.from(names.map((name) => shipped[name] ?? 0));

  const baseline = reach.map((kase) => readUnder(kase, start));
  const now = gateReading(reach, baseline, start, args.familyFloor);
  process.stdout.write(`THE SHIPPED WEIGHTS\n${formatGateReading(now)}\n`);
  const zero = countUnder(reach, new Float64Array(names.length));
  process.stdout.write(
    `\nthe zero vector answers ${zero.answers} strictly and ${zero.optimistic} optimistically — the second number is the recorded run, won entirely by tie\n`,
  );
  if (!args.fit) return;
  const fit = fitUnderGate(reach, shipped, names, {
    ...DEFAULT_GATE_FIT,
    epochs: args.epochs,
    seed: args.seed,
    orientation: args.orientation,
    familyFloor: args.familyFloor,
  });
  const weights = Float64Array.from(names.map((name) => fit.weights[name] ?? 0));
  process.stdout.write(`\n${formatGateFit(fit)}\n`);
  process.stdout.write(
    `\nTHE FITTED VECTOR\n${formatGateReading(gateReading(reach, baseline, weights, args.familyFloor))}\n`,
  );
  process.stdout.write(
    `\nweights ${names.map((name, index) => `${name} ${weights[index]!.toFixed(6)}`).join(', ')}\n`,
  );
}

main();
