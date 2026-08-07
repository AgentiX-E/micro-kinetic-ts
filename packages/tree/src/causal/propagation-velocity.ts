/**
 * Propagation Velocity Model — BOCPD-enhanced edge weight computation.
 *
 * Replaces the binary temporalBonus (0.15) with a continuous probability
 * derived from BOCPD changepoint analysis: P(propagation | Δt).
 *
 * Core insight (Collision Tree Integration, Direction B):
 * In Deng Yu's collision tree, the time between collisions (mean free time τ)
 * determines propagation velocity. Similarly, in a service call graph,
 * the delay between fault onset at A and observable anomaly at B reveals
 * whether A→B is a direct causal edge or multi-hop/coincidental.
 *
 * Edge weight formula:
 *   w(A→B) = pearsonR × P(propagation | Δt)
 *
 * where:
 *   pearsonR = |max Pearson correlation| across all metric pairs (A, B)
 *   Δt = t_B - t_A (onset delay in time index units)
 *   P(propagation | Δt) = Gaussian kernel centered at expected topology latency
 *
 * This eliminates false causal edges from coincidental correlation:
 * if metrics are uncorrelated (low Pearson) OR propagation delay is
 * inconsistent with direct causality (low BOCPD probability),
 * the edge weight → 0.
 *
 * @module tree/causal/propagation-velocity
 */

import {
  computeAutoSensitivity,
  type AutoSensitivityConfig,
} from '../../../kinetic/src/signals/auto-sensitivity.js';
import { bocpdDetectOnset, type BOCPDConfig } from '../../../kinetic/src/signals/bocpd-detector.js';
import { computeMADThreshold } from '../../../kinetic/src/signals/mad-threshold.js';

/**
 * Configuration for the propagation velocity model.
 */
export interface PropagationVelocityConfig {
  /** BOCPD configuration for onset detection. */
  bocpd: BOCPDConfig;

  /** AutoSensitivity configuration for threshold tuning. */
  autoSensitivity: AutoSensitivityConfig;

  /**
   * Expected direct-call latency between services (in time index units).
   * This is the "mean free time" in the collision tree analogy.
   *
   * If unknown, the model uses data-driven estimation:
   *   Δt_expected = argmax P(propagation | Δt)
   *
   * Default 1.0 (one time step) — useful when sampling interval
   * is coarse relative to service latency.
   */
  expectedDirectLatency: number;

  /**
   * Standard deviation multiplier for the Gaussian propagation kernel.
   * Larger values → wider acceptance window for different Δt values.
   * Default 0.5 (50% of expected latency).
   */
  latencyStddevMultiplier: number;

  /**
   * Whether to use BOCPD-based onset detection (true) or
   * AutoSensitivity/MAD-based onset detection (false).
   */
  useBOCPD: boolean;
}

export const DEFAULT_PROPAGATION_CONFIG: PropagationVelocityConfig = {
  bocpd: {
    hazardRate: 1 / 250,
    maxRunLength: 1000,
    degreesOfFreedom: 3,
    scale: 1.0,
    changepointThreshold: 0.1,
    minRunLength: 3,
  },
  autoSensitivity: {
    kMin: 2.0,
    kMax: 7.0,
    coarseStep: 0.5,
    fineStep: 10,
    targetAnomalyRate: 0.02,
    minDataPoints: 10,
    sparseK: 5.0,
  },
  expectedDirectLatency: 1.0,
  latencyStddevMultiplier: 0.5,
  useBOCPD: false, // Default to MAD-based for speed; BOCPD for accuracy
};

/**
 * Result of propagation velocity computation.
 */
export interface PropagationVelocityResult {
  /**
   * Propagation probability P(propagation | Δt) ∈ [0, 1].
   * Multiplied with Pearson correlation to produce edge weight.
   */
  propagationProbability: number;

  /** Estimated propagation delay in time index units. */
  propagationDelay: number;

  /** Source service onset index. -1 if no changepoint detected. */
  sourceOnsetIndex: number;

  /** Target service onset index. -1 if no changepoint detected. */
  targetOnsetIndex: number;

  /** Source changepoint confidence [0, 1]. */
  sourceConfidence: number;

  /** Target changepoint confidence [0, 1]. */
  targetConfidence: number;

  /**
   * Whether propagation time is consistent with direct call
   * (true) or suggests multi-hop/coincidental (false).
   */
  isDirectPropagation: boolean;

  /**
   * Whether onset detection was BOCPD (true) or MAD-based (false).
   */
  usedBOCPD: boolean;
}

/**
 * Gaussian kernel for delay-match probability.
 *
 * P(Δt) = exp(-(Δt - μ)² / (2σ²))
 *
 * where μ = expectedDirectLatency, σ = μ × latencyStddevMultiplier.
 * This peaks at expected latency and decays symmetrically.
 */
function gaussianKernel(dt: number, mu: number, sigma: number): number {
  if (sigma <= 0) return dt === mu ? 1 : 0;
  const z = (dt - mu) / sigma;
  return Math.exp(-0.5 * z * z);
}

/**
 * Detect onset using MAD-based method (AutoSensitivity).
 *
 * Uses MAD × k_opt to find the first data point exceeding
 * the adaptive threshold.
 *
 * @param values - Metric time series.
 * @param config - AutoSensitivity configuration.
 * @returns Onset index and confidence.
 */
