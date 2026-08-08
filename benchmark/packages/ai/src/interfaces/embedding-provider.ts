/**
 * Embedding provider interface.
 *
 * Contract aligned with @agentix-e/log-parser-core's IEmbeddingProvider.
 * All output vectors must be L2-normalized so cosine similarity equals dot product.
 *
 * Design principle: core defines the interface contract ONLY.
 * Implementations live in separate packages:
 *   - @agentix-e/micro-kinetic-ai (this package) — built-in TF-IDF fallback
 *   - @agentix-e/micro-kinetic-ai-openai — OpenAI-compatible API provider
 *   - @agentix-e/micro-kinetic-ai-transformers — @xenova/transformers offline provider
 *   - @agentix-e/micro-kinetic-ai-onnx — ONNX Runtime offline provider
 *   - @agentix-e/micro-kinetic-ai-webllm — WebLLM browser provider
 *
 * When no provider is injected, the system degrades to TfIdfEmbeddingProvider
 * (zero dependencies, zero network calls, always available).
 *
 * @module ai/interfaces
 */
export interface IEmbeddingProvider {
  /** Model identifier used in logs and metrics. */
  readonly modelId: string;
  /** Fixed dimension of output embedding vectors. */
  readonly dimension: number;
  /**
   * Batch-generate L2-normalized embedding vectors.
   *
   * Constraints:
   * - `vectors.length === texts.length`
   * - Each vector has length `this.dimension`
   * - All vectors are L2-normalized (cosine similarity = dot product)
   *
   * @param texts - Input text array.
   * @returns Normalized embedding vectors.
   */
  embed(texts: readonly string[]): Promise<{
    readonly vectors: readonly Float32Array[];
  }>;
}

/**
 * Service descriptor for semantic alignment matching.
 *
 * Describes a known topology service node that needs to be matched
 * against unknown span service names from trace data.
 */
export interface ServiceDescriptor {
  /** Canonical service ID in the topology graph. */
  readonly id: string;
  /** Human-readable service name. */
  readonly name: string;
  /** Optional namespace qualifier. */
  readonly namespace?: string;
  /** Optional labels for semantic enrichment (e.g., "web-gateway", "database"). */
  readonly labels?: ReadonlyArray<string>;
}

/**
 * Result of an entity alignment operation.
 *
 * Maps unknown span service names to known topology service IDs
 * with confidence scores and usage tracking.
 */
export interface EntityAlignmentResult {
  /** Successful mappings: span service → topology service ID. */
  readonly matches: ReadonlyMap<string, string>;
  /** Low-confidence or failed mappings with confidence scores. */
  readonly lowConfidence: ReadonlyArray<{
    spanService: string;
    candidates: ReadonlyArray<{
      topologyId: string;
      confidence: number;
    }>;
  }>;
  /** Token consumption statistics for cost tracking (optional). */
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
  };
}

/**
 * Semantic alignment fallback strategy.
 *
 * Controls how the system degrades when different alignment methods fail.
 */
export type AlignmentFallbackStrategy = 'best-effort' | 'none';

/**
 * Provider metadata for logging and observability.
 */
export interface EmbeddingProviderMeta {
  /** Provider name for debugging. */
  readonly name: string;
  /** Backend type (e.g., "tfidf", "transformers", "onnx", "api"). */
  readonly backend: string;
  /** Whether this provider needs network access. */
  readonly requiresNetwork: boolean;
}
