/**
 * The pipeline's shortlist inside `TOOL fleet`, and the census that makes the arm readable.
 *
 * Two properties are asserted here and both exist because of a measurement that went wrong.
 *
 * The first is that the shortlist is EVIDENCE and not instruction: it rides in a tool result, the system prompt stays
 * byte-identical to the published one, and an arm that carries no shortlist renders exactly the text every earlier arm
 * printed. Iteration 342b measured a paragraph appended to the prompt costing −43 pp while the tool it advertised was
 * never called, so the next intervention has to change what an investigation can SEE without changing what it is TOLD.
 *
 * The second is that the artifact must not have to be read through a truncated transcript. The recorded `trace` keeps
 * its last 2 000 characters, so a per-tool presence table computed from it measures the TAIL of an investigation — the
 * first call is elided whenever the rest of the transcript is longer, which is exactly what happened when `TOOL fleet`
 * was reported at 0.5 %. The census counts directives as they execute, so elision cannot reach it.
 *
 * The model is a fake at the port, never a network call: what is under test is the harness, not an endpoint's mood.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTelemetry,
  DEFAULT_QUERY_BUDGET,
  executeTool,
  PIPELINE_LINES,
  QUERY_SYSTEM_PROMPT,
  runQueryAgent,
  TRACE_CHARS,
  type QueryAgentClient,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const INJECT = 1_700_000_000_000;

/** A case with three services whose strongest rises rank `checkout`, `payment`, `db`. */
function makeCase(): BenchmarkCase {
  const series = (base: number, peak: number) => ({
    label: 'cpu',
    unit: 'percent',
    timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
    values: Float64Array.from([base, base, peak, peak]),
  });
  return {
    id: 'case-shortlist',
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

/** A case wide enough that five `fleet` reads overflow the recorded trace's 2 000 characters. */
function makeWideCase(): BenchmarkCase {
  const base = makeCase();
  const metrics = new Map(base.metrics);
  const nodes = new Map(base.callGraph.nodes);
  for (let index = 0; index < 10; index += 1) {
    const id = `wide-${String(index)}`;
    metrics.set(id, [
      {
        label: 'cpu',
        unit: 'percent',
        timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
        values: Float64Array.from([10, 10, 11 + index, 11 + index]),
      },
    ]);
    nodes.set(id, { id, name: id, namespace: 'shop', labels: {} });
  }
  return { ...base, id: 'case-wide', metrics, callGraph: { ...base.callGraph, nodes } };
}

/** A model that says what it is told, and remembers the system prompt it was given. */
function scripted(replies: readonly string[]): {
  client: QueryAgentClient;
  systems: string[];
} {
  const systems: string[] = [];
  let index = 0;
  const client: QueryAgentClient = {
    model: 'fake',
    complete: async (turn) => {
      systems.push(turn.system);
      const text = replies[Math.min(index, replies.length - 1)]!;
      index += 1;
      return { text, promptTokens: 1, completionTokens: 1 };
    },
  };
  return { client, systems };
}

const FLEET = { kind: 'tool', tool: 'fleet', argument: '' } as const;

describe('the pipeline shortlist inside a fleet read', () => {
  it('renders nothing at all when the arm carries no shortlist', () => {
    const telemetry = buildTelemetry(makeCase());
    // The published rendering is the two-argument call; an arm that asks for no shortlist must produce that text
    // byte for byte, or every earlier reading is taken under a prompt nobody can reproduce.
    expect(executeTool(telemetry, FLEET).text).toBe(
      executeTool(telemetry, FLEET, undefined, null).text,
    );
    expect(executeTool(telemetry, FLEET).text).not.toContain('pipeline order');
  });

  it('prints the pipeline’s own ranking, in the order it was given', () => {
    const result = executeTool(buildTelemetry(makeCase()), FLEET, undefined, ['db', 'checkout']);
    const lines = result.text.split('\n');
    const start = lines.findIndex((line) => line.startsWith('pipeline order'));
    expect(start).toBeGreaterThan(0);
    expect(lines.slice(start)).toEqual([
      'pipeline order: the first 2 of 2 ranked services this case carries',
      '  db',
      '  checkout',
    ]);
  });

  it('skips a name the case does not carry, and counts what it printed rather than what it was handed', () => {
    const result = executeTool(buildTelemetry(makeCase()), FLEET, undefined, [
      'ghost',
      'payment',
      'ghost-2',
      'db',
    ]);
    expect(result.text).toContain('the first 2 of 2 ranked services');
    expect(result.text).not.toContain('ghost');
  });

  it('truncates a wide order to the width the fleet read prints, and says what it left out', () => {
    const order = [
      'checkout',
      'payment',
      'db',
      'wide-0',
      'wide-1',
      'wide-2',
      'wide-3',
      'wide-4',
      'wide-5',
    ];
    const lines = executeTool(buildTelemetry(makeWideCase()), FLEET, undefined, order).text.split(
      '\n',
    );
    const start = lines.findIndex((line) => line.startsWith('pipeline order'));
    expect(lines[start]).toBe(
      `pipeline order: the first ${String(PIPELINE_LINES)} of 9 ranked services this case carries`,
    );
    const section: string[] = [];
    for (
      let index = start + 1;
      index < lines.length && lines[index]!.startsWith('  ');
      index += 1
    ) {
      section.push(lines[index]!.trim());
    }
    // The section is exactly the width, in the pipeline's order: a shortlist that printed nine names would be the
    // fleet read the arm already has, with an opinion attached.
    expect(section).toEqual(order.slice(0, PIPELINE_LINES));
  });

  it('prints no section when the order names nothing the case carries', () => {
    const result = executeTool(buildTelemetry(makeCase()), FLEET, undefined, ['ghost', 'ghost-2']);
    expect(result.text).not.toContain('pipeline order');
    expect(result.ok).toBe(true);
  });

  it('reaches the model inside the tool result while the instruction stays the published one', async () => {
    const { client, systems } = scripted(['TOOL fleet', 'ANSWER db']);
    const outcome = await runQueryAgent(
      client,
      buildTelemetry(makeCase()),
      DEFAULT_QUERY_BUDGET,
      null,
      'none',
      'none',
      null,
      null,
      null,
      ['db', 'checkout'],
    );
    // The intervention is a change of EVIDENCE: the prompt is the free arm's, so a difference between the two arms
    // cannot be a difference in what the model was told.
    expect(systems).toEqual([QUERY_SYSTEM_PROMPT, QUERY_SYSTEM_PROMPT]);
    expect(outcome.exchanges[0]!.result).toContain('pipeline order');
    expect(outcome.exchanges[0]!.result).toContain('  db');
  });
});

describe('the census an artifact carries instead of a truncated trace', () => {
  it('counts a directive the recorded trace has already elided', async () => {
    const replies = [
      'TOOL fleet',
      'TOOL fleet',
      'TOOL fleet',
      'TOOL fleet',
      'TOOL fleet',
      'ANSWER db',
    ];
    const { client } = scripted(replies);
    const outcome = await runQueryAgent(client, buildTelemetry(makeWideCase()));
    // The trace is the last 2 000 characters, so the FIRST fleet read is gone from it by construction.
    expect(outcome.trace.length).toBeLessThanOrEqual(TRACE_CHARS + 64);
    expect(outcome.trace.split('TOOL fleet').length - 1).toBeLessThan(5);
    expect(outcome.tools.fleet).toBe(5);
  });

  it('counts what the arm reached for even when the call was refused', async () => {
    // No schedule, so `next` is refused every time it is asked for — and it is still a tool the arm chose.
    const { client } = scripted(['TOOL next', 'TOOL next', 'ANSWER db']);
    const outcome = await runQueryAgent(client, buildTelemetry(makeCase()));
    expect(outcome.tools.next).toBe(2);
    expect(outcome.nextServed).toBe(0);
  });

  it('separates a served slot from a refused one on the arm that carries a schedule', async () => {
    const { client } = scripted(['TOOL next', 'TOOL next', 'TOOL next', 'ANSWER db']);
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
    // One slot existed, three were asked for: the count of served slots is the harness's, not the model's.
    expect(outcome.tools.next).toBe(3);
    expect(outcome.nextServed).toBe(1);
  });

  it('counts the terminal act, so a case that answered is distinguishable from one that never did', async () => {
    const { client } = scripted(['ANSWER db']);
    const outcome = await runQueryAgent(client, buildTelemetry(makeCase()));
    expect(outcome.tools.answer).toBe(1);
    expect(outcome.tools.fleet).toBeUndefined();
  });
});
