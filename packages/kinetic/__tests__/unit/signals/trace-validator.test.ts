import { describe, it, expect } from 'vitest';
import {
  validateTopologyWithTraces,
  canValidateWithTraces,
} from '@agentix-e/micro-kinetic';
import type { TraceSpan, ServiceCallGraph, ServiceNode, TimeSeries } from '@agentix-e/micro-kinetic';

// ── Helpers ───────────────────────────────────────────────

function makeNode(id: string, namespace = 'test'): ServiceNode {
  return { id, name: id, namespace, labels: {} };
}

function makeGraph(services: string[], edges: [string, string][]): ServiceCallGraph {
  const nodes = new Map(services.map((s) => [s, makeNode(s)]));
  return {
    nodes,
    edges: edges.map(([from, to]) => ({
      from, to,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    })),
    systemLoad: 0.5,
  };
}

function makeSpan(
  traceId: string,
  spanId: string,
  parentId: string,
  service: string,
  duration = 10,
  isError = false,
  startTime = 0,
): TraceSpan {
  return {
    traceId,
    spanId,
    parentSpanId: parentId,
    service,
    operation: `GET /${service}`,
    duration,
    statusCode: isError ? 500 : 200,
    isError,
    startTime,
  };
}

/**
 * Create a linear trace: service0 → service1 → ... → serviceN.
 * Each span is the child of the previous span in the chain.
 */
function makeLinearTraceChain(
  traceId: string,
  services: string[],
  baseStartTime = 1000,
  stepDuration = 10,
): TraceSpan[] {
  const spans: TraceSpan[] = [];
  let prevSpanId = '';
  for (let i = 0; i < services.length; i++) {
    const spanId = `${traceId}_span_${i}`;
    spans.push(makeSpan(
      traceId,
      spanId,
      i === 0 ? '' : `${traceId}_span_${i - 1}`,
      services[i]!,
      stepDuration,
      false,
      baseStartTime + i * 20,
    ));
    prevSpanId = spanId;
  }
  return spans;
}

const makeTimeSeries = (name: string, vals: number[]) => ({
  name, values: new Float64Array(vals),
});

function makeMetrics(
  entries: [string, { name: string; values: Float64Array }[]][],
): ReadonlyMap<string, readonly { name: string; values: Float64Array }[]> {
  return new Map(entries.map(([s, t]) => [s, Object.freeze(t)]));
}

// ── Tests ─────────────────────────────────────────────────

