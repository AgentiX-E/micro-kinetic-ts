export { BENCHMARK_CONTEXTS, expectCloseTo, extractSystemContext } from './context-extractor.js';
export type { CloseToMatcher } from './context-extractor.js';
export type { ContextBenchmark, SystemContext } from './types.js';

export {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_SPACE,
  RANKING_AXES,
  rankingToVector,
  vectorToRanking,
} from './config-space.js';
export type {
  ConfigSpace,
  ContinuousParam,
  DiscreteParam,
  RCAConfiguration,
} from './config-space.js';

export { coordinateDescent } from './coordinate-descent.js';
export type {
  CoordinateDescentOptions,
  CoordinateDescentResult,
  CoordinateDescentStep,
  CoordinateOracle,
} from './coordinate-descent.js';

export {
  minimumStratumSizeForHeldOutCoverage,
  requiredCasesForHeldOutCoverage,
  stratifiedSplit,
} from './split.js';
export type { SplitRatios, SplitResult } from './split.js';

export { GaussianProcess } from './gaussian-process.js';
export type { GPObservation, GPOptions, GPPrediction } from './gaussian-process.js';

export { MetaLearner, loadMetaLearner } from './meta-learner.js';
export type { HistoricalConfig, HistoricalRecord, MetaLearnerOptions } from './meta-learner.js';

export { LLMAdvisor } from './llm-advisor.js';
export type { ExperimentRecord, LLMAdvisorOptions, RankResult } from './llm-advisor.js';

export { AdaptiveConfigOptimizer } from './optimizer.js';
export type {
  BenchmarkOracle,
  IterationRecord,
  OptimizationResult,
  OptimizerOptions,
} from './optimizer.js';

export { ConvergenceChecker } from './convergence-checker.js';
export type { ConvergenceOptions, ConvergenceState } from './convergence-checker.js';

export {
  HELD_AT_ENGINE_DEFAULT,
  UNPASSED_SECOND_ARGUMENT,
  configToPrunerOptions,
  configToTopologyConfig,
  createDefaultEngine,
  createEngineWithConfig,
  formatEngineConfigLine,
} from './integration.js';
export type { TopologyFaultGraphConfig } from './integration.js';

export { ModelStore, loadModel, saveModel } from './persistence.js';
export type { PersistedModel } from './persistence.js';

export { GPStateStore, extractGPState } from './gp-state-store.js';
export type { GPState } from './gp-state-store.js';

export { LLMCacheStore } from './llm-cache-store.js';
export type { LlmCacheEntry } from './llm-cache-store.js';

export {
  cycleCertificate,
  formatAttenuation,
  formatCycleCertificate,
  measureAttenuation,
} from './cycle-bound.js';
export type {
  AttenuationEstimate,
  CycleCertificate,
  CycleCertificateOptions,
  DirectedEdge,
} from './cycle-bound.js';
