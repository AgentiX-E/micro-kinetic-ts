/**
 * The containment gate's pure half: argument parsing and the lines a dispatch reads.
 *
 * Separated from the program for the reason `containment-residual-report.ts` records: the program calls `main()`
 * on import and cannot be called from a test, and the two functions here are what a test can hold — a flag
 * accepted and ignored, or a table that prints an arm's Top@1 without the population it was counted over, are
 * the failures this file exists to make impossible.
 *
 * @module benchmarks/containment-gate-report
 */

import {
  STANDING_CRITERION,
  compareEdgeKeys,
  gateBar,
  type GateCriterion,
  type GateReading,
} from './containment-gate.js';
import { MIN_POPULATION, type ResidualScore } from './containment-residual.js';

/** The flags the gate report accepts. */
export interface GateArgs {
  /** The containment-row ndjson written by `run-fse26.ts --containment-out`. */
  readonly rows: string;
  /** The run's per-case verdict ndjson, joined on `datapack` for the accepted answers. */
  readonly perCase: string;
  /** Which statistic the prior is fitted from. */
  readonly score: ResidualScore;
  /** Where to write the JSON result (empty = the log only). */
  readonly output: string;
}

/**
 * Read `--flag value` pairs, refusing an unknown flag and an unknown statistic.
 *
 * @param argv - The argument list.
 * @returns The parsed options.
 * @throws Error when a flag is unknown, a value is not a statistic, or a required flag is missing.
 */
export function parseGateArgs(argv: readonly string[]): GateArgs {
  let rows = '';
  let perCase = '';
  let score: ResidualScore = 'rho';
  let output = '';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--rows' && i + 1 < argv.length) rows = argv[++i]!;
    else if (arg === '--per-case' && i + 1 < argv.length) perCase = argv[++i]!;
    else if (arg === '--score' && i + 1 < argv.length) {
      const value = argv[++i]!;
      // Refused rather than defaulted: a dispatch that misspelled `phi` would silently read the pre-registered
      // statistic twice and report the φ row as a second ρ, which looks like agreement.
      if (value !== 'rho' && value !== 'phi') {
        throw new Error(`--score must be rho or phi, got ${JSON.stringify(value)}`);
      }
      score = value;
    } else if (arg === '--output' && i + 1 < argv.length) output = argv[++i]!;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (rows === '') throw new Error('--rows is required');
  if (perCase === '') throw new Error('--per-case is required');
  return { rows, perCase, score, output };
}

/**
 * Format the gate's reading as the lines a dispatch reads.
 *
 * Three blocks, in the order a reader needs them: whether the artifact could be walked at all, what the two
 * priors were fitted from, and what the three arms answered. The reconstruction row is printed FIRST among the
 * arms because it is the instrument check — the shipped arm's replay must reproduce the recorded number, and if
 * it does not, the two rows under it are describing a walk the run did not take.
 *
 * @param reading - The gate's reading.
 * @param criterion - The gate the reading is judged against, printed so the numbers travel with their bar.
 * @returns The lines, in reading order.
 */
export function formatGateReading(
  reading: GateReading,
  criterion: GateCriterion = STANDING_CRITERION,
): string[] {
  // The scope census is printed BESIDE the disagreement count, because the two answer one question: a mismatch
  // on a dump that states no scope is a missing word, not a broken chain (`docs/gate-replay.md` §8).
  const census = Object.entries(reading.scopes)
    .sort(([left], [right]) => compareEdgeKeys(left, right))
    .map(([scope, count]) => `${scope}=${count}`)
    .join(' ');
  // The POPULATION census goes on the same line as the scope's, because it is the same kind of statement: a pair
  // population is what ρ is fitted over, and a file that states two of them is two populations rather than one. A
  // row names its population by a width (`5`) or by the rule `pool`, so the token is printed as it was read.
  const widths = Object.entries(reading.depths)
    .sort(([left], [right]) => compareEdgeKeys(left, right))
    .map(([depth, count]) => `${depth}=${count}`)
    .join(' ');
  const lines = [
    `  rows=${reading.cases} replayable=${reading.replayable} scored=${reading.scored} ` +
      `disagreements=${reading.disagreements} scopes: ${census === '' ? 'none' : census} ` +
      `depths: ${widths === '' ? 'none' : widths}`,
  ];
  for (const prior of reading.priors) {
    lines.push(
      `  prior fitted-on=${prior.fittedOn} applies-to=${prior.appliesTo} score=${prior.score} ` +
        `edges=${prior.edges} fitted=${prior.fitted} admitted=${prior.admitted} ` +
        `unfitted=${prior.unfitted} observations=${prior.observations} ` +
        `(floor n>=${MIN_POPULATION})`,
    );
  }
  for (const [name, arm] of [
    ['fusion', reading.arms.fusion],
    ['shipped', reading.arms.shipped],
    ['prior', reading.arms.prior],
  ] as const) {
    // The baseline's own ± is not printed as a movement: it IS the movement's origin, and a `+0 / −0` beside
    // the other two rows would read as a third arm that achieved nothing.
    const movement = name === 'fusion' ? '' : ` +${arm.gains}/-${arm.losses}`;
    lines.push(`  arm=${name} top1=${arm.top1}/${reading.scored}${movement}`);
  }
  lines.push(
    `  gate decisions: inverted=${reading.decisions.inverted} ` +
      `prior-absent=${reading.decisions['prior-absent']} prior-below=${reading.decisions['prior-below']} ` +
      `not-larger=${reading.decisions['not-larger']} unmeasured=${reading.decisions.unmeasured}`,
  );
  // The criterion is printed before the verdict is, so a reader never has to hold the numbers against a bar
  // quoted somewhere else — the same reason `formatDiscrimination` prints `bar=`.
  const bar = gateBar(reading, criterion);
  lines.push(
    `  criterion: gains>=${bar.gains} losses<=${bar.losses} top1>${bar.shippedTop1}` +
      (bar.shippedTop1 === criterion.shippedTop1
        ? ` (recorded)`
        : ` (raised from the recorded ${criterion.shippedTop1} to this corpus's own arm)`),
  );
  return lines;
}
