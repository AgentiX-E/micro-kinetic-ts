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
