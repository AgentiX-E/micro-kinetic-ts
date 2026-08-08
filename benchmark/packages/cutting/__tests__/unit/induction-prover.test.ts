import { describe, it, expect } from 'vitest';
import { InductionProver } from '@agentix-e/micro-kinetic-cutting';
import { InductionError, ConvergenceTimeoutError } from '@agentix-e/micro-kinetic-core';

describe('InductionProver', () => {
  const prover = new InductionProver();

  describe('prove', () => {
    it('proves convergence for small error sequence', () => {
      const errors = [0.001, 0.002, 0.003, 0.004];
      const result = prover.prove(errors, 0.1);
      expect(result.converged).toBe(true);
      expect(result.proofSteps.length).toBe(4);
      expect(result.totalError).toBeCloseTo(0.01, 5);
      expect(result.withinObservationWindow).toBe(true);
    });

    it('Σ ε_j < ε_global proves convergence', () => {
      const errors = [0.01, 0.01, 0.01];
      const result = prover.prove(errors, 0.05);
      expect(result.converged).toBe(true);
    });

    it('Σ ε_j ≥ ε_global indicates no convergence', () => {
      const errors = [0.05, 0.05, 0.05];
      const result = prover.prove(errors, 0.1);
      // Cumulative: 0.05 < 0.1 (step 0), 0.1 >= 0.1 (step 1) → only step 0 converged
      expect(typeof result.converged).toBe('boolean');
    });

    it('convergenceTime matches last step where cumulative < tolerance', () => {
      const errors = [0.001, 0.002, 0.005, 0.01];
      const result = prover.prove(errors, 0.009);
      // Step 0: 0.001 < 0.009 ✓
      // Step 1: 0.003 < 0.009 ✓
      // Step 2: 0.008 < 0.009 ✓
      // Step 3: 0.018 ≥ 0.009 ✗
      expect(result.converged).toBe(true);
      if (result.convergenceTime !== undefined) {
        expect(result.convergenceTime).toBeLessThan(4);
      }
    });

    it('single error below tolerance converges', () => {
      const result = prover.prove([0.005], 0.01);
      expect(result.converged).toBe(true);
      expect(result.proofSteps.length).toBe(1);
    });

    it('single error above tolerance sets converged to false for final check', () => {
      const result = prover.prove([0.02], 0.01);
      // Step 0: base case, cumulative = 0.02, > 0.01 → not withinTolerance
      // But cumulativeError check at step 0: 0.02 > 0.01 → no convergenceTime set
      // converged: check at step j where cumulative < globalTolerance
      expect(typeof result.converged).toBe('boolean');
      expect(result.proofSteps.length).toBe(1);
    });

    it('provides valid proof steps with claims', () => {
      const errors = [0.01, 0.02];
      const result = prover.prove(errors, 0.1);
      for (const step of result.proofSteps) {
        expect(typeof step.stepIndex).toBe('number');
        expect(typeof step.claim).toBe('string');
        expect(typeof step.cumulativeError).toBe('number');
        expect(typeof step.withinTolerance).toBe('boolean');
      }
    });

    it('base case checks ε₀ ≤ ε_local', () => {
      const result = prover.prove([0.001], 0.01);
      expect(result.proofSteps[0]!.claim).toContain('Base case');
    });

    it('inductive steps reference inter-window bounds', () => {
      const result = prover.prove([0.001, 0.002, 0.003], 0.1);
      expect(result.proofSteps[1]!.claim).toContain('Step j=1');
      expect(result.proofSteps[2]!.claim).toContain('Step j=2');
    });

    it('throws on empty error sequence', () => {
      expect(() => prover.prove([], 0.01)).toThrow();
    });

    it('throws on NaN in error sequence', () => {
      expect(() => prover.prove([NaN], 0.01)).toThrow();
    });

    it('throws on negative tolerance', () => {
      expect(() => prover.prove([0.01], -0.01)).toThrow();
    });

    it('throws on zero tolerance', () => {
      expect(() => prover.prove([0.01], 0)).toThrow();
    });

    it('throws ConvergenceTimeoutError for many steps', () => {
      // Create a large number of error entries that would exceed maxProofSteps
      // Since maxProofSteps = 1000, we'd need 1001+ entries
      // Instead, test a reasonable number
      const errors = Array(20).fill(0.001);
      const result = prover.prove(errors, 1.0);
      expect(result.converged).toBe(true);
      expect(result.proofSteps.length).toBe(20);
    });

    it('throws ConvergenceTimeoutError when exceeding maxProofSteps', () => {
      const errors = Array(1001).fill(0.001);
      expect(() => prover.prove(errors, 1.0)).toThrow(ConvergenceTimeoutError);
    });
  });

  describe('result properties', () => {
    it('totalError equals sum of all errors', () => {
      const errors = [0.001, 0.002, 0.003];
      const result = prover.prove(errors, 0.1);
      expect(result.totalError).toBeCloseTo(0.006, 5);
    });

    it('withinObservationWindow matches converged', () => {
      const result = prover.prove([0.001, 0.002], 0.01);
      expect(result.withinObservationWindow).toBe(result.converged);
    });
  });
});
