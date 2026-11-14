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
  process.stdout.write(`THE CONFIGURATION, READ AS ONE VECTOR\n${formatGateReading(now)}\n`);
  // The dump's own top-1 is the run's own answer, and no vector reproduces it when a name in the fusion is a
  // DECISION: a gated term records 0 on every case it was refused, so `max` (the configuration) applies it
  // everywhere and `first` applies it nowhere, and the run is neither. Printing the three numbers together is the
  // only way a reader can see which of them a `Δw = 0` row is really against.
  const recorded = cases.filter((kase) => {
    const winner = kase.candidates[0];
    return winner !== undefined && kase.accepted.includes(winner.id);
  }).length;
  const zero = countUnder(reach, new Float64Array(names.length));
  process.stdout.write(
    `\nthe dump's own top-1 answers ${recorded} of ${cases.length} — that is the run, and no vector equals it while a gated name is in the fusion\n`,
  );
  process.stdout.write(
    `the zero vector answers ${zero.answers} strictly and ${zero.optimistic} optimistically: with every score level the stable sort keeps the dump's order, so it reproduces the run's answers by ranking nothing\n`,
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
