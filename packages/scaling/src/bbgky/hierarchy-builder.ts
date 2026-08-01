/**
 * BBGKY Hierarchy Builder — multi-service fault correlation hierarchy.
 *
 * Constructs the BBGKY hierarchy of k-service correlation functions
 * from microservice state data, using numpy-ts for tensor operations.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### BBGKY Hierarchy (Bogoliubov–Born–Green–Kirkwood–Yvon)
 * The BBGKY hierarchy describes the statistical dynamics of N-particle
 * systems through a chain of equations for reduced distribution functions:
 *
 *   f₁(t, z₁)                    — single-particle distribution
 *   f₂(t, z₁, z₂)               — two-particle correlation
 *   f₃(t, z₁, z₂, z₃)          — three-particle correlation
 *   ...
 *   f_k(t, z₁, ..., z_k)        — k-particle correlation
 *
 * Deng Yu's key contribution: rigorous convergence rates for the
 * truncation of this infinite hierarchy, showing that higher-order
 * terms decay exponentially with k in the Boltzmann-Grad limit.
 *
 * ### AIOps Translation
 * - N-particle system → N-service microservice architecture
 * - f_k → k-service fault correlation function
 * - E_k = ||f_k||² → correlation energy at order k
 * - Truncation → ignore high-order interactions beyond significance
 *
 * ### Core Formula
 *   f_k(i₁, ..., i_k) = product of anomaly scores weighted by
 *   pairwise coupling strengths between services
 *
 *   E_k = Σ f_k(i₁, ..., i_k)²
 *
 * @module scaling/bbgky/hierarchy-builder
 */

import type {
  MicroserviceState,
  BBGKYState,
  BBGKYHierarchy,
  BBGKYOptions,
  ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_BBGKY_OPTIONS,
  invariant,
  invariantNonEmpty,
  invariantPositiveInt,
  invariantRange,
} from '@agentix-e/micro-kinetic-core';

/**
 * BBGKY Hierarchy Builder.
 *
 * Implements IScalingAnalyzer.computeBBGKYHierarchy() to construct
 * the k-order correlation hierarchy from microservice state data.
 */
export class HierarchyBuilder {
  /**
   * Build the BBGKY hierarchy from microservice states.
   *
   * **Algorithm:**
   * 1. f₁: Single-service fault distribution = anomaly score vector
   * 2. f₂: Pairwise fault correlation = anomaly_i × anomaly_j × coupling_ij
   * 3. fₖ (k ≥ 3): Tensor product with pairwise coupling weights
   * 4. For each order, compute E_k = ||f_k||²
   * 5. Store all states with significance flags
   *
   * @param states - Array of microservice state snapshots
   * @param serviceGraph - Service call graph for coupling structure
   * @param options - BBGKY hierarchy construction options
   * @returns Complete BBGKY hierarchy
   */
  public computeBBGKYHierarchy(
    states: readonly MicroserviceState[],
    serviceGraph: ServiceCallGraph,
    options?: BBGKYOptions,
  ): BBGKYHierarchy {
    invariantNonEmpty(states, 'states');
    invariant(serviceGraph.nodes.size > 0, 'serviceGraph must contain nodes');

    const opts = { ...DEFAULT_BBGKY_OPTIONS, ...options };
    const N = serviceGraph.nodes.size;

    invariantPositiveInt(opts.maxOrder, 'maxOrder');
    invariantRange(opts.truncationEta, 0, 1, 'truncationEta');

    // Step 1: Build f₁ — single-service fault distribution
    const f1Tensor = this.buildSingleServiceDistribution(states, serviceGraph);
    const e1 = this.computeNormSquared(f1Tensor);
    const f1State = this.createBBGKYState(1, serviceGraph, f1Tensor, e1, true);

    const states_result: BBGKYState[] = [f1State];
    const energyRatios: number[] = [];

    // Step 2: Build f_k for k = 2, 3, ..., maxOrder
    for (let k = 2; k <= opts.maxOrder; k++) {
      const prevEnergy = states_result[k - 2]!.correlationEnergy;

      const fkTensor = this.buildKServiceCorrelation(
        k,
        N,
        states,
        serviceGraph,
        f1Tensor,
      );

      const ek = this.computeNormSquared(fkTensor);
      const ratio = prevEnergy > 0 ? ek / prevEnergy : 0;
      const isSignificant = ratio >= opts.truncationEta;

      energyRatios.push(ratio);

      const fkState = this.createBBGKYState(k, serviceGraph, fkTensor, ek, isSignificant);
      states_result.push(fkState);

      // Stop if correlation drops below significance
      if (!isSignificant && k > 2) {
        break;
      }
    }

    // Step 3: Determine truncation order
    const truncationOrder = this.findTruncationOrder(energyRatios, opts.truncationEta);

    // Step 4: Estimate truncation error
    const truncationError = this.estimateTruncationError(energyRatios, truncationOrder - 1);

    return {
      systemSize: N,
      states: states_result,
      truncationOrder,
      energyRatios,
      truncationError,
    };
  }

