/**
 * @agentix-e/micro-kinetic-cutting
 *
 * Cutting Algorithm for AIOps Chronic Fault Detection.
 *
 * ## Deng Yu's Kinetic Theory Mapping (邓煜切割算法)
 *
 * This package implements Deng Yu's (2026 Fields Medal) cutting algorithm
 * from kinetic theory, applied to AIOps chronic fault detection:
 *
 *   - **Long-time interval [0,T]** → 72h monitoring window
 *   - **N cutting windows** → Short observation segments
 *   - **Local kinetic energy ε_j** → Error bound per window
 *   - **Inductive proof** → Global convergence guarantee
 *
 * ## Modules
 *
 * - **Segmentation** — AdaptiveWindowCutter, FixedWindowCutter
 * - **Convergence** — LocalErrorEstimator, InductionProver
 * - **Chronic** — MemoryLeakDetector, ConnectionPoolDetector,
 *   DegradationCurveAnalyzer, PatternClassifier
 *
 * ## Usage
 *
 * ```typescript
 * import { AdaptiveWindowCutter } from '@agentix-e/micro-kinetic-cutting';
 *
 * const cutter = new AdaptiveWindowCutter();
 * const windows = cutter.segment(myTimeSeries, { maxWindows: 50 });
 * const bounds = cutter.estimateLocalBounds(windows, 'mem_rss');
 * const proof = cutter.proveConvergence(bounds, 0.01);
 * ```
 *
 * @packageDocumentation
 */

// ── Segmentation engines ─────────────────────────────────
export { AdaptiveWindowCutter, computeKineticEnergyBound } from './segmentation/adaptive-cutter.js';
export { FixedWindowCutter } from './segmentation/fixed-cutter.js';

// ── Convergence analysis ─────────────────────────────────
export {
  DEFAULT_ERROR_ESTIMATOR_CONFIG,
  DegradationType,
  LocalErrorEstimator,
  computeExponentialErrorBound,
  computeLinearErrorBound,
  computeLogarithmicErrorBound,
  computePowerLawErrorBound,
} from './convergence/local-estimator.js';
export type { ErrorEstimatorConfig } from './convergence/local-estimator.js';

export { InductionProver } from './convergence/induction-prover.js';

// ── Chronic fault detectors ──────────────────────────────
export { MemoryLeakDetector } from './chronic/memory-leak.js';
export type { MemoryLeakDetectionOptions, MemoryLeakResult } from './chronic/memory-leak.js';

export { ConnectionPoolDetector } from './chronic/connection-pool.js';
export type {
  ConnectionPoolDetectionOptions,
  ConnectionPoolResult,
} from './chronic/connection-pool.js';

export { CurveModel, DegradationCurveAnalyzer } from './chronic/degradation-curve.js';
export type {
  CurveAnalysisOptions,
  CurveFitResult,
  DegradationAnalysisResult,
} from './chronic/degradation-curve.js';

export { ChronicPattern, PatternClassifier } from './chronic/pattern-classifier.js';
export type {
  PatternClassificationOptions,
  PatternClassificationResult,
} from './chronic/pattern-classifier.js';

// ── DI Factory registrations ─────────────────────────────
export { registerCuttingFactories, type CuttingFactoryContext } from './di/factories.js';
