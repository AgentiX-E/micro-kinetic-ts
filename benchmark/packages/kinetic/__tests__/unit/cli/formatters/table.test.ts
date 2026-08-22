import { describe, it, expect } from 'vitest';
import {
  formatRCATable,
  formatDenoiseTable,
  formatBenchmarkTable,
} from '../../../../src/cli/formatters/table.js';
import type { RootCauseResult, DenoiseResult, BenchmarkResult } from '@agentix-e/micro-kinetic-core';

function makeRootCause(rank: number): RootCauseResult {
  return {
    serviceId: `svc_test${rank}`,
    faultType: { category: 'CPU', subType: 'overload', severity: 'critical' },
    confidence: 0.9,
    rank,
    evidenceMetrics: [{ metric: 'cpu_usage', value: 95, threshold: 80 }],
    propagationDepth: rank + 1,
    propagationErrorBound: 0.01,
    viaTreeSearch: true,
  };
}

function makeDenoiseResult(): DenoiseResult {
  return {
    trueAlarms: [
      { id: '1', serviceId: 'svc_a', severity: 'critical', timestamp: 1000, metric: 'cpu', value: 0.95, threshold: 0.8, message: 'High CPU' },
    ],
    coincidentalAlarms: [
      { id: '2', serviceId: 'svc_b', severity: 'warning', timestamp: 1100, metric: 'mem', value: 0.3, threshold: 0.7, message: 'Low mem' },
    ],
    groupedAlarms: [],
    sparsityScore: 0.85,
    falsePositiveReduction: 0.5,
  };
}

function makeBenchmarkResult(): BenchmarkResult {
  return {
    datasetId: 'rca100',
    totalCases: 103,
    passedCases: 95,
    avgAtK: { avgAt1: 0.72, avgAt3: 0.88, avgAt5: 0.92 },
    perFaultType: [],
    executionTimeMs: 5000,
    memoryPeakBytes: 104857600,
    runTimestamp: '2025-01-01T00:00:00Z',
    libraryVersion: '0.0.1',
  };
}

describe('formatRCATable', () => {
  it('should format empty results', () => {
    const output = formatRCATable([]);
    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(0);
  });

  it('should format single RCA result', () => {
    const output = formatRCATable([makeRootCause(1)]);
    expect(output).toContain('svc_test1');
    expect(output).toContain('CPU');
  });

  it('should format multiple RCA results', () => {
    const results = [makeRootCause(1), makeRootCause(2), makeRootCause(3)];
    const output = formatRCATable(results);
    expect(output).toContain('svc_test1');
    expect(output).toContain('svc_test2');
    expect(output).toContain('svc_test3');
  });

  it('should include column headers', () => {
    const output = formatRCATable([makeRootCause(1)]);
    expect(output).toContain('Rank');
    expect(output).toContain('Service');
    expect(output).toContain('Confidence');
  });
});

describe('formatDenoiseTable', () => {
  it('should format denoise result', () => {
    const result = makeDenoiseResult();
    const output = formatDenoiseTable(result);
    expect(typeof output).toBe('string');
  });

  it('should include sparsity score', () => {
    const result = makeDenoiseResult();
    const output = formatDenoiseTable(result);
    expect(output).toContain('Sparsity Score');
  });

  it('should include false positive reduction', () => {
    const result = makeDenoiseResult();
    const output = formatDenoiseTable(result);
    expect(output).toContain('False Positive Reduction');
  });

  it('should handle zero total', () => {
    const result: DenoiseResult = {
      trueAlarms: [],
      coincidentalAlarms: [],
      groupedAlarms: [],
      sparsityScore: 0,
      falsePositiveReduction: 0,
    };
    const output = formatDenoiseTable(result);
    expect(typeof output).toBe('string');
  });
});

describe('formatBenchmarkTable', () => {
  it('should format benchmark result', () => {
    const result = makeBenchmarkResult();
    const output = formatBenchmarkTable(result);
    expect(typeof output).toBe('string');
  });

  it('should include dataset and scores', () => {
    const result = makeBenchmarkResult();
    const output = formatBenchmarkTable(result);
    expect(output).toContain('rca100');
    expect(output).toContain('Total Cases');
  });
});
