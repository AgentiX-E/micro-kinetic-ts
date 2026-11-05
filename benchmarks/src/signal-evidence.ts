/**
 * The per-case comparisons the failure block prints, and whether each one can move the ranking.
 *
 * ## The defect this module exists for
 *
 * `printFailureDiagnostics` prints six per-case comparisons for a failing case — `onset`, `injectDelay`,
 * `ratioContrib`, `topoSource`, `logScore` and the trace-activity triple. Each enters the score as
 * `weight × signal`, and on the published cells **four of the six weights are zero**:
 *
 * ```
 * signals: ... collisionWeight=0 topoWeight=0 ... traceWeight=1 ... temporalWeight=0 ...
 * ```
 *
 * So `onset`, `injectDelay`, `ratioContrib` and `topoSource` are printed, differ between the truth and the
 * winner, and **cannot change the order of the ranking above them**. Nothing on the line said so. On a bare
 * dispatch it is five of six, because `traceWeight` also ships at zero and only the RE3 step pins it to 1.
 *
 * The reading that produced this module was made twice, by the author of it: a failure block whose winner
 * sat at `topoSource=1.000` against the truth's `0.640` was read as "the source credit is what separates
 * them" and became a pre-registered arm — for a term at weight zero. Measured afterwards, the arm moves the
 * blocking cell the WRONG way (`63.3 → 60.0 → 46.7` at `topoWeight` 0.1 and 0.3), which is what a signal
 * that is not in the score can do when it is finally put in one.
 *
 * A number printed without the weight that reads it is not evidence: it is a description of a mechanism
 * the run may not be using. The label is the fix, for the reason `docs/accuracy-aggregation.md` §8 gives
 * about a percentage — **a quantity cannot assert its own unit**.
 *
 * @module benchmarks/signal-evidence
 */

import type { CliOptions } from './rcaeval-cli.js';

/**
 * Every per-case comparison the failure block prints.
 *
 * Exhaustive by construction: the printer must name each member through {@link formatInertSuffix}, and
 * `signal-evidence.test.ts` reads `run-rcaeval.ts` to check that it does — a member added here without a
 * printed line (or a line added without a member) fails that test rather than shipping an unlabelled
 * comparison.
 */
export type PrintedSignal =
  'onset' | 'injectDelay' | 'ratioContrib' | 'topoSource' | 'logScore' | 'traceActivity';

/** Every member of {@link PrintedSignal}, in the order the failure block prints them. */
export const PRINTED_SIGNALS: readonly PrintedSignal[] = [
  'onset',
  'injectDelay',
  'ratioContrib',
  'topoSource',
  'logScore',
  'traceActivity',
];

/**
 * The weights the printed comparisons are read by.
 *
 * A `Pick` of the runner's options rather than a bag of numbers: the caller has to hand over the object it
 * built the engine from, so the annotation cannot describe a configuration the run did not use.
 */
export type PrintedSignalWeights = Pick<
  CliOptions,
  'temporalWeight' | 'collisionWeight' | 'topoWeight' | 'logWeight' | 'traceWeight'
>;

/** How one printed comparison is read. */
export interface PrintedSignalEvidence {
  readonly signal: PrintedSignal;
  /** The `finalScore` term the comparison enters, written as `pruner.ts` documents it. */
  readonly term: string;
  /** The option field the weight is read from, so the notice names the field a reader can change. */
  readonly weightName: keyof PrintedSignalWeights;
  /** The weight that term is multiplied by. */
  readonly weight: number;
  /** `weight === 0`, i.e. the comparison is printed and cannot move the ranking. */
  readonly inert: boolean;
}

/**
 * The term each comparison enters, and the option field that weights it.
 *
 * The `term` strings are the engine's own `finalScore` lines, quoted VERBATIM from
 * `packages/tree/src/pruning/pruner.ts` — including the `×` and `−=` characters — rather than paraphrased: a
 * reader who follows one to the engine has to arrive at the arithmetic, not at a sentence about it.
 *
 * `signal-evidence.test.ts` reads that file and asserts every string below still appears in it, so a formula
 * that changes in the engine cannot leave a stale quotation in the artifact. A paraphrase would have been
 * free to rot; a quotation is a fixture.
 */
