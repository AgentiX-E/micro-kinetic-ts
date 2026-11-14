/**
 * One OpenAI-compatible chat-completions call, with the three behaviours a measurement line needs and a library
 * client does not offer.
 *
 * * **A retry is a retry, not a new measurement.** 429 and 5xx are the two answers a shared endpoint gives when it
 *   is busy, and they say nothing about the question. They are retried with `Retry-After` honoured when the server
 *   states it; a 4xx that is not 429 is returned immediately, because a wrong key or a bad model name will not fix
 *   itself and retrying it turns one clear failure into a minute of silence.
 * * **A timeout is a wall clock, not a hope.** Every attempt carries an `AbortSignal`; a socket that never answers
 *   fails the case rather than the job, which matters when 1 400 cases share one dispatch.
 * * **The key never becomes a string.** It is read once, placed in one header, and never interpolated into an error
 *   message, a log line or a URL. `ChatCompletionError.detail` carries the response body only, truncated.
 *
 * Token counts are what the endpoint REPORTED and nothing else. Estimating them from character counts would put a
 * number in the budget ledger that nobody measured, and the ledger's job is to make "this arm cost $5.30" checkable.
 *
 * Zero dependencies: `fetch` and `node:timers` are the whole surface, so the module is testable against a real
 * loopback server rather than a stubbed one.
 */

/** The endpoint `deepseek-chat` is served from. Model-agnostic: any OpenAI-compatible base URL is accepted. */
export const DEFAULT_CHAT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';

/** The environment variable the key is read from. Named here so no caller invents a second name for it. */
export const CHAT_KEY_VARIABLE = 'DEEPSEEK_API_KEY';

/** Two messages: the standing instruction and the question. */
export interface ChatTurn {
  readonly system: string;
  readonly user: string;
}

/** What one call produced. */
export interface ChatCompletion {
  /** The assistant message, verbatim, including any Markdown fence the model added. */
  readonly text: string;
  /** The model the endpoint reported serving, which is not always the model that was asked for. */
  readonly model: string;
  /** Prompt tokens as reported by `usage`, or zero when the endpoint reported none. */
  readonly promptTokens: number;
  /** Completion tokens as reported by `usage`, or zero when the endpoint reported none. */
  readonly completionTokens: number;
  /** Attempts it took, so a run can report how much of its latency was the endpoint's queue. */
  readonly attempts: number;
}

/** A call that did not produce a message. Carries the status and the body, never the key. */
export class ChatCompletionError extends Error {
  constructor(
    message: string,
    /** HTTP status, or `null` when the request never reached a server (timeout, DNS, reset). */
    readonly status: number | null,
    /** Response body, truncated to 400 characters, or the transport error's message. */
    readonly detail: string,
    /** How many attempts were spent before giving up. */
    readonly attempts: number,
  ) {
    super(message);
    this.name = 'ChatCompletionError';
  }
}

/** Everything a call needs. The key is required and is never defaulted. */
export interface ChatClientOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  /** Response cap. 512 is enough for four eliminations and keeps a runaway reply cheap. */
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  /** Total attempts, including the first. One means no retry. */
  readonly maxAttempts?: number;
  /** Base of the exponential backoff, in milliseconds. */
  readonly backoffMs?: number;
  /** Injected delay, so a test of the retry path costs microseconds instead of seconds. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Resolved defaults: a 20 s wall clock, four attempts, and a 250 ms backoff base. */
export const DEFAULT_CHAT_LIMITS = {
  maxTokens: 512,
  temperature: 0,
  timeoutMs: 20_000,
  maxAttempts: 4,
  backoffMs: 250,
} as const;

/** A client bound to one endpoint, one model and one key. */
export interface ChatClient {
  readonly model: string;
  readonly endpoint: string;
  complete(turn: ChatTurn): Promise<ChatCompletion>;
}

/** Real sleep. The only place a clock enters the module, and it is a parameter of every caller. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The statuses a retry can fix. 408 is the request-timeout standard; 429 and 5xx are the endpoint being busy. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Read `Retry-After`, which the standard allows as seconds or as an HTTP date.
 *
 * A date is converted to a delay against `now`; the clock is passed in so this stays testable. A negative or
 * unparseable value reads as zero — "no advice", not "wait forever".
 *
 * @param header - The header value, or `null`.
 * @param now - Current epoch milliseconds.
 * @returns Milliseconds to wait.
 */
export function retryAfterMs(header: string | null, now: number): number {
  if (header === null) return 0;
  const trimmed = header.trim();
  if (trimmed === '') return 0;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, at - now);
}

