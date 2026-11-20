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
  bySurprise,
  executeTool,
  formatNumber,
  gateAdmits,
  leadsEvidence,
  median,
  netBetween,
  onPriorCone,
  onsetOf,
  parseCall,
  projectOntoCorpus,
  renderBudget,
  renderGate,
  renderSeed,
  renderTranscript,
  runQueryAgent,
  stride,
  summariseGatePolicies,
  summariseQueryArm,
  summariseSeries,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type {
  ContrastEvidence,
  GateContext,
  GateReading,
  QueryAgentClient,
  QueryArmRow,
  QueryBudget,
  QueryExchange,
  QuerySeed,
  TelemetryMetric,
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

describe('a series the producer under-filled', () => {
  it('reads a series with no samples as a flat zero rather than as an invented baseline', () => {
    // A metric family can be declared and carry nothing, and the two degenerate branches here are the difference
    // between "no rise" and a division by a number that was never measured.
    const empty = summariseSeries('cpu', [], [], INJECT);
    expect(empty.baseline).toBe(0);
    expect(empty.peak).toBe(0);
    expect(empty.delta).toBe(0);
    expect(empty.ratio).toBe(0);
    expect(empty.surprise).toBeUndefined();
  });

  it('places a sample that carries no timestamp at the injection, which is the earliest time it can be about', () => {
    const short = summariseSeries('cpu', [INJECT - 1_000], [1, 2], INJECT);
    expect(short.baseline).toBe(1);
    expect(short.peak).toBe(2);
    expect(short.peakOffset).toBe(0);
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
    seeded: false,
    rounds: 2,
    toolCalls: 1,
    promptTokens: 100,
    completionTokens: 10,
    rawAnswer: 'a',
    answeredBy: 'model',
    calls: [],
    inCone: false,
    answerOnset: { firstError: null, fall: null },
    priorOnset: { firstError: null, fall: null },
    intoAnswer: null,
    intoPrior: null,
    gateRefusals: 0,
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

  it('reports retention on the cases the engine already had, because that is a seeded arm floor', () => {
    const summary = summariseQueryArm([
      row({}),
      row({ answer: 'b', correct: false }),
      row({ engineRank: 7, engineWinner: 'b', answer: 'b', correct: false }),
      row({ engineRank: 4, engineWinner: 'b', answer: 'a', correct: true }),
    ]);
    expect(summary.engineHits).toBe(2);
    expect(summary.engineHitsRetained).toBe(1);
    expect(summary.retention).toBe(0.5);
  });

  it('reports no retention when the engine had nothing to retain', () => {
    const summary = summariseQueryArm([row({ engineRank: 5, engineWinner: 'b' })]);
    expect(summary.engineHits).toBe(0);
    expect(summary.retention).toBeNull();
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

describe('the seed', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed = (candidates: readonly string[]): QuerySeed => ({ source: 'engine', candidates });

  it('numbers the engine order from one and keeps the order it was given', () => {
    const text = renderSeed(seed(['payment', 'checkout']), telemetry);
    expect(text).toContain('1. payment');
    expect(text).toContain('2. checkout');
    expect(text.indexOf('payment')).toBeLessThan(text.indexOf('checkout'));
  });

  it('says the order is a prior that evidence may contradict, because a seed read as an answer is a copy', () => {
    const text = renderSeed(seed(['payment']), telemetry);
    expect(text).toMatch(/prior/i);
    expect(text).toMatch(/wrong|contradict/i);
  });

  it('names where the order came from, so a transcript can say which arm produced it', () => {
    expect(renderSeed(seed(['payment']), telemetry)).toContain('engine');
  });

  it('drops a name the case does not carry rather than print evidence a model cannot verify', () => {
    expect(renderSeed(seed(['ghost']), telemetry)).toBe('');
    const mixed = renderSeed(seed(['ghost', 'payment']), telemetry);
    expect(mixed).toContain('payment');
    expect(mixed).not.toContain('ghost');
  });

  it('renumbers after a drop, so a gap cannot be read as a missing rank', () => {
    const text = renderSeed(seed(['ghost', 'payment', 'checkout']), telemetry);
    expect(text).toContain('1. payment');
    expect(text).toContain('2. checkout');
    expect(text).not.toContain('3.');
  });

  it('renders nothing for an empty order instead of an empty prior', () => {
    expect(renderSeed(seed([]), telemetry)).toBe('');
    expect(renderSeed(seed(['']), telemetry)).toBe('');
  });

  it('names a repeated service once, because a repeat would consume a rank the gate reads', () => {
    const text = renderSeed(seed(['payment', 'payment', 'checkout']), telemetry);
    expect(text).toContain('1. payment');
    expect(text).toContain('2. checkout');
    expect(text.match(/payment/g)).toHaveLength(1);
  });
});

describe('the seeded prompt', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed: QuerySeed = { source: 'engine', candidates: ['payment', 'checkout'] };

  it('carries the prior into the question, after the case size and before the transcript', () => {
    const prompt = buildUserPrompt(telemetry, [], undefined, seed);
    expect(prompt).toContain('carries 3 services');
    expect(prompt).toContain('1. payment');
    expect(prompt.indexOf('1. payment')).toBeGreaterThan(prompt.indexOf('carries 3 services'));
  });

  it('keeps the budget line and the prior together, so a seeded turn still knows its runway', () => {
    const prompt = buildUserPrompt(
      telemetry,
      [],
      { round: 1, maxRounds: 6, callsLeft: 10, forcing: false },
      seed,
    );
    expect(prompt).toContain('round 1 of 6');
    expect(prompt).toContain('1. payment');
  });

  it('says nothing about a prior when the arm is unseeded', () => {
    expect(buildUserPrompt(telemetry, [])).not.toContain('prior');
  });
});

describe('the seeded investigation', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed: QuerySeed = { source: 'engine', candidates: ['payment', 'checkout'] };
  const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, maxRounds: 3 };

  it('shows the prior on every turn, not only the first', async () => {
    const client = scriptedClient(['TOOL services', 'TOOL services', 'ANSWER payment']);
    await runQueryAgent(client, telemetry, budget, seed);
    expect(client.seen).toHaveLength(3);
    for (const prompt of client.seen) expect(prompt).toContain('1. payment');
  });

  it('answers inside the seeded order when the model takes the prior', async () => {
    const client = scriptedClient(['ANSWER checkout']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed);
    expect(outcome.answer).toBe('checkout');
    expect(outcome.stop).toBe('answered');
  });

  it('still refuses an answer the case does not carry, seeded or not', async () => {
    const client = scriptedClient(['ANSWER ghost', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed);
    expect(outcome.answer).toBe('payment');
    expect(outcome.answerRefused).toContain('ghost');
  });

  it('keeps the prior out of the transcript, which records what was ASKED and not what was shown', async () => {
    const seeded = await runQueryAgent(scriptedClient(['ANSWER payment']), telemetry, budget, seed);
    const free = await runQueryAgent(scriptedClient(['ANSWER payment']), telemetry, budget);
    expect(seeded.trace).toBe(free.trace);
  });
});

describe('surprise, the dispersion-normalised amplitude', () => {
  const series = (values: number[], start = INJECT - 4_000, step = 1_000): TelemetryMetric =>
    summariseSeries(
      'cpu',
      values.map((_, index) => start + index * step),
      values,
      INJECT,
    );

  it("measures the peak in units of the pre-window's own spread, not of its level", () => {
    // Pre-window 10, 10, 10, 10 → median 10, MAD 0, so the floor is 1 % of the level; the peak of 20 is 100
    // floors out, which is the reading a series that never moved deserves.
    const flat = series([10, 10, 10, 10, 20]);
    expect(flat.surprise).toBeGreaterThan(50);
    // The same doubling against a noisy pre-window is a much smaller surprise, and the ratio cannot say so.
    const noisy = series([4, 18, 6, 14, 20]);
    expect(noisy.surprise).toBeLessThan(flat.surprise!);
    expect(noisy.ratio).toBeCloseTo(20 / 10, 5);
  });

  it('is undefined when the pre-window is too short to estimate a spread', () => {
    const one = series([10, 20], INJECT - 1_000);
    expect(one.surprise).toBeUndefined();
  });

  it('is zero for a peak that never rose above the pre-window median', () => {
    const collapsing = series([20, 20, 20, 10, 5]);
    expect(collapsing.surprise).toBeLessThanOrEqual(0);
  });

  it('refuses a standardised reading when the pre-window is zero, rather than report 5e10 for a 0 to 50 step', () => {
    // The first version floored the spread at a thousandth of the level and let the level be zero, so this series
    // scored 5e10 and outranked every real rise in its case. It is not a surprise of 5e10; it is a different
    // observation -- silence, then noise -- and the ratio is the statistic that says so.
    expect(series([0, 0, 0, 0, 50]).surprise).toBeUndefined();
    expect(series([0, 0, 0, 0, 0]).surprise).toBeUndefined();
    // A zero MEDIAN inside a window that did move is the same case: no level, no standardised reading.
    expect(series([0, 0, 0, 4, 50]).surprise).toBeUndefined();
  });

  it('still standardises a flat window that has a level, because there the level is the reference', () => {
    const flat = series([10, 10, 10, 10, 10]);
    expect(flat.surprise).toBe(0);
  });
});

describe('the fleet read orders by surprise, not by ratio', () => {
  const twoServices = (): BenchmarkCase =>
    makeCase({
      metrics: new Map([
        // Doubles, but against a pre-window that swings by a factor of four: ordinary for this series.
        [
          'payment',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [
                INJECT - 4_000,
                INJECT - 3_000,
                INJECT - 2_000,
                INJECT - 1_000,
                INJECT + 1_000,
              ],
              values: Float64Array.from([4, 18, 6, 14, 20]),
            },
          ],
        ],
        // Barely moves, but it has never moved before: the one thing that changed.
        [
          'checkout',
          [
            {
              label: 'p99',
              unit: 'ms',
              timestamps: [
                INJECT - 4_000,
                INJECT - 3_000,
                INJECT - 2_000,
                INJECT - 1_000,
                INJECT + 1_000,
              ],
              values: Float64Array.from([100, 100, 100, 100, 106]),
            },
          ],
        ],
      ]),
    });

  it('puts the quiet series that moved first, although its ratio is smaller', () => {
    const telemetry = buildTelemetry(twoServices());
    const payment = telemetry.services.get('payment')!.metrics[0]!;
    const quiet = telemetry.services.get('checkout')!.metrics[0]!;
    expect(payment.ratio).toBeGreaterThan(quiet.ratio);
    const result = executeTool(telemetry, { kind: 'tool', tool: 'fleet', argument: '' });
    expect(result.text.indexOf('checkout')).toBeLessThan(result.text.indexOf('payment'));
  });

  it('still prints the ratio, so the model can see both readings and disagree with the order', () => {
    const result = executeTool(buildTelemetry(twoServices()), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.text).toContain('ratio=');
    expect(result.text).toContain('z=');
  });

  it('places a series with no estimable spread last rather than first', () => {
    const short = makeCase({
      metrics: new Map([
        [
          'payment',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [INJECT + 1_000],
              values: Float64Array.from([99]),
            },
          ],
        ],
        [
          'gateway',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [INJECT - 4_000, INJECT - 3_000, INJECT - 2_000, INJECT + 1_000],
              values: Float64Array.from([10, 10, 10, 12]),
            },
          ],
        ],
      ]),
    });
    const result = executeTool(buildTelemetry(short), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    });
    expect(result.text.indexOf('gateway')).toBeLessThan(result.text.indexOf('payment'));
  });
});

