/**
 * Unit tests for the ReAct investigator agent (GALA+ phase-III).
 *
 * Covers the bounded Thought/Action/Observation loop with a SCRIPTED mock
 * provider (no network, no DeepSeek): a successful multi-hop walk, and the
 * deterministic fallback on provider failure / unparseable response / hop-budget
 * exhaustion. The agent must never throw.
 *
 * @module ai/__tests__/unit/investigator-agent
 */

import type { FaultPropagationGraph } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it, vi } from 'vitest';
import { ReActInvestigatorAgent } from '../../src/agent/investigator-agent.js';
import { GraphInvestigatorToolkit } from '../../src/agent/investigator-toolkit.js';
import type { IChatProvider } from '../../src/providers/api-llm.js';

// ── Helpers ───────────────────────────────────────────────

function graph(): FaultPropagationGraph {
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
    dominantMetrics: new Map([
      ['src', { label: 'workload', head: [0.4], tail: [1.4], transientSkipped: [] }],
      ['sym', { label: 'cpu', head: [3.5], tail: [0.05], transientSkipped: [] }],
    ]),
    deepestExceptions: new Map([['sym', 'MalformedJwtException']]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

/** A provider that replays a scripted sequence of responses (last one repeats). */
function scriptedProvider(responses: string[], modelId = 'mock'): IChatProvider {
  let i = 0;
  return {
    modelId,
    complete: vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)] ?? '';
      i++;
      return r;
    }),
  };
}

const ANSWER = (rootCause: string, confidence: number): string =>
  `{"answer": {"rootCause": "${rootCause}", "confidence": ${confidence}, "reasoning": "upstream producer"}}`;

// ── Tests ─────────────────────────────────────────────────

describe('ReActInvestigatorAgent', () => {
  it('walks upstream and concludes with the source', async () => {
    const provider = scriptedProvider([
      '{"action": "get_upstream", "serviceId": "sym"}',
      '{"action": "get_evidence", "serviceId": "src"}',
      ANSWER('src', 0.8),
    ]);
    const agent = new ReActInvestigatorAgent(provider);
    const toolkit = new GraphInvestigatorToolkit(graph(), ['sym'], 6);

    const result = await agent.investigate(toolkit);

    expect(result.rootCause).toBe('src');
    expect(result.confidence).toBe(0.8);
    expect(result.hopsUsed).toBe(2);
    expect(provider.complete).toHaveBeenCalledTimes(3);
  });

  it('returns null root cause when the provider throws', async () => {
    const provider: IChatProvider = {
      modelId: 'mock',
      complete: vi.fn(async () => {
        throw new Error('network');
      }),
    };
    const agent = new ReActInvestigatorAgent(provider);
    const toolkit = new GraphInvestigatorToolkit(graph(), ['sym'], 6);

    const result = await agent.investigate(toolkit);
    expect(result.rootCause).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('returns null root cause on an unparseable response', async () => {
    const provider = scriptedProvider(['this is not JSON']);
    const agent = new ReActInvestigatorAgent(provider);
    const toolkit = new GraphInvestigatorToolkit(graph(), ['sym'], 6);

    const result = await agent.investigate(toolkit);
    expect(result.rootCause).toBeNull();
    expect(result.hopsUsed).toBe(0);
  });

  it('returns null root cause when the hop budget is exhausted', async () => {
    // Always asks for evidence, never answers → budget runs out.
    const provider = scriptedProvider(['{"action": "get_evidence", "serviceId": "sym"}']);
    const agent = new ReActInvestigatorAgent(provider);
    const toolkit = new GraphInvestigatorToolkit(graph(), ['sym'], 2);

    const result = await agent.investigate(toolkit);
    expect(result.rootCause).toBeNull();
    expect(result.hopsUsed).toBe(2);
    expect(toolkit.remainingHops()).toBe(0);
  });

  it('exposes the provider modelId', () => {
    const provider = scriptedProvider([]);
    expect(new ReActInvestigatorAgent(provider).modelId).toBe('mock');
  });
});
