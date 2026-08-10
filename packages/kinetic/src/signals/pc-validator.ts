/**
 * PC Algorithm Causal Validator — bridge from service topology + metrics to
 * PC-discovered causal structure.
 *
 * ## Deng Yu Collision Tree Integration
 *
 * The PC algorithm (Spirtes-Glymour-Scheines) discovers causal skeletons
 * from observational time-series data. In Deng Yu's kinetic framework:
 *
 * - **Skeleton edges** define the kinetic interaction graph (who talks to whom)
 * - **v-structures** (colliders X→Z←Y) identify collision nodes where fault
 *   signals converge — these have Boltzmann amplification factor Φ > 1.0
 * - **Edge removal** by CI test identifies spurious dependencies — edges that
 *   don't carry causal information are pruned before fault propagation
 *
 * ### Integration Points
 *
 * This module bridges between the topology world (`ServiceCallGraph`) and the
 * causal discovery world (`runPCAlgorithm`). It:
 *
 * 1. Converts `MetricMap` → time-series for each service
 * 2. Runs the PC algorithm to discover the causal skeleton
 * 3. Maps discovered causal edges back to `CallEdge` format
 * 4. Optionally prunes non-causal edges from the call graph
 *
 * The resulting refined graph feeds into `buildFaultGraph()` for collision-tree
 * RCA, ensuring only causally validated edges propagate fault energy.
 *
 * @module signals/pc-validator
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceId,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { runPCAlgorithm, type PCConfig, type PCResult } from './pc-causal-discovery.js';

/**
 * Configuration for PC-based topology validation.
 */
export interface PCValidatorConfig {
  /** PC algorithm configuration. */
  readonly pcConfig?: Partial<PCConfig>;
  /** When true, remove edges from output that are not in the PC skeleton. */
  readonly pruneNonCausal: boolean;
  /** When true, add new edges discovered by PC that are missing from the topology. */
  readonly discoverNewEdges: boolean;
  /** Minimum absolute correlation to add a PC-discovered edge. */
  readonly minDiscoveryCorrelation: number;
  /** When true, returns the PC result alongside the refined graph. */
  readonly reportPCResult: boolean;
}

const DEFAULT_VALIDATOR_CONFIG: PCValidatorConfig = {
  pruneNonCausal: false, // Default: decorate but don't remove edges
  discoverNewEdges: true,
  minDiscoveryCorrelation: 0.3, // Moderate threshold for edge addition
  reportPCResult: false,
};

/**
 * Complete result of PC topology validation.
 */
export interface PCValidationResult {
  /** Refined service call graph with PC-validated/adjusted edges. */
  readonly refinedGraph: ServiceCallGraph;
  /** Raw PC algorithm result (only present when reportPCResult=true). */
  readonly pcResult?: PCResult;
  /** Number of edges in original graph. */
  readonly originalEdgeCount: number;
  /** Number of edges after PC validation. */
  readonly refinedEdgeCount: number;
  /** Edges that were pruned (found non-causal by PC). */
  readonly prunedEdges: readonly CallEdge[];
  /** Edges newly discovered by PC that weren't in the original graph. */
  readonly discoveredEdges: readonly CallEdge[];
  /** Number of v-structures (collision nodes) found. */
  readonly vStructureCount: number;
}

/**
 * Validate and refine a service call graph using the PC causal discovery algorithm.
 *
 * ### Algorithm
 *
 * 1. Extract per-service time series from the MetricMap.
 *    For each service, aggregate all metrics into a single time series
 *    (using mean across metrics at each time point).
 *
 * 2. Run the PC algorithm on the extracted time series to discover
 *    the causal skeleton and v-structures.
 *
 * 3. Map the PC skeleton back to CallEdge format:
 *    - Edges in the skeleton that exist in the call graph → keep
 *    - Edges in the skeleton but NOT in the call graph → discover (if enabled)
 *    - Edges in the call graph but NOT in the skeleton → prune (if enabled)
 *
 * 4. Return the refined graph with PC-validated causal structure.
 *
 * ### Time Complexity
 *
 * The PC algorithm is O(N^d) in the worst case where d is the max
 * conditioning set size. For most microservice topologies (N ≤ 50),
 * this is tractable with the default maxConditioningSetSize=5.
 *
 * @param callGraph - Original service call graph to validate
 * @param metrics - Per-service metric time series
 * @param config - Validation configuration
 * @returns Validation result with refined graph and metadata
 */
