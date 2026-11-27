/**
 * Walk a case's two relational passes again, from the dump alone.
 *
 * ## Why a walk and not a re-decision
 *
 * The obvious way to price a new requirement is to re-read the decisions already recorded and drop the
 * inversions it would have refused. That is wrong, and it is wrong in a way that flatters the requirement: a
 * sweep inverts pairs as it goes, so refusing one inversion changes the adjacency the next row describes. The
 * gated walk examines a different set of pairs — sometimes a superset in one place and a subset in another — and
 * a re-decision would report a corpus the gate never saw.
 *
 * So the dump stores the sweep's INPUT (`chain`, see `containment-rows.ts`) and this module calls the same two
 * functions the engine calls, in the same order. `applyContainmentOrder` is a pure function of that input, which
 * is what makes the replay an observation rather than a second implementation: there is one implementation, and
 * the artifact carries its arguments.
 *
 * @module benchmarks/containment-replay
 */

import type { ServiceId } from '../../packages/core/src/index.js';
import {
  DEFAULT_FAILURE_CONTAINMENT_SCOPE,
  applyFailureContainment,
  inspectContainmentOrder,
  type ContainmentPrior,
  type ContainmentVerdict,
  type FailureContainmentScope,
} from '../../packages/tree/src/index.js';

import type { ContainmentCaseRow } from './containment-rows.js';
import { gradeByTerm, type TermTransfer } from './containment-term.js';

/**
 * Which arm the containment stage is walked as.
 *
 * Six arms, because this repository asks six different things of the pass and only one of them is "do nothing":
 *
 * - `off` — no sweep at all. The order goes straight to the flow pass, which is the 1 141-case baseline every ±
 *   in `docs/containment-order.md` is read against, and the arm the gate is compared TO.
 * - `ungated` — the excursion rule and nothing else. The arm iteration 293 refused (`+33 / −5`), kept because it
 *   is the control the interface record is priced against.
 * - `shipped` — the excursion rule AND the failed-interface record.
 * - `prior` — the excursion rule AND a residual fitted outside this case.
 * - `graded` — no sweep: the fusion order re-sorted by `score + Σδ`, where δ is the residual spent as a bounded
 *   TERM (`containment-term.ts`). The transfers are passed in rather than computed here so that this module stays
 *   a walk of the shipped chain and the study keeps its census.
 * - `surprise` — the shipped rule (the interface record included) reading a DIFFERENT per-candidate measurement:
 *   the fault-free surprise over every published channel instead of the latency excursion over one family. It is
 *   the same walk of the same chain with one map swapped, which is what makes it a statement about the
 *   measurement rather than about the rule.
 *
 * - `veto` — the shipped rule reading its own interface record at CASE scope (`ContainmentOrderInput.recordScope`).
 *   A pair whose own edge carried no failed call is still refused when the case recorded failed calls ANYWHERE, and
 *   falls through to the measurements and the residual when it recorded none. `prior` is the same cross-fitted
 *   residual the `prior` arm carries. The record stays a requirement on the edges that have one, which is the whole
 *   point: this arm keeps the veto and drops the licence.
 *
 * A row whose chain carries no surprise map REFUSES the `surprise` arm rather than walking it empty: an empty map
 * makes the pass a no-op, so a dump written before the field existed would report the arm as identical to `off`
 * and the difference would look like a finding.
 *
 * `off` and `ungated` are not the same arm, and conflating them is the mistake this type exists to prevent: a
 * baseline that inverted pairs would credit the gate with decisions the fusion had already made.
 */
export type ReplayArm =
  | { readonly kind: 'off' }
  | { readonly kind: 'ungated' }
  | { readonly kind: 'shipped' }
  | { readonly kind: 'prior'; readonly prior: ContainmentPrior }
  | {
      readonly kind: 'graded';
      readonly transfers: readonly TermTransfer[];
      readonly scores: ReadonlyMap<string, number>;
    }
  | { readonly kind: 'surprise' }
  | {
      readonly kind: 'veto';
      readonly prior: ContainmentPrior;
    };

/** One case's chain, walked. */
export interface ReplayedCase {
  /** The containment stage's order. */
  readonly containment: readonly string[];
  /** The order the engine would publish: the containment stage, then the flow pass. */
  readonly published: readonly string[];
  /** What the sweep decided about each adjacent pair it examined, in sweep order. */
  readonly verdicts: readonly ContainmentVerdict[];
  /**
   * How far the flow pass looked for a pair on this walk.
   *
   * Reported rather than implied, because the pass HAS a default and a walk that used it is indistinguishable
   * from one that read the run's own statement. `'adjacent'` here on a case the run published under
   * `'global-measured'` is the reading that turns a missing word into a false disagreement.
   */
  readonly scope: FailureContainmentScope;
}

/** The first element of an order, or `null` when it is empty. */
export function headOf(order: readonly string[]): string | null {
  return order.length === 0 ? null : order[0]!;
}

/**
 * Walk one case's chain.
 *
 * @param row - The case's dump row.
 * @param arm - The requirement to walk under.
 * @returns The two orders, or `null` when the row carries no chain (a dump written before it was recorded).
 */
