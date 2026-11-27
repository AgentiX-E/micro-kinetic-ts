/**
 * The H8 report: the interface record read at case scope, and the family's ceiling as a line of counts.
 *
 * Laid out on the gate's, the term's and the surprise's reports: the instrument first (`replayable`, `scored`,
 * `disagreements`, `record-free`), then the priors, then the three arms, then the census, then the ceiling, then
 * the verdict. A reader who has read any of the other three can read this one.
 *
 * Two lines are the reason it exists.
 *
 * `decisions` carries `record-silent` in its own column, and that column is the arm: it counts the pairs that were
 * inverted **because the case's record was silent throughout**, which is a population no shipped walk can produce
 * and the only population this arm adds. Its complement, `no-failed-interface`, then means what it always meant in
 * principle and never had to mean in practice — the record exists and this edge is not in it, so a call passed and
 * completed.
 *
 * `ceiling` is what keeps the whole axis honest. A sweep visits adjacent positions from the top and never revisits
 * one, so a candidate ascends exactly one place and only the pair at positions 0 and 1 can change the published
 * head. The cases any arm on this axis can fix are therefore countable before any arm is run, and every `top1`
 * above is spending against that number rather than against a percentage.
 *
 * @module benchmarks/containment-veto-report
 */

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

import { STANDING_CRITERION, type GateCriterion } from './containment-gate.js';
import type { VetoReading, VetoVerdict } from './containment-veto-study.js';

/** The reasons, in the order the report prints them. */
const REASONS: readonly ContainmentDecision[] = [
  'inverted',
  'record-silent',
  'no-failed-interface',
  'unmeasured',
  'callee-in-band',
  'not-larger',
  'prior-absent',
  'prior-below',
];

/** What the command line accepts. */
export interface VetoArgs {
  readonly rows: string;
  readonly perCase: string;
  readonly output?: string;
}

/**
 * Parse the command line.
 *
 * A token that matches no branch is refused rather than ignored, for the reason the other parsers in this
 * directory record: a mistyped `--row` would leave the required input unset and the run would read whatever the
 * default happened to be.
 *
 * @param argv - Arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseVetoArgs(argv: readonly string[]): VetoArgs {
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

/** `+4/-0` for one arm, in the layout the other three reports use. */
function armLine(name: string, arm: { top1: number; gains: number; losses: number }): string {
  const delta = arm.gains === 0 && arm.losses === 0 ? '' : ` +${arm.gains}/-${arm.losses}`;
  return `  arm=${name.padEnd(9)} top1=${arm.top1}${delta}`;
}

/**
 * One prior as a line.
 *
 * `admitted` is printed beside `fitted` because the two are the arm's price and its cost, in that order: a gate
 * that admits everything it fitted is selective only about half a corpus, and §299 established that reading one
 * number without the other makes the gate look narrow when it is mostly starved.
 *
 * @param prior - The fitted prior.
 * @returns The line.
 */
function priorLine(prior: VetoReading['priors'][number]): string {
  return `  prior fitted-on=${prior.fittedOn} applies-to=${prior.appliesTo} edges=${prior.edges} fitted=${prior.fitted} admitted=${prior.admitted} observations=${prior.observations}`;
}

/**
 * The reading as report lines.
 *
 * @param reading - What the study measured.
 * @param criterion - The bar the verdict is read against.
 * @returns One line per fact.
 */
export function formatVetoReading(
  reading: VetoReading,
  criterion: GateCriterion = STANDING_CRITERION,
): string[] {
  return [
    `  rows=${reading.cases} replayable=${reading.replayable} scored=${reading.scored} disagreements=${reading.disagreements} record-free=${reading.recordFree}`,
    ...reading.priors.map(priorLine),
    armLine('fusion', reading.arms.fusion),
    armLine('shipped', reading.arms.shipped),
    armLine('veto', reading.arms.veto),
    `  decisions ${REASONS.map((reason) => `${reason}=${reading.decisions[reason]}`).join(' ')}`,
    // The control's own census, printed first for the reason H7 prints `opened` beside `decisions`: a census with
    // nothing to compare it against is the state this axis was in for four iterations, and §301's `242` is what it
    // cost — a number about the shipped walk that no artifact could confirm or refuse.
    `  control   ${REASONS.map((reason) => `${reason}=${reading.control[reason]}`).join(' ')}`,
    `  ceiling at-second=${reading.ceiling.atSecond} reachable=${reading.ceiling.reachable} unreachable=${reading.ceiling.unreachable} shipped=${reading.ceiling.shipped} veto=${reading.ceiling.veto}`,
    `  criterion: gains>=${criterion.gains} losses<=${criterion.losses} top1>${criterion.shippedTop1}`,
  ];
}

/**
 * The verdict as one line, in the layout `H6-term:` and `H7-surprise:` use.
 *
 * @param verdict - The verdict the study returned.
 * @param reason - Its sentence.
 * @returns The line.
 */
export function formatVetoVerdict(verdict: VetoVerdict, reason: string): string {
  return `  H8-veto: ${verdict.toUpperCase()} — ${reason}`;
}
