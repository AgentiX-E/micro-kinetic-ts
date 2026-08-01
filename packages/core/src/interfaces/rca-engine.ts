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

import type {
  FaultPropagationGraph,
  ServiceCallGraph,
} from '../types/graph.js';
import type {
  MetricMap,
  RCAEngineOptions,
  RootCauseResult,
} from '../types/faults.js';

/**
 * Core RCA engine interface.
 *
 * Implementations:
 * - CollisionTreeRCAEngine (tree package)
 * - TODO: GNN-based RCA engine
 * - TODO: LLM-assisted RCA engine
 */
export interface IRCAEngine {
  /**
   * Build a fault propagation graph from the service call graph
   * and time-series metrics. This annotates edges with propagation
   * probabilities derived from metric anomaly correlations.
   */
  buildFaultGraph(
    callGraph: ServiceCallGraph,
    metrics: MetricMap,
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
  analyze(
    graph: FaultPropagationGraph,
    topK?: number,
  ): Promise<readonly RootCauseResult[]>;

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
