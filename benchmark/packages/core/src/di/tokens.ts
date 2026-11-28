/**
 * DI Token registry for @agentix-e/micro-kinetic.
 *
 * All dependency injection tokens are defined as Symbol.for()
 * with the 'micro-kinetic:' namespace prefix. This ensures
 * cross-package token identity without circular dependencies.
 *
 * Pattern: Symbol.for('micro-kinetic:<Category>')
 *
 * @module di/tokens
 */

export const DI_TOKENS = {
  // ── Math Backends ──────────────────────────────────────
  /** IMatrixOps implementation (default: numpy-ts) */
  MATRIX_OPS: Symbol.for('micro-kinetic:MatrixOps'),

  /** IStatistics implementation (default: simple-statistics) */
  STATISTICS: Symbol.for('micro-kinetic:Statistics'),

  /** ILinearAlgebra implementation (default: ubique) */
  LINEAR_ALGEBRA: Symbol.for('micro-kinetic:LinearAlgebra'),

  /** IArbitraryPrecision implementation (default: decimal.js) */
  ARBITRARY_PRECISION: Symbol.for('micro-kinetic:ArbitraryPrecision'),

  // ── Engines ────────────────────────────────────────────
  /** IRCAEngine implementation — collision tree RCA */
  RCA_ENGINE: Symbol.for('micro-kinetic:RCAEngine'),

  /** IRootCauseRanker implementation */
  ROOT_CAUSE_RANKER: Symbol.for('micro-kinetic:RootCauseRanker'),

  /** ICuttingEngine implementation — chronic fault cutting */
  CUTTING_ENGINE: Symbol.for('micro-kinetic:CuttingEngine'),

  /** IConvergenceProver implementation */
  CONVERGENCE_PROVER: Symbol.for('micro-kinetic:ConvergenceProver'),

  /** IDenoiseEngine implementation — Stosszahlansatz denoising */
  DENOISE_ENGINE: Symbol.for('micro-kinetic:DenoiseEngine'),

  /** IIndependenceChecker implementation */
  INDEPENDENCE_CHECKER: Symbol.for('micro-kinetic:IndependenceChecker'),

  /** IScalingAnalyzer implementation — BBGKY + Boltzmann-Grad */
  SCALING_ANALYZER: Symbol.for('micro-kinetic:ScalingAnalyzer'),

  /** IHierarchyTruncator implementation */
  HIERARCHY_TRUNCATOR: Symbol.for('micro-kinetic:HierarchyTruncator'),

  /** IWavePropagationModel implementation — alert cascade */
  WAVE_PROPAGATION_MODEL: Symbol.for('micro-kinetic:WavePropagationModel'),

  /** ICascadeSimulator implementation */
  CASCADE_SIMULATOR: Symbol.for('micro-kinetic:CascadeSimulator'),

  /** ICorrelationDecayEstimator implementation */
  CORRELATION_DECAY_ESTIMATOR: Symbol.for('micro-kinetic:CorrelationDecayEstimator'),

  // ── Data ───────────────────────────────────────────────
  /** Benchmark dataset loader */
  BENCHMARK_LOADER: Symbol.for('micro-kinetic:BenchmarkLoader'),

  // ── Pipeline ───────────────────────────────────────────
  /** Full RCA pipeline */
  RCA_PIPELINE: Symbol.for('micro-kinetic:RCAPipeline'),

  // ── Timing / Causal Direction ──────────────────────────
  /** ITimingProviderRegistry — ordered provider chain */
  TIMING_REGISTRY: Symbol.for('micro-kinetic:TimingRegistry'),

  /** ITimingProvider — trace-based temporal direction */
  TRACE_TIMING_PROVIDER: Symbol.for('micro-kinetic:TraceTiming'),

  /** ITimingProvider — log-based temporal direction */
  LOG_TIMING_PROVIDER: Symbol.for('micro-kinetic:LogTiming'),

  /** ITimingProvider — Granger causality direction */
  GRANGER_CAUSALITY_PROVIDER: Symbol.for('micro-kinetic:GrangerCausality'),

  /** ITimingProvider — static config direction */
  STATIC_DIRECTION_PROVIDER: Symbol.for('micro-kinetic:StaticDirection'),

  /** ISignalProvider — multi-signal fusion */
  SIGNAL_PROVIDER: Symbol.for('micro-kinetic:SignalProvider'),
} as const;

/** Type helper: extracts the Symbol type from DI_TOKENS values. */
export type DIToken = (typeof DI_TOKENS)[keyof typeof DI_TOKENS];
