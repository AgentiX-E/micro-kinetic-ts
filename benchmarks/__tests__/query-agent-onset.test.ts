/**
 * The onset channel inside `TOOL metric`, and the reason it is not a second shortlist.
 *
 * Iteration 344 measured where the shortlist arm's 205-case loss lives and found the largest block (49 %) on the
 * engine's misses, where **neither** arm queried the culprit and the free arm still answered 52.8 % of them while the
 * shortlist arm answered 6.3 %. That is a path from the fleet's global evidence to an answer which never passes through
 * a per-service query — and the census says the channel it would have to read first, `TOOL logs`, is opened in 0.44 of
 * the five calls per case.
 *
 * This arm changes **what one existing call returns**, not which calls exist and not what the instruction says: each
 * `TOOL metric <service>` line gains `err=<offset>s/<count>`, the service's first `ERROR`/`FATAL` relative to the
 * injection and how many there were. It spends no call, adds no round, and carries **no ranking** — a timestamp is
 * evidence a model can weigh against its own surprise order, while a list of names is an authority that replaces it.
 * That distinction is the whole pre-registration in `docs/onset-channel-345.md`: if this arm also loses, the finding is
 * that the model does not want more evidence but a decision, and the axis closes with the mechanism named.
 *
 * The fake client is at the port and never a network call: what is under test is the rendering and the default arm's
 * byte-identity, not an endpoint.
 */

import { describe, expect, it } from 'vitest';

import {
  buildTelemetry,
  executeTool,
  type ParsedCall,
  type Telemetry,
} from '../src/query-agent.js';

import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

const INJECT = 1_700_000_000_000;

/** A case whose `checkout` service logs three errors at +2 s and 7 in total; `db` logs none. */
function makeCase(): BenchmarkCase {
  const series = (base: number, peak: number) => ({
    label: 'cpu',
    unit: 'percent',
    timestamps: [INJECT - 3_000, INJECT - 2_000, INJECT + 1_000, INJECT + 2_000],
    values: Float64Array.from([base, base, peak, peak]),
  });
  return {
    id: 'case-onset',
    datasetName: 'fse26',
    injectTime: INJECT,
    metrics: new Map([
      ['checkout', [series(10, 90)]],
      ['db', [series(10, 20)]],
    ]),
    callGraph: {
      systemLoad: 0,
      nodes: new Map([
        ['checkout', { id: 'checkout', name: 'checkout', namespace: 'shop', labels: {} }],
        ['db', { id: 'db', name: 'db', namespace: 'shop', labels: {} }],
      ]),
      edges: [],
    },
    logs: Array.from({ length: 7 }, (_, index) => ({
      // Seven lines at +2 s: the offset is the FIRST one and the count is all of them, which is the pair the channel
      // prints. `db` contributes nothing, so its read must say so rather than stay silent.
      timestamp: INJECT + 2_000 + index,
      service: 'checkout',
      message: index === 0 ? 'pool exhausted' : `retry ${String(index)} failed`,
      level: index === 0 ? ('ERROR' as const) : ('FATAL' as const),
    })),
    traces: [],
    truth: [],
  } as unknown as BenchmarkCase;
}

const metricOf = (name: string): ParsedCall => ({ kind: 'tool', tool: 'metric', argument: name });
const fleet: ParsedCall = { kind: 'tool', tool: 'fleet', argument: '' };
const logsOf = (name: string): ParsedCall => ({ kind: 'tool', tool: 'logs', argument: name });

function telemetry(): Telemetry {
  return buildTelemetry(makeCase());
}

describe('the onset channel', () => {
  it('leaves the metric line byte-identical when the arm carries no onset channel', () => {
    const text = executeTool(telemetry(), metricOf('checkout')).text;
    // The exact line every arm before this one printed (z is n/a: a two-sample pre-window has no spread). A guard rather than a shape: an arm added later must not be
    // able to change the free arm's text by accident, or its 414 becomes unreadable against every published number.
    expect(text).toBe('checkout cpu: base=10.00 peak=90.00 delta=80.00 ratio=9.00 z=n/a at=1s');
    expect(text).not.toContain('err=');
  });

  it('prints the first error offset and the count when the channel is on', () => {
    const text = executeTool(telemetry(), metricOf('checkout'), undefined, null, true).text;
    expect(text).toContain('err=+2s/7');
  });

  it('says `err=-` for a service that logged nothing, rather than staying silent', () => {
    // Silence is ambiguous: a model cannot tell "no errors" from "this arm does not report errors", and the second
    // reading would make it discount the whole line.
    const text = executeTool(telemetry(), metricOf('db'), undefined, null, true).text;
    expect(text).toContain('err=-');
  });

  it('does not touch the fleet read, which is a global ordering and not a per-service query', () => {
    const off = executeTool(telemetry(), fleet).text;
    const on = executeTool(telemetry(), fleet, undefined, null, true).text;
    expect(on).toBe(off);
    expect(on).not.toContain('err=');
  });

  it('does not touch the logs tool, which already carries the lines themselves', () => {
    const off = executeTool(telemetry(), logsOf('checkout')).text;
    const on = executeTool(telemetry(), logsOf('checkout'), undefined, null, true).text;
    expect(on).toBe(off);
  });

  it('adds no call and no round: the same directive returns one more field', () => {
    const off = executeTool(telemetry(), metricOf('checkout'));
    const on = executeTool(telemetry(), metricOf('checkout'), undefined, null, true);
    expect(on.ok).toBe(off.ok);
    // One line in, one line out — the channel is a suffix on an existing line, not a new section.
    expect(on.text.split('\n')).toHaveLength(off.text.split('\n').length);
  });

  it('carries no service name, so it cannot become a third surface for the engine order', () => {
    const on = executeTool(telemetry(), metricOf('checkout'), undefined, null, true).text;
    // The line names the service it was ASKED about and nothing else.
    expect(on.split('\n').filter((line) => line.includes('db'))).toEqual([]);
  });
});
