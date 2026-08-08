/**
 * Scaling Analyzer interface — BBGKY hierarchy + Boltzmann-Grad limit.
 *
 * Maps two interlinked concepts from Deng Yu's kinetic theory:
 *
 * 1. BBGKY Hierarchy: N-particle distribution functions
 *    f₁ → single-particle, f₂ → pairwise, ..., f_k → k-particle
 *    Truncation: E_k/E_{k-1} < η → stop at order k-1
 *
 *    AIOps: N-service fault correlation hierarchy
 *    k=1: single-service fault probability
 *    k=2: pairwise fault propagation
 *    k≥3: higher-order cascade effects
 *
 * 2. Boltzmann-Grad Limit: N→∞, d→0, Nd²=constant
 *    AIOps: service count N, fault impact radius d
 *    The product Nd² (global fault density) must stay constant
 *    as the system scales, or cascading failures become inevitable.
 *
 * @module interfaces/scaling-engine
 */

import type {
  BBGKYHierarchy,
  BBGKYOptions,
  BoltzmannGradResult,
  MicroserviceState,
} from '../types/coupling.js';

/**
 * Scaling analyzer interface.
 */
export interface IScalingAnalyzer {
  /**
   * Build the BBGKY hierarchy from microservice states.
   *
   * f₁: single-service fault distribution
   * f₂: pairwise fault correlation
   * ...
   * f_k: k-service joint fault correlation
   */
  computeBBGKYHierarchy(
    states: readonly MicroserviceState[],
    options?: BBGKYOptions,
  ): BBGKYHierarchy;

  /**
   * Determine the optimal truncation order.
   *
   * Computes energy ratios E_k/E_{k-1} for k = 2, 3, ...
   * and truncates when the ratio drops below η.
   *
   * @returns The optimal truncation order k* (first insignificant order)
   */
  truncateHierarchy(hierarchy: BBGKYHierarchy, eta?: number): number;

  /**
   * Estimate fault probability under Boltzmann-Grad scaling.
   *
   * P_fault(N) = P₀ + A/N + B/N² + O(1/N³)
   *
   * @param N - Number of services
   * @param impactRadius - Fault impact radius d
   * @returns Boltzmann-Grad analysis result
   */
  estimateFaultProbability(N: number, impactRadius: number): BoltzmannGradResult;
}

/**
 * Hierarchy truncator interface — standalone truncation strategy.
 */
export interface IHierarchyTruncator {
  /**
   * Find the optimal truncation order.
   *
   * Strategy:
   * 1. Compute correlation energy E_k for each order k
   * 2. Compute energy ratio E_k/E_{k-1}
   * 3. First k where ratio < η → truncate to k-1
   */
  findTruncationOrder(energies: readonly number[], eta: number): number;

  /**
   * Estimate the truncation error from dropping order k and above.
   */
  estimateTruncationError(hierarchy: BBGKYHierarchy, truncationOrder: number): number;
}