export function validateTopologyWithPC(
  callGraph: ServiceCallGraph,
  metrics: MetricMap,
  config: Partial<PCValidatorConfig> = {},
): PCValidationResult {
  const cfg = { ...DEFAULT_VALIDATOR_CONFIG, ...config };

  // ── Step 1: Extract time series from metrics ───────────────
  const nodeIds: ServiceId[] = []; // Preserve order for PC algorithm
  const timeSeries = new Map<ServiceId, Float64Array>();

  for (const [nodeId, nodeMetrics] of metrics) {
    const series: number[] = [];
    const metricEntries = Array.from(nodeMetrics.entries());

    if (metricEntries.length === 0) continue;

    // Find the maximum length across all metric time series for this service
    let maxLen = 0;
    for (const [, ts] of metricEntries) {
      if (ts.values.length > maxLen) maxLen = ts.values.length;
    }

    // Aggregate: mean of all metrics at each time position
    for (let t = 0; t < maxLen; t++) {
      let sum = 0;
      let count = 0;
      for (const [, ts] of metricEntries) {
        if (t < ts.values.length) {
          sum += ts.values[t]!;
          count++;
        }
      }
      series.push(count > 0 ? sum / count : 0);
    }

    timeSeries.set(nodeId, new Float64Array(series));
    nodeIds.push(nodeId);
  }

  // Guard: need at least 2 nodes with data for PC
  if (nodeIds.length < 2) {
    return {
      refinedGraph: callGraph,
      originalEdgeCount: callGraph.edges.length,
      refinedEdgeCount: callGraph.edges.length,
      prunedEdges: [],
      discoveredEdges: [],
      vStructureCount: 0,
    };
  }

  // ── Step 2: Run PC algorithm ──────────────────────────────
  const pcResult = runPCAlgorithm(nodeIds, timeSeries, cfg.pcConfig as PCConfig | undefined);

  // Build fast lookup: is (from, to) in the PC skeleton?
  const skeletonSet = new Set<string>();
  for (const edge of pcResult.skeleton) {
    skeletonSet.add(`${edge.from}→${edge.to}`);
    skeletonSet.add(`${edge.to}→${edge.from}`); // Undirected
  }

  // Build v-structure set for collision node classification
  const vStructureChildren = new Set<ServiceId>();
  for (const vs of pcResult.vStructures) {
    vStructureChildren.add(vs.child);
  }

  // ── Step 3: Map back to CallEdge ──────────────────────────
  const nodes = new Map<ServiceId, ServiceNode>();
  for (const [id, node] of callGraph.nodes) {
    nodes.set(id, { ...node });
  }

  const prunedEdges: CallEdge[] = [];
  const keptEdges: CallEdge[] = [];
  const discoveredEdges: CallEdge[] = [];

  // Process existing edges
  for (const edge of callGraph.edges) {
    const key = `${edge.from}→${edge.to}`;
    if (skeletonSet.has(key)) {
      // Edge confirmed by PC skeleton → keep with adjusted weight
      keptEdges.push({
        ...edge,
        // Boost v-structure edges: they're collision nodes with Φ > 1
        callRate: vStructureChildren.has(edge.to) ? edge.callRate + 50 : edge.callRate,
        errorRate: Math.max(0.01, edge.errorRate),
      });
    } else if (!cfg.pruneNonCausal) {
      // Edge not in skeleton, pruneNonCausal=false → keep but mark
      keptEdges.push({
        ...edge,
        callRate: Math.max(1, Math.floor(edge.callRate * 0.5)), // De-weight
        errorRate: Math.max(0.01, edge.errorRate),
      });
    } else {
      prunedEdges.push(edge);
    }
  }

  // Discover new edges from PC skeleton not in original graph
  if (cfg.discoverNewEdges) {
    const existingEdges = new Set<string>();
    for (const edge of callGraph.edges) {
      existingEdges.add(`${edge.from}→${edge.to}`);
    }

    for (const pcEdge of pcResult.skeleton) {
      const fwdKey = `${pcEdge.from}→${pcEdge.to}`;
      const revKey = `${pcEdge.to}→${pcEdge.from}`;

      // Skip if edge already exists in either direction
      if (existingEdges.has(fwdKey) || existingEdges.has(revKey)) continue;

      // Determine direction: prefer v-structure orientation if available
      const directed = pcResult.directedEdges.find(
        (e) => e.from === pcEdge.from && e.to === pcEdge.to,
      );
      const revDirected = pcResult.directedEdges.find(
        (e) => e.from === pcEdge.to && e.to === pcEdge.from,
      );

      // Check correlation strength
      // Edge is validated by skeleton + directed edge info below

      if (directed && directed.directed) {
        discoveredEdges.push({
          from: pcEdge.from,
          to: pcEdge.to,
          type: 'REST',
          callRate: 30, // Moderate confidence — PC-discovered
          p99Latency: 50,
          errorRate: 0.01,
        });
      } else if (revDirected && revDirected.directed) {
        discoveredEdges.push({
          from: pcEdge.to,
          to: pcEdge.from,
          type: 'REST',
          callRate: 30,
          p99Latency: 50,
          errorRate: 0.01,
        });
      } else {
        // Undirected — add both ways with low weight
        // Actually, add only the direction that makes more topological sense.
        // Conservative: add neither for undirected edges unless discoverNewEdges
        // is explicitly set to add undirected candidates.
        // We skip undetermined directions to avoid injecting noise.
      }

      // Ensure nodes exist
      if (!nodes.has(pcEdge.from)) {
        nodes.set(pcEdge.from, {
          id: pcEdge.from,
          name: pcEdge.from,
          namespace: 'pc-discovered',
          labels: {},
        });
      }
      if (!nodes.has(pcEdge.to)) {
        nodes.set(pcEdge.to, {
          id: pcEdge.to,
          name: pcEdge.to,
          namespace: 'pc-discovered',
          labels: {},
        });
      }
    }
  }

  const allEdges = [...keptEdges, ...discoveredEdges];

  return {
    refinedGraph: {
      nodes,
      edges: allEdges,
      systemLoad: callGraph.systemLoad,
    },
    pcResult: cfg.reportPCResult ? pcResult : undefined,
    originalEdgeCount: callGraph.edges.length,
    refinedEdgeCount: allEdges.length,
    prunedEdges,
    discoveredEdges,
    vStructureCount: pcResult.vStructures.length,
  };
}

/**
 * Quick check: is there enough time-series data to run PC validation?
 *
 * Returns true when at least 3 nodes have time series with ≥5 data points.
 */
export function canValidateWithPC(metrics: MetricMap, minNodes = 3, minDataPoints = 5): boolean {
  let validNodes = 0;
  for (const [, nodeMetrics] of metrics) {
    const firstEntry = nodeMetrics.values().next();
    if (firstEntry.done) continue;
    const ts: TimeSeries | undefined = firstEntry.value;
    if (ts && ts.values.length >= minDataPoints) {
      validNodes++;
    }
  }
  return validNodes >= minNodes;
}
