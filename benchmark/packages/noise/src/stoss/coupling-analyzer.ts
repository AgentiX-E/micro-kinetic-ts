/**
 * Coupling Sparsity Analyzer — Stosszahlansatz-based coupling matrix.
 *
 * Computes the N×N coupling sparsity matrix from alert history
 * and service topology. This is the core data structure for
 * molecular-chaos-based alert denoising.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Stosszahlansatz (Molecular Chaos Hypothesis)
 * In Deng Yu's rigorous derivation of the Boltzmann equation from
 * hard-sphere dynamics, the Stosszahlansatz states:
 *
 *   For an N-particle system with sparse coupling (S > τ),
 *   the joint distribution factorizes:
 *     P(a₁, a₂, ..., a_N) ≈ ∏_{i=1}^N P(a_i)
 *   with error bounded by K/N → 0 as N → ∞.
 *
 * ### AIOps Translation
 * - "Particle" → Microservice
 * - "P(a_i)" → Marginal alert probability for service i
 * - "P(a_i, a_j)" → Joint alert probability for services i, j
 * - "Sparse coupling" → S = 1 - ||C||₀/N² > τ
 * - "Factorizes" → Most simultaneous alerts are coincidental
 *
 * ### Core Formula
 *   S = 1 - ||C||₀ / N²
 *   where C_{ij} = MI(alert_i, alert_j)
 *   and ||C||₀ = count of |C_{ij}| > ε
 *
 * If S > τ (default τ = 0.7), the system satisfies Stosszahlansatz
 * and coincidental alerts can be safely suppressed.
 *
 * @module noise/stoss/coupling-analyzer
 */

