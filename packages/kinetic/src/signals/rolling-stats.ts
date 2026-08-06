/**
 * Rolling Statistics via Welford's Online Algorithm.
 *
 * Computes mean, variance, and standard deviation in a single pass
 * without storing the entire data series. O(n) time, O(1) memory.
 *
 * Welford, B. P. (1962). "Note on a method for calculating corrected
 * sums of squares and products." Technometrics 4(3):419-420.
 *
 * Used by the BOCPD onset detector and AutoSensitivity threshold
 * calculator to avoid quadratic memory cost on long metric histories.
 *
 * @module kinetic/signals/rolling-stats
 */

/**
 * Rolling statistics accumulator using Welford's online algorithm.
 *
 * Supports incremental observation feeding (addValue) and bulk
 * computation from an array (fromValues). The algorithm maintains:
 *   - count: number of observations
 *   - mean:  running arithmetic mean
 *   - M2:    sum of squared differences from current mean
 *   - min/max: extremal values (not from Welford, tracked separately)
 */
export class RollingStats {
  private _count = 0;
  private _mean = 0;
  private _m2 = 0;
  private _min = Infinity;
  private _max = -Infinity;

  /** Number of observations accumulated. */
  get count(): number {
    return this._count;
  }

  /** Running arithmetic mean. */
  get mean(): number {
    return this._mean;
  }

  /** Population variance (divides by N). */
  get variance(): number {
    if (this._count < 1) return 0;
    return this._m2 / this._count;
  }

  /** Sample variance (divides by N-1). For N < 2 returns 0. */
  get sampleVariance(): number {
    if (this._count < 2) return 0;
    return this._m2 / (this._count - 1);
  }

  /** Population standard deviation. */
  get stddev(): number {
    return Math.sqrt(this.variance);
  }

  /** Sample standard deviation. */
  get sampleStddev(): number {
    return Math.sqrt(this.sampleVariance);
  }

  /** Minimum value observed. */
  get min(): number {
    return this._min;
  }

  /** Maximum value observed. */
  get max(): number {
    return this._max;
  }

  /**
   * Add a single observation via Welford's online update.
   *
   * Numerical stability: Uses the stable formulation
   *   delta = x - mean
   *   mean += delta / count
   *   M2 += delta * (x - mean)
   */
  addValue(x: number): void {
    this._count++;
    const delta = x - this._mean;
    this._mean += delta / this._count;
    const delta2 = x - this._mean;
    this._m2 += delta * delta2;

    // Track extremal values
    if (x < this._min) this._min = x;
    if (x > this._max) this._max = x;
  }

  /**
   * Bulk-compute statistics from a numeric array.
   *
   * More efficient than calling addValue() in a loop because
   * Welford's algorithm is already O(n) — but this provides
   * convenience and ensures correct reset behavior.
   */
  static fromValues(values: Float64Array | number[]): RollingStats {
    const stats = new RollingStats();
    for (let i = 0; i < values.length; i++) {
      stats.addValue(values[i]!);
    }
    return stats;
  }

  /**
   * Compute median of a numeric array.
   *
   * Sorts a copy in-place. O(n log n) time, O(n) memory.
   * For large streaming contexts, consider approximate median methods.
   */
  static median(values: Float64Array | number[]): number {
    if (values.length === 0) return 0;
    const sorted = Float64Array.from(values).sort();
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    return sorted[mid]!;
  }

  /**
   * Compute Median Absolute Deviation (MAD) of a numeric array.
   *
   * MAD = median(|x_i - median(x)|)
   *
   * MAD is a robust measure of dispersion suitable for anomaly
   * detection because it tolerates up to 50% contamination before
   * breaking down (breakdown point = 0.5).
   *
   * The constant scaling factor 1.4826 makes MAD a consistent
   * estimator for the standard deviation under normality.
   * Raw MAD: divide by this factor to get unscaled MAD.
   */
  static mad(
    values: Float64Array | number[],
    scaled = true,
  ): { mad: number; median: number } {
    if (values.length === 0) return { mad: 0, median: 0 };

    const med = RollingStats.median(values);
    const absDeviations = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) {
      absDeviations[i] = Math.abs(values[i]! - med);
    }

    const rawMad = RollingStats.median(absDeviations);
    return {
      mad: scaled ? rawMad * 1.4826 : rawMad,
      median: med,
    };
  }

  /** Reset all accumulators. */
  reset(): void {
    this._count = 0;
    this._mean = 0;
    this._m2 = 0;
    this._min = Infinity;
    this._max = -Infinity;
  }
}
