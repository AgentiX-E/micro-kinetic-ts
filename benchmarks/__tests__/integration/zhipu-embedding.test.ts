/**
 * Integration test: Zhipu GLM embedding-3 API connectivity.
 *
 * Validates that the ApiEmbeddingProvider correctly communicates with
 * the Zhipu API endpoint using the openai-compatible format.
 *
 * Tests are skipped when no .env file is present or ZHIPU_API_KEY is
 * not set — no test failure in CI/offline environments.
 *
 * API key is read from process.env only; never appears in this file.
 *
 * @module benchmarks/__tests__/integration/zhipu-embedding.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ApiEmbeddingProvider } from '@agentix-e/micro-kinetic-core';
import { cosineSimilarity } from '@agentix-e/micro-kinetic-core';
import { createApiEmbeddingFromEnv } from '@agentix-e/micro-kinetic-core';

// ── Skip Check ───────────────────────────────────────────

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const runIntegration = Boolean(ZHIPU_API_KEY);

const describeIf = runIntegration ? describe : describe.skip;

// ── Test Fixture ─────────────────────────────────────────

const ZHIPU_CONFIG = {
  vendorPrefix: 'ZHIPU' as const,
  endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
  model: process.env.ZHIPU_EMBEDDING_MODEL ?? 'embedding-3',
  dimension: Number(process.env.ZHIPU_EMBEDDING_DIMENSION ?? '2048'),
} as const;

// ── Tests ────────────────────────────────────────────────

describeIf('Zhipu embedding-3 API integration', () => {
  let provider: ApiEmbeddingProvider;

  beforeAll(() => {
    provider = createApiEmbeddingFromEnv(ZHIPU_CONFIG);
  });

  it('should connect to Zhipu API and return embeddings', async () => {
    const result = await provider.embed(['order-service', 'payment-service']);
    expect(result.vectors).toHaveLength(2);
    for (const vec of result.vectors) {
      expect(vec.length).toBe(2048);
    }
  });

  it('should produce normalized vectors (L2 ≈ 1)', async () => {
    const result = await provider.embed(['ts-order-service', 'ts-payment-service']);
    for (const vec of result.vectors) {
      // By default, ApiEmbeddingProvider normalizes with L2
      // Check that norm is approximately 1
      let sumSq = 0;
      for (const val of vec) {
        sumSq += val * val;
      }
      const norm = Math.sqrt(sumSq);
      expect(norm).toBeCloseTo(1, 4);
    }
  });

  it('should produce high cosine similarity for related services', async () => {
    const result = await provider.embed([
      'ts-order-service',
      'order-service',
      'ts-payment-service',
      'payment-service',
    ]);
    // Same concept, different naming convention → high similarity
    const simOrder = cosineSimilarity(result.vectors[0]!, result.vectors[1]!);
    const simPayment = cosineSimilarity(result.vectors[2]!, result.vectors[3]!);

    expect(simOrder).toBeGreaterThan(0.7);
    expect(simPayment).toBeGreaterThan(0.7);
  });

  it('should produce distinct embeddings for unrelated services', async () => {
    const result = await provider.embed([
      'ts-order-service',
      'ts-seat-service',
    ]);
    const sim = cosineSimilarity(result.vectors[0]!, result.vectors[1]!);
    // Different concepts, same prefix → moderate similarity
    expect(sim).toBeLessThan(0.95);
  });

  it('should handle batch with valid dimension', async () => {
    const result = await provider.embed([
      'order-service',
      'payment-service',
      'user-service',
      'auth-service',
      'train-service',
    ]);
    expect(result.vectors).toHaveLength(5);
    expect(result.vectors[0]!.length).toBe(2048);
  });

  it('should match provider metadata', () => {
    expect(provider.meta.backend).toBe('api');
    expect(provider.meta.requiresNetwork).toBe(true);
    expect(provider.dimension).toBe(2048);
  });
});