/** One parsed body, or a reason the body is not a completion. */
interface ParsedBody {
  readonly text: string;
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/** Pull the assistant message out of a response body, refusing a body that has none. */
function parseBody(body: string): ParsedBody | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'the endpoint answered with a body that is not JSON';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'the endpoint answered with a non-object body';
  }
  const record = parsed as Record<string, unknown>;
  const choices = record['choices'];
  if (!Array.isArray(choices) || choices.length === 0)
    return 'the endpoint answered with no choices';
  const first = choices[0];
  if (typeof first !== 'object' || first === null) return 'the first choice is not an object';
  const message = (first as Record<string, unknown>)['message'];
  if (typeof message !== 'object' || message === null) return 'the first choice carries no message';
  const content = (message as Record<string, unknown>)['content'];
  if (typeof content !== 'string') return 'the first choice message carries no text content';
  const usage = record['usage'];
  const usageRecord =
    typeof usage === 'object' && usage !== null ? (usage as Record<string, unknown>) : {};
  const reported = (key: string): number => {
    const value = usageRecord[key];
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  };
  return {
    text: content,
    model: typeof record['model'] === 'string' ? record['model'] : '',
    promptTokens: reported('prompt_tokens'),
    completionTokens: reported('completion_tokens'),
  };
}

/** Truncate a body so a 4 KB HTML error page does not become an error message. */
function excerpt(body: string): string {
  return body.length <= 400 ? body : `${body.slice(0, 400)}…`;
}

/**
 * Build a client.
 *
 * @param options - Endpoint, model, key and limits.
 * @returns A client whose `complete` performs one turn with retries.
 */
export function createChatClient(options: ChatClientOptions): ChatClient {
  if (options.apiKey.trim() === '') {
    throw new Error(`${CHAT_KEY_VARIABLE} is empty: the arm cannot be measured without a key`);
  }
  const endpoint = options.endpoint ?? DEFAULT_CHAT_ENDPOINT;
  const maxTokens = options.maxTokens ?? DEFAULT_CHAT_LIMITS.maxTokens;
  const temperature = options.temperature ?? DEFAULT_CHAT_LIMITS.temperature;
  const timeoutMs = options.timeoutMs ?? DEFAULT_CHAT_LIMITS.timeoutMs;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_CHAT_LIMITS.maxAttempts);
  const backoffMs = Math.max(0, options.backoffMs ?? DEFAULT_CHAT_LIMITS.backoffMs);
  const sleep = options.sleep ?? realSleep;
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
  };

  return {
    model: options.model,
    endpoint,
    async complete(turn: ChatTurn): Promise<ChatCompletion> {
      const payload = JSON.stringify({
        model: options.model,
        temperature,
        max_tokens: maxTokens,
        // The protocol asks for JSON, and stating it to the endpoint is the one server-side enforcement of that:
        // a model that would otherwise answer with prose is constrained at the sampler rather than corrected later.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: turn.system },
          { role: 'user', content: turn.user },
        ],
      });

      let last: ChatCompletionError | null = null;
      for (let attempt = 1; ; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
          controller.abort();
        }, timeoutMs);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: payload,
            signal: controller.signal,
          });
          const body = await response.text();
          if (!response.ok) {
            last = new ChatCompletionError(
              `the endpoint answered ${response.status}`,
              response.status,
              excerpt(body),
              attempt,
            );
            if (!RETRYABLE.has(response.status) || attempt >= maxAttempts) throw last;
            const advised = retryAfterMs(response.headers.get('retry-after'), Date.now());
            await sleep(advised > 0 ? advised : backoffMs * 2 ** (attempt - 1));
            continue;
          }
          const parsed = parseBody(body);
          if (typeof parsed === 'string') {
            // A 200 whose body is not a completion is the endpoint's fault and is not retried: the same request
            // will produce the same body, and four attempts at it would only make the failure slower.
            throw new ChatCompletionError(parsed, response.status, excerpt(body), attempt);
          }
          return { ...parsed, attempts: attempt };
        } catch (error) {
          if (error instanceof ChatCompletionError) throw error;
          // Read off the thrown value rather than off an `Error` instance: `fetch` rejects with a `DOMException`
          // for a timeout and with a `TypeError` for a dead socket, and a caller's patched transport may reject
          // with something that is neither. The name is the only field every one of those carries.
          const name = (error as { readonly name?: unknown } | null)?.name;
          last = new ChatCompletionError(
            name === 'AbortError'
              ? `the endpoint did not answer within ${timeoutMs} ms`
              : 'the request failed in transport',
            null,
            String(error),
            attempt,
          );
          if (attempt >= maxAttempts) throw last;
          await sleep(backoffMs * 2 ** (attempt - 1));
        } finally {
          clearTimeout(timer);
        }
      }
    },
  };
}

/**
 * Build a client from the environment, or explain why the arm cannot run.
 *
 * A missing key is not an error of the program: it is the difference between a dispatch that can measure the model
 * arm and one that cannot, and the caller prints the second as a named reason rather than as a stack trace.
 *
 * @param model - The model name to request.
 * @param env - The environment, defaulting to `process.env`.
 * @returns The client, or `null` with the reason a caller can print.
 */
export function createChatClientFromEnv(
  model: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): { client: ChatClient | null; reason: string } {
  const key = env[CHAT_KEY_VARIABLE];
  if (key === undefined || key.trim() === '') {
    return {
      client: null,
      reason: `${CHAT_KEY_VARIABLE} is not set, so the model arm was not measured`,
    };
  }
  return { client: createChatClient({ apiKey: key, model }), reason: '' };
}
