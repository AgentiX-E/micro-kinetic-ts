/**
 * Topology-Preserving Fault Graph Builder — builds fault propagation graphs
 * that preserve the original service topology edges from YAML/trace configs,
 * using real Pearson cross-service anomaly correlation for edge weights.
 *
 * ## Motivation
 *
 * The existing `buildChronologicalPropagationTree()` in TreePruner discards
 * all YAML topology edges and replaces them with a generic star-tree based
 * on anomaly onset times. This loses the actual service dependency structure
 * that is essential for accurate root cause localization.
 *
 * ## Architecture
 *
 * 1. **Preserve topology edges** — Use the call graph's edges as-is (from
 *    YAML configs + semantic enhancement). No synthetic edge replacement.
 *
 * 2. **Pearson cross-service correlation** — For each topology edge (A→B),
 *    compute the Pearson correlation coefficient between A's metric time-series
 *    and B's metric time-series. High correlation → high propagation weight.
 *
 * 3. **Multi-metric aggregation** — Each service has multiple metrics (cpu, mem,
 *    disk, latency, etc.). The edge weight is the maximum Pearson coefficient
 *    across all metric pairs from source to target.
 *
 * 4. **Temporal causality bonus** — If the source's anomaly appears BEFORE
 *    the target's anomaly (onset time ordering), the edge weight gets a temporal
 *    causality bonus of +0.15 (clamped to [0, 1]).
 *
 * 5. **Degraded signal handling** — When metrics have <2 data points or all-zero
 *    values, use anomaly score similarity as fallback instead of crashing.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * The topology-preserving approach maps directly to Deng Yu's physical framework:
 * - Edge (A→B) → kinetic collision channel between A and B
 * - Pearson correlation → collision cross-section magnitude
 * - Temporal onset ordering → causality direction (which particle emitted first)
 * - Multi-metric aggregation → multi-channel coupling in BBGKY hierarchy
 *
 * @module causal/topology-fault-graph
 */

import type {
  CallEdge,
  MetricDiagnostic,
  MetricDiagnosticOutcome,
  MetricScoreBreakdown,
  ServiceCallGraph,
  ServiceId,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  invariantFinite,
  invariantRange,
  StatisticalAnalyzer,
} from '@agentix-e/micro-kinetic-core';

import type { BOCPDConfig } from '../../../kinetic/src/signals/bocpd-detector.js';

import { computePropagationVelocity } from './propagation-velocity.js';

/**
 * Configuration for the topology-preserving fault graph builder.
 */
export interface TopologyFaultGraphConfig {
  /** Minimum number of data points required for correlation. Default: 3. */
  readonly minDataPoints: number;
  /** Temporal causality bonus: added when source anomaly precedes target. Default: 0.15. */
  readonly temporalBonus: number;
  /** Default edge weight when correlation cannot be computed. Default: 0.05. */
  readonly defaultWeight: number;
  /** Whether to apply temporal causality analysis. Default: true. */
  readonly useTemporalCausality: boolean;
  /**
   * Baseline estimation strategy when change-point detection fails.
   *
   * - `auto`: detect metric distribution shape and select best strategy (default)
   * - `q25`: lower-quartile mean — best for bimodal data (clear pre-spike
   *   baseline + sharp 3-10× spike).  +12% on OnlineBoutique RE1.
   * - `sliding-window`: sliding-window minimum — best for continuous data
   *   (gradual ramps, smooth trends).  +21.6% on SockShop RE1.
   *
   * Auto-detection: counts values > 0.8×max.  If 30–70% of points are
   * in the spike (spike-dominated, typical of stress-ng benchmarks like
   * OnlineBoutique), selects q25.  Otherwise selects sliding-window.
   */
  readonly baselineStrategy: 'auto' | 'q25' | 'sliding-window';
  /**
   * Correlation method for cross-service propagation weight.
   *
   * - `spearman`: rank-based, robust to non-linear relationships (default)
   * - `pearson`: linear, original method (fallback when Spearman unavailable)
   *
   * Spearman rank correlation is preferred because microservice metrics
   * often exhibit monotonic but non-linear co-variation — a CPU fault
   * may cause a logarithmic latency increase, which Spearman detects
   * while Pearson may miss.
   */
  readonly correlationMethod: 'pearson' | 'spearman';
  /**
   * Whether to use adaptive decay parameters based on topology size.
   *
   * When enabled, decayAlpha is chosen automatically:
   *   | Services | decayAlpha | Rationale                         |
   *   | < 20     | 0.90       | Shallow tree — need deep signal   |
   *   | 20–49    | 0.85       | Balanced                          |
   *   | 50+      | 0.75       | Deep tree — prevent dilution      |
   *
   * Default: true.
   */
  readonly adaptiveDecay: boolean;
  /**
   * Whether to use BOCPD/MAD-based propagation velocity as a secondary
   * weight computation method when correlation is unavailable.
   * Default: true.
   */
  readonly usePropagationVelocity: boolean;
  /**
   * Propagation velocity model configuration.
   * Used when usePropagationVelocity=true and Pearson correlation
   * cannot be computed (e.g., insufficient or constant data).
   */
  readonly propagationVelocity?: {
    /** Whether to use BOCPD for onset detection (default: false, MAD-based). */
    readonly useBOCPD?: boolean;
    /** Expected direct-call latency in time-index units. Default: 1.0. */
    readonly expectedDirectLatency?: number;
    /**
     * BOCPD onset-detection tuning. Only consulted when `useBOCPD` is true.
     *
     * The default BOCPD config (`hazardRate: 1/250`) is deliberately
     * conservative — tuned for ~250-observation segments — so it never fires
     * on the short (≤100-point) series a fault graph sees. Callers enabling
     * `useBOCPD` must therefore raise `hazardRate` (e.g. 0.3) to detect a
     * changepoint; without it the BOCPD path yields `propagationProbability 0`
     * and the edge falls through to the anomaly-similarity tier.
     */
    readonly bocpd?: Partial<BOCPDConfig>;
  };
  /**
   * Fault injection time in Unix milliseconds (case-level temporal anchor).
   *
   * When `> 0`, the builder computes each service's onset DELAY relative to
   * this instant (using the pre-injection window as a clean baseline) instead
   * of relying solely on the index-based, self-derived-baseline onset. This
   * yields a far more reliable source/symptom ordering — the fault source's
   * metric deviates at (or immediately after) injection, while symptoms lag
   * as the disturbance propagates. `0`/`undefined` means "unknown" and
   * disables the anchored onset (the index-based fallback still applies).
   */
  readonly injectTimeMs?: number;
  /**
   * Direction-aware deviation: the factor by which the DROP component of a
   * metric's deviation is discounted, in [0, 1].
   *
   * The anomaly deviation is currently `log10(1 + max(riseRatio, dropRatio))`,
   * treating a monotonic RISE (resource consumption, work) and a monotonic
   * COLLAPSE (traffic loss, shutdown) as equally anomalous. But they are NOT
   * symmetric signals: a fault SOURCE's metric RISES (leak, saturation, wrong
   * value doing more work), while a downstream SYMPTOM's traffic metric
   * COLLAPSES to near-zero once the source stops feeding it (TrainTicket RE3:
   * source workload 0.4→1.4 vs symptom cpu 3.55→0.046). Rewarding the rise and
   * discounting the collapse makes the score direction-aware:
   *
   *   effectiveRatio = max(riseRatio, dropRatio × (1 − collapseDiscount))
   *
   * `0` (default) is bit-identical to the current symmetric behaviour. `1`
   * ignores drops entirely (only rises count). The drop is DISCOUNTED, never
   * amplified — the opposite of the #193 "drop vs post-drop minimum" failure,
   * which re-exploded drop-noise by making a collapse symmetric with a rise.
   *
   * Opt-in: a genuine crash fault (RE1/RE2 resource exhaustion) manifests as a
   * RISE first (usage climbs to the limit), so its rise component still scores
   * even when the post-crash drop is discounted; the ablation must confirm
   * this against real RE1/RE2 data before the default is changed.
   */
  readonly collapseDiscount: number;
  /**
   * Rank-based anomaly-score normalization for large topologies (at or above
   * {@link ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes — the flag cannot act below it).
   *
   * When `true`, the min-max rescale of `anomalyScores` is replaced by a
   * uniform-rank mapping (average rank / (n − 1), ties averaged). Min-max is
   * not robust to a single outlier: a near-zero-baseline spike (a symptom
   * metric like latency-90 rising 41–764×) sets the range's max, crushing the
   * genuine source's modest deviation toward zero and letting the symptom win
   * the log-domain anomaly term by a ~1.7 margin. Rank normalization is
   * metric-semantics-agnostic — it maps the outlier and the second-ranked
   * source to ≈1.0 vs ≈0.98, so the deterministic causal signals (trace/topo)
   * that already point at the silent source can tip the ranking.
   *
   * It is inert below {@link ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes, so small calibrated topologies
   * (OnlineBoutique 12–14, SockShop 12–14) keep their existing scoring either way.
   *
   * Default: {@link DEFAULT_RANK_NORMALIZATION}, which is **`true`** — the SHIPPED value. This doc used to
   * say `false` was "shipped behaviour", and the default agreed with it, while every published number was
   * measured with the flag ON, carried as an independent literal default in two runner parsers. A caller who
   * built the engine with no topology argument therefore got a configuration the README's numbers were not
   * measured under — see `docs/rank-normalization-default-audit.md`.
   */
  readonly rankNormalization: boolean;
  /**
   * The node count at or above which a case's anomalies are rescaled at all.
   *
   * **The axis's population, and until this field existed it was not an option.** `rankNormalization` picks
   * WHICH rescale; this picks WHETHER any runs, and it is the second decision that decides how much of a
   * benchmark the first one can act on. Measured over the 735 RCAEval cases, the two sides are exactly the
   * small systems and the large one — 487 cases (OnlineBoutique ≤ 12 nodes, SockShop ≤ 15) below, 248
   * (TrainTicket 63–69) at or above — so the register's `rankNormalization ON — never revert` verdict has
   * never been testable on two thirds of the corpus, because the flag is not read there at all.
   *
   * It is a field rather than a constant for the reason `rankNormalization` is: a value that decides which
   * cases a mechanism acts on cannot be varied, no run can measure the mechanism's population, and the
   * register ends up holding a verdict about a population nobody chose. Default:
   * {@link ANOMALY_NORMALIZE_NODE_THRESHOLD}, which is the shipped behaviour.
   */
  readonly anomalyNormalizeNodeThreshold: number;
  /**
   * Whether to extend the transient-spike guard to an IDLE-start transient:
   * a metric that starts at ~0 (head ≤ max × 0.001), has a transient excursion
   * (permanence < 0.3) and settles at a NON-zero tail (tail > max × 0.001).
   *
   * Such a metric is a duty-cycled event/resource that was IDLE before the
   * fault and only became active during it (e.g. a latency percentile that is
   * 0 with no traffic, then pulses when the fault propagates). Its relative
   * RISE over the near-zero baseline is a measurement artifact — latency-90
   * rising 0 → 0.091 s over a 0.201 s baseline reads as a 19× "rise" that
   * outranks the genuine permanent drop (the ts-route-service RE3 signature).
   *
   * The guard is deliberately conservative: it only fires when the head is
   * near-zero AND the tail is NON-zero, so a zero→burst→zero EVENT fault (the
   * #199 RE3 OnlineBoutique error-burst regression, whose tail returns to
   * zero) is still kept — its spike is the fault itself, not a symptom.
   * Default: `false` (bit-identical to the shipped transient-spike guard).
   */
  readonly suppressIdleTransients: boolean;
  /**
   * Suppress a metric whose baseline is essentially ZERO (≤ `0.001`) from
   * scoring its RISE.
   *
   * A relative rise is `|max − baseline| / baseline`; when the baseline is
   * near-zero the ratio explodes for a meaningless absolute excursion — a
   * `rabbitmq-exporter::cpu` baseline of 0.0001 rising to 0.003 reads as a
   * 32× "rise" (dev ≈ 1.5) and outranks a genuine crash drop, whose dev is
   * hard-capped at `log10(2) ≈ 0.301` (the drop/rise asymmetry in
   * `docs/re3-fault-ceiling.md`). The offending baseline is near-zero but NOT
   * exactly zero, so it escapes both the change-point path's exact-zero reset
   * and the idle guard's `> 40% near-zero` fraction (the leak sits at 30–39%).
   *
   * The `0.001` epsilon is the SAME absolute floor used by
   * `computeRobustBaseline` (`> 0.001` meaningful baseline) and `isCrash`
   * (`headMedian > 0.001`), so a genuinely idle metric is treated uniformly.
   * A zero→burst→zero EVENT fault keeps its exact-zero baseline (reset to the
   * full mean, which the burst raises well above 0.001) and is untouched.
   *
   * Default: `false` (bit-identical to shipped behaviour). Opt-in — the
   * ablation must confirm a net RE3 gain with zero RE1/RE2 regression before
   * the default is changed.
   */
  readonly suppressNearZeroBaselineRise: boolean;
  /**
   * Whether a TRANSPORT channel whose head window has no level is discarded as evidence.
   *
   * The RE3-TrainTicket miss, verbatim from run `40255890256`: the winner's decisive channel is `latency-90`
   * with `head=[0,0,0,0,0,0]` and `tail=[0.0235, …]`, read as a **764× rise** (`dev=2.884`) against a truth
   * whose own evidence is a `socket` DROP (17 → 9, `dev=0.34`). A percentile that reports `0` means the
   * service answered NOTHING in that window, so the "rise" measures the arrival of traffic rather than
   * slowness.
   *
   * Deliberately NARROWER than {@link suppressNearZeroBaselineRise}, which was measured a no-op: that guard
   * tests every family's baseline MEAN against `0.001`, and the failing winners sit at `base = 0.002` — just
   * above it. The question here is not "is the baseline small" but "did the channel have a LEVEL", and it is
   * asked of the transport family only: a resource channel at zero is the idle/crash question the
   * `duty-cycled-idle` guard already owns, and it is the signature of genuine TrainTicket faults.
   */
  readonly suppressZeroBaselineLatency: boolean;
  /**
   * Whether the TREND bonus may exceed the deviation it augments.
   *
   * `true` caps `trendBonus` at `deviation`; `false` is the shipped, unbounded shape.
   *
   * The defect, read off run `40285881991` on RE3-TrainTicket `re3tt_ts-route-service_f1_3`: the winner
   * scored `latency-90` 2.35 → 0.021 — a COLLAPSE — at `deviation = 0.301` with a **trend bonus of 0.661**.
   * A relative drift is unbounded in the denominator, while a collapse's deviation is capped at `log₁₀(2)`
   * by construction (`docs/re3-fault-ceiling.md`), so the bonus can exceed the evidence **only** on the
   * collapse side — which is exactly the side a service that stopped serving occupies.
   *
   * This is the minimal form of the asymmetry rule: it treats both directions alike (a rise whose bonus
   * exceeds its deviation is capped too, and never occurs on this corpus) and refuses to re-introduce the
   * direction the term deliberately does not read.
   */
  readonly capTrendBonusAtDeviation: boolean;
  /**
   * Whether a DEMAND metric may be a node's decisive evidence at all.
   *
   * A demand metric counts how much work a service was HANDED (`workload` and its family), not how it
   * behaved while doing it. A fault is a change in the second; a change in the first is a ROUTING outcome,
   * produced by whatever upstream failed — which is why the family is over-represented as the decisive
   * metric of bystanders and barely present as the decisive metric of truths.
   *
   * **Measured, on the one cell this repository can rank offline** (`docs/rcaeval-local-harness.md`, run
   * through `benchmarks/src/ablate-rcaeval-dump.ts`, whose fidelity on that dump is 125/125): the family is
   * decisive for **5 of 124 ground-truth services (4.0%) against 132 of 1057 bystanders (12.5%)**, and
   * removing it takes RE1-OnlineBoutique from **100/125 to 103/125 with zero regressed fault types**
   * (`disk` 84% → 92%, `loss` 44% → 48%).
   *
   * **Provably inert on the other half**: the FSE'26 dump carries the string `workload` in **0 of its 7781
   * service lines** (`grep -c 'workload=' artifacts/r34928980425/fse26-results.txt` → 0), so no case there
   * can have a demand metric, decisive or otherwise.
   *
   * Default `true`, which is the ENROLMENT and not a preference: the gain above is measured with zero
   * regressed types, the other half cannot be affected, and the eight RCAEval cells this loop cannot rank
   * are read by the dispatch that follows the commit. A cell that moves DOWN there reverts this line.
   *
   * It is a boolean and not a weight on purpose. A discounted form was measured too — flat at +5 across
   * `α ∈ [0.20, 0.50]` — and a plateau is still a range to choose a number out of, which is the defect
   * `docs/fse26-discriminator-verdict.md` §20–§22 spent three iterations correcting.
   */
  readonly suppressDemandMetrics: boolean;
  /**
   * Largest relative deviation ONE metric may contribute, as a bound on the
   * ratio itself rather than on the resulting score.
   *
   * `deviation = log10(1 + max(riseRatio, dropRatio × (1 − collapseDiscount)))`
   * is unbounded in the RISE direction and bounded at `log10(2) ≈ 0.301` in the
   * DROP direction (a relative drop cannot exceed 100%), so `max over metrics`
   * hands a service's whole anomaly score to whichever of its metrics happened
   * to move furthest in relative terms. Measured on the FSE'26 silent block
   * (run 34694846718, 369 cases): the metric that dethroned the fault source
   * rises a median of 29.2× against the source's own 8.5×, so the *symptom*
   * wins on dynamic range alone — `docs/fse26-metric-competition-verdict.md`.
   *
   * A ceiling states that past some point "moved a lot" is all a metric is
   * allowed to say, so no single metric can be worth an unbounded amount more
   * than another. It preserves the ordering among a service's own metrics below
   * the ceiling, which is where a source's genuine signature lives.
   *
   * Because a drop's ratio is already ≤ 1, any ceiling at or above 1 can only
   * affect rises; a ceiling below 1 is a bound on both directions.
   *
   * `0` (or any non-positive value) means OFF. Default: `0` — bit-identical to
   * the shipped scoring, which is what the golden RCAEval baseline depends on.
   */
  readonly metricRiseCeiling: number;
  /**
   * Subtract each metric's CROSS-SERVICE median from the metric's score before
   * taking the service maximum.
   *
   * A metric that moved for every service in the case — an agent queue draining
   * harder because the whole fleet logged more, a node-level load average, a
   * database pool under fleet-wide traffic — carries no information about WHICH
   * service is the root cause, yet `max over metrics` cannot distinguish "this
   * service is unusual on this metric" from "everyone moved and this service
   * moved a little more". Removing the shared component makes the score answer
   * "is this service unusual on this metric", which is the question a root-cause
   * rank is actually asking.
   *
   * This is one of only two operations that can REORDER two services. A bound on
   * the ratio cannot: `min` is monotone, so clamping can only shrink a margin or
   * tie both parties (see `metricRiseCeiling`). Changing which metric is the
   * maximum is the other.
   *
   * Default: `false` (bit-identical to shipped behaviour).
   */
  readonly metricFleetBaseline: boolean;
  /**
   * Weight of the TREND bonus: `trendStrength × this`, added to a metric's score when the fitted drift of
   * the window exceeds `0.1` of its mean.
   *
   * One of three coefficients that together ARE the RCAEval RE1 ranking. On that population every other
   * term is `WEIGHT_ZERO` or `INPUT_MAP_EMPTY` on all 374 analysable cases (run `40133362501`'s loss
   * census), so the ranking there is `deviation + trend + burst + cv` plus a `0.007352` tie-break — and the
   * three numbers had never been named, let alone ablated, which is why they are configuration now.
   *
   * Default: 0.15 (shipped behaviour).
   */
  readonly anomalyTrendWeight: number;
  /**
   * Weight of the BURST bonus: `deviation × this`, added when any sample exceeds `mean + 3σ`.
   *
   * Default: 0.1 (shipped behaviour).
   */
  readonly anomalyBurstWeight: number;
  /**
   * Weight of the coefficient-of-variation bonus: `min(cv, 1.5) × this`, added when `cv > 0.5`.
   *
   * Default: 0.05 (shipped behaviour).
   */
  readonly anomalyCvWeight: number;
  /**
   * Weight of the BREADTH term: how many of a service's channels moved, added to its anomaly score.
   *
   *   breadth(v) = (Σ_i d_i)² / Σ_i d_i²  −  1        over the KEPT metrics of v
   *
   * The score is a `max` over metrics, so a node whose cpu, mem and latency ALL moved scores exactly the
   * same as a node where a single latency channel moved by the same amount — and on RCAEval the second is
   * usually the propagated SYMPTOM while the first is the source. `breadth` is the effective number of
   * moving channels minus one: 0 for a single channel, `k−1` when `k` channels moved equally, and — the
   * property that matters after three iterations of scale defects — a pure RATIO, so it means the same
   * thing on OnlineBoutique's raw scores (order 1–3) and on TrainTicket's rank-normalised ones (steps of
   * 1/63). It is added rather than multiplied because a node-dependent multiplier was measured to destroy
   * the ranking it was meant to refine (`docs/dispatch-forwarding.md` §7–§8).
   *
   * Default: 0 — OFF, i.e. bit-identical to the shipped ranking. A non-zero value is a candidate, not a
   * decision: the 26 one-step misses on RE1 are what it is aimed at, and the nine cells decide.
   */
  readonly anomalyBreadthWeight: number;
  /**
   * CONTENDER gate for the breadth term: the bonus applies only to nodes whose own deviation is at least
   * this FRACTION of the fleet's largest.
   *
   * `0` — the shipped value — means no gate, i.e. every node with a breadth earns the bonus. A gate exists
   * because the ungated term was measured on both halves (`docs/anomaly-composition.md` §4a–§4b): RCAEval
   * gained **11 cases with no cell down**, while FSE'26 gained **7 Top@1 but lost 6 Top@5**. The reading is
   * that the bonus promotes nodes that are nowhere near contention into the top five, which a Top-1 metric
   * cannot see and a Top-5 metric pays for. The gate is a RATIO of the node's own score to the fleet's
   * best — the same dimensionless form the bonus itself uses — so it transfers between a raw and a
   * rank-normalised score.
   *
   * The prediction it is built on is falsifiable: on FSE'26 the Top@5 loss must shrink while Top@1 holds
   * its gain; if it does not, the promotion explanation is wrong and the term stays refused.
   *
   * Default: 0 (no gate).
   */
  readonly anomalyBreadthGate: number;
}

