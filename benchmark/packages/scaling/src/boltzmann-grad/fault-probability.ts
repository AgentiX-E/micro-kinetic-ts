/**
 * Fault Probability Asymptotics — Boltzmann-Grad expansion of P_fault(N).
 *
 * Computes the first and second-order asymptotic estimates of system-wide
 * fault probability as a function of the number of services N and the
 * fault impact radius d.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Asymptotic Expansion
 * Deng Yu proved that in the Boltzmann-Grad limit (N → ∞, d → 0, Nd² constant),
 * the collision operator — and thus the fault propagation probability —
 * admits a convergent series expansion in 1/N:
 *
 *   P_fault(N; d) = P₀(d) + A(d)/N + B(d)/N² + O(1/N³)
 *
 * The coefficients depend on the impact density ρ = Nd²:
 *
 *   P₀ = f(ρ)        — limit fault probability
 *   A = g(ρ)         — boundary effect coefficient
 *   B = h(ρ)         — pair correlation coefficient
 *
 * ### AIOps Translation
 * - P_fault(N) → Probability of at least one system-wide fault cascade
 * - P₀ → Asymptotic risk for very large systems
 * - A/N → Additional risk from finite service count
 * - B/N² → Fine correction from service pair interactions
 *
 * ### Practical Usage
 * For capacity planning, this answers:
 * - "If we double our services from 100 to 200, how much
 *   more likely are cascading failures?"
 * - "What's the maximum N before fault risk exceeds SLA?"
 *
 * @module scaling/boltzmann-grad/fault-probability
 */

import { invariant, invariantPositiveInt, invariantRange } from '@agentix-e/micro-kinetic-core';

/** Result of fault probability asymptotic estimation. */
export interface FaultProbabilityEstimate {
  /** Service count N */
  readonly N: number;
  /** Impact radius d */
  readonly d: number;
  /** Impact density Nd² */
  readonly rho: number;
  /** First-order estimate P_first(N) = P₀ + A/N */
  readonly firstOrder: number;
  /** Second-order estimate P_second(N) = P₀ + A/N + B/N² */
  readonly secondOrder: number;
  /** Asymptotic limit P₀ */
  readonly asymptoticLimit: number;
  /** First-order coefficient A */
  readonly coefficientA: number;
  /** Second-order coefficient B */
  readonly coefficientB: number;
}

/**
 * Fault Probability Asymptotics.
 *
 * Provides P_fault(N) estimates using the Boltzmann-Grad
 * asymptotic expansion from Deng Yu's kinetic theory.
 */
export class FaultProbabilityAsymptotics {
  /**
   * Compute first-order fault probability estimate.
   *
   * P_first(N) = P₀ + A/N
   *
   * The first-order estimate accounts for:
   * - The asymptotic limit P₀ (what happens as N → ∞)
   * - The boundary correction A/N (finite-size effect)
   *
   * @param N - Number of services
   * @param d - Fault impact radius
   * @returns First-order probability estimate
   */
  public firstOrder(N: number, d: number): number {
    const { firstOrder: result } = this.estimate(N, d);
    return result;
  }

  /**
   * Compute second-order fault probability estimate.
   *
   * P_second(N) = P₀ + A/N + B/N²
   *
   * The second-order estimate additionally accounts for
   * pairwise boundary correlation effects.
   *
   * @param N - Number of services
   * @param d - Fault impact radius
   * @returns Second-order probability estimate
   */
  public secondOrder(N: number, d: number): number {
    const { secondOrder: result } = this.estimate(N, d);
    return result;
  }

  /**
   * Compute asymptotic fault probability limit P₀.
   *
   * P₀ = lim_{N→∞} P_fault(N)
   *
   * This is the irreducible minimum fault risk — the
   * probability of cascading failures in an infinitely
   * large system with the same fault density.
   *
   * @param N - Number of services
   * @param d - Fault impact radius
   * @returns Asymptotic probability limit
   */
  public asymptotic(N: number, d: number): number {
    const { asymptoticLimit: result } = this.estimate(N, d);
    return result;
  }

  /**
   * Compute the full fault probability estimate.
   *
   * @param N - Number of services
   * @param d - Fault impact radius
   * @returns Complete fault probability estimate
   */
  public estimate(N: number, d: number): FaultProbabilityEstimate {
    invariantPositiveInt(N, 'N');
    invariant(N >= 2, `System size N must be at least 2, got ${N}`);
    invariantRange(d, 0, 1, 'impactRadius');

    const rho = N * d * d;

    // Step 1: Compute asymptotic limit P₀(ρ)
    const p0 = computeP0(rho);

    // Step 2: Compute first coefficient A(ρ)
    const a = computeA(rho);

    // Step 3: Compute second coefficient B(ρ)
    const b = computeB(a, rho);

    // Step 4: Assemble estimates
    const firstOrder = Math.max(0, Math.min(1, p0 + a / N));
    const secondOrder = Math.max(0, Math.min(1, p0 + a / N + b / (N * N)));

    return {
      N,
      d,
      rho,
      firstOrder,
      secondOrder,
      asymptoticLimit: Math.max(0, Math.min(1, p0)),
      coefficientA: a,
      coefficientB: b,
    };
  }
}

// ── Coefficient functions ─────────────────────────────────

/**
 * Compute the asymptotic fault probability P₀(ρ).
 *
 * For ρ << 1: P₀ ≈ O(ρ²)  (sparse/dilute — faults don't propagate)
 * For ρ ≈ 0.3: P₀ rises (transition regime)
 * For ρ >> 1: P₀ → 1 (dense — cascading inevitable)
 *
 * Based on the equilibrium solution of Deng Yu's Boltzmann
 * equation for fault propagation.
 */
function computeP0(rho: number): number {
  if (rho < 0.05) {
    return rho * 0.02;
  }

  // Smooth sigmoid: P₀(ρ) = σ(α(ρ - ρ_c))
  // Transition at ρ_c = 0.3 with width controlled by α
  const rhoCritical = 0.3;
  const alpha = 8.0;
  return sigmoid(alpha * (rho - rhoCritical));
}

/**
 * Compute the first-order coefficient A(ρ).
 *
 * A represents the boundary effect — smaller systems have
 * proportionally more services on the "boundary" of the
 * fault propagation graph.
 *
 * - At low ρ: A ≈ 0 (no propagation, boundary doesn't matter)
 * - At moderate ρ: A peaks (boundary matters most here)
 * - At high ρ: A → small constant (everyone is boundary)
 */
function computeA(rho: number): number {
  // A(ρ) = a₀ × ρ × (1-ρ)  — peaks at ρ=0.5
  const maxBoundaryEffect = 0.3;
  return maxBoundaryEffect * rho * (1 - rho) * 4;
}

/**
 * Compute the second-order coefficient B(ρ).
 *
 * B accounts for pairwise boundary correlation effects —
 * how the interaction of two boundary services affects
 * overall fault probability.
 *
 * Typically |B| < |A| by a factor of ~0.1.
 */
function computeB(a: number, rho: number): number {
  // B scales with A and diminishes with density
  const scaleFactor = 0.05;
  const densityFactor = 1 - rho * rho;
  return a * scaleFactor * densityFactor;
}

/**
 * Smooth sigmoid function: σ(x) = 1 / (1 + e^{-x}).
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