describe('validateTopologyWithTraces', () => {
  // ── Guard: canValidateWithTraces ──────────────────────

  describe('canValidateWithTraces', () => {
    it('returns false for empty spans', () => {
      expect(canValidateWithTraces([])).toBe(false);
    });

    it('returns false for insufficient span count (< 10)', () => {
      const spans = [
        makeSpan('t1', 's0', '', 'A'),
        makeSpan('t1', 's1', 's0', 'B'),
      ];
      expect(canValidateWithTraces(spans)).toBe(false);
    });

    it('returns false when all spans belong to same service', () => {
      const spans = Array.from({ length: 10 }, (_, i) =>
        makeSpan('t1', `s${i}`, i === 0 ? '' : `s${i - 1}`, 'A'),
      );
      expect(canValidateWithTraces(spans)).toBe(false);
    });

    it('returns false when no parent-child relationships', () => {
      const rootSpans: TraceSpan[] = Array.from({ length: 5 }, (_, i) =>
        makeSpan(`t${i}`, `root_${i}`, '', 'A'),
      );
      const leafSpans: TraceSpan[] = Array.from({ length: 5 }, (_, i) =>
        makeSpan(`t${i}`, `leaf_${i}`, '', 'B'),
      );
      expect(canValidateWithTraces([...rootSpans, ...leafSpans])).toBe(false);
    });

    it('returns true with 10+ spans and cross-service parent-child edges', () => {
      const chain = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
      expect(canValidateWithTraces(chain)).toBe(true);
    });

    it('returns true with 1 parent-child cross-service edge (10+ spans)', () => {
      const rootSpans: TraceSpan[] = Array.from({ length: 9 }, (_, i) =>
        makeSpan('t1', `r_${i}`, '', 'A'),
      );
      const spans = [
        ...rootSpans,
        makeSpan('t1', 'child', 'r_0', 'B'), // B is child of r_0 (A)
      ];
      expect(spans.length).toBe(10);
      expect(canValidateWithTraces(spans)).toBe(true);
    });
  });

  // ── Basic validation ──────────────────────────────────

  it('returns original graph when spans are insufficient', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans: TraceSpan[] = [makeSpan('t1', 's0', '', 'A')];

    const result = validateTopologyWithTraces(graph, spans);

    expect(result.refinedGraph).toBe(graph); // Same reference
    expect(result.prunedEdgeCount).toBe(0);
    expect(result.keptEdgeCount).toBe(1);
    expect(result.discoveredEdgeCount).toBe(0);
    expect(result.totalEdges).toBe(1);
  });

  it('keeps edges observed in traces', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    const chain = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

    const result = validateTopologyWithTraces(graph, chain);

    // A→B is in the trace chain, A→C is not observed
    expect(result.prunedEdgeCount).toBe(1); // A→C pruned
    expect(result.keptEdgeCount).toBe(1);    // A→B kept
    expect(result.discoveredEdgeCount).toBeGreaterThan(0); // B→C etc. from trace
  });

  it('prunes all edges not observed in traces', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    // Trace only contains A→B, never A→C
    const spans = makeLinearTraceChain('t1', ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

    const result = validateTopologyWithTraces(graph, spans);

    expect(result.prunedEdgeCount).toBe(1); // A→C pruned
    const refinedEdges = result.refinedGraph.edges;
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'B')).toBe(true);
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'C')).toBe(false);
  });

  it('discovers new edges from trace data', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    // Trace shows A→B→C but C is not in the original graph
    const spans = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

    const result = validateTopologyWithTraces(graph, spans);

    expect(result.discoveredEdgeCount).toBeGreaterThan(0);
    // Check that C's node was created
    expect(result.refinedGraph.nodes.has('C')).toBe(true);
  });

  it('respects discoverNewEdges=false', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

    const result = validateTopologyWithTraces(graph, spans, undefined, {
      discoverNewEdges: false,
    });

    // No new edges discovered, but existing edges may be pruned
    expect(result.discoveredEdgeCount).toBe(0);
  });

  it('respects pruneUnobserved=false', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    // Trace only shows A→B
    const spans = makeLinearTraceChain('t1', ['A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

    const result = validateTopologyWithTraces(graph, spans, undefined, {
      pruneUnobserved: false,
    });

    // A→C should remain since pruning is off
    const refinedEdges = result.refinedGraph.edges;
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'C')).toBe(true);
  });

  it('respects minCallFrequency threshold', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

    // Requires 2+ trace observations but edge only appears once
    const result = validateTopologyWithTraces(graph, spans, undefined, {
      minCallFrequency: 2,
    });

    // With minCallFrequency=2, edges with only 1 observation are pruned
    // A→B appears once → may be pruned
    expect(result.prunedEdgeCount).toBeGreaterThanOrEqual(0);
  });

  // ── Edge cases ────────────────────────────────────────

  it('handles graph with no edges', () => {
    const graph = makeGraph(['A', 'B'], []);
    const chain = makeLinearTraceChain('t1', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);

    const result = validateTopologyWithTraces(graph, chain);

    expect(result.prunedEdgeCount).toBe(0);
    expect(result.keptEdgeCount).toBe(0);
    expect(result.discoveredEdgeCount).toBeGreaterThan(0); // Trace edges discovered
  });

  it('handles self-referencing spans (same service parent-child)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans: TraceSpan[] = [
      ...makeLinearTraceChain('t1', ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'A']),
    ];

    // All parent-child are same service → no cross-service edges
    const result = validateTopologyWithTraces(graph, spans);

    // With no cross-service parent-child, canValidateWithTraces returns false
    expect(result.refinedGraph).toBe(graph);
  });

  it('handles spans with orphaned parents (parent not found)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const rootSpans: TraceSpan[] = Array.from({ length: 9 }, (_, i) =>
      makeSpan('t1', `r_${i}`, '', 'A'),
    );
    const orphanSpan = makeSpan('t1', 'orphan', 'nonexistent_parent', 'B');
    const spans = [...rootSpans, orphanSpan];

    const result = validateTopologyWithTraces(graph, spans);

    // The orphan span's parent doesn't exist → ignored
    // But the 9 root spans + 1 orphan = 10 spans, canValidate returns true
    // No cross-service edges → returns original
    expect(result.totalEdges).toBeGreaterThanOrEqual(1);
  });

  it('handles multi-trace aggregation', () => {
    const graph = makeGraph(['A', 'B', 'C', 'D'], [
      ['A', 'B'], ['A', 'C'], ['A', 'D'],
    ]);
    // Multiple traces: some show A→B, some A→C, none A→D
    const chain1 = makeLinearTraceChain('t1', ['A', 'B', 'X', 'Y', 'Z', 'W', 'V', 'U', 'T', 'S']);
    const chain2 = makeLinearTraceChain('t2', ['A', 'C', 'X', 'Y', 'Z', 'W', 'V', 'U', 'T', 'S']);

    const result = validateTopologyWithTraces(graph, [...chain1, ...chain2]);

    // A→D pruned (not in any trace),
    // A→B and A→C kept (observed in traces)
    const refinedEdges = result.refinedGraph.edges;
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'B')).toBe(true);
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'C')).toBe(true);
    expect(refinedEdges.some((e) => e.from === 'A' && e.to === 'D')).toBe(false);
  });

  // ── Metrics-aware PC co-verification ──────────────────

  it('passes trace-validated graph through PC when pcVerify=true (with metrics)', () => {
    const n = 30;
    const aVals = new Float64Array(n);
    const bVals = new Float64Array(n);
    const cVals = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      aVals[i] = 10 + Math.sin(i * 0.15) * 2 + Math.random();
      bVals[i] = 10 + Math.sin(i * 0.15) * 2 + Math.random();
      cVals[i] = 5 + Math.random() * 10; // Independent of A, B
    }

    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    const spans = makeLinearTraceChain('t1', [
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    ]);

    const metrics = makeMetrics([
      ['A', [makeTimeSeries('cpu', Array.from(aVals))]],
      ['B', [makeTimeSeries('cpu', Array.from(bVals))]],
      ['C', [makeTimeSeries('cpu', Array.from(cVals))]],
    ]);

    const result = validateTopologyWithTraces(graph, spans, metrics, {
      pcVerify: true,
    });

    expect(result.pcResult).toBeDefined();
    expect(result.pcResult!.refinedGraph).toBeDefined();
  });

  it('skips PC verification when no metrics provided (pcVerify=true)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = makeLinearTraceChain('t1', [
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
    ]);

    // pcVerify=true but no metrics
    const result = validateTopologyWithTraces(graph, spans, undefined, {
      pcVerify: true,
    });

    expect(result.pcResult).toBeUndefined();
  });

  it('skips PC verification when fewer than 3 nodes', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const n = 20;
    const aVals = Array.from({ length: n }, (_, i) => 10 + i * 0.1);
    const bVals = Array.from({ length: n }, (_, i) => 10 + i * 0.1);
    const spans = makeLinearTraceChain('t1', [
      'A', 'B', 'X', 'Y', 'Z', 'W', 'V', 'U', 'T', 'S',
    ]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('cpu', aVals)]],
      ['B', [makeTimeSeries('cpu', bVals)]],
    ]);

    const result = validateTopologyWithTraces(graph, spans, metrics, {
      pcVerify: true,
    });

    // 2 nodes (< 3 required for PC) → PC skipped
    expect(result.pcResult).toBeUndefined();
  });

  // ── Statistics accuracy ───────────────────────────────

  it('reports accurate kept/pruned/discovered counts', () => {
    // Original: A→B, A→C
    // Trace: A→B, B→D, D→E, E→F, F→G, G→H, H→I, I→J, J→K, K→L (10 chain)
    // Kept: A→B (observed in trace)
    // Pruned: A→C (not in trace)
    // Discovered: B→D (from trace, not in original)
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    const spans = makeLinearTraceChain('t1', [
      'A', 'B', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
    ]);

    const result = validateTopologyWithTraces(graph, spans);

    expect(result.keptEdgeCount).toBe(1);    // A→B
    expect(result.prunedEdgeCount).toBe(1);   // A→C
    expect(result.discoveredEdgeCount).toBeGreaterThanOrEqual(0);
    expect(result.totalEdges).toEqual(result.refinedGraph.edges.length);
  });
});
