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

import type {
  InvestigationTermination,
  InvestigatorAgent,
} from '../../packages/ai/src/index.js';
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
 * Maximum ReAct hops per investigation. A code-level fault is found within a
 * couple of upstream steps (symptom → upstream producer → evidence → answer),
 * so the budget is kept small to bound the LLM cost per case.
 */
const MAX_AGENT_HOPS = 4;

/**
 * One per-case decision record, captured for EVERY `analyze` call made while an
 * agent is wired in (one entry per call, in call order). This lets the ablation
 * runner zip the decisions against its own per-case ground-truth list and build
 * a confusion matrix (wrong→correct vs wrong→wrong vs correct→wrong), which is
 * the only way to tell whether the agent's `changed` conclusions actually move
 * toward the true root cause or just shuffle one wrong symptom for another.
 */
export interface InvestigatorDecision {
  /** The deterministic top-1 the agent was handed (null only when no result). */
  readonly baselineTop1: ServiceId | null;
  /** The agent's concluded root cause, or null when it did not conclude. */
  readonly agentRootCause: string | null;
  /** Whether the agent fired at all for this case (passed the gates). */
  readonly triggered: boolean;
  /** Whether the conclusion differs from the deterministic top-1. */
  readonly changed: boolean;
  /**
   * Whether `agentRootCause` was actually promoted to top-1. False when the
   * agent hallucinated a service not in the call graph — the conclusion is
   * then discarded and the deterministic top-1 is kept, so the EFFECTIVE
   * final answer remains `baselineTop1` (not the hallucinated name).
   */
  readonly promoted: boolean;
  /** Why the investigation loop stopped (invalid when it never fired). */
  readonly termination: InvestigationTermination;
  /** The agent's free-text reasoning chain (empty when it never fired). */
  readonly reasoning: string;
}

/**
 * Wraps a deterministic engine with an optional graph-guided investigator.
 */
export class InvestigatorEngine implements IRCAEngine {
  /**
   * Diagnostic counters, aggregated by the ablation runner to tell whether the
   * agent is firing at all (`triggered`), reaching a conclusion (`concluded`),
   * actually changing the deterministic top-1 (`changed`), or why it stopped
   * without a conclusion (`invalid` / `budget` / `error`).
   */
  public readonly stats = {
    triggered: 0,
    concluded: 0,
    changed: 0,
    invalid: 0,
    budget: 0,
    error: 0,
  };

  /**
   * Per-case decision trace, one entry per `analyze` call (in call order) while
   * an agent is wired in. Alignment with the caller's per-case ground-truth list
   * is by index, so every `analyze` call — including the early-return gates —
   * records exactly one entry. Diagnostic-only: never a ranking input.
   */
  public readonly decisions: InvestigatorDecision[] = [];

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

    if (!this.agent) return results;

    // One decision record per analyze call (in call order) — even for the
    // early-return gates — so the ablation runner can zip this trace against
    // its per-case ground-truth list by index. The fields are accumulated as
    // mutable locals and snapshotted into a fresh record at each exit point.
    const baselineTop1 = results[0]?.serviceId ?? null;
    let agentRootCause: string | null = null;
    let triggered = false;
    let changed = false;
    let promoted = false;
    let termination: InvestigationTermination = 'invalid';
    let reasoning = '';
    const record = (): void => {
      this.decisions.push({
        baselineTop1,
        agentRootCause,
        triggered,
        changed,
        promoted,
        termination,
        reasoning,
      });
    };

    if (results.length < 2) {
      record();
      return results;
    }

    // The agent targets CODE-LEVEL faults: a silent source hides behind a
    // logic-exception symptom (e.g. TrainTicket RE3's MalformedJwtException).
    // Resource faults (RE1/RE2) emit only connectivity exceptions — no logic
    // exception — and the deterministic signals already rank them, so the agent
    // is skipped there (avoids both the cost and the regression risk).
    if (!graph.deepestExceptions || graph.deepestExceptions.size === 0) {
      record();
      return results;
    }

    if (
      !shouldRerank(
        results.map((r) => r.confidence),
        this.gapThreshold,
      )
    ) {
      record();
      return results;
    }

    this.stats.triggered++;
    triggered = true;

    // Seed the toolkit with the deterministic top-K and let the agent walk the
    // graph upstream from those symptoms.
    const seeds = results.map((r) => r.serviceId);
    const toolkit = new GraphInvestigatorToolkit(graph, seeds, MAX_AGENT_HOPS);
    const outcome = await this.agent.investigate(toolkit);

    agentRootCause = outcome.rootCause;
    termination = outcome.termination;
    reasoning = outcome.reasoning;

    // Track WHY the agent stopped without a conclusion.
    if (outcome.termination === 'invalid') this.stats.invalid++;
    else if (outcome.termination === 'budget') this.stats.budget++;
    else if (outcome.termination === 'error') this.stats.error++;

    // Undecided, or a hallucinated service → deterministic fallback.
    if (outcome.rootCause === null) {
      record();
      return results;
    }
    if (!graph.callGraph.nodes.has(outcome.rootCause)) {
      record();
      return results;
    }

    this.stats.concluded++;
    if (outcome.rootCause !== results[0]!.serviceId) {
      this.stats.changed++;
      changed = true;
    }
    promoted = true;

    record();
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