function detectMADOnset(
  values: Float64Array | number[],
  config: AutoSensitivityConfig,
): { onsetIndex: number; confidence: number } {
  if (values.length < config.minDataPoints) {
    return { onsetIndex: -1, confidence: 0 };
  }

  const { optimalK } = computeAutoSensitivity(values, config);
  const { median, threshold, usedSparseFallback } = computeMADThreshold(values, {
    multiplier: optimalK,
    minDataPoints: config.minDataPoints,
  });

  if (threshold === 0) return { onsetIndex: -1, confidence: 0 };

  // Find first point exceeding threshold
  for (let i = 0; i < values.length; i++) {
    const deviation = Math.abs(values[i]! - median);
    if (deviation > threshold) {
      // Confidence based on how far above threshold
      const confidence = Math.min(1, deviation / threshold - 1);
      return { onsetIndex: i, confidence: usedSparseFallback ? confidence * 0.5 : confidence };
    }
  }

  return { onsetIndex: -1, confidence: 0 };
}

/**
 * Compute propagation velocity between two services.
 *
 * Detects anomaly onset in both source and target metric series,
 * then computes the propagation probability based on the delay
 * between them. Uses BOCPD (high accuracy) or MAD-based (fast)
 * onset detection depending on config.
 *
 * @param sourceValues - Source service metric time series.
 * @param targetValues - Target service metric time series.
 * @param config - Propagation velocity configuration.
 * @returns Propagation velocity result.
 */
export function computePropagationVelocity(
  sourceValues: Float64Array | number[],
  targetValues: Float64Array | number[],
  config: Partial<PropagationVelocityConfig> = {},
): PropagationVelocityResult {
  const merged = { ...DEFAULT_PROPAGATION_CONFIG, ...config };
  const {
    bocpd: bocpdCfg,
    autoSensitivity: asCfg,
    expectedDirectLatency,
    latencyStddevMultiplier,
    useBOCPD,
  } = merged;

  // Detect onset in source
  let sourceOnset: number;
  let sourceConfidence: number;

  if (useBOCPD) {
    const bocpdResult = bocpdDetectOnset(sourceValues, bocpdCfg);
    sourceOnset = bocpdResult.onsetIndex;
    sourceConfidence = bocpdResult.confidence;
  } else {
    ({ onsetIndex: sourceOnset, confidence: sourceConfidence } = detectMADOnset(
      sourceValues,
      asCfg,
    ));
  }

  // Detect onset in target
  let targetOnset: number;
  let targetConfidence: number;

  if (useBOCPD) {
    const bocpdResult = bocpdDetectOnset(targetValues, bocpdCfg);
    targetOnset = bocpdResult.onsetIndex;
    targetConfidence = bocpdResult.confidence;
  } else {
    ({ onsetIndex: targetOnset, confidence: targetConfidence } = detectMADOnset(
      targetValues,
      asCfg,
    ));
  }

  // If either onset is undetected, propagation is indeterminate
  if (sourceOnset < 0 || targetOnset < 0) {
    // Default to neutral propagation probability when onset unclear
    return {
      propagationProbability: 0.5,
      propagationDelay: 0,
      sourceOnsetIndex: sourceOnset,
      targetOnsetIndex: targetOnset,
      sourceConfidence,
      targetConfidence,
      isDirectPropagation: false,
      usedBOCPD: useBOCPD,
    };
  }

  // Compute propagation delay
  const propagationDelay = targetOnset - sourceOnset;

  // Negative delay → causality is reversed or coincidental
  // (target anomaly appeared BEFORE source anomaly)
  if (propagationDelay < 0) {
    return {
      propagationProbability: 0,
      propagationDelay,
      sourceOnsetIndex: sourceOnset,
      targetOnsetIndex: targetOnset,
      sourceConfidence,
      targetConfidence,
      isDirectPropagation: false,
      usedBOCPD: useBOCPD,
    };
  }

  // Zero delay → same time step, likely coincident
  if (propagationDelay === 0) {
    return {
      propagationProbability: 0.1, // Small non-zero: possible zero-lag propagation
      propagationDelay: 0,
      sourceOnsetIndex: sourceOnset,
      targetOnsetIndex: targetOnset,
      sourceConfidence,
      targetConfidence,
      isDirectPropagation: false,
      usedBOCPD: useBOCPD,
    };
  }

  // Compute Gaussian kernel probability
  const sigma = expectedDirectLatency * latencyStddevMultiplier;
  const delayMatch = gaussianKernel(propagationDelay, expectedDirectLatency, sigma);

  // Combined probability
  const propagationProbability = Math.max(
    0,
    Math.min(1, delayMatch * sourceConfidence * targetConfidence),
  );

  // Direct propagation: Δt within 2σ of expected latency
  const isDirectPropagation = Math.abs(propagationDelay - expectedDirectLatency) <= 2 * sigma;

  return {
    propagationProbability,
    propagationDelay,
    sourceOnsetIndex: sourceOnset,
    targetOnsetIndex: targetOnset,
    sourceConfidence,
    targetConfidence,
    isDirectPropagation,
    usedBOCPD: useBOCPD,
  };
}
