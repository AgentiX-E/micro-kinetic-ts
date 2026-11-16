/**
 * The failure-flow order: the second relational pass, and the engine that applies it.
 *
 * The unit half pins the ORDER on fixtures small enough that every position can be argued for, including the
 * refusals — no edge, an edge that carried no rise, equal unexplained flows — because those refusals are the
 * rule rather than its edge cases. The engine half asserts the two properties that decide whether the pass can
 * ship as a switch: it inverts a caller whose own interface failures are explained by its calls, and it reads a
 * measurement the graph carries rather than one the builder decided to take.
 *
 * Iteration 290 adds the third direction. A CALLER that corrupts its request makes the callee reject a shape the
 * callee has never been asked for, and every count of that failure still lands on the callee — the mechanism
 * behind the two losses the full-corpus readback recorded. The fixtures below therefore carry both kinds of rise:
 * `novel` (a shape the edge never carried, charged to the caller) and the rest (a shape it always carried,
 * charged to the callee).
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
import type { FailingEdge, FailureFlow } from '@agentix-e/micro-kinetic-tree';

import {
  applyFailureContainment,
  DEFAULT_FAILURE_ATTRIBUTION,
  DEFAULT_FAILURE_CONTAINMENT,
  failureFlows,
  isFailureAttribution,
  TreePruner,
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

/** One counted rise: the whole count known-shape unless a test says otherwise. */
function rise(caller: string, callee: string, amount: number, novel = 0) {
  return { caller, callee, rise: amount, novel };
}

/**
 * One flow entry, as the 2×2 the pass reads: known inbound, known outbound, novel inbound, novel outbound.
 *
 * The novel halves default to zero, so a fixture that is about the one-dimensional rule reads as the 289
 * counting and a fixture that is about the shape split has to say which half moved.
 */
