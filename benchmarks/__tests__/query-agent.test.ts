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
  TRACE_CHARS,
  buildTelemetry,
  buildUserPrompt,
  executeTool,
  formatNumber,
  median,
  parseCall,
  renderBudget,
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

  it('trims a log line to a length a prompt can carry, and says it did', () => {
    const long = makeCase({
      logs: [
        {
          timestamp: INJECT + 500,
          service: 'payment',
          level: 'ERROR',
          message: 'x'.repeat(400),
        },
      ],
    });
    const line = buildTelemetry(long).services.get('payment')!.errorLines[0]!;
    expect(line).toHaveLength(141);
    expect(line.endsWith('…')).toBe(true);
  });

  it('ignores an edge whose endpoint the snapshot does not carry, instead of inventing one', () => {
    const partial = makeCase({
      callGraph: {
        systemLoad: 0,
        nodes: new Map([
          ['payment', { id: 'payment', name: 'payment', namespace: 'shop', labels: {} }],
        ]),
        edges: [
          {
            from: 'ghost',
            to: 'payment',
            type: 'REST',
            callRate: 1,
            p99Latency: 1,
            errorRate: 0,
          },
          {
            from: 'payment',
            to: 'ghost',
            type: 'REST',
            callRate: 1,
            p99Latency: 1,
            errorRate: 0,
          },
        ],
      },
    });
    const telemetry = buildTelemetry(partial);
    expect(telemetry.services.get('payment')!.callers).toEqual([]);
    expect(telemetry.services.get('payment')!.callees).toEqual([]);
    expect(telemetry.services.has('ghost')).toBe(false);
  });

  it('summarises an empty series as zero rather than as a non-number', () => {
    const empty = makeCase({
      metrics: new Map([
        [
          'payment',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [],
              values: Float64Array.from([]),
            },
          ],
        ],
      ]),
    });
    const series = buildTelemetry(empty).services.get('payment')!.metrics[0]!;
    expect(series.baseline).toBe(0);
    expect(series.peak).toBe(0);
    expect(series.delta).toBe(0);
    expect(series.ratio).toBe(0);
  });

  it('lists a repeated edge once, because a duplicate is a producer artefact and not a second caller', () => {
    const doubled = makeCase();
    const edge = {
      from: 'checkout',
      to: 'payment',
      type: 'REST' as const,
      callRate: 10,
      p99Latency: 5,
      errorRate: 0,
    };
    const telemetry = buildTelemetry({
      ...doubled,
      callGraph: { ...doubled.callGraph, edges: [...doubled.callGraph.edges, edge] },
    });
    expect(telemetry.services.get('payment')!.callers).toEqual(['checkout']);
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
      // Three tools take no argument because they are questions about the CASE rather than about one service.
      const argument =
        tool === 'services' || tool === 'failed' || tool === 'fleet' ? '' : ' payment';
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

  it('carries the budget the model is planning against', () => {
    const prompt = buildUserPrompt(buildTelemetry(makeCase()), [], {
      round: 2,
      maxRounds: 6,
      callsLeft: 5,
      forcing: false,
    });
    expect(prompt).toContain('round 2 of 6');
    expect(prompt).toContain('5 tool calls left');
  });
});

describe('renderBudget', () => {
  it('names the round, the calls left, and that an unanswered case scores zero', () => {
    const text = renderBudget({ round: 3, maxRounds: 6, callsLeft: 4, forcing: false });
    expect(text).toContain('round 3 of 6');
    expect(text).toContain('4 tool calls left');
    expect(text).toContain('scores zero');
  });

  it('turns into an order on the last round rather than a report', () => {
    const text = renderBudget({ round: 6, maxRounds: 6, callsLeft: 0, forcing: true });
    expect(text).toContain('LAST turn');
    expect(text).toContain('ANSWER <service>');
  });

  it('says `1 tool call` rather than `1 tool calls`', () => {
    expect(renderBudget({ round: 1, maxRounds: 6, callsLeft: 1, forcing: false })).toContain(
      '1 tool call left',
    );
  });
});