describe('bySurprise, the comparator that orders a list', () => {
  const metric = (over: Partial<TelemetryMetric>): TelemetryMetric => ({
    label: 'cpu',
    baseline: 1,
    peak: 2,
    delta: 1,
    ratio: 2,
    peakOffset: 0,
    ...over,
  });

  it('puts an estimable series before one whose spread cannot be estimated, whatever their ratios', () => {
    const known = metric({ surprise: -50, ratio: 1 });
    const unknown = metric({ surprise: undefined, ratio: 99 });
    expect(bySurprise(known, unknown)).toBeLessThan(0);
    expect(bySurprise(unknown, known)).toBeGreaterThan(0);
  });

  it('orders two estimable series by surprise, largest first', () => {
    expect(bySurprise(metric({ surprise: 3 }), metric({ surprise: 9 }))).toBeGreaterThan(0);
    expect(bySurprise(metric({ surprise: 9 }), metric({ surprise: 3 }))).toBeLessThan(0);
  });

  it('falls back to the ratio when neither series has an estimable spread', () => {
    expect(bySurprise(metric({ ratio: 1 }), metric({ ratio: 5 }))).toBeGreaterThan(0);
  });

  it('falls back to the label when the ratio ties too, so the text is a function of the data', () => {
    expect(bySurprise(metric({ label: 'cpu' }), metric({ label: 'rps' }))).toBeLessThan(0);
    expect(bySurprise(metric({ label: 'rps' }), metric({ label: 'cpu' }))).toBeGreaterThan(0);
  });

  it('returns zero for two series that are the same in every field it reads', () => {
    expect(bySurprise(metric({}), metric({}))).toBe(0);
  });

  it('ties on surprise and breaks the tie on the ratio', () => {
    expect(
      bySurprise(metric({ surprise: 4, ratio: 1 }), metric({ surprise: 4, ratio: 6 })),
    ).toBeGreaterThan(0);
  });
});