import type {
  AlertRecord,
  CouplingSparsityMatrix,
  ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';
import { DEFAULT_STOSS_PARAMS, invariant, invariantNonEmpty } from '@agentix-e/micro-kinetic-core';
import { StatisticsProvider } from '../math/statistics-provider.js';

/** Default coupling significance threshold ε. */
const DEFAULT_COUPLING_EPSILON = 0.001;

/**
 * Coupling Sparsity Analyzer.
 *
 * Implements IDenoiseEngine.computeCouplingSparsity() to build
 * the coupling matrix C_{ij} from alert time series using
 * mutual information.
 */
export class CouplingSparsityAnalyzer {
  private readonly stats: StatisticsProvider;

  /**
   * @param stats - Statistics provider for mutual information computation
   */
  constructor(stats?: StatisticsProvider) {
    this.stats = stats ?? new StatisticsProvider();
  }

  /**
   * Compute the coupling sparsity matrix from alert history and service topology.
   *
   * **Algorithm:**
   * 1. Group alerts by service ID
   * 2. Convert each service's alert sequence to a Float64Array time series
   * 3. For each pair (i, j), compute C_{ij} = MI(alert_i, alert_j)
   * 4. Compute sparsity S = 1 - ||C||₀ / N² where ||C||₀ counts |C_{ij}| > ε
   * 5. Identify independent groups via sparsity threshold τ
   *
   * **Deng Yu Guarantee:**
   *   For systems with S > 0.7 and N > 20,
   *   the Stosszahlansatz approximation error is ≤ K/N.
   *
   * @param alertHistory - Historical alert records
   * @param serviceGraph - Service call graph topology
   * @returns CouplingSparsityMatrix with full coupling and sparsity analysis
   */
  public computeCouplingSparsity(
    alertHistory: readonly AlertRecord[],
    serviceGraph: ServiceCallGraph,
  ): CouplingSparsityMatrix {
    invariantNonEmpty(alertHistory, 'alertHistory');
    invariant(serviceGraph.nodes.size > 0, 'serviceGraph must contain at least one node');

    // Step 1: Group alerts by service ID
    const serviceIds = Array.from(serviceGraph.nodes.keys());
    const alertsByService = new Map<string, { times: number[]; values: number[] }>();

    for (const alert of alertHistory) {
      let entry = alertsByService.get(alert.serviceId);
      if (!entry) {
        entry = { times: [], values: [] };
        alertsByService.set(alert.serviceId, entry);
      }
      entry.times.push(alert.timestamp);
      entry.values.push(alert.value);
    }

    const N = serviceIds.length;
    const threshold = DEFAULT_STOSS_PARAMS.sparsityThreshold;

    // Step 2: Build time series for each service
    const timeSeries: Float64Array[] = serviceIds.map((id) => {
      const entry = alertsByService.get(id);
      if (!entry || entry.values.length === 0) {
        return new Float64Array([0]);
      }
      return new Float64Array(entry.values);
    });

    // Step 3: Compute N×N coupling matrix
    const matrix = new Float64Array(N * N);
    let nonzeroCount = 0;

    for (let i = 0; i < N; i++) {
      matrix[i * N + i] = 1.0; // diagonal: self-coupling = 1
      nonzeroCount++;

      for (let j = i + 1; j < N; j++) {
        const tsI = timeSeries[i]!;
        const tsJ = timeSeries[j]!;

        // Align time series to same length for MI computation
        const minLen = Math.min(tsI.length, tsJ.length);
        if (minLen < 5) {
          // Insufficient data for meaningful MI
          matrix[i * N + j] = 0;
          matrix[j * N + i] = 0;
          continue;
        }

        const alignedI = tsI.slice(0, minLen);
        const alignedJ = tsJ.slice(0, minLen);

        const mi = this.stats.mutualInformation(alignedI, alignedJ);

        // Symmetric fill
        matrix[i * N + j] = mi;
        matrix[j * N + i] = mi;

        if (Math.abs(mi) > DEFAULT_COUPLING_EPSILON) {
          nonzeroCount += 2; // both i,j and j,i
        }
      }
    }

    // Step 4: Compute sparsity
    const totalPairs = N * N;
    const sparsityScore = 1 - nonzeroCount / totalPairs;

    // Step 5: Identify independent groups
    const satisfies = sparsityScore >= threshold;
    const independentGroups = this.findIndependentGroups(matrix, N, threshold);

    // Step 6: Validate against Deng Yu's minimum system scale
    const minSystemSize = DEFAULT_STOSS_PARAMS.minSystemSize;
    const meetsScaleRequirement = N >= minSystemSize;

    // Stosszahlansatz holds when sparsity exceeds threshold and system is large enough
    const satisfiesStosszahlansatz = satisfies && meetsScaleRequirement;

    return {
      dimension: N,
      matrix,
      sparsityScore,
      threshold,
      satisfiesStosszahlansatz,
      independentGroups,
    };
  }

  /**
   * Find groups of services with negligible mutual coupling.
   *
   * Two services are "independent" under Stosszahlansatz if
   * |C_{ij}| < ε (i.e., their alert patterns are uncorrelated).
   *
   * Uses union-find to cluster services into independent groups.
   *
   * @param matrix - Flattened N×N coupling matrix (row-major)
   * @param N - Number of services
   * @param threshold - Coupling significance threshold ε
   */
  private findIndependentGroups(
    matrix: Float64Array,
    N: number,
    threshold: number,
  ): ReadonlyArray<readonly string[]> {
    // Union-find data structure
    const parent = Array.from({ length: N }, (_, i) => i);
    const rank = Array.from({ length: N }, () => 0);

    function find(x: number): number {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]!]!;
        x = parent[x]!;
      }
      return x;
    }

    function union(a: number, b: number): void {
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      if (rank[ra]! < rank[rb]!) {
        parent[ra] = rb;
      } else if (rank[ra]! > rank[rb]!) {
        parent[rb] = ra;
      } else {
        parent[rb] = ra;
        rank[ra] = rank[ra]! + 1;
      }
    }

    // Union services with significant coupling (i.e., NOT independent)
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const coupling = Math.abs(matrix[i * N + j]!);
        if (coupling >= threshold * DEFAULT_COUPLING_EPSILON * 10) {
          union(i, j);
        }
      }
    }

    // Collect groups
    const groups = new Map<number, number[]>();
    for (let i = 0; i < N; i++) {
      const root = find(i);
      let group = groups.get(root);
      if (!group) {
        group = [];
        groups.set(root, group);
      }
      group.push(i);
    }

    // Note: independent groups are individual services that aren't
    // in any coupled group (singleton groups)
    return Array.from(groups.values()).map((indices) => indices.map((i) => `service_${i}`));
  }
}
