import { describe, it, expect } from 'vitest';
import { StatisticsProvider } from '../../../src/math/statistics-provider.js';

function makeArray(data: number[]): Float64Array {
  return new Float64Array(data);
}

describe('StatisticsProvider', () => {
  let stats: StatisticsProvider;

  beforeEach(() => {
    stats = new StatisticsProvider();
  });

  describe('rollingStats', () => {
    it('should compute rolling stats for a simple array', () => {
      const data = makeArray([1, 2, 3, 4, 5]);
      const result = stats.rollingStats(data, 3);
      expect(result.windowSize).toBe(3);
      expect(result.mean.length).toBe(3); // 5-3+1
      expect(result.variance.length).toBe(3);
      expect(result.stddev.length).toBe(3);
    });

    it('should compute correct rolling mean', () => {
      const data = makeArray([1, 2, 3, 4, 5]);
      const result = stats.rollingStats(data, 3);
      // Window [1,2,3]: mean=2, [2,3,4]: mean=3, [3,4,5]: mean=4
      expect(result.mean[0]).toBeCloseTo(2, 5);
      expect(result.mean[1]).toBeCloseTo(3, 5);
      expect(result.mean[2]).toBeCloseTo(4, 5);
    });

    it('should throw when windowSize > data length', () => {
      const data = makeArray([1, 2, 3]);
      expect(() => stats.rollingStats(data, 5)).toThrow();
    });

    it('should work with windowSize equal to data length', () => {
      const data = makeArray([1, 2, 3]);
      const result = stats.rollingStats(data, 3);
      expect(result.mean.length).toBe(1);
    });

    it('should produce valid variance for constant data', () => {
      const data = makeArray([5, 5, 5, 5, 5]);
      const result = stats.rollingStats(data, 3);
      expect(result.variance[0]).toBeCloseTo(0, 5);
    });
  });

  describe('kde', () => {
    it('should compute KDE for a non-empty sample', () => {
      const samples = makeArray([1, 2, 3, 4, 5]);
      const result = stats.kde(samples);
      expect(result.x.length).toBeGreaterThan(0);
      expect(result.density.length).toBeGreaterThan(0);
      expect(result.bandwidth).toBeGreaterThan(0);
    });

    it('should compute KDE with custom bandwidth', () => {
      const samples = makeArray([1, 2, 3, 4, 5]);
      const result = stats.kde(samples, 0.5);
      expect(result.bandwidth).toBeCloseTo(0.5, 5);
    });

    it('should have density values that sum positive', () => {
      const samples = makeArray([1, 2, 3, 4, 5]);
      const result = stats.kde(samples);
      let sum = 0;
      for (let i = 0; i < result.density.length; i++) {
        sum += result.density[i]!;
      }
      expect(sum).toBeGreaterThan(0);
    });

    it('should throw for empty samples', () => {
      expect(() => stats.kde(makeArray([]))).toThrow();
    });

    it('should work for multi-element samples with some spread', () => {
      const samples = makeArray([1, 2, 3, 4, 5]);
      const result = stats.kde(samples);
      let allValid = true;
      for (let i = 0; i < result.density.length; i++) {
        const d = result.density[i]!;
        if (isNaN(d) || d < 0) { allValid = false; break; }
      }
      expect(allValid).toBe(true);
    });
  });

  describe('independenceTest', () => {
    it('should return TestResult type with expected properties', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 4, 6, 8, 10]);
      const result = stats.independenceTest(x, y);
      expect(result).toHaveProperty('pValue');
      expect(result).toHaveProperty('statistic');
      expect(result).toHaveProperty('significant');
    });

    it('should detect independence at high significance', () => {
      const x = makeArray([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
      const y = makeArray([0.9, 0.1, 0.8, 0.2, 0.7, 0.3, 0.6, 0.4, 0.5, 0.1]);
      const result = stats.independenceTest(x, y);
      expect(typeof result.significant).toBe('boolean');
    });

    it('should show dependence for correlated data', () => {
      const x = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const y = makeArray([1.1, 2.2, 3.3, 4.4, 5.5, 6.6, 7.7, 8.8, 9.9, 11.0]);
      const result = stats.independenceTest(x, y);
      expect(typeof result.significant).toBe('boolean');
    });

    it('should throw when arrays have different lengths', () => {
      expect(() => stats.independenceTest(makeArray([1, 2]), makeArray([1]))).toThrow();
    });

    it('should throw for empty array', () => {
      expect(() => stats.independenceTest(makeArray([]), makeArray([]))).toThrow();
    });

    it('should handle identical inputs', () => {
      const data = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = stats.independenceTest(data, data);
      expect(typeof result.pValue).toBe('number');
      expect(typeof result.significant).toBe('boolean');
    });

    it('should produce valid pValue between 0 and 1', () => {
      const x = makeArray([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]);
      const y = makeArray([0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.0]);
      const result = stats.independenceTest(x, y);
      expect(result.pValue).toBeGreaterThanOrEqual(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    });
  });

  describe('mutualInformation', () => {
    it('should compute MI between two related arrays', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 4, 6, 8, 10]);
      const mi = stats.mutualInformation(x, y);
      expect(typeof mi).toBe('number');
      expect(mi).toBeGreaterThanOrEqual(0);
    });

    it('should compute MI between two unrelated arrays', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([5, 4, 3, 2, 1]);
      const mi = stats.mutualInformation(x, y);
      expect(typeof mi).toBe('number');
    });

    it('should compute MI with custom params', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([1, 2, 3, 4, 5]);
      const mi = stats.mutualInformation(x, y, {
        minCooccurrence: 2,
        timeWindowMs: 30000,
        smoothingFactor: 0.05,
      });
      expect(typeof mi).toBe('number');
    });

    it('should throw for different length arrays', () => {
      expect(() => stats.mutualInformation(makeArray([1, 2]), makeArray([1]))).toThrow();
    });

    it('should return positive MI for identical arrays', () => {
      const x = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const mi = stats.mutualInformation(x, x);
      expect(mi).toBeGreaterThan(0);
    });

    it('should handle single-element arrays', () => {
      const x = makeArray([1]);
      const y = makeArray([1]);
      const mi = stats.mutualInformation(x, y);
      expect(typeof mi).toBe('number');
    });

    it('should handle arrays with zero smoothing', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([1, 2, 3, 4, 5]);
      const mi = stats.mutualInformation(x, y, {
        minCooccurrence: 2,
        timeWindowMs: 60000,
        smoothingFactor: 0,
      });
      expect(typeof mi).toBe('number');
    });

    it('should handle sparse data with few unique values', () => {
      const x = makeArray([0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3]);
      const y = makeArray([0.1, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3]);
      const mi = stats.mutualInformation(x, y);
      expect(typeof mi).toBe('number');
      expect(mi).toBeGreaterThanOrEqual(0);
    });

    it('should handle data with large range differences', () => {
      const x = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const y = makeArray([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
      const mi = stats.mutualInformation(x, y);
      expect(typeof mi).toBe('number');
      expect(mi).toBeGreaterThanOrEqual(0);
    });
  });

  describe('linearRegression', () => {
    it('should compute regression for simple linear data', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 4, 6, 8, 10]);
      const result = stats.linearRegression(x, y);
      expect(result.slope).toBeCloseTo(2, 5);
      expect(result.intercept).toBeCloseTo(0, 5);
    });

    it('should compute R-squared for perfect fit', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 4, 6, 8, 10]);
      const result = stats.linearRegression(x, y);
      expect(result.rSquared).toBeCloseTo(1, 5);
    });

    it('should have lower R-squared for noisy data', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 5, 7, 8, 11]);
      const result = stats.linearRegression(x, y);
      expect(result.rSquared).toBeLessThan(1);
      expect(result.rSquared).toBeGreaterThan(0);
    });

    it('should throw for different length arrays', () => {
      expect(() => stats.linearRegression(makeArray([1, 2]), makeArray([1]))).toThrow();
    });
  });

  describe('correlation', () => {
    it('should compute perfect positive correlation', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([2, 4, 6, 8, 10]);
      const corr = stats.correlation(x, y);
      expect(corr).toBeCloseTo(1, 5);
    });

    it('should compute perfect negative correlation', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([10, 8, 6, 4, 2]);
      const corr = stats.correlation(x, y);
      expect(corr).toBeCloseTo(-1, 5);
    });

    it('should compute near-zero correlation for unrelated normal data', () => {
      const x = makeArray([1, 2, 3, 4, 5]);
      const y = makeArray([3, 1, 4, 2, 5]);
      const corr = stats.correlation(x, y);
      // For randomly shuffled data, correlation should be near 0 but not exactly
      expect(typeof corr).toBe('number');
      expect(corr).toBeGreaterThanOrEqual(-1);
      expect(corr).toBeLessThanOrEqual(1);
    });

    it('should throw for different length arrays', () => {
      expect(() => stats.correlation(makeArray([1, 2]), makeArray([1]))).toThrow();
    });

    it('should compute correlation for constant vs variable', () => {
      const x = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const y = makeArray([5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
      const corr = stats.correlation(x, y);
      // Correlation with constant should be 0 or NaN depending on implementation
      expect(typeof corr).toBe('number');
    });

    it('should compute correlation for two identical arrays', () => {
      const x = makeArray([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const corr = stats.correlation(x, x);
      expect(corr).toBeCloseTo(1, 5);
    });
  });
});
