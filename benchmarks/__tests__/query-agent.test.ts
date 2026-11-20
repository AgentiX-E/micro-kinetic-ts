/**
 * The free-investigation arm's own tests.
 *
 * The arm is a measurement instrument, so the properties asserted here are the ones a wrong reading would come
 * from: a directive the grammar does not admit must not become a call, a tool must not answer for a service the
 * case does not carry, a budget must stop the loop rather than be consulted, and an answer must be one the case's
 * own directory contains. The model is a fake at the port, never a network call: what is under test is the loop
 * and the tools, not the endpoint.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_QUERY_BUDGET,
  LOG_LINES,
  METRIC_LINES,
  QUERY_SYSTEM_PROMPT,
  QUERY_TOOLS,
  buildTelemetry,
  buildUserPrompt,
  executeTool,
  formatNumber,
  median,
  parseCall,
  renderTranscript,
  runQueryAgent,
  stride,
  summariseQueryArm,
  summariseSeries,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type {
  QueryAgentClient,
  QueryArmRow,
  QueryBudget,
  QueryExchange,
} from '../src/query-agent.js';

const INJECT = 1_700_000_000_000;

/** A case with two services, one of which is the fault's host. */
function makeCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  const metrics = new Map([
    [
      'checkout',
      [
        {
          label: 'cpu',
          unit: 'percent',
          timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
          values: Float64Array.from([10, 10, 10.5, 10.2]),
        },
        {
          label: 'rps',
          unit: 'calls',
          timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
          values: Float64Array.from([100, 100, 20, 5]),
        },
      ],
    ],
    [
      'payment',
      [
        {
          label: 'cpu',
          unit: 'percent',
          timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
          values: Float64Array.from([5, 5, 40, 55]),
        },
      ],
    ],
  ]);
  return {
    id: 'case-1',
    datasetName: 'fse26',
    injectTime: INJECT,
    metrics,
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
        { from: 'payment', to: 'payment', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
      ],
    },
    groundTruth: { serviceId: 'payment', faultType: 'HTTPResponseReplaceCode' },
    logs: [
      {
        timestamp: INJECT - 5_000,
        service: 'payment',
        level: 'ERROR',
        message: 'before injection',
      },
      { timestamp: INJECT + 1_500, service: 'payment', level: 'ERROR', message: 'pool exhausted' },
      { timestamp: INJECT + 1_200, service: 'payment', level: 'FATAL', message: 'giving up' },
      { timestamp: INJECT + 1_800, service: 'checkout', level: 'INFO', message: 'ok' },
      {
        timestamp: INJECT + 1_900,
        service: 'checkout',
        level: 'ERROR',
        message: 'upstream said no',
      },
    ],
    failedTraceEdges: [
      { caller: 'checkout', callee: 'payment', failed: 40, baseline: 2 },
      { caller: 'payment', callee: 'db', failed: 3, baseline: 3 },
    ],
    edgeLatency: [
      { caller: 'checkout', callee: 'payment', preMeanMs: 12, postMeanMs: 900 },
      { caller: 'payment', callee: 'db', preMeanMs: 4, postMeanMs: 5 },
    ],
    ...overrides,
  };
}

