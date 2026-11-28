/**
 * The emission term's JURISDICTION — it may reorder the nodes it measured, and it may not speak about a node
 * it could not measure.
 *
 * ## The defect this module repairs
 *
 * `computeEmissionScores` returns a SPARSE map: a service is present only when it carries both channels, both
 * series are aligned, both windows have traffic, and its per-request error rate ROSE. Absence therefore means
 * "this case cannot answer for this node" — no channel, no denominator, no rise — and the module's own record
 * spells out that a case whose best `Δλ` is below the floor yields an EMPTY map rather than a map of zeros.
 *
 * The term, however, is additive: `score += w × share(v)`, and a lookup that misses yields the neutral `0`. So
 * an absent node was scored as if it had been MEASURED AT ZERO, and a share of zero loses to every node the term
 * could measure. That is precisely the defect this repository refuses everywhere else — a rejected span is
 * absent, not a zero; a refused channel is absent, not a low score — and on the corpus it costs real cases:
 *
 * | case | shipped rank-1 | truth | why the arm lost it |
 * | --- | --- | --- | --- |
 * | `re3ob_cartservice_f1_1` | `cartservice` | `cartservice` | the truth has NO `error` channel; `frontend` does |
 * | `re3tt_ts-route-service_f1_2` | `ts-route-service` | `ts-route-service` | the same: no `error` channel |
 * | `re2ob_currencyservice_loss_1` | `currencyservice` | `currencyservice` | the truth emits 0 of 13,217 requests |
 * | `re2ss_payment_loss_1` | `payment` | `payment` | the truth emits 0 of 710 requests |
 *
 * In each of the seven cases the term disputes, the node it overturns carries NO emission reading at all. The
 * instrument has no jurisdiction there: "somebody else emits more per request" is not a contradiction of a node
 * whose emission is not measurable.
 *
 * ## The rule, stated as an ORDER rather than as a score
 *
 * A node the map cannot measure keeps the positions it holds against the nodes it was ranked against; the
 * measured nodes are then free to permute among the positions the base ranking gave to measured nodes. That is a
 * STRATIFIED sort: the number of measured nodes above any prefix of the answer is exactly the number the base
 * ranking put there, and inside the stratum the term decides.
 *
 * Two consequences are worth stating because they are what the corpus measured:
 *
 * - A measured node may still rise above an UNMEASURED one when a different measured node falls below it — the
 *   stratum keeps its positions, not its members' places. This is not a loophole: the instrument's opinion is
 *   about the stratum, and where the stratum sits is the base ranking's business.
 * - When the map is empty, or when every node is in it, the rule degenerates to the ordinary score order. An
 *   inert term must cost nothing.
 *
 * ## Why not a penalty
 *
 * The obvious alternative — subtract a constant from an unmeasured node — invents a magnitude (what constant? a
 * weight's worth? a share's worth?) and makes the answer depend on it. The jurisdiction is a statement about
 * which pairs of nodes the term may compare, and an order expresses exactly that with no free parameter.
 *
 * @module pruning/emission-jurisdiction
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

/**
 * One candidate, as the ranking sees it at the moment the emission term is applied.
 *
 * `score` includes the term's contribution and `baseScore` does not, so the two orders the rule needs are both
 * available without recomputing the score: `score − baseScore` is the term's contribution, which the pruner
 * already carries as a term breakdown.
 */
export interface EmissionJurisdictionRow {
  /** The candidate's service id. */
  readonly serviceId: ServiceId;
  /** The final score, WITH the emission term's contribution. */
  readonly score: number;
  /** The final score, WITHOUT it — the ranking the term is allowed to rearrange. */
  readonly baseScore: number;
  /** Whether the case's emission map carried this candidate at all. */
  readonly measured: boolean;
}

/** Score descending, then id ascending — the one comparator every ranking in this package uses. */
function compareRows(a: EmissionJurisdictionRow, b: EmissionJurisdictionRow): number {
  const d = b.score - a.score;
  if (d !== 0) return d;
  return a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0;
}

/**
 * Order the candidates under the emission term's jurisdiction.
 *
 * @param rows - Every scored candidate; the array is not mutated.
 * @returns A permutation of `rows`: the measured stratum permuted by `score`, every other position fixed by the
 *   order of `baseScore`.
 */
export function orderWithEmissionJurisdiction<T extends EmissionJurisdictionRow>(
  rows: readonly T[],
): T[] {
  // The base order is what the term must preserve BETWEEN strata, so it is computed from `baseScore` with the
  // same comparator rather than from the input order: a caller's array order is not an ordering.
  const baseOrder = [...rows].sort((a, b) =>
    compareRows({ ...a, score: a.baseScore }, { ...b, score: b.baseScore }),
  );
  const finalOrder = [...rows].sort(compareRows);

  // The measured stratum, in the term's own order. Its length equals the number of slots below by construction:
  // both are the count of rows with `measured`.
  const promoted = finalOrder.filter((row) => row.measured);
  let next = 0;
  const ordered = baseOrder.map((row) => (row.measured ? promoted[next++]! : row));
  return ordered;
}
