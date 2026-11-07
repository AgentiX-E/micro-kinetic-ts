/**
 * MAD (Median Absolute Deviation) threshold computation.
 *
 * Provides robust anomaly threshold calculation using MAD as
 * the baseline dispersion measure. MAD tolerates up to 50%
 * outliers before breaking down — far more robust than
 * standard deviation which has 0% breakdown point.
 *
 * Integration with AutoSensitivity:
 *   threshold = MAD * k_optimal
 * where k_optimal is determined by the bifurcation-guided
 * EGADS-inspired AutoSensitivity search.
 *
 * Reference:
 *   Laptev, N., et al. (2015). "Generic and Scalable Framework
 *   for Automated Time-series Anomaly Detection." KDD 2015.
 *
 * @module kinetic/signals/mad-threshold
 */

import { RollingStats } from './rolling-stats.js';

/**
 * Configuration for MAD-based threshold computation.
 */
export interface MADThresholdConfig {
  /**
   * MAD multiplier. Lower values → more anomalies flagged.
   * Default 3.0 (Iglewicz & Hoaglin convention: 3.5 for
   * moderately conservative, 3.0 for moderate).
   *
   * Should be overridden by AutoSensitivity's optimal k.
   */
  multiplier: number;

  /**
   * If true, use scaled MAD (× 1.4826 consistency correction
   * for normal distribution). If false, use raw MAD.
   */
  scaled: boolean;

  /**
   * Minimum number of data points required. If actual data
   * count is less than this, a fallback multiplier is used.
   */
  minDataPoints: number;

  /**
   * Fallback multiplier for sparse data scenarios.
   */
  sparseFallbackMultiplier: number;
}

export const DEFAULT_MAD_CONFIG: MADThresholdConfig = {
  multiplier: 3.0,
  scaled: true,
  minDataPoints: 10,
  sparseFallbackMultiplier: 5.0,
};

/**
 * Result of MAD threshold computation.
 */
export interface MADThresholdResult {
  /** Median of the data series. */
  median: number;
  /** MAD value (scaled or raw per config). */
  mad: number;
  /** Computed threshold = MAD × multiplier. */
  threshold: number;
  /**
   * Whether sparse fallback was applied.
   * True when data points < minDataPoints.
   */
  usedSparseFallback: boolean;
  /** Actual multiplier used (may differ from config if sparse fallback). */
  effectiveMultiplier: number;
}

/**
 * Compute the anomaly threshold using Median Absolute Deviation.
 *
 * For each value x, an anomaly is detected when:
 *   |x - median| > threshold
 * where threshold = MAD × multiplier.
 *
 * MAD is computed as:
 *   MAD = median(|x_i - median(x)|) × 1.4826 (if scaled)
 *
 * This approach is robust to outliers — up to 50% of the data
 * can be anomalous before the MAD itself is affected.
 *
 * @param values - Metric time series values.
 * @param config - MAD threshold configuration.
 * @returns Threshold result with median, MAD, and computed threshold.
 */
export function computeMADThreshold(
  values: Float64Array | number[],
  config: Partial<MADThresholdConfig> = {},
): MADThresholdResult {
  const merged = { ...DEFAULT_MAD_CONFIG, ...config };
  const { multiplier, scaled, minDataPoints, sparseFallbackMultiplier } = merged;

  if (values.length === 0) {
    return {
      median: 0,
      mad: 0,
      threshold: 0,
      usedSparseFallback: true,
      effectiveMultiplier: sparseFallbackMultiplier,
    };
  }

  const { mad, median } = RollingStats.mad(values, scaled);
  const isSparse = values.length < minDataPoints;

  const effectiveMultiplier = isSparse ? sparseFallbackMultiplier : multiplier;

  return {
    median,
    mad,
    threshold: mad * effectiveMultiplier,
    usedSparseFallback: isSparse,
    effectiveMultiplier,
  };
}

/**
 * Detect anomalies using MAD threshold.
 *
 * Returns the indices of data points that exceed the threshold,
 * along with their deviation ratios (|x - median| / threshold).
 *
 * Does NOT modify the input array.
 *
 * @param values - Metric time series.
 * @param config - MAD threshold configuration.
 * @returns Array of anomaly entries with index, value, and deviation ratio.
 */
export function detectMADAnomalies(
  values: Float64Array | number[],
  config: Partial<MADThresholdConfig> = {},
): Array<{ index: number; value: number; deviationRatio: number }> {
  const { median, threshold } = computeMADThreshold(values, config);
  const anomalies: Array<{ index: number; value: number; deviationRatio: number }> = [];

  if (threshold === 0) return anomalies;

  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    const deviation = Math.abs(v - median);
    if (deviation > threshold) {
      anomalies.push({
        index: i,
        value: v,
        deviationRatio: deviation / threshold,
      });
    }
  }

  return anomalies;
}
