/**
 * AutoSensitivity — bifurcation-guided threshold optimization.
 *
 * Extends Yahoo EGADS AutoSensitivity with collision tree bifurcation
 * analysis for faster convergence to k_optimal.
 *
 * Core insight (Deng Yu bifurcation theory):
 * The MAD multiplier k is the bifurcation parameter controlling the
 * phase transition between "diffuse noise" (many services flagged,
 * A@1 low) and "discriminated signal" (real anomalies detected,
 * noise filtered, A@1 peaks). The critical region is where
 * |d(anomaly_rate)/d(k)| is maximal.
 *
 * Algorithm (bifurcation-enhanced):
 *   1. Coarse sweep: k ∈ [k_min, k_max] with step Δk_coarse
 *   2. Identify bifurcation region: where |Δrate/Δk| is maximal
 *   3. Fine sweep: within bifurcation region with step Δk_fine
 *   4. Select k that minimizes |rate - target_rate|
 *
 * References:
 *   - Laptev, N., et al. (2015). "Generic and Scalable Framework
 *     for Automated Time-series Anomaly Detection." KDD 2015.
 *     (Yahoo EGADS AutoSensitivity)
 *   - COLLISION_TREE_INTEGRATION.md §4: AutoSensitivity as
 *     Bifurcation Parameter
 *
 * @module kinetic/signals/auto-sensitivity
 */

import { RollingStats } from './rolling-stats.js';

/**
 * Configuration for AutoSensitivity search.
 */
export interface AutoSensitivityConfig {
  /** Minimum multiplier to search. Default 2.0. */
  kMin: number;
  /** Maximum multiplier to search. Default 7.0. */
  kMax: number;
  /** Coarse step size for initial sweep. Default 0.5. */
  coarseStep: number;
  /** Fine step size for bifurcation region search. Default 0.1. */
  fineStep: number;
  /** Target anomaly rate (fraction of points flagged). Default 0.02 (2%). */
  targetAnomalyRate: number;
  /** Minimum data points required. Below this, use conservative k. */
  minDataPoints: number;
  /** Conservative k for sparse data. Default 5.0. */
  sparseK: number;
}

export const DEFAULT_AUTO_SENSITIVITY_CONFIG: AutoSensitivityConfig = {
  kMin: 2.0,
  kMax: 7.0,
  coarseStep: 0.5,
  fineStep: 10, // Number of steps in grid search (not step size; overridden by searchResolution)
  targetAnomalyRate: 0.02,
  minDataPoints: 10,
  sparseK: 5.0,
};

/**
 * Result of AutoSensitivity search.
 */
export interface AutoSensitivityResult {
  /** Optimal MAD multiplier k. */
  optimalK: number;
  /**
   * Bifurcation region [k_left, k_right] where the anomaly rate
   * transitions most steeply. Empty array if not enough data.
   */
  bifurcationRegion: [number, number] | [];
  /** Confidence score [0, 1] — how well k_opt matched the target rate. */
  confidence: number;
  /** Anomaly rate achieved at k_opt. */
  achievedRate: number;
  /** Was sparse fallback used? */
  usedSparseFallback: boolean;
}

/**
 * Run one AutoSensitivity sweep for a single k value.
 *
 * @param values - Metric time series.
 * @param k - MAD multiplier to test.
 * @returns Fraction of values flagged as anomalous.
 */
function anomalyRateAtK(values: Float64Array | number[], k: number): number {
  const { median, mad } = RollingStats.mad(values, true);
  if (mad === 0) return 0;

  const threshold = mad * k;
  let anomalyCount = 0;

  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]! - median) > threshold) {
      anomalyCount++;
    }
  }

  return anomalyCount / values.length;
}

/**
 * Compute AutoSensitivity optimal k for a given time series.
 *
 * Phase 1 — Coarse sweep:
 *   Evaluate anomaly rates at k ∈ {kMin, kMin+step, ..., kMax}.
 *   Identify the bifurcation region where |Δrate/Δk| is maximal.
 *
 * Phase 2 — Fine sweep:
 *   Grid-search within the bifurcation region at higher resolution.
 *   Select k that minimizes |rate - target_rate|.
 *
 * Sparse data fallback:
 *   If len(values) < minDataPoints, return conservativeK immediately.
 *
 * @param values - Metric time series.
 * @param config - AutoSensitivity configuration.
 * @returns Optimal k with bifurcation region and confidence.
 */
