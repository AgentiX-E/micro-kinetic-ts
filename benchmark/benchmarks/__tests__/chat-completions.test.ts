import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHAT_KEY_VARIABLE,
  ChatCompletionError,
  createChatClient,
  createChatClientFromEnv,
  retryAfterMs,
} from '../src/chat-completions.js';

/** One request the server saw, decoded. */
interface Seen {
  readonly method: string;
  readonly path: string;
  readonly authorization: string;
  readonly body: Record<string, unknown>;
}

/**
 * A real loopback endpoint.
 *
 * Not a stub of `fetch`: the module's failure modes are status codes, headers and a socket that does not answer,
 * and all three live in the transport. Handing the module a function would test the function.
 */
async function listen(
  handler: (
    request: IncomingMessage,
    body: string,
    index: number,
  ) => Promise<{
    status: number;
    headers?: Record<string, string>;
    body: string;
  }>,
): Promise<{ endpoint: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => {
      body += String(chunk);
    });
    request.on('end', () => {
      const index = seen.length;
      seen.push({
        method: request.method ?? '',
        path: request.url ?? '',
        authorization: String(request.headers.authorization ?? ''),
        body: JSON.parse(body) as Record<string, unknown>,
      });
      void handler(request, body, index).then((answer) => {
        try {
          response.writeHead(answer.status, {
            'content-type': 'application/json',
            ...answer.headers,
          });
          response.end(answer.body);
        } catch {
          // The client abandoned the request (the timeout test): the socket is already gone.
        }
      });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    endpoint: `http://127.0.0.1:${port}/v1/chat/completions`,
    seen,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

const completion = JSON.stringify({
  id: 'x',
  model: 'deepseek-chat',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"eliminate":[]}' } }],
  usage: { prompt_tokens: 812, completion_tokens: 9 },
});

const open: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of open.splice(0)) await close();
});

async function endpointWith(
  handler: Parameters<typeof listen>[0],
): Promise<Awaited<ReturnType<typeof listen>>> {
  const started = await listen(handler);
  open.push(started.close);
  return started;
}

const KEY = 'sk-test-key-that-must-not-be-printed';

