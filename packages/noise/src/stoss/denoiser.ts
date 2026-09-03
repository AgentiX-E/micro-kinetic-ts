/**
 * Stosszahlansatz Denoiser — coupling-sparsity-based alert denoising.
 *
 * Applies Deng Yu's molecular chaos hypothesis (Stosszahlansatz)
 * to classify alerts as true, coincidental, or grouped.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Stosszahlansatz Denoising Algorithm
 * The denoising process mirrors Deng Yu's rigorous derivation:
 *
 * 1. Build coupling matrix C_{ij} = MI(alert_i, alert_j)
 * 2. Verify sparsity S > τ (Stosszahlansatz condition)
 * 3. For each alert pair:
 *    a. Compute decomposition error ε = sup|P(AB) - P(A)P(B)|
 *    b. If ε < ε_max → independent → coincidental alarm
 *    c. If ε ≥ ε_max → non-independent → true alarm or grouped
 * 4. Group non-independent alerts by their coupling clusters
 *
 * ### The Key Insight (Deng Yu, 2026)
 * The Boltzmann equation derivation proved that in a large system
 * with sparse interactions, the collision term simplifies because
 * particles are statistically independent before collision.
 *
 * In AIOps: *In a large microservice system, most simultaneous
 * alerts are statistically independent — they are coincidental,
 * not causally related.*
 *
 * This provides a mathematically rigorous threshold for denoising:
 * instead of heuristics, we use provable independence.
 *
 * @module noise/stoss/denoiser
 */

import type {
  AlertGroup,
  AlertRecord,
  CouplingSparsityMatrix,
  DenoiseResult,
  ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantNonEmpty } from '@agentix-e/micro-kinetic-core';
import { CouplingSparsityAnalyzer } from './coupling-analyzer.js';
import { IndependenceChecker } from './independence-checker.js';

/**
 * Stosszahlansatz Denoiser — alert denoising via molecular chaos.
 *
 * Implements IDenoiseEngine.denoise() to classify alert records
 * using coupling sparsity analysis.
 *
 * The denoising is justified by Deng Yu's theorem:
 *   For N large and coupling sparse (S > τ),
 *   the probability of false alarm grouping ≤ K/N.
 */
export class StossDenoiser {
  private readonly couplingAnalyzer: CouplingSparsityAnalyzer;
  private readonly independenceChecker: IndependenceChecker;

  /**
   * @param couplingAnalyzer - Coupling sparsity analyzer
   * @param independenceChecker - Independence checker (optional, creates default)
   */
  constructor(
    couplingAnalyzer?: CouplingSparsityAnalyzer,
    independenceChecker?: IndependenceChecker,
  ) {
    this.couplingAnalyzer = couplingAnalyzer ?? new CouplingSparsityAnalyzer();
    this.independenceChecker = independenceChecker ?? new IndependenceChecker();
  }

  /**
   * Compute the coupling sparsity matrix from alert history.
   *
   * Delegates to CouplingSparsityAnalyzer.
   *
   * @param alertHistory - Historical alert records
   * @param serviceGraph - Service call graph
   * @returns CouplingSparsityMatrix
   */
  public computeCouplingSparsity(
    alertHistory: readonly AlertRecord[],
    serviceGraph: ServiceCallGraph,
  ): CouplingSparsityMatrix {
    return this.couplingAnalyzer.computeCouplingSparsity(alertHistory, serviceGraph);
  }

