/**
 * The containment-residual report's pure half: argument parsing and the lines a dispatch reads.
 *
 * Separated from the program for the reason `fse26-report.ts` is separated from `run-fse26.ts`: the program
 * calls `main()` on import and cannot be called from a test, and the two functions here are exactly the ones a
 * test can check — a flag that is accepted and ignored, or a verdict line that prints `0.5` where the population
 * supported nothing, are the two failures this file exists to make impossible.
 *
 * @module benchmarks/containment-residual-report
 */

import { DISCRIMINATION_BAR, verdictOf, type Discrimination } from './containment-residual.js';

/** The flags the residual report accepts. */
export interface ResidualArgs {
  /** The containment-row ndjson written by `run-fse26.ts --containment-out`. */
  readonly rows: string;
  /** The run's per-case verdict ndjson, joined on `datapack` for the accepted answers. */
  readonly perCase: string;
  /** Where to write the JSON result (empty = the log only). */
  readonly output: string;
}

/**
 * Read `--flag value` pairs, refusing an unknown flag.
 *
 * Unknown flags are REFUSED rather than ignored: a dispatch that spelled `--percase` would otherwise run with an
 * empty join and report a population of zero, which reads as "no case could be labelled" rather than as a typo.
 *
 * @param argv - The argument list.
 * @returns The parsed options.
 * @throws Error when a flag is unknown or a required one is missing.
 */
export function parseResidualArgs(argv: readonly string[]): ResidualArgs {
  let rows = '';
  let perCase = '';
  let output = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--rows' && i + 1 < argv.length) rows = argv[++i]!;
    else if (arg === '--per-case' && i + 1 < argv.length) perCase = argv[++i]!;
    else if (arg === '--output' && i + 1 < argv.length) output = argv[++i]!;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (rows === '') throw new Error('--rows is required');
  if (perCase === '') throw new Error('--per-case is required');
  return { rows, perCase, output };
}

/**
 * Format one arm's discrimination as the lines a dispatch reads.
 *
 * The census is printed BESIDE the number rather than under it, because the two refusals it separates are
 * different findings: `ambiguous` is an attribution rule that could not name the pair, while `scored` below
 * `gains + losses` is a corpus too thin to estimate the residual on. A reader who saw only the AUC could not tell
 * a weak instrument from a thin corpus.
 *
 * @param discrimination - The arm's result.
 * @returns The lines, in reading order.
 */
export function formatDiscrimination(discrimination: Discrimination): string[] {
  const { census } = discrimination;
  const verdict = verdictOf(discrimination);
  const lines = [
    `  arm=${discrimination.arm} score=${discrimination.score} ` +
      `gains=${census.gains} losses=${census.losses} ` +
      `unchanged=${census.unchanged} unanswered=${census.unanswered} ambiguous=${census.ambiguous}`,
    `  arm=${discrimination.arm} score=${discrimination.score} scored: ` +
      `gains=${census.scoredGains} losses=${census.scoredLosses}`,
  ];
  if (discrimination.auc === null) {
    lines.push(
      `  arm=${discrimination.arm} score=${discrimination.score} AUC=N/A ` +
        `(${discrimination.unavailable ?? 'population unavailable'})`,
    );
  } else {
    lines.push(
      `  arm=${discrimination.arm} score=${discrimination.score} AUC=${discrimination.auc.toFixed(4)} ` +
        `bar=${DISCRIMINATION_BAR} -> ${verdict.toUpperCase()}`,
    );
  }
  return lines;
}
