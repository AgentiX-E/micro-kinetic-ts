import { describe, expect, it } from 'vitest';
import { ConvergenceChecker } from '../../src/convergence-checker.js';
import type { GPPrediction } from '../../src/gaussian-process.js';

function pred(mean: number, variance: number): GPPrediction {
  return { mean, variance, std: Math.sqrt(variance) };
}

describe('ConvergenceChecker', () => {
  it('should not converge when variance is high', () => {
    const checker = new ConvergenceChecker({ epsilonVariance: 0.005 });
    const result = checker.checkConvergence(
      [pred(0.5, 0.1), pred(0.6, 0.08)],
      0.7,
      1,
    );
    expect(result).toBe(false);
    expect(checker.currentState.consecutiveConverged).toBe(0);
  });

  it('should not converge without patience', () => {
    const checker = new ConvergenceChecker({ patience: 3 });
    // First: low variance but not enough patience
    const r1 = checker.checkConvergence([pred(0.5, 0.001)], 0.7, 1);
    expect(r1).toBe(false); // Requires patience=3, only 1 iteration
    expect(checker.currentState.consecutiveConverged).toBe(1); // First iteration always stable
  });

  it('should converge after patience iterations', () => {
    const checker = new ConvergenceChecker({
      epsilonVariance: 0.01,
      epsilonMean: 0.02,
      patience: 2,
    });

    // Iteration 1: seed mean
    checker.checkConvergence([pred(0.8, 0.003), pred(0.8, 0.004)], 0.8, 1);
    // meanStable=true (no history), varianceConverged=true → bothCriteria=true → consecutiveConverged=1
    expect(checker.currentState.consecutiveConverged).toBe(1);

    // Iteration 2: same mean, low variance
    const r2 = checker.checkConvergence([pred(0.8, 0.002), pred(0.8, 0.003)], 0.8, 2);
    expect(r2).toBe(true);
    expect(checker.currentState.consecutiveConverged).toBe(2);
  });

  it('should reset after variance spike', () => {
    const checker2 = new ConvergenceChecker({
      epsilonVariance: 0.01,
      epsilonMean: 0.02,
      patience: 2,
    });

    checker2.checkConvergence([pred(0.8, 0.003)], 0.8, 1);
    expect(checker2.currentState.consecutiveConverged).toBe(1);

    // High variance → reset
    checker2.checkConvergence([pred(0.8, 0.5)], 0.8, 2);
    expect(checker2.currentState.consecutiveConverged).toBe(0);
  });

  it('should track best accuracy', () => {
    const checker = new ConvergenceChecker();
    checker.checkConvergence([pred(0.5, 0.001)], 0.7, 1);
    checker.checkConvergence([pred(0.5, 0.001)], 0.95, 2);
    checker.checkConvergence([pred(0.5, 0.001)], 0.6, 3);

    expect(checker.currentState.bestAccuracy).toBe(0.95);
    expect(checker.currentState.bestIteration).toBe(2);
  });

  it('should store variance and mean histories', () => {
    const checker = new ConvergenceChecker();
    checker.checkConvergence([pred(0.5, 0.01), pred(0.6, 0.02)], 0.7, 1);
    checker.checkConvergence([pred(0.5, 0.005), pred(0.6, 0.01)], 0.7, 2);

    expect(checker.currentState.varianceHistory).toHaveLength(2);
    expect(checker.currentState.meanHistory).toHaveLength(2);
    expect(checker.currentState.varianceHistory[1]).toBe(0.01);
  });

  it('should reset completely', () => {
    const checker = new ConvergenceChecker();
    checker.checkConvergence([pred(0.5, 0.001)], 0.9, 1);
    checker.checkConvergence([pred(0.5, 0.001)], 0.9, 2);

    checker.reset();
    expect(checker.currentState.consecutiveConverged).toBe(0);
    expect(checker.currentState.bestAccuracy).toBe(-Infinity);
    expect(checker.currentState.varianceHistory).toHaveLength(0);
  });

  it('should respect custom patience and thresholds', () => {
    const checker = new ConvergenceChecker({
      epsilonVariance: 0.05,
      epsilonMean: 0.1,
      patience: 1,
    });

    checker.checkConvergence([pred(0.7, 0.04), pred(0.7, 0.03)], 0.7, 1);
    // meanStable=true (no history), variance=0.04 < 0.05 → converge immediately
    expect(checker.currentState.consecutiveConverged).toBe(1);
  });
});
