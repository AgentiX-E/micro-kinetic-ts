/**
 * LocalErrorEstimator — kinetic energy-based local error bounds for
 * each cutting window.
 *
 * ## Theoretical Background (邓煜切割算法)
 *
 * In Deng Yu's kinetic theory, each cutting window [t_j, t_{j+1}]
 * has an associated local error estimate that bounds the maximum
 * deviation between the discrete approximation f^N(t) and the true
 * solution f(t):
 *
 *   |f^N(t) - f(t)| ≤ ε_j    for t ∈ [t_j, t_{j+1}]
 *
 * The error bound ε_j depends on the degradation type:
 *
 *   - **Linear degradation** (memory leak):
 *     ε_j = r_j × δ_j² / 2
 *     where r = Δmem/Δt (bytes/s)
 *
 *   - **Exponential degradation** (connection pool):
 *     ε_j = r_j × (exp(λ × δ_j) - λ × δ_j - 1) / λ²
 *     where λ is the growth rate
 *
 *   - **Power-law degradation** (data skew):
 *     ε_j = r_j × δ_j^α / (α × (α-1))
 *     where α is the power-law exponent
 *
 * Each bound is derived from the local kinetic energy estimate
 * in Deng Yu's H-theorem proof — the error is proportional to
 * the rate of change times the square of the time scale.
 *
 * @module convergence/local-estimator
 */

import * as np from 'numpy-ts';

import type {
  ChronicFaultIndicator,
  CuttingWindow,
  LocalErrorBound,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantFinite, invariantNonEmpty } from '@agentix-e/micro-kinetic-core';

/** Degradation types affecting error estimation. */
export enum DegradationType {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  POWER_LAW = 'power_law',
  LOGARITHMIC = 'logarithmic',
  UNKNOWN = 'unknown',
}

/** Configuration for local error estimation. */
export interface ErrorEstimatorConfig {
  /** Default degradation type assumption */
  readonly defaultType: DegradationType;
  /** Scaling constant C in ε = C × kinetic_energy */
  readonly scaleFactor: number;
  /** Minimum detectable degradation rate */
  readonly minDegradationRate: number;
}

/** Default error estimator configuration. */
export const DEFAULT_ERROR_ESTIMATOR_CONFIG: ErrorEstimatorConfig = {
  defaultType: DegradationType.LINEAR,
  scaleFactor: 1.0,
  minDegradationRate: 1e-6,
};

/**
 * LocalErrorEstimator computes local error bounds ε_j for each
 * cutting window using Deng Yu's kinetic energy estimation.
 */
export class LocalErrorEstimator {
  private readonly config: ErrorEstimatorConfig;

  constructor(config?: Partial<ErrorEstimatorConfig>) {
    this.config = { ...DEFAULT_ERROR_ESTIMATOR_CONFIG, ...config };
  }

  /**
   * Estimate local error bounds for a sequence of cutting windows.
   *
   * For each window, this:
   * 1. Attempts to classify the degradation type
   * 2. Fits the appropriate regression model using numpy-ts
   * 3. Computes the kinetic energy bound ε_j
   * 4. Generates chronic fault indicators
   *
   * @param windows - Pre-computed cutting windows
   * @param metric - Metric label
   * @returns Array of LocalErrorBound, one per window
   */
  estimateLocalBounds(windows: readonly CuttingWindow[], metric: string): LocalErrorBound[] {
    invariantNonEmpty(windows, 'windows');

    return windows.map((window, idx) => {
      const { degradationRate: rate, errorBound, indicators } = this.estimateWindow(window);

      return {
        windowIndex: idx,
        startTime: window.startTime,
        endTime: window.endTime,
        degradationRate: rate,
        errorBound,
        indicators,
      };
    });
  }

  /**
   * Estimate error bound for a single window.
   *
   * Detects degradation type and applies the appropriate kinetic
   * energy formula.
   */
  estimateWindow(window: CuttingWindow): {
    degradationRate: number;
    errorBound: number;
    indicators: ChronicFaultIndicator[];
  } {
    const degradationType = this.detectDegradationType(window.slice);
    const degradationRate = this.computeRate(window.slice, degradationType);
    const durationHours = window.duration / 3_600_000;

    const safeRate = Math.max(Math.abs(degradationRate), this.config.minDegradationRate);

    let errorBound: number;
    switch (degradationType) {
      case DegradationType.EXPONENTIAL:
        errorBound = computeExponentialErrorBound(safeRate, durationHours);
        break;
      case DegradationType.POWER_LAW:
        errorBound = computePowerLawErrorBound(safeRate, durationHours);
        break;
      default:
        errorBound = computeLinearErrorBound(safeRate, durationHours);
    }

    const indicators: ChronicFaultIndicator[] = [
      {
        metric: window.slice.label,
        degradationRate: safeRate,
        temporalCorrelation: computeTemporalCorrelation(
          [...window.slice.timestamps],
          [...window.slice.values],
        ),
        isMonotonic: isMonotonic([...window.slice.values]),
      },
    ];

    return { degradationRate: safeRate, errorBound, indicators };
  }

