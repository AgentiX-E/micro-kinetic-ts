/**
 * TreePruner — collision tree fault propagation graph pruner.
 *
 * Implements the IRCAEngine interface, mapping Deng Yu's collision tree
 * pruning theory to AIOps root cause analysis.
 *
 * ## Algorithm (Deng Yu Mapping)
 *
 * 1. **Cycle Detection**: Enumerate all simple cycles in the fault
 *    propagation graph using Johnson's algorithm. Each cycle corresponds
 *    to a closed-loop collision trajectory C in the BBGKY hierarchy.
 *
 * 2. **Contribution Computation**: For each cycle C, compute:
 *      w(C) = ∏_{e∈C} propagationWeight(e)
 *    This is the collision cross-section product.
 *
 * 3. **Pruning**: For each cycle, remove the weakest edge (smallest
 *    propagation weight). This discards the least-probable collision
 *    trajectory and preserves the dominant fault-propagation paths.
 *
 * 4. **Tree RCA**: On the resulting acyclic tree, perform bottom-up
 *    anomaly score accumulation in O(V+E) time.
 *
 * ## Critical Load Theorem
 *
 * Deng Yu proved: if systemLoad < λ_critical, then Σw(C) ≤ K×ε.
 * This guarantees that in rarefied (low-load) regimes, residual
 * cycle contribution is bounded below the prune threshold.
 *
 * @module pruning/pruner
 */

import {
  DEFAULT_PRISM_POOLING,
  DEFAULT_RCA_OPTIONS,
  invariant,
  invariantPositiveInt,
  invariantRange,
  type BuildFaultGraphOptions,
  type DetectedCycle,
  type FaultCategory,
  type FaultEdgeLatency,
  type FaultPropagationGraph,
  type MetricMap,
  type PrismPooling,
  type PrunedEdgeRecord,
  type PrunedTree,
  type RCAEngineOptions,
  type RankingWeights,
  type RootCauseResult,
  type ScoreTerm,
  type ServiceCallGraph,
  type ServiceId,
  type ServiceNode,
  type TermSourcePresence,
  type TermZeroCause,
  type TreeNodeScore,
} from '@agentix-e/micro-kinetic-core';

import { aggregateFaultEnergy, type FaultGraphEdge } from '../causal/collision-aggregator.js';
import type { TopoClosure, TopoDeductionAudit } from '../causal/topo-deduction.js';
import {
  DEFAULT_TOPO_CLOSURE,
  applyAnomalyNormalization,
  deductExplainedAnomalies,
  isTopoClosure,
} from '../causal/topo-deduction.js';
import type {
  PoolAdmission,
  TopoDiscountScope,
  TopologyFaultGraphConfig,
} from '../causal/topology-fault-graph.js';
import {
  DEFAULT_POOL_ADMISSION,
  DEFAULT_TOPO_DISCOUNT_SCOPE,
  buildTopologyFaultGraph,
} from '../causal/topology-fault-graph.js';
import { JohnsonCycleDetector, cycleKey } from '../graph/cycle-detector.js';
import { CollisionContributionAnalyzer, buildEdgeWeightMap } from './contribution.js';
import {
  DEFAULT_DUAL_FAMILY_GATE,
  DEFAULT_DUAL_FAMILY_GATE_MODE,
  computeChannelSymmetry,
  computeDualFamilyServices,
  computePrismScores,
  type DualFamilyGateMode,
} from './prism-signal.js';
import type { FailedEdgeMode, LogSignalMode } from './ranking-signals.js';
import {
  DEFAULT_FAILED_EDGE_MIN_RECORDS,
  DEFAULT_FAILED_EDGE_MODE,
  computeDeepestExceptions,
  computeEdgeLatencyByCallee,
  computeEdgeLatencyScores,
  computeFailedEdgeScores,
  computeLogScores,
  computePoolMetricScores,
  computeRiseScores,
  computeSelfTimeScores,
  computeStabilityScores,
  computeTopoSourceScores,
  computeTraceActivityScores,
  gatedRiseContribution,
} from './ranking-signals.js';

/**
 * The total a term breakdown adds up to, in the order the terms are stated.
 *
 * This is the definition of the identity the ranking score's breakdown carries — `finalScore(v)` IS the sum of
 * its terms — and it lives HERE, beside the only code that produces either, rather than in any consumer. A
 * consumer that summed the terms itself would be a second implementation of the total, and the first thing
 * that breaks when a second implementation exists is the agreement between the two: a term added to the
 * formula would reach the total (computed one way) and not the breakdown (computed another), and the artifact
 * would report a decomposition of a number it did not produce.
 *
 * Left-to-right, so the floating-point result is the one the formula's own expression produced: addition is
 * not associative in IEEE-754, and a pairwise sum of the same terms is a different double.
 *
 * @param terms - The contributions, in formula order.
 * @returns Their sum.
 */
export function sumScoreTerms(terms: readonly ScoreTerm[]): number {
  let total = 0;
  for (const term of terms) total += term.contribution;
  return total;
}

/**
 * Name the mechanism that made a contribution zero.
 *
 * The ORDER of the tests is the design, and it is an order of how SHARP the answer is rather than of
 * likelihood: a zero weight forces the zero on its own and licenses **no** inference about the corpus, so it is
 * reported even when the input is also absent. Answering an `INPUT_*` there would send a reader to the graph for
 * a fact that lives in the configuration — and answering an ENTRY absence for a source that is not there at
 * all would send them to a map that does not exist. The three source states then follow coarsest first, because
 * each one narrows what the reader should go and look at: the map, the map's emptiness, the candidate's entry.
 *
 * @param weight - The configured weight the contribution was multiplied by.
 * @param presence - Whether the OPTIONAL source carried this candidate, and if not, at which level it did not.
 * @param masked - Whether a gate in the formula overrode a present, non-zero value.
 * @returns The cause, among the six the formula can produce.
 */
export function classifyTermZero(
  weight: number,
  presence: TermSourcePresence,
  masked: boolean,
): TermZeroCause {
  if (weight === 0) return 'WEIGHT_ZERO';
  if (presence === 'MAP_ABSENT') return 'INPUT_MAP_ABSENT';
  if (presence === 'MAP_EMPTY') return 'INPUT_MAP_EMPTY';
  if (presence === 'ENTRY_ABSENT') return 'INPUT_ENTRY_ABSENT';
  if (masked) return 'MASKED';
  return 'VALUE_ZERO';
}

/**
 * Build one ranking term, recording WHY it is zero when it is.
 *
 * The cause is decided HERE rather than by a consumer, because it is a function of facts this assembly is
 * already holding — the configured weight, whether the optional source carried the candidate and at which
 * level, and whether a gate overrode it. A consumer holding only a total would have to re-derive all of them
 * from a number, which is the same defect as restating a threshold at the reader instead of carrying it.
 *
 * `contribution` is computed from the SAME two values the previous inline expression used, so the sum is
 * unchanged to the last bit — including the two terms whose weight is negative, where `(-w) * v` and
 * `-(w * v)` are the same double.
 *
 * @param name - The term's name, as the formula spells it.
 * @param weight - The configured weight, already signed as the formula signs it.
 * @param value - The value the formula multiplies, with any neutral substitution ALREADY applied — so a gated
 *   term passes its gated value and the gate is not re-derived here.
 * @param facts - Whether and at which level the source carried the candidate, the source's name, and the
 *   gate's name when one overrode a present input.
 * @returns The term, with `cause` present if and only if the contribution is exactly zero.
 */
function buildTerm(
  name: string,
  weight: number,
  value: number,
  facts: {
    readonly presence: TermSourcePresence;
    readonly source: string;
    readonly masked?: boolean;
    readonly mask?: string;
  },
): ScoreTerm {
  const contribution = weight * value;
  // `!== 0` rather than a truthiness test: a contribution of `-0` is a zero and must be attributed, and
  // `NaN !== 0` keeps a broken term visible as a broken term instead of filing it under a cause.
  if (contribution !== 0) return { name, contribution };
  const cause = classifyTermZero(weight, facts.presence, facts.masked ?? false);
  return {
    name,
    contribution,
    cause,
    // The `INPUT_` prefix is the union's own convention for "this cause names the OPTIONAL source it read", so
    // the name travels with the whole FAMILY rather than with an enumeration of its members: a fourth absence
    // level would carry its source by being named like the others, and an enumerated condition here would print
    // an empty parenthesis on the reader's side instead.
    ...(cause.startsWith('INPUT_') ? { source: facts.source } : {}),
    ...(cause === 'MASKED' && facts.mask !== undefined ? { mask: facts.mask } : {}),
  };
}

/**
 * Options for TreePruner construction.
 * Extends the core RCAEngineOptions with pruner-specific settings.
 */
