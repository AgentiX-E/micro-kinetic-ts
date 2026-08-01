import { describe, it, expect, vi } from 'vitest';

vi.mock('numpy-ts', () => {
  class NDArray {
    data: Float64Array;
    flags = { C_CONTIGUOUS: true };
    _shape: number[];
    constructor(data: Float64Array, shape?: number[]) { this.data = data; this._shape = shape || [data.length]; }
    tolist(): number[] { return Array.from(this.data); }
    reshape(shape: number[]) { return new NDArray(this.data, shape); }
    copy() { return new NDArray(new Float64Array(this.data), this._shape); }
  }
  function array(data: Float64Array | number[]): NDArray {
    const d = data instanceof Float64Array ? data : new Float64Array(data);
    return new NDArray(d, [d.length]);
  }
  function polyfit(x: NDArray, y: NDArray, _degree: number): NDArray {
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

import { FixedWindowCutter } from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, n: number): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    timestamps.push(i * 60000);
    values.push(1000 + i * 10);
  }
  return { label, timestamps, values: new Float64Array(values), unit: 'count' };
}

describe('FixedWindowCutter', () => {
  const cutter = new FixedWindowCutter();

  describe('segment', () => {
    it('segments into N equal windows', () => {
      const ts = makeTS('mem', 10);
      const windows = cutter.segment(ts, { maxWindows: 5, minWindowDurationMs: 10000, adaptive: false });
      expect(windows.length).toBe(5);
    });

    it('handles N=1 single window', () => {
      const ts = makeTS('mem', 10);
      const windows = cutter.segment(ts, { maxWindows: 1, minWindowDurationMs: 10000, adaptive: false });
      expect(windows.length).toBe(1);
    });

    it('handles N near data point count', () => {
      const ts = makeTS('mem', 10);
      const windows = cutter.segment(ts, { maxWindows: 9, minWindowDurationMs: 10000, adaptive: false });
      expect(windows.length).toBe(9);
    });

    it('windows are non-overlapping', () => {
      const ts = makeTS('mem', 100);
      const windows = cutter.segment(ts, { maxWindows: 10, minWindowDurationMs: 10000, adaptive: false });
      for (let i = 1; i < windows.length; i++) {
        expect(windows[i]!.startTime).toBeGreaterThanOrEqual(windows[i - 1]!.endTime);
      }
    });

    it('each window has valid properties', () => {
      const ts = makeTS('mem', 50);
      const windows = cutter.segment(ts, { maxWindows: 5, minWindowDurationMs: 10000, adaptive: false });
      for (const w of windows) {
        expect(w.index).toBeGreaterThanOrEqual(0);
        expect(w.degradationRate).toBeGreaterThanOrEqual(0);
        expect(w.localErrorBound).toBeGreaterThanOrEqual(0);
        expect(w.duration).toBeGreaterThan(0);
      }
    });

    it('throws on fewer than 2 data points', () => {
      const ts: TimeSeries = { label: 't', timestamps: [0], values: new Float64Array([1]), unit: 'x' };
      expect(() => cutter.segment(ts, { maxWindows: 1, minWindowDurationMs: 10000, adaptive: false })).toThrow();
    });

    it('throws on mismatched lengths', () => {
      const ts: TimeSeries = { label: 't', timestamps: [0, 1000], values: new Float64Array([1]), unit: 'x' };
      expect(() => cutter.segment(ts, { maxWindows: 1, minWindowDurationMs: 10000, adaptive: false })).toThrow();
    });
  });

  describe('estimateLocalBounds', () => {
    it('returns bounds for each window', () => {
      const ts = makeTS('mem', 100);
      const windows = cutter.segment(ts, { maxWindows: 5, minWindowDurationMs: 10000, adaptive: false });
      const bounds = cutter.estimateLocalBounds(windows, 'metric');
      expect(bounds.length).toBe(5);
      for (const b of bounds) {
        expect(typeof b.errorBound).toBe('number');
      }
    });

    it('throws on empty windows', () => {
      expect(() => cutter.estimateLocalBounds([], 'metric')).toThrow();
    });
  });

  describe('proveConvergence', () => {
    it('proves convergence with induction prover', () => {
      const ts = makeTS('mem', 100);
      const windows = cutter.segment(ts, { maxWindows: 5, minWindowDurationMs: 10000, adaptive: false });
      const bounds = cutter.estimateLocalBounds(windows, 'metric');
      const result = cutter.proveConvergence(bounds, 1000);
      expect(typeof result.converged).toBe('boolean');
      expect(result.proofSteps.length).toBe(bounds.length);
    });

    it('throws on empty bounds', () => {
      expect(() => cutter.proveConvergence([], 0.01)).toThrow();
    });
  });
});
