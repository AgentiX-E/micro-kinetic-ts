/**
 * OpenAI-compatible chat-completion provider (DeepSeek and similar).
 *
 * A thin, vendor-agnostic HTTP client over `/chat/completions`. Mirrors the
 * {@link ApiEmbeddingProvider} contract: injected `fetch` for testability,
 * timeout via AbortController, and exponential-backoff retry on 429/502/503.
 *
 * @module ai/providers
 */

/** A single chat message. */
export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/** Options for a single completion request. */
export interface ChatCompletionOptions {
  /** Sampling temperature (default 0 — greedy, deterministic). */
  readonly temperature?: number;
  /** Maximum completion tokens. */
  readonly maxTokens?: number;
  /** Request timeout in ms (default 30000). */
  readonly timeoutMs?: number;
  /** Maximum retry attempts for transient failures (default 3). */
  readonly maxAttempts?: number;
}

/**
 * Minimal chat-completion contract. Only the surface the reranker needs.
 */
export interface IChatProvider {
  readonly modelId: string;
  /** Complete a conversation and return the assistant's text. */
  complete(messages: readonly ChatMessage[], options?: ChatCompletionOptions): Promise<string>;
}

/**
 * OpenAI-compatible chat-completion response shape.
 */
interface OpenAIChatResponse {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
}

/**
 * OpenAI-compatible chat-completion provider.
 *
 * Defaults to the DeepSeek endpoint; override via `endpoint`/`headers`.
 */
export class ApiChatProvider implements IChatProvider {
  public readonly modelId: string;
  private readonly endpoint: string;
  private readonly headers: Readonly<Record<string, string>>;
  private readonly model: string;
  private _fetch: typeof fetch = globalThis.fetch;

  /**
   * Replace the fetch implementation (for testing).
   *
   * @internal
   */
  _setFetch(fetchFn: typeof fetch): void {
    this._fetch = fetchFn;
  }

  constructor(config: {
    readonly endpoint: string;
    readonly model: string;
    readonly headers?: Readonly<Record<string, string>>;
  }) {
    this.endpoint = config.endpoint;
    this.model = config.model;
    this.modelId = config.model;
    this.headers = { 'Content-Type': 'application/json', ...config.headers };
  }

  async complete(
    messages: readonly ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<string> {
    const maxAttempts = options?.maxAttempts ?? 3;
    const timeoutMs = options?.timeoutMs ?? 30000;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        const response = await this._fetch(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: options?.temperature ?? 0,
            ...(options?.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
          }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.status === 429 || response.status === 502 || response.status === 503) {
          if (attempt === maxAttempts - 1) {
            const body = await response.text().catch(() => '(unknown)');
            throw new Error(
              `LLM API error ${response.status} (retries exhausted): ${body.slice(0, 200)}`,
            );
          }
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '(unknown)');
          throw new Error(`LLM API error ${response.status}: ${body.slice(0, 200)}`);
        }

        const data = (await response.json()) as OpenAIChatResponse;
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('Invalid LLM API response: expected choices[0].message.content');
        }
        return content;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === 'AbortError') {
          throw new Error(`LLM API timeout after ${timeoutMs}ms`);
        }
        if (attempt === maxAttempts - 1) throw lastError;
        await sleep(1000 * Math.pow(2, attempt));
      }
    }

    throw lastError ?? new Error('LLM API request failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
