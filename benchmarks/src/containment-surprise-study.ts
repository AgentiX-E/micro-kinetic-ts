/**
 * H7: is the containment pass's ceiling the CHANNEL it reads, or the rule it applies?
 *
 * ## The question, and why it is the next one
 *
 * The shipped pass reads `latencyExcursions` — one channel family, in band widths — and it earns `+15 / −0`
 * (`docs/containment-order.md` §12). `docs/closed-axes-register.md` §289 records the ceiling it then hits: a case
 * whose fault never reached a latency channel is a case the pass cannot speak about, however far the candidate
 * moved on everything else. The register's containment entries all priced the RULE (the interface record, the
 * residual, the margin); none of them swapped the MEASUREMENT while holding the rule fixed.
 *
 * `channelSurprise` is that swap: the same case, the same candidates, every published channel read instead of one
 * family, and each channel's departure priced by the rate at which that channel fires when nothing is wrong
 * (`pruning/fault-free-surprise.ts`). Because the pass takes a plain `ReadonlyMap<ServiceId, number>`, the swap
 * needs no change to the rule at all — it is one arm of one walk of one artifact, which is what makes it a
 * statement about the measurement.
 *
 * ## What this reading can and cannot say
 *
 * It compares three walks of the same chain: `fusion` (no pass), `shipped` (the pass on latency), and `surprise`
 * (the pass on the surprise map, the interface record included). The contribution it reports is therefore the
 * difference between two MEASUREMENTS, and it inherits every limit of a case-level label: a gain is a case whose
 * published head became an accepted answer, not a chain that became correct.
 *
 * The `shipped` row is a CHECK and not a result. It has to reproduce the corpus's published number, and a dump that
 * cannot is a dump whose walk describes something other than the decision — the reading is then `unmeasured` and
 * says so rather than publishing the arm beneath it.
 *
 * @module benchmarks/containment-surprise-study
 */

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

import { STANDING_CRITERION, judgeArm, type GateCriterion } from './containment-gate.js';
import { headOf, replayAgrees, replayCase } from './containment-replay.js';
import type { ContainmentCaseRow } from './containment-rows.js';

/** One arm's answer over the population it could be scored on. */
export interface SurpriseArmScore {
  /** Cases whose first candidate is in the accepted set. */
  readonly top1: number;
  /** Cases this arm gets right and the fusion baseline does not. */
  readonly gains: number;
  /** Cases the fusion baseline gets right and this arm does not. */
  readonly losses: number;
}

/** What the surprise arm did, and where it differed from the shipped one. */
export interface SurpriseReading {
  /** Rows in the dump. */
  readonly cases: number;
  /** Rows carrying a chain, i.e. rows that can be walked. */
  readonly replayable: number;
  /** Rows whose chain carries no surprise map — the arm is not walkable there at all. */
  readonly unmeasurable: number;
  /** Rows whose shipped replay did NOT reproduce the recorded top-1. Zero on a healthy artifact. */
  readonly disagreements: number;
  /** Rows that entered every arm, i.e. the population the three numbers below are over. */
  readonly scored: number;
  /** Cases whose published head the surprise arm changed, in either direction. */
  readonly moved: number;
  /** The three walks. */
  readonly arms: {
    readonly fusion: SurpriseArmScore;
    readonly shipped: SurpriseArmScore;
    readonly surprise: SurpriseArmScore;
  };
  /** What the surprise walk decided about every pair it examined. */
  readonly decisions: Readonly<Record<ContainmentDecision, number>>;
  /** Pairs the surprise walk inverted and the shipped walk did not, keyed by the SHIPPED reason for refusing. */
  readonly opened: Readonly<Record<ContainmentDecision, number>>;
  /** Band half-width the run measured against, for the report's provenance line. */
  readonly sigma: number;
}

/** Whether a case's answer is correct: `null` when the arm had no answer. */
function correct(answer: string | null, accepted: readonly string[]): boolean | null {
  if (answer === null) return null;
  return accepted.includes(answer);
}

/** A zeroed decision census. */
function emptyCensus(): Record<ContainmentDecision, number> {
  return {
    inverted: 0,
    // Unreachable from this arm — the surprise walk reads the record per edge — and present for the reason the
    // gate's census records: the counters are a `Record` over the union.
    'record-silent': 0,
    'no-failed-interface': 0,
    unmeasured: 0,
    'not-larger': 0,
    'prior-absent': 0,
    'prior-below': 0,
  };
}

/**
 * Read the surprise arm over the whole corpus, beside the two walks it is a change to.
 *
 * @param rows - The corpus's dump rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @returns The three arms' numbers and the two censuses.
 */
