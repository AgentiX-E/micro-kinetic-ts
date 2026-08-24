/**
 * Unit tests for the evidence-grounded LLM reranker.
 *
 * Covers the pure helpers (prompt builder, order parser, gap trigger) and the
 * provider-backed reranker with a mocked fetch, including the deterministic
 * fallback on error/timeout. No real network is touched.
 *
 * @module ai/__tests__/unit/reranker
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateEvidence } from '../../src/interfaces/reranker.js';
import { ApiChatProvider } from '../../src/providers/api-llm.js';
import { EvidenceGroundedReranker } from '../../src/providers/evidence-reranker.js';
import { createEvidenceRerankerFromEnv } from '../../src/providers/env-reranker.js';
import {
  buildRerankPrompt,
  parseRerankOrder,
  shouldRerank,
} from '../../src/providers/reranker-core.js';

// ── Helpers ───────────────────────────────────────────────

function cand(id: string, overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  return { serviceId: id, ...overrides };
}

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], model: 'test' }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const FIVE = [
  cand('a', { anomalyScore: 0.35, dominantMetric: 'workload' }),
  cand('b', { anomalyScore: 1.0, dominantMetric: 'cpu' }),
  cand('c', { anomalyScore: 0.9 }),
  cand('d', { anomalyScore: 0.8 }),
  cand('e', { anomalyScore: 0.7 }),
];

// ── buildRerankPrompt ─────────────────────────────────────

describe('buildRerankPrompt', () => {
  it('returns empty string for no candidates', () => {
    expect(buildRerankPrompt({ candidates: [] })).toBe('');
  });

  it('includes a label and the service id for each candidate', () => {
    const prompt = buildRerankPrompt({ candidates: FIVE });
    expect(prompt).toContain('[A] a');
    expect(prompt).toContain('[B] b');
    expect(prompt).toContain('[E] e');
    expect(prompt).toContain('Ranked order:');
  });

  it('caps the candidate list at MAX_RERANK_CANDIDATES', () => {
    const six = [...FIVE, cand('f')];
    const prompt = buildRerankPrompt({ candidates: six });
    expect(prompt).not.toContain('[F] f');
    expect(prompt).toContain('[E] e');
  });

  it('includes evidence pointers (metric, breakdown, log, adjacency)', () => {
    const prompt = buildRerankPrompt({
      candidates: [
        cand('x', {
          dominantMetric: 'cpu',
          metricShift: 'head=[1] tail=[0]',
          breakdown: {
            deviation: 0.5,
            trend: 0.1,
            cv: 0,
            burst: 0,
            riseRatio: 2,
            dropRatio: 0.9,
            baselineMean: 1,
          },
          deepestLogException: 'NullPointerException',
          adjacency: 'upstream=[p]',
        }),
      ],
    });
    expect(prompt).toContain('metric: cpu head=[1] tail=[0]');
    expect(prompt).toContain('deviation=0.500');
    expect(prompt).toContain('log: NullPointerException');
    expect(prompt).toContain('topology: upstream=[p]');
  });

  it('includes the optional context line', () => {
    const prompt = buildRerankPrompt({ candidates: FIVE, context: 'system=test' });
    expect(prompt).toContain('Context: system=test');
  });

  it('includes a human-readable name only when it differs from the id', () => {
    const prompt = buildRerankPrompt({
      candidates: [cand('id-1', { name: 'auth-service' }), cand('id-2', { name: 'id-2' })],
    });
    expect(prompt).toContain('[A] id-1 (auth-service)');
    expect(prompt).toContain('[B] id-2');
    expect(prompt).not.toContain('[B] id-2 (id-2)');
  });
});

// ── parseRerankOrder ──────────────────────────────────────

describe('parseRerankOrder', () => {
  it('maps labels to service ids in response order', () => {
    expect(parseRerankOrder('B\nA\nC\nD\nE', FIVE)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('is case-insensitive', () => {
    expect(parseRerankOrder('b a c d e', FIVE)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('appends candidates whose labels the model omitted, preserving input order', () => {
    expect(parseRerankOrder('B\nC', FIVE)).toEqual(['b', 'c', 'a', 'd', 'e']);
  });

  it('returns the input order for an empty or unparseable response', () => {
    expect(parseRerankOrder('', FIVE)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(parseRerankOrder('zzz', FIVE)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('de-duplicates repeated labels', () => {
    expect(parseRerankOrder('B\nB\nA', FIVE)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('returns empty for empty candidates', () => {
    expect(parseRerankOrder('A', [])).toEqual([]);
  });
});

// ── shouldRerank ──────────────────────────────────────────

describe('shouldRerank', () => {
  it('triggers when the top-1/top-2 gap is below the threshold', () => {
    expect(shouldRerank([1.0, 0.9, 0.8], 0.2)).toBe(true);
  });

  it('does not trigger when the gap meets the threshold', () => {
    expect(shouldRerank([1.0, 0.7, 0.6], 0.2)).toBe(false);
  });

  it('does not trigger with fewer than two scores', () => {
    expect(shouldRerank([1.0], 0.2)).toBe(false);
    expect(shouldRerank([], 0.2)).toBe(false);
  });

  it('does not trigger with a non-positive threshold', () => {
    expect(shouldRerank([1.0, 0.9], 0)).toBe(false);
    expect(shouldRerank([1.0, 0.9], -1)).toBe(false);
  });
});

// ── ApiChatProvider ───────────────────────────────────────

describe('ApiChatProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the assistant content on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('B\nA'));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    const out = await provider.complete([{ role: 'user', content: 'hi' }]);
    expect(out).toBe('B\nA');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse('rate limited', 429))
      .mockResolvedValueOnce(chatResponse('ok'));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    const out = await provider.complete([{ role: 'user', content: 'hi' }], { maxAttempts: 3 });
    expect(out).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting retries on persistent 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('limited', 429));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await expect(
      provider.complete([{ role: 'user', content: 'hi' }], { maxAttempts: 2 }),
    ).rejects.toThrow(/429/);
  });

  it('throws on a non-retryable HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('bad request', 400));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await expect(provider.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(/400/);
  });

  it('throws on an empty completion content', async () => {
    // A fresh Response per call: the provider retries the malformed response,
    // and a shared Response body can only be read once.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(chatResponse('')));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await expect(
      provider.complete([{ role: 'user', content: 'hi' }], { maxAttempts: 1 }),
    ).rejects.toThrow(/Invalid LLM API response/);
  });

  it('throws a timeout error on abort', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await expect(
      provider.complete([{ role: 'user', content: 'hi' }], { timeoutMs: 10 }),
    ).rejects.toThrow(/timeout/);
  });

  it('honours the maxTokens option in the request body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('ok'));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await provider.complete([{ role: 'user', content: 'hi' }], { maxTokens: 128 });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      max_tokens?: number;
    };
    expect(body.max_tokens).toBe(128);
  });

  it('wraps a non-Error rejection into an Error', async () => {
    const fetchMock = vi.fn().mockRejectedValue('network string failure');
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);

    await expect(
      provider.complete([{ role: 'user', content: 'hi' }], { maxAttempts: 1 }),
    ).rejects.toThrow('network string failure');
  });
});

// ── EvidenceGroundedReranker ──────────────────────────────

describe('EvidenceGroundedReranker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('re-ranks candidates according to the model response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('B\nA\nC\nD\nE'));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);
    const reranker = new EvidenceGroundedReranker(provider);

    const result = await reranker.rerank({ candidates: FIVE });
    expect(result.order).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(result.reasoning).toBe('B\nA\nC\nD\nE');
  });

  it('falls back to input order when the provider throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);
    const reranker = new EvidenceGroundedReranker(provider);

    const result = await reranker.rerank({ candidates: FIVE });
    expect(result.order).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('returns the single candidate without calling the provider', async () => {
    const fetchMock = vi.fn();
    const provider = new ApiChatProvider({
      endpoint: 'https://example.com/chat/completions',
      model: 'deepseek-chat',
    });
    provider._setFetch(fetchMock as unknown as typeof fetch);
    const reranker = new EvidenceGroundedReranker(provider);

    const result = await reranker.rerank({ candidates: [cand('only')] });
    expect(result.order).toEqual(['only']);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ── createEvidenceRerankerFromEnv ─────────────────────────

describe('createEvidenceRerankerFromEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns null when the API key is not set', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    expect(createEvidenceRerankerFromEnv()).toBeNull();
  });

  it('returns a reranker when the API key is set', () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    const reranker = createEvidenceRerankerFromEnv();
    expect(reranker).not.toBeNull();
    expect(reranker!.modelId).toBe('deepseek-chat');
  });

  it('honours a custom env var name and model', () => {
    vi.stubEnv('CUSTOM_KEY', 'test-key');
    const reranker = createEvidenceRerankerFromEnv({
      apiKeyEnv: 'CUSTOM_KEY',
      model: 'custom-model',
    });
    expect(reranker).not.toBeNull();
    expect(reranker!.modelId).toBe('custom-model');
  });
});
