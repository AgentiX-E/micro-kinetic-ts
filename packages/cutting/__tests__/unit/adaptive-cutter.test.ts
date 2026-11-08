import { describe, expect, it, vi } from 'vitest';

vi.mock('numpy-ts', () => {
  class NDArray {
    data: Float64Array;
    flags = { C_CONTIGUOUS: true };
    _shape: number[];
    constructor(data: Float64Array, shape?: number[]) {
      this.data = data;
      this._shape = shape || [data.length];
    }
    tolist(): number[] {
      return Array.from(this.data);
    }
    reshape(shape: number[]) {
      return new NDArray(this.data, shape);
    }
    copy() {
      return new NDArray(new Float64Array(this.data), this._shape);
    }
  }
  function array(data: Float64Array | number[]): NDArray {
    const d = data instanceof Float64Array ? data : new Float64Array(data);
    return new NDArray(d, [d.length]);
  }
  function polyfit(x: NDArray, y: NDArray, _degree: number): NDArray {
    const xd = x.data;
    const yd = y.data;
    const n = xd.length;
    let sx = 0,
      sy = 0,
      sxy = 0,
      sx2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = xd[i]!;
      const yi = yd[i]!;
      sx += xi;
      sy += yi;
      sxy += xi * yi;
      sx2 += xi * xi;
    }
    const denom = n * sx2 - sx * sx;
    const slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = Math.abs(denom) < 1e-12 ? 0 : (sy * sx2 - sx * sxy) / denom;
    return new NDArray(new Float64Array([slope, intercept]), [2]);
  }
  return { array, polyfit, NDArray, default: { array, polyfit, NDArray } };
});

import type { CuttingWindow, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { AdaptiveWindowCutter, computeKineticEnergyBound } from '@agentix-e/micro-kinetic-cutting';

function makeTimeSeries(
  label: string,
  timestamps: number[],
  values: number[],
  unit = 'count',
): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit };
}

function linearDegradation(n: number, startTime = 0, intervalMs = 60000): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    timestamps.push(startTime + i * intervalMs);
    values.push(1000 + i * 10);
  }
  return makeTimeSeries('mem_rss', timestamps, values, 'bytes');
}

function stableData(n: number, startTime = 0, intervalMs = 60000): TimeSeries {
  const timestamps: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < n; i++) {
    timestamps.push(startTime + i * intervalMs);
    values.push(100);
  }
  return makeTimeSeries('cpu_usage', timestamps, values, 'percent');
}

