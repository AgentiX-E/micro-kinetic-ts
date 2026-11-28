/**
 * The excursion-licence arm: a resolvable callee excursion as the licence a completed call cannot give.
 *
 * ## The defect this arm is the only test of
 *
 * The shipped containment pass refuses to invert a pair whose own interface recorded no failed call: a call
 * passed between them and completed, so the failure did not travel over it. That inference is sound for a CONTENT
 * fault — a 200-OK delivered the value — and false for a LATENCY fault, which can complete and still be slow.
 * Train-ticket instruments its operations with Hystrix fallbacks that turn a downstream failure into a synthetic
 * `200 OK` (RESTberus, arXiv:2611.04769), so on this corpus "no failed call on the edge" is not evidence of
 * non-propagation.
 *
 * At floor 0 this arm is exactly the ruled-out `ungated` arm: it inverts boundary noise over a correct root and
 * costs the five losses iteration 293 removed. Iteration 382's {@link DEFAULT_MIN_CALLEE_EXCURSION} floor refuses
 * those noise pairs as `callee-in-band` BEFORE the licence is consulted, so on the fixed engine the only pairs
 * this arm newly licenses are callees that genuinely left their band. This module prices that difference on the
 * artifact the gate already trusts: three arms over one chain, the same excursions, and one rule moved.
 *
 * ## What is read, and what is not claimed
 *
 * The arm is a counterfactual over a dump: `off` is the fusion order, `shipped` is the record-only rule the dump
 * was produced under, and `excursion-license` is the same chain with the switch on. A row that cannot be walked is
 * not a lost case; a dump that does not reproduce its own recorded top-1 is not a measurement. Both are named as
 * `unmeasured` rather than folded into an arm. The verdict uses the SAME bar as the gate, so a gain is read against
 * fusion and a loss against fusion, on the population every arm was scored on.
 *
 * @module benchmarks/containment-excursion-license-study
 */

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

import { judgeArm, priorsFor, STANDING_CRITERION, type GateCriterion } from './containment-gate.js';
import { headOf, replayAgrees, replayCase } from './containment-replay.js';
import type { ContainmentCaseRow } from './containment-rows.js';

/** One arm's answer over the population it could be scored on. */
export interface LicenseArmScore {
  /** Cases whose first candidate is in the accepted set. */
  readonly top1: number;
  /** Cases this arm gets right and the fusion baseline does not. */
  readonly gains: number;
  /** Cases the fusion baseline gets right and this arm does not. */
  readonly losses: number;
}

/** Everything the reading records, so a later arm can be priced on the same bytes. */
export interface ExcursionLicenseReading {
  /** Rows in the dump. */
  readonly cases: number;
  /** Rows carrying a chain, i.e. rows that can be walked. */
  readonly replayable: number;
  /** Rows that entered every arm and carry an accepted answer. */
  readonly scored: number;
  /** Rows whose shipped replay did NOT reproduce the recorded top-1. Zero on a healthy artifact. */
  readonly disagreements: number;
  /** The no-pass baseline, the shipped record-only rule, and the excursion-licence arm. */
  readonly arms: {
    readonly fusion: LicenseArmScore;
    readonly shipped: LicenseArmScore;
    readonly licensed: LicenseArmScore;
  };
  /** What the licensed walk decided about every pair it examined. */
  readonly decisions: Readonly<Record<ContainmentDecision, number>>;
  /** What the shipped walk decided — the control's own census. */
  readonly control: Readonly<Record<ContainmentDecision, number>>;
}

/** The two ways the artifact cannot be read, and the two ways it can. */
export type LicenseVerdict = 'pass' | 'fail' | 'unmeasured';

/** The empty census, as a value so a missing key is a compile error rather than a silent zero. */
function emptyCensus(): Record<ContainmentDecision, number> {
  return {
    inverted: 0,
    'record-silent': 0,
    'no-failed-interface': 0,
    unmeasured: 0,
    'callee-in-band': 0,
    'not-larger': 0,
    'excursion-licensed': 0,
    'prior-absent': 0,
    'prior-below': 0,
  };
}