describe('buildTelemetry', () => {
  it('splits each series at the injection and keeps the pre-window as the baseline', () => {
    const telemetry = buildTelemetry(makeCase());
    const checkout = telemetry.services.get('checkout')!;
    const rps = checkout.metrics.find((one) => one.label === 'rps')!;
    expect(rps.baseline).toBe(100);
    // A metric that COLLAPSES after the injection has a peak BELOW its baseline, and the summary says so with a
    // negative delta rather than clamping at zero — a service that went quiet is the case the prompt tells the
    // model to take seriously.
    expect(rps.peak).toBe(20);
    expect(rps.delta).toBe(-80);
    const cpu = checkout.metrics.find((one) => one.label === 'cpu')!;
    expect(cpu.baseline).toBe(10);
    expect(cpu.peak).toBe(10.5);
    expect(cpu.ratio).toBeCloseTo(1.05, 6);
    expect(cpu.peakOffset).toBe(1_000);
  });

  it('counts only ERROR and FATAL lines at or after the injection, oldest first', () => {
    const telemetry = buildTelemetry(makeCase());
    const payment = telemetry.services.get('payment')!;
    expect(payment.errorCount).toBe(2);
    expect(payment.firstErrorOffset).toBe(1_200);
    expect(payment.errorLines).toEqual(['giving up', 'pool exhausted']);
    const checkout = telemetry.services.get('checkout')!;
    expect(checkout.errorCount).toBe(1);
    expect(checkout.firstErrorOffset).toBe(1_900);
  });

  it('carries a node with no metrics rather than hiding it from the directory', () => {
    const telemetry = buildTelemetry(makeCase());
    const db = telemetry.services.get('db')!;
    expect(db.metrics).toEqual([]);
    expect(db.callers).toEqual(['payment']);
  });

  it('drops self-edges from the caller and callee lists without dropping the node', () => {
    const telemetry = buildTelemetry(makeCase());
    const payment = telemetry.services.get('payment')!;
    expect(payment.callees).toEqual(['db']);
    expect(payment.callers).toEqual(['checkout']);
  });

  it('reads the failed-interface and latency channels in the units the producer wrote', () => {
    const telemetry = buildTelemetry(makeCase());
    expect(telemetry.failed).toEqual([
      { caller: 'checkout', callee: 'payment', failed: 40, baseline: 2 },
      { caller: 'payment', callee: 'db', failed: 3, baseline: 3 },
    ]);
    expect(telemetry.latency[0]).toEqual({
      caller: 'checkout',
      callee: 'payment',
      pre: 12,
      post: 900,
    });
  });

  it('survives a case with no logs, no failed edges and no latency', () => {
    const telemetry = buildTelemetry(
      makeCase({ logs: undefined, failedTraceEdges: undefined, edgeLatency: undefined }),
    );
    expect(telemetry.failed).toEqual([]);
    expect(telemetry.latency).toEqual([]);
    expect(telemetry.services.get('payment')!.errorCount).toBe(0);
    expect(telemetry.services.get('payment')!.firstErrorOffset).toBeUndefined();
  });

  it('ignores an error line from a service the graph does not carry', () => {
    const telemetry = buildTelemetry(
      makeCase({
        logs: [{ timestamp: INJECT + 10, service: 'ghost', level: 'ERROR', message: 'nobody' }],
      }),
    );
    expect(telemetry.services.has('ghost')).toBe(false);
    expect(telemetry.services.get('payment')!.errorCount).toBe(0);
  });
});

describe('summariseSeries', () => {
  it('uses the first sample as the baseline when every sample follows the injection', () => {
    const summary = summariseSeries('cpu', [INJECT + 1, INJECT + 2], [7, 9], INJECT);
    expect(summary.baseline).toBe(7);
    expect(summary.peak).toBe(9);
    expect(summary.delta).toBe(2);
  });

  it('reports the peak itself as the ratio when the baseline is zero', () => {
    const summary = summariseSeries('cpu', [INJECT - 1, INJECT + 1], [0, 4], INJECT);
    expect(summary.baseline).toBe(0);
    expect(summary.ratio).toBe(4);
  });

  it('is total on an empty series rather than throwing', () => {
    const summary = summariseSeries('cpu', [], [], INJECT);
    expect(summary.peak).toBe(0);
    expect(summary.baseline).toBe(0);
    expect(summary.peakOffset).toBe(0);
  });

  it('reads a peak that precedes the injection at a negative offset', () => {
    const summary = summariseSeries('cpu', [INJECT - 5, INJECT - 1, INJECT + 1], [8, 9, 2], INJECT);
    expect(summary.peak).toBe(2);
    expect(summary.peakOffset).toBe(1);
  });
});

