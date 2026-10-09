/**
 * Readback for the routing probe: the held-out gain, and the floor a telemetry-free ranker reaches.
 *
 * The probe writes one JSON per suite carrying every case's engine top-1/top-2 and PRISM top-1/top-2. That is
 * enough to answer both questions WITHOUT a new run:
 *
 * 1. **Is the frontier's gain real?** The probe's `bestZeroRegression` is fitted on all the cases it reports over,
 *    so it is an in-sample optimum. This re-fits on a train fold and scores on a disjoint test fold.
 * 2. **What is the floor the headline must clear?** `arXiv:2609.27069` records that this benchmark injects faults
 *    into only five services per system while telemetry exposes 12 to 70, so a ranker reading no telemetry is a
 *    serious baseline: its own published figure is `Avg@5` 0.488 against 0.137 for uniform-random. This measures
 *    the analogous quantity for service Top-1 on our corpus, held out.
 *
 * The report is built by {@link formatSuiteValidation} — a pure function returning lines — so that every arm of it
 * is testable without invoking a process. The CLI below is argv wiring and nothing else; a formatter that could
 * only be exercised by running it is a formatter nobody checks.
 *
 * Usage:
 *
 * ```sh
 * pnpm exec tsx benchmarks/src/validate-routing-frontier.ts [--folds N] <routing-probe.json> [...]
 * ```
 *
 * @module benchmarks/validate-routing-frontier
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import type { RoutingCase } from './router-validation.js';
import {
  accuracy,
  alwaysEngine,
  crossValidateRouter,
  FIT_CONSTRAINTS,
  priorFloor,
  ROUTER_SIGNALS,
} from './router-validation.js';

/** Folds for the held-out estimate. 5 keeps each RE3 fold at 18 cases, which is thin — and the spread says so. */
export const VALIDATION_FOLDS = 5;

/** The signal names, in a fixed order so two runs print the same table. */
export const VALIDATION_SIGNALS = Object.keys(
  ROUTER_SIGNALS,
).sort() as (keyof typeof ROUTER_SIGNALS)[];

/**
 * The criteria, in a fixed order and printed for EVERY signal.
 *
 * Both are reported side by side rather than one being selected, because the difference between them is the
 * finding: a gain that exists only under the weaker rule is a gain the probe's own frontier would not have
 * admitted, and a reader who saw only one column could not tell which they were looking at.
 */
export const VALIDATION_CONSTRAINTS = Object.keys(
  FIT_CONSTRAINTS,
).sort() as (keyof typeof FIT_CONSTRAINTS)[];

