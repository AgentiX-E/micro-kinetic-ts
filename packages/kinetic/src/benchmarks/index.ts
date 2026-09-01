/**
 * Benchmarks — barrel export.
 *
 * Provides loaders for RCAEval, AIOps2025, and RCA100 benchmark datasets,
 * a synthetic data generator for testing, and the benchmark runner framework.
 *
 * @module benchmarks
 */

// ── Loaders ───────────────────────────────────────────────

export { AIOps2025Loader } from './loaders/aiops2025-loader.js';
export { RCA100Loader } from './loaders/rca100-loader.js';
export {
  RCAEvalLoader,
  classifyLogLevel,
  countTraceActivityByService,
  extractDeepestExceptionClass,
  extractExceptionNames,
  extractSpringBootLevel,
  isLogicExceptionMessage,
  isStackTraceMessage,
} from './loaders/rcaeval-loader.js';

export type {
  AIOps2025Case,
  AIOps2025LabelScores,
  AIOps2025Suite,
  BenchmarkAlert,
  BenchmarkCase,
  BenchmarkEvent,
  BenchmarkGroundTruth,
  BenchmarkLogEntry,
  BenchmarkSuite,
  BenchmarkTraceSpan,
  RCA100Case,
  RCA100GroundTruthLayers,
  RCA100Suite,
  RCAEvalCase,
  RCAEvalSuite,
} from './loaders/types.js';

// ── Synthetic Data Generator ──────────────────────────────

export { SyntheticBenchmarkGenerator } from './synthetic/data-generator.js';

// ── Evaluation Metrics ────────────────────────────────────

export {
  avgAtK,
  computeAIOps2025CompositeScore,
  computeAggregateLA,
  computeAggregateMRR,
  computeAggregateTA,
  computeAvgAtK,
  computeF1Score,
  computeLA,
  computeMRR,
  computePrecisionAtK,
  computeRCA100CompositeScore,
  computeRecallAtK,
  computeTA,
} from './runners/metrics.js';

// ── Benchmark Runner ──────────────────────────────────────

export { BenchmarkRunner } from './runners/benchmark-runner.js';

export type {
  CompleteBenchmarkReport,
  FailedCase,
  FaultTypeMetric,
  RunResult,
} from './runners/benchmark-runner.js';
