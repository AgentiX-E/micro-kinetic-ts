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

// ── DI Container ──────────────────────────────────────────

export { createDefaultContainer } from './di/container.js';

// ── Defaults ──────────────────────────────────────────────

export { DEFAULTS } from './di/defaults.js';

// ── Pipeline ──────────────────────────────────────────────

export { RCAPipeline, registerRCAPipeline } from './pipeline/rca-pipeline.js';
export type {
  RCAPipelineResult,
  RCAPipelineConfig,
  StageResult,
} from './pipeline/rca-pipeline.js';
export { DEFAULT_PIPELINE_CONFIG } from './pipeline/rca-pipeline.js';

// ── Pipeline Factory ──────────────────────────────────────

export {
  createPipeline,
  createAcutePipeline,
  createChronicPipeline,
  createAlertStormPipeline,
  createFullPipeline,
} from './pipeline/pipeline-factory.js';
export type {
  PipelineScenario,
  PipelineFactoryResult,
} from './pipeline/pipeline-factory.js';

// ── CLI ───────────────────────────────────────────────────

export {
  createProgram,
  runCli,
} from './cli/index.js';

// ── Formatters ────────────────────────────────────────────

export {
  formatRCATable,
  formatDenoiseTable,
  formatBenchmarkTable,
} from './cli/formatters/table.js';
export { formatJson } from './cli/formatters/json.js';

// ── Benchmarks ─────────────────────────────────────────

export {
  // Loaders
  RCAEvalLoader,
  AIOps2025Loader,
  RCA100Loader,
  // Synthetic Data
  SyntheticBenchmarkGenerator,
  // Metrics
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
  // Runner
  BenchmarkRunner,
} from './benchmarks/index.js';

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
  FaultTypeMetric,
  FailedCase,
  RunResult,
  CompleteBenchmarkReport,
} from './benchmarks/index.js';