export function replayCase(row: ContainmentCaseRow, arm: ReplayArm): ReplayedCase | null {
  const chain = row.chain;
  if (chain === undefined) return null;
  const ranking = chain.order.map((service) => ({ service }));
  // `graded` re-sorts rather than sweeps, and its refusal is a value: a case whose candidate has no score cannot
  // be ordered by score, and `null` is that statement rather than an order invented from the ones that can.
  if (arm.kind === 'graded') {
    const graded = gradeByTerm({
      order: chain.order,
      scores: arm.scores,
      transfers: arm.transfers,
    });
    if (graded === null) return null;
    return publishThroughFlows(chain, row, graded, []);
  }
  // `off` skips the sweep entirely rather than passing it an empty requirement: the pass is what the arm is
  // about, and a sweep with nothing to require is still a sweep — it inverts, and that is the `ungated` arm.
  // The two maps are read here rather than inline, so that the arm which needs the missing one REFUSES before the
  // sweep is called: an empty map would make the pass a no-op and the arm would report itself as identical to
  // `off`, which is the reading `channelSurprise` spends its refusals preventing.
  let measured: Map<ServiceId, number>;
  if (arm.kind === 'surprise') {
    const surprises = chain.surprises;
    if (surprises === undefined) return null;
    measured = new Map<ServiceId, number>(Object.entries(surprises));
  } else {
    measured = new Map<ServiceId, number>(Object.entries(chain.excursions));
  }
  const sweep =
    arm.kind === 'off'
      ? { order: ranking, verdicts: [] }
      : inspectContainmentOrder({
          ranking,
          edges: chain.edges.map(([from, to]) => ({ from, to })),
          excursions: measured,
          margin: row.margin,
          // The interface record is what the SHIPPED rule requires, and the `surprise` arm varies the measurement
          // rather than the requirement — so it carries the record, and dropping it would price a different rule.
          // `veto` carries it too and reads it at CASE scope: the same map, one word of interpretation.
          ...(arm.kind === 'shipped' || arm.kind === 'surprise' || arm.kind === 'veto'
            ? { failingEdges: new Map(Object.entries(chain.failedInterfaces)) }
            : {}),
          ...(arm.kind === 'veto' ? { recordScope: 'case' as const } : {}),
          // The `prior` arm REPLACES the failed-interface record with the residual, so a walk carrying both would
          // price the residual on the cases the record had already refused. The `veto` arm is the opposite shape,
          // and that is why it carries both: the record decides where it SPEAKS, the residual where it is SILENT.
          // One requirement per pair either way; the two are never consulted for the same one.
          ...(arm.kind === 'prior' || arm.kind === 'veto' ? { prior: arm.prior } : {}),
        });
  return publishThroughFlows(
    chain,
    row,
    sweep.order.map((entry) => entry.service),
    sweep.verdicts,
  );
}

/**
 * The order the engine publishes: the containment stage, then the failure-flow pass.
 *
 * Shared by every arm rather than repeated, because the flow pass is not what any of them vary: an arm that ran
 * its own copy could disagree about the chain it is supposed to be a change to.
 *
 * @param chain - The case's recorded inputs.
 * @param row - The case's dump row, for the margin.
 * @param containment - The containment stage's order.
 * @param verdicts - The pairs the sweep examined.
 * @returns The walked orders, the sweep's reasons, and the scope the flow pass ran at.
 */
function publishThroughFlows(
  chain: NonNullable<ContainmentCaseRow['chain']>,
  row: ContainmentCaseRow,
  containment: readonly string[],
  verdicts: readonly ContainmentVerdict[],
): ReplayedCase {
  // The scope comes from the CHAIN, not from a caller: it is part of what the run was, and a caller that passed
  // its own would be able to re-walk a run at a configuration the run never had. A chain that states none is
  // walked at the engine's default, and the fallback is REPORTED below rather than assumed silently.
  const scope = chain.scope ?? DEFAULT_FAILURE_CONTAINMENT_SCOPE;
  const published = applyFailureContainment({
    ranking: containment.map((service) => ({ service })),
    flows: new Map(Object.entries(chain.flows)),
    failingEdges: new Map(Object.entries(chain.failingEdges)),
    attribution: chain.attribution,
    scope,
  }).map((entry) => entry.service);
  return { containment: [...containment], published, verdicts, scope };
}

/**
 * Whether the replay reproduces the answer the run recorded.
 *
 * The check is on the TOP-1 rather than on the whole order because the dump stores the published top-1 and not
 * the published list. That is not a weakening: the run itself compared the complete order and wrote the verdict
 * to `replay`, and a `differs` there already disqualifies the artifact. What this adds is the second, independent
 * check a reader can make WITHOUT the run — if the chain is missing an input, the top-1 drifts and says so.
 *
 * A case the replay cannot perform is not a disagreement: `null` when the row has no chain.
 *
 * @param row - The case's dump row.
 * @param replayed - The case's replay, or `null`.
 * @returns `true` when the replay's published first candidate equals the recorded one, `null` when unanswerable.
 */
export function replayAgrees(
  row: ContainmentCaseRow,
  replayed: ReplayedCase | null,
): boolean | null {
  if (replayed === null) return null;
  return headOf(replayed.published) === row.shippedTop1;
}