/**
 * Above this many nodes, and only above it, the anomaly scores a case is RANKED on are rescaled (step 1b of
 * {@link buildTopologyFaultGraph}). The engine's default for
 * {@link TopologyFaultGraphConfig.anomalyNormalizeNodeThreshold}.
 *
 * Exported because it is the one number that lets a reader INTERPRET a score the engine reported — the
 * difference between "self-anomaly 1.000 is the case maximum by construction" and "1.000 is a raw deviation
 * that happened to be the largest". A consumer holding a per-service anomaly vector and its node count cannot
 * tell those apart without it, and the failure is silent: a below-threshold vector's values are a different
 * quantity, not a differently-scaled one, so a reader that assumes the rescale has the engine's ORDER (any
 * rescale here is strictly monotone) and NOT its gaps.
 *
 * The two clauses of the condition are separate axes and both are load-bearing: the flag
 * {@link TopologyFaultGraphConfig.rankNormalization} picks WHICH rescale, this threshold decides WHETHER one
 * happens at all. Neither can be inferred from the other — **and the second one is the axis's POPULATION.**
 * Measured over the 735 RCAEval cases, the two sides are exactly the small systems and the large one: 487
 * cases below it (OnlineBoutique ≤ 12 nodes, SockShop ≤ 15) and 248 at or above (TrainTicket 63–69). So the
 * register's `rankNormalization ON — never revert` verdict has never been testable on two thirds of the
 * corpus, because below this line **the flag is not read at all**. That is why this value became
 * {@link TopologyFaultGraphConfig.anomalyNormalizeNodeThreshold} rather than staying a constant no run could
 * leave, and why the default here remains the shipped 20.
 */
export const ANOMALY_NORMALIZE_NODE_THRESHOLD = 20;

/**
 * Whether the engine rank-normalizes anomaly scores above the node threshold, when the caller says nothing.
 *
 * **This is the SHIPPED value, and it is the value every published number was measured with.** It was a
 * literal `false` in the defaults table (then `DEFAULT_CONFIG`) until this constant existed, described in
 * the field's own doc as
 * "shipped behaviour" — while the golden and FSE'26 runners each declared `true` as an independent literal
 * default of their own, and the register keeps the axis ON ("rankNormalizeScores ON — never revert"). Two
 * consequences followed, and both are recorded in `docs/rank-normalization-default-audit.md`:
 *
 * - a caller who built the engine with no topology argument — the DI container, the tree factory, two
 *   runners, and the L2 weight SEARCH — ran a configuration the published numbers were not measured under;
 * - the three owners could drift, which is the failure mode that once published a headline 24.2pp below the
 *   best-measured one: a value with more than one owner is a value with more than one answer.
 *
 * The flag is inert below {@link ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes, so the change moves nothing for
 * small calibrated topologies (OnlineBoutique 12–14, SockShop 12–14) and acts only where it was measured to
 * (Train Ticket's larger graph).
 */
export const DEFAULT_RANK_NORMALIZATION = true;

/**
 * The shipped defaults of the three topology knobs that had **no name** — the other half of the census
 * `docs/ranking-default-owners.md` records, and the same class as `DEFAULT_LOG_WEIGHT`.
 *
 * Each of the three declared its shipped value as a bare literal in {@link DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG}
 * AND in both parsers' option objects, while the workflows' input descriptions quoted the number — so
 * nothing could compare the sites. All three are `0`/`false`, i.e. an OFF value, which is why the class
 * survived: an off value that is never measured is never corrected, and a drift between two OFF values is
 * invisible until somebody enables one of them.
 *
 * @see DEFAULT_COLLAPSE_DISCOUNT for what the first of them decides.
 */
export const DEFAULT_COLLAPSE_DISCOUNT = 0;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.suppressIdleTransients}, which is `false`.
 *
 * Opt-in and measured: `suppressIdleTransients` was measured on the golden corpus (`38329682118` against
 * the same revision at `38329642349`) and REJECTED — OnlineBoutique RE1 80.0 → 80.8 and TrainTicket RE2
 * 71.1 → 73.3, but the three cases it lost are ALL TrainTicket `disk`, and enabling it takes that cell
 * from 73.3 to 53.3. The failure is systematic and the missing discriminator is a metric's OWNER rather
 * than its shape; `docs/near-zero-rise-suppression-falsified.md` owns the record.
 */
