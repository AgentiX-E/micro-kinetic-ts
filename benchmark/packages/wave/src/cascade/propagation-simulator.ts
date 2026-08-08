/**
 * Propagation Simulator — Monte Carlo cascade simulation.
 *
 * Simulates alert cascade propagation through the service graph
 * using a discrete-time Monte Carlo approach with ensemble averaging.
 *
 * ## Deng Yu Theorem Mapping
 *
 * ### Wave Cascade Statistics
 * The wave kinetic equation describes the *ensemble-averaged* behavior
 * of the wave field. Individual realizations differ due to the
 * stochastic nature of wave interactions, but the ensemble average
 * converges to the WKE solution as the number of realizations increases.
 *
 * For AIOps:
 * - Each MC realization = one possible alert cascade outcome
 * - Ensemble average = most likely cascade pattern
 * - Variance = uncertainty in the cascade outcome
 *
 * ### AIOps Translation
 * - Monte Carlo sample → individual alert cascade realization
 * - Ensemble → statistical summary of possible cascades
 * - Mean cascade → typical alert propagation pattern
 * - Variance → variability across scenarios
 *
 * @module wave/cascade/propagation-simulator
 */

import type {
  AlertIntensity,
  CascadeResult,
  ServiceCallGraph,
  WaveParams,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantNonEmpty, invariantPositiveInt } from '@agentix-e/micro-kinetic-core';
import { WaveCascadeModel } from './cascade-model.js';

/**
 * Propagation Simulator — Monte Carlo cascade simulation.
 *
 * Implements ICascadeSimulator for discrete-time Monte Carlo
 * simulation of alert cascades.
 */
export class PropagationSimulator {
  private readonly waveModel: WaveCascadeModel;

  /**
   * @param waveModel - Underlying wave cascade model
   */
  constructor(waveModel?: WaveCascadeModel) {
    this.waveModel = waveModel ?? new WaveCascadeModel();
  }

  /**
   * Run a single cascade realization.
   *
   * @param source - Source service ID
   * @param graph - Service call graph
   * @param params - Wave propagation parameters
   * @returns Single cascade result
   */
  public simulate(source: string, graph: ServiceCallGraph, params: WaveParams): CascadeResult {
    invariantNonEmpty(source, 'source');
    invariant(graph.nodes.has(source), `Source "${source}" not found in graph`);

    return this.waveModel.simulateCascade(source, graph, params);
  }

  /**
   * Run multiple realizations and aggregate statistics.
   *
   * **Ensemble Mode:**
   * 1. Run `ensembleSize` independent cascade simulations
   * 2. Compute the mean cascade trajectory
   * 3. Compute variance field across realizations
   * 4. Compute confidence intervals for key metrics
   *
   * **Deng Yu's Guarantee:**
   *   As ensembleSize → ∞, the ensemble mean converges to the
   *   solution of the wave kinetic equation with error O(1/√M).
   *
   * @param source - Source service ID
   * @param graph - Service call graph
   * @param params - Wave propagation parameters
   * @param ensembleSize - Number of Monte Carlo realizations
   * @returns Ensemble statistics
   */
  public simulateEnsemble(
    source: string,
    graph: ServiceCallGraph,
    params: WaveParams,
    ensembleSize: number,
  ): {
    readonly meanCascade: CascadeResult;
    readonly varianceField: ReadonlyMap<string, number>;
    readonly confidenceIntervals: ReadonlyMap<
      string,
      { readonly lower: number; readonly upper: number }
    >;
  } {
    invariantNonEmpty(source, 'source');
    invariant(graph.nodes.has(source), `Source "${source}" not found in graph`);
    invariantPositiveInt(ensembleSize, 'ensembleSize');
    invariant(ensembleSize >= 2, 'ensembleSize must be at least 2');

    // Step 1: Run all realizations
    const realizations: CascadeResult[] = [];
    for (let i = 0; i < ensembleSize; i++) {
      // Add small noise to couplingStrength for variability between runs
      const noisyParams: WaveParams = {
        ...params,
        couplingStrength: this.addNoise(params.couplingStrength, 0.1),
      };
      const result = this.waveModel.simulateCascade(source, graph, noisyParams);
      realizations.push(result);
    }

    // Step 2: Compute mean cascade
    const meanCascade = this.computeMeanCascade(realizations, source, graph);

    // Step 3: Compute variance field per service
    const varianceField = this.computeVarianceField(realizations);

    // Step 4: Compute confidence intervals
    const confidenceIntervals = this.computeConfidenceIntervals(realizations, varianceField);

    return {
      meanCascade,
      varianceField,
      confidenceIntervals,
    };
  }