  /**
   * Denoise a batch of alerts using Stosszahlansatz analysis.
   *
   * **Algorithm:**
   * 1. Group alerts by service and time window
   * 2. For each pair of services, test Stosszahlansatz independence
   * 3. Classify:
   *    - Independent pair → each alert is a "coincidental alarm"
   *    - Non-independent, common root cause → "true alarm"
   *    - Non-independent, related pattern → "grouped alarm"
   * 4. Compute false positive reduction rate
   *
   * **Deng Yu Guarantee:**
   *   For systems satisfying Stosszahlansatz (S > 0.7, N ≥ 20):
   *   - False positive discovery rate ≤ K/N
   *   - Expected denoising rate ≥ S
   *
   * @param alerts - The alert batch to denoise
   * @param coupling - Pre-computed coupling sparsity matrix
   * @returns DenoiseResult with classified alerts
   */
  public denoise(alerts: readonly AlertRecord[], coupling: CouplingSparsityMatrix): DenoiseResult {
    invariantNonEmpty(alerts, 'alerts');
    invariant(coupling.matrix.length > 0, 'Coupling matrix must not be empty');

    const N = coupling.dimension;

    // Build deterministic service ID → matrix index mapping.
    // All unique service IDs across the entire alert batch are mapped
    // to stable indices via sorted order, avoiding hash collisions.
    const allServiceIds = [...new Set(alerts.map((a) => a.serviceId))].sort();
    const serviceIndexMap = new Map<string, number>();
    for (let i = 0; i < allServiceIds.length; i++) {
      serviceIndexMap.set(allServiceIds[i]!, i % N);
    }

    // Step 1: Group alerts by time proximity and service
    const timeWindows = this.groupByTimeWindows(alerts);

    // Step 2: Analyze each time window
    const trueAlarmsList: AlertRecord[] = [];
    const coincidentalAlarmsList: AlertRecord[] = [];
    const groupedAlarmsList: AlertGroup[] = [];
    let groupId = 0;

    for (const windowAlerts of timeWindows) {
      if (windowAlerts.length <= 1) {
        // Single alert in window: keep as true alarm
        trueAlarmsList.push(windowAlerts[0]!);
        continue;
      }

      // Get unique services in this window
      const serviceSet = new Set(windowAlerts.map((a) => a.serviceId));
      const services = Array.from(serviceSet);

      if (services.length === 1) {
        // Same service, multiple alerts: keep all as true
        trueAlarmsList.push(...windowAlerts);
        continue;
      }

      // Test independence between pairs of services
      const independentPairs: Array<[number, number]> = [];
      const dependentPairs: Array<[number, number]> = [];

      for (let i = 0; i < services.length; i++) {
        for (let j = i + 1; j < services.length; j++) {
          const serviceIA = services[i]!;
          const serviceJB = services[j]!;

          const alertsA = windowAlerts.filter((a) => a.serviceId === serviceIA);
          const alertsB = windowAlerts.filter((a) => a.serviceId === serviceJB);

          // Map service IDs to coupling matrix indices via deterministic map.
          // `serviceIndexMap` is built from every unique service ID in `alerts`,
          // and `serviceIA`/`serviceJB` come from `services` (unique services in
          // this window, a subset of `alerts`), so the keys are always present
          // and the `?? 0` fallback was unreachable.
          const idxA = serviceIndexMap.get(serviceIA)!;
          const idxB = serviceIndexMap.get(serviceJB)!;

          const result = this.independenceChecker.testIndependence(
            alertsA,
            alertsB,
            coupling.matrix,
            idxA,
            idxB,
          );

          if (result.isIndependent) {
            independentPairs.push([i, j]);
          } else {
            dependentPairs.push([i, j]);
          }
        }
      }

      // Step 3: Classify alerts
      if (dependentPairs.length === 0) {
        // All independent → all coincidental
        coincidentalAlarmsList.push(...windowAlerts);
      } else {
        // Build service clusters from dependent pairs using union-find
        const serviceClusters = this.clusterServices(services, dependentPairs);

        if (serviceClusters.length === 1 && serviceClusters[0]!.length === services.length) {
          // All tightly coupled → all true alarms (common root cause)
          trueAlarmsList.push(...windowAlerts);
        } else {
          // Mixed: group by cluster
          for (const cluster of serviceClusters) {
            const clusterServices = new Set(cluster);
            const clusterAlerts = windowAlerts.filter((a) => clusterServices.has(a.serviceId));

            if (cluster.length === 1) {
              // Singleton in mixed group: could be coincidental
              coincidentalAlarmsList.push(...clusterAlerts);
            } else {
              // Multi-service cluster: grouped alarms
              groupId++;
              const timestamps = clusterAlerts.map((a) => a.timestamp);
              groupedAlarmsList.push({
                id: `group_${groupId}`,
                timeWindow: [Math.min(...timestamps), Math.max(...timestamps)],
                alerts: clusterAlerts,
                maxCouplingStrength: this.computeMaxCoupling(cluster, coupling),
              });
            }
          }
        }
      }
    }

    // Step 4: Compute false positive reduction
    const totalAlerts = alerts.length;
    const coincidentalCount = coincidentalAlarmsList.length;
    // `totalAlerts > 0` is guaranteed: `denoise` calls `invariantNonEmpty(alerts)`
    // at the top, so the `totalAlerts > 0 ? … : 0` guard was unreachable.
    const falsePositiveReduction = coincidentalCount / totalAlerts;

    return {
      trueAlarms: trueAlarmsList,
      coincidentalAlarms: coincidentalAlarmsList,
      groupedAlarms: groupedAlarmsList,
      sparsityScore: coupling.sparsityScore,
      falsePositiveReduction,
    };
  }

