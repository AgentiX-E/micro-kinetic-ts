/**
 * Denoise Engine interface — Stosszahlansatz-based alert noise reduction.
 *
 * Maps Deng Yu's rigorous proof of the Stosszahlansatz (Molecular Chaos
 * Hypothesis) to AIOps alert denoising:
 *
 * Stosszahlansatz: In sufficiently large systems with sparse coupling,
 * the joint distribution of particles factorizes:
 *   P(a, b) ≈ P(a) × P(b)   with error ≤ K/N
 *
 * AIOps mapping:
 * - Particle → microservice
 * - Distribution → alert pattern
 * - Stosszahlansatz → most simultaneous alerts are coincidental,
 *   not causally related
 *
 * This provides a mathematically-justified threshold for denoising
 * instead of heuristic "similarity-based" approaches.
 *
 * @module interfaces/denoise-engine
 */

import type {
  AlertRecord,
  AlertGroup,
  CouplingSparsityMatrix,
  IndependenceResult,
  DenoiseResult,
} from '../types/alerts.js';
import type { ServiceCallGraph } from '../types/graph.js';

/**
 * Denoise engine interface — the core of Stosszahlansatz-based denoising.
 */
export interface IDenoiseEngine {
  /**
   * Compute the coupling sparsity matrix from alert history
   * and service topology.
   *
   * S = 1 - ||C||₀ / N²
   * where C_{ij} = mutual information between alerts of service i and j
   */
  computeCouplingSparsity(
    alertHistory: readonly AlertRecord[],
    serviceGraph: ServiceCallGraph,
  ): CouplingSparsityMatrix;

  /**
   * Check whether an alert group satisfies the Stosszahlansatz
   * independence condition.
   *
   * Computes:
   *   sup_{a,b} |P(a,b) - P(a)P(b)|
   *
   * If this supremum < ε_max, the group satisfies independence.
   *
   * Deng Yu's theorem guarantees:
   *   error ≤ K/N → 0 as N → ∞
   */
  checkIndependence(
    alertGroup: AlertGroup,
    coupling: CouplingSparsityMatrix,
  ): IndependenceResult;

  /**
   * Denoise a set of alerts using coupling sparsity analysis.
   *
   * Classifies alerts into:
   * - True alarms: causally related to a common root cause
   * - Coincidental alarms: independent under Stosszahlansatz,
   *   can be safely suppressed
   * - Grouped alarms: clustered for correlation analysis
   */
  denoise(
    alerts: readonly AlertRecord[],
    coupling: CouplingSparsityMatrix,
  ): DenoiseResult;
}

/**
 * Independence checker interface — standalone statistical independence test.
 */
export interface IIndependenceChecker {
  /**
   * Test whether two alert time series are independent.
   *
   * @returns Independence result with decomposition error
   */
  testIndependence(
    alertsA: readonly AlertRecord[],
    alertsB: readonly AlertRecord[],
    couplingMatrix: Float64Array,
    serviceIndexA: number,
    serviceIndexB: number,
  ): IndependenceResult;
}
