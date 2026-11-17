/**
 * H8: the interface record kept as a VETO, and dropped as a licence.
 *
 * ## The question this arm is the only survivor of
 *
 * `docs/closed-axes-register.md` §299 measured a residual requirement that gains 27 and loses 3, and refused it.
 * The three losses are one edge (`ts-preserve → ts-security`) in three cases: the fault is at the caller, the
 * callee moved further out, and the shipped rule correctly refused to promote the victim over its root because a
 * call between them **completed**. The eighteen gains the same arm takes that the record never reaches are cases
 * where no call failed anywhere, so the record had nothing to say.
 *
 * Both facts are about the SAME absence. The shipped rule reads it as one object — "not in the record, therefore
 * refuse" — and pays `+15 / −0` for the simplicity. §299's census shows the absence is two facts wearing one
 * label:
 *
 * - the case recorded failed calls somewhere, and this edge is not among them → a call passed between these two
 *   and completed, which is evidence the failure did not travel over it. That is a **veto**.
 * - the case recorded no failed call at all → the record is silent about the case, which is a fact about the
 *   recording and not about this pair. That is **not** a veto, and treating it as one discards the eighteen gains.
 *
 * `ContainmentOrderInput.recordScope: 'case'` is that distinction, and this module prices it. One variable moves:
 * the scope of the record. The measurement, the inequality, the cross-fitting and the prior are the shipped ones.
 *
 * ## Why the arm cannot be read as a tuned number
 *
 * Nothing is fitted. The residual is the same cross-fitted prior the `prior` arm carries (`priorsFor`, one half
 * fitted and the other judged), and the threshold is the shipped `0`. What changed is a word — which of two
 * statements a missing record is allowed to make — so an improvement here is not a coefficient that happened to
 * fit the corpus, and it cannot be re-tuned to a better one.
 *
 * ## The ceiling, measured rather than argued
 *
 * The sweep visits adjacent positions from the top and never revisits one, so a candidate ascends exactly one
 * place and only a pair at positions 0 and 1 can change the published head. That makes the whole family's bound a
 * census rather than a claim: the cases a sweep can fix are exactly the fusion misses whose accepted answer sits
 * at the fusion's SECOND position and whose pair carries a call edge with the lower side further out. This module
 * counts that set, so every arm on this axis is read against the headroom it is spending rather than against a
 * percentage.
 *
 * @module benchmarks/containment-veto-study
 */

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

import {
  foldOf,
  judgeArm,
  priorsFor,
  STANDING_CRITERION,
  type FittedPrior,
  type GateCriterion,
} from './containment-gate.js';
import { headOf, replayAgrees, replayCase } from './containment-replay.js';
import type { ContainmentCaseRow } from './containment-rows.js';

/** One arm's answer over the population it could be scored on. */
export interface VetoArmScore {
  /** Cases whose first candidate is in the accepted set. */
  readonly top1: number;
  /** Cases this arm gets right and the fusion baseline does not. */
  readonly gains: number;
  /** Cases the fusion baseline gets right and this arm does not. */
  readonly losses: number;
}

/**
 * The family's own bound, counted off the artifact.
 *
 * `atSecond` is the population; `reachable` is the part of it any sweep can act on, because a sweep can only
 * exchange positions 0 and 1 and only when an edge runs between them with the lower side further out. A reading
 * whose `arms.*.top1` is quoted without this denominator describes an arm without saying what it is spending.
 */
export interface SweepCeiling {
  /** Fusion misses whose accepted answer sits at the fusion's second position. */
  readonly atSecond: number;
  /** Of those, the ones whose pair carries a call edge and whose lower side is further out. */
  readonly reachable: number;
  /** The unreachable remainder, counted so the three numbers partition `atSecond`. */
  readonly unreachable: number;
  /** The reachable cases the shipped walk actually turns into hits. */
  readonly shipped: number;
  /** The reachable cases the veto walk actually turns into hits. */
  readonly veto: number;
}

