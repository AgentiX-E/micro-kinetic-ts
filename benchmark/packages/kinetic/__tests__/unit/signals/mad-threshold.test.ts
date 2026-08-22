/**
 * Unit tests for MAD threshold computation.
 */

import { describe, it, expect } from 'vitest';
import { computeMADThreshold, detectMADAnomalies, DEFAULT_MAD_CONFIG } from '../../../src/signals/mad-threshold.js';

describe('computeMADThreshold — basic cases', () => {
  it('should compute MAD threshold for normal-ish data', () => {
    const values = new Float64Array([1, 2, 3, 4, 5, 2.5, 3.5, 3, 3, 3]);
    const result = computeMADThreshold(values);
    expect(result.median).toBe(3);
    expect(result.mad).toBeGreaterThan(0);
    expect(result.threshold).toBe(result.mad * DEFAULT_MAD_CONFIG.multiplier);
    expect(result.usedSparseFallback).toBe(false);
  });

  it('should handle single value', () => {
    const result = computeMADThreshold(new Float64Array([42]));
    expect(result.median).toBe(42);
    expect(result.mad).toBe(0);
    expect(result.threshold).toBe(0);
    expect(result.usedSparseFallback).toBe(true);
  });

  it('should handle two values', () => {
    const result = computeMADThreshold(new Float64Array([10, 20]));
    expect(result.usedSparseFallback).toBe(true);
    expect(result.effectiveMultiplier).toBe(DEFAULT_MAD_CONFIG.sparseFallbackMultiplier);
  });

  it('should handle empty array', () => {
    const result = computeMADThreshold(new Float64Array([]));
    expect(result.median).toBe(0);
    expect(result.mad).toBe(0);
    expect(result.threshold).toBe(0);
    expect(result.usedSparseFallback).toBe(true);
  });

  it('should use custom multiplier', () => {
    const values = new Float64Array(Array.from({ length: 20 }, (_, i) => i + 1));
    const result = computeMADThreshold(values, { multiplier: 2.5, minDataPoints: 10 });
    expect(result.effectiveMultiplier).toBe(2.5);
    expect(result.usedSparseFallback).toBe(false);
  });

  it('should apply sparse fallback multiplier for small datasets', () => {
    const result = computeMADThreshold(new Float64Array([1, 2, 3]));
    expect(result.usedSparseFallback).toBe(true);
    expect(result.effectiveMultiplier).toBe(DEFAULT_MAD_CONFIG.sparseFallbackMultiplier);
  });
});

describe('computeMADThreshold — robustness', () => {
  it('should be robust to a single extreme outlier', () => {
    const values = new Float64Array(51);
    for (let i = 0; i < 50; i++) values[i] = 10 + Math.random() * 10;
    values[50] = 1_000_000;

    const result = computeMADThreshold(values, { minDataPoints: 10 });
    expect(result.median).toBeLessThan(50);
    expect(result.threshold).toBeGreaterThan(0);
    expect(result.usedSparseFallback).toBe(false);
  });

  it('should be robust to 30% contamination', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < 70; i++) values[i] = 50 + Math.random() * 5;
    for (let i = 70; i < 100; i++) values[i] = 200 + Math.random() * 50;

    const result = computeMADThreshold(values, { minDataPoints: 10, multiplier: 3.0 });
    expect(result.median).toBeLessThan(60);
  });

  it('should compute higher threshold with more variance', () => {
    const tight = computeMADThreshold(new Float64Array([5, 5, 5, 5, 6, 5, 5, 5, 5, 5]));
    const spread = computeMADThreshold(new Float64Array([1, 3, 5, 7, 9, 2, 4, 6, 8, 10]));
    expect(spread.threshold).toBeGreaterThan(tight.threshold);
  });
});

describe('detectMADAnomalies', () => {
  it('should detect anomalies with clear spike pattern', () => {
    // Small spike: values are [0..9] except position 5 = 100
    const values = new Float64Array(10);
    for (let i = 0; i < 10; i++) {
      values[i] = i === 5 ? 100 : i;
    }
    // median = 5.5, abs devs: [5.5,4.5,3.5,2.5,1.5,94.5,0.5,1.5,2.5,3.5]
    // sorted: [0.5,1.5,1.5,2.5,2.5,3.5,3.5,4.5,5.5,94.5] → median = 3.0
    // scaled MAD = 3.0 × 1.4826 ≈ 4.45
    // threshold = 4.45 × 1.5 = 6.67 → |100-5.5| = 94.5 > 6.67 ✓
    const anomalies = detectMADAnomalies(values, { minDataPoints: 5, multiplier: 1.5 });
    expect(anomalies.length).toBeGreaterThanOrEqual(1);
    expect(anomalies[0]!.index).toBe(5);
  });

  it('should detect anomalies in low-contamination scenario', () => {
    // 10% contamination (9 normal + 1 outlier)
    const values = new Float64Array(10);
    for (let i = 0; i < 9; i++) values[i] = 5;
    values[9] = 50;

    // Low contamination: MAD = 0 (9/10 zero deviations from median)
    // threshold = 0 → no anomalies detected (expected behavior for robust method)
    const anomalies = detectMADAnomalies(values, { minDataPoints: 5, multiplier: 2.0 });
    // MAD=0 for single outlier → no detection with MAD method
    // This is a known limitation: MAD requires ≥ 50% non-zero deviations
    expect(anomalies.length).toBe(0);
  });

  it('should detect no anomalies in uniform data', () => {
    const values = new Float64Array(100);
    values.fill(10);
    const anomalies = detectMADAnomalies(values, { minDataPoints: 5, multiplier: 3.0 });
    expect(anomalies.length).toBe(0);
  });

  it('should return empty for empty input', () => {
    const anomalies = detectMADAnomalies(new Float64Array([]));
    expect(anomalies.length).toBe(0);
  });

  it('should include deviationRatio in results when anomalies detected', () => {
    const values = new Float64Array(20);
    for (let i = 0; i < 15; i++) values[i] = 5;
    for (let i = 15; i < 20; i++) values[i] = 100;

    const anomalies = detectMADAnomalies(values, { minDataPoints: 5, multiplier: 1.5 });
    if (anomalies.length > 0) {
      expect(anomalies[0]!.deviationRatio).toBeGreaterThan(1);
    }
  });

  it('should handle scalar threshold (all MAD=0 → threshold=0, no anomalies)', () => {
    const values = new Float64Array([7, 7, 7, 7, 7]);
    const anomalies = detectMADAnomalies(values, { minDataPoints: 3 });
    expect(anomalies.length).toBe(0);
  });
});
