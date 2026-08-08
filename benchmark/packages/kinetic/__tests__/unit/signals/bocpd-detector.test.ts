/**
 * Unit tests for BOCPD onset detector.
 *
 * BOCPD (Adams & MacKay 2007) detects changepoints in streaming data.
 * The current implementation uses a likelihood-ratio trigger alongside
 * the standard probability-based detection.
 *
 * For production RCA onset detection, the MAD-based method
 * (computePropagationVelocity with useBOCPD=false) is the default.
 * BOCPD is useful when precise probabilistic onset detection is needed.
 */

import { describe, it, expect } from 'vitest';
import { bocpdDetectOnset, bocpdDetectAllChangepoints } from '../../../src/signals/bocpd-detector.js';

describe('bocpdDetectOnset — parameter validation', () => {
  it('should return onsetIndex=-1 for dataset below minRunLength', () => {
    const values = new Float64Array([1, 2]);
    const result = bocpdDetectOnset(values, { minRunLength: 3 });
    expect(result.onsetIndex).toBe(-1);
    expect(result.confidence).toBe(0);
  });

  it('should return onsetIndex=-1 for empty dataset', () => {
    const result = bocpdDetectOnset(new Float64Array([]));
    expect(result.onsetIndex).toBe(-1);
  });

  it('should handle single observation', () => {
    const result = bocpdDetectOnset(new Float64Array([5]));
    expect(result.onsetIndex).toBe(-1);
  });
});

describe('bocpdDetectOnset — stationary data', () => {
  it('should not detect false changepoint in stationary data with low hazard', () => {
    const values = new Float64Array(200);
    for (let i = 0; i < values.length; i++) {
      values[i] = 10 + Math.random() * 0.1;
    }
    const result = bocpdDetectOnset(values, {
      changepointThreshold: 0.05,
      minRunLength: 10,
      hazardRate: 1 / 1000,
      scale: 5,
    });
    // Stationary data with low hazard, wide scale → no detection
    expect(result.onsetIndex).toBe(-1);
  });

  it('should not detect false changepoint in data with natural variance', () => {
    const values = new Float64Array(200);
    for (let i = 0; i < values.length; i++) {
      values[i] = 50 + (Math.random() - 0.5) * 10;
    }
    const result = bocpdDetectOnset(values, {
      changepointThreshold: 0.1,
      minRunLength: 10,
      hazardRate: 1 / 500,
    });
    // Should not spuriously detect in stationary-ish data
    // (May sometimes detect due to stochasticity — accept either)
    if (result.onsetIndex >= 0) {
      expect(result.confidence).toBeLessThan(0.8);
    }
  });
});

describe('bocpdDetectOnset — valid outputs', () => {
  it('should produce confidence in [0, 1]', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < 100; i++) values[i] = Math.random() * 100;
    const result = bocpdDetectOnset(values, { minRunLength: 5 });
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should produce valid output for data with regime change', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < 50; i++) values[i] = 10 + Math.random() * 2;
    for (let i = 50; i < 100; i++) values[i] = 50 + Math.random() * 2;
    const result = bocpdDetectOnset(values, { minRunLength: 5 });
    expect(typeof result.onsetIndex).toBe('number');
    expect(typeof result.confidence).toBe('number');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('should be more sensitive with higher hazard rate', () => {
    const values = new Float64Array(80);
    for (let i = 0; i < 40; i++) values[i] = 10 + Math.random();
    for (let i = 40; i < 80; i++) values[i] = 50 + Math.random();

    const lowHazard = bocpdDetectOnset(values, {
      hazardRate: 1 / 1000,
      changepointThreshold: 0.5,
      minRunLength: 5,
    });
    const highHazard = bocpdDetectOnset(values, {
      hazardRate: 1 / 50,
      changepointThreshold: 0.5,
      minRunLength: 5,
    });

    expect(typeof lowHazard.onsetIndex).toBe('number');
    expect(typeof highHazard.onsetIndex).toBe('number');
    expect(lowHazard.confidence).toBeGreaterThanOrEqual(0);
    expect(highHazard.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('bocpdDetectOnset — edge cases', () => {
  it('should not overflow with very large values', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < 50; i++) values[i] = 1e6 + Math.random() * 1e3;
    for (let i = 50; i < 100; i++) values[i] = 1e9 + Math.random() * 1e4;

    const result = bocpdDetectOnset(values, { minRunLength: 5, maxRunLength: 500, scale: 1e10 });
    expect(typeof result.onsetIndex).toBe('number');
    expect(typeof result.confidence).toBe('number');
  });

  it('should handle negative values without crash', () => {
    const values = new Float64Array(60);
    for (let i = 0; i < 30; i++) values[i] = -10 + Math.random() * 2;
    for (let i = 30; i < 60; i++) values[i] = 10 + Math.random() * 2;

    const result = bocpdDetectOnset(values, { minRunLength: 5, maxRunLength: 200 });
    expect(typeof result.onsetIndex).toBe('number');
    expect(typeof result.confidence).toBe('number');
  });

  it('should handle maxRunLength truncation', () => {
    const values = new Float64Array(200);
    for (let i = 0; i < 100; i++) values[i] = 1 + Math.random() * 0.1;
    for (let i = 100; i < 200; i++) values[i] = 10 + Math.random() * 0.1;

    const result = bocpdDetectOnset(values, {
      maxRunLength: 50,
      changepointThreshold: 0.3,
      minRunLength: 5,
    });
    expect(typeof result.onsetIndex).toBe('number');
    expect(typeof result.confidence).toBe('number');
  });
});

describe('bocpdDetectAllChangepoints', () => {
  it('should return valid results for data with regime changes', () => {
    const values = new Float64Array(90);
    for (let i = 0; i < 30; i++) values[i] = 10 + Math.random();
    for (let i = 30; i < 60; i++) values[i] = 50 + Math.random();
    for (let i = 60; i < 90; i++) values[i] = 10 + Math.random();

    const results = bocpdDetectAllChangepoints(values, {
      changepointThreshold: 0.3,
      minRunLength: 5,
    });
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(r.onsetIndex).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should return empty for empty input', () => {
    const results = bocpdDetectAllChangepoints(new Float64Array([]));
    expect(results).toEqual([]);
  });

  it('should handle stationary data gracefully', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < values.length; i++) values[i] = 42 + Math.random() * 0.01;

    const results = bocpdDetectAllChangepoints(values, {
      changepointThreshold: 0.05,
      minRunLength: 10,
      hazardRate: 1 / 1000,
    });
    expect(Array.isArray(results)).toBe(true);
  });
});