const READINGS: readonly {
  readonly signal: PrintedSignal;
  readonly term: string;
  readonly weightName: keyof PrintedSignalWeights;
}[] = [
  {
    signal: 'onset',
    term: 'finalScore(v) = log1p(selfAnomaly(v)) + temporalWeight × slope(v)',
    weightName: 'temporalWeight',
  },
  {
    // The delay is the temporal term's INPUT, not a term of its own: it becomes `slope(v)`. It is a separate
    // printed comparison because `onset` reads the series' own first departure while this one is anchored to
    // `inject_time`, and a reader needs both to tell a late truth from an unreachable one.
    signal: 'injectDelay',
    term: 'finalScore(v) = log1p(selfAnomaly(v)) + temporalWeight × slope(v)',
    weightName: 'temporalWeight',
  },
  {
    signal: 'ratioContrib',
    term: 'finalScore(v) −= collisionWeight × ratioContrib(v)',
    weightName: 'collisionWeight',
  },
  {
    signal: 'topoSource',
    term: 'finalScore(v) += topoWeight × topoSource(v)',
    weightName: 'topoWeight',
  },
  {
    signal: 'logScore',
    term: 'finalScore(v) += logWeight × logScore(v)',
    weightName: 'logWeight',
  },
  {
    signal: 'traceActivity',
    term: 'finalScore(v) += traceWeight × traceActivity(v)',
    weightName: 'traceWeight',
  },
];

/**
 * Every printed comparison with the weight that reads it.
 *
 * @param weights - The weights the run was dispatched with.
 * @returns One entry per member of {@link PRINTED_SIGNALS}, in print order.
 */
export function printedSignalEvidence(
  weights: PrintedSignalWeights,
): readonly PrintedSignalEvidence[] {
  return READINGS.map((reading) => {
    const weight = weights[reading.weightName];
    return {
      signal: reading.signal,
      term: reading.term,
      weightName: reading.weightName,
      weight,
      inert: weight === 0,
    };
  });
}

/**
 * The printed comparisons that cannot move this run's ranking.
 *
 * @param weights - The weights the run was dispatched with.
 * @returns The inert members, in print order. Empty when every printed comparison is weighted.
 */
export function inertPrintedSignals(weights: PrintedSignalWeights): readonly PrintedSignal[] {
  return printedSignalEvidence(weights)
    .filter((entry) => entry.inert)
    .map((entry) => entry.signal);
}

/**
 * The one line the failure block prints before its cases, or `undefined` when nothing is inert.
 *
 * `undefined` rather than an empty line, for the reason every other conditional line in this runner returns
 * it: a header that appears on every run says nothing, and a reader learns to skip it on exactly the runs
 * where it is load-bearing.
 *
 * @param weights - The weights the run was dispatched with.
 * @returns The notice, wrapped to the artifact's width, or `undefined`.
 */
export function formatInertSignalsNotice(weights: PrintedSignalWeights): string | undefined {
  const inert = printedSignalEvidence(weights).filter((entry) => entry.inert);
  if (inert.length === 0) return undefined;
  const named = inert
    .map((entry) => `${entry.signal} (${entry.weightName}=${entry.weight})`)
    .join(', ');
  return [
    '  INERT AT THESE WEIGHTS: ' + named,
    '    Printed because every case prints them. They cannot move the ranking below, so a diagnosis read',
    '    off one of them is a diagnosis of a mechanism this run did not use. The weights are on the',
    '    `signals:` line at the head of this artifact.',
  ].join('\n');
}

/**
 * The suffix a single printed comparison carries when its weight is zero.
 *
 * @param inert - The inert members, from {@link inertPrintedSignals}.
 * @param signal - The comparison the line prints.
 * @returns `'  [INERT: weight 0]'`, or the empty string when the comparison is weighted.
 */
export function formatInertSuffix(inert: readonly PrintedSignal[], signal: PrintedSignal): string {
  return inert.includes(signal) ? '  [INERT: weight 0]' : '';
}
