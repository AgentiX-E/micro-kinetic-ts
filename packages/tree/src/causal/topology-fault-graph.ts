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

import {
  computePropagationVelocity,
  type PropagationVelocityResult,
} from './propagation-velocity.js';

/**
 * Configuration for the topology-preserving fault graph builder.
 */
export interface TopologyFaultGraphConfig {
  /** Minimum number of data points required for Pearson correlation. Default: 3. */
  readonly minDataPoints: number;
  /** Temporal causality bonus: added when source anomaly precedes target. Default: 0.15. */
  readonly temporalBonus: number;
  /** Default edge weight when correlation cannot be computed. Default: 0.05. */
  readonly defaultWeight: number;
  /** Whether to apply temporal causality analysis. Default: true. */
  readonly useTemporalCausality: boolean;
  /**
   * Whether to use BOCPD/MAD-based propagation velocity as a secondary
   * weight computation method when Pearson correlation is unavailable.
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
  };
}

const DEFAULT_CONFIG: TopologyFaultGraphConfig = {
  minDataPoints: 3,
  temporalBonus: 0.15,
  defaultWeight: 0.05,
  useTemporalCausality: true,
  usePropagationVelocity: true,
  propagationVelocity: {
    useBOCPD: false, // MAD-based by default for performance
    expectedDirectLatency: 1.0,
  },
};

/**
 * Result of building a topology-preserving fault graph.
 */
export interface TopologyFaultGraphResult {
  /** Per-service anomaly scores (0-1). */
  readonly anomalyScores: Map<ServiceId, number>;
  /** Per-service anomaly onset indices (earliest anomalous data point). */
  readonly anomalyOnsetTimes: Map<ServiceId, number>;
  /** Per-edge propagation weights (0-1), aligned with callGraph.edges. */
  readonly propagationWeights: Float64Array;
  /** Diagnostic: number of edges computed via Pearson correlation. */
  readonly pearsonEdgeCount: number;
  /** Diagnostic: number of edges computed via fallback (anomaly similarity). */
  readonly fallbackEdgeCount: number;
  /** Diagnostic: number of edges with temporal causality bonus applied. */
  readonly temporalEdgeCount: number;
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

  // Step 1: Compute per-service anomaly scores and onset times
  const anomalyScores = new Map<ServiceId, number>();
  const anomalyOnsetTimes = new Map<ServiceId, number>();
  for (const [serviceId] of callGraph.nodes) {
    const serviceMetrics = metrics.get(serviceId);
    const result = computeAnomalyFeatures(serviceMetrics, cfg);
    anomalyScores.set(serviceId, result.score);
    anomalyOnsetTimes.set(serviceId, result.onsetIndex);
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
    propagationWeights,
    pearsonEdgeCount,
    fallbackEdgeCount,
    temporalEdgeCount,
  };
}

// ── Internal Types ────────────────────────────────────────

interface AnomalyFeatures {
  score: number;
  onsetIndex: number;
}

interface EdgeWeightResult {
  weight: number;
  method: 'pearson' | 'bocpd_velocity' | 'mad_velocity' | 'anomaly_similarity';
  temporalBonus: boolean;
}

// ── Anomaly Score Computation ─────────────────────────────

/**
 * Compute per-service anomaly features: score and onset index.
 *
 * Score: maximum feature-weighted anomaly across all metrics (0-1).
 * Onset: earliest data point index where deviation exceeds 1.5σ.
 *
 * Feature contributions:
 *   - Base deviation: (max - baseline_mean) / baseline_mean
 *   - Trend bonus: monotonic upward slope × 0.3
 *   - Burst bonus: 3-sigma spike detection × 0.2
 *   - CV bonus: high coefficient of variation × 0.15
 *
 * @internal
 */
function computeAnomalyFeatures(
  serviceMetrics: readonly TimeSeries[] | undefined,
  _cfg: TopologyFaultGraphConfig,
): AnomalyFeatures {
  if (!serviceMetrics || serviceMetrics.length === 0) {
    return { score: 0, onsetIndex: Number.MAX_SAFE_INTEGER };
  }

  let bestScore = 0;
  let earliestOnset = Number.MAX_SAFE_INTEGER;

  for (const ts of serviceMetrics) {
    if (ts.values.length < 2) continue;

    const n = ts.values.length;

    // Basic statistics
    let sum = 0;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = ts.values[i]!;
      sum += v;
      if (v > max) max = v;
    }
    const mean = sum / n;
    if (mean <= 0) continue;

    // Change point detection: find first point exceeding 1.5σ
    const fullVariance = ts.values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const fullStd = Math.sqrt(fullVariance);
    let changePt = n;
    for (let i = 1; i < n; i++) {
      if (ts.values[i]! > mean + 1.5 * fullStd) {
        changePt = i;
        break;
      }
    }

    // Baseline from pre-change period
    let baselineMean = mean;
    if (changePt < n && changePt > 2) {
      let bs = 0;
      for (let i = 0; i < changePt; i++) bs += ts.values[i]!;
      baselineMean = bs / changePt;
      if (baselineMean <= 0) baselineMean = mean;
    }

    // Deviation
    const deviation = Math.abs(max - baselineMean) / baselineMean;
    if (deviation < 0.05) continue;

    // Trend slope (linear regression)
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
    const trendStrength = mean > 0 ? Math.abs((slope * n) / mean) : 0;

    // CV
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const diff = ts.values[i]! - mean;
      variance += diff * diff;
    }
    variance /= n;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    // Burst detection
    let hasBurst = false;
    const threshold = mean + 3 * Math.sqrt(variance);
    for (let i = 0; i < n && !hasBurst; i++) {
      if (ts.values[i]! > threshold) hasBurst = true;
    }

