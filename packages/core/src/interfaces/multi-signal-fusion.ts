/**
 * Multi-signal root cause analysis — unified architecture.
 *
 * Integrates three independent signal sources for root cause analysis:
 *
 *   Signal 1 — Trace Analysis (span tree):
 *     Precise call relationships from distributed tracing. Resolves the
 *     "who calls whom" ambiguity that metric-only methods cannot answer.
 *     Directly provides directional causality via span.parent → span.child.
 *
 *   Signal 2 — Metric Analysis (collision tree):
 *     Anomaly magnitude scoring via Deng Yu's collision tree theory + BARO
 *     inspired deviation scoring. Captures "how severely anomalous" each
 *     service is, but without directional certainty.
 *
 *   Signal 3 — Topology Analysis (service call graph):
 *     Known service dependency relationships from K8s/Istio/static config.
 *     Provides structural priors that constrain the search space.
 *
 * Fusion Layer:
 *   Combines signals with configurable weights. Supports three modes:
 *   - Static: user-defined weight vector (w_trace, w_metric, w_topology)
 *   - Heuristic: auto-tuning based on data characteristics (trace quality,
 *     metric variance, topology completeness)
 *   - LLM-guided: DeepSeek API optimizes weights based on deployment context
 *
 * Self-Learning:
 *   After each RCA event, accuracy is measured (known ground truth or
 *   operator feedback). Weights are updated online using gradient descent
 *   on the softmax-weighted signal fusion.
 *
 * @module interfaces/multi-signal-fusion
 */

import type { ServiceCallGraph } from '../types/graph.js';
import type { RootCauseResult } from '../types/faults.js';
import type { TimeSeries } from '../types/time-series.js';

// ── Signal Result Types ──────────────────────────────────

/** Result from a single signal analysis. */
export interface SignalResult {
  /** Signal source identifier. */
  readonly signal: 'trace' | 'metric' | 'topology';
  /** Ranked root cause candidates from this signal. */
  readonly candidates: readonly RootCauseResult[];
  /** Signal-internal confidence (0-1). */
  readonly confidence: number;
  /** Metadata for diagnostics and self-learning. */
  readonly metadata: SignalMetadata;
}

/** Per-signal metadata for diagnostics and weight optimization. */
export interface SignalMetadata {
  /** Number of candidate root causes produced. */
  readonly candidateCount: number;
  /** Average candidate confidence from this signal. */
  readonly avgConfidence: number;
  /** Data quality indicators. */
  readonly quality: {
    /** Trace coverage (0-1): what fraction of calls have trace data. */
    readonly traceCoverage: number;
    /** Metric completeness (0-1): what fraction of services have metric data. */
    readonly metricCompleteness: number;
    /** Topology match rate (0-1): how many topology edges match actual data. */
    readonly topologyMatch: number;
  };
}

// ── Signal Provider Interface ────────────────────────────

/**
 * A signal provider analyzes one data modality and produces root cause
 * candidates with confidence scores.
 *
 * Implementations:
 *   - TraceSignalProvider: analyzes span trees from distributed tracing
 *   - MetricSignalProvider: collision tree analysis on metric time series
 *   - TopologySignalProvider: structural analysis on service call graph
 */
export interface ISignalProvider {
  /** Signal type identifier. */
  readonly signalType: SignalResult['signal'];

  /**
   * Analyze this signal and produce root cause candidates.
   *
   * @param context - Available data (traces, metrics, call graph)
   * @returns Ranked candidates with signal-specific confidence
   */
  analyze(context: SignalAnalysisContext): Promise<SignalResult>;

  /**
   * Estimate the quality of this signal for the given context.
   * Used by the heuristic fusion mode to auto-weight signals.
   */
  estimateQuality(context: SignalAnalysisContext): Promise<SignalQuality>;
}

// ── Analysis Context ─────────────────────────────────────

/** Data available for multi-signal analysis. */
export interface SignalAnalysisContext {
  /** Service call graph (topology signal). */
  readonly callGraph?: ServiceCallGraph;
  /** Metric time series per service. */
  readonly metrics?: ReadonlyMap<string, readonly TimeSeries[]>;
  /** Raw trace spans (trace signal). */
  readonly traceSpans?: readonly TraceSpan[];
  /** Timestamp of the suspected anomaly injection. */
  readonly anomalyTime?: number;
}

/** Quality estimate for a signal source. */
export interface SignalQuality {
  /** Overall quality score (0-1). */
  readonly score: number;
  /** Reason for the quality estimate (human-readable). */
  readonly reason: string;
}

// ── Trace Data Types ─────────────────────────────────────

/**
 * A single trace span representing one service invocation.
 *
 * Matches OpenTelemetry/OpenTracing span model and RCAEval's traces.csv
 * format.
 */
export interface TraceSpan {
  /** Unique trace identifier grouping related spans. */
  readonly traceId: string;
  /** This span's unique identifier. */
  readonly spanId: string;
  /** Parent span ID (empty for root spans). */
  readonly parentSpanId: string;
  /** Service that executed this span. */
  readonly service: string;
  /** Operation name (e.g., HTTP GET /users). */
  readonly operation: string;
  /** Span duration in milliseconds. */
  readonly duration: number;
  /** HTTP/gRPC status code. */
  readonly statusCode: number;
  /** Whether this span represents an error. */
  readonly isError: boolean;
  /** Start timestamp (Unix ms). */
  readonly startTime: number;
}

// ── Fusion Configuration ─────────────────────────────────

/**
 * Fusion weight vector. Each weight ∈ [0, 1], sum may exceed 1
 * (normalized internally via softmax).
 */
export interface FusionWeights {
  readonly trace: number;
  readonly metric: number;
  readonly topology: number;
}

/**
 * Fusion mode: how weights are determined.
 */
export type FusionMode =
  | { type: 'static'; weights: FusionWeights }
  | { type: 'heuristic' }
  | { type: 'llm'; model: string; apiKey: string }
  | { type: 'selfLearning'; learningRate: number };

/**
 * Configuration for the multi-signal fusion engine.
 */
export interface MultiSignalConfig {
  /** Fusion mode and parameters. */
  readonly mode: FusionMode;
  /** Minimum confidence for a candidate to be included. */
  readonly confidenceThreshold: number;
  /** Maximum number of fused candidates to return. */
  readonly maxCandidates: number;
}

/** Default fusion weights: equal weighting. */
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  trace: 1.0,
  metric: 1.0,
  topology: 1.0,
};

// ── Self-Learning State ──────────────────────────────────

/**
 * Self-learning history entry for weight optimization.
 * After each RCA event with known ground truth, the weights are
 * updated via gradient descent on the signal fusion loss.
 */
export interface LearningEntry {
  /** Timestamp of the learning event. */
  readonly timestamp: number;
  /** Weights used for this analysis. */
  readonly weights: FusionWeights;
  /** Signal results from each provider. */
  readonly signalResults: Record<string, SignalResult>;
  /** Top-k accuracy achieved (0-1). */
  readonly accuracy: number;
  /** Updated weights after this learning step. */
  readonly updatedWeights: FusionWeights;
}
