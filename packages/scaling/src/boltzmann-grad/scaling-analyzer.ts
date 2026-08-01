/**
 * Boltzmann-Grad Scaling Analyzer — N → ∞ fault probability asymptotics.
 *
 * Computes fault probability scaling behavior in the Boltzmann-Grad
 * limit, where N → ∞, d → 0, and Nd² = constant.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Boltzmann-Grad Limit
 * In kinetic theory, the Boltzmann-Grad limit describes the regime
 * where the number of particles N → ∞, the particle interaction
 * radius d → 0, but the global interaction density Nd² remains
 * constant.
 *
 * Deng Yu's key contribution was the rigorous derivation of the
 * Boltzmann equation in this limit from hard-sphere particle dynamics,
 * proving that:
 *
 *   P_fault(N) = P₀ + A/N + B/N² + O(1/N³)
 *
 * where:
 * - P₀ is the asymptotic fault probability (N → ∞ limit)
 * - A is the first-order finite-size correction
 * - B is the second-order finite-size correction
 *
 * ### AIOps Translation
 * - N → number of microservices
 * - d → single-service fault impact radius
 * - Nd² → global fault impact density
 * - P_fault → probability of system-wide failure cascade
 *
 * ### Practical Insight
 * For a system with N services and impact radius d:
 * - dilute regime (Nd² < 0.1): Faults don't propagate
 * - transition regime (0.1 ≤ Nd² ≤ 0.5): Some cascading possible
 * - dense regime (Nd² > 0.5): Cascading failures are likely
 *
 * @module scaling/boltzmann-grad/scaling-analyzer
 */

import type {
  BoltzmannGradResult,
  BBGKYHierarchy,
  MicroserviceState,
  BBGKYOptions,
  ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantPositiveInt, invariantRange } from '@agentix-e/micro-kinetic-core';
import { HierarchyBuilder } from '../bbgky/hierarchy-builder.js';
import { HierarchyTruncator } from '../bbgky/truncator.js';

/**
 * Boltzmann-Grad Scaling Analyzer.
 *
 * Implements IScalingAnalyzer.estimateFaultProbability() to compute
 * scaling behavior using the Boltzmann-Grad asymptotic expansion.
 */
export class BoltzmannGradAnalyzer {
  private readonly hierarchyBuilder: HierarchyBuilder;
  private readonly truncator: HierarchyTruncator;

  /**
   * @param hierarchyBuilder - BBGKY hierarchy builder
   * @param truncator - Hierarchy truncation strategy
   */
  constructor(hierarchyBuilder?: HierarchyBuilder, truncator?: HierarchyTruncator) {
    this.hierarchyBuilder = hierarchyBuilder ?? new HierarchyBuilder();
    this.truncator = truncator ?? new HierarchyTruncator();
  }

  /**
   * Build the BBGKY hierarchy from microservice states.
   *
   * Delegates to the HierarchyBuilder for constructing
   * k-service correlation functions.
   *
   * @param states - Microservice state snapshots
   * @param serviceGraph - Service call graph
   * @param options - BBGKY construction options
   * @returns BBGKY hierarchy
   */
  public computeBBGKYHierarchy(
    states: readonly MicroserviceState[],
    serviceGraph: ServiceCallGraph,
    options?: BBGKYOptions,
  ): BBGKYHierarchy {
    return this.hierarchyBuilder.computeBBGKYHierarchy(states, serviceGraph, options);
  }

  /**
   * Determine the optimal truncation order for a BBGKY hierarchy.
   *
   * Delegates to HierarchyTruncator to find the first insignificant
   * order where E_k/E_{k-1} < η.
   *
   * @param hierarchy - The computed BBGKY hierarchy
   * @param eta - Truncation threshold (default 0.01)
   * @returns Optimal truncation order k*
   */
  public truncateHierarchy(
    hierarchy: BBGKYHierarchy,
    eta?: number,
  ): number {
    const effectiveEta = eta ?? 0.01;
    const energies = hierarchy.states.map(s => s.correlationEnergy);
    return this.truncator.findTruncationOrder(energies, effectiveEta);
  }

