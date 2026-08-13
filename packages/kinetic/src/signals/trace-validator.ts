/**
 * Trace Validator — Bridge from trace spans to topology refinement.
 *
 * Integrates distributed trace span data into the RCA pipeline:
 * 1. Validate existing topology edges against actual call patterns
 * 2. Prune unobserved edges (noise reduction)
 * 3. Discover missing edges (self-healing topology)
 *
 * ### Deng Yu Collision Tree Mapping
 *
 * In the collision-tree framework, trace spans are the observable collision
 * events of the distributed system: each parent→child span pair represents
 * a fault-energy transfer event. Traces validate the kinetic operator:
 * only edges that appear in observed collision events can carry fault energy.
 *
 * ### Architecture
 *
 * ```
 * ServiceCallGraph + TraceSpan[]
 *         │
 *         ▼
 *  augmentTopologyWithTraces()
 *         │
 *         ▼
 *  Refined ServiceCallGraph
 * ```
 *
 * @module signals/trace-validator
 */

import type { ServiceCallGraph, TraceSpan } from '@agentix-e/micro-kinetic-core';
import { augmentTopologyWithTraces } from './trace-topology.js';

// ── Config ────────────────────────────────────────────────

export interface TraceValidationConfig {
  /** Minimum number of trace observations to keep an edge. Default: 1. */
  readonly minCallFrequency: number;
  /** Whether to add edges found in traces but missing from topology. Default: true. */
  readonly discoverNewEdges: boolean;
  /** Whether to prune edges not observed in any trace. Default: true. */
  readonly pruneUnobserved: boolean;
}

export const DEFAULT_TRACE_VALIDATION_CONFIG: TraceValidationConfig = {
  minCallFrequency: 1,
  discoverNewEdges: true,
  pruneUnobserved: true,
};

// ── Result ────────────────────────────────────────────────

export interface TraceValidationResult {
  /** The refined service call graph. */
  readonly refinedGraph: ServiceCallGraph;
  /** Number of edges pruned (existed in original but not in traces). */
  readonly prunedEdgeCount: number;
  /** Number of edges kept from original topology. */
  readonly keptEdgeCount: number;
  /** Number of edges discovered from traces (not in original). */
  readonly discoveredEdgeCount: number;
  /** Summary: total edges in the refined graph. */
  readonly totalEdges: number;
}

// ── Core function ─────────────────────────────────────────

/**
 * Validate and refine a topology using distributed trace data.
 *
 * Pipeline:
 * `augmentTopologyWithTraces()` — filter observed edges, discover new ones
 *
 * @param callGraph - Original service call graph
 * @param spans - Trace spans from the anomaly period
 * @param config - Validation configuration
 * @returns Validation result with refined graph and statistics
 */
export function validateTopologyWithTraces(
  callGraph: ServiceCallGraph,
  spans: readonly TraceSpan[],
  config: Partial<TraceValidationConfig> = {},
): TraceValidationResult {
  const cfg = { ...DEFAULT_TRACE_VALIDATION_CONFIG, ...config };

  if (!canValidateWithTraces(spans)) {
    // Insufficient trace data — return original graph unchanged
    return {
      refinedGraph: callGraph,
      prunedEdgeCount: 0,
      keptEdgeCount: callGraph.edges.length,
      discoveredEdgeCount: 0,
      totalEdges: callGraph.edges.length,
    };
  }

  // ── Step 1: Trace-based augmentation ────────────────────
  const augmented = augmentTopologyWithTraces(callGraph, spans, {
    minCallFrequency: cfg.minCallFrequency,
    discoverNewEdges: cfg.discoverNewEdges,
  });

  // Count statistics
  const originalEdgeKeys = new Set(callGraph.edges.map((e) => `${e.from}→${e.to}`));
  const augmentedEdgeKeys = new Set(augmented.edges.map((e) => `${e.from}→${e.to}`));

  const keptEdgeCount = cfg.pruneUnobserved
    ? augmented.edges.filter((e) => originalEdgeKeys.has(`${e.from}→${e.to}`)).length
    : callGraph.edges.length;

  const prunedEdgeCount = cfg.pruneUnobserved
    ? Array.from(originalEdgeKeys).filter((k) => !augmentedEdgeKeys.has(k)).length
    : 0;

  const discoveredEdgeCount = augmented.edges.filter(
    (e) => !originalEdgeKeys.has(`${e.from}→${e.to}`),
  ).length;

  let refinedGraph: ServiceCallGraph;

  if (!cfg.pruneUnobserved) {
    // Keep all original edges, only add discovered ones
    const discoveredEdges = augmented.edges.filter(
      (e) => !originalEdgeKeys.has(`${e.from}→${e.to}`),
    );
    refinedGraph = {
      nodes: augmented.nodes,
      edges: [...callGraph.edges, ...discoveredEdges.map((e) => ({ ...e }))],
      systemLoad: callGraph.systemLoad,
    };
  } else {
    refinedGraph = augmented;
  }

  return {
    refinedGraph,
    prunedEdgeCount,
    keptEdgeCount,
    discoveredEdgeCount,
    totalEdges: refinedGraph.edges.length,
  };
}

// ── Guard ─────────────────────────────────────────────────

/**
 * Check if trace data is sufficient for meaningful topology validation.
 *
 * Requirements:
 * - At least 10 spans
 * - At least 1 parent→child relationship
 * - (Implicitly) at least 2 unique services involved
 */
export function canValidateWithTraces(spans: readonly TraceSpan[]): boolean {
  if (spans.length < 10) return false;

  const services = new Set<string>();
  let parentChildPairs = 0;

  for (const span of spans) {
    services.add(span.service);
    if (span.parentSpanId) {
      const parent = spans.find((s) => s.spanId === span.parentSpanId);
      if (parent && parent.service !== span.service) {
        parentChildPairs++;
      }
    }
  }

  return services.size >= 2 && parentChildPairs > 0;
}
