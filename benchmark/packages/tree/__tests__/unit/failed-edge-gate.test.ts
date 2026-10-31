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
import type {
  FailedEdgeGate,
  FailedEdgeGateMode,
  TreePrunerOptions,
} from '@agentix-e/micro-kinetic-tree';
import {
  admitsFailedEdgeTerm,
  DEFAULT_FAILED_EDGE_GATE_MODE,
  DEFAULT_FAILED_EDGE_GATE_SHARE,
  DEFAULT_LAT_MIN_RISE,
  FAILED_EDGE_GATE_MODES,
  FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR,
  FAILED_EDGE_RANK_ONE_LAT_RISE_PLATEAU,
  isFailedEdgeGateMode,
  maxInboundRise,
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

  it('admits at a fleet bar what a 300-constant refuses, on the same case and the same rise', () => {
    // THE ENGINE-LEVEL FENCE for the bar, and the shape the golden corpus's four span-bearing cells have: a
    // duration-dominant rank-1 whose rise is 5 — refused by the constant, admitted by a bar that is a share of the
    // case's own champion. `share: 1` and champion 5, so the bar IS the rise and the comparison is the boundary.
    const withRise = (options: Partial<TreePrunerOptions>) => {
      const pruner = new TreePruner(options);
      const [callGraph, metrics] = caseOf(DURATION);
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        failedTraceEdges: failures,
        edgeLatency: [{ caller: GATEWAY, callee: CALLER, preMeanMs: 1, postMeanMs: 5 }],
      });
      return pruner.analyze(graph, 3);
    };
    const termOf = (results: ReturnType<typeof withRise>, id: string) =>
      results.find((r) => r.serviceId === id)?.terms?.find((e) => e.name === 'failedEdge');

    const refused = withRise({ failedEdgeWeight: 3 });
    const admitted = withRise({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'fleet',
      failedEdgeGateShare: 1,
    });

    // Same case, same rank-1, same observable: the only difference is the bar.
    expect(termOf(refused, CALLEE)!.cause).toBe('WEIGHT_ZERO');
    expect(termOf(admitted, CALLEE)!.contribution).toBeCloseTo(3, 12);
    expect(termOf(admitted, CALLEE)!.cause).toBeUndefined();
  });

  it('reads neither the share nor the champion at `absolute`, so the shipped path is byte-identical', () => {
    // The option being INERT is the property that makes the default safe, and it is asserted on the ranking rather
    // than argued from the source: two shares that would be markedly different bars must produce the same results,
    // bit for bit, at the shipped mode.
    const scored = (options: Partial<TreePrunerOptions>) => {
      const pruner = new TreePruner(options);
      const [callGraph, metrics] = caseOf(DURATION);
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        failedTraceEdges: failures,
        edgeLatency: inbound,
      });
      return pruner.analyze(graph, 3).map((r) => [r.serviceId, r.finalScore, r.rank]);
    };
    const shares = [0, 0.5, 1, 1e6].map((share) =>
      scored({ failedEdgeWeight: 3, failedEdgeGateShare: share }),
    );

    for (const one of shares) expect(one).toEqual(shares[0]);
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

  it('derives the shipped ranking from the defaults whether they are NAMED, omitted or spelled out as undefined', () => {
    // The defaults table exists so that no caller holds a second opinion about what the engine ships, and the
    // engine is the FIRST caller: its own two `??` fallbacks must land exactly where the exported constants
    // point. Asserted on the ranking rather than on the table, because a fallback moved to a different number
    // leaves both constants intact and changes every answer.
    //
    // The THIRD arm is why the fallbacks exist at all. An object spread copies a key whose value is `undefined`
    // (`{ ...defaults, ...{ failedEdgeGateMode: undefined } }` has the key, with no value), so a caller that
    // forwards an optional field it did not receive — a parser building the options object, which is exactly
    // what `rcaeval-cli` does — would otherwise erase the default rather than leave it alone.
    const scored = (options: Partial<TreePrunerOptions>) => {
      const pruner = new TreePruner(options);
      const [callGraph, metrics] = caseOf(DURATION);
      const graph = pruner.buildFaultGraph(callGraph, metrics, {
        failedTraceEdges: failures,
        edgeLatency: inbound,
      });
      return pruner.analyze(graph, 3).map((r) => [r.serviceId, r.finalScore, r.rank]);
    };
    const omitted = scored({ failedEdgeWeight: 3 });
    const named = scored({
      failedEdgeWeight: 3,
      failedEdgeGateMode: DEFAULT_FAILED_EDGE_GATE_MODE,
      failedEdgeGateShare: DEFAULT_FAILED_EDGE_GATE_SHARE,
    });
    const explicitUndefined = scored({
      failedEdgeWeight: 3,
      failedEdgeGateMode: undefined,
      failedEdgeGateShare: undefined,
    });

    expect(named).toEqual(omitted);
    expect(explicitUndefined).toEqual(omitted);
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

/**
 * The gate's BAR — an absolute number measured on one corpus, and the form that survives a second one.
 *
 * Iteration 168. `FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR = 300` is a rise measured on FSE'26, whose injections
 * are hundreds of milliseconds against sub-millisecond baselines. The golden corpus's latencies are SECONDS
 * (0.04 → 0.05), so its rank-1 rises live between 1.2 and 8 — three orders of magnitude below the bar — and
 * the term with the largest weight in the formula reads `WEIGHT_ZERO` on 734 of 735 cases. The published
 * artifact says so in two places that were never read together: `latency-routes` reports 1080 and 6781
 * latency rows on the two RE2 cells whose traces carry them, and `[term-gap]` reports `failedEdge
 * WEIGHT_ZERO 100.0%`.
 *
 * So the bar has two forms, and this block asserts the properties that make the second one a mechanism
 * rather than a tuned number:
 *
 * 1. **Identity at the default.** `absolute` (and an absent gate) is the shipped predicate, bit for bit,
 *    with the share unread — so no run that does not name the other mode can move.
 * 2. **Fleet-relative, not an invented floor.** `fleet` reads `share × the case's own largest measured
 *    inbound rise`, the construction `anomalyBreadthGate` and `dualFamilyGate` already use: the same
 *    statement about a 14-service graph and a 69-service one.
 * 3. **It fails closed.** A case with no measured rise, or a fleet whose champion is not positive and
 *    finite, has no bar — and an absent measurement must never admit a term.
 * 4. **It can only narrow as the share grows**, so a swept share is a monotone family rather than nine
 *    unrelated predicates.
 */
describe('the gate bar — absolute versus fleet-relative', () => {
  it('names exactly two modes, and the shipped one is the absolute bar', () => {
    expect(Object.keys(FAILED_EDGE_GATE_MODES).sort()).toEqual(['absolute', 'fleet']);
    expect(DEFAULT_FAILED_EDGE_GATE_MODE).toBe('absolute');
    for (const mode of Object.keys(FAILED_EDGE_GATE_MODES)) {
      expect(isFailedEdgeGateMode(mode)).toBe(true);
    }
    for (const other of ['', 'FLEET', 'fleet ', 'absolute ', 'relative', 'sum']) {
      expect(isFailedEdgeGateMode(other)).toBe(false);
    }
  });

  it('is the shipped predicate at the default, and the share is UNREAD there', () => {
    // An absent gate and an explicit `absolute` are one declaration of one configuration. If they
    // could disagree, a caller that omitted the field would be running a different engine from the
    // one the default table names — the defect this repository has published a number 24.2 pp off
    // the best-measured value for.
    for (const rise of [0, 1, 9, 299.999, 300, 300.001, 1e6]) {
      const bare = admitsFailedEdgeTerm(DURATION, rise);
      expect(admitsFailedEdgeTerm(DURATION, rise, undefined)).toBe(bare);
      expect(admitsFailedEdgeTerm(DURATION, rise, { mode: 'absolute', share: 0 })).toBe(bare);
      expect(admitsFailedEdgeTerm(DURATION, rise, { mode: 'absolute', share: 0.9 })).toBe(bare);
      expect(admitsFailedEdgeTerm(DURATION, rise, { mode: 'absolute', share: 1 })).toBe(bare);
    }
  });

  it('reads the bar as a SHARE of the case champion in fleet mode, at equality', () => {
    const fleet = (fleetMax: number, share: number): FailedEdgeGate => ({
      mode: 'fleet',
      share,
      fleetMax,
    });
    // 0.5 x 8 = 4: the boundary is admitted, one epsilon below it is not, and the epsilon is the
    // smallest representable step rather than a tolerance this test invented.
    expect(admitsFailedEdgeTerm(DURATION, 4, fleet(8, 0.5))).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, 4 * (1 - 1e-12), fleet(8, 0.5))).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, 6, fleet(8, 0.5))).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, 3.9, fleet(8, 0.5))).toBe(false);
    // The same rise changes verdict with the fleet, which is the whole point: the bar is relative.
    expect(admitsFailedEdgeTerm(DURATION, 4, fleet(4, 0.5))).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, 4, fleet(40, 0.5))).toBe(false);
  });

  it('fails CLOSED when the fleet has no champion or no measurement', () => {
    // A missing measurement is not a measured zero, and neither is a champion of 0 — which is what an
    // empty map would produce if the maximum were taken without a guard.
    for (const fleetMax of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const gate: FailedEdgeGate = { mode: 'fleet', share: 0, fleetMax };
      expect(admitsFailedEdgeTerm(DURATION, 1e9, gate)).toBe(false);
    }
    // And the rise half still has to exist: a case with no inbound measurement is refused at every share,
    // including the degenerate one that admits every measured rise.
    for (const share of [0, 0.5, 1]) {
      expect(admitsFailedEdgeTerm(DURATION, undefined, { mode: 'fleet', share, fleetMax: 8 })).toBe(
        false,
      );
      expect(
        admitsFailedEdgeTerm(DURATION, Number.NaN, { mode: 'fleet', share, fleetMax: 8 }),
      ).toBe(false);
    }
  });

  it('is the unrestricted measured form at share 0 and the champion alone at share 1', () => {
    // The two ends make the family's meaning checkable without a corpus: share 0 admits every case the
    // OBSERVABLE can speak about, share 1 admits only the service the case's own champion names.
    expect(admitsFailedEdgeTerm(DURATION, 0.001, { mode: 'fleet', share: 0, fleetMax: 8 })).toBe(
      true,
    );
    expect(admitsFailedEdgeTerm(DURATION, 8, { mode: 'fleet', share: 1, fleetMax: 8 })).toBe(true);
    expect(admitsFailedEdgeTerm(DURATION, 7.999, { mode: 'fleet', share: 1, fleetMax: 8 })).toBe(
      false,
    );
  });

  it('reads a share it cannot use at the END of the interval rather than at a torn bar', () => {
    // Both wrong answers here are silent and both look like a narrow gate: a NaN bar makes every comparison
    // false, and an infinity bar refuses everything too — so a caller passing `NaN` would be told the case has
    // no rise when it has one. The defined reading is the end that asserts nothing new: the champion alone.
    for (const share of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(admitsFailedEdgeTerm(DURATION, 8, { mode: 'fleet', share, fleetMax: 8 })).toBe(true);
      expect(admitsFailedEdgeTerm(DURATION, 7.999, { mode: 'fleet', share, fleetMax: 8 })).toBe(
        false,
      );
    }
    // A NEGATIVE share would compute a bar below zero and admit a case the observable never measured, so it is
    // clamped to the opposite end — every measured rise.
    expect(admitsFailedEdgeTerm(DURATION, 0.001, { mode: 'fleet', share: -3, fleetMax: 8 })).toBe(
      true,
    );
  });

  it('narrows monotonically as the share grows', () => {
    const rises = [1, 1.5, 2, 3, 5, 8];
    const fleetMax = Math.max(...rises);
    const admittedAt = (share: number): number =>
      rises.filter((rise) =>
        admitsFailedEdgeTerm(DURATION, rise, { mode: 'fleet', share, fleetMax }),
      ).length;
    let previous = Number.POSITIVE_INFINITY;
    for (const share of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
      const count = admittedAt(share);
      expect(count).toBeLessThanOrEqual(previous);
      previous = count;
    }
    expect(admittedAt(0)).toBe(rises.length);
    expect(admittedAt(1)).toBe(1);
  });

  it('keeps the DURATION test in force in both modes, including at share 0', () => {
    // The name half closes one residue and the magnitude half another; a share of 0 relaxes the second,
    // never the first. A resource-dominant rank-1 refuses at every share and every rise.
    for (const mode of Object.keys(FAILED_EDGE_GATE_MODES) as FailedEdgeGateMode[]) {
      for (const share of [0, 0.5, 1]) {
        expect(admitsFailedEdgeTerm(RESOURCE, 1e6, { mode, share, fleetMax: 8 })).toBe(false);
        expect(admitsFailedEdgeTerm(undefined, 1e6, { mode, share, fleetMax: 8 })).toBe(false);
      }
    }
  });

  it('refuses a golden-corpus rise under the absolute bar and admits it fleet-relatively', () => {
    // THE FENCE. The magnitudes are the golden half's own, and they are stated for what they ARE: the metric
    // series behind `latWeight` gives case maxima of 1.01 (min), 7.68 (median), 121.01 (p90) and 482.5 (max)
    // over RE1-OnlineBoutique's 125 cases, i.e. a distribution whose body sits one to two orders below the
    // constant and whose tail crosses it. The per-EDGE map this gate reads is a different observable — and it is
    // EMPTY on that cell (0 latency rows over 125 cases, measured), so no golden case is admitted at any bar
    // there. That is the point of the fence: the two bars differ only in their bar, and on a case whose champion
    // is 7.99 the absolute one refuses what the fleet one admits — while on a case with no map at all both
    // refuse, which is what makes "the corpus cannot reach 300" a smaller claim than it looks.
    const goldenFleetMax = 7.99;
    for (const rise of [1.2, 1.81, 3.31, 4.17, 7.99]) {
      expect(admitsFailedEdgeTerm(DURATION, rise, { mode: 'absolute', share: 0.5 })).toBe(false);
    }
    expect(
      admitsFailedEdgeTerm(DURATION, goldenFleetMax, {
        mode: 'fleet',
        share: 0.5,
        fleetMax: goldenFleetMax,
      }),
    ).toBe(true);
    // And the corpus's LATENCY TERM, which reads the same per-edge ratio, credits rises from 10.3 up — an
    // internal statement that 300 is not this engine's scale for the quantity: two thresholds on one statistic,
    // fitted on two corpora, disagreeing by a factor of 29. It is the only part of the argument that does not
    // depend on which of the two observables a reader has in mind.
    expect(DEFAULT_LAT_MIN_RISE).toBeLessThan(FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR / 10);
  });
});

