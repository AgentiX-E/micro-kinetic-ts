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
// The SHIPPED value of the axis that decides WHICH rescale a large topology gets. Exported so a consumer
// does not have to state it: until it existed, the golden and FSE'26 parsers each carried their own `true`
// while the engine's default was `false`, so three owners of one shipped value could drift — and a caller
// who passed no topology argument ran a configuration the published numbers were not measured under.
export { DEFAULT_RANK_NORMALIZATION } from './causal/topology-fault-graph.js';
// The three topology knobs that were bare literals in this package's defaults table AND in both parsers'
// option objects — eighteen declaration sites, zero names — plus the two whose workflow descriptions can
// only state their shipped value in WORDS. `docs/ranking-default-owners.md` is the census that found them,
// and `packages/kinetic/__tests__/unit/ranking-default-owners.test.ts` is what keeps the list from growing
// back one instance at a time.
export {
  DEFAULT_ANOMALY_BREADTH_GATE,
  DEFAULT_ANOMALY_BREADTH_WEIGHT,
  DEFAULT_ANOMALY_BURST_WEIGHT,
  DEFAULT_ANOMALY_CV_WEIGHT,
  DEFAULT_ANOMALY_TREND_WEIGHT,
  DEFAULT_COLLAPSE_DISCOUNT,
  DEFAULT_METRIC_FLEET_BASELINE,
  DEFAULT_METRIC_RISE_CEILING,
  // The demand guard: an ENROLMENT, not an opt-in, and the only member of its family list is `workload`.
  // Exported with the classifier because a caller that wants to ask "is this metric fault evidence" must
  // ask the same function the guard asks, not a substring test of its own.
  DEFAULT_SUPPRESS_DEMAND_METRICS,
  DEFAULT_SUPPRESS_IDLE_TRANSIENTS,
  DEFAULT_SUPPRESS_NEAR_ZERO_BASELINE_RISE,
  DEFAULT_TOPOLOGY_FAULT_GRAPH_CONFIG,
  DEMAND_METRIC_LABELS,
  isDemandMetric,
  // The transport family, exported on the same rule as the demand family: the term that credits a
  // latency rise and the classifier that calls a latency rise `DELAY` must ask one question.
  isLatencyMetric,
} from './causal/topology-fault-graph.js';
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
  DEFAULT_COLLISION_WEIGHT,
  DEFAULT_FAILED_EDGE_WEIGHT,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_SIGNAL_MODE,
  DEFAULT_LOG_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_PRISM_WEIGHT,
  DEFAULT_RISE_WEIGHT,
  DEFAULT_SELF_TIME_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
  DEFAULT_TOPO_DISCOUNT,
  DEFAULT_TOPO_WEIGHT,
  DEFAULT_TRACE_WEIGHT,
  DEFAULT_TREE_PRUNER_OPTIONS,
  FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR,
  FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU,
  ONSET_SHAPES,
  TreePruner,
  admitsFailedEdgeTerm,
  classifyTermZero,
  computeOnsetSlopes,
  computeTemporalEarliness,
  isOnsetShape,
  sumScoreTerms,
  toRankingWeights,
} from './pruning/pruner.js';
export type { OnsetShape, TreePrunerOptions } from './pruning/pruner.js';

export {
  DEFAULT_FAILED_EDGE_MIN_RECORDS,
  DEFAULT_FAILED_EDGE_MODE,
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_TRACE_ACTIVITY_OPTIONS,
  LOG_SIGNAL_MODES,
  POOL_METRIC_PREFIX,
  computeDeepestExceptions,
  computeEdgeLatencyByCallee,
  computeEdgeLatencyScores,
  computeFailedEdgeScores,
  computeHttpEmitterDominance,
  computeHttpVictimSet,
  computeLogNoveltyScores,
  computeLogScores,
  computePoolMetricScores,
  computeRiseScores,
  computeSelfTimeScores,
  computeStabilityScores,
  computeTopoSourceScores,
  computeTraceActivityScores,
  gatedRiseContribution,
  isLogSignalMode,
  // Level 1 of the log gate, exported because the census that attributes an EMPTY log tier has to read the same
  // rule the scorer does: "retained but not admitted" is a mechanism, and a census spelling its own version of
  // the admission test would be free to disagree with the map it is trying to explain.
  logLineAdmittedByMode,
} from './pruning/ranking-signals.js';
export type {
  FailedEdgeMode,
  HttpEmitterDominance,
  HttpSourceJointContext,
  InboundLatency,
  LogSignalMode,
  TraceActivityOptions,
} from './pruning/ranking-signals.js';

export {
  DEFAULT_PRISM_POOLING,
  PRISM_POOLINGS,
  computePrismScores,
  isPrismPooling,
} from './pruning/prism-signal.js';
export type { PrismPooling } from './pruning/prism-signal.js';

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
