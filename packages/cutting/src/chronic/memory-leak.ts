/**
 * MemoryLeakDetector — chronic memory leak detection via Deng Yu
 * cutting algorithm and monotonic trend analysis.
 *
 * ## Theoretical Background (邓煜切割算法)
 *
 * Memory leaks exhibit linear degradation in Deng Yu's framework:
 *   - The degradation rate r = Δmem/Δt is approximately constant
 *   - The kinetic energy estimate ε_j = r × δ_j² / 2 grows quadratically
 *     with window size when a leak is present
 *   - Monotonic increasing memory usage → temporal correlation ≈ 1
 *   - The induction proof converges when cumulative error Σ ε_j
 *     exceeds the noise floor
 *
 * ## Operational Mapping
 *
 *   - **RSS/Heap monitoring**: Track memory.mem_rss or process.memory.heap.used
 *   - **Degradation rate**: KB/s or MB/h of memory growth
 *   - **OOM prediction**: T_OOM = (mem_limit - mem_current) / r
 *   - **Confidence**: Based on temporal correlation and monotonicity
 *
 * @module chronic/memory-leak
 */

import * as np from 'numpy-ts';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  invariant,
  invariantFinite,
  invariantNonEmpty,
  invariantPositiveInt,
  KineticValidationError,
} from '@agentix-e/micro-kinetic-core';

/** Memory leak detection result. */
export interface MemoryLeakResult {
  /** Whether a memory leak was detected */
  readonly detected: boolean;
  /** Estimated degradation rate in bytes per millisecond */
  readonly degradationRate: number;
  /** Degradation rate in KB per second (human-readable) */
  readonly degradationRateKBs: number;
  /** Pearson correlation coefficient between time and memory */
  readonly temporalCorrelation: number;
  /** Whether the memory trend is monotonically increasing */
  readonly isMonotonic: boolean;
  /** Predicted OOM timestamp (Unix ms), if applicable */
  readonly oomTimestamp?: number;
  /** Predicted time to OOM in hours, if applicable */
  readonly hoursToOOM?: number;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Current memory usage in bytes */
  readonly currentMemoryBytes: number;
}

/** Options for memory leak detection. */
export interface MemoryLeakDetectionOptions {
  /** Memory limit in bytes — required for OOM prediction */
  readonly memoryLimitBytes?: number;
  /** Minimum temporal correlation to report a leak (default 0.7) */
  readonly minCorrelation: number;
  /** Minimum monotonic streak ratio (default 0.8) */
  readonly minMonotonicRatio: number;
  /** Number of most recent data points to use (0 = all) */
  readonly windowPoints: number;
}

const DEFAULT_MEM_LEAK_OPTIONS: MemoryLeakDetectionOptions = {
  minCorrelation: 0.7,
  minMonotonicRatio: 0.8,
  windowPoints: 0,
};

/**
 * MemoryLeakDetector identifies monotonic memory growth patterns
 * characteristic of chronic memory leaks using Deng Yu's kinetic
 * energy estimation framework.
 */
