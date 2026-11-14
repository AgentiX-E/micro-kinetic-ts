import { describe, expect, it } from 'vitest';

import {
  buildEliminatorPrompt,
  DEFAULT_ELIMINATOR_OPTIONS,
  ELIMINATOR_PROTOCOL,
} from '../../packages/ai/src/agent/index.js';
import type { ClaimRecord } from '../src/agentic-claims.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import { digestsOf, proposeClaims } from '../src/agentic-proposer.js';
import {
  ChatCompletionError,
  type ChatClient,
  type ChatCompletion,
} from '../src/chat-completions.js';

/** One case: the auth service leads on a latency spike and the order service follows it. */
function headroomCase(datapack: string, faultType = 'HTTPResponseReplaceCode'): HeadroomCase {
  return {
    datapack,
    faultType,
    accepted: ['ts-order-service'],
    candidates: [
      {
        service: 'ts-auth-service',
        rank: 0,
        score: 2,
        channels: [
          { label: 'latency_p99', pre: 11, post: 98.25, band: [11, 14.2], rate: 0, onset: 4200 },
        ],
      },
      {
        service: 'ts-order-service',
        rank: 1,
        score: 1,
        channels: [
          { label: 'latency_p99', pre: 11, post: 40, band: [11, 14.2], rate: 0, onset: 9000 },
        ],
      },
    ],
  };
}

const VERIFIABLE = JSON.stringify({
  eliminate: [
    {
      remove: 'ts-auth-service',
      keep: 'ts-order-service',
      channel: 'latency_p99',
      statistic: 'post',
      observed: 98.25,
      band: [11, 14.2],
      rate: 0,
    },
  ],
});

/**
 * A client that answers from a table and counts what it was asked.
 *
 * Not a stub of `fetch` — the transport is measured in `chat-completions.test.ts` against a real socket. What is
 * under test here is the ordering, the reuse rule and the failure accounting, and those are properties of how the
 * proposer drives a client, not of how a client speaks HTTP.
 */
class ScriptedClient implements ChatClient {
  readonly model = 'deepseek-chat';
  readonly endpoint = 'http://127.0.0.1:1/v1/chat/completions';
  readonly asked: string[] = [];
  inFlight = 0;
  peak = 0;

  constructor(
    private readonly answer: (user: string, index: number) => string | Error,
    private readonly reported: Partial<ChatCompletion> = {},
  ) {}

  async complete(turn: { system: string; user: string }): Promise<ChatCompletion> {
    const index = this.asked.length;
    this.asked.push(turn.user);
    this.inFlight += 1;
    this.peak = Math.max(this.peak, this.inFlight);
    // A macrotask, so two workers that were started together are both counted as in flight.
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.inFlight -= 1;
    const answer = this.answer(turn.user, index);
    if (answer instanceof Error) throw answer;
    return {
      text: answer,
      model: 'deepseek-chat',
      promptTokens: 100,
      completionTokens: 10,
      attempts: 1,
      ...this.reported,
    };
  }
}

function sink(): { records: ClaimRecord[]; onRecord: (record: ClaimRecord) => void } {
  const records: ClaimRecord[] = [];
  return { records, onRecord: (record) => records.push(record) };
}

describe('digestsOf', () => {
  it('gives one digest per case and the same one the prompt builder gives', () => {
    const cases = [headroomCase('a'), headroomCase('b', 'NetworkLoss')];
    const digests = digestsOf(cases);
    expect([...digests.keys()]).toEqual(['a', 'b']);
    expect(digests.get('a')).toBe(
      buildEliminatorPrompt('HTTPResponseReplaceCode', cases[0]!.candidates).digest,
    );
    expect(digests.get('b')).not.toBe(digests.get('a'));
  });

  it('changes when the presentation changes, which is what makes a stale answer detectable', () => {
    const cases = [headroomCase('a')];
    const narrow = digestsOf(cases, {
      ...DEFAULT_ELIMINATOR_OPTIONS,
      maxCandidates: 2,
      maxClaims: 1,
    });
    expect(narrow.get('a')).not.toBe(digestsOf(cases).get('a'));
  });
});

