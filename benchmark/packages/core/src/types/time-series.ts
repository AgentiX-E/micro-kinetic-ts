/**
 * Time series and cutting algorithm types.
 *
 * These map to Deng Yu's cutting algorithm in kinetic theory:
 * - Long-time interval [0, T] → segmented into N short windows
 * - Local error estimation → kinetic energy bounds per window
 * - Inductive proof → global convergence guarantee
 *
 * @module types/time-series
 */

/** A single time series data stream. */
export interface TimeSeries {
  /** Metric label (e.g. "cpu_usage", "mem_rss") */
  readonly label: string;
  /** Unix timestamps in milliseconds */
  readonly timestamps: readonly number[];
  /** Metric values aligned with timestamps */
  readonly values: Float64Array;
  /** Unit of measurement */
  readonly unit: string;
}

/** A snapshot of all metrics for a service at a given time. */
export interface MetricSnapshot {
  readonly serviceId: string;
  readonly timestamp: number;
  /** Metric name → value map */
  readonly metrics: Readonly<Record<string, number>>;
}

/**
 * A single cutting window — maps to one segment [t_j, t_{j+1}]
 * in Deng Yu's cutting algorithm.
 */
export interface CuttingWindow {
  /** Zero-based index in the cutting schedule */
  readonly index: number;
  /** Start time (Unix ms) */
  readonly startTime: number;
  /** End time (Unix ms) */
  readonly endTime: number;
  /** Duration in milliseconds */
  readonly duration: number;
  /** Data slice within this window */
  readonly slice: TimeSeries;
  /**
   * Estimated degradation rate within this window.
   * For memory leaks: r ≈ Δmem/Δt (bytes/ms)
   */
  readonly degradationRate: number;
  /**
   * Local error bound — kinetic energy estimate.
   * In Deng Yu's theory: |f^N(t) - f(t)| ≤ ε_j
   */
  readonly localErrorBound: number;
}

/** Options controlling the cutting algorithm. */
export interface CuttingOptions {
  /** Maximum number of windows N (T → N segments) */
  readonly maxWindows: number;
  /** Minimum window duration in milliseconds */
  readonly minWindowDurationMs: number;
  /** Enable adaptive window sizing based on degradation rate variance */
  readonly adaptive: boolean;
}

/** Default cutting options. */
export const DEFAULT_CUTTING_OPTIONS: CuttingOptions = {
  maxWindows: 100,
  minWindowDurationMs: 60_000, // 1 minute
  adaptive: true,
};

/** Quality metrics for a cutting schedule. */
export interface CuttingQualityMetrics {
  /** Normalized entropy (lower = more uniform windows) */
  readonly entropy: number;
  /** Maximum local error across all windows */
  readonly maxLocalError: number;
  /** Convergence rate: average error reduction per window */
  readonly convergenceRate: number;
}

/** Complete cutting schedule with convergence analysis. */
export interface CuttingSchedule {
  /** Total time span in milliseconds */
  readonly totalDuration: number;
  /** Sequence of cutting windows */
  readonly windows: readonly CuttingWindow[];
  /** Whether the schedule satisfies global convergence */
  readonly converged: boolean;
  /** Upper bound on convergence time (Unix ms), if converged */
  readonly convergenceTimeUpperBound?: number;
  /** Quality metrics */
  readonly quality: CuttingQualityMetrics;
}