export const DEFAULT_SUPPRESS_IDLE_TRANSIENTS = false;

/**
 * The metric labels that count a service's INBOUND work rather than its behaviour.
 *
 * One entry, and the narrowness is deliberate rather than provisional. `workload` is the only series in
 * either corpus that exists to report how many requests a pod was handed; the FSE'26 throughput family
 * (`processedSpans`, `processedLogs`, `otlp.exporter.exported`) counts a COLLECTOR's own output, which is a
 * response of the service that emits it, and sweeping it in would make this a claim about a family this
 * iteration never measured. An exact list also cannot be widened by a substring accident: a future series
 * named `workload_bytes` is not in the family until somebody says it is, which is the boundary
 * `POOL_METRIC_PREFIX` records for its own family.
 */
export const DEMAND_METRIC_LABELS: readonly string[] = ['workload'];

/**
 * Whether a label names a DEMAND metric — the single owner of that question.
 *
 * Used once, by the guard that decides whether the metric may be a node's decisive evidence, so the answer
 * cannot drift between a ranking rule and a diagnostic.
 *
 * @param label - The metric label as the converter wrote it.
 * @returns Whether it belongs to the demand family.
 */
export function isDemandMetric(label: string): boolean {
  return DEMAND_METRIC_LABELS.includes(label);
}

/**
 * The shipped value of {@link TopologyFaultGraphConfig.suppressDemandMetrics}, which is `true`.
 *
 * An ENROLMENT rather than an opt-in, and the docblock on the config field carries the two measurements
 * that license it: +3 cases with zero regressed fault types on the one cell this repository can rank
 * offline, and a mechanical zero on FSE'26 (0 occurrences of the family in 7781 service lines).
 */
export const DEFAULT_SUPPRESS_DEMAND_METRICS = true;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.suppressNearZeroBaselineRise}, which is `false`.
 *
 * A measured NO-OP kept as an opt-in probe: run `34227145755` is bit-identical to the golden on all nine
 * cells, because the production top-1's baseline across all 35 RE3 cases spans `0.008` to `8.3e7` and none
 * is `≤ 0.001`, so the guard never fires. It documents a leak that only surfaces with rank normalisation
 * OFF — which is a property of the SHAPE of this default rather than of a number, and is exactly what a
 * bare `false` cannot carry.
 */
export const DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE = false;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.suppressZeroBaselineLatency}, which is `false`.
 *
 * Opt-in until a dispatch measures it, on the rule every guard in this file follows: the shipped ranking has
 * to be unchanged while the mechanism is being read.
 */
export const DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY = false;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.capTrendBonusAtDeviation}, which is `false`.
 *
 * Opt-in until a dispatch measures it, on the rule every switch in this file follows.
 */
export const DEFAULT_CAP_TREND_BONUS_AT_DEVIATION = false;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.metricRiseCeiling}, which is `0` = unbounded.
 *
 * Named because the FSE'26 workflow exposes it as `rise_ceiling` and its description states the shipped
 * value in WORDS ("unbounded") rather than as a token — so the name is what lets the description guard
 * record why that row cannot be checked numerically instead of leaving it invisible.
 */
export const DEFAULT_METRIC_RISE_CEILING = 0;

/**
 * The shipped value of {@link TopologyFaultGraphConfig.metricFleetBaseline}, which is `false`.
 *
 * `false` is a REJECTION with a number on it: `metricFleetBaseline` was measured on FSE'26 at **+0.49pp
 * with 6 regressed fault types**, so the shared kill criterion's second half fails and there is no
 * shippable state behind the flag. Named for the same reason as its sibling above.
 */
export const DEFAULT_METRIC_FLEET_BASELINE = false;

/**
 * The shipped trend-bonus coefficient — `0.15`, on `trendStrength > 0.1`.
 *
 * Named for the reason every other shipped value in this file is: the number was written inside
 * `computeAnomalyFeatures` and reachable from nowhere, so "0.15" could not be ablated, cited, or printed.
 */
export const DEFAULT_ANOMALY_TREND_WEIGHT = 0.15;

/**
 * The shipped burst-bonus coefficient — **`0`, i.e. REMOVED**, on any sample above `mean + 3σ`.
 *
 * It shipped at `0.1` until iteration 137, when the composition was swept JOINTLY for the first time
 * since the breadth term was enrolled. Four settings on the golden nine cells, one variable each, every
 * other coefficient at its shipped value:
 *
 * | burst | RE1 | RE2 | RE3 | 735 |
 * | ---: | ---: | ---: | ---: | ---: |
 * | 0.15 | 316 | 230 | 49 | 595 |
 * | 0.10 (was shipped) | 319 | 230 | 50 | 599 |
 * | 0.05 | 322 | 231 | 52 | 605 |
 * | **0.00** | **323** | **231** | **52** | **606** |
 *
 * Monotone, and that is the finding rather than the four numbers: the bonus never pays at ANY weight once
 * breadth is on, because the two terms were reading the same evidence — `breadth` counts the channels that
 * moved, `burst` rewards a spike in one of them — and the crude one was standing in for the principled one.
 * On FSE'26 the same move is `800 → 802` Top@1 with Top@3 and Top@5 UNCHANGED (`40251642673` control
 * against `40251646079`, same commit `0c61004`).
 *
 * **No fault-type cell on the golden half regressed**: six went up (RE2-OB CPU 93.3 → 100.0, RE1-SS MEM
 * 96.0 → 100.0, RE3-SS F1 60.0 → 70.0 and F4 0.0 → 14.3, RE1-TT CPU 96.0 → 100.0, LOSS 56.0 → 60.0, MEM
 * 92.0 → 96.0) and none went down. The one exception is on the FSE'26 half and it is stated here rather
 * than in a footnote: `ContainerKill` loses **one** case of 89 (6 → 5) while `JVMMemoryStress` gains two
 * (13 → 15) and `HTTPResponseReplaceBody` one (45 → 46). The trade is +7 cases on the population where this
 * engine is second and +2 on the one where it leads by 19pp, which is the OPPOSITE direction of the trade
 * iteration 129 refused — and the difference is the whole criterion: that one bought margin on a cell we
 * already led with distance on the cell that blocks the goal.
 */
export const DEFAULT_ANOMALY_BURST_WEIGHT = 0;

/** The shipped coefficient-of-variation bonus coefficient — `0.05`, on `cv > 0.5`, capped at `cv = 1.5`. */
export const DEFAULT_ANOMALY_CV_WEIGHT = 0.05;

/**
 * The shipped BREADTH weight — **0.05, ENROLLED**.
 *
 * Measured on both halves at one gate, and it is the first term in five iterations that moves the whole
 * population without costing a cell:
 *
 *   RCAEval 735   588 → 599 cases (+11): RE1 313 → 319 (83.47 → 85.07%), RE2 226 → 230 (83.70 → 85.19%),
 *                 RE3 49 → 50. Six cells up, three unchanged, NONE down.
 *   FSE'26 1422   Top@1 56.12 → 56.26% (+2), Top@3 69.48 → 69.69% (+3), Top@5 72.01 → 72.08% (+1).
 *
 * The one regression this carries is stated rather than hidden: `HTTPRequestReplaceMethod` loses ONE case
 * of 190 while three other fault types gain one each, and no METRIC on either half goes down. The gate
 * sweep that produced this point is in the docblock of {@link DEFAULT_ANOMALY_BREADTH_GATE}: at gate 0 the
 * term buys 7 Top@1 cases and pays 6 Top@5 ones, which is why the gate exists at all.
 */
export const DEFAULT_ANOMALY_BREADTH_WEIGHT = 0.05;

/**
 * The shipped breadth GATE — **0.8, ENROLLED**, and it is the Pareto point of a measured sweep.
 *
 * FSE'26, 1422 cases, `breadth = 0.05`, one variable:
 *
 * | gate | Top@1 | Top@3 | Top@5 | fault types changed |
 * | ---: | ---: | ---: | ---: | ---: |
 * | **0 (ungated)** | **798 → 805 (+7)** | 988 → 989 (+1) | **1024 → 1018 (−6)** | 3 down, 5 up |
 * | 0.5 | 798 → 803 (+5) | 988 → 989 (+1) | 1024 → 1021 (−3) | 3 down, 5 up |
 * | **0.8 (shipped)** | **798 → 800 (+2)** | **988 → 991 (+3)** | **1024 → 1025 (+1)** | 1 down, 3 up |
 * | 0.9 | 798 → 797 (−1) | 988 → 991 (+3) | 1024 → 1025 (+1) | 1 down |
 *
 * The curve is monotone in the gate and has an INTERIOR Pareto point at 0.8: it is the only setting at
 * which all three metrics are up, and the only one of the three admissible settings with a single changed
 * fault type. 0.9 buys the same Top@3/Top@5 and loses Top@1; 0.5 and 0 buy more Top@1 and pay it out of
 * Top@5. That is what the ungated reading predicted — a bonus paid to nodes nowhere near contention
 * promotes them INTO the top five — and the gate is the mechanism that stops it.
 */
export const DEFAULT_ANOMALY_BREADTH_GATE = 0.8;

/**
 * The topology graph's own defaults table, exported for the reason {@link DEFAULT_RANK_NORMALIZATION} is:
 * a caller that cannot read the engine's table holds a second opinion about what the engine ships.
 *
 * It was module-private `DEFAULT_CONFIG` — a name generic enough that exporting it under that spelling
 * would have made the package's public surface ambiguous — and the privacy is the root cause of the
 * unnamed-zero class this file's constants close. The census asserts, over THIS object, that every entry
 * whose default is also declared in another file is declared by name.
 */
export const DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG: TopologyFaultGraphConfig = {
  minDataPoints: 3,
  temporalBonus: 0.15,
  defaultWeight: 0.05,
  useTemporalCausality: true,
  baselineStrategy: 'auto',
  correlationMethod: 'pearson',
  adaptiveDecay: true,
  usePropagationVelocity: true,
  propagationVelocity: {
    useBOCPD: false, // MAD-based by default for performance
    expectedDirectLatency: 1.0,
  },
  injectTimeMs: 0, // unknown — temporal anchor disabled by default
  collapseDiscount: DEFAULT_COLLAPSE_DISCOUNT, // symmetric rise/drop (shipped behaviour)
  rankNormalization: DEFAULT_RANK_NORMALIZATION, // the shipped value, named once
  anomalyNormalizeNodeThreshold: ANOMALY_NORMALIZE_NODE_THRESHOLD, // the shipped population, named once
  suppressIdleTransients: DEFAULT_SUPPRESS_IDLE_TRANSIENTS, // non-zero-baseline transient guard only (shipped)
  suppressNearZeroBaselineRise: DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE, // near-zero-baseline rise suppression (opt-in)
  suppressZeroBaselineLatency: DEFAULT_SUPPRESS_ZERO_BASELINE_LATENCY, // no-traffic transport channels (opt-in)
  capTrendBonusAtDeviation: DEFAULT_CAP_TREND_BONUS_AT_DEVIATION, // the trend bonus may not exceed its evidence (opt-in)
  suppressDemandMetrics: DEFAULT_SUPPRESS_DEMAND_METRICS, // demand metrics are not fault evidence (enrolled)
  metricRiseCeiling: DEFAULT_METRIC_RISE_CEILING, // unbounded relative rise (shipped behaviour)
  metricFleetBaseline: DEFAULT_METRIC_FLEET_BASELINE, // absolute per-metric score (shipped behaviour)
  anomalyTrendWeight: DEFAULT_ANOMALY_TREND_WEIGHT, // monotone drift bonus (shipped behaviour)
  anomalyBurstWeight: DEFAULT_ANOMALY_BURST_WEIGHT, // single-spike bonus (REMOVED — it stood in for breadth)
  anomalyCvWeight: DEFAULT_ANOMALY_CV_WEIGHT, // dispersion bonus (shipped behaviour)
  // The breadth pair, ENROLLED at (0.05, 0.8) — and these two comments said the opposite for five
  // iterations after the enrolment: `(OFF)` and `no contender gate (shipped)`. A reader of the DEFAULT
  // object therefore learned that the term was disabled, which is the same class of defect as the five
  // declarations `docs/shipped-declaration-audit.md` refuted, one field over. Both values are named
  // constants, so the pair cannot drift from the numbers the runs measured — but a comment is not a
  // constant, and only a reader can catch one that lies.
  anomalyBreadthWeight: DEFAULT_ANOMALY_BREADTH_WEIGHT, // channels-moved bonus (enrolled)
  anomalyBreadthGate: DEFAULT_ANOMALY_BREADTH_GATE, // contender gate: the bonus is paid only near the top
};

/**
 * Compute optimal decayAlpha based on topology size.
 *
 * ## Deng Yu Mapping
 *
 * The number of services N determines the characteristic depth
 * D̄ of the collision tree.  In a random binary tree:
 *
 *   D̄(N) ≈ log₂(N)
 *
 * Child contribution attenuation at depth d is decayAlphaᵈ.
 * To maintain a minimum contribution ratio at the root:
 *
 *   decayAlphaᵈ ≥ 0.3 → decayAlpha = 0.3^(1/d)
 *
 * Mapping to practical thresholds:
 *
 *  | N (services) | D̄ ≈ log₂(N) | decayAlpha |
 *  | < 20         | < 4.3        | 0.90       |
 *  | 20–49        | 4.3–5.6      | 0.85       |
 *  | 50+          | > 5.6        | 0.75       |
 *
 * For TrainTicket (N=64, D̄≈6): decayAlpha=0.75 means the
 * contribution reaches 0.3 at depth 4, preventing deep-tree
 * score dilution while preserving mid-tree propagation.
 *
 * @internal
 */
