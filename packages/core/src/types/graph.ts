/**
 * Graph types for microservice topology and fault propagation modeling.
 *
 * These types model the "Collision Tree" concept from Deng Yu's kinetic theory:
 * - Service nodes ↔ particles in a gas
 * - Call edges ↔ collision interactions
 * - Propagation weights ↔ collision cross-sections
 * - Cycles ↔ closed-loop collisions (proven to vanish in rarefied gas limit)
 *
 * @module types/graph
 */

/** Unique identifier for a service node. */
export type ServiceId = string;

/** Edge type within a microservice call graph. */
export type EdgeType = 'REST' | 'gRPC' | 'MQ' | 'CALLBACK' | 'ASYNC';

/** A single service node in the call graph. */
export interface ServiceNode {
  /** Unique identifier, e.g. "checkoutservice" */
  readonly id: ServiceId;
  /** Human-readable name */
  readonly name: string;
  /** Kubernetes namespace or logical grouping */
  readonly namespace: string;
  /** Arbitrary key-value labels for categorization */
  readonly labels: Readonly<Record<string, string>>;
}

/** A directed call edge between two services. */
export interface CallEdge {
  /** Source service ID */
  readonly from: ServiceId;
  /** Target service ID */
  readonly to: ServiceId;
  /** Protocol/transport type */
  readonly type: EdgeType;
  /** Call rate in calls per minute */
  readonly callRate: number;
  /** P99 latency in milliseconds */
  readonly p99Latency: number;
  /** Error rate (0-1) */
  readonly errorRate: number;
}

/** The input service call graph (pre-analysis). */
export interface ServiceCallGraph {
  /** All service nodes, keyed by ID */
  readonly nodes: ReadonlyMap<ServiceId, ServiceNode>;
  /** All directed call edges */
  readonly edges: readonly CallEdge[];
  /** Normalized system load (0-1), used for load threshold theorem */
  readonly systemLoad: number;
}

/** A detected directed cycle in the propagation graph. */
export interface DetectedCycle {
  /** Ordered list of node IDs forming the cycle */
  readonly nodePath: readonly ServiceId[];
  /**
   * Collision contribution weight: w(C) = ∏_{e∈C} propagationWeight(e)
   * Maps to Deng Yu's cycle contribution in the collision tree expansion.
   */
  readonly contribution: number;
  /** True if contribution exceeds the prune threshold */
  readonly significant: boolean;
}

/**
 * Fault propagation graph — the core data structure for collision tree RCA.
 *
 * This is built from a ServiceCallGraph by annotating edges with
 * propagation probabilities derived from metric anomalies.
 */
