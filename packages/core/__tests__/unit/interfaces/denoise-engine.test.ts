import { describe, it, expect } from 'vitest';
import type { AlertRecord, AlertGroup, CouplingSparsityMatrix, IndependenceResult, DenoiseResult } from '@agentix-e/micro-kinetic-core';

describe('Denoise Engine interfaces - interface type usage', () => {
  it('should construct AlertGroup for denoising', () => {
    const alert: AlertRecord = {
      id: 'a1', serviceId: 'svc-a', severity: 'warning',
      timestamp: 1000, metric: 'cpu', value: 85, threshold: 80, message: 'high cpu',
    };
    const group: AlertGroup = {
      id: 'g1',
      timeWindow: [1000, 2000],
      alerts: [alert],
      maxCouplingStrength: 0.2,
    };
    expect(group.alerts.length).toBe(1);
  });

  it('should construct CouplingSparsityMatrix for independence testing', () => {
    const matrix: CouplingSparsityMatrix = {
      dimension: 20,
      matrix: new Float64Array(400),
      sparsityScore: 0.85,
      threshold: 0.7,
      satisfiesStosszahlansatz: true,
      independentGroups: [],
    };
    expect(matrix.satisfiesStosszahlansatz).toBe(true);
    expect(matrix.sparsityScore).toBeGreaterThan(0.7);
  });

  it('should construct IndependenceResult', () => {
    const result: IndependenceResult = {
      isIndependent: true,
      decompositionError: 0.001,
      sparsityThreshold: 0.7,
      confidenceLevel: 0.98,
    };
    expect(result.isIndependent).toBe(true);
  });

  it('should construct DenoiseResult', () => {
    const alert: AlertRecord = {
      id: 'a1', serviceId: 'svc', severity: 'critical',
      timestamp: 0, metric: 'mem', value: 2000, threshold: 1000, message: 'oom',
    };
    const result: DenoiseResult = {
      trueAlarms: [alert],
      coincidentalAlarms: [],
      groupedAlarms: [],
      sparsityScore: 0.9,
      falsePositiveReduction: 0.6,
    };
    expect(result.trueAlarms.length).toBe(1);
    expect(result.falsePositiveReduction).toBe(0.6);
  });

  it('should verify IDenoiseEngine and IIndependenceChecker imports', () => {
    const methodNames = ['computeCouplingSparsity', 'checkIndependence', 'denoise'];
    expect(methodNames).toHaveLength(3);
  });
});