export interface TreePrunerOptions extends RCAEngineOptions {
  /**
   * Weight of the BASE term — the candidate's own anomaly.
   *
   *   finalScore(v) = selfAnomalyWeight × log1p(anomaly(v)) + Σ (the priors below)
   *
   * This is the only term that is a quantity of the model rather than a prior over it: `anomaly(v)` is the
   * extensive deviation the collision picture assigns to a service, and every other term is a correction
   * applied to it. Until this field existed the coefficient was the literal `1` written into the formula, which
   * made the largest single contribution to every score the one weight no ablation could state — not even at 0.
   *
   * Default {@link DEFAULT_SELF_ANOMALY_WEIGHT} = **1**, i.e. bit-identical to the literal. A value other than 1
   * is a measurement, not a tuning: `docs/base-term-price.md` holds the sweep and the reading.
   *
   * Required, not optional, on the same rule as the pool penalty and the stability prior: the score term reads
   * it without a fallback, because an `?? 1` on a field the constructor always fills is a branch no run can
   * take and one that would read as a measurement of the ablation if it ever did.
   */
  readonly selfAnomalyWeight: number;
  /** 1-hop decay factor α ∈ (0, 1]. Default: 0.8 */
  readonly decayAlpha: number;
  /** 2-hop coupling coefficient β ∈ [0, 1]. Default: 0.3 */
  readonly decayBeta: number;
  /** Whether to use 2-hop decay model (default: 1-hop) */
  readonly useTwoHopDecay: boolean;
  /** Maximum number of cycles to enumerate */
  readonly maxCycles: number;
  /**
   * Enable Boltzmann Q(f,f) collision energy aggregation (I8-P3).
   * When disabled, the engine falls back to raw anomaly scores
   * with no collision type amplification in ranking.
   * Default: true (collision aggregation enabled).
   */
  readonly enableCollisionAggregation: boolean;
  /**
   * Weight of the source-likelihood signal in root-cause ranking.
   *
   * The ranking combines a node's self-anomaly with a dataset-agnostic
   * causality prior: a service whose anomaly ONSET precedes its causal
   * neighbours' is more likely to be the fault source (cause precedes
   * effect — Deng Yu's mean free time τ). A higher weight favours the
   * source over a larger downstream symptom. `0` disables the signal
   * (pure self-anomaly ranking).
   *
   * Default: 0 — the onset-ordering signal is opt-in. It is shipped
   * disabled because, at weight 1.0, it regressed the benchmark (#193):
   * the naive onset detection was too noisy to reliably separate source
   * from symptom, and the signal could not overcome even a small
   * self-anomaly gap. Re-enable at a low weight only after the onset
   * detector has been validated against real data.
   */
  readonly sourceWeight: number;
  /**
   * Weight of the GLOBAL injection-anchored temporal prior in root-cause ranking.
   *
   * Unlike `sourceWeight` (a LOCAL neighbour-fraction prior based on the
   * index-based, self-derived-baseline onset), this signal is anchored to
   * the fault INJECTION time: each service's onset delay after injection is
   * computed from a clean pre-injection baseline, turned into a slope by
   * {@link computeOnsetSlopes} in whatever shape `onsetShape` names, and added in
   * log1p space:
   *
   *   finalScore(v) = log1p(selfAnomaly(v)) + temporalWeight × slope(v)
   *
   * When the injection time is unknown, or fewer than two services have a
   * determined onset, every slope is 0 and the signal has no effect.
   *
   * Default {@link DEFAULT_TEMPORAL_WEIGHT}, measured as a PAIR with
   * {@link DEFAULT_ONSET_SHAPE} — and the shape is not decoration, it is what the
   * weight was measured ON. The signal's only earlier measurement at a non-zero weight
   * used the min-max `earliness` shape and was a net regression of ≈ −2.5pp on RCAEval
   * (#207/#208): the injection-anchored onset systematically anchors to the SOURCE's
   * slow-responding dominant metric (latency/socket), which crosses the 30% deviation
   * threshold LATE, while a symptom's fast metrics (workload/cpu) cross it EARLY. That
   * mechanism makes "earliest onset = source" a claim about the SHAPE, so the shape is
   * where it was answered: `earliest-only` is one-sided and cannot demote anybody.
   */
  readonly temporalWeight: number;
  /**
   * Which shape the temporal prior reads the onset delays in.
   *
   * The weight decides HOW MUCH the term matters; this decides WHAT it says. They are a
   * PAIR rather than two settings, and the pairing is measured: a weight is a claim
   * about a shape, so a value quoted without the shape it was measured on is not a
   * configuration. See {@link OnsetShape} for what each one asserts.
   *
   * Default {@link DEFAULT_ONSET_SHAPE}. Inert while `temporalWeight` is 0 — the term is
   * multiplied by the weight — which is why the shape could be enrolled, screened and
   * dispatched before the weight was chosen, and why flipping it alone can never move a
   * published number.
   */
  readonly onsetShape: OnsetShape;
  /**
   * Weight of the collision-energy signal: penalise a node whose fault energy
   * is mostly INHERITED from upstream rather than self-generated.
   *
   *   finalScore(v) −= collisionWeight × ratioContrib(v)
   *
   * `ratioContrib(v) = collisionGain / (local + collisionGain)` is the
   * fraction of v's Boltzmann fault energy coming from its parents. A source
   * generates its own fault (ratioContrib ≈ 0) and is untouched; a fan-in
   * symptom aggregates upstream faults (ratioContrib → 1) and is penalised.
   *
   * Default: 0 (opt-in). The direction of the call-graph edges is a known
   * assumption to validate via ablation — resource faults can propagate
   * callee → caller, in which case this directed penalty would misfire.
   */
  readonly collisionWeight: number;
  /**
   * Weight of the topological-source signal: reward a node whose CALLEES are healthy.
   *
   *   finalScore(v) += topoWeight × topoSource(v)
   *
   * `topoSource(v) = 1 − max over callees c of (propagationWeight(v→c) ×
   * anomaly(c))` — a source has no anomalous callee (score 1), while a caller whose callee is
   * already anomalous is explained by it (score low). This is a PURE structural signal,
   * deliberately distinct from the nonlinear collision gain so the two can be ablated
   * independently.
   *
   * **The direction was the other way round, and it was measured rather than argued.** The term used
   * to explain a node by its anomalous PARENT, which penalises the source and rewards its caller. On
   * RCAEval RE1-OnlineBoutique the old direction reads **57.6% at weight 0.5** (−24.8 pp) while the
   * corrected one reads 82.4% at the same weight and **85.6% at 0.1**. It also explains the −42.4 /
   * −37.8 / −3.1 case verdict this term carries from FSE'26: those numbers were taken with the sign
   * `docs/transient-guard-window.md`'s successor records as backwards. See
   * {@link computeTopoSourceScores} for the table.
   *
   * Default: 0 (opt-in), and that default is unchanged by the correction — a weight of zero makes
   * every direction equivalent, so no published cell moved.
   */
  readonly topoWeight: number;
  /**
   * Deduction on a node's own anomaly, by how much of it its CALLEES explain.
   *
   *   explained(v) = ⊕ over callees c of propWeight(v→c) × anomaly(c)   (⊕ = {@link topoClosure})
   *   anomaly'(v)  = max(0, anomaly(v) − topoDiscount × explained(v))
   *
   * `explained(v)` is zero for a node none of whose callees is anomalous, so a source keeps ALL of its
   * anomaly; a node whose anomaly is entirely accounted for by what it calls falls to zero at
   * `topoDiscount = 1`.
   *
   * **The form is a DEDUCTION, not a ratio, and that removed ONE defect and exposed another.** Its
   * relative effect is `topoDiscount × explained(v) / anomaly(v)`, a ratio of two quantities on the same
   * scale, which fixes the ratio form's inversion (a callee's own `cpu` anomaly is no longer deducted by
   * its caller's response). What it does NOT fix is the SPACE: the subtraction is extensive, and the
   * engine's graph builder rank-normalises the anomaly above `anomalyNormalizeNodeThreshold`, so on
   * TrainTicket `a = k/(n−1)` and the relative effect becomes `rho·w·(n−1)/k` — **linear in the
   * population**. Measured on run `40896889186`: the same weight read +1.6 pp on RE1:OnlineBoutique and
   * −5.6 pp on RE1:TrainTicket, with DELAY 64.0 → 56.0 and LOSS 52.0 → 32.0. The deduction therefore
   * runs on {@link deductedAnomalies}'s deviation-space input (`FaultPropagationGraph.rawAnomalyScores`)
   * and returns through the graph's own `anomalyNormalization`. The ADDITIVE `topoWeight` above has a
   * related defect in the other direction: at `topoWeight = 0.1` its term is 3% of one cell's score scale
   * and six rank steps of another's, and RE1-TrainTicket lost **46.4 pp** on run `40167961908`.
   *
   * **The earlier form was a ratio and it was refused twice.** `anomaly × (1 − ρ·(1 − topoSource))`
   * applies the discount to the node's WHOLE anomaly, so on RE3/SockShop it deducted the callee-origin's
   * own `cpu` anomaly by the caller's response anomaly and lost cases at every weight (RE1 83.47 → 68.53
   * at ρ = 0.25, `docs/dispatch-forwarding.md` §7; RE3/SockShop −2.5 pp at ρ = 0.25 on this corpus).
   * Restricting the deduction to {@link isResponseChannel} channels — the only ones a callee can explain
   * — removes that: RE3/SockShop is unmoved at ρ = 0.25 and 0.5 while RE1/OnlineBoutique gains, and
   * `docs/topo-discount-scope.md` records the sweep.
   *
   * Default: 1, paired with a {@link topoDiscountGate} of 1 — enrolled in iteration 163 after both
   * populations were read at the boundary: 641/735 on the golden nine cells against 631 for the zero this
   * field shipped at, with no cell and no fault type down, and `FSE'26` byte-identical on all three
   * headline numbers and all twenty-five fault types. `docs/topo-share.md` §9 is the plane that decided
   * it: every partial charge between 0 and 1 was measured and reads BELOW the boundary.
   */
  readonly topoDiscount: number;
  /**
   * Which channels {@link topoDiscount} is allowed to act on — see {@link TopoDiscountScope}.
   *
   * `external` (the default) restricts the deduction on BOTH sides to {@link isResponseChannel} channels:
   * only a response anomaly at a callee may explain, and only a response anomaly at the caller may be
   * deducted. `all` is the ablation arm, and it is the form that was refused.
   *
   * Read only when `topoDiscount > 0`, and the shipped weight is now 1, so this field is load-bearing on
   * every published number: `external` is what keeps an internal-channel anomaly (a component's own
   * machine) from being explained away by a busy callee, which is the defect the previous form paid for.
   */
  readonly topoDiscountScope: TopoDiscountScope;
  /**
   * The smallest share of a node's anomaly its callees must account for before {@link topoDiscount}
   * may charge it, in [0, 1].
   *
   *   charged(v) = min(a, e) >= gate × a ? rho × min(a, e) : 0
   *
   * `0` is the degenerate threshold: it charges every node a callee explains at all, which is the
   * operator without the gate, because `min(a, e) >= 0` holds on every node. `1` is the boundary, and it
   * is the SHIPPED value: only a node whose callees account for ALL of it is charged, which turns the
   * deduction into a filter over the candidate pool. Everything between the two is a bounded charge, and
   * it was measured and refused — `docs/topo-share.md` §9 reads the `rho × gate` plane and shows that a
   * partial charge converts a deletion into a DEMOTION rather than into a correct answer, while giving up
   * most of the fixes.
   *
   * Read only when `topoDiscount > 0`, on the same rule {@link topoDiscountScope} follows.
   *
   * Default: 1 (the boundary, which reads 641/735 on the golden nine cells against 631 for the ungated
   * operator, with no cell and no fault type down, and is byte-identical on FSE'26).
   */
  readonly topoDiscountGate: number;
  /**
   * How {@link topoDiscount}'s explanation is aggregated over a caller's callees — see {@link TopoClosure}.
   *
   *   explained(v) = max_c w·a_c   (`max`, the shipped reading)
   *   explained(v) = Σ_c   w·a_c   (`sum`, the fan-out reading)
   *
   * The two coincide on a node with one callee and differ only on a fan-out, which is exactly the shape
   * `docs/topo-share.md` §11 found in the rank-2 band: a node that calls everything and is called by nothing
   * — TrainTicket's `ts-admin-travel-service`, SockShop's `front-end` — has an anomaly that is an aggregate
   * of nine or ten callees, and a maximum over them cannot reach it however loud the loudest one is.
   *
   * The shipped reading is `max` because every published population was measured under it, and because a
   * request that takes ONE branch of its fan-out is explained by that branch alone. `sum` is the ablation
   * `docs/topo-closure.md` measures, and it is admissible on the same terms as the gate: the explanation is
   * capped at the whole inside `min(a, e)`, so a sum cannot produce a negative anomaly, and the gate still
   * decides whether a node is charged at all.
   *
   * Read only when `topoDiscount > 0`, on the same rule {@link topoDiscountScope} follows.
   *
   * Default: 'max'.
   */
  readonly topoClosure: TopoClosure;
  /**
   * Which SET of nodes the ranking may answer with — see {@link PoolAdmission}.
   *
   * The ranking has always dropped a node whose post-deduction self-anomaly is zero, which is a filter nobody
   * declared and which the topological deduction makes observable: a node it explains in full reads 0, leaves
   * the pool entirely, and its `truthRank` comes back missing rather than large
   * (`docs/topo-discount-scope.md` §7.4). This field names the filter so the filter can be measured.
   *
   * `positive` is the shipped value and the set every published figure was measured on; `graph` admits every
   * node the engine was handed. Read only where the ranking is built, so a `graph` run differs from a
   * `positive` run in the pool and nowhere else.
   *
   * Default {@link DEFAULT_POOL_ADMISSION} = **positive**.
   */
  readonly poolAdmission: PoolAdmission;
  /**
   * Weight of the log signal: reward a node whose post-injection ERROR/FATAL
   * log volume is highest.
   *
   *   finalScore(v) += logWeight × logScore(v)
   *
   * `logScore(v)` is the max-normalised count of SELF-CAUSED logic-exception
   * lines emitted at/after the fault injection time (see computeLogScores).
   * Code-level faults (uncaught exceptions, stack traces) are frequently
   * visible only in logs, so this targets the RE3 cases that metric-shape
   * signals cannot distinguish. The count is passed through the engine as
   * `BuildFaultGraphOptions.logs`.
   *
   * Default: 1.0 (enabled). Benchmark #220 measured the logic-exception-
   * weighted signal as net-positive with ZERO regression: RE2 resource
   * cascades are neutral (connectivity exceptions are excluded, so the signal
   * does not misfire onto symptoms), while RE3 code-level faults are lifted
   * (OnlineBoutique +13.4pp, SockShop +3.3pp). It is the first ranking signal
   * to ship enabled; the other causal priors remain opt-in.
   */
  readonly logWeight: number;
  /**
   * The log signal's scoring mode:
   *
   * - `count` (default): the max-normalised count of self-caused
   *   logic-exception lines per service (benchmark-validated #220).
   * - `novelty`: each logic-exception line is weighted by the inverse document
   *   frequency of its DEEPEST `Caused by:` exception class, so a service
   *   emitting a rare, specific root cause out-scores one emitting a shared
   *   HTTP wrapper (e.g. Spring's `HttpServerErrorException`).
   * - `logicHttp`: counts logic exceptions PLUS framework HTTP exceptions —
   *   the source signature of FSE'26 `HTTPResponseReplaceCode`, whose source
   *   floods `HttpClientErrorException`/`HttpServerErrorException` while the
   *   logic gate scores it 0. Lifted Top@1 +30.0pp but regressed 15 cases
   *   where a VICTIM floods the same direction-symmetric exception.
   * - `logicHttpJoint`: `logicHttp` plus a call-graph TOPOLOGY gate — the
   *   framework-HTTP half is suppressed for a service whose callee is MORE
   *   anomalous (that callee is the real source, so the emitter is a victim).
   *   Separates the replace-code source (healthy callee) from the
   *   memory/bandwidth/killed-source victim (anomalous callee). FALSIFIED
   *   (rank-normalised scores defeat the relative comparison — see
   *   docs/fse26-logicHttpJoint-falsified.md).
   * - `logicHttpDominant`: `logicHttp` plus an EMITTER-CONCENTRATION gate — the
   *   framework-HTTP half is suppressed ENTIRELY when the flood is SPREAD
   *   across many callers (a victim cascade) rather than concentrated on one
   *   emitter (a source). Rank-normalisation-proof (never compares anomaly
   *   scores). FALSIFIED before ablation (run 34482091814): the victim flood is
   *   itself concentrated ~70% of the time, so concentration does not separate
   *   source from victim — see docs/fse26-emitter-dominance-falsified.md.
   * - `all`: the max-normalised count of EVERY ERROR/FATAL line (no
   *   logic-exception gate). Targets fault classes whose SOURCE floods a
   *   propagated HTTP error (e.g. FSE'26 HTTPResponseReplaceCode).
   *
   * `novelty`, `logicHttp`, `logicHttpJoint`, `logicHttpDominant` and `all` are
   * opt-in until benchmarked; `count` is the shipped default.
   */
  readonly logSignalMode: LogSignalMode;
  /**
   * Weight of the metric-direction (RISE) signal: reward a node whose DOMINANT
   * metric rises post-injection; penalise a COLLAPSE only when the node
   * emitted NO logic exception (a silent collapse is the symptom), never when
   * it did (a logic-exception collapse is the source's own crash).
   *
   *   finalScore(v) += riseWeight × gatedRiseContribution(dir(v), hasLogicException(v))
   *
   * `dir(v)` is `2 × (direction(v) − 0.5)` and `direction(v) =
   * mean(tail) / (mean(head) + mean(tail))` of the dominant metric's
   * pre/post-injection levels (see computeRiseScores + gatedRiseContribution).
   * Default 0 (opt-in).
   */
  readonly riseWeight: number;
  /**
   * Weight of the trace-activity signal: reward the UNIQUE service whose
   * post-injection trace span count rises significantly above its pre-injection
   * count.
   *
   *   finalScore(v) += traceWeight × traceActivity(v)
   *
   * `traceActivity(v)` is `1` only when exactly one graph service qualifies as
   * a significant riser (pre ≥ 500, post ≥ 1, post/pre ≥ 1.15) AND the case is
   * a genuine silent-source fault (no graph service emitted a self-caused logic
   * exception), and `0` for every service otherwise — see
   * computeTraceActivityScores. This is the deterministic signature of a
   * SILENT-SOURCE fault (RCAEval RE3 "wrong value", e.g. TrainTicket's
   * `ts-auth-service`), which emits no exception and no error span, only a
   * workload rise visible in the span counts. The uniqueness gate keeps
   * route/latency cases (whose GT does not rise) neutral; the silent-source
   * gate keeps exception-type resource faults (OB RE3 f4, RE2 TT mem) neutral
   * so the signal defers to the log signal instead of misfiring onto a wrong
   * service.
   *
   * Default: 0 (opt-in).
   */
  readonly traceWeight: number;
  /**
   * Whether the trace vote is WITHHELD from the candidate that already holds the cell's largest self-anomaly.
   *
   * The term exists for a source the magnitude ranking cannot see — the `ts-auth-service` case it was written
   * for moved its metrics mildly and emitted no error anywhere, and its ONE signature was a rise in span count.
   * A candidate that is already the loudest needs no corroboration, and a vote landing on it is more often
   * traffic RE-ROUTED toward a loud victim than a silent source.
   *
   * Measured on TrainTicket RE3 (iteration 148, `[trace-vote] cases=30 votes=20 hits=15 (75.0%) ... wrong=5
   * decisive=5`): the vote is right three times in four, and **all five wrong votes became the top-1** — the
   * exact five cases the term-gap census charges `trace=+1.000` for. A removal arm reads the pin as worth **+10
   * cases** over the suite (61 → 51), so the term stays and this mask is the question: keep the 15, drop the 5.
   *
   * Inert at `traceWeight = 0`, which is the shipped weight on every suite but RE3.
   */
  readonly traceSkipsLeader: boolean;
  /**
   * Weight of the PRISM graph-free signal: reward a node that is anomalous in
   * BOTH its internal (cpu/memory/disk/socket) AND external (latency/error/
   * throughput) properties.
   *
   *   finalScore(v) += prismWeight × prismScore(v)
   *
   * `prismScore(v)` is PRISM's root-cause score (arXiv:2601.21359) — the
   * additive combination of the max-pooled internal S^I and external S^E
   * deviation z-scores, max-normalised to [0, 1] (see computePrismScores).
   * PRISM encodes the internal/external asymmetry: a root cause is anomalous
   * in BOTH channels while a downstream symptom is external-only, so it is
   * genuinely complementary to the topology-aware priors. It uses a DIFFERENT
   * anomaly scorer (a simple standardized mean shift over the pre/post-inject
   * windows) than the engine's own deviation/trend/cv/burst pipeline, so it
   * surfaces faults the engine's self-anomaly term cannot see.
   *
   * Default: 0 (opt-in). The fusion ceiling (union of engine + PRISM correct
   * cases = 87.5% vs 76.1%/76.7% separately) shows the two are strongly
   * complementary, so this is the highest-value fusion candidate — but it must
   * be ablated and read back net-positive with zero regression before the
   * default is flipped.
   */
  readonly prismWeight: number;
  /**
   * Which of PRISM's two combination functions `prismScore` is built with.
   *
   * `additive` (the paper's default) is `M = S^I + S^E − log1p(S^I + S^E)`: a sub-linear dampener that
   * keeps the reward for being anomalous in BOTH channels while softening a single very large score, so a
   * massive external-only symptom cannot swamp a genuine source. `conjunctive` is `M = min(S^I, S^E)`: the
   * score is GATED by the weaker channel, so a component anomalous in external properties only scores 0 —
   * the asymmetry stated as a hard prior rather than as a trade-off.
   *
   * ## Why this is an option rather than a constant
   *
   * The two poolings are not close variants of one another, and the difference is not spread evenly. The
   * controlled head-to-head (`docs/prism-head-to-head.md`, run `34246577708`, the identical 735 cases our
   * own nine cells are measured on) reads the two side by side per cell: `additive` wins overall (78.9%
   * against 69.8%) **and on every resource-fault cell**, while `conjunctive` is the ONLY pooling that
   * resolves the code-level block — **RE3 TrainTicket 76.7% against `additive`'s 33.3%**, the largest
   * single-cell margin anywhere in this repository's record, on the weakest cell of the published nine
   * (51.1%). A global choice is therefore unsupportable in either direction, which is exactly the state
   * the parameter exposes.
   *
   * ## The defect this field repairs
   *
   * `conjunctive` was ALREADY implemented — `combinePrismScore` takes it, and the standalone evaluator
   * dispatches it (`scripts/run-prism.ts --pooling conjunctive`) — but the engine's single call site
   * omitted the argument, so **every engine run, every ablation row and every workflow dispatch combined
   * additively whatever it asked for**. The table above could be published while being unreproducible from
   * the engine, and the ablation battery could not pose the question at all. An unreachable knob is an open
   * axis; this is where it becomes reachable, named on the configuration line, and measurable.
   *
   * Default {@link DEFAULT_PRISM_POOLING}, which is the value the call site already passed by OMISSION —
   * so enrolling this option moves no published number, and the nine cells are the acceptance criterion
   * for exactly that claim. The field is inert while `prismWeight` is 0, the shipped value.
   */
  readonly prismPooling: PrismPooling;
  /**
   * Weight of the failed-edge-DIRECTION signal: reward a service that its
   * callers' FAILED calls were made AGAINST (the callee of a failed edge).
   *
   *   finalScore(v) += failedEdgeWeight × failedEdgeScore(v)
   *
   * `failedEdgeScore(v)` is the max-normalised sum over edges `caller → v` of
   * `failed − baseline`, where both counts are measured on the SAME edge over
   * the post- and pre-injection windows (see computeFailedEdgeScores). It is
   * the INVERSE of the log signal: the log signal credits whichever service
   * EMITS an error — which on a propagation-carrying fault is a VICTIM that is
   * reporting its broken dependency — while this one credits the service the
   * error was emitted ABOUT, i.e. the dependency itself. That is the direction
   * the log signal cannot express, and the reason this is a separate signal
   * rather than another log mode.
   *
   * Default: 3, and the flip has both halves. The GAIN is a controlled pair on FSE'26 — Top@1 53.2% at weight 0
   * (`35416576350`) against **56.1% at weight 3** (`40072799488`), +41 cases with **zero regressed fault types**.
   * The COST is a structural zero rather than a measured one: the RCAEval corpus view the nine cells rank on
   * carries no `edgeLatency` rows at all, so the gate cannot fire there and no published cell can move —
   * `DEFAULT_FAILED_EDGE_WEIGHT`'s own docblock states the consequence, including what re-opens it.
   *
   * The term is GATED (`admitsFailedEdgeTerm`), so the ungated form's +105-with-two-regressions is not what ships.
   */
  readonly failedEdgeWeight: number;
  /**
   * How a callee's per-edge failures are aggregated: `sum` (the default and the
   * measured one) or `mean` over the distinct callers that saw failures against
   * it. `mean` removes the fan-in/volume amplification that a raw sum carries —
   * the cache averages ~211 net failures per edge, so a high-traffic symptom can
   * out-accumulate the source. Ablation switch; default `sum`.
   */
  readonly failedEdgeMode?: FailedEdgeMode;
  /**
   * Minimum contributing edges a callee needs before it is credited at all.
   * Default 1 (today's behaviour). The FSE'26 measurement is why a floor exists:
   * every one of the five regressions this signal caused had a winner with
   * exactly ONE contributing record, and max-normalisation turns that single
   * record into the full weight — so one failed call outranks a source whose own
   * anomaly is maximal. One event is not a pattern.
   */
  readonly failedEdgeMinRecords?: number;
  /**
   * Weight of the per-edge inbound latency rise.
   *
   *   finalScore(v) += latWeight × latScore(v)
   *   finalScore(v) −= poolMetricPenaltyWeight × poolMetricScore(v)
   *
   * `latScore(v)` is the largest `postMeanMs / preMeanMs` over the edges
   * `caller → v`, `log1p`-compressed and max-normalised. It is the CONTINUOUS
   * counterpart of `failedEdgeWeight`: that one counts failures, so a call that
   * became slow but still succeeded is invisible to it, and so is a case where
   * no call failed at all.
   *
   * Default: {@link DEFAULT_LAT_WEIGHT}, the measured zero-regression point. Pass
   * `0` explicitly for the ablation that scores 47.33%.
   */
  readonly latWeight: number;
  /**
   * Rise a service must clear before the latency term credits it at all.
   *
   * Default {@link DEFAULT_LAT_MIN_RISE}. A floor turns the term into a *precision*
   * instrument: a rise of 1.1× and a rise of 10× are not the same evidence, and a
   * competitor with a moderate rise of its own can be enough to displace a source
   * that the failure counts cannot see. `1` restores the credited-everything shape,
   * and is the ablation that scores 48.80%.",
   *
   * It is a MASK, not a compression, and that matters for what it can do. It removes
   * rises strictly between 1 and the floor, so the surviving maximum is always the
   * case maximum, the divisor never moves, and no slope is ever raised. The term can
   * therefore only lose votes — and it cannot remove a spurious COMPETITOR without
   * removing that same service as a CREDITEE, so a floor pays only when the evidence
   * it deletes is worth less than the interference it removes.
   *
   * A rise at or below 1 is never dropped: such a service is present with magnitude
   * 0, exactly as the shipped shape has it, so a floor of 1 is identical to the term
   * that shipped before this option existed.
   */
  readonly latMinRise?: number;
  /** The per-edge latency records the term above is computed from. */
  readonly edgeLatency?: readonly FaultEdgeLatency[];
  /**
   * Weight of the DB-connection-pool dominance PENALTY.
   *
   *   finalScore(v) −= poolMetricPenaltyWeight × poolMetricScore(v)
   *
   * `poolMetricScore(v)` is 1 when the metric that won `v`'s anomaly maximum is
   * a `db.client.connections.*` series and 0 otherwise (see
   * {@link computePoolMetricScores}) — a function of WHICH series won, not of the
   * score, so it is not one of the metric-layer shapes the register has closed.
   *
   * Default {@link DEFAULT_POOL_METRIC_PENALTY_WEIGHT} = **0.0679, the MIDPOINT of the
   * measured zero-regression window** `w ∈ (0.048823, 0.087011)`, worth **+6 cases / 0
   * lost / 0 regressed fault types** (`34949812666` off, `34949854236` on, same commit).
   * Both halves of the kill criterion were measured on that pair, and the value is a key
   * of the recorded-runs table in `fse26-reported-config.test.ts`, so moving it without
   * a run fails the suite rather than silently changing what every published number
   * means.
   *
   * Required, not optional, so the score term can read it without a fallback: an
   * `?? 0` on a field the constructor always fills is a branch no run can take, and
   * one that would read as a measurement of the ablation if it ever did.
   */
  readonly poolMetricPenaltyWeight: number;
  /**
   * Weight on the DECISIVE-STABILITY prior: rewards a node whose dominant metric's dispersion bonus
   * is the LOWEST in the case (see {@link RankingWeights.stabilityWeight}).
   *
   *   finalScore(v) += stabilityWeight × stabilityScore(v)
   *
   * Required, not optional, on the same rule as the pool penalty: the score term reads it without a
   * fallback, because an `?? 0` on a field the constructor always fills is a branch no run can take
   * and one that would read as a measurement of the ablation if it ever did.
   *
   * Ships at {@link DEFAULT_STABILITY_WEIGHT} — the midpoint of the CRITERION INTERSECTION, and
   * measured on the DEFAULT path rather than on the flag: run `35416576350` passes no input at all
   * and reads the constant's value, giving FSE'26 `757/1422` against the same-commit control
   * `35416580279` at `756` — one case, `HTTPResponseReplaceCode 160 → 161`, nothing moving the
   * other way — with the push's own golden (`35416556932`) 9 of 9 byte-identical. The FSE'26-only
   * window this intersection EXCLUDES (`[0.029860, 0.030480]`, midpoint `0.030170`) is kept on the
   * constant below as a REJECTED point rather than deleted, because a value can only be rejected
   * against the run that rejected it.
   */
  readonly stabilityWeight: number;
  /**
   * Weight on the SELF-TIME prior: rewards a service for the part of its own latency rise that no
   * callee can explain (see {@link computeSelfTimeScores}).
   *
   *   finalScore(v) += selfTimeWeight × selfTimeShare(v)
   *
   * The term exists because a caller's response time CONTAINS its callees', so on a rank-normalised
   * graph a slow callee lifts its caller further than itself. That is the mechanism
   * `docs/transient-guard-window.md` §4 names when it records that the window estimator's seventeen
   * RE1 losses are eleven single-rank-step calls decided by a CALLER's `latency-90` (25.89×) against
   * the truth's `cpu` (14.35×). The guard had been damping that advantage as a side effect of
   * discarding propagation channels; this term replaces the side effect with a mechanism.
   *
   * Ships at {@link DEFAULT_SELF_TIME_WEIGHT} = **0**, i.e. OFF, because it has no measurement yet —
   * and the docblock on that constant is where its measurement will be recorded. A weight of 0 skips
   * the map's construction entirely, so the shipped ranking is bit-identical by construction.
   */
  readonly selfTimeWeight: number;
  /**
   * Weight on the INTERNAL/EXTERNAL SYMMETRY MASK — PRISM's axiom (arXiv:2601.21359) applied as a bounded
   * discount on a candidate's own evidence rather than as an extra score.
   *
   *   finalScore(v) −= victimWeight × (1 − symmetry(v)) × log1p(selfAnomaly(v))
   *
   * where `symmetry(v) = 2·min(Sⁱ,Sᵉ)/(Sⁱ+Sᵉ)` over the component's internal (cpu/mem/disk/socket) and
   * external (latency/error/…) channels, and 1 when the component carries no internal channel at all — an
   * axiom about internal properties cannot be applied to a component that has none.
   *
   * **The form is the measurement.** Iteration 140 swept PRISM's own score as an ADDITIVE term over six
   * arms (`prism_weight` × `prism_pooling`, runs `40341334056`–`40341401043`): the conjunctive form takes
   * RE3-TrainTicket from **15 to 24 of 30** cases — past PRISM's own 23 — while costing RE1 **37**, because
   * a score added at a weight that can reorder the whole ranking trades one population for another. The
   * axiom does not need to reorder anything; it only says a component that shows an external anomaly and
   * no internal one is downstream of something. As a multiplier it can only move a candidate relative to
   * the ones that fail the axiom, and on a case where every candidate is external-only (a pure delay
   * fault) it discounts them alike and moves nothing.
   *
   * Ships at {@link DEFAULT_VICTIM_WEIGHT} = **0**, and at 0 the symmetry map is not even built, so the
   * shipped ranking is bit-identical by construction.
   */
  readonly victimWeight: number;
  /**
   * Weight on the DUAL-FAMILY presence bonus — PRISM's shape test as a bounded indicator.
   *
   *   finalScore(v) += dualFamilyWeight × 1[v has a moving channel in BOTH families]
   *
   * The blocking cell's defect is a RANK distance, not a sign: `docs/re3-quiet-truth.md` §6 measures the truth
   * at **median rank 33 of 68** on RE3-TrainTicket while the same engine puts the same corpus's truth at rank
   * 2 and rank 9 on the other two suites. A lever therefore has to lift one candidate 32 places without
   * lifting the 32 above it, and every MAGNITUDE lever measured this month moved candidates by a few places.
   *
   * The one thing that reaches this cell is a SHAPE test — PRISM's `min(Sⁱ,Sᵉ)` finds the truth 23 of 30 —
   * and the form matters: as a SCORE it brings an imported z-scale and re-weights everything (three forms
   * refused, −10 to −37 on RE1). As a 0/1 indicator it can claim at most its own weight.
   *
   * Ships at {@link DEFAULT_DUAL_FAMILY_WEIGHT} = **0.25**, ENROLLED on a sweep with no cell down (RE3 52 → 55
   * at RE1/RE2 byte-identical). At 0 — an ablation a dispatch can still state — the membership set is not built.
   */
  readonly dualFamilyWeight: number;
  /**
   * The share of the fleet's strongest dual signal a component must reach to be in the family.
   *
   *   m(v)    = hasInternal(v) ? min(Sⁱ(v), Sᵉ(v)) : 0
   *   dual(v) = m(v) > 0 && m(v) ≥ dualFamilyGate × max_w m(w)
   *
   * The weight above says WHAT the shape is worth; this says WHO has it. A constant membership can only
   * re-order a cell whose family is a strict subset of the fleet, and the enrolment's own numbers say that is
   * the exception rather than the rule: RE3-SockShop moved (15 → 18) on 14 candidates, RE3-TrainTicket did not
   * on 68, and FSE'26 was byte-identical at every weight. Making the family relative to its own maximum is how
   * the same 0/1 term stays selective as the fleet grows, and it is the construction
   * `anomalyBreadthGate` already uses — a share of the fleet maximum rather than an invented absolute floor.
   *
   * Ships at {@link DEFAULT_DUAL_FAMILY_GATE} = **0.25** in `channel` mode, ENROLLED in iteration 146: the same
   * gate in `min` mode bought RE2 +6 / RE3 +3 for RE1 −5 and was refused, while `channel` bought RE1 +4, RE2 +9,
   * RE3 +6 and FSE'26 +4.1 pp — the first arm of this campaign that costs no population anything. `0` remains a
   * legal value and is the predicate iteration 144 enrolled, which is what an ablation states.
   */
  readonly dualFamilyGate: number;
  /**
   * WHICH fleet-relative comparison that gate applies — `min` (shipped) or `channel`.
   *
   *   min:      min(Sⁱ(v), Sᵉ(v)) ≥ gate × max_w min(Sⁱ(w), Sᵉ(w))
   *   channel:  Sⁱ(v) ≥ gate × max_w Sⁱ(w)  AND  Sᵉ(v) ≥ gate × max_w Sᵉ(w)
   *
   * The difference is a property of the FLEET, not of the component: `max min` can never exceed
   * `min(max Sⁱ, max Sᵉ)` and on a fleet whose extremes live in different components it falls far below it,
   * so the `min` bar is loose exactly where the fleet is heterogeneous. `channel` gives each family its own
   * champion — PRISM's own per-family normalisation, which `docs/prism-symmetry-mask.md` and
   * `docs/self-time-share.md` both named as the precondition for a fourth attempt at the axiom.
   *
   * Both modes are the identity at gate 0, so this option cannot move a shipped cell on its own.
   * Ships at {@link DEFAULT_DUAL_FAMILY_GATE_MODE} = `channel`, the enrolment of iteration 146.
   */
  readonly dualFamilyGateMode: DualFamilyGateMode;
}

