import { describe, it, expect } from 'vitest';
import {
  augmentTopologyWithTraces,
  canValidateWithTraces,
} from '@agentix-e/micro-kinetic';
import type { TraceSpan } from '@agentix-e/micro-kinetic';
import type { ServiceCallGraph } from '@agentix-e/micro-kinetic-core';

function makeGraph(services: string[], edges: [string, string][]): ServiceCallGraph {
  const nodes = new Map(services.map((s) => [s, { id: s, name: s, namespace: 'test', labels: {} }]));
  return {
    nodes,
    edges: edges.map(([from, to]) => ({ from, to, type: 'REST' as const, callRate: 100, p99Latency: 50, errorRate: 0.01 })),
    systemLoad: 0.5,
  };
}

function makeSpan(
  traceId: string,
  spanId: string,
  parentId: string,
  service: string,
  duration: number,
  isError: boolean,
  startTime: number,
): TraceSpan {
  return { traceId, spanId, parentSpanId: parentId, service, operation: 'GET /api', duration, statusCode: isError ? 500 : 200, isError, startTime };
}

describe('augmentTopologyWithTraces', () => {
  it('should keep edges confirmed by traces', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['A', 'C']]);
    const spans = [
      makeSpan('t1', 's1', '', 'A', 10, false, 0),
      makeSpan('t1', 's2', 's1', 'B', 20, false, 0),     // A→B confirmed
      makeSpan('t1', 's3', 's2', 'C', 30, true, 0),       // B→C confirmed
      // A→C NOT confirmed
    ];

    const result = augmentTopologyWithTraces(graph, spans);
    expect(result.edges.length).toBe(2); // A→C pruned
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'B')).toBe(true);
    expect(result.edges.some((e) => e.from === 'B' && e.to === 'C')).toBe(true);
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'C')).toBe(false);
  });

  it('should discover new edges from traces', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = [
      makeSpan('t1', 's1', '', 'A', 10, false, 0),
      makeSpan('t1', 's2', 's1', 'B', 20, false, 0),     // A→B
      makeSpan('t1', 's3', 's1', 'D', 40, true, 0),       // A→D (new!)
    ];

    const result = augmentTopologyWithTraces(graph, spans);
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'D')).toBe(true);
    expect(result.nodes.has('D')).toBe(true);
  });

  it('should boost callRate for trace-validated edges', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = [
      makeSpan('t1', 's1', '', 'A', 10, false, 0),
      makeSpan('t1', 's2', 's1', 'B', 20, false, 0),
      makeSpan('t2', 's3', '', 'A', 10, false, 0),
      makeSpan('t2', 's4', 's3', 'B', 20, true, 0),
    ];

    const result = augmentTopologyWithTraces(graph, spans);
    const ab = result.edges.find((e) => e.from === 'A' && e.to === 'B')!;
    expect(ab.callRate).toBeGreaterThan(100); // boosted by trace frequency (2 calls)
  });

  it('should handle empty spans gracefully', () => {
    const graph = makeGraph(['A'], []);
    const result = augmentTopologyWithTraces(graph, []);
    expect(result.edges.length).toBe(0);
    expect(result.nodes.size).toBe(1);
  });

  it('should not discover new edges when disabled', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const spans = [
      makeSpan('t1', 's1', '', 'A', 10, false, 0),
      makeSpan('t1', 's2', 's1', 'C', 40, true, 0),       // A→C (new)
    ];

    const result = augmentTopologyWithTraces(graph, spans, { discoverNewEdges: false });
    expect(result.edges.some((e) => e.from === 'A' && e.to === 'C')).toBe(false);
  });
});

describe('canValidateWithTraces', () => {
  it('should return true with sufficient spans', () => {
    const spans = Array.from({ length: 10 }, (_, i) =>
      makeSpan('t1', `s${i}`, i > 0 ? `s${i - 1}` : '', `svc-${i}`, 10, false, 0),
    );
    expect(canValidateWithTraces(spans)).toBe(true);
  });

  it('should return false with too few spans', () => {
    const spans = [makeSpan('t1', 's1', '', 'A', 10, false, 0)];
    expect(canValidateWithTraces(spans)).toBe(false);
  });
});
