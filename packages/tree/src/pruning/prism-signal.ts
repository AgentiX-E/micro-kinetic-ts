/**
 * PRISM ranking-fusion signal.
 *
 * Fuses PRISM's graph-free internal/external asymmetry (arXiv:2601.21359)
 * into the collision-tree engine as an eighth ranking prior. PRISM localises
 * the root cause from per-service metric time series ALONE — no topology — so
 * it is genuinely complementary to the topology-aware collision/topo/trace
 * signals: it sees a root cause as anomalous in BOTH internal properties
 * (cpu / memory / disk / socket) AND external properties (latency / error /
 * throughput), while a downstream symptom is external-only.
 *
 * The signal is deliberately INDEPENDENT of the engine's anomaly scoring:
 * it reuses the shared PRISM primitives from `@agentix-e/micro-kinetic-core`
 * (`classifyMetricChannel`, `deviationZScore`, `combinePrismScore`) rather than
 * the engine's own deviation/trend/cv/burst feature pipeline, so it contributes
 * a signal the engine's self-anomaly term cannot already see.
 *
 * ## Formula
 *
 * For each graph member v:
 *
 *   S^I(v) = max over internal metrics  of |mean_fault − mean_baseline|/scale
 *   S^E(v) = max over external metrics of |mean_fault − mean_baseline|/scale
 *   M(v)   = combinePrismScore(S^I(v), S^E(v), pooling)
 *   prismScore(v) = M(v) / max_w M(w)   ∈ [0, 1]
 *
 * The map is MAX-NORMALISED to [0, 1] (like the log/topo signals) so the
 * fusion weight is dimensionally comparable to the other priors. It is EMPTY
 * (neutral) when the injection time is unknown or when no service carries any
 * deviation — the caller then contributes nothing, exactly as the other
 * opt-in signals do.
 *
 * @module pruning/prism-signal
 */

import type { ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  classifyMetricChannel,
  combinePrismScore,
  DEFAULT_PRISM_POOLING,
  deviationZScore,
  type PrismPooling,
} from '@agentix-e/micro-kinetic-core';

/**
 * The pooling vocabulary, re-exported beside the signal that consumes it.
 *
 * The census and its guard live in `core` because `combinePrismScore` is shared with the standalone
 * evaluator (one union, one owner — see {@link PRISM_POOLINGS}). They are surfaced here so a runner
 * reads its own pooling vocabulary from the same module it reads `computePrismScores` from, which is
 * how `--onset-shape` and `--log-signal-mode` are parsed: through the guard that owns the union rather
 * than through a cast or a hand-written pair.
 */
export {
  DEFAULT_PRISM_POOLING,
  isPrismPooling,
  PRISM_POOLINGS,
} from '@agentix-e/micro-kinetic-core';
export type { PrismPooling } from '@agentix-e/micro-kinetic-core';

/**
 * The two channels' pooled deviations for one component, and whether it carries internal telemetry at
 * all.
 *
 * `hasInternal` is not decoration: a component with NO internal series and a component whose internal
 * series did not move both produce `internal === 0`, and the two mean different things. An axiom about
 * internal properties cannot be applied to a component that has none — the rule the self-time term
 * records as "unknown is not a measured zero" — so the flag travels beside the number rather than being
 * re-derived by every consumer.
 */
/**
 * Which fleet-relative comparison the dual-family gate applies — see {@link DUAL_FAMILY_GATE_MODES}.
 *
 * A string union rather than a boolean because the two members are different STATEMENTS about a fleet, not a
 * switch on one: `min` asks "is this component's weaker family comparable to the best joint candidate's?", and
 * `channel` asks PRISM's question — "is each of its families strong against that family's own champion?".
 */
export type DualFamilyGateMode = 'min' | 'channel';

export interface ChannelExtremes {
  /** `S^I`: the largest internal deviation, 0 when none moved or none exist. */
  readonly internal: number;
  /** `S^E`: the largest external deviation, 0 when none moved. */
  readonly external: number;
  /** Whether the component carries any internal property at all (cpu/mem/disk/socket). */
  readonly hasInternal: boolean;
}

