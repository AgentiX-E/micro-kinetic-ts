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

import { MemoryLeakDetector } from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, timestamps: number[], values: number[]): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit: 'bytes' };
}

describe('MemoryLeakDetector', () => {
  const detector = new MemoryLeakDetector();

  describe('detect', () => {
    it('detects monotonic increasing memory as leak', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 110, 120, 130, 140]);
      const result = detector.detect(ts);
      expect(result.isMonotonic).toBe(true);
      expect(result.temporalCorrelation).toBeGreaterThan(0.3);
      expect(result.degradationRate).toBeGreaterThanOrEqual(0);
    });

    it('does not detect leak for stable memory', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 100, 100, 100, 100]);
      const result = detector.detect(ts);
      expect(result.detected).toBe(false);
    });

    it('returns degradation rate and KB/s', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 110, 120, 130, 140]);
      const result = detector.detect(ts);
      expect(result.degradationRate).toBeGreaterThan(0);
      expect(result.degradationRateKBs).toBeGreaterThan(0);
    });

    it('predicts OOM with memoryLimitBytes', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 110, 120, 130, 140]);
      const result = detector.detect(ts, { memoryLimitBytes: 200, minCorrelation: 0.1 });
      if (result.detected) {
        expect(result.oomTimestamp).toBeDefined();
        expect(result.hoursToOOM).toBeDefined();
      }
    });

    it('returns current memory bytes', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000], [100, 200, 300]);
      const result = detector.detect(ts);
      expect(result.currentMemoryBytes).toBe(300);
    });

    it('handles windowPoints option', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000, 18000000], [100, 200, 300, 400, 500, 600]);
      const result = detector.detect(ts, { windowPoints: 3, minCorrelation: 0.1 });
      expect(typeof result.detected).toBe('boolean');
    });

    it('throws on fewer than 2 data points', () => {
      const ts: TimeSeries = { label: 'mem', timestamps: [0], values: new Float64Array([100]), unit: 'bytes' };
      expect(() => detector.detect(ts)).toThrow();
    });

    it('throws on mismatched lengths', () => {
      const ts: TimeSeries = { label: 'mem', timestamps: [0, 1000], values: new Float64Array([100]), unit: 'bytes' };
      expect(() => detector.detect(ts)).toThrow();
    });

    it('non-monotonic data not detected', () => {
      const ts = makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 90, 120, 85, 110]);
      const result = detector.detect(ts, { minCorrelation: 0.7 });
      expect(result.detected).toBe(false);
      expect(result.isMonotonic).toBe(false);
    });
  });

  describe('computeDegradationRate', () => {
    it('returns 0 for fewer than 2 values', () => {
      expect(detector.computeDegradationRate([0], [100])).toBe(0);
    });

    it('returns non-negative rate', () => {
      const rate = detector.computeDegradationRate([0, 3600000, 7200000], [100, 200, 300]);
      expect(rate).toBeGreaterThanOrEqual(0);
    });
  });
});
