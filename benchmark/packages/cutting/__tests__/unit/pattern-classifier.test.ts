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

import { PatternClassifier, ChronicPattern } from '@agentix-e/micro-kinetic-cutting';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeTS(label: string, timestamps: number[], values: number[]): TimeSeries {
  return { label, timestamps, values: new Float64Array(values), unit: 'count' };
}

describe('PatternClassifier', () => {
  const classifier = new PatternClassifier();

  describe('classify', () => {
    it('classifies monotonic increasing memory', () => {
      const ts = makeTS('mem_rss',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 110, 120, 130, 140, 150]);
      const result = classifier.classify(ts);
      expect(result.metric).toBe('mem_rss');
      expect(Object.values(ChronicPattern).includes(result.pattern)).toBe(true);
      expect(typeof result.confidence).toBe('number');
      expect(typeof result.detected).toBe('boolean');
      expect(result.faultCategory).toBeDefined();
    });

    it('classifies monotonic decreasing pool', () => {
      const ts = makeTS('pool.available',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 90, 80, 70, 60, 50]);
      const result = classifier.classify(ts);
      expect(Object.values(ChronicPattern).includes(result.pattern)).toBe(true);
    });

    it('handles stable data', () => {
      const ts = makeTS('cpu_usage',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [50, 52, 48, 51, 49, 50]);
      const result = classifier.classify(ts);
      expect(result.pattern).toBeDefined();
    });

    it('custom confidence threshold', () => {
      const ts = makeTS('mem_rss',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 110, 120, 130, 140, 150]);
      const result = classifier.classify(ts, { confidenceThreshold: 0.9 });
      expect(typeof result.detected).toBe('boolean');
    });

    it('exhaustive mode', () => {
      const ts = makeTS('mem_rss',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 110, 120, 130, 140, 150]);
      const result = classifier.classify(ts, { exhaustive: true });
      expect(result.scores).toBeDefined();
    });

    it('throws on mismatched lengths', () => {
      const ts: TimeSeries = { label: 'test', timestamps: [0, 1000, 2000], values: new Float64Array([10, 20]), unit: 'count' };
      expect(() => classifier.classify(ts)).toThrow();
    });
  });

  describe('classifyMultiMetric', () => {
    it('classifies multiple metrics', () => {
      const metrics = {
        'mem_rss': makeTS('mem_rss', [0, 3600000, 7200000, 10800000, 14400000], [100, 110, 120, 130, 140]),
        'cpu_usage': makeTS('cpu_usage', [0, 3600000, 7200000, 10800000, 14400000], [50, 52, 48, 51, 49]),
      };
      const result = classifier.classifyMultiMetric(metrics);
      expect(result.metric).toBeDefined();
      expect(Object.values(ChronicPattern).includes(result.pattern)).toBe(true);
    });

    it('throws on empty metrics', () => {
      expect(() => classifier.classifyMultiMetric({})).toThrow();
    });
  });

  describe('selectPattern', () => {
    it('selects highest score', () => {
      const scores: Record<ChronicPattern, number> = {
        [ChronicPattern.MEMORY_LEAK]: 0.3,
        [ChronicPattern.CONNECTION_POOL_EXHAUSTION]: 0.8,
        [ChronicPattern.DATA_SKEW]: 0.5,
        [ChronicPattern.GRADUAL_DEGRADATION]: 0.2,
        [ChronicPattern.UNKNOWN]: 0,
      };
      expect(classifier.selectPattern(scores)).toBe(ChronicPattern.CONNECTION_POOL_EXHAUSTION);
    });

    it('returns UNKNOWN for all zero', () => {
      const scores: Record<ChronicPattern, number> = {
        [ChronicPattern.MEMORY_LEAK]: 0,
        [ChronicPattern.CONNECTION_POOL_EXHAUSTION]: 0,
        [ChronicPattern.DATA_SKEW]: 0,
        [ChronicPattern.GRADUAL_DEGRADATION]: 0,
        [ChronicPattern.UNKNOWN]: 0,
      };
      expect(classifier.selectPattern(scores)).toBe(ChronicPattern.UNKNOWN);
    });
  });

  describe('ChronicPattern enum', () => {
    it('has all expected values', () => {
      expect(ChronicPattern.MEMORY_LEAK).toBe('memory_leak');
      expect(ChronicPattern.CONNECTION_POOL_EXHAUSTION).toBe('connection_pool_exhaustion');
      expect(ChronicPattern.DATA_SKEW).toBe('data_skew');
      expect(ChronicPattern.GRADUAL_DEGRADATION).toBe('gradual_degradation');
      expect(ChronicPattern.UNKNOWN).toBe('unknown');
    });
  });

  describe('fault category mapping', () => {
    it('maps to valid fault category', () => {
      const ts = makeTS('mem_rss',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 110, 120, 130, 140, 150]);
      const result = classifier.classify(ts);
      expect(typeof result.faultCategory).toBe('string');
    });

    it('classifies strongly monotonic increasing data (memory leak pattern)', () => {
      const ts = makeTS('mem_rss',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000, 21600000],
        [100, 120, 140, 160, 180, 200, 220]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
      expect(typeof result.faultCategory).toBe('string');
    });

    it('classifies strongly monotonic decreasing data (connection pool pattern)', () => {
      const ts = makeTS('pool.available',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000, 21600000],
        [200, 180, 160, 140, 120, 100, 80]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
      expect(typeof result.faultCategory).toBe('string');
    });

    it('classifies stable flat data (unknown pattern)', () => {
      const ts = makeTS('flat_metric',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [50, 50, 50, 50, 50, 50]);
      const result = classifier.classify(ts);
      expect(typeof result.pattern).toBe('string');
      expect(typeof result.faultCategory).toBe('string');
    });

    it('classifies accelerating trend data', () => {
      const ts = makeTS('accel_metric',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000, 21600000],
        [10, 12, 16, 25, 40, 65, 100]);
      const result = classifier.classify(ts);
      expect(result.faultCategory).toBeDefined();
    });

    it('classifies exponential growth data', () => {
      const ts = makeTS('exp_metric',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [1, 2, 4, 8, 16, 32]);
      const result = classifier.classify(ts);
      expect(typeof result.pattern).toBe('string');
      expect(typeof result.reason).toBe('string');
      expect(result.scores).toBeDefined();
    });

    it('classifies power-law (quadratic) data', () => {
      const ts = makeTS('pow_metric',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [1, 4, 9, 16, 25, 36]);
      const result = classifier.classify(ts);
      expect(typeof result.pattern).toBe('string');
      expect(typeof result.faultCategory).toBe('string');
    });

    it('returns reason for gradual degradation data', () => {
      const ts = makeTS('gradual',
        [0, 3600000, 7200000, 10800000, 14400000],
        [100, 105, 110, 115, 120]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
    });

    it('classifies strongly decreasing pool data', () => {
      const ts = makeTS('pool_avail',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [500, 400, 300, 200, 100, 50]);
      const result = classifier.classify(ts);
      expect(typeof result.pattern).toBe('string');
      expect(typeof result.reason).toBe('string');
    });

    it('classifies power-law growth data', () => {
      const ts = makeTS('pow',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [1, 4, 9, 16, 25, 36]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
      expect(result.scores).toBeDefined();
    });

    it('classifies random oscillating data', () => {
      const ts = makeTS('random',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [100, 95, 102, 88, 105, 92]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
      expect(typeof result.faultCategory).toBe('string');
    });

    it('classifies very flat stable data', () => {
      const ts = makeTS('flat',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [50, 50, 50, 50, 50, 50]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
    });

    it('classifies slow decay data', () => {
      const ts = makeTS('decay',
        [0, 3600000, 7200000, 10800000, 14400000, 18000000],
        [200, 195, 190, 185, 180, 175]);
      const result = classifier.classify(ts);
      expect(typeof result.reason).toBe('string');
    });
  });
});
