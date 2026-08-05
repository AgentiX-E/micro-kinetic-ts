/**
 * Internal types for causal direction inference.
 *
 * These extend the core interfaces with provider-specific data structures
 * used internally by the causal package implementations.
 *
 * @module causal/types
 */

import type {
  ConfidenceTier,
  CausalDirection,
  ServiceTiming,
} from '@agentix-e/micro-kinetic-core';

// ── Trace-specific Types ─────────────────────────────────

/**
 * Parsed span timing extracted from distributed tracing data.
 */
export interface SpanTiming {
  /** Service name (from span attribute). */
  readonly service: string;
  /** Earliest span start time for this service (Unix ms). */
  readonly earliestStartMs: number;
  /** Latest span start time for this service (Unix ms). */
  readonly latestStartMs: number;
  /** Earliest span end time for this service (Unix ms). */
  readonly earliestEndMs: number;
  /** Total number of spans for this service. */
  readonly spanCount: number;
  /** Number of error spans (status code ≥ 400). */
  readonly errorSpanCount: number;
  /** Parent service IDs observed calling this service. */
  readonly callers: readonly string[];
  /** Child service IDs observed being called by this service. */
  readonly callees: readonly string[];
}

// ── Log-specific Types ────────────────────────────────────

/**
 * Anomaly inflection point extracted from structured logs.
 */
export interface LogAnomalyPoint {
  /** Service that logged the anomaly. */
  readonly service: string;
  /** Timestamp of the first anomalous log entry (Unix ms). */
  readonly firstAnomalyMs: number;
  /** Timestamp of the last normal log entry (Unix ms). */
  readonly lastNormalMs: number;
  /** Log template ID or pattern identifier. */
  readonly templateId: string;
  /** Number of anomalous log entries observed. */
  readonly anomalyCount: number;
  /** Number of normal log entries observed. */
  readonly normalCount: number;
}

// ── Granger-specific Types ────────────────────────────────

/**
 * Granger causality test configuration.
 */
export interface GrangerConfig {
  /** Maximum lag order to test. */
  readonly maxLag: number;
  /** Significance threshold (p-value). */
  readonly alpha: number;
  /** Minimum time-series length for valid test. */
  readonly minSeriesLength: number;
  /** Minimum number of observations per lag. */
  readonly minObservations: number;
}

/** Default Granger test configuration. */
export const DEFAULT_GRANGER_CONFIG: GrangerConfig = {
  maxLag: 5,
  alpha: 0.05,
  minSeriesLength: 30,
  minObservations: 10,
};

/**
 * Result of a single Granger causality test.
 */
export interface GrangerTestResult {
  /** Source service (potential cause). */
  readonly source: string;
  /** Target service (potential effect). */
  readonly target: string;
  /** Lag at which the test was most significant. */
  readonly bestLag: number;
  /** F-statistic at best lag. */
  readonly fStatistic: number;
  /** P-value at best lag. */
  readonly pValue: number;
  /** Whether causality is statistically significant at α = 0.05. */
  readonly significant: boolean;
}

// ── Fusion Types ──────────────────────────────────────────

/**
 * Provider result with tier for fusion.
 */
export interface ProviderTierResult {
  /** Provider identifier. */
  readonly providerId: string;
  /** Confidence tier. */
  readonly tier: ConfidenceTier;
  /** Inferred directions. */
  readonly directions: readonly CausalDirection[];
  /** Overall confidence for this tier. */
  readonly confidence: number;
}

/**
 * Fusion orchestration result.
 */
export interface FusionResult {
  /** Final resolved directions. */
  readonly directions: readonly CausalDirection[];
  /** Which tier provided the accepted result. */
  readonly acceptedTier: ConfidenceTier;
  /** Number of edges resolved. */
  readonly edgesResolved: number;
  /** Total edges requested. */
  readonly edgesTotal: number;
  /** Coverage fraction (resolved / total). */
  readonly coverage: number;
  /** Provider tier results (for diagnostics). */
  readonly tierResults: readonly ProviderTierResult[];
}

// ── Service Timing Extraction ─────────────────────────────

/**
 * Service-level timing extracted from traces or logs.
 *
 * Enriched version of ServiceTiming with temporal ordering
 * information for pair-wise comparison.
 */
export interface ExtractedServiceTiming extends ServiceTiming {
  /** Mean inter-event interval for anomaly events (ms). */
  readonly meanAnomalyInterval: number;
  /** Whether timing data quality is sufficient for reliable inference. */
  readonly dataQuality: 'high' | 'medium' | 'low' | 'insufficient';
}
