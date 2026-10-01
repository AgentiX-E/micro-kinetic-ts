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
import type { FaultPropagationGraph, ServiceCallGraph, ServiceId } from '../types/graph.js';

/**
 * Core RCA engine interface.
 *
 * Implementations:
 * - CollisionTreeRCAEngine (tree package)
 * - TODO: GNN-based RCA engine
 * - TODO: LLM-assisted RCA engine
 */
/**
 * One edge's span duration before and after the injection, as measured BY THE CALLER.
 *
 * The continuous counterpart of {@link FaultFailedEdge}. That one counts FAILURES, so a
 * call that became slow but still succeeded is invisible to it — and so is a case where
 * no call failed at all, which is 70 of the 291 silent-source cases. Duration is what the
 * caller recorded about the callee, so it carries the same direction and exists exactly
 * where the counts are zero.
 *
 * Measured on FSE'26: a JVM memory-stress source's inbound rise is 3.574 at the median and
 * 14.79 at p90, against a ReplaceCode source's 0.976 — and ranking by this alone reaches
 * 33.3% on that block against a shipped 2.3%.
 */
export interface FaultEdgeLatency {
  /** The service that made the call (the caller of the edge). */
  readonly caller: ServiceId;
  /** The service the call was made against (the callee, which is credited). */
  readonly callee: ServiceId;
  /** Mean span duration in milliseconds BEFORE the injection. */
  readonly preMeanMs: number;
  /** Mean span duration in milliseconds AT or AFTER the injection. */
  readonly postMeanMs: number;
}

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
   * Whether the log line names a FRAMEWORK HTTP exception — Spring Web's
   * `HttpClientErrorException` / `HttpServerErrorException` (and their
   * `ResourceAccessException` / `RestClient*Exception` kin), the signature of a
   * fault-injection fault that makes the SOURCE's outgoing REST calls fail.
   *
   * Distinct from {@link isLogicException} (a programming error) and from a
   * propagated connectivity exception: an HTTP-status exception means the
   * emitting service observed a 4xx/5xx from a downstream dependency. On
   * FSE'26 this storms the SOURCE at 10–16× the victim rate, so it is a
   * source signal there — but only when counted separately from the business/
   * AMQP errors that victims flood. Optional — absent means "not a framework
   * HTTP exception".
   */
  readonly isHttpException?: boolean;
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
 * Per-service trace span activity, split by the fault injection instant.
 *
 * The trace-activity signal (a silent-source fault makes its SOURCE service
 * emit MORE spans after injection — a workload rise with no error/log
 * signature) needs only the pre/post span COUNTS per service, not the raw
 * span tree. Keeping counts instead of spans is the memory-safe contract: a
 * TrainTicket case carries 178K+ spans, but a per-service `{pre, post}` pair
 * collapses them to two integers per service (≈70 services).
 */
export interface TraceActivityCounts {
  /** Number of spans emitted BEFORE the fault injection time. */
  readonly pre: number;
  /** Number of spans emitted AT or AFTER the fault injection time. */
  readonly post: number;
}

/**
 * One caller → callee edge with its FAILED-call counts, measured separately in
 * the pre- and post-injection windows.
 *
 * This is the one evidence class that carries the DIRECTION of a fault. The log
 * signal credits the service that emits an error; this credits the service the
 * error was emitted ABOUT, because a callee that broke is what its callers
 * report. The two are inverses, which is why this is a distinct signal rather
 * than another log mode.
 *
 * `baseline` is a required field and is never folded into `failed`: an edge
 * that was already failing BEFORE the injection is a deployment property, so
 * only the rise over its own baseline is evidence of this fault. Merging the
 * two would make a permanently broken edge read as the fault's signature.
 */
export interface FaultFailedEdge {
  /** The service that made the calls (the caller of the edge). */
  readonly caller: ServiceId;
  /** The service the failed calls were made against (the callee). */
  readonly callee: ServiceId;
  /** Failed calls on this edge AT or AFTER the injection time. */
  readonly failed: number;
  /** Failed calls on the SAME edge before the injection time. */
  readonly baseline: number;
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
   * Per-service trace span activity (pre/post fault-injection counts). Drives
   * the trace-activity signal: a silent-source fault (RCAEval RE3, e.g.
   * TrainTicket's `ts-auth-service` "wrong value" fault) emits no exception
   * and no error span, only a mild workload rise, so its span count RISES
   * after injection while every other service's stays flat or falls. Absent
   * counts disable that signal (neutral for every service).
   */
  readonly traceActivity?: ReadonlyMap<ServiceId, TraceActivityCounts>;
  /**
   * Per-edge failed-call counts (the callee each failed call was made
   * against). Drives the failed-edge-direction signal: a fault's victims are
   * the CALLEES their callers' calls failed against, so the service that owns
   * those failures is the source, not whoever logged the error. Absent edges
   * disable that signal (neutral for every service).
   *
   * Edges naming a service that is not in the call graph are ignored by the
   * signal: the engine can only rank nodes it has metrics for, so a
   * trace-only service (a load generator, a data-plane pod) must not enter the
   * normalisation either.
   */
  readonly failedTraceEdges?: ReadonlyArray<FaultFailedEdge>;
  /**
   * Per-edge span latency before and after the injection, as the CALLER
   * measured it. Drives the latency-rise signal — the continuous counterpart of
   * `failedTraceEdges`, which counts failures and is therefore blind to a call
   * that became slow but still succeeded.
   *
   * Absent means "not recorded", never "nothing got slower": the converter
   * writes the key only when at least one edge has a usable measurement on both
   * sides, and the loader maps an empty list to `undefined` for the same
   * reason. Edges naming a service outside the call graph are ignored by the
   * signal, so a trace-only service cannot enter its normalisation either.
   */
  readonly edgeLatency?: ReadonlyArray<FaultEdgeLatency>;
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
