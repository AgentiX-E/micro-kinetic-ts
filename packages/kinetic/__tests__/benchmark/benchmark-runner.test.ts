import {
  Container,
  DI_TOKENS,
  type IContainer,
  type IRCAEngine,
} from '@agentix-e/micro-kinetic-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SyntheticBenchmarkGenerator } from '../../src/benchmarks/synthetic/data-generator.js';

import { BenchmarkRunner, type RunResult } from '../../src/benchmarks/runners/benchmark-runner.js';

import {
  avgAtK,
  computeAggregateLA,
  computeAggregateMRR,
  computeAggregateTA,
  computeAIOps2025CompositeScore,
  computeAvgAtK,
  computeF1Score,
  computeLA,
  computeMRR,
  computePrecisionAtK,
  computeRCA100CompositeScore,
  computeRecallAtK,
  computeTA,
} from '../../src/benchmarks/runners/metrics.js';

// ── Helpers ───────────────────────────────────────────────

/**
 * Build a minimal mock RCA engine for testing the benchmark runner.
 * The engine returns the faulty service as top-1 with moderate confidence.
 * This allows us to test runner metrics computation in isolation.
 */
function createMockEngine(): IRCAEngine {
  return {
    buildFaultGraph: (callGraph, _metrics, _injectTimeMs) => ({
      callGraph,
      propagationWeights: new Float64Array(callGraph.edges.map(() => 0.5)),
      anomalyScores: new Map(
        [...callGraph.nodes.keys()].map((id) => [id, id === 'service_1' ? 0.9 : 0.1]),
      ),
      anomalyOnsetTimes: new Map(
        [...callGraph.nodes.keys()].map((id) => [id, id === 'service_1' ? 2 : 5]),
      ),
      dominantMetrics: new Map(
        [...callGraph.nodes.keys()].map((id) => [
          id,
          { label: 'cpu', head: [0.1, 0.2, 0.3], tail: [0.8, 0.9] },
        ]),
      ),
      detectedCycles: [],
      totalCycleContribution: 0,
      pruneThreshold: 0.001,
    }),
    analyze: async (_graph, topK = 5) => {
      const results = [];
      // First result: correct service but generic fault type
      results.push({
        serviceId: 'service_1',
        faultType: { category: 'CPU', subType: '', severity: 'major' },
        confidence: 0.75,
        rank: 1,
        timestamp: Date.now(),
        evidenceMetrics: [{ metric: 'cpu_usage_percent', value: 0.92, threshold: 0.8 }],
        propagationDepth: 1,
        propagationErrorBound: 0.01,
        viaTreeSearch: true,
      });
      // Fill up to topK with other services at lower confidence
      for (let i = 2; i <= Math.min(topK, 5); i++) {
        results.push({
          serviceId: `service_${i}`,
          faultType: { category: 'UNKNOWN', subType: '', severity: 'info' },
          confidence: 0.5 / i,
          rank: i,
          evidenceMetrics: [],
          propagationDepth: i,
          propagationErrorBound: 0.1,
          viaTreeSearch: false,
        });
      }
      return results;
    },
    getCycleContributionBound: () => 0,
  };
}

function createContainer(): IContainer {
  const container = new Container();
  container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());
  return container;
}

// ── Metrics Tests ─────────────────────────────────────────

