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
import { crossValidateRouter, priorFloor, ROUTER_SIGNALS } from './router-validation.js';

/** Folds for the held-out estimate. 5 keeps each RE3 fold at 18 cases, which is thin — and the spread says so. */
export const VALIDATION_FOLDS = 5;

/** The signal names, in a fixed order so two runs print the same table. */
export const VALIDATION_SIGNALS = Object.keys(
  ROUTER_SIGNALS,
).sort() as (keyof typeof ROUTER_SIGNALS)[];

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

  // ── the frontier, in sample and held out ──
  lines.push(
    `\n  THE FRONTIER (${folds}-fold; "held out" fits the threshold on ${folds - 1} folds and scores the ${folds}th)`,
    `    ${'signal'.padEnd(14)} ${'baseline'.padStart(9)} ${'in-sample'.padStart(10)} ` +
      `${'held out'.padStart(9)} ${'held gain'.padStart(10)} ${'fitting'.padStart(9)}`,
  );
  for (const signal of VALIDATION_SIGNALS) {
    const cv = crossValidateRouter(cases, signal, folds);
    lines.push(
      `    ${signal.padEnd(14)} ${pct(cv.baseline).padStart(9)} ${pct(cv.inSample).padStart(10)} ` +
        `${pct(cv.heldOut).padStart(9)} ${pp(cv.heldOutGain).padStart(10)} ` +
        `${pp(cv.fittingAllowance).padStart(9)}`,
    );
  }
  lines.push(
    '    "fitting" = in-sample minus held-out: how much larger the whole-set optimum is than the fold',
    '    mean. Its SIGN is not guaranteed -- a fold can score above the whole-set optimum -- so read it as',
    '    a magnitude, and read "held gain" as the estimate.',
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
 * Run only when this file IS the entry point.
 *
 * A bare top-level call would make the module unimportable by a test — the formatter would then be exercised only
 * by running a process, which is how it came to be 70% covered in the first place.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
