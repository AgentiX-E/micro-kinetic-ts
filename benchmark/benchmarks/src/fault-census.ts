/**
 * The fault census: how the misses split across fault types, and how each type's misses split across the two
 * failures that need different owners.
 *
 * ## Why the accuracy table is the wrong unit
 *
 * Every roadmap decision in this campaign has been read off a nine-cell accuracy, and each cell is five fault types
 * averaged together. The types are not comparable populations: a `cpu` fault is a permanent resource shift whose
 * signature is a large, stable deviation at the injected service, while a `loss` fault is a fractional degradation
 * that shows up as a modest tail-latency rise at the injected service and a bigger one at its callers. Averaging
 * them means the number is moved by whichever type happens to be large, and it cannot say whether a change addressed
 * a defect or traded one population for another — the mistake `docs/closed-axes-register.md` records four times.
 *
 * ## The two failures, and why the split names an owner
 *
 * A miss is one of three things, and only two of them are ranking problems:
 *
 * - **blank** — the truth carried no breakdown at all. The ranking never surfaced it, so there is no measurement to
 *   compare and nothing to re-order. Its owner is candidate generation, not the formula.
 * - **outweighed** — the truth was ranked and its own evidence read LOWER than the candidate that beat it. No
 *   re-weighting of the terms the engine already has can repair this, because the quantity that lost the case is the
 *   one every term is multiplied by: a signal is needed that does not measure magnitude.
 * - **outvoted** — the truth was ranked, its own evidence read at least as high, and the case was still lost. That is
 *   a trade between signals, and the census names which signal made it.
 *
 * The split is computed on the BASE term rather than on the total, and the difference is the whole point: the total
 * contains the priors, so comparing totals would answer "did the priors decide it" with "yes" for every miss by
 * construction, and the axis would be a constant.
 *
 * ## The line says which pass it is
 *
 * Every RCAEval job runs each suite three times — the shipped protocol, a `--no-inject-time` pass, and the same pass
 * with `logSignalMode=novelty` — so one log holds three censuses of the same cases. They are not the same population:
 * see {@link FaultCensusAnchor}. The line therefore carries its anchor, and the parameter has no default.
 *
 * ## What the base term is, and why its name is written here
 *
 * `finalScore(v) = log1p(selfAnomaly(v)) + Σ signalWeight × signal(v)`: the first summand is the one contribution
 * that is a measurement of the candidate rather than a prior over the candidates, and the census is a statement about
 * whether the measurement was loud enough. The name is spelled out rather than imported because `benchmarks` copies
 * the producer's shapes instead of importing them (see `loss-census.ts` for the rule), and the mirror is kept honest
 * by the same fence: the ranking emits this name, and a rename would be visible as every miss turning `outvoted`.
 *
 * @module benchmarks/fault-census
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/**
 * The name the ranking gives its own base term — the only contribution that is a measurement of the candidate.
 *
 * Read by name rather than by position: the breakdown's order is the formula's, and a census that took `terms[0]`
 * would silently start reading a prior the first time the formula was reordered.
 */
export const BASE_TERM_NAME = 'selfAnomalyLog1p';

/**
 * The label a case with no fault type is counted under.
 *
 * A record without a label is still a case, and dropping it would make the totals disagree with the accuracy table
 * it sits beside. `unknown` is a fact about the artifact, and a non-zero count on it is a loader defect rather than
 * a fault type.
 */
export const UNKNOWN_FAULT = 'unknown';

/** How many blamed terms one type's entry prints. */
export const FAULT_BLAME_TOP = 3;

/** One fault type's tally. Mutable, because it is accumulated in place over a suite. */
export interface FaultTally {
  /** Cases of this type. */
  n: number;
  /** Cases of this type the engine answered correctly. */
  correct: number;
  /** Misses whose truth carried no breakdown: absent from the ranking rather than ranked low. */
  blank: number;
  /** Misses whose truth's base term read strictly lower than the winner's. */
  outweighed: number;
  /** Misses whose truth's base term read at least the winner's, and which were lost anyway. */
  outvoted: number;
  /** Among {@link outvoted}, how many cases each term favoured the winner on. */
  readonly blame: Map<string, number>;
}

/** The running totals, one per fault type. */
export interface FaultCensus {
  readonly byFault: Map<string, FaultTally>;
}

/** An empty census. */
export function createFaultCensus(): FaultCensus {
  return { byFault: new Map() };
}

/**
 * One candidate's base-term contribution, or `0` when it carries none.
 *
 * A candidate whose base term is absent read no evidence and paid nothing: for the comparison this is a zero, and
 * the presence question is a different one that `classifyTermZero` already answers.
 *
 * @param terms - The candidate's breakdown, or `undefined` when it has none.
 */
