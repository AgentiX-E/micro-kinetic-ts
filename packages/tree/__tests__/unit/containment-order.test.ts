/**
 * The containment order: the pairwise rule, and the engine that applies it.
 *
 * The unit half pins the ORDER with fixtures small enough that every position can be argued for, including the
 * refusals — no profile, no channel, one side unmeasured, the wrong direction of the edge. The engine half runs
 * a two-service case through the pruner and asserts the three properties that decide whether the pass ships: it
 * inverts a caller whose own latency stayed inside its band, it does nothing at all without a profile, and it
 * renumbers `rank` when it moves a pair.
 *
 * @module __tests__/unit/containment-order
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FaultFreeProfile } from '@agentix-e/micro-kinetic-tree';
import {
  DEFAULT_CONTAINMENT_MARGIN,
  DEFAULT_CONTAINMENT_ORDER,
  TreePruner,
  applyContainmentOrder,
  isLatencyChannel,
  latencyExcursions,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

const LATENCY = 'http.server.request.duration';

function series(label: string, values: readonly number[], stepMs = 60_000): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * stepMs),
    values: new Float64Array(values),
    unit: 'ms',
  };
}

/**
 * A profile entry centred on `centre` with scale `scale`, so the shipped band at σ = 3 is
 * `[centre − 3·scale, centre + 3·scale]`.
 */
function profileOf(
  entries: ReadonlyArray<readonly [service: string, label: string, centre: number, scale: number]>,
): FaultFreeProfile {
  const byService = new Map<
    string,
    Map<string, { label: string; centre: number; scale: number; rate: number; windows: number }>
  >();
  for (const [service, label, centre, scale] of entries) {
    const channels = byService.get(service) ?? new Map();
    channels.set(label, { label, centre, scale, rate: 0.5, windows: 5 });
    byService.set(service, channels);
  }
  return byService as unknown as FaultFreeProfile;
}

/** Ten samples at one-minute spacing with the injection at index 5. */
const INJECT = 5 * 60_000;

function excursionsOf(
  metrics: MetricMap,
  profile: FaultFreeProfile | undefined,
  injectTimeMs = INJECT,
  sigma?: number,
): Map<string, number> {
  return latencyExcursions({
    metrics,
    profile,
    injectTimeMs,
    ...(sigma === undefined ? {} : { sigma }),
  });
}

// ── isLatencyChannel ──────────────────────────────────────

describe('isLatencyChannel', () => {
  it('accepts the server-side request histogram', () => {
    expect(isLatencyChannel(LATENCY)).toBe(true);
  });

  it('accepts every Hubble quantile', () => {
    for (const quantile of ['p50', 'p90', 'p95', 'p99', 'max']) {
      expect(isLatencyChannel(`hubble_http_request_duration_${quantile}_seconds`)).toBe(true);
    }
  });

  it('refuses channels that measure something else', () => {
    for (const label of [
      'container.cpu.usage',
      'http.response.error_rate',
      'k8s.pod.memory.rss',
      '',
    ]) {
      expect(isLatencyChannel(label)).toBe(false);
    }
  });
});

// ── latencyExcursions ─────────────────────────────────────

