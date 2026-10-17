/**
 * DI Factory registrations for @agentix-e/micro-kinetic-tree.
 *
 * Provides factory functions that wire up the collision tree RCA
 * engine components for use with the AgentiX-E DI container.
 *
 * ## Registration Pattern
 *
 * ```typescript
 * import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
 * import { registerTreeModule } from '@agentix-e/micro-kinetic-tree';
 *
 * const container = new Container();
 * registerTreeModule(container);
 *
 * const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
 * ```
 *
 * ## Deng Yu Mapping
 *
 * The DI wiring corresponds to assembling the kinetic theory
 * computational pipeline:
 * - Matrix ops → collision cross-section computation
 * - Linear algebra → Boltzmann equation solver
 * - RCA engine → collision tree pruning + root cause ranking
 *
 * @module di/factories
 */

import { DI_TOKENS, type IContainer, invariant } from '@agentix-e/micro-kinetic-core';

import { NumpyTsMatrixOps } from '../math/numpy-provider.js';
import { UbiqueLinearAlgebra } from '../math/ubique-provider.js';
import { TreePruner } from '../pruning/pruner.js';
import { ConfidenceEstimator } from '../rca/confidence.js';
import { TreeRCAEngine } from '../rca/tree-rca.js';

/**
 * Factory: create a TreePruner (IRCAEngine implementation).
 *
 * Uses collision tree pruning — detects cycles, computes
 * contributions w(C), prunes cycles with w(C) < ε, and
 * performs RCA on the resulting tree.
 *
 * @param container - DI container for resolving dependencies
 * @returns Configured TreePruner instance
 */
export function createTreePruner(_container: IContainer): TreePruner {
  return new TreePruner({
    pruneEpsilon: 0.01,
    criticalLoadThreshold: 0.7,
    defaultTopK: 10,
    maxPropagationDepth: 20,
    maxCycles: 10_000,
  });
}

/**
 * Factory: create a TreeRCAEngine (tree-based root cause ranker).
 *
 * Performs bottom-up anomaly score accumulation on the pruned
 * tree in O(V+E) time, ranking root cause candidates.
 *
 * @param container - DI container for resolving dependencies
 * @returns Configured TreeRCAEngine instance
 */
export function createTreeRCAEngine(_container: IContainer): TreeRCAEngine {
  return new TreeRCAEngine({
    decayAlpha: 0.8,
    tauMs: 1000,
    defaultTopK: 10,
  });
}

/**
 * Factory: create a ConfidenceEstimator.
 *
 * Estimates propagation error bounds k hops from root cause,
 * based on the geometric series bound from the BBGKY hierarchy.
 *
 * @param container - DI container for resolving dependencies
 * @returns Configured ConfidenceEstimator instance
 */
export function createConfidenceEstimator(_container: IContainer): ConfidenceEstimator {
  return new ConfidenceEstimator({
    alpha: 0.85,
    applyDepthPenalty: true,
    depthPenaltyCoeff: 1.0,
  });
}

/**
 * Factory: create a NumpyTsMatrixOps (IMatrixOps implementation).
 *
 * Uses numpy-ts for matrix multiplication, eigenvalues, SVD,
 * and graph spectrum computation.
 *
 * @param container - DI container for resolving dependencies
 * @returns Configured NumpyTsMatrixOps instance
 */
export function createNumpyTsMatrixOps(_container: IContainer): NumpyTsMatrixOps {
  return new NumpyTsMatrixOps();
}

/**
 * Factory: create a UbiqueLinearAlgebra (ILinearAlgebra implementation).
 *
 * Uses ubique (Rust nalgebra → WASM) for LU decomposition,
 * linear system solve, matrix inverse, and determinant.
 *
 * @param container - DI container for resolving dependencies
 * @returns Configured UbiqueLinearAlgebra instance
 */
export function createUbiqueLinearAlgebra(_container: IContainer): UbiqueLinearAlgebra {
  return new UbiqueLinearAlgebra();
}

/**
 * Register all tree module components in the DI container.
 *
 * This is the one-shot registration function that wires up
 * the entire collision tree RCA pipeline:
 *
 * - **MATRIX_OPS**: NumpyTsMatrixOps (numpy-ts backend)
 * - **LINEAR_ALGEBRA**: UbiqueLinearAlgebra (ubique backend)
 * - **RCA_ENGINE**: TreePruner (collision tree pruning)
 * - **ROOT_CAUSE_RANKER**: TreeRCAEngine (tree-based ranking)
 *
 * ### Deng Yu Mapping
 *
 * This registration assembles the complete kinetic theory
 * computational pipeline, from collision operator spectral
 * analysis through cycle pruning to root cause ranking.
 *
 * @param container - DI container to register into
 */
export function registerTreeModule(container: IContainer): void {
  invariant(!!container, 'container must be provided');

  // Math backends
  container.register(DI_TOKENS.MATRIX_OPS, createNumpyTsMatrixOps, true);
  container.register(DI_TOKENS.LINEAR_ALGEBRA, createUbiqueLinearAlgebra, true);

  // RCA engine (collision tree pruning)
  container.register(DI_TOKENS.RCA_ENGINE, createTreePruner, true);

  // Root cause ranker (tree-based scoring)
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, createTreeRCAEngine, true);
}