describe('TOOL fleet', () => {
  it('is a directive the grammar admits with no argument', () => {
    expect(parseCall('TOOL fleet')).toEqual({ kind: 'tool', tool: 'fleet', argument: '' });
  });

  it('refuses an argument, because the fleet is the whole case', () => {
    expect(parseCall('TOOL fleet payment').kind).toBe('unparsed');
  });

  it('ranks every service by its strongest rise, in one call', () => {
    const result = executeTool(buildTelemetry(makeCase()), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.ok).toBe(true);
    // `payment` carries the injected rise; `checkout`'s best ratio is a 1.05 on cpu, so it must not lead.
    expect(result.text.indexOf('payment')).toBeLessThan(result.text.indexOf('checkout'));
    expect(result.text).toContain('ratio=');
  });

  it('says so when the case carries no metric series at all', () => {
    const bare = makeCase({ metrics: new Map() });
    const result = executeTool(buildTelemetry(bare), { kind: 'tool', tool: 'fleet', argument: '' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('no metric series');
  });

  it('shows the collapse as well as the rises, because a root cause can be the service that went quiet', () => {
    const result = executeTool(buildTelemetry(makeCase()), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.text).toContain('falling');
    expect(result.text).toContain('rps');
  });

  it('never prints a rank the engine computed, because this arm is not a reranker of it', () => {
    const result = executeTool(buildTelemetry(makeCase()), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.text).not.toContain('rank');
  });

  it('omits the collapse section when nothing collapsed', () => {
    const rising = makeCase({
      metrics: new Map([
        [
          'payment',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([5, 55]),
            },
          ],
        ],
      ]),
    });
    const result = executeTool(buildTelemetry(rising), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.text).not.toContain('falling');
  });

  it('picks each service\u2019s deepest fall, not the delta of its best rise', () => {
    const twin = makeCase({
      metrics: new Map([
        [
          'checkout',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([10, 12]),
            },
            {
              label: 'rps',
              unit: 'calls',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([100, 20]),
            },
            {
              label: 'throughput',
              unit: 'calls',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([50, 1]),
            },
          ],
        ],
      ]),
    });
    const result = executeTool(buildTelemetry(twin), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    const falling = result.text.slice(result.text.indexOf('falling:'));
    // One service contributes one fall — its deepest — so the 49-point drop on `throughput` is not printed beside
    // the 80-point drop on `rps`: the section answers "which services lost the most", not "which series did".
    expect(falling).toContain('rps');
    expect(falling).not.toContain('throughput');
    expect(falling).not.toContain('cpu');
  });
});

