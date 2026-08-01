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
  function polyval(coeffs: NDArray, x: NDArray): NDArray {
    const c = coeffs.data; const xd = x.data;
    const result = new Float64Array(xd.length);
    for (let i = 0; i < xd.length; i++) {
      let val = 0;
      for (let j = 0; j < c.length; j++) val += (c[j] ?? 0) * Math.pow(xd[i]!, c.length - 1 - j);
      result[i] = val;
    }
    return new NDArray(result);
  }
  return { array, polyfit, polyval, NDArray, default: { array, polyfit, polyval, NDArray } };
});

import { DegradationCurveAnalyzer, CurveModel } from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, timestamps: number[], values: number[]): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit: 'count' };
}

describe('DegradationCurveAnalyzer', () => {
  const analyzer = new DegradationCurveAnalyzer();

  describe('analyze', () => {
    it('analyzes linear data', () => {
      const ts = makeTS('metric', [0, 3600000, 7200000, 10800000, 14400000, 18000000, 21600000, 25200000, 28800000, 32400000],
        [10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
      const result = analyzer.analyze(ts, { minRSquared: 0.5 });
      expect(result.input).toBe(ts);
      expect(result.timeHours.length).toBe(10);
      expect(Object.values(CurveModel).includes(result.bestModel)).toBe(true);
      expect(result.bestFit).toBeDefined();
    });

    it('computes time-to-threshold', () => {
      const vals = Array.from({ length: 10 }, (_, i) => 10 + i * 2);
      const ts = makeTS('metric', vals.map((_, i) => i * 3600000), vals);
      const result = analyzer.analyze(ts, { failureThreshold: 50 });
      expect(result.hoursToThreshold).toBeDefined();
    });

    it('throws on fewer than 3 data points', () => {
      const ts = makeTS('test', [0, 1000], [10, 20]);
      expect(() => analyzer.analyze(ts)).toThrow();
    });

    it('throws on mismatched lengths', () => {
      const ts: TimeSeries = { label: 'test', timestamps: [0, 1000, 2000], values: new Float64Array([10, 20]), unit: 'count' };
      expect(() => analyzer.analyze(ts)).toThrow();
    });
  });

  describe('fitLinear', () => {
    it('fits linear model', () => {
      const fit = analyzer.fitLinear([0, 1, 2, 3, 4], [10, 12, 14, 16, 18]);
      expect(fit).toBeDefined();
      expect(fit!.model).toBe(CurveModel.LINEAR);
      expect(fit!.rSquared).toBeGreaterThan(0.9);
    });

    it('returns null for fewer than 2 points', () => {
      expect(analyzer.fitLinear([0], [10])).toBeNull();
    });
  });

  describe('fitExponential', () => {
    it('fits exponential model', () => {
      const fit = analyzer.fitExponential([0, 1, 2, 3], [10, 14, 20, 28]);
      expect(fit).toBeDefined();
      if (fit) expect(fit.model).toBe(CurveModel.EXPONENTIAL);
    });

    it('returns null for insufficient data', () => {
      expect(analyzer.fitExponential([0, 1], [10, 20])).toBeNull();
    });
  });

  describe('fitLogarithmic', () => {
    it('fits logarithmic model', () => {
      const fit = analyzer.fitLogarithmic([1, 2, 3, 4, 5], [5, 7, 8, 9, 9.5]);
      expect(fit).toBeDefined();
      expect(fit!.model).toBe(CurveModel.LOGARITHMIC);
    });

    it('returns null for < 2 points', () => {
      expect(analyzer.fitLogarithmic([0], [10])).toBeNull();
    });
  });

  describe('fitPowerLaw', () => {
    it('fits power-law model', () => {
      const fit = analyzer.fitPowerLaw([1, 2, 3, 4, 5], [5, 14, 27, 40, 56]);
      expect(fit).toBeDefined();
      if (fit) expect(fit.model).toBe(CurveModel.POWER_LAW);
    });

    it('returns null for insufficient data', () => {
      expect(analyzer.fitPowerLaw([0, 1], [1, 2])).toBeNull();
    });
  });

  describe('selectBestModel', () => {
    it('selects highest adjusted R-squared', () => {
      const fits: Record<CurveModel, any> = {
        [CurveModel.LINEAR]: { adjustedRSquared: 0.95 },
        [CurveModel.EXPONENTIAL]: { adjustedRSquared: 0.85 },
        [CurveModel.LOGARITHMIC]: { adjustedRSquared: 0.80 },
        [CurveModel.POWER_LAW]: { adjustedRSquared: 0.70 },
      } as any;
      expect(analyzer.selectBestModel(fits, 0.7)).toBe(CurveModel.LINEAR);
    });

    it('falls back to linear below threshold', () => {
      const fits: Record<CurveModel, any> = {
        [CurveModel.LINEAR]: { adjustedRSquared: 0.6 },
        [CurveModel.EXPONENTIAL]: { adjustedRSquared: 0.5 },
        [CurveModel.LOGARITHMIC]: null,
        [CurveModel.POWER_LAW]: null,
      } as any;
      expect(analyzer.selectBestModel(fits, 0.7)).toBe(CurveModel.LINEAR);
    });
  });

  describe('computeEndpointRate', () => {
    it('computes rate for linear', () => {
      const fit = { model: CurveModel.LINEAR, parameters: [2, 10] } as any;
      expect(analyzer.computeEndpointRate(CurveModel.LINEAR, fit, [0, 1, 2, 3])).toBe(2);
    });
  });

  describe('estimateTimeToThreshold', () => {
    it('estimates linear threshold', () => {
      const fit = { model: CurveModel.LINEAR, parameters: [2, 10] } as any;
      expect(analyzer.estimateTimeToThreshold(CurveModel.LINEAR, fit, 30, 5)).toBe(5);
    });

    it('returns undefined if already passed', () => {
      const fit = { model: CurveModel.LINEAR, parameters: [2, 10] } as any;
      expect(analyzer.estimateTimeToThreshold(CurveModel.LINEAR, fit, 10, 5)).toBeUndefined();
    });
  });
});
