/**
 * @agentix-e/micro-kinetic-core
 *
 * Zero-dependency contract layer for the AIOps-Kinetic framework.
 *
 * This package defines:
 * - Types: data structures for graphs, time series, faults, alerts, coupling, benchmarks
 * - Interfaces: engine contracts (RCA, Cutting, Denoise, Scaling, Wave) and math provider abstraction
 * - DI Tokens: Symbol-based dependency injection registry
 * - DI Container: minimal DI container for token registration and resolution
 * - Exceptions: typed error hierarchy for error classification
 * - Utilities: invariant assertions
 *
 * ## Design Principle
 * core NEVER imports any npm package that isn't a devDependency.
 * It defines WHAT the system can do, never HOW.
 * Real implementations live in the sibling packages (tree, cutting, noise, scaling, wave, kinetic).
 *
 * ## Deng Yu's Kinetic Theory Mapping
 * This framework maps six concepts from Deng Yu's Fields Medal-winning work
 * (rigorous derivation of the Boltzmann equation from hard-sphere dynamics)
 * to AIOps microservice root cause analysis:
 *
 * 1. Collision Tree → Fault Propagation Tree Pruning (tree package)
 * 2. Cutting Algorithm → Chronic Fault Time-Segmented Induction (cutting package)
 * 3. Stosszahlansatz → Alert Denoising via Coupling Sparsity (noise package)
 * 4. BBGKY Hierarchy → Multi-Service Coupling Truncation (scaling package)
 * 5. Boltzmann-Grad Limit → Service Scaling Analysis (scaling package)
 * 6. Wave Kinetic Equation → Alert Cascade Propagation (wave package)
 *
 * @packageDocumentation
 */

// ── Types ────────────────────────────────────────────────
export type * from './types/alerts.js';
export type * from './types/benchmark.js';
export type * from './types/coupling.js';
export type * from './types/faults.js';
export type * from './types/graph.js';
export type * from './types/probability.js';
export type * from './types/time-series.js';

// ── Interfaces ───────────────────────────────────────────
export type * from './interfaces/cutting-engine.js';
export type * from './interfaces/denoise-engine.js';
export type * from './interfaces/math-provider.js';
export type * from './interfaces/rca-engine.js';
export type * from './interfaces/scaling-engine.js';
export type * from './interfaces/wave-engine.js';

// ── DI ───────────────────────────────────────────────────
export { CircularDependencyError, Container, ContainerResolutionError } from './di/container.js';
export type { Factory, IContainer } from './di/container.js';
export type * from './di/registry.js';
export { DI_TOKENS } from './di/tokens.js';
export type { DIToken } from './di/tokens.js';

// ── Exceptions ───────────────────────────────────────────
export {
  KineticConfigError,
  KineticError,
  KineticPrecisionError,
  KineticTimeoutError,
  KineticValidationError,
} from './exceptions/base.js';
export {
  BenchmarkFormatError,
  BenchmarkLoadError,
  BenchmarkValidationError,
} from './exceptions/benchmark.js';
export {
  ConvergenceTimeoutError,
  InductionError,
  InvalidWindowError,
} from './exceptions/convergence.js';
export {
  DisconnectedGraphError,
  EmptyGraphError,
  GraphCycleError,
  PruningFailureError,
} from './exceptions/graph.js';

// ── Utilities ────────────────────────────────────────────
export {
  invariant,
  invariantFinite,
  invariantNonEmpty,
  invariantPositiveInt,
  invariantRange,
} from './utils/invariant.js';

// ── Constants ────────────────────────────────────────────
export { DEFAULT_STOSS_PARAMS } from './types/alerts.js';
export { DEFAULT_BBGKY_OPTIONS } from './types/coupling.js';
export { DEFAULT_RCA_OPTIONS } from './types/faults.js';
export { DEFAULT_CUTTING_OPTIONS } from './types/time-series.js';
