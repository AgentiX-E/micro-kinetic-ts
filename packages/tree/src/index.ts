/**
 * @agentix-e/micro-kinetic-tree
 *
 * Collision Tree fault propagation pruning RCA engine.
 *
 * ## Overview
 *
 * This package applies Deng Yu's (2026 Fields Medal) kinetic theory
 * to AIOps microservice root cause analysis through the collision
 * tree model:
 *
 * ```
 * Service Call Graph → Fault Propagation Graph → Pruned Tree → Root Causes
 *                        (cycle detection)        (w(C) < ε)
 * ```
 *
 * ## Core Components
 *
 * | Module | Component | Deng Yu Mapping |
 * |--------|-----------|----------------|
 * | `graph/cycle-detector` | JohnsonCycleDetector | Closed-loop collision trajectory enumeration |
 * | `pruning/contribution` | CollisionContributionAnalyzer | Collision cross-section product w(C) |
 * | `pruning/pruner` | TreePruner | Cycle removal in rarefied gas limit |
 * | `rca/tree-rca` | TreeRCAEngine | Bottom-up kinetic energy accumulation |
 * | `rca/confidence` | ConfidenceEstimator | BBGKY truncation error bounds |
 * | `math/numpy-provider` | NumpyTsMatrixOps | Collision operator spectral analysis |
 * | `math/ubique-provider` | UbiqueLinearAlgebra | Boltzmann equation solver |
 *
 * ## Key Results
 *
 * - **Complexity**: NP-hard graph RCA → O(V+E) tree RCA
 * - **Guarantee**: Σw(C) ≤ K×ε when systemLoad < λ_critical
 * - **Accuracy**: Error bound ε_k = 1 - α^k for depth k
 *
 * @module @agentix-e/micro-kinetic-tree
 */

// Graph algorithms
export {
  JohnsonCycleDetector,
  buildAdjacencyList,
  cycleKey,
  tarjanSCC,
} from './graph/cycle-detector.js';
export type { JohnsonCycleOptions } from './graph/cycle-detector.js';

// Causal (topology fault graph)
// `rankNormalizeScores` is public because it defines the contract of
// `HttpSourceJointContext.anomalyScores`: the joint gate compares callee against
// emitter, and that comparison is provably invariant under any strictly monotone
// rescale (rank or min-max). Consumers need to be able to verify that property
// rather than infer it — see the invariance suite in `ranking-signals.test.ts`.
export { rankNormalizeScores } from './causal/topology-fault-graph.js';
// The threshold is public for the same reason `rankNormalizeScores` is, one step earlier in the
// chain: it decides WHETHER a case's anomaly scores were rescaled at all, so a consumer holding a
// per-service vector and a node count can say which quantity it is looking at. Without it, a
// below-threshold vector reads as a rescaled one and the reader inherits the engine's ORDER while
// silently inventing its gaps — the defect `docs/fse26-cv-screen.md` §"The cause, and the fix" records.
export { ANOMALY_NORMALIZE_NODE_THRESHOLD } from './causal/topology-fault-graph.js';
// The topology config is part of the public surface: `TreePruner` takes a
// `Partial<TopologyFaultGraphConfig>` as its second constructor argument, so a
// consumer that wants to name the object it builds — rather than infer it — needs
// the type. It is also the home of the scoring ablation switches, which a
// benchmark harness has to be able to describe.
export type {
  MetricBreakdown,
  MetricDiagnostic,
  MetricDiagnosticOutcome,
  TopologyFaultGraphConfig,
} from './causal/topology-fault-graph.js';

// Pruning
export { CollisionContributionAnalyzer, buildEdgeWeightMap } from './pruning/contribution.js';
export type { DecayParams, EdgeWeightMap } from './pruning/contribution.js';

export {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  ONSET_SHAPES,
  TreePruner,
  computeOnsetSlopes,
  computeTemporalEarliness,
  isOnsetShape,
  toRankingWeights,
} from './pruning/pruner.js';
export type { OnsetShape, TreePrunerOptions } from './pruning/pruner.js';

export {
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_TRACE_ACTIVITY_OPTIONS,
  POOL_METRIC_PREFIX,
  computeDeepestExceptions,
  computeEdgeLatencyScores,
  computeFailedEdgeScores,
  computeHttpEmitterDominance,
  computeHttpVictimSet,
  computeLogNoveltyScores,
  computeLogScores,
  computePoolMetricScores,
  computeRiseScores,
  computeStabilityScores,
  computeTopoSourceScores,
  computeTraceActivityScores,
  gatedRiseContribution,
} from './pruning/ranking-signals.js';
export type {
  FailedEdgeMode,
  HttpEmitterDominance,
  HttpSourceJointContext,
  LogSignalMode,
  TraceActivityOptions,
} from './pruning/ranking-signals.js';

export { computePrismScores } from './pruning/prism-signal.js';

// RCA
export { TreeRCAEngine } from './rca/tree-rca.js';
export type { TreeRCAOptions } from './rca/tree-rca.js';

export { ConfidenceEstimator, boundToConfidence, estimateErrorBound } from './rca/confidence.js';
export type { ConfidenceOptions } from './rca/confidence.js';

// Math providers
export { NumpyTsMatrixOps } from './math/numpy-provider.js';
export { UbiqueLinearAlgebra } from './math/ubique-provider.js';

// DI factories
export {
  createConfidenceEstimator,
  createNumpyTsMatrixOps,
  createTreePruner,
  createTreeRCAEngine,
  createUbiqueLinearAlgebra,
  registerTreeModule,
} from './di/factories.js';
