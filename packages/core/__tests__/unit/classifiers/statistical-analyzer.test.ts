import { describe, it, expect } from 'vitest';
import type { TimeSeries } from '../../../src/types/time-series.js';
import type { FaultClassifierContext } from '../../../src/interfaces/fault-classifier.js';
import { StatisticalAnalyzer } from '../../../src/utils/classifiers/statistical-analyzer.js';

// ── Helpers ───────────────────────────────────────────────

function makeSeries(
  label: string,
  values: number[],
  unit = 'count',
): TimeSeries {
  return {
    label,
    values: new Float64Array(values),
    timestamps: values.map((_, i) => 1000 + i * 60),
    unit,
  };
}

function makeContext(serviceId = 'svc_a'): FaultClassifierContext {
  return { serviceId, metricNames: [] };
}

// ── Tests — StatisticalAnalyzer ───────────────────────────

describe('StatisticalAnalyzer', () => {
  const analyzer = new StatisticalAnalyzer();

  describe('extractFeatures', () => {
    it('should compute basic statistics', () => {
      const series = makeSeries('cpu', [1, 2, 3, 4, 5]);
      const f = analyzer.extractFeatures(series);
      expect(f.mean).toBeCloseTo(3);
      expect(f.stddev).toBeCloseTo(Math.sqrt(2), 1);
      expect(f.variance).toBeCloseTo(2);
      expect(f.median).toBe(3);
    });

    it('should detect monotonic increase', () => {
      const series = makeSeries('mem', [10, 20, 30, 40, 50, 60, 70, 80]);
      const f = analyzer.extractFeatures(series);
      expect(f.isMonotonicIncreasing).toBe(true);
    });

    it('should reject non-monotonic series', () => {
      const series = makeSeries('cpu', [10, 20, 15, 30]);
      const f = analyzer.extractFeatures(series);
      expect(f.isMonotonicIncreasing).toBe(false);
    });

    it('should detect burst pattern', () => {
      const series = makeSeries('disk', [1, 1, 1, 1, 100, 1]);
      const f = analyzer.extractFeatures(series);
      expect(f.hasBurst).toBe(true);
    });

    it('should detect no burst in stable series', () => {
      const series = makeSeries('cpu', [5, 5, 5, 5, 5]);
      const f = analyzer.extractFeatures(series);
      expect(f.hasBurst).toBe(false);
    });

    it('should compute autocorrelation (periodic pattern)', () => {
      const series = makeSeries('cpu', [1, 5, 1, 5, 1, 5]);
      const f = analyzer.extractFeatures(series);
      // Alternating pattern → negative autocorrelation
      expect(f.autocorrelationLag1).toBeLessThan(0);
    });

    it('should compute autocorrelation (trending pattern)', () => {
      const series = makeSeries('cpu', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const f = analyzer.extractFeatures(series);
      // Strong positive trend → high positive autocorrelation
      expect(f.autocorrelationLag1).toBeGreaterThan(0.7);
    });

    it('should compute trend slope', () => {
      const series = makeSeries('latency', [10, 20, 30, 40, 50, 60]);
      const f = analyzer.extractFeatures(series);
      expect(f.trendSlope).toBeGreaterThan(0);
    });

    it('should compute coefficient of variation', () => {
      const stable = makeSeries('cpu', [5, 5, 5, 5]);
      const veryVolatile = makeSeries('loss', [1, 30, 2, 25, 3, 30]);
      expect(analyzer.extractFeatures(stable).coefficientOfVariation).toBeCloseTo(0);
      // Mean ≈15, stddev ≈14, CV ≈0.93. We just verify it's not zero.
      expect(analyzer.extractFeatures(veryVolatile).coefficientOfVariation).toBeGreaterThan(0.5);
    });

    it('should handle single data point', () => {
      const series = makeSeries('cpu', [5]);
      const f = analyzer.extractFeatures(series);
      expect(f.mean).toBe(5);
      expect(f.stddev).toBe(0);
      expect(f.trendSlope).toBe(0);
      expect(f.autocorrelationLag1).toBe(0);
    });

    it('should compute median for even-length series', () => {
      const series = makeSeries('cpu', [1, 3, 5, 7]);
      const f = analyzer.extractFeatures(series);
      expect(f.median).toBe(4);
    });

    it('should compute median for odd-length series', () => {
      const series = makeSeries('cpu', [1, 3, 5]);
      const f = analyzer.extractFeatures(series);
      expect(f.median).toBe(3);
    });
  });

  describe('classify', () => {
    // Use permissive config so single-series patterns can be detected
    const c = new StatisticalAnalyzer({ minDataPoints: 1 });

    it('should classify MEM from monotonic low-CV pattern', () => {
      // Gradual linear increase → monotonic, low CV, no bursts
      const values: number[] = [];
      for (let i = 0; i < 20; i++) {
        values.push(100 + i * 5);
      }
      const series = [makeSeries('heap_used', values)];
      const result = c.classify(series, makeContext());
      expect(result.some((h) => h.category === 'MEM')).toBe(true);
      expect(result.some((h) => h.method === 'statistical')).toBe(true);
    });

    it('should classify DISK from burst high-CV pattern', () => {
      const series = [makeSeries('disk_io', [5, 5, 5, 500, 5, 5])];
      const result = c.classify(series, makeContext());
      expect(result[0]!.category).toBe('DISK');
    });

    it('should classify CPU from high autocorrelation', () => {
      const values: number[] = [];
      for (let i = 0; i < 100; i++) {
        values.push(50 + 10 * Math.sin(i * 0.1));
      }
      const series = [makeSeries('cpu', values)];
      const result = c.classify(series, makeContext());
      expect(result.some((h) => h.category === 'CPU')).toBe(true);
    });

    it('should classify DELAY from trend with moderate CV', () => {
      const values: number[] = [];
      for (let i = 0; i < 20; i++) {
        values.push(100 + i * 20);
      }
      const series = [makeSeries('latency', values)];
      const result = c.classify(series, makeContext());
      expect(result.some((h) => h.category === 'DELAY')).toBe(true);
    });

    it('should classify LOSS from very high CV and low autocorrelation', () => {
      const series = [makeSeries('errors', [0, 0, 500, 0, 0, 400, 0, 0, 600])];
      const result = c.classify(series, makeContext());
      expect(result.some((h) => h.category === 'LOSS')).toBe(true);
    });

    it('should return UNKNOWN for insufficient data (default config)', () => {
      const series = [makeSeries('cpu', [5, 5])];
      const result = analyzer.classify(series, makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
    });

    it('should return UNKNOWN for empty input', () => {
      const result = analyzer.classify([], makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
    });

    it('should return UNKNOWN for stable all-same series', () => {
      const series = [
        makeSeries('cpu', [5, 5, 5, 5, 5]),
      ];
      const result = analyzer.classify(series, makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
    });

    it('should sort hypotheses by confidence descending', () => {
      const series = [
        makeSeries('metric', [0, 0, 100, 0, 50]),
        makeSeries('other', [1, 2, 3, 4, 5]),
      ];
      const result = c.classify(series, makeContext());
      for (let i = 1; i < result.length; i++) {
        expect(result[i - 1]!.confidence).toBeGreaterThanOrEqual(result[i]!.confidence);
      }
    });
  });

  describe('method identifier', () => {
    it('should return statistical as method', () => {
      expect(analyzer.method).toBe('statistical');
    });
  });

  describe('custom config', () => {
    it('should accept custom anomaly threshold', () => {
      const a = new StatisticalAnalyzer({ anomalyThreshold: 3.0, minDataPoints: 10 });
      const series = [
        makeSeries('cpu', [1, 2, 3, 4, 5, 1, 2, 3, 4, 5]),
      ];
      // Only 10 points, meets custom minDataPoints
      const result = a.classify(series, makeContext());
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
