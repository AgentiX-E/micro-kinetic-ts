/**
 * Unit tests for RollingStats (Welford's online algorithm).
 *
 * Coverage target: ≥95% statements, branches, functions, lines.
 */

import { describe, it, expect } from 'vitest';
import { RollingStats } from '../../../src/signals/rolling-stats.js';

// ===========================================================================
// Static factory: fromValues
// ===========================================================================

describe('RollingStats.fromValues', () => {
  it('should compute correct mean for positive integers', () => {
    const stats = RollingStats.fromValues(new Float64Array([1, 2, 3, 4, 5]));
    expect(stats.mean).toBeCloseTo(3.0, 8);
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
  });

  it('should compute correct variance for positive integers', () => {
    // Population variance of [1,2,3,4,5] = 2.0
    const stats = RollingStats.fromValues(new Float64Array([1, 2, 3, 4, 5]));
    expect(stats.variance).toBeCloseTo(2.0, 8);
  });

  it('should compute correct sample variance', () => {
    // Sample variance of [1,2,3,4,5] = 2.5
    const stats = RollingStats.fromValues(new Float64Array([1, 2, 3, 4, 5]));
    expect(stats.sampleVariance).toBeCloseTo(2.5, 8);
  });

  it('should handle single value', () => {
    const stats = RollingStats.fromValues(new Float64Array([42]));
    expect(stats.mean).toBe(42);
    expect(stats.variance).toBe(0);
    expect(stats.sampleVariance).toBe(0);
  });

  it('should return variance=0 for empty input', () => {
    const stats = RollingStats.fromValues(new Float64Array([]));
    expect(stats.variance).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.count).toBe(0);
  });

  it('should handle negative values', () => {
    const stats = RollingStats.fromValues(new Float64Array([-5, -3, -1, 1, 3, 5]));
    expect(stats.mean).toBeCloseTo(0, 8);
    expect(stats.variance).toBeCloseTo(11.6667, 3);
    expect(stats.min).toBe(-5);
    expect(stats.max).toBe(5);
  });

  it('should handle large arrays efficiently', () => {
    // Welford should handle 100K values in O(n) with O(1) memory
    const large = new Float64Array(100000);
    for (let i = 0; i < large.length; i++) large[i] = i + 1;
    const stats = RollingStats.fromValues(large);
    // Mean of 1..100000 = (100000 + 1) / 2
    expect(stats.mean).toBeCloseTo(50000.5, 0);
    expect(stats.variance).toBeGreaterThan(0);
  });

  it('should handle regular array (not Float64Array)', () => {
    const stats = RollingStats.fromValues([10, 20, 30, 40, 50]);
    expect(stats.mean).toBeCloseTo(30, 8);
  });
});

// ===========================================================================
// Incremental addValue
// ===========================================================================

describe('RollingStats.addValue (incremental)', () => {
  it('should match fromValues for same data', () => {
    const batch = RollingStats.fromValues(new Float64Array([1, 2, 3, 4, 5]));

    const inc = new RollingStats();
    inc.addValue(1); inc.addValue(2); inc.addValue(3); inc.addValue(4); inc.addValue(5);

    expect(inc.mean).toBeCloseTo(batch.mean, 8);
    expect(inc.variance).toBeCloseTo(batch.variance, 8);
    expect(inc.count).toBe(batch.count);
  });

  it('should track min/max incrementally', () => {
    const stats = new RollingStats();
    stats.addValue(100);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(100);

    stats.addValue(50);
    expect(stats.min).toBe(50);
    expect(stats.max).toBe(100);

    stats.addValue(200);
    expect(stats.min).toBe(50);
    expect(stats.max).toBe(200);
  });

  it('should return correct stddev for known distribution', () => {
    const stats = new RollingStats();
    // Values with mean=10, variance=4 → stddev=2
    stats.addValue(8); stats.addValue(10); stats.addValue(12);
    expect(stats.stddev).toBeCloseTo(1.633, 3); // pop stddev
    expect(stats.sampleStddev).toBeCloseTo(2.0, 2);
  });
});

