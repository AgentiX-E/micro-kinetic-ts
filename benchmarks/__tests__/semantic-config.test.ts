/**
 * Unit tests for the semantic configuration factory used by the RCAEval runners.
 *
 * Tests `createSemanticConfig()`'s env-variable-driven behavior:
 * - ZHIPU_API_KEY set → ApiEmbeddingProvider (Zhipu embedding-3)
 * - ZHIPU_API_KEY unset → TfIdfEmbeddingProvider (offline fallback)
 * - BENCHMARK_USE_TFIDF=1 → offline fallback even with a key present
 * - No LLM provider when not needed, and thresholds as configured
 *
 * This file previously held a hand-maintained *copy* of the factory, so it could
 * only prove that the copy agreed with itself -- and it had drifted already: it
 * asserted an `llmProvider: null` field the real factory no longer returns. It
 * now imports the real function from `benchmarks/src/semantic-config.ts`.
 *
 * NOTE: This file does NOT call the real Zhipu API. It tests the factory's
 * decision logic with mock env variables.
 *
 * @module benchmarks/__tests__/semantic-config
 */

import { ApiEmbeddingProvider } from '@agentix-e/micro-kinetic-ai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSemanticConfig } from '../src/semantic-config.js';

describe('Semantic configuration factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['ZHIPU_API_KEY'];
    delete process.env['BENCHMARK_USE_TFIDF'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('with ZHIPU_API_KEY set', () => {
    it('should create an ApiEmbeddingProvider', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      const config = await createSemanticConfig();
      const provider = config.embeddingProvider;

      expect(provider).toBeDefined();
      expect(provider?.meta?.backend).toBe('api');
      expect(provider?.meta?.requiresNetwork).toBe(true);
      expect(provider!.dimension).toBe(2048);
    });

    it('should not create an LLM provider', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      const config = await createSemanticConfig();

      // `undefined` is how the config spells "none"; `null` is not a legal value
      // for the optional field, so the factory must not produce it.
      expect(config.llmProvider).toBeUndefined();
    });

    it('should fall back to TF-IDF when BENCHMARK_USE_TFIDF=1', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      process.env['BENCHMARK_USE_TFIDF'] = '1';
      const config = await createSemanticConfig();

      expect(config.embeddingProvider?.meta?.backend).toBe('tfidf');
      expect(config.embeddingProvider?.meta?.requiresNetwork).toBe(false);
    });
  });

  describe('without ZHIPU_API_KEY', () => {
    it('should create a TfIdfEmbeddingProvider as fallback', async () => {
      const config = await createSemanticConfig();

      expect(config.embeddingProvider).toBeDefined();
      expect(config.embeddingProvider?.meta?.backend).toBe('tfidf');
      expect(config.embeddingProvider?.meta?.requiresNetwork).toBe(false);
    });

    it('should still produce valid alignment config', async () => {
      const config = await createSemanticConfig();

      expect(config.alignmentConfig).toBeDefined();
      expect(config.alignmentConfig?.embeddingThreshold).toBe(0.6);
      expect(config.alignmentConfig?.llmThreshold).toBe(0.5);
      expect(config.embeddingProvider).toBeDefined();
    });

    it('should produce embeddings locally without network', async () => {
      const config = await createSemanticConfig();

      const result = await config.embeddingProvider!.embed(['test-service']);
      expect(result.vectors).toHaveLength(1);
      expect(result.vectors[0]!.length).toBeGreaterThan(0);
    });
  });

  describe('CI fallback behavior', () => {
    it('should gracefully handle empty string key as absent', async () => {
      process.env['ZHIPU_API_KEY'] = '';

      // Empty string is falsy → use TF-IDF fallback
      const config = await createSemanticConfig();
      expect(config.embeddingProvider?.meta?.backend).toBe('tfidf');
    });

    it('should handle key being unset (CI without secrets configured)', async () => {
      // Just verify no throw
      const config = await createSemanticConfig();
      expect(config).toBeDefined();
      expect(config.embeddingProvider).toBeDefined();
    });
  });
});

