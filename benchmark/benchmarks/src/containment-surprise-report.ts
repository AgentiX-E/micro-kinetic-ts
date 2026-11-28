/**
 * The H7 report: three walks of one chain, and the census that says which silence the second measurement breaks.
 *
 * Laid out on the gate's and the term's reports rather than invented again: the instrument first (`replayable`,
 * `unmeasurable`, `disagreements`), then the population, then the three arms, then the two censuses, then the
 * verdict. A reader who has read either of the other two reports can read this one.
 *
 * The `opened` line is the reason this report exists. The arm REPLACES the latency measurement, so its Top@1 is
 * expected to lose the cases the shipped pass fixed — that number alone would say "worse" and stop. What the
 * census adds is the population the latency family could not see at all: pairs the surprise map inverted that the
 * shipped walk refused, tallied under the reason it refused them. `unmeasured` and `not-larger` are the two
 * silences §289 names, and a union is only worth building if they are not empty.
 *
 * @module benchmarks/containment-surprise-report
 */

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

import { STANDING_CRITERION, type GateCriterion } from './containment-gate.js';
import type { SurpriseReading, SurpriseVerdict } from './containment-surprise-study.js';

/** The reasons, in the order the report prints them. */
const REASONS: readonly ContainmentDecision[] = [
  'inverted',
  'no-failed-interface',
  'unmeasured',
  'callee-in-band',
  'not-larger',
  'excursion-licensed',
  'prior-absent',
  'prior-below',
];

/** What the command line accepts. */
export interface SurpriseArgs {
  readonly rows: string;
  readonly perCase: string;
  readonly output?: string;
}

/**
 * Parse the command line.
 *
 * A token that matches no branch is refused rather than ignored, for the reason both other parsers in this
 * directory record: a mistyped `--row` would leave the required input unset and the run would read whatever the
 * default happened to be.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseSurpriseArgs(argv: readonly string[]): SurpriseArgs {
  let rows = '';
  let perCase = '';
  let output: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--rows') rows = argv[++i] ?? '';
    else if (arg === '--per-case') perCase = argv[++i] ?? '';
    else if (arg === '--output') output = argv[++i] ?? '';
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (rows === '') throw new Error('--rows is required');
  if (perCase === '') throw new Error('--per-case is required');
  return { rows, perCase, ...(output === undefined ? {} : { output }) };
}

/** `+4/-0` for one arm, in the layout the other two reports use. */
function armLine(name: string, arm: { top1: number; gains: number; losses: number }): string {
  const delta = arm.gains === 0 && arm.losses === 0 ? '' : ` +${arm.gains}/-${arm.losses}`;
  return `  arm=${name.padEnd(9)} top1=${arm.top1}${delta}`;
}

/**
 * The reading as report lines.
 *
 * @param reading - What the study measured.
 * @param criterion - The bar the verdict is read against.
 * @returns One line per fact.
 */
export function formatSurpriseReading(
  reading: SurpriseReading,
  criterion: GateCriterion = STANDING_CRITERION,
): string[] {
  const lines = [
    `  rows=${reading.cases} replayable=${reading.replayable} unmeasurable=${reading.unmeasurable} disagreements=${reading.disagreements} scored=${reading.scored}`,
    `  moved=${reading.moved} (the surprise map changes the published head)  sigma=${reading.sigma}`,
    armLine('fusion', reading.arms.fusion),
    armLine('shipped', reading.arms.shipped),
    armLine('surprise', reading.arms.surprise),
    `  decisions ${REASONS.map((reason) => `${reason}=${reading.decisions[reason]}`).join(' ')}`,
    `  opened    ${REASONS.map((reason) => `${reason}=${reading.opened[reason]}`).join(' ')}`,
    `  criterion: gains>=${criterion.gains} losses<=${criterion.losses} top1>${criterion.shippedTop1}`,
  ];
  return lines;
}

/**
 * The verdict as one line, in the layout `H6-term:` and the gate's own line use.
 *
 * @param verdict - The verdict the study returned.
 * @param reason - Its sentence.
 * @returns The line.
 */
export function formatSurpriseVerdict(verdict: SurpriseVerdict, reason: string): string {
  return `  H7-surprise: ${verdict.toUpperCase()} — ${reason}`;
}
