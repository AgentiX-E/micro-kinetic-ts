import { afterEach, describe, expect, it, vi } from 'vitest';
import { LLMAdvisor } from '../../src/llm-advisor.js';
import type { SystemContext } from '../../src/types.js';
import type { RCAConfiguration } from '../../src/config-space.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeCtx(overrides?: Partial<SystemContext>): SystemContext {
  return {
    serviceCount: 10,
    graphDensity: 0.2,
    degreeCV: 0.5,
    maxDepth: 3,
    traceCoverage: 0,
    metricCV: 0.4,
    spikeDominanceRatio: 0.3,
    anomalyConcentration: 0.4,
    systemLoad: 0.5,
    faultTypeCount: 5,
    avgCasesPerType: 10,
    ...overrides,
  };
}

function makeCfg(overrides?: Partial<RCAConfiguration['continuous'] & RCAConfiguration['discrete']>): RCAConfiguration {
  return {
    continuous: {
      decayAlpha: overrides?.decayAlpha ?? 0.8,
      pruneEpsilon: overrides?.pruneEpsilon ?? 0.001,
      temporalBonus: overrides?.temporalBonus ?? 0.15,
      defaultWeight: overrides?.defaultWeight ?? 0.05,
      childContributionCap: overrides?.childContributionCap ?? 1.0,
    },
    ranking: {
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1.0,
      traceWeight: 0,
    },
    discrete: {
      baselineStrategy: overrides?.baselineStrategy ?? 'auto',
      correlationMethod: overrides?.correlationMethod ?? 'pearson',
      propagationMode: overrides?.propagationMode ?? 'additive',
      enableCollisionAggregation: overrides?.enableCollisionAggregation ?? true,
      useTemporalCausality: overrides?.useTemporalCausality ?? true,
    },
  };
}

/** Stub the global fetch with a controlled DeepSeek-compatible response. */
function stubFetch(payload: string, status = 200): ReturnType<typeof vi.fn> {
  const res = new Response(payload, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
  const fetchMock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Build the full DeepSeek completion body for the given assistant content. */
function completionBody(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

/** Extract the `user` prompt sent to the LLM from the (mock) fetch call. */
function lastUserPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
  const init = fetchMock.mock.calls.at(-1)![1] as { body: string };
  const body = JSON.parse(init.body) as {
    messages: Array<{ role: string; content: string }>;
  };
  return body.messages.find((m) => m.role === 'user')!.content;
}

describe('LLMAdvisor', () => {
  it('should create with default options', () => {
    const advisor = new LLMAdvisor();
    expect(advisor.callsThisCycle).toBe(0);
  });

  it('should fallback to uniform ranking when no API key', async () => {
    // Delete API key if set
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    const advisor = new LLMAdvisor();
    const result = await advisor.rank(
      [],
      [makeCfg(), makeCfg({ decayAlpha: 0.9 })],
      makeCtx(),
    );

    // Should get uniform ranking (no API call possible)
    expect(result.ranking).toHaveLength(2);
    expect(result.confidence).toBe(0);
    expect(result.fromCache).toBe(false);
    expect(result.reasoning).toContain('DEEPSEEK');

    // Restore
    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should respect max calls per cycle', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 2 });
    // First call: budget ok (but will fail on API since no key = fallback)
    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(1);

    // Second call
    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(2);

    // Third call: should be budget-exhausted fallback, callCount stays at 2
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());
    if (saved) process.env.DEEPSEEK_API_KEY = saved;

    expect(advisor.callsThisCycle).toBe(2);
    expect(result.reasoning).toContain('Budget exhausted');
  });

  it('should reset cycle counter', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 2 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(1);

    advisor.resetCycle();
    expect(advisor.callsThisCycle).toBe(0);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should provide consistent fallback output', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 5 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    // Multiple identical calls should return same ranking (fallback path)
    const r1 = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.74 }],
      [makeCfg()],
      makeCtx(),
    );
    const r2 = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.74 }],
      [makeCfg()],
      makeCtx(),
    );

    // Both should return uniform ranking with 0 confidence (fallback)
    expect(r1.confidence).toBe(0);
    expect(r2.confidence).toBe(0);
    expect(r1.ranking).toEqual(r2.ranking);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should handle empty candidates gracefully', async () => {
    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [], makeCtx());
    expect(result.ranking).toHaveLength(0);
  });

  it('should handle large experiment history', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 10 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    const history = Array.from({ length: 20 }, (_, i) => ({
      config: makeCfg({ decayAlpha: 0.5 + i * 0.02 }),
      accuracy: 0.5 + i * 0.02,
    }));

    const result = await advisor.rank(history, [makeCfg(), makeCfg()], makeCtx());
    expect(result.ranking).toHaveLength(2);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });
});