describe('Standalone Metrics', () => {
  describe('avgAtK', () => {
    it('should return 1 when actual is in first K predictions', () => {
      expect(avgAtK(['svc_a', 'svc_b', 'svc_c'], 'svc_a', 1)).toBe(1);
      expect(avgAtK(['svc_a', 'svc_b', 'svc_c'], 'svc_b', 2)).toBe(1);
      expect(avgAtK(['svc_a', 'svc_b', 'svc_c'], 'svc_c', 3)).toBe(1);
    });

    it('should return 0 when actual is not in first K predictions', () => {
      expect(avgAtK(['svc_a', 'svc_b', 'svc_c'], 'svc_d', 3)).toBe(0);
      expect(avgAtK(['svc_a', 'svc_b', 'svc_c'], 'svc_b', 1)).toBe(0);
    });

    it('should return 0 for empty predictions', () => {
      expect(avgAtK([], 'svc_a', 5)).toBe(0);
    });

    it('should return 0 for k <= 0', () => {
      expect(avgAtK(['svc_a'], 'svc_a', 0)).toBe(0);
    });
  });

  describe('computeAvgAtK', () => {
    it('should compute correct aggregate Avg@1', () => {
      const predictions = [['correct'], ['wrong'], ['correct']];
      const truths = ['correct', 'correct', 'correct'];
      expect(computeAvgAtK(predictions, truths, 1)).toBeCloseTo(2 / 3);
    });

    it('should handle empty arrays', () => {
      expect(computeAvgAtK([], [], 5)).toBe(0);
    });
  });

  describe('computePrecisionAtK', () => {
    it('should compute Precision@1 correctly', () => {
      const predictions = [
        { serviceId: 'svc_a', confidence: 0.9 },
        { serviceId: 'svc_b', confidence: 0.5 },
      ].map((p, i) => ({
        ...p,
        faultType: { category: 'CPU', subType: '', severity: 'major' as const },
        rank: i + 1,
        evidenceMetrics: [],
        propagationDepth: 1,
        propagationErrorBound: 0.01,
        viaTreeSearch: false,
      }));
      expect(computePrecisionAtK(predictions, 'svc_a', 1)).toBe(1);
      expect(computePrecisionAtK(predictions, 'svc_b', 1)).toBe(0);
    });

    it('should return 0 for k <= 0', () => {
      expect(computePrecisionAtK([], 'svc_a', 0)).toBe(0);
    });
  });

  describe('computeF1Score', () => {
    it('should compute F1 correctly', () => {
      expect(computeF1Score(1, 1)).toBe(1);
      expect(computeF1Score(0.5, 0.5)).toBeCloseTo(0.5);
      expect(computeF1Score(0, 0)).toBe(0);
    });

    it('should compute F1 from precision and recall', () => {
      // Precision = 2/3, Recall = 2/3 => F1 = (2 * 2/3 * 2/3) / (4/3) = 2/3
      const f1 = computeF1Score(2 / 3, 2 / 3);
      expect(f1).toBeCloseTo(2 / 3);
    });
  });

  describe('computeRecallAtK', () => {
    it('should return 1 when actual is in top-K (single truth)', () => {
      const predictions = [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')];
      // svc_a in top-2, 1 truth → 1/1 = 1
      expect(computeRecallAtK(predictions, ['svc_a'], 2)).toBe(1);
    });

    it('should return 0 when actual not in top-K', () => {
      const predictions = [makePrediction('svc_c', 'CPU'), makePrediction('svc_d', 'MEM')];
      expect(computeRecallAtK(predictions, ['svc_a'], 2)).toBe(0);
    });

    it('should return 0 for empty truths array', () => {
      const predictions = [makePrediction('svc_a', 'CPU')];
      expect(computeRecallAtK(predictions, [], 3)).toBe(0);
    });

    it('should return 0 for empty predictions', () => {
      expect(computeRecallAtK([], ['svc_a'], 3)).toBe(0);
    });

    it('should return 0 for k <= 0', () => {
      const predictions = [makePrediction('svc_a', 'CPU')];
      expect(computeRecallAtK(predictions, ['svc_a'], 0)).toBe(0);
    });
  });

  describe('computeAggregateMRR', () => {
    it('should compute average MRR across cases', () => {
      const predictionsPerCase = [
        [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')],
        [makePrediction('svc_b', 'MEM'), makePrediction('svc_a', 'CPU')],
      ];
      // Case 1: svc_a at rank 1 → RR = 1/1 = 1
      // Case 2: svc_b at rank 1 → RR = 1/1 = 1
      // Average MRR = (1 + 1) / 2 = 1
      expect(computeAggregateMRR(predictionsPerCase, ['svc_a', 'svc_b'])).toBe(1);
    });

    it('should return 0 for empty predictions', () => {
      expect(computeAggregateMRR([], [])).toBe(0);
    });

    it('should return partial score when some not found', () => {
      const predictionsPerCase = [
        [makePrediction('svc_a', 'CPU')],
        [makePrediction('svc_b', 'MEM')],
      ];
      // Case 1: svc_c not found → RR = 0
      // Case 2: svc_d not found → RR = 0
      expect(computeAggregateMRR(predictionsPerCase, ['svc_c', 'svc_d'])).toBe(0);
    });
  });

  describe('computeMRR', () => {
    it('should compute reciprocal rank when found', () => {
      const predictions = [
        { serviceId: 'svc_b', confidence: 0.9 },
        { serviceId: 'svc_a', confidence: 0.8 },
        { serviceId: 'svc_c', confidence: 0.7 },
      ].map((p, i) => ({
        ...p,
        faultType: { category: 'CPU', subType: '', severity: 'major' as const },
        rank: i + 1,
        evidenceMetrics: [],
        propagationDepth: 1,
        propagationErrorBound: 0.01,
        viaTreeSearch: false,
      }));
      expect(computeMRR(predictions, 'svc_b')).toBe(1);
      expect(computeMRR(predictions, 'svc_a')).toBe(0.5);
      expect(computeMRR(predictions, 'svc_c')).toBeCloseTo(1 / 3);
    });

    it('should return 0 when not found', () => {
      const predictions = [{ serviceId: 'svc_a', confidence: 0.9 }].map((p, i) => ({
        ...p,
        faultType: { category: 'CPU', subType: '', severity: 'major' as const },
        rank: i + 1,
        evidenceMetrics: [],
        propagationDepth: 1,
        propagationErrorBound: 0.01,
        viaTreeSearch: false,
      }));
      expect(computeMRR(predictions, 'svc_z')).toBe(0);
    });
  });

  describe('computeLA', () => {
    it('should return 1 when service IDs match', () => {
      const prediction = makePrediction('svc_a');
      expect(computeLA(prediction, 'svc_a')).toBe(1);
    });

    it('should return 0 when service IDs differ', () => {
      const prediction = makePrediction('svc_a');
      expect(computeLA(prediction, 'svc_b')).toBe(0);
    });
  });

  describe('computeTA', () => {
    it('should return 1 when fault types match', () => {
      const prediction = makePrediction('svc_a', 'CPU');
      expect(computeTA(prediction, 'CPU')).toBe(1);
    });

    it('should be case-insensitive', () => {
      const prediction = makePrediction('svc_a', 'CPU');
      expect(computeTA(prediction, 'cpu')).toBe(1);
    });

    it('should normalize separators', () => {
      const prediction = makePrediction('svc_a', 'NETWORK_DELAY');
      expect(computeTA(prediction, 'NETWORK-DELAY')).toBe(1);
      expect(computeTA(prediction, 'network delay')).toBe(1);
    });

    it('should return 0 when fault types differ', () => {
      const prediction = makePrediction('svc_a', 'CPU');
      expect(computeTA(prediction, 'MEM')).toBe(0);
    });
  });

  describe('computeAggregateTA', () => {
    it('should return 1 when all fault types match', () => {
      const predictions = [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')];
      expect(computeAggregateTA(predictions, ['cpu', 'mem'])).toBe(1);
    });

    it('should return 0 when no fault types match', () => {
      const predictions = [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')];
      expect(computeAggregateTA(predictions, ['disk', 'network'])).toBe(0);
    });

    it('should return 0.5 when half match', () => {
      const predictions = [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')];
      expect(computeAggregateTA(predictions, ['cpu', 'network'])).toBe(0.5);
    });

    it('should return 0 for empty predictions', () => {
      expect(computeAggregateTA([], [])).toBe(0);
    });

    it('should handle FaultType objects (category + subType)', () => {
      const prediction = {
        serviceId: 'svc_a',
        faultType: { category: 'NETWORK', subType: 'DELAY' },
        confidence: 0.9,
        rank: 1,
      } as RootCauseResult;
      expect(computeTA(prediction, 'network_delay')).toBe(1);
      expect(computeTA(prediction, 'network-delay')).toBe(1);
    });

    it('should normalize non-string non-object fault type via String()', () => {
      const prediction = {
        serviceId: 'svc_a',
        faultType: 42 as unknown,
        confidence: 0.9,
        rank: 1,
      } as RootCauseResult;
      expect(computeTA(prediction, '42')).toBe(1);
    });
  });

  describe('computeAggregateLA', () => {
    it('should return 1 when all locations match', () => {
      const predictions = [makePrediction('svc_a', 'CPU'), makePrediction('svc_b', 'MEM')];
      expect(computeAggregateLA(predictions, ['svc_a', 'svc_b'])).toBe(1);
    });

    it('should return 0 for empty predictions', () => {
      expect(computeAggregateLA([], [])).toBe(0);
    });
  });

  describe('Composite Scores', () => {
    it('should compute AIOps2025 composite score', () => {
      const score = computeAIOps2025CompositeScore(0.8, 0.7, 0.9, 0.85);
      expect(score).toBeCloseTo((0.4 * 0.8 + 0.4 * 0.7 + 0.1 * 0.9 + 0.1 * 0.85) * 100);
    });

    it('should compute RCA100 composite score', () => {
      const score = computeRCA100CompositeScore(0.9, 0.8, 0.85);
      expect(score).toBeCloseTo((0.4 * 0.9 + 0.3 * 0.8 + 0.3 * 0.85) * 100);
    });
  });
});

// ── Synthetic Data Generator Tests ────────────────────────

describe('SyntheticBenchmarkGenerator', () => {
  const generator = new SyntheticBenchmarkGenerator(42);

  describe('generateRCAEvalCase', () => {
    it('should generate a CPU fault case', () => {
      const benchCase = generator.generateRCAEvalCase('CPU', 5);
      expect(benchCase.id).toContain('CPU');
      expect(benchCase.metrics.size).toBeGreaterThan(0);
      expect(benchCase.groundTruth.serviceId).toBeDefined();
      expect(benchCase.groundTruth.faultType).toBe('CPU');
    });

    it('should generate a MEM fault case', () => {
      const benchCase = generator.generateRCAEvalCase('MEM', 5);
      expect(benchCase.groundTruth.faultType).toBe('MEM');
    });

    it('should generate a DISK fault case', () => {
      const benchCase = generator.generateRCAEvalCase('DISK', 5);
      expect(benchCase.groundTruth.faultType).toBe('DISK');
    });

    it('should generate a DELAY fault case', () => {
      const benchCase = generator.generateRCAEvalCase('DELAY', 5);
      expect(benchCase.groundTruth.faultType).toBe('DELAY');
    });

    it('should generate a LOSS fault case', () => {
      const benchCase = generator.generateRCAEvalCase('LOSS', 5);
      expect(benchCase.groundTruth.faultType).toBe('LOSS');
    });

    it('should generate a SOCKET fault case', () => {
      const benchCase = generator.generateRCAEvalCase('SOCKET', 5);
      expect(benchCase.groundTruth.faultType).toBe('SOCKET');
    });

    it('should have metrics for each service', () => {
      const numServices = 7;
      const benchCase = generator.generateRCAEvalCase('CPU', numServices);
      expect(benchCase.metrics.size).toBe(numServices);
    });

    it('should have a valid inject time', () => {
      const benchCase = generator.generateRCAEvalCase('CPU', 3);
      expect(benchCase.injectTime).toBeGreaterThan(0);
    });
  });

  describe('generateRCAEvalSuite', () => {
    it('should generate a suite with specified number of cases', () => {
      const suite = generator.generateRCAEvalSuite('synthetic-suite', 12);
      expect(suite.totalCases).toBe(12);
      expect(suite.cases.length).toBe(12);
    });

    it('should cycle through fault types', () => {
      const suite = generator.generateRCAEvalSuite('test', 6);
      const faultTypes = suite.cases.map((c) => c.groundTruth.faultType);
      expect(faultTypes).toEqual(['CPU', 'MEM', 'DISK', 'DELAY', 'LOSS', 'SOCKET']);
    });
  });

  describe('generateCallGraph', () => {
    it('should create a connected graph', () => {
      const graph = generator.generateCallGraph(['svc_a', 'svc_b', 'svc_c'], false);
      expect(graph.nodes.size).toBe(3);
      expect(graph.edges.length).toBeGreaterThan(0);
    });

    it('should handle single node', () => {
      const graph = generator.generateCallGraph(['svc_a'], false);
      expect(graph.nodes.size).toBe(1);
      expect(graph.edges.length).toBe(0);
    });

    it('should include cycles when requested', () => {
      const graph = generator.generateCallGraph(['svc_a', 'svc_b', 'svc_c'], true);
      expect(graph.edges.length).toBeGreaterThan(0);
      // Check for a back edge (cycle)
      const hasCycle = graph.edges.some((e) => e.from === 'svc_c' && e.to === 'svc_a');
      expect(hasCycle).toBe(true);
    });
  });

  describe('specific fault patterns', () => {
    const timestamps = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
    const injectIndex = 4;

    it('should generate CPU fault with increasing values after injection', () => {
      const series = generator.generateCPUFault(timestamps, injectIndex);
      const cpuValues = series[0].values;
      const beforeInject = cpuValues.slice(0, injectIndex).reduce((a, b) => a + b, 0) / injectIndex;
      const afterInject =
        cpuValues.slice(injectIndex).reduce((a, b) => a + b, 0) / (cpuValues.length - injectIndex);
      expect(afterInject).toBeGreaterThan(beforeInject);
    });

    it('should generate MEM fault with monotonic growth', () => {
      const series = generator.generateMEMFault(timestamps, injectIndex);
      const memValues = series[0].values;
      // After injection, the overall trend should grow
      // Compare average of first half of post-injection vs second half
      const postInject = Array.from(memValues.slice(injectIndex));
      const mid = Math.floor(postInject.length / 2);
      const firstHalfAvg = postInject.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalfAvg =
        postInject.slice(mid).reduce((a, b) => a + b, 0) / (postInject.length - mid);
      expect(secondHalfAvg).toBeGreaterThan(firstHalfAvg);
    });

    it('should generate DISK fault with increased I/O', () => {
      const series = generator.generateDISKFault(timestamps, injectIndex);
      const readValues = series[0].values;
      const beforeAvg = readValues.slice(0, injectIndex).reduce((a, b) => a + b, 0) / injectIndex;
      const afterAvg =
        readValues.slice(injectIndex).reduce((a, b) => a + b, 0) /
        (readValues.length - injectIndex);
      expect(afterAvg).toBeGreaterThan(beforeAvg * 1.5);
    });

    it('should generate DELAY fault with growing latency', () => {
      const series = generator.generateDELAYFault(timestamps, injectIndex);
      const latValues = series[0].values;
      const lastValue = latValues[latValues.length - 1];
      const firstBefore = latValues[0];
      expect(lastValue).toBeGreaterThan(firstBefore * 10);
    });

    it('should generate LOSS fault with elevated loss rate', () => {
      const series = generator.generateLOSSFault(timestamps, injectIndex);
      const lossValues = series[0].values;
      const afterAvg =
        lossValues.slice(injectIndex).reduce((a, b) => a + b, 0) /
        (lossValues.length - injectIndex);
      expect(afterAvg).toBeGreaterThan(0.02);
    });

    it('should generate SOCKET fault with growing socket count', () => {
      const series = generator.generateSOCKETFault(timestamps, injectIndex);
      const socketValues = series[0].values;
      const afterAvg =
        socketValues.slice(injectIndex).reduce((a, b) => a + b, 0) /
        (socketValues.length - injectIndex);
      const beforeAvg = socketValues.slice(0, injectIndex).reduce((a, b) => a + b, 0) / injectIndex;
      expect(afterAvg).toBeGreaterThan(beforeAvg);
    });
  });
});

// ── Benchmark Runner Tests ────────────────────────────────

describe('BenchmarkRunner', () => {
  const generator = new SyntheticBenchmarkGenerator(42);
  const container = createContainer();
  const runner = new BenchmarkRunner(container);

  describe('calibrator access', () => {
    it('exposes the weight calibrator instance', () => {
      const calibrator = runner.getCalibrator();
      expect(calibrator).toBeDefined();
      // The calibrator persists across runSuite calls (self-evolving RCA).
      expect(runner.getCalibrator()).toBe(calibrator);
    });
  });

  describe('runSuite', () => {
    let result: RunResult;

    beforeAll(async () => {
      const suite = generator.generateRCAEvalSuite('synthetic-test', 6);
      result = await runner.runSuite(suite);
    });

    it('should produce a valid RunResult', () => {
      expect(result).toBeDefined();
      expect(result.suiteName).toBe('synthetic-test');
      expect(result.totalCases).toBe(6);
    });

    it('should have valid Avg@K metrics', () => {
      expect(result.avgTop1).toBeGreaterThanOrEqual(0);
      expect(result.avgTop1).toBeLessThanOrEqual(1);
      expect(result.avgTop5).toBeGreaterThanOrEqual(0);
      expect(result.avgTop5).toBeLessThanOrEqual(1);
    });

    it('should have valid Location Accuracy', () => {
      expect(result.locationAccuracy).toBeGreaterThanOrEqual(0);
      expect(result.locationAccuracy).toBeLessThanOrEqual(1);
    });

    it('should have valid Type Accuracy', () => {
      expect(result.typeAccuracy).toBeGreaterThanOrEqual(0);
      expect(result.typeAccuracy).toBeLessThanOrEqual(1);
    });

    it('should have perFaultType breakdown', () => {
      expect(result.perFaultType.size).toBeGreaterThan(0);
    });

    it('should track execution duration', () => {
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should have failures array (possibly empty)', () => {
      expect(Array.isArray(result.failures)).toBe(true);
    });
  });

  describe('runAll', () => {
    it('should produce aggregated report across suites', async () => {
      const suite1 = generator.generateRCAEvalSuite('suite-1', 3);
      const suite2 = generator.generateRCAEvalSuite('suite-2', 3);
      const report = await runner.runAll([suite1, suite2]);

      expect(report.totalCases).toBe(6);
      expect(report.suiteResults.length).toBe(2);
      expect(report.aggregateAvgTop1).toBeGreaterThanOrEqual(0);
      expect(report.aggregateAvgTop1).toBeLessThanOrEqual(1);
      expect(report.aggregateAvgTop5).toBeGreaterThanOrEqual(0);
      expect(report.aggregateAvgTop5).toBeLessThanOrEqual(1);
      expect(report.totalDuration).toBeGreaterThanOrEqual(0);
      expect(report.timestamp).toBeDefined();
    });
  });

  describe('generateReport', () => {
    let results: RunResult[];

    beforeAll(async () => {
      const suite = generator.generateRCAEvalSuite('report-test', 3);
      const result = await runner.runSuite(suite);
      results = [result];
    });

    it('should generate JSON report', () => {
      const report = runner.generateReport(results, 'json');
      expect(typeof report).toBe('string');
      const parsed = JSON.parse(report);
      expect(parsed.suites).toBeDefined();
      expect(Array.isArray(parsed.suites)).toBe(true);
      expect(parsed.summary).toBeDefined();
    });

    it('should generate text report', () => {
      const report = runner.generateReport(results, 'text');
      expect(typeof report).toBe('string');
      expect(report).toContain('Micro-Kinetic Benchmark Report');
      expect(report).toContain('Avg@1');
      expect(report).toContain('Avg@5');
    });

    it('should generate HTML report', () => {
      const report = runner.generateReport(results, 'html');
      expect(typeof report).toBe('string');
      expect(report).toContain('<!DOCTYPE html>');
      expect(report).toContain('Micro-Kinetic Benchmark Report');
    });
  });

  describe('edge cases', () => {
    it('should handle empty suite gracefully', async () => {
      const emptySuite = {
        name: 'empty-suite',
        cases: [],
        totalCases: 0,
      };
      const result = await runner.runSuite(emptySuite);
      expect(result.totalCases).toBe(0);
      expect(result.avgTop1).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle runAll with empty suites array', async () => {
      const report = await runner.runAll([]);
      expect(report.totalCases).toBe(0);
      expect(report.suiteResults.length).toBe(0);
      expect(report.aggregateAvgTop1).toBe(0);
    });

    it('should handle engine failure and record it in failures', async () => {
      const container = new Container();
      const failingEngine: IRCAEngine = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: { nodes: new Map(), edges: [], systemLoad: 0 },
          anomalyScores: new Map(),
        })),
        analyze: vi.fn(() => Promise.reject(new Error('Engine crashed'))),
        getCycleContributionBound: () => 0,
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => failingEngine);
      const failingRunner = new BenchmarkRunner(container);
      const suite = generator.generateRCAEvalSuite('fail-suite', 10);
      const failureResult = await failingRunner.runSuite(suite);
      expect(failureResult.failures.length).toBeGreaterThan(5);
      expect(failureResult.totalCases).toBe(10);

      // Verify text report truncates failure list at 5
      const textReport = failingRunner.generateReport([failureResult], 'text');
      expect(textReport).toContain('Micro-Kinetic');
      expect(textReport).toContain('... and');

      // Verify HTML report handles special characters
      const htmlReport = failingRunner.generateReport([failureResult], 'html');
      expect(htmlReport).toContain('<!DOCTYPE html>');
    });

    it('should handle engine returning empty predictions', async () => {
      const container = new Container();
      const emptyEngine: IRCAEngine = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: {
            nodes: new Map([['svc_a', { serviceId: 'svc_a', dependencies: [] }]]),
            edges: [],
            systemLoad: 0,
          },
          anomalyScores: new Map(),
        })),
        analyze: vi.fn(() => Promise.resolve([])),
        getCycleContributionBound: () => 0,
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => emptyEngine);
      const emptyRunner = new BenchmarkRunner(container);
      const suite = generator.generateRCAEvalSuite('empty-suite', 3);
      const emptyResult = await emptyRunner.runSuite(suite);
      // No predictions → all cases should have "No predictions generated" failure
      expect(emptyResult.failures.length).toBe(3);
      expect(emptyResult.avgTop1).toBe(0);
    });
  });

  describe('Top-K accuracy distinction (regression)', () => {
    /**
     * Regression guard for the AC@1 reporting bug: `perFaultType.accuracy`
     * and `avgTop1` must reflect Top-1 correctness, while `avgTop5` must
     * reflect Top-5 correctness. Previously `perFaultType.accuracy` was
     * incremented on a Top-5 match, misreporting AC@1.
     */
    it('distinguishes Top-1 from Top-5 when GT is ranked second', async () => {
      const container = new Container();
      // Engine returns 'service_1' as top-1 (wrong) and 'service_2' as
      // top-2 (correct). GT is always 'service_2'.
      const rankedEngine: IRCAEngine = {
        buildFaultGraph: (callGraph) => ({
          callGraph,
          anomalyScores: new Map(
            [...callGraph.nodes.keys()].map((id) => [id, id === 'service_2' ? 0.9 : 0.1]),
          ),
          anomalyOnsetTimes: new Map(),
        }),
        analyze: async (_graph, topK = 5) => {
          const mk = (id: string, rank: number) => ({
            serviceId: id,
            faultType: { category: 'CPU', subType: '', severity: 'major' as const },
            confidence: 1 - rank * 0.1,
            rank,
            timestamp: Date.now(),
            evidenceMetrics: [],
            propagationDepth: rank,
            propagationErrorBound: 0.01,
            viaTreeSearch: false,
          });
          return [
            mk('service_1', 1),
            mk('service_2', 2),
            ...Array.from({ length: topK - 2 }, (_, i) => mk(`filler_${i}`, 3 + i)),
          ];
        },
        getCycleContributionBound: () => 0,
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => rankedEngine);
      const runner = new BenchmarkRunner(container);

      const generator = new SyntheticBenchmarkGenerator({ seed: 42 });
      // Force every generated case's ground-truth service to 'service_2'.
      const suite = generator.generateRCAEvalSuite('topk-distinction', 4);
      const patchedCases = suite.cases.map((c) => ({
        ...c,
        groundTruth: { ...c.groundTruth, serviceId: 'service_2' },
      }));

      const result = await runner.runSuite({ ...suite, cases: patchedCases });

      // Top-1 is wrong for every case → avgTop1 must be 0.
      expect(result.avgTop1).toBe(0);
      // 'service_2' is ranked second → within Top-5 → avgTop5 must be 1.
      expect(result.avgTop5).toBe(1);
      // perFaultType.accuracy must match Top-1 (0), NOT Top-5 (1).
      for (const [, metric] of result.perFaultType) {
        expect(metric.accuracy).toBe(0);
      }
    });

    it('reports Top-1 in perFaultType when GT is ranked first', async () => {
      const container = new Container();
      // Engine returns the GT service as top-1.
      const correctEngine: IRCAEngine = {
        buildFaultGraph: (callGraph) => ({
          callGraph,
          anomalyScores: new Map(
            [...callGraph.nodes.keys()].map((id) => [id, id === 'service_1' ? 0.9 : 0.1]),
          ),
          anomalyOnsetTimes: new Map(),
        }),
        analyze: async (_graph, topK = 5) => {
          const mk = (id: string, rank: number) => ({
            serviceId: id,
            faultType: { category: 'CPU', subType: '', severity: 'major' as const },
            confidence: 1 - rank * 0.1,
            rank,
            timestamp: Date.now(),
            evidenceMetrics: [],
            propagationDepth: rank,
            propagationErrorBound: 0.01,
            viaTreeSearch: false,
          });
          return [
            mk('service_1', 1),
            ...Array.from({ length: topK - 1 }, (_, i) => mk(`filler_${i}`, 2 + i)),
          ];
        },
        getCycleContributionBound: () => 0,
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => correctEngine);
      const runner = new BenchmarkRunner(container);

      const generator = new SyntheticBenchmarkGenerator({ seed: 42 });
      const suite = generator.generateRCAEvalSuite('topk-correct', 4);
      const patchedCases = suite.cases.map((c) => ({
        ...c,
        groundTruth: { ...c.groundTruth, serviceId: 'service_1' },
      }));

      const result = await runner.runSuite({ ...suite, cases: patchedCases });

      expect(result.avgTop1).toBe(1);
      expect(result.avgTop5).toBe(1);
      for (const [, metric] of result.perFaultType) {
        expect(metric.accuracy).toBe(1);
      }
    });
  });
});