/**
 * Package the ranking fusion weights into the shared, serializable
 * {@link RankingWeights} structure. This is the single source of truth for
 * "what are the ranking weights", used by the offline optimizer (L2) to tune
 * and persist them without coupling to the engine's flat option fields.
 */
export function toRankingWeights(
  options: Pick<
    TreePrunerOptions,
    | 'selfAnomalyWeight'
    | 'sourceWeight'
    | 'temporalWeight'
    | 'collisionWeight'
    | 'topoWeight'
    | 'logWeight'
    | 'riseWeight'
    | 'traceWeight'
    | 'prismWeight'
    | 'failedEdgeWeight'
    | 'latWeight'
    | 'poolMetricPenaltyWeight'
    | 'stabilityWeight'
    | 'selfTimeWeight'
    | 'victimWeight'
    | 'dualFamilyWeight'
  >,
): RankingWeights {
  return {
    selfAnomalyWeight: options.selfAnomalyWeight,
    sourceWeight: options.sourceWeight,
    temporalWeight: options.temporalWeight,
    collisionWeight: options.collisionWeight,
    topoWeight: options.topoWeight,
    logWeight: options.logWeight,
    riseWeight: options.riseWeight,
    traceWeight: options.traceWeight,
    prismWeight: options.prismWeight,
    failedEdgeWeight: options.failedEdgeWeight,
    latWeight: options.latWeight,
    poolMetricPenaltyWeight: options.poolMetricPenaltyWeight,
    stabilityWeight: options.stabilityWeight,
    selfTimeWeight: options.selfTimeWeight,
    victimWeight: options.victimWeight,
    dualFamilyWeight: options.dualFamilyWeight,
  };
}

/**
 * Rise a service must clear before the per-edge latency term credits it.
 *
 * The shipped value, measured as a PAIR with {@link DEFAULT_LAT_WEIGHT} — and the
 * pairing is the point, because this floor is not safe on its own. At the previous
 * weight (0.03) a floor of 10.3 costs 6 cases across 6 fault types; at 0.561495 the
 * same floor gains 56 cases across 10 with none regressed.
 *
 * Why it works is structural rather than tuned. The shipped shape's zero-regression
 * window ends at 0.030459, and the single case that sets it has a target with latency
 * slope 0 against a rival at the case maximum 1 — a **maximal** gap, which no
 * pointwise reshaping of the term can widen (`--window` prints that arithmetic). A
 * floor is not a pointwise reshaping: it deletes rises instead of compressing them, so
 * it can remove a spurious competitor outright. It holds at 0.030459 until the floor
 * passes 10.283 — the rise of the one competitor that bound the window, in
 * `ts1-ts-food-service-exception-ch2v8l` — and then jumps to 0.561495, because that
 * case no longer binds.
 *
 * 10.3 rather than a round 10: the step's boundary is a solved threshold with a named
 * binder, and 10 does not reach it. Inside a step the optimum is its LOWER boundary,
 * because the cap is fixed there and a higher floor only masks more credit.
 */
export const DEFAULT_LAT_MIN_RISE = 10.3;

/**
 * The shipped weight of the per-edge latency-rise term.
 *
 * Flipped from 0 to this value only after the weight was SOLVED rather than swept:
 * the score is affine in the weight, so with both terms recorded per service in a
 * diagnostic dump the set of weights at which a currently-correct case stays correct
 * is an intersection of half-lines. The window is `w ∈ [0, 0.561495]` at
 * {@link DEFAULT_LAT_MIN_RISE}, and immediately above it the first casualty is the
 * named binder.
 *
 * The points that matter were MEASURED on the real engine, one commit and one cache,
 * only these two values different:
 *
 * | floor | weight | Top@1 | correct | regressed fault types |
 * | --- | --- | --- | --- | --- |
 * | 1 (shipped shape) | 0.03 | 47.33% | 673 | 0 |
 * | 1 | 0.03 | 48.80% | 694 | 0 |
 * | 10.3 | 0.03 (the floor ALONE) | 48.38% | 688 | **6** |
 * | **10.3** | **0.561495 (shipped)** | **52.74%** | **750** | **0** |
 *
 * The third row is why the pair ships together and why the guard in
 * `fse26-reported-config.test.ts` requires a measurement of the PAIR: each half is
 * individually defensible and only the pair is a gain. The measured 750 is exactly
 * what the reconstruction predicted.
 */
export const DEFAULT_LAT_WEIGHT = 0.561495;

/**
 * The shipped weight of the DB-connection-pool dominance penalty.
 *
 * 0.0679 — the midpoint of the measured zero-regression window, not a round number:
 * the window is `w ∈ (0.048823, 0.087011)`, bisected to 1e-6, and a value chosen at
 * either boundary is a value a converter revision can move across it.
 *
 * MEASURED on FSE'26 (`34949854236`), against the same commit with the term off
 * (`34949812666`, 750): **750 → 756, +6 cases / 0 lost, zero regressed fault types**,
 * Top@3 65.75% → 66.46%, Top@5 70.11% → 70.25%. The offline pre-screen predicted
 * exactly that split (`ContainerKill` +2, `HTTPResponseReplaceCode` +1, `JVMLatency`
 * +1, `NetworkDelay` +1, `NetworkPartition` +1) and the run reproduced it case for
 * case, which is what makes the reconstruction usable for the next candidate.
 *
 * The guard in `packages/kinetic/__tests__/unit/fse26-reported-config.test.ts`
 * requires BOTH points to be in the recorded-runs table, so this constant cannot be
 * moved to an unmeasured value.
 */
export const DEFAULT_POOL_METRIC_PENALTY_WEIGHT = 0.0679;

/**
 * Weight on the decisive-stability prior — the midpoint of the CRITERION INTERSECTION, not of the
 * FSE'26 window.
 *
 * The history is the point, because the two numbers differ by more than 4× and the first one was
 * vetoed. The FSE'26 half of the criterion was solved and positive: over all 1422 cases of run
 * `35107871516` the `rank` shape gains six cases and loses none, `w ∈ [0.029860, 0.030480]`, and
 * the solver recommended its midpoint `0.030170`. The dispatched run at that weight delivered
 * **+5 cases with zero regressed fault types** — and moved **four of the nine golden cells**, one
 * of them by 15.8pp. So `0.030170` is a REJECTED point, and it stays in the recorded-runs table as
 * data (§"keeps the REJECTED candidate on the record").
 *
 * What ships is the intersection of the criterion's two halves, computed offline by
 * `criterionVerdicts` over four artifacts (`docs/fse26-cv-screen.md` §"The criterion,
 * intersected"): FSE'26 gains its first case at `0.006672` on the `rank` shape, and the golden is
 * loss-free only below `0.008032` (`re1`'s permission). The midpoint of that region is
 * **`0.007352`**, and the dispatch at `2f10a82` confirmed BOTH halves: FSE'26 **757/1422 =
 * 53.23%** (was 756), Top@3 66.5%, Top@5 70.4%, **zero regressed fault types** (`run
 * 35411806524`), RCAEval golden **9 of 9 byte-identical** (`run 35411810992`).
 *
 * The engine's own `computeStabilityScores` is the `rank` reading of the statistic, so the weight's
 * meaning is fixed and there is no shape to pair it with — which is why the recorded-runs table is
 * keyed by the weight alone here, where the temporal prior's is keyed by a pair.
 *
 * The guard in `packages/kinetic/__tests__/unit/fse26-reported-config.test.ts` reads this constant
 * out of the source (all three of them are read as text — a typed import cannot see a disagreement
 * between two files) and requires the shipped value to be one whose recorded run has BOTH halves
 * green: `regressedTypes === 0` on FSE'26 AND `golden: 'identical'`. So the rejected point can
 * never become the default, and neither can any value nobody has run.
 */
export const DEFAULT_STABILITY_WEIGHT = 0.007352;

/**
 * The shipped weight of the BASE term — the candidate's own anomaly.
 *
 * **1**, i.e. the coefficient the formula carried as a literal for as long as the term has existed. It is
 * named here so that the one contribution every score is built on can be ABLATED, including at 0, which the
 * literal could not state.
 *
 * The value is not a tuning result and must not become one without a run: at 1 the term is the quantity the
 * kinetic model defines, and `docs/base-term-price.md` is where a sweep's readings are recorded. What the
 * constant buys immediately is that the three readers of a configuration — the engine, the two benchmark
 * runners and the artifact's own line — can disagree about it in a way a test can see, which the literal
 * made impossible.
 */
export const DEFAULT_SELF_ANOMALY_WEIGHT = 1;

/**
 * The shipped weight of the self-time term.
 *
 * **0, i.e. OFF**, and this constant is where the value stops being a bare literal and starts being a
 * name: the term's own docblock on {@link TreePrunerOptions.selfTimeWeight} carries the mechanism, and
 * the measurement that enrols it will be recorded here.
 *
 * A new term ships at 0 for the reason every other one did: the shipped ranking has to be
 * bit-identical by construction while the mechanism is being measured, so that a dispatch which states
 * the weight is the only thing that differs between two runs. The map is not even built at 0.
 */
export const DEFAULT_SELF_TIME_WEIGHT = 0;

/**
 * The shipped weight of the internal/external symmetry mask — `0`, and **REFUSED at the first weight it was
 * measured at**.
 *
 * | arm | RE1 | RE2 | RE3 | 735 |
 * | ---: | ---: | ---: | ---: | ---: |
 * | 0 (shipped) | 323 | 231 | 52 | 606 |
 * | 0.05 | 290 | 215 | 52 | 557 |
 * | 0.10 | 262 | 212 | 53 | 527 |
 * | 0.20 | 237 | 205 | 53 | 495 |
 * | 0.50 | 217 | 194 | 51 | 462 |
 *
 * On FSE'26 the same term at 0.2 reads Top@1 55.0% against 56.4% (run `40378704523`).
 *
 * **The mechanism, and it is a DEFECT in the form rather than a bad weight.** Online Boutique and Sock Shop
 * are untouched at every weight and everything happens on TrainTicket (RE1-TT 101 → 68 → 42 → 18 → 10): a
 * re-weighting has nothing to reorder on 13 edges and everything on 79. `sym` is a ratio of two quantities
 * that are not commensurable — a resource channel's relative mean shift is ~0.1σ where a transport
 * channel's is ~4σ — so the discount is near-uniform on a sparse graph and violently non-uniform on a dense
 * one, where the components that keep an internal anomaly are the CALLERS retrying rather than the source.
 *
 * The build is kept because the refusal is worth more than a deletion: `docs/prism-symmetry-mask.md` §5
 * closes the PRISM family in three forms (additive score −10 RE1, conjunctive score −37, this mask −33) with
 * one cause, and states the requirement a successor must meet — a per-family normalisation the engine does
 * not have.
 */
export const DEFAULT_VICTIM_WEIGHT = 0;

/**
 * The shipped weight of the dual-family presence bonus — **`0.25`, ENROLLED**, on a plateau that costs nothing.
 *
 * Three arms on the golden nine cells, same commit (`be40fe5`), one input each, everything else shipped:
 *
 * | dualfam | RE1 | RE2 | RE3 | 735 |
 * | ---: | ---: | ---: | ---: | ---: |
 * | 0 (was shipped) | **323** | **231** | 52 | **606** |
 * | 0.10 | **323** | **231** | **54** | **608** |
 * | **0.25** | **323** | **231** | **55** | **609** |
 * | 0.50 | **323** | **231** | **55** | **609** |
 *
 * **No cell moved down — the first arm this month of which that is true.** Every magnitude lever measured since
 * iteration 137 traded RE1 for RE3 (PRISM −10/−37, the mask −33, drop symmetry −35, the ceiling −7); this one
 * leaves RE1 and RE2 BYTE-IDENTICAL (105/117/101 and 77/85/69) and takes RE3 from 52 to 55 — all three cases in
 * SockShop (15 → 18), which is the cell whose truth carries both families.
 *
 * On FSE'26 the same weight reads Top@1 56.4% / Top@3 69.7% / Top@5 72.1% — **exactly the shipped line**
 * (run `40501641253`). The term is inert there rather than harmful: that corpus is `Resource,Pod,JVM`, so
 * almost every candidate carries a moving channel in both families and the bonus is near-uniform, which cannot
 * reorder a ranking. That is the form working as designed — a membership that fails to discriminate stays
 * silent instead of re-weighting everything.
 *
 * 0.25 is the LEFT EDGE of the plateau (0.25 and 0.50 both read 609), taken on the rule the breadth gate
 * established: the smallest weight that reaches the measured value is the one that leaves the most room before
 * the next mechanism starts to matter.
 */
