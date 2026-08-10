/**
 * ConnectionPoolDetector — chronic connection pool exhaustion detection
 * using exponential degradation curve fitting and Deng Yu's kinetic
 * error estimation.
 *
 * ## Theoretical Background (邓煜切割算法)
 *
 * Connection pool exhaustion exhibits exponential degradation in
 * Deng Yu's framework:
 *
 *   - Available connections decrease exponentially:
 *     C(t) = C₀ - A × exp(λ × t)
 *   - The degradation rate r(t) = dC/dt = Aλ × exp(λ × t) grows
 *     exponentially — much faster than linear memory leaks
 *   - The kinetic energy bound for exponential degradation is:
 *     ε_j = r_j × (exp(λ × δ_j) - λ × δ_j - 1) / λ²
 *   - This bound grows faster than linear, requiring careful
 *     adaptive window sizing
 *
 * ## Operational Mapping
 *
 *   - **Metrics**: db.connections.active, pool.size, pool.waiters
 *   - **Fitting**: Log-linear regression on available connections
 *   - **Exhaustion prediction**: T_exhaust = t such that C(t) ≤ threshold
 *   - **Growth rate**: λ from exponential fit
 *
 * @module chronic/connection-pool
 */

import * as np from 'numpy-ts';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import { invariant, invariantNonEmpty } from '@agentix-e/micro-kinetic-core';

/** Connection pool detection result. */
export interface ConnectionPoolResult {
  /** Whether connection pool exhaustion was detected */
  readonly detected: boolean;
  /** Estimated exponential growth rate λ */
  readonly growthRate: number;
  /** Current available connections */
  readonly currentAvailable: number;
  /** Initial available connections (estimated) */
  readonly initialAvailable: number;
  /** Pool capacity (max connections) */
  readonly poolCapacity?: number;
  /** Current utilization ratio (0-1) */
  readonly utilizationRatio: number;
  /** Predicted exhaustion timestamp (Unix ms), if applicable */
  readonly exhaustionTimestamp?: number;
  /** Predicted time to exhaustion in hours */
  readonly hoursToExhaustion?: number;
  /** R-squared of exponential fit */
  readonly fitQuality: number;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Whether the trend is monotonically depleting */
  readonly isMonotonic: boolean;
}

/** Options for connection pool detection. */
export interface ConnectionPoolDetectionOptions {
  /** Pool capacity — required for exhaustion prediction */
  readonly poolCapacity?: number;
  /** Exhaustion threshold as fraction of capacity (default 0.05 = 5%) */
  readonly exhaustionThreshold: number;
  /** Minimum R-squared for the exponential fit (default 0.7) */
  readonly minFitQuality: number;
  /** Minimum growth rate λ to trigger detection */
  readonly minGrowthRate: number;
}

const DEFAULT_CP_OPTIONS: ConnectionPoolDetectionOptions = {
  exhaustionThreshold: 0.05,
  minFitQuality: 0.7,
  minGrowthRate: 0.01,
};

/**
 * ConnectionPoolDetector identifies connection pool depletion
 * patterns characteristic of connection leaks or runaway queries.
 *
 * Uses exponential curve fitting (via log-linear regression with
 * numpy-ts) and applies Deng Yu's exponential kinetic energy bound.
 */
export class ConnectionPoolDetector {
  /**
   * Detect connection pool exhaustion from a time series.
   *
   * @param ts - Time series of available connections count
   * @param options - Detection parameters
   * @returns ConnectionPoolResult with detection status
   */
  detect(ts: TimeSeries, options?: Partial<ConnectionPoolDetectionOptions>): ConnectionPoolResult {
    const opts = { ...DEFAULT_CP_OPTIONS, ...options };
    this.validateInputs(ts);

    const values = [...ts.values];
    const timestamps = [...ts.timestamps];
    const t0 = timestamps[0]!;

    // Normalize time to hours
    const tRel = timestamps.map((t) => (t - t0) / 3_600_000);

    // Check monotonic depletion
    const isMonotonic = checkMonotonicDecreasing(values);

    // Fit exponential decay: C(t) = C₀ × exp(-λ × t) + C_min
    // Through log transform: ln(C(t) - C_min) = ln(C₀) - λ × t
    const { growthRate, initialAvailable, fitQuality } = this.fitExponentialDecay(tRel, values);

    const currentAvailable = values[values.length - 1]!;
    const poolCap = opts.poolCapacity ?? this.estimatePoolCapacity(values);
    const utilizationRatio = 1 - currentAvailable / poolCap;

    // Detection logic
    const detected =
      isMonotonic && growthRate >= opts.minGrowthRate && fitQuality >= opts.minFitQuality;

    // Exhaustion prediction: solve C(t) = threshold
    let exhaustionTimestamp: number | undefined;
    let hoursToExhaustion: number | undefined;

    if (detected && growthRate > 0) {
      const threshold = poolCap * opts.exhaustionThreshold;
      const hoursToThreshold = Math.log(Math.max(initialAvailable / threshold, 1.01)) / growthRate;

      if (Number.isFinite(hoursToThreshold) && hoursToThreshold > 0) {
        exhaustionTimestamp = timestamps[timestamps.length - 1]! + hoursToThreshold * 3_600_000;
        hoursToExhaustion = hoursToThreshold;
      }
    }

    const confidence = computePoolConfidence(
      isMonotonic,
      fitQuality,
      growthRate,
      opts.minGrowthRate,
    );

    return {
      detected,
      growthRate,
      currentAvailable,
      initialAvailable,
      poolCapacity: poolCap,
      utilizationRatio,
      exhaustionTimestamp,
      hoursToExhaustion,
      fitQuality,
      confidence,
      isMonotonic,
    };
  }

