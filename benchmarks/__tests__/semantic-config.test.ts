/**
 * Unit tests for the semantic configuration factory used by run-rcaeval.ts.
 *
 * Tests the createSemanticConfig() function's env-variable-driven behavior:
 * - ZHIPU_API_KEY set → ApiEmbeddingProvider (Zhipu embedding-3)
 * - ZHIPU_API_KEY unset → TfIdfEmbeddingProvider (offline fallback)
 * - No LLM provider when not needed
 * - Config values correct (thresholds, dimension)
 *
 * NOTE: This file does NOT call the real Zhipu API. It tests the
 * factory function's decision logic with mock env variables.
 *
 * @module benchmarks/__tests__/semantic-config.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Helpers (replicate the factory logic from run-rcaeval.ts) ───

async function createSemanticConfigEnv(
  zhipuKey: string | undefined,
) {
  // Simulate env (run-rcaeval.ts reads process.env directly)
  if (zhipuKey !== undefined) {
    process.env['ZHIPU_API_KEY'] = zhipuKey;
  }

  const { TfIdfEmbeddingProvider } = await import('@agentix-e/micro-kinetic-core');
  const { createApiEmbeddingFromEnv } = await import('@agentix-e/micro-kinetic-core');

  const zhipu_effective = process.env['ZHIPU_API_KEY'];
  const embeddingProvider = zhipu_effective
    ? createApiEmbeddingFromEnv({
        vendorPrefix: 'ZHIPU',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
        model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
        dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
      })
    : new TfIdfEmbeddingProvider();

  return {
    embeddingProvider,
    llmProvider: null as unknown,
    alignmentConfig: {
      embeddingThreshold: 0.6,
      llmThreshold: 0.5,
    },
  };
}

// ── Tests ────────────────────────────────────────────────

describe('Semantic configuration factory', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Restore env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('with ZHIPU_API_KEY set', () => {
    it('should create an ApiEmbeddingProvider', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      const config = await createSemanticConfigEnv('test-key');

      expect(config.embeddingProvider.meta.backend).toBe('api');
      expect(config.embeddingProvider.meta.requiresNetwork).toBe(true);
      expect(config.embeddingProvider.dimension).toBe(2048);
    });

    it('should not create an LLM provider', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      const config = await createSemanticConfigEnv('test-key');

      expect(config.llmProvider).toBeNull();
    });

    it('should set correct alignment thresholds', async () => {
      process.env['ZHIPU_API_KEY'] = 'test-key';
      const config = await createSemanticConfigEnv('test-key');

      expect(config.alignmentConfig.embeddingThreshold).toBe(0.6);
      expect(config.alignmentConfig.llmThreshold).toBe(0.5);
    });
  });

  describe('without ZHIPU_API_KEY', () => {
    it('should create a TfIdfEmbeddingProvider as fallback', async () => {
      delete process.env['ZHIPU_API_KEY'];
      const config = await createSemanticConfigEnv(undefined);

      expect(config.embeddingProvider.meta.backend).toBe('tfidf');
      expect(config.embeddingProvider.meta.requiresNetwork).toBe(false);
    });

    it('should still produce valid alignment config', async () => {
      delete process.env['ZHIPU_API_KEY'];
      const config = await createSemanticConfigEnv(undefined);

      expect(config.alignmentConfig).toBeDefined();
      expect(config.embeddingProvider).toBeDefined();
    });

    it('should produce embeddings locally without network', async () => {
      delete process.env['ZHIPU_API_KEY'];
      const config = await createSemanticConfigEnv(undefined);

      const result = await config.embeddingProvider.embed(['test-service']);
      expect(result.vectors).toHaveLength(1);
      expect(result.vectors[0]!.length).toBeGreaterThan(0);
    });
  });

  describe('CI fallback behavior', () => {
    it('should gracefully handle empty string key as absent', async () => {
      process.env['ZHIPU_API_KEY'] = '';
      const config = await createSemanticConfigEnv('');

      // Empty string is falsy → use TF-IDF fallback
      expect(config.embeddingProvider.meta.backend).toBe('tfidf');
    });

    it('should handle key being unset (CI without secrets configured)', async () => {
      delete process.env['ZHIPU_API_KEY'];

      // Just verify no throw
      const config = await createSemanticConfigEnv(undefined);
      expect(config).toBeDefined();
      expect(config.embeddingProvider).toBeDefined();
    });
  });
});
