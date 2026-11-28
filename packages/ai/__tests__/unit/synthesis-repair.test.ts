/**
 * The structured synthesis-repair loop, tested at the boundary it actually owns.
 *
 * The module under test is pure: it decides WHEN to repair, WHAT to feed back and WHETHER the repair worked. The
 * model transport lives in `benchmarks/chat-completions.ts` and is measured there against a real loopback server;
 * this suite injects scripted replies at that boundary so the decision is observable without a paid call. The
 * end-to-end wiring through a real HTTP endpoint is covered in `benchmarks/__tests__/synthesis-repair-loopback.test.ts`.
 *
 * Every assertion is about a distinction the mechanism claims: empty vs no-brace vs never-closed vs decode vs
 * shape vs bound; the exact error fed back verbatim; the bounded attempt count; and honest token accounting.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ELIMINATOR_OPTIONS,
  buildEliminatorPrompt,
  type CandidateFingerprint,
} from '../../src/agent/index.js';
import {
  DEFAULT_REPAIR_ATTEMPTS,
  MAX_REPAIR_ATTEMPTS,
  SYNTHESIS_REPAIR_PROTOCOL,
  buildRepairTurn,
  classifyFault,
  repairSynthesis,
  type RepairTurn,
  type SynthesisReply,
} from '../../src/agent/synthesis-repair.js';

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

function reply(text: string, over: Partial<SynthesisReply> = {}): SynthesisReply {
  return {
    text,
    model: 'deepseek-chat',
    promptTokens: 100,
    completionTokens: 20,
    ...over,
  };
}

describe('classifyFault', () => {
  it("names each failure in the order ThinkDepth's output_validator applies its checks", () => {
    expect(classifyFault('   ', 'the reply was empty')).toBe('empty');
    expect(classifyFault('The source is svc-a.', 'the reply is not JSON')).toBe('no-brace');
    expect(classifyFault('{"eliminate":[', 'the reply is not JSON')).toBe('never-closed');
    expect(classifyFault('{"eliminate": nope}', 'the reply is not JSON')).toBe('decode-error');
    expect(classifyFault('[]', 'the reply is not a JSON object')).toBe('shape-error');
    expect(classifyFault('{}', 'the reply carries 5 eliminations against a bound of 4')).toBe(
      'bound-error',
    );
    expect(classifyFault('{}', 'elimination 0 does not name a channel')).toBe('shape-error');
  });

  it('does not count braces inside quoted strings as open or closed', () => {
    // A service name may contain a brace; a scanner that counted it would call a valid reply "never-closed" and
    // repair an answer that needed no repair.
    expect(classifyFault('{"eliminate":[{"remove":"a{b","keep":"c"}]}', 'shape')).toBe(
      'shape-error',
    );
    expect(classifyFault('{"eliminate":[{"remove":"a}b","keep":"c"}]}', 'shape')).toBe(
      'shape-error',
    );
  });

  it('sees an unterminated string whose brace is unclosed as never-closed', () => {
    expect(classifyFault('{"eliminate":[{"remove":"a{b', 'the reply is not JSON')).toBe(
      'never-closed',
    );
  });

  it('honours an escaped quote inside a string, so a brace after it is still counted correctly', () => {
    // `\"` is one quote inside the string, not the end of it; a scanner that ended the string there would count
    // the following brace as structural and misclassify a balanced reply.
    const balanced = '{"remove":"a\\"{b","keep":"c"}';
    expect(classifyFault(balanced, 'the reply is not a JSON object')).toBe('shape-error');
    const unclosed = '{"remove":"a\\"{b","keep":"c"';
    expect(classifyFault(unclosed, 'the reply is not JSON')).toBe('never-closed');
  });

  it('treats a closing brace with no opening one as a decode error, not a repairable open object', () => {
    // A leading `}` is not an object waiting to be closed — counting it as "never-closed" would ask the model to
    // close something that was never opened. The parser's decode failure is the honest category.
    expect(classifyFault('} garbage {', 'the reply is not JSON')).toBe('decode-error');
  });
});

describe('buildRepairTurn', () => {
  it('feeds the exact error and the rejected reply back verbatim, beside the original question', () => {
    const why = 'the reply carries 5 eliminations against a bound of 4';
    const turn = buildRepairTurn(prompt, 'first bad reply', why, 'bound-error', 2, 3);
    expect(turn.user).toContain(prompt.user);
    expect(turn.user).toContain('first bad reply');
    expect(turn.user).toContain(why);
    expect(turn.system).toContain(why);
    expect(turn.system).toContain(prompt.system);
    expect(turn.user).toContain('bound-error');
    expect(turn.system).toContain('attempt 2 of 3');
  });

  it('is a pure function of its inputs, and a different attempt is a different question', () => {
    const a = buildRepairTurn(prompt, 'bad', 'why', 'decode-error', 1, 3);
    const again = buildRepairTurn(prompt, 'bad', 'why', 'decode-error', 1, 3);
    const next = buildRepairTurn(prompt, 'bad', 'why', 'decode-error', 2, 3);
    expect(again).toEqual(a);
    expect(again.digest).toBe(a.digest);
    expect(next.digest).not.toBe(a.digest);
    expect(a.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('truncates a runaway rejected reply so a repair cannot amplify the bill', () => {
    const huge = 'x'.repeat(5000);
    const turn = buildRepairTurn(prompt, huge, 'the reply was empty', 'empty', 1, 3);
    expect(turn.user.length).toBeLessThan(4000);
    expect(turn.user).toContain('[truncated]');
  });
});

describe('repairSynthesis', () => {
  const ok = async (_turn: RepairTurn): Promise<SynthesisReply> => reply(VALID);

  it('does not call the model when the first reply already parsed', async () => {
    let calls = 0;
    const outcome = await repairSynthesis(prompt, reply(VALID), async () => {
      calls += 1;
      return reply(VALID);
    });
    expect(calls).toBe(0);
    expect(outcome.ok).toBe(true);
    expect(outcome.attempts).toBe(1);
    expect(outcome.repairs).toBe(0);
    expect(outcome.recovered).toBe(false);
    expect(outcome.faults).toEqual([]);
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.promptTokens).toBe(100);
    expect(outcome.completionTokens).toBe(20);
    expect(outcome.steps).toHaveLength(1);
  });

  it('repairs a malformed first reply and counts the extra call and its tokens', async () => {
    const first = reply('The source is svc-a.', { promptTokens: 90, completionTokens: 8 });
    const fed: string[] = [];
    const outcome = await repairSynthesis(prompt, first, async (turn) => {
      fed.push(turn.user);
      return reply(VALID, { promptTokens: 200, completionTokens: 30 });
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.recovered).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(outcome.repairs).toBe(1);
    expect(outcome.faults).toEqual(['no-brace']);
    expect(outcome.claims).toHaveLength(1);
    expect(outcome.promptTokens).toBe(290);
    expect(outcome.completionTokens).toBe(38);
    expect(fed[0]).toContain('the reply is not JSON');
    expect(outcome.steps).toHaveLength(2);
    expect(outcome.steps[0]!.fault).toBe('no-brace');
    expect(outcome.steps[1]!.fault).toBeNull();
  });

  it('retries on successive malformed replies and stops at the first valid one', async () => {
    const script = [
      reply('{', { promptTokens: 1, completionTokens: 1 }),
      reply('[]', { promptTokens: 2, completionTokens: 2 }),
      reply(VALID, { promptTokens: 3, completionTokens: 3 }),
    ];
    let at = 0;
    const outcome = await repairSynthesis(prompt, reply('bad'), async () => script[at++]!);
    expect(outcome.ok).toBe(true);
    expect(outcome.recovered).toBe(true);
    // One first synthesis plus three repair calls, the last of which parsed.
    expect(outcome.attempts).toBe(4);
    expect(outcome.repairs).toBe(3);
    expect(outcome.faults).toEqual(['no-brace', 'never-closed', 'shape-error']);
    expect(outcome.promptTokens).toBe(106);
    expect(outcome.completionTokens).toBe(26);
  });

  it('exhausts the default budget and reports the last reason, not the first', async () => {
    const outcome = await repairSynthesis(prompt, reply('bad'), async () => reply('still bad'));
    expect(outcome.ok).toBe(false);
    expect(outcome.recovered).toBe(false);
    expect(outcome.repairs).toBe(DEFAULT_REPAIR_ATTEMPTS);
    expect(outcome.attempts).toBe(DEFAULT_REPAIR_ATTEMPTS + 1);
    expect(outcome.faults).toHaveLength(DEFAULT_REPAIR_ATTEMPTS + 1);
    expect(outcome.why).toBe('the reply is not JSON');
    expect(outcome.claims).toEqual([]);
  });

  it('never exceeds the hard cap even when a caller asks for more', async () => {
    const outcome = await repairSynthesis(prompt, reply('bad'), async () => reply('still bad'), {
      maxAttempts: 999,
    });
    expect(outcome.repairs).toBe(MAX_REPAIR_ATTEMPTS);
    expect(outcome.attempts).toBe(MAX_REPAIR_ATTEMPTS + 1);
  });

  it('makes exactly one repair call when the budget is one', async () => {
    let calls = 0;
    const outcome = await repairSynthesis(
      prompt,
      reply('bad'),
      async () => {
        calls += 1;
        return reply(VALID);
      },
      { maxAttempts: 1 },
    );
    expect(calls).toBe(1);
    expect(outcome.ok).toBe(true);
    expect(outcome.recovered).toBe(true);
    expect(outcome.attempts).toBe(2);
    expect(outcome.repairs).toBe(1);
  });

  it('refuses a non-positive attempt count rather than silently repairing zero times', async () => {
    await expect(repairSynthesis(prompt, reply('bad'), ok, { maxAttempts: 0 })).rejects.toThrow(
      'maxAttempts must be a positive integer',
    );
    await expect(repairSynthesis(prompt, reply('bad'), ok, { maxAttempts: 1.5 })).rejects.toThrow(
      'maxAttempts must be a positive integer',
    );
  });

  it('leaves a transport failure to the caller, which owns retries and the failure census', async () => {
    await expect(
      repairSynthesis(prompt, reply('bad'), async () => {
        throw new Error('the endpoint answered 503');
      }),
    ).rejects.toThrow('the endpoint answered 503');
  });

  it('carries a protocol version so a recorded repair can be told from a different contract', () => {
    expect(SYNTHESIS_REPAIR_PROTOCOL).toBe(1);
    expect(DEFAULT_REPAIR_ATTEMPTS).toBeLessThanOrEqual(MAX_REPAIR_ATTEMPTS);
  });

  it('uses the default claim bound when the caller supplies none', async () => {
    const tooMany = JSON.stringify({ eliminate: Array(9).fill(null) });
    const outcome = await repairSynthesis(prompt, reply(tooMany), ok, { maxAttempts: 2 });
    expect(outcome.faults[0]).toBe('bound-error');
    expect(outcome.claims).toHaveLength(1);
    expect(DEFAULT_ELIMINATOR_OPTIONS.maxClaims).toBeGreaterThan(0);
  });
});
