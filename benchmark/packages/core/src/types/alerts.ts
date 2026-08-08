/**
 * Alert and denoising types.
 *
 * These map to Deng Yu's rigorous proof of Stosszahlansatz
 * (Molecular Chaos Hypothesis):
 * - In large-scale systems with sparse coupling,
 *   joint alert distributions factorize to near-independence.
 * - This provides a mathematically justified denoising criterion.
 *
 * @module types/alerts
 */

/** Alert severity levels. */
export type AlertSeverity = 'critical' | 'warning' | 'info';

/** A single alert record from the monitoring system. */
export interface AlertRecord {
  /** Unique alert ID */
  readonly id: string;
  /** Source service ID */
  readonly serviceId: string;
  /** Severity level */
  readonly severity: AlertSeverity;
  /** When the alert fired (Unix ms) */
  readonly timestamp: number;
  /** Metric that triggered the alert */
  readonly metric: string;
  /** Current metric value */
  readonly value: number;
  /** Alert threshold */
  readonly threshold: number;
  /** Human-readable alert message */
  readonly message: string;
}

/** A group of temporally related alerts. */
export interface AlertGroup {
  /** Group identifier */
  readonly id: string;
  /** Time window of grouped alerts */
  readonly timeWindow: readonly [number, number];
  /** Alerts within this group */
  readonly alerts: readonly AlertRecord[];
  /** Maximum pairwise coupling strength within the group */
  readonly maxCouplingStrength: number;
}

/**
 * Coupling sparsity matrix — the core data structure for
 * Stosszahlansatz-based denoising.
 *
 * S = 1 - ||C||₀ / N², where C is the N×N coupling matrix,
 * ||C||₀ is the count of nonzero entries.
 */
export interface CouplingSparsityMatrix {
  /** Number of services N */
  readonly dimension: number;
  /** Flattened N×N coupling matrix (row-major) */
  readonly matrix: Float64Array;
  /** Coupling sparsity score S ∈ [0, 1] */
  readonly sparsityScore: number;
  /** Threshold τ for Stosszahlansatz satisfaction */
  readonly threshold: number;
  /** Whether the coupling satisfies the Stosszahlansatz condition */
  readonly satisfiesStosszahlansatz: boolean;
  /** Groups of independent services (factorable) */
  readonly independentGroups: ReadonlyArray<readonly string[]>;
}

/** Result of independence check for an alert group. */
export interface IndependenceResult {
  /** Whether the alerts are independent under Stosszahlansatz */
  readonly isIndependent: boolean;
  /** sup|P(AB) - P(A)P(B)| decomposition error */
  readonly decompositionError: number;
  /** The sparsity threshold used for judgment */
  readonly sparsityThreshold: number;
  /** Statistical confidence level (0-1) */
  readonly confidenceLevel: number;
}

/** Result of alert denoising. */
export interface DenoiseResult {
  /** Alerts retained for analysis (true alarms) */
  readonly trueAlarms: readonly AlertRecord[];
  /** Alerts identified as coincidental (can be suppressed) */
  readonly coincidentalAlarms: readonly AlertRecord[];
  /** Grouped alerts for correlation analysis */
  readonly groupedAlarms: readonly AlertGroup[];
  /** Overall sparsity score of the alert set */
  readonly sparsityScore: number;
  /** False positive reduction rate compared to rule-based approach */
  readonly falsePositiveReduction: number;
}

/** Default Stosszahlansatz parameters. */
export const DEFAULT_STOSS_PARAMS = {
  /** Minimum system scale for Stosszahlansatz to hold */
  minSystemSize: 20,
  /** Default coupling sparsity threshold τ */
  sparsityThreshold: 0.7,
  /** Minimum confidence level for independence declaration */
  minConfidenceLevel: 0.95,
  /** Maximum tolerable decomposition error */
  maxDecompositionError: 0.05,
} as const;