function flow(knownIn: number, knownOut: number, novelIn = 0, novelOut = 0) {
  return { knownIn, knownOut, novelIn, novelOut };
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

/**
 * The request-corruption shape of the same topology: `a` sends `b` a request shape the edge has never carried,
 * `b` rejects it, and `b` therefore reports an inbound failure `a` produced. `d` is kept as a second caller of
 * `b` so the fixture is not the degenerate relay.
 */
const CORRUPTED_FAILURES = [
  { caller: 'c', callee: 'a', failed: 200, baseline: 0 },
  { caller: 'a', callee: 'b', failed: 200, baseline: 0, novel: 200 },
  { caller: 'd', callee: 'b', failed: 300, baseline: 0 },
];

function rankWith(
  options: { readonly failureContainment?: boolean },
  failures: readonly {
    caller: string;
    callee: string;
    failed: number;
    baseline: number;
    novel?: number;
  }[] = RELAY_FAILURES,
): {
  readonly services: string[];
  readonly ranks: number[];
} {
  const { callGraph, metrics, injectTimeMs } = relayCase();
  const pruner = new TreePruner(
    options.failureContainment === undefined
      ? {}
      : { failureContainment: options.failureContainment },
  );
  const graph = pruner.buildFaultGraph(callGraph, metrics, {
    injectTimeMs,
    failedTraceEdges: failures,
  });
  const results = pruner.analyze(graph, 3);
  return { services: results.map((one) => one.serviceId), ranks: results.map((one) => one.rank) };
}

// ── The measurement ───────────────────────────────────────

describe('failureFlows', () => {
  it('sums each service’s net rises in and out, without a normaliser', () => {
    const flows = failureFlows([rise('c', 'a', 200), rise('a', 'b', 150), rise('a', 'd', 50)]);
    expect(flows.get('a')).toEqual(flow(200, 200));
    expect(flows.get('b')).toEqual(flow(150, 0));
  });

  it('reads a service with only one direction as a zero on the other', () => {
    const flows = failureFlows([rise('a', 'b', 7)]);
    expect(flows.get('a')).toEqual(flow(0, 7));
    expect(flows.get('b')).toEqual(flow(7, 0));
  });

  it('charges a NOVEL rise to the caller’s own corruption, not to the callee it was reported against', () => {
    // The whole of iteration 290 in one assertion: the count is the same on both rows, and the direction it
    // supports is opposite. `b`'s interface did not fail — it rejected a request it had never been asked for —
    // so the novel half is recorded OUT of `a` and INTO `b` under its own name, and the pass decides which end
    // it charges. `b`'s known column stays at the 300 its other caller sent.
    const flows = failureFlows([rise('a', 'b', 200, 200), rise('d', 'b', 300)]);
    expect(flows.get('a')).toEqual(flow(0, 0, 0, 200));
    expect(flows.get('b')).toEqual(flow(300, 0, 200, 0));
    expect(flows.get('d')).toEqual(flow(0, 300));
  });

  it('splits a mixed edge between the two accounts instead of choosing one', () => {
    // 500 failures on the edge, 200 of them on shapes the edge never carried: the callee is failing 300 known
    // requests AND the caller sent 200 corrupted ones. Both are true and both are charged.
    const flows = failureFlows([rise('a', 'b', 500, 200)]);
    expect(flows.get('a')).toEqual(flow(0, 300, 0, 200));
    expect(flows.get('b')).toEqual(flow(300, 0, 200, 0));
  });

  it('never charges more novelty than the rise it is part of', () => {
    // A producer that reported novelty beyond the net rise would otherwise let one failure explain two
    // directions at once. The clamp is the measurement refusing to exceed what it counted.
    const flows = failureFlows([rise('a', 'b', 100, 900)]);
    expect(flows.get('a')).toEqual(flow(0, 0, 0, 100));
    expect(flows.get('b')).toEqual(flow(0, 0, 100, 0));
  });

  it('is empty for an empty channel, and empty is not a measurement', () => {
    expect(failureFlows([]).size).toBe(0);
  });
});

describe('unexplainedFailures', () => {
  it('is the incoming rise no outgoing rise explains', () => {
    expect(unexplainedFailures(flow(200, 0))).toBe(200);
    expect(unexplainedFailures(flow(200, 200))).toBe(0);
  });

  it('counts a service’s own corrupted requests as evidence about that service', () => {
    // A service whose every call is rejected for its shape is a source that fails no request of its own: its
    // interface is healthy and its outbound traffic is not.
    expect(unexplainedFailures(flow(0, 0, 0, 200))).toBe(200);
  });

  it('nets the two kinds of evidence, because both say the same thing about the service', () => {
    expect(unexplainedFailures(flow(400, 0, 0, 200))).toBe(600);
  });

  it('clamps a service that fails more than it is failing, because the rule is not a penalty', () => {
    expect(unexplainedFailures(flow(5, 90))).toBe(0);
  });

  it('reads an unmeasured service as zero rather than as zero evidence', () => {
    expect(unexplainedFailures(undefined)).toBe(0);
  });

  it('applies the COUNTS reading on request, which is the 289 rule kept reachable', () => {
    // The ablation switch has to change the READING and nothing else: on the same flow the two attributions
    // disagree by exactly the novel rise, and on a flow with no novelty they agree exactly.
    const corrupted = flow(200, 0, 0, 200);
    expect(unexplainedFailures(corrupted)).toBe(400);
    expect(unexplainedFailures(corrupted, 'counts')).toBe(0);
    const plain = flow(200, 200);
    expect(unexplainedFailures(plain)).toBe(unexplainedFailures(plain, 'counts'));
  });
});

// ── The rule ──────────────────────────────────────────────

const FAILING = new Map([['a\u0000b', { rise: 200, novel: 0 }]]);

function order(
  ranking: readonly string[],
  flows: ReadonlyMap<string, FailureFlow>,
  failingEdges: ReadonlyMap<string, FailingEdge> = FAILING,
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
    ['a', flow(400, 200)],
    ['b', flow(500, 0)],
  ]);

  it('promotes the callee whose incoming failures nothing outgoing explains', () => {
    expect(order(['a', 'b'], asymmetric)).toEqual(['b', 'a']);
  });

  it('reads the SAME quantity on both candidates, not their raw volumes', () => {
    // `a`'s raw incoming rise (1 000) is TWICE `b`'s (500), and `a` still loses the pair: 900 of its own calls
    // are failing, so its residual is 100 against `b`'s 500. This is the whole content of the rule.
    const explained = new Map([
      ['a', flow(1000, 900)],
      ['b', flow(500, 0)],
    ]);
    expect(order(['a', 'b'], explained, new Map([['a\u0000b', { rise: 100, novel: 0 }]]))).toEqual([
      'b',
      'a',
    ]);
  });

  it('is not moved by a caller whose residual is the larger one', () => {
    const inverted = new Map([
      ['a', flow(900, 0)],
      ['b', flow(500, 0)],
    ]);
    expect(order(['a', 'b'], inverted, new Map([['a\u0000b', { rise: 400, novel: 0 }]]))).toEqual([
      'a',
      'b',
    ]);
  });

  it('does nothing without a direct edge, however asymmetric the flows are', () => {
    expect(order(['a', 'b'], asymmetric, new Map([['b\u0000a', { rise: 200, novel: 0 }]]))).toEqual(
      ['a', 'b'],
    );
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
      ['c', flow(0, 203)],
      ['a', flow(203, 203)],
      ['b', flow(203, 0)],
    ]);
    const chainEdges = new Map([
      ['c\u0000a', { rise: 203, novel: 0 }],
      ['a\u0000b', { rise: 203, novel: 0 }],
    ]);
    expect(order(['a', 'b'], relay, chainEdges)).toEqual(['a', 'b']);
    // …and the same flow with a GRADIENT is repaired: the callee's incoming count differs from the caller's own,
    // so the two accounts are not one account.
    const graded = new Map([
      ['c', flow(0, 400)],
      ['a', flow(400, 203)],
      ['b', flow(203, 0)],
    ]);
    expect(order(['a', 'b'], graded, chainEdges)).toEqual(['b', 'a']);
  });

  it('does not read a NOVEL count as one of the relay’s three accounts', () => {
    // The relay refusal compares like with like: a count that arrived on a shape this edge never carried is not
    // the same account as the ones that did. Every known quantity here is zero, so there is no count travelling
    // through the pair at all and the refusal has nothing to refuse — the pair is judged on its residual.
    const flows = new Map([
      ['a', flow(0, 0, 0, 203)],
      ['b', flow(0, 0, 0, 300)],
    ]);
    const edges = new Map([['a\u0000b', { rise: 203, novel: 203 }]]);
    expect(order(['a', 'b'], flows, edges)).toEqual(['b', 'a']);
    // The SAME totals with the novelty removed ARE the relay, and the refusal fires: the guard reads the known
    // shape of the counts, not their sum.
    const knownRelay = new Map([
      ['a', flow(203, 203)],
      ['b', flow(203, 0)],
    ]);
    expect(order(['a', 'b'], knownRelay, new Map([['a\u0000b', { rise: 203, novel: 0 }]]))).toEqual(
      ['a', 'b'],
    );
  });

  it('refuses to promote the callee that only rejected a CORRUPTED request', () => {
    // The two losses of the 289 readback, in miniature. The fusion published the caller first; without the shape
    // channel the callee nets the whole rise and is promoted, which is the wrong end; with it the callee nets
    // nothing and the published order stands.
    const edge = new Map([['a\u0000b', { rise: 200, novel: 200 }]]);
    // `c` → `a` carried 200 failures and `d` → `b` carried 300: `a`'s inbound is explained by its own outgoing
    // call only in the counted-only reading, where that call is what failed.
    const corrupted = new Map([
      ['a', flow(200, 0, 0, 200)],
      ['b', flow(300, 0)],
    ]);
    expect(order(['a', 'b'], corrupted, edge)).toEqual(['a', 'b']);
    const countedOnly = new Map([
      ['a', flow(200, 200)],
      ['b', flow(500, 0)],
    ]);
    expect(order(['a', 'b'], countedOnly, edge)).toEqual(['b', 'a']);
  });

  it('is the pre-290 rule whenever no shape is novel, so the change is confined to the families it names', () => {
    // The equivalence that makes the axis safe: `novel = 0` on every row reduces the residual to `incoming −
    // outgoing`, which is exactly what iteration 289 measured. Anything else would be a second change hidden
    // inside this one.
    const channels: Array<[ReadonlyMap<string, { incoming: number; outgoing: number }>, string[]]> =
      [
        [
          new Map([
            ['a', { incoming: 400, outgoing: 200 }],
            ['b', { incoming: 500, outgoing: 0 }],
          ]),
          ['b', 'a'],
        ],
        [
          new Map([
            ['a', { incoming: 5, outgoing: 0 }],
            ['b', { incoming: 5, outgoing: 0 }],
          ]),
          ['a', 'b'],
        ],
        [
          new Map([
            ['a', { incoming: 900, outgoing: 0 }],
            ['b', { incoming: 500, outgoing: 0 }],
          ]),
          ['a', 'b'],
        ],
      ];
    for (const [known, expected] of channels) {
      const asFlows = new Map(
        [...known].map(([service, one]) => [service, flow(one.incoming, one.outgoing)]),
      );
      expect(order(['a', 'b'], asFlows)).toEqual(expected);
    }
  });

  it('can be pinned to the COUNTS reading, and then promotes the callee it would otherwise spare', () => {
    // One cache, two readings, opposite answers — which is what makes the axis ablatable rather than a claim.
    const corrupted = new Map([
      ['a', flow(200, 0, 0, 200)],
      ['b', flow(300, 0, 200, 0)],
    ]);
    const edge = new Map([['a\u0000b', { rise: 200, novel: 200 }]]);
    const rank = (attribution: 'shape' | 'counts'): string[] =>
      applyFailureContainment({
        ranking: [{ service: 'a' }, { service: 'b' }],
        flows: corrupted,
        failingEdges: edge,
        attribution,
      }).map((one) => one.service);
    expect(rank('shape')).toEqual(['a', 'b']);
    expect(rank('counts')).toEqual(['b', 'a']);
  });

  it('applies the relay refusal under the COUNTS reading too, where the three accounts are totals', () => {
    // The refusal has a second form because the counts reading has no novel split: the equalities are the same
    // three counts, each summed over both kinds. Without this arm the guard would silently not exist for the
    // ablation the switch exists to run.
    const relay = new Map([
      ['a', flow(203, 203)],
      ['b', flow(203, 0)],
    ]);
    const chain = new Map([['a\u0000b', { rise: 203, novel: 0 }]]);
    expect(
      applyFailureContainment({
        ranking: [{ service: 'a' }, { service: 'b' }],
        flows: relay,
        failingEdges: chain,
        attribution: 'counts',
      }).map((one) => one.service),
    ).toEqual(['a', 'b']);
  });

  it('is a no-op on a ranking of fewer than two candidates', () => {
    // `analyze` calls the pass on whatever list it produced, and a one-candidate list has no adjacent pair to
    // judge. The early return is the only guard that does not need a flow to exist.
    expect(order(['a'], asymmetric)).toEqual(['a']);
  });

  it('does nothing when the two are equal, because the comparison is strict', () => {
    const tie = new Map([
      ['a', flow(5, 0)],
      ['b', flow(5, 0)],
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
      ['a', flow(200, 200)],
      ['b', flow(200, 0)],
      ['x', flow(0, 0)],
    ]);
    expect(order(['a', 'x', 'b'], flows)).toEqual(['a', 'x', 'b']);
  });

  it('is independent of the scores, which it never reads', () => {
    const flows = new Map([
      ['a', flow(400, 200)],
      ['b', flow(500, 0)],
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

  it('reads novel-shape evidence to the caller in the shipped configuration', () => {
    expect(DEFAULT_FAILURE_ATTRIBUTION).toBe('shape');
  });

  it('recognises exactly the two readings, and nothing else', () => {
    // The guard the CLI parses against. A total function over `unknown`, because the value arrives from a
    // workflow input: `true`, `'Shape'` and `'shape '` are all things a dispatch can produce, and each of them
    // has to be a REFUSAL rather than silently picking a reading.
    expect(isFailureAttribution('shape')).toBe(true);
    expect(isFailureAttribution('counts')).toBe(true);
    for (const value of ['Shape', 'shape ', 'COUNT', '', 'novel', undefined, 0, null, {}]) {
      expect(isFailureAttribution(value)).toBe(false);
    }
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
    expect(graph.failureFlows?.get('a')).toEqual(flow(200, 200));
    expect(graph.failureFlows?.get('b')).toEqual(flow(500, 0));
  });

  it('carries the novel split on the graph, measured, whichever way the pass is set', () => {
    const { callGraph, metrics, injectTimeMs } = relayCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics, {
      injectTimeMs,
      failedTraceEdges: CORRUPTED_FAILURES,
    });
    expect(graph.failureFlows?.get('a')).toEqual(flow(200, 0, 0, 200));
    expect(graph.failureFlows?.get('b')).toEqual(flow(300, 0, 200, 0));
    expect(graph.failingEdges?.get('a\u0000b')).toEqual({ rise: 200, novel: 200 });
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

  it('keeps a corrupted-request case out of the callee’s column through the whole engine', () => {
    // End to end: one graph, one option, and the only difference is whether the producer reported the shape
    // split. The fusion publishes the caller `a` first; the counted-only channel promotes the callee `b` over
    // it, and the shape channel leaves the order alone — exactly the pair the 289 readback lost twice.
    expect(rankWith({ failureContainment: true }, CORRUPTED_FAILURES).services.slice(0, 2)).toEqual(
      ['a', 'b'],
    );
    const withoutNovel = CORRUPTED_FAILURES.map(({ caller, callee, failed, baseline }) => ({
      caller,
      callee,
      failed,
      baseline,
    }));
    expect(rankWith({ failureContainment: true }, withoutNovel).services.slice(0, 2)).toEqual([
      'b',
      'a',
    ]);
  });
});
