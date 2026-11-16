/**
 * The failure-flow order: the second relational pass, and the engine that applies it.
 *
 * The unit half pins the ORDER on fixtures small enough that every position can be argued for, including the
 * refusals — no edge, an edge that carried no rise, equal unexplained flows — because those refusals are the
 * rule rather than its edge cases. The engine half asserts the two properties that decide whether the pass can
 * ship as a switch: it inverts a caller whose own interface failures are explained by its calls, and it reads a
 * measurement the graph carries rather than one the builder decided to take.
 *
 * @module __tests__/unit/failure-containment
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_FAILURE_CONTAINMENT,
  TreePruner,
  applyFailureContainment,
  failureFlows,
  unexplainedFailures,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

function series(label: string, values: readonly number[], stepMs = 60_000): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * stepMs),
    values: new Float64Array(values),
    unit: 'ms',
  };
}

function node(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function graphOf(
  ids: readonly string[],
  pairs: ReadonlyArray<readonly [string, string]>,
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of ids) nodes.set(id, node(id));
  const edges: CallEdge[] = pairs.map(([from, to]) => ({
    from,
    to,
    type: 'REST',
    callRate: 100,
    p99Latency: 10,
    errorRate: 0.01,
  }));
  return { nodes, edges, systemLoad: 0.3 };
}

/** Three services in a line — `c` calls `a` calls `b` — with `a` the fusion's mistaken leader. */
function relayCase(): {
  callGraph: ServiceCallGraph;
  metrics: MetricMap;
  injectTimeMs: number;
} {
  const callGraph = graphOf(
    ['a', 'b', 'c', 'd'],
    [
      ['a', 'b'],
      ['c', 'a'],
      ['d', 'b'],
    ],
  );
  const metrics = new Map<string, readonly TimeSeries[]>([
    ['a', [series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100])]],
    ['b', [series('cpu', [10, 10, 10, 10, 10, 12, 12, 12, 12, 12])]],
    ['c', [series('cpu', [10, 10, 10, 10, 10, 11, 11, 11, 11, 11])]],
    ['d', [series('cpu', [10, 10, 10, 10, 10, 10.5, 10.5, 10.5, 10.5, 10.5])]],
  ]);
  return { callGraph, metrics, injectTimeMs: 300_000 };
}

/**
 * The failed-call channel of {@link relayCase}: `c` reports 200 failures against `a`, and `a` reports 200
 * against `b`. `a`'s incoming failures are therefore entirely explained by its own outgoing ones, while `b`'s
 * are not explained by anything — the asymmetry the pass reads.
 */
const RELAY_FAILURES = [
  { caller: 'c', callee: 'a', failed: 200, baseline: 0 },
  { caller: 'a', callee: 'b', failed: 200, baseline: 0 },
  // A second caller of `b`, so `b`'s account is not the single number travelling down one chain — without this
  // the fixture is the degenerate relay the pass refuses, and the test would be asserting the refusal.
  { caller: 'd', callee: 'b', failed: 300, baseline: 0 },
];

