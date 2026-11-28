/**
 * The repair loop against a real HTTP endpoint, not a scripted `complete` function.
 *
 * `synthesis-repair.test.ts` in `packages/ai` measures the decision with injected replies, which is where the fault
 * taxonomy, the verbatim error and the budget belong. This file closes the other half: that the decision drives a
 * real OpenAI-compatible transport, that the repair turn is what actually goes over the wire, and that the tokens
 * reported by the endpoint are the ones the driver sums. The server is a real loopback socket; nothing is stubbed.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REPAIR_ATTEMPTS,
  buildEliminatorPrompt,
  repairSynthesis,
  type CandidateFingerprint,
} from '../../packages/ai/src/agent/index.js';
import { createChatClient } from '../src/chat-completions.js';

interface Seen {
  readonly system: string;
  readonly user: string;
}

const open: Server[] = [];
afterEach(async () => {
  for (const server of open.splice(0)) {
    await new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  }
});

/** A completion body whose assistant message is `content`, with reported usage. */
function body(content: string, promptTokens: number, completionTokens: number): string {
  return JSON.stringify({
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content } }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
  });
}

/** A loopback endpoint that answers each request from a script, recording what it was asked. */
async function serve(
  script: readonly string[],
  tokens: readonly [number, number],
): Promise<{ endpoint: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  let index = 0;
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => {
      raw += String(chunk);
    });
    request.on('end', () => {
      const parsed = JSON.parse(raw) as {
        messages: readonly { readonly role: string; readonly content: string }[];
      };
      const system = parsed.messages.find((m) => m.role === 'system')?.content ?? '';
      const user = parsed.messages.find((m) => m.role === 'user')?.content ?? '';
      seen.push({ system, user });
      const answer = script[Math.min(index, script.length - 1)]!;
      index += 1;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(body(answer, tokens[0], tokens[1]));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  open.push(server);
  const port = (server.address() as AddressInfo).port;
  return { endpoint: `http://127.0.0.1:${port}/v1/chat/completions`, seen };
}

const candidate: CandidateFingerprint = {
  service: 'ts-auth-service',
  rank: 0,
  score: 1.4,
  channels: [
    {
      label: 'latency_p99',
      pre: 11,
      post: 98,
      band: [11, 14.2],
      rate: 0,
      onset: 4000,
    },
  ],
};
const prompt = buildEliminatorPrompt('NetworkLoss', [candidate]);
const VALID = JSON.stringify({
  eliminate: [
    {
      remove: 'ts-order-service',
      keep: 'ts-auth-service',
      channel: 'latency_p99',
      statistic: 'post',
      observed: 98,
      band: [11, 14.2],
      rate: 0,
    },
  ],
});

describe('repairSynthesis over a real chat-completions endpoint', () => {
  it('sends the exact error back on the wire and sums the endpoint-reported tokens', async () => {
    const endpoint = await serve(['The source is svc-a.', VALID], [120, 11]);
    const client = createChatClient({
      apiKey: 'sk-loopback-key',
      model: 'deepseek-chat',
      endpoint: endpoint.endpoint,
    });
    const first = await client.complete({ system: prompt.system, user: prompt.user });
    const outcome = await repairSynthesis(prompt, first, (turn) =>
      client.complete({ system: turn.system, user: turn.user }),
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.recovered).toBe(true);
    expect(outcome.repairs).toBe(1);
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.promptTokens).toBe(240);
    expect(outcome.completionTokens).toBe(22);
    expect(endpoint.seen).toHaveLength(2);
    expect(endpoint.seen[0]!.user).toBe(prompt.user);
    // The repair turn actually carried the original question AND the verbatim validation error over the socket.
    expect(endpoint.seen[1]!.user).toContain('FAULT TYPE: NetworkLoss');
    expect(endpoint.seen[1]!.user).toContain('the reply is not JSON');
    expect(endpoint.seen[1]!.system).toContain('REPAIR MODE');
  });

  it('stops at the endpoint default when every reply stays malformed', async () => {
    const endpoint = await serve(['still prose'], [7, 3]);
    const client = createChatClient({
      apiKey: 'sk-loopback-key',
      model: 'deepseek-chat',
      endpoint: endpoint.endpoint,
    });
    const first = await client.complete({ system: prompt.system, user: prompt.user });
    const outcome = await repairSynthesis(prompt, first, (turn) =>
      client.complete({ system: turn.system, user: turn.user }),
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.repairs).toBe(DEFAULT_REPAIR_ATTEMPTS);
    expect(endpoint.seen).toHaveLength(DEFAULT_REPAIR_ATTEMPTS + 1);
    expect(outcome.promptTokens).toBe(7 * (DEFAULT_REPAIR_ATTEMPTS + 1));
  });
});
