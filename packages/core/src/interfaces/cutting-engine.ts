/**
 * Cutting Engine interface — chronic fault detection via time segmentation.
 *
 * Maps Deng Yu's cutting algorithm from kinetic theory:
 * - Long-time evolution interval [0, T] split into N segments
 * - Local energy estimation per segment using kinetic bounds
 * - Inductive proof of global H-theorem convergence
 *
 * In AIOps, this handles slow-degradation faults (memory leaks,
 * connection pool exhaustion, data skew) that are invisible at
 * single-timepoint snapshots but converge to failure over hours/days.
 *
 * @module interfaces/cutting-engine
 */

import type { ChronicFaultIndicator } from '../types/faults.js';
import type { CuttingOptions, CuttingWindow, TimeSeries } from '../types/time-series.js';

/** Local error bound for a single cutting window. */
export interface LocalErrorBound {
  /** Zero-based window index */
  readonly windowIndex: number;
  /** Window start time (Unix ms) */
  readonly startTime: number;
  /** Window end time (Unix ms) */
  readonly endTime: number;
  /** Estimated degradation rate within this window */
  readonly degradationRate: number;
  /** Local error bound ε_j from kinetic energy estimation */
  readonly errorBound: number;
  /** Fault indicators detected in this window */
  readonly indicators: readonly ChronicFaultIndicator[];
}

/** A single inductive proof step. */
export interface ProofStep {
  /** Step number in the induction */
  readonly stepIndex: number;
  /** The induction claim for this step */
  readonly claim: string;
  /** The computed error bound after this step */
  readonly cumulativeError: number;
  /** Whether this step's bound ≤ the global tolerance */
  readonly withinTolerance: boolean;
}

/** Convergence proof result. */
export interface ConvergenceResult {
  /** Whether global convergence was proved */
  readonly converged: boolean;
  /** Upper bound on convergence time (Unix ms), if converged */
  readonly convergenceTime?: number;
  /** Total accumulated error across all windows */
  readonly totalError: number;
  /** Inductive proof steps */
  readonly proofSteps: readonly ProofStep[];
  /** Whether convergence was proved within the observation window */
  readonly withinObservationWindow: boolean;
}

/**
 * Cutting engine interface — the core of chronic fault detection.
 */
export interface ICuttingEngine {
  /**
   * Segment a long time series into optimal short windows.
   *
   * Adaptive strategy:
   * 1. Start with uniform windows δ = T/N
   * 2. For each window [t_j, t_{j+1}]:
   *    a. Estimate degradation rate r_j
   *    b. Compute local error bound ε_j
   *    c. If |ε_j - ε_{j-1}| > threshold, refine this window
   * 3. Output optimized window sequence
   */
  segment(ts: TimeSeries, options?: CuttingOptions): CuttingWindow[];

  /**
   * Estimate local error bounds for each cutting window.
   *
   * Uses kinetic energy estimation from Deng Yu's theory:
   * ε_j = C × r_j × δ_j² / 2
   * where r_j is the degradation rate and δ_j is the window duration.
   */
  estimateLocalBounds(windows: readonly CuttingWindow[], metric: string): LocalErrorBound[];

  /**
   * Prove global convergence via induction over the cutting windows.
   *
   * Induction scheme:
   * - Base: ε_0 ≤ ε_local, T_0 = max(t anomaly in window_0)
   * - Step: If ε_{j-1} bounded, use inter-window error propagation
   *   relation to prove ε_j also bounded
   * - Conclusion: Σ_{j=0}^{k} ε_j < ε_global ⇒ T_conv = t_k
   */
  proveConvergence(
    localBounds: readonly LocalErrorBound[],
    globalTolerance: number,
  ): ConvergenceResult;
}

/**
 * Convergence prover interface — standalone inductive proof engine.
 */
export interface IConvergenceProver {
  /**
   * Run the full inductive proof.
   *
   * @param errorSequence - Sequence of local error bounds ε₀, ε₁, ..., ε_{N-1}
   * @param globalTolerance - Global error tolerance ε_global
   * @returns Convergence result with proof steps
   */
  prove(errorSequence: readonly number[], globalTolerance: number): ConvergenceResult;
}
