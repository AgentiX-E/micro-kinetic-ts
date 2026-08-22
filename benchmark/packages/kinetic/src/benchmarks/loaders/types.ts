/**
 * Common benchmark interfaces for RCAEval, AIOps2025, and RCA100 datasets.
 *
 * These interfaces unify the three benchmark formats into a common
 * representation that the BenchmarkRunner can process uniformly.
 *
 * @module benchmarks/loaders/types
 */

import type { MetricMap, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';

// ── Common Benchmark Types ────────────────────────────────

/** Ground truth for a single benchmark case. */
export interface BenchmarkGroundTruth {
  /** The service ID that is the actual root cause. */
  readonly serviceId: string;
  /** The fault type that was injected. */
  readonly faultType: string;
  /** The metric that indicates the fault (if known). */
  readonly metric?: string;
  /** Optional 4-layer ground truth for RCA100 format. */
  readonly rca100Layers?: RCA100GroundTruthLayers;
}

/** 4-layer ground truth for RCA100. */
export interface RCA100GroundTruthLayers {
  /** Layer 1: Fault type category. */
  readonly faultType: string;
  /** Layer 2: Target entity (service/node). */
  readonly targetEntity: string;
  /** Layer 3: Causal chain of propagation. */
  readonly causalChain: readonly string[];
  /** Layer 4: Observability checkpoints. */
  readonly observabilityCheckpoints: readonly string[];
}

/** A single unified benchmark case. */
export interface BenchmarkCase {
  /** Unique case identifier within the dataset. */
  readonly id: string;
  /** Which benchmark dataset this belongs to. */
  readonly datasetName: 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3' | 'aiops2025' | 'rca100';
  /** The service call graph for this case. */
  readonly callGraph: ServiceCallGraph;
  /** Time-series metrics, keyed by service ID. */
  readonly metrics: MetricMap;
  /** Fault injection time as Unix timestamp (milliseconds). */
  readonly injectTime: number;
  /** Ground truth information. */
  readonly groundTruth: BenchmarkGroundTruth;
  /** Optional log entries (RE2, RE3, AIOps2025). */
  readonly logs?: ReadonlyArray<BenchmarkLogEntry>;
  /** Optional trace spans (RE2, RE3, AIOps2025). */
  readonly traces?: ReadonlyArray<BenchmarkTraceSpan>;
  /** Optional structured event records (RCA100). */
  readonly events?: ReadonlyArray<BenchmarkEvent>;
  /** Optional alert data (RCA100). */
  readonly alerts?: ReadonlyArray<BenchmarkAlert>;
  /** Optional topology graph in adjacency format (RCA100). */
  readonly topologyGraph?: Record<string, readonly string[]>;
}

/** Log entry within a benchmark case. */
export interface BenchmarkLogEntry {
  readonly timestamp: number;
  readonly service: string;
  readonly message: string;
  readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  /** Whether the message carries a stack-trace signature (code-level fault). */
  readonly isStackTrace?: boolean;
  /** Whether the message is a self-caused logic exception (source signal). */
  readonly isLogicException?: boolean;
  /** Simple class name of the deepest `Caused by:` exception (root cause). */
  readonly deepestExceptionClass?: string;
}

/** Trace span within a benchmark case. */
export interface BenchmarkTraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly service: string;
  readonly operationName: string;
  readonly startTime: number;
  readonly duration: number;
  readonly status: 'OK' | 'ERROR';
}

/** Structured alert event (RCA100 format). */
export interface BenchmarkEvent {
  readonly eventId: string;
  readonly timestamp: number;
  readonly service: string;
  readonly eventType: string;
  readonly severity: 'critical' | 'major' | 'minor' | 'warning' | 'info';
  readonly description: string;
  readonly tags: Readonly<Record<string, string>>;
}

/** Alert record for RCA100. */
export interface BenchmarkAlert {
  readonly alertId: string;
  readonly timestamp: number;
  readonly service: string;
  readonly alertName: string;
  readonly severity: 'critical' | 'major' | 'minor' | 'warning' | 'info';
  readonly value: number;
  readonly threshold: number;
}

// ── Suite Types ───────────────────────────────────────────

