/**
 * Vendor-agnostic API-based embedding provider.
 *
 * Sends HTTP POST requests to any OpenAI-compatible embedding endpoint.
 * Fully decoupled from any specific model vendor — all behavior is driven
 * by ApiEmbeddingConfig.
 *
 * Features:
 * - Batch processing with configurable maxBatchSize
 * - Automatic L2 normalization (optional, on by default)
 * - Exponential backoff retry for transient failures (429, 502, 503)
 * - Custom request/response mappers for non-standard APIs
 * - Timeout control
 * - Dimension validation on response
 *
 * Usage:
 * ```typescript
 * import { ApiEmbeddingProvider } from '@agentix-e/micro-kinetic-ai';
 *
 * const provider = new ApiEmbeddingProvider({
 *   endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
 *   model: 'embedding-3',
 *   dimension: 2048,
 *   headers: { Authorization: `Bearer ${process.env.ZHIPU_API_KEY}` },
 * });
 *
 * const { vectors } = await provider.embed(['service-a', 'service-b']);
 * ```
 *
 * @module ai/providers
 */

import type {
  EmbeddingProviderMeta,
  IEmbeddingProvider,
} from '../interfaces/embedding-provider.js';
import { normalizeL2 } from '../utils/similarity.js';
import type { ApiEmbeddingConfig, ApiEmbeddingConfigInput } from './api-embedding-config.js';
import { resolveApiEmbeddingConfig } from './api-embedding-config.js';

/**
 * OpenAI-compatible embedding response shape.
 *
 * Matches the OpenAI /v1/embeddings response format, which is also
 * used by Zhipu GLM, DeepSeek, and many other providers.
 */
interface OpenAIEmbeddingResponse {
  readonly data: ReadonlyArray<{
    readonly embedding: readonly number[];
    readonly index: number;
  }>;
  readonly model: string;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly total_tokens: number;
  };
}

export class ApiEmbeddingProvider implements IEmbeddingProvider {
  public readonly modelId: string;
  public readonly dimension: number;
  private readonly config: ApiEmbeddingConfig;

  /**
   * Injected fetch function for testability.
   *
   * Defaults to globalThis.fetch. Tests can replace via `setFetch()`.
   */
  private _fetch: typeof fetch = globalThis.fetch;

  /**
   * @param input - Partial config with endpoint, model, and dimension required.
   */
  /**
   * Replace the fetch implementation (for testing).
   *
   * @internal
   */
  _setFetch(fetchFn: typeof fetch): void {
    this._fetch = fetchFn;
  }

  constructor(input: ApiEmbeddingConfigInput) {
    this.config = resolveApiEmbeddingConfig(input);
    this.modelId = this.config.model;
    this.dimension = this.config.dimension;
  }

  /**
   * Provider metadata for logging and observability.
   */
  get meta(): EmbeddingProviderMeta {
    return {
      name: `api-embedding:${this.modelId}`,
      backend: 'api',
      requiresNetwork: true,
    };
  }

  /**
   * Batch-generate embedding vectors.
   *
   * Splits large batches into chunks (respecting maxBatchSize),
   * sends concurrent HTTP requests, and reassembles results
   * in original order.
   */
  async embed(texts: readonly string[]): Promise<{
    readonly vectors: readonly Float32Array[];
  }> {
    if (texts.length === 0) {
      return { vectors: [] };
    }

    const maxBatch = this.config.maxBatchSize ?? 32;
    const chunks: Array<readonly string[]> = [];

    for (let i = 0; i < texts.length; i += maxBatch) {
      chunks.push(texts.slice(i, i + maxBatch));
    }

    // Process chunks concurrently
    const chunkResults = await Promise.all(chunks.map((chunk) => this.embedChunk(chunk)));

    // Reassemble in order
    const vectors: Float32Array[] = [];
    for (const result of chunkResults) {
      vectors.push(...result);
    }

    return { vectors };
  }