export const DEFAULT_DUAL_FAMILY_WEIGHT = 0.25;

// Re-exported beside the option that consumes it: the two runners import this module directly rather than the
// barrel, and a vocabulary a CLI cannot import is a vocabulary no flag can be parsed against.
export {
  DEFAULT_DUAL_FAMILY_GATE,
  DEFAULT_DUAL_FAMILY_GATE_MODE,
  DUAL_FAMILY_GATE_MODES,
  isDualFamilyGateMode,
} from './prism-signal.js';
export type { DualFamilyGateMode } from './prism-signal.js';

/**
 * How the temporal prior turns onset delays into an order.
 *
 * `earliness` is the shipped shape and the only one the engine rendered until the
 * offline screen measured the alternatives: it is min-max normalisation of the DELAY,
 * so one service that moves a minute late compresses every other service's earliness
 * onto ≈ 1. The others exist because "no admissible weight on this shape" is a weaker
 * statement than "no admissible weight on any declared shape", and a screen that only
 * tried one would leave the axis open on a technicality.
 *
 * - `earliness` — min-max in the delay; earliest 1, latest 0.
 * - `order` — the same ORDER with the magnitude discarded: linear in the onset RANK.
 * - `earliest-only` — credit only the service(s) that moved FIRST, and nothing else.
 *   A MASK on the onset, which the register notes a rise floor cannot build: there,
 *   the spurious competitor and the credited source are the same service.
 * - `latest-only` — the CONTROL. The premise is that cause precedes effect, so a shape
 *   that helps while inverted would falsify it; without this arm a screen cannot tell
 *   a working term from a working term with the sign flipped.
 *
 * Shipped is `earliest-only`, and the reason the shape and not the weight is the lever
 * is measured: the two-sided shapes cannot help here. At `w = 0.5` with `earliness`,
 * the signal was a net regression of ≈ −2.5pp on RCAEval (#207/#208) because the
 * injection-anchored onset systematically anchors to the SOURCE's slow-responding
 * dominant metric — latency and socket cross the 30% deviation threshold LATE — while a
 * symptom's fast metrics (workload, cpu) cross it EARLY. "Earliest onset = source" is
 * therefore a claim about the shape, and a two-sided normalisation is punished by the
 * mechanism rather than by the noise. `earliest-only` is ONE-SIDED: it credits the first
 * mover and cannot demote anybody, which is why the failure mode above is structurally
 * unavailable to it — and why it is the only shape of the four with an admissible weight
 * on FSE'26 (`docs/fse26-onset-verdict.md`).
 */
export type OnsetShape = 'earliness' | 'order' | 'earliest-only' | 'latest-only';

/** Every shape, in the order the screen reports and the CLI documents them. */
export const ONSET_SHAPES: readonly OnsetShape[] = [
  'earliness',
  'order',
  'earliest-only',
  'latest-only',
];

/**
 * The shipped SHAPE of the injection-anchored temporal prior — inert, because the weight
 * is 0.
 *
 * `earliest-only` was the shape the FSE'26 screen solved a zero-loss window for
 * (`+4 cases`), and it shipped — then the golden suite rejected it (see
 * {@link DEFAULT_TEMPORAL_WEIGHT}). The default is the engine's original normalisation
 * because that is the shape every published number was measured with and a weight of 0
 * makes the field inert either way: leaving the rejected candidate as the default would be
 * an opinion the measurement does not support.
 */
export const DEFAULT_ONSET_SHAPE: OnsetShape = 'earliness';

/** Whether a string names a declared shape; the CLI parses through this, not a cast. */
export function isOnsetShape(value: string): value is OnsetShape {
  return (ONSET_SHAPES as readonly string[]).includes(value);
}

/**
 * The shipped weight of the injection-anchored temporal prior. **0 = off**, and the axis
 * is closed by a rejection rather than by an absence.
 *
 * It was shipped once, at `0.036552` with `earliest-only` — a value SOLVED rather than
 * swept (the term is affine in this weight, so the zero-loss window is a closed interval;
 * it was `w ∈ [0.034920, 0.038183]` on 1422 FSE'26 cases, and the midpoint rule is the one
 * the pool penalty shipped under). The FSE'26 half of the shared kill criterion passed
 * completely, at case granularity: `760` against the control's `756`, three fault types up
 * by 1/2/1, **zero regressed**, and the run flipped exactly the four datapacks the screen
 * had named in advance with none broken.
 *
 * The RCAEval half failed, and that is why the value is 0:
 *
 *     cell      recorded  at the shipped pair
 *     RE1 TT       68.0        27.2      (−40.8)
 *     RE2 TT       68.1        25.7      (−42.4)
 *     RE1 OB       80.0        79.2
 *     RE3 SS       45.0        47.5      (+2.5)
 *     other five   —           unchanged
 *
 * Six of nine cells moved, two of them by ~41pp, reproduced identically on a second run of
 * the same engine (`35029285379`, `35030365430`). The mechanism was on record before the
 * attempt and is now measured: on RCAEval the injection-anchored onset anchors to the
 * SOURCE's slow-responding dominant metric, so "whoever moved first" is systematically a
 * symptom — which is exactly why the two-sided shapes had no admissible weight either, and
 * why a one-sided mask cannot rescue the signal on that benchmark.
 *
 * One owner for the value, so the pruner's default and every runner's parsed fallback
 * cannot disagree — the defect that once published a headline 24.2pp below the
 * best-measured one. `fse26-onset-verdict.md` §8 carries the whole record; the register
 * row points at the −40.8 rather than at the FSE'26 gain, because the criterion is BOTH
 * halves.
 */
export const DEFAULT_TEMPORAL_WEIGHT = 0.0;

/**
 * Weight on the log signal, the largest term in the ranking and the first to ship enabled.
 *
 * Benchmark #220 measured it as net-positive with zero regression — RE2 resource cascades are
 * neutral (connectivity exceptions are excluded, so the signal does not misfire onto symptoms)
 * while RE3 code-level faults are lifted (OnlineBoutique +13.4pp, SockShop +3.3pp) — and it has
 * been 1.0 ever since.
 *
 * One owner, and it was the LAST value here to get one. Every other shipped weight was given an
 * exported constant when it acquired a second owner; the log weight was a bare `1.0` in four
 * files — this default, each parser's parsed default, and each parser's `parseWeight` fallback —
 * with nothing to compare them against. Both workload descriptions quote it ("empty = the runner
 * default, which is the measured 1.0"), so a guard on those descriptions could only be satisfied
 * by typing a fourth literal into a test. The one that found it is
 * `packages/kinetic/__tests__/unit/fse26-reported-config.test.ts`, whose `DESCRIBES_SHIPPED` table
 * was the only entry in it not read from an owner.
 */
export const DEFAULT_LOG_WEIGHT = 1.0;

/**
 * The log-signal mode the engine ships when the caller names none.
 *
 * The same shape of second owner {@link DEFAULT_LOG_WEIGHT} was extracted for, one option over: this
 * value was the bare literal `'count'` here, and a runner that reads the option (the RCAEval half needs a
 * fallback for a malformed mode, so it must state the shipped value somewhere) held its own `'count'`
 * beside it with nothing to compare the two against. Naming it once means a caller cannot describe a
 * configuration the engine does not ship — which is the same guarantee every other shipped default has.
 *
 * The two callers that need it are the RCAEval half's own field default and its rejected-mode fallback —
 * which used to reach it through a local alias, `DEFAULT_RCAEVAL_LOG_SIGNAL_MODE`, whose single line was
 * `= DEFAULT_LOG_SIGNAL_MODE`. The alias is gone as of iteration 98: a second NAME for one value is what
 * `docs/ranking-default-owners.md` refuses, because the census resolves a name and an alias resolves to
 * another name rather than to the owner — and the ablation runner's configuration line reads this constant
 * directly.
 */
export const DEFAULT_LOG_SIGNAL_MODE: LogSignalMode = 'count';

/**
 * Weight on the trace-activity prior, the THIRD instance of the class {@link DEFAULT_LOG_WEIGHT} was
 * extracted for and the one `docs/dispatch-surface-audit.md`'s Finding 6 recorded as its residue.
 *
 * **That count is history, not an inventory.** Nothing may be inferred from "third": the census in
 * `docs/ranking-default-owners.md` reverted to the tree as it stood before iteration 98 and found the class
 * still had nineteen declaration sites over twelve knobs — six of them with no name at all, and two of them
 * in THIS constant's own four owners, because the field default each parser resolves the no-flag path to was
 * left as a bare `0` while the fallback and the workflow description were moved onto the name. A comment that
 * counts a growing list is a copy the list does not own (the register's law 16), so the inventory lives in
 * `packages/kinetic/__tests__/unit/ranking-default-owners.test.ts` and this sentence points at it.
 *
 * It shipped as a bare literal in **four** places — the engine's own `DEFAULT_TREE_PRUNER_OPTIONS`, each
 * parser's field default, and each parser's `parseWeight` fallback — none of which was a name, so there was
 * nothing for a guard to compare the value against. The consequence was concrete rather than tidy: the RCAEval
 * workflow's `trace_weight` description could not state its default as a NUMBER, because a description that
 * quotes a number has to name the constant it came from, and there was none. Its description stated the default
 * in words instead, which is honest and uncheckable.
 *
 * **`0` is the engine's shipped value and the one the golden RE3 job OVERRIDES.** That job pins `1` on its own
 * command line — a workflow-side value this module cannot own, because it is a per-invocation configuration
 * rather than the engine's default — so a reader holding only this constant cannot tell which of the two a run
 * used. `formatSignalLine` prints the value the run actually resolved to, which is what makes the two
 * distinguishable on an artifact; the constant answers the other question, "what does the engine ship".
 *
 * Measured on the golden corpus, and the reason the value matters beyond bookkeeping: the trace term is BINARY
 * (`0` or `1`, no magnitude) while the base term's adjacent-rank gap on rank-normalised TrainTicket is
 * `0.0083` at 68 nodes, so the term can override ~100 rank positions, and on the 735 cases it moved a deciding
 * gap ten times — **never in the truth's favour**. See `docs/rank-collapse-falsified.md` for the scale argument
 * and the RE3 pin's own evidence.
 */
export const DEFAULT_TRACE_WEIGHT = 0.0;

/**
 * The shipped value of {@link TreePrunerOptions.traceSkipsLeader}, which is `false`.
 *
 * Opt-in because it was never the term's premise: the gate was written for a SILENT source and measured on one,
 * and the leader mask is a refinement of WHO the vote may be paid to that has to earn its place on the nine
 * cells like every other lever this campaign has priced.
 */
export const DEFAULT_TRACE_SKIPS_LEADER = false;

/**
 * The shipped defaults of the ranking knobs that had **no name**, and the reason they now have one.
 *
 * `DEFAULT_LOG_WEIGHT`, `DEFAULT_LOG_SIGNAL_MODE` and `DEFAULT_TRACE_WEIGHT` were extracted one at a
 * time, each after an incident, and each extraction was a HAND-FIX of the instance someone had noticed.
 * The class was recorded in prose — `DEFAULT_TRACE_WEIGHT`'s own docblock calls itself "the THIRD instance
 * of the class" — so the count was a copy of a list the list did not own, which is the shape
 * `docs/closed-axes-register.md` names as law 16. Six members were still unnamed when the count was
 * written, and `docs/ranking-default-owners.md` is the census that found them: `topoWeight`,
 * `collisionWeight`, `prismWeight`, `collapseDiscount`, `suppressIdleTransients` and
 * `suppressNearZeroBaselineRise` each declared their shipped value as a bare literal in the engine's own
 * defaults table AND in both parsers' option objects — **eighteen declaration sites, zero names** — while
 * both workflows' input descriptions quoted the number.
 *
 * The names below are what makes the value comparable. Nothing about the ENGINE changes with them: every
 * literal they replace already held the same number, so the acceptance is exact rather than argued (nine
 * golden cells and the whole `signals:` line byte-identical), and what the names buy is that the census in
 * `packages/kinetic/__tests__/unit/ranking-default-owners.test.ts` can now require EVERY knob declared in
 * more than one file to be declared by name.
 */
export const DEFAULT_TOPO_WEIGHT = 0.0;

/**
 * The shipped topological DISCOUNT — off.
 *
 * A name rather than a literal in two files, for the reason `DEFAULT_TOPO_WEIGHT` has one: the value is
 * written in the engine's defaults table and in both runners' option objects, and a numeric literal in
 * each is a class of drift this repository has a census for (`docs/ranking-default-owners.md`).
 */
export const DEFAULT_TOPO_DISCOUNT = 1;

/**
 * The shipped {@link TreePrunerOptions.topoDiscountGate} — no gate.
 *
 * A name rather than a literal for the reason `DEFAULT_TOPO_DISCOUNT` has one, and it is a SEPARATE
 * name rather than a shared zero because the two knobs answer different questions and a census that
 * could not tell them apart could not require a claimant for either. `0` is not a placeholder: it is
 * the ungated operator, which is what the nine published cells were measured with, and the gate is
 * inert there by construction rather than by agreement.
 *
 * @see DEFAULT_TOPO_DISCOUNT — the pair, and the axis they arm together.
 */
export const DEFAULT_TOPO_DISCOUNT_GATE = 1;

/**
 * @see DEFAULT_TOPO_WEIGHT — the class these names close.
 *
 * The collision term is the Deng-Yu-inspired `Q(f,f)` aggregation, and 0 is a REJECTION rather than an
 * absence: the term is `WEIGHT_ZERO` on all 19084 RCAEval term instances, which is a configuration fact
 * and licenses no inference about the corpus. Recorded so a reader of the constant cannot mistake the
 * shipped value for an unmeasured one.
 */
export const DEFAULT_COLLISION_WEIGHT = 0.0;

/**
 * @see DEFAULT_TOPO_WEIGHT — the class these names close.
 *
 * The PRISM-derived term. 0 is a recorded never-revert fact on this corpus, and the workflow description
 * says so; the name exists so that claim has an owner to be checked against.
 */
export const DEFAULT_PRISM_WEIGHT = 0.0;

/**
 * @see DEFAULT_TOPO_WEIGHT — the class these names close.
 *
 * The rise half of the direction-aware deviation. One declaring site rather than three, and it is named
 * for a different reason: its neighbours in this table are named, and an unnamed zero sitting between
 * named zeros is the shape a reader fills in by assuming it is one of them.
 */
export const DEFAULT_RISE_WEIGHT = 0.0;

/**
 * The failed-edge direction term's shipped weight — **ENROLLED at 3 in iteration 125**, and it is the only
 * nonzero default this table has gained since the latency term.
 *
 * ## What licenses 3
 *
 * A CONTROLLED pair on FSE'26, same corpus and same configuration, one input differing:
 *
 * | run | weight | Top@1 | Top@3 | Top@5 |
 * | --- | ---: | ---: | ---: | ---: |
 * | `35416576350` (the DEFAULT path) | 0 (absent) | 53.2% | 66.5% | 70.4% |
 * | `40072799488` (dispatch) | **3** | **56.1%** | **69.5%** | **72.0%** |
 *
 * **+41 cases, 757 → 798, and ZERO regressed fault types**: the entire gain is `NetworkPartition` 49 → 65,
 * `NetworkLoss` 23 → 31, `NetworkBandwidth` 13 → 21, `NetworkCorrupt` 24 → 31 and `HTTPRequestReplaceMethod`
 * 127 → 129, with the other twenty types byte-identical. That is the mechanism §16 of
 * `docs/fse26-discriminator-verdict.md` states rather than a pattern: a failed call names the fault site
 * exactly when what failed IS the connection.
 *
 * The term is not shipped bare — it is gated (`admitsFailedEdgeTerm`), because the UNGATED form took the same
 * corpus to 855 with two regressed types and that arm is refused. The gate admits 131 of 1422 cases at its
 * floor, and the arm behind it measured +42 in the benchmark reconstruction, which this run reproduced as +41.
 *
 * ## Why the golden half could not refuse it — and what that does NOT mean
 *
 * The RCAEval nine cells are ranked on a corpus view whose `edgeLatency` is EMPTY on every cell
 * (`latency-routes` prints `rows: shipped 0` for all nine; `latency-views.test.ts` asserts it of the
 * assembler). The gate's second half therefore has no value there and the term cannot fire, so no published
 * cell can move — a STRUCTURAL zero rather than a measured one. Two consequences the record keeps together:
 * the flip costs the golden nothing, and the golden has never tested this term. Adopting the `whole-file`
 * view would make the term live on the four trace-bearing cells and **re-open** the measurement; the register
 * holds that condition.
 *
 * `0` remains a MEASURED configuration (every published cell before this iteration ran it), so the ablation is
 * one input away and the constant is what makes the two distinguishable on an artifact.
 */
export const DEFAULT_FAILED_EDGE_WEIGHT = 3;

/**
 * The rank-1 latency rise, in the dump's own units, at which the failed-edge direction term is
 * allowed to act — and the interval it was measured inside.
 *
 * ## Why the term is gated at all
 *
 * The ungated term is not a candidate: it takes FSE'26 from 750 to 855 (+105) and **regresses two
 * fault types**, so the engine's acceptance condition — gain on the benchmark, no regressed fault
 * type — refuses it. The gross gain of the ungated term sits ENTIRELY inside the network class
 * (+62 of +62) while its losses sit entirely outside it, which is a mechanism rather than a
 * pattern: a failed call names the fault site exactly when what failed IS the connection.
 *
 * ## What the gate reads, and what it must NOT read
 *
 * Two observables of the engine's **own rank-1** service, both computable at inference time and
 * neither derived from the injected label:
 *
 * 1. whether the metric that dominates its anomaly is a **duration series** — the deployable proxy
 *    that clears the base rate at 30.1% precision / 90.6% recall against 17.9%;
 * 2. whether that service's **raw inbound latency rise** clears {@link FAILED_EDGE_LAT_RISE_FLOOR},
 *    which is what separates the two types the metric proxy alone keeps breaking. Their rank-1 rise
 *    has a median of **9.0** against **340.9** on the cases the term is for — a 38× separation in
 *    MAGNITUDE, and the only one available: the harmful types' dominant metric is literally
 *    `http.server.request.duration`, the same series family as the useful ones, so no metric NAME
 *    can separate them.
 *
 * The gate reads the raw rise and **not** `edgeLatencyScores`. That map is `log1p`-compressed and
 * max-normalised, so the top candidate always sits at the maximum of the term's range whatever its
 * input was — a saturated quantity, and law 1 forbids reading one to decide whether to trust it.
 *
 * ## Why 300, and why it is not a fitted point
 *
 * A fine scan puts the criterion's feasible region at **`[240, 360]`, where the net is exactly +42
 * and no fault type regresses at every point**. The corpus therefore does not offer a number, it
 * offers an INTERVAL, and the constant is that interval's **midpoint** — a canonical point inside a
 * region where every choice gives the same answer, which is what makes the choice unfalsifiable by
 * fold protocol rather than merely lucky on it. Held out per fold by taking each training interval's
 * midpoint, the criterion holds on **every** fold with **zero leaking folds** (+42 over 1422), where
 * choosing the point that maximises the training net leaked a regressed type on the fold that
 * dissented.
 *
 * The value is FITTED in the statistician's sense — it came from a scan — and the licence is the
 * plateau's width plus the held-out protocol, not the number's identity. A reader who moves it
 * anywhere inside the interval has not changed the measurement.
 */
