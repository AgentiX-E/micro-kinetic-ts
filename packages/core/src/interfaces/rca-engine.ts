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
export interface BuildFaultGraphOptions {
  /**
   * Fault injection time in Unix milliseconds. `0` or `undefined` means
   * "unknown" and disables the temporal onset signal.
   */
  readonly injectTimeMs?: number;
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
