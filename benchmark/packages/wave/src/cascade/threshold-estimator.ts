/**
 * Threshold Estimator — alert wave generation, propagation, and extinction.
 *
 * Estimates the critical thresholds that govern alert cascade dynamics
 * based on the service graph topology and coupling parameters.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Wave Thresholds in Kinetic Theory
 * Deng Yu's work on wave turbulence identifies three critical regimes:
 *
 * 1. **Generation Threshold (T_gen)**
 *    Minimum alert intensity needed to initiate a cascade.
 *    Below this, perturbations are damped; above, they amplify.
 *
 * 2. **Propagation Threshold (T_prop)**
 *    Minimum coupling strength for a cascade to spread.
 *    Related to the percolation threshold of the service graph.
 *
 * 3. **Extinction Threshold (T_ext)**
 *    Alert intensity below which the cascade dies out.
 *    Determined by the dissipation rate γ and spectral gap Δ.
 *
 * ### AIOps Translation
 * - T_gen → How severe must an alert be to trigger a cascade?
 * - T_prop → How tightly coupled must services be for propagation?
 * - T_ext → At what level does the alert wave dissipate naturally?
 *
 * @module wave/cascade/threshold-estimator
 */

import type { ServiceCallGraph } from '@agentix-e/micro-kinetic-core';
import { invariant, invariantRange } from '@agentix-e/micro-kinetic-core';

/** Estimated thresholds for alert wave dynamics. */
export interface WaveThresholds {
  /** Minimum intensity to generate a cascade */
  readonly generationThreshold: number;
  /** Minimum coupling strength for sustained propagation */
  readonly propagationThreshold: number;
  /** Intensity below which the cascade dies out */
  readonly extinctionThreshold: number;
  /** Spectral gap of the service graph */
  readonly spectralGap: number;
  /** Estimated percolation threshold of the graph */
  readonly percolationThreshold: number;
  /** Classification of the system's cascade risk */
  readonly cascadeRisk: 'low' | 'moderate' | 'high';
}

/**
 * Threshold Estimator — computes critical wave dynamics thresholds.
 *
 * Estimates the thresholds that determine whether an alert
 * becomes a propagating cascade, sustains itself, or dies out.
 */
export class ThresholdEstimator {
  /**
   * Estimate all critical thresholds for alert wave dynamics.
   *
   * **Computation:**
   * 1. Build graph adjacency and compute spectral properties
   * 2. T_gen ≈ 1 / (N × mean_coupling)  — inverse of total coupling
   * 3. T_prop ≈ percolation threshold ~ 1/<k>  — inverse avg degree
   * 4. T_ext ≈ dissipation_rate / spectral_gap
   * 5. Classify cascade risk based on current thresholds
   *
   * @param graph - Service call graph
   * @param dissipationRate - Alert dissipation rate γ (0-1)
   * @returns Estimated wave thresholds
   */
  public estimate(graph: ServiceCallGraph, dissipationRate: number = 0.1): WaveThresholds {
    invariant(graph.nodes.size > 0, 'graph must contain nodes');
    invariantRange(dissipationRate, 0, 1, 'dissipationRate');

    const serviceIds = Array.from(graph.nodes.keys());
    const N = serviceIds.length;

    // Build adjacency and compute spectral gap
    const adjacency = this.buildAdjacencyMatrix(graph, serviceIds);
    const spectralGap = this.computeSpectralGap(adjacency, N);

    // Compute average degree and coupling
    const { avgDegree, avgCoupling } = this.computeGraphStats(graph);

    // Step 1: Generation threshold
    // T_gen = minimal intensity to overcome dissipation
    // T_gen ≈ dissipationRate / mean_coupling
    const generationThreshold =
      avgCoupling > 1e-10 ? Math.min(1, dissipationRate / avgCoupling) : 1.0;

    // Step 2: Propagation threshold
    // T_prop ≈ percolation threshold for the graph
    // For Erdős-Rényi: p_c ≈ 1/<k>, but we use a refined estimate
    const percolationThreshold = avgDegree > 0 ? 1 / (avgDegree * avgCoupling) : 1.0;

    // The propagation requires both:
    // - Enough coupling to pass the percolation threshold
    // - Enough average degree for multi-hop propagation
    const propagationThreshold = Math.max(percolationThreshold, N > 1 ? 1 / (N - 1) : 1.0);

    // Step 3: Extinction threshold
    // T_ext = intensity below which cascade dies
    // T_ext ≈ dissipationRate / spectralGap
    const extinctionThreshold =
      spectralGap > 1e-10 ? Math.min(1, dissipationRate / spectralGap) : 0.01;

    // Step 4: Cascade risk classification
    const cascadeRisk = this.classifyRisk(
      generationThreshold,
      propagationThreshold,
      spectralGap,
      avgCoupling,
    );

    return {
      generationThreshold: Math.max(0.01, Math.min(1, generationThreshold)),
      propagationThreshold: Math.max(0.01, Math.min(1, propagationThreshold)),
      extinctionThreshold: Math.max(0.001, Math.min(1, extinctionThreshold)),
      spectralGap,
      percolationThreshold: Math.max(0.01, Math.min(1, percolationThreshold)),
      cascadeRisk,
    };
  }

  /**
   * Estimate the generation threshold specifically.
   *
   * T_gen is the minimum alert intensity required to
   * initiate a propagating cascade wave.
   *
   * @param graph - Service call graph
   * @param dissipationRate - Dissipation rate γ
   * @returns Generation threshold intensity value
   */
  public generationThreshold(graph: ServiceCallGraph, dissipationRate: number = 0.1): number {
    const thresholds = this.estimate(graph, dissipationRate);
    return thresholds.generationThreshold;
  }

