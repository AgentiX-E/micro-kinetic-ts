/**
 * `run-agentic-headroom` — score the elimination layer's ceiling and its deterministic arm, offline.
 *
 * Two inputs, both written by a benchmark run: the per-case fingerprint dump (`--fingerprint-out`) and the
 * per-case verdict file (`--per-case-out`). The join is refused when the two disagree about a case's ordering,
 * because that means the files came from different runs and any number computed from them would describe a
 * configuration neither run had.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-agentic-headroom.ts \
 *     --fingerprints <ndjson> --verdicts <ndjson> [--weight W] [--split all|in|out]
 *
 * Output is a table per population (whole corpus, then the in-sample half and the best point re-read on the
 * held-out half), the refusal tally by reason, and the skip rule's census.
 *
 * @module benchmarks/run-agentic-headroom
 */

import { readFingerprintFile } from './agentic-fingerprint-file.js';
import {
  formatArmTable,
  formatGateCensus,
  formatRefusals,
  formatSkipCensus,
  formatSweep,
} from './agentic-headroom-report.js';
import {
  bestSweepPoint,
  gateCensus,
  joinHeadroom,
  scoreArm,
  sweepEvidence,
  takeSplit,
  type HeadroomCase,
} from './agentic-headroom.js';
import { readPerCaseVerdicts } from './fse26-per-case.js';

/** The thresholds swept on every population. */
const FLOORS = [0, 0.2, 0.33, 0.5, 0.67, 0.8] as const;
const MARGINS = [0, 0.1, 0.25] as const;

/** Parsed arguments. */
interface Args {
  fingerprints: string;
  verdicts: string;
  weight: number;
  thresholds: { floor: number; margin: number } | undefined;
}

/**
 * Parse the arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 * @throws Error on an unknown flag or a missing value, so a typo cannot run a different study.
 */
export function parseHeadroomArgs(argv: readonly string[]): Args {
  const args: Args = { fingerprints: '', verdicts: '', weight: 1, thresholds: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--fingerprints') args.fingerprints = value;
    else if (arg === '--verdicts') args.verdicts = value;
    else if (arg === '--weight') args.weight = Number(value);
    else if (arg === '--floor') {
      args.thresholds = { floor: Number(value), margin: args.thresholds?.margin ?? 0 };
    } else if (arg === '--margin') {
      args.thresholds = { floor: args.thresholds?.floor ?? 0, margin: Number(value) };
    } else throw new Error(`unrecognised argument ${arg}`);
    index += 1;
  }
  if (args.fingerprints === '' || args.verdicts === '') {
    throw new Error('--fingerprints and --verdicts are both required');
  }
  return args;
}

/** The three arms a population is reported with. */
function outcomesFor(
  cases: readonly HeadroomCase[],
  weight: number,
  evidence: { rateFloor: number; margin: number },
) {
  return [
    scoreArm(cases, { arm: 'engine', weight: 0, useSkipRule: false }),
    // The ceiling reads the label and does NOT run under the skip rule: the rule bounds what a METHOD is allowed
    // to spend, and a ceiling that respected it would report a bound on the method rather than on the population.
    scoreArm(cases, { arm: 'oracle', weight, useSkipRule: false }),
    scoreArm(cases, { arm: 'evidence', weight, useSkipRule: false, thresholds: evidence }),
  ];
}

function main(): void {
  const args = parseHeadroomArgs(process.argv.slice(2));
  const join = joinHeadroom(
    readFingerprintFile(args.fingerprints),
    readPerCaseVerdicts(args.verdicts),
  );

  console.log('Micro-Kinetic — elimination headroom');
  console.log('═'.repeat(78));
  console.log(`Fingerprints: ${args.fingerprints}`);
  console.log(`Verdicts:     ${args.verdicts}`);
  console.log(`Paired:       ${join.cases.length} cases`);
  if (join.unpairedFingerprints.length > 0) {
    console.log(
      `UNPAIRED fingerprints: ${join.unpairedFingerprints.length} (first: ${join.unpairedFingerprints[0]})`,
    );
  }
  if (join.unpairedVerdicts.length > 0) {
    console.log(
      `UNPAIRED verdicts:     ${join.unpairedVerdicts.length} (first: ${join.unpairedVerdicts[0]})`,
    );
  }
  if (join.disagreements.length > 0) {
    // A dump and a verdict file from different runs would produce a number for a configuration neither ran.
    console.log(
      `DISAGREEMENTS:         ${join.disagreements.length} (first: ${join.disagreements[0]})`,
    );
    console.log('Refusing to score: the two artifacts are not from the same run.');
    process.exitCode = 1;
    return;
  }

  const thresholds = args.thresholds ?? { floor: 0, margin: 0 };
  const evidence = { rateFloor: thresholds.floor, margin: thresholds.margin };

  console.log('');
  console.log(`All ${join.cases.length} paired cases, weight=${args.weight}`);
  const all = outcomesFor(join.cases, args.weight, evidence);
  console.log(formatArmTable(all));
  console.log(formatSkipCensus(all[0]!));
  for (const outcome of all)
    console.log(`${outcome.arm.padEnd(9)} refusals: ${formatRefusals(outcome)}`);

  console.log('');
  console.log('Skip rule grid: what resolving a case without a model costs');
  console.log(
    formatGateCensus(
      gateCensus(join.cases, {
        margins: [0.05, 0.1, 0.25, 0.5, 1],
        decisiveChannels: [3, 4, 5, 6, 8],
      }),
    ),
  );

  const inSample = takeSplit(join.cases, 'in');
  const outOfSample = takeSplit(join.cases, 'out');
  console.log('');
  console.log(
    `Threshold sweep on the in-sample half (${inSample.length} cases), weight=${args.weight}`,
  );
  const points = sweepEvidence(inSample, {
    floors: FLOORS,
    margins: MARGINS,
    weight: args.weight,
    useSkipRule: false,
  });
  const best = bestSweepPoint(points);
  console.log(formatSweep(points, best));
  if (best === undefined) return;

  console.log('');
  console.log(`Best in-sample point re-read on the held-out half (${outOfSample.length} cases)`);
  console.log(
    formatArmTable(
      outcomesFor(outOfSample, args.weight, { rateFloor: best.rateFloor, margin: best.margin }),
    ),
  );
  console.log(
    `best point: floor=${best.rateFloor} margin=${best.margin} — ` +
      `in-sample ${(best.outcome.top1 * 100).toFixed(1)}%, ` +
      `held-out ${(
        scoreArm(outOfSample, {
          arm: 'evidence',
          weight: args.weight,
          useSkipRule: false,
          thresholds: { rateFloor: best.rateFloor, margin: best.margin },
        }).top1 * 100
      ).toFixed(1)}%`,
  );
}

main();