describe('Semantic configuration factory — the embedding OVERRIDES', () => {
  /**
   * The three `ZHIPU_EMBEDDING_*` overrides are what make this factory usable
   * outside China mainland: `ZHIPU_EMBEDDING_ENDPOINT` is the documented switch
   * from `open.bigmodel.cn` to `api.z.ai`. None of them was covered — every test
   * above leaves them unset, so only the default arm of each `??` had ever run.
   *
   * It stayed invisible because this file was absent from the coverage
   * allow-list, so the module with tests was outside the denominator and its 50%
   * branch coverage was folded into nothing. Enrolling it is what surfaced this.
   *
   * The endpoint is not a public field, so it is verified where it is actually
   * consumed: through the provider's own `_setFetch` seam, which exists for this
   * purpose. Asserting model and dimension alone would leave the override that
   * matters most for CI unverified — and a silently dropped override is this
   * repo's most expensive recurring defect, because the provider still constructs
   * and still looks correct.
   */
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['ZHIPU_API_KEY'];
    delete process.env['BENCHMARK_USE_TFIDF'];
    delete process.env['ZHIPU_EMBEDDING_ENDPOINT'];
    delete process.env['ZHIPU_EMBEDDING_MODEL'];
    delete process.env['ZHIPU_EMBEDDING_DIMENSION'];
  });

  afterEach(() => {
    process.env = { ...process.env };
  });

  /** Run one embed call and report the URL the provider actually POSTed to. */
  async function endpointUsed(dimension: number): Promise<string> {
    const config = await createSemanticConfig();
    const provider = config.embeddingProvider;
    if (!(provider instanceof ApiEmbeddingProvider)) throw new Error('expected an API provider');
    const urls: string[] = [];
    provider._setFetch((url) => {
      urls.push(String(url));
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: [{ embedding: Array.from({ length: dimension }, () => 0.5) }] }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    });
    await provider.embed(['ts-order-service']);

    return urls[0]!;
  }

  it('sends the request to the DEFAULT endpoint when none is configured', async () => {
    process.env['ZHIPU_API_KEY'] = 'test-key';

    expect(await endpointUsed(2048)).toBe('https://open.bigmodel.cn/api/paas/v4/embeddings');
  });

  it('honours ZHIPU_EMBEDDING_ENDPOINT, which is the CI / overseas switch', async () => {
    process.env['ZHIPU_API_KEY'] = 'test-key';
    process.env['ZHIPU_EMBEDDING_ENDPOINT'] = 'https://api.z.ai/api/paas/v4/embeddings';
    process.env['ZHIPU_EMBEDDING_MODEL'] = 'embedding-3-ci';
    process.env['ZHIPU_EMBEDDING_DIMENSION'] = '8';

    expect(await endpointUsed(8)).toBe('https://api.z.ai/api/paas/v4/embeddings');

    const config = await createSemanticConfig();
    const provider = config.embeddingProvider;
    if (!(provider instanceof ApiEmbeddingProvider)) throw new Error('expected an API provider');
    expect(provider.modelId).toBe('embedding-3-ci');
    expect(provider.dimension).toBe(8);
    expect(provider.meta.name).toBe('api-embedding:embedding-3-ci');
  });

  it('honours an override of the MODEL alone, leaving the rest at their defaults', async () => {
    process.env['ZHIPU_API_KEY'] = 'test-key';
    process.env['ZHIPU_EMBEDDING_MODEL'] = 'embedding-4';

    const config = await createSemanticConfig();
    const provider = config.embeddingProvider;
    if (!(provider instanceof ApiEmbeddingProvider)) throw new Error('expected an API provider');

    expect(provider.modelId).toBe('embedding-4');
    expect(provider.dimension).toBe(2048);
    expect(await endpointUsed(2048)).toBe('https://open.bigmodel.cn/api/paas/v4/embeddings');
  });

  it('forces TF-IDF on the string "1" only, and nothing else', async () => {
    // The check is `=== '1'` rather than truthiness, so an exported `'0'` or
    // `'false'` — both of which a shell can produce — must NOT disable the API
    // path. Getting this backwards is silent: the run still succeeds, on a
    // different embedding backend, and every number moves.
    process.env['ZHIPU_API_KEY'] = 'test-key';
    for (const value of ['0', 'false', 'yes']) {
      process.env['BENCHMARK_USE_TFIDF'] = value;
      const config = await createSemanticConfig();

      expect([value, config.embeddingProvider?.meta?.backend]).toEqual([value, 'api']);
    }
  });
});

describe('Semantic configuration factory — the empty key is the CI case', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env['BENCHMARK_USE_TFIDF'];
  });

  afterEach(() => {
    process.env = { ...process.env };
  });

  it('falls back to TF-IDF when the key is exported but EMPTY', async () => {
    // A CI job with the secret unset still exports the variable, so this is the
    // common CI shape and it must not be read as "a key was configured".
    process.env['ZHIPU_API_KEY'] = '';

    const config = await createSemanticConfig();

    expect(config.embeddingProvider?.meta?.backend).toBe('tfidf');
    expect(config.embeddingProvider?.meta?.requiresNetwork).toBe(false);
  });

  it('always returns a provider, whichever way the API path declines', async () => {
    // The invariant the factory now guarantees, and the reason its `?? undefined`
    // could be deleted: an absent provider would make `hasEmbedding` false, so
    // semantic alignment would be skipped while the run still reported numbers.
    for (const env of [
      {},
      { ZHIPU_API_KEY: '' },
      { ZHIPU_API_KEY: 'k', BENCHMARK_USE_TFIDF: '1' },
    ]) {
      process.env = { ...originalEnv, ...env };
      const config = await createSemanticConfig();

      expect([JSON.stringify(env), config.embeddingProvider !== undefined]).toEqual([
        JSON.stringify(env),
        true,
      ]);
    }
  });
});
