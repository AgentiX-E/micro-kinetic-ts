/**
 * Fault and root cause analysis types.
 *
 * @module types/faults
 */

/** Severity level of a fault. */
export type FaultSeverity = 'critical' | 'major' | 'minor' | 'warning' | 'info';

import type { TimeSeries } from './time-series.js';

/** Categories of fault types for classification. */
export type FaultCategory =
  | 'CPU'
  | 'MEMORY'
  | 'MEM'
  | 'DISK'
  | 'NETWORK_DELAY'
  | 'NETWORK_LOSS'
  | 'SOCKET'
  | 'DELAY'
  | 'LOSS'
  | 'JVM_GC'
  | 'JVM_OOM'
  | 'CONNECTION_POOL'
  | 'MEMORY_LEAK'
  | 'DATA_SKEW'
  | 'CODE_ERROR'
  | 'MISCONFIGURATION'
  | 'DNS_FAILURE'
  | 'UNKNOWN';

/** Type identifier for a specific fault. */
export interface FaultType {
  readonly category: FaultCategory;
  readonly subType: string;
  readonly severity: FaultSeverity;
}

/** Indicator of chronic (slow-degrading) fault behavior. */
export interface ChronicFaultIndicator {
  /** The metric showing degradation */
  readonly metric: string;
  /** Estimated degradation rate (e.g., 1 KB/s for memory leak) */
  readonly degradationRate: number;
  /** Correlation coefficient with time (0-1) */
  readonly temporalCorrelation: number;
  /** Whether this indicator shows monotonic degradation */
  readonly isMonotonic: boolean;
}

/** A single root cause analysis result. */
export interface RootCauseResult {
  /** Service identified as root cause */
  readonly serviceId: string;
  /** Fault type classification */
  readonly faultType: FaultType;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Rank in Top-K results (1-based) */
  readonly rank: number;
  /** Time of root cause event (Unix ms) */
  readonly timestamp?: number;
  /** Supporting evidence metrics */
  readonly evidenceMetrics: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly threshold: number;
  }>;
  /** Propagation depth from root to first observable symptom */
  readonly propagationDepth: number;
  /** The error bound at this propagation depth */
  readonly propagationErrorBound: number;
  /** Whether this result was found via tree search (vs full graph) */
  readonly viaTreeSearch: boolean;
}

/** Options for RCA engine configuration. */
export interface RCAEngineOptions {
  /** Pruning epsilon threshold for cycle contributions */
  readonly pruneEpsilon: number;
  /** Critical load threshold below which Σw(C) → 0 */
  readonly criticalLoadThreshold: number;
  /** Default Top-K value */
  readonly defaultTopK: number;
  /** Maximum propagation depth to explore */
  readonly maxPropagationDepth: number;
}

/** Default RCA engine options. */
export const DEFAULT_RCA_OPTIONS: RCAEngineOptions = {
  pruneEpsilon: 0.001,
  criticalLoadThreshold: 0.7,
  defaultTopK: 5,
  maxPropagationDepth: 10,
};

/** Mapping from service ID to its time series metrics. */
export type MetricMap = ReadonlyMap<string, readonly TimeSeries[]>;
