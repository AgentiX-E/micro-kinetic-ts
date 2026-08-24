/**
 * RCA Engine interface — root cause analysis using collision tree pruning.
 *
 * This is the primary AIOps engine, implementing the mapping from
 * Deng Yu's collision tree model to fault propagation graph pruning.
 *
 * The key insight: cycles in fault propagation graphs correspond to
 * closed-loop collisions in the BBGKY hierarchy. Deng Yu proved that
 * in the rarefied gas limit (low system load), the total contribution
 * of closed loops vanishes. This allows us to prune cycles and solve
 * RCA in polynomial time on the resulting tree.
 *
 * @module interfaces/rca-engine
 */

import type { MetricMap, RootCauseResult } from '../types/faults.js';
import type { FaultPropagationGraph, ServiceCallGraph } from '../types/graph.js';

/**
 * Core RCA engine interface.
 *
 * Implementations:
 * - CollisionTreeRCAEngine (tree package)
 * - TODO: GNN-based RCA engine
 * - TODO: LLM-assisted RCA engine
 */
/**
 * Optional inputs to {@link IRCAEngine.buildFaultGraph}.
 *
 * These carry case-level temporal context that is independent of the call
 * graph and metric series — most importantly the fault injection time, which
 * anchors the causal source/symptom onset ordering.
 */
/**
 * A single log line, reduced to the minimal fields the RCA engine needs.
 *
 * The core layer must not depend on any benchmark package's log type, so this
 * is a deliberately minimal structural contract: a timestamp, the emitting
 * service, and the severity level (compared as a string against 'ERROR' /
 * 'FATAL'). The `message` text is intentionally NOT carried — the current log
 * signal only uses error/fatal volume, so pulling the full message through
 * the engine would waste memory on RE2/RE3 cases with hundreds of thousands
 * of log lines.
 */
export interface FaultLogEntry {
  /** Log emission time in Unix milliseconds. */
  readonly timestamp: number;
  /** The service that emitted the log. */
  readonly service: string;
  /** Severity level (e.g. 'INFO', 'WARN', 'ERROR', 'FATAL'). */
  readonly level: string;
  /**
   * Whether the log message carries a stack-trace signature (a code-level
   * fault marker: `at ...(file:line)`, `Caused by:`, an exception class name,
   * or a `Traceback`/`stack trace` header). When true, the log signal treats
   * this line as evidence of a code-level fault rather than a resource/network
   * cascade. Optional — absent means "unknown" (treated as not a stack trace).
   */
  readonly isStackTrace?: boolean;
  /**
   * Whether the log line is a SELF-CAUSED logic exception (a programming error
   * such as `NullPointerException`, `IllegalArgumentException`,
   * `ConcurrentModificationException`, `AttributeError`, …), as opposed to a
   * PROPAGATED connectivity exception (`ConnectionException`,
   * `SocketTimeoutException`, `MongoSocketException`, …) or a non-error line.
   *
   * A logic exception indicates the emitting service has an internal bug, so it
   * is a SOURCE signal; a connectivity exception is a downstream cascade and is
   * noise for source identification. The log signal therefore counts only logic
   * exceptions (benchmark #219: RE2 resource faults flood connectivity
   * exceptions in the SYMPTOM services, while RE3 code-level faults flood logic
   * exceptions in the SOURCE). Optional — absent means "not a logic exception".
   */
  readonly isLogicException?: boolean;
  /**
   * The simple class name of the DEEPEST exception in the message's `Caused by:`
   * chain (the root cause), or of the leading exception when there is no chain.
   *
   * This is the discriminative feature behind the log signal's `novelty` mode:
   * Spring's `HttpServerErrorException` is a non-discriminative HTTP *wrapper*
   * that every downstream symptom emits, while the actual fault signature is the
   * deepest `Caused by:` class (e.g. `IllegalArgumentException`), which is rare
   * and unique to the source. Optional — absent means "no exception detected".
   */
  readonly deepestExceptionClass?: string;
}