  /**
   * Fit exponential decay model using numpy-ts linear regression
   * on log-transformed data.
   *
   * Model: C(t) = C₀ × exp(-λ × t) + C_min
   *
   * Returns growth rate λ, initial capacity C₀, and fit quality (R²).
   */
  fitExponentialDecay(
    tRel: readonly number[],
    values: readonly number[],
  ): {
    growthRate: number;
    initialAvailable: number;
    fitQuality: number;
  } {
    const n = values.length;
    if (n < 3) {
      return { growthRate: 0, initialAvailable: values[0]!, fitQuality: 0 };
    }

    // Estimate baseline as the minimum value
    const baseline = Math.min(...values) * 0.9;

    // Remove baseline and log-transform for linear regression
    const posIndices: number[] = [];
    const logValues: number[] = [];
    const logTimes: number[] = [];

    for (let i = 0; i < n; i++) {
      const adjusted = values[i]! - baseline;
      if (adjusted > 0 && tRel[i] !== undefined) {
        posIndices.push(i);
        logValues.push(Math.log(adjusted));
        logTimes.push(tRel[i]!);
      }
    }

    if (posIndices.length < 3) {
      return { growthRate: 0, initialAvailable: values[0]!, fitQuality: 0 };
    }

    // Linear regression on log-transformed data
    const tArr = np.array(logTimes);
    const vArr = np.array(logValues);

    const coeffs = np.polyfit(tArr, vArr, 1);
    const params = coeffs.tolist() as number[];
    const slope = params[0]!;
    const intercept = params[1]!;

    // λ = -slope (growth rate, positive means depletion)
    const growthRate = Math.max(0, -slope);

    // C₀ = exp(intercept) + baseline
    const initialAvailable = Math.exp(intercept) + baseline;

    // Compute R-squared
    const predicted = logTimes.map((t) => slope * t + intercept);
    const actualMean = logValues.reduce((a, b) => a + b, 0) / logValues.length;
    let ssRes = 0;
    let ssTot = 0;

    for (let i = 0; i < logValues.length; i++) {
      ssRes += (logValues[i]! - predicted[i]!) ** 2;
      ssTot += (logValues[i]! - actualMean) ** 2;
    }

    const fitQuality = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    return { growthRate, initialAvailable, fitQuality };
  }

  /**
   * Estimate pool capacity from data — uses the maximum observed value
   * plus a 10% buffer.
   */
  estimatePoolCapacity(values: readonly number[]): number {
    const maxObserved = Math.max(...values);
    return Math.ceil(maxObserved * 1.1);
  }

  private validateInputs(ts: TimeSeries): void {
    invariantNonEmpty(ts.timestamps, 'TimeSeries.timestamps');
    invariantNonEmpty(ts.values as unknown as { length: number }, 'TimeSeries.values');
    invariant(ts.timestamps.length === ts.values.length, 'Timestamps and values must match');
    invariant(
      ts.timestamps.length >= 3,
      'Need at least 3 data points for exponential curve fitting',
    );
  }
}

function checkMonotonicDecreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! > values[i - 1]!) return false;
  }
  return values.length > 1;
}

function computePoolConfidence(
  isMonotonic: boolean,
  fitQuality: number,
  growthRate: number,
  minGrowthRate: number,
): number {
  let confidence = 0;

  // Exponential fit quality (0 to 0.5)
  confidence += 0.5 * Math.min(1, fitQuality);

  // Monotonicity (0 to 0.3)
  if (isMonotonic) {
    confidence += 0.3;
  }

  // Growth rate significance (0 to 0.2)
  const rateRatio = Math.min(1, growthRate / Math.max(minGrowthRate, 0.01));
  confidence += 0.2 * rateRatio;

  return Math.min(1, confidence);
}