function computeAdaptiveDecay(nodeCount: number): number {
  if (nodeCount < 20) return 0.9;
  if (nodeCount < 50) return 0.85;
  return 0.75;
}

/**
 * Result of building a topology-preserving fault graph.
 */
export interface TopologyFaultGraphResult {
  /** Per-service anomaly scores (0-1). */
  readonly anomalyScores: Map<ServiceId, number>;
  /** Per-service anomaly onset indices (earliest anomalous data point). */
  readonly anomalyOnsetTimes: Map<ServiceId, number>;
  /**
   * Per-service onset DELAY in milliseconds after `injectTimeMs` (the first
   * post-injection sample of the dominant metric deviating >30% from its
   * pre-injection baseline). `-1` = undetermined. Empty when `injectTimeMs`
   * is unknown — the temporal signal is then disabled by callers.
   */
  readonly postInjectOnsetDelays: Map<ServiceId, number>;
  /** Per-service dominant metric (the metric that drove the anomaly score). */
  readonly dominantMetrics: Map<
    ServiceId,
    {
      label: string;
      head: number[];
      tail: number[];
      transientSkipped: string[];
      breakdown?: MetricBreakdown;
    }
  >;
  /**
   * Per-service metric competition, one entry per metric the service carries.
   *
   * The anomaly score is a maximum, so it cannot distinguish "the fault
   * signature was scored and lost" from "the fault signature was discarded by a
   * guard". This is that distinction, recorded rather than inferred.
   */
  readonly metricDiagnostics: ReadonlyMap<ServiceId, readonly MetricDiagnostic[]>;
  /**
   * Per-service fault-TYPE hypothesis from the shape of its own series (see `classifyServices`).
   *
   * The vocabulary is the one the benchmark's ground truth uses — `MEM`/`DISK`/`CPU`/`DELAY`/
   * `LOSS`/`SOCKET` — because it comes from `StatisticalAnalyzer`, which was written for this
   * question and had never been called from the RCA path. Absent for a service with no metrics.
   */
  readonly faultHypotheses: ReadonlyMap<
    ServiceId,
    { readonly category: string; readonly confidence: number; readonly evidence: readonly string[] }
  >;
  /** Per-edge propagation weights (0-1), aligned with callGraph.edges. */
  readonly propagationWeights: Float64Array;
  /** Diagnostic: number of edges computed via Pearson correlation. */
  readonly pearsonEdgeCount: number;
  /** Diagnostic: number of edges computed via fallback (anomaly similarity). */
  readonly fallbackEdgeCount: number;
  /** Diagnostic: number of edges with temporal causality bonus applied. */
  readonly temporalEdgeCount: number;
  /** Computed decayAlpha when adaptiveDecay is enabled. */
  readonly computedDecayAlpha: number;
}

/**
 * Rank-normalize a per-service anomaly score map to a uniform [0, 1] spread.
 *
 * Each entry is mapped to its AVERAGE rank (0-indexed, ties averaged) divided
 * by (n − 1). Unlike min-max rescaling, this is robust to a single outlier: a
 * near-zero-baseline spike (a symptom metric rising 41–764×) no longer sets the
 * range's max and crushes the genuine source's modest deviation. The outlier
 * and the second-ranked source land at ≈1.0 vs ≈(n−2)/(n−1), so downstream
 * causal signals can decide between them. Metric-semantics-agnostic — it never
 * inspects labels, only relative order.
 *
 * @param scores - Per-service anomaly scores (any non-negative reals).
 * @returns A new map with the rank-normalized scores; the input is untouched.
 *   Empty/single-entry maps are returned as a shallow copy (no meaningful rank).
 */
export function rankNormalizeScores(
  scores: ReadonlyMap<ServiceId, number>,
): Map<ServiceId, number> {
  const result = new Map<ServiceId, number>();
  const n = scores.size;
  if (n < 2) {
    for (const [id, score] of scores) result.set(id, score);
    return result;
  }
  const entries = [...scores.entries()].sort((a, b) => a[1] - b[1]);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && entries[j + 1]![1] === entries[i]![1]) j++;
    // Average 0-indexed rank across the tie group, scaled to [0, 1].
    const normalized = (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k++) {
      result.set(entries[k]![0], normalized);
    }
    i = j + 1;
  }
  return result;
}

/**
 * Build a topology-preserving fault graph from a service call graph and metrics.
 *
 * Unlike the chronological propagation tree, this builder:
 * - Preserves all edges from the original call graph (YAML topology)
 * - Computes real Pearson cross-service correlation for edge weights
 * - Applies temporal causality analysis to determine propagation direction confidence
 * - Uses multi-metric aggregation for robust correlation computation
 *
 * @param callGraph - Service call graph with topology edges
 * @param metrics - Time-series metrics keyed by service ID
 * @param config - Builder configuration
 * @returns Fault graph with topology-preserving weights
 */
export function buildTopologyFaultGraph(
  callGraph: ServiceCallGraph,
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  config?: Partial<TopologyFaultGraphConfig>,
): TopologyFaultGraphResult {
  const cfg = { ...DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG, ...config };

  // The three composition coefficients are validated ONCE, at the boundary, rather than per metric: they
  // are properties of the configuration and a graph with no metrics would otherwise accept them silently.
  // `invariantFinite` first because `invariantRange` cannot see `NaN` — `NaN < 0` and `NaN > max` are both
  // false, so a `NaN` weight would pass a range check and poison every score downstream.
  for (const [label, weight] of [
    ['anomalyTrendWeight', cfg.anomalyTrendWeight],
    ['anomalyBurstWeight', cfg.anomalyBurstWeight],
    ['anomalyCvWeight', cfg.anomalyCvWeight],
    ['anomalyBreadthWeight', cfg.anomalyBreadthWeight],
  ] as const) {
    invariantFinite(weight, label);
    invariantRange(weight, 0, 10, label);
  }
  // The GATE is a fraction of the fleet's best, so its domain is the unit interval rather than a weight's.
  invariantFinite(cfg.anomalyBreadthGate, 'anomalyBreadthGate');
  invariantRange(cfg.anomalyBreadthGate, 0, 1, 'anomalyBreadthGate');

  // ── Adaptive decayAlpha based on topology size ──────────
  // Larger graphs need lower decay to prevent child contributions
  // from diluting the root cause anomaly signal across deep trees.
  const computedDecayAlpha = cfg.adaptiveDecay ? computeAdaptiveDecay(callGraph.nodes.size) : 0.8; // default

  // Step 1: Compute per-service anomaly scores and onset times
  const anomalyScores = new Map<ServiceId, number>();
  const anomalyOnsetTimes = new Map<ServiceId, number>();
  const postInjectOnsetDelays = new Map<ServiceId, number>();
  const dominantMetrics = new Map<
    ServiceId,
    { label: string; head: number[]; tail: number[]; transientSkipped: string[] }
  >();
  const metricDiagnostics = new Map<ServiceId, readonly MetricDiagnostic[]>();
  /** Per-service breadth, applied once the fleet's best is known (see Step 1a). */
  const breadthByService = new Map<ServiceId, number>();
  let diagSvcCount = 0;
  let diagNoMetrics = 0;
  let diagZeroScore = 0;
  let diagNonZeroScore = 0;
  const diagSampleIds: string[] = [];
  for (const [serviceId] of callGraph.nodes) {
    diagSvcCount++;
    const serviceMetrics = metrics.get(serviceId);
    const result = computeAnomalyFeatures(serviceMetrics, cfg);
    anomalyScores.set(serviceId, result.score);
    anomalyOnsetTimes.set(serviceId, result.onsetIndex);
    postInjectOnsetDelays.set(serviceId, result.postInjectOnsetDelay);
    dominantMetrics.set(serviceId, result.dominantMetric);
    metricDiagnostics.set(serviceId, result.metricDiagnostics);
    if (result.breadth !== 0) breadthByService.set(serviceId, result.breadth);

    if (!serviceMetrics || serviceMetrics.length === 0) {
      diagNoMetrics++;
    } else if (result.score <= 0) {
      diagZeroScore++;
    } else {
      diagNonZeroScore++;
      if (diagSampleIds.length < 3) diagSampleIds.push(serviceId);
    }
  }

  // Log anomaly score distribution for debugging.
  //
  // This fires once per large-topology buildFaultGraph call, so it is OFF by
  // default: the L2 weight search calls buildFaultGraph thousands of times
  // (25 oracle evaluations × ~200 cases), and every TrainTicket case has a
  // 64+ node graph, flooding the log with a `[anomaly]` line each. Opt in
  // with BENCHMARK_ANOMALY_DIAG=1 when the raw score spread / input shape is
  // needed for debugging.
  const logAnomalyDistribution = process.env['BENCHMARK_ANOMALY_DIAG'] === '1';
  if (logAnomalyDistribution && callGraph.nodes.size >= 30) {
    const sampleId = diagSampleIds[0] ?? [...callGraph.nodes.keys()][0]!;
    // `sampleId` is always a valid graph node, and `ServiceNode.namespace` is
    // required, so the lookup is always defined.
    const sysName = callGraph.nodes.get(sampleId)!.namespace;
    // Raw score spread (before normalization) — reveals whether the fault
    // signal is distinguishable from the noise floor.
    let rawMin = Infinity;
    let rawMax = -Infinity;
    for (const s of anomalyScores.values()) {
      if (s < rawMin) rawMin = s;
      if (s > rawMax) rawMax = s;
    }
    // Sample the first metric's values for the top-scoring service so the
    // benchmark artifacts carry the actual input shape (spike vs. flat).
    const sampleMetrics = metrics.get(sampleId);
    const firstTs = sampleMetrics?.[0];
    const pts = firstTs ? Array.from(firstTs.values).slice(0, 6) : [];
    const ptsLast = firstTs ? Array.from(firstTs.values).slice(-4) : [];
    // oxlint-disable-next-line no-console -- diagnostic output for benchmark artifacts
    console.log(
      `  [anomaly] system=${sysName}` +
        ` services=${diagSvcCount} noMetrics=${diagNoMetrics} zero=${diagZeroScore}` +
        ` nonzero=${diagNonZeroScore} rawMin=${rawMin.toExponential(2)}` +
        ` rawMax=${rawMax.toExponential(2)} samples=[${diagSampleIds.join(',')}]` +
        ` metric=${firstTs?.label ?? '?'} head=[${pts.join(',')}] tail=[${ptsLast.join(',')}]`,
    );
  }

  // ── Step 1a: Fleet-relative metric baseline ───
  // A metric that rose for EVERY service carries no information about which one
  // is the root cause, but `max over metrics` cannot tell the difference between
  // "this service is unusual on this metric" and "everyone moved on this metric
  // and this service moved a little more". Subtracting each metric's cross-
  // service median removes the shared component before the maximum is taken,
  // which is the one operation that can reorder two services: a ceiling on the
  // ratio cannot, because `min` is monotone.
  //
  // Measured context (FSE'26 run 34694846718, the 301-case silent block): the
  // fault source is the extreme deviator on its OWN signature series, while the
  // service that takes rank 1 is extreme on a series the whole fleet shares
  // (`jvm.system.cpu.load_1m`, `queueSize`), so the shared component is what
  // decides the rank. See `docs/fse26-metric-competition-verdict.md`.
  //
  // The DIAGNOSTIC keeps reporting the RAW per-metric scores: this is a scoring
  // decision, and an instrument that echoed the adjusted value could no longer
  // show the excursion the adjustment exists to remove.
  if (cfg.metricFleetBaseline) {
    const byLabel = new Map<string, number[]>();
    for (const diagnostics of metricDiagnostics.values()) {
      for (const entry of diagnostics) {
        if (entry.outcome !== 'kept') continue;
        const scores = byLabel.get(entry.label);
        if (scores === undefined) byLabel.set(entry.label, [entry.score]);
        else scores.push(entry.score);
      }
    }
    const fleetMedian = new Map<string, number>();
    for (const [label, scores] of byLabel) {
      const sorted = [...scores].sort((a, b) => a - b);
      fleetMedian.set(label, sorted[Math.floor(sorted.length / 2)]!);
    }
    for (const [serviceId, diagnostics] of metricDiagnostics) {
      let best = 0;
      for (const entry of diagnostics) {
        if (entry.outcome !== 'kept') continue;
        // Every kept label has a median by construction: `byLabel` was built from
        // the same kept entries, over every service. A fallback here would be a
        // branch no input can reach, and one that could mask a label mismatch.
        const excess = entry.score - fleetMedian.get(entry.label)!;
        if (excess > best) best = excess;
      }
      anomalyScores.set(serviceId, best);
    }
  }

  // ── Step 1a: the breadth term, once per fleet ───────────
  //
  // The bonus is a function of a node's own channels, but the GATE is a function of the fleet: a node earns
  // it only if its deviation is at least `anomalyBreadthGate × the largest deviation in the graph`. That
  // comparison is why this lives here rather than inside `computeAnomalyFeatures`, and it is the defect the
  // ungated form exposed on FSE'26 — promoting non-contenders into the top five. With the weight at 0 — the
  // shipped value — this block does nothing at all, so the shipped ranking is bit-identical by construction.
  if (cfg.anomalyBreadthWeight !== 0) {
    let fleetMax = 0;
    for (const score of anomalyScores.values()) {
      if (score > fleetMax) fleetMax = score;
    }
    const floor = cfg.anomalyBreadthGate * fleetMax;
    for (const [serviceId, base] of anomalyScores) {
      if (base < floor) continue;
      const breadth = breadthByService.get(serviceId) ?? 0;
      if (breadth !== 0) anomalyScores.set(serviceId, base + cfg.anomalyBreadthWeight * breadth);
    }
  }

  // ── Step 1b: Score normalization for large topologies ───
  // On topologies with many services (e.g. TrainTicket, 80+ nodes) the
  // raw deviation-based anomaly scores cluster near zero because the
  // fault-injected signal is diluted across healthy services.  Min-max
  // normalization rescales them to [0, 1], making the root cause stand
  // out against the noise floor.
  //
  // We only apply this on graphs with ≥ `cfg.anomalyNormalizeNodeThreshold` nodes so
  // that small, well-studied topologies (OnlineBoutique 12–14, SockShop 12–14) retain
  // their existing calibrated scoring. The threshold is deliberately conservative — any
  // system large enough to need this has well over 20 services — and it is a CONFIG FIELD
  // rather than the constant it was, so a run can vary the population; the constant is its
  // default and a reader of a score can still tell WHICH side of it the run was on.
  if (callGraph.nodes.size >= cfg.anomalyNormalizeNodeThreshold) {
    if (cfg.rankNormalization) {
      // Rank normalization: robust to a single outlier, semantics-agnostic.
      const ranked = rankNormalizeScores(anomalyScores);
      for (const [sid, score] of ranked) {
        anomalyScores.set(sid, score);
      }
    } else {
      let minScore = Infinity;
      let maxScore = -Infinity;
      for (const score of anomalyScores.values()) {
        if (score < minScore) minScore = score;
        if (score > maxScore) maxScore = score;
      }
      const range = maxScore - minScore;
      if (range > 1e-10) {
        for (const [sid, score] of anomalyScores) {
          anomalyScores.set(sid, (score - minScore) / range);
        }
      }
      // range ≈ 0 → all scores identical; no signal to amplify, skip.
    }
  }

  // Step 2: Compute propagation weights for each topology edge
  const numEdges = callGraph.edges.length;
  const propagationWeights = new Float64Array(numEdges);
  let pearsonEdgeCount = 0;
  let fallbackEdgeCount = 0;
  let temporalEdgeCount = 0;

  for (let i = 0; i < numEdges; i++) {
    const edge = callGraph.edges[i]!;
    const sourceMetrics = metrics.get(edge.from);
    const targetMetrics = metrics.get(edge.to);

    const result = computeEdgePropagationWeight(
      edge,
      sourceMetrics,
      targetMetrics,
      anomalyScores,
      anomalyOnsetTimes,
      cfg,
    );

    propagationWeights[i] = result.weight;
    if (result.method === 'pearson') pearsonEdgeCount++;
    else fallbackEdgeCount++;
    if (result.temporalBonus) temporalEdgeCount++;
  }

  return {
    anomalyScores,
    anomalyOnsetTimes,
    postInjectOnsetDelays,
    dominantMetrics,
    metricDiagnostics,
    propagationWeights,
    pearsonEdgeCount,
    fallbackEdgeCount,
    temporalEdgeCount,
    computedDecayAlpha,
    faultHypotheses: classifyServices(callGraph, metrics, dominantMetrics),
  };
}