  /**
   * Embed a single chunk (≤ maxBatchSize texts).
   */
  private async embedChunk(texts: readonly string[]): Promise<Float32Array[]> {
    const results = await this.requestWithRetry(texts);
    const parsed = this.parseResponse(results);

    if (this.config.normalize !== false) {
      return parsed.map((v) => normalizeL2(v));
    }
    return parsed;
  }

  /**
   * Send API request with exponential backoff retry.
   */
  private async requestWithRetry(texts: readonly string[]): Promise<unknown> {
    const retry = this.config.retry ?? DEFAULT_RETRY_CONFIG_INTERNAL;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < retry.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);

        const response = await this._fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.headers ?? {}),
          },
          body: JSON.stringify(this.buildRequestBody(texts)),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (this.isRetryableStatus(response.status)) {
          // On last attempt, treat as error
          if (attempt === retry.maxAttempts - 1) {
            const body = await response.text().catch(() => '(unknown)');
            throw new Error(
              `Embedding API error ${response.status} (retries exhausted): ${body.slice(0, 200)}`,
            );
          }
          const delayMs = retry.initialDelayMs * Math.pow(retry.backoffMultiplier, attempt);
          await sleep(delayMs);
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '(unknown)');
          throw new Error(`Embedding API error ${response.status}: ${body.slice(0, 200)}`);
        }

        return await response.json();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Don't retry on abort (timeout)
        if (lastError.name === 'AbortError') {
          throw new Error(`Embedding API timeout after ${this.config.timeoutMs}ms`);
        }
        // Last attempt — throw immediately
        if (attempt === retry.maxAttempts - 1) {
          throw lastError;
        }
        const delayMs = retry.initialDelayMs * Math.pow(retry.backoffMultiplier, attempt);
        await sleep(delayMs);
      }
    }

    // Unreachable — loop always throws or returns before exhausting.
    // Retryable status on last attempt throws, non-retryable status throws
    // immediately, success returns. This is a type-check safety net.
    throw lastError ?? new Error('Embedding API request failed');
  }

  /**
   * Build the request body for the embedding API.
   */
  private buildRequestBody(texts: readonly string[]): unknown {
    const format = this.config.format ?? 'openai-compatible';

    if (format === 'custom' && this.config.mapRequest) {
      return this.config.mapRequest(texts);
    }

    // Default: OpenAI-compatible format
    return {
      model: this.config.model,
      input: texts,
    };
  }

  /**
   * Parse the API response into Float32Array vectors.
   */
  private parseResponse(data: unknown): Float32Array[] {
    const format = this.config.format ?? 'openai-compatible';

    if (format === 'custom' && this.config.mapResponse) {
      return this.config.mapResponse(data);
    }

    // Default: OpenAI-compatible format
    const typed = data as OpenAIEmbeddingResponse;
    if (!typed?.data || !Array.isArray(typed.data)) {
      throw new Error('Invalid embedding API response: expected { data: [{ embedding: [...] }] }');
    }

    // Sort by index to preserve input order
    const sorted = [...typed.data].sort((a, b) => a.index - b.index);

    return sorted.map((item) => {
      const vec = new Float32Array(item.embedding);
      if (vec.length !== this.dimension) {
        throw new Error(
          `Embedding dimension mismatch: expected ${this.dimension}, got ${vec.length}`,
        );
      }
      return vec;
    });
  }

  /**
   * Check if an HTTP status is retryable.
   */
  private isRetryableStatus(status: number): boolean {
    const retryable =
      this.config.retry?.retryableStatuses ?? DEFAULT_RETRY_CONFIG.retryableStatuses;
    return retryable.includes(status);
  }
}

// ── Helpers ───────────────────────────────────────────────

/** Internal default — same as the exported one. */
const DEFAULT_RETRY_CONFIG_INNER = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2.0,
  retryableStatuses: [429, 502, 503],
} as const;

const DEFAULT_RETRY_CONFIG_INTERNAL = DEFAULT_RETRY_CONFIG_INNER;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Import the exported default to satisfy TS (symbolic link)
import { DEFAULT_RETRY_CONFIG } from './api-embedding-config.js';

// Verify internal matches exported
void (DEFAULT_RETRY_CONFIG as typeof DEFAULT_RETRY_CONFIG_INNER);
