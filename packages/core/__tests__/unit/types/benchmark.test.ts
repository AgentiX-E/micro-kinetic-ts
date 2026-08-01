import { describe, it, expect } from 'vitest';
import type {
  BenchmarkDatasetId,
  BenchmarkCase,
  AvgAtK,
  FaultTypeAccuracy,
  LA_TA_Scores,
  EntityFaultProcessScores,
  BenchmarkResult,
} from '@agentix-e/micro-kinetic-core';

describe('Benchmark types - BenchmarkDatasetId', () => {
  it('should accept all valid dataset IDs', () => {
    const ids: BenchmarkDatasetId[] = ['rcaeval-re1', 'rcaeval-re2', 'rcaeval-re3', 'aiops2025', 'rca100'];
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

describe('Benchmark types - BenchmarkCase', () => {
  it('should accept a minimal BenchmarkCase', () => {
    const c: BenchmarkCase = {
      caseId: 'case-001',
      datasetId: 'rcaeval-re1',
      systemName: 'Online Boutique',
      faultType: 'CPU_HOG',
      groundTruthServiceId: 'checkoutservice',
      anomalyTimestamp: 1000000,
      injectTimestamp: 999000,
      metrics: {},
    };
    expect(c.caseId).toBe('case-001');
    expect(c.groundTruthServiceId).toBe('checkoutservice');
  });

  it('should accept BenchmarkCase with full optional fields', () => {
    const c: BenchmarkCase = {
      caseId: 'case-002',
      datasetId: 'aiops2025',
      systemName: 'TrainTicket',
      faultType: 'MEMORY_LEAK',
      groundTruthServiceId: 'payment',
      groundTruthMetric: 'heap_used',
      anomalyTimestamp: 2000000,
      injectTimestamp: 1990000,
      metrics: {
        'svc-a': { timestamps: [1, 2], values: [10, 20], metricName: 'cpu' },
      },
      logs: [{ timestamp: 1995000, serviceId: 'svc-a', level: 'ERROR', message: 'OOM' }],
      traces: [{
        traceId: 't1', spanId: 's1', parentSpanId: 'p1',
        serviceId: 'svc-a', operationName: 'POST /pay',
        startTime: 1990000, duration: 100, status: 'ERROR',
      }],
    };
    expect(c.groundTruthMetric).toBe('heap_used');
    expect(c.logs?.length).toBe(1);
    expect(c.traces?.length).toBe(1);
  });

  it('should support trace status OK', () => {
    const c: BenchmarkCase = {
      caseId: 'c3', datasetId: 'rca100', systemName: 'SockShop',
      faultType: 'NETWORK_DELAY', groundTruthServiceId: 'orders',
      anomalyTimestamp: 3000, injectTimestamp: 2000, metrics: {},
      traces: [{
        traceId: 't2', spanId: 's2', serviceId: 'orders',
        operationName: 'GET /orders', startTime: 2000, duration: 50, status: 'OK',
      }],
    };
    expect(c.traces?.[0].status).toBe('OK');
  });
});

describe('Benchmark types - AvgAtK', () => {
  it('should accept valid AvgAtK', () => {
    const a: AvgAtK = { avgAt1: 0.8, avgAt3: 0.9, avgAt5: 0.95 };
    expect(a.avgAt1).toBe(0.8);
    expect(a.avgAt3).toBe(0.9);
    expect(a.avgAt5).toBe(0.95);
  });
});

describe('Benchmark types - FaultTypeAccuracy', () => {
  it('should compute accuracy correctly', () => {
    const fta: FaultTypeAccuracy = {
      faultType: 'CPU_HOG',
      totalCases: 10,
      correctAt5: 8,
      accuracy: 0.8,
    };
    expect(fta.accuracy).toBe(fta.correctAt5 / fta.totalCases);
  });
});

describe('Benchmark types - LA_TA_Scores', () => {
  it('should accept valid LA_TA_Scores', () => {
    const scores: LA_TA_Scores = {
      locationAccuracy: 0.7,
      typeAccuracy: 0.8,
      explainability: 0.9,
      efficiency: 0.85,
      compositeScore: 78,
    };
    expect(scores.compositeScore).toBe(78);
  });
});

describe('Benchmark types - EntityFaultProcessScores', () => {
  it('should accept valid EntityFaultProcessScores', () => {
    const scores: EntityFaultProcessScores = {
      entityScore: 0.7,
      faultScore: 0.8,
      processScore: 0.9,
      compositeScore: 79,
    };
    expect(scores.compositeScore).toBe(79);
  });
});

describe('Benchmark types - BenchmarkResult', () => {
  it('should accept a minimal BenchmarkResult', () => {
    const result: BenchmarkResult = {
      datasetId: 'rcaeval-re1',
      totalCases: 100,
      passedCases: 95,
      avgAtK: { avgAt1: 0.8, avgAt3: 0.85, avgAt5: 0.9 },
      perFaultType: [],
      executionTimeMs: 5000,
      memoryPeakBytes: 1048576,
      runTimestamp: '2024-01-01T00:00:00.000Z',
      libraryVersion: '0.0.1',
    };
    expect(result.passedCases).toBe(95);
  });

  it('should accept BenchmarkResult with AIOps2025 scores', () => {
    const result: BenchmarkResult = {
      datasetId: 'aiops2025',
      totalCases: 400,
      passedCases: 380,
      avgAtK: { avgAt1: 0.7, avgAt3: 0.8, avgAt5: 0.85 },
      perFaultType: [{ faultType: 'CPU', totalCases: 100, correctAt5: 90, accuracy: 0.9 }],
      laTaScores: {
        locationAccuracy: 0.75, typeAccuracy: 0.8,
        explainability: 0.7, efficiency: 0.9, compositeScore: 78,
      },
      executionTimeMs: 10000,
      memoryPeakBytes: 2097152,
      runTimestamp: '2024-01-01T00:00:00.000Z',
      libraryVersion: '0.0.1',
    };
    expect(result.laTaScores?.compositeScore).toBe(78);
  });

  it('should accept BenchmarkResult with RCA100 scores', () => {
    const result: BenchmarkResult = {
      datasetId: 'rca100',
      totalCases: 103,
      passedCases: 100,
      avgAtK: { avgAt1: 0.9, avgAt3: 0.95, avgAt5: 0.97 },
      perFaultType: [],
      efpScores: {
        entityScore: 0.8, faultScore: 0.85,
        processScore: 0.9, compositeScore: 83.5,
      },
      executionTimeMs: 3000,
      memoryPeakBytes: 1048576,
      runTimestamp: '2024-01-01T00:00:00.000Z',
      libraryVersion: '0.0.1',
    };
    expect(result.efpScores?.compositeScore).toBe(83.5);
  });
});