describe('AdaptiveWindowCutter', () => {
  const cutter = new AdaptiveWindowCutter();

  describe('segment', () => {
    it('segments linear degradation data', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: true,
      });
      expect(windows.length).toBeGreaterThan(0);
      for (const w of windows) {
        expect(w.index).toBeGreaterThanOrEqual(0);
        expect(w.startTime).toBeGreaterThanOrEqual(0);
        expect(w.duration).toBeGreaterThan(0);
        expect(w.slice).toBeDefined();
        expect(typeof w.degradationRate).toBe('number');
        expect(typeof w.localErrorBound).toBe('number');
      }
    });

    it('segments stable data', () => {
      const ts = stableData(50);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: true,
      });
      expect(windows.length).toBeGreaterThan(0);
    });

    it('produces N=2 windows', () => {
      const ts = linearDegradation(20);
      const windows = cutter.segment(ts, {
        maxWindows: 2,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBeGreaterThanOrEqual(1);
      expect(windows.length).toBeLessThanOrEqual(3);
    });

    it('produces N=5 windows', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBe(5);
    });

    it('produces N=10 windows', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 10,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBe(10);
    });

    it('respects minWindowDurationMs constraint', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 60000,
        adaptive: false,
      });
      for (const w of windows) {
        expect(w.duration).toBeGreaterThanOrEqual(60000);
      }
    });

    it('non-adaptive mode returns exactly N windows', () => {
      const ts = linearDegradation(60);
      const windows = cutter.segment(ts, {
        maxWindows: 4,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBe(4);
    });

    it('adaptive mode may split windows with high variance', () => {
      const timestamps: number[] = [];
      const values: number[] = [];
      for (let i = 0; i < 100; i++) {
        timestamps.push(i * 60000);
        if (i < 50) {
          values.push(1000 + i * 1);
        } else {
          values.push(1050 + (i - 50) * 20);
        }
      }
      const ts = makeTimeSeries('mem_usage', timestamps, values, 'bytes');
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: true,
      });
      expect(windows.length).toBeGreaterThanOrEqual(4);
    });

    it('handles single data point gracefully', () => {
      const ts: TimeSeries = {
        label: 'test',
        timestamps: [0, 1000],
        values: new Float64Array([100, 100]),
        unit: 'count',
      };
      const windows = cutter.segment(ts, {
        maxWindows: 1,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBeGreaterThanOrEqual(0);
    });

    it('throws on maxWindows exceeding data points', () => {
      const ts = linearDegradation(5);
      expect(() =>
        cutter.segment(ts, { maxWindows: 10, minWindowDurationMs: 10000, adaptive: true }),
      ).toThrow();
    });

    it('throws on fewer than 2 data points', () => {
      const ts: TimeSeries = {
        label: 'test',
        timestamps: [0],
        values: new Float64Array([100]),
        unit: 'count',
      };
      expect(() =>
        cutter.segment(ts, { maxWindows: 1, minWindowDurationMs: 10000, adaptive: false }),
      ).toThrow();
    });

    it('throws on timestamp/value length mismatch', () => {
      const ts: TimeSeries = {
        label: 'test',
        timestamps: [0, 1000, 2000],
        values: new Float64Array([100, 200]),
        unit: 'count',
      };
      expect(() =>
        cutter.segment(ts, { maxWindows: 2, minWindowDurationMs: 10000, adaptive: true }),
      ).toThrow();
    });

    it('handles single window covering all data (N=1)', () => {
      const ts = linearDegradation(20);
      const windows = cutter.segment(ts, {
        maxWindows: 1,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBe(1);
      expect(windows[0]!.index).toBe(0);
    });

    it('handles extractSlice with narrow window (no points fallback)', () => {
      // Create data where some windows may have very narrow ranges
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 3,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      expect(windows.length).toBeGreaterThan(0);
      // Each window should still have a valid slice
      for (const w of windows) {
        expect(w.slice.values.length).toBeGreaterThan(0);
      }
    });

    it('handles peaky data with adaptive refinement', () => {
      const ts = linearDegradation(80);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 5000,
        adaptive: true,
      });
      expect(windows.length).toBeGreaterThan(0);
    });

    it('uses the default options when none are supplied', () => {
      const ts = linearDegradation(120);
      const windows = cutter.segment(ts);
      expect(windows.length).toBe(100);
      for (const w of windows) {
        expect(w.slice.values.length).toBeGreaterThan(0);
      }
    });

    it('falls back to the nearest sample when a window contains no data', () => {
      // Two dense clusters separated by a long idle gap: the middle windows
      // cover no sample at all, so each one borrows its closest sample.
      const timestamps: number[] = [];
      const values: number[] = [];
      for (let i = 0; i < 8; i++) {
        timestamps.push(i * 60000);
        values.push(1000 + i);
      }
      for (let i = 0; i < 8; i++) {
        timestamps.push((993 + i) * 60000);
        values.push(2000 + i);
      }
      const ts = makeTimeSeries('sparse_metric', timestamps, values);

      const windows = cutter.segment(ts, {
        maxWindows: 8,
        minWindowDurationMs: 10000,
        adaptive: false,
      });

      expect(windows.length).toBe(8);
      expect(windows[3]!.slice.values.length).toBe(1);
      expect(windows[3]!.degradationRate).toBe(0);
      for (const w of windows) {
        expect(w.slice.values.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('rejects a series whose first timestamp slot is missing', () => {
      // A hole at index 0 is what `noUncheckedIndexedAccess` calls `undefined`, and the reason the
      // cutter refuses a series rather than silently treating the hole as time zero.
      const timestamps = Array.from<number>({ length: 2 });
      timestamps[1] = 1000;
      const ts: TimeSeries = {
        label: 'broken',
        timestamps,
        values: new Float64Array([1, 2]),
        unit: 'count',
      };
      expect(() =>
        cutter.segment(ts, { maxWindows: 1, minWindowDurationMs: 10000, adaptive: false }),
      ).toThrow(/no valid timestamps/);
    });
  });

  describe('estimateLocalBounds', () => {
    it('returns bounds for each window', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      const bounds = cutter.estimateLocalBounds(windows, 'mem_rss');
      expect(bounds.length).toBe(windows.length);
      for (let i = 0; i < bounds.length; i++) {
        expect(bounds[i]!.windowIndex).toBe(i);
        expect(bounds[i]!.errorBound).toBeGreaterThanOrEqual(0);
      }
    });

    it('throws on empty windows', () => {
      expect(() => cutter.estimateLocalBounds([], 'metric')).toThrow();
    });

    it('returns no indicators for flat windows', () => {
      const ts = stableData(50);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      const bounds = cutter.estimateLocalBounds(windows, 'cpu_usage');
      for (const bound of bounds) {
        expect(bound.degradationRate).toBe(0);
        expect(bound.indicators).toEqual([]);
      }
    });

    it('flags a rising but wobbly window as non-monotonic', () => {
      const ts = makeTimeSeries(
        'mem_rss',
        [0, 60000, 120000, 180000, 240000],
        [100, 130, 120, 170, 160],
      );
      const windows = cutter.segment(ts, {
        maxWindows: 1,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      const bounds = cutter.estimateLocalBounds(windows, 'mem_rss');
      expect(bounds.length).toBe(1);
      expect(bounds[0]!.degradationRate).toBeGreaterThan(0);
      expect(bounds[0]!.indicators[0]!.isMonotonic).toBe(false);
      expect(bounds[0]!.indicators[0]!.temporalCorrelation).toBeGreaterThan(0);
    });

    it('reports zero correlation for a caller-supplied single-sample window', () => {
      const win: CuttingWindow = {
        index: 0,
        startTime: 0,
        endTime: 60000,
        duration: 60000,
        slice: makeTimeSeries('metric', [0], [5]),
        degradationRate: 1.5,
        localErrorBound: 0.1,
      };
      const bounds = cutter.estimateLocalBounds([win], 'metric');
      expect(bounds[0]!.indicators[0]!.temporalCorrelation).toBe(0);
      expect(bounds[0]!.indicators[0]!.isMonotonic).toBe(false);
    });

    it('reports zero correlation for a caller-supplied constant window', () => {
      const win: CuttingWindow = {
        index: 0,
        startTime: 0,
        endTime: 120000,
        duration: 120000,
        slice: makeTimeSeries('metric', [0, 60000, 120000], [7, 7, 7]),
        degradationRate: 1.5,
        localErrorBound: 0.1,
      };
      const bounds = cutter.estimateLocalBounds([win], 'metric');
      expect(bounds[0]!.indicators[0]!.temporalCorrelation).toBe(0);
      expect(bounds[0]!.indicators[0]!.isMonotonic).toBe(true);
    });
  });

  describe('proveConvergence', () => {
    it('proves convergence for small error sequence', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      const bounds = cutter.estimateLocalBounds(windows, 'metric');
      const result = cutter.proveConvergence(bounds, 100);
      expect(typeof result.converged).toBe('boolean');
      expect(result.proofSteps.length).toBe(bounds.length);
    });

    it('throws on empty bounds', () => {
      expect(() => cutter.proveConvergence([], 0.01)).toThrow();
    });

    it('throws on non-positive tolerance', () => {
      const ts = linearDegradation(100);
      const windows = cutter.segment(ts, {
        maxWindows: 5,
        minWindowDurationMs: 10000,
        adaptive: false,
      });
      const bounds = cutter.estimateLocalBounds(windows, 'metric');
      expect(() => cutter.proveConvergence(bounds, 0)).toThrow();
      expect(() => cutter.proveConvergence(bounds, -0.01)).toThrow();
    });
  });
});

describe('computeKineticEnergyBound', () => {
  it('computes ε = C * r * δ² / 2', () => {
    expect(computeKineticEnergyBound(2, 3)).toBeCloseTo(9);
  });

  it('returns 0 for zero degradation rate', () => {
    expect(computeKineticEnergyBound(0, 5)).toBe(0);
  });

  it('returns 0 for zero duration', () => {
    expect(computeKineticEnergyBound(5, 0)).toBe(0);
  });

  it('applies custom scale factor', () => {
    expect(computeKineticEnergyBound(2, 3, 0.5)).toBeCloseTo(4.5);
  });

  it('throws for negative degradation rate', () => {
    expect(() => computeKineticEnergyBound(-1, 5)).toThrow();
  });

  it('throws for non-finite inputs', () => {
    expect(() => computeKineticEnergyBound(Infinity, 5)).toThrow();
    expect(() => computeKineticEnergyBound(5, NaN)).toThrow();
  });
});