/**
 * A minimal trace span carried into the engine for the trace ranking signal.
 *
 * RCAEval RE2/RE3 `traces.csv` files can exceed 100K spans per case, so only a
 * COMPACT subset (ERROR spans, or a bounded sample) is passed through the
 * engine — never the full span history. `status === 'ERROR'` marks a span that
 * returned an error response code, which for a code-level fault (RE3) is the
 * SOURCE's own span failing, distinct from the OK spans of healthy services.
 */
export interface FaultTraceSpan {
  /** The service that executed the span. */
  readonly service: string;
  /** Span start time in Unix milliseconds (for post-injection filtering). */
  readonly startTime: number;
  /** Span status: 'OK' or 'ERROR'. */
  readonly status: 'OK' | 'ERROR';
  /** Span duration in milliseconds (reserved for the latency-instability signal). */
  readonly duration?: number;
}

/**
 * Optional inputs to {@link IRCAEngine.buildFaultGraph}.
 *
 * These carry case-level temporal context that is independent of the call
 * graph and metric series — most importantly the fault injection time, which
 * anchors the causal source/symptom onset ordering, and the raw service logs,
 * which drive the log-volume source signal.
 */
export interface BuildFaultGraphOptions {
  /**
   * Fault injection time in Unix milliseconds. `0` or `undefined` means
   * "unknown" and disables the temporal onset signal.
   */
  readonly injectTimeMs?: number;
  /**
   * Raw service logs (RE2/RE3 cases). When present, the engine derives a
   * post-injection ERROR/FATAL volume score per service for the log signal.
   * Absent logs simply disable that signal (neutral for every service).
   */
  readonly logs?: ReadonlyArray<FaultLogEntry>;
  /**
   * Compact trace spans (RE2/RE3 cases) — ERROR spans only, or a bounded
   * sample. When present, the engine derives a post-injection ERROR-span count
   * score per service for the (opt-in) trace signal. Absent traces simply
   * disable that signal (neutral for every service).
   */
  readonly traces?: ReadonlyArray<FaultTraceSpan>;
}

export interface IRCAEngine {
  /**
   * Build a fault propagation graph from the service call graph
   * and time-series metrics. This annotates edges with propagation
   * probabilities derived from metric anomaly correlations.
   *
   * @param callGraph - Service call graph with topology
   * @param metrics - Time series metrics keyed by service ID
   * @param options - Optional case-level context (e.g. fault injection time)
   */
  buildFaultGraph(
    callGraph: ServiceCallGraph,
    metrics: MetricMap,
    options?: BuildFaultGraphOptions,
  ): FaultPropagationGraph;

  /**
   * Perform root cause analysis on the fault propagation graph.
   * Returns Top-K ranked root cause candidates.
   *
   * The algorithm:
   * 1. Detect all cycles (Johnson's algorithm)
   * 2. Compute cycle contributions w(C) = ∏ p(e)
   * 3. Prune cycles with w(C) < ε
   * 4. Perform tree-based RCA on the pruned acyclic graph
   */
  analyze(graph: FaultPropagationGraph, topK?: number): Promise<readonly RootCauseResult[]>;

  /**
   * Compute the upper bound on total cycle contribution
   * given the current system load.
   *
   * This implements the critical load theorem:
   * if systemLoad < λ_critical, then Σw(C) ≤ K×ε
   */
  getCycleContributionBound(graph: FaultPropagationGraph): number;
}

/**
 * Root cause ranker interface — scores and ranks root cause candidates.
 */
export interface IRootCauseRanker {
  /**
   * Rank root cause candidates by anomaly contribution score.
   * Uses bottom-up score propagation on the pruned tree.
   */
  rank(
    anomalyScores: ReadonlyMap<string, number>,
    propagationWeights: Float64Array,
    edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
    topK: number,
  ): ReadonlyMap<string, number>;
}
