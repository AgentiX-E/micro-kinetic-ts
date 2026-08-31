/**
 * IRCAEngine wrapper that applies the graph-guided ReAct investigator after the
 * deterministic ranking (GALA+ phase-III).
 *
 * Unlike the single-shot reranker, the investigator WALKS the dependency graph
 * upstream from the deterministic top-K symptoms and concludes a single root
 * cause. It is gap-triggered (fires only when the top-1/top-2 confidence gap is
 * narrow) and correctness-safe: on any failure, an undecided result
 * (`rootCause: null`), or a hallucinated service, the deterministic order is
 * returned unchanged — the wrapper can never regress.
 *
 * @module benchmarks/investigator-engine
 */

import type { InvestigatorAgent } from '../../packages/ai/src/index.js';
import { GraphInvestigatorToolkit, shouldRerank } from '../../packages/ai/src/index.js';
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
 * The deterministic engine the investigator wraps (same shape as the reranker's).
 */
type DeterministicEngine = Omit<IRCAEngine, 'analyze'> & {
  analyze(
    graph: FaultPropagationGraph,
    topK?: number,
  ): RootCauseResult[] | Promise<readonly RootCauseResult[]>;
};

/**
 * Wraps a deterministic engine with an optional graph-guided investigator.
 */
export class InvestigatorEngine implements IRCAEngine {
  constructor(
    private readonly inner: DeterministicEngine,
    private readonly agent: InvestigatorAgent | null,
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

    if (!this.agent || results.length < 2) return results;
    if (
      !shouldRerank(
        results.map((r) => r.confidence),
        this.gapThreshold,
      )
    )
      return results;

    // Seed the toolkit with the deterministic top-K and let the agent walk the
    // graph upstream from those symptoms.
    const seeds = results.map((r) => r.serviceId);
    const toolkit = new GraphInvestigatorToolkit(graph, seeds);
    const outcome = await this.agent.investigate(toolkit);

    // Undecided, or a hallucinated service → deterministic fallback.
    if (outcome.rootCause === null) return results;
    if (!graph.callGraph.nodes.has(outcome.rootCause)) return results;

    return promoteRootCause(results, outcome.rootCause, outcome.confidence);
  }
}

/**
 * Promote the agent's conclusion to rank 1, building a minimal result when the
 * root cause was not already in the deterministic top-K.
 */
function promoteRootCause(
  results: readonly RootCauseResult[],
  rootCause: ServiceId,
  confidence: number,
): RootCauseResult[] {
  const existing = results.find((r) => r.serviceId === rootCause);
  const promoted: RootCauseResult =
    existing ??
    ({
      serviceId: rootCause,
      faultType: { category: 'UNKNOWN', subType: 'agent_investigated', severity: 'minor' },
      confidence,
      rank: 0,
      evidenceMetrics: [],
      propagationDepth: 0,
      propagationErrorBound: 0,
      viaTreeSearch: false,
    } as RootCauseResult);

  const rest = results.filter((r) => r.serviceId !== rootCause);
  return [promoted, ...rest].slice(0, results.length).map((r, i) => ({ ...r, rank: i + 1 }));
}
