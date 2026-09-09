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
export {
  FSE26Loader,
  buildFSE26CallGraph,
  buildFSE26StaticEdges,
  buildFSE26TraceEdges,
  resolveFSE26GroundTruth,
  toFSE26LogEntry,
  toFSE26MetricMap,
} from './loaders/fse26-loader.js';
export type { FSE26RawCase } from './loaders/fse26-loader.js';
export { RCA100Loader } from './loaders/rca100-loader.js';
export {
  RCAEvalLoader,
  classifyLogLevel,
  countTraceActivityByService,
  extractDeepestExceptionClass,
  extractExceptionNames,
  extractSpringBootLevel,
  isLogicExceptionMessage,
  isPropagatedExceptionMessage,
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

// ── SOTA Leaderboard ──────────────────────────────────────

export {
  SOTA_LEADERBOARD_VERSION,
  VALIDATION_CODES,
  createSotaLeaderboard,
  entriesByCohort,
  isOursMeasured,
  isPublished,
  marginTo,
  requireComparable,
  validateLeaderboard,
} from './leaderboard/sota-leaderboard.js';

export type {
  Cohort,
  EntryMargin,
  LeaderboardEntry,
  LeaderboardTable,
  OursMeasuredProvenance,
  Paradigm,
  Provenance,
  PublishedProvenance,
  ValidationCode,
  ValidationIssue,
  ValidationReport,
  ValidationSeverity,
} from './leaderboard/sota-leaderboard.js';

export {
  classifyMetricChannel,
  combinePrismScore,
  computePrismRanking,
  deviationZScore,
  prismTop1,
} from './leaderboard/prism.js';

export type { MetricChannel, PrismPooling, PrismServiceScore } from './leaderboard/prism.js';

export { computeFusionCeiling, computeFusionCeilingByCell } from './leaderboard/fusion-ceiling.js';

export type { FusionCasePrediction, FusionCeiling } from './leaderboard/fusion-ceiling.js';

export { analyzePrismSweep } from './leaderboard/prism-sweep.js';

export type { PrismSweepAnalysis, SweepCell, SweepPoint } from './leaderboard/prism-sweep.js';

export {
  RESOURCE_FAULT_TYPES,
  analyzeRoutingProbe,
  engineMargin,
  prismMargin,
  regressionCellKey,
} from './leaderboard/routing-probe.js';

export type {
  RoutingDecision,
  RoutingProbeAnalysis,
  RoutingProbeRecord,
  RuleResult,
} from './leaderboard/routing-probe.js';

// ── Synthetic Data Generator ──────────────────────────────

export { SyntheticBenchmarkGenerator } from './synthetic/data-generator.js';

// ── Evaluation Metrics ────────────────────────────────────

export {
  avgAtK,
  avgAtKMultiLabel,
  computeAIOps2025CompositeScore,
  computeAggregateLA,
  computeAggregateMRR,
  computeAggregateTA,
  computeAvgAtK,
  computeAvgAtKMultiLabel,
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
  CasePrediction,
  CompleteBenchmarkReport,
  FailedCase,
  FaultTypeMetric,
  RunResult,
} from './runners/benchmark-runner.js';
