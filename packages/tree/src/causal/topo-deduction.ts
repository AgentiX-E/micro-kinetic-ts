/**
 * The topological deduction: what a node's CALLEES explain about its own anomaly.
 *
 * ## The operator
 *
 *     explained(v) = max over callees c with weight(v→c) > 0 of weight(v→c) × anomaly(c)
 *     anomaly′(v)  = anomaly(v) − rho × min(anomaly(v), explained(v))
 *
 * A node that calls nothing anomalous keeps all of its anomaly; a node whose anomaly is entirely
 * accounted for by what it calls loses `rho` of it and no more.
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
 * Deduct what a node's callees explain about its own anomaly.
 *
 * @param input - Anomalies in deviation space, the edges, and their weights.
 * @param rho - How much of the explained part to remove, in [0, 1].
 * @param scope - Which channels may explain and be explained through.
 * @returns A new map in the SAME space as `input.anomalies`; the input is untouched.
 * @throws RangeError if `rho` is outside [0, 1] or if the weight vector is not aligned with the edges.
 */
export function deductExplainedAnomalies(
  input: TopoDeductionInput,
  rho: number,
  scope: TopoDiscountScope,
): Map<ServiceId, number> {
  // `invariantFinite` first: `invariantRange` cannot see NaN — `NaN < 0` and `NaN > 1` are both false,
  // so a NaN weight would pass a range check and poison every anomaly downstream.
  invariantFinite(rho, 'topoDiscount');
  invariantRange(rho, 0, 1, 'topoDiscount');
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
    const chargeable = rho * Math.min(anomaly, explained.get(nodeId) ?? 0);
    // Written as a branch rather than a clamp at zero so a fully explained node reads exactly `0` and
    // never `-0`, which the ranking's tie-break would see as a different value from a node whose anomaly
    // genuinely was zero. The clamp that matters is on the EXPLAINED side, above: with `chargeable ≤ rho·a`
    // the subtraction cannot go negative except by float error at `rho = 1`, which the branch absorbs.
    discounted.set(nodeId, chargeable >= anomaly ? 0 : anomaly - chargeable);
  }
  return discounted;
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