export const FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU = { lo: 240, hi: 360 } as const;

/**
 * The admitted floor: the plateau's midpoint. See
 * {@link FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU} for the measurement, the width and the protocol.
 */
export const FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR = 300;

/**
 * The metric-name families that count as a duration series.
 *
 * These four alternatives are not a guess: they are the ones the corpus's dominant labels use
 * (`http.server.request.duration`, `http.client.request.duration.max`,
 * `hubble_http_request_duration_p90_seconds`, `*_p99_*`, `*latency*`, `*_time`) and the ones the
 * deployable proxy was measured with. **Widening it would not help**: the two harmful types reach
 * the gate through `http.server.request.duration` itself, so the separator cannot be a name.
 */
const DURATION_DOMINANT_METRIC = /duration|latency|time|p99|p95/i;

/**
 * May the failed-edge direction term act on a case whose rank-1 service looks like this?
 *
 * Ported from the benchmark's `admitsToGate`, in the engine, reading the engine's OWN observables:
 * the label of the metric that won the rank-1's anomaly, and that service's raw inbound dwell rise.
 *
 * Both halves are required, and each closes a different residue:
 *
 * - **the name** alone admits 765 of 1422 cases and regresses two types (+110);
 * - **the magnitude** alone is not computable without a candidate to measure;
 * - together they admit ~130 cases and regress **none** (+42).
 *
 * `latRise` is `undefined` when the case carried no per-edge measurement, and an absent measurement
 * is read as **0** — the term is then refused. That is the only safe direction: a case with no
 * latency evidence is precisely the case where the gate's second half cannot speak, and defaulting
 * the other way would let "no data" admit the term.
 *
 * @param dominantMetric - The label of the rank-1 service's dominant metric, if measured.
 * @param latRise - The rank-1 service's largest raw inbound `post / pre` rise, if measured.
 * @returns True only when both halves of the gate hold.
 */
export function admitsFailedEdgeTerm(
  dominantMetric: string | undefined,
  latRise: number | undefined,
): boolean {
  // `undefined` is not the empty string: a metric with an empty label was never named by the
  // producer, and `RegExp.test('')` is false anyway — but the explicit first test is what makes
  // the absence-vs-empty distinction readable rather than incidental.
  if (dominantMetric === undefined) return false;
  if (!DURATION_DOMINANT_METRIC.test(dominantMetric)) return false;
  // A missing rise reads as 0 and is refused; `Number.isFinite` keeps a NaN out, which would
  // otherwise make every comparison false and silently reproduce the same refusal for a different
  // reason than the one this branch states.
  const rise = latRise === undefined || !Number.isFinite(latRise) ? 0 : latRise;
  return rise >= FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR;
}

/**
 * The engine's own defaults table, exported so that a caller cannot hold a second opinion about what the
 * engine ships.
 *
 * It was `const` (module-private) until iteration 98, and that privacy is the ROOT CAUSE of the class
 * above rather than an incidental fact: each parser needs the shipped value for its own field default and
 * for the fallback it takes on a malformed argument, and a private table leaves it no way to read one —
 * so it wrote the number again. Making the table readable is what lets the census assert the property
 * over the PRODUCER instead of over a parser's source text, and the parsers are now required to read
 * either a named constant or this table, never a literal.
 *
 * Read-only by convention: the engine merges it (`{ ...DEFAULT_TREE_PRUNER_OPTIONS, ...options }`) rather
 * than mutating it, and the census asserts that every entry whose value also appears in another file is
 * declared by NAME rather than here as a literal.
 */
export const DEFAULT_TREE_PRUNER_OPTIONS: TreePrunerOptions = {
  ...DEFAULT_RCA_OPTIONS,
  decayAlpha: 0.8,
  decayBeta: 0.3,
  useTwoHopDecay: false,
  maxCycles: 10_000,
  enableCollisionAggregation: true,
  selfAnomalyWeight: DEFAULT_SELF_ANOMALY_WEIGHT,
  sourceWeight: 0.0,
  temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
  onsetShape: DEFAULT_ONSET_SHAPE,
  collisionWeight: DEFAULT_COLLISION_WEIGHT,
  topoWeight: DEFAULT_TOPO_WEIGHT,
  topoDiscount: DEFAULT_TOPO_DISCOUNT,
  topoDiscountScope: DEFAULT_TOPO_DISCOUNT_SCOPE,
  topoDiscountGate: DEFAULT_TOPO_DISCOUNT_GATE,
  topoClosure: DEFAULT_TOPO_CLOSURE,
  poolAdmission: DEFAULT_POOL_ADMISSION,
  logWeight: DEFAULT_LOG_WEIGHT,
  logSignalMode: DEFAULT_LOG_SIGNAL_MODE,
  riseWeight: DEFAULT_RISE_WEIGHT,
  traceWeight: DEFAULT_TRACE_WEIGHT,
  traceSkipsLeader: DEFAULT_TRACE_SKIPS_LEADER,
  prismWeight: DEFAULT_PRISM_WEIGHT,
  prismPooling: DEFAULT_PRISM_POOLING,
  failedEdgeWeight: DEFAULT_FAILED_EDGE_WEIGHT,
  failedEdgeMode: DEFAULT_FAILED_EDGE_MODE,
  failedEdgeMinRecords: DEFAULT_FAILED_EDGE_MIN_RECORDS,
  latWeight: DEFAULT_LAT_WEIGHT,
  latMinRise: DEFAULT_LAT_MIN_RISE,
  poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  stabilityWeight: DEFAULT_STABILITY_WEIGHT,
  selfTimeWeight: DEFAULT_SELF_TIME_WEIGHT,
  victimWeight: DEFAULT_VICTIM_WEIGHT,
  dualFamilyWeight: DEFAULT_DUAL_FAMILY_WEIGHT,
  dualFamilyGate: DEFAULT_DUAL_FAMILY_GATE,
  dualFamilyGateMode: DEFAULT_DUAL_FAMILY_GATE_MODE,
};

/**
 * TreePruner — implements IRCAEngine for collision tree RCA.
 *
 * This is the primary engine for root cause analysis using
 * Deng Yu's collision tree pruning methodology.
 *
 * @example
 * ```typescript
 * const pruner = new TreePruner();
 * const graph = pruner.buildFaultGraph(callGraph, metrics);
 * const results = await pruner.analyze(graph, 10);
 * ```
 */
export class TreePruner {
  private readonly options: TreePrunerOptions;
  private readonly cycleDetector: JohnsonCycleDetector;
  private readonly topologyConfig?: Partial<TopologyFaultGraphConfig>;

  constructor(
    options?: Partial<TreePrunerOptions>,
    topologyConfig?: Partial<TopologyFaultGraphConfig>,
  ) {
    this.options = { ...DEFAULT_TREE_PRUNER_OPTIONS, ...options };
    this.topologyConfig = topologyConfig;
    invariantRange(this.options.pruneEpsilon, 0, 1, 'pruneEpsilon');
    invariantRange(this.options.criticalLoadThreshold, 0, 1, 'criticalLoadThreshold');
    invariantPositiveInt(this.options.defaultTopK, 'defaultTopK');
    invariantPositiveInt(this.options.maxPropagationDepth, 'maxPropagationDepth');
    // Checked HERE as well as inside the operator, because the operator only rejects it when the deduction is
    // switched on: a misspelt closure on a run at `topoDiscount = 0` would otherwise be carried, printed on the
    // `signals:` line and never executed — a configuration that reports an arm nobody runs.
    invariant(
      isTopoClosure(this.options.topoClosure),
      `topoClosure must be 'max' or 'sum', got '${this.options.topoClosure}'`,
    );

    this.cycleDetector = new JohnsonCycleDetector({
      maxCycles: this.options.maxCycles,
    });
  }

  /**
   * Build a fault propagation graph from the service call graph
   * and time-series metrics.
   *
   * ### Computation:
   *
   * 1. **Propagation weights**: For each edge (from → to), compute
   *    the propagation probability as the Pearson correlation between
   *    the anomaly score of the source and target services.
   *
   *    p(from, to) = |corr(anomaly_from, anomaly_to)|
   *
   * 2. **Anomaly scores**: For each service, compute the normalized
   *    anomaly score as the maximum metric deviation from baseline.
   *
   *    anomaly(s) = max(0, min(1, max_i |metric_i - baseline_i| / baseline_i))
   *
   * 3. **Prune threshold**: Set to ε = pruneEpsilon from options.
   *
   * ### Invariants
   * - callGraph must have at least one node and one edge
   * - metrics must have entries for all services in the call graph
   *
   * @param callGraph - Service call graph with topology
   * @param metrics - Time series metrics keyed by service ID
   * @returns Fault propagation graph ready for analysis
   */
  buildFaultGraph(
    callGraph: ServiceCallGraph,
    metrics: MetricMap,
    options?: BuildFaultGraphOptions,
  ): FaultPropagationGraph {
    invariant(callGraph.nodes.size > 0, 'callGraph must have at least one node');
    invariant(callGraph.edges.length > 0, 'callGraph must have at least one edge');
    invariant(metrics.size > 0, 'metrics must be non-empty');

    // The fault injection time, resolved once and reused by the topology
    // builder (onset anchor), the log signal (post-injection window), and the
    // returned graph.
    const injectTimeMs = options?.injectTimeMs ?? this.topologyConfig?.injectTimeMs ?? 0;

    // Build topology-preserving fault graph with Pearson cross-service correlation.
    // Unlike the legacy chronological propagation tree, this preserves the YAML
    // topology edges and computes real cross-service correlation for edge weights.
    // The fault injection time (when known) is forwarded so the builder can anchor
    // each service's anomaly onset to a clean pre-injection baseline.
    const topoResult = buildTopologyFaultGraph(callGraph, metrics, {
      ...this.topologyConfig,
      injectTimeMs,
    });
    const {
      anomalyScores,
      // Kept because the topological deduction is an EXTENSIVE operator and the anomaly above is a
      // rank on any graph the builder normalised — see `discountedAnomalies`.
      rawAnomalyScores,
      anomalyNormalization,
      anomalyOnsetTimes,
      postInjectOnsetDelays,
      dominantMetrics,
      metricDiagnostics,
      faultHypotheses,
      propagationWeights,
    } = topoResult;

    // Use the original call graph (topology-preserving), not a synthetic star-tree.
    // The call graph's edges reflect the actual service dependency topology from
    // YAML configs + semantic enhancement.
    const topologyGraph = callGraph;

    // Detect cycles using topology edges
    const edgePairs = topologyGraph.edges.map(
      (e) => [e.from, e.to] as readonly [ServiceId, ServiceId],
    );
    const cycles = this.cycleDetector.detect(edgePairs);

    // Compute cycle contributions with adaptive or fixed decayAlpha
    const effectiveAlpha = topoResult.computedDecayAlpha;
    const analyzer = new CollisionContributionAnalyzer(topologyGraph.edges, propagationWeights, {
      alpha: effectiveAlpha,
      beta: this.options.decayBeta,
    });

    const contributions = this.options.useTwoHopDecay
      ? analyzer.computeAllTwoHopContributions(cycles)
      : analyzer.computeAllContributions(cycles);

    let totalCycleContribution = 0;
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      const contrib = contributions.get(key)!;
      totalCycleContribution += contrib;
    }