describe('TOOL metric, both directions', () => {
  it('reports a collapsing metric beside the rises instead of hiding it', () => {
    const result = executeTool(buildTelemetry(makeCase()), {
      kind: 'tool',
      tool: 'metric',
      argument: 'checkout',
    });
    expect(result.text).toContain('falling');
    expect(result.text).toContain('rps');
  });

  it('says nothing about a collapse when every series in the service rose', () => {
    const result = executeTool(buildTelemetry(makeCase()), {
      kind: 'tool',
      tool: 'metric',
      argument: 'payment',
    });
    expect(result.text).not.toContain('falling');
  });

  it('orders two collapses by how far each one fell, deepest first', () => {
    const twin = makeCase({
      metrics: new Map([
        [
          'checkout',
          [
            {
              label: 'rps',
              unit: 'calls',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([100, 20]),
            },
            {
              label: 'throughput',
              unit: 'calls',
              timestamps: [INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([50, 1]),
            },
          ],
        ],
      ]),
    });
    const result = executeTool(buildTelemetry(twin), {
      kind: 'tool',
      tool: 'metric',
      argument: 'checkout',
    });
    const falling = result.text.slice(result.text.indexOf('falling:'));
    expect(falling).toContain('falling:');
    // rps fell 80 of 100 and throughput 49 of 50, so the deeper absolute fall leads.
    expect(falling.indexOf('rps')).toBeLessThan(falling.indexOf('throughput'));
  });
});

describe('the forcing turn', () => {
  it('records a rejected answer and ends there, rather than spending a turn it does not have', async () => {
    const client = scriptedClient(['TOOL services', 'ANSWER ghost']);
    const outcome = await runQueryAgent(client, buildTelemetry(makeCase()), {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 2,
      maxToolCalls: 10,
    });
    expect(outcome.answer).toBeNull();
    expect(outcome.stop).toBe('rounds');
    expect(outcome.answerRefused).toContain('ghost');
    expect(outcome.rounds).toBe(2);
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

describe('the trace the artifact keeps', () => {
  it('carries what was asked and what came back, so a wrong answer is diagnosable', async () => {
    // The v2 pilot answered all 160 cases and was still 26 cases worse than the engine, and NOTHING in the artifact
    // could say why: the row carried rounds and tokens but not one exchange. A reading nobody can look inside is a
    // reading that cannot be acted on.
    const client = scriptedClient(['TOOL fleet', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, buildTelemetry(makeCase()));
    expect(outcome.trace).toContain('TOOL fleet');
    expect(outcome.trace).toContain('ANSWER payment');
    expect(outcome.trace.length).toBeLessThanOrEqual(TRACE_CHARS + 40);
  });

  it('keeps the END of a long transcript, because the end is what the answer was made from', async () => {
    const many = Array.from({ length: 40 }, (_, index) => `TOOL metric s${index}`);
    const client = scriptedClient([...many, 'ANSWER payment']);
    const outcome = await runQueryAgent(client, buildTelemetry(makeCase()), {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 41,
      maxToolCalls: 40,
    });
    expect(outcome.trace).toContain('ANSWER payment');
    expect(outcome.trace).toContain('elided');
  });
});

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
    // The last round is an ORDER to answer, so a tool call there is refused instead of executed — two calls were
    // spent and the third was not.
    expect(outcome.toolCalls).toBe(2);
    expect(outcome.exchanges.at(-1)!.result).toContain('last turn');
  });

  it('tells the model which round it is on, and orders an answer on the last one', async () => {
    const client = scriptedClient(['TOOL services', 'TOOL services', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 3,
      maxToolCalls: 10,
    });
    expect(client.seen[0]).toContain('round 1 of 3');
    expect(client.seen[0]).toContain('10 tool calls left');
    expect(client.seen[1]).toContain('round 2 of 3');
    expect(client.seen[1]).toContain('9 tool calls left');
    expect(client.seen[2]).toContain('LAST turn');
    expect(outcome.answer).toBe('payment');
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
    // The round that spent the last call is followed by one more turn, and that turn only accepts an answer: a
    // budget that executes its own termination is a budget the model never gets to answer inside.
    expect(outcome.exchanges.at(-1)!.result).toContain('last turn');
  });

  it('still accepts an answer on the forcing turn, so the spent calls are not wasted', async () => {
    const client = scriptedClient(['TOOL services', 'TOOL services', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry, {
      ...DEFAULT_QUERY_BUDGET,
      maxRounds: 10,
      maxToolCalls: 2,
    });
    expect(outcome.stop).toBe('answered');
    expect(outcome.answer).toBe('payment');
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
    trace: 'TOOL fleet\n=> fleet: 1 service',
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

  it('reports a case it could not measure rather than scoring it as a break', () => {
    const summary = summariseQueryArm([
      row({ answer: null, correct: false, engineRank: 1, stop: 'error', promptTokens: 0 }),
    ]);
    expect(summary.failed).toBe(1);
    expect(summary.cases).toBe(0);
    expect(summary.breaks).toBe(0);
    expect(summary.precision).toBeNull();
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
