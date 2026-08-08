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

// Pruning
export { CollisionContributionAnalyzer, buildEdgeWeightMap } from './pruning/contribution.js';
export type { DecayParams, EdgeWeightMap } from './pruning/contribution.js';

export { TreePruner } from './pruning/pruner.js';
export type { TreePrunerOptions } from './pruning/pruner.js';

// RCA
export { TreeRCAEngine } from './rca/tree-rca.js';
export type { TreeRCAOptions } from './rca/tree-rca.js';

export { IntelligentFaultClassifier } from './rca/intelligent-fault-classifier.js';
export type { FaultClassification, IntelligentClassifierOptions } from './rca/intelligent-fault-classifier.js';

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