describe('createChatClient', () => {
  it('posts one turn and reports what the endpoint said it used', async () => {
    const endpoint = await endpointWith(async () => ({ status: 200, body: completion }));
    const client = createChatClient({
      apiKey: KEY,
      model: 'deepseek-chat',
      endpoint: endpoint.endpoint,
    });
    const answer = await client.complete({ system: 'sys', user: 'usr' });

    expect(answer).toEqual({
      text: '{"eliminate":[]}',
      model: 'deepseek-chat',
      promptTokens: 812,
      completionTokens: 9,
      attempts: 1,
    });
    expect(endpoint.seen).toHaveLength(1);
    const request = endpoint.seen[0]!;
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/v1/chat/completions');
    expect(request.authorization).toBe(`Bearer ${KEY}`);
    expect(request.body['model']).toBe('deepseek-chat');
    expect(request.body['temperature']).toBe(0);
    expect(request.body['max_tokens']).toBe(512);
    expect(request.body['response_format']).toEqual({ type: 'json_object' });
    expect(request.body['messages']).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('retries a busy endpoint and counts the attempts', async () => {
    const endpoint = await endpointWith(async (_request, _body, index) =>
      index === 0
        ? { status: 429, headers: { 'retry-after': '0' }, body: '{"error":"slow down"}' }
        : { status: 200, body: completion },
    );
    // `Retry-After: 0` is the endpoint saying "immediately", which is read as no advice and falls back to the
    // client's own backoff — set to zero here so the assertion is about the retry, not about the wait.
    const slept: number[] = [];
    const client = createChatClient({
      apiKey: KEY,
      model: 'deepseek-chat',
      endpoint: endpoint.endpoint,
      backoffMs: 0,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    const answer = await client.complete({ system: 's', user: 'u' });
    expect(answer.attempts).toBe(2);
    expect(slept).toEqual([0]);
    expect(endpoint.seen).toHaveLength(2);
  });

  it('waits as long as the endpoint advised, then falls back to its own backoff', async () => {
    const endpoint = await endpointWith(async (_request, _body, index) =>
      index === 0
        ? { status: 503, headers: { 'retry-after': '2' }, body: '' }
        : index === 1
          ? { status: 503, body: '' }
          : { status: 200, body: completion },
    );
    const slept: number[] = [];
    const client = createChatClient({
      apiKey: KEY,
      model: 'm',
      endpoint: endpoint.endpoint,
      backoffMs: 10,
      sleep: async (ms) => {
        slept.push(ms);
      },
    });
    expect((await client.complete({ system: 's', user: 'u' })).attempts).toBe(3);
    expect(slept).toEqual([2000, 20]);
  });

  it('does not retry an answer that will not change', async () => {
    const endpoint = await endpointWith(async () => ({
      status: 401,
      body: '{"error":"invalid api key"}',
    }));
    const client = createChatClient({ apiKey: KEY, model: 'm', endpoint: endpoint.endpoint });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toMatchObject({
      status: 401,
      attempts: 1,
    });
    expect(endpoint.seen).toHaveLength(1);
  });

  it('gives up after the attempt bound and says how many it spent', async () => {
    const endpoint = await endpointWith(async () => ({ status: 500, body: 'upstream exploded' }));
    const client = createChatClient({
      apiKey: KEY,
      model: 'm',
      endpoint: endpoint.endpoint,
      maxAttempts: 2,
      backoffMs: 0,
      sleep: async () => undefined,
    });
    const failure = await client
      .complete({ system: 's', user: 'u' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatCompletionError);
    expect(failure).toMatchObject({ status: 500, detail: 'upstream exploded', attempts: 2 });
    expect((failure as ChatCompletionError).message).toBe('the endpoint answered 500');
    expect(endpoint.seen).toHaveLength(2);
  });

  it('truncates a long error body instead of carrying an HTML page', async () => {
    const endpoint = await endpointWith(async () => ({ status: 400, body: 'x'.repeat(900) }));
    const client = createChatClient({ apiKey: KEY, model: 'm', endpoint: endpoint.endpoint });
    const failure = await client
      .complete({ system: 's', user: 'u' })
      .catch((error: unknown) => error);
    const detail = (failure as ChatCompletionError).detail;
    expect(detail).toHaveLength(401);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('fails a case whose socket never answers, rather than the job', async () => {
    const endpoint = await endpointWith(() => new Promise<never>(() => undefined));
    const client = createChatClient({
      apiKey: KEY,
      model: 'm',
      endpoint: endpoint.endpoint,
      timeoutMs: 60,
      maxAttempts: 1,
    });
    const failure = await client
      .complete({ system: 's', user: 'u' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatCompletionError);
    expect((failure as ChatCompletionError).message).toBe(
      'the endpoint did not answer within 60 ms',
    );
    expect((failure as ChatCompletionError).status).toBeNull();
  });

  it('fails a transport error that is not a timeout, and retries it', async () => {
    // Port 1 on loopback refuses the connection: a real transport failure, not a simulated one.
    const client = createChatClient({
      apiKey: KEY,
      model: 'm',
      endpoint: 'http://127.0.0.1:1/v1/chat/completions',
      maxAttempts: 2,
      backoffMs: 0,
      sleep: async () => undefined,
    });
    const failure = await client
      .complete({ system: 's', user: 'u' })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ChatCompletionError);
    expect((failure as ChatCompletionError).message).toBe('the request failed in transport');
    expect((failure as ChatCompletionError).attempts).toBe(2);
  });

  it('refuses a 200 whose body is not a completion, and does not retry it', async () => {
    const bodies = [
      'not json',
      '[]',
      '{"choices":[]}',
      '{"choices":[null]}',
      '{"choices":[{"index":0}]}',
      '{"choices":[{"message":{}}]}',
    ];
    const whys = [
      'the endpoint answered with a body that is not JSON',
      'the endpoint answered with a non-object body',
      'the endpoint answered with no choices',
      'the first choice is not an object',
      'the first choice carries no message',
      'the first choice message carries no text content',
    ];
    for (let index = 0; index < bodies.length; index++) {
      const endpoint = await endpointWith(async () => ({ status: 200, body: bodies[index]! }));
      const client = createChatClient({ apiKey: KEY, model: 'm', endpoint: endpoint.endpoint });
      const failure = await client
        .complete({ system: 's', user: 'u' })
        .catch((error: unknown) => error);
      expect((failure as ChatCompletionError).message).toBe(whys[index]);
      expect(endpoint.seen).toHaveLength(1);
    }
  });

  it('reads a usage block that is missing or malformed as zero rather than as an estimate', async () => {
    for (const body of [
      '{"model":"m","choices":[{"message":{"content":"{}"}}]}',
      '{"model":"m","choices":[{"message":{"content":"{}"}}],"usage":{"prompt_tokens":-4,"completion_tokens":"9"}}',
    ]) {
      const endpoint = await endpointWith(async () => ({ status: 200, body }));
      const client = createChatClient({ apiKey: KEY, model: 'm', endpoint: endpoint.endpoint });
      const answer = await client.complete({ system: 's', user: 'u' });
      expect(answer.promptTokens).toBe(0);
      expect(answer.completionTokens).toBe(0);
      expect(answer.model).toBe('m');
    }
    // An endpoint that does not name the model it served is reported as naming nothing, never as the model asked for.
    const unnamed = await endpointWith(async () => ({
      status: 200,
      body: '{"choices":[{"message":{"content":"{}"}}],"usage":{}}',
    }));
    const client = createChatClient({
      apiKey: KEY,
      model: 'asked-for',
      endpoint: unnamed.endpoint,
    });
    expect((await client.complete({ system: 's', user: 'u' })).model).toBe('');
  });

  it('waits on a real clock when no delay was injected', async () => {
    // The one production path a fully injected test suite would never touch: `realSleep`, at 1 ms so the
    // assertion costs a millisecond and still proves the timer arms and fires.
    const endpoint = await endpointWith(async (_request, _body, index) =>
      index === 0 ? { status: 503, body: '' } : { status: 200, body: completion },
    );
    const started = Date.now();
    const client = createChatClient({
      apiKey: KEY,
      model: 'm',
      endpoint: endpoint.endpoint,
      backoffMs: 1,
    });
    expect((await client.complete({ system: 's', user: 'u' })).attempts).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1);
  });

  it('refuses to build a client with no key, naming the variable rather than the value', () => {
    expect(() => createChatClient({ apiKey: '   ', model: 'm' })).toThrow(
      `${CHAT_KEY_VARIABLE} is empty`,
    );
  });
});

describe('createChatClientFromEnv', () => {
  it('reports a missing key as a reason the caller prints, not as a crash', () => {
    expect(createChatClientFromEnv('deepseek-chat', {})).toEqual({
      client: null,
      reason: `${CHAT_KEY_VARIABLE} is not set, so the model arm was not measured`,
    });
    expect(createChatClientFromEnv('deepseek-chat', { [CHAT_KEY_VARIABLE]: '  ' })).toEqual({
      client: null,
      reason: `${CHAT_KEY_VARIABLE} is not set, so the model arm was not measured`,
    });
  });

  it('builds a client when the key is present', () => {
    const built = createChatClientFromEnv('deepseek-chat', { [CHAT_KEY_VARIABLE]: KEY });
    expect(built.client?.model).toBe('deepseek-chat');
    expect(built.reason).toBe('');
    expect(built.client?.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
  });
});

describe('retryAfterMs', () => {
  it('reads seconds, an HTTP date, and nothing at all', () => {
    const now = Date.parse('2026-11-14T00:00:00Z');
    expect(retryAfterMs(null, now)).toBe(0);
    expect(retryAfterMs('  ', now)).toBe(0);
    expect(retryAfterMs('2', now)).toBe(2000);
    expect(retryAfterMs('0.5', now)).toBe(500);
    expect(retryAfterMs('-3', now)).toBe(0);
    expect(retryAfterMs('Sat, 14 Nov 2026 00:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('Sat, 14 Nov 2026 00:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBe(0);
    expect(retryAfterMs(new Date(now - 1000).toUTCString(), now)).toBe(0);
  });
});
