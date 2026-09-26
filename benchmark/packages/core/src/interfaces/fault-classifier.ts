/**
 * Fault type classification interfaces.
 *
 * Defines the three-layer pyramid classifier contract:
 *   Layer 1 — Rule engine: deterministic regex-based fast path (~0.1ms)
 *   Layer 2 — Statistical analysis: time-series feature extraction (~5ms)
 *   Layer 3 — LLM agent: multi-modal semantic reasoning (~500ms, fallback only)
 *
 * Each layer implements IFaultClassifier. The PyramidFaultClassifier
 * orchestrator (in the kinetic umbrella) cascades through layers by
 * confidence threshold, invoking slower/more expensive layers only
 * when faster layers produce low-confidence results.
 *
 * @module interfaces/fault-classifier
 */

import type { ServiceCallGraph } from '../types/graph.js';
import type { TimeSeries } from '../types/time-series.js';

// ── Classification Rule ──────────────────────────────────

/**
 * A single classification rule for the regex-based rule engine.
 *
 * Rules are registered via DI, enabling production environments
 * to extend the classifier without modifying core code.
 */
export interface ClassificationRule {
  /** Regex pattern to match against metric names (case-insensitive). */
  readonly pattern: RegExp;
  /** Fault category label assigned when this rule matches. */
  readonly category: string;
  /** Priority — higher values are evaluated first. */
  readonly priority: number;
  /** Base confidence assigned by this rule alone (0-1). */
  readonly confidence: number;
  /** Human-readable description for audit/debugging. */
  readonly description: string;
}

// ── Classification Context ────────────────────────────────

/**
 * Context passed to classifiers for informed decision-making.
 */
export interface FaultClassifierContext {
  /** Service ID under analysis. */
  readonly serviceId: string;
  /** All available metric names in this service's time series. */
  readonly metricNames: readonly string[];
  /** Optional known fault injection type (during benchmark evaluation). */
  readonly hints?: Record<string, string>;
}

// ── Fault Type Hypothesis ─────────────────────────────────

/**
 * A fault type hypothesis produced by any classification layer.
 *
 * Each hypothesis includes a confidence score and the method
 * that produced it, enabling the pyramid orchestrator to
 * decide whether to escalate to the next layer.
 */
export interface FaultTypeHypothesis {
  /** Predicted fault category. */
  readonly category: string;
  /** Confidence score (0-1). */
  readonly confidence: number;
  /** Evidence supporting this hypothesis (for explainability). */
  readonly evidence: readonly string[];
  /** Which layer produced this hypothesis. */
  readonly method: 'rule' | 'statistical' | 'llm';
  /** Fault severity level. */
  readonly severity: 'critical' | 'major' | 'minor' | 'warning' | 'info';
}

// ── Core Interface ────────────────────────────────────────

/**
 * Fault type classifier interface.
 *
 * All three layers (rule engine, statistical analyzer, LLM agent)
 * implement this contract. The PyramidFaultClassifier orchestrator
 * composes them into a cascading pipeline.
 */
export interface IFaultClassifier {
  /**
   * Classify fault type from time-series metrics.
   *
   * @param metricSeries - Time series data for the service under analysis.
   * @param context - Classification context (service ID, hints, etc.).
   * @returns Sorted array of hypotheses, best confidence first.
   */
  classify(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
  ): FaultTypeHypothesis[];

  /**
   * Get the classification method identifier.
   */
  readonly method: 'rule' | 'statistical' | 'llm';
}

// ── Statistical Analyzer — Specialized Interface ──────────

/**
 * Extended interface for Layer 2 (statistical analysis).
 *
 * Provides additional statistical feature extraction capabilities
 * beyond the basic IFaultClassifier contract.
 */
export interface IStatisticalAnalyzer extends IFaultClassifier {
  readonly method: 'statistical';

  /**
   * Compute statistical features from a time series.
   *
   * Returns a feature vector that can be used for downstream
   * classification or abnormally detection.
   */
  extractFeatures(series: TimeSeries): TimeSeriesFeatures;
}

/**
 * Statistical features extracted from a single time series.
 */
export interface TimeSeriesFeatures {
  /** Mean value across the full window. */
  readonly mean: number;
  /** Standard deviation. */
  readonly stddev: number;
  /** Variance. */
  readonly variance: number;
  /** Median value (50th percentile). */
  readonly median: number;
  /** Ratio of the last N values to the historical mean (drift detection). */
  readonly trendSlope: number;
  /** Coefficient of variation (stddev / mean, 0 if mean ≈ 0). */
  readonly coefficientOfVariation: number;
  /** Whether the series shows monotonic increase (memory leak pattern). */
  readonly isMonotonicIncreasing: boolean;
  /** Whether the series shows burst/spike pattern (disk/network pattern). */
  readonly hasBurst: boolean;
  /** Autocorrelation at lag-1 (periodicity detection). */
  readonly autocorrelationLag1: number;
}

// ── LLM Classifier — Specialized Interface ────────────────

/**
 * Extended interface for Layer 3 (LLM agent).
 *
 * Receives multi-modal context (metrics + logs + traces + topology)
 * plus prior hypotheses from lower layers for informed reasoning.
 */
export interface ILLMFaultClassifier extends IFaultClassifier {
  readonly method: 'llm';

  /**
   * Classify with full multi-modal context and prior hypotheses.
   *
   * @param metricSeries - Time series data.
   * @param context - Standard classifier context.
   * @param priorHypotheses - Results from Layer 1 and Layer 2.
   * @param logs - Optional log entries for semantic analysis.
   * @param traces - Optional trace spans for propagation analysis.
   * @param topology - Service call graph for topological reasoning.
   * @returns Refined hypotheses with LLM reasoning.
   */
  classifyWithContext(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
    priorHypotheses: readonly FaultTypeHypothesis[],
    logs?: ReadonlyArray<{
      readonly message: string;
      readonly level: string;
      readonly timestamp: number;
    }>,
    traces?: ReadonlyArray<{
      readonly service: string;
      readonly operationName: string;
      readonly duration: number;
      readonly status: string;
    }>,
    topology?: ServiceCallGraph,
  ): Promise<FaultTypeHypothesis[]>;
}