  /**
   * Compute the mean cascade from multiple realizations.
   *
   * Averages intensity trajectories across all realizations
   * for each service and time point.
   *
   * @param realizations - Array of cascade results
   * @param source - Source service ID
   * @param graph - Service call graph
   * @returns Mean cascade result
   */
  private computeMeanCascade(
    realizations: CascadeResult[],
    source: string,
    graph: ServiceCallGraph,
  ): CascadeResult {
    const M = realizations.length;
    const first = realizations[0]!;
    const serviceIds = Array.from(first.intensityTrajectories.keys());
    const timePoints = first.intensityTrajectories.get(serviceIds[0]!)!.length;

    // Accumulate trajectories
    const accumulatedTrajectories = new Map<string, AlertIntensity[]>();

    for (const realization of realizations) {
      for (const [serviceId, trajectory] of realization.intensityTrajectories) {
        let acc = accumulatedTrajectories.get(serviceId);
        if (!acc) {
          acc = Array.from({ length: timePoints }, (_, t) => ({
            serviceId,
            time: trajectory[t]!.time,
            intensity: 0,
          }));
          accumulatedTrajectories.set(serviceId, acc);
        }

        for (let t = 0; t < Math.min(timePoints, trajectory.length); t++) {
          acc[t] = {
            ...acc[t]!,
            intensity: acc[t]!.intensity + trajectory[t]!.intensity,
          };
        }
      }
    }

    // Divide by M
    const meanTrajectories = new Map<string, readonly AlertIntensity[]>();
    for (const [serviceId, acc] of accumulatedTrajectories) {
      const mean = acc.map((a) => ({
        ...a,
        intensity: a.intensity / M,
      }));
      meanTrajectories.set(serviceId, mean);
    }

    // Compute mean statistics
    const avgPeak = realizations.reduce((s, r) => s + r.peakIntensity, 0) / M;
    const avgTimeToPeak = realizations.reduce((s, r) => s + r.timeToPeak, 0) / M;
    const avgPropDistance = realizations.reduce((s, r) => s + r.propagationDistance, 0) / M;
    const dissipatedCount = realizations.filter((r) => r.dissipated).length;

    return {
      sourceServiceId: source,
      intensityTrajectories: meanTrajectories,
      propagationDistance: Math.round(avgPropDistance),
      peakIntensity: avgPeak,
      timeToPeak: avgTimeToPeak,
      dissipated: dissipatedCount > M / 2, // majority vote
      dissipationTime:
        realizations
          .filter((r) => r.dissipated && r.dissipationTime !== undefined)
          .reduce((s, r) => s + r.dissipationTime!, 0) / Math.max(1, dissipatedCount),
    };
  }

  /**
   * Compute per-service variance of peak intensity.
   *
   * @param realizations - Cascade results
   * @returns Map from serviceId to variance
   */
  private computeVarianceField(realizations: CascadeResult[]): ReadonlyMap<string, number> {
    const M = realizations.length;

    // Compute per-service peak intensity distributions
    const servicePeaks = new Map<string, number[]>();

    for (const realization of realizations) {
      for (const [serviceId, trajectory] of realization.intensityTrajectories) {
        let peaks = servicePeaks.get(serviceId);
        if (!peaks) {
          peaks = [];
          servicePeaks.set(serviceId, peaks);
        }
        const peak = Math.max(...trajectory.map((t) => t.intensity));
        peaks.push(peak);
      }
    }

    // Compute variance for each service
    const varianceField = new Map<string, number>();
    for (const [serviceId, peaks] of servicePeaks) {
      const mean = peaks.reduce((s, v) => s + v, 0) / M;
      const variance = peaks.reduce((s, v) => s + (v - mean) ** 2, 0) / (M - 1);
      varianceField.set(serviceId, variance);
    }

    return varianceField;
  }

  /**
   * Compute 95% confidence intervals for peak intensity per service.
   *
   * Uses t-distribution with M-1 degrees of freedom.
   *
   * @param realizations - Cascade results
   * @param varianceField - Per-service variances
   * @returns Map from serviceId to confidence interval
   */
  private computeConfidenceIntervals(
    realizations: CascadeResult[],
    varianceField: ReadonlyMap<string, number>,
  ): ReadonlyMap<string, { readonly lower: number; readonly upper: number }> {
    const M = realizations.length;

    // t-value for 95% CI with M-1 df (approximated)
    const tValue = this.tDistributionQuantile(0.975, M - 1);

    const ci = new Map<string, { readonly lower: number; readonly upper: number }>();

    // Get mean peak per service from the first realization's structure
    const first = realizations[0]!;
    for (const serviceId of first.intensityTrajectories.keys()) {
      const peaks: number[] = [];
      for (const r of realizations) {
        const trajectory = r.intensityTrajectories.get(serviceId);
        if (trajectory) {
          peaks.push(Math.max(...trajectory.map((t) => t.intensity)));
        }
      }

      const mean = peaks.reduce((s, v) => s + v, 0) / M;
      const variance = varianceField.get(serviceId)!;
      const sem = Math.sqrt(variance / M); // standard error of mean
      const margin = tValue * sem;

      ci.set(serviceId, {
        lower: Math.max(0, mean - margin),
        upper: Math.min(1, mean + margin),
      });
    }

    return ci;
  }

  /**
   * Approximate t-distribution quantile.
   *
   * Uses the normal approximation for degrees of freedom > 30,
   * and a lookup table for small df.
   *
   * @param p - Probability (e.g., 0.975 for 95% CI)
   * @param df - Degrees of freedom
   * @returns t-statistic value
   */
  private tDistributionQuantile(p: number, df: number): number {
    if (df > 30) {
      // Normal approximation: z_{0.975} = 1.96
      return 1.96;
    }

    // Lookup table for small df (t_{0.975, df})
    const tTable: Record<number, number> = {
      1: 12.706,
      2: 4.303,
      3: 3.182,
      4: 2.776,
      5: 2.571,
      6: 2.447,
      7: 2.365,
      8: 2.306,
      9: 2.262,
      10: 2.228,
      15: 2.131,
      20: 2.086,
      25: 2.06,
      30: 2.042,
    };

    return tTable[df] ?? 2.0;
  }

  /**
   * Add multiplicative noise to a value.
   *
   * @param value - Base value
   * @param noiseLevel - Standard deviation of multiplicative noise (0-1)
   * @returns Value with noise
   */
  private addNoise(value: number, noiseLevel: number): number {
    // Box-Muller transform for Gaussian noise
    let u1 = Math.random();
    while (u1 === 0) u1 = Math.random();
    const u2 = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

    const noisy = value * (1 + noiseLevel * gaussian);
    return Math.max(0, Math.min(1, noisy));
  }
}
