import { describe, it, expect } from 'vitest';
import {
  InductionError,
  ConvergenceTimeoutError,
  InvalidWindowError,
  KineticError,
} from '@agentix-e/micro-kinetic-core';

describe('InductionError', () => {
  it('should create with failedStep, accumulatedError, and tolerance', () => {
    const err = new InductionError(5, 0.15, 0.1);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('InductionError');
    expect(err.errorCode).toBe('INDUCTION_ERROR');
    expect(err.failedStep).toBe(5);
    expect(err.accumulatedError).toBe(0.15);
    expect(err.tolerance).toBe(0.1);
  });

  it('should include step and error info in message', () => {
    const err = new InductionError(3, 0.05, 0.01);
    expect(err.message).toContain('3');
    expect(err.message).toContain('0.05');
    expect(err.message).toContain('0.01');
  });

  it('should detect when accumulated error exceeds tolerance', () => {
    const err = new InductionError(10, 0.5, 0.2);
    expect(err.accumulatedError).toBeGreaterThan(err.tolerance);
  });

  it('should handle edge case where error equals tolerance', () => {
    const err = new InductionError(1, 0.1, 0.1);
    expect(err.accumulatedError).toBe(err.tolerance);
  });

  it('should handle large step numbers', () => {
    const err = new InductionError(1000, 1.0, 0.01);
    expect(err.failedStep).toBe(1000);
  });

  it('should chain to KineticError', () => {
    const err = new InductionError(1, 0.1, 0.01);
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('ConvergenceTimeoutError', () => {
  it('should create with stepsAttempted and maxSteps', () => {
    const err = new ConvergenceTimeoutError(100, 100);
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('ConvergenceTimeoutError');
    expect(err.errorCode).toBe('CONVERGENCE_TIMEOUT');
    expect(err.stepsAttempted).toBe(100);
  });

  it('should include steps in message', () => {
    const err = new ConvergenceTimeoutError(50, 200);
    expect(err.message).toContain('50');
    expect(err.message).toContain('200');
  });

  it('should handle zero steps attempted', () => {
    const err = new ConvergenceTimeoutError(0, 10);
    expect(err.stepsAttempted).toBe(0);
  });

  it('should chain correctly', () => {
    const err = new ConvergenceTimeoutError(10, 50);
    expect(err instanceof KineticError).toBe(true);
  });
});

describe('InvalidWindowError', () => {
  it('should create with message', () => {
    const err = new InvalidWindowError('Window start must be before end');
    expect(err).toBeInstanceOf(KineticError);
    expect(err.name).toBe('InvalidWindowError');
    expect(err.message).toBe('Window start must be before end');
    expect(err.errorCode).toBe('INVALID_WINDOW');
  });

  it('should handle empty window message', () => {
    const err = new InvalidWindowError('Empty window detected');
    expect(err.message).toBe('Empty window detected');
  });

  it('should chain correctly', () => {
    const err = new InvalidWindowError('Bad window');
    expect(err instanceof KineticError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});