describe('latencyExcursions', () => {
  it('is empty without a profile', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, undefined).size).toBe(0);
  });

  it('is empty when the profile holds nothing', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, profileOf([])).size).toBe(0);
  });

  it('is empty when the injection instant is unknown', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9])]]]);
    const profile = profileOf([['a', LATENCY, 1, 1]]);
    expect(excursionsOf(metrics, profile, 0).size).toBe(0);
  });

  it('measures zero for a service inside its band', () => {
    // Post median 5 against centre 5 with a band of ±3·1 → inside, so the excursion is a measured 0.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 5, 5, 5, 5, 5])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBe(0);
  });

  it('measures the distance above the band in band widths', () => {
    // Band [2, 8] (centre 5, scale 1, σ 3): post median 14 sits 6 above the top, i.e. 1 band width.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBeCloseTo(1, 12);
  });

  it('measures the distance below the band in band widths', () => {
    // Band [2, 8]; post median −4 sits 6 below the bottom → one band width. A COLLAPSE is an excursion too:
    // a service that stopped answering is not a service that did not move.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, -4, -4, -4, -4, -4])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).get('a')).toBeCloseTo(1, 12);
  });

  it('reads the widest of a service\u2019s latency channels', () => {
    const metrics = new Map([
      [
        'a',
        [
          series(LATENCY, [1, 1, 1, 1, 1, 9, 9, 9, 9, 9]),
          series('hubble_http_request_duration_p99_seconds', [1, 1, 1, 1, 1, 20, 20, 20, 20, 20]),
        ],
      ],
    ]);
    const profile = profileOf([
      ['a', LATENCY, 5, 1],
      ['a', 'hubble_http_request_duration_p99_seconds', 5, 1],
    ]);
    // Band [2, 8] → width 6: 9 gives (9−8)/6 and 20 gives (20−8)/6 = 2, so the widest wins.
    expect(excursionsOf(metrics, profile).get('a')).toBeCloseTo(2, 12);
  });

  it('honours a caller-supplied sigma', () => {
    // At σ = 1 the band is [4, 6] and post 14 sits 8 outside a width of 2 → 4 band widths.
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(
      excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]]), INJECT, 1).get('a'),
    ).toBeCloseTo(4, 12);
  });

  it('refuses a service the profile does not carry', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]]]);
    expect(excursionsOf(metrics, profileOf([['b', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('refuses a service whose channels are not latency channels', () => {
    const metrics = new Map([
      ['a', [series('container.cpu.usage', [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]],
    ]);
    expect(excursionsOf(metrics, profileOf([['a', 'container.cpu.usage', 5, 1]])).has('a')).toBe(
      false,
    );
  });

  it('refuses a latency channel the profile has no entry for', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]]]);
    expect(
      excursionsOf(
        metrics,
        profileOf([['a', 'hubble_http_request_duration_p50_seconds', 5, 1]]),
      ).has('a'),
    ).toBe(false);
  });

  it('refuses a degenerate band rather than dividing by its width', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, 90, 90, 90, 90, 90])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 0]])).has('a')).toBe(false);
  });

  it('refuses a series with no post-injection sample', () => {
    // One sample, injection at index 5: there is no window after the boundary to measure.
    const metrics = new Map([['a', [series(LATENCY, [1])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('refuses a series holding a non-finite sample', () => {
    const metrics = new Map([['a', [series(LATENCY, [1, 1, 1, 1, 1, Number.NaN, 9, 9, 9, 9])]]]);
    expect(excursionsOf(metrics, profileOf([['a', LATENCY, 5, 1]])).has('a')).toBe(false);
  });

  it('measures each service independently', () => {
    const metrics = new Map([
      ['a', [series(LATENCY, [1, 1, 1, 1, 1, 5, 5, 5, 5, 5])]],
      ['b', [series(LATENCY, [1, 1, 1, 1, 1, 14, 14, 14, 14, 14])]],
    ]);
    const profile = profileOf([
      ['a', LATENCY, 5, 1],
      ['b', LATENCY, 5, 1],
    ]);
    const result = excursionsOf(metrics, profile);
    expect(result.get('a')).toBe(0);
    expect(result.get('b')).toBeCloseTo(1, 12);
  });
});

// ── applyContainmentOrder ─────────────────────────────────

interface Row {
  readonly service: string;
}

const rows = (...services: readonly string[]): Row[] => services.map((service) => ({ service }));

const servicesOf = (list: readonly Row[]): string[] => list.map((one) => one.service);

const CALLS_AB: readonly CallEdge[] = [
  { from: 'a', to: 'b', type: 'REST', callRate: 100, p99Latency: 10, errorRate: 0.01 },
];

describe('applyContainmentOrder', () => {
  it('inverts a caller whose callee is further outside its band', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['b', 'a']);
  });

  it('leaves a pair alone when the caller is the one further outside', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 4],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('leaves equal excursions alone, because the comparison is strict', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 1],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('applies the margin in band widths', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 0.5],
      ]),
      margin: 1,
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does nothing without edges', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: [],
      excursions: new Map([
        ['a', 0],
        ['b', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does nothing without excursions', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map(),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('leaves a list shorter than two alone', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a'),
      edges: CALLS_AB,
      excursions: new Map([['a', 9]]),
    });
    expect(servicesOf(ordered)).toEqual(['a']);
  });

  it('refuses the pair when only one side was measured', () => {
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: CALLS_AB,
      excursions: new Map([['b', 9]]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does not invert a callee above its caller', () => {
    // The edge runs `b → a`, so the ranking puts the CALLER second. The rule only ever moves a callee up, never a
    // caller, whatever the excursions say — an upward move that ignored the direction would be a different claim.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b'),
      edges: [{ from: 'b', to: 'a' }],
      excursions: new Map([
        ['a', 0],
        ['b', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b']);
  });

  it('does not touch a non-adjacent pair', () => {
    // `a` calls `c`, but `b` sits between them: the pass compares POSITIONS, and a promotion across an
    // intervening candidate would be a re-sort rather than an inversion of the published order.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b', 'c'),
      edges: [{ from: 'a', to: 'c' }],
      excursions: new Map([
        ['a', 0],
        ['b', 0],
        ['c', 9],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['a', 'b', 'c']);
  });

  it('sweeps once, without re-examining what it moved', () => {
    // a → b → c with rising excursions: the first inversion puts `b` on top; the pass then compares `a` against
    // `c`, finds no edge, and stops. `c` never climbs, which is what keeps one measurement from compounding.
    const ordered = applyContainmentOrder({
      ranking: rows('a', 'b', 'c'),
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      excursions: new Map([
        ['a', 0],
        ['b', 1],
        ['c', 2],
      ]),
    });
    expect(servicesOf(ordered)).toEqual(['b', 'a', 'c']);
  });

  it('returns a new array and never mutates its input', () => {
    const ranking = rows('a', 'b');
    const ordered = applyContainmentOrder({
      ranking,
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(servicesOf(ranking)).toEqual(['a', 'b']);
    expect(ordered).not.toBe(ranking);
  });

  it('carries the caller\u2019s payload through the inversion', () => {
    const ordered = applyContainmentOrder({
      ranking: [
        { service: 'a', payload: 'caller' },
        { service: 'b', payload: 'callee' },
      ],
      edges: CALLS_AB,
      excursions: new Map([
        ['a', 0],
        ['b', 1],
      ]),
    });
    expect(ordered.map((one) => one.payload)).toEqual(['callee', 'caller']);
  });
});

// ── The engine ────────────────────────────────────────────

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

/**
 * A two-service propagation case whose leader is the CALLER.
 *
 * `a` calls `b`. `a`'s cpu rises by a factor of ten while its latency stays inside the band it occupied when
 * nothing was wrong; `b`'s cpu is flat while its latency leaves the band by a wide margin. The fusion reads
 * `a`'s rise and answers with `a` — the mechanism the pass exists for.
 */
function propagationCase(): {
  callGraph: ServiceCallGraph;
  metrics: MetricMap;
  injectTimeMs: number;
} {
  const callGraph = graphOf(['a', 'b'], [['a', 'b']]);
  const metrics = new Map<string, readonly TimeSeries[]>([
    [
      'a',
      [
        series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100]),
        series(LATENCY, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
      ],
    ],
    [
      'b',
      [
        series('cpu', [10, 10, 10, 10, 10, 10, 10, 10, 10, 10]),
        series(LATENCY, [5, 5, 5, 5, 5, 40, 40, 40, 40, 40]),
      ],
    ],
  ]);
  return { callGraph, metrics, injectTimeMs: INJECT };
}

function profileForCase(): FaultFreeProfile {
  return profileOf([
    ['a', LATENCY, 5, 1],
    ['b', LATENCY, 5, 1],
  ]);
}

function rankWith(options: {
  readonly containmentOrder?: boolean;
  readonly profile?: FaultFreeProfile;
}): { readonly services: string[]; readonly ranks: number[] } {
  const { callGraph, metrics, injectTimeMs } = propagationCase();
  const pruner = new TreePruner({
    ...(options.containmentOrder === undefined
      ? {}
      : { containmentOrder: options.containmentOrder }),
    ...(options.profile === undefined ? {} : { faultFreeProfile: options.profile }),
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs });
  const results = pruner.analyze(graph, 5);
  return { services: results.map((one) => one.serviceId), ranks: results.map((one) => one.rank) };
}

describe('the containment order in the engine', () => {
  it('ships off with a strict margin, because no benchmark dispatch supplies a profile', () => {
    expect(DEFAULT_CONTAINMENT_ORDER).toBe(false);
    expect(DEFAULT_CONTAINMENT_MARGIN).toBe(0);
  });

  it('promotes the callee whose own latency left its band', () => {
    expect(
      rankWith({ containmentOrder: true, profile: profileForCase() }).services.slice(0, 2),
    ).toEqual(['b', 'a']);
  });

  it('renumbers the published rank when it moves a pair', () => {
    expect(
      rankWith({ containmentOrder: true, profile: profileForCase() }).ranks.slice(0, 2),
    ).toEqual([1, 2]);
  });

  it('is a no-op without a profile, even when switched on', () => {
    const withoutPass = rankWith({ containmentOrder: false });
    const withPassButNoProfile = rankWith({ containmentOrder: true });
    expect(withPassButNoProfile.services).toEqual(withoutPass.services);
    expect(withoutPass.services[0]).toBe('a');
  });

  it('is a no-op when switched off, whatever the profile says', () => {
    expect(rankWith({ containmentOrder: false, profile: profileForCase() }).services[0]).toBe('a');
  });

  it('is off in the shipped configuration', () => {
    expect(rankWith({ profile: profileForCase() }).services[0]).toBe('a');
  });

  it('does not build the excursion map when it cannot be read', () => {
    const { callGraph, metrics, injectTimeMs } = propagationCase();
    const graph = new TreePruner().buildFaultGraph(callGraph, metrics, { injectTimeMs });
    expect(graph.containmentExcursions).toBeUndefined();
  });

  it('measures the excursions on the graph when the pass can run', () => {
    const { callGraph, metrics, injectTimeMs } = propagationCase();
    const pruner = new TreePruner({ containmentOrder: true, faultFreeProfile: profileForCase() });
    const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs });
    expect(graph.containmentExcursions?.get('a')).toBe(0);
    expect(graph.containmentExcursions?.get('b')).toBeGreaterThan(1);
  });

  it('lets one pruner analyze a graph another pruner built, under its OWN setting', () => {
    // THE PHASE FENCE. `containmentOrder` used to decide, at BUILD time, whether the excursion map existed, so a
    // graph built by a pruner that had the pass switched off carried no map and every other pruner reading that
    // graph silently ran without the pass — whatever its own option said. That is not hypothetical: it is how the
    // seven-arm factorial measured a 13-violation corpus at exactly the shipped 484, because the first arm built
    // the graph and the first arm was the pass-off control. A measurement is a property of the CASE; whether it
    // acts is a property of the RUN, and the run is `analyze` — the same phase `failedEdgeGateMode` already lives
    // in. The builder here has the pass OFF and the reader has it ON, which is the shape the harnesses use.
    const { callGraph, metrics, injectTimeMs } = propagationCase();
    const builder = new TreePruner({
      containmentOrder: false,
      faultFreeProfile: profileForCase(),
    });
    const graph = builder.buildFaultGraph(callGraph, metrics, { injectTimeMs });
    const reader = new TreePruner({ containmentOrder: true, faultFreeProfile: profileForCase() });
    expect(
      reader
        .analyze(graph, 3)
        .map((result) => String(result.serviceId))
        .slice(0, 2),
    ).toEqual(['b', 'a']);
    // …and the builder, reading the same graph, still does nothing: the map's existence cannot switch the pass on.
    expect(
      builder
        .analyze(graph, 3)
        .map((result) => String(result.serviceId))
        .slice(0, 2),
    ).toEqual(['a', 'b']);
  });
});