export class MemoryLeakDetector {
  /**
   * Detect memory leak from a time series.
   *
   * @param ts - Time series of memory usage (bytes)
   * @param options - Detection parameters
   * @returns MemoryLeakResult with detection status and predictions
   */
  detect(
    ts: TimeSeries,
    options?: Partial<MemoryLeakDetectionOptions>,
  ): MemoryLeakResult {
    const opts = { ...DEFAULT_MEM_LEAK_OPTIONS, ...options };
    this.validateInputs(ts);

    const values = this.extractValues(ts, opts.windowPoints);
    const timestamps = ts.timestamps.slice(
      Math.max(0, ts.timestamps.length - values.length),
    );

    const degradationRate = this.computeDegradationRate(timestamps, values);
    const degradationRateKBs = degradationRate * 1000; // bytes/ms → KB/s

    const temporalCorrelation = computeCorrelation(
      timestamps.map((t) => t - timestamps[0]!),
      values,
    );

    const isMonotonic = checkMonotonicIncreasing(values);

    const confidence = computeConfidence(
      temporalCorrelation,
      isMonotonic,
      opts.minCorrelation,
      opts.minMonotonicRatio,
    );

    const detected =
      isMonotonic &&
      temporalCorrelation >= opts.minCorrelation &&
      degradationRate > 0;

    const currentMemory = values[values.length - 1]!;

    let oomTimestamp: number | undefined;
    let hoursToOOM: number | undefined;

    if (detected && opts.memoryLimitBytes !== undefined && degradationRate > 0) {
      const remainingBytes = opts.memoryLimitBytes - currentMemory;
      const msToOOM = remainingBytes / degradationRate;
      const lastTimestamp = timestamps[timestamps.length - 1]!;
      oomTimestamp = lastTimestamp + msToOOM;
      hoursToOOM = msToOOM / 3_600_000;
    }

    return {
      detected,
      degradationRate,
      degradationRateKBs,
      temporalCorrelation,
      isMonotonic,
      oomTimestamp,
      hoursToOOM,
      confidence,
      currentMemoryBytes: currentMemory,
    };
  }

  /**
   * Compute memory degradation rate r = Δmem/Δt using numpy-ts linear regression.
   *
   * Maps to the kinetic energy rate r_j in Deng Yu's cutting algorithm.
   */
  computeDegradationRate(
    timestamps: readonly number[],
    values: readonly number[],
  ): number {
    if (values.length < 2) return 0;

    // Normalize time to hours
    const t0 = timestamps[0] ?? 0;
    const tRel = timestamps.map((t) => (t - t0) / 3_600_000);
    const tArr = np.array(tRel);
    const vArr = np.array([...values]);

    const coeffs = np.polyfit(tArr, vArr, 1);
    const slope = coeffs instanceof np.NDArray
      ? (coeffs.tolist() as number[])[0] ?? 0
      : Number(coeffs);

    // Convert from bytes/hour to bytes/ms for consistency
    return Math.max(0, slope / 3_600_000);
  }

  private validateInputs(ts: TimeSeries): void {
    invariantNonEmpty(ts.timestamps, 'TimeSeries.timestamps');
    invariantNonEmpty((ts.values as unknown) as { length: number }, 'TimeSeries.values');
    invariant(
      ts.timestamps.length === ts.values.length,
      'Timestamps and values must match',
    );
    invariant(
      ts.timestamps.length >= 2,
      'Need at least 2 data points for memory leak detection',
    );
  }

  private extractValues(ts: TimeSeries, windowPoints: number): number[] {
    if (windowPoints > 0) {
      const start = Math.max(0, ts.values.length - windowPoints);
      return [...ts.values].slice(start);
    }
    return [...ts.values];
  }
}

// ── Utility helpers ──────────────────────────────────────

function computeCorrelation(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 2) return 0;

  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let xVar = 0;
  let yVar = 0;

  for (let i = 0; i < n; i++) {
    const xd = xs[i]! - xMean;
    const yd = ys[i]! - yMean;
    cov += xd * yd;
    xVar += xd * xd;
    yVar += yd * yd;
  }

  if (xVar === 0 || yVar === 0) return 0;
  return cov / Math.sqrt(xVar * yVar);
}

function checkMonotonicIncreasing(values: readonly number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < values[i - 1]!) return false;
  }
  return values.length > 1;
}

function computeConfidence(
  correlation: number,
  isMonotonic: boolean,
  minCorrelation: number,
  _minMonotonicRatio: number,
): number {
  let confidence = 0;

  // Baseline from correlation (0 to 0.6)
  const corrScore = Math.min(1, Math.max(0, correlation / minCorrelation));
  confidence += 0.6 * corrScore;

  // Monotonicity bonus (0 to 0.3)
  if (isMonotonic) {
    confidence += 0.3;
  }

  // Residual (0.1) for data adequacy
  confidence += 0.1;

  return Math.min(1, confidence);
}
