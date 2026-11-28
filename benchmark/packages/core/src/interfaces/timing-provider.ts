/**
 * Timing-based causal direction provider interface.
 *
 * In multi-service RCA, the critical ambiguity is "which way does the fault
 * propagate?" — A → B or B → A? Three independent signal sources can resolve
 * this, each with different cost and accuracy characteristics:
 *
 *   Priority 1 — Trace Timing (millisecond precision):
 *     Distributed tracing spans carry parent-child relationships and precise
 *     wall-clock timestamps. If span_start(A) < span_start(B) in the same
 *     trace, A calls B (or at least A's processing started earlier).
 *     Cost: zero (data already available). Accuracy: highest.
 *
 *   Priority 2 — Log Timing (millisecond precision):
 *     Structured logs carry timestamps with millisecond granularity. If
 *     service A logs an error at T and service B starts logging errors at
 *     T + Δt, the fault likely propagated A → B.
 *     Cost: zero (data already available). Accuracy: high, but requires
 *     log parsing and anomaly inflection point detection.
 *
 *   Priority 3 — Granger Causality (statistical, second-level):
 *     Granger causality tests whether past values of X provide statistically
 *     significant information about future values of Y. If metric_A
 *     Granger-causes metric_B with p < 0.05, direction is A → B.
 *     Cost: zero (pure statistics). Accuracy: moderate, requires
 *     stationarity assumptions and sufficient time-series length.
 *
 *   Fallback — Static Topology (zero cost, lowest precision):
 *     Pre-configured service dependency direction (YAML, K8s manifests).
 *     Cost: zero. Accuracy: depends on configuration quality.
 *
 *   LLM Fallback (rare, cost-controlled):
 *     If no temporal signal, no Granger significance, and no static config
 *     resolves direction, LLM infers semantic direction from service names
 *     (e.g., "order-service" likely calls "payment-service").
 *     Cost: ~$0.001/query, capped at $0.02/day.
 *
 * Providers implement a strict confidence tier. The CausalDirectionFusion
 * orchestrator selects the highest-confidence available result.
 *
 * @module interfaces/timing-provider
 */

import type { CallEdge, ServiceId } from '../types/graph.js';

// ── Confidence Tiers ─────────────────────────────────────

/**
 * Confidence tier for causal direction inference.
 *
 * Higher tiers indicate stronger evidence. The fusion orchestrator
 * selects the highest-tier available result.
 */
export type ConfidenceTier =
  | 'trace' // Span parent-child = definitive
  | 'log' // Timestamped error logs = very strong
  | 'granger' // Granger causality test = statistically significant
  | 'static' // Pre-configured topology = structurally informed
  | 'llm' // Semantic inference = fallback only
  | 'none'; // No direction can be inferred

// ── Causal Direction Result ──────────────────────────────

/**
 * Result of causal direction inference for a pair of services or edges.
 */
export interface CausalDirection {
  /** Source service (potential root cause). */
  readonly source: ServiceId;
  /** Target service (affected downstream). */
  readonly target: ServiceId;
  /** Confidence tier of this inference. */
  readonly tier: ConfidenceTier;
  /** Normalized confidence (0-1). */
  readonly confidence: number;
  /** Human-readable reasoning for audit/debugging. */
  readonly reasoning: string;
  /** Provider that produced this result. */
  readonly provider: string;
}

/**
 * Batch result: direction inference for multiple service pairs.
 */
export interface BatchCausalDirection {
  /** Per-edge direction inferences. */
  readonly directions: readonly CausalDirection[];
  /** Aggregated confidence score (0-1). */
  readonly aggregateConfidence: number;
  /** Fraction of edges with resolved direction. */
  readonly coverage: number;
  /** Tier breakdown counts. */
  readonly tierBreakdown: Readonly<Record<ConfidenceTier, number>>;
}

// ── Timing Source Interface ──────────────────────────────

/**
 * A timing source provides start/end timestamps for a service in a given
 * incident context. Used by trace-based and log-based providers to
 * determine temporal ordering.
 */