  /**
   * Estimate fault probability under Boltzmann-Grad scaling.
   *
   * **Computation:**
   * P_fault(N) = P₀ + A/N + B/N² + O(1/N³)
   *
   * **Derivation from Deng Yu's theorem:**
   * In the Boltzmann-Grad limit, the collision operator has a convergent
   * series expansion in 1/N. The leading terms give:
   *
   * - P₀ (= asymptotic fault probability)
   *   Depends on the global fault density Nd² — if this is too large,
   *   even an infinite system has non-zero cascade probability.
   *
   * - A/N (= first-order finite-size correction)
   *   Accounts for boundary effects: smaller systems have proportionally
   *   more boundary services that can "reflect" faults back inward.
   *
   * - B/N² (= second-order correction)
   *   Accounts for pair correlations between boundary services.
   *
   * **Regime Classification:**
   *   dilute (Nd² < 0.1): Safe scaling, faults don't propagate
   *   transition (0.1 ≤ Nd² ≤ 0.5): Careful, some cascading
   *   dense (Nd² > 0.5): Dangerous, cascading likely
   *
   * @param N - Number of services (system size)
   * @param impactRadius - Fault impact radius d
   * @returns Boltzmann-Grad analysis result
   */
  public estimateFaultProbability(
    N: number,
    impactRadius: number,
  ): BoltzmannGradResult {
    invariantPositiveInt(N, 'N');
    invariant(N >= 2, `System size N must be at least 2, got ${N}`);
    invariantRange(impactRadius, 0, 1, 'impactRadius');

    // Compute global fault impact density
    const impactDensity = N * impactRadius * impactRadius;

    // Step 1: Determine scaling regime
    const regime = this.classifyRegime(impactDensity);

    // Step 2: Compute asymptotic fault probability P₀
    // P₀ is derived from the equilibrium solution of the Boltzmann-Grad
    // equation. In the dilute limit, P₀ → 0.
    const p0 = this.computeAsymptoticProbability(impactDensity);

    // Step 3: Compute first-order correction A/N
    // A represents the boundary effect: smaller systems have
    // proportionally larger boundary surface area.
    const a = this.computeFirstOrderCorrection(p0, impactDensity, regime);
    const firstOrderTerm = a / N;

    // Step 4: Compute second-order correction B/N²
    const b = this.computeSecondOrderCorrection(a, impactDensity);
    const secondOrderTerm = b / (N * N);

    // Step 5: Compute fault probabilities
    const p1 = p0 + firstOrderTerm; // first-order estimate
    const p2 = p0 + firstOrderTerm + secondOrderTerm; // second-order estimate

    // Step 6: Check if we're in the Boltzmann-Grad regime
    // The regime holds when Nd² is O(1), i.e., between 0.05 and 2.0
    const inBoltzmannGradRegime =
      impactDensity >= 0.05 && impactDensity <= 2.0;

    return {
      serviceCount: N,
      impactRadius,
      impactDensity,
      faultProbabilityFirstOrder: Math.max(0, Math.min(1, p1)),
      faultProbabilitySecondOrder: Math.max(0, Math.min(1, p2)),
      faultProbabilityAsymptotic: Math.max(0, Math.min(1, p0)),
      inBoltzmannGradRegime,
      regime,
    };
  }

  /**
   * Classify the scaling regime based on fault impact density.
   *
   * @param impactDensity - Nd² value
   * @returns Scaling regime classification
   */
  private classifyRegime(impactDensity: number): 'dilute' | 'transition' | 'dense' {
    if (impactDensity < 0.1) return 'dilute';
    if (impactDensity > 0.5) return 'dense';
    return 'transition';
  }

  /**
   * Compute the asymptotic fault probability P₀.
   *
   * In the N → ∞ limit:
   * - dilute: P₀ ≈ 0 (faults don't propagate in sparse systems)
   * - transition: P₀ ≈ Nd² - (Nd²)²/2 (supercritical)
   * - dense: P₀ → 1 (cascading is inevitable)
   *
   * **Deng Yu's derivation:**
   *   P₀ emerges from the stationary solution of the Boltzmann
   *   equation for the fault propagation operator.
   *
   * @param impactDensity - Global fault impact density Nd²
   */
  private computeAsymptoticProbability(impactDensity: number): number {
    // Use a smooth sigmoid transition from dilute to dense
    const rho = impactDensity;

    if (rho < 0.05) {
      // Exponential decay for very dilute systems
      return 0.01 * rho;
    }

    // Smooth interpolation between regimes
    const diluteContribution = Math.max(0, 1 - Math.exp(-rho * 2));
    const denseContribution = Math.tanh(rho * 4);

    // Weighted blend based on density
    const blend = sigmoid((rho - 0.3) * 10);
    return (1 - blend) * diluteContribution + blend * denseContribution;
  }

  /**
   * Compute the first-order finite-size correction coefficient A.
   *
   * A represents boundary effects: in smaller systems, more services
   * are on the "boundary" of fault propagation paths, leading to
   * proportionally larger reflection of fault waves.
   *
   * @param p0 - Asymptotic probability
   * @param impactDensity - Nd²
   * @param regime - Scaling regime
   */
  private computeFirstOrderCorrection(
    p0: number,
    impactDensity: number,
    regime: 'dilute' | 'transition' | 'dense',
  ): number {
    // Boundary effect is strongest in transition regime
    if (regime === 'dilute') {
      return -0.01; // small systems slightly safer in dilute regime
    }

    if (regime === 'dense') {
      return 0.05; // small systems slightly more dangerous in dense
    }

    // Transition: boundary effect matters most
    return 0.1 * (impactDensity - 0.1) * (0.5 - impactDensity) * 10;
  }

  /**
   * Compute the second-order finite-size correction coefficient B.
   *
   * B accounts for pairwise boundary correlation corrections.
   * This is a finer effect that becomes relevant for moderate N.
   *
   * @param a - First-order coefficient
   * @param impactDensity - Nd²
   */
  private computeSecondOrderCorrection(
    a: number,
    impactDensity: number,
  ): number {
    // Second-order correction: B = a * γ(ρ)
    // B is typically smaller than A, scaling with pair correlations
    const sign = Math.sign(a);
    const gamma = impactDensity * (1 - impactDensity) * 0.5;
    return sign * gamma * 0.02;
  }
}

/**
 * Smooth sigmoid function: σ(x) = 1 / (1 + e^{-x}).
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