describe('proposeClaims', () => {
  it('asks once per case and records a claim that parses', async () => {
    const cases = [headroomCase('a'), headroomCase('b')];
    const client = new ScriptedClient(() => VERIFIABLE);
    const { records, onRecord } = sink();
    const progress: number[] = [];
    const summary = await proposeClaims(cases, {
      client,
      onRecord,
      onProgress: (done) => progress.push(done),
    });

    expect(summary).toMatchObject({
      cases: 2,
      asked: 2,
      reused: 0,
      answered: 2,
      declined: 0,
      unreadable: 0,
      claims: 2,
      promptTokens: 200,
      completionTokens: 20,
    });
    expect(records.map((record) => record.datapack)).toEqual(['a', 'b']);
    expect(records[0]!.protocol).toBe(ELIMINATOR_PROTOCOL);
    expect(records[0]!.digest).toBe(digestsOf(cases).get('a'));
    expect(records[0]!.claims).toHaveLength(1);
    expect(progress).toEqual([1, 2]);
    expect(client.asked).toHaveLength(2);
  });

  it('counts an empty answer as a decline rather than as a failure', async () => {
    const client = new ScriptedClient(() => '{"eliminate":[]}');
    const { records, onRecord } = sink();
    const summary = await proposeClaims([headroomCase('a')], { client, onRecord });
    expect(summary).toMatchObject({ answered: 0, declined: 1, unreadable: 0, claims: 0 });
    expect(records[0]!.claims).toEqual([]);
    expect(records[0]!.malformed).toBeUndefined();
  });

  it('records an unreadable reply with its reason and does not abort the run', async () => {
    const client = new ScriptedClient((_user, index) =>
      index === 0 ? 'The source is ts-auth-service.' : VERIFIABLE,
    );
    const { records, onRecord } = sink();
    const summary = await proposeClaims([headroomCase('a'), headroomCase('b')], {
      client,
      onRecord,
    });
    expect(summary.unreadable).toBe(1);
    expect(summary.unreadableCases).toEqual(['a: the reply is not JSON']);
    expect(summary.answered).toBe(1);
    expect(records[0]!.malformed).toBe('the reply is not JSON');
    expect(records[1]!.claims).toHaveLength(1);
  });

  it('records a failed call as a case whose answer could not be read, keeping the denominator', async () => {
    const client = new ScriptedClient(
      () => new ChatCompletionError('the endpoint answered 503', 503, 'busy', 4),
    );
    const { records, onRecord } = sink();
    const summary = await proposeClaims([headroomCase('a')], { client, onRecord });
    expect(summary.cases).toBe(1);
    expect(summary.unreadable).toBe(1);
    expect(summary.unreadableCases).toEqual(['a: the call failed: the endpoint answered 503']);
    expect(records[0]!.malformed).toBe('the call failed: the endpoint answered 503');
    expect(records[0]!.promptTokens).toBe(0);
  });

  it('records a failure that is not a completion error with its own text', async () => {
    const client = new ScriptedClient(() => new Error('socket hang up'));
    const { records, onRecord } = sink();
    await proposeClaims([headroomCase('a')], { client, onRecord });
    expect(records[0]!.malformed).toBe('the call failed: Error: socket hang up');
  });

  it('does not ask again what was already answered under the same prompt', async () => {
    const cases = [headroomCase('a'), headroomCase('b')];
    const digests = digestsOf(cases);
    const already: ClaimRecord = {
      datapack: 'a',
      model: 'deepseek-chat',
      protocol: ELIMINATOR_PROTOCOL,
      digest: digests.get('a')!,
      claims: [],
      ms: 500,
      promptTokens: 900,
      completionTokens: 5,
    };
    const client = new ScriptedClient(() => VERIFIABLE);
    const { records, onRecord } = sink();
    const summary = await proposeClaims(cases, {
      client,
      onRecord,
      existing: new Map([['a', already]]),
    });
    expect(summary).toMatchObject({ asked: 1, reused: 1 });
    expect(client.asked).toHaveLength(1);
    // Only the case that was ASKED is emitted: the reused answer is already a line in the caller's file, and
    // re-emitting it would append a duplicate to an artifact that is read by line count.
    expect(records.map((record) => record.datapack)).toEqual(['b']);
  });

  it('asks again when the recorded answer belongs to a different prompt', async () => {
    const stale: ClaimRecord = {
      datapack: 'a',
      model: 'deepseek-chat',
      protocol: ELIMINATOR_PROTOCOL,
      digest: '0000000000000000',
      claims: [],
      ms: 500,
      promptTokens: 900,
      completionTokens: 5,
    };
    const client = new ScriptedClient(() => VERIFIABLE);
    const { onRecord } = sink();
    const summary = await proposeClaims([headroomCase('a')], {
      client,
      onRecord,
      existing: new Map([['a', stale]]),
    });
    expect(summary).toMatchObject({ asked: 1, reused: 0 });
  });

  it('keeps at most the stated number of calls in flight', async () => {
    const cases = Array.from({ length: 7 }, (_, index) => headroomCase(`case-${index}`));
    const client = new ScriptedClient(() => VERIFIABLE);
    const { onRecord } = sink();
    await proposeClaims(cases, { client, onRecord, concurrency: 3 });
    expect(client.peak).toBe(3);
  });

  it('finishes a one-case run with a single worker, and an empty run with none', async () => {
    const single = new ScriptedClient(() => VERIFIABLE);
    const one = sink();
    expect(
      (
        await proposeClaims([headroomCase('a')], {
          client: single,
          onRecord: one.onRecord,
          concurrency: 8,
        })
      ).asked,
    ).toBe(1);
    expect(single.peak).toBe(1);

    const none = new ScriptedClient(() => VERIFIABLE);
    const zero = sink();
    const summary = await proposeClaims([], { client: none, onRecord: zero.onRecord });
    expect(summary).toMatchObject({ cases: 0, asked: 0, reused: 0 });
    expect(none.asked).toEqual([]);
  });

  it('names the model the endpoint reported, falling back to the one asked for', async () => {
    const accepted = new ScriptedClient(() => VERIFIABLE, { model: 'deepseek-chat-2026-11' });
    const first = sink();
    await proposeClaims([headroomCase('a')], { client: accepted, onRecord: first.onRecord });
    expect(first.records[0]!.model).toBe('deepseek-chat-2026-11');

    const silent = new ScriptedClient(() => VERIFIABLE, { model: '' });
    const second = sink();
    await proposeClaims([headroomCase('a')], { client: silent, onRecord: second.onRecord });
    expect(second.records[0]!.model).toBe('deepseek-chat');
  });

  it('clamps a concurrency the caller got wrong rather than refusing to run', async () => {
    const cases = [headroomCase('a'), headroomCase('b')];
    const client = new ScriptedClient(() => VERIFIABLE);
    const { onRecord } = sink();
    await proposeClaims(cases, { client, onRecord, concurrency: 0 });
    expect(client.peak).toBe(1);
  });
});