/**
 * Pool every graph member's per-channel deviations — the ONE place the internal/external split is
 * walked, shared by {@link computePrismScores} and {@link computeChannelSymmetry}.
 *
 * Restricted to `nodeIds` (a series for a service absent from the call graph cannot contribute a ranking
 * signal) and gated on a known injection time (PRISM needs the clean pre-injection baseline to split the
 * windows). Empty when there is nothing to measure.
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (Unix ms; 0 = unknown → empty).
 */
export function computeChannelExtremes(
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): Map<ServiceId, ChannelExtremes> {
  const out = new Map<ServiceId, ChannelExtremes>();
  if (injectTimeMs <= 0 || metrics.size === 0 || nodeIds.size === 0) return out;
  for (const nodeId of nodeIds) {
    const series = metrics.get(nodeId);
    if (!series || series.length === 0) continue;
    let internal = 0;
    let external = 0;
    let hasInternal = false;
    for (const ts of series) {
      const s = deviationZScore(ts, injectTimeMs);
      if (classifyMetricChannel(ts.label) === 'internal') {
        hasInternal = true;
        if (s > internal) internal = s;
      } else if (s > external) {
        external = s;
      }
    }
    out.set(nodeId, { internal, external, hasInternal });
  }
  return out;
}

/**
 * The internal/external SYMMETRY of each graph member's anomaly, in [0, 1] — PRISM's axiom as a MASK.
 *
 * ```
 *   sym(v) = hasInternal(v) && S^I+S^E > 0 ? 2·min(S^I, S^E) / (S^I + S^E) : 1
 * ```
 *
 * 1 means the two channels moved alike (nothing to discount); 0 means only ONE channel moved, which is
 * exactly the victim signature: a fault propagates through observable interfaces and does not penetrate a
 * component's internal state, so a component with an external anomaly and no internal one is downstream
 * of something.
 *
 * **Why a mask and not a score.** The six-arm `prism_weight × prism_pooling` sweep (iteration 140, runs
 * `40341334056`…`40341401043`) measured PRISM's own conjunctive form as an ADDITIVE term: it lifts
 * RE3-TrainTicket from **15 to 24 of 30** cases — past PRISM's own 23 — while costing RE1 **37** cases,
 * because an added score at a weight that can reorder the whole ranking trades one population for
 * another. The axiom does not need to reorder anything. As a bounded multiplier on a candidate's own
 * evidence it changes the ORDER only between a component that fails the axiom and one that does not, and
 * on a population where every candidate is external-only (a pure delay fault) it is very nearly neutral
 * by construction, because it discounts them alike.
 *
 * The ratio is scale-free and threshold-free: no constant had to be invented for "how small is small",
 * which is the failure mode both the breadth gate and the trend ceiling were built to avoid.
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (Unix ms; 0 = unknown → empty).
 * @returns Per-service symmetry in [0, 1]; empty when there is nothing to measure.
 */
export function computeChannelSymmetry(
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): Map<ServiceId, number> {
  const symmetry = new Map<ServiceId, number>();
  for (const [nodeId, e] of computeChannelExtremes(metrics, nodeIds, injectTimeMs)) {
    const total = e.internal + e.external;
    symmetry.set(
      nodeId,
      !e.hasInternal || total <= 0 ? 1 : (2 * Math.min(e.internal, e.external)) / total,
    );
  }
  return symmetry;
}

/**
 * How the gate compares a component against the fleet.
 *
 * `min` (shipped) is one number per component: `min(Sⁱ,Sᵉ)` against the fleet's best JOINT candidate. `channel`
 * is PRISM's own per-family statement: `Sⁱ` against the fleet's strongest internal shift AND `Sᵉ` against its
 * strongest external one.
 *
 * The two differ exactly when a fleet's extremes live in DIFFERENT components — one service with a huge `cpu`
 * shift and another with a huge `latency` shift. `max min(Sⁱ,Sᵉ)` then collapses toward the balanced middle (it
 * can never exceed `min(max Sⁱ, max Sᵉ)`, and on a split fleet it is far below it), so the `min` bar is LOOSE
 * exactly where the fleet is heterogeneous. `channel` keeps each family's own champion as its bar, which is what
 * two earlier refusals named as the precondition for retrying PRISM's axiom at all
 * (`docs/prism-symmetry-mask.md`, `docs/self-time-share.md`).
 *
 * Exhaustive by construction: a new mode is a COMPILE error here until it is named, and the keys are the
 * vocabulary a CLI parses against.
 */