describe('the fleet read when nothing collapsed', () => {
  it('omits the falling section rather than print an empty one', () => {
    const rising = makeCase({
      metrics: new Map([
        [
          'payment',
          [
            {
              label: 'cpu',
              unit: 'percent',
              timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT - 1_000, INJECT + 1_000],
              values: Float64Array.from([5, 5, 5, 55]),
            },
          ],
        ],
      ]),
    });
    const text = executeTool(buildTelemetry(rising), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    }).text;
    expect(text).toContain('fleet:');
    expect(text).not.toContain('falling');
  });
});

describe('the fleet read with more than one collapse', () => {
  it('sorts them by the depth of the fall, deepest first', () => {
    const two = makeCase({
      metrics: new Map([
        [
          'payment',
          [
            {
              label: 'rps',
              unit: 'calls',
              timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT - 1_000, INJECT + 1_000],
              values: Float64Array.from([100, 100, 100, 80]),
            },
          ],
        ],
        [
          'checkout',
          [
            {
              label: 'rps',
              unit: 'calls',
              timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT - 1_000, INJECT + 1_000],
              values: Float64Array.from([100, 100, 100, 10]),
            },
          ],
        ],
      ]),
    });
    const text = executeTool(buildTelemetry(two), {
      kind: 'tool',
      tool: 'fleet',
      argument: '',
    }).text;
    const falling = text.slice(text.indexOf('falling:'));
    expect(falling.indexOf('checkout')).toBeLessThan(falling.indexOf('payment'));
  });
});

describe('the gate rule, as a predicate', () => {
  const context = (over: Partial<GateContext> = {}): GateContext => ({
    priorTop: 'payment',
    cited: new Set(['checkout']),
    onCone: false,
    ...over,
  });

  it('admits every override when no policy is asked for, because `none` is the control and not a lax gate', () => {
    expect(gateAdmits('none', 'checkout', context())).toBe(true);
    expect(gateAdmits('none', 'ghost', context({ priorTop: null }))).toBe(true);
  });

  it('admits an answer that IS the prior, because taking the prior is not an override', () => {
    expect(gateAdmits('cited', 'payment', context({ cited: new Set() }))).toBe(true);
    expect(gateAdmits('cone', 'payment', context({ onCone: false }))).toBe(true);
  });

  it('refuses an override the investigation never queried', () => {
    expect(gateAdmits('cited', 'checkout', context({ cited: new Set(['payment']) }))).toBe(false);
  });

  it('admits an override the investigation did query, which is the whole of the `cited` rule', () => {
    expect(gateAdmits('cited', 'checkout', context({ cited: new Set(['checkout']) }))).toBe(true);
  });

  it('refuses a CITED override that points at a caller when the direction is asked for', () => {
    expect(
      gateAdmits('cone', 'checkout', context({ cited: new Set(['checkout']), onCone: false })),
    ).toBe(false);
  });

  it('admits a cited override that sits on the prior callee-side cone', () => {
    expect(gateAdmits('cone', 'db', context({ cited: new Set(['db']), onCone: true }))).toBe(true);
  });

  it('has no prior to defend when the arm was not seeded, so it admits what it would otherwise refuse', () => {
    expect(gateAdmits('cited', 'checkout', context({ priorTop: null, cited: new Set() }))).toBe(
      true,
    );
    expect(gateAdmits('cone', 'checkout', context({ priorTop: null }))).toBe(true);
  });
});

describe('the callee-side cone', () => {
  const telemetry = buildTelemetry(makeCase());

  it('reaches a direct callee', () => {
    expect(onPriorCone(telemetry, 'payment', 'checkout')).toBe(true);
  });

  it('reaches a callee of a callee, because a root cause is not always one hop below', () => {
    expect(onPriorCone(telemetry, 'db', 'checkout')).toBe(true);
  });

  it('does not reach a caller, because the caller reporting errors is the victim', () => {
    expect(onPriorCone(telemetry, 'checkout', 'payment')).toBe(false);
  });

  it('is strict: the prior itself is not on its own cone', () => {
    expect(onPriorCone(telemetry, 'payment', 'payment')).toBe(false);
  });

  it('terminates on a cycle, because this case carries a self-call on payment', () => {
    expect(onPriorCone(telemetry, 'db', 'payment')).toBe(true);
  });

  it('refuses a name the case does not carry rather than answering about a service it never saw', () => {
    expect(onPriorCone(telemetry, 'ghost', 'payment')).toBe(false);
  });

  it('has no cone without a prior', () => {
    expect(onPriorCone(telemetry, 'db', null)).toBe(false);
  });

  it('revisits nothing on a diamond, which is the shape that makes a walk terminate', () => {
    // Two paths to one service is the ordinary case in a call graph, not an edge case: `a` calls `b` and `c`, both
    // call `d`, and `d` calls `e`. The answer has to be below the join for the revisit to happen at all — asking for
    // `d` returns on the first path — and without the visited set the second arrival at `d` is a second enqueue,
    // which on a real graph is a loop rather than a slow answer.
    const diamond = makeCase({
      callGraph: {
        systemLoad: 0,
        nodes: new Map(
          ['a', 'b', 'c', 'd', 'e'].map((id) => [
            id,
            { id, name: id, namespace: 'shop', labels: {} },
          ]),
        ),
        edges: [
          { from: 'a', to: 'b', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'a', to: 'c', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'b', to: 'd', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'c', to: 'd', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
          { from: 'd', to: 'e', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
        ],
      },
    });
    const graph = buildTelemetry(diamond);
    expect(onPriorCone(graph, 'e', 'a')).toBe(true);
    expect(onPriorCone(graph, 'a', 'd')).toBe(false);
  });
});

describe('the gate in the loop', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed: QuerySeed = { source: 'engine', candidates: ['payment', 'db', 'checkout'] };
  const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, maxRounds: 4 };

  it('refuses an override the model has not queried, and the refusal asks for the query', async () => {
    const client = scriptedClient(['ANSWER checkout']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'cited');
    expect(outcome.answer).toBe('payment');
    expect(outcome.answeredBy).toBe('prior');
    expect(outcome.gateRefusals).toBe(4);
    expect(outcome.exchanges[0]!.ok).toBe(false);
    expect(outcome.exchanges[0]!.result).toContain('TOOL metric');
  });

  it('admits the override once the service it names has been queried', async () => {
    const client = scriptedClient(['ANSWER checkout', 'TOOL metric checkout', 'ANSWER checkout']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'cited');
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('model');
    expect(outcome.gateRefusals).toBe(1);
    expect(outcome.investigated).toEqual(['checkout']);
  });

  it('keeps the model’s FIRST answer as the raw one, because that is what an ungated arm would have said', async () => {
    // The first answer is refused and the second is admitted, and the artifact must remember both: `rawAnswer` is
    // the ungated arm's answer and `answer` is the shipped one. Reporting only the second would make the control
    // unrecoverable from the artifact, which is what the three-policy table is re-scored from.
    const client = scriptedClient(['ANSWER checkout', 'TOOL metric db', 'ANSWER db']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'cited');
    expect(outcome.rawAnswer).toBe('checkout');
    expect(outcome.answer).toBe('db');
  });

  it('records each service once, however often it was queried', async () => {
    const client = scriptedClient([
      'TOOL metric checkout',
      'TOOL logs checkout',
      'TOOL fleet',
      'ANSWER payment',
    ]);
    const outcome = await runQueryAgent(
      client,
      telemetry,
      { ...DEFAULT_QUERY_BUDGET, maxRounds: 5 },
      seed,
      'cited',
    );
    expect(outcome.investigated).toEqual(['checkout']);
    expect(outcome.answer).toBe('payment');
  });

  it('does not count a REFUSED query as a record, because nothing was shown', async () => {
    const client = scriptedClient(['TOOL logs ghost', 'ANSWER checkout']);
    const outcome = await runQueryAgent(
      client,
      telemetry,
      { ...DEFAULT_QUERY_BUDGET, maxRounds: 3 },
      seed,
      'cited',
    );
    expect(outcome.investigated).toEqual([]);
    expect(outcome.answer).toBe('payment');
  });

  it('refuses a cited caller under the cone policy and admits the callee', async () => {
    const client = scriptedClient([
      'TOOL metric checkout',
      'ANSWER checkout',
      'TOOL metric db',
      'ANSWER db',
    ]);
    const outcome = await runQueryAgent(
      client,
      telemetry,
      { ...DEFAULT_QUERY_BUDGET, maxRounds: 4 },
      seed,
      'cone',
    );
    expect(outcome.answer).toBe('db');
    expect(outcome.gateRefusals).toBe(1);
    expect(outcome.exchanges[0]!.ok).toBe(true);
    expect(outcome.exchanges[1]!.ok).toBe(false);
    expect(outcome.exchanges[1]!.result).toContain('callee');
  });

  it('leaves the arm ungated when the policy is `none`, which is what makes it the control', async () => {
    const outcome = await runQueryAgent(
      scriptedClient(['ANSWER checkout']),
      telemetry,
      budget,
      seed,
      'none',
    );
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('model');
    expect(outcome.gateRefusals).toBe(0);
    expect(outcome.rawAnswer).toBe('checkout');
  });

  it('has nothing to gate when the arm was not seeded, and does not invent a prior to fall back to', async () => {
    const outcome = await runQueryAgent(
      scriptedClient(['ANSWER checkout']),
      telemetry,
      budget,
      null,
      'cone',
    );
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('model');
    expect(outcome.gateRefusals).toBe(0);
  });

  it('reports `answeredBy: null` when neither the model nor a prior could answer', async () => {
    const outcome = await runQueryAgent(
      scriptedClient(['TOOL services']),
      telemetry,
      { ...DEFAULT_QUERY_BUDGET, maxRounds: 2 },
      null,
      'cited',
    );
    expect(outcome.answer).toBeNull();
    expect(outcome.answeredBy).toBeNull();
    expect(outcome.rawAnswer).toBeNull();
  });
});