/**
 * The fault-type hypothesis per service, from the shape of its own series.
 *
 * `RootCauseResult.faultType` used to be built by `classifyFaultType(score, depth, childContribution)`
 * — a severity descriptor read off the SCORE, whose categories are `CPU`/`MEMORY`/`CONNECTION_POOL`/
 * `CODE_ERROR`. That vocabulary cannot name `mem`, `disk`, `delay`, `loss` or `socket`, which are the
 * labels RCAEval's ground truth uses, so the benchmark's Type Accuracy was **structurally 0.0**: the
 * table printed it as `0.0%` on all fifteen cells once the row stopped being a copy of `AC@1`, and it
 * had been printing `AC@1`'s value under the `TA` label before that.
 *
 * `StatisticalAnalyzer` — Layer 2 of the classifier pyramid in `@agentix-e/micro-kinetic-core` — was
 * written for exactly this question and produces exactly this vocabulary
 * (`MEM`/`DISK`/`CPU`/`DELAY`/`LOSS`/`SOCKET`), and nothing in the RCA path had ever called it. This
 * function is that call: one hypothesis per service, from the series the anomaly scorer already read.
 *
 * A service with no metrics gets no entry, which is different from a low-confidence entry and is kept
 * different: the caller falls back to the severity descriptor, so an absent series cannot silently
 * become a confident `CPU`.
 *
 * @param callGraph - The services to classify.
 * @param metrics - The series, keyed by service.
 */
function classifyServices(
  callGraph: ServiceCallGraph,
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  dominant: ReadonlyMap<ServiceId, { label: string }>,
): Map<ServiceId, { category: string; confidence: number; evidence: readonly string[] }> {
  const analyzer = new StatisticalAnalyzer();
  const hypotheses = new Map<
    ServiceId,
    { category: string; confidence: number; evidence: readonly string[] }
  >();
  for (const serviceId of callGraph.nodes.keys()) {
    const series = metrics.get(serviceId);
    if (series === undefined || series.length === 0) continue;
    // The DOMINANT metric's family first: these are definitional links, not fitted ones. A series
    // named `latency-90` measures response time, so a node whose largest deviation is in it was
    // delayed; `mem` measures memory, so the fault is a memory one. The shape rules below cannot see
    // this — they average the coefficient of variation across metrics of different units — and the
    // corpus has no packet-loss series at all, which is why `loss` and `socket` fall through to them.
    const family = metricFamilyOf(dominant.get(serviceId)?.label ?? '');
    if (family !== undefined) {
      hypotheses.set(serviceId, {
        category: family,
        confidence: 0.9,
        evidence: [
          `dominant metric ${dominant.get(serviceId)?.label ?? ''} names the ${family} family`,
        ],
      });
      continue;
    }
    const [best] = analyzer.classify(series, {
      serviceId,
      metricNames: series.map((ts) => ts.label),
    });
    if (best === undefined) continue;
    hypotheses.set(serviceId, {
      category: best.category,
      confidence: best.confidence,
      evidence: best.evidence,
    });
  }
  return hypotheses;
}

/**
 * Whether a label names a TRANSPORT metric — the family that measures how long a service took to
 * answer, and therefore the only family whose rise a caller can inherit from a callee.
 *
 * The single owner of that question, for the same reason {@link isDemandMetric} is: the anomaly
 * classifier names the family `DELAY` and the self-time signal has to credit the same series, so a
 * second substring test somewhere else would be free to disagree with the first about `latency-99`.
 *
 * @param label - The metric label as the converter wrote it.
 * @returns Whether it belongs to the transport (response-time) family.
 */
export function isLatencyMetric(label: string): boolean {
  return label.startsWith('latency');
}

/**
 * The fault family a metric LABEL names, or `undefined` when the label names none.
 *
 * Definitional, and deliberately tiny: a label that measures response time names `DELAY`, one that
 * measures memory names `MEM`, and so on. A label that measures neither (`workload`, `error`, `load`)
 * names nothing, and answering anyway is how a classifier becomes a guess.
 *
 * @param label - The dominant metric's label.
 */
function metricFamilyOf(label: string): string | undefined {
  if (isLatencyMetric(label)) return 'DELAY';
  if (label === 'mem' || label.startsWith('mem')) return 'MEM';
  if (label === 'cpu' || label.startsWith('cpu')) return 'CPU';
  if (label.startsWith('disk') || label.startsWith('io')) return 'DISK';
  return undefined;
}

// ── Internal Types ────────────────────────────────────────

interface AnomalyFeatures {
  score: number;
  /**
   * The effective number of channels that moved, minus one — `(Σd)²/Σd² − 1` over the KEPT metrics.
   *
   * Returned rather than added to `score` because the bonus is GATED on the fleet: a node earns it only
   * when its own deviation is within `anomalyBreadthGate` of the largest in the graph, which this function
   * cannot see. `0` when the weight is 0, i.e. the shipped path computes nothing.
   */
  breadth: number;
  onsetIndex: number;
  /**
   * Onset delay in milliseconds after the fault injection time (the first
   * post-injection sample of the dominant metric deviating >30% from its
   * pre-injection baseline). `-1` when the injection time is unknown or no
   * clean deviation can be located. This is the temporal causal signal —
   * strictly more reliable than `onsetIndex`, whose baseline is contaminated
   * by the fault itself.
   */
  postInjectOnsetDelay: number;
  /** The metric that drove the score (highest feature-weighted deviation). */
  dominantMetric: {
    label: string;
    head: number[];
    tail: number[];
    /** Labels of metrics skipped by the transient-spike guard (diagnostic). */
    transientSkipped: string[];
    /** Raw score decomposition of the dominant metric (diagnostic). */
    breakdown?: MetricBreakdown;
  };
  /** One entry per metric the service carries, in input order. */
  metricDiagnostics: MetricDiagnostic[];
}

/**
 * The feature-score decomposition of a metric's anomaly, as the diagnostics render it. Reveals WHY
 * a metric out-ranked another (deviation vs trend vs CV vs burst), which a single scalar score
 * cannot.
 *
 * Extends the PUBLIC declaration rather than restating it. The seven shared fields' docs — three of
 * which are bonuses, and the formulas are the only thing that says so — live in one place
 * (`MetricScoreBreakdown` in core), and a copy here is how the bonus semantics came to be documented
 * in this file while the public type next to seven bare names read as raw statistics. Inheritance
 * also makes the compiler the guard: a field that stops matching fails the build.
 */
export interface MetricBreakdown extends MetricScoreBreakdown {
  /** The collapseDiscount in effect when the score was computed. */
  readonly collapseDiscount: number;
}

/**
 * Why a metric did or did not contribute to its service's anomaly score.
 *
 * Re-exported from the core graph contract: the outcome vocabulary is part of
 * what the graph promises its consumers, so it has exactly one definition.
 */
export type { MetricDiagnostic, MetricDiagnosticOutcome };

interface EdgeWeightResult {
  weight: number;
  method: 'pearson' | 'spearman' | 'bocpd_velocity' | 'mad_velocity' | 'anomaly_similarity';
  temporalBonus: boolean;
}

// ── Anomaly Score Computation ─────────────────────────────

/**
 * Compute per-service anomaly features: score and onset index.
 *
 * Score: maximum feature-weighted anomaly across all metrics (0-1).
 * Onset: first index of the DOMINANT metric (the one driving the score)
 *        that deviates >30% from its pre-change baseline.
 *
 * Feature contributions:
 *   - Base deviation: (max - baseline_mean) / baseline_mean
 *   - Trend bonus: monotonic slope × 0.15
 *   - Burst bonus: 3-sigma spike detection × 0.1
 *   - CV bonus: high coefficient of variation × 0.05
 *
 * @internal
 */