    // Classify cycles with significance
    const classifiedCycles: DetectedCycle[] = [];
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      const contrib = contributions.get(key)!;
      classifiedCycles.push({
        nodePath: cycle.nodePath,
        contribution: contrib,
        significant: contrib >= this.options.pruneEpsilon,
      });
    }

    // ── Collision Node Fault Aggregation (Deng Yu Boltzmann Q(f,f)) ──────────
    // When enableCollisionAggregation is off, skip aggregation and use raw
    // anomaly scores for all nodes. This enables apples-to-apples ablation
    // comparison against the baseline (no collision enhancement).
    let collisionEnergy: Map<
      ServiceId,
      {
        totalEnergy: number;
        collisionType: string;
        collisionGain: number;
        ratioContrib: number;
      }
    >;

    if (this.options.enableCollisionAggregation) {
      // Build cycle membership map for collision type classification
      const cycleMembership = new Map<ServiceId, number>();
      for (const cycle of cycles) {
        for (const nodeId of cycle.nodePath) {
          cycleMembership.set(nodeId, (cycleMembership.get(nodeId) ?? 0) + 1);
        }
      }

      // Convert call graph edges to FaultGraphEdge format for aggregator
      const faultEdges: FaultGraphEdge[] = topologyGraph.edges.map((e, i) => ({
        from: e.from,
        to: e.to,
        weight: propagationWeights[i]!,
      }));

      collisionEnergy = new Map(
        Array.from(
          aggregateFaultEnergy(faultEdges, anomalyScores, cycleMembership, {
            alpha: 0.4,
            bottleneckCapacity: 0.5,
            fanInThreshold: 3,
          }).entries(),
        ).map(([id, r]) => [
          id,
          {
            totalEnergy: r.totalEnergy,
            collisionType: r.collisionType,
            collisionGain: r.collisionGain,
            ratioContrib: r.ratioContrib,
          },
        ]),
      );
    } else {
      // Collision disabled: each node gets its raw anomaly score as energy,
      // with default 'chain' type (no amplification) and no upstream gain.
      collisionEnergy = new Map();
      for (const [nodeId, score] of anomalyScores) {
        collisionEnergy.set(nodeId, {
          totalEnergy: score,
          collisionType: 'chain',
          collisionGain: 0,
          ratioContrib: 0,
        });
      }
    }

    // ── Auxiliary ranking signals (dataset-decoupled, opt-in) ────────────────
    // The log signal (ERROR/FATAL volume after injection) and the topological
    // source signal (no strongly anomalous parent) are computed here — once,
    // on the full graph — and stored so the ranking can consume them without
    // re-deriving per case. Both default to neutral when the case carries no
    // logs or when collision aggregation is disabled, respectively.
    const logScores = computeLogScores(
      options?.logs,
      new Set(callGraph.nodes.keys()),
      injectTimeMs,
      this.options.logSignalMode,
      { edges: topologyGraph.edges, anomalyScores },
    );
    const topoScores = computeTopoSourceScores(
      topologyGraph.edges,
      propagationWeights,
      anomalyScores,
    );
    const riseScores = computeRiseScores(dominantMetrics, new Set(callGraph.nodes.keys()));
    // The pool-dominance indicator is a FUNCTION OF THE DOMINANT LABEL, so it is
    // derived here from the same `dominantMetrics` the rise signal reads rather
    // than being carried on the graph: one owner for "which metric won", and the
    // term is exactly 0 unless the weight is non-zero.
    const poolMetricScores = computePoolMetricScores(
      dominantMetrics,
      new Set(callGraph.nodes.keys()),
    );
    // The decisive-stability score is a FUNCTION OF THE DOMINANT METRIC'S COMPOSITION, so it is
    // derived from the same `dominantMetrics` the pool indicator reads rather than carried on the
    // graph: one owner for "which metric won", and the term is exactly 0 unless the weight is
    // non-zero. Ranked ACROSS the case, because the statistic it reads is a clamped bonus whose
    // magnitude saturates — see `computeStabilityScores`.
    const stabilityScores = computeStabilityScores(
      dominantMetrics,
      new Set(callGraph.nodes.keys()),
    );
    const deepestExceptions = computeDeepestExceptions(
      options?.logs,
      new Set(callGraph.nodes.keys()),
      injectTimeMs,
    );
    // The trace-activity signal is the deterministic signature of a
    // SILENT-SOURCE fault: it rewards the UNIQUE service whose post-injection
    // span count rises significantly above its pre-injection count. The counts
    // are pre-computed by the loader (see TraceActivityCounts) so the engine
    // never holds raw spans — only per-service {pre, post} integers.
    //
    // It is gated CASE-LEVEL on the services that actually threw a self-caused
    // logic exception (the `deepestExceptions` keys — a service is a key iff it
    // emitted ≥1 post-injection logic-exception line, see
    // computeDeepestExceptions). A silent wrong-value source still votes because
    // a downstream wrapper's PROPAGATED empty-value parse failure is NOT in
    // `deepestExceptions` (the loader flags it `isLogicException === false`):
    // in TrainTicket RE3 f2 the source (ts-auth-service) is silent while the
    // wrapper throws `IllegalArgumentException: Invalid UUID string`, and the
    // wrapper is therefore excluded — the silent riser receives the vote. When a
    // self-caused thrower IS present (OB f4 NullPointerException, RE2 memory
    // faults), the case is not silent and the log signal already ranks it, so
    // trace defers entirely.
    const traceActivityScores = computeTraceActivityScores(
      options?.traceActivity,
      new Set(callGraph.nodes.keys()),
      undefined,
      new Set(deepestExceptions.keys()),
    );

    // The PRISM graph-free signal: for each graph member, compute PRISM's
    // root-cause score (max-pooled internal/external deviation z-scores,
    // combined with `prismPooling`) and max-normalise to [0, 1]. It is topology-free
    // and uses a DIFFERENT anomaly scorer than the engine's own feature
    // pipeline, so it is genuinely complementary to the collision/topo/log/
    // trace priors — the fusion ceiling showed the two engines agree on only
    // 402/615 cases, with 70 cases PRISM alone gets right. Empty (neutral)
    // when the injection time is unknown or no service is anomalous.
    //
    // The pooling is FORWARDED rather than left to the primitive's default. It used to be left out, which
    // made `conjunctive` — the only pooling that resolves the code-level block (RE3 TrainTicket 76.7%
    // against `additive`'s 33.3% in the controlled head-to-head) — unreachable from the engine and from
    // every runner built on it: the option existed, `combinePrismScore` implemented it, and no engine
    // configuration could select it. `prismPooling` defaults to `DEFAULT_PRISM_POOLING`, the value this
    // call already passed by omission, so forwarding it changes no run that does not name the other one.
    const prismScores = computePrismScores(
      metrics,
      new Set(callGraph.nodes.keys()),
      injectTimeMs,
      this.options.prismPooling,
    );

    // The failed-edge-DIRECTION signal: each failed call is charged to its
    // CALLEE — the service whose interface was failing — which is the inverse
    // of the log signal's credit to the emitter. This is the only signal that
    // carries the DIRECTION of a fault, so it is deliberately not a log mode.
    const failedEdgeScores = computeFailedEdgeScores(
      options?.failedTraceEdges,
      new Set(callGraph.nodes.keys()),
      this.options.failedEdgeMode,
      this.options.failedEdgeMinRecords,
    );

    // The per-edge LATENCY signal: the continuous counterpart of the term above.
    // It credits the callee of an edge whose mean span duration rose, which is
    // the same direction — and it is defined on the cases where no call failed
    // at all, which the failed-edge counts cannot see.
    const edgeLatencyScores = computeEdgeLatencyScores(
      options?.edgeLatency,
      new Set(callGraph.nodes.keys()),
      this.options.latMinRise,
    );
    // The RAW per-callee rise behind that term — the observable, not a shape over it. Derived once
    // here so the gate that decides the failed-edge term and the diagnostic artifact that reports
    // it read the SAME numbers; two derivations of one statistic is how a measurement comes to be
    // about a quantity the code never used. See `computeEdgeLatencyByCallee` for why this map is
    // deliberately wider than the term's population.
    const edgeLatencyByCallee = computeEdgeLatencyByCallee(options?.edgeLatency);

    // The SELF-TIME share: the fraction of a service's own latency rise that no callee can explain.
    // Computed from the RAW metric series rather than from the anomaly features, because the guards
    // delete exactly the propagation channels this term has to compare — see the function's docblock.
    // At weight 0 the map is not built at all, so the shipped path is byte-identical by construction.
    const selfTimeScores =
      this.options.selfTimeWeight !== 0
        ? computeSelfTimeScores(topologyGraph.edges, metrics)
        : undefined;

    // The INTERNAL/EXTERNAL SYMMETRY, PRISM's axiom in the form the six-arm sweep argued for: a mask on a
    // candidate's own evidence rather than a score beside it. Built only when the weight is non-zero, so
    // the shipped path is byte-identical by construction rather than by arithmetic — the rule the
    // self-time and breadth maps follow.
    const channelSymmetry =
      this.options.victimWeight !== 0
        ? computeChannelSymmetry(metrics, new Set(callGraph.nodes.keys()), injectTimeMs)
        : undefined;

    // The DUAL-FAMILY membership: the same walk as the symmetry above, read as presence instead of as a ratio.
    // Built only when the weight is non-zero, so the shipped path is byte-identical by construction.
    const dualFamilyServices =
      this.options.dualFamilyWeight !== 0
        ? computeDualFamilyServices(
            metrics,
            new Set(callGraph.nodes.keys()),
            injectTimeMs,
            this.options.dualFamilyGate,
            this.options.dualFamilyGateMode,
          )
        : undefined;

    return {
      callGraph: topologyGraph,
      propagationWeights,
      anomalyScores,
      rawAnomalyScores,
      anomalyNormalization,
      anomalyOnsetTimes,
      postInjectOnsetDelays,
      dominantMetrics,
      metricDiagnostics,
      faultHypotheses,
      injectTimeMs,
      detectedCycles: classifiedCycles,
      totalCycleContribution,
      pruneThreshold: this.options.pruneEpsilon,
      collisionEnergy,
      logScores,
      topoScores,
      riseScores,
      deepestExceptions,
      traceActivityScores,
      prismScores,
      failedEdgeScores,
      edgeLatencyScores,
      edgeLatencyByCallee,
      poolMetricScores,
      stabilityScores,
      selfTimeScores,
      channelSymmetry,
      dualFamilyServices,
    };
  }

  /**
   * Perform root cause analysis on the fault propagation graph.
   *
   * ### Algorithm Steps:
   *
   * 1. **Cycle Detection → Pruning**: If cycles are already detected
   *    in the graph, use them. Otherwise detect fresh. Prune every
   *    cycle (significant or not) by breaking its weakest edge.
   *
   * 2. **Tree RCA**: On the pruned acyclic tree, accumulate anomaly
   *    scores bottom-up and rank root cause candidates.
   *
   * 3. **Top-K**: Return the top K results sorted by RCA score.
   *
   * ### Deng Yu Mapping
   *
   * The pruning step corresponds to removing closed-loop collision
   * trajectories. Breaking the weakest collision cross-section edge in
   * each cycle discards the least-probable trajectory while preserving the
   * dominant fault-propagation paths — a valid approximation in the
   * rarefied gas limit. Previously cycles with w(C) ≥ ε threw
   * `GraphCycleError`, which made the engine unusable on dense real-world
   * topologies (e.g. TrainTicket's 68-node, 267-edge graph) where feedback
   * loops are inherent, so every cycle is now pruned uniformly.
   *
   * @param graph - Fault propagation graph
   * @param topK - Number of top results to return (default from options)
   * @returns Ranked root cause results
   */
  analyze(graph: FaultPropagationGraph, topK?: number): RootCauseResult[] {
    const k = topK ?? this.options.defaultTopK;
    invariantPositiveInt(k, 'topK');

    // The anomaly map the ranking reads. `topoDiscount = 0` returns the graph's own map, so the shipped
    // configuration is bit-identical by construction rather than by test. The audit is the share the
    // deduction measured and the gate this run judged it against — absent at `topoDiscount = 0`, because
    // nothing was measured and an evidence row reporting a zero share would be a reading of a run that
    // never looked.
    const deduction = this.discountedAnomalies(graph);
    const anomalyScores = deduction.scores;

    // Prune ALL cycles — significant and insignificant alike. Breaking the
    // weakest edge in every cycle keeps dense topologies analyzable; throwing
    // on significant cycles previously returned "no prediction" for the whole
    // TrainTicket benchmark.
    const allCycles = graph.detectedCycles;
    const prunedTree = pruneCycles(graph, allCycles.length > 0 ? allCycles : undefined);

    // The BASELINE ranking — the configuration every mutation of this engine is measured against,
    // and the only one in which the gate's subject is observable. When the direction term is off
    // this pass IS the answer and nothing below runs.
    const baseline = performTreeRCA(
      prunedTree,
      anomalyScores,
      graph.anomalyOnsetTimes,
      graph.postInjectOnsetDelays,
      graph.injectTimeMs ?? 0,
      graph.callGraph.nodes,
      graph.propagationWeights,
      k,
      { ...this.options, failedEdgeWeight: 0 },
      graph.collisionEnergy,
      graph.logScores,
      graph.topoScores,
      graph.riseScores,
      graph.traceActivityScores,
      graph.prismScores,
      graph.failedEdgeScores,
      graph.edgeLatencyScores,
      graph.poolMetricScores,
      graph.stabilityScores,
      graph.selfTimeScores,
      graph.channelSymmetry,
      graph.dualFamilyServices,
      deduction.audit,
    );

    // ── The failed-edge direction term's GATE ────────────────────────────────
    // The term is not a reweighting that can be applied unconditionally: ungated it regresses two
    // fault types on FSE'26, so the engine's acceptance condition refuses it. What licenses it is a
    // predicate on the engine's OWN rank-1 — the service the baseline ranking already chose, which
    // is the only subject the benchmark's measurement was taken on, and never the injected label.
    //
    // The pass above is what makes this decidable: a gate that needed the term's own output to
    // name its subject would be circular, and a gate that read the option instead of the ranking
    // would decide about a service the engine does not answer with. The cost is a second ranking
    // ONLY on the cases the gate admits; a refused case returns the baseline it already has.
    const directionWeight = this.options.failedEdgeWeight;
    if (directionWeight === 0) return withFaultHypotheses(graph, baseline);
    const rankOne = baseline[0];
    if (rankOne === undefined) return withFaultHypotheses(graph, baseline);
    if (
      !admitsFailedEdgeTerm(
        graph.dominantMetrics?.get(rankOne.serviceId)?.label,
        graph.edgeLatencyByCallee?.get(rankOne.serviceId)?.rise,
      )
    ) {
      return withFaultHypotheses(graph, baseline);
    }

    return withFaultHypotheses(
      graph,
      performTreeRCA(
        prunedTree,
        anomalyScores,
        graph.anomalyOnsetTimes,
        graph.postInjectOnsetDelays,
        graph.injectTimeMs ?? 0,
        graph.callGraph.nodes,
        graph.propagationWeights,
        k,
        this.options,
        graph.collisionEnergy,
        graph.logScores,
        graph.topoScores,
        graph.riseScores,
        graph.traceActivityScores,
        graph.prismScores,
        graph.failedEdgeScores,
        graph.edgeLatencyScores,
        graph.poolMetricScores,
        graph.stabilityScores,
        graph.selfTimeScores,
        graph.channelSymmetry,
        graph.dualFamilyServices,
        deduction.audit,
      ),
    );
  }

  /**
   * The per-node anomaly the ranking reads, after the topological deduction.
   *
   *   explained(v) = max over callees c with propWeight(v→c) > 0 of propWeight(v→c) × anomaly(c)
   *   anomaly'(v)  = anomaly(v) − rho × min(anomaly(v), explained(v))
   *
   * applied only where {@link TopoDiscountScope} allows: under `external` both the explaining callee and
   * the deducted caller must carry a {@link isResponseChannel} dominant metric, because a response is the
   * only thing a call boundary transmits. A source — no anomalous callee, or an internal anomaly no
   * callee can produce — keeps its anomaly entire.
   *
   * The operator itself lives in `deductExplainedAnomalies` because it is a function of the anomaly map
   * and the edges and of NOTHING else — which is what makes its space an explicit argument rather than
   * an accident of what the graph happens to report. This method's job is only the round trip: deduct in
   * deviation space, return in the graph's own space.
   *
   * `rho = 0` — the shipped value — returns the graph's own map unchanged, so the shipped configuration
   * is bit-identical by construction: no copy, no float rounding, no comparison to defend.
   *
   * @param graph - The graph whose anomalies are to be deducted.
   * @returns The map the ranking should read, and the audit the evidence records — the audit is absent
   *   at `topoDiscount = 0`, where the operator never ran.
   */
  private discountedAnomalies(graph: FaultPropagationGraph): {
    readonly scores: ReadonlyMap<ServiceId, number>;
    readonly audit?: TopoDeductionAudit;
  } {
    const rho = this.options.topoDiscount;
    // At the shipped weight the map is not built at all, so the ranking is bit-identical to the one
    // that existed before this axis did — no copy, no re-normalisation, the same object.
    if (rho === 0) return { scores: graph.anomalyScores };
    // ── The operator runs in DEVIATION space, and that is the whole of iteration 158 ─────────────
    //
    // `explained` adds a callee's anomaly into a caller's, so the subtraction that undoes it is an
    // EXTENSIVE operation, and the anomaly the engine reports is not an extensive quantity on every
    // suite: step 1b of the graph builder rank-normalises it above `anomalyNormalizeNodeThreshold`, so
    // TrainTicket's scores are ranks with steps of 1/(n−1) while OnlineBoutique's are deviations of
    // order 1–3. Deducting on the rank surface makes the relative effect `rho·w·(n−1)/k` — linear in
    // the fleet's size — which is why the same weight that read +1.6 pp on RE1:OnlineBoutique cost
    // RE1:TrainTicket 5.6 pp on run `40896889186`. The deduction now runs on `rawAnomalyScores` and the
    // result is returned through the SAME transform the builder applied, so the ranking keeps reading
    // one space while the operator works in another.
    const deducted = deductExplainedAnomalies(
      {
        anomalies: graph.rawAnomalyScores,
        edges: graph.callGraph.edges,
        propagationWeights: graph.propagationWeights,
        dominantMetrics: graph.dominantMetrics,
      },
      rho,
      this.options.topoDiscountScope,
      this.options.topoDiscountGate,
      this.options.topoClosure,
    );
    // The share is reported in the space the operator computed it in and NOT mapped through the
    // normalisation below: `rankNormalizeScores` would turn it into a rank share, which is a different
    // quantity with a different meaning (a fraction of a step count rather than a fraction of an anomaly).
    return {
      scores: applyAnomalyNormalization(deducted.discounted, graph.anomalyNormalization),
      audit: { share: deducted.share, gate: this.options.topoDiscountGate },
    };
  }

  /**
   * Compute the upper bound on total cycle contribution given
   * the current system load.
   *
   * ### Critical Load Theorem (Deng Yu)
   *
   * If systemLoad < λ_critical:
   *
   *   Σw(C) ≤ K × ε
   *
   * where K is the kinetic constant and ε is the prune threshold.
   *
   * The bound increases with system load:
   *
   *   bound = systemLoad × K_0 / λ_critical
   *
   * where K_0 = ε × (1 + systemLoad).
   *
   * @param graph - Fault propagation graph
   * @returns Upper bound on total cycle contribution
   */
  getCycleContributionBound(graph: FaultPropagationGraph): number {
    const load = graph.callGraph.systemLoad;
    invariantRange(load, 0, 1, 'systemLoad');

    if (load >= this.options.criticalLoadThreshold) {
      // Above critical load: bound grows rapidly (system is dense)
      return load * this.options.pruneEpsilon * 2;
    }

    // Below critical load: bounded by K×ε (rarefied regime)
    const K0 = this.options.pruneEpsilon * (1 + load);
    return (load / this.options.criticalLoadThreshold) * K0;
  }

  /**
   * Get the current prune epsilon threshold.
   */
  get pruneEpsilon(): number {
    return this.options.pruneEpsilon;
  }
}

/**
 * Prune insignificant cycles from the fault propagation graph.
 *
 * For each insignificant cycle, find the edge with the minimum
 * propagation weight and remove it. This breaks the cycle while
 * preserving the strongest fault propagation paths.
 *
 * Deng Yu mapping: removing the weakest collision cross-section edge
 * corresponds to discarding the least probable collision trajectory.
 *
 * @param graph - Fault propagation graph
 * @param cycles - Cycles to prune (defaults to all detected cycles)
 * @returns Pruned tree structure
 * @internal
 */
function pruneCycles(graph: FaultPropagationGraph, cycles?: readonly DetectedCycle[]): PrunedTree {
  const targetCycles = cycles ?? graph.detectedCycles;
  const weightMap = buildEdgeWeightMap(graph.callGraph.edges, graph.propagationWeights);

  // Track which edges are pruned
  const prunedEdgeSet = new Set<string>();
  const prunedEdges: PrunedEdgeRecord[] = [];

  for (const cycle of targetCycles) {
    // Find the weakest edge in this cycle
    let weakestEdge: [ServiceId, ServiceId] | null = null;
    let weakestWeight = Infinity;

    const path = cycle.nodePath;
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const u = path[i]!;
      const v = path[(i + 1) % n]!;
      const key = `${u}→${v}`;
      const w = weightMap.get(key)!;
      if (w < weakestWeight) {
        weakestWeight = w;
        weakestEdge = [u, v];
      }
    }

    if (weakestEdge) {
      const [from, to] = weakestEdge;
      const edgeKey = `${from}→${to}`;
      if (!prunedEdgeSet.has(edgeKey)) {
        prunedEdgeSet.add(edgeKey);
        prunedEdges.push({
          from,
          to,
          cycleId: cycleKey(cycle.nodePath),
          cycleContribution: cycle.contribution,
          marginBelowThreshold: graph.pruneThreshold - cycle.contribution,
        });
      }
    }
  }

  // Build remaining edges
  const remainingEdges = graph.callGraph.edges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    return !prunedEdgeSet.has(key);
  });

  // Build initial node scores (just anomaly, no child propagation yet)
  const nodes = new Map<ServiceId, TreeNodeScore>();
  for (const [nodeId, _node] of graph.callGraph.nodes) {
    const anomalyScore = graph.anomalyScores.get(nodeId)!;
    nodes.set(nodeId, {
      nodeId,
      anomalyScore,
      childPropagationScore: 0,
      totalScore: anomalyScore,
      depth: 0,
    });
  }

  // Compute contributed removed
  let contributionRemoved = 0;
  for (const cycle of targetCycles) {
    contributionRemoved += cycle.contribution;
  }

  return {
    nodes,
    edges: remainingEdges,
    rootCauseScores: new Map(),
    prunedEdges,
    cyclesPruned: targetCycles.length,
    contributionRemoved,
  };
}

/**
 * Perform RCA on the pruned tree using bottom-up anomaly score accumulation.
 *
 * When collisionEnergy is provided, the Boltzmann Q(f,f) collision energy
 * replaces raw anomaly scores as the primary ranking signal, and collision
 * type classification (chain/fan-in/bottleneck/cycle) adjusts depth bonuses.
 *
 * Algorithm:
 * 1. Build adjacency from remaining edges
 * 2. Compute in-degree for each node
 * 3. Topological sort (leaves first)
 * 4. Bottom-up accumulation: leaf nodes contribute upward
 * 5. Top nodes get the highest scores → root cause candidates
 *
 * Time complexity: O(V + E)
 *
 * @internal
 */
/**
 * How confident a shape hypothesis must be before it is reported as the fault TYPE.
 *
 * `0.35` is the lowest confidence any rule in `StatisticalAnalyzer` can emit (`0.4 + 0.5·trend` at a
 * trend of zero, minus rounding), so a hypothesis below it is one no rule produced. Below the floor the
 * severity descriptor is the more honest answer, and it says which of the two answered through its own
 * `subType`.
 */
const HYPOTHESIS_CONFIDENCE_FLOOR = 0.35;

/**
 * Report each ranked node's fault-type CATEGORY from the shape of its series, when the graph has one.
 *
 * The two answers are different questions and both are kept: the descriptor produced by the ranking
 * says how SEVERE the node is and whether it is local or cascaded, and the hypothesis says WHICH KIND
 * of fault its series looks like. Only the category is replaced, so a reader keeps the severity and
 * the local/cascaded distinction while the reported type becomes one the benchmark can score.
 *
 * Before this, `TA` (type accuracy) was structurally zero: the descriptor's vocabulary is
 * `CPU`/`MEMORY`/`CONNECTION_POOL`/`CODE_ERROR` and the ground truth's is `cpu`/`mem`/`disk`/`delay`/
 * `loss`/`socket`. The results table hid it by printing `AC@1` under the `TA` label.
 *
 * @param graph - The graph the ranking was computed on (it carries the hypotheses).
 * @param results - The ranking, in order.
 * @returns The same ranking with categories replaced where a confident hypothesis exists.
 */
function withFaultHypotheses(
  graph: FaultPropagationGraph,
  results: readonly RootCauseResult[],
): RootCauseResult[] {
  const hypotheses = graph.faultHypotheses;
  if (hypotheses === undefined) return [...results];
  return results.map((result) => {
    const hypothesis = hypotheses.get(result.serviceId);
    if (hypothesis === undefined || hypothesis.confidence < HYPOTHESIS_CONFIDENCE_FLOOR) {
      return result;
    }
    return {
      ...result,
      faultType: { ...result.faultType, category: hypothesis.category as FaultCategory },
    };
  });
}

