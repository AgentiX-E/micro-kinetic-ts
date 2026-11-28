/**
 * The gate-policy monotonicity invariant of the shipped arm.
 *
 * The arm's five gate policies are ordered by strictness: `none` < `cited` < `cone` < `contrast` < `lag`. Each
 * stricter policy refuses a superset of the overrides a looser one refuses, and a refused override falls back to
 * the engine's prior. On a SEEDED arm — the seed is both the order shown to the model and the name a refusal falls
 * back to — that nesting forces three quantities to move one way as strictness rises:
 *
 * * admitted overrides never increase;
 * * refusals never decrease (and, per policy, `admitted + refused` is conserved);
 * * resolved Top@1 never decreases.
 *
 * The third is the non-obvious one: a stricter gate throws away more model overrides, yet on a seeded arm it cannot
 * lose a case, because every throw-away lands back on the name the engine already had. This is the architectural
 * opposite of the shape reported for a freely calling agent in "Free to Look, Free to Reason"
 * (arXiv:2610.35767, 2026-10), where a higher prescribed-call ratio correlates with LOWER accuracy. Stating this
 * invariant as code lets the two positions be compared on one population instead of conflated.
 *
 * This module is a pure checker over an already-computed gate table. It never re-scores rows and never calls a
 * model: constructing the table is `summariseGatePolicies`'s job, and a second scorer here would be a second
 * definition of the metric. Every refusal names the reason so a broken ladder cannot be read as a quiet "false".
 *
 * @module benchmarks/gate-policy-monotonicity
 */

import type { GatePolicy, GateReading } from './query-agent.js';

/** The five policies in ascending strictness — the order `summariseGatePolicies` emits. */
export const POLICY_ORDER: readonly GatePolicy[] = ['none', 'cited', 'cone', 'contrast', 'lag'];

/** The loosest policy: the control, which admits every override. */
export const FIRST_POLICY: GatePolicy = POLICY_ORDER[0]!;

/** The strictest policy: the one that refuses every override it distrusts. */
export const LAST_POLICY: GatePolicy = POLICY_ORDER[POLICY_ORDER.length - 1]!;

/** Options for {@link checkMonotonicity}. */
export interface MonotonicityOptions {
  /**
   * Whether the artifact was a seeded arm. This does not change the invariant — the strictness nesting and the
   * fallback hold on both arms — but it changes how the reader may INTERPRET the refused column: on a free arm
   * there is no incumbent to fall back to, so the refused rows describe a policy the run could not execute. The
   * flag is recorded in the result so that caveat travels with the number rather than being forgotten.
   */
  readonly seeded: boolean;
}

/** The adjacent-step change in each monotone quantity, plus whether that step kept the invariant. */
export interface AdjacentStep {
  readonly from: GatePolicy;
  readonly to: GatePolicy;
  readonly admittedDelta: number;
  readonly refusedDelta: number;
  readonly resolvedDelta: number;
  readonly admittedOk: boolean;
  readonly refusedOk: boolean;
  readonly resolvedOk: boolean;
}

/** The result of checking a whole ladder. */
export interface MonotonicityResult {
  readonly monotone: boolean;
  /** The first step that broke an invariant, or `null` when all steps held. */
  readonly firstViolation: AdjacentStep | null;
  readonly steps: readonly AdjacentStep[];
  /** Carried through from the options so a free-arm caveat travels with the reading. */
  readonly seeded: boolean;
}

/** Locate a policy's strictness rank, refusing names outside the loop's ladder. */
function rankOf(policy: GatePolicy): number {
  const rank = POLICY_ORDER.indexOf(policy);
  if (rank < 0) throw new Error(`unknown gate policy: ${policy}`);
  return rank;
}

/**
 * Price every adjacent transition in a policy ladder.
 *
 * @param readings - Two or more gate readings in ascending strictness order, each for a distinct policy.
 * @returns One step per adjacent policy pair.
 * @throws when fewer than two readings are given, a policy is unknown, duplicated, or out of order.
 */
export function adjacentMonotonicity(readings: readonly GateReading[]): readonly AdjacentStep[] {
  if (readings.length < 2) throw new Error('monotonicity needs at least two gate readings');

  let previousRank = -1;
  for (const row of readings) {
    const rank = rankOf(row.policy);
    if (rank <= previousRank) {
      throw new Error(
        rank === previousRank
          ? `duplicate gate policy: ${row.policy}`
          : `gate ladder is out of order: ${row.policy} follows a stricter policy`,
      );
    }
    previousRank = rank;
  }

  const steps: AdjacentStep[] = [];
  for (let i = 0; i < readings.length - 1; i += 1) {
    const lo = readings[i]!;
    const hi = readings[i + 1]!;
    const admittedDelta = hi.admitted - lo.admitted;
    const refusedDelta = hi.refused - lo.refused;
    const resolvedDelta = hi.correctResolved - lo.correctResolved;
    steps.push({
      from: lo.policy,
      to: hi.policy,
      admittedDelta,
      refusedDelta,
      resolvedDelta,
      admittedOk: admittedDelta <= 0,
      refusedOk: refusedDelta >= 0,
      resolvedOk: resolvedDelta >= 0,
    });
  }
  return steps;
}

/**
 * Check the full ladder and report the first violation.
 *
 * @param readings - Gate readings in ascending strictness order.
 * @param options - Records whether the source arm was seeded, for interpretation only: the invariant holds on
 *   both arms, but a free arm's refused column describes a policy it could not execute (the caveat travels out).
 * @throws when the ladder is malformed (see {@link adjacentMonotonicity}).
 */
export function checkMonotonicity(
  readings: readonly GateReading[],
  options: MonotonicityOptions = { seeded: true },
): MonotonicityResult {
  const steps = adjacentMonotonicity(readings);
  const violation =
    steps.find((step) => !step.admittedOk || !step.refusedOk || !step.resolvedOk) ?? null;
  return { monotone: violation === null, firstViolation: violation, steps, seeded: options.seeded };
}

/** Predicate form of {@link checkMonotonicity}. */
export function isMonotone(
  readings: readonly GateReading[],
  options: MonotonicityOptions = { seeded: true },
): boolean {
  return checkMonotonicity(readings, options).monotone;
}

/** Render a result as a stable ledger that names every adjacent transition. */
export function formatMonotonicity(result: MonotonicityResult): string {
  const lines = result.steps.map(
    (step) =>
      `${step.from} -> ${step.to}: admitted ${step.admittedDelta >= 0 ? '+' : ''}${step.admittedDelta}, ` +
      `refused ${step.refusedDelta >= 0 ? '+' : ''}${step.refusedDelta}, ` +
      `resolved ${step.resolvedDelta >= 0 ? '+' : ''}${step.resolvedDelta}`,
  );
  const verdict = result.monotone
    ? 'MONOTONE: strictness never costs resolved accuracy'
    : `VIOLATION at ${result.firstViolation?.from} -> ${result.firstViolation?.to}`;
  return [verdict, ...lines].join('\n');
}
