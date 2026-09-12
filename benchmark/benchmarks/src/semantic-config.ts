/**
 * Semantic-alignment configuration for the RCAEval benchmark runners.
 *
 * Lives in its own module rather than inline in `run-rcaeval.ts` because the
 * unit tests exercise it directly. It used to be duplicated: `run-rcaeval.ts`
 * held the factory and `benchmarks/__tests__/semantic-config.test.ts` held a
 * hand-maintained copy of it, so the test could only ever prove that the copy
 * matched itself -- and it had already drifted (the copy still asserted an
 * `llmProvider: null` field the real factory no longer returns).
 *
 * NEVER contains API keys -- only environment variable names.
 *
 * @module benchmarks/semantic-config
 */

import type { SemanticEnhancerConfig } from './rcaeval-semantic.js';

/**
 * Build the semantic-alignment config from the environment.
 *
 * Reads `ZHIPU_API_KEY` and `DEEPSEEK_API_KEY` from the environment. If no
 * embedding provider can be built, semantic enhancement is disabled and the
 * topology builder falls back to exact YAML matches and ring-connect.
 */
export async function createSemanticConfig(): Promise<SemanticEnhancerConfig> {
  const { TfIdfEmbeddingProvider } = await import('@agentix-e/micro-kinetic-ai');
  const { createApiEmbeddingFromEnv } = await import('@agentix-e/micro-kinetic-ai');

  // Prefer real API embedding; fall back to TF-IDF for local-only runs.
  // ZHIPU_EMBEDDING_ENDPOINT: override the default Zhipu API endpoint.
  //   - Default: https://open.bigmodel.cn/api/paas/v4/embeddings (China mainland)
  //   - For CI / overseas runners: https://api.z.ai/api/paas/v4/embeddings
  //
  // When BENCHMARK_USE_TFIDF=1: force local TF-IDF embedding (zero network
  // dependency). Use this in CI to prevent API latency from inflating benchmark
  // runtime.
  const forceTfIdf = process.env['BENCHMARK_USE_TFIDF'] === '1';
  const zhipuKey = process.env['ZHIPU_API_KEY'];
  const embeddingProvider =
    zhipuKey && !forceTfIdf
      ? createApiEmbeddingFromEnv({
          vendorPrefix: 'ZHIPU',
          endpoint:
            process.env['ZHIPU_EMBEDDING_ENDPOINT'] ??
            'https://open.bigmodel.cn/api/paas/v4/embeddings',
          model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
          dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
        })
      : new TfIdfEmbeddingProvider();

  return {
    // `createApiEmbeddingFromEnv` returns null when it cannot build a provider
    // from the environment. `undefined` is how this config spells "none", and
    // `Boolean(undefined)` is false exactly as `Boolean(null)` was, so the
    // caller's decision is unchanged.
    embeddingProvider: embeddingProvider ?? undefined,
    // LLM fallback is not needed for embedding-based matching, so no provider is
    // set. `null` is not a legal value here: the field is optional.
    alignmentConfig: {
      embeddingThreshold: 0.6,
      llmThreshold: 0.5,
    },
  };
}