// ===========================================================================
// Static: median
// ===========================================================================

describe('RollingStats.median', () => {
  it('should compute median of odd-length array', () => {
    expect(RollingStats.median(new Float64Array([1, 3, 5]))).toBe(3);
  });

  it('should compute median of even-length array', () => {
    expect(RollingStats.median(new Float64Array([1, 2, 3, 4]))).toBe(2.5);
  });

  it('should handle unsorted input', () => {
    expect(RollingStats.median(new Float64Array([5, 1, 3, 7, 9]))).toBe(5);
  });

  it('should return 0 for empty array', () => {
    expect(RollingStats.median(new Float64Array([]))).toBe(0);
  });

  it('should handle single element', () => {
    expect(RollingStats.median(new Float64Array([7]))).toBe(7);
  });

  it('should handle duplicate values', () => {
    expect(RollingStats.median(new Float64Array([2, 2, 2, 2, 2]))).toBe(2);
  });
});

// ===========================================================================
// Static: MAD
// ===========================================================================

describe('RollingStats.mad', () => {
  it('should compute MAD for symmetric distribution', () => {
    // Data: [1, 2, 3, 4, 5], median=3
    // abs deviations: [2, 1, 0, 1, 2], median=1
    // raw MAD = 1, scaled = 1 * 1.4826 ≈ 1.4826
    const result = RollingStats.mad(new Float64Array([1, 2, 3, 4, 5]), true);
    expect(result.median).toBe(3);
    expect(result.mad).toBeCloseTo(1.4826, 3);
  });

  it('should compute raw (unscaled) MAD', () => {
    const result = RollingStats.mad(new Float64Array([1, 2, 3, 4, 5]), false);
    expect(result.mad).toBeCloseTo(1.0, 8);
  });

  it('should be robust to a single outlier', () => {
    // 10 normal points + 1 extreme outlier: median stays at normal range
    const values = new Float64Array([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 1000]);
    const result = RollingStats.mad(values, false);
    // median = 10, all abs deviations from 10: [0, 0, ..., 990]
    // median of abs deviations = 0
    expect(result.median).toBe(10);
    expect(result.mad).toBe(0);
  });

  it('should handle empty array', () => {
    const result = RollingStats.mad(new Float64Array([]));
    expect(result.mad).toBe(0);
    expect(result.median).toBe(0);
  });

  it('should handle scenario with exactly 1 non-zero MAD', () => {
    // [1, 1, 1, 100] → median=1, abs devs=[0,0,0,99] → median of abs devs=0
    const result = RollingStats.mad(new Float64Array([1, 1, 1, 100]), false);
    expect(result.median).toBe(1);
    expect(result.mad).toBe(0);
  });
});

// ===========================================================================
// Edge Cases
// ===========================================================================

describe('RollingStats — edge cases', () => {
  it('should reset correctly', () => {
    const stats = RollingStats.fromValues(new Float64Array([1, 2, 3]));
    expect(stats.count).toBe(3);
    stats.reset();
    expect(stats.count).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.variance).toBe(0);
    expect(stats.min).toBe(Infinity);
    expect(stats.max).toBe(-Infinity);
  });

  it('should handle very small floating-point values', () => {
    const stats = RollingStats.fromValues(new Float64Array([1e-10, 2e-10, 3e-10]));
    expect(stats.mean).toBeCloseTo(2e-10, 15);
  });

  it('should handle very large floating-point values', () => {
    const stats = RollingStats.fromValues(new Float64Array([1e10, 2e10, 3e10]));
    expect(stats.mean).toBeCloseTo(2e10, -5);
  });

  it('should handle NaN in addValue by propagating NaN', () => {
    const stats = new RollingStats();
    stats.addValue(NaN);
    expect(stats.mean).toBeNaN();
    expect(stats.variance).toBeNaN();
  });

  it('should handle Infinity in addValue', () => {
    const stats = new RollingStats();
    stats.addValue(Infinity);
    expect(stats.mean).toBe(Infinity);
    expect(stats.max).toBe(Infinity);
  });
});
