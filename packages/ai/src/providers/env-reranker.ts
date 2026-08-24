/**
 * Environment-based factory for the evidence-grounded reranker.
 *
 * Reads the DeepSeek chat API configuration from the environment and returns a
 * ready-to-use {@link EvidenceGroundedReranker}, or `null` when the key is not
 * set (so callers can silently fall back to the deterministic order).
 *
 * No API keys are embedded here — they come from `.env` / CI secrets.
 *
 * @module ai/providers
 */

import { ApiChatProvider } from './api-llm.js';
import { EvidenceGroundedReranker } from './evidence-reranker.js';

/**
 * Configuration for {@link createEvidenceRerankerFromEnv}.
 */
export interface EnvRerankerConfig {
  /** Environment variable name for the API key (default "DEEPSEEK_API_KEY"). */
  readonly apiKeyEnv?: string;
  /** Chat completions endpoint (default "https://api.deepseek.com/v1/chat/completions"). */
  readonly endpoint?: string;
  /** Model identifier (default "deepseek-chat"). */
  readonly model?: string;
}

/**
 * Create an evidence-grounded reranker backed by the DeepSeek chat API.
 *
 * Returns `null` when the API key is absent, so callers can keep the
 * deterministic ordering. The endpoint and model default to the DeepSeek
 * OpenAI-compatible API.
 */
export function createEvidenceRerankerFromEnv(
  config: EnvRerankerConfig = {},
): EvidenceGroundedReranker | null {
  const apiKeyEnv = config.apiKeyEnv ?? 'DEEPSEEK_API_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) return null;

  const endpoint = config.endpoint ?? 'https://api.deepseek.com/v1/chat/completions';
  const model = config.model ?? 'deepseek-chat';

  const provider = new ApiChatProvider({
    endpoint,
    model,
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return new EvidenceGroundedReranker(provider);
}
