/**
 * Unit tests for the evidence-grounded RerankingEngine wrapper.
 *
 * Verifies the gap-trigger contract and the deterministic fallback: the LLM is
 * only consulted when the top-1/top-2 confidence gap is narrow, the reranker's
 * permutation is applied in order, and any missing/omitted candidate is never
 * dropped. No network is touched — the inner engine and reranker are stubs.
 *
 * @module benchmarks/__tests__/reranking-engine
 */

import type { IRootCauseReranker, RerankRequest, RerankResult } from '@agentix-e/micro-kinetic-ai';
import type {
  FaultPropagationGraph,
  IRCAEngine,
  RootCauseResult,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it, vi } from 'vitest';
import { RerankingEngine } from '../src/reranking-engine.js';

// ── Helpers ───────────────────────────────────────────────

function result(serviceId: string, confidence: number, rank: number): RootCauseResult {
  return {
    serviceId,
    confidence,
    rank,
    faultType: { category: 'CPU', subType: '', severity: 'info' },
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: true,
  };
}

/** Minimal fault graph with a 2-node call graph and per-node anomaly scores. */
function minimalGraph(): FaultPropagationGraph {
  return {
    callGraph: {
      nodes: new Map([
        ['a', { id: 'a', name: 'auth', namespace: 'ns', labels: {} }],
        ['b', { id: 'b', name: 'order', namespace: 'ns', labels: {} }],
      ]),
      edges: [{ from: 'a', to: 'b', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 }],
      systemLoad: 0.5,
    },
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map([
      ['a', 0.9],
      ['b', 1.0],
    ]),
    dominantMetrics: new Map([
      ['a', { label: 'cpu', head: [1, 2], tail: [3, 4], transientSkipped: [] }],
      ['b', { label: 'workload', head: [5, 6], tail: [7, 8], transientSkipped: [] }],
    ]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

function innerEngine(results: RootCauseResult[]): IRCAEngine {
  return {
    buildFaultGraph: vi.fn().mockReturnValue(minimalGraph()),
    analyze: vi.fn().mockResolvedValue(results),
    getCycleContributionBound: vi.fn().mockReturnValue(0),
  } as unknown as IRCAEngine;
}

function stubReranker(order: string[]): IRootCauseReranker {
  return {
    modelId: 'stub',
    rerank: vi
      .fn()
      .mockImplementation(async (_req: RerankRequest): Promise<RerankResult> => ({ order })),
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('RerankingEngine', () => {
  it('applies the reranker permutation and refreshes ranks when the gap is narrow', async () => {
    const reranker = stubReranker(['b', 'a']);
    const engine = new RerankingEngine(
      innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]),
      reranker,
      0.1,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['b', 'a']);
    expect(out[0]!.rank).toBe(1);
    expect(out[1]!.rank).toBe(2);
    expect(reranker.rerank).toHaveBeenCalledTimes(1);
  });

  it('skips the reranker when the top-1/top-2 gap meets the threshold', async () => {
    const reranker = stubReranker(['b', 'a']);
    // gap 0.6 - 0.4 = 0.2 >= threshold 0.1 → no rerank.
    const engine = new RerankingEngine(
      innerEngine([result('a', 0.6, 1), result('b', 0.4, 2)]),
      reranker,
      0.1,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['a', 'b']);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });

  it('returns the deterministic order when the reranker is null', async () => {
    const engine = new RerankingEngine(
      innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]),
      null,
      0.1,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['a', 'b']);
  });

  it('never drops a candidate the reranker omits (defensive append)', async () => {
    const reranker = stubReranker(['b']); // omits 'a'
    const engine = new RerankingEngine(
      innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]),
      reranker,
      0.1,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId).sort()).toEqual(['a', 'b']);
  });

  it('delegates buildFaultGraph and getCycleContributionBound to the inner engine', () => {
    const inner = innerEngine([result('a', 0.9, 1)]);
    const engine = new RerankingEngine(inner, null, 0.1);

    const graph = minimalGraph();
    engine.buildFaultGraph(graph.callGraph, new Map());
    expect(inner.buildFaultGraph).toHaveBeenCalledTimes(1);
    engine.getCycleContributionBound(graph);
    expect(inner.getCycleContributionBound).toHaveBeenCalledTimes(1);
  });

  it('returns early for a single result without consulting the reranker', async () => {
    const reranker = stubReranker(['a']);
    const engine = new RerankingEngine(innerEngine([result('a', 0.9, 1)]), reranker, 0.1);

    const out = await engine.analyze(minimalGraph(), 1);
    expect(out.map((r) => r.serviceId)).toEqual(['a']);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });

  it('builds undefined adjacency for a node with no edges', async () => {
    const reranker = stubReranker(['a', 'b']);
    const inner = innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.1);

    // A graph with no edges: every node has empty adjacency.
    const graph = minimalGraph();
    graph.callGraph.edges = [];
    await engine.analyze(graph, 2);
    // The reranker was consulted (narrow gap) and never threw.
    expect(reranker.rerank).toHaveBeenCalledTimes(1);
  });

  it('omits the metric-shift when a service has no dominant metric', async () => {
    const reranker = stubReranker(['a', 'b']);
    const inner = innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.1);

    const graph = minimalGraph();
    // No dominantMetrics → toEvidence leaves metricShift undefined.
    delete (graph as { dominantMetrics?: unknown }).dominantMetrics;
    await engine.analyze(graph, 2);
    expect(reranker.rerank).toHaveBeenCalledTimes(1);
  });

  it('surfaces an upstream ancestor the deterministic ranker ranked below top-K', async () => {
    // Graph: src → sym1 and src → sym2. The deterministic top-2 are the two
    // symptoms; the silent source 'src' is NOT among them. The widening must
    // add 'src' (upstream of both) so the LLM can promote it to rank 1.
    const graph: FaultPropagationGraph = {
      callGraph: {
        nodes: new Map([
          ['src', { id: 'src', name: 'auth', namespace: 'ns', labels: {} }],
          ['sym1', { id: 'sym1', name: 'order', namespace: 'ns', labels: {} }],
          ['sym2', { id: 'sym2', name: 'user', namespace: 'ns', labels: {} }],
        ]),
        edges: [
          { from: 'src', to: 'sym1', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'src', to: 'sym2', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
        ],
        systemLoad: 0.5,
      },
      propagationWeights: new Float64Array(0),
      anomalyScores: new Map([
        ['src', 0.3],
        ['sym1', 1.0],
        ['sym2', 0.9],
      ]),
      anomalyOnsetTimes: new Map(),
      injectTimeMs: 0,
    } as unknown as FaultPropagationGraph;

    const reranker = stubReranker(['src', 'sym1', 'sym2']);
    const inner = innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.2);

    const out = await engine.analyze(graph, 2);
    // The LLM promoted the ancestor 'src' to rank 1; top-2 is [src, sym1].
    expect(out.map((r) => r.serviceId)).toEqual(['src', 'sym1']);
    expect(out[0]!.rank).toBe(1);
    expect(out[0]!.confidence).toBe(0.3); // minimal result uses the anomaly score
    expect(reranker.rerank).toHaveBeenCalledTimes(1);
  });

  it('caps the ancestor set so the rerank prompt stays bounded', async () => {
    // A wide fan-in: four distinct ancestors feed the top symptom. Only the
    // first MAX_ANCESTOR_CANDIDATES (3) are added.
    const nodes = new Map<
      string,
      { id: string; name: string; namespace: string; labels: Record<string, never> }
    >([['sym', { id: 'sym', name: 'order', namespace: 'ns', labels: {} }]]);
    const edges: {
      from: string;
      to: string;
      type: string;
      callRate: number;
      p99Latency: number;
      errorRate: number;
    }[] = [];
    const anomalyScores = new Map<string, number>([['sym', 1.0]]);
    for (let i = 0; i < 5; i++) {
      const id = `anc${i}`;
      nodes.set(id, { id, name: `anc${i}`, namespace: 'ns', labels: {} });
      edges.push({ from: id, to: 'sym', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 });
      anomalyScores.set(id, 0.1);
    }
    const graph: FaultPropagationGraph = {
      callGraph: { nodes, edges, systemLoad: 0.5 },
      propagationWeights: new Float64Array(0),
      anomalyScores,
      anomalyOnsetTimes: new Map(),
      injectTimeMs: 0,
    } as unknown as FaultPropagationGraph;

    const reranker = stubReranker(['sym', 'anc0', 'anc1', 'anc2']);
    const inner = innerEngine([result('sym', 1.0, 1), result('anc0', 0.95, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.2);

    await engine.analyze(graph, 2);
    // The rerank request must carry at most top-2 + 3 ancestors = 5 candidates.
    const request = (reranker.rerank as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { candidates: readonly unknown[] } | undefined;
    expect(request?.candidates.length).toBeLessThanOrEqual(5);
  });

  it('populates deepestLogException from the graph for the LLM evidence', async () => {
    const graph = minimalGraph();
    (graph as { deepestExceptions?: Map<string, string> }).deepestExceptions = new Map([
      ['a', 'NullPointerException'],
    ]);

    const reranker = stubReranker(['a', 'b']);
    const inner = innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.1);

    await engine.analyze(graph, 2);
    const request = (reranker.rerank as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      { candidates: readonly { serviceId: string; deepestLogException?: string }[] } | undefined;
    const a = request?.candidates.find((c) => c.serviceId === 'a');
    expect(a?.deepestLogException).toBe('NullPointerException');
  });

  it('defaults topK to the result length when omitted', async () => {
    const reranker = stubReranker(['b', 'a']);
    const engine = new RerankingEngine(
      innerEngine([result('a', 0.9, 1), result('b', 0.95, 2)]),
      reranker,
      0.1,
    );

    const out = await engine.analyze(minimalGraph());
    expect(out.map((r) => r.serviceId)).toEqual(['b', 'a']);
    expect(out).toHaveLength(2);
  });

  it('uses a zero confidence for a promoted ancestor with no anomaly score', async () => {
    // Graph: src → sym1 and src → sym2. The source 'src' is the upstream
    // ancestor of both symptoms but has NO anomaly score entry — minimalResult
    // must fall back to 0.
    const graph: FaultPropagationGraph = {
      callGraph: {
        nodes: new Map([
          ['src', { id: 'src', name: 'auth', namespace: 'ns', labels: {} }],
          ['sym1', { id: 'sym1', name: 'order', namespace: 'ns', labels: {} }],
          ['sym2', { id: 'sym2', name: 'user', namespace: 'ns', labels: {} }],
        ]),
        edges: [
          { from: 'src', to: 'sym1', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'src', to: 'sym2', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
        ],
        systemLoad: 0.5,
      },
      propagationWeights: new Float64Array(0),
      anomalyScores: new Map([
        ['sym1', 1.0],
        ['sym2', 0.9], // 'src' absent
      ]),
      anomalyOnsetTimes: new Map(),
      injectTimeMs: 0,
    } as unknown as FaultPropagationGraph;

    const reranker = stubReranker(['src', 'sym1', 'sym2']);
    const inner = innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]);
    const engine = new RerankingEngine(inner, reranker, 0.2);

    const out = await engine.analyze(graph, 2);
    const src = out.find((r) => r.serviceId === 'src');
    expect(src?.confidence).toBe(0);
  });
});