export const DUAL_FAMILY_GATE_MODES: Readonly<Record<DualFamilyGateMode, true>> = {
  min: true,
  channel: true,
};

/** The comparison {@link computeDualFamilyServices} applies when its caller names none. */
export const DEFAULT_DUAL_FAMILY_GATE_MODE: DualFamilyGateMode = 'min';

/**
 * Whether a raw argument names a gate mode.
 *
 * `hasOwnProperty.call` rather than `in`, the rule `isPrismPooling` records: a `Record` is an object, so the
 * prototype chain makes `toString`, `constructor` and `__proto__` reachable and `in` would accept all three.
 *
 * @param value - The raw string, from a flag or a dispatch key.
 */
export function isDualFamilyGateMode(value: string): value is DualFamilyGateMode {
  return Object.prototype.hasOwnProperty.call(DUAL_FAMILY_GATE_MODES, value);
}

/**
 * The components whose anomaly is PRESENT in BOTH families — PRISM's shape test as a SET, not a score.
 *
 * ```
 *   dual(v) = hasInternal(v) && Sⁱ(v) > 0 && Sᵉ(v) > 0
 * ```
 *
 * This is the shape that reaches the blocking cell — PRISM's `min(Sⁱ,Sᵉ)` finds the truth 23 times of 30
 * where this engine's magnitude ranking finds it 15 — imported as PRESENCE rather than as a number. The
 * difference is the whole of iteration 140's refusal: a score brings its own z-scale into a ranking that
 * fourteen terms already tune, so it re-weights everything; a 0/1 membership cannot claim more than the
 * weight it is given and cannot explode.
 *
 * `Sⁱ` and `Sᵉ` are the same extremes the symmetry mask reads, from the same walk, so the set and the ratio
 * cannot disagree about which channels moved. **The statistic is PRISM's own**: `computeChannelExtremes` calls
 * `deviationZScore`, the standardized mean shift the paper's `S(P)` defines. (An earlier revision of
 * `docs/re3-quiet-truth.md` §7 claimed this engine used `log₁₀(1 + ratio)` while PRISM used a z-score, and
 * made the difference the next measurement; the claim was false about the code, and
 * `prism-signal.test.ts`'s "reads PRISM's own z-score" fence pins the value so it cannot come back.)
 *
 * ## The gate, and why the population is the lever
 *
 * A membership is a CONSTANT bonus, so it can only re-order a cell in which the family is a strict subset of
 * the fleet: where nearly every candidate carries a moving channel in both families the bonus is near-uniform
 * and cannot move anything. Iteration 144 measured exactly that split — RE3-SockShop (14 candidates) 15 → 18,
 * while RE3-TrainTicket (68) stayed at 15 and FSE'26 Top@1 was byte-identical at every weight.
 *
 * `gate` is therefore the membership's POPULATION rather than its magnitude. A component is a member when its
 * weaker channel reaches `gate` × the fleet's strongest `min(Sⁱ,Sᵉ)`:
 *
 * ```
 *   m(v)   = hasInternal(v) ? min(Sⁱ(v), Sᵉ(v)) : 0
 *   dual(v) = m(v) > 0 && m(v) ≥ gate · max_w m(w)
 * ```
 *
 * At `gate = 0` this is the predicate above, to the case: `min > 0` holds exactly when both channels moved.
 * At any positive gate a zero can never clear a positive share of a positive maximum, so the gate can only
 * NARROW PRISM's conjunction — it cannot admit an external-only victim — and the family stays a strict subset
 * of the fleet however large the fleet is. The threshold is fleet-relative for the reason
 * `anomalyBreadthGate` is: an absolute floor would be a constant invented per corpus, and a relative one
 * makes the same statement about a 14-service graph and a 69-service one.
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (Unix ms; 0 = unknown → empty).
 * @param gate - Share of the fleet's strongest dual signal a component must reach, in [0, 1]; 0 = no gate
 *   (`DEFAULT_DUAL_FAMILY_GATE`), which is the membership iteration 144 enrolled.
 * @param mode - Which fleet-relative comparison the gate applies (`DUAL_FAMILY_GATE_MODES`); `min` is the
 *   shipped one, `channel` compares each family against its own champion. Both are the identity at gate 0.
 */