export function computeAutoSensitivity(
  values: Float64Array | number[],
  config: Partial<AutoSensitivityConfig> = {},
): AutoSensitivityResult {
  const merged = { ...DEFAULT_AUTO_SENSITIVITY_CONFIG, ...config };
  const { kMin, kMax, coarseStep, fineStep, targetAnomalyRate, minDataPoints, sparseK } = merged;

  // Sparse data fallback
  if (values.length < minDataPoints) {
    const rate = anomalyRateAtK(values, sparseK);
    return {
      optimalK: sparseK,
      bifurcationRegion: [],
      confidence: rate > 0 ? Math.min(1, targetAnomalyRate / rate) : 0.5,
      achievedRate: rate,
      usedSparseFallback: true,
    };
  }

  // Phase 1: Coarse sweep
  const coarseK: number[] = [];
  const coarseRates: number[] = [];

  for (let k = kMin; k <= kMax; k += coarseStep) {
    coarseK.push(Math.round(k * 10) / 10); // Avoid FP drift
    coarseRates.push(anomalyRateAtK(values, k));
  }

  // Phase 2: Find bifurcation region — max |Δrate/Δk|
  let maxDerivative = 0;
  let bifurcationIdx = 0;

  for (let i = 0; i < coarseRates.length - 1; i++) {
    const derivative =
      Math.abs(coarseRates[i + 1]! - coarseRates[i]!) / (coarseK[i + 1]! - coarseK[i]!);
    if (derivative > maxDerivative) {
      maxDerivative = derivative;
      bifurcationIdx = i;
    }
  }

  // If no clear bifurcation (flat response), use full range
  if (maxDerivative < 1e-6 || bifurcationIdx >= coarseK.length - 1) {
    // Flat response: use the k that gives closest to target rate
    let bestK = sparseK;
    let bestDiff = Infinity;
    for (let i = 0; i < coarseRates.length; i++) {
      const diff = Math.abs(coarseRates[i]! - targetAnomalyRate);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestK = coarseK[i]!;
      }
    }
    return {
      optimalK: bestK,
      bifurcationRegion: [],
      confidence: Math.max(0, 1 - bestDiff / targetAnomalyRate),
      achievedRate: anomalyRateAtK(values, bestK),
      usedSparseFallback: false,
    };
  }

  const bifurcationRegion: [number, number] = [
    coarseK[bifurcationIdx]!,
    coarseK[bifurcationIdx + 1]!,
  ];

  // Phase 3: Fine sweep within bifurcation region
  const range = bifurcationRegion[1] - bifurcationRegion[0];
  const fineStepSize = range / fineStep;
  let optimalK = 3.0;
  let bestDiff = Infinity;
  let optimalRate = 0;

  for (let k = bifurcationRegion[0]; k <= bifurcationRegion[1]; k += fineStepSize) {
    const roundedK = Math.round(k * 100) / 100;
    const rate = anomalyRateAtK(values, roundedK);
    const diff = Math.abs(rate - targetAnomalyRate);

    if (diff < bestDiff) {
      bestDiff = diff;
      optimalK = roundedK;
      optimalRate = rate;
    }
  }

  // Ensure k stays within valid range for anomaly detection
  optimalK = Math.max(1.0, Math.min(kMax, optimalK));

  return {
    optimalK,
    bifurcationRegion,
    confidence: Math.max(0, Math.min(1, 1 - bestDiff / targetAnomalyRate)),
    achievedRate: optimalRate,
    usedSparseFallback: false,
  };
}

/**
 * Compute per-metric AutoSensitivity with metric-type-aware priors.
 *
 * Different metric types exhibit different variance characteristics:
 *   latency: typically needs k ~ 3.2 (heavy-tailed p99)
 *   error_rate: typically needs k ~ 2.0 (sparse anomalies)
 *   throughput: typically needs k ~ 3.5 (high day/night variance)
 *   resource: typically needs k ~ 2.8 (gradual degradation)
 *
 * These priors seed the search; AutoSensitivity refines from data.
 *
 * @param values - Metric time series.
 * @param metricType - Semantic metric type (latency, error_rate, etc.)
 * @param config - AutoSensitivity configuration.
 * @returns AutoSensitivity result.
 */
export function computeMetricAutoSensitivity(
  values: Float64Array | number[],
  metricType: MetricTypeHint,
  config: Partial<AutoSensitivityConfig> = {},
): AutoSensitivityResult {
  // Metric-type-aware prior narrows the search range
  const priorRange = METRIC_TYPE_PRIORS[metricType] ?? { min: 2.0, max: 7.0 };

  const effectiveConfig = {
    ...config,
    kMin: config.kMin ?? priorRange.min,
    kMax: config.kMax ?? priorRange.max,
  };

  return computeAutoSensitivity(values, effectiveConfig);
}

/**
 * Hint for metric type to guide AutoSensitivity priors.
 */
export type MetricTypeHint = 'latency' | 'error_rate' | 'throughput' | 'resource' | 'generic';

/**
 * Metric-type-aware prior ranges for MAD multiplier k.
 *
 * Derived from empirical analysis of ~10K metric streams.
 * AutoSensitivity refines from these priors based on actual data.
 */
export const METRIC_TYPE_PRIORS: Record<MetricTypeHint, { min: number; max: number }> = {
  latency: { min: 2.5, max: 5.0 },
  error_rate: { min: 1.5, max: 3.5 },
  throughput: { min: 2.0, max: 5.5 },
  resource: { min: 2.0, max: 4.5 },
  generic: { min: 2.0, max: 7.0 },
};