  /**
   * Detect the degradation type by fitting multiple models
   * and selecting the one with lowest residual error.
   *
   * Uses numpy-ts polyfit for the regression.
   */
  detectDegradationType(slice: TimeSeries): DegradationType {
    const n = slice.timestamps.length;
    if (n < 5) return DegradationType.LINEAR;

    const tRel = slice.timestamps.map((t) => (t - slice.timestamps[0]!) / 3_600_000);
    const values = [...slice.values];

    const tArr = np.array(tRel);

    // Try linear fit
    const vArr = np.array(values);
    const linCoeffs = np.polyfit(tArr, vArr, 1);
    const linPred = np.polyval(linCoeffs, tArr);
    const linResidual = computeMSE(values, linPred.tolist() as number[]);

    // Try exponential fit via log-transformed linear regression
    let expResidual = Infinity;
    const logValues = values.filter((v) => v > 0).map(Math.log);
    if (logValues.length >= 3) {
      const logArr = np.array(logValues);
      const tLogArr = np.array(tRel.slice(0, logValues.length));
      const expCoeffs = np.polyfit(tLogArr, logArr, 1);
      const expPred = np.polyval(expCoeffs, tLogArr);
      const expPredList = (expPred.tolist() as number[]).map(Math.exp);
      const actualSliced = values.slice(0, logValues.length);
      expResidual = computeMSE(actualSliced, expPredList);
    }

    // Try power-law fit via log-log linear regression
    let powResidual = Infinity;
    const posIndices = values.map((v, i) => (v > 0 && tRel[i]! > 0 ? i : -1)).filter((i) => i >= 0);
    if (posIndices.length >= 3) {
      const logT = posIndices.map((i) => Math.log(tRel[i]!));
      const logV = posIndices.map((i) => Math.log(values[i]!));
      const logTArr = np.array(logT);
      const logVArr = np.array(logV);
      const powCoeffs = np.polyfit(logTArr, logVArr, 1);
      const powPred = np.polyval(powCoeffs, logTArr);
      const powPredList = (powPred.tolist() as number[]).map(Math.exp);
      powResidual = computeMSE(
        posIndices.map((i) => values[i]!),
        powPredList,
      );
    }

    // Select model with lowest residual (favor simpler models)
    const LIN_BIAS = 0.95; // Slight preference for linear
    const EXP_BIAS = 1.0;
    const POW_BIAS = 1.0;

    const weightedLin = linResidual * LIN_BIAS;
    const weightedExp = expResidual * EXP_BIAS;
    const weightedPow = powResidual * POW_BIAS;

    const minResidual = Math.min(weightedLin, weightedExp, weightedPow);

    if (minResidual === weightedPow && powResidual !== Infinity) {
      return DegradationType.POWER_LAW;
    }
    if (minResidual === weightedExp && expResidual !== Infinity) {
      return DegradationType.EXPONENTIAL;
    }
    return DegradationType.LINEAR;
  }

  /**
   * Compute degradation rate for a given type using numpy-ts polyfit.
   */
  private computeRate(slice: TimeSeries, type: DegradationType): number {
    const tRel = slice.timestamps.map((t) => (t - slice.timestamps[0]!) / 3_600_000);
    const values = [...slice.values];

    if (values.length < 2) return 0;

    const tArr = np.array(tRel);

    let slope: number;

    switch (type) {
      case DegradationType.EXPONENTIAL: {
        const logValues = values.filter((v) => v > 0).map(Math.log);
        if (logValues.length < 2) return 0;
        const logArr = np.array(logValues);
        const tLogArr = np.array(tRel.slice(0, logValues.length));
        const coeffs = np.polyfit(tLogArr, logArr, 1);
        const slopePart = (coeffs.tolist() as number[])[0] ?? 0;
        // Convert log-slope to effective rate at window midpoint
        const lastVal = values[values.length - 1] ?? 1;
        slope = Math.abs(slopePart * lastVal);
        break;
      }
      case DegradationType.POWER_LAW: {
        const posIndices = values
          .map((v, i) => (v > 0 && tRel[i]! > 0 ? i : -1))
          .filter((i) => i >= 0);
        if (posIndices.length < 2) return 0;
        const logT = posIndices.map((i) => Math.log(tRel[i]!));
        const logV = posIndices.map((i) => Math.log(values[i]!));
        const logTArr = np.array(logT);
        const logVArr = np.array(logV);
        const coeffs = np.polyfit(logTArr, logVArr, 1);
        const exponent = (coeffs.tolist() as number[])[0] ?? 0;
        slope = Math.abs(exponent);
        break;
      }
      default: {
        const vArr = np.array(values);
        const coeffs = np.polyfit(tArr, vArr, 1);
        slope = (coeffs.tolist() as number[])[0]!;
        break;
      }
    }

    return Math.max(Math.abs(slope), this.config.minDegradationRate);
  }
}