export function computeDualFamilyServices(
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
  gate = 0,
  mode: DualFamilyGateMode = DEFAULT_DUAL_FAMILY_GATE_MODE,
): Set<ServiceId> {
  const dual = new Set<ServiceId>();
  // The gate is read as `> 0` rather than `!== 0` because a NON-FINITE value must not be able to build a
  // family with `NaN` thresholds in it: `NaN > 0` is false, so it takes the ungated path, which is the
  // behaviour every shipped call site has. `parseUnitInterval` at the boundary refuses the value anyway.
  const gated = gate > 0;
  const extremes = computeChannelExtremes(metrics, nodeIds, injectTimeMs);

  if (mode === 'channel') {
    // Each family's own champion. Both maxima are taken over the FLEET, not over the dual members — the
    // question is what this fleet's strongest internal and external shifts are, and a component with no
    // internal telemetry contributes nothing to the first by construction.
    let maxInternal = 0;
    let maxExternal = 0;
    for (const [, e] of extremes) {
      if (e.internal > maxInternal) maxInternal = e.internal;
      if (e.external > maxExternal) maxExternal = e.external;
    }
    const thresholdInternal = gated ? gate * maxInternal : 0;
    const thresholdExternal = gated ? gate * maxExternal : 0;
    for (const [nodeId, e] of extremes) {
      // `> 0` AND `>= threshold`: at gate 0 the thresholds are 0, so the predicate is exactly PRISM's
      // conjunction — which is what makes the mode a refinement of the membership rather than a new one.
      if (!e.hasInternal) continue;
      if (e.internal <= 0 || e.external <= 0) continue;
      if (e.internal >= thresholdInternal && e.external >= thresholdExternal) dual.add(nodeId);
    }
    return dual;
  }

  let fleetMax = 0;
  const strengths = new Map<ServiceId, number>();
  for (const [nodeId, e] of extremes) {
    // `hasInternal` gates the strength for the reason the axiom gates it: a component with no internal
    // series and one whose internal series did not move both read `internal === 0`, and only the second is
    // a measurement. A component with no internal channel cannot be a member at any gate.
    const strength = e.hasInternal ? Math.min(e.internal, e.external) : 0;
    strengths.set(nodeId, strength);
    if (strength > fleetMax) fleetMax = strength;
  }
  const threshold = gated ? gate * fleetMax : 0;
  for (const [nodeId, strength] of strengths) {
    if (strength > 0 && strength >= threshold) dual.add(nodeId);
  }
  return dual;
}

/**
 * Compute the PRISM root-cause score for each graph member, max-normalised to
 * [0, 1].
 *
 * Restricted to `nodeIds` (a metric series for a service absent from the call
 * graph cannot contribute a ranking signal) and gated on a known injection
 * time (PRISM needs the clean pre-injection baseline to split the windows).
 * A graph member with no metrics, or with only flat metrics, scores 0 against
 * its anomalous peers; when NO member is anomalous the map is empty (neutral).
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (Unix ms; 0 = unknown → empty).
 * @param pooling - Combination function; defaults to {@link DEFAULT_PRISM_POOLING}
 *   (the paper's additive form). `conjunctive` gates an external-only symptom to 0.
 * @returns Per-service PRISM score in [0, 1]; empty when no signal.
 */
export function computePrismScores(
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
  pooling: PrismPooling = DEFAULT_PRISM_POOLING,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  // PRISM needs the injection instant to split the clean pre-fault baseline
  // from the post-fault observation; without it every metric reads as
  // all-post-injection (empty baseline) and deviationZScore returns 0, so the
  // signal would be a pointless constant. Return neutral instead.
  if (injectTimeMs <= 0 || metrics.size === 0 || nodeIds.size === 0) return scores;

  const raw = new Map<ServiceId, number>();
  let max = 0;
  for (const [nodeId, e] of computeChannelExtremes(metrics, nodeIds, injectTimeMs)) {
    const m = combinePrismScore(e.internal, e.external, pooling);
    raw.set(nodeId, m);
    if (m > max) max = m;
  }

  // No member carries any deviation — nothing to discriminate, stay neutral.
  if (max <= 0) return scores;

  for (const nodeId of nodeIds) {
    scores.set(nodeId, (raw.get(nodeId) ?? 0) / max);
  }
  return scores;
}
