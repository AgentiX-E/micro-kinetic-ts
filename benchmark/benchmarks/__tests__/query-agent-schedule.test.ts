/**
 * The schedule arm's own tests: `TOOL next`, and the loop that walks it.
 *
 * The properties asserted here are the ones a wrong reading would come from. A schedule is the harness's order and
 * NOT the prompt's, so the first is that the free arm's prompt cannot carry the tool at all; the second is that a
 * served slot spends a call and is recorded as investigated, because a schedule that showed the model a service while
 * leaving the gate blind to it would refuse evidence the harness itself handed over; the third is that exhausting the
 * order is a refusal and not an empty list, for the reason every other refusal in this package is one.
 *
 * The model is a fake at the port, never a network call: what is under test is the harness, not an endpoint's mood.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTelemetry,
  DEFAULT_QUERY_BUDGET,
  executeTool,
  parseCall,
  QUERY_SYSTEM_PROMPT,
  runQueryAgent,
  SCHEDULED_SYSTEM_PROMPT,
  scheduleNames,
  type QueryAgentClient,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const INJECT = 1_700_000_000_000;

/** A case with three services whose ranks are 1 `checkout`, 2 `payment`, 3 `db`. */
function makeCase(): BenchmarkCase {
  const series = (base: number, peak: number) => ({
    label: 'cpu',
    unit: 'percent',
    timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
    values: Float64Array.from([base, base, peak, peak]),
  });
  return {
    id: 'case-schedule',
    datasetName: 'fse26',
    injectTime: INJECT,
    metrics: new Map([
      ['checkout', [series(10, 90)]],
      ['payment', [series(10, 50)]],
      ['db', [series(10, 20)]],
    ]),
    callGraph: {
      systemLoad: 0,
      nodes: new Map([
        ['checkout', { id: 'checkout', name: 'checkout', namespace: 'shop', labels: {} }],
        ['payment', { id: 'payment', name: 'payment', namespace: 'shop', labels: {} }],
        ['db', { id: 'db', name: 'db', namespace: 'shop', labels: {} }],
      ]),
      edges: [
        {
          from: 'checkout',
          to: 'payment',
          type: 'REST',
          callRate: 10,
          p99Latency: 5,
          errorRate: 0,
        },
        { from: 'payment', to: 'db', type: 'REST', callRate: 10, p99Latency: 5, errorRate: 0 },
      ],
    },
    groundTruth: { serviceId: 'db', faultType: 'HTTPResponseReplaceCode' },
    logs: [],
    failedTraceEdges: [],
    edgeLatency: [],
  };
}

/** A model that says what it is told, and remembers the system prompt it was given. */
function scripted(replies: readonly string[]): {
  client: QueryAgentClient;
  systems: string[];
  users: string[];
} {
  const systems: string[] = [];
  const users: string[] = [];
  let index = 0;
  const client: QueryAgentClient = {
    model: 'fake',
    complete: async (turn) => {
      systems.push(turn.system);
      users.push(turn.user);
      const text = replies[Math.min(index, replies.length - 1)]!;
      index += 1;
      return { text, promptTokens: 1, completionTokens: 1 };
    },
  };
  return { client, systems, users };
}

describe('the services a schedule can serve', () => {
  it('keeps the order it was given, and drops only what the case cannot describe', () => {
    const telemetry = buildTelemetry(makeCase());
    expect(scheduleNames(telemetry, ['payment', 'ghost', 'db'])).toEqual(['payment', 'db']);
  });

  it('drops a repeat, which would otherwise spend a second call on a service already shown', () => {
    const telemetry = buildTelemetry(makeCase());
    expect(scheduleNames(telemetry, ['db', 'db', 'payment'])).toEqual(['db', 'payment']);
  });

  it('drops the empty name, which would spend a call to describe nothing', () => {
    const telemetry = buildTelemetry(makeCase());
    expect(scheduleNames(telemetry, ['', 'db'])).toEqual(['db']);
  });
});

