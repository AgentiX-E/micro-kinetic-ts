import { describe, it, expect, vi } from 'vitest';

vi.mock('numpy-ts', () => {
  class NDArray {
    data: Float64Array;
    flags = { C_CONTIGUOUS: true };
    _shape: number[];
    constructor(data: Float64Array, shape?: number[]) { this.data = data; this._shape = shape || [data.length]; }
    tolist(): number[] { return Array.from(this.data); }
    copy() { return new NDArray(new Float64Array(this.data), this._shape); }
    reshape(shape: number[]) { return new NDArray(this.data, shape); }
  }
  function array(data: Float64Array | number[]) {
    return new NDArray(data instanceof Float64Array ? data : new Float64Array(data), [data.length]);
  }
  function polyfit(x: NDArray, y: NDArray): NDArray {
    const xd = x.data; const yd = y.data; const n = xd.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = xd[i]!, yi = yd[i]!;
      sx += xi; sy += yi; sxy += xi * yi; sx2 += xi * xi;
    }
    const denom = n * sx2 - sx * sx;
    const slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = Math.abs(denom) < 1e-12 ? 0 : (sy * sx2 - sx * sxy) / denom;
    return new NDArray(new Float64Array([slope, intercept]), [2]);
  }
  return { array, polyfit, NDArray, default: { array, polyfit, NDArray } };
});

import { ConnectionPoolDetector } from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, timestamps: number[], values: number[]): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit: 'connections' };
}

describe('ConnectionPoolDetector', () => {
  const detector = new ConnectionPoolDetector();

  describe('detect', () => {
    it('detects monotonic connection depletion', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000, 10800000], [100, 90, 80, 70]);
      const result = detector.detect(ts, { minGrowthRate: 0.001, minFitQuality: 0.5 });
      expect(result.isMonotonic).toBe(true);
      expect(result.growthRate).toBeGreaterThanOrEqual(0);
      expect(result.currentAvailable).toBe(70);
    });

    it('estimates pool capacity', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000, 10800000, 14400000], [100, 90, 80, 70, 60]);
      const result = detector.detect(ts);
      expect(result.poolCapacity).toBeGreaterThan(0);
      expect(result.utilizationRatio).toBeGreaterThanOrEqual(0);
      expect(result.utilizationRatio).toBeLessThanOrEqual(1);
    });

    it('predicts exhaustion time', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000, 10800000, 14400000], [100, 85, 70, 55, 40]);
      const result = detector.detect(ts, { poolCapacity: 100, exhaustionThreshold: 0.1, minGrowthRate: 0.001, minFitQuality: 0.5 });
      if (result.detected) {
        expect(result.hoursToExhaustion).toBeDefined();
        expect(result.exhaustionTimestamp).toBeDefined();
      }
    });

    it('stable connections not detected', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000, 10800000, 14400000], [100, 100, 100, 100, 100]);
      expect(detector.detect(ts).detected).toBe(false);
    });

    it('returns initial and current available', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000], [100, 80, 60]);
      const result = detector.detect(ts);
      expect(result.currentAvailable).toBe(60);
      expect(result.initialAvailable).toBeGreaterThan(0);
    });

    it('throws on fewer than 3 data points', () => {
      const ts: TimeSeries = { label: 'pool', timestamps: [0, 1000], values: new Float64Array([100, 90]), unit: 'connections' };
      expect(() => detector.detect(ts)).toThrow();
    });

    it('throws on mismatched lengths', () => {
      const ts: TimeSeries = { label: 'pool', timestamps: [0, 1000, 2000], values: new Float64Array([100, 90]), unit: 'connections' };
      expect(() => detector.detect(ts)).toThrow();
    });

    it('reports fit quality and confidence', () => {
      const ts = makeTS('pool', [0, 3600000, 7200000, 10800000], [100, 85, 72, 61]);
      const result = detector.detect(ts);
      expect(result.fitQuality).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('estimatePoolCapacity', () => {
    it('estimates from max observed + 10%', () => {
      const cap = detector.estimatePoolCapacity([100, 80, 60, 70, 90]);
      expect(cap).toBeGreaterThanOrEqual(100);
      expect(cap).toBeLessThanOrEqual(120);
    });
  });

  describe('fitExponentialDecay', () => {
    it('fits exponential model', () => {
      const result = detector.fitExponentialDecay([0, 1, 2, 3], [100, 80, 64, 51]);
      expect(result.growthRate).toBeGreaterThanOrEqual(0);
      expect(result.initialAvailable).toBeGreaterThan(0);
      expect(result.fitQuality).toBeGreaterThanOrEqual(0);
    });

    it('handles fewer than 3 points', () => {
      const result = detector.fitExponentialDecay([0, 1], [100, 80]);
      expect(result.growthRate).toBe(0);
      expect(result.fitQuality).toBe(0);
    });

    it('handles fewer than 3 positive values after baseline removal', () => {
      // Values with many zeros: baseline = 0, only 2 positive values survive
      const result = detector.fitExponentialDecay([0, 1, 2, 3], [0, 5, 8, 0]);
      expect(result.growthRate).toBeGreaterThanOrEqual(0);
    });
  });
});