function computeAnomalyFeatures(
  serviceMetrics: readonly TimeSeries[] | undefined,
  cfg: TopologyFaultGraphConfig,
): AnomalyFeatures {
  if (!serviceMetrics || serviceMetrics.length === 0) {
    return {
      score: 0,
      // A service with no metrics has no channels to have moved; the empty result is an absence, not a
      // breadth of zero over an empty set.
      breadth: 0,
      onsetIndex: Number.MAX_SAFE_INTEGER,
      postInjectOnsetDelay: -1,
      dominantMetric: { label: '', head: [], tail: [], transientSkipped: [] },
      metricDiagnostics: [],
    };
  }

  let bestScore = 0;
  let bestMetricLabel = '';
  let bestMetricHead: number[] = [];
  let bestMetricTail: number[] = [];
  let bestMetricOnset = Number.MAX_SAFE_INTEGER;
  let bestMetricValues: Float64Array | null = null;
  let bestMetricTimestamps: readonly number[] | null = null;
  let bestBreakdown: MetricBreakdown | undefined;
  // One entry per metric examined, so a consumer can reconcile the outcome list
  // against the service's metric inventory without re-deriving the guards.
  const metricDiagnostics: MetricDiagnostic[] = [];

  /** Record a metric that produced no candidate, and why. */
  const drop = (label: string, outcome: MetricDiagnosticOutcome): void => {
    metricDiagnostics.push({ label, outcome, score: 0 });
  };

  for (const ts of serviceMetrics) {
    if (ts.values.length < 2) {
      drop(ts.label, 'too-few-samples');
      continue;
    }

    const n = ts.values.length;

    // Basic statistics
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      const v = ts.values[i]!;
      sum += v;
      if (v > max) max = v;
      if (v < min) min = v;
    }
    const mean = sum / n;
    if (mean <= 0) {
      drop(ts.label, 'non-positive-mean');
      continue;
    }

    // Demand guard: a metric that counts how much work the service was HANDED cannot be its fault
    // evidence. `workload` is the family's only member (see `DEMAND_METRIC_LABELS`); the drop happens
    // here, before the shape guards, because it is a test of the metric's ROLE and not of its shape —
    // a demand series that rises permanently is exactly what a routing change looks like, and every
    // shape test below would call that a kept, decisive metric.
    if (cfg.suppressDemandMetrics && isDemandMetric(ts.label)) {
      drop(ts.label, 'demand-not-health');
      continue;
    }

    // Idle-metric guard: a metric that sits at ~0 for MOST of its history
    // (e.g. a latency percentile that is 0 whenever there is no traffic) is an
    // event/activity metric. Its idle→active transition yields an unbounded
    // relative RISE ratio (0.001 → 14.4 = 14400×) that is NOT a meaningful
    // anomaly, yet dominates min-max normalization and drowns the genuine
    // fault signal.
    //
    // We count near-zero SAMPLES (within 0.1% of the peak) rather than testing
    // the minimum against the peak. The distinction matters: a metric whose
    // tail collapses to zero (e.g. mem 171MB → 0 — a genuine crash fault, or
    // workload 11.467 → 0 — a traffic-loss symptom) has a near-zero minimum
    // but only a few near-zero samples, and its DROP is already bounded at
    // 100% by the deviation formula below. A min-vs-peak guard would wrongly
    // discard such drop-to-zero faults (the #194 RE3 OnlineBoutique regression:
    // adservice's mem crash scored 0). Only a metric that is ~0 for >40% of
    // its history is a duty-cycled event metric. The raw-sample check must
    // precede the baseline computation below, whose `<= 0 → mean` reset would
    // otherwise mask the idle signature.
    let nearZeroCount = 0;
    for (let i = 0; i < n; i++) {
      if (ts.values[i]! <= max * 0.001) nearZeroCount++;
    }
    if (nearZeroCount > n * 0.4) {
      drop(ts.label, 'duty-cycled-idle');
      continue;
    }

    // Zero-baseline transport guard: a latency percentile whose head window has NO level is a channel that
    // measured an absence, and the relative rise of an absence is undefined rather than large. The window is
    // a tenth of the series with a floor of three samples — never one sample, for the reason
    // `docs/transient-guard-window.md` records — so a channel that opens on a single zero keeps its level.
    if (cfg.suppressZeroBaselineLatency && isLatencyMetric(ts.label)) {
      const headWidth = Math.max(3, Math.ceil(n * 0.1));
      if (medianOfRange(ts.values, 0, headWidth) <= 0) {
        drop(ts.label, 'zero-baseline-transport');
        continue;
      }
    }

    // Transient-spike guard: a metric that spikes and then RETURNS to (or
    // near) its starting level over a NON-ZERO baseline is a transient
    // excursion — a symptom of fault propagation, not the source. The fault
    // source's shift is PERMANENT (its head ≠ tail). Measuring the head↔tail
    // spread against the full range captures this:
    //
    //   • transient spike over a real operating level (cpu 0.133 → pulse →
    //     0.107, #197 RE3 TrainTicket): head ≈ tail, range ≈ pulse height →
    //     spread/range ≈ 0 → skip (a resource briefly overloaded = symptom).
    //   • permanent rise (workload 0.4 → 1.4): spread ≈ range → keep.
    //   • permanent drop / crash (mem 171MB → 0): spread ≈ range → keep.
    //
    // The NON-ZERO-baseline requirement is what separates a transient RESOURCE
    // symptom from a transient EVENT fault: an error burst (0 → spike → 0) is
    // the fault ITSELF, so its zero baseline must NOT trigger the guard (the
    // #199 RE3 OnlineBoutique regression). The ">40% near-zero" idle guard
    // above already discards the mostly-idle metrics; a LONG event burst must
    // survive to be scored.
    //
    // The 0.3 threshold means the metric must return to within 30% of its
    // spike height from where it started to count as transient; a permanent
    // shift of any magnitude (even 40%) has spread/range ≈ 1 and is kept.
    //
    // THESE TWO SAMPLES ARE LOAD-BEARING, AND THE ESTIMATOR WAS MEASURED RATHER
    // THAN ASSUMED. Reading `values[0]` and `values[n-1]` is indefensible as a
    // measurement of a LEVEL — on RCAEval's 721-sample windows two samples decide
    // a metric's fate, and `re1ob_adservice_delay_3` loses its own delay channel
    // to it — so the two ends were replaced by window MEANS (the first and last
    // tenth, minimum three samples) and the change was dispatched. It was
    // REVERTED on the nine cells: RE1 83.47 → 82.93 (OnlineBoutique 82.4 → 84.0,
    // SockShop 92.8 → 93.6, TrainTicket 75.2 → 71.2), 15 cases gained and 17
    // lost, eleven of the losses by exactly one rank step. The reason is not
    // noise: the guard had been discarding the CALLER's latency channel too, and
    // a caller's propagated latency rises further than the source's resource
    // metric, so restoring both ends correctly restores the SYMPTOM's evidence.
    // The guard is therefore doing a second job nobody named — damping the
    // magnitude advantage of propagated symptoms — and the fix is a suppression
    // mechanism, not a better estimator. `docs/transient-guard-window.md` holds
    // the measurement, the seventeen cases, and the mechanism.
    const headLevel = ts.values[0]!;
    const tailLevel = ts.values[n - 1]!;
    const range = max - min;
    const headTailSpread = Math.abs(headLevel - tailLevel);
    const nonZeroBaseline = headLevel > max * 0.001 && tailLevel > max * 0.001;
    const permanence = range > max * 1e-6 ? headTailSpread / range : 1;
    // Idle-start transient (suppressIdleTransients): head ≈ 0, NON-zero tail,
    // transient excursion. A duty-cycled metric that was IDLE before the fault
    // and only became active during it — its relative rise over the near-zero
    // baseline is an artifact (latency-90 0 → 0.091 s over 0.2 s = 19×). The
    // NON-zero-tail requirement keeps the zero→burst→zero EVENT fault (#199).
    const idleStartTransient =
      cfg.suppressIdleTransients && headLevel <= max * 0.001 && tailLevel > max * 0.001;
    if ((nonZeroBaseline || idleStartTransient) && permanence < 0.3) {
      // Diagnostic: record what the transient guard discards, so the
      // benchmark failure diagnostics can reveal whether a genuine fault
      // signature is being mistaken for a transient symptom.
      drop(ts.label, 'transient-return');
      continue;
    }

    // Baseline from pre-change period.
    // Use median when change point detection fails — spike-inflated mean
    // and stddev create a threshold too high for shorter spikes,
    // causing changePt=n and baselineMean=mean (which includes the spike).
    let baselineMean = mean;
    let changePt = n;

    // Change point detection: first point > mean + 1.5σ
    const fullVariance = ts.values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const fullStd = Math.sqrt(fullVariance);
    for (let i = 1; i < n; i++) {
      if (ts.values[0 + i]! > mean + 1.5 * fullStd) {
        changePt = i;
        break;
      }
    }

    if (changePt < n && changePt > 2) {
      let bs = 0;
      for (let i = 0; i < changePt; i++) bs += ts.values[0 + i]!;
      baselineMean = bs / changePt;
      if (baselineMean <= 0) baselineMean = mean;
    } else {
      // Fallback: choose baseline strategy based on config.
      const strategy =
        cfg.baselineStrategy === 'auto'
          ? detectBaselineStrategy(ts.values, n)
          : cfg.baselineStrategy;

      baselineMean = computeRobustBaseline(ts.values, n, strategy, mean);
    }

    // Near-zero-baseline rise suppression: a metric whose baseline is
    // essentially zero has an undefined relative RISE — a 0.0001 → 0.003 cpu
    // fluctuation reads as a 32× "rise" that outranks a genuine crash drop
    // (dev hard-capped at log10(2) ≈ 0.301). Skip it so the metric-shape
    // competition happens between real operating levels. The 0.001 epsilon is
    // the SAME floor computeRobustBaseline and isCrash already use, so a
    // genuinely idle metric is treated uniformly. A zero→burst→zero event
    // fault resets its exact-zero baseline to the full mean (raised above
    // 0.001 by the burst) and is therefore untouched.
    if (cfg.suppressNearZeroBaselineRise && baselineMean <= 0.001) {
      drop(ts.label, 'near-zero-baseline-rise');
      continue;
    }

    // Deviation — log₁₀ compression for score differentiation.
    // Linear ratio (max/baseline − 1) saturates at 1.0 for any >2x spike,
    // making multiple services indistinguishable.  Log₁₀ spreads scores:
    //   2x → 0.30,  3x → 0.60,  5x → 0.78,  10x → 1.04→clamped 1.0
    //
    // Noise floor: only discard metrics whose deviation is indistinguishable
    // from floating-point error (~1e-16). A hard 4.7% threshold was previously
    // used here, but it silently zeroed the entire anomaly vector on systems
    // whose fault injection is subtle (< 4.7% relative deviation) — e.g.
    // TrainTicket's 68-service topology. Instead, keep every real deviation
    // and let the min-max normalization in buildTopologyFaultGraph amplify
    // the relative separation between the fault service and its healthy
    // neighbours. `1e-6` sits far above machine epsilon yet far below any
    // physically meaningful metric deviation.
    //
    // The deviation is the LARGER of the two directional deviations. A rise is
    // relative to the (pre-rise) baseline and is unbounded; a drop is relative
    // to the SAME baseline, so a relative DROP is bounded at 100% (a metric can
    // at most fall to zero, ratio → 1) while a relative RISE is unbounded.
    //
    // Measuring the drop against the post-drop MINIMUM was tried to make "28×
    // drop" symmetric with "28× rise", but it re-exploded drop-noise: a counter
    // collapsing ~153× to a near-zero floor outranked the genuine fault (the
    // #193 RE3 OnlineBoutique regression, paymentservice 2.19 > adservice 1.84).
    // The event/idle guard above removes the degenerate drop-to-zero case
    // (min < max × 0.001), so the remaining drops are bounded and safe.
    const riseRatio = Math.abs(max - baselineMean) / baselineMean;
    const dropRatio = Math.abs(baselineMean - min) / baselineMean;
    // Direction-aware deviation (collapseDiscount): discount the DROP
    // component so a traffic-loss collapse (symptom) does not out-rank an
    // equivalent RISE (source). See the `collapseDiscount` config doc. With
    // the default 0 this is bit-identical to max(riseRatio, dropRatio).
    const collapseDiscount = cfg.collapseDiscount > 0 ? cfg.collapseDiscount : 0;
    const effectiveDrop = dropRatio * (1 - collapseDiscount);
    const unboundedRatio = Math.max(riseRatio, effectiveDrop);
    // The ceiling bounds the ratio, not the score, so the breakdown keeps
    // reporting the TRUE rise/drop while the deviation reflects the clamp: a
    // diagnostic that echoed the clamped value could no longer justify the
    // setting, because the excursion it exists to bound would be invisible.
    const ratio =
      cfg.metricRiseCeiling > 0 ? Math.min(unboundedRatio, cfg.metricRiseCeiling) : unboundedRatio;
    const deviation = Math.log10(1 + ratio);
    if (deviation < 1e-6) {
      drop(ts.label, 'sub-epsilon-deviation');
      continue;
    }

    // Trend slope (linear regression) — the magnitude of the monotonic drift.
    // This is direction-agnostic: a monotonic drop (memory release, crash)
    // gets the same bonus as a monotonic rise (leak, saturation).
    let sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let i = 0; i < n; i++) {
      const v = ts.values[i]!;
      sx += i;
      sy += v;
      sxx += i * i;
      sxy += i * v;
    }
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    // `mean > 0` is guaranteed here — the loop above `continue`s on mean <= 0 —
    // so the former `: 0` fallback was unreachable dead code.
    const trendStrength = Math.abs((slope * n) / mean);

    // CV
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = ts.values[i]! - mean;
      variance += diff * diff;
    }
    variance /= n;
    const cv = Math.sqrt(variance) / mean;

    // Burst detection. GUARDED on the coefficient, which ships at 0 since iteration 137: at 0 the
    // detector's answer cannot change the score, so the pass is skipped rather than run and multiplied by
    // zero — the same rule the breadth block follows, and it keeps the shipped path bit-identical because
    // `hasBurst` is only ever read by the bonus below.
    let hasBurst = false;
    if (cfg.anomalyBurstWeight !== 0) {
      const threshold = mean + 3 * Math.sqrt(variance);
      for (let i = 0; i < n && !hasBurst; i++) {
        if (ts.values[i]! > threshold) hasBurst = true;
      }
    }

    // Feature-weighted score — bonuses scaled to match log₁₀ deviation.
    //
    // NOTE: do NOT clamp to [0, 1] here. The log₁₀ compression already
    // keeps the magnitude bounded for realistic faults, but the [0,1]
    // upper clamp collapsed every fault whose deviation exceeded ~9×
    // onto the SAME score of 1.0. On dense topologies (TrainTicket's
    // 68 services) the fault injection and its propagated symptoms all
    // saturated at 1.0, so the downstream min-max normalization could
    // no longer tell the root cause apart from its neighbours and the
    // ranking fell back to an arbitrary tiebreaker. Leaving the score
    // unbounded (clamped only at 0 below) preserves the true deviation
    // magnitude; buildTopologyFaultGraph re-scales to [0,1] afterwards.
    // Trend bonus is direction-agnostic: trendStrength is already the
    // ABSOLUTE normalized slope, so a monotonic drop (memory release,
    // crash) gets the same bonus as a monotonic rise (leak, saturation).
    // The bonus is an AMPLIFIER, so it may not exceed the signal it amplifies. On a COLLAPSE it routinely
    // does: a relative drift is unbounded in the denominator while a drop's deviation is capped at
    // `log10(2)`, so the ratio between them is not a fixed scale — see `capTrendBonusAtDeviation`.
    const trendBonusRaw = trendStrength > 0.1 ? trendStrength * cfg.anomalyTrendWeight : 0;
    const trendBonus = cfg.capTrendBonusAtDeviation
      ? Math.min(trendBonusRaw, deviation)
      : trendBonusRaw;
    const burstBonus = hasBurst ? deviation * cfg.anomalyBurstWeight : 0;
    const cvBonus = cv > 0.5 ? Math.min(cv, 1.5) * cfg.anomalyCvWeight : 0;
    let featureScore = deviation + trendBonus + burstBonus + cvBonus;
    featureScore = Math.max(0, featureScore);

    // The decomposition is built once and shared: the diagnostic entry and the
    // dominant-metric record must not be two drifting renderings of the same
    // score (a hand-copied second object is how the published FSE'26 config
    // block lost the field that produced a 24.2pp swing).
    const breakdown: MetricBreakdown = {
      deviation,
      trend: trendBonus,
      cv: cvBonus,
      burst: burstBonus,
      riseRatio,
      dropRatio,
      baselineMean,
      collapseDiscount,
    };
    metricDiagnostics.push({ label: ts.label, outcome: 'kept', score: featureScore, breakdown });

    // Onset: the first point deviating from the PRE-CHANGE baseline by more
    // than 30%. Comparing against the full mean (which includes the spike)
    // made every first point look anomalous, so the onset was always 0 and
    // the source/symptom ordering signal was useless. The baseline is the
    // pre-anomaly level, so the first point that leaves it marks the fault
    // injection time — earlier for the source, later for propagated symptoms.
    let metricOnset = Number.MAX_SAFE_INTEGER;
    for (let i = 0; i < n; i++) {
      if (baselineMean > 0 && Math.abs(ts.values[i]! - baselineMean) / baselineMean > 0.3) {
        metricOnset = i;
        break;
      }
    }

    if (featureScore > bestScore) {
      bestScore = featureScore;
      // Record the metric that actually drove the score, so downstream
      // diagnostics can reveal the TRUE anomaly driver rather than a metric
      // picked by a separate ratio heuristic (which can point at an idle
      // metric that the guards already skipped).
      bestMetricLabel = ts.label;
      bestMetricHead = Array.from(ts.values).slice(0, 6);
      bestMetricTail = Array.from(ts.values).slice(-4);
      // Retain the dominant metric's full series + timestamps so the onset
      // delay can be anchored to the fault injection time afterwards.
      bestMetricValues = ts.values;
      bestMetricTimestamps = ts.timestamps;
      // The onset must follow the DOMINANT metric (the one that drives the
      // score), not the earliest point across all metrics. Taking the MIN
      // across metrics let a non-dominant metric with pre-existing drift
      // (index 0) mask the true fault onset (e.g. a late step change), which
      // corrupted the source/symptom ordering signal used downstream.
      bestMetricOnset = metricOnset;
      bestBreakdown = breakdown;
    }
  }

  // Temporal causal onset: how long after injection did the dominant metric
  // first leave its PRE-INJECT baseline. Anchoring the baseline to the clean
  // pre-fault window avoids the self-derived-baseline contamination that made
  // the index-based `onsetIndex` unreliable (the fault spike inflated the
  // baseline, so the first point looked anomalous and the onset read 0).
  const postInjectOnsetDelay = computePostInjectOnsetDelay(
    bestMetricValues,
    bestMetricTimestamps,
    cfg.injectTimeMs ?? 0,
  );

  // Breadth: the effective number of channels that moved, minus one, times its weight. A `max` over
  // metrics cannot see a source (three channels moved) from a symptom (one channel moved) at the same
  // magnitude, which is the shape of RCAEval's one-step misses; this term can, and it is a ratio so it
  // transfers between a raw and a rank-normalised score. `w = 0` — the shipped value — skips the
  // arithmetic entirely, so the shipped ranking is bit-identical by construction.
  let breadth = 0;
  if (cfg.anomalyBreadthWeight !== 0) {
    let sum = 0;
    let sumSq = 0;
    let keptCount = 0;
    for (const entry of metricDiagnostics) {
      if (entry.outcome !== 'kept') continue;
      keptCount++;
      sum += entry.score;
      sumSq += entry.score * entry.score;
    }
    // `sumSq > 0` needs no guard: every kept entry has `deviation ≥ 1e-6` by the `continue` in the loop
    // above, so at least one score is positive whenever `keptCount ≥ 1` — and with `keptCount ∈ {0, 1}` the
    // expression is `0` or `1 − 1 = 0` on its own. A `sumSq > 0 ? … : 0` here would be a branch no input can
    // reach, which this repository counts as dead code rather than as defensive programming.
    breadth = keptCount > 0 ? (sum * sum) / sumSq - 1 : 0;
  }

  return {
    // The bonus is NOT applied here: it is applied once the whole fleet is known, because the contender
    // gate compares a node's score with the fleet's best — a comparison this function cannot make. The
    // weight being 0 keeps the shipped path exact: `score` is `bestScore + 0·breadth`.
    score: bestScore,
    breadth,
    onsetIndex: bestMetricOnset,
    postInjectOnsetDelay,
    dominantMetric: {
      label: bestMetricLabel,
      head: bestMetricHead,
      tail: bestMetricTail,
      // Derived from the single outcome list rather than accumulated in
      // parallel: the transient guard's discarded labels are one outcome of
      // many, and a second accumulator can only disagree with the first.
      transientSkipped: metricDiagnostics
        .filter((d) => d.outcome === 'transient-return')
        .map((d) => d.label),
      breakdown: bestBreakdown,
    },
    metricDiagnostics,
  };
}

