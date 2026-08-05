import type { ServiceDescriptor } from './embedding-provider.js';

/**
 * LLM provider interface for semantic entity alignment.
 *
 * Contract aligned with @agentix-e/log-parser-core's ILLMProvider interface pattern.
 * Provides entity matching capabilities for semantic alignment between
 * trace span service names and known topology service IDs.
 *
 * Design principle: core defines the interface contract ONLY.
 * Implementations live in separate packages:
 *   - @agentix-e/micro-kinetic-ai-openai — OpenAI-compatible API provider
 *   - @agentix-e/micro-kinetic-ai-webllm — WebLLM browser provider
 *
 * When no provider is injected, the system uses only embedding-based alignment
 * (TfIdfEmbeddingProvider with substring heuristic fallback).
 *
 * Cost control:
 * - Maximum 1 LLM call per alignment batch (cached 24h)
 * - Only triggered when embedding confidence < 0.85
 * - All low-confidence entities batched into a single API call
 *
 * @module ai/interfaces
 */

/**
 * Result from LLM-based semantic entity alignment.
 */
export interface LlmAlignmentResult {
  /** Successful mappings: span service → topology service ID. */
  readonly matches: ReadonlyMap<string, string>;
  /** Entities that the LLM could not match with sufficient confidence. */
  readonly unmatched: ReadonlyArray<{
    spanService: string;
    reason: string;
  }>;
  /** Provider model identifier. */
  readonly modelId: string;
  /** Token consumption statistics for cost tracking. */
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

/**
 * LLM provider interface.
 *
 * Matches span service names to known topology service IDs using
 * entity linking with domain knowledge about microservice naming conventions.
 */
export interface ILLMProvider {
  /** Unique model identifier used in logs and metrics. */
  readonly modelId: string;
  /**
   * Align span service names to topology service IDs.
   *
   * Takes a batch of unknown span service names and a list of known
   * topology service descriptors, returns mappings with confidence scores.
   *
   * The LLM is prompted with NER-style entity linking: given service names
   * from traces and known topology services, identify which are the same.
   * Prompt is designed to be generic — no dataset-specific instructions.
   *
   * @param spanServices - Service names extracted from trace spans.
   * @param topologyServices - Known service descriptors from the topology config.
   * @returns Alignment result with matches and unmatched entities.
   */
  alignEntities(
    spanServices: readonly string[],
    topologyServices: readonly ServiceDescriptor[],
  ): Promise<LlmAlignmentResult>;
}

/**
 * Model router for complexity-based LLM selection.
 *
 * Routes simple alignment cases to a local (fast, free) model and
 * complex cases to a remote (powerful) model.
 *
 * Complexity is assessed heuristically:
 * - Number of unmatched services after embedding alignment
 * - Text distance between candidate service names
 * - Number of ambiguous candidates per span service
 */
export interface IModelRouter {
  /**
   * Select the appropriate LLM provider based on alignment complexity.
   *
   * @param unresolvedServices - Services that embedding alignment could not match.
   * @param topologyServices - Available topology service descriptors.
   * @returns The selected ILLMProvider.
   */
  select(
    unresolvedServices: ReadonlyArray<{
      spanService: string;
      candidates: ReadonlyArray<{
        topologyId: string;
        confidence: number;
      }>;
    }>,
    topologyServices: readonly ServiceDescriptor[],
  ): ILLMProvider;
}
