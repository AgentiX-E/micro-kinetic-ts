/**
 * Vendor-agnostic API-based embedding provider configuration.
 *
 * Designed to be fully decoupled from any specific model vendor.
 * Users configure the endpoint, model name, authentication headers,
 * and request format — the provider handles the HTTP plumbing.
 *
 * Supported formats:
 *   - "openai-compatible":  POST { input, model } → { data: [{ embedding }] }
 *   - "custom":             Extensible via `mapRequest` / `mapResponse`
 *
 * @module ai/providers
 */

/**
 * HTTP request format for embedding API calls.
 */
export type EmbeddingApiFormat = 'openai-compatible' | 'custom';

/**
 * Retry configuration for transient failures.
 */
export interface EmbeddingRetryConfig {
  /** Maximum number of retry attempts (default: 3). */
  readonly maxAttempts: number;
  /** Initial backoff delay in milliseconds (default: 1000). */
  readonly initialDelayMs: number;
  /** Backoff multiplier (default: 2.0 — exponential). */
  readonly backoffMultiplier: number;
  /** HTTP status codes that trigger a retry (default: [429, 502, 503]). */
  readonly retryableStatuses: readonly number[];
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: EmbeddingRetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2.0,
  retryableStatuses: [429, 502, 503],
};

/**
 * Vendor-agnostic configuration for API-based embedding providers.
 *
 * No vendor-specific fields. Everything is driven by configuration:
 * - endpoint: Any HTTP(S) URL
 * - model: Model identifier sent in the request body
 * - headers: Arbitrary headers (auth tokens, content type, etc.)
 * - format: Request/response format (openai-compatible or custom mapping)
 *
 * Example (Zhipu GLM embedding-3):
 * ```typescript
 * const config: ApiEmbeddingConfigInput = {
 *   endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
 *   model: 'embedding-3',
 *   dimension: 2048,
 *   headers: { Authorization: `Bearer ${process.env.ZHIPU_API_KEY}` },
 * };
 * ```
 *
 * Example (custom vendor):
 * ```typescript
 * const config: ApiEmbeddingConfigInput = {
 *   endpoint: 'https://api.example.com/v1/embed',
 *   model: 'example-model',
 *   dimension: 768,
 *   headers: { 'X-API-Key': process.env.EXAMPLE_KEY! },
 *   format: 'custom',
 *   mapRequest: (texts) => ({ texts, model: 'example-model' }),
 *   mapResponse: (data) => data.vectors.map((v: number[]) => new Float32Array(v)),
 * };
 * ```
 */
export interface ApiEmbeddingConfig {
  /** HTTP(S) endpoint for the embedding API. */
  readonly endpoint: string;
  /** Model identifier sent in the request body. */
  readonly model: string;
  /** Fixed embedding output dimension. */
  readonly dimension: number;
  /** Arbitrary HTTP headers (auth tokens, content type, etc.). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Request/response format. Filled by `resolveApiEmbeddingConfig`. */
  readonly format: EmbeddingApiFormat;
  /** Request timeout in milliseconds. Filled by `resolveApiEmbeddingConfig`. */
  readonly timeoutMs: number;
  /** Retry configuration for transient failures. Filled by `resolveApiEmbeddingConfig`. */
  readonly retry: EmbeddingRetryConfig;
  /** Whether to L2-normalize output vectors. Filled by `resolveApiEmbeddingConfig`. */
  readonly normalize: boolean;
  /** Maximum batch size (texts per API call). Filled by `resolveApiEmbeddingConfig`. */
  readonly maxBatchSize: number;
  /**
   * Custom request body mapper.
   *
   * Only used when format = "custom". Takes an array of input texts
   * and returns the request body to POST to the endpoint.
   */
  readonly mapRequest?: (texts: readonly string[]) => unknown;
  /**
   * Custom response mapper.
   *
   * Only used when format = "custom". Takes the parsed JSON response
   * and returns an array of Float32Array vectors (one per input text).
   */
  readonly mapResponse?: (responseData: unknown) => Float32Array[];
}

/**
 * Partial config with required fields for programmatic use.
 *
 * All other fields have sensible defaults:
 * - format: "openai-compatible"
 * - timeoutMs: 30000
 * - retry: DEFAULT_RETRY_CONFIG
 * - normalize: true
 * - maxBatchSize: 32
 */
export type ApiEmbeddingConfigInput = Pick<ApiEmbeddingConfig, 'endpoint' | 'model' | 'dimension'> &
  Partial<
    Pick<
      ApiEmbeddingConfig,
      | 'headers'
      | 'format'
      | 'timeoutMs'
      | 'retry'
      | 'normalize'
      | 'maxBatchSize'
      | 'mapRequest'
      | 'mapResponse'
    >
  >;

/**
 * Resolve a partial config to a full config with defaults applied.
 */
export function resolveApiEmbeddingConfig(input: ApiEmbeddingConfigInput): ApiEmbeddingConfig {
  return {
    format: 'openai-compatible',
    timeoutMs: 30000,
    retry: DEFAULT_RETRY_CONFIG,
    normalize: true,
    maxBatchSize: 32,
    headers: input.headers,
    ...input,
  };
}