    // Monotonic upward
    let isMonotonicUp = slope > 0;
    if (isMonotonicUp) {
      for (let i = 1; i < n; i++) {
        if (ts.values[i]! < ts.values[i - 1]!) {
          isMonotonicUp = false;
          break;
        }
      }
    }

    // Feature-weighted score
    let featureScore = deviation;
    if (isMonotonicUp && trendStrength > 0.1) featureScore += trendStrength * 0.3;
    if (hasBurst) featureScore += deviation * 0.2;
    if (cv > 0.5) featureScore += Math.min(cv, 1.5) * 0.15;
    featureScore = Math.max(0, Math.min(1, featureScore));

    if (featureScore > bestScore) bestScore = featureScore;

    // Onset: first point exceeding 30% deviation from mean
    for (let i = 0; i < n; i++) {
      if (Math.abs(ts.values[i]! - mean) / mean > 0.3) {
        if (i < earliestOnset) earliestOnset = i;
        break;
      }
    }
  }

  return { score: bestScore, onsetIndex: earliestOnset };
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
  // ── Tier 1: Pearson cross-service correlation ────────────
  if (sourceMetrics && sourceMetrics.length > 0 && targetMetrics && targetMetrics.length > 0) {
    const pearsonWeight = computeMaxPearsonCorrelation(
      sourceMetrics,
      targetMetrics,
      cfg.minDataPoints,
    );

    if (pearsonWeight !== null) {
      // Apply temporal causality bonus
      const sourceOnset = anomalyOnsetTimes.get(edge.from) ?? Number.MAX_SAFE_INTEGER;
      const targetOnset = anomalyOnsetTimes.get(edge.to) ?? Number.MAX_SAFE_INTEGER;
      const temporalBonus =
        cfg.useTemporalCausality && sourceOnset < targetOnset ? cfg.temporalBonus : 0;

      const finalWeight = Math.min(1, pearsonWeight + temporalBonus);
      return {
        weight: finalWeight,
        method: 'pearson',
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

      let velocityResult: PropagationVelocityResult;
      try {
        velocityResult = computePropagationVelocity(sourceValues, targetValues, {
          useBOCPD,
          expectedDirectLatency,
        });
      } catch {
        // Velocity computation can fail for pathological data (e.g. all zeros).
        // Fall through to tier 3.
        velocityResult = {
          propagationProbability: 0,
          propagationDelay: 0,
          sourceOnsetIndex: -1,
          targetOnsetIndex: -1,
          sourceConfidence: 0,
          targetConfidence: 0,
          isDirectPropagation: false,
          usedBOCPD: false,
          method: 'mad',
          onsetDelta: 0,
        };
      }

      if (velocityResult.propagationProbability > 0) {
        const sourceScore = anomalyScores.get(edge.from) ?? 0;
        const targetScore = anomalyScores.get(edge.to) ?? 0;
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
  const targetScore = anomalyScores.get(edge.to) ?? 0;

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

// ── Pearson Cross-Service Correlation ─────────────────────

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

      // Align time-series to the minimum common length
      const minLen = Math.min(srcTs.values.length, tgtTs.values.length);
      if (minLen < minDataPoints) continue;

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
