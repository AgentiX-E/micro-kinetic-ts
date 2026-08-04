/**
 * @agentix-e/micro-kinetic — Umbrella Package
 *
 * Aggregation package for the AIOps-Kinetic framework.
 * Provides:
 * - Global DI container assembly (createDefaultContainer)
 * - Full RCA pipeline (RCAPipeline)
 * - Scenario-based pipeline factory
 * - CLI tools (analyze, benchmark, denoise)
 *
 * === Deng Yu Kinetic Theory Mapping ===
 *
 * This umbrella package assembles the complete kinetic theory
 * pipeline from Deng Yu's Fields Medal-winning work (2026):
 *
 *   Collision Tree  →  Cutting Algorithm  →  Stosszahlansatz
 *        ↓                    ↓                     ↓
 *   Cycle Pruning    Convergent Segments    Alert Independence
 *
 *   BBGKY Hierarchy  →  Boltzmann-Grad  →  Wave Kinetics
 *        ↓                    ↓                  ↓
 *   k-Service Corr.    P_fault(N→∞)        Cascade Sim.
 *
 * @packageDocumentation
 */

// ── Re-export from sub-packages ───────────────────────────

// Core (types, interfaces, DI, exceptions, utils)
export * from '@agentix-e/micro-kinetic-core';

// Tree (collision tree pruning RCA)
export * from '@agentix-e/micro-kinetic-tree';

// Cutting (chronic fault detection)
export * from '@agentix-e/micro-kinetic-cutting';

// Noise (Stosszahlansatz denoising)
export * from '@agentix-e/micro-kinetic-noise';

// Scaling (BBGKY hierarchy + Boltzmann-Grad limit)
export * from '@agentix-e/micro-kinetic-scaling';

// Wave (cascade propagation + correlation decay)
export * from '@agentix-e/micro-kinetic-wave';

// ── Fault Classifiers ─────────────────────────────────────

export { LLMFaultClassifier } from './classifiers/llm-classifier.js';
export type { LLMClassifierConfig } from './classifiers/llm-classifier.js';
export { PyramidFaultClassifier } from './classifiers/pyramid-classifier.js';
export type { PyramidClassifierConfig } from './classifiers/pyramid-classifier.js';

// ── DI Container ──────────────────────────────────────────

export { createDefaultContainer } from './di/container.js';

// ── Signals ──────────────────────────────────────────────

export {
  MultiSignalFusionEngine,
} from './signals/fusion-engine.js';

export {
  TraceSignalProvider,
} from './signals/trace-provider.js';

export {
  LogSignalProvider,
} from './signals/log-provider.js';
export type { LogEntry, LogTemplate } from './signals/log-provider.js';

export {
  augmentTopologyWithTraces,
  canValidateWithTraces,
} from './signals/trace-topology.js';
export type { TraceTopologyConfig } from './signals/trace-topology.js';

// ── Defaults ──────────────────────────────────────────────

export { DEFAULTS } from './di/defaults.js';

// ── Pipeline ──────────────────────────────────────────────

export {
  DEFAULT_PIPELINE_CONFIG,
  RCAPipeline,
  registerRCAPipeline,
} from './pipeline/rca-pipeline.js';
export type { RCAPipelineConfig, RCAPipelineResult, StageResult } from './pipeline/rca-pipeline.js';

// ── Pipeline Factory ──────────────────────────────────────

export {
  createAcutePipeline,
  createAlertStormPipeline,
  createChronicPipeline,
  createFullPipeline,
  createPipeline,
} from './pipeline/pipeline-factory.js';
export type { PipelineFactoryResult, PipelineScenario } from './pipeline/pipeline-factory.js';

// ── CLI ───────────────────────────────────────────────────

export { createProgram, runCli } from './cli/index.js';

// ── Formatters ────────────────────────────────────────────

export { formatJson } from './cli/formatters/json.js';
export {
  formatBenchmarkTable,
  formatDenoiseTable,
  formatRCATable,
} from './cli/formatters/table.js';

// ── Benchmarks ─────────────────────────────────────────

export {
  AIOps2025Loader,
  // Runner
  BenchmarkRunner,
  RCA100Loader,
  // Loaders
  RCAEvalLoader,
  // Synthetic Data
  SyntheticBenchmarkGenerator,
  // Metrics
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
} from './benchmarks/index.js';

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
  CompleteBenchmarkReport,
  FailedCase,
  FaultTypeMetric,
  RCA100Case,
  RCA100GroundTruthLayers,
  RCA100Suite,
  RCAEvalCase,
  RCAEvalSuite,
  RunResult,
} from './benchmarks/index.js';
// ci: trigger I1 benchmark 1785834730