/**
 * Compute linear kinetic energy bound (Deng Yu, H-theorem):
 *   ε_j = C × r_j × δ_j² / 2
 */
export function computeLinearErrorBound(rate: number, durationHours: number, scale = 1.0): number {
  invariantFinite(rate, 'rate');
  invariantFinite(durationHours, 'durationHours');
  return (scale * rate * durationHours * durationHours) / 2;
}

/**
 * Compute exponential error bound for connection pool exhaustion:
 *   ε_j = C × r_j × (exp(λ × δ) - λ × δ - 1) / λ²
 *
 * Using Taylor expansion for small arguments:
 *   ε_j ≈ C × r_j × δ² / 2 × (1 + λ×δ/3 + ...)
 *
 * @param rate - Effective degradation rate
 * @param durationHours - Window duration in hours
 * @param lambda - Growth rate parameter (default 0.5)
 */
export function computeExponentialErrorBound(
  rate: number,
  durationHours: number,
  lambda = 0.5,
  scale = 1.0,
): number {
  invariantFinite(rate, 'rate');
  invariantFinite(durationHours, 'durationHours');

  const x = lambda * durationHours;

  // For small x, use Taylor expansion to avoid numerical issues
  if (Math.abs(x) < 0.01) {
    // exp(x) ≈ 1 + x + x²/2 + x³/6
    // exp(x) - x - 1 ≈ x²/2 + x³/6
    const taylor = (x * x) / 2 + (x * x * x) / 6;
    return (scale * rate * taylor) / (lambda * lambda);
  }

  const expTerm = Math.exp(x);
  return (scale * rate * (expTerm - x - 1)) / (lambda * lambda);
}

/**
 * Compute power-law error bound for data skew:
 *   ε_j = C × r_j × δ_j^α / (α × (α - 1))
 *
 * where α is the power-law exponent (typically α > 1).
 *
 * @param rate - Effective degradation rate
 * @param durationHours - Window duration in hours
 * @param alpha - Power-law exponent (default 2.0)
 */
export function computePowerLawErrorBound(
  rate: number,
  durationHours: number,
  alpha = 2.0,
  scale = 1.0,
): number {
  invariantFinite(rate, 'rate');
  invariantFinite(durationHours, 'durationHours');
  invariant(alpha > 1, 'Power-law exponent must be > 1');

  const denominator = alpha * (alpha - 1);
  return (scale * rate * Math.pow(durationHours, alpha)) / denominator;
}

/**
 * Compute logarithmic error bound:
 *   ε_j = C × r_j × δ_j² × ln(1 + δ_j) / 2
 */
export function computeLogarithmicErrorBound(
  rate: number,
  durationHours: number,
  scale = 1.0,
): number {
  invariantFinite(rate, 'rate');
  invariantFinite(durationHours, 'durationHours');

  return (scale * rate * durationHours * durationHours * Math.log(1 + durationHours)) / 2;
}

// ── Utility helpers ──────────────────────────────────────

function computeMSE(actual: number[], predicted: number[]): number {
  const n = actual.length;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const diff = actual[i]! - predicted[i]!;
    sumSq += diff * diff;
  }
  return sumSq / n;
}

function computeTemporalCorrelation(
  timestamps: readonly number[],
  values: readonly number[],
): number {
  const n = timestamps.length;
  if (n < 2) return 0;

  const tMean = timestamps.reduce((a, b) => a + b, 0) / n;
  const vMean = values.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let tVar = 0;
  let vVar = 0;

  for (let i = 0; i < n; i++) {
    const td = timestamps[i]! - tMean;
    const vd = values[i]! - vMean;
    cov += td * vd;
    tVar += td * td;
    vVar += vd * vd;
  }

  const minComponent = Math.min(1, Math.max(0, Math.abs(cov / Math.sqrt(tVar * vVar))));
  return minComponent;
}

function isMonotonic(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
  }
  return values.length > 1;
}