/**
 * Compute how long after fault injection a metric first deviated from its
 * pre-injection (clean) baseline.
 *
 * The metric series is split at `injectTimeMs` into a pre-injection window
 * (the fault-free "normal" level, summarised by its median) and a
 * post-injection window. The delay is the timestamp of the first post-inject
 * sample deviating more than 30% from that clean baseline, minus the injection
 * time. This is the temporal causal signal: the fault source's metric leaves
 * its normal level at (or immediately after) injection, while a symptom's lags
 * as the disturbance propagates (Deng Yu's mean free time τ).
 *
 * @param values - The dominant metric's values (aligned with timestamps).
 * @param timestamps - The dominant metric's Unix-ms timestamps.
 * @param injectTimeMs - Fault injection time in Unix ms (0 = unknown).
 * @returns Onset delay in ms, or -1 when undetermined.
 * @internal
 */
function computePostInjectOnsetDelay(
  values: Float64Array | null,
  timestamps: readonly number[] | null,
  injectTimeMs: number,
): number {
  if (!values || !timestamps) return -1;
  if (injectTimeMs <= 0) return -1;
  if (values.length < 3 || timestamps.length !== values.length) return -1;

  // First sample at/after the injection instant — the inject boundary.
  let boundary = -1;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i]! >= injectTimeMs) {
      boundary = i;
      break;
    }
  }
  // Need at least two clean pre-inject samples and one post-inject sample.
  if (boundary < 2 || boundary >= values.length) return -1;

  // Clean baseline = median of the pre-injection window. The median resists
  // the odd pre-fault outlier, unlike the mean which the fault could inflate.
  const baseline = medianOfRange(values, 0, boundary);
  if (!Number.isFinite(baseline) || baseline <= 0) return -1;

  for (let i = boundary; i < values.length; i++) {
    if (Math.abs(values[i]! - baseline) / baseline > 0.3) {
      // Defensive clamp: with monotonic timestamps this is always >= 0 (the
      // boundary is the first sample at/after injection); the clamp guards
      // against non-monotonic input so a negative delay cannot surface.
      return Math.max(0, timestamps[i]! - injectTimeMs);
    }
  }
  return -1;
}

/**
 * Median of a half-open slice `values[start..end)`.
 *
 * Exported for the self-time signal (`computeSelfTimeScores`), which needs the median of a window at
 * each END of a latency channel and must use the SAME primitive this module's baselines use: two
 * medians would be two estimators, and the whole point of the signal is that the two ends of two
 * different services are measured the same way.
 *
 * Every caller passes a window of at least two samples — the onset baseline (`boundary >= 2`), the
 * robust baseline's fixed 2–5 sample head/tail, and the self-time signal's thirds (`width >= 2`) —
 * so a one-sample window is not a case this function has to answer.
 *
 * @internal
 */
export function medianOfRange(values: Float64Array, start: number, end: number): number {
  const slice = Array.from(values.slice(start, end)).sort((a, b) => a - b);
  const n = slice.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return slice[mid]!;
  return (slice[mid - 1]! + slice[mid]!) / 2;
}

// ── Edge Propagation Weight ───────────────────────────────

/**
 * Compute propagation weight for a single topology edge.
 *
 * ### Propagation Signal Tiers (Priority Order)
 *
 * 1. **Pearson cross-service correlation** (highest priority):
 *    Direct metric correlation across services. Strong co-variation confirms
 *    fault propagation — the strongest possible propagation signal.
 *
 * 2. **BOCPD/MAD propagation velocity** (secondary, I8-P4c):
 *    When Pearson fails, use propagation velocity model: detect anomaly onset
 *    independently for source and target, compute P(propagation | Δt).
 *    This replaces the old static fallback with continuous probability
 *    from changepoint analysis per Deng Yu's mean free time τ.
 *
 * 3. **Data-adaptive anomaly score similarity** (last resort):
 *    Only when both Pearson AND velocity models fail. Uses anomaly score
 *    difference as a weak proxy for propagation. Least reliable signal
 *    and only deployed when no better data source is available.
 *
 * @internal
 */
function computeEdgePropagationWeight(
  edge: CallEdge,
  sourceMetrics: readonly TimeSeries[] | undefined,
  targetMetrics: readonly TimeSeries[] | undefined,
  anomalyScores: ReadonlyMap<ServiceId, number>,
  anomalyOnsetTimes: ReadonlyMap<ServiceId, number>,
  cfg: TopologyFaultGraphConfig,
): EdgeWeightResult {
  // ── Tier 1: Cross-service correlation (Spearman or Pearson) ─
  if (sourceMetrics && sourceMetrics.length > 0 && targetMetrics && targetMetrics.length > 0) {
    const corrWeight =
      cfg.correlationMethod === 'spearman'
        ? computeMaxSpearmanCorrelation(sourceMetrics, targetMetrics, cfg.minDataPoints)
        : computeMaxPearsonCorrelation(sourceMetrics, targetMetrics, cfg.minDataPoints);

    if (corrWeight !== null) {
      // Apply temporal causality bonus
      const sourceOnset = anomalyOnsetTimes.get(edge.from)!;
      const targetOnset = anomalyOnsetTimes.get(edge.to)!;
      const temporalBonus =
        cfg.useTemporalCausality && sourceOnset < targetOnset ? cfg.temporalBonus : 0;

      const finalWeight = Math.min(1, corrWeight + temporalBonus);
      return {
        weight: finalWeight,
        method: cfg.correlationMethod,
        temporalBonus: temporalBonus > 0,
      };
    }
  }

  // ── Tier 2: Propagation velocity (BOCPD/MAD) ────────────
  if (
    cfg.usePropagationVelocity &&
    sourceMetrics &&
    sourceMetrics.length > 0 &&
    targetMetrics &&
    targetMetrics.length > 0
  ) {
    const sourceValues = sourceMetrics[0]!.values;
    const targetValues = targetMetrics[0]!.values;

    if (sourceValues.length >= 5 && targetValues.length >= 5) {
      const useBOCPD = cfg.propagationVelocity?.useBOCPD ?? false;
      const expectedDirectLatency = cfg.propagationVelocity?.expectedDirectLatency ?? 1.0;

      // `computePropagationVelocity` and its entire call chain
      // (`bocpdDetectOnset`, `computeAutoSensitivity`, `computeMADThreshold`,
      // `detectMADOnset`) contain no `throw` statements — they degrade
      // gracefully to `propagationProbability: 0` for pathological input
      // (e.g. all-zero series) rather than raising. The former try/catch
      // fallback was therefore unreachable dead code.
      const velocityResult = computePropagationVelocity(sourceValues, targetValues, {
        useBOCPD,
        expectedDirectLatency,
        // Only forward the BOCPD tuning when present: spreading `undefined`
        // would overwrite the merged default config with `bocpd: undefined`.
        ...(cfg.propagationVelocity?.bocpd ? { bocpd: cfg.propagationVelocity.bocpd } : {}),
      });

      if (velocityResult.propagationProbability > 0) {
        const sourceScore = anomalyScores.get(edge.from)!;
        const targetScore = anomalyScores.get(edge.to)!;
        const anomalyCorrelation = 1 - Math.abs(sourceScore - targetScore);

        // Edge weight = anomaly correlation × propagation probability
        const velocityWeight = Math.max(
          0,
          Math.min(1, anomalyCorrelation * velocityResult.propagationProbability),
        );

        if (velocityWeight > 0.05) {
          return {
            weight: velocityWeight,
            method: velocityResult.method === 'bocpd' ? 'bocpd_velocity' : 'mad_velocity',
            temporalBonus: false,
          };
        }
      }
    }
  }

  // ── Tier 3: Data-adaptive anomaly score similarity ──────
  const sourceScore = anomalyScores.get(edge.from) ?? 0;
  // `edge.to` is always a graph node (tier 3 is only reached for real edges),
  // so the target score lookup is always defined.
  const targetScore = anomalyScores.get(edge.to)!;

  // Anomaly score difference as weak proxy for correlation
  const correlationProxy = 1 - Math.abs(sourceScore - targetScore);

  // Apply data-adaptive gain based on anomaly magnitude
  // Higher average anomaly → higher weight for co-anomalous edges
  const avgScore = (sourceScore + targetScore) / 2;
  const gainFactor = Math.min(1, avgScore * 2);

  const similarityWeight = correlationProxy * (0.3 + 0.7 * gainFactor);

  return {
    weight: Math.max(0.05, Math.min(1, similarityWeight)),
    method: 'anomaly_similarity',
    temporalBonus: false,
  };
}