function baseOf(terms: readonly ScoreTerm[] | undefined): number {
  if (terms === undefined) return 0;
  let total = 0;
  for (const t of terms) {
    if (t.name === BASE_TERM_NAME) total += t.contribution;
  }
  return total;
}

/**
 * Fold one case into the census.
 *
 * @param census - The running totals.
 * @param prediction - One case's record, as the runner emits it.
 */
export function accumulateFaultCensus(census: FaultCensus, prediction: CasePrediction): void {
  const label = prediction.faultType ?? UNKNOWN_FAULT;
  let tally = census.byFault.get(label);
  if (tally === undefined) {
    tally = { n: 0, correct: 0, blank: 0, outweighed: 0, outvoted: 0, blame: new Map() };
    census.byFault.set(label, tally);
  }
  tally.n += 1;
  if (prediction.correct) {
    tally.correct += 1;
    return;
  }

  const truth = prediction.truthEvidence?.terms;
  if (truth === undefined || truth.length === 0) {
    tally.blank += 1;
    return;
  }

  const winner = prediction.top1Terms;
  if (baseOf(truth) < baseOf(winner)) {
    tally.outweighed += 1;
    return;
  }

  tally.outvoted += 1;
  // Only a term that paid the WINNER more than the truth can have made the difference. The base term can never
  // appear here: it is positive only when the winner's base is larger, which returned above.
  const winnerBy = new Map<string, number>();
  for (const t of winner ?? []) winnerBy.set(t.name, (winnerBy.get(t.name) ?? 0) + t.contribution);
  for (const t of truth) {
    const advantage = (winnerBy.get(t.name) ?? 0) - t.contribution;
    if (advantage > 0) tally.blame.set(t.name, (tally.blame.get(t.name) ?? 0) + 1);
  }
  for (const [name, contribution] of winnerBy) {
    if (truth.some((t) => t.name === name)) continue;
    // A term the truth does not carry at all paid the winner everything it is worth.
    if (contribution > 0) tally.blame.set(name, (tally.blame.get(name) ?? 0) + 1);
  }
}

/**
 * The anchor a run scored against — the one field that makes two `[faults]` lines incomparable.
 *
 * `inject-time` is the RCAEval baseline protocol: the anomaly window is anchored to the injection the dataset
 * records. `dataset-decoupled` is the pass that removes it and reads the metrics on their own. They are not the same
 * population, and on `RE3:TrainTicket` they are not close: 22/30 against 2/30, because that corpus does not carry the
 * injection into the metrics the decoupled pass reads — the truth's own onset comes back undefined and its own
 * anomaly reads 0.0224 against the leader's 1.0.
 *
 * A job runs both passes back to back, so the two lines sit a few hundred lines apart in one log and a census read
 * off a paste cannot tell them apart unless the line says which it is. It says which it is.
 */
export type FaultCensusAnchor = 'inject-time' | 'dataset-decoupled';

/**
 * The readable line, or `undefined` when the census has no case in it.
 *
 * Types are ordered by their miss count, so the head of the line is the pocket rather than the alphabetically first
 * label; the entry's own numbers let a reader check that the sum of the split is the miss count.
 *
 * @param census - The running totals.
 * @param anchor - Which pass these cases were scored under. Required rather than optional: a default would make the
 *   one field that decides comparability the one field a new caller can omit.
 */
export function formatFaultLine(
  census: FaultCensus,
  anchor: FaultCensusAnchor,
): string | undefined {
  if (census.byFault.size === 0) return undefined;
  const entries: string[] = [...census.byFault.entries()]
    .sort(([a, x], [b, y]) => y.n - y.correct - (x.n - x.correct) || y.n - x.n || (a < b ? -1 : 1))
    .map(([label, tally]) => {
      const hits = `${label} ${tally.correct}/${tally.n}`;
      const misses = tally.n - tally.correct;
      if (misses === 0) return `${hits}: miss 0`;
      const split = [
        `blank ${tally.blank}`,
        `outweighed ${tally.outweighed}`,
        `outvoted ${tally.outvoted}`,
      ];
      const blame = formatBlame(tally.blame);
      return `${hits}: miss ${misses} = ${split.join(' + ')}${blame === '' ? '' : ` [${blame}]`}`;
    });
  return `[faults:${anchor}] ${entries.join(' | ')}`;
}

/**
 * The blamed terms as `name count ...`, bounded and with its own truncation counted.
 *
 * @param blame - Case counts keyed by term name.
 */
function formatBlame(blame: ReadonlyMap<string, number>): string {
  if (blame.size === 0) return '';
  const ranked = [...blame.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  const shown = ranked.slice(0, FAULT_BLAME_TOP).map(([name, count]) => `${name} ${count}`);
  const rest = ranked.length - shown.length;
  if (rest > 0) shown.push(`+${rest}`);
  return shown.join(' ');
}