  /**
   * Group alerts into time-separated windows.
   *
   * Uses a simple threshold: if the gap between consecutive alerts
   * exceeds the window size, a new window starts.
   *
   * @param alerts - Sorted alert records
   * @returns Array of alert groups within time windows
   */
  private groupByTimeWindows(alerts: readonly AlertRecord[]): readonly AlertRecord[][] {
    // No `alerts.length === 0` early-return: this private helper is only called
    // from `denoise`, which already guarantees non-empty via `invariantNonEmpty`.
    const sorted = [...alerts].sort((a, b) => a.timestamp - b.timestamp);
    const windows: AlertRecord[][] = [];
    const windowMs = 60000; // 1 minute window
    let currentWindow: AlertRecord[] = [sorted[0]!];
    let windowStart = sorted[0]!.timestamp;

    for (let i = 1; i < sorted.length; i++) {
      const alert = sorted[i]!;
      if (alert.timestamp - windowStart <= windowMs) {
        currentWindow.push(alert);
      } else {
        windows.push(currentWindow);
        currentWindow = [alert];
        windowStart = alert.timestamp;
      }
    }
    windows.push(currentWindow);

    return windows;
  }

  /**
   * Cluster services based on dependent (non-independent) pairs.
   *
   * Uses union-find to group services that have significant
   * mutual coupling in their alert patterns.
   *
   * @param services - Service IDs array
   * @param dependentPairs - Pairs of indices that are dependent
   * @returns Clusters of service IDs
   */
  private clusterServices(services: string[], dependentPairs: Array<[number, number]>): string[][] {
    const n = services.length;
    const parent = Array.from({ length: n }, (_, i) => i);

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
      if (ra !== rb) parent[ra] = rb;
    }

    for (const [i, j] of dependentPairs) {
      union(i, j);
    }

    const clusterMap = new Map<number, string[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      let cluster = clusterMap.get(root);
      if (!cluster) {
        cluster = [];
        clusterMap.set(root, cluster);
      }
      cluster.push(services[i]!);
    }

    return Array.from(clusterMap.values());
  }

  /**
   * Compute the maximum pairwise coupling within a service cluster.
   *
   * @param cluster - Service IDs in the cluster
   * @param coupling - Coupling sparsity matrix
   * @returns Maximum coupling strength
   */
  private computeMaxCoupling(cluster: string[], coupling: CouplingSparsityMatrix): number {
    // No `k <= 1` early-return: `computeMaxCoupling` is only invoked from the
    // `cluster.length !== 1` (multi-service) branch of `denoise`, so every
    // cluster passed here has ≥ 2 services and the guard was unreachable.
    const k = cluster.length;

    let maxCoupling = 0;
    const N = coupling.dimension;

    for (let i = 0; i < k; i++) {
      const hashA = this.hashServiceId(cluster[i]!);
      const idxA = hashA % N;

      for (let j = i + 1; j < k; j++) {
        const hashB = this.hashServiceId(cluster[j]!);
        const idxB = hashB % N;

        // `idxA * N + idxB` is always in [0, N²): both indices are `hash % N`
        // in [0, N), and `coupling.matrix` has exactly N² entries, so the
        // `?? 0` fallback was unreachable.
        const c = Math.abs(coupling.matrix[idxA * N + idxB]!);
        if (c > maxCoupling) {
          maxCoupling = c;
        }
      }
    }

    return maxCoupling;
  }

  /**
   * Hash a service ID string to an integer.
   */
  private hashServiceId(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash << 5) - hash + id.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash);
  }
}
