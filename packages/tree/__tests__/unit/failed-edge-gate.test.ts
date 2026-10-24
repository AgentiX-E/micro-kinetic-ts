/**
 * The failed-edge direction term's GATE — the predicate, and the engine behaviour it licenses.
 *
 * The term's ungated form is not a candidate: +105 on FSE'26 with two regressed fault types, which
 * the engine's acceptance condition refuses. What makes it shippable is a predicate on the engine's
 * OWN rank-1 service — a duration-shaped dominant metric AND a raw inbound latency rise inside a
 * measured plateau — and this file is where that predicate's boundary, its refusals and the
 * ranking it changes are asserted.
 *
 * Two things this file deliberately does NOT do. It does not assert the constant's VALUE: the
 * number is a platea's midpoint and a reader who moves it inside the interval has not changed the
 * measurement, so the assertions are properties of the predicate (equality at the boundary, refusal
 * one epsilon below it, refusal of the wrong metric at any rise). And it does not check a text: every
 * engine assertion reads the objects `analyze` returned.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  admitsFailedEdgeTerm,
  FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR,
  FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

const DURATION = 'http.client.request.duration.max';
const RESOURCE = 'container_cpu_usage_seconds_total';

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function makeCallGraph(pairs: [string, string][]): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const [from, to] of pairs) {
    nodes.set(from, makeNode(from));
    nodes.set(to, makeNode(to));
  }
  return {
    nodes,
    edges: pairs.map(([from, to]) => ({
      from,
      to,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    })),
    systemLoad: 0.3,
  };
}

function makeTimeSeries(label: string, values: number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: new Float64Array(values),
    unit: 'count',
  };
}

describe('admitsFailedEdgeTerm — the predicate', () => {
  it('is a point strictly INSIDE the measured plateau, which is what makes the choice arbitrary', () => {
    // The corpus's criterion holds across the interval and the constant is its midpoint, so the
    // claim a reader must be able to check is positional rather than numeric: the floor is inside
    // the interval, and the interval has width. A floor ON a bound would be a boundary the corpus
    // never measured; a zero-width "interval" would be the point fit this replaced.
    const { lo, hi } = FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU;
    expect(hi).toBeGreaterThan(lo);
    expect(FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR).toBeGreaterThan(lo);
    expect(FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR).toBeLessThan(hi);
    // And the predicate agrees with the interval at its ends: the top of the plateau is admitted,
    // the bottom is not — otherwise "the floor sits inside" would be true of a floor the gate
    // never applies.
    expect(admitsFailedEdgeTerm(DURATION, hi)).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, lo)).toBe(false);
  });

  it('admits exactly AT the floor, and refuses one floating-point step below it', () => {
    // Equality is the boundary rule: the benchmark's `>=` was applied to a rise rendered from the
    // dump, and an exclusive comparison would move every case whose rise IS the floor out of the
    // arm without saying so.
    expect(admitsFailedEdgeTerm(DURATION, FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR)).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR - 1)).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR * (1 - 1e-12))).toBe(
      false,
    );
    expect(admitsFailedEdgeTerm(DURATION, FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR + 1)).toBe(true);
  });

  it('reads an ABSENT rise as 0, so a case with no latency evidence is refused', () => {
    // The only safe direction. A missing measurement is precisely the case where the gate's second
    // half cannot speak, and a default of "no data means admit" would hand the term every case the
    // corpus did not measure — which on a metrics-only suite is all of them.
    expect(admitsFailedEdgeTerm(DURATION, undefined)).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, 0)).toBe(false);
  });

  it('refuses a NaN rise rather than letting it fall through a comparison', () => {
    // `NaN >= 300` is false, so the naive form happens to agree — but for a reason the code does
    // not state. Reading NaN as 0 makes the refusal attributable to an absent measurement instead
    // of to an accident of IEEE comparison.
    expect(admitsFailedEdgeTerm(DURATION, Number.NaN)).toBe(false);
  });

  it('refuses the term on a resource metric WHATEVER the rise — the oracle mutation', () => {
    // This is the assertion the whole gate exists for, and the one a fence on the injected label
    // would satisfy while shipping an oracle: `JVMMemoryStress` and `HTTPRequestDelay` both carry
    // enormous rises on the cases the term is for. The separator is the metric's NAME, so a rise of
    // 999 on a CPU series must be refused — and so must any larger one.
    expect(admitsFailedEdgeTerm(RESOURCE, 999)).toBe(false);
    expect(admitsFailedEdgeTerm(RESOURCE, 1e9)).toBe(false);
    expect(admitsFailedEdgeTerm('jvm.system.cpu.load_1m', 400)).toBe(false);
  });

  it('admits `db.client.connections.use_time.max` by NAME and refuses it by MAGNITUDE', () => {
    // The one label that looks like a counter-example and is not, kept here because it is the
    // record's own account of why no name-based refinement could exist. `JVMMemoryStress`'s
    // dominant metrics include this series (`×18` of the type's cases) and it contains `time`, so
    // the name proxy admits it — exactly as it admits `http.server.request.duration` on
    // `HTTPRequestDelay` and `NetworkLoss`. What separates the harmful types is the 38× magnitude
    // gap: their rank-1 rise has a median of 9.0, and 9.0 is under every floor the corpus admits.
    expect(admitsFailedEdgeTerm('db.client.connections.use_time.max', 400)).toBe(true);
    expect(admitsFailedEdgeTerm('db.client.connections.use_time.max', 9.0)).toBe(false);
  });

  it('refuses an UNNAMED dominant metric, because an unnamed metric is not a duration one', () => {
    expect(admitsFailedEdgeTerm(undefined, 999)).toBe(false);
    expect(admitsFailedEdgeTerm('', 999)).toBe(false);
  });

  it('admits every series family the corpus’s duration proxy was measured over', () => {
    // The proxy's population, stated as behaviour rather than as a copy of the regex: these are the
    // labels the four alternatives exist for, and a tightening that dropped one of them would lose
    // cases the measurement covers (the benchmark measured `strict` — no `time` alternative — at
    // +77 with THREE regressed types, i.e. worse on both halves).
    for (const label of [
      'http.server.request.duration',
      'http.client.request.duration.max',
      'hubble_http_request_duration_p90_seconds',
      'rpc_server_latency_p99',
      'HTTP_RESPONSE_TIME',
    ]) {
      expect(admitsFailedEdgeTerm(label, FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR)).toBe(true);
    }
  });
});

describe('TreePruner — the gate decides the CASE, and the case is the engine’s own rank-1', () => {
  const GATEWAY = 'ts-gateway';
  const CALLER = 'ts-ui-dashboard';
  const CALLEE = 'ts-order-service';
  const failures = [{ caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 }];
  const inbound = [{ caller: GATEWAY, callee: CALLER, preMeanMs: 1, postMeanMs: 500 }];

  const caseOf = (rankOneLabel: string): [ServiceCallGraph, MetricMap] => [
    makeCallGraph([
      [GATEWAY, CALLER],
      [CALLER, CALLEE],
    ]),
    new Map<string, readonly TimeSeries[]>([
      [GATEWAY, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 2, 2, 2, 2])]],
      [CALLER, [makeTimeSeries(rankOneLabel, [1, 1, 1, 1, 4, 4, 4, 4])]],
      [CALLEE, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 3, 3, 3, 3])]],
    ]),
  ];

  const rank = (weight: number, rankOneLabel: string) => {
    const pruner = new TreePruner({ failedEdgeWeight: weight });
    const [callGraph, metrics] = caseOf(rankOneLabel);
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: inbound,
    });
    return { graph, results: pruner.analyze(graph, 3) };
  };

  it('names the failed-edge term WEIGHT_ZERO on every result when the gate refuses', () => {
    // The refusal has to be visible on the artifact, not only in the scores: a run whose option
    // said 3 and whose term contributed nothing would otherwise be indistinguishable from a run
    // that had no failures to charge.
    const { results } = rank(3, RESOURCE);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      const term = result.terms?.find((entry) => entry.name === 'failedEdge');
      expect(term).toBeDefined();
      expect(term!.contribution).toBe(0);
      expect(term!.cause).toBe('WEIGHT_ZERO');
    }
  });

  it('carries a LIVE failed-edge term when the gate admits', () => {
    const { results } = rank(3, DURATION);
    const callee = results.find((result) => result.serviceId === CALLEE);
    expect(callee).toBeDefined();
    const term = callee!.terms?.find((entry) => entry.name === 'failedEdge');
    // No cause: the absence of a cause IS the statement that the term was live.
    expect(term!.contribution).toBeCloseTo(3, 12);
    expect(term!.cause).toBeUndefined();
  });

  it('is inert at weight 0 whatever the observables say — the shipped default costs nothing', () => {
    // `DEFAULT_FAILED_EDGE_WEIGHT` is 0, so the gate must not be consulted at all on the shipped
    // path: a duration-dominant rank-1 with a 500× rise must produce exactly the ranking a case
    // with no observables produces.
    const admittedShaped = rank(0, DURATION).results;
    const refusedShaped = rank(0, RESOURCE).results;
    const scores = (results: typeof admittedShaped) =>
      results.map((result) => [result.serviceId, result.finalScore]);
    // The two cases differ in their metric LABEL, and the label is not a ranking input at weight
    // 0 — so the scores agree term for term.
    expect(scores(admittedShaped)).toEqual(scores(refusedShaped));
  });

  it('answers an empty ranking without consulting the gate when no service is anomalous', () => {
    // A case where every series is flat has NO candidates — `scoredNodes` keeps only nodes with a
    // self anomaly > 0 — so there is no rank-1 to be the gate's subject. The term must not invent
    // one, and the pass must not run.
    const flat: MetricMap = new Map<string, readonly TimeSeries[]>([
      [GATEWAY, [makeTimeSeries(DURATION, [1, 1, 1, 1, 1, 1, 1, 1])]],
      [CALLER, [makeTimeSeries(DURATION, [1, 1, 1, 1, 1, 1, 1, 1])]],
    ]);
    const pruner = new TreePruner({ failedEdgeWeight: 3 });
    const graph = pruner.buildFaultGraph(makeCallGraph([[GATEWAY, CALLER]]), flat, {
      failedTraceEdges: [{ caller: GATEWAY, callee: CALLER, failed: 5, baseline: 0 }],
    });
    expect(graph.failedEdgeScores?.size).toBe(1);
    expect(pruner.analyze(graph, 3)).toEqual([]);
  });

  it('refuses the term when the graph carries no raw latency map at all', () => {
    // The map is derived by `buildFaultGraph`, so a graph without it is one produced elsewhere —
    // the interface's optionality. The gate must fail CLOSED: a missing map means the magnitude
    // half measured nothing, not that it measured no rise.
    const built = rank(0, DURATION).graph;
    const stripped = { ...built, edgeLatencyByCallee: undefined };
    const pruner = new TreePruner({ failedEdgeWeight: 3 });
    const withMap = pruner.analyze(built, 3);
    const withoutMap = pruner.analyze(stripped, 3);

    for (const result of withoutMap) {
      expect(result.terms?.find((entry) => entry.name === 'failedEdge')!.contribution).toBe(0);
    }
    // The same graph WITH the map admits, and the callee's term is exactly the weight.
    const callee = withMap.find((result) => result.serviceId === CALLEE)!;
    expect(callee.terms?.find((entry) => entry.name === 'failedEdge')!.contribution).toBeCloseTo(
      3,
      12,
    );
    // And the consequence is visible in the answer, not only in the term.
    expect(withMap[0]!.serviceId).not.toBe(withoutMap[0]!.serviceId);
  });

  it('admits on a graph with no injection anchor, where the second pass reads 0 for it', () => {
    // The admitted pass is a SECOND ranking, and it must be able to run on the graphs the first one
    // ran on — including a case the engine had no anchor for. `injectTimeMs` is optional on the
    // interface, so the fallback is a branch of its own rather than a defensive habit.
    const built = rank(0, DURATION).graph;
    const unanchored = new TreePruner({ failedEdgeWeight: 3 }).analyze(
      { ...built, injectTimeMs: undefined },
      3,
    );
    expect(unanchored[0]!.serviceId).toBe(CALLEE);
  });
});