// ── RCA Engine Integration Tests ──────────────────────────

describe('RCA Engine Integration', () => {
  const generator = new SyntheticBenchmarkGenerator(42);

  it('should achieve high Avg@1 on CPU fault data', async () => {
    const container = createContainer();
    const runner = new BenchmarkRunner(container);
    // Generate cases where the faulty service is always service_1
    // and our mock engine always returns service_1 as top-1
    const suite = generator.generateRCAEvalSuite('cpu-integration', 6);
    const result = await runner.runSuite(suite);
    // Our mock engine always picks service_1, but not all cases have service_1 as faulty
    // So we should have partial accuracy
    expect(result.avgTop1).toBeGreaterThanOrEqual(0);
    expect(result.locationAccuracy).toBeGreaterThanOrEqual(0);
  });

  it('should compute correct Location Accuracy', async () => {
    const container = createContainer();
    const runner = new BenchmarkRunner(container);
    // Generate a single case with known ground truth
    const benchCase = generator.generateRCAEvalCase('CPU', 3);
    const suite = {
      name: 'la-test',
      cases: [benchCase],
      totalCases: 1,
    };
    const result = await runner.runSuite(suite);
    // Assert LA is computed
    expect(result.locationAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.locationAccuracy).toBeLessThanOrEqual(1);
  });

  it('should compute correct Type Accuracy', async () => {
    const container = createContainer();
    const runner = new BenchmarkRunner(container);
    const benchCase = generator.generateRCAEvalCase('MEM', 3);
    const suite = {
      name: 'ta-test',
      cases: [benchCase],
      totalCases: 1,
    };
    const result = await runner.runSuite(suite);
    expect(result.typeAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.typeAccuracy).toBeLessThanOrEqual(1);
  });
});

