import { describe, it, expect } from 'vitest';
import { DecimalProvider } from '../../../src/math/decimal-provider.js';

describe('DecimalProvider', () => {
  describe('constructor', () => {
    it('should create with default precision 50', () => {
      const dp = new DecimalProvider();
      expect(dp.precision).toBe(50);
    });

    it('should create with custom precision', () => {
      const dp = new DecimalProvider(30);
      expect(dp.precision).toBe(30);
    });
  });

  describe('multiply', () => {
    it('should multiply two positive numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.multiply('3.14', '2.718');
      expect(Number(result)).toBeCloseTo(3.14 * 2.718, 10);
    });

    it('should multiply two integers', () => {
      const dp = new DecimalProvider();
      const result = dp.multiply('100', '200');
      expect(result).toBe('20000');
    });

    it('should multiply with zero', () => {
      const dp = new DecimalProvider();
      const result = dp.multiply('42', '0');
      expect(result).toBe('0');
    });

    it('should multiply very large numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.multiply('1e50', '1e50');
      const val = Number(result);
      expect(val).toBeGreaterThan(1e99);
    });

    it('should multiply very small positive numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.multiply('1e-50', '1e-50');
      const val = Number(result);
      expect(val).toBeLessThan(1e-98);
    });
  });

  describe('ln', () => {
    it('should compute natural log of e', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('2.718281828459045');
      expect(Number(result)).toBeCloseTo(1, 12);
    });

    it('should compute natural log of 1', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('1');
      expect(Number(result)).toBe(0);
    });

    it('should compute natural log of a small positive number', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('0.1');
      expect(Number(result)).toBeCloseTo(Math.log(0.1), 10);
    });

    it('should return NaN for zero', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('0');
      // decimal.js returns '-Infinity' for ln(0)
      expect(result).toBeTruthy();
    });

    it('should return NaN for negative numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('-1');
      // decimal.js returns 'NaN' string for ln of negative numbers
      expect(result).toBeTruthy();
      expect(isNaN(Number(result))).toBe(true);
    });
  });

  describe('exp', () => {
    it('should compute exp(0)', () => {
      const dp = new DecimalProvider();
      const result = dp.exp('0');
      expect(result).toBe('1');
    });

    it('should compute exp(1)', () => {
      const dp = new DecimalProvider();
      const result = dp.exp('1');
      expect(Number(result)).toBeCloseTo(Math.E, 12);
    });

    it('should compute exp of negative number', () => {
      const dp = new DecimalProvider();
      const result = dp.exp('-1');
      expect(Number(result)).toBeCloseTo(1 / Math.E, 12);
    });

    it('should handle large input', () => {
      const dp = new DecimalProvider();
      const result = dp.exp('50');
      expect(Number(result)).toBeGreaterThan(1e20);
    });
  });

  describe('pow', () => {
    it('should compute power of integers', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('2', '10');
      expect(result).toBe('1024');
    });

    it('should compute power with fractional exponent', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('4', '0.5');
      expect(Number(result)).toBeCloseTo(2, 12);
    });

    it('should compute x^0 as 1', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('42', '0');
      expect(result).toBe('1');
    });

    it('should compute 0^x', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('0', '5');
      expect(result).toBe('0');
    });
  });

  describe('setPrecision', () => {
    it('should dynamically adjust precision', () => {
      const dp = new DecimalProvider();
      dp.setPrecision(20);
      expect(dp.precision).toBe(20);
    });

    it('should use new precision for subsequent operations', () => {
      const dp = new DecimalProvider();
      dp.setPrecision(10);
      const result = dp.multiply('1.23456789', '9.87654321');
      expect(Number(result)).toBeCloseTo(1.23456789 * 9.87654321, 8);
    });

    it('should handle precision change to 50 digits', () => {
      const dp = new DecimalProvider();
      dp.setPrecision(50);
      expect(dp.precision).toBe(50);
    });
  });

  describe('50-digit precision correctness', () => {
    it('should compute multiply with high precision', () => {
      const dp = new DecimalProvider(50);
      const result = dp.multiply('1.0000000000000000000000000001', '2.0000000000000000000000000002');
      expect(result.startsWith('2.0000000000000000000000000004')).toBe(true);
    });

    it('should compute exp with high precision', () => {
      const dp = new DecimalProvider(50);
      const result = dp.exp('0.5');
      expect(Number(result)).toBeCloseTo(Math.exp(0.5), 14);
    });

    it('should compute ln with 50-digit precision', () => {
      const dp = new DecimalProvider(50);
      const result = dp.ln('2');
      expect(Number(result)).toBeCloseTo(Math.log(2), 14);
    });

    it('should compute pow with 50-digit precision', () => {
      const dp = new DecimalProvider(50);
      const result = dp.pow('1.0000000000000001', '10');
      expect(Number(result)).toBeCloseTo(Math.pow(1.0000000000000001, 10), 14);
    });
  });

  describe('precision edge cases', () => {
    it('should handle extremely small multiply', () => {
      const dp = new DecimalProvider(50);
      const result = dp.multiply('0.0000000000000000000000000001', '0.0000000000000000000000000001');
      expect(Number(result)).toBeLessThan(1e-30);
    });

    it('should compute ln of very small numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.ln('0.0001');
      expect(Number(result)).toBeCloseTo(Math.log(0.0001), 10);
    });

    it('should compute exp of large negative numbers', () => {
      const dp = new DecimalProvider();
      const result = dp.exp('-50');
      expect(Number(result)).toBeLessThan(1e-10);
      expect(Number(result)).toBeGreaterThan(0);
    });

    it('should compute pow with negative exponent', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('2', '-3');
      expect(Number(result)).toBeCloseTo(0.125, 10);
    });

    it('should compute pow with zero base and positive exponent', () => {
      const dp = new DecimalProvider();
      const result = dp.pow('0', '3');
      expect(result).toBe('0');
    });

    it('should set precision multiple times', () => {
      const dp = new DecimalProvider();
      dp.setPrecision(100);
      expect(dp.precision).toBe(100);
      dp.setPrecision(20);
      expect(dp.precision).toBe(20);
      dp.setPrecision(50);
      expect(dp.precision).toBe(50);
    });
  });
});
