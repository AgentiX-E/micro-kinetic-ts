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
  function polyval(coeffs: NDArray, x: NDArray): NDArray {
    const c = coeffs.data; const xd = x.data;
    const result = new Float64Array(xd.length);
    for (let i = 0; i < xd.length; i++) {
      let val = 0;
      for (let j = 0; j < c.length; j++) { val += (c[j] ?? 0) * Math.pow(xd[i]!, c.length - 1 - j); }
      result[i] = val;
    }
    return new NDArray(result);
  }
  return { array, polyfit, polyval, NDArray, default: { array, polyfit, polyval, NDArray } };
});

import {
  LocalErrorEstimator, DegradationType,
  computeLinearErrorBound, computeExponentialErrorBound,
  computePowerLawErrorBound, computeLogarithmicErrorBound,
  DEFAULT_ERROR_ESTIMATOR_CONFIG,
} from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries, CuttingWindow } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, timestamps: number[], values: number[]): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit: 'count' };
}

function makeWindow(index: number, startTime: number, endTime: number, ts: TimeSeries): CuttingWindow {
  return { index, startTime, endTime, duration: endTime - startTime, slice: ts, degradationRate: 2.0, localErrorBound: 1.0 };
}

describe('computeLinearErrorBound', () => {
  it('computes ε = C * r * δ² / 2', () => { expect(computeLinearErrorBound(2, 3)).toBeCloseTo(9); });
  it('custom scale', () => { expect(computeLinearErrorBound(2, 3, 0.5)).toBeCloseTo(4.5); });
  it('throws on NaN', () => { expect(() => computeLinearErrorBound(NaN, 1)).toThrow(); });
});

describe('computeExponentialErrorBound', () => {
  it('computes exponential bound', () => { expect(computeExponentialErrorBound(2, 1, 0.5)).toBeGreaterThan(0); });
  it('uses Taylor for small x', () => { expect(computeExponentialErrorBound(2, 0.001, 0.5)).toBeGreaterThan(0); });
});

describe('computePowerLawErrorBound', () => {
  it('computes power-law bound', () => { expect(computePowerLawErrorBound(2, 2, 2)).toBeCloseTo(4); });
  it('throws for alpha <= 1', () => {
    expect(() => computePowerLawErrorBound(1, 1, 1)).toThrow();
    expect(() => computePowerLawErrorBound(1, 1, 0.5)).toThrow();
  });
});

describe('computeLogarithmicErrorBound', () => {
  it('computes log bound', () => { expect(computeLogarithmicErrorBound(2, 3)).toBeGreaterThan(0); });
  it('zero duration', () => { expect(computeLogarithmicErrorBound(5, 0)).toBe(0); });
});

describe('LocalErrorEstimator', () => {
  const estimator = new LocalErrorEstimator();

  describe('estimateLocalBounds', () => {
    it('returns bounds for each window', () => {
      const ts = makeTS('mem', [0, 1000, 2000, 3000, 4000, 5000], [100, 200, 300, 400, 500, 600]);
      const bounds = estimator.estimateLocalBounds([makeWindow(0, 0, 5000, ts)], 'mem_rss');
      expect(bounds.length).toBe(1);
      expect(bounds[0]!.errorBound).toBeGreaterThanOrEqual(0);
    });
  });

  describe('estimateWindow', () => {
    it('estimates error for a window', () => {
      const ts = makeTS('mem', [0, 1000, 2000, 3000, 4000, 5000], [100, 200, 300, 400, 500, 600]);
      const result = estimator.estimateWindow(makeWindow(0, 0, 5000, ts));
      expect(typeof result.errorBound).toBe('number');
    });

    it('handles minimal data', () => {
      const ts = makeTS('single', [0], [100]);
      const win: CuttingWindow = { index: 0, startTime: 0, endTime: 1000, duration: 1000, slice: ts, degradationRate: 0, localErrorBound: 0 };
      const result = estimator.estimateWindow(win);
      expect(result.degradationRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectDegradationType', () => {
    it('returns LINEAR for small data', () => {
      expect(estimator.detectDegradationType(makeTS('mem', [0, 1000, 2000], [100, 200, 300]))).toBe(DegradationType.LINEAR);
    });

    it('returns valid type for larger data', () => {
      const ts = makeTS('mem', [0, 1000, 2000, 3000, 4000, 5000, 6000], [100, 105, 110, 115, 120, 125, 130]);
      const type = estimator.detectDegradationType(ts);
      expect([DegradationType.LINEAR, DegradationType.EXPONENTIAL, DegradationType.POWER_LAW].includes(type)).toBe(true);
    });
  });

  describe('config', () => {
    it('DEFAULT_ERROR_ESTIMATOR_CONFIG has valid values', () => {
      expect(DEFAULT_ERROR_ESTIMATOR_CONFIG.defaultType).toBe(DegradationType.LINEAR);
      expect(DEFAULT_ERROR_ESTIMATOR_CONFIG.scaleFactor).toBe(1.0);
      expect(DEFAULT_ERROR_ESTIMATOR_CONFIG.minDegradationRate).toBe(1e-6);
    });

    it('supports custom config', () => {
      const custom = new LocalErrorEstimator({ defaultType: DegradationType.EXPONENTIAL, scaleFactor: 2.0 });
      expect(custom).toBeDefined();
    });
  });
});
