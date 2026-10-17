/**
 * Factory registry — provides factory function type definitions
 * for all engine interfaces.
 *
 * These are type-only helpers used by sub-packages when declaring
 * their factory registrations. They enforce type safety at
 * registration time via the Container.resolve() return type.
 *
 * @module di/registry
 */

import type { IConvergenceProver, ICuttingEngine } from '../interfaces/cutting-engine.js';
import type { IDenoiseEngine, IIndependenceChecker } from '../interfaces/denoise-engine.js';
import type {
  IArbitraryPrecision,
  ILinearAlgebra,
  IMatrixOps,
  IStatistics,
} from '../interfaces/math-provider.js';
import type { IRCAEngine, IRootCauseRanker } from '../interfaces/rca-engine.js';
import type { IHierarchyTruncator, IScalingAnalyzer } from '../interfaces/scaling-engine.js';
import type {
  ICascadeSimulator,
  ICorrelationDecayEstimator,
  IWavePropagationModel,
} from '../interfaces/wave-engine.js';
import type { IContainer } from './container.js';

/** Factory function type alias for cleaner registration code. */
export type FactoryFn<T> = (container: IContainer) => T;

/** Signature for all math backend factories. */
export type MathBackendFactory = FactoryFn<
  IMatrixOps | IStatistics | ILinearAlgebra | IArbitraryPrecision
>;

/** Signature for all engine factories. */
export type EngineFactory = FactoryFn<
  | IRCAEngine
  | IRootCauseRanker
  | ICuttingEngine
  | IConvergenceProver
  | IDenoiseEngine
  | IIndependenceChecker
  | IScalingAnalyzer
  | IHierarchyTruncator
  | IWavePropagationModel
  | ICascadeSimulator
  | ICorrelationDecayEstimator
>;