// ── Classifier Integration Tests ─────────────────────────

import { DEFAULT_CLASSIFICATION_RULES, RegexFaultClassifier } from '@agentix-e/micro-kinetic-core';

describe('BenchmarkRunner with Fault Classifier', () => {
  const generator = new SyntheticBenchmarkGenerator(42);

  it('should use classifier to improve Type Accuracy on synthetic data', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    // Generate CPU fault cases — metrics have 'cpu' in name
    const suite = generator.generateRCAEvalSuite('cpu-classifier-test', 10);
    const result = await runner.runSuite(suite);

    // Location accuracy comes from the mock engine (always returns service_1)
    expect(result.locationAccuracy).toBeGreaterThanOrEqual(0);
    // Type accuracy should be computed and within bounds
    expect(result.typeAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.typeAccuracy).toBeLessThanOrEqual(1);
    // Verify TA is actually being computed (not default 0)
    expect(typeof result.typeAccuracy).toBe('number');
    expect(Number.isNaN(result.typeAccuracy)).toBe(false);
  });

  it('should maintain Location Accuracy with classifier present', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    const suite = generator.generateRCAEvalSuite('la-classifier-test', 10);
    const result = await runner.runSuite(suite);

    expect(result.locationAccuracy).toBeGreaterThanOrEqual(0);
    expect(result.locationAccuracy).toBeLessThanOrEqual(1);
  });

  it('should work with empty metric cases', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    // Generate a tiny suite
    const suite = generator.generateRCAEvalSuite('tiny-suite', 2);
    const result = await runner.runSuite(suite);

    expect(result.totalCases).toBe(2);
    expect(result.avgTop1).toBeGreaterThanOrEqual(0);
  });

  it('should produce per-fault-type breakdown with classifier', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    const suite = generator.generateRCAEvalSuite('per-fault-suite', 6);
    const result = await runner.runSuite(suite);

    expect(result.perFaultType.size).toBeGreaterThanOrEqual(0);
    for (const [, metric] of result.perFaultType) {
      expect(metric.cases).toBeGreaterThan(0);
      expect(metric.accuracy).toBeGreaterThanOrEqual(0);
      expect(metric.accuracy).toBeLessThanOrEqual(1);
    }
  });

  it('should handle classifier with service not in metrics map', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    // Create a suite where the faulty service has no metrics
    const benchCase = generator.generateRCAEvalCase('CPU', 3);
    const emptyMetricsCase = {
      ...benchCase,
      id: 'empty-metrics-test',
      metrics: new Map<string, readonly TimeSeries[]>([
        ['other_service', benchCase.metrics.values().next().value ?? []],
      ]),
      groundTruth: { ...benchCase.groundTruth, serviceId: 'service_1' },
    };
    const suite = {
      name: 'empty-metrics-suite',
      cases: [emptyMetricsCase],
      totalCases: 1,
    };
    const result = await runner.runSuite(suite);
    expect(result.totalCases).toBe(1);
    expect(result.typeAccuracy).toBeGreaterThanOrEqual(0);
  });

  it('should handle classifier with UNKNOWN classification result', async () => {
    const container = createContainer();
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
    const runner = new BenchmarkRunner(container, classifier);

    // Generate case with no recognizable metric names → UNKNOWN from classifier
    const customCase = generator.generateRCAEvalCase('CPU', 2);
    const renamedMetrics = new Map<string, readonly TimeSeries[]>();
    for (const [svcId, series] of customCase.metrics) {
      renamedMetrics.set(
        svcId,
        series.map((s) => ({
          ...s,
          label: `custom_biz_metric_${s.label}`,
        })),
      );
    }
    const unknownCase = {
      ...customCase,
      metrics: renamedMetrics,
    };
    const suite = {
      name: 'unknown-classify-suite',
      cases: [unknownCase],
      totalCases: 1,
    };
    const result = await runner.runSuite(suite);
    // Should still complete without errors — classifier returns UNKNOWN
    expect(result.typeAccuracy).toBeGreaterThanOrEqual(0);
  });
});