describe('maxInboundRise — the case champion the fleet bar is a share of', () => {
  it('is the largest POSITIVE finite rise over the measured callees', () => {
    const map = new Map([
      ['a', { rise: 1.5, count: 2 }],
      ['b', { rise: 7.99, count: 1 }],
      ['c', { rise: 0.4, count: 3 }],
    ]);
    expect(maxInboundRise(map)).toBe(7.99);
  });

  it('is absent when nothing measurable was recorded, which is what makes the bar fail closed', () => {
    expect(maxInboundRise(undefined)).toBeUndefined();
    expect(maxInboundRise(new Map())).toBeUndefined();
    expect(
      maxInboundRise(
        new Map([
          ['a', { rise: 0, count: 1 }],
          ['b', { rise: Number.NaN, count: 1 }],
          ['c', { rise: -2, count: 1 }],
        ]),
      ),
    ).toBeUndefined();
  });

  it('ignores a non-positive or non-finite entry rather than letting it become the maximum', () => {
    const map = new Map([
      ['a', { rise: Number.NaN, count: 1 }],
      ['b', { rise: 3, count: 1 }],
      ['c', { rise: Number.POSITIVE_INFINITY, count: 1 }],
    ]);
    // `Math.max` would answer NaN and Infinity respectively; both are bars no rise can be read against.
    expect(maxInboundRise(map)).toBe(3);
  });
});