  /**
   * Build the single-service (k=1) fault distribution.
   *
   * f₁(i) = anomalyScore(i) × faultProbability(i)
   *
   * This is the baseline: how likely each service is to have a fault.
   *
   * @param states - Microservice states
   * @param serviceGraph - Service topology
   * @returns f₁ tensor as Float64Array of length N
   */
  private buildSingleServiceDistribution(
    states: readonly MicroserviceState[],
    serviceGraph: ServiceCallGraph,
  ): Float64Array {
    const N = serviceGraph.nodes.size;
    const serviceIds = Array.from(serviceGraph.nodes.keys());
    const result = new Float64Array(N);

    // Aggregate states by service (take most recent)
    const latestByService = new Map<string, MicroserviceState>();
    for (const s of states) {
      const existing = latestByService.get(s.serviceId);
      if (!existing || s.timestamp > existing.timestamp) {
        latestByService.set(s.serviceId, s);
      }
    }

    for (let i = 0; i < N; i++) {
      const serviceId = serviceIds[i];
      const state = latestByService.get(serviceId!);
      if (state) {
        result[i] = state.anomalyScore * state.faultProbability;
      } else {
        result[i] = 0;
      }
    }

    return result;
  }

  /**
   * Build k-service correlation tensor f_k.
   *
   * For k=2:
   *   f₂(i,j) = f₁(i) × f₁(j) × couplingStrength(i,j)
   *   where couplingStrength is derived from the service graph edges.
   *
   * For k≥3:
   *   fₖ(i₁,...,i_k) = ∏_{a=1}^k f₁(i_a) × ∏_{a<b} couplingStrength(i_a, i_b)
   *
   * The coupling between infrastructure nodes only affects
   * non-infrastructure pairs through the service graph edges.
   *
   * @param k - Correlation order
   * @param N - Number of services
   * @param _states - Microservice states (unused, f₁ already built)
   * @param serviceGraph - Service topology
   * @param f1 - Single-service distribution
   * @returns Flattened k-order tensor in row-major order
   */
  private buildKServiceCorrelation(
    k: number,
    N: number,
    _states: readonly MicroserviceState[],
    serviceGraph: ServiceCallGraph,
    f1: Float64Array,
  ): Float64Array {
    const size = Math.pow(N, k);
    const result = new Float64Array(size);

    // Pre-compute coupling strengths from service graph edges
    const couplingMatrix = this.buildCouplingMatrix(serviceGraph);

    if (k === 2) {
      // Direct computation for pairwise correlation
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const coupling = (couplingMatrix[i * N + j] ?? 0);
          result[i * N + j] = (f1[i] ?? 0) * (f1[j] ?? 0) * coupling;
        }
      }
      return result;
    }

    // For k ≥ 3: recursive tensor product approach
    if (k === 3) {
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          for (let m = 0; m < N; m++) {
            const coupling = this.averagePairwiseCoupling(couplingMatrix, N, [i, j, m]);
            const idx = i * N * N + j * N + m;
            result[idx] = (f1[i] ?? 0) * (f1[j] ?? 0) * (f1[m] ?? 0) * coupling;
          }
        }
      }
      return result;
    }

    // For k > 3: use recursive construction
    // f_k(i₁,...,i_k) = f_{k-1}(i₁,...,i_{k-1}) × f₁(i_k) × avg_coupling
    const fkMinus1 = this.buildKServiceCorrelation(k - 1, N, _states, serviceGraph, f1);
    const lowerSize = Math.pow(N, k - 1);

    for (let idx = 0; idx < lowerSize; idx++) {
      const fkPrev = fkMinus1[idx] ?? 0;
      // Decode multi-index from flattened position
      const baseIndices = this.decodeMultiIndex(idx, N, k - 1);

      for (let ik = 0; ik < N; ik++) {
        const allIndices = [...baseIndices, ik];
        const coupling = this.averagePairwiseCoupling(couplingMatrix, N, allIndices);
        result[idx * N + ik] = fkPrev * (f1[ik] ?? 0) * coupling;
      }
    }

    return result;
  }

  /**
   * Build a normalized coupling matrix from the service call graph.
   *
   * Coupling[i][j] is derived from:
   * - Call rate between services i and j
   * - Error rate on the edge
   * - P99 latency relative to threshold
   *
   * Normalized to [0, 1].
   *
   * @param serviceGraph - Service call graph
   * @returns Flattened N×N coupling matrix (row-major)
   */
  private buildCouplingMatrix(serviceGraph: ServiceCallGraph): Float64Array {
    const N = serviceGraph.nodes.size;
    const serviceIds = Array.from(serviceGraph.nodes.keys());
    const matrix = new Float64Array(N * N);

    // Build service ID to index mapping
    const idToIndex = new Map<string, number>();
    serviceIds.forEach((id, i) => idToIndex.set(id, i));

    // Set diagonal to 1 (self-coupling)
    for (let i = 0; i < N; i++) {
      matrix[i * N + i] = 1.0;
    }

    // Populate from edges
    for (const edge of serviceGraph.edges) {
      const fromIdx = idToIndex.get(edge.from);
      const toIdx = idToIndex.get(edge.to);

      if (fromIdx === undefined || toIdx === undefined) continue;

      // Coupling strength = weighted combination of call metrics
      const callRateNorm = Math.tanh(edge.callRate / 1000); // normalize high rates
      const latencySeverity = edge.p99Latency > 500 ? Math.min(1, edge.p99Latency / 2000) : edge.p99Latency / 2000;
      const coupling = 0.4 * callRateNorm + 0.3 * latencySeverity + 0.3 * (1 - edge.errorRate);

      matrix[fromIdx * N + toIdx] = Math.min(1, Math.max(0, coupling));
    }

    return matrix;
  }

  /**
   * Compute the squared L² norm of a tensor: ||f||² = Σ f(...)².
   *
   * This represents the correlation energy E_k at order k.
   *
   * @param tensor - Flattened tensor values
   * @returns Sum of squared values
   */
  private computeNormSquared(tensor: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < tensor.length; i++) {
      const v = tensor[i]!;
      sum += v * v;
    }
    return sum;
  }

  /**
   * Create a BBGKYState object for a given order.
   *
   * @param order - Correlation order k
   * @param serviceGraph - Service topology
   * @param tensor - Correlation tensor values
   * @param energy - Correlation energy ||f_k||²
   * @param isSignificant - Whether this order is above truncation threshold
   */
  private createBBGKYState(
    order: number,
    serviceGraph: ServiceCallGraph,
    tensor: Float64Array,
    energy: number,
    isSignificant: boolean,
  ): BBGKYState {
    return {
      order,
      serviceIds: Array.from(serviceGraph.nodes.keys()),
      correlationEnergy: energy,
      tensor,
      isSignificant,
    };
  }

  /**
   * Compute the average pairwise coupling for a set of service indices.
   *
   * @param coupling - N×N coupling matrix (row-major)
   * @param N - Matrix dimension
   * @param indices - Service indices
   * @returns Average coupling strength
   */
  private averagePairwiseCoupling(
    coupling: Float64Array,
    N: number,
    indices: number[],
  ): number {
    if (indices.length <= 1) return 1.0;

    let sum = 0;
    let count = 0;

    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a]!;
        const j = indices[b]!;
        sum += Math.abs(coupling[i * N + j] ?? 0);
        count++;
      }
    }

    return count > 0 ? sum / count : 0;
  }

  /**
   * Decode a flat index into a multi-index for k-1 dimensions.
   *
   * @param flatIndex - Position in flattened tensor
   * @param N - Dimension of each axis
   * @param dimensions - Number of dimensions (k)
   * @returns Array of indices in each dimension
   */
  private decodeMultiIndex(flatIndex: number, N: number, dimensions: number): number[] {
    const indices: number[] = [];
    let remaining = flatIndex;

    for (let d = 0; d < dimensions; d++) {
      const divisor = Math.pow(N, dimensions - 1 - d);
      const idx = Math.floor(remaining / divisor);
      indices.push(idx);
      remaining = remaining % divisor;
    }

    return indices;
  }

  /**
   * Find the truncation order from energy ratios.
   *
   * The first ratio < η determines the truncation point.
   *
   * @param energyRatios - E_k/E_{k-1} for k=2,3,...
   * @param eta - Truncation threshold
   * @returns Optimal truncation order (first insignificant order)
   */
  private findTruncationOrder(energyRatios: readonly number[], eta: number): number {
    // Truncation order = k where ratio < η, else max order
    for (let i = 0; i < energyRatios.length; i++) {
      if ((energyRatios[i] ?? 0) < eta) {
        return i + 1; // Orders are 2,3,... so i=0 means k=2 is first insignificant
      }
    }
    return energyRatios.length + 1;
  }

  /**
   * Estimate the truncation error from dropping orders ≥ k*.
   *
   * Error ≈ E_k* / (1 - r) where r is the geometric ratio of energies.
   *
   * @param energyRatios - Energy ratios E_k/E_{k-1}
   * @param lastIncludedOrder - Last order included (k* - 1)
   * @returns Estimated error bound
   */
  private estimateTruncationError(
    energyRatios: readonly number[],
    lastIncludedOrder: number,
  ): number {
    if (lastIncludedOrder >= energyRatios.length) return 0;

    // Use geometric series sum: E_total ≈ E_k* + E_k* × r + E_k* × r² + ...
    //                                = E_k* / (1 - r)
    const firstDroppedRatio = energyRatios[lastIncludedOrder] ?? 0;
    if (firstDroppedRatio >= 1) return firstDroppedRatio;

    return firstDroppedRatio / (1 - firstDroppedRatio + 1e-10);
  }
}
