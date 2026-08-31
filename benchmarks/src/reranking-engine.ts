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

import type { IRootCauseReranker } from '../../packages/ai/src/index.js';
import { buildCandidateEvidence, shouldRerank } from '../../packages/ai/src/index.js';
import type {
  BuildFaultGraphOptions,
  FaultPropagationGraph,
  IRCAEngine,
  MetricMap,
  RootCauseResult,
  ServiceCallGraph,
} from '../../packages/core/src/index.js';

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

    const candidates = results.map((r) => buildCandidateEvidence(r.serviceId, graph));
    const { order } = await this.reranker.rerank({ candidates });

    // Re-order the results by the reranker's permutation and refresh ranks.
    const byId = new Map(results.map((r) => [r.serviceId, r]));
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

    return reordered.map((r, i) => ({ ...r, rank: i + 1 }));
  }
}
