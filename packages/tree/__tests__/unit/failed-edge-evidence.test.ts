/**
 * The failed-edge direction term's THIRD bar — the failed-call channel's own evidence, and not a metric name.
 *
 * The shipped predicate asks two questions of the engine's rank-1: is its dominant metric a duration series, and
 * did its inbound latency rise clear a bar. Both were fitted on FSE'26, where an injection adds hundreds of
 * milliseconds to a sub-millisecond baseline. On RCABench neither question is answerable: the dominant metrics are
 * `cpu_usage` and `memory`, so the NAME half refuses **1 030 of 1 422 cases (72.4%)** before the term can speak,
 * and the term therefore acts on one case in seven whatever its weight is.
 *
 * The third mode asks the question the name half was standing in for — *is this interface actually failing?* — of
 * the one channel that answers it directly: the failed calls themselves. `fraction = the strongest failing
 * callee's net failed calls / the calls that reached it after the injection`. It is a ratio of two counts on the
 * same edge set, so it carries no corpus's units and no corpus's latency scale, and it is computable on every cell
 * that carries a status column — including the four where `edgeLatency` is empty.
 *
 * The measurement that licenses it (`docs/failed-edge-gate.md`): on the 1 422 archive cases, the truth is the top
 * callee by net failed calls in **321 of the 814 misses (39.4%)**, and the fraction separates those from the cases
 * where promoting that callee would displace a correct answer.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FailedEdgeEvidence } from '@agentix-e/micro-kinetic-tree';
import {
  admitsFailedEdgeTerm,
  computeFailedEdgeLedger,
  computeFailedEdgeScores,
  FAILED_EDGE_GATE_MODES,
  isFailedEdgeGateMode,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────

const DURATION = 'http.server.request.duration';
const RESOURCE = 'container_cpu_usage_seconds_total';

function edge(caller: string, callee: string, failed: number, baseline: number) {
  return { caller, callee, failed, baseline };
}

function evidenceOf(
  edges: ReadonlyArray<{ caller: string; callee: string; failed: number; baseline: number }>,
  calls: ReadonlyMap<string, number> | undefined,
  nodes: readonly string[] = ['a', 'b', 'c'],
  minRecords?: number,
): FailedEdgeEvidence {
  return computeFailedEdgeLedger(edges, new Set(nodes), 'sum', minRecords, calls).evidence;
}

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function makeCallGraph(pairs: ReadonlyArray<readonly [string, string]>): ServiceCallGraph {
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

function makeTimeSeries(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: new Float64Array(values),
    unit: 'count',
  };
}

// ── The ledger: one walk, two views ───────────────────────

describe('computeFailedEdgeLedger', () => {
  it('returns the same scores the shipped function returns, so the two views cannot drift', () => {
    const edges = [
      edge('a', 'b', 10, 0),
      edge('a', 'c', 3, 1),
      edge('b', 'c', 7, 7),
      edge('c', 'c', 5, 0),
    ];
    const nodes = new Set(['a', 'b', 'c']);
    const ledger = computeFailedEdgeLedger(edges, nodes, 'sum', 1, new Map([['b', 10]]));

    expect([...ledger.scores.entries()]).toEqual([
      ...computeFailedEdgeScores(edges, nodes).entries(),
    ]);
  });

  it('takes the numerator from the NET rise, not from the raw count', () => {
    // `a → b` failed 100 times but was already failing 99 times before the injection; `a → c` failed 5 times from
    // a clean baseline. The term exists for the second edge: a permanently broken dependency is a deployment
    // property, and charging its volume to its callee would make a pre-existing defect look like this fault.
    const evidence = evidenceOf(
      [edge('a', 'b', 100, 99), edge('a', 'c', 5, 0)],
      new Map([
        ['b', 1000],
        ['c', 10],
      ]),
    );

    expect(evidence.topService).toBe('c');
    expect(evidence.topNet).toBe(5);
    expect(evidence.fraction).toBeCloseTo(5 / 10, 12);
    expect(evidence.netTotal).toBe(6);
    expect(evidence.callees).toBe(2);
  });

  it('divides by every call that reached the callee, including the ones that did not fail', () => {
    // The denominator is the interface's traffic, not the failing edge's traffic. A callee that fails on 5 of its
    // 10 calls from `a` and serves 90 healthy calls from `b` is failing at 5%, and a gate that read 50% would be
    // admitting the case on a number no operator would recognise.
    const evidence = evidenceOf(
      [edge('a', 'b', 5, 0), edge('b', 'c', 0, 0)],
      new Map([
        ['b', 10 + 90],
        ['c', 50],
      ]),
    );

    expect(evidence.topService).toBe('b');
    expect(evidence.fraction).toBeCloseTo(0.05, 12);
  });

  it('leaves the fraction UNDEFINED when no call count was produced, rather than reading it as zero', () => {
    // A producer that cannot count calls (the FSE'26 cache, which carries counts only for failures) must not make
    // the gate believe the interface failed at 0% — nor at 100%. The absence is its own answer, and the predicate
    // refuses it. `topNet` is still reported: the volume IS measured, only the divisor is missing.
    const evidence = evidenceOf([edge('a', 'b', 5, 0)], undefined);

    expect(evidence.topNet).toBe(5);
    expect(evidence.topCalls).toBe(0);
    expect(evidence.fraction).toBeUndefined();
  });

  it('applies the same filters that drop an edge from the scores', () => {
    const evidence = evidenceOf(
      [
        edge('a', 'b', 5, 0),
        // A self-call carries no direction.
        edge('a', 'a', 900, 0),
        // An endpoint outside the graph cannot be ranked, so its volume must not enter any normalisation.
        edge('a', 'zzz', 900, 0),
        edge('zzz', 'b', 900, 0),
        // A malformed count would make the difference NaN.
        edge('a', 'c', Number.NaN, 0),
        // An edge that did not rise above its own baseline is not evidence of this fault.
        edge('b', 'c', 4, 9),
      ],
      new Map([
        ['a', 10],
        ['b', 10],
        ['c', 10],
      ]),
    );

    expect(evidence.topService).toBe('b');
    expect(evidence.topNet).toBe(5);
    expect(evidence.netTotal).toBe(5);
    expect(evidence.callees).toBe(1);
  });

  it('drops a callee below the record floor from both views, not from one of them', () => {
    // One failed call is not a pattern: the floor exists to require repetition, and a callee it removes must also
    // leave the normalisation denominator — otherwise the survivors would be rescaled against evidence the signal
    // refused to use.
    const edges = [edge('a', 'b', 1, 0), edge('a', 'c', 40, 0), edge('b', 'c', 30, 0)];
    const nodes = new Set(['a', 'b', 'c']);
    const ledger = computeFailedEdgeLedger(
      edges,
      nodes,
      'sum',
      2,
      new Map([
        ['b', 1],
        ['c', 70],
      ]),
    );

    expect(ledger.scores.has('b')).toBe(false);
    expect(ledger.evidence.topService).toBe('c');
    expect(ledger.evidence.callees).toBe(1);
    expect(ledger.evidence.topNet).toBe(70);
    expect(ledger.evidence.fraction).toBeCloseTo(1, 12);
  });

  it('reports an empty channel as an empty channel', () => {
    const empty = evidenceOf([], new Map([['b', 100]]));
    expect(empty).toEqual({
      topService: undefined,
      topNet: 0,
      topCalls: 0,
      fraction: undefined,
      netTotal: 0,
      callees: 0,
    });
    // A callee that received failures but no calls is a contradiction the producer cannot make, and the ledger
    // must not turn it into an infinite fraction.
    const noCalls = evidenceOf([edge('a', 'b', 5, 0)], new Map([['b', 0]]));
    expect(noCalls.topService).toBe('b');
    expect(noCalls.fraction).toBeUndefined();
  });
});

// ── The predicate: the evidence bar refuses on evidence, never on a name ──

describe('admitsFailedEdgeTerm — the evidence bar', () => {
  const evidence = (fraction: number | undefined): FailedEdgeEvidence => ({
    topService: 'b',
    topNet: 10,
    topCalls: fraction === undefined ? 0 : 100,
    fraction,
    netTotal: 10,
    callees: 1,
  });

  it('is a member of the mode vocabulary, so a parser and a dispatch cannot disagree about the word', () => {
    expect(FAILED_EDGE_GATE_MODES.evidence).toBe(true);
    expect(isFailedEdgeGateMode('evidence')).toBe(true);
  });

  it('admits a RESOURCE-dominant case, which is exactly the population the name half refuses', () => {
    // The whole point of the mode: `<cpu_usage>` is a metric name the shipped predicate rejects at ANY rise, and
    // the same case is admitted here on 10 failed calls out of 100.
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0.1,
        evidence: evidence(0.1),
      }),
    ).toBe(true);
    expect(
      admitsFailedEdgeTerm(RESOURCE, 0, { mode: 'evidence', share: 0.1, evidence: evidence(0.5) }),
    ).toBe(true);
  });

  it('reads neither the dominant metric nor the latency rise, so a case with no latency at all can be admitted', () => {
    // On the four cells whose `edgeLatency` is empty the shipped gate's second half has no value to judge; this
    // mode must not inherit that refusal, or it would be inert on exactly the corpus it was built for.
    expect(
      admitsFailedEdgeTerm(undefined, undefined, {
        mode: 'evidence',
        share: 0.1,
        evidence: evidence(0.2),
      }),
    ).toBe(true);
    expect(
      admitsFailedEdgeTerm(DURATION, 1e9, {
        mode: 'evidence',
        share: 0.1,
        evidence: evidence(0.05),
      }),
    ).toBe(false);
  });

  it('holds the bar at its own boundary, to the last bit', () => {
    const below = 0.1 * (1 - 1e-12);
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0.1,
        evidence: evidence(0.1),
      }),
    ).toBe(true);
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0.1,
        evidence: evidence(below),
      }),
    ).toBe(false);
  });

  it('fails CLOSED on every shape of missing evidence', () => {
    expect(admitsFailedEdgeTerm(RESOURCE, undefined, { mode: 'evidence', share: 0 })).toBe(false);
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0,
        evidence: evidence(undefined),
      }),
    ).toBe(false);
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0,
        evidence: evidence(Number.NaN),
      }),
    ).toBe(false);
    expect(
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share: 0,
        evidence: evidence(Number.POSITIVE_INFINITY),
      }),
    ).toBe(false);
  });

  it('reads a malformed share as the strictest bar and a negative one as the loosest', () => {
    // A share outside the unit interval is not a share. `0` is legal and means "any measured failure"; a value the
    // arithmetic cannot place is read as `1`, because defaulting the other way would let a typo admit the term on
    // every case with a single failed call.
    const at = (share: number, fraction: number) =>
      admitsFailedEdgeTerm(RESOURCE, undefined, {
        mode: 'evidence',
        share,
        evidence: evidence(fraction),
      });

    expect(at(0, 0.0001)).toBe(true);
    expect(at(-3, 0.0001)).toBe(true);
    expect(at(1, 0.9999)).toBe(false);
    expect(at(1, 1)).toBe(true);
    expect(at(Number.NaN, 0.999)).toBe(false);
    expect(at(Number.NaN, 1)).toBe(true);
  });

  it('reads an ABSENT share as the strictest bar, not as the one that admits everything', () => {
    // The same reading the malformed share gets, and for the same reason: at `evidence` the number is the
    // caller's own parameter, so a gate that names the mode and no number has not stated how much failure it
    // wants. A bar of 0 would admit every case whose interface failed once, which is the widest possible
    // reading of the least information.
    const bare = (fraction: number) =>
      admitsFailedEdgeTerm(RESOURCE, undefined, { mode: 'evidence', evidence: evidence(fraction) });
    expect(bare(1)).toBe(true);
    expect(bare(0.999)).toBe(false);
    expect(bare(0)).toBe(false);
  });

  it('leaves the two latency bars untouched, so the shipped predicate is unchanged', () => {
    // The evidence object is INERT at the other two modes — the property that makes it safe to carry on every
    // graph, and the reason the shipped cells cannot move.
    const gate = { mode: 'absolute' as const, share: 0, evidence: evidence(1) };
    expect(admitsFailedEdgeTerm(RESOURCE, 1e9, gate)).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, 0, gate)).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, 300, gate)).toBe(true);
  });
});

// ── The engine: the mode selects the bar, and the bar changes the answer ──

describe('TreePruner — an evidence bar is a bar the golden corpus can read', () => {
  const GATEWAY = 'ts-gateway';
  const CALLER = 'ts-ui-dashboard';
  const CALLEE = 'ts-order-service';
  const failures = [{ caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 }];

  const caseOf = (): [ServiceCallGraph, MetricMap] => [
    makeCallGraph([
      [GATEWAY, CALLER],
      [CALLER, CALLEE],
    ]),
    new Map<string, readonly TimeSeries[]>([
      [GATEWAY, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 2, 2, 2, 2])]],
      [CALLER, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 4, 4, 4, 4])]],
      [CALLEE, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 3, 3, 3, 3])]],
    ]),
  ];

  const termOf = (
    options: ConstructorParameters<typeof TreePruner>[0],
    calls: ReadonlyMap<string, number> | undefined,
    latency: ReadonlyArray<{
      caller: string;
      callee: string;
      preMeanMs: number;
      postMeanMs: number;
    }> = [],
  ) => {
    const pruner = new TreePruner(options);
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: latency,
      failedEdgeCalls: calls,
    });
    return pruner
      .analyze(graph, 3)
      .find((r) => r.serviceId === CALLEE)
      ?.terms?.find((e) => e.name === 'failedEdge');
  };

  it('is WEIGHT_ZERO on this case at every latency bar — the refusal the archive is 72.4% made of', () => {
    for (const mode of ['absolute', 'fleet'] as const) {
      const term = termOf(
        { failedEdgeWeight: 3, failedEdgeGateMode: mode, failedEdgeGateShare: 0 },
        undefined,
      );
      expect(term!.cause).toBe('WEIGHT_ZERO');
      expect(term!.contribution).toBe(0);
    }
  });

  it('is LIVE on the same case at an evidence bar, with no latency input at all', () => {
    const term = termOf(
      { failedEdgeWeight: 3, failedEdgeGateMode: 'evidence', failedEdgeGateShare: 0.1 },
      new Map([[CALLEE, 100]]),
    );
    expect(term!.cause).toBeUndefined();
    expect(term!.contribution).toBeCloseTo(3, 12);
  });

  it('refuses the same case when the interface served too much traffic to call it failing', () => {
    // Ten failures out of ten thousand calls is 0.1%, not a broken interface — and the bar has to be able to say
    // so on a case whose every other observable is identical.
    const term = termOf(
      { failedEdgeWeight: 3, failedEdgeGateMode: 'evidence', failedEdgeGateShare: 0.1 },
      new Map([[CALLEE, 10_000]]),
    );
    expect(term!.cause).toBe('WEIGHT_ZERO');
  });

  it("refuses when the producer counted no calls, which is the FSE'26 cache and any future one", () => {
    const term = termOf(
      { failedEdgeWeight: 3, failedEdgeGateMode: 'evidence', failedEdgeGateShare: 0 },
      undefined,
    );
    expect(term!.cause).toBe('WEIGHT_ZERO');
  });
});
