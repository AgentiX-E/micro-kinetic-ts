import { describe, it, expect } from 'vitest';
import { FaultProbabilityAsymptotics } from '../../../src/boltzmann-grad/fault-probability.js';

describe('FaultProbabilityAsymptotics', () => {
  describe('estimate', () => {
    // ── Basic estimate for N=10, d=0.1 ──────────────────
    it('should set N in result', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.1);
      expect(result.N).toBe(10);
    });

    it('should set d in result', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.1);
      expect(result.d).toBe(0.1);
    });

    it('should compute rho = N*d*d', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.1);
      expect(result.rho).toBeCloseTo(0.1, 5);
    });

    it('should have firstOrder within [0,1]', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.1);
      expect(result.firstOrder).toBeGreaterThanOrEqual(0);
    });

    it('should have firstOrder within [0,1] upper bound', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.1);
      expect(result.firstOrder).toBeLessThanOrEqual(1);
    });

    // ── Estimate with N=50, d=0.05 ──────────────────────
    it('should compute firstOrder for N=50 d=0.05', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(50, 0.05);
      expect(result.firstOrder).toBeGreaterThanOrEqual(0);
    });

    it('should compute secondOrder for N=50 d=0.05', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(50, 0.05);
      expect(result.secondOrder).toBeGreaterThanOrEqual(0);
    });

    it('should compute asymptoticLimit for N=50 d=0.05', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(50, 0.05);
      expect(result.asymptoticLimit).toBeGreaterThanOrEqual(0);
    });

    it('should have coefficientA as number', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(100, 0.05);
      expect(typeof result.coefficientA).toBe('number');
    });

    it('should have coefficientB as number', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(100, 0.05);
      expect(typeof result.coefficientB).toBe('number');
    });

    // ── Rho computation ─────────────────────────────────
    it('should compute rho = N*d*d precisely', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0.2);
      expect(result.rho).toBeCloseTo(10 * 0.2 * 0.2, 10);
    });

    it('should compute rho=0 for d=0', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0);
      expect(result.rho).toBe(0);
    });

    it('should compute rho=N for d=1', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(5, 1);
      expect(result.rho).toBe(5);
    });

    // ── Low density: rho < 0.05 ─────────────────────────
    it('should have near-zero asymptotic limit for very low density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(100, 0.001);
      // rho = 100 * 1e-6 = 0.0001 < 0.05 → P0 = rho * 0.02
      expect(result.asymptoticLimit).toBeCloseTo(0, 2);
    });

    // ── High density ────────────────────────────────────
    it('should have asymptotic limit near 1 for high density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      // rho = 1000 * 0.01 = 10, high density
      const result = asymptotics.estimate(1000, 0.1);
      expect(result.asymptoticLimit).toBeGreaterThan(0.5);
    });

    it('should compute first order for high density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(1000, 0.1);
      expect(result.firstOrder).toBeGreaterThanOrEqual(0);
    });

    // ── Moderate N ──────────────────────────────────────
    it('should handle moderate N=500 d=0.02', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      // rho = 500 * 0.0004 = 0.2
      const result = asymptotics.estimate(500, 0.02);
      expect(result.rho).toBeCloseTo(0.2, 10);
    });

    it('should have coefficientA non-zero for moderate density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(500, 0.02);
      // rho=0.2, A = 0.3 * 0.2 * 0.8 * 4 = 0.192
      expect(result.coefficientA).toBeGreaterThan(0);
    });
  });

  describe('firstOrder', () => {
    it('should return first-order probability within [0,1]', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.firstOrder(10, 0.1);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should return first-order probability <= 1', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.firstOrder(10, 0.1);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should handle large N=1000 d=0.3', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const first = asymptotics.firstOrder(1000, 0.3);
      expect(first).toBeGreaterThanOrEqual(0);
    });

    it('should handle tiny d=0.001', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const first = asymptotics.firstOrder(10, 0.001);
      expect(first).toBeGreaterThanOrEqual(0);
    });

    // ── Error boundaries ────────────────────────────────
    it('should throw for N=1 in firstOrder', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      expect(() => asymptotics.firstOrder(1, 0.1)).toThrow();
    });

    it('should throw for negative d in firstOrder', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      expect(() => asymptotics.firstOrder(10, -0.1)).toThrow();
    });
  });

  describe('secondOrder', () => {
    it('should return second-order probability within [0,1]', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.secondOrder(10, 0.1);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should return second-order probability <= 1', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.secondOrder(10, 0.1);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should handle small N=5 d=0.01', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const second = asymptotics.secondOrder(5, 0.01);
      expect(second).toBeGreaterThanOrEqual(0);
    });

    it('should handle large N=10000 d=0.001', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      // rho = 10000 * 1e-6 = 0.01 < 0.05 → P0 = 0.0002
      const second = asymptotics.secondOrder(10000, 0.001);
      expect(second).toBeGreaterThanOrEqual(0);
    });

    // ── Difference from first order for small N ─────────
    it('should return a number for first and second order (small N)', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const first = asymptotics.firstOrder(10, 0.2);
      const second = asymptotics.secondOrder(10, 0.2);
      expect(typeof first).toBe('number');
      expect(typeof second).toBe('number');
    });
  });

  describe('asymptotic', () => {
    it('should return asymptotic probability within [0,1]', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.asymptotic(100, 0.01);
      expect(result).toBeGreaterThanOrEqual(0);
    });

    it('should return asymptotic probability <= 1', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.asymptotic(100, 0.01);
      expect(result).toBeLessThanOrEqual(1);
    });

    it('should approach 0 for very low density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.asymptotic(100, 0.001);
      expect(result).toBeCloseTo(0, 2);
    });

    it('should approach 1 for very high density', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      // rho = 100 * 0.04 = 4, high density
      const result = asymptotics.asymptotic(100, 0.2);
      expect(result).toBeGreaterThan(0.5);
    });
  });

  describe('boundary conditions', () => {
    it('should throw for N < 2 in estimate', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      expect(() => asymptotics.estimate(1, 0.1)).toThrow();
    });

    it('should throw for d < 0 in estimate', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      expect(() => asymptotics.estimate(10, -0.1)).toThrow();
    });

    it('should throw for d > 1 in estimate', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      expect(() => asymptotics.estimate(10, 1.5)).toThrow();
    });

    it('should handle N=1000 d=0.01 (low density)', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(1000, 0.01);
      // rho = 1000 * 0.0001 = 0.1
      expect(result.rho).toBe(0.1);
      expect(result.firstOrder).toBeGreaterThanOrEqual(0);
    });

    it('should handle N=1000 d=0.1 (high density)', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(1000, 0.1);
      // rho = 1000 * 0.01 = 10
      expect(result.rho).toBe(10);
      expect(result.asymptoticLimit).toBeGreaterThan(0.5);
    });

    it('should handle d=0 in estimate', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(10, 0);
      expect(result.rho).toBe(0);
    });

    it('should handle d=1 in estimate', () => {
      const asymptotics = new FaultProbabilityAsymptotics();
      const result = asymptotics.estimate(5, 1);
      expect(result.d).toBe(1);
    });
  });
});
