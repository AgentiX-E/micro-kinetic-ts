/**
 * Benchmarks — barrel export.
 *
 * Provides loaders for RCAEval, AIOps2025, and RCA100 benchmark datasets,
 * a synthetic data generator for testing, and the benchmark runner framework.
 *
 * @module benchmarks
 */

// ── Loaders ───────────────────────────────────────────────

export { RCAEvalLoader } from './loaders/rcaeval-loader.js';
export { AIOps2025Loader } from './loaders/aiops2025-loader.js';
export { RCA100Loader } from './loaders/rca100-loader.js';

export type {
  BenchmarkCase,
  BenchmarkSuite,
  BenchmarkGroundTruth,
  BenchmarkLogEntry,
  BenchmarkTraceSpan,
  BenchmarkEvent,
  BenchmarkAlert,
  RCAEvalCase,
  RCAEvalSuite,
  AIOps2025Case,
  AIOps2025Suite,
  AIOps2025LabelScores,
  RCA100Case,
  RCA100Suite,
  RCA100GroundTruthLayers,
} from './loaders/types.js';

// ── Synthetic Data Generator ──────────────────────────────

export { SyntheticBenchmarkGenerator } from './synthetic/data-generator.js';

// ── Evaluation Metrics ────────────────────────────────────

export {
  avgAtK,
  computeAvgAtK,
  computePrecisionAtK,
  computeRecallAtK,
  computeF1Score,
  computeMRR,
  computeAggregateMRR,
  computeLA,
  computeAggregateLA,
  computeTA,
  computeAggregateTA,
  computeAIOps2025CompositeScore,
  computeRCA100CompositeScore,
} from './runners/metrics.js';

// ── Benchmark Runner ──────────────────────────────────────

export { BenchmarkRunner } from './runners/benchmark-runner.js';

export type {
  FaultTypeMetric,
  FailedCase,
  RunResult,
  CompleteBenchmarkReport,
} from './runners/benchmark-runner.js';