describe('TOOL next', () => {
  const telemetry = buildTelemetry(makeCase());

  it('is parsed as an argument-free tool, because it is a question about the route rather than about a service', () => {
    expect(parseCall('TOOL next')).toEqual({ kind: 'tool', tool: 'next', argument: '' });
  });

  it('refuses an argument, which would be a second way to name a service', () => {
    expect(parseCall('TOOL next db').kind).toBe('unparsed');
  });

  it('refuses on an arm that carries no schedule, and does not say the case has no services', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'next', argument: '' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('this arm carries no schedule');
    expect(result.cursor).toBeUndefined();
  });

  it('serves the next service in the order, numbered against the servable population', () => {
    const result = executeTool(
      telemetry,
      { kind: 'tool', tool: 'next', argument: '' },
      {
        order: ['checkout', 'payment', 'db'],
        cursor: 0,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.served).toBe('checkout');
    expect(result.cursor).toBe(1);
    expect(result.text.split('\n')[0]).toBe('next 1/3 — checkout');
  });

  it('serves exactly what `TOOL metric <id>` would have shown, so the two reads cannot drift', () => {
    const named = executeTool(telemetry, { kind: 'tool', tool: 'metric', argument: 'payment' });
    const scheduled = executeTool(
      telemetry,
      { kind: 'tool', tool: 'next', argument: '' },
      {
        order: ['payment', 'db'],
        cursor: 0,
      },
    );
    expect(scheduled.text).toBe(`next 1/2 — payment\n${named.text}`);
  });

  it('advances from the cursor it was given rather than from zero', () => {
    const result = executeTool(
      telemetry,
      { kind: 'tool', tool: 'next', argument: '' },
      {
        order: ['checkout', 'payment'],
        cursor: 1,
      },
    );
    expect(result.served).toBe('payment');
    expect(result.cursor).toBe(2);
  });

  it('numbers the servable population, not the raw order, so a skipped name cannot shift the count', () => {
    const result = executeTool(
      telemetry,
      { kind: 'tool', tool: 'next', argument: '' },
      {
        order: ['ghost', 'db'],
        cursor: 0,
      },
    );
    expect(result.text.split('\n')[0]).toBe('next 1/1 — db');
  });

  it('refuses past the end rather than returning an empty answer', () => {
    const result = executeTool(
      telemetry,
      { kind: 'tool', tool: 'next', argument: '' },
      {
        order: ['checkout'],
        cursor: 1,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.text).toContain('schedule is exhausted after 1 service');
    expect(result.cursor).toBeUndefined();
  });
});

describe('the loop that walks the schedule', () => {
  it('hands the model the schedule prompt and nothing else when a schedule is present', async () => {
    const { client, systems } = scripted(['TOOL next', 'ANSWER db']);
    await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      DEFAULT_QUERY_BUDGET,
      null,
      'none',
      'none',
      null,
      null,
      ['payment', 'db'],
    );
    expect(systems.every((one) => one === SCHEDULED_SYSTEM_PROMPT)).toBe(true);
  });

  it('leaves the free arm on the published prompt, which must not offer the tool it refuses', async () => {
    const { client, systems } = scripted(['ANSWER db']);
    await runQueryAgent(client, buildTelemetry(makeCase()));
    expect(systems).toEqual([QUERY_SYSTEM_PROMPT]);
  });

  it('records a served service as investigated, because the harness is the one that showed it', async () => {
    const { client } = scripted(['TOOL next', 'TOOL next', 'ANSWER db']);
    const outcome = await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      DEFAULT_QUERY_BUDGET,
      null,
      'none',
      'none',
      null,
      null,
      ['payment', 'db'],
    );
    expect(outcome.investigated).toEqual(['payment', 'db']);
    expect(outcome.toolCalls).toBe(2);
    expect(outcome.answer).toBe('db');
    expect(outcome.stop).toBe('answered');
  });

  it('spends a call per served slot, so the schedule cannot widen the budget it was given', async () => {
    const { client } = scripted(['TOOL next', 'TOOL next', 'ANSWER db']);
    const outcome = await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      { maxRounds: 6, maxToolCalls: 2, transcriptChars: 9_000 },
      null,
      'none',
      'none',
      null,
      null,
      ['checkout', 'payment', 'db'],
    );
    // Two calls are the wall. The schedule had a third slot and could not spend it: the turn after the second call
    // is the forced one, and a forced turn accepts an answer and nothing else. That is the budget being a wall rather
    // than a hope, measured on the schedule rather than argued from it.
    expect(outcome.toolCalls).toBe(2);
    expect(outcome.investigated).toEqual(['checkout', 'payment']);
    expect(outcome.answer).toBe('db');
    expect(outcome.stop).toBe('answered');
  });

  it('does not walk a name the case does not carry', async () => {
    const { client } = scripted(['TOOL next', 'TOOL next', 'ANSWER db']);
    const outcome = await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      DEFAULT_QUERY_BUDGET,
      null,
      'none',
      'none',
      null,
      null,
      ['ghost', 'payment', 'db'],
    );
    expect(outcome.investigated).toEqual(['payment', 'db']);
  });

  it('keeps the investigation alive after the order runs out', async () => {
    const { client } = scripted(['TOOL next', 'TOOL next', 'TOOL logs db', 'ANSWER db']);
    const outcome = await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      DEFAULT_QUERY_BUDGET,
      null,
      'none',
      'none',
      null,
      null,
      ['payment'],
    );
    expect(outcome.investigated).toEqual(['payment', 'db']);
    expect(outcome.exchanges[1]!.result).toContain('schedule is exhausted');
    expect(outcome.answer).toBe('db');
  });
});