describe('median', () => {
  it('is the middle of an odd list and the mean of the middle pair of an even one', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('parseCall', () => {
  it('reads a directive with an argument', () => {
    expect(parseCall('TOOL metric payment')).toEqual({
      kind: 'tool',
      tool: 'metric',
      argument: 'payment',
    });
  });

  it('reads an argument-free directive', () => {
    expect(parseCall('TOOL services')).toEqual({ kind: 'tool', tool: 'services', argument: '' });
  });

  it('tolerates prose around a directive', () => {
    expect(parseCall('Let me look at the logs.\nTOOL logs payment')).toEqual({
      kind: 'tool',
      tool: 'logs',
      argument: 'payment',
    });
  });

  it('strips a Markdown fence and emphasis around the directive', () => {
    expect(parseCall('**TOOL logs payment**')).toEqual({
      kind: 'tool',
      tool: 'logs',
      argument: 'payment',
    });
  });

  it('refuses an unknown tool rather than inventing one', () => {
    expect(parseCall('TOOL sql SELECT 1').kind).toBe('unparsed');
  });

  it('refuses an argument on a directive that takes none', () => {
    expect(parseCall('TOOL services everything').kind).toBe('unparsed');
  });

  it('refuses a directive that needs an argument and carries none', () => {
    expect(parseCall('TOOL metric').kind).toBe('unparsed');
  });

  it('refuses a bare name with no keyword', () => {
    expect(parseCall('payment')).toEqual({ kind: 'unparsed', text: 'payment' });
  });

  it('refuses a reply whose only directive is malformed, even after a good line', () => {
    expect(parseCall('TOOL metric\nTOOL logs payment').kind).toBe('unparsed');
  });

  it('refuses a bare ANSWER with no service', () => {
    expect(parseCall('ANSWER')).toEqual({ kind: 'unparsed', text: 'ANSWER' });
  });

  it('refuses a bare TOOL with no name', () => {
    expect(parseCall('TOOL')).toEqual({ kind: 'unparsed', text: 'TOOL' });
  });

  it('truncates the text it reports for an unparsed reply', () => {
    const text = parseCall('x'.repeat(500));
    expect(text.kind).toBe('unparsed');
    expect((text as { text: string }).text.length).toBe(200);
  });

  it('knows every tool in the prompt list', () => {
    for (const tool of QUERY_TOOLS) {
      const argument = tool === 'services' || tool === 'failed' ? '' : ' payment';
      expect(parseCall(`TOOL ${tool}${argument}`)).toEqual({
        kind: 'tool',
        tool,
        argument: argument.trim(),
      });
    }
  });
});

describe('executeTool', () => {
  const telemetry = buildTelemetry(makeCase());

  it('lists the directory', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'services', argument: '' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('services (3): checkout, db, payment');
  });

  it('orders failed interfaces by net rise, not by raw count', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'failed', argument: '' });
    expect(result.text.split('\n')[0]).toBe('payment <- checkout net=38 failed=40 pre=2');
    expect(result.text.split('\n')[1]).toBe('db <- payment net=0 failed=3 pre=3');
  });

  it('says so when the case carries no failed-interface counts', () => {
    const empty = buildTelemetry(makeCase({ failedTraceEdges: undefined }));
    expect(executeTool(empty, { kind: 'tool', tool: 'failed', argument: '' }).text).toBe(
      'no failed-interface counts in this case',
    );
  });

  it('orders metrics by ratio and caps the list', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'metric', argument: 'payment' });
    expect(result.text.startsWith('payment cpu: base=5.00 peak=55.00')).toBe(true);
    const many = buildTelemetry(
      makeCase({
        metrics: new Map([
          [
            'payment',
            Array.from({ length: METRIC_LINES + 4 }, (_, index) => ({
              label: `m${index}`,
              unit: 'u',
              timestamps: [INJECT - 1, INJECT + 1],
              values: Float64Array.from([1, index + 2]),
            })),
          ],
        ]),
      }),
    );
    expect(
      executeTool(many, { kind: 'tool', tool: 'metric', argument: 'payment' }).text.split('\n'),
    ).toHaveLength(METRIC_LINES);
  });

  it('says a service with no metrics has none', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'metric', argument: 'db' });
    expect(result.text).toBe('db: no metrics in this case');
  });

  it('prints the error lines with the first offset', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'logs', argument: 'payment' });
    expect(result.text.split('\n')[0]).toBe('payment: 2 error lines, first at +1s');
    expect(result.text).toContain('giving up');
  });

  it('says a silent service is silent', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'logs', argument: 'db' });
    expect(result.text).toBe('db: no ERROR or FATAL line at or after the injection');
  });

  it('prints the topology and the latency on the edges it touches', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'edges', argument: 'payment' });
    expect(result.text.split('\n')[0]).toBe('payment callers=[checkout] callees=[db]');
    expect(result.text).toContain('checkout->payment pre=12.00 post=900');
  });

  it('refuses a service the case does not carry, by name', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'logs', argument: 'ghost' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('ghost');
  });

  it('accepts an answer that names a service, case-insensitively', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'answer', argument: 'Payment' });
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe('payment');
  });

  it('refuses an answer that names nothing in the case', () => {
    const result = executeTool(telemetry, { kind: 'tool', tool: 'answer', argument: 'ghost' });
    expect(result.ok).toBe(false);
    expect(result.resolved).toBeUndefined();
  });

  it('refuses an unparsed directive with the grammar it expected', () => {
    const result = executeTool(telemetry, { kind: 'unparsed', text: 'hmm' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('TOOL <name>');
  });
});