/** The whole reading. */
export interface VetoReading {
  /** Rows in the dump. */
  readonly cases: number;
  /** Rows carrying a chain, i.e. rows that can be walked. */
  readonly replayable: number;
  /** Rows that entered every arm and carry an accepted answer. */
  readonly scored: number;
  /** Rows whose shipped replay did NOT reproduce the recorded top-1. Zero on a healthy artifact. */
  readonly disagreements: number;
  /**
   * Cases whose interface record is EMPTY — the population the scope change is about.
   *
   * A case with no record at all is the only place the two scopes disagree, so this count is the arm's reach
   * before any measurement is consulted. It is reported beside the arms because a scope change that touched three
   * cases and moved nine of them would be a coincidence worth doubting.
   */
  readonly recordFree: number;
  /** The two halves' priors, keyed by the half each applies to. */
  readonly priors: readonly FittedPrior[];
  /** The no-pass baseline, the shipped arm, and the veto arm. */
  readonly arms: {
    readonly fusion: VetoArmScore;
    readonly shipped: VetoArmScore;
    readonly veto: VetoArmScore;
  };
  /** What the veto walk decided about every pair it examined. */
  readonly decisions: Readonly<Record<ContainmentDecision, number>>;
  /**
   * What the SHIPPED walk decided about every pair it examined — the control's own census.
   *
   * The three arms before this one each printed their own census and never the control's, which is how §301 came
   * to quote an inversion count for the shipped walk that was a DERIVATION rather than a reading: the gate's 198
   * plus the 44 pairs the residual stopped, valid only if the two walks shared a cascade, which they do not —
   * inverting one pair changes every adjacency below it. A control with no census is a control a claim about it
   * cannot be checked against, and this field is one line of arithmetic away from existing.
   */
  readonly control: Readonly<Record<ContainmentDecision, number>>;
  /** The family's bound and what each arm took of it. */
  readonly ceiling: SweepCeiling;
}

/** Whether a case's answer is correct: `null` when the arm had no answer. */
function correct(answer: string | null, accepted: readonly string[]): boolean | null {
  if (answer === null) return null;
  return accepted.includes(answer);
}

/** The two ways the arm can be unreadable, and the two ways it can be read. */
export type VetoVerdict = 'pass' | 'fail' | 'unmeasured';

/**
 * The pre-registered verdict for this arm.
 *
 * The unmeasured branches are the same three the gate and the surprise arms use, and they fire in the same order:
 * a dump with no chain cannot be walked at all, a dump where only some rows carry one would be read over a
 * population the run did not declare, and one where the shipped replay does not reproduce the recorded top-1
 * describes a walk the run never took. Only then does the arm's own number decide, through `judgeArm`.
 *
 * @param reading - The arm's reading.
 * @param criterion - The standing bar, or another one.
 * @returns The verdict and its sentence.
 */
export function vetoVerdict(
  reading: VetoReading,
  criterion: GateCriterion = STANDING_CRITERION,
): { readonly verdict: VetoVerdict; readonly reason: string } {
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
  const judged = judgeArm(reading.arms.veto, criterion);
  return { verdict: judged.verdict, reason: judged.reason };
}

/** The empty census, as a value so that a missing key is a compile error rather than a silent zero. */
function emptyCensus(): Record<ContainmentDecision, number> {
  return {
    inverted: 0,
    'record-silent': 0,
    'no-failed-interface': 0,
    unmeasured: 0,
    'not-larger': 0,
    'prior-absent': 0,
    'prior-below': 0,
  };
}

/** Where one fusion miss sits relative to the family's bound. */
export type SweepReach = 'not-second' | 'unqualified' | 'qualified';

/**
 * How close a sweep could come to fixing this case, read off the order the sweep is handed.
 *
 * Three answers, because they partition the misses and a two-way split would hide one of them:
 *
 * - `not-second` — the accepted answer is not at position 1 of the chain's recorded order. A sweep cannot reach it
 *   at all: the pass walks adjacent positions from the top and never revisits one, so a candidate ascends exactly
 *   one place and only positions 0 and 1 decide the published head.
 * - `unqualified` — it is at position 1, and the rule refuses the pair on its own terms: no call edge between the
 *   two, or a side the profile could not measure, or the lower side is not further out. Every arm on this axis
 *   refuses it for the same reason, whatever requirement it applies.
 * - `qualified` — position 1, a call edge, both sides measured, and the lower side further out by more than the
 *   margin. This is the only set any containment arm can convert, and it is what the ceiling is.
 *
 * @param row - A case row whose fusion head is wrong.
 * @param accepted - The case's accepted answers.
 * @returns Where the case sits relative to the bound.
 */