function performTreeRCA(
  tree: PrunedTree,
  anomalyScores: ReadonlyMap<ServiceId, number>,
  anomalyOnsetTimes: ReadonlyMap<ServiceId, number>,
  postInjectOnsetDelays: ReadonlyMap<ServiceId, number> | undefined,
  injectTimeMs: number,
  allNodes: ReadonlyMap<ServiceId, ServiceNode>,
  propagationWeights: Float64Array,
  topK: number,
  options: TreePrunerOptions,
  collisionEnergy?: ReadonlyMap<
    ServiceId,
    { totalEnergy: number; collisionType: string; collisionGain: number; ratioContrib: number }
  >,
  logScores?: ReadonlyMap<ServiceId, number>,
  topoScores?: ReadonlyMap<ServiceId, number>,
  riseScores?: ReadonlyMap<ServiceId, number>,
  traceActivityScores?: ReadonlyMap<ServiceId, number>,
  prismScores?: ReadonlyMap<ServiceId, number>,
  failedEdgeScores?: ReadonlyMap<ServiceId, number>,
  edgeLatencyScores?: ReadonlyMap<ServiceId, number>,
  poolMetricScores?: ReadonlyMap<ServiceId, number>,
  stabilityScores?: ReadonlyMap<ServiceId, number>,
  selfTimeScores?: ReadonlyMap<ServiceId, number>,
  channelSymmetry?: ReadonlyMap<ServiceId, number>,
  dualFamilyServices?: ReadonlySet<ServiceId>,
  topoAudit?: TopoDeductionAudit,
): RootCauseResult[] {
  // Build adjacency from remaining edges
  const children = new Map<ServiceId, Array<{ child: ServiceId; weight: number }>>();

  for (const nodeId of allNodes.keys()) {
    children.set(nodeId, []);
  }

  for (let i = 0; i < tree.edges.length; i++) {
    const edge = tree.edges[i]!;
    const childList = children.get(edge.from);
    if (childList) {
      childList.push({
        child: edge.to,
        weight: propagationWeights[i]!,
      });
    }
  }

  // Topological sort: start with TRUE leaves (outDegree === 0).
  // inDegree counts incoming edges (parents); inDegree===0 means ROOT nodes.
  // We need nodes with NO children to propagate bottom-up.
  const leaves: ServiceId[] = [];
  for (const [nodeId, childList] of children) {
    if (childList.length === 0) {
      leaves.push(nodeId);
    }
  }

  // Fallback: if ring-connect edges create cycles with no true leaves,
  // fall back to nodes with the FEWEST children as starting points.
  if (leaves.length === 0) {
    let minChildren = Infinity;
    for (const [_nodeId, childList] of children) {
      if (childList.length < minChildren) minChildren = childList.length;
    }
    for (const [nodeId, childList] of children) {
      if (childList.length === minChildren) leaves.push(nodeId);
    }
  }

  // Bottom-up accumulation with BFS from leaves
  const scores = new Map<ServiceId, number>();
  // Self anomaly per node (mixedSelf) — the primary ranking signal. Kept
  // separate from `scores` (the accumulated totalScore) so the root cause
  // (the fault injection point) is ranked by its OWN deviation, not by the
  // anomaly its downstream children propagate back up to it.
  const selfScores = new Map<ServiceId, number>();
  const depths = new Map<ServiceId, number>();
  // Queue for bottom-up processing: process nodes when all parents processed
  // Actually, we process from leaf → root: initialize leaves, then propagate upward

  // Initialize all scores with collision energy when available,
  // falling back to raw anomaly scores otherwise.
  // Also track collision type for each node (for sort-time amplification).
  const collisionTypes = new Map<ServiceId, string>();
  for (const [nodeId] of allNodes) {
    const collisionResult = collisionEnergy?.get(nodeId);
    const ce = collisionResult?.totalEnergy;
    // Use collision energy only when it adds signal (> 0).
    // Falls back to raw anomaly score when totalEnergy is 0 or undefined.
    scores.set(nodeId, ce !== null && ce !== undefined && ce > 0 ? ce : anomalyScores.get(nodeId)!);
    collisionTypes.set(nodeId, collisionResult?.collisionType ?? 'chain');
    depths.set(nodeId, 0);
  }

  // Build reverse adjacency (parent → children)
  const reverseAdj = new Map<ServiceId, string[]>();
  for (const [nodeId] of allNodes) {
    reverseAdj.set(nodeId, []);
  }
  for (const edge of tree.edges) {
    const list = reverseAdj.get(edge.to);
    if (list) {
      list.push(edge.from);
    }
  }

  // Source-likelihood prior: the fraction of a node's causal neighbours
  // (children + parents in the pruned tree) whose anomaly onset is LATER
  // than its own. The fault source's disturbance precedes its neighbours'
  // (cause precedes effect — Deng Yu's mean free time τ), so a source has a
  // high score while a downstream symptom (whose parent changed first) or an
  // isolated noise service (random neighbour onsets) has a low score. Onset
  // indices are derived purely from each service's own time series, never
  // from dataset metadata such as inject_time.
  const sourceScores = new Map<ServiceId, number>();
  for (const [nodeId] of allNodes) {
    const myOnset = anomalyOnsetTimes.get(nodeId)!;
    let later = 0;
    let neighbours = 0;
    for (const { child } of children.get(nodeId)!) {
      neighbours++;
      if (anomalyOnsetTimes.get(child)! > myOnset) later++;
    }
    for (const parent of reverseAdj.get(nodeId)!) {
      neighbours++;
      if (anomalyOnsetTimes.get(parent)! > myOnset) later++;
    }
    sourceScores.set(nodeId, neighbours > 0 ? later / neighbours : 0);
  }

  // Global temporal earliness — the injection-time-anchored causal prior. Each
  // service's onset delay (ms after fault injection) becomes a SLOPE in the shape
  // `options.onsetShape` names, which is what the score adds per unit of weight; a
  // service the shape leaves out contributes nothing. This is strictly more reliable
  // than the local `sourceScores` prior above, whose onset index came from a
  // fault-contaminated baseline.
  const onsetSlopes = computeOnsetSlopes(postInjectOnsetDelays, injectTimeMs, options.onsetShape);

  // Topological order: use in-degree with reverse adjacency
  // Process from leaves upward
  const processQueue = [...leaves];
  const processed = new Set<ServiceId>();

  while (processQueue.length > 0) {
    const node = processQueue.shift()!;
    // `node` is enqueued exactly once (see the `!processed.has(p)` guard when
    // parents are pushed), so it can never already be processed here.
    processed.add(node);

    // Use collision-enhanced energy when available, falling back to raw anomaly.
    // Collision energy is the Boltzmann Q(f,f) aggregate of upstream fault signals,
    // which captures propagation dynamics that raw anomaly scores miss.
    const collisionResult = collisionEnergy?.get(node);
    const nodeEnergy = collisionResult?.totalEnergy ?? anomalyScores.get(node)!;
    const nodeAnomaly = anomalyScores.get(node)!;
    let childContrib = 0;
    let maxChildDepth = 0;

    // Accumulate from outgoing children
    const childList = children.get(node)!;
    for (const { child, weight } of childList) {
      const childScore = scores.get(child)!;
      const childDepth = depths.get(child)!;
      // Time-delay decay: each hop attenuates by α
      const latencyDecay = Math.pow(options.decayAlpha, 1);
      childContrib += childScore * weight * latencyDecay;
      if (childDepth + 1 > maxChildDepth) {
        maxChildDepth = childDepth + 1;
      }
    }

    // Fan-out dilution theorem (Deng Yu, 2024):
    // In a collision tree, a parent with N children receives anomaly
    // contributions from each child, but the total contribution is
    // attenuated by 1/N to prevent fan-out services (like API gateways
    // or frontends) from unfairly accumulating anomaly evidence from
    // the entire downstream graph.
    //
    // Without this normalization, a frontend with 7 downstream services
    // accumulates 7× more child contributions than a specific backend
    // service with only 1 downstream child, artificially boosting the
    // frontend's root cause score even when the fault originates in a
    // downstream service.
    const childCount = childList.length;
    const fanOutDilution = childCount > 0 ? 1 / childCount : 1;

    // Mix: collision energy (upstream-aware) + child contributions (downstream-aware)
    // Weight: α = 0.6 collision-driven, 0.4 raw-anomaly-driven for non-collision nodes
    // This prevents children from dominating the score of a deep bottleneck node
    // whose collision energy already captures upstream propagation.
    const isCollisionNode = collisionTypes.get(node) !== 'chain';
    const collisionWeight = isCollisionNode ? 0.7 : 0.5;
    const mixedSelf = collisionWeight * nodeEnergy + (1 - collisionWeight) * nodeAnomaly;
    const totalScore = mixedSelf + childContrib * fanOutDilution;
    scores.set(node, totalScore);
    // Rank by the node's OWN raw anomaly — the fault injection point has the
    // highest deviation. The collision energy (Q(f,f)) aggregates upstream
    // signals and amplifies convergence points (fan-in/bottleneck), which
    // would let a healthy convergence node outrank the true source, so it is
    // deliberately excluded from the primary ranking signal.
    selfScores.set(node, nodeAnomaly);
    depths.set(node, maxChildDepth);

    // Push parent nodes for processing
    const parents = reverseAdj.get(node)!;
    for (const p of parents) {
      if (!processed.has(p)) {
        // Check if all children of p have been processed. Guard against a
        // parent absent from the node map (a dangling edge endpoint) — skip
        // it rather than crashing the whole analysis.
        const pChildren = children.get(p);
        if (!pChildren) continue;
        const allProcessed = pChildren.every((c) => processed.has(c.child));
        if (allProcessed && !processQueue.includes(p)) {
          processQueue.push(p);
        }
      }
    }
  }

  // Compute final scores and rank
  const scoredNodes: Array<{
    serviceId: ServiceId;
    score: number;
    depth: number;
  }> = [];

  for (const [nodeId] of allNodes) {
    const selfScore = selfScores.get(nodeId)!;
    const depth = depths.get(nodeId)!;

    // The pool is `{v : selfScore(v) > 0}` under the shipped admission, which is a SET DECISION and not a
    // significance test: a node whose anomaly a callee accounts for in full reads exactly 0 and is dropped,
    // so it is absent from the ranking rather than last in it — and an absent truth and a low-ranked truth are
    // different failures with different owners (see `docs/topo-discount-scope.md` §7.4). `poolAdmission`
    // names the decision so it can be measured; `graph` admits every node, each still ranked by its own score.
    if (selfScore > 0 || options.poolAdmission === 'graph') {
      scoredNodes.push({ serviceId: nodeId, score: selfScore, depth });
    }
  }

  // Rank by self anomaly combined with twelve causal priors (all opt-in except log) and one mask:
  //
  // 1. A LOCAL source-likelihood prior (`sourceWeight`) — the fraction of a
  //    node's neighbours whose index-based onset is later.
  // 2. A GLOBAL injection-anchored temporal prior (`temporalWeight`) — the earlier
  //    a service deviated from its clean pre-injection baseline, the more likely it
  //    is the source. What exactly the onset delays are read as is `onsetShape`'s
  //    (`earliest-only` credits the first mover and nothing else).
  // 3. A COLLISION-ENERGY prior (`collisionWeight`) — penalise a node whose
  //    fault energy is mostly INHERITED from upstream (ratioContrib → 1).
  // 4. A TOPOLOGICAL-source prior (`topoWeight`) — reward a node with no
  //    strongly anomalous upstream parent.
  // 5. A LOG prior (`logWeight`) — reward the service with the highest
  //    post-injection ERROR/FATAL volume (code-level faults).
  // 6. A RISE prior (`riseWeight`) — reward the service whose DOMINANT metric
  //    rises post-injection (source does more work); penalise a collapse ONLY
  //    when the service emitted no logic exception (silent symptom), never
  //    when it did (source crash) — see gatedRiseContribution.
  // 7. A TRACE-ACTIVITY prior (`traceWeight`) — reward the UNIQUE service whose
  //    post-injection span count rises significantly (silent-source signature).
  // 8. A PRISM prior (`prismWeight`) — reward the service anomalous in BOTH its
  //    internal and external properties (the graph-free internal/external
  //    asymmetry of PRISM).
  // 9. A FAILED-EDGE-DIRECTION prior (`failedEdgeWeight`) — reward the CALLEE
  //    of post-injection failed calls, i.e. the service its callers' calls
  //    failed against. The inverse of the log prior, and the only signal that
  //    carries a fault's DIRECTION.
  // 10. A PER-EDGE-LATENCY prior (`latWeight`) — reward the CALLEE of the edges
  //    whose mean span duration rose. The CONTINUOUS counterpart of 9: it exists
  //    on the cases where no call failed at all, and its floor (`latMinRise`) is
  //    a MASK on how thin a rise counts as evidence.
  // 11. A POOL-DOMINANCE PENALTY (`poolMetricPenaltyWeight`) — SUBTRACT when the
  //    metric that won a service's own anomaly maximum is a DB connection-pool
  //    series. The only term here keyed on WHICH evidence won rather than on how
  //    much, and the only one whose sign is a penalty on the evidence rather than
  //    on inherited energy.
  // 12. A SELF-TIME prior (`selfTimeWeight`) — reward the part of a service's own latency
  //    rise that no CALLEE can explain. The transport counterpart of 1, and the answer to
  //    the mechanism `docs/transient-guard-window.md` §4 measured: a caller's response time
  //    contains its callees', so a rise a slow callee accounts for is INHERITED rather
  //    than created — and a maximum-over-metrics anomaly cannot tell the two apart.
  // 13. An INTERNAL/EXTERNAL SYMMETRY MASK (`victimWeight`) — SUBTRACT a share of a candidate's OWN
  //    evidence when its anomaly is EXTERNAL-ONLY, which is PRISM's victim signature (arXiv:2601.21359).
  //    The only entry here that is a bounded MULTIPLIER on the base term rather than a prior beside it,
  //    and the only one whose value is a ratio of two channels' deviations with no constant in it.
  //
  // This list has to grow with the score: it was one term short for a release
  // (the per-edge latency prior shipped without an entry), and a reader counting
  // it is how the omission was found.
  //
  // The root cause is the fault injection point — the service whose OWN
  // deviation is highest AND whose onset precedes its neighbours'. A healthy
  // parent must not accumulate its faulted children's anomaly (childContrib)
  // and outrank the actual source, and propagation DEPTH is not used
  // (RCAEval injects faults at arbitrary depths). The combination is in
  // log1p space so a strong causal signal can overcome a moderately larger
  // symptom anomaly without unbounded amplification. `log1p` (not `log`) is
  // used because rank-normalized self anomalies live in [0, 1] — the top
  // service maps to exactly 1.0, and `log(1.0) === 0` would collapse the
  // base term to zero for the STRONGEST signal (the "0-score zombie"
  // bothWrong failure), leaving the ranking to secondary signals or a
  // service-id tiebreak. `log1p` keeps the base term strictly positive and
  // monotonic (top → log1p(1.0) = 0.693) and also maps a zero-anomaly service
  // to 0 instead of `log(0) = -Infinity`:
  //
  //   finalScore(v) = log1p(selfAnomaly(v))
  //                 + sourceWeight    × sourceScore(v)
  //                 + temporalWeight  × onsetSlope(v)   // shaped by `onsetShape`
  //                 − collisionWeight × ratioContrib(v)
  //                 + topoWeight      × topoSource(v)
  //                 + logWeight       × logScore(v)
  //                 + riseWeight      × gatedRiseContribution(dir(v), hasLogicException(v))
  //                 + traceWeight     × traceActivity(v)
  //                 + prismWeight     × prismScore(v)
  //                 + failedEdgeWeight × failedEdgeScore(v)
  //
  // When self anomalies are exactly equal (or all weights are 0), the order
  // is settled deterministically by service id.
  const weights = toRankingWeights(options);
  // Extract the ratioContrib of each node's collision result once, so the
  // comparator does not re-read the (possibly undefined) collision map per
  // comparison.
  const ratioContrib = new Map<ServiceId, number>();
  for (const [id, ce] of collisionEnergy ?? []) {
    ratioContrib.set(id, ce.ratioContrib);
  }
  // Gate the collapse half of the rise signal by the log signal: a RISE is
  // always rewarded; a COLLAPSE is penalised only when the service emitted NO
  // logic exception (silent symptom), never when it did (source crash). The gate
  // is applied where the term is BUILT rather than through a per-term helper,
  // because the term has to be classified as `MASKED` when the gate is what made
  // it zero — and a helper computing the value would take that fact with it.
  const riseWeight = options.riseWeight;
  // The trace-activity signal rewards the unique significant span-count riser
  // (silent-source signature). It is a pure {0,1} indicator per service, so the
  // term is simply the weight applied to whichever service was flagged.
  const traceWeight = options.traceWeight;
  // The PRISM graph-free signal rewards the node anomalous in BOTH its internal
  // (cpu/mem/disk/socket) and external (latency/error/throughput) channels —
  // the internal/external asymmetry of PRISM. `prismScore` is the max-normalised
  // PRISM M-score in [0, 1], so the term is simply the weight applied to the
  // service's normalised score (0 when the signal is absent/neutral).
  const prismWeight = options.prismWeight;
  // The failed-edge-direction signal rewards the CALLEE of post-injection failed
  // calls — the service whose interface was failing — which is the inverse of the
  // log signal's credit to the emitter. Non-negative by construction
  // (`computeFailedEdgeScores` clamps each edge's net at zero), so this term can
  // only ever reward.
  const failedEdgeWeight = options.failedEdgeWeight;
  // The continuous counterpart of the term above, and the only term whose
  // magnitude comes from a DURATION rather than a count: it exists exactly where
  // the counts are zero. `edgeLatencyScores` is absent (not empty) when the case
  // carried no per-edge measurements, so a case without the field scores exactly
  // as it did before this term existed.
  const latWeight = options.latWeight;
  // The DB-connection-pool penalty, and the only NEGATIVE term here whose sign is
  // not already inside the signal (the collision term's `ratioContrib` is defined
  // as a penalty; this indicator is 1 = pool-dominant, so the minus is the term's).
  // An absent map and an entry of 0 mean the same thing to it — no evidence —
  // which is why the lookup may fall back: only a measured dominance is punished.
  const poolPenaltyWeight = options.poolMetricPenaltyWeight;
  // The decisive-stability term. Its map is ABSENT for a service the engine could not decompose,
  // which is why the lookup keeps a neutral fallback: `undefined` is not a measured bonus of zero.
  const stabilityWeight = options.stabilityWeight;
  const selfAnomalyWeight = options.selfAnomalyWeight;
  // The self-time term. Its map is ABSENT when the case carries no usable latency channel (or when a
  // candidate has an undecidable callee), so the lookup keeps the neutral 0 — the same rule the other
  // sparse maps follow: a missing measurement is not a measured zero, and this term only ever rewards.
  const selfTimeWeight = options.selfTimeWeight;
  // The internal/external symmetry mask. Its map is ABSENT at the shipped weight (not built), and a
  // candidate missing from it is NEUTRAL rather than fully discounted — a case the map cannot judge is not
  // a case it can punish, which is why the lookup substitutes the symmetry 1 the map would have given a
  // component with no internal channel.
  const victimWeight = options.victimWeight;
  // The dual-family bonus. A membership test rather than a value: the term is the weight or nothing, which is
  // what keeps an imported SHAPE from becoming an imported SCALE.
  const dualFamilyWeight = options.dualFamilyWeight;
  // `sourceScores` is populated for every node in `allNodes` (see its
  // construction loop above), and `scoredNodes` is a subset of `allNodes`, so
  // its lookup never falls back. The `onsetSlopes`, `topoScores`,
  // `logScores`, `riseScores` and `ratioContrib` maps, in contrast, are derived
  // from OPTIONAL graph fields (or are empty when the injection time is
  // unknown), so their lookups keep a neutral fallback.
  // Compute the ranking score for every candidate exactly once, so the sort
  // comparator and the emitted results share a single source of truth. The
  // formula matches the `finalScore(v)` documented on the ranking weights; the
  // log term reads `selfScores` directly because `scoredNodes[i].score` is that
  // same value (each scored node was pushed with its `selfScores` entry).
  // The sum and its BREAKDOWN are assembled in ONE array, and the total is that array's sum rather than a
  // parallel expression. That is the point: a breakdown kept beside a total is a second description of the
  // same score, and the two agree until one of them is edited — at which point the artifact reports a
  // decomposition of a number it did not come from. Here the total cannot disagree with its terms, and the
  // term order is the formula's own, so the floating-point sum is unchanged to the last bit.
  // The trace vote's leader mask, and the maximum it compares against — computed ONCE, from the same map the
  // base term reads, so "the loudest candidate" cannot mean two different things inside one ranking.
  const traceSkipsLeader = options.traceSkipsLeader;
  let anomalyLeaderScore = Number.NEGATIVE_INFINITY;
  for (const score of selfScores.values()) {
    if (score > anomalyLeaderScore) anomalyLeaderScore = score;
  }

  const termCache = new Map<ServiceId, readonly ScoreTerm[]>();
  const termsOf = (id: ServiceId): readonly ScoreTerm[] => {
    let t = termCache.get(id);
    if (t === undefined) {
      // Every OPTIONAL source is read ONCE per candidate, so the value the contribution uses and the presence
      // the cause is classified from are the same lookup. Reading a map twice to ask "did it carry this id" is
      // how a term comes to report a cause for a lookup that did not decide it.
      //
      // `presenceOf` answers at the LEVEL the absence happened, which is why it takes the map itself: a term
      // reading `logScores?.get(id)` loses `logScores`, a term reading a PRESENT-but-EMPTY map loses the whole
      // tier, and a term reading a populated map loses an entry — and collapsing any two of those would report
      // one for another.
      //
      // The order is the level order, coarsest first: the map is missing, the map holds nothing, the map does
      // not hold this candidate. The EMPTY tier is tested before `has` because an empty map answers `false` to
      // `has` for every candidate, which is exactly the reading that would mislabel a producer that ran and
      // emitted nothing as a per-candidate measurement that is missing.
      const presenceOf = <V>(
        map: ReadonlyMap<ServiceId, V> | undefined,
        id: ServiceId,
      ): TermSourcePresence => {
        if (map === undefined) return 'MAP_ABSENT';
        if (map.size === 0) return 'MAP_EMPTY';
        return map.has(id) ? 'PRESENT' : 'ENTRY_ABSENT';
      };
      // The SET counterpart, with the same three tiers. A membership is a different container from a map, and
      // collapsing "no set" with "a set that does not hold this candidate" would report one absence for another
      // — which is the whole reason `presenceOf` reads the map itself rather than a lookup result.
      const presenceInSet = (
        set: ReadonlySet<ServiceId> | undefined,
        id: ServiceId,
      ): TermSourcePresence => {
        if (set === undefined) return 'MAP_ABSENT';
        if (set.size === 0) return 'MAP_EMPTY';
        return set.has(id) ? 'PRESENT' : 'ENTRY_ABSENT';
      };
      const onsetEntry = onsetSlopes.get(id);
      const collisionEntry = ratioContrib.get(id);
      const topoEntry = topoScores?.get(id);
      const logEntry = logScores?.get(id);
      const riseEntry = riseScores?.get(id);
      const traceEntry = traceActivityScores?.get(id);
      // A vote the leader mask withholds. `(traceEntry ?? 0) > 0` first, so a candidate the rule never voted for
      // is not reported as a candidate a gate withheld from.
      const traceSkipped =
        traceSkipsLeader && (traceEntry ?? 0) > 0 && selfScores.get(id) === anomalyLeaderScore;
      const prismEntry = prismScores?.get(id);
      const failedEdgeEntry = failedEdgeScores?.get(id);
      const latEntry = edgeLatencyScores?.get(id);
      const poolEntry = poolMetricScores?.get(id);
      const stabilityEntry = stabilityScores?.get(id);
      const selfTimeEntry = selfTimeScores?.get(id);
      const symmetryEntry = channelSymmetry?.get(id);
      const riseHasLogic = (logEntry ?? 0) > 0;
      // The direction the map carried, or the NEUTRAL 0.5 the formula substitutes. Read once so the value and
      // the ungated value it is compared against cannot come from two different lookups.
      const riseRaw = riseEntry ?? 0.5;
      const riseValue = gatedRiseContribution(riseRaw, riseHasLogic);
      t = [
        // `log1p`, not `log`: rank-normalized self anomalies live in [0, 1], the top service maps to exactly
        // 1.0, and `log(1.0) === 0` would collapse the base term to zero for the STRONGEST signal while
        // `log(0) === -Infinity` would destroy a zero-anomaly service.
        //
        // The weight is a declared constant now rather than the formula's own `1`, and that is what lets the
        // base term be ABLATED: at 0 this term reports `WEIGHT_ZERO` (the sharpest cause, and the only one the
        // literal could never produce), at 1 the sum is bit-identical to the literal. Its source is not
        // optional — `selfScores` carries every scored node — so the two absence causes stay unreachable by
        // construction, which the neighbouring test asserts for this term by name.
        buildTerm('selfAnomalyLog1p', selfAnomalyWeight, Math.log1p(selfScores.get(id)!), {
          presence: 'PRESENT',
          source: 'selfScores',
        }),
        buildTerm('source', weights.sourceWeight, sourceScores.get(id)!, {
          presence: 'PRESENT',
          source: 'sourceScores',
        }),
        buildTerm('temporal', weights.temporalWeight, onsetEntry ?? 0, {
          presence: presenceOf(onsetSlopes, id),
          source: 'onsetSlopes',
        }),
        buildTerm('collision', -weights.collisionWeight, collisionEntry ?? 0, {
          presence: presenceOf(collisionEnergy, id),
          source: 'collisionEnergy',
        }),
        buildTerm('topo', weights.topoWeight, topoEntry ?? 0, {
          presence: presenceOf(topoScores, id),
          source: 'topoScores',
        }),
        buildTerm('log', weights.logWeight, logEntry ?? 0, {
          presence: presenceOf(logScores, id),
          source: 'logScores',
        }),
        // The only term with a gate INSIDE the score rather than in the map's construction: a collapse is
        // penalised only when the service emitted no logic exception, so a present, non-zero direction can
        // still contribute zero.
        //
        // `masked` is ONE comparison rather than a chain of guards — the gate applied exactly when the value it
        // produced differs from the one it was handed. That is the same statement the chain was making, and it
        // is the only form in which the flag cannot be true for a reason the cause cannot see: the gate's only
        // possible effect is to turn a non-zero collapse into 0, so a difference IS the gate firing.
        buildTerm('rise', riseWeight, riseValue, {
          presence: presenceOf(riseScores, id),
          source: 'riseScores',
          masked: riseValue !== 2 * (riseRaw - 0.5),
          mask: 'logicExceptionGate',
        }),
        // The vote, and the ONE precondition that can withhold it from a CANDIDATE rather than from a case. The
        // case-level gate decides whether the corpus is SILENT; this decides whether a loud candidate is the one
        // that should be paid for being loud. `selfScores.get(id) === anomalyLeaderScore` is an exact comparison
        // because the leader's score IS one of the values the maximum was taken over.
        //
        // The gate zeroes the VALUE and the flag records that it did — the shape the `rise` term established:
        // `buildTerm` derives its contribution from the value, so a flag alone would report `MASKED` over a
        // non-zero contribution, which is a cause the classification could never reach.
        buildTerm('trace', traceWeight, traceSkipped ? 0 : (traceEntry ?? 0), {
          presence: presenceOf(traceActivityScores, id),
          source: 'traceActivityScores',
          masked: traceSkipped,
          mask: 'traceSkipsLeader',
        }),
        buildTerm('prism', prismWeight, prismEntry ?? 0, {
          presence: presenceOf(prismScores, id),
          source: 'prismScores',
        }),
        buildTerm('failedEdge', failedEdgeWeight, failedEdgeEntry ?? 0, {
          presence: presenceOf(failedEdgeScores, id),
          source: 'failedEdgeScores',
        }),
        buildTerm('lat', latWeight, latEntry ?? 0, {
          presence: presenceOf(edgeLatencyScores, id),
          source: 'edgeLatencyScores',
        }),
        buildTerm('pool', -poolPenaltyWeight, poolEntry ?? 0, {
          presence: presenceOf(poolMetricScores, id),
          source: 'poolMetricScores',
        }),
        buildTerm('stability', stabilityWeight, stabilityEntry ?? 0, {
          presence: presenceOf(stabilityScores, id),
          source: 'stabilityScores',
        }),
        // The only term whose INPUT is a comparison with the candidate's CALLEES rather than a
        // property of the candidate: `selfTimeShare` is 0 for a service whose rise a callee fully
        // explains, so a missing entry (an undecidable callee) and a measured 0 both contribute
        // nothing and the term can only ever reward a node DOWNSTREAM evidence does not cover.
        buildTerm('selfTime', selfTimeWeight, selfTimeEntry ?? 0, {
          presence: presenceOf(selfTimeScores, id),
          source: 'selfTimeScores',
        }),
        // PRISM's axiom as a MASK: a component whose anomaly is EXTERNAL-ONLY is downstream of something, so
        // the term removes a share of its own evidence rather than adding a score beside it. The value is
        // `(1 − symmetry) × log1p(selfAnomaly)`, i.e. at weight 1 it cancels exactly the base term of a
        // component that failed the axiom and exactly half of one that is balanced.
        buildTerm(
          'victim',
          -victimWeight,
          (1 - (symmetryEntry ?? 1)) * Math.log1p(selfScores.get(id)!),
          { presence: presenceOf(channelSymmetry, id), source: 'channelSymmetry' },
        ),
        // PRISM's shape test as a bounded indicator: the weight or nothing, never a magnitude. The one form of
        // this axiom that cannot re-weight a ranking by an imported scale.
        buildTerm('dualFamily', dualFamilyWeight, dualFamilyServices?.has(id) ? 1 : 0, {
          presence: presenceInSet(dualFamilyServices, id),
          source: 'dualFamilyServices',
        }),
      ];
      termCache.set(id, t);
    }
    return t;
  };
  const finalScores = new Map<ServiceId, number>();
  const finalScoreOf = (id: ServiceId): number => {
    let s = finalScores.get(id);
    if (s === undefined) {
      s = sumScoreTerms(termsOf(id));
      finalScores.set(id, s);
    }
    return s;
  };

  scoredNodes.sort((a, b) => {
    const d = finalScoreOf(b.serviceId) - finalScoreOf(a.serviceId);
    if (d !== 0) return d;
    return a.serviceId < b.serviceId ? -1 : 1;
  });

  // Top-K results with collision type awareness
  const results: RootCauseResult[] = [];
  for (let i = 0; i < Math.min(topK, scoredNodes.length); i++) {
    const node = scoredNodes[i]!;
    const errorBound = estimatePropagationError(node.depth, options.decayAlpha);
    const cResult = collisionEnergy?.get(node.serviceId);
    const collisionType = cResult?.collisionType ?? 'chain';

    // Collision-enhanced severity: non-chain types suggest systemic impact
    let severityLabel = node.score > 0.7 ? 'critical' : node.score > 0.4 ? 'major' : 'minor';
    if (collisionType === 'cycle') severityLabel = 'critical';
    else if (collisionType === 'bottleneck' && severityLabel !== 'critical')
      severityLabel = 'major';

    results.push({
      serviceId: node.serviceId,
      faultType: {
        category: 'UNKNOWN',
        subType: `anomaly_propagation_${collisionType}`,
        severity: severityLabel as 'critical' | 'major' | 'minor',
      },
      confidence: computeConfidence(node.score, node.depth, errorBound),
      finalScore: finalScoreOf(node.serviceId),
      // The breakdown of the value above, from the same assembly, so `finalScore` and its terms cannot
      // disagree — see `sumScoreTerms`. It travels on EVERY result rather than only on a miss, because the
      // attribution a benchmark needs compares the truth's terms with the WINNER's, and the winner is by
      // definition not a miss.
      terms: termsOf(node.serviceId),
      rank: i + 1,
      evidenceMetrics: [
        { metric: 'rca_score', value: node.score, threshold: 0.1 },
        ...(cResult
          ? [{ metric: 'collision_gain', value: cResult.collisionGain, threshold: 0.3 }]
          : []),
        // The deduction's own decision about THIS candidate, when the deduction ran at all. It is an
        // evidence row rather than a score term because it is not part of `finalScore` — it is the reading
        // that explains why the anomaly above moved — and `threshold` is the run's gate, so the row carries
        // the cut that judged it instead of leaving a reader to look one up in the configuration line.
        //
        // Present only for a candidate the operator CONSIDERED: a node the scope never looked at has no
        // share, and writing 0 would report a configuration fact as a measurement of the corpus.
        ...(topoAudit !== undefined && topoAudit.share.has(node.serviceId)
          ? [
              {
                metric: 'topo_share',
                value: topoAudit.share.get(node.serviceId)!,
                threshold: topoAudit.gate,
              },
            ]
          : []),
      ],
      propagationDepth: node.depth,
      propagationErrorBound: errorBound,
      viaTreeSearch: true,
    });
  }

  return results;
}

