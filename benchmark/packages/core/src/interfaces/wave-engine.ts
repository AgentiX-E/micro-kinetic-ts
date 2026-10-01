/**
 * Wave Propagation Model interface — alert cascade dynamics.
 *
 * Maps Deng Yu's wave kinetic equation (WKE) from turbulence theory:
 *
 * WKE: ∂_t n(k) = ∫ T(k,k₁,k₂) [n₁n₂ - nk(n₁+n₂)] dk₁dk₂
 *
 * This equation describes the statistical energy cascade in
 * weakly nonlinear dispersive wave systems — how energy flows
 * from one wavenumber to another over time.
 *
 * AIOps mapping:
 * - Wave energy → alert "intensity" at a service
 * - Wavenumber k → service position in graph
 * - Energy cascade → alert propagation along call chains
 * - WKE → statistical evolution of alert patterns
 *
 * @module interfaces/wave-engine
 */

import type { ServiceCallGraph } from '../types/graph.js';

/** Parameters for the wave cascade model. */
export interface WaveParams {
  /** Coupling strength between adjacent services (0-1) */
  readonly couplingStrength: number;
  /** Propagation speed multiplier */
  readonly propagationSpeed: number;
  /** Correlation decay time constant τ (ms) */
  readonly decayTimeConstant: number;
  /** Alert intensity threshold for cascade initiation */
  readonly cascadeThreshold: number;
  /** Simulation time horizon (ms) */
  readonly timeHorizon: number;
}

/** Alert intensity at a service node at a given time. */
export interface AlertIntensity {
  readonly serviceId: string;
  readonly time: number;
  readonly intensity: number; // 0-1 normalized
}

/** Result of a cascade simulation. */
export interface CascadeResult {
  /** Source service where the cascade originates */
  readonly sourceServiceId: string;
  /** Time series of alert intensities per service */
  readonly intensityTrajectories: ReadonlyMap<string, readonly AlertIntensity[]>;
  /** Propagation distance (hops from source) */
  readonly propagationDistance: number;
  /** Peak intensity across all services */
  readonly peakIntensity: number;
  /** Time to peak intensity (ms from cascade start) */
  readonly timeToPeak: number;
  /** Whether the cascade dissipated or persisted */
  readonly dissipated: boolean;
  /** Dissipation time (ms), if dissipated */
  readonly dissipationTime?: number;
}

/** Correlation decay curve over time. */
export interface DecayCurve {
  /** Time points (ms) */
  readonly timePoints: Float64Array;
  /** Correlation values C(t) aligned with time points */
  readonly correlationValues: Float64Array;
  /** Fitted decay time constant τ */
  readonly decayConstant: number;
  /** R² of exponential fit C(t) = C₀ × exp(-t/τ) */
  readonly fitQuality: number;
}

/**
 * Wave propagation model interface.
 */
export interface IWavePropagationModel {
  /**
   * Simulate an alert cascade from a source service.
   *
   * Uses a discretized wave kinetic equation to model how
   * alert intensity propagates through the service graph.
   *
   * The cascade intensity I(s, t) evolves as:
   *   ∂_t I(s,t) = Σ_{s'} T(s,s',s'') [I(s')I(s'') - I(s)(I(s')+I(s''))]
   *              - γ × I(s,t)   (dissipation term)
   *
   * where T is the interaction kernel derived from graph topology.
   */
  simulateCascade(source: string, graph: ServiceCallGraph, params: WaveParams): CascadeResult;
}

/**
 * Cascade simulator interface — discrete-time Monte Carlo simulator.
 */
export interface ICascadeSimulator {
  /**
   * Run a single cascade realization.
   */
  simulate(source: string, graph: ServiceCallGraph, params: WaveParams): CascadeResult;

  /**
   * Run multiple realizations and aggregate statistics.
   */
  simulateEnsemble(
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
  };
}

/**
 * Correlation decay estimator interface.
 */
export interface ICorrelationDecayEstimator {
  /**
   * Estimate how alert correlation decays with distance/time.
   *
   * Under the WKE, correlation decays as C(t) = C₀ × exp(-t/τ)
   * where τ is determined by the graph's spectral gap.
   */
  estimateDecay(graph: ServiceCallGraph, timeHorizon: number): DecayCurve;
}
