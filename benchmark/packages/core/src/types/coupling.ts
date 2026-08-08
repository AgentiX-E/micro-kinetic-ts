/**
 * Multi-service coupling types for BBGKY hierarchy modeling.
 *
 * BBGKY Hierarchy in Deng Yu's kinetic theory:
 *   f₁(t, z₁)           — single-particle distribution
 *   f₂(t, z₁, z₂)       — two-particle correlation
 *   f₃(t, z₁, z₂, z₃)  — three-particle correlation
 *   ...
 *   f_k                  — k-particle correlation
 *
 * Truncation: when E_k / E_{k-1} < η, truncate to order k-1.
 *
 * AIOps mapping:
 *   particle → microservice
 *   k-particle distribution → k-service fault correlation
 *
 * @module types/coupling
 */

/** Single-service state vector for BBGKY analysis. */
export interface MicroserviceState {
  /** Service identifier */
  readonly serviceId: string;
  /** Observation timestamp (Unix ms) */
  readonly timestamp: number;
  /** Fault probability (0-1) */
  readonly faultProbability: number;
  /** Normalized anomaly score (0-1) */
  readonly anomalyScore: number;
  /** Traffic volume (requests per second) */
  readonly trafficRps: number;
}

/**
 * k-th order BBGKY distribution function.
 * f_k represents the joint fault correlation among k services.
 */
export interface BBGKYState {
  /** Order of correlation (1 = single-service, 2 = pairwise, etc.) */
  readonly order: number;
  /** Service IDs involved in this correlation */
  readonly serviceIds: readonly string[];
  /** Correlation energy ||f_k||² */
  readonly correlationEnergy: number;
  /**
   * Correlation tensor elements, flattened in row-major order.
   * Dimension: N^k where N = number of services.
   * For k=2, this is the N×N correlation matrix.
   */
  readonly tensor: Float64Array;
  /** Whether this order is significant (E_k/E_{k-1} ≥ η) */
  readonly isSignificant: boolean;
}

/**
 * BBGKY hierarchy: the complete set of k-order correlation states
 * from k=1 up to the truncation order.
 */
export interface BBGKYHierarchy {
  /** Total number of services N */
  readonly systemSize: number;
  /** Ordered list of BBGKY states (index = order-1) */
  readonly states: readonly BBGKYState[];
  /** The truncation order k* (first insignificant order) */
  readonly truncationOrder: number;
  /** Energy ratios E_k/E_{k-1} for convergence analysis */
  readonly energyRatios: readonly number[];
  /** Truncation error bound */
  readonly truncationError: number;
}

/**
 * Boltzmann-Grad limit analysis result.
 *
 * N → ∞, d → 0, Nd² = constant
 *
 * AIOps mapping:
 *   N = number of services
 *   d = single-service fault impact radius
 *   Nd² = global fault impact density
 */
export interface BoltzmannGradResult {
  /** Number of services N */
  readonly serviceCount: number;
  /** Estimated fault impact radius d */
  readonly impactRadius: number;
  /** Global fault impact density Nd² */
  readonly impactDensity: number;
  /** First-order fault probability P₁(N) */
  readonly faultProbabilityFirstOrder: number;
  /** Second-order fault probability P₂(N) */
  readonly faultProbabilitySecondOrder: number;
  /** Asymptotic fault probability P_∞ */
  readonly faultProbabilityAsymptotic: number;
  /** Whether the system operates in the Boltzmann-Grad regime */
  readonly inBoltzmannGradRegime: boolean;
  /** Scaling regime: 'dilute' | 'transition' | 'dense' */
  readonly regime: 'dilute' | 'transition' | 'dense';
}

/** Parameters for BBGKY hierarchy construction. */
export interface BBGKYOptions {
  /** Maximum correlation order to compute */
  readonly maxOrder: number;
  /** Truncation threshold η (E_k/E_{k-1} < η → truncate) */
  readonly truncationEta: number;
}

/** Default BBGKY options. */
export const DEFAULT_BBGKY_OPTIONS: BBGKYOptions = {
  maxOrder: 5,
  truncationEta: 0.01,
};
