/**
 * Environment-based factory for the ReAct investigator.
 *
 * This is the ONLY place a concrete vendor (DeepSeek) is named. It reads the
 * chat API configuration from the environment and returns a ready-to-use
 * {@link ReActInvestigatorAgent}, or `null` when the key is absent so callers
 * fall back to the deterministic ranking. Swap this factory for another
 * provider without touching the agent or the loop.
 *
 * No API keys are embedded here — they come from `.env` / CI secrets.
 *
 * @module ai/agent
 */

import { ApiChatProvider } from '../providers/api-llm.js';
import { ReActInvestigatorAgent } from './investigator-agent.js';

/**
 * Configuration for {@link createInvestigatorFromEnv}.
 */
export interface EnvInvestigatorConfig {
  /** Environment variable name for the API key (default "DEEPSEEK_API_KEY"). */
  readonly apiKeyEnv?: string;
  /** Chat completions endpoint (default "https://api.deepseek.com/v1/chat/completions"). */
  readonly endpoint?: string;
  /** Model identifier (default "deepseek-chat"). */
  readonly model?: string;
}

/**
 * Create a ReAct investigator backed by the DeepSeek chat API.
 *
 * Returns `null` when the API key is absent so callers keep the deterministic
 * ranking. The endpoint and model default to the DeepSeek OpenAI-compatible
 * API; override them to target any other OpenAI-compatible provider.
 */
export function createInvestigatorFromEnv(
  config: EnvInvestigatorConfig = {},
): ReActInvestigatorAgent | null {
  const apiKeyEnv = config.apiKeyEnv ?? 'DEEPSEEK_API_KEY';
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) return null;

  const provider = new ApiChatProvider({
    endpoint: config.endpoint ?? 'https://api.deepseek.com/v1/chat/completions',
    model: config.model ?? 'deepseek-chat',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  return new ReActInvestigatorAgent(provider);
}