describe('the gate is stated in the prompt, not discovered by refusal', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed: QuerySeed = { source: 'engine', candidates: ['payment', 'checkout'] };

  it('names the rule, the prior’s first name, and the tool shape that satisfies it', () => {
    const text = buildUserPrompt(telemetry, [], undefined, seed, 'cited');
    expect(text).toMatch(/only if/i);
    expect(text).toContain('TOOL metric');
    expect(text).toContain('1. payment');
  });

  it('adds the direction test only under the cone policy', () => {
    expect(buildUserPrompt(telemetry, [], undefined, seed, 'cone')).toMatch(/callee side/i);
    expect(buildUserPrompt(telemetry, [], undefined, seed, 'cited')).not.toMatch(/callee side/i);
  });

  it('says nothing when the gate is off, because an ungated arm has no rule to read', () => {
    expect(buildUserPrompt(telemetry, [], undefined, seed, 'none')).not.toMatch(/only if/i);
    expect(buildUserPrompt(telemetry, [], undefined, seed)).not.toMatch(/only if/i);
  });

  it('says nothing when there is no prior to defend', () => {
    expect(buildUserPrompt(telemetry, [], undefined, null, 'cited')).not.toMatch(/only if/i);
  });

  it('carries no gate line when the prior is empty after the existence filter, because there is no name to defend', () => {
    const ghostSeed: QuerySeed = { source: 'engine', candidates: ['ghost'] };
    const text = buildUserPrompt(telemetry, [], undefined, ghostSeed, 'cited');
    expect(text).not.toMatch(/only if/i);
    expect(text).not.toContain('The engine order');
  });
});

