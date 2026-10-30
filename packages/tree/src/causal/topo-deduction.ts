/**
 * The topological deduction: what a node's CALLEES explain about its own anomaly.
 *
 * ## The operator
 *
 *     explained(v) = max over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
 *     charged(v)   = min(anomaly(v), explained(v)) >= gate × anomaly(v)
 *                    ? rho × min(anomaly(v), explained(v))
 *                    : 0
 *     anomaly′(v)  = anomaly(v) − charged(v)
 *
 * A node that calls nothing anomalous keeps all of its anomaly; a node whose anomaly is entirely
 * accounted for by what it calls loses `rho` of it and no more; and a node whose anomaly is only
 * PARTLY accounted for is left alone entirely, which is what `gate` decides and what §"The gate"
 * below is about.
 *
 * The `min` is inside the `rho`, not outside, and that placement is the operator: it makes the relative
 * effect `rho × min(1, explained/anomaly)`, **bounded by `rho` on every population**, while at `rho = 1`
 * it is exactly the plain subtraction `max(0, anomaly − explained)` — the influx balance this operator
 * is a relaxation of. Clamping the result instead (`max(0, a − rho·e)`) bounds nothing: for `rho·e ≥ a`
 * it removes the node's WHOLE anomaly, which is the regime that zeroed TrainTicket's cells.
 *
 * ## Why this is an EXTENSIVE operator, and why that is the whole story
 *
 * `explained` is a SUM-shaped quantity: it adds a callee's anomaly into a caller's, weighted by the
 * fraction of the caller's traffic that reaches that callee. An operator built out of it is therefore
 * defined on quantities that ADD — deviations — and it is not defined on quantities that only ORDER.
 *
 * That distinction is not academic here, because the engine's own graph builder rescales the anomaly
 * before any of this runs: `buildTopologyFaultGraph` step 1b rank-normalises it on every graph with at
 * least `anomalyNormalizeNodeThreshold` nodes, so on TrainTicket (63–69 nodes) a score is `k/(n−1)` and
 * on OnlineBoutique (12–14 nodes) it is a raw deviation of order 1–3.
 *
 * **The population law, which is the defect this module's signature exists to prevent.** On a rank
 * surface, a node at rank `k` has `a = k/(n−1)` while its callee sits at `a_c ≈ 1`, so the relative
 * effect of the deduction is
 *
 *     rho × explained / a = rho × w × (n−1) / k
 *
 * — **linear in the population**. At `rho = 0.5`, `w = 0.5` and the top rank that is 15.5× the node's
 * own anomaly, i.e. the node is zeroed; the identical weight on OnlineBoutique's deviation is a 25%
 * nudge. Same weight, same topology, same physics, a verdict that differs by the number of services in
 * the fleet. Iteration 157 measured exactly that: RE1:TrainTicket 83.2% → 77.6% and RE2:TrainTicket
 * 83.3% → 81.1% while RE1:OnlineBoutique gained, and the fault families that lost (DELAY 64.0% → 56.0%,
 * LOSS 52.0% → 32.0%) are the ones whose anomalies sit highest on the rank surface.
 *
 * ## So the function takes the space as an argument
 *
 * `anomalies` is required to be in DEVIATION space — `FaultPropagationGraph.rawAnomalyScores`, not
 * `anomalyScores` — and the result is in that same space. The caller maps it back with
 * {@link applyAnomalyNormalization}, using the graph's own `anomalyNormalization`. On a graph the
 * builder never normalised (OnlineBoutique, SockShop) this is the identity, which is why the published
 * numbers on those cells are unchanged by construction rather than by luck.
 *
 * ## The two refusals that produced the form
 *
 * The first form was a ratio, `anomaly × (1 − rho·(1 − topoSource))`, and it was refused because it
 * applies a callee's correction to the node's WHOLE anomaly: on RE3/SockShop it deducted a
 * callee-origin's own `cpu` by its caller's response anomaly, losing cases at every weight (RE1
 * 83.47% → 68.53% at `rho = 0.25`). The second form is this subtraction, and it is the one that lost
 * TrainTicket for a reason unrelated to the correction's direction — the space it ran in. Restricting
 * the deduction to {@link isResponseChannel} channels (the only ones a call boundary transmits) is
 * orthogonal to both and is carried by {@link TopoDiscountScope}.
 *
 * ## The gate, which is the one thing that document named and did not measure
 *
 * `docs/topo-discount-scope.md` §6 leaves exactly two arms unrun, and names this one:
 *
 * > …or to gate the deduction on `explained / anomaly >= θ`, so a node that a callee explains only
 * > slightly is not moved at all.
 *
 * The measurement that motivates it is the shape of the nine cells at `rho = 1`, in deviation space,
 * against a control that reproduces the shipped run case for case (`docs/anomaly-space.md` §6):
 * five cells gain eight cases and three cells lose four, for `631 → 635`. A weight cannot separate
 * those two groups — raising it gains and loses in the same direction, because the operator charges
 * every caller whose callee moves at all. What separates them is a property of the NODE rather than of
 * the configuration: a symptom's anomaly is *mostly* its callees' (that is what containment means),
 * while a source's callee accounts for a *fraction* of it, because the source's own reading is the
 * fault. `gate` is that fraction, and at `rho = 1` it turns the operator from "deduct a share" into
 * "deduct everything, but only from a node that is mostly explained" — the influx balance of §"The
 * operator" with a support condition instead of a linearisation.
 *
 * **`gate = 0` is not a small default, it is the operator without the gate**, because
 * `min(a, e) >= 0` holds for every node. That is the same standard `topoDiscount = 0` is held to: a
 * default that had to be defended against the published cells would be a change, and this one is
 * inert by construction — no branch that can be reached, no float that can round.
 *
 * ## The share, which is what the gate reads and what the artifact could not say
 *
 * The gate's question is a ratio, so the operator returns the ratio beside the result
 * ({@link TopoDeductionResult}): `share(v) = min(a, e) / a`, capped at 1, for every node the scope let it
 * consider and whose anomaly is positive. It is a property of the NODE, not of the configuration — the same
 * share comes back at every gate — because the gate decides *whether* to charge and the share says *how
 * much* was explained. Reporting it is what turns "run a grid and see which cells move" into "read why this
 * case moved", and it is the only quantity that can be read on a case the deduction REMOVED from the
 * candidate pool, since such a node has no post-deduction score to report at all.
 *
 * @module causal/topo-deduction
 */