/** Whether a case's answer is correct: `null` when the arm had no answer. */
function correct(answer: string | null, accepted: readonly string[]): boolean | null {
  if (answer === null) return null;
  return accepted.includes(answer);
}

/**
 * Price the excursion licence over a whole corpus, beside the two walks it is a change to.
 *
 * @param rows - The corpus's dump rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @returns The arms, both censuses, and the health counters.
 */
export function readExcursionLicense(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
): ExcursionLicenseReading {
  const decisions = emptyCensus();
  const control = emptyCensus();
  const tally = { fusion: 0, shipped: 0, licensed: 0 };
  const gains = { shipped: 0, licensed: 0 };
  const losses = { shipped: 0, licensed: 0 };
  // `priorsFor` is read only to keep the dump's fitted-edge population declared here, the same way the gate does:
  // no arm on this axis carries a residual, but a corpus whose edges cannot be fitted is a corpus worth naming.
  priorsFor(rows);
  let replayable = 0;
  let scored = 0;
  let disagreements = 0;

  for (const row of rows) {
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const licensed = replayCase(row, { kind: 'excursion-license' });
    if (base !== null) replayable += 1;
    if (licensed !== null) {
      for (const verdict of licensed.verdicts) decisions[verdict.decision] += 1;
    }
    if (shipped !== null) {
      for (const verdict of shipped.verdicts) control[verdict.decision] += 1;
    }
    if (base === null || shipped === null || licensed === null) continue;
    if (!replayAgrees(row, shipped)) disagreements += 1;
    const answers = accepted.get(row.datapack);
    if (answers === undefined) continue;
    const baseOk = correct(headOf(base.published), answers);
    const shippedOk = correct(headOf(shipped.published), answers);
    const licensedOk = correct(headOf(licensed.published), answers);
    if (baseOk === null || shippedOk === null || licensedOk === null) continue;
    scored += 1;
    if (baseOk) tally.fusion += 1;
    if (shippedOk) tally.shipped += 1;
    if (licensedOk) tally.licensed += 1;
    if (shippedOk && !baseOk) gains.shipped += 1;
    if (!shippedOk && baseOk) losses.shipped += 1;
    if (licensedOk && !baseOk) gains.licensed += 1;
    if (!licensedOk && baseOk) losses.licensed += 1;
  }

  return {
    cases: rows.length,
    replayable,
    scored,
    disagreements,
    arms: {
      fusion: { top1: tally.fusion, gains: 0, losses: 0 },
      shipped: { top1: tally.shipped, gains: gains.shipped, losses: losses.shipped },
      licensed: { top1: tally.licensed, gains: gains.licensed, losses: losses.licensed },
    },
    decisions,
    control,
  };
}

/**
 * The pre-registered verdict. The unmeasured branches fire in the same order as the gate's: a dump that cannot be
 * walked at all, one only partly walked, or one whose shipped replay does not reproduce its own recorded top-1 is
 * a statement about the artifact, not a pass or a failure of the arm. Only then does the arm meet the bar.
 */
export function licenseVerdict(
  reading: ExcursionLicenseReading,
  criterion: GateCriterion = STANDING_CRITERION,
): { readonly verdict: LicenseVerdict; readonly reason: string } {
  if (reading.replayable === 0) {
    return {
      verdict: 'unmeasured',
      reason: 'no row carries the sweep input, so no arm can be walked',
    };
  }
  if (reading.replayable < reading.cases) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.cases - reading.replayable} of ${reading.cases} rows carry no sweep input, so the arm would be read over a population the run did not declare`,
    };
  }
  if (reading.disagreements > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.disagreements} case(s) did not reproduce the recorded top-1, so the chain is incomplete`,
    };
  }
  return judgeArm(reading.arms.licensed, criterion);
}
