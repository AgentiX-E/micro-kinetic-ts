/**
 * Environment-based embedding provider factory helpers.
 *
 * Provides vendor-agnostic factory functions that read API configuration
 * from environment variables. NO vendor-specific code or API keys here —
 * everything is driven by the caller's environment.
 *
 * Safe to commit: only generic env var names (ZHIPU_API_KEY, DEEPSEEK_API_KEY, etc.)
 * are referenced as documentation. Actual keys come from `.env` (gitignored).
 *
 * Usage in user code:
 * ```typescript
 * import { createApiEmbeddingFromEnv } from '@agentix-e/micro-kinetic-ai';
 *
 * const provider = createApiEmbeddingFromEnv('ZHIPU', {
 *   endpoint: process.env.ZHIPU_EMBEDDING_ENDPOINT!,
 *   model: process.env.ZHIPU_EMBEDDING_MODEL!,
 *   dimension: Number(process.env.ZHIPU_EMBEDDING_DIMENSION!),
 * });
 * ```
 *
 * @module ai/providers
 */

import { ApiEmbeddingProvider } from './api-embedding.js';

/**
 * Configuration for createApiEmbeddingFromEnv.
 *
 * The API key is loaded from process.env[`${vendorPrefix}_API_KEY`].
 * All other fields come from the caller.
 */
export interface EnvEmbeddingConfig {
  /** Environment variable prefix for the API key (e.g., "ZHIPU", "DEEPSEEK"). */
  readonly vendorPrefix: string;
  /** HTTP endpoint URL. */
  readonly endpoint: string;
  /** Model identifier. */
  readonly model: string;
  /** Output embedding dimension. */
  readonly dimension: number;
  /** Optional additional headers. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
}

/**
 * Create an ApiEmbeddingProvider from environment variables.
 *
 * Reads `${vendorPrefix}_API_KEY` from process.env and passes it
 * as the Authorization header. No vendor-specific logic.
 *
 * Example with Zhipu GLM:
 * ```bash
 * # .env (gitignored)
 * ZHIPU_API_KEY=xxx
 * ZHIPU_EMBEDDING_MODEL=embedding-3
 * ZHIPU_EMBEDDING_DIMENSION=2048
 * ```
 *
 * ```typescript
 * const provider = createApiEmbeddingFromEnv({
 *   vendorPrefix: 'ZHIPU',
 *   endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
 *   model: 'embedding-3',
 *   dimension: 2048,
 * });
 * ```
 */
export function createApiEmbeddingFromEnv(config: EnvEmbeddingConfig): ApiEmbeddingProvider {
  const apiKey = process.env[`${config.vendorPrefix}_API_KEY`];
  const headers: Record<string, string> = {
    ...(config.extraHeaders ?? {}),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return new ApiEmbeddingProvider({
    endpoint: config.endpoint,
    model: config.model,
    dimension: config.dimension,
    headers,
  });
}