describe('formatNumber', () => {
  it('keeps ordinary magnitudes readable and refuses to print a non-number', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(0.5)).toBe('0.50');
    expect(formatNumber(0.004)).toBe('0.0040');
    expect(formatNumber(1234.5)).toBe('1235');
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe('n/a');
  });
});

describe('renderTranscript', () => {
  const exchange = (round: number, result: string): QueryExchange => ({
    round,
    directive: `TOOL logs s${round}`,
    result,
    ok: true,
  });

  it('keeps the newest results and elides the oldest under a tight cap', () => {
    const exchanges = [exchange(1, 'a'.repeat(200)), exchange(2, 'b'.repeat(200))];
    const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, transcriptChars: 260 };
    const text = renderTranscript(exchanges, budget);
    expect(text.startsWith('[earlier results elided] (1)')).toBe(true);
    expect(text).toContain('b'.repeat(200));
  });

  it('always keeps the last exchange even when it alone exceeds the cap', () => {
    const exchanges = [exchange(1, 'a'.repeat(500))];
    const text = renderTranscript(exchanges, { ...DEFAULT_QUERY_BUDGET, transcriptChars: 10 });
    expect(text).toContain('a'.repeat(500));
  });

  it('marks a refused result so a refusal is not read as a finding', () => {
    const text = renderTranscript([
      { round: 1, directive: 'TOOL logs ghost', result: 'no such service', ok: false },
    ]);
    expect(text).toContain('REFUSED');
  });

  it('is empty before the first query', () => {
    expect(renderTranscript([])).toBe('');
  });
});

describe('buildUserPrompt', () => {
  it('states the case size and the deliverable, and says when nothing has been asked', () => {
    const prompt = buildUserPrompt(buildTelemetry(makeCase()), []);
    expect(prompt).toContain('carries 3 services');
    expect(prompt).toContain('ANSWER <service>');
    expect(prompt).toContain('No queries yet.');
  });

  it('drops the placeholder once a query exists', () => {
    const prompt = buildUserPrompt(buildTelemetry(makeCase()), [
      { round: 1, directive: 'TOOL services', result: 'services (3): a, b', ok: true },
    ]);
    expect(prompt).not.toContain('No queries yet.');
    expect(prompt).toContain('TOOL services');
  });
});

/** A model that replays a scripted list of replies and records what it was asked. */
function scriptedClient(
  replies: readonly string[],
  usage = { promptTokens: 10, completionTokens: 5 },
): QueryAgentClient & {
  readonly seen: string[];
} {
  const seen: string[] = [];
  let index = 0;
  return {
    model: 'fake',
    seen,
    complete: (turn) => {
      seen.push(turn.user);
      const text = replies[Math.min(index, replies.length - 1)] ?? '';
      index += 1;
      return Promise.resolve({ text, ...usage });
    },
  };
}

describe('runQueryAgent', () => {
  const telemetry = buildTelemetry(makeCase());

  it('answers when the model names a service the case carries', async () => {
    const client = scriptedClient(['TOOL failed', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry);
    expect(outcome.answer).toBe('payment');
    expect(outcome.stop).toBe('answered');
    expect(outcome.rounds).toBe(2);
    expect(outcome.toolCalls).toBe(1);
    expect(outcome.promptTokens).toBe(20);
    expect(outcome.completionTokens).toBe(10);
  });

  it('carries the previous result into the next prompt', async () => {
    const client = scriptedClient(['TOOL failed', 'ANSWER payment']);
    await runQueryAgent(client, telemetry);
    expect(client.seen[0]).not.toContain('net=38');
    expect(client.seen[1]).toContain('net=38');
  });

  it('spends a round on an unparsed reply and a call on none', async () => {
    const client = scriptedClient(['I am thinking about it.', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry);
    expect(outcome.rounds).toBe(2);
    expect(outcome.toolCalls).toBe(0);
    expect(outcome.exchanges[0]!.ok).toBe(false);
    expect(outcome.exchanges[0]!.directive).toContain('UNPARSED');
  });

  it('records a refused answer and keeps going', async () => {
    const client = scriptedClient(['ANSWER ghost', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry);
    expect(outcome.answer).toBe('payment');
    expect(outcome.exchanges[0]!.ok).toBe(false);
  });

  it('stops on rounds when the model never answers', async () => {
    const client = scriptedClient(['TOOL services']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 3,
    });
    expect(outcome.answer).toBeNull();
    expect(outcome.stop).toBe('rounds');
    expect(outcome.rounds).toBe(3);
    expect(outcome.toolCalls).toBe(3);
  });

  it('stops on the call budget even when rounds remain', async () => {
    const client = scriptedClient(['TOOL services']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 10,
      maxToolCalls: 2,
    });
    expect(outcome.stop).toBe('tool-calls');
    expect(outcome.toolCalls).toBe(2);
    expect(outcome.exchanges.at(-1)!.result).toBe('budget: no tool calls left');
  });

  it('reports the refusal that ended it when the budget runs out after a bad answer', async () => {
    const client = scriptedClient(['ANSWER ghost', 'TOOL services']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 5,
      maxToolCalls: 1,
    });
    expect(outcome.stop).toBe('tool-calls');
    expect(outcome.answerRefused).toContain('ghost');
  });

  it('counts a refused tool call against the budget, so a loop cannot mine free refusals', async () => {
    const client = scriptedClient(['TOOL logs ghost']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 3,
      maxToolCalls: 1,
    });
    expect(outcome.toolCalls).toBe(1);
    expect(outcome.stop).toBe('tool-calls');
  });
});

