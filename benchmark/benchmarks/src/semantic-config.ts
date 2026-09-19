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
 * Reads `ZHIPU_API_KEY` and `DEEPSEEK_API_KEY` from the environment, plus the
 * three `ZHIPU_EMBEDDING_*` overrides. When the API path cannot produce a
 * provider the local TF-IDF provider is used instead, so this ALWAYS returns a
 * provider; the topology builder therefore never has to handle "none".
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
  // `!== undefined`, not truthiness: an exported-but-EMPTY key is the CI case, and
  // the factory below already refuses it. Letting the factory decide makes the
  // `null` it returns REACHABLE -- it used to be guarded out here, which turned
  // the `?? undefined` below into an arm no test could ever take and hid the fact
  // that this factory could hand back no provider at all.
  const apiProvider =
    zhipuKey !== undefined && !forceTfIdf
      ? createApiEmbeddingFromEnv({
          vendorPrefix: 'ZHIPU',
          endpoint:
            process.env['ZHIPU_EMBEDDING_ENDPOINT'] ??
            'https://open.bigmodel.cn/api/paas/v4/embeddings',
          model: process.env['ZHIPU_EMBEDDING_MODEL'] ?? 'embedding-3',
          dimension: Number(process.env['ZHIPU_EMBEDDING_DIMENSION'] ?? '2048'),
        })
      : undefined;

  return {
    // One fallback for both reasons the API path can decline -- forced (`=1`) and
    // refused (no key) -- so a run never silently proceeds with no embedding
    // provider while every downstream number still looks computed.
    embeddingProvider: apiProvider ?? new TfIdfEmbeddingProvider(),
    // LLM fallback is not needed for embedding-based matching, so no provider is
    // set. `null` is not a legal value here: the field is optional.
    alignmentConfig: {
      embeddingThreshold: 0.6,
      llmThreshold: 0.5,
    },
  };
}