export function sweepReach(row: ContainmentCaseRow, accepted: readonly string[]): SweepReach {
  const chain = row.chain;
  if (chain === undefined || chain.order.length < 2) return 'not-second';
  const [upper, lower] = [chain.order[0]!, chain.order[1]!];
  if (!accepted.includes(lower)) return 'not-second';
  const calls = new Set(chain.edges.map(([from, to]) => `${from}\u0000${to}`));
  if (!calls.has(`${upper}\u0000${lower}`)) return 'unqualified';
  const upperExcursion = chain.excursions[upper];
  const lowerExcursion = chain.excursions[lower];
  // Absent is not zero: a side the profile could not measure is a pair no arm can qualify, which is the same
  // refusal `inspectContainmentOrder` makes and must not be restated here as a comparison against 0.
  if (upperExcursion === undefined || lowerExcursion === undefined) return 'unqualified';
  return lowerExcursion > upperExcursion + row.margin ? 'qualified' : 'unqualified';
}

/**
 * Read the veto arm over the whole corpus, cross-fitted.
 *
 * @param rows - The corpus's dump rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @returns The three arms, the census, and the family's bound.
 */
export function readVeto(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
): VetoReading {
  const priors = priorsFor(rows);
  const decisions = emptyCensus();
  const control = emptyCensus();
  const tally = { fusion: 0, shipped: 0, veto: 0 };
  const gains = { shipped: 0, veto: 0 };
  const losses = { shipped: 0, veto: 0 };
  const reach = { unqualified: 0, reachable: 0, shipped: 0, veto: 0 };
  let replayable = 0;
  let scored = 0;
  let disagreements = 0;
  let recordFree = 0;

  for (const row of rows) {
    const chain = row.chain;
    if (chain !== undefined && Object.keys(chain.failedInterfaces).length === 0) recordFree += 1;
    const answers = accepted.get(row.datapack);
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const veto = replayCase(row, {
      kind: 'veto',
      prior: priors.get(foldOf(row.datapack))!.prior,
    });
    if (base !== null) replayable += 1;
    // The census describes the WALK and not the labels, so it is taken over every row that could be walked —
    // including rows with no accepted answer, whose refusals are still decisions the arm made.
    if (veto !== null) {
      for (const verdict of veto.verdicts) decisions[verdict.decision] += 1;
    }
    if (shipped !== null) {
      for (const verdict of shipped.verdicts) control[verdict.decision] += 1;
    }
    if (base === null || shipped === null || veto === null) continue;
    if (!replayAgrees(row, shipped)) disagreements += 1;
    if (answers === undefined) continue;
    const baseOk = correct(headOf(base.published), answers);
    const shippedOk = correct(headOf(shipped.published), answers);
    const vetoOk = correct(headOf(veto.published), answers);
    if (baseOk === null || shippedOk === null || vetoOk === null) continue;
    scored += 1;
    if (baseOk) tally.fusion += 1;
    if (shippedOk) tally.shipped += 1;
    if (vetoOk) tally.veto += 1;
    if (shippedOk && !baseOk) gains.shipped += 1;
    if (!shippedOk && baseOk) losses.shipped += 1;
    if (vetoOk && !baseOk) gains.veto += 1;
    if (!vetoOk && baseOk) losses.veto += 1;
    // The bound is read on the same population as the arms, and only where the fusion was wrong — a case the
    // baseline already answers correctly is not headroom for any arm.
    if (!baseOk) {
      const where = sweepReach(row, answers);
      if (where === 'qualified') {
        reach.reachable += 1;
        if (shippedOk) reach.shipped += 1;
        if (vetoOk) reach.veto += 1;
      } else if (where === 'unqualified') {
        reach.unqualified += 1;
      }
    }
  }

  return {
    cases: rows.length,
    replayable,
    scored,
    disagreements,
    recordFree,
    priors: [priors.get('a')!, priors.get('b')!],
    arms: {
      fusion: { top1: tally.fusion, gains: 0, losses: 0 },
      shipped: { top1: tally.shipped, gains: gains.shipped, losses: losses.shipped },
      veto: { top1: tally.veto, gains: gains.veto, losses: losses.veto },
    },
    decisions,
    control,
    ceiling: {
      atSecond: reach.unqualified + reach.reachable,
      reachable: reach.reachable,
      unreachable: reach.unqualified,
      shipped: reach.shipped,
      veto: reach.veto,
    },
  };
}

/** The verdict, as a value. Shared with the gate and the term so the bar cannot drift between arms. */
export { judgeArm, STANDING_CRITERION, type GateCriterion } from './containment-gate.js';