describe('three policies priced from one artifact', () => {
  const row = (over: Partial<QueryArmRow>): QueryArmRow => ({
    datapack: 'case-1',
    faultType: 'cpu',
    truth: ['payment'],
    engineRank: 1,
    engineWinner: 'payment',
    answer: 'payment',
    correct: true,
    stop: 'answered',
    trace: '',
    seeded: true,
    rounds: 2,
    toolCalls: 1,
    promptTokens: 10,
    completionTokens: 5,
    rawAnswer: 'payment',
    answeredBy: 'model',
    calls: [],
    inCone: false,
    answerOnset: { firstError: null, fall: null },
    priorOnset: { firstError: null, fall: null },
    intoAnswer: null,
    intoPrior: null,
    gateRefusals: 0,
    ...over,
  });

  it('scores the control at the raw answer and a gated policy at the prior when it refuses', () => {
    // The model overrode a correct prior without asking anything about the service it named.
    const rows = [
      row({ rawAnswer: 'checkout', answer: 'checkout', correct: false, calls: [], inCone: false }),
    ];
    const readings = summariseGatePolicies(rows);
    const byPolicy = new Map(readings.map((reading) => [reading.policy, reading]));
    expect(byPolicy.get('none')!.correct).toBe(0);
    expect(byPolicy.get('none')!.breaks).toBe(1);
    expect(byPolicy.get('cited')!.correct).toBe(1);
    expect(byPolicy.get('cited')!.admitted).toBe(0);
    expect(byPolicy.get('cited')!.refused).toBe(1);
    expect(byPolicy.get('cited')!.retention).toBe(1);
  });

  it('counts an admitted repair against the engine and an admitted break against the prior', () => {
    const rows = [
      // A miss the model repaired after querying the service it named.
      row({
        datapack: 'a',
        engineRank: 4,
        engineWinner: 'checkout',
        truth: ['payment'],
        rawAnswer: 'payment',
        answer: 'payment',
        correct: true,
        calls: ['payment'],
        inCone: true,
      }),
      // A hit the model broke after querying the service it named.
      row({
        datapack: 'b',
        engineRank: 1,
        engineWinner: 'payment',
        truth: ['payment'],
        rawAnswer: 'db',
        answer: 'db',
        correct: false,
        calls: ['db'],
        inCone: false,
      }),
    ];
    const cited = summariseGatePolicies(rows).find((reading) => reading.policy === 'cited')!;
    expect(cited.admitted).toBe(2);
    expect(cited.repairs).toBe(1);
    expect(cited.breaks).toBe(1);
    expect(cited.precision).toBe(0.5);
    // The cone policy refuses the second one — a cited caller — so it keeps the prior's hit.
    const cone = summariseGatePolicies(rows).find((reading) => reading.policy === 'cone')!;
    expect(cone.admitted).toBe(1);
    expect(cone.repairs).toBe(1);
    expect(cone.breaks).toBe(0);
    expect(cone.precision).toBe(1);
    expect(cone.correct).toBe(2);
  });

  it('reports no precision rather than one when nothing was admitted', () => {
    const rows = [row({ rawAnswer: 'payment', answer: 'payment', correct: true })];
    for (const reading of summariseGatePolicies(rows)) {
      expect(reading.admitted).toBe(0);
      expect(reading.precision).toBeNull();
    }
  });

  it('leaves a case the arm could not measure out of every policy, exactly as the summary does', () => {
    const rows = [row({ stop: 'error', rawAnswer: null, answer: null, correct: false })];
    for (const reading of summariseGatePolicies(rows)) {
      expect(reading.correct).toBe(0);
      expect(reading.admitted).toBe(0);
      expect(reading.retention).toBeNull();
    }
  });

  it('agrees with the ONLINE run under the policy that was dispatched', async () => {
    // The shipped surface and the priced one must be the same surface: the counterfactual is a re-score of the
    // artifact, so a divergence between the two would mean the table in the document describes an arm nobody ran.
    const telemetry = buildTelemetry(makeCase());
    const seed: QuerySeed = { source: 'engine', candidates: ['payment', 'db', 'checkout'] };
    const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, maxRounds: 4 };
    const script = ['ANSWER db', 'TOOL metric db', 'ANSWER db'];
    const gated = await runQueryAgent(scriptedClient(script), telemetry, budget, seed, 'cone');
    const toRow = (outcome: typeof gated): QueryArmRow =>
      row({
        engineRank: 2,
        engineWinner: 'payment',
        truth: ['db'],
        rawAnswer: outcome.rawAnswer,
        answer: outcome.answer,
        correct: outcome.answer !== null && outcome.answer === 'db',
        calls: outcome.investigated,
        inCone: onPriorCone(telemetry, outcome.rawAnswer ?? '', 'payment'),
        answerOnset: { firstError: null, fall: null },
        priorOnset: { firstError: null, fall: null },
        intoAnswer: null,
        intoPrior: null,
        gateRefusals: outcome.gateRefusals,
      });
    const offline = summariseGatePolicies([toRow(gated)]).find(
      (reading) => reading.policy === 'cone',
    )!;
    expect(offline.correct).toBe(gated.answer === 'db' ? 1 : 0);
    expect(offline.admitted).toBe(1);
    expect(offline.repairs).toBe(1);
  });
});

describe('a case the model never answered, under each policy', () => {
  const unanswered = (over: Partial<QueryArmRow> = {}): QueryArmRow => ({
    datapack: 'u',
    faultType: 'cpu',
    truth: ['payment'],
    engineRank: 2,
    engineWinner: 'checkout',
    answer: null,
    correct: false,
    stop: 'rounds',
    trace: '',
    seeded: true,
    rounds: 6,
    toolCalls: 10,
    promptTokens: 10,
    completionTokens: 5,
    rawAnswer: null,
    answeredBy: null,
    calls: [],
    inCone: false,
    answerOnset: { firstError: null, fall: null },
    priorOnset: { firstError: null, fall: null },
    intoAnswer: null,
    intoPrior: null,
    gateRefusals: 0,
    ...over,
  });

  it('scores the control as a miss, because it has nothing to fall back to', () => {
    const none = summariseGatePolicies([unanswered()]).find(
      (reading) => reading.policy === 'none',
    )!;
    expect(none.correct).toBe(0);
    expect(none.admitted).toBe(0);
  });

  it('scores a gated policy at the prior, because that is what the runner would have answered', () => {
    const rows = [unanswered({ engineRank: 2, engineWinner: 'checkout', truth: ['checkout'] })];
    const cited = summariseGatePolicies(rows).find((reading) => reading.policy === 'cited')!;
    expect(cited.correct).toBe(1);
    expect(cited.repairs).toBe(1);
    expect(cited.admitted).toBe(0);
  });

  it('keeps a hit when the fallback lands on the engine’s own answer', () => {
    const rows = [unanswered({ engineRank: 1, engineWinner: 'payment' })];
    const cone = summariseGatePolicies(rows).find((reading) => reading.policy === 'cone')!;
    expect(cone.correct).toBe(1);
    expect(cone.retention).toBe(1);
  });

  it('scores a wrong answer that was never an override as neither a repair nor a break', () => {
    // The model answered the prior's own name and the prior was wrong: an admitted override neither way, so the
    // policy's precision must not be charged for it.
    const rows = [
      unanswered({
        rawAnswer: 'checkout',
        answer: 'checkout',
        engineWinner: 'checkout',
        engineRank: 2,
        truth: ['payment'],
      }),
    ];
    for (const reading of summariseGatePolicies(rows)) {
      expect(reading.admitted).toBe(0);
      expect(reading.breaks).toBe(0);
      expect(reading.repairs).toBe(0);
      expect(reading.precision).toBeNull();
    }
  });
});

describe('the two numbers a victim cannot manufacture', () => {
  const telemetry = buildTelemetry(makeCase());

  it('reads the earliest error line, which is the FATAL and not the later ERROR', () => {
    expect(onsetOf(telemetry, 'payment')).toEqual({ firstError: 1200, fall: null });
  });

  it('reads a collapse with no error line at all, because a victim can fall silent', () => {
    // checkout carries one ERROR at +1900 and an rps series that falls from 100 to 20: the shape this iteration
    // records precisely because it does NOT admit it — see the test below that refuses it.
    expect(onsetOf(telemetry, 'checkout')).toEqual({ firstError: 1900, fall: -80 });
  });

  it('reports a service with neither logs nor metrics as two nulls rather than as a healthy zero', () => {
    expect(onsetOf(telemetry, 'db')).toEqual({ firstError: null, fall: null });
  });

  it('has no reading for a name the case does not carry', () => {
    expect(onsetOf(telemetry, 'ghost')).toBeUndefined();
  });

  it('reads the net failures on an interface, in the direction asked for', () => {
    expect(netBetween(telemetry, 'checkout', 'payment')).toBe(38);
    expect(netBetween(telemetry, 'payment', 'checkout')).toBeNull();
    expect(netBetween(telemetry, 'payment', 'db')).toBe(0);
  });
});

