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
  ServiceCallGraph,
  ServiceId,
  TimeSeries,
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
}

const DEFAULT_CONFIG: TopologyFaultGraphConfig = {
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
  collapseDiscount: 0, // symmetric rise/drop (shipped behaviour)
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
  const cfg = { ...DEFAULT_CONFIG, ...config };

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

  // ── Step 1b: Score normalization for large topologies ───
  // On topologies with many services (e.g. TrainTicket, 80+ nodes) the
  // raw deviation-based anomaly scores cluster near zero because the
  // fault-injected signal is diluted across healthy services.  Min-max
  // normalization rescales them to [0, 1], making the root cause stand
  // out against the noise floor.
  //
  // We only apply this on graphs with ≥ 20 nodes so that small, well-
  // studied topologies (OnlineBoutique 12–14, SockShop 12–14) retain
  // their existing calibrated scoring.  The threshold is deliberately
  // conservative — any system large enough to need this has well over
  // 20 services and the overhead of an extra pass is negligible.
  const ANOMALY_NORMALIZE_NODE_THRESHOLD = 20;
  if (callGraph.nodes.size >= ANOMALY_NORMALIZE_NODE_THRESHOLD) {
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
    propagationWeights,
    pearsonEdgeCount,
    fallbackEdgeCount,
    temporalEdgeCount,
    computedDecayAlpha,
  };
}

// ── Internal Types ────────────────────────────────────────

interface AnomalyFeatures {
  score: number;
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
}

/**
 * The raw feature-score decomposition of a metric's anomaly, for the failure
 * diagnostics. Reveals WHY a metric out-ranked another (deviation vs trend vs
 * CV vs burst), which a single scalar score cannot.
 */
export interface MetricBreakdown {
  /** log10(1 + ratio) — the direction-aware deviation magnitude. */
  readonly deviation: number;
  /** trendStrength × 0.15 — the monotonic-slope bonus (0 when suppressed). */
  readonly trend: number;
  /** min(cv, 1.5) × 0.05 — the coefficient-of-variation bonus. */
  readonly cv: number;
  /** deviation × 0.1 — the burst bonus. */
  readonly burst: number;
  /** (max − baseline) / baseline — the rise component. */
  readonly riseRatio: number;
  /** (baseline − min) / baseline — the drop component (before discount). */
  readonly dropRatio: number;
  /** The pre-anomaly baseline used to compute both ratios. */
  readonly baselineMean: number;
  /** The collapseDiscount in effect when the score was computed. */
  readonly collapseDiscount: number;
}

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
      onsetIndex: Number.MAX_SAFE_INTEGER,
      postInjectOnsetDelay: -1,
      dominantMetric: { label: '', head: [], tail: [], transientSkipped: [] },
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
  const transientSkippedLabels: string[] = [];

  for (const ts of serviceMetrics) {
    if (ts.values.length < 2) continue;

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
    if (mean <= 0) continue;

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
    if (nearZeroCount > n * 0.4) continue;

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
    const headLevel = ts.values[0]!;
    const tailLevel = ts.values[n - 1]!;
    const range = max - min;
    const headTailSpread = Math.abs(headLevel - tailLevel);
    const nonZeroBaseline = headLevel > max * 0.001 && tailLevel > max * 0.001;
    const permanence = range > max * 1e-6 ? headTailSpread / range : 1;
    if (nonZeroBaseline && permanence < 0.3) {
      // Diagnostic: record what the transient guard discards, so the
      // benchmark failure diagnostics can reveal whether a genuine fault
      // signature is being mistaken for a transient symptom.
      transientSkippedLabels.push(ts.label);
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
    const ratio = Math.max(riseRatio, effectiveDrop);
    const deviation = Math.log10(1 + ratio);
    if (deviation < 1e-6) continue;

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

    // Burst detection
    let hasBurst = false;
    const threshold = mean + 3 * Math.sqrt(variance);
    for (let i = 0; i < n && !hasBurst; i++) {
      if (ts.values[i]! > threshold) hasBurst = true;
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
    const trendBonus = trendStrength > 0.1 ? trendStrength * 0.15 : 0;
    const burstBonus = hasBurst ? deviation * 0.1 : 0;
    const cvBonus = cv > 0.5 ? Math.min(cv, 1.5) * 0.05 : 0;
    let featureScore = deviation + trendBonus + burstBonus + cvBonus;
    featureScore = Math.max(0, featureScore);

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
      bestBreakdown = {
        deviation,
        trend: trendBonus,
        cv: cvBonus,
        burst: burstBonus,
        riseRatio,
        dropRatio,
        baselineMean,
        collapseDiscount,
      };
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

  return {
    score: bestScore,
    onsetIndex: bestMetricOnset,
    postInjectOnsetDelay,
    dominantMetric: {
      label: bestMetricLabel,
      head: bestMetricHead,
      tail: bestMetricTail,
      transientSkipped: transientSkippedLabels,
      breakdown: bestBreakdown,
    },
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
 * @internal
 */
function medianOfRange(values: Float64Array, start: number, end: number): number {
  const slice = Array.from(values.slice(start, end)).sort((a, b) => a - b);
  const n = slice.length;
  // `n` is always >= 2 here: the sole caller (`computePostInjectOnsetDelay`)
  // returns early when `boundary < 2`, and `medianOfRange(values, 0, boundary)`
  // slices exactly `boundary` elements. The former `n === 0` guard was dead code.
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
 * @internal
 */
function computeRobustBaseline(
  values: Float64Array,
  n: number,
  strategy: 'q25' | 'sliding-window',
  fallbackMean: number,
): number {
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
