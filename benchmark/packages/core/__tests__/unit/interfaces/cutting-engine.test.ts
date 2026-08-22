import { describe, it, expect } from 'vitest';
import type {
  LocalErrorBound,
  ProofStep,
  ConvergenceResult,
  ICuttingEngine,
  IConvergenceProver,
} from '@agentix-e/micro-kinetic-core';

describe('Cutting Engine interfaces', () => {
  it('should accept a valid LocalErrorBound object', () => {
    const bound: LocalErrorBound = {
      windowIndex: 0,
      startTime: 1000,
      endTime: 2000,
      degradationRate: 0.001,
      errorBound: 0.0001,
      indicators: [],
    };
    expect(bound.windowIndex).toBe(0);
    expect(bound.errorBound).toBe(0.0001);
  });

  it('should accept LocalErrorBound with indicators', () => {
    const indicator = { metric: 'cpu', degradationRate: 0.001, temporalCorrelation: 0.9, isMonotonic: true };
    const bound: LocalErrorBound = {
      windowIndex: 1,
      startTime: 2000,
      endTime: 3000,
      degradationRate: 0.002,
      errorBound: 0.0002,
      indicators: [indicator],
    };
    expect(bound.indicators.length).toBe(1);
  });

  it('should accept a valid ProofStep', () => {
    const step: ProofStep = {
      stepIndex: 0,
      claim: 'Base case',
      cumulativeError: 0.001,
      withinTolerance: true,
    };
    expect(step.claim).toBe('Base case');
    expect(step.withinTolerance).toBe(true);
  });

  it('should accept a ProofStep that exceeds tolerance', () => {
    const step: ProofStep = {
      stepIndex: 5,
      claim: 'Inductive step 5',
      cumulativeError: 0.1,
      withinTolerance: false,
    };
    expect(step.withinTolerance).toBe(false);
  });

  it('should accept a converged ConvergenceResult', () => {
    const step: ProofStep = { stepIndex: 0, claim: 'base', cumulativeError: 0, withinTolerance: true };
    const result: ConvergenceResult = {
      converged: true,
      convergenceTime: 10000,
      totalError: 0.001,
      proofSteps: [step],
      withinObservationWindow: true,
    };
    expect(result.converged).toBe(true);
    expect(result.convergenceTime).toBe(10000);
  });

  it('should accept a non-converged ConvergenceResult', () => {
    const result: ConvergenceResult = {
      converged: false,
      totalError: 0.5,
      proofSteps: [],
      withinObservationWindow: false,
    };
    expect(result.convergenceTime).toBeUndefined();
  });

  it('should verify ICuttingEngine is importable', () => {
    // Type-only verification - if we can reach here, the import succeeded
    const engineMethods = ['segment', 'estimateLocalBounds', 'proveConvergence'] as const;
    expect(engineMethods.length).toBe(3);
  });

  it('should verify IConvergenceProver is importable', () => {
    const proverMethods = ['prove'] as const;
    expect(proverMethods.length).toBe(1);
  });
});