describe('leads evidence, the predicate `contrast` is built on', () => {
  const telemetry = buildTelemetry(makeCase());
  const payment = onsetOf(telemetry, 'payment')!;
  const checkout = onsetOf(telemetry, 'checkout')!;

  it('admits the callee the prior called and the interface says failed', () => {
    expect(
      leadsEvidence(payment, checkout, netBetween(telemetry, 'checkout', 'payment'), null),
    ).toBe(true);
  });

  it('admits the side that logged its first error earlier, which a caller cannot do for its callee', () => {
    // No failing interface in the case at all: the lag alone has to decide, and the earlier onset is the caller's
    // own admission that the callee failed first.
    expect(leadsEvidence(payment, checkout, null, null)).toBe(true);
  });

  it('admits a silent prior, because a prior that logged nothing is not counter-evidence', () => {
    expect(leadsEvidence(payment, { firstError: null, fall: null }, null, null)).toBe(true);
  });

  it('refuses a candidate that logged later, which is what a victim of its own callee looks like', () => {
    expect(leadsEvidence(checkout, payment, null, null)).toBe(false);
  });

  it('refuses a candidate whose interface failure points back UP at the prior and that logged later', () => {
    // The only failing interface runs from the candidate into the prior, and the candidate logged AFTER it: that is
    // a caller reporting its own callee's failure, which is a victim and not a source.
    expect(leadsEvidence(checkout, payment, -5, 40)).toBe(false);
  });

  it('refuses a candidate with no evidence on either axis', () => {
    const silent = { firstError: null, fall: null };
    expect(leadsEvidence(silent, silent, null, null)).toBe(false);
  });

  it('does NOT admit on a collapse alone, because this case is the counter-example that rejects it', () => {
    // checkout's traffic fell by 80 while payment rose. A deeper collapse is exactly what a victim of a stopped
    // callee looks like, so the E3 axis registered in the pre-registration was dropped rather than shipped: it
    // would have admitted this. Recorded here so the negative result cannot be re-invented later.
    expect(leadsEvidence(checkout, payment, null, null)).toBe(false);
    expect(checkout.fall).toBeLessThan(payment.fall ?? 0);
  });
});

describe('the contrast policy, as a predicate', () => {
  const telemetry = buildTelemetry(makeCase());
  const evidence = (over: Partial<ContrastEvidence> = {}): ContrastEvidence => ({
    answer: onsetOf(telemetry, 'payment')!,
    prior: onsetOf(telemetry, 'checkout')!,
    intoAnswer: 38,
    intoPrior: null,
    ...over,
  });
  const context = (over: Partial<GateContext> = {}): GateContext => ({
    priorTop: 'checkout',
    cited: new Set(['payment']),
    onCone: true,
    evidence: evidence(),
    ...over,
  });

  it('admits an override that is cited, in cone, and leads on evidence', () => {
    expect(gateAdmits('contrast', 'payment', context())).toBe(true);
  });

  it('refuses a cited, in-cone override whose evidence does not lead', () => {
    const contradicted = evidence({
      answer: onsetOf(telemetry, 'checkout')!,
      prior: onsetOf(telemetry, 'payment')!,
      intoAnswer: null,
      intoPrior: 38,
    });
    expect(gateAdmits('contrast', 'payment', context({ evidence: contradicted }))).toBe(false);
  });

  it('refuses when the harness cannot compute the evidence, rather than admitting on absence', () => {
    // Fail-closed: a policy that admitted when its own input was missing would be a wider `cone` under a
    // narrower name, and the pre-registration priced `contrast` as strictly narrower.
    expect(gateAdmits('contrast', 'payment', context({ evidence: undefined }))).toBe(false);
  });

  it('still requires the cone, so contrast can never admit what cone refuses', () => {
    expect(gateAdmits('contrast', 'payment', context({ onCone: false }))).toBe(false);
  });

  it('still requires the record, so contrast can never admit what cited refuses', () => {
    expect(gateAdmits('contrast', 'payment', context({ cited: new Set() }))).toBe(false);
  });

  it('is strictly narrower than cone on the same context', () => {
    const contradicted = evidence({
      answer: onsetOf(telemetry, 'checkout')!,
      prior: onsetOf(telemetry, 'payment')!,
      intoAnswer: null,
      intoPrior: 38,
    });
    const narrower = context({ evidence: contradicted });
    expect(gateAdmits('cone', 'payment', narrower)).toBe(true);
    expect(gateAdmits('contrast', 'payment', narrower)).toBe(false);
  });
});

describe('the contrast rule, as the model reads it', () => {
  it('names both axes and the tool shapes that carry them', () => {
    const text = renderGate('contrast', 'payment');
    expect(text).toContain('TOOL failed');
    expect(text).toContain('TOOL logs');
    expect(text).toContain('net=');
    expect(text).toMatch(/earlier/i);
  });

  it('says nothing without a prior, exactly as the other policies do', () => {
    expect(renderGate('contrast', null)).toBe('');
  });
});

