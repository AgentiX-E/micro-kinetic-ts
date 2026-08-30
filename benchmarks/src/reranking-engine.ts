/**
 * IRCAEngine wrapper that applies an evidence-grounded LLM reranker after the
 * deterministic ranking.
 *
 * The reranker is gap-triggered: it only fires when the deterministic top-1 and
 * top-2 confidence scores are within `gapThreshold` of each other. A wide gap
 * means the deterministic ranker is already confident, so the LLM call is
 * skipped. On any reranker failure the deterministic order is returned
 * unchanged (the reranker itself guarantees this), so the wrapper can never
 * regress correctness.
 *
 * The wrapper lives in the benchmarks package because it bridges the ranking
 * engine (tree) and the LLM reranker (ai) — the two packages do not depend on
 * each other.
 *
 * @module benchmarks/reranking-engine
 */

import type { CandidateEvidence, IRootCauseReranker } from '../../packages/ai/src/index.js';
import { shouldRerank } from '../../packages/ai/src/index.js';
import type {
  BuildFaultGraphOptions,
  FaultPropagationGraph,
  IRCAEngine,
  MetricMap,
  RootCauseResult,
  ServiceCallGraph,
  ServiceId,
} from '../../packages/core/src/index.js';

/**
 * Cap on the number of upstream ancestors added to the rerank candidate set.
 * Keeps the LLM prompt bounded even on dense topologies (TrainTicket has 68
 * services); the ancestor walk stops as soon as this many are collected.
 */
const MAX_ANCESTOR_CANDIDATES = 3;

/**
 * The deterministic engine the reranker wraps.
 *
 * {@link IRCAEngine} declares `analyze` as async (`Promise<...>`), but the
 * concrete {@link TreePruner} implements it synchronously and is cast to
 * IRCAEngine by the DI container. Accepting both signatures here lets the
 * wrapper take a TreePruner directly without a cast.
 */
type DeterministicEngine = Omit<IRCAEngine, 'analyze'> & {
  analyze(
    graph: FaultPropagationGraph,
    topK?: number,
  ): RootCauseResult[] | Promise<readonly RootCauseResult[]>;
};

/**
 * Wraps a deterministic engine with an optional reranker.
 */
export class RerankingEngine implements IRCAEngine {
  constructor(
    private readonly inner: DeterministicEngine,
    private readonly reranker: IRootCauseReranker | null,
    private readonly gapThreshold: number,
  ) {}

  buildFaultGraph(
    callGraph: ServiceCallGraph,
    metrics: MetricMap,
    options?: BuildFaultGraphOptions,
  ): FaultPropagationGraph {
    return this.inner.buildFaultGraph(callGraph, metrics, options);
  }

  getCycleContributionBound(graph: FaultPropagationGraph): number {
    return this.inner.getCycleContributionBound(graph);
  }

  async analyze(graph: FaultPropagationGraph, topK?: number): Promise<readonly RootCauseResult[]> {
    const results = await this.inner.analyze(graph, topK);

    if (!this.reranker || results.length < 2) return results;
    if (
      !shouldRerank(
        results.map((r) => r.confidence),
        this.gapThreshold,
      )
    )
      return results;

    // Widen the candidate set with the upstream ancestors of the top-K results:
    // a silent "wrong value" source can rank BELOW top-K (e.g. TrainTicket RE3)
    // while its symptom tops the list, so without the ancestors the LLM would
    // never see the true source.
    const ancestors = upstreamAncestors(results, graph);
    const candidates = [
      ...results.map((r) => toEvidence(r.serviceId, graph)),
      ...ancestors.map((a) => toEvidence(a, graph)),
    ];
    const { order } = await this.reranker.rerank({ candidates });

    // Rebuild the final order: original results plus a minimal result for any
    // ancestor the LLM promoted (so a promoted source becomes a valid output).
    const byId = new Map<string, RootCauseResult>(results.map((r) => [r.serviceId, r]));
    for (const a of ancestors) {
      if (!byId.has(a)) byId.set(a, minimalResult(a, graph));
    }
    const reordered: RootCauseResult[] = [];
    for (const id of order) {
      const r = byId.get(id);
      if (r) reordered.push(r);
    }
    // Defensive: never drop a result the reranker omitted (should not happen —
    // parseRerankOrder returns a full permutation — but keep the invariant).
    for (const r of results) {
      if (!reordered.some((x) => x.serviceId === r.serviceId)) reordered.push(r);
    }

    return reordered.slice(0, topK ?? results.length).map((r, i) => ({ ...r, rank: i + 1 }));
  }
}

/**
 * Upstream ancestors of the top-K results, capped so the rerank prompt stays
 * bounded. An ancestor is a service that calls INTO a candidate (edge
 * `ancestor → candidate`); the true source of a propagated fault is always
 * upstream of the symptom that tops the deterministic list.
 */
function upstreamAncestors(
  results: readonly RootCauseResult[],
  graph: FaultPropagationGraph,
): ServiceId[] {
  const inResults = new Set(results.map((r) => r.serviceId));
  const ancestors: ServiceId[] = [];
  for (const r of results) {
    for (const e of graph.callGraph.edges) {
      if (e.to === r.serviceId && !inResults.has(e.from) && !ancestors.includes(e.from)) {
        ancestors.push(e.from);
        if (ancestors.length >= MAX_ANCESTOR_CANDIDATES) return ancestors;
      }
    }
  }
  return ancestors;
}

/**
 * Build a minimal {@link RootCauseResult} for an ancestor the LLM promoted,
 * using its anomaly score as the confidence and an UNKNOWN fault type.
 */
function minimalResult(serviceId: ServiceId, graph: FaultPropagationGraph): RootCauseResult {
  return {
    serviceId,
    faultType: { category: 'UNKNOWN', subType: 'llm_promoted_ancestor', severity: 'minor' },
    confidence: graph.anomalyScores.get(serviceId) ?? 0,
    rank: 0,
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: false,
  };
}

/**
 * Build per-candidate evidence from the fault graph for one service.
 */
function toEvidence(serviceId: ServiceId, graph: FaultPropagationGraph): CandidateEvidence {
  const node = graph.callGraph.nodes.get(serviceId);
  const dominant = graph.dominantMetrics?.get(serviceId);
  const anomaly = graph.anomalyScores.get(serviceId);

  const evidence: CandidateEvidence = {
    serviceId,
    name: node?.name,
    anomalyScore: anomaly,
    dominantMetric: dominant?.label,
    metricShift:
      dominant && (dominant.head.length > 0 || dominant.tail.length > 0)
        ? `head=[${dominant.head.join(',')}] tail=[${dominant.tail.join(',')}]`
        : undefined,
    breakdown: dominant?.breakdown,
    deepestLogException: graph.deepestExceptions?.get(serviceId),
    adjacency: buildAdjacency(serviceId, graph.callGraph),
  };

  return evidence;
}

/**
 * Compact adjacency summary for a service: its upstream and downstream
 * neighbours in the call graph.
 */
function buildAdjacency(id: ServiceId, callGraph: ServiceCallGraph): string | undefined {
  const upstream: string[] = [];
  const downstream: string[] = [];
  for (const e of callGraph.edges) {
    if (e.to === id) upstream.push(e.from);
    if (e.from === id) downstream.push(e.to);
  }
  if (upstream.length === 0 && downstream.length === 0) return undefined;
  const parts: string[] = [];
  if (upstream.length > 0) parts.push(`upstream=[${upstream.join(',')}]`);
  if (downstream.length > 0) parts.push(`downstream=[${downstream.join(',')}]`);
  return parts.join(' ');
}