/**
 * Estimate propagation error after k hops.
 *
 * Error grows multiplicatively with each hop:
 *   ε_k = 1 - α^k
 *
 * where α is the 1-hop propagation accuracy.
 *
 * Deng Yu mapping: cumulative error bound in the BBGKY truncation.
 *
 * @internal
 */
function estimatePropagationError(depth: number, decayAlpha: number): number {
  return 1 - Math.pow(decayAlpha, Math.max(depth, 0));
}

/**
 * Compute confidence from score, depth, and error bound.
 *
 * confidence = score × (1 - errorBound)
 *
 * High score + low error = high confidence.
 *
 * @internal
 */
function computeConfidence(score: number, depth: number, errorBound: number): number {
  const depthPenalty = depth > 0 ? 1 / (1 + Math.log(depth + 1)) : 1;
  return Math.max(0, Math.min(1, score * (1 - errorBound) * depthPenalty));
}

/**
 * Compute the global temporal earliness score for each service from its
 * post-injection onset delay.
 *
 * Each defined delay (ms after fault injection) is min-max normalised so the
 * EARLIEST service scores 1 and the LATEST scores 0; an undetermined delay
 * (absent from the map, negative, or non-finite) stays out of the map and is
 * treated as neutral 0.5 by the caller. A single defined onset (or none, or
 * an unknown injection time) carries no comparative information, so the map is
 * left empty — the temporal signal then contributes nothing to the ranking.
 *
 * Exported rather than `@internal` on purpose: the offline diagnostic screen
 * answers "would any weight on this term help?" over dumps, and a SECOND
 * implementation of the normalisation would be a second answer to that
 * question — the exact defect this repo's analyzer exists to find. The engine's
 * ranking and the offline screen therefore share this function, including its
 * "too few onsets and there is no signal" rule, so a screen can never report a
 * window for a term the engine would have left inert.
 */
export function computeTemporalEarliness(
  postInjectOnsetDelays: ReadonlyMap<ServiceId, number> | undefined,
  injectTimeMs: number,
): Map<ServiceId, number> {
  const earliness = new Map<ServiceId, number>();
  if (!injectTimeMs || injectTimeMs <= 0 || !postInjectOnsetDelays) return earliness;

  const defined: Array<{ id: ServiceId; delay: number }> = [];
  for (const [id, delay] of postInjectOnsetDelays) {
    if (Number.isFinite(delay) && delay >= 0) defined.push({ id, delay });
  }

  // A single defined onset (or none) cannot establish a before/after order.
  if (defined.length < 2) return earliness;

  let minDelay = Infinity;
  let maxDelay = -Infinity;
  for (const { delay } of defined) {
    if (delay < minDelay) minDelay = delay;
    if (delay > maxDelay) maxDelay = delay;
  }
  const span = maxDelay - minDelay;

  for (const { id, delay } of defined) {
    // earliest → 1, latest → 0; a zero span (all tied) → neutral 0.5.
    earliness.set(id, span > 0 ? 1 - (delay - minDelay) / span : 0.5);
  }
  return earliness;
}

/**
 * The temporal prior's per-service SLOPE in one shape: what the term ADDS, per unit
 * of `temporalWeight`.
 *
 * The slope rather than the score, because every candidate's final score is affine in
 * the weight — `base + w × slope` — which is what makes a weight window solvable
 * instead of sweepable, offline, from a dump. Both the engine's ranking and the offline
 * screen call THIS function, so a screen cannot report a window for a term the ranking
 * would have left inert.
 *
 * The `earliness` shape is `2 × (earliness − 0.5)`, computed from
 * {@link computeTemporalEarliness}, so a service the engine excludes from the map has
 * slope 0 here — exactly the `?? 0` the ranking used to apply to `2 × (0.5 − 0.5)`.
 * Multiplying by 2 is exact in binary floating point, so this is bit-identical to the
 * expression it replaces, not merely equal.
 *
 * ABSENT, not zero, when the term cannot act: the map is empty when there are fewer
 * than two defined onsets or no injection time, and callers read a missing entry as
 * "no credit". Filling it with 0.5-valued neutrals would make "nothing measured" and
 * "everything simultaneous" the same object, and they are different statements.
 *
 * @param postInjectOnsetDelays - Onset delay in ms per service; negative = undetermined.
 * @param injectTimeMs - Fault injection time; `0` or absent means unknown, and the map
 *   is then left empty because no delay can be anchored to anything.
 * @param shape - Which shape to build; defaults to the shipped one.
 * @returns The slope per measurable service; empty when the term cannot act.
 */
export function computeOnsetSlopes(
  postInjectOnsetDelays: ReadonlyMap<ServiceId, number> | undefined,
  injectTimeMs: number,
  shape: OnsetShape = DEFAULT_ONSET_SHAPE,
): Map<ServiceId, number> {
  const slopes = new Map<ServiceId, number>();
  const defined: Array<{ id: ServiceId; delay: number }> = [];
  if (injectTimeMs > 0 && postInjectOnsetDelays) {
    for (const [id, delay] of postInjectOnsetDelays) {
      if (Number.isFinite(delay) && delay >= 0) defined.push({ id, delay });
    }
  }
  // The engine's own precondition, applied to every shape: one onset cannot establish a
  // before/after order, and no anchor means no delay is anchored to anything.
  if (defined.length < 2) return slopes;

  if (shape === 'earliness') {
    const earliness = computeTemporalEarliness(postInjectOnsetDelays, injectTimeMs);
    for (const { id } of defined) {
      // Total over the defined set, which is what `computeTemporalEarliness` returns
      // for the same inputs — the map is non-empty here because `defined.length >= 2`.
      slopes.set(id, 2 * (earliness.get(id)! - 0.5));
    }
    return slopes;
  }

  // Every other shape reads the order, which min-max normalisation cannot express. The
  // tiebreak is the service id, as everywhere in this repo, so a screen over a dump is
  // reproducible and the tie does not depend on Map insertion order.
  const ordered = [...defined].sort((a, b) => a.delay - b.delay || (a.id < b.id ? -1 : 1));
  if (shape === 'order') {
    // A zero SPAN — every delay equal — carries no rank information, and the ranks a
    // comparator would still produce from it are an artefact of that comparator. The
    // test is on the delays, not on the length: a field of three tied services has
    // three ranks to hand out and no reason to hand them out.
    const span = ordered[ordered.length - 1]!.delay - ordered[0]!.delay;
    const last = ordered.length - 1;
    ordered.forEach(({ id }, index) => {
      slopes.set(id, span > 0 ? 1 - (2 * index) / last : 0);
    });
    return slopes;
  }
  // `earliest-only` / `latest-only`: one credited set, and a TIE at the boundary is
  // credited together — the alternative would make a shape whose whole claim is about
  // simultaneity depend on the service-id tiebreak.
  const boundary =
    shape === 'earliest-only' ? ordered[0]!.delay : ordered[ordered.length - 1]!.delay;
  for (const { id, delay } of ordered) {
    if (delay === boundary) slopes.set(id, shape === 'earliest-only' ? 1 : -1);
  }
  return slopes;
}