import type { AnomalyNormalization, CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import { invariant, invariantFinite, invariantRange } from '@agentix-e/micro-kinetic-core';

import type { TopoDiscountScope } from './topology-fault-graph.js';
import {
  isResponseChannel,
  minMaxNormalizeScores,
  rankNormalizeScores,
} from './topology-fault-graph.js';

/**
 * The three inputs the deduction reads, named as a structural type so a test can build one without a
 * whole `FaultPropagationGraph`.
 */
export interface TopoDeductionInput {
  /** Anomalies in DEVIATION space — a quantity that adds. */
  readonly anomalies: ReadonlyMap<ServiceId, number>;
  /** The call graph's edges; `propagationWeights` is aligned with this array. */
  readonly edges: readonly CallEdge[];
  /** Per-edge propagation weights, indexed as `edges`. */
  readonly propagationWeights: Float64Array;
  /**
   * Per-node dominant metric, read only for its LABEL: which channel a node is anomalous on decides
   * whether a call boundary can transmit it at all.
   */
  readonly dominantMetrics?: ReadonlyMap<ServiceId, { readonly label: string }>;
}

/**
 * What the operator decided, per node — the deduction's result AND the quantity its gate reads.
 *
 * ## Why the share travels with the result rather than being recoverable from it
 *
 * `discounted` is a single number per node, and a reader holding only it cannot say whether the node was
 * left alone because nothing explained it, because the scope excluded it, because the gate refused it, or
 * because `rho` was 0. Those are four different facts about four different objects — a corpus, a
 * configuration, a threshold, a weight — and an artifact that records only the post-deduction anomaly files
 * all four as the same reading. Iteration 195 hit exactly that wall: the one cell the gate could not repair
 * needed the pre-deduction anomaly of a single case, and no artifact carried it, so the next arm had to be
 * chosen by running a grid and watching cells move instead of by reading a mechanism.
 *
 * `share` is therefore the operator's own answer to its own gate's question, in the space the operator works
 * in: `min(a, e) / a`, capped at 1, for every node the scope let it consider and whose anomaly is positive.
 *
 * ## The two absences, which are not a zero
 *
 * A node the scope never considered has NO entry: `external` scope declining to explain a `cpu` reading is a
 * fact about the configuration, and a 0 would report it as a fact about the corpus ("its callees explained
 * nothing"). A node with no anomaly has no entry either, because a fraction of nothing is not a quantity.
 * Both absences are therefore reportable as absences, which is what lets a consumer distinguish a threshold
 * that refused a measured share from a subject the operator never looked at.
 */
export interface TopoDeductionResult {
  /** The anomaly map the ranking should read, in the same space as the input. */
  readonly discounted: ReadonlyMap<ServiceId, number>;
  /** `min(anomaly, explained) / anomaly` for every node the operator considered with `anomaly > 0`. */
  readonly share: ReadonlyMap<ServiceId, number>;
}

/**
 * What the deduction measured, and the threshold this run judged it against.
 *
 * The two travel together because a share without its gate cannot be read: 0.62 is "charged" at a gate of
 * 0.5 and "refused" at 0.75, so an artifact carrying only the value would need the run's configuration line
 * to interpret its own evidence — and a record that needs an outside document to be legible is the defect
 * `truthEvidence` exists to avoid for the self-anomaly term.
 */
export interface TopoDeductionAudit {
  /** The share, in DEVIATION space, as {@link deductExplainedAnomalies} computed it. */
  readonly share: ReadonlyMap<ServiceId, number>;
  /** The gate the share was compared with, so the record can be judged against the cut that produced it. */
  readonly gate: number;
}

/**
 * Deduct what a node's callees explain about its own anomaly.
 *
 * @param input - Anomalies in deviation space, the edges, and their weights.
 * @param rho - How much of the explained part to remove, in [0, 1].
 * @param scope - Which channels may explain and be explained through.
 * @param gate - The smallest share `min(a, e) / a` at which the operator runs on a node, in [0, 1].
 *   `0` charges every node a callee explains at all, which is the ungated operator and the shipped
 *   behaviour; a larger value leaves a mostly-unexplained node entirely alone. Required rather than
 *   defaulted, on the rule the engine's other shipped values follow: a parameter whose callers can
 *   omit it is a parameter that silently takes a value nobody declared.
 * @returns The discounted map and the share it was discounted by, both in the SAME space as
 *   `input.anomalies`; the input is untouched.
 * @throws RangeError if `rho` or `gate` is outside [0, 1] or not finite, or if the weight vector is not
 *   aligned with the edges.
 */
export function deductExplainedAnomalies(
  input: TopoDeductionInput,
  rho: number,
  scope: TopoDiscountScope,
  gate: number,
): TopoDeductionResult {
  // `invariantFinite` first: `invariantRange` cannot see NaN — `NaN < 0` and `NaN > 1` are both false,
  // so a NaN weight would pass a range check and poison every anomaly downstream.
  invariantFinite(rho, 'topoDiscount');
  invariantRange(rho, 0, 1, 'topoDiscount');
  // The gate is checked the same way and for the same reason, and the failure it prevents is the
  // quieter of the two: a NaN gate makes `min(a, e) >= NaN` false on EVERY node, so the deduction
  // switches itself off while the configuration line reports it on.
  invariantFinite(gate, 'topoDiscountGate');
  invariantRange(gate, 0, 1, 'topoDiscountGate');
  // The weight vector is aligned with the edge array by construction upstream, and this function is
  // public: a caller that hands over a shorter vector would otherwise read `undefined` and produce a
  // NaN anomaly, which no ranking can see. The check is the contract, stated where the contract is.
  invariant(
    input.propagationWeights.length === input.edges.length,
    `propagationWeights must match edges length (${input.propagationWeights.length} vs ${input.edges.length})`,
  );

  // One predicate for BOTH sides of the deduction: the channel a callee may explain THROUGH and the
  // channel a caller may be deducted ON are one question, and two predicates would be free to disagree
  // about which channels cross a call boundary.
  const explicable = (nodeId: ServiceId): boolean => {
    if (scope === 'all') return true;
    const dominant = input.dominantMetrics?.get(nodeId);
    return dominant !== undefined && isResponseChannel(dominant.label);
  };

  // The largest single-callee explanation per caller. A maximum rather than a sum: the caller's
  // traffic splits across its callees, so the fractions do not compose into a total — and a sum would
  // let two mildly anomalous callees out-explain one that is entirely responsible.
  const explained = new Map<ServiceId, number>();
  for (let i = 0; i < input.edges.length; i++) {
    const edge = input.edges[i]!;
    if (!explicable(edge.to)) continue;
    const weight = input.propagationWeights[i]!;
    if (!(weight > 0)) continue;
    // A callee CAN be an edge endpoint and carry no anomaly at all — a node with no telemetry explains
    // nothing — so this default is reachable and stays.
    const calleeAnomaly = input.anomalies.get(edge.to) ?? 0;
    if (!(calleeAnomaly > 0)) continue;
    const value = weight * calleeAnomaly;
    const current = explained.get(edge.from);
    if (current === undefined || value > current) explained.set(edge.from, value);
  }

  const discounted = new Map<ServiceId, number>();
  // The share the gate reads, recorded as it is computed rather than re-derived by a consumer: `capped`
  // already holds the capped explanation, and a second division outside this loop would be a second answer
  // to the same question — the shape this repository's analyzer exists to find.
  const share = new Map<ServiceId, number>();
  for (const [nodeId, anomaly] of input.anomalies) {
    if (!explicable(nodeId)) {
      discounted.set(nodeId, anomaly);
      continue;
    }
    // A PART CANNOT EXCEED THE WHOLE. When the linearisation says a callee explains more than its
    // caller's entire anomaly, the linearisation has broken down; the admissible reading is "entirely
    // explained", not "explained by six times as much". Capping the EXPLAINED quantity inside the
    // weight — rather than clamping the subtraction's result at zero — is what makes the relative effect
    // `rho × min(1, e/a)` bounded by `rho`, which an unclamped subtraction has only while the
    // subtrahend happens to stay small.
    const capped = Math.min(anomaly, explained.get(nodeId) ?? 0);
    // The gate reads the SAME capped quantity the charge does, so the two halves of one sentence cannot
    // disagree about how much was explained: with `e = 10` against `a = 2` the raw share is 5 and the
    // capped share is 1, and only the second is a share a gate inside [0, 1] can express. Written as a
    // comparison against `gate × anomaly` rather than as a ratio of the two because `anomaly`
    // is not guaranteed positive — a node with no anomaly must read `0` at every gate, and a division
    // would answer `NaN` there and silently switch the deduction off for it. A non-positive anomaly is
    // admitted unconditionally for the same reason: a share of a non-positive whole is not a quantity,
    // and the charge it would gate is `rho × min(a, e) ≤ 0`, which the branch below already absorbs.
    const chargeable = anomaly <= 0 || capped >= gate * anomaly ? rho * capped : 0;
    // Written as a branch rather than a clamp at zero so a fully explained node reads exactly `0` and
    // never `-0`, which the ranking's tie-break would see as a different value from a node whose anomaly
    // genuinely was zero. The clamp that matters is on the EXPLAINED side, above: with `chargeable ≤ rho·a`
    // the subtraction cannot go negative except by float error at `rho = 1`, which the branch absorbs.
    discounted.set(nodeId, chargeable >= anomaly ? 0 : anomaly - chargeable);
    // Recorded for every node the operator considered with something to explain, INCLUDING one the gate
    // refused: the gate's refusal is a decision about a share, and a record that only carried the share of
    // the nodes that were charged could not say whether a threshold was above or below a given node's value
    // — which is the one question the instrument exists to answer. A non-positive anomaly is skipped rather
    // than filed as 0, because a fraction of nothing is not a quantity and the 0 would read as a measurement.
    if (anomaly > 0) share.set(nodeId, capped / anomaly);
  }
  return { discounted, share };
}

/**
 * Map a deviation-space score map into the space a graph reports its anomalies in.
 *
 * This is the inverse direction of `buildTopologyFaultGraph` step 1b, and it is the same three cases
 * for a reason: an operator that took its input out of the reported space has to put its output back
 * into it, or the ranking reads a score in one unit and the rest of its terms in another.
 *
 * @param scores - Scores in deviation space.
 * @param mode - The graph's own `anomalyNormalization`.
 * @returns The scores as the graph would have reported them.
 */
export function applyAnomalyNormalization(
  scores: ReadonlyMap<ServiceId, number>,
  mode: AnomalyNormalization,
): Map<ServiceId, number> {
  switch (mode) {
    case 'rank':
      return rankNormalizeScores(scores);
    case 'minmax':
      return minMaxNormalizeScores(scores);
    case 'none':
      return new Map(scores);
  }
}