export function readSurprise(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
): SurpriseReading {
  const decisions = emptyCensus();
  const opened = emptyCensus();
  const tally = { fusion: 0, shipped: 0, surprise: 0 };
  const gains = { shipped: 0, surprise: 0 };
  const losses = { shipped: 0, surprise: 0 };
  let replayable = 0;
  let unmeasurable = 0;
  let disagreements = 0;
  let scored = 0;
  let moved = 0;
  let sigma = rows.length === 0 ? 0 : rows[0]!.sigma;

  for (const row of rows) {
    const answers = accepted.get(row.datapack);
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const surprise = replayCase(row, { kind: 'surprise' });
    if (base !== null) replayable += 1;
    if (surprise === null) {
      // A row with a chain but no surprise map is a row this arm cannot walk: counted, not silently folded into
      // the arms below, because a smaller population that looks like a worse arm is the same mistake as a larger
      // one that looks like a better arm.
      if (row.chain !== undefined) unmeasurable += 1;
      continue;
    }
    for (const verdict of surprise.verdicts) decisions[verdict.decision] += 1;
    if (answers === undefined || base === null || shipped === null) continue;
    if (!replayAgrees(row, shipped)) disagreements += 1;
    const baseOk = correct(headOf(base.published), answers);
    const shippedOk = correct(headOf(shipped.published), answers);
    const surpriseOk = correct(headOf(surprise.published), answers);
    if (baseOk === null || shippedOk === null || surpriseOk === null) continue;
    scored += 1;
    sigma = row.sigma;
    if (headOf(surprise.published) !== headOf(shipped.published)) moved += 1;
    // Which pairs the surprise map opened: a pair this walk inverted and the shipped walk did not, tallied under
    // the reason the SHIPPED walk gave for leaving it alone. That is the census which says WHICH silence the
    // second measurement breaks, and whether it breaks the one §289 named.
    const shippedKey = new Map(
      shipped.verdicts.map((verdict) => [
        `${verdict.upper}\u0000${verdict.lower}`,
        verdict.decision,
      ]),
    );
    for (const verdict of surprise.verdicts) {
      if (verdict.decision !== 'inverted') continue;
      const before = shippedKey.get(`${verdict.upper}\u0000${verdict.lower}`);
      if (before === undefined) opened['inverted'] += 1;
      else if (before !== 'inverted') opened[before] += 1;
    }
    if (baseOk) tally.fusion += 1;
    if (shippedOk) tally.shipped += 1;
    if (surpriseOk) tally.surprise += 1;
    if (shippedOk && !baseOk) gains.shipped += 1;
    if (!shippedOk && baseOk) losses.shipped += 1;
    if (surpriseOk && !baseOk) gains.surprise += 1;
    if (!surpriseOk && baseOk) losses.surprise += 1;
  }

  return {
    cases: rows.length,
    replayable,
    unmeasurable,
    disagreements,
    scored,
    moved,
    arms: {
      fusion: { top1: tally.fusion, gains: 0, losses: 0 },
      shipped: { top1: tally.shipped, gains: gains.shipped, losses: losses.shipped },
      surprise: { top1: tally.surprise, gains: gains.surprise, losses: losses.surprise },
    },
    decisions,
    opened,
    sigma,
  };
}

/** The two ways the arm can be unreadable, and the one way it can be read. */
export type SurpriseVerdict = 'pass' | 'fail' | 'unmeasured';

/**
 * Judge the reading.
 *
 * `unmeasured` is reserved for the three instrument failures — no walkable row, the shipped replay disagreeing with
 * the published answer, or a row whose chain carries no surprise map — because all three mean the arm's row
 * describes a population the run never walked. A measured refusal is a finding and leaves the job green.
 *
 * @param reading - The arm's numbers.
 * @param criterion - The bar, default {@link STANDING_CRITERION}.
 * @returns The verdict and the sentence that says why.
 */
export function surpriseVerdict(
  reading: SurpriseReading,
  criterion: GateCriterion = STANDING_CRITERION,
): { verdict: SurpriseVerdict; reason: string } {
  if (reading.replayable === 0) {
    return { verdict: 'unmeasured', reason: 'no row carries a chain, so nothing was walked' };
  }
  if (reading.unmeasurable > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.unmeasurable} of ${reading.cases} rows carry no surprise map — the arm cannot be walked`,
    };
  }
  if (reading.disagreements > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.disagreements} rows do not replay the published top-1, so the walk is not the decision`,
    };
  }
  const judged = judgeArm(reading.arms.surprise, criterion);
  return { verdict: judged.verdict, reason: judged.reason };
}