  /**
   * Estimate the propagation threshold specifically.
   *
   * T_prop is the minimum coupling strength required
   * for sustained cascade propagation.
   *
   * @param graph - Service call graph
   * @returns Propagation threshold coupling value
   */
  public propagationThreshold(graph: ServiceCallGraph): number {
    const thresholds = this.estimate(graph);
    return thresholds.propagationThreshold;
  }

  /**
   * Estimate the extinction threshold specifically.
   *
   * T_ext is the intensity below which an existing
   * cascade wave dies out (below the noise floor).
   *
   * @param graph - Service call graph
   * @param dissipationRate - Dissipation rate γ
   * @returns Extinction threshold intensity value
   */
  public extinctionThreshold(graph: ServiceCallGraph, dissipationRate: number = 0.1): number {
    const thresholds = this.estimate(graph, dissipationRate);
    return thresholds.extinctionThreshold;
  }

  // ── Internal methods ────────────────────────────────────

  /**
   * Build adjacency matrix from the service call graph.
   */
  private buildAdjacencyMatrix(graph: ServiceCallGraph, serviceIds: string[]): Float64Array {
    const N = serviceIds.length;
    const matrix = new Float64Array(N * N);
    const idToIdx = new Map(serviceIds.map((id, i) => [id, i]));

    for (let i = 0; i < N; i++) {
      matrix[i * N + i] = 1.0;
    }

    for (const edge of graph.edges) {
      const from = idToIdx.get(edge.from);
      const to = idToIdx.get(edge.to);
      if (from === undefined || to === undefined) continue;

      const callRateNorm = Math.tanh(edge.callRate / 100);
      matrix[from * N + to] = callRateNorm * (1 - edge.errorRate);
    }

    return matrix;
  }

  /**
   * Compute graph statistics: average degree and coupling.
   */
  private computeGraphStats(graph: ServiceCallGraph): {
    avgDegree: number;
    avgCoupling: number;
  } {
    const N = graph.nodes.size;
    if (N === 0) return { avgDegree: 0, avgCoupling: 0 };

    const degrees = new Map<string, number>();

    for (const edge of graph.edges) {
      degrees.set(edge.from, degrees.get(edge.from)! + 1);
      degrees.set(edge.to, degrees.get(edge.to)! + 1);
    }

    const avgDegree =
      degrees.size > 0 ? Array.from(degrees.values()).reduce((s, d) => s + d, 0) / N : 0;

    const avgCoupling =
      graph.edges.length > 0
        ? graph.edges.reduce((s, e) => s + e.callRate, 0) / graph.edges.length / 1000
        : 0;

    return { avgDegree, avgCoupling };
  }

  /**
   * Compute spectral gap via power iteration with deflation.
   */
  private computeSpectralGap(matrix: Float64Array, N: number): number {
    if (N <= 1) return 1.0;

    const v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = Math.random() * 2 - 1;
    this.normalize(v);

    let lambda1 = 0;
    for (let iter = 0; iter < 100; iter++) {
      const next = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = 0; j < N; j++) {
          sum += matrix[i * N + j]! * v[j]!;
        }
        next[i] = sum;
      }

      let num = 0,
        den = 0;
      for (let i = 0; i < N; i++) {
        num += v[i]! * next[i]!;
        den += v[i]! * v[i]!;
      }
      lambda1 = den > 1e-15 ? num / den : 0;

      this.normalize(next);
      v.set(next);
    }

    const deflated = new Float64Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        deflated[i * N + j] = matrix[i * N + j]! - lambda1 * v[i]! * v[j]!;
      }
    }

    const w = new Float64Array(N);
    for (let i = 0; i < N; i++) w[i] = Math.random() * 2 - 1;
    this.normalize(w);

    let lambda2 = 0;
    for (let iter = 0; iter < 100; iter++) {
      const next = new Float64Array(N);
      for (let i = 0; i < N; i++) {
        let sum = 0;
        for (let j = 0; j < N; j++) {
          sum += deflated[i * N + j]! * w[j]!;
        }
        next[i] = sum;
      }

      let num = 0,
        den = 0;
      for (let i = 0; i < N; i++) {
        num += w[i]! * next[i]!;
        den += w[i]! * w[i]!;
      }
      lambda2 = den > 1e-15 ? num / den : 0;

      this.normalize(next);
      w.set(next);
    }

    return Math.max(1e-10, Math.abs(lambda1 - lambda2));
  }

  /**
   * Normalize vector to unit L² norm.
   */
  private normalize(vec: Float64Array): void {
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm);
    if (norm > 1e-15) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] = vec[i]! / norm;
      }
    }
  }

  /**
   * Classify the cascade risk based on threshold values.
   *
   * - Low: generation threshold is high, propagation unlikely
   * - Moderate: thresholds are moderate, some risk of cascading
   * - High: thresholds are low, cascading is likely
   */
  private classifyRisk(
    generationThreshold: number,
    propagationThreshold: number,
    spectralGap: number,
    avgCoupling: number,
  ): 'low' | 'moderate' | 'high' {
    // High generation threshold → low risk (hard to trigger cascade)
    // Low propagation threshold → high risk (easy to spread)
    // Small spectral gap → high risk (slow decay, persistent)

    const riskScore =
      (1 - generationThreshold) * 0.3 +
      (1 - propagationThreshold) * 0.3 +
      avgCoupling * 0.2 +
      (1 - spectralGap / 10) * 0.2;

    if (riskScore < 0.3) return 'low';
    if (riskScore < 0.6) return 'moderate';
    return 'high';
  }
}