/** A collection of benchmark cases forming a suite. */
export interface BenchmarkSuite {
  /** Suite name (e.g., "rcaeval-re1", "aiops2025"). */
  readonly name: string;
  /** Individual benchmark cases. */
  readonly cases: readonly BenchmarkCase[];
  /** Total number of cases in the suite. */
  readonly totalCases: number;
}

// ── Dataset-Specific Raw Types ────────────────────────────

/** Raw RCAEval case directory structure. */
export interface RCAEvalCase {
  /** Case path on filesystem. */
  readonly casePath: string;
  /** Benchmark name (e.g., "OnlineBoutique"). */
  readonly benchmark: string;
  /** Service name. */
  readonly service: string;
  /** Fault type string (e.g., "CPU_HIGH"). */
  readonly fault: string;
  /** Instance number. */
  readonly instance: number;
  /** Metrics data: service_name → [{timestamp, value, metric_name}]. */
  readonly metrics: Record<
    string,
    ReadonlyArray<{
      readonly timestamp: number;
      readonly value: number;
      readonly metric_name: string;
    }>
  >;
  /** Fault injection time as Unix timestamp (seconds). */
  readonly injectTime: number;
  /** Log entries (RE2/RE3 only). */
  readonly logs?: ReadonlyArray<BenchmarkLogEntry>;
  /** Trace spans (RE2/RE3 only). */
  readonly traces?: ReadonlyArray<BenchmarkTraceSpan>;
  /** Ground truth: root cause service and metric. */
  readonly groundTruth: BenchmarkGroundTruth;
}

/** Raw AIOps2025 case structure. */
export interface AIOps2025Case {
  /** Case path on filesystem. */
  readonly casePath: string;
  /** Case identifier from directory name or metadata. */
  readonly caseId: string;
  /** Metrics data (from Prometheus). */
  readonly metrics: MetricMap;
  /** Log entries (from Filebeat). */
  readonly logs: ReadonlyArray<BenchmarkLogEntry>;
  /** Trace spans (from Jaeger). */
  readonly traces: ReadonlyArray<BenchmarkTraceSpan>;
  /** Service call graph. */
  readonly callGraph: ServiceCallGraph;
  /** Fault injection time. */
  readonly injectTime: number;
  /** Ground truth. */
  readonly groundTruth: BenchmarkGroundTruth;
  /** AIOps2025-specific label scores. */
  readonly labelScores?: AIOps2025LabelScores;
}

/** AIOps2025 competition label scores per case. */
export interface AIOps2025LabelScores {
  readonly locationAccuracy: number;
  readonly typeAccuracy: number;
  readonly explainability: number;
  readonly efficiency: number;
}

/** Raw RCA100 case structure. */
export interface RCA100Case {
  /** Case path on filesystem. */
  readonly casePath: string;
  /** Case identifier. */
  readonly caseId: string;
  /** Metrics data. */
  readonly metrics: MetricMap;
  /** Log entries. */
  readonly logs: ReadonlyArray<BenchmarkLogEntry>;
  /** Trace spans. */
  readonly traces: ReadonlyArray<BenchmarkTraceSpan>;
  /** Structured events. */
  readonly events: ReadonlyArray<BenchmarkEvent>;
  /** Alerts. */
  readonly alerts: ReadonlyArray<BenchmarkAlert>;
  /** Topology graph (service → downstream services). */
  readonly topology: Record<string, readonly string[]>;
  /** Service call graph. */
  readonly callGraph: ServiceCallGraph;
  /** Fault injection time. */
  readonly injectTime: number;
  /** 4-layer ground truth. */
  readonly groundTruth: BenchmarkGroundTruth;
}

/** RCAEval suite (RE1, RE2, or RE3). */
export interface RCAEvalSuite {
  /** Suite name. */
  readonly suiteName: 'RE1' | 'RE2' | 'RE3';
  /** All cases in this suite. */
  readonly cases: readonly RCAEvalCase[];
  /** Total cases. */
  readonly totalCases: number;
}

/** AIOps2025 suite. */
export interface AIOps2025Suite {
  readonly cases: readonly AIOps2025Case[];
  readonly totalCases: number;
}

/** RCA100 suite. */
export interface RCA100Suite {
  readonly cases: readonly RCA100Case[];
  readonly totalCases: number;
}