// ── Spearman Rank Correlation ───────────────────────────────

/**
 * Compute the maximum absolute Spearman rank correlation coefficient
 * between any metric pair from source and target services.
 *
 * Spearman rank correlation (ρ) measures monotonic relationship
 * strength without assuming linearity.  It converts values to ranks
 * then computes Pearson correlation on the ranks:
 *
 *   ρ = 1 − (6 × Σd²) / (n(n² − 1))     (no ties)
 *
 * where d is the rank difference for each pair.  Average ranks are
 * assigned for ties.
 *
 * Spearman is preferred over Pearson for microservice fault
 * propagation because:
 *   - CPU → latency is often logarithmic, not linear
 *   - Memory leak → throughput effect is sigmoidal
 *   - Outliers and scale differences don't distort ranks
 *
 * @internal
 */
function computeMaxSpearmanCorrelation(
  sourceMetrics: readonly TimeSeries[],
  targetMetrics: readonly TimeSeries[],
  minDataPoints: number,
): number | null {
  let maxAbsCorr = -1;

  for (const srcTs of sourceMetrics) {
    if (srcTs.values.length < minDataPoints) continue;

    for (const tgtTs of targetMetrics) {
      if (tgtTs.values.length < minDataPoints) continue;

      // `minLen` is always >= `minDataPoints` here: both outer loops
      // `continue` when either `srcTs.values.length` or `tgtTs.values.length`
      // is below `minDataPoints`, so their minimum cannot be. The former
      // `minLen < minDataPoints` guard was unreachable dead code.
      const minLen = Math.min(srcTs.values.length, tgtTs.values.length);

      const r = spearmanCorrelation(srcTs.values, tgtTs.values, minLen);
      if (r !== null) {
        const absR = Math.abs(r);
        if (absR > maxAbsCorr) maxAbsCorr = absR;
      }
    }
  }

  return maxAbsCorr >= 0 ? maxAbsCorr : null;
}

/**
 * Compute Spearman rank correlation coefficient (ρ).
 *
 * Algorithm:
 *   1. Rank each array independently (average rank for ties)
 *   2. Compute Pearson correlation on the ranks
 *   3. Return ρ ∈ [−1, 1] or null if degenerate
 *
 * Complexity: O(n log n) due to sorting for ranking.
 *
 * @internal
 */
function spearmanCorrelation(xs: Float64Array, ys: Float64Array, n: number): number | null {
  // ── Rank xs ──────────────────────────────────────────
  const xRanks = rankValues(xs, n);
  if (!xRanks) return null;

  // ── Rank ys ──────────────────────────────────────────
  const yRanks = rankValues(ys, n);
  if (!yRanks) return null;

  // ── Pearson correlation on ranks ─────────────────────
  return pearsonCorrelation(xRanks, yRanks, n);
}

/**
 * Rank a Float64Array with average rank for ties.
 *
 * Returns a Float64Array of ranks where each element's rank is its
 * position in the sorted order (1-indexed), with tied values
 * sharing the average of their rank positions.
 *
 * Returns null if all values are identical (undefined rank).
 *
 * @internal
 */
function rankValues(values: Float64Array, n: number): Float64Array | null {
  // Create index array and sort by value
  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => values[a]! - values[b]!);

  // Check for degeneracy
  if (values[indices[0]!]! === values[indices[n - 1]!]!) return null;

  // Assign average ranks for ties
  const ranks = new Float64Array(n);
  let i = 0;
  while (i < n) {
    // Find the end of the tie group
    let j = i + 1;
    while (j < n && values[indices[j]!]! === values[indices[i]!]!) j++;
    // Average rank for positions i to j-1 (1-indexed: i+1 to j)
    const avgRank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) {
      ranks[indices[k]!] = avgRank;
    }
    i = j;
  }

  return ranks;
}

/**
 * Compute the maximum absolute Pearson correlation coefficient between
 * any metric pair from source and target services.
 *
 * For each metric in source (e.g., "cpu_usage"), we find the best-correlated
 * metric in target (e.g., "cpu_usage", "mem_usage", "disk_usage") and compute
 * the Pearson r. The maximum |r| across all pairs is returned.
 *
 * This handles the case where a fault in service A's CPU manifests as
 * increased latency in service B — the correlation is between different
 * metric types, not just same-named metrics.
 *
 * Returns null if neither service has sufficient data for correlation.
 *
 * @internal
 */
function computeMaxPearsonCorrelation(
  sourceMetrics: readonly TimeSeries[],
  targetMetrics: readonly TimeSeries[],
  minDataPoints: number,
): number | null {
  let maxAbsCorr = -1;

  for (const srcTs of sourceMetrics) {
    if (srcTs.values.length < minDataPoints) continue;

    for (const tgtTs of targetMetrics) {
      if (tgtTs.values.length < minDataPoints) continue;

      // Align time-series to the minimum common length. `minLen` is always
      // >= `minDataPoints` here (both outer loops already `continue` on short
      // series), so the former `minLen < minDataPoints` guard was unreachable
      // dead code.
      const minLen = Math.min(srcTs.values.length, tgtTs.values.length);

      const r = pearsonCorrelation(srcTs.values, tgtTs.values, minLen);
      if (r !== null) {
        const absR = Math.abs(r);
        if (absR > maxAbsCorr) maxAbsCorr = absR;
      }
    }
  }

  return maxAbsCorr >= 0 ? maxAbsCorr : null;
}

/**
 * Compute the Pearson product-moment correlation coefficient.
 *
 * r = Σ[(x_i - x̄)(y_i - ȳ)] / √[Σ(x_i - x̄)² · Σ(y_i - ȳ)²]
 *
 * Returns null if either series has zero variance (all values identical).
 *
 * @internal
 */
function pearsonCorrelation(xs: Float64Array, ys: Float64Array, n: number): number | null {
  // Compute means
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  // Compute covariance and variances
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  // Handle zero variance
  if (varX === 0 || varY === 0) return null;

  return cov / Math.sqrt(varX * varY);
}

// ── Baseline Strategy Selection ────────────────────────────

/**
 * Auto-detect the optimal baseline strategy from metric distribution.
 *
 * **Bimodality detection:**
 *   bimodal = (median − min) / (max − min) < 0.3
 *           ∧ (max − Q3) / (Q3 − Q1) > 2.0
 *
 * A bimodal distribution (most values near baseline, few spike values)
 * **Spike-dominated detection:**
 *   Count values > 0.8 × max.  If 30–70% of points are in the spike,
 *   the metric is spike-dominated (most points elevated, few baseline).
 *   This pattern (common in stress-ng benchmarks like OnlineBoutique)
 *   benefits from Q25 baseline which picks the low-baseline minority.
 *
 *   For continuous data (SockShop, most values spread across range),
 *   few values exceed the 0.8×max threshold → sliding-window.
 *
 * @internal
 */
function detectBaselineStrategy(values: Float64Array, n: number): 'q25' | 'sliding-window' {
  const minVal = Math.min(...values.slice(0, n));
  const maxVal = Math.max(...values.slice(0, n));
  if (maxVal === minVal) return 'sliding-window';

  const spikeThreshold = maxVal * 0.8;
  let spikeCount = 0;
  for (let i = 0; i < n; i++) {
    if (values[i]! >= spikeThreshold) spikeCount++;
  }

  const spikeRatio = spikeCount / n;

  // Spike-dominated: 30-70% of data elevated → bimodal with spike majority
  // (e.g. OB order-svc: 5/10 > 0.8×max → Q25 finds the 3 baseline points)
  return spikeRatio > 0.3 && spikeRatio <= 0.7 ? 'q25' : 'sliding-window';
}

/**
 * Compute a robust baseline when change-point detection fails,
 * using the selected strategy.
 *
 * The baseline must be the PRE-anomaly level. A rise starts low and climbs
 * high, so its pre-anomaly level is the LOW side; a drop starts high and
 * falls low, so its pre-anomaly level is the HIGH side. Picking the minimum
 * window unconditionally (the previous behaviour) inverted a drop — the low
 * tail became the "baseline" and the high pre-drop level became a spurious
 * 142× "rise", letting a symptom that merely fell to ~0 outrank the fault's
 * genuine percentage increase. We therefore detect the trend direction from
 * the two halves of the series and select the extreme window on the
 * pre-anomaly side: minimum-mean windows for a rise, maximum-mean windows
 * for a drop.
 *
 * One shape defeats BOTH the half-mean direction detector and the
 * 25%-of-whole anchor: a CRASH VICTIM, whose series is a SHORT pre-crash
 * head (5-9 high samples) followed by a LONG near-zero tail. The tail
 * dominates both half-means (a noise-level coin flip that flips the drop into
 * a "rise") and the 25% anchor window (diluting the baseline low and
 * re-scoring the drop as a 13x-200x rise — the TT RE3 F3/F4 signature, base
 * 0.025-0.244 in the wild). A crash is recognised unambiguously by its
 * collapsed tail (median < 10% of the head median); we anchor it directly to
 * the head's upper quartile instead of running the half-mean / window
 * inference. Everything else keeps the original inference, so a long-plateau
 * drop (OB/SS RE3) is untouched.
 *
 * @internal
 */
function computeRobustBaseline(
  values: Float64Array,
  n: number,
  strategy: 'q25' | 'sliding-window',
  fallbackMean: number,
): number {
  const headWin = Math.max(2, Math.min(5, n));
  const tailWin = Math.max(2, Math.min(5, n));
  const headMedian = medianOfRange(values, 0, headWin);
  const tailMedian = medianOfRange(values, n - tailWin, n);

  // Crash-victim signature: the tail collapsed to < 10% of the head level.
  // Anchor directly to the head upper quartile (the pre-crash level) — the
  // half-mean / window inference below is defeated by the long near-zero tail.
  // The upper quartile (not the median/max) sits near the pre-crash peak and
  // tolerates a single low outlier in the head.
  const isCrash = headMedian > 0.001 && tailMedian < headMedian * 0.1;
  if (isCrash) {
    const headSorted = Array.from(values.slice(0, headWin)).sort((a, b) => a - b);
    const upperIdx = Math.min(headSorted.length - 1, Math.ceil(headSorted.length * 0.75) - 1);
    // `upperIdx` is at or above the median index of the head window, so
    // `headSorted[upperIdx] >= headMedian`, and reaching this branch already
    // requires `headMedian > 0.001`. The upper quartile is therefore always a
    // usable baseline here — a `> 0.001 ? … : fallbackMean` guard would carry a
    // permanently unreachable arm, so the value is returned directly.
    return headSorted[upperIdx]!;
  }

  // Trend direction from the two halves: a drop's first half is higher.
  const half = Math.floor(n / 2);
  let firstSum = 0;
  for (let i = 0; i < half; i++) firstSum += values[i]!;
  let secondSum = 0;
  for (let i = half; i < n; i++) secondSum += values[i]!;
  const isDrop = firstSum / half > secondSum / (n - half);

  if (strategy === 'q25') {
    const sorted = Array.from(values.slice(0, n)).sort((a, b) => a - b);
    if (isDrop) {
      // Pre-drop baseline is the HIGH quarter of the distribution.
      const lo = Math.floor(n * 0.75);
      let sum = 0;
      for (let k = lo; k < n; k++) sum += sorted[k]!;
      const highMean = sum / (n - lo);
      return highMean > 0.001 ? highMean : fallbackMean;
    }
    const q25Idx = Math.max(1, Math.floor(n * 0.25));
    let sum = 0;
    for (let k = 0; k < q25Idx; k++) sum += sorted[k]!;
    const q25Mean = sum / q25Idx;
    return q25Mean > 0.001 ? q25Mean : fallbackMean;
  }

  // sliding-window: minimum-mean window for a rise, maximum-mean for a drop.
  const winSize = Math.max(2, Math.ceil(n * 0.25));
  let extremeWinMean = isDrop ? -Infinity : Infinity;
  for (let w = 0; w <= n - winSize; w++) {
    let winSum = 0;
    for (let k = 0; k < winSize; k++) winSum += values[w + k]!;
    const winMean = winSum / winSize;
    if (isDrop ? winMean > extremeWinMean : winMean < extremeWinMean) {
      extremeWinMean = winMean;
    }
  }
  return extremeWinMean > 0.001 ? extremeWinMean : fallbackMean;
}