export interface ServiceTiming {
  /** Service identifier. */
  readonly serviceId: ServiceId;
  /** Earliest observed anomaly timestamp (Unix ms), or null if none. */
  readonly earliestAnomalyMs: number | null;
  /** Latest observed normal timestamp (Unix ms), or null if none. */
  readonly latestNormalMs: number | null;
  /** Total number of anomalous events observed. */
  readonly anomalyCount: number;
  /** Total number of normal events observed. */
  readonly normalCount: number;
}

/**
 * Context for temporal analysis.
 */
export interface TemporalContext {
  /** Known or suspected anomaly injection time (Unix ms). */
  readonly injectionTime: number | null;
  /** Service timings collected from all available sources. */
  readonly timings: ReadonlyMap<ServiceId, ServiceTiming>;
  /** Pre-configured edge direction hints (source → target directions). */
  readonly staticDirections?: ReadonlyMap<string, CausalDirection>;
  /** Additional metadata passed through to providers. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Provider Interface ───────────────────────────────────

/**
 * Metadata about a timing provider.
 */
export interface TimingProviderMeta {
  /** Unique provider identifier. */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string;
  /** Confidence tier this provider produces. */
  readonly tier: ConfidenceTier;
  /** Whether this provider is always available or conditional. */
  readonly availability: 'always' | 'conditional';
}

/**
 * Causal direction timing provider.
 *
 * Each implementation infers fault propagation direction from a specific
 * temporal signal source. Providers are ordered by confidence tier;
 * the CausalDirectionFusion orchestrator queries them in priority order.
 */
export interface ITimingProvider {
  /** Provider metadata. */
  readonly meta: TimingProviderMeta;

  /**
   * Infer causal direction for a set of service edges.
   *
   * @param edges - Service call edges to resolve direction for.
   * @param context - Temporal context (timings, injection time, static hints).
   * @returns Resolved directions for edges that could be inferred.
   */
  inferDirection(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<readonly CausalDirection[]>;

  /**
   * Check whether this provider has enough data to produce meaningful results.
   *
   * @param context - Current temporal context.
   * @returns True if enough data is available.
   */
  canInfer(context: TemporalContext): Promise<boolean>;

  /**
   * Estimate the confidence of this provider for the given context.
   * Used by the fusion orchestrator to decide whether to fall through
   * to the next provider.
   *
   * @param context - Current temporal context.
   * @returns Confidence estimate (0-1), or 0 if no data.
   */
  estimateConfidence(context: TemporalContext): Promise<number>;
}

// ── Fusion Orchestrator ──────────────────────────────────

/**
 * Provider registry for the causal direction fusion pipeline.
 *
 * Holds ordered array of ITimingProvider instances in priority order.
 * The fusion orchestrator queries each provider sequentially, stopping
 * at the first provider that returns results with acceptable confidence.
 */
export interface ITimingProviderRegistry {
  /** All registered providers in priority order (highest tier first). */
  readonly providers: readonly ITimingProvider[];

  /**
   * Register a timing provider at the appropriate position based on tier.
   */
  register(provider: ITimingProvider): void;

  /**
   * Remove a provider by ID.
   */
  unregister(providerId: string): void;

  /**
   * Get all providers that are currently available.
   */
  getAvailable(context: TemporalContext): Promise<readonly ITimingProvider[]>;
}

/**
 * Configuration for the causal direction fusion.
 */
export interface CausalDirectionConfig {
  /** Minimum confidence for accepting a direction inference. */
  readonly minConfidence: number;
  /** Minimum coverage fraction before falling through to next tier. */
  readonly minCoverage: number;
  /** Whether LLM fallback is enabled (cost-controlled). */
  readonly llmFallbackEnabled: boolean;
  /** Maximum daily LLM inference budget in USD. */
  readonly llmDailyBudgetUSD: number;
  /** Maximum edge pairs to send per LLM inference batch. */
  readonly llmBatchSize: number;
}

/** Default causal direction config. */
export const DEFAULT_CAUSAL_DIRECTION_CONFIG: CausalDirectionConfig = {
  minConfidence: 0.5,
  minCoverage: 0.8,
  llmFallbackEnabled: true,
  llmDailyBudgetUSD: 0.02,
  llmBatchSize: 20,
};