function rankWith(options: { readonly failureContainment?: boolean }): {
  readonly services: string[];
  readonly ranks: number[];
} {
  const { callGraph, metrics, injectTimeMs } = relayCase();
  const pruner = new TreePruner({
    ...(options.failureContainment === undefined
      ? {}
      : { failureContainment: options.failureContainment }),
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, {
    injectTimeMs,
    failedTraceEdges: RELAY_FAILURES,
  });
  const results = pruner.analyze(graph, 3);
  return { services: results.map((one) => one.serviceId), ranks: results.map((one) => one.rank) };
}

// ── The measurement ───────────────────────────────────────

describe('failureFlows', () => {
  it('sums each service’s net rises in and out, without a normaliser', () => {
    const flows = failureFlows([
      { caller: 'c', callee: 'a', rise: 200 },
      { caller: 'a', callee: 'b', rise: 150 },
      { caller: 'a', callee: 'd', rise: 50 },
    ]);
    expect(flows.get('a')).toEqual({ incoming: 200, outgoing: 200 });
    expect(flows.get('b')).toEqual({ incoming: 150, outgoing: 0 });
  });

  it('reads a service with only one direction as a zero on the other', () => {
    const flows = failureFlows([{ caller: 'a', callee: 'b', rise: 7 }]);
    expect(flows.get('a')).toEqual({ incoming: 0, outgoing: 7 });
    expect(flows.get('b')).toEqual({ incoming: 7, outgoing: 0 });
  });

  it('is empty for an empty channel, and empty is not a measurement', () => {
    expect(failureFlows([]).size).toBe(0);
  });
});

describe('unexplainedFailures', () => {
  it('is the incoming rise no outgoing rise explains', () => {
    expect(unexplainedFailures({ incoming: 200, outgoing: 0 })).toBe(200);
    expect(unexplainedFailures({ incoming: 200, outgoing: 200 })).toBe(0);
  });

  it('clamps a service that fails more than it is failing, because the rule is not a penalty', () => {
    expect(unexplainedFailures({ incoming: 5, outgoing: 90 })).toBe(0);
  });

  it('reads an unmeasured service as zero rather than as zero evidence', () => {
    expect(unexplainedFailures(undefined)).toBe(0);
  });
});

// ── The rule ──────────────────────────────────────────────

const FAILING = new Map([['a\u0000b', 200]]);

function order(
  ranking: readonly string[],
  flows: ReadonlyMap<string, { incoming: number; outgoing: number }>,
  failingEdges: ReadonlyMap<string, number> = FAILING,
): string[] {
  return applyFailureContainment({
    ranking: ranking.map((service) => ({ service })),
    flows,
    failingEdges,
  }).map((one) => one.service);
}

describe('applyFailureContainment', () => {
  // `a` reports 200 failures outbound and saw 400 inbound — its own calls explain half of what it is charged;
  // `b` saw 500 inbound, only 200 of them from `a`. A GRADIENT, not a relay: the two accounts are not one account.
  const asymmetric = new Map([
    ['a', { incoming: 400, outgoing: 200 }],
    ['b', { incoming: 500, outgoing: 0 }],
  ]);

  it('promotes the callee whose incoming failures nothing outgoing explains', () => {
    expect(order(['a', 'b'], asymmetric)).toEqual(['b', 'a']);
  });

  it('reads the SAME quantity on both candidates, not their raw volumes', () => {
    // `a`'s raw incoming rise (1 000) is TWICE `b`'s (500), and `a` still loses the pair: 900 of its own calls
    // are failing, so its residual is 100 against `b`'s 500. This is the whole content of the rule.
    const explained = new Map([
      ['a', { incoming: 1000, outgoing: 900 }],
      ['b', { incoming: 500, outgoing: 0 }],
    ]);
    expect(order(['a', 'b'], explained, new Map([['a\u0000b', 100]]))).toEqual(['b', 'a']);
  });

  it('is not moved by a caller whose residual is the larger one', () => {
    const inverted = new Map([
      ['a', { incoming: 900, outgoing: 0 }],
      ['b', { incoming: 500, outgoing: 0 }],
    ]);
    expect(order(['a', 'b'], inverted, new Map([['a\u0000b', 400]]))).toEqual(['a', 'b']);
  });

  it('does nothing without a direct edge, however asymmetric the flows are', () => {
    expect(order(['a', 'b'], asymmetric, new Map([['b\u0000a', 200]]))).toEqual(['a', 'b']);
  });

  it('does nothing when the pair’s own edge carried no rise', () => {
    // The conduit lesson: the flows are asymmetric only because the edge is the only path, and a pair whose own
    // edge did not fail has no evidence about either end. Acting here is what the measured arm's single loss was.
    expect(order(['a', 'b'], asymmetric, new Map())).toEqual(['a', 'b']);
  });

  it('refuses the DEGENERATE RELAY, where the three accounts are one account', () => {
    // The measured arm's only regression: a chain in which the same 203 failures appear on every hop. Every
    // failure the callee saw came from this edge, every failure the caller reported left on it, and the caller's
    // own incoming count is that same number — one count travelling down a chain, so the residual asymmetry is an
    // artefact of where the chain stops. The refusal is an equality at three sites, not a threshold.
    const relay = new Map([
      ['c', { incoming: 0, outgoing: 203 }],
      ['a', { incoming: 203, outgoing: 203 }],
      ['b', { incoming: 203, outgoing: 0 }],
    ]);
    const chainEdges = new Map([
      ['c\u0000a', 203],
      ['a\u0000b', 203],
    ]);
    expect(order(['a', 'b'], relay, chainEdges)).toEqual(['a', 'b']);
    // …and the same flow with a GRADIENT is repaired: the callee's incoming count differs from the caller's own,
    // so the two accounts are not one account.
    const graded = new Map([
      ['c', { incoming: 0, outgoing: 400 }],
      ['a', { incoming: 400, outgoing: 203 }],
      ['b', { incoming: 203, outgoing: 0 }],
    ]);
    expect(order(['a', 'b'], graded, chainEdges)).toEqual(['b', 'a']);
  });

  it('does nothing when the two are equal, because the comparison is strict', () => {
    const tie = new Map([
      ['a', { incoming: 5, outgoing: 0 }],
      ['b', { incoming: 5, outgoing: 0 }],
    ]);
    expect(order(['a', 'b'], tie)).toEqual(['a', 'b']);
  });

  it('does nothing without a measurement', () => {
    expect(order(['a', 'b'], new Map())).toEqual(['a', 'b']);
  });

  it('inverts ADJACENT pairs only, so an unrelated candidate in between is not jumped', () => {
    // `a` calls `b`, but the fusion published `x` between them. The rule is about the order the fusion
    // published, one position at a time — a pass that reached over `x` would be a re-sort on one instrument,
    // which is measured worse than the fusion it replaces.
    const flows = new Map([
      ['a', { incoming: 200, outgoing: 200 }],
      ['b', { incoming: 200, outgoing: 0 }],
      ['x', { incoming: 0, outgoing: 0 }],
    ]);
    expect(order(['a', 'x', 'b'], flows)).toEqual(['a', 'x', 'b']);
  });

  it('is independent of the scores, which it never reads', () => {
    const flows = new Map([
      ['a', { incoming: 400, outgoing: 200 }],
      ['b', { incoming: 500, outgoing: 0 }],
    ]);
    const high = applyFailureContainment({
      ranking: [
        { service: 'a', score: 99 },
        { service: 'b', score: 1 },
      ],
      flows,
      failingEdges: FAILING,
    });
    const low = applyFailureContainment({
      ranking: [
        { service: 'a', score: 1 },
        { service: 'b', score: 99 },
      ],
      flows,
      failingEdges: FAILING,
    });
    expect(high.map((one) => one.service)).toEqual(['b', 'a']);
    expect(low.map((one) => one.service)).toEqual(['b', 'a']);
  });
});

// ── The engine ────────────────────────────────────────────

describe('the failure-flow order in the engine', () => {
  it('ships off, because the measured arm carries one regression in 711 cases', () => {
    expect(DEFAULT_FAILURE_CONTAINMENT).toBe(false);
  });

  it('promotes the callee whose failures no call of its own explains', () => {
    expect(rankWith({ failureContainment: true }).services.slice(0, 2)).toEqual(['b', 'a']);
  });

  it('renumbers the published rank when it moves a pair', () => {
    expect(rankWith({ failureContainment: true }).ranks.slice(0, 2)).toEqual([1, 2]);
  });

  it('is off in the shipped configuration', () => {
    expect(rankWith({}).services[0]).toBe('a');
    expect(DEFAULT_FAILURE_CONTAINMENT).toBe(false);
  });

  it('carries the flows on the graph even when the pass is off', () => {
    // THE PHASE FENCE, the same one the excursion map needed: `analyze` takes a graph from ANY pruner, so a
    // measurement that only exists when the option is on is a per-graph option wearing a per-run name.
    const { callGraph, metrics, injectTimeMs } = relayCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics, {
      injectTimeMs,
      failedTraceEdges: RELAY_FAILURES,
    });
    expect(graph.failureFlows?.get('a')).toEqual({ incoming: 200, outgoing: 200 });
    expect(graph.failureFlows?.get('b')).toEqual({ incoming: 500, outgoing: 0 });
  });

  it('omits the flows when the case carried no failed call, so a silent channel is absent not empty', () => {
    const { callGraph, metrics, injectTimeMs } = relayCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics, { injectTimeMs });
    expect(graph.failureFlows).toBeUndefined();
  });

  it('lets one pruner analyze a graph another pruner built, under its OWN setting', () => {
    const { callGraph, metrics, injectTimeMs } = relayCase();
    const builder = new TreePruner({ failureContainment: false });
    const graph = builder.buildFaultGraph(callGraph, metrics, {
      injectTimeMs,
      failedTraceEdges: RELAY_FAILURES,
    });
    const reader = new TreePruner({ failureContainment: true });
    expect(
      reader
        .analyze(graph, 4)
        .map((one) => String(one.serviceId))
        .slice(0, 2),
    ).toEqual(['b', 'a']);
    expect(
      builder
        .analyze(graph, 4)
        .map((one) => String(one.serviceId))
        .slice(0, 2),
    ).toEqual(['a', 'b']);
  });
});
