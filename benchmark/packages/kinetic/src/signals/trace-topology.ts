/**
 * Trace-augmented topology validation and pruning.
 *
 * Uses distributed trace spans to:
 * 1. Validate topology edges against actual call patterns
 * 2. Assign frequency-based edge weights (high-frequency = strong dependency)
 * 3. Prune unobserved or low-frequency edges (noise reduction)
 * 4. Discover missing edges (self-healing topology)
 *
 * This solves our star-DAG problem: trace data reveals which of frontend's
 * 7 downstream calls actually participated in the faulty request flow.
 * Non-participating edges are pruned, reducing the star to a meaningful
 * tree of only the services involved in the fault.
 *
 * Algorithm:
 *   1. Build adjacency from span trees: (parent.service → child.service)
 *   2. Count call frequency per edge in the anomalous period
 *   3. Keep edges with frequency above threshold (default: ≥1 call)
 *   4. Add edges present in traces but missing from topology
 *   5. Assign edge weight = normalized call frequency
 *
 * @module signals/trace-topology
 */

import type { CallEdge, ServiceCallGraph, ServiceNode } from '@agentix-e/micro-kinetic-core';

/**
 * Minimal span shape required for topology augmentation.
 *
 * `augmentTopologyWithTraces` (and `trace-validator.ts`'s
 * `canValidateWithTraces`) only read the caller→callee relationship encoded
 * by `spanId`/`parentSpanId`/`service`.
 * Accepting this structural subset (rather than the full `TraceSpan`) lets
 * both the core `TraceSpan` and the benchmark `BenchmarkTraceSpan` flow
 * through without a lossy conversion layer.
 */
export interface TraceSpanLike {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly service: string;
}

/**
 * Configuration for trace-based topology augmentation.
 */
export interface TraceTopologyConfig {
  /** Minimum number of trace observations to keep an edge. */
  readonly minCallFrequency: number;
  /** Whether to add edges found in traces but missing from topology. */
  readonly discoverNewEdges: boolean;
  /** Only use spans after this timestamp (anomaly period). */
  readonly anomalyTime?: number;
}

const DEFAULT_CONFIG: TraceTopologyConfig = {
  minCallFrequency: 1,
  discoverNewEdges: true,
};

/**
 * Augment a service call graph with trace-validated edges.
 *
 * Returns a new graph where:
 * - Edges confirmed by traces keep their structure but gain weight
 * - Edges not observed in traces are removed (pruned)
 * - New edges from trace data are added (self-healing)
 *
 * @param callGraph - Original service call graph (with all edges)
 * @param spans - Trace spans from the fault period
 * @param config - Augmentation configuration
 * @returns Augmented call graph with trace-validated edges
 */
export function augmentTopologyWithTraces(
  callGraph: ServiceCallGraph,
  spans: readonly TraceSpanLike[],
  config: Partial<TraceTopologyConfig> = {},
): ServiceCallGraph {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Step 1: Extract call relationships from span trees ─
  // Build a spanId→span lookup map (O(n)) to avoid O(n²) in the loop below.
  const spanBySpanId = new Map<string, TraceSpanLike>();
  for (const span of spans) {
    spanBySpanId.set(span.spanId, span);
  }

  const callFrequency = new Map<string, number>(); // "from→to" → count

  for (const span of spans) {
    // Root spans (no parent) carry no caller→callee relationship.
    if (!span.parentSpanId) continue;
    // Find parent span to determine caller→callee
    const parentSpan = spanBySpanId.get(span.parentSpanId);
    if (parentSpan && parentSpan.service !== span.service) {
      const key = `${parentSpan.service}→${span.service}`;
      callFrequency.set(key, (callFrequency.get(key) ?? 0) + 1);
    }
  }

  // ── Step 2: Build validated edge set ────────────────────
  const validatedEdges: CallEdge[] = [];
  const nodes = new Map<string, ServiceNode>();

  // Copy nodes
  for (const [id, node] of callGraph.nodes) {
    nodes.set(id, { ...node });
  }

  // If no call relationships were extracted from traces (e.g. all spans
  // are root spans without parentSpanId, or trace format is incompatible),
  // return the original call graph unchanged rather than pruning everything.
  if (callFrequency.size === 0) {
    return {
      nodes,
      edges: callGraph.edges.map((e) => ({ ...e })),
      systemLoad: callGraph.systemLoad,
    };
  }

  // Check existing edges against trace data
  for (const edge of callGraph.edges) {
    const key = `${edge.from}→${edge.to}`;
    const traceCount = callFrequency.get(key) ?? 0;

    if (traceCount >= cfg.minCallFrequency) {
      validatedEdges.push({
        ...edge,
        callRate: edge.callRate + traceCount * 10, // boost weight for trace-validated edges
        errorRate: Math.max(0.01, edge.errorRate), // ensure non-zero
      });
    }
    // If not observed in traces → pruned (removed)
  }

  // ── Step 3: Discover new edges from traces ──────────────
  if (cfg.discoverNewEdges) {
    for (const [key, count] of callFrequency) {
      const [from, to] = key.split('→') as [string, string];
      if (!from || !to) continue;

      // Respect minCallFrequency threshold — consistent with Step 2
      if (count < cfg.minCallFrequency) continue;

      // Skip if edge already exists in validated set
      const exists = validatedEdges.some((e) => e.from === from && e.to === to);
      if (exists) continue;

      // Add discovered edge
      if (!nodes.has(from))
        nodes.set(from, { id: from, name: from, namespace: 'trace-discovered', labels: {} });
      if (!nodes.has(to))
        nodes.set(to, { id: to, name: to, namespace: 'trace-discovered', labels: {} });

      validatedEdges.push({
        from,
        to,
        type: 'REST',
        callRate: count * 10,
        p99Latency: 50,
        errorRate: 0.01,
      });
    }
  }

  return {
    nodes,
    edges: validatedEdges,
    systemLoad: callGraph.systemLoad,
  };
}
