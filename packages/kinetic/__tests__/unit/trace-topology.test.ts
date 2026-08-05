import { describe, it, expect } from 'vitest';
import {
  augmentTopologyWithTraces,
  canValidateWithTraces,
} from '@agentix-e/micro-kinetic';
import type { TraceSpan } from '@agentix-e/micro-kinetic';
import type { ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

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
    traceId, spanId, parentSpanId: parentId, service,
    operation: 'GET /api', duration,
    statusCode: isError ? 500 : 200,
    isError, startTime,
  };
}

// ────────────────────────────────────────────────────────────
// Test: augmentTopologyWithTraces
// ────────────────────────────────────────────────────────────

describe('augmentTopologyWithTraces', () => {

  // ── Test 1: Star-DAG pruning ──────────────────────────
  it('should prune star-DAG edges not observed in traces (1 parent → 7 children, 2 confirmed)', () => {
    const graph = makeGraph(
      ['frontend', 'auth', 'cart', 'catalog', 'payment', 'shipping', 'email', 'recommendation'],
      [
        ['frontend', 'auth'], ['frontend', 'cart'], ['frontend', 'catalog'],
        ['frontend', 'payment'], ['frontend', 'shipping'], ['frontend', 'email'],
        ['frontend', 'recommendation'],
      ],
    );

    // Only auth and cart are called downstream in this faulty request trace
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'frontend', 100, false, 0),
      makeSpan('t1', 's-auth', 'root', 'auth', 20, false, 100),
      makeSpan('t1', 's-cart', 'root', 'cart', 30, true, 120),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    expect(result.edges.length).toBe(2); // only auth & cart kept, 5 pruned

    const keptEdges = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(keptEdges).toContain('frontend→auth');
    expect(keptEdges).toContain('frontend→cart');
    expect(keptEdges).not.toContain('frontend→catalog');
    expect(keptEdges).not.toContain('frontend→payment');
    expect(keptEdges).not.toContain('frontend→shipping');
    expect(keptEdges).not.toContain('frontend→email');
    expect(keptEdges).not.toContain('frontend→recommendation');
  });

  // ── Test 2: No traces → all edges pruned (no trace evidence) ─
  it('should prune all edges when spans are empty (no trace evidence to confirm any edge)', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);

    const result = augmentTopologyWithTraces(graph, []);

    // With no trace data, no edges can be confirmed → all pruned
    expect(result.edges.length).toBe(0);
    // Nodes are still preserved from the original graph
    expect(result.nodes.size).toBe(3);
    expect(result.systemLoad).toBe(0.5);
    expect(result.nodes.has('A')).toBe(true);
    expect(result.nodes.has('B')).toBe(true);
    expect(result.nodes.has('C')).toBe(true);
  });

  // ── Test 3: All edges confirmed → no pruning ──────────
  it('should keep all edges when every edge is confirmed by traces', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['A', 'C']]);
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'A', 10, false, 0),
      makeSpan('t1', 's1', 'root', 'B', 20, false, 1),
      makeSpan('t1', 's2', 'root', 'C', 20, false, 2),   // A→C (direct from root A)
      makeSpan('t1', 's3', 's1', 'C', 30, false, 3),      // B→C
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    expect(result.edges.length).toBe(3);
    const keys = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(keys).toContain('A→B');
    expect(keys).toContain('B→C');
    expect(keys).toContain('A→C');
  });

  // ── Test 4: Edge discovery — new edge from traces ─────
  it('should discover new edges from traces when discoverNewEdges is true (default)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'A', 10, false, 0),
      makeSpan('t1', 's1', 'root', 'B', 20, false, 1),   // A→B
      makeSpan('t1', 's2', 'root', 'D', 40, true, 2),     // A→D (new!)
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    expect(result.edges.some((e) => e.from === 'A' && e.to === 'D')).toBe(true);
    expect(result.nodes.has('D')).toBe(true);
    const discoveredNode = result.nodes.get('D')!;
    expect(discoveredNode.namespace).toBe('trace-discovered');
  });

  // ── Test 5: Edge discovery disabled ───────────────────
  it('should not discover new edges when discoverNewEdges is false', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'A', 10, false, 0),
      makeSpan('t1', 's1', 'root', 'C', 40, true, 1),     // A→C (new)
    ];

    const result = augmentTopologyWithTraces(graph, spans, { discoverNewEdges: false });

    // Only A→B should survive (it was in the original graph)
    // But A→B was NOT confirmed by traces either, so it should also be pruned
    // Wait — actually, without discoverNewEdges, A→C should NOT be added,
    // and A→B is NOT in traces either, so it gets pruned too
    // So result should have 0 edges
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'C')).toBe(false);
    expect(result.edges.length).toBe(0); // A→B pruned (not in traces), A→C not discovered
  });

  // ── Test 6: minCallFrequency threshold ────────────────
  it('should prune edges below minCallFrequency threshold (with discoverNewEdges disabled to avoid re-adding)', () => {
    const graph = makeGraph(
      ['frontend', 'auth', 'cart', 'payment'],
      [
        ['frontend', 'auth'],   // observed 3 times
        ['frontend', 'cart'],   // observed 1 time (below threshold)
        ['frontend', 'payment'], // observed 2 times
      ],
    );

    const spans: TraceSpan[] = [
      // Trace 1
      makeSpan('t1', 'root', '', 'frontend', 100, false, 0),
      makeSpan('t1', 'a1', 'root', 'auth', 20, false, 1),
      // Trace 2
      makeSpan('t2', 'r2', '', 'frontend', 100, false, 0),
      makeSpan('t2', 'a2', 'r2', 'auth', 20, false, 1),
      makeSpan('t2', 'p2', 'r2', 'payment', 30, true, 2),
      // Trace 3
      makeSpan('t3', 'r3', '', 'frontend', 100, false, 0),
      makeSpan('t3', 'a3', 'r3', 'auth', 20, false, 1),
      makeSpan('t3', 'c3', 'r3', 'cart', 30, false, 2),
      makeSpan('t3', 'p3', 'r3', 'payment', 30, false, 3),
    ];

    // minCallFrequency = 2: auth(3) and payment(2) survive, cart(1) pruned
    // NOTE: discoverNewEdges must be false, otherwise Step 3 re-adds
    // cart as a "discovered" edge (it's in callFrequency but not validatedEdges)
    const result = augmentTopologyWithTraces(graph, spans, {
      minCallFrequency: 2,
      discoverNewEdges: false,
    });

    const keys = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(keys).toContain('frontend→auth');
    expect(keys).toContain('frontend→payment');
    expect(keys).not.toContain('frontend→cart');
    expect(result.edges.length).toBe(2);
  });

  // ── Test 7: Empty spans with parent→child relationships ─
  it('should handle spans that all have parentSpanId pointing to non-existent spans (no relationships)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    // All spans have parentSpanId set, but no span exists with that spanId
    // → no parent→child relationships are resolved → no edge confirmations
    const spans: TraceSpan[] = [
      makeSpan('t1', 's1', 'nonexistent', 'A', 10, false, 0),
      makeSpan('t1', 's2', 'another-nonexistent', 'B', 10, false, 0),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    // No relationships found → all original edges pruned
    expect(result.edges.length).toBe(0);
    // Nodes still preserved
    expect(result.nodes.size).toBe(2);
  });

  // ── Test 8: Self-loops (same service parent→child) ────
  it('should ignore self-loops (spans where parent and child are the same service)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'A', 100, false, 0),
      // Self-loop: A calls A (same service for parent and child)
      makeSpan('t1', 's2', 'root', 'A', 10, false, 1),
      makeSpan('t1', 's3', 'root', 'B', 20, false, 2),   // A→B
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    // Self-loop A→A should NOT create an edge (guard: parentSpan.service !== span.service)
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'A')).toBe(false);
    // A→B should be confirmed
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'B')).toBe(true);
    expect(result.edges.length).toBe(1);
  });

  // ── Test 9: Multiple trace trees ──────────────────────
  it('should correctly aggregate call frequency across multiple trace trees', () => {
    const graph = makeGraph(
      ['frontend', 'auth', 'cart', 'payment', 'shipping'],
      [
        ['frontend', 'auth'], ['frontend', 'cart'],
        ['frontend', 'payment'], ['frontend', 'shipping'],
      ],
    );

    // 3 different trace trees with overlapping and distinct edges
    const spans: TraceSpan[] = [
      // ── Tree 1: frontend→auth→payment ──────────────
      makeSpan('t1', 'ft1', '', 'frontend', 100, false, 0),
      makeSpan('t1', 'a1', 'ft1', 'auth', 20, false, 1),
      makeSpan('t1', 'p1', 'a1', 'payment', 50, true, 2),

      // ── Tree 2: frontend→cart ──────────────────────
      makeSpan('t2', 'ft2', '', 'frontend', 100, false, 0),
      makeSpan('t2', 'c2', 'ft2', 'cart', 15, false, 1),

      // ── Tree 3: frontend→auth→shipping ─────────────
      makeSpan('t3', 'ft3', '', 'frontend', 100, false, 0),
      makeSpan('t3', 'a3', 'ft3', 'auth', 25, false, 1),
      makeSpan('t3', 'sh3', 'a3', 'shipping', 40, true, 2),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    // Expected edges: frontend→auth (t1,t3), frontend→cart (t2), auth→payment (t1), auth→shipping (t3)
    // frontend→payment and frontend→shipping are NOT directly called from frontend in traces → pruned
    const keys = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(keys).toContain('frontend→auth');
    expect(keys).toContain('frontend→cart');
    expect(keys).not.toContain('frontend→payment');    // not directly called from frontend
    expect(keys).not.toContain('frontend→shipping');    // not directly called from frontend
    // auth→payment and auth→shipping should exist (discovered or kept)
    // Note: these are not in original graph, so they are "discovered" if discoverNewEdges is true (default)
    expect(keys).toContain('auth→payment');
    expect(keys).toContain('auth→shipping');
  });

  // ── Test 10: Nodes preserved ─────────────────────────
  it('should preserve all original nodes in the augmented graph', () => {
    const graph = makeGraph(
      ['frontend', 'auth', 'cart', 'payment'],
      [['frontend', 'auth'], ['frontend', 'cart']],
    );

    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'frontend', 100, false, 0),
      makeSpan('t1', 's-auth', 'root', 'auth', 20, false, 1),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    // All 4 nodes should exist, even payment which had no confirmed edges
    expect(result.nodes.size).toBe(4);
    expect(result.nodes.has('frontend')).toBe(true);
    expect(result.nodes.has('auth')).toBe(true);
    expect(result.nodes.has('cart')).toBe(true);
    expect(result.nodes.has('payment')).toBe(true);

    // Verify node properties preserved
    const frontendNode = result.nodes.get('frontend')!;
    expect(frontendNode.name).toBe('frontend');
    expect(frontendNode.namespace).toBe('test');
  });

  // ── Test 11: Edge weight boost for trace-validated edges ─
  it('should boost callRate for trace-validated edges proportionally to call frequency', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['A', 'C']]);
    // A→B called 3 times across traces, A→C called 1 time
    const spans: TraceSpan[] = [
      makeSpan('t1', 'r1', '', 'A', 100, false, 0),
      makeSpan('t1', 'b1', 'r1', 'B', 20, false, 1),

      makeSpan('t2', 'r2', '', 'A', 100, false, 0),
      makeSpan('t2', 'b2', 'r2', 'B', 20, false, 1),
      makeSpan('t2', 'c2', 'r2', 'C', 30, false, 2),

      makeSpan('t3', 'r3', '', 'A', 100, false, 0),
      makeSpan('t3', 'b3', 'r3', 'B', 20, true, 1),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    const ab = result.edges.find((e) => e.from === 'A' && e.to === 'B')!;
    const ac = result.edges.find((e) => e.from === 'A' && e.to === 'C')!;

    // Original callRate = 100, trace boost = traceCount * 10
    // A→B: 3 traces → 100 + 3*10 = 130
    // A→C: 1 trace  → 100 + 1*10 = 110
    expect(ab.callRate).toBe(130);
    expect(ac.callRate).toBe(110);
    expect(ab.callRate).toBeGreaterThan(ac.callRate);
  });

  // ── Test 12: systemLoad preserved ────────────────────
  it('should preserve systemLoad from the original graph', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    // Mutate systemLoad to a custom value (must override the helper)
    const customGraph: ServiceCallGraph = {
      nodes: graph.nodes,
      edges: graph.edges,
      systemLoad: 0.87,
    };

    const spans: TraceSpan[] = [
      makeSpan('t1', 'r1', '', 'A', 100, false, 0),
      makeSpan('t1', 'b1', 'r1', 'B', 20, false, 1),
    ];

    const result = augmentTopologyWithTraces(customGraph, spans);
    expect(result.systemLoad).toBe(0.87);
  });

  // ── Test 13: discoverNewEdges respects minCallFrequency ─
  it('should not re-add edges below minCallFrequency via discoverNewEdges', () => {
    const graph = makeGraph(
      ['frontend', 'auth', 'cart'],
      [
        ['frontend', 'auth'],   // observed 3 times
        ['frontend', 'cart'],   // observed 1 time (below threshold)
      ],
    );

    const spans: TraceSpan[] = [
      makeSpan('t1', 'r1', '', 'frontend', 100, false, 0),
      makeSpan('t1', 'a1', 'r1', 'auth', 20, false, 1),

      makeSpan('t2', 'r2', '', 'frontend', 100, false, 0),
      makeSpan('t2', 'a2', 'r2', 'auth', 20, false, 1),

      makeSpan('t3', 'r3', '', 'frontend', 100, false, 0),
      makeSpan('t3', 'a3', 'r3', 'auth', 20, false, 1),
      makeSpan('t3', 'c3', 'r3', 'cart', 30, false, 2),
    ];

    // minCallFrequency=2, discoverNewEdges=true (default)
    // auth seen 3 times ≥ threshold → kept
    // cart seen 1 time < threshold → pruned and NOT re-added
    const result = augmentTopologyWithTraces(graph, spans, { minCallFrequency: 2 });

    // Only auth edge should survive — cart is below minCallFrequency
    expect(result.edges.length).toBe(1);
    expect(result.edges.some((e) => e.from === 'frontend' && e.to === 'auth')).toBe(true);
    expect(result.edges.some((e) => e.from === 'frontend' && e.to === 'cart')).toBe(false);

    // Verify consistency with discoverNewEdges=false
    const fixed = augmentTopologyWithTraces(graph, spans, {
      minCallFrequency: 2,
      discoverNewEdges: false,
    });
    expect(fixed.edges.length).toBe(1);
    expect(fixed.edges.some((e) => e.from === 'frontend' && e.to === 'auth')).toBe(true);
  });

  // ── Test 13b: discoverNewEdges above threshold adds new edges ─
  it('should discover new edges from traces when above minCallFrequency', () => {
    // Graph has frontend→auth only; traces reveal frontend also calls cart 3 times
    const graph = makeGraph(
      ['frontend', 'auth', 'cart'],
      [['frontend', 'auth']],
    );

    const spans: TraceSpan[] = [
      makeSpan('t1', 'r1', '', 'frontend', 100, false, 0),
      makeSpan('t1', 'a1', 'r1', 'auth', 20, false, 1),
      makeSpan('t1', 'c1', 'r1', 'cart', 30, false, 2),

      makeSpan('t2', 'r2', '', 'frontend', 100, false, 0),
      makeSpan('t2', 'a2', 'r2', 'auth', 20, false, 1),
      makeSpan('t2', 'c2', 'r2', 'cart', 30, false, 2),

      makeSpan('t3', 'r3', '', 'frontend', 100, false, 0),
      makeSpan('t3', 'a3', 'r3', 'auth', 20, false, 1),
      makeSpan('t3', 'c3', 'r3', 'cart', 30, false, 2),
    ];

    // minCallFrequency=2 — cart is observed 3 times ≥ 2, should be discovered
    const result = augmentTopologyWithTraces(graph, spans, {
      minCallFrequency: 2,
      discoverNewEdges: true,
    });

    expect(result.edges.length).toBe(2);
    expect(result.edges.some((e) => e.from === 'frontend' && e.to === 'auth')).toBe(true);
    expect(result.edges.some((e) => e.from === 'frontend' && e.to === 'cart')).toBe(true);
  });

  // ── Test 15: anomalyTime filter (spans from correct time window observed) ─
  it('should process spans correctly when anomalyTime is set (inclusionary check)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    // NOTE: The current implementation does NOT filter by anomalyTime.
    // This test verifies the behavior — all spans are processed regardless of anomalyTime.
    // If anomalyTime filtering is added later, this test documents expected behavior.
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'A', 100, false, 1000),      // startTime = 1000
      makeSpan('t1', 's1', 'root', 'B', 20, false, 1001),
    ];

    const result = augmentTopologyWithTraces(graph, spans, { anomalyTime: 5000 });
    // Current behavior: anomalyTime is not used for filtering, edges are still processed
    expect(result.edges.length).toBe(1);
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'B')).toBe(true);
  });

  // ── Test 16: Deeply nested trace tree ────────────────
  it('should handle deeply nested trace trees (>3 levels)', () => {
    const graph = makeGraph(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['B', 'C'], ['C', 'D'], ['D', 'E']],
    );
    // 5-level deep trace: A→B→C→D→E
    const spans: TraceSpan[] = [
      makeSpan('t1', 'sA', '', 'A', 100, false, 0),
      makeSpan('t1', 'sB', 'sA', 'B', 20, false, 1),
      makeSpan('t1', 'sC', 'sB', 'C', 30, true, 2),
      makeSpan('t1', 'sD', 'sC', 'D', 40, true, 3),
      makeSpan('t1', 'sE', 'sD', 'E', 50, true, 4),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    const keys = result.edges.map((e) => `${e.from}→${e.to}`);
    expect(keys).toContain('A→B');
    expect(keys).toContain('B→C');
    expect(keys).toContain('C→D');
    expect(keys).toContain('D→E');
    expect(result.edges.length).toBe(4);
  });

  // ── Test 17: Fan-out pattern (one parent → many children in same trace) ──
  it('should handle fan-out patterns (one parent spans to many children in same trace)', () => {
    const graph = makeGraph(
      ['A', 'B', 'C', 'D', 'E'],
      [['A', 'B'], ['A', 'C'], ['A', 'D'], ['A', 'E']],
    );
    // A fans out to B,C,D,E in a single trace
    const spans: TraceSpan[] = [
      makeSpan('t1', 'r', '', 'A', 100, false, 0),
      makeSpan('t1', 'sB', 'r', 'B', 20, false, 1),
      makeSpan('t1', 'sC', 'r', 'C', 30, false, 2),
      makeSpan('t1', 'sD', 'r', 'D', 40, true, 3),
      makeSpan('t1', 'sE', 'r', 'E', 50, false, 4),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    expect(result.edges.length).toBe(4);
    ['B', 'C', 'D', 'E'].forEach((child) => {
      expect(result.edges.some((e) => e.from === 'A' && e.to === child)).toBe(true);
    });
  });

  // ── Test 18: Root spans without children (all leaf spans) ─
  it('should handle spans where every span is a root span (no parent→child edges)', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    // All spans are root spans (parentSpanId='')
    const spans: TraceSpan[] = [
      makeSpan('t1', 's1', '', 'A', 10, false, 0),
      makeSpan('t2', 's2', '', 'B', 10, false, 0),
      makeSpan('t3', 's3', '', 'C', 10, false, 0),
    ];

    const result = augmentTopologyWithTraces(graph, spans);

    // No parent→child relationships → all edges pruned
    expect(result.edges.length).toBe(0);
    // Nodes preserved
    expect(result.nodes.size).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────
// Test: canValidateWithTraces
// ────────────────────────────────────────────────────────────

describe('canValidateWithTraces', () => {

  it('should return true with 10+ spans and at least one parent relationship', () => {
    const spans = Array.from({ length: 10 }, (_, i) =>
      makeSpan(
        't1',
        `s${i}`,
        i > 0 ? `s${i - 1}` : '',
        `svc-${i}`,
        10, false, 0,
      ),
    );
    expect(canValidateWithTraces(spans)).toBe(true);
  });

  it('should return false with fewer than 10 spans', () => {
    const spans = Array.from({ length: 9 }, (_, i) =>
      makeSpan(
        't1',
        `s${i}`,
        i > 0 ? `s${i - 1}` : '',
        `svc-${i}`,
        10, false, 0,
      ),
    );
    expect(canValidateWithTraces(spans)).toBe(false);
  });

  it('should return false with exactly 10 spans but no parent relationships', () => {
    const spans = Array.from({ length: 10 }, (_, i) =>
      makeSpan('t1', `s${i}`, '', `svc-${i}`, 10, false, 0),
    );
    expect(canValidateWithTraces(spans)).toBe(false);
  });

  it('should return false with empty spans', () => {
    expect(canValidateWithTraces([])).toBe(false);
  });

  it('should return true at boundary: exactly 10 spans with 1 parent relationship', () => {
    const spans: TraceSpan[] = [
      makeSpan('t1', 'root', '', 'svc-root', 10, false, 0),
      makeSpan('t1', 'child', 'root', 'svc-child', 10, false, 1),
      ...Array.from({ length: 8 }, (_, i) =>
        makeSpan('t1', `x${i}`, '', `svc-x${i}`, 1, false, 0),
      ),
    ];
    expect(spans.length).toBe(10);
    expect(canValidateWithTraces(spans)).toBe(true);
  });

  it('should handle single-span trace trees correctly', () => {
    // 15 spans but none have parentSpanId set (all root spans)
    const spans = Array.from({ length: 15 }, (_, i) =>
      makeSpan(`t${i}`, `s${i}`, '', `svc-${i}`, 10, false, 0),
    );
    expect(spans.length).toBe(15);
    expect(canValidateWithTraces(spans)).toBe(false); // no parent relationships
  });
});