const pct = (x: number): string => `${(x * 100).toFixed(2)}%`;
const pp = (x: number): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}pp`;

/**
 * The whole report for one suite, as lines.
 *
 * @param suite - The suite's name, as the probe recorded it.
 * @param cases - The probe's per-case records.
 * @param folds - How many folds to hold out.
 * @returns The report, one line per entry, and one line for the arm where there is nothing to validate.
 */
export function formatSuiteValidation(
  suite: string,
  cases: readonly RoutingCase[],
  folds: number = VALIDATION_FOLDS,
): string[] {
  const lines = [`\n${'='.repeat(78)}`, `${suite}  —  ${cases.length} cases recorded by the probe`];

  if (cases.length === 0) {
    // An empty artifact is a fact about the run, and printing a zero would read as a measurement.
    lines.push('  no records: nothing to validate, and saying so beats printing a zero.');
    return lines;
  }

  // ── the floor, before the frontier: a number the frontier has to be read against ──
  const floor = priorFloor(cases, folds);
  lines.push(
    `\n  THE FLOOR a ranker that reads NO telemetry reaches (held out, ${folds} folds)`,
    `    distinct culprits in the population : ${floor.truths}`,
    `    most frequent culprit, in sample    : ${pct(floor.inSample)}   <- optimistic`,
    `    most frequent culprit, HELD OUT     : ${pct(floor.heldOut)}   <- the honest floor`,
    `    uniform over those culprits         : ${pct(floor.uniform)}   <- the weaker floor`,
    `    folds chose: ${floor.perFoldWinners.join(', ')}`,
  );

  // ── the frontier, in sample and held out, under BOTH criteria ──
  lines.push(
    `\n  THE FRONTIER (${folds}-fold; "held out" fits the threshold on ${folds - 1} folds and scores the ${folds}th)`,
    `    baseline (always-engine) = ${pct(accuracy(cases, alwaysEngine(VALIDATION_SIGNALS[0]!)))}`,
    `    ${'signal'.padEnd(14)} ${'criterion'.padEnd(16)} ${'in-sample'.padStart(10)} ` +
      `${'held out'.padStart(9)} ${'held gain'.padStart(10)} ${'fitting'.padStart(9)} ${'regr'.padStart(5)}`,
  );
  // The best arm under the criterion a router has to survive, tracked as the rows are printed so the decision line
  // below cannot disagree with the table above it.
  let bestDeployable: { signal: string; gain: number } | null = null;
  for (const signal of VALIDATION_SIGNALS) {
    for (const constraint of VALIDATION_CONSTRAINTS) {
      const cv = crossValidateRouter(cases, signal, folds, constraint);
      lines.push(
        `    ${signal.padEnd(14)} ${constraint.padEnd(16)} ${pct(cv.inSample).padStart(10)} ` +
          `${pct(cv.heldOut).padStart(9)} ${pp(cv.heldOutGain).padStart(10)} ` +
          `${pp(cv.fittingAllowance).padStart(9)} ${String(cv.regressedUnitsHeldOut).padStart(5)}`,
      );
      if (
        constraint === 'zero-regression' &&
        cv.heldOutGain > 0 &&
        (bestDeployable === null || cv.heldOutGain > bestDeployable.gain)
      ) {
        bestDeployable = { signal, gain: cv.heldOutGain };
      }
    }
  }
  lines.push(
    '    regr = (fold, unit) pairs scored below the always-engine baseline ON THAT FOLD. A unit is a',
    '    (system x fault-type) pair, so this counts PAIRS and not distinct cells; a count and not a rate,',
    '    because a percentage of units would read as an accuracy. It is above zero whenever a threshold',
    '    admissible on its train folds regressed a unit on the fold it was then scored on.',
    '    "fitting" = in-sample minus held-out: how much larger the whole-set optimum is than the fold',
    '    mean. Its SIGN is not guaranteed -- a fold can score above the whole-set optimum -- so read it as',
    '    a magnitude, and read "held gain" as the estimate.',
  );
  // ── the decision, which is the zero-regression arm and not the largest number in the table ──
  lines.push(
    bestDeployable === null
      ? '\n  DEPLOYABLE READ: no zero-regression arm scored above the baseline on this suite.'
      : `\n  DEPLOYABLE READ: the best zero-regression arm is ${bestDeployable.signal} at ` +
          `${pp(bestDeployable.gain)} held out. The larger figures above are unconstrained optima.`,
  );
  return lines;
}

/** Read one probe artifact and report it. Split out so the CLI below stays argv wiring. */
export function reportFile(path: string, folds: number = VALIDATION_FOLDS): string[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { suite?: string; records?: RoutingCase[] };
  return formatSuiteValidation(raw.suite ?? path, raw.records ?? [], folds);
}

/**
 * The CLI: parse `--folds N`, then report each path.
 *
 * @param argv - Arguments after the script name.
 * @returns The process exit code: 0 reported, 2 usage.
 */
export function main(argv: readonly string[]): number {
  let folds = VALIDATION_FOLDS;
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--folds') {
      const raw = argv[++i];
      const value = Number(raw);
      if (raw === undefined || !Number.isInteger(value) || value < 2) {
        console.error(`--folds must be an integer >= 2, got ${String(raw)}`);
        return 2;
      }
      folds = value;
    } else if (!argv[i]!.startsWith('-')) {
      paths.push(argv[i]!);
    }
  }
  if (paths.length === 0) {
    console.error(
      'usage: tsx benchmarks/src/validate-routing-frontier.ts [--folds N] <routing-probe.json> [...]',
    );
    return 2;
  }
  for (const path of paths) for (const line of reportFile(path, folds)) console.log(line);
  return 0;
}

/**
 * Whether this module is the process's entry point, as a pure predicate.
 *
 * Extracted so the decision is testable rather than sitting in a top-level `if` whose body no import can reach:
 * the guard exists precisely so a test CAN import this file, which leaves its own condition as the only statement
 * in the module that only a spawned process executes. A predicate a test can call with a fabricated `argv[1]`
 * removes two of those three uncovered branches, and the one that remains is the `process.exit` itself.
 *
 * @param argv1 - `process.argv[1]`, or `undefined` when the process was started without a script.
 * @param moduleUrl - `import.meta.url` of the module asking.
 * @returns `true` only when `argv1` names this exact file.
 */
export function isEntryPoint(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && moduleUrl === pathToFileURL(argv1).href;
}

/** Run only when this file IS the entry point. */
if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