export interface FaultPropagationGraph {
  /** Underlying service call graph */
  readonly callGraph: ServiceCallGraph;
  /** Flattened propagation weights array, indexed by edge order */
  readonly propagationWeights: Float64Array;
  /** Per-node anomaly scores (0-1, where 1 = fully anomalous) */
  readonly anomalyScores: ReadonlyMap<ServiceId, number>;
  /**
   * Per-node anomaly ONSET indices — the earliest data-point index (in the
   * service's own time series) where its metric deviated from normal. Used
   * as a dataset-agnostic causality signal: the fault source's anomaly onset
   * precedes its downstream neighbours'. Derived purely from the time series
   * (change-point detection), never from dataset metadata such as inject_time.
   */
  readonly anomalyOnsetTimes: ReadonlyMap<ServiceId, number>;
  /**
   * Per-node dominant metric — the metric that actually drove the node's
   * anomaly score (highest feature-weighted deviation). Used by diagnostics
   * to surface the TRUE anomaly driver rather than a metric picked by a
   * separate ratio heuristic (which may point at an idle metric the guards
   * already skipped). Optional: it is a diagnostic convenience, not a ranking
   * input, so engines may omit it.
   */
  readonly dominantMetrics?: ReadonlyMap<
    ServiceId,
    {
      readonly label: string;
      readonly head: number[];
      readonly tail: number[];
      /** Labels of metrics discarded by the transient-spike guard. */
      readonly transientSkipped: string[];
      /**
       * Raw feature-score decomposition (deviation / trend / cv / burst /
       * riseRatio / dropRatio / baselineMean) — a diagnostic for why one
       * metric out-ranked another. Optional: diagnostic-only, not a ranking
       * input.
       */
      readonly breakdown?: {
        readonly deviation: number;
        readonly trend: number;
        readonly cv: number;
        readonly burst: number;
        readonly riseRatio: number;
        readonly dropRatio: number;
        readonly baselineMean: number;
      };
    }
  >;
  /**
   * Fault injection time in Unix milliseconds, when known.
   *
   * This is the temporal anchor for the causal root-cause signal: the fault
   * source's metric deviates AT (or immediately after) this instant, while
   * symptoms deviate LATER as the disturbance propagates. It is derived from
   * the benchmark case's `inject_time` (analogous to the incident start time
   * an operator observes from alerting), NOT from the ground-truth service id.
   * `0` or `undefined` means "unknown" — the temporal signal must be disabled.
   */
  readonly injectTimeMs?: number;
  /**
   * Per-node onset DELAY in milliseconds — how long after `injectTimeMs` the
   * service's dominant metric first deviated from its PRE-INJECT baseline.
   *
   * This replaces the old index-based `anomalyOnsetTimes` as the temporal
   * causality signal: anchoring the baseline to the pre-injection window (a
   * clean, fault-free segment) makes the source/symptom ordering far more
   * reliable than a self-derived baseline contaminated by the fault itself.
   * `-1` (or absent) means "onset undetermined" — the service is treated as
   * temporally neutral (no earliness reward, no lateness penalty).
   */
  readonly postInjectOnsetDelays?: ReadonlyMap<ServiceId, number>;
  /** All detected cycles before pruning */
  readonly detectedCycles: readonly DetectedCycle[];
  /** Sum of all cycle contributions w(C) */
  readonly totalCycleContribution: number;
  /** Threshold ε below which cycle contributions are pruned */
  readonly pruneThreshold: number;
  /**
   * Collision-enhanced fault energy per service (Boltzmann Q(f,f) aggregation).
   *
   * Each entry maps to a collision result containing:
   * - totalEnergy: combined local + collision gain ∈ [0, 1]
   * - collisionType: chain | fan-in | bottleneck | cycle
   * - collisionGain: Boltzmann Q(f,f) value ∈ [0, 1]
   * - ratioContrib: collisionGain / (local + collisionGain) — the fraction of
   *   a node's fault energy inherited from upstream. A source ≈ 0, a fan-in
   *   symptom → 1. Feeds the (opt-in) collisionWeight ranking signal.
   *
   * When present, this replaces raw anomalyScores as the primary energy
   * source for root cause ranking.
   */
  readonly collisionEnergy?: ReadonlyMap<
    ServiceId,
    {
      readonly totalEnergy: number;
      readonly collisionType: string;
      readonly collisionGain: number;
      readonly ratioContrib: number;
    }
  >;
  /**
   * Per-service log signal score (0-1) — the count of ERROR/FATAL log lines
   * emitted at/after the fault injection time, normalised by the maximum
   * count (the top erroring service scores 1, zero-error services 0). Targets
   * code-level faults (stack traces) that metric-shape signals cannot see.
   * Optional: absent when the case carried no error logs. Feeds the (opt-in)
   * logWeight ranking signal.
   */
  readonly logScores?: ReadonlyMap<ServiceId, number>;
  /**
   * Per-service topological-source score (0-1) — `1 − maxParentExplanation`,
   * where `maxParentExplanation` is the largest `propagationWeight(p→v) ×
   * anomaly(p)` over a node's upstream parents. A source (no strongly
   * anomalous parent) scores 1; a symptom (explained by a parent) scores low.
   * A pure structural signal, distinct from the nonlinear collision gain.
   * Feeds the (opt-in) topoWeight ranking signal.
   */
  readonly topoScores?: ReadonlyMap<ServiceId, number>;
}

/** A pruned edge record — documents why an edge was removed. */
export interface PrunedEdgeRecord {
  readonly from: ServiceId;
  readonly to: ServiceId;
  /** Which cycle caused this edge to be pruned */
  readonly cycleId: string;
  /** The cycle's contribution value */
  readonly cycleContribution: number;
  /** How far below threshold the contribution fell */
  readonly marginBelowThreshold: number;
}

/** Score for a node in the pruned tree during RCA traversal. */
export interface TreeNodeScore {
  readonly nodeId: ServiceId;
  /** The node's own anomaly score */
  readonly anomalyScore: number;
  /** Cumulative score from child propagation (weighted sum) */
  readonly childPropagationScore: number;
  /** Total RCA score = anomaly + child propagation */
  readonly totalScore: number;
  /** Tree depth (distance from farthest leaf) */
  readonly depth: number;
}

/**
 * Pruned fault propagation tree — result of collision tree pruning.
 *
 * After pruning, the graph is guaranteed to be acyclic (a tree),
 * enabling polynomial-time root cause search.
 */
export interface PrunedTree {
  /** All nodes with computed scores */
  readonly nodes: ReadonlyMap<ServiceId, TreeNodeScore>;
  /** Remaining (non-pruned) edges */
  readonly edges: readonly CallEdge[];
  /** Root cause scores, sorted descending */
  readonly rootCauseScores: ReadonlyMap<ServiceId, number>;
  /** Pruned edges with justification */
  readonly prunedEdges: readonly PrunedEdgeRecord[];
  /** Total number of cycles pruned */
  readonly cyclesPruned: number;
  /** Total cycle contribution removed */
  readonly contributionRemoved: number;
}