describe('four policies priced from one artifact', () => {
  const row = (over: Partial<QueryArmRow> = {}): QueryArmRow => ({
    datapack: 'case-1',
    faultType: 'cpu',
    truth: ['payment'],
    engineRank: 1,
    engineWinner: 'payment',
    answer: 'payment',
    correct: true,
    stop: 'answered',
    trace: '',
    seeded: true,
    rounds: 2,
    toolCalls: 1,
    promptTokens: 10,
    completionTokens: 5,
    rawAnswer: 'payment',
    answeredBy: 'model',
    calls: [],
    inCone: false,
    answerOnset: { firstError: null, fall: null },
    priorOnset: { firstError: null, fall: null },
    intoAnswer: null,
    intoPrior: null,
    gateRefusals: 0,
    ...over,
  });

  it('prices a break cone admits and contrast refuses, which is the whole point', () => {
    // The model descended from a correct prior into a callee, queried it, and the callee logged later: cone
    // admits (position) and contrast refuses (evidence).
    const rows = [
      row({
        rawAnswer: 'checkout',
        answer: 'checkout',
        correct: false,
        calls: ['checkout'],
        inCone: true,
        answerOnset: { firstError: 900, fall: null },
        priorOnset: { firstError: 400, fall: null },
        intoAnswer: null,
        intoPrior: 30,
      }),
    ];
    const byPolicy = new Map(
      summariseGatePolicies(rows).map((reading) => [reading.policy, reading]),
    );
    expect(byPolicy.get('cone')!.admitted).toBe(1);
    expect(byPolicy.get('cone')!.breaks).toBe(1);
    expect(byPolicy.get('cone')!.correct).toBe(0);
    expect(byPolicy.get('contrast')!.admitted).toBe(0);
    expect(byPolicy.get('contrast')!.refused).toBe(1);
    expect(byPolicy.get('contrast')!.correct).toBe(1);
    expect(byPolicy.get('contrast')!.retention).toBe(1);
  });

  it('keeps a repair that leads, so narrowing costs nothing that pays', () => {
    const rows = [
      row({
        engineRank: 3,
        engineWinner: 'checkout',
        truth: ['payment'],
        rawAnswer: 'payment',
        answer: 'payment',
        correct: true,
        calls: ['payment'],
        inCone: true,
        answerOnset: { firstError: 300, fall: null },
        priorOnset: { firstError: 800, fall: null },
        intoAnswer: 12,
        intoPrior: null,
      }),
    ];
    const contrast = summariseGatePolicies(rows).find((reading) => reading.policy === 'contrast')!;
    expect(contrast.admitted).toBe(1);
    expect(contrast.repairs).toBe(1);
    expect(contrast.precision).toBe(1);
  });

  it('reports every policy in a stable order, so a table over the result reads as a ladder', () => {
    const policies = summariseGatePolicies([row({})]).map((reading) => reading.policy);
    expect(policies).toEqual(['none', 'cited', 'cone', 'contrast', 'lag']);
  });
});

describe('the contrast gate in the loop', () => {
  const telemetry = buildTelemetry(makeCase());
  // `checkout` is the prior, so `payment` is one hop down its cone and `db` is two.
  const seed: QuerySeed = { source: 'engine', candidates: ['checkout'] };
  const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, maxRounds: 4 };

  it('refuses an override the case’s own evidence says nothing about', async () => {
    // `db` carries no metrics and logs nothing: cited, in cone, and still no evidence that it leads.
    const client = scriptedClient(['TOOL metric db', 'ANSWER db']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'contrast');
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('prior');
    expect(outcome.gateRefusals).toBe(3);
    expect(outcome.exchanges[1]!.ok).toBe(false);
    expect(outcome.exchanges[1]!.result).toMatch(/earlier|interface|LEAD/i);
  });

  it('admits an override that logged first AND whose interface into it is the one that failed', async () => {
    // payment logged at +1200 against checkout's +1900, and checkout->payment carries net +38 failures.
    const client = scriptedClient(['TOOL metric payment', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'contrast');
    expect(outcome.answer).toBe('payment');
    expect(outcome.answeredBy).toBe('model');
    expect(outcome.gateRefusals).toBe(0);
  });
});

describe('the two ways the evidence can be absent', () => {
  const telemetry = buildTelemetry(makeCase());
  const payment = onsetOf(telemetry, 'payment')!;

  it('refuses when the candidate itself has no reading, because absence is not a lead', () => {
    expect(leadsEvidence(undefined, payment, null, null)).toBe(false);
  });

  it('prices a row whose answer names a service the case does not carry as fail-closed', () => {
    const row: QueryArmRow = {
      datapack: 'x',
      faultType: 'cpu',
      truth: ['payment'],
      engineRank: 1,
      engineWinner: 'payment',
      answer: 'ghost',
      correct: false,
      stop: 'answered',
      trace: '',
      seeded: true,
      rounds: 3,
      toolCalls: 2,
      promptTokens: 10,
      completionTokens: 5,
      rawAnswer: 'ghost',
      answeredBy: 'model',
      calls: ['ghost'],
      inCone: true,
      answerOnset: null,
      priorOnset: null,
      intoAnswer: null,
      intoPrior: null,
      gateRefusals: 0,
    };
    const contrast = summariseGatePolicies([row]).find((reading) => reading.policy === 'contrast')!;
    // `cone` admits it on position alone; `contrast` cannot read the evidence and so refuses, falling back.
    const cone = summariseGatePolicies([row]).find((reading) => reading.policy === 'cone')!;
    expect(cone.admitted).toBe(1);
    expect(contrast.admitted).toBe(0);
    expect(contrast.refused).toBe(1);
    expect(contrast.retention).toBe(1);
  });
});

describe('the lag policy, as a predicate', () => {
  const telemetry = buildTelemetry(makeCase());
  const evidence = (over: Partial<ContrastEvidence> = {}): ContrastEvidence => ({
    answer: onsetOf(telemetry, 'payment')!,
    prior: onsetOf(telemetry, 'checkout')!,
    intoAnswer: 38,
    intoPrior: null,
    ...over,
  });
  const context = (over: Partial<GateContext> = {}): GateContext => ({
    priorTop: 'checkout',
    cited: new Set(['payment']),
    onCone: true,
    evidence: evidence(),
    ...over,
  });

  it('admits an override whose first error precedes the prior’s, which no caller can forge', () => {
    // payment logged at +1200 and checkout at +1900: the callee produced the failure, then the caller reported it.
    expect(gateAdmits('lag', 'payment', context())).toBe(true);
  });

  it('refuses an override the interface alone would admit, and that is the whole difference from contrast', () => {
    // checkout -> payment carries net +38 failures, so a failing interface points INTO the answer. It points into
    // every callee of a caller that has failed, which is why it cannot separate a source from a victim: the answer
    // here logged at +2500, long after the prior's +1000.
    const interfaceOnly = evidence({
      answer: { firstError: 2_500, fall: null },
      prior: { firstError: 1_000, fall: null },
      intoAnswer: 38,
      intoPrior: null,
    });
    expect(gateAdmits('contrast', 'payment', context({ evidence: interfaceOnly }))).toBe(true);
    expect(gateAdmits('lag', 'payment', context({ evidence: interfaceOnly }))).toBe(false);
  });

  it('refuses a candidate that logged nothing at all, however its interface behaved', () => {
    const silent = evidence({ answer: { firstError: null, fall: null }, intoAnswer: 38 });
    expect(gateAdmits('lag', 'payment', context({ evidence: silent }))).toBe(false);
  });

  it('admits when the PRIOR logged nothing, because a silent prior is not counter-evidence', () => {
    const quietPrior = evidence({ prior: { firstError: null, fall: null } });
    expect(gateAdmits('lag', 'payment', context({ evidence: quietPrior }))).toBe(true);
  });

  it('still requires the cone, so lag can never admit what cone refuses', () => {
    expect(gateAdmits('lag', 'payment', context({ onCone: false }))).toBe(false);
  });

  it('still requires the record, so lag can never admit what cited refuses', () => {
    expect(gateAdmits('lag', 'payment', context({ cited: new Set() }))).toBe(false);
  });

  it('fails closed on a missing evidence block, exactly as contrast does', () => {
    expect(gateAdmits('lag', 'payment', context({ evidence: undefined }))).toBe(false);
  });
});

