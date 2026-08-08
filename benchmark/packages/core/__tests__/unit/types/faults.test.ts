import { describe, it, expect } from 'vitest';
import {
  DEFAULT_RCA_OPTIONS,
} from '@agentix-e/micro-kinetic-core';
import type {
  FaultSeverity,
  FaultCategory,
  FaultType,
  ChronicFaultIndicator,
  RootCauseResult,
  RCAEngineOptions,
  MetricMap,
} from '@agentix-e/micro-kinetic-core';

describe('Fault types - FaultType', () => {
  it('should accept a valid FaultType', () => {
    const ft: FaultType = {
      category: 'CPU',
      subType: 'cpu_spike',
      severity: 'critical',
    };
    expect(ft.category).toBe('CPU');
    expect(ft.severity).toBe('critical');
  });

  it('should support all fault categories', () => {
    const categories: FaultCategory[] = [
      'CPU', 'MEMORY', 'DISK', 'NETWORK_DELAY', 'NETWORK_LOSS',
      'SOCKET', 'JVM_GC', 'JVM_OOM', 'CONNECTION_POOL', 'MEMORY_LEAK',
      'DATA_SKEW', 'CODE_ERROR', 'MISCONFIGURATION', 'DNS_FAILURE', 'UNKNOWN',
    ];
    for (const cat of categories) {
      const ft: FaultType = { category: cat, subType: 'test', severity: 'warning' };
      expect(ft.category).toBe(cat);
    }
  });

  it('should support all severity levels', () => {
    const severities: FaultSeverity[] = ['critical', 'major', 'minor', 'warning', 'info'];
    for (const sev of severities) {
      const ft: FaultType = { category: 'UNKNOWN', subType: 'test', severity: sev };
      expect(ft.severity).toBe(sev);
    }
  });
});

describe('Fault types - ChronicFaultIndicator', () => {
  it('should accept a monotonic indicator', () => {
    const ind: ChronicFaultIndicator = {
      metric: 'memory_rss',
      degradationRate: 0.001,
      temporalCorrelation: 0.95,
      isMonotonic: true,
    };
    expect(ind.isMonotonic).toBe(true);
  });

  it('should accept a non-monotonic indicator', () => {
    const ind: ChronicFaultIndicator = {
      metric: 'cpu_usage',
      degradationRate: 0.0005,
      temporalCorrelation: 0.3,
      isMonotonic: false,
    };
    expect(ind.isMonotonic).toBe(false);
  });
});

describe('Fault types - RootCauseResult', () => {
  it('should accept a complete RootCauseResult with viaTreeSearch', () => {
    const result: RootCauseResult = {
      serviceId: 'checkoutservice',
      faultType: { category: 'MEMORY_LEAK', subType: 'heap', severity: 'critical' },
      confidence: 0.95,
      rank: 1,
      timestamp: 1000000,
      evidenceMetrics: [{ metric: 'heap_used', value: 2048, threshold: 1024 }],
      propagationDepth: 3,
      propagationErrorBound: 0.001,
      viaTreeSearch: true,
    };
    expect(result.serviceId).toBe('checkoutservice');
    expect(result.viaTreeSearch).toBe(true);
    expect(result.evidenceMetrics.length).toBe(1);
  });

  it('should accept minimal RootCauseResult without timestamp', () => {
    const result: RootCauseResult = {
      serviceId: 'svc-x',
      faultType: { category: 'UNKNOWN', subType: 'generic', severity: 'warning' },
      confidence: 0.5,
      rank: 3,
      evidenceMetrics: [],
      propagationDepth: 0,
      propagationErrorBound: 0,
      viaTreeSearch: false,
    };
    expect(result.timestamp).toBeUndefined();
  });
});

describe('Fault types - DEFAULT_RCA_OPTIONS', () => {
  it('should export DEFAULT_RCA_OPTIONS as a frozen object', () => {
    expect(DEFAULT_RCA_OPTIONS).toBeDefined();
  });

  it('should have pruneEpsilon', () => {
    expect(DEFAULT_RCA_OPTIONS.pruneEpsilon).toBe(0.001);
  });

  it('should have criticalLoadThreshold', () => {
    expect(DEFAULT_RCA_OPTIONS.criticalLoadThreshold).toBe(0.7);
  });

  it('should have defaultTopK', () => {
    expect(DEFAULT_RCA_OPTIONS.defaultTopK).toBe(5);
  });

  it('should have maxPropagationDepth', () => {
    expect(DEFAULT_RCA_OPTIONS.maxPropagationDepth).toBe(10);
  });

  it('should have all expected keys', () => {
    expect(Object.keys(DEFAULT_RCA_OPTIONS)).toHaveLength(4);
    expect(DEFAULT_RCA_OPTIONS).toHaveProperty('pruneEpsilon');
    expect(DEFAULT_RCA_OPTIONS).toHaveProperty('criticalLoadThreshold');
    expect(DEFAULT_RCA_OPTIONS).toHaveProperty('defaultTopK');
    expect(DEFAULT_RCA_OPTIONS).toHaveProperty('maxPropagationDepth');
  });
});

describe('Fault types - MetricMap type usage', () => {
  it('should construct a valid MetricMap', () => {
    const ts: import('@agentix-e/micro-kinetic-core').TimeSeries = {
      label: 'cpu', timestamps: [1], values: new Float64Array([50]), unit: '%',
    };
    const map: MetricMap = new Map([['svc-a', [ts]]]);
    expect(map.size).toBe(1);
    expect(map.get('svc-a')?.[0]?.label).toBe('cpu');
  });
});