describe('LLMAdvisor API path (controlled fetch)', () => {
  it('ranks candidates from a successful API response', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = stubFetch(
      completionBody(
        JSON.stringify({ ranking: [1, 0], reasoning: 'r2 dominates', confidence: 0.9 }),
      ),
    );

    const advisor = new LLMAdvisor();
    const result = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.74 }],
      [makeCfg(), makeCfg({ decayAlpha: 0.9 })],
      makeCtx(),
    );

    expect(result.fromCache).toBe(false);
    expect(result.ranking).toEqual([1, 0]);
    expect(result.reasoning).toBe('r2 dominates');
    expect(result.confidence).toBe(0.9);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(advisor.callsThisCycle).toBe(1);

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('serves a cache hit without a second network call', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = stubFetch(
      completionBody(JSON.stringify({ ranking: [1, 0], reasoning: 'cached', confidence: 0.8 })),
    );

    const advisor = new LLMAdvisor({ cacheTTL: 60_000 });
    const history = [{ config: makeCfg(), accuracy: 0.7 }];
    const candidates = [makeCfg(), makeCfg({ decayAlpha: 0.9 })];
    const ctx = makeCtx();

    const r1 = await advisor.rank(history, candidates, ctx);
    const r2 = await advisor.rank(history, candidates, ctx);

    expect(r1.fromCache).toBe(false);
    expect(r2.fromCache).toBe(true);
    expect(r2.ranking).toEqual([1, 0]);
    expect(r2.reasoning).toBe('cached');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('includes experiment history in the prompt when present', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = stubFetch(
      completionBody(JSON.stringify({ ranking: [0, 1], reasoning: 'ok', confidence: 0.7 })),
    );

    const advisor = new LLMAdvisor();
    await advisor.rank(
      [{ config: makeCfg({ decayAlpha: 0.82 }), accuracy: 0.74 }],
      [makeCfg(), makeCfg()],
      makeCtx(),
    );

    const prompt = lastUserPrompt(fetchMock);
    expect(prompt).toContain('Experiment history');
    expect(prompt).toContain('74.0%');
    expect(prompt).not.toContain('No experiment history');

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('emits the no-history prompt on the first iteration', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = stubFetch(
      completionBody(JSON.stringify({ ranking: [0, 1], reasoning: 'ok', confidence: 0.7 })),
    );

    const advisor = new LLMAdvisor();
    await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());

    const prompt = lastUserPrompt(fetchMock);
    expect(prompt).toContain('No experiment history yet');
    expect(prompt).not.toContain('Experiment history (config');

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('falls back to uniform ranking when the LLM returns an invalid ranking', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    // Ranking omits an index and duplicates another — not a permutation.
    stubFetch(completionBody(JSON.stringify({ ranking: [0, 0], reasoning: 'bad', confidence: 0.9 })));

    const advisor = new LLMAdvisor();
    const result = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.7 }],
      [makeCfg(), makeCfg()],
      makeCtx(),
    );

    expect(result.confidence).toBe(0);
    expect(result.fromCache).toBe(false);
    expect(result.reasoning).toContain('API error');

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('clamps out-of-range confidence and defaults missing reasoning', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const fetchMock = stubFetch(
      completionBody(JSON.stringify({ ranking: [0, 1], confidence: 1.7 })),
    );

    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());

    expect(result.confidence).toBe(1.0); // clamped to [0, 1]
    expect(result.reasoning).toBe('No reasoning provided');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('defaults a zero confidence to 0.5', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    stubFetch(completionBody(JSON.stringify({ ranking: [0, 1], reasoning: 'x', confidence: 0 })));

    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());

    expect(result.confidence).toBe(0.5);

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('falls back to uniform ranking on an HTTP error response', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    stubFetch('rate limited', 429);

    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());

    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('HTTP 429');

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('reports API errors through the progress callback', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    stubFetch('server exploded', 500);
    const messages: string[] = [];
    const advisor = new LLMAdvisor({ onProgress: (m) => messages.push(m) });

    await advisor.rank([], [makeCfg()], makeCtx());

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain('LLM advisor error');

    delete process.env.DEEPSEEK_API_KEY;
  });

  it('handles a non-Error rejection from the network layer', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    // A rejecting fetch with a non-Error reason exercises the String(err)
    // fallback in the error-message formatting.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('network down'));

    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());

    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('network down');

    delete process.env.DEEPSEEK_API_KEY;
  });
});