describe('the lag rule, as the model reads it', () => {
  it('names the order axis and the tool that carries it, and not the interface axis it dropped', () => {
    const text = renderGate('lag', 'payment');
    expect(text).toContain('TOOL logs');
    expect(text).toMatch(/earlier/i);
    expect(text).not.toContain('TOOL failed');
  });

  it('says nothing without a prior, exactly as the other policies do', () => {
    expect(renderGate('lag', null)).toBe('');
  });
});

describe('five policies priced from one artifact', () => {
  const row = (over: Partial<QueryArmRow> = {}): QueryArmRow => ({
    datapack: 'case-1',
    faultType: 'cpu',
    truth: ['payment'],
    engineRank: 1,
    engineWinner: 'payment',
    answer: 'payment',
    correct: true,
    stop: 'answered',
    trace: '',
    seeded: true,
    rounds: 2,
    toolCalls: 1,
    promptTokens: 10,
    completionTokens: 5,
    rawAnswer: 'payment',
    answeredBy: 'model',
    calls: [],
    inCone: false,
    answerOnset: { firstError: null, fall: null },
    priorOnset: { firstError: null, fall: null },
    intoAnswer: null,
    intoPrior: null,
    gateRefusals: 0,
    ...over,
  });

  it('prices a break contrast admits and lag refuses — the case that made E1 an admission axis no more', () => {
    // A correct prior, an override one hop down, queried, the interface into it failing, and the answer logging
    // LATE. On this repository's own 160 cases that shape accounted for four of the four breaks `contrast`
    // admitted and one of its eleven repairs.
    const rows = [
      row({
        rawAnswer: 'checkout',
        answer: 'checkout',
        correct: false,
        calls: ['checkout'],
        inCone: true,
        answerOnset: { firstError: 2_500, fall: null },
        priorOnset: { firstError: 1_000, fall: null },
        intoAnswer: 30,
        intoPrior: null,
      }),
    ];
    const byPolicy = new Map(
      summariseGatePolicies(rows).map((reading) => [reading.policy, reading]),
    );
    expect(byPolicy.get('contrast')!.admitted).toBe(1);
    expect(byPolicy.get('contrast')!.breaks).toBe(1);
    expect(byPolicy.get('lag')!.admitted).toBe(0);
    expect(byPolicy.get('lag')!.refused).toBe(1);
    expect(byPolicy.get('lag')!.correct).toBe(1);
    expect(byPolicy.get('lag')!.retention).toBe(1);
  });

  it('keeps a repair whose first error precedes the prior’s, so the narrowing costs nothing that pays', () => {
    const rows = [
      row({
        engineRank: 3,
        engineWinner: 'checkout',
        truth: ['payment'],
        rawAnswer: 'payment',
        answer: 'payment',
        correct: true,
        calls: ['payment'],
        inCone: true,
        answerOnset: { firstError: 300, fall: null },
        priorOnset: { firstError: 800, fall: null },
        intoAnswer: null,
        intoPrior: null,
      }),
    ];
    const lag = summariseGatePolicies(rows).find((reading) => reading.policy === 'lag')!;
    expect(lag.admitted).toBe(1);
    expect(lag.repairs).toBe(1);
    expect(lag.precision).toBe(1);
    // The row's engine rank is 3, so this sample carries no engine hit and retention is undefined rather than 1:
    // a retention over no hits would be a division the case cannot supply.
    expect(lag.retention).toBeNull();
  });

  it('orders the policies by strictness, so a table over the result reads as a ladder', () => {
    const policies = summariseGatePolicies([row({})]).map((reading) => reading.policy);
    expect(policies).toEqual(['none', 'cited', 'cone', 'contrast', 'lag']);
  });
});

describe('the lag gate in the loop', () => {
  const telemetry = buildTelemetry(makeCase());
  const seed: QuerySeed = { source: 'engine', candidates: ['checkout'] };
  const budget: QueryBudget = { ...DEFAULT_QUERY_BUDGET, maxRounds: 4 };

  it('refuses an override that logged after the prior and falls back to it', async () => {
    const client = scriptedClient(['TOOL metric db', 'TOOL logs db', 'ANSWER db']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'lag');
    expect(outcome.answer).toBe('checkout');
    expect(outcome.answeredBy).toBe('prior');
    expect(outcome.gateRefusals).toBeGreaterThan(0);
  });

  it('admits an override that logged first', async () => {
    const client = scriptedClient(['TOOL metric payment', 'ANSWER payment']);
    const outcome = await runQueryAgent(client, telemetry, budget, seed, 'lag');
    expect(outcome.answer).toBe('payment');
    expect(outcome.answeredBy).toBe('model');
    expect(outcome.gateRefusals).toBe(0);
  });
});

describe('a balanced sample projected onto the corpus it ships in', () => {
  const reading = (over: Partial<GateReading> = {}): GateReading => ({
    policy: 'contrast',
    admitted: 19,
    refused: 22,
    repairs: 11,
    breaks: 4,
    precision: 11 / 15,
    correct: 87,
    retention: 0.95,
    ...over,
  });
  const corpus = { misses: 266, hits: 1_156 };

  it('turns a +7 sample gain into the loss it is at corpus base rate', () => {
    // The 320 artifact, projected: 11 repairs over 80 sampled misses and 4 breaks over 80 sampled hits. On a corpus
    // that is 81.3 % hits the same rates read −21 cases, which is why the balanced sample's +7 was reported as a
    // diagnostic and not as a shipping gain.
    const projection = projectOntoCorpus(reading(), 80, 80, corpus);
    expect(projection.repairs).toBeCloseTo(36.575, 3);
    expect(projection.breaks).toBeCloseTo(57.8, 3);
    expect(projection.net).toBeCloseTo(-21.225, 3);
    expect(projection.top1).toBeCloseTo(79.8, 2);
  });

  it('keeps a reading with no breaks positive, and says by how much', () => {
    const projection = projectOntoCorpus(reading({ repairs: 10, breaks: 0 }), 80, 80, corpus);
    expect(projection.breaks).toBe(0);
    expect(projection.net).toBeCloseTo((10 / 80) * 266, 6);
    expect(projection.top1).toBeCloseTo(((1_156 + (10 / 80) * 266) / 1_422) * 100, 6);
  });

  it('refuses to divide by a stratum the sample did not carry', () => {
    // A sample with no misses has no repair rate, and a projection that invented 0 there would report "the arm
    // repairs nothing" as a property of the gate rather than of the sample.
    const projection = projectOntoCorpus(reading(), 0, 80, corpus);
    expect(projection.repairs).toBeNull();
    expect(projection.net).toBeNull();
    expect(projection.top1).toBeNull();
  });
});
