/**
 * Unit tests for the graph-guided InvestigatorEngine wrapper.
 *
 * Verifies the gap-trigger contract, the promote-to-top-1 behaviour (both for
 * a new root cause and one already in the top-K), and the deterministic
 * fallback on an undecided or hallucinated conclusion. The inner engine and the
 * agent are stubs — no network.
 *
 * @module benchmarks/__tests__/investigator-engine
 */

import type { InvestigatorAgent } from '@agentix-e/micro-kinetic-ai';
import type {
  FaultPropagationGraph,
  IRCAEngine,
  RootCauseResult,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it, vi } from 'vitest';
import { InvestigatorEngine } from '../src/investigator-engine.js';

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

/** A 2-node graph: src → sym, with a logic-exception symptom (code-level fault). */
function minimalGraph(): FaultPropagationGraph {
  return {
    callGraph: {
      nodes: new Map([
        ['src', { id: 'src', name: 'auth', namespace: 'ns', labels: {} }],
        ['sym', { id: 'sym', name: 'order', namespace: 'ns', labels: {} }],
      ]),
      edges: [{ from: 'src', to: 'sym', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 }],
      systemLoad: 0.5,
    },
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map([
      ['src', 0.3],
      ['sym', 1.0],
    ]),
    deepestExceptions: new Map([['sym', 'MalformedJwtException']]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

/** A 3-node graph: src → sym1 and src → sym2 (for a root cause outside top-K). */
function threeNodeGraph(): FaultPropagationGraph {
  return {
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
    deepestExceptions: new Map([['sym1', 'MalformedJwtException']]),
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

function stubAgent(rootCause: string | null, confidence = 0.8): InvestigatorAgent {
  return {
    modelId: 'stub',
    investigate: vi.fn(async () => ({
      rootCause,
      confidence,
      reasoning: '',
      hopsUsed: 0,
      termination: rootCause === null ? 'invalid' : 'answer',
    })),
  };
}

// ── Tests ─────────────────────────────────────────────────

describe('InvestigatorEngine', () => {
  it('promotes an existing top-K member to rank 1 when the gap is narrow', async () => {
    const agent = stubAgent('sym');
    const engine = new InvestigatorEngine(
      innerEngine([result('src', 0.9, 1), result('sym', 0.95, 2)]),
      agent,
      0.2,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym', 'src']);
    expect(out[0]!.rank).toBe(1);
    expect(agent.investigate).toHaveBeenCalledTimes(1);
  });

  it('promotes a NEW root cause (outside top-K) by building a minimal result', async () => {
    const agent = stubAgent('src', 0.6);
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      agent,
      0.2,
    );

    const out = await engine.analyze(threeNodeGraph(), 2);
    // 'src' was NOT in the deterministic top-K; it is promoted to rank 1.
    expect(out.map((r) => r.serviceId)).toEqual(['src', 'sym1']);
    expect(out[0]!.confidence).toBe(0.6); // the agent's confidence
    expect(out[0]!.faultType.subType).toBe('agent_investigated');
  });

  it('returns the deterministic order when the agent is undecided', async () => {
    const agent = stubAgent(null);
    const engine = new InvestigatorEngine(
      innerEngine([result('sym', 1.0, 1), result('src', 0.95, 2)]),
      agent,
      0.2,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym', 'src']);
  });

  it('returns the deterministic order on a hallucinated root cause', async () => {
    const agent = stubAgent('ghost');
    const engine = new InvestigatorEngine(
      innerEngine([result('sym', 1.0, 1), result('src', 0.95, 2)]),
      agent,
      0.2,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym', 'src']);
    // The hallucinated conclusion is recorded but NOT promoted: `promoted`
    // stays false, so the effective final answer remains the baseline top-1.
    expect(engine.decisions[0]).toMatchObject({
      baselineTop1: 'sym',
      agentRootCause: 'ghost',
      triggered: true,
      changed: false,
      promoted: false,
      termination: 'answer',
    });
  });

  it('skips the agent when the top-1/top-2 gap meets the threshold', async () => {
    const agent = stubAgent('src');
    const engine = new InvestigatorEngine(
      innerEngine([result('sym', 0.6, 1), result('src', 0.4, 2)]),
      agent,
      0.1,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym', 'src']);
    expect(agent.investigate).not.toHaveBeenCalled();
  });

  it('returns early for a single result without consulting the agent', async () => {
    const agent = stubAgent('src');
    const engine = new InvestigatorEngine(innerEngine([result('sym', 1.0, 1)]), agent, 0.1);

    const out = await engine.analyze(minimalGraph(), 1);
    expect(out.map((r) => r.serviceId)).toEqual(['sym']);
    expect(agent.investigate).not.toHaveBeenCalled();
  });

  it('returns the deterministic order when the agent is null', async () => {
    const engine = new InvestigatorEngine(
      innerEngine([result('sym', 1.0, 1), result('src', 0.95, 2)]),
      null,
      0.2,
    );

    const out = await engine.analyze(minimalGraph(), 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym', 'src']);
  });

  it('delegates buildFaultGraph and getCycleContributionBound to the inner engine', () => {
    const inner = innerEngine([result('sym', 1.0, 1)]);
    const engine = new InvestigatorEngine(inner, null, 0.1);

    const graph = minimalGraph();
    engine.buildFaultGraph(graph.callGraph, new Map());
    expect(inner.buildFaultGraph).toHaveBeenCalledTimes(1);
    engine.getCycleContributionBound(graph);
    expect(inner.getCycleContributionBound).toHaveBeenCalledTimes(1);
  });

  it('tracks triggered/concluded/changed diagnostic counters', async () => {
    // Narrow gap, agent concludes a DIFFERENT root cause → all three count.
    const agent = stubAgent('src', 0.6);
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      agent,
      0.2,
    );

    await engine.analyze(threeNodeGraph(), 2);
    expect(engine.stats).toEqual({
      triggered: 1,
      concluded: 1,
      changed: 1,
      invalid: 0,
      budget: 0,
      error: 0,
    });

    // Wide gap → the agent is never consulted, triggered stays unchanged.
    const wide = new InvestigatorEngine(
      innerEngine([result('sym1', 0.6, 1), result('sym2', 0.4, 2)]),
      stubAgent('src'),
      0.1,
    );
    await wide.analyze(threeNodeGraph(), 2);
    expect(wide.stats.triggered).toBe(0);
  });

  it('counts an invalid termination in the diagnostic stats', async () => {
    const agent = stubAgent(null); // terminates 'invalid'
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      agent,
      0.2,
    );

    await engine.analyze(threeNodeGraph(), 2);
    expect(engine.stats.invalid).toBe(1);
    expect(engine.stats.concluded).toBe(0);
  });

  it('counts budget and error terminations in the diagnostic stats', async () => {
    const budgetAgent: InvestigatorAgent = {
      modelId: 'stub',
      investigate: vi.fn(async () => ({
        rootCause: null,
        confidence: 0,
        reasoning: '',
        hopsUsed: 4,
        termination: 'budget',
      })),
    };
    const budgetEngine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      budgetAgent,
      0.2,
    );
    await budgetEngine.analyze(threeNodeGraph(), 2);
    expect(budgetEngine.stats.budget).toBe(1);

    const errorAgent: InvestigatorAgent = {
      modelId: 'stub',
      investigate: vi.fn(async () => ({
        rootCause: null,
        confidence: 0,
        reasoning: '',
        hopsUsed: 0,
        termination: 'error',
      })),
    };
    const errorEngine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      errorAgent,
      0.2,
    );
    await errorEngine.analyze(threeNodeGraph(), 2);
    expect(errorEngine.stats.error).toBe(1);
  });

  it('skips the agent when there are no logic exceptions (resource fault)', async () => {
    // A graph with no deepestExceptions models a resource fault (RE1/RE2):
    // the agent is gated out and the deterministic order is returned unchanged.
    const graph = threeNodeGraph();
    delete (graph as { deepestExceptions?: unknown }).deepestExceptions;

    const agent = stubAgent('src');
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      agent,
      0.2,
    );

    const out = await engine.analyze(graph, 2);
    expect(out.map((r) => r.serviceId)).toEqual(['sym1', 'sym2']);
    expect(agent.investigate).not.toHaveBeenCalled();
    expect(engine.stats.triggered).toBe(0);
  });

  it('records a triggered decision with the agent conclusion and change flag', async () => {
    const agent = stubAgent('src', 0.6);
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 1.0, 1), result('sym2', 0.9, 2)]),
      agent,
      0.2,
    );

    await engine.analyze(threeNodeGraph(), 2);
    expect(engine.decisions).toHaveLength(1);
    expect(engine.decisions[0]).toMatchObject({
      baselineTop1: 'sym1',
      agentRootCause: 'src',
      triggered: true,
      changed: true,
      promoted: true,
      termination: 'answer',
    });
  });

  it('records a gated decision (wide gap) with triggered=false', async () => {
    const engine = new InvestigatorEngine(
      innerEngine([result('sym1', 0.6, 1), result('sym2', 0.4, 2)]),
      stubAgent('src'),
      0.1,
    );

    await engine.analyze(threeNodeGraph(), 2);
    expect(engine.decisions).toHaveLength(1);
    expect(engine.decisions[0]).toMatchObject({
      baselineTop1: 'sym1',
      agentRootCause: null,
      triggered: false,
      changed: false,
    });
  });

  it('records a decision with null baseline when the inner engine returns nothing', async () => {
    const engine = new InvestigatorEngine(
      innerEngine([]),
      stubAgent('src'),
      0.2,
    );

    await engine.analyze(minimalGraph(), 1);
    expect(engine.decisions).toHaveLength(1);
    expect(engine.decisions[0]).toMatchObject({
      baselineTop1: null,
      triggered: false,
      changed: false,
    });
  });
});