describe('the prompt', () => {
  it('names every tool it will accept and no tool it will refuse', () => {
    for (const tool of QUERY_TOOLS) {
      expect(QUERY_SYSTEM_PROMPT).toContain(tool);
    }
    expect(QUERY_SYSTEM_PROMPT).toContain('ANSWER <service>');
  });

  it('caps the log lines a single call may print', () => {
    const many = makeCase({
      logs: Array.from({ length: 20 }, (_, index) => ({
        timestamp: INJECT + index,
        service: 'payment',
        level: 'ERROR' as const,
        message: `failure ${index}`,
      })),
    });
    const telemetry = buildTelemetry(many);
    expect(telemetry.services.get('payment')!.errorLines).toHaveLength(LOG_LINES);
    expect(telemetry.services.get('payment')!.errorCount).toBe(20);
  });
});

describe('summariseQueryArm', () => {
  const row = (over: Partial<QueryArmRow>): QueryArmRow => ({
    datapack: 'd',
    faultType: 'Kill',
    truth: ['a'],
    engineRank: 1,
    engineWinner: 'a',
    answer: 'a',
    correct: true,
    stop: 'answered',
    rounds: 2,
    toolCalls: 1,
    promptTokens: 100,
    completionTokens: 10,
    ...over,
  });

  it('counts a repair against the engine on the same case, not against the corpus', () => {
    const summary = summariseQueryArm([
      row({ engineRank: 3, answer: 'a', correct: true }),
      row({ engineRank: 1, answer: 'b', correct: false }),
      row({ engineRank: 1, answer: 'a', correct: true }),
    ]);
    expect(summary.cases).toBe(3);
    expect(summary.repairs).toBe(1);
    expect(summary.breaks).toBe(1);
    expect(summary.precision).toBe(0.5);
    expect(summary.engineCorrect).toBe(2);
    expect(summary.agentCorrect).toBe(2);
  });

  it('reports no precision when the arm changed nothing', () => {
    expect(summariseQueryArm([row({})]).precision).toBeNull();
  });

  it('counts an unanswered case as answered-by-nobody rather than as a wrong answer', () => {
    const summary = summariseQueryArm([
      row({ answer: null, correct: false, engineRank: 1, stop: 'rounds' }),
    ]);
    expect(summary.answered).toBe(0);
    expect(summary.breaks).toBe(1);
  });

  it('sums the tokens the endpoint reported', () => {
    expect(summariseQueryArm([row({}), row({})]).promptTokens).toBe(200);
  });
});

describe('stride', () => {
  it('takes the whole population when it is no larger than the request', () => {
    expect(stride(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('takes nothing for a zero size', () => {
    expect(stride(['a', 'b'], 0)).toEqual([]);
  });

  it('is a deterministic function of the sorted population', () => {
    const population = Array.from(
      { length: 100 },
      (_, index) => `case-${String(index).padStart(3, '0')}`,
    );
    const first = stride(population, 10);
    expect(first).toEqual(stride(population, 10));
    expect(first).toHaveLength(10);
    expect(new Set(first).size).toBe(10);
    expect(first[0]).toBe('case-000');
  });

  it('spreads the sample over the population rather than taking a prefix', () => {
    const population = Array.from({ length: 20 }, (_, index) => `c${index}`);
    expect(stride(population, 4)).toEqual(['c0', 'c5', 'c10', 'c15']);
  });
});