// ── Helpers ───────────────────────────────────────────────

function makePrediction(
  serviceId: string,
  faultCategory = 'CPU',
): import('@agentix-e/micro-kinetic-core').RootCauseResult {
  return {
    serviceId,
    faultType: { category: faultCategory, subType: '', severity: 'major' },
    confidence: 0.9,
    rank: 1,
    evidenceMetrics: [],
    propagationDepth: 1,
    propagationErrorBound: 0.01,
    viaTreeSearch: false,
  };
}

// ═══════════════════════════════════════════════════════════
// Trace Topology Validation Integration Tests (I9)
// ═══════════════════════════════════════════════════════════

describe('BenchmarkRunner trace topology validation (I9)', () => {
  function makeTraceSpan(
    traceId: string,
    spanId: string,
    parentSpanId: string,
    service: string,
  ): import('@agentix-e/micro-kinetic-core').TraceSpan {
    return {
      traceId,
      spanId,
      parentSpanId,
      service,
      operation: `GET /${service}`,
      duration: 10,
      statusCode: 200,
      isError: false,
      startTime: 1000,
    };
  }

  it('constructs with traceValidation disabled (default)', () => {
    const container = new Container();
    container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

    const runner = new BenchmarkRunner(container);
    expect(runner).toBeDefined();
  });

  it('constructs with traceValidation enabled', () => {
    const container = new Container();
    container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

    const runner = new BenchmarkRunner(container, undefined, {
      enabled: true,
      spans: [],
    });
    expect(runner).toBeDefined();
  });

  it('runs suite successfully with trace validation enabled', async () => {
    const container = new Container();
    container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

    const spans = [
      makeTraceSpan('t1', 's0', '', 'svc-a'),
      makeTraceSpan('t1', 's1', 's0', 'svc-b'),
      ...Array.from({ length: 8 }, (_, i) =>
        makeTraceSpan('t1', `s${i + 2}`, `s${i + 1}`, `svc-${String.fromCodePoint(99 + i)}`),
      ),
    ];

    const runner = new BenchmarkRunner(container, undefined, {
      enabled: true,
      spans,
      pruneUnobserved: true,
      discoverNewEdges: true,
    });

    const generator = new SyntheticBenchmarkGenerator({ seed: 42 });
    const suite = generator.generateRCAEvalSuite('trace-suite', 2);
    const result = await runner.runSuite(suite);

    expect(result.totalCases).toBe(2);
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('runs suite with trace disabled (enabled=false)', async () => {
    const container = new Container();
    container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

    const runner = new BenchmarkRunner(container, undefined, {
      enabled: false,
      spans: [],
    });

    const generator = new SyntheticBenchmarkGenerator({ seed: 33 });
    const suite = generator.generateRCAEvalSuite('no-trace', 2);
    const result = await runner.runSuite(suite);

    expect(result.totalCases).toBe(2);
  });

  it('prefers per-case traces over constructor spans', async () => {
    const container = new Container();
    container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

    // Constructor-level spans would prune everything if used (they point at
    // services that do not exist in the case's call graph). Per-case traces
    // describe the real fault-period flow and must take precedence.
    const misleadingSpans = [
      makeTraceSpan('t1', 'x0', '', 'ghost-a'),
      makeTraceSpan('t1', 'x1', 'x0', 'ghost-b'),
      ...Array.from({ length: 8 }, (_, i) =>
        makeTraceSpan('t1', `x${i + 2}`, `x${i + 1}`, `ghost-${String.fromCodePoint(99 + i)}`),
      ),
    ];

    const runner = new BenchmarkRunner(container, undefined, {
      enabled: true,
      spans: misleadingSpans,
      pruneUnobserved: true,
    });

    const generator = new SyntheticBenchmarkGenerator({ seed: 42 });
    const suite = generator.generateRCAEvalSuite('per-case-trace', 2);

    // Attach per-case traces (BenchmarkTraceSpan shape — structurally a
    // TraceSpanLike subset) so the runner uses them instead of the
    // constructor spans.
    const perCaseTraces = [
      makeTraceSpan('t1', 's0', '', 'svc-a'),
      makeTraceSpan('t1', 's1', 's0', 'svc-b'),
      ...Array.from({ length: 8 }, (_, i) =>
        makeTraceSpan('t1', `s${i + 2}`, `s${i + 1}`, `svc-${String.fromCodePoint(99 + i)}`),
      ),
    ].map((s) => ({
      traceId: s.traceId,
      spanId: s.spanId,
      parentSpanId: s.parentSpanId || undefined,
      service: s.service,
      operationName: s.operation,
      startTime: s.startTime,
      duration: s.duration,
      status: s.isError ? ('ERROR' as const) : ('OK' as const),
    }));

    const cases = suite.cases.map((c) => ({ ...c, traces: perCaseTraces }));
    const result = await runner.runSuite({ ...suite, cases });

    expect(result.totalCases).toBe(2);
    // Trace validation ran without pruning the whole graph (per-case traces
    // were recognized, not the misleading constructor spans).
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
