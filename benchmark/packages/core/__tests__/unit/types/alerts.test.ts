import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STOSS_PARAMS,
} from '@agentix-e/micro-kinetic-core';
import type {
  AlertSeverity,
  AlertRecord,
  AlertGroup,
  CouplingSparsityMatrix,
  IndependenceResult,
  DenoiseResult,
} from '@agentix-e/micro-kinetic-core';

describe('Alert types - AlertRecord', () => {
  it('should accept a valid AlertRecord', () => {
    const alert: AlertRecord = {
      id: 'alert-001',
      serviceId: 'svc-a',
      severity: 'critical',
      timestamp: 1000000,
      metric: 'cpu_usage',
      value: 95,
      threshold: 80,
      message: 'CPU usage exceeds threshold',
    };
    expect(alert.id).toBe('alert-001');
    expect(alert.severity).toBe('critical');
    expect(alert.value).toBe(95);
  });

  it('should support all severity levels', () => {
    const severities: AlertSeverity[] = ['critical', 'warning', 'info'];
    for (const sev of severities) {
      const alert: AlertRecord = {
        id: 'a', serviceId: 'svc', severity: sev,
        timestamp: 0, metric: 'm', value: 0, threshold: 0, message: '',
      };
      expect(alert.severity).toBe(sev);
    }
  });
});

describe('Alert types - AlertGroup', () => {
  it('should accept a valid AlertGroup', () => {
    const alerts: AlertRecord[] = [{
      id: 'a1', serviceId: 'svc-a', severity: 'warning',
      timestamp: 1000, metric: 'cpu', value: 80, threshold: 70, message: 'warning',
    }];
    const group: AlertGroup = {
      id: 'group-1',
      timeWindow: [1000, 2000],
      alerts,
      maxCouplingStrength: 0.3,
    };
    expect(group.id).toBe('group-1');
    expect(group.maxCouplingStrength).toBe(0.3);
    expect(group.alerts.length).toBe(1);
  });
});

describe('Alert types - CouplingSparsityMatrix', () => {
  it('should accept a matrix that satisfies Stosszahlansatz', () => {
    const matrix: CouplingSparsityMatrix = {
      dimension: 10,
      matrix: new Float64Array(100).fill(0),
      sparsityScore: 0.9,
      threshold: 0.7,
      satisfiesStosszahlansatz: true,
      independentGroups: [['svc-a']],
    };
    expect(matrix.satisfiesStosszahlansatz).toBe(true);
    expect(matrix.sparsityScore).toBe(0.9);
  });

  it('should accept a matrix that does not satisfy Stosszahlansatz', () => {
    const matrix: CouplingSparsityMatrix = {
      dimension: 5,
      matrix: new Float64Array(25).fill(0.5),
      sparsityScore: 0.3,
      threshold: 0.7,
      satisfiesStosszahlansatz: false,
      independentGroups: [],
    };
    expect(matrix.satisfiesStosszahlansatz).toBe(false);
  });

  it('should have dimension matching matrix length', () => {
    const dim = 4;
    const matrix: CouplingSparsityMatrix = {
      dimension: dim,
      matrix: new Float64Array(dim * dim),
      sparsityScore: 1,
      threshold: 0.7,
      satisfiesStosszahlansatz: true,
      independentGroups: [],
    };
    expect(matrix.matrix.length).toBe(dim * dim);
  });
});

describe('Alert types - IndependenceResult', () => {
  it('should accept an independent result', () => {
    const r: IndependenceResult = {
      isIndependent: true,
      decompositionError: 0.001,
      sparsityThreshold: 0.7,
      confidenceLevel: 0.99,
    };
    expect(r.isIndependent).toBe(true);
    expect(r.decompositionError).toBe(0.001);
  });

  it('should accept a dependent result', () => {
    const r: IndependenceResult = {
      isIndependent: false,
      decompositionError: 0.1,
      sparsityThreshold: 0.7,
      confidenceLevel: 0.8,
    };
    expect(r.isIndependent).toBe(false);
  });
});

describe('Alert types - DenoiseResult', () => {
  it('should accept a valid DenoiseResult', () => {
    const alert: AlertRecord = {
      id: 'a1', serviceId: 'svc-a', severity: 'critical',
      timestamp: 1000, metric: 'cpu', value: 90, threshold: 80, message: 'high',
    };
    const result: DenoiseResult = {
      trueAlarms: [alert],
      coincidentalAlarms: [],
      groupedAlarms: [],
      sparsityScore: 0.8,
      falsePositiveReduction: 0.5,
    };
    expect(result.trueAlarms.length).toBe(1);
    expect(result.coincidentalAlarms.length).toBe(0);
    expect(result.falsePositiveReduction).toBe(0.5);
  });

  it('should accept result with both true and coincidental alarms', () => {
    const na: AlertRecord = {
      id: 'n1', serviceId: 'svc', severity: 'info',
      timestamp: 0, metric: 'm', value: 0, threshold: 0, message: '',
    };
    const result: DenoiseResult = {
      trueAlarms: [na],
      coincidentalAlarms: [na],
      groupedAlarms: [],
      sparsityScore: 0.5,
      falsePositiveReduction: 0.3,
    };
    expect(result.trueAlarms.length).toBe(1);
    expect(result.coincidentalAlarms.length).toBe(1);
  });
});

describe('Alert types - DEFAULT_STOSS_PARAMS', () => {
  it('should export DEFAULT_STOSS_PARAMS', () => {
    expect(DEFAULT_STOSS_PARAMS).toBeDefined();
  });

  it('should have minSystemSize', () => {
    expect(DEFAULT_STOSS_PARAMS.minSystemSize).toBe(20);
  });

  it('should have sparsityThreshold', () => {
    expect(DEFAULT_STOSS_PARAMS.sparsityThreshold).toBe(0.7);
  });

  it('should have minConfidenceLevel', () => {
    expect(DEFAULT_STOSS_PARAMS.minConfidenceLevel).toBe(0.95);
  });

  it('should have maxDecompositionError', () => {
    expect(DEFAULT_STOSS_PARAMS.maxDecompositionError).toBe(0.05);
  });

  it('should have all expected keys', () => {
    const keys = Object.keys(DEFAULT_STOSS_PARAMS);
    expect(keys).toContain('minSystemSize');
    expect(keys).toContain('sparsityThreshold');
    expect(keys).toContain('minConfidenceLevel');
    expect(keys).toContain('maxDecompositionError');
  });
});
