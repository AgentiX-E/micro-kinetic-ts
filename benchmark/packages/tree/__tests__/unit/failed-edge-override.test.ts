/**
 * A service whose own failures point at another charged service cannot OVERRIDE the ranking.
 *
 * The direction term does not cast a vote, it overrides one: the score is `aggregate / max(aggregate)`, so the
 * winner is `1.0` by construction and its contribution is the term's whole weight (3.000 against a median
 * `selfAnomalyLog1p` of 0.617). That is the structural asymmetry iteration 235 measured, and it is why every
 * attempt to weaken the term proportionally cost more than it bought.
 *
 * What the 26 cases the evidence gate breaks have in common is narrower than any of those attempts assumed: the
 * promoted service has a net failed-call edge INTO another service the channel also charges. So the same channel
 * states "this one is the source" and "that one is the source" along one call boundary, and picking the end with
 * more accumulated failures is a statement about traffic rather than about the fault.
 *
 * `return-path` therefore removes the charge of any credited callee that has its own net rise against another
 * credited callee, before normalisation, so the survivors are rescaled and the term goes on to the next candidate.
 * Measured on the 221 cases the evidence arm moves, through the engine's own `countDirectionalInputs` join: it
 * fires on 12 of the 26 breaks and on none of the 195 fixes.
 *
 * Each case below is a decision about what "contradicted" means rather than an exercise of a branch:
 *
 * 1. `override` is the shipped behaviour and may not move a published cell.
 * 2. The rule reads the SAME rows the scores are built from — baseline subtraction, self-edges, out-of-graph
 *    endpoints and the record floor are all applied first, so a row the engine never counted cannot contradict.
 * 3. Only a CREDITED callee can be contradicted: a service below the record floor is not a candidate, and letting
 *    it remove one would be the floor deciding a question it was never asked.
 * 4. Removal happens before normalisation, so the survivors are rescaled. That is the difference between "the term
 *    stays silent" and "the term speaks about the next candidate", and it is why this can repair a case.
 * 5. The mutual-pair rule runs FIRST. A pair that fails in both directions was already removed as ambiguous, and
 *    letting it contradict a third service would make the two rules interact in an order nobody declared.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FailedEdgeOverrideRule } from '@agentix-e/micro-kinetic-tree';
import {
  computeFailedEdgeLedger,
  computeFailedEdgeScores,
  DEFAULT_FAILED_EDGE_OVERRIDE_RULE,
  FAILED_EDGE_OVERRIDE_RULES,
  isFailedEdgeOverrideRule,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────

function edge(caller: string, callee: string, failed: number, baseline = 0) {
  return { caller, callee, failed, baseline };
}

const NODES = new Set(['a', 'b', 'c', 'd', 'e']);

function ledger(
  edges: ReadonlyArray<{ caller: string; callee: string; failed: number; baseline: number }>,
  rule?: FailedEdgeOverrideRule,
  minRecords = 1,
  calls?: ReadonlyMap<string, number>,
) {
  return computeFailedEdgeLedger(
    edges,
    NODES,
    'sum',
    minRecords,
    calls,
    'constant',
    'credit',
    rule,
  );
}

// Three charges, arranged so that the two ends of each failing edge are BOTH credited: `a` is charged by `d`,
// `b` is charged by `a`, and `c` is charged by `b`. Under the shipped rule the loudest charge wins; under
// `return-path` both `a` and `b` are contradicted by their own outgoing edge and only `c` survives.
const CHAIN = [edge('a', 'b', 5), edge('b', 'c', 3), edge('d', 'a', 1)];

// ── The vocabulary ────────────────────────────────────────

describe('the override-rule vocabulary', () => {
  it('names exactly two rules, and the shipped one overrides', () => {
    expect([...FAILED_EDGE_OVERRIDE_RULES]).toEqual(['override', 'return-path']);
    expect(DEFAULT_FAILED_EDGE_OVERRIDE_RULE).toBe('override');
  });

  it('recognises its own members and refuses anything else', () => {
    for (const rule of FAILED_EDGE_OVERRIDE_RULES) {
      expect(isFailedEdgeOverrideRule(rule)).toBe(true);
    }
    for (const absent of [undefined, null, '', 'Override', 'return_path', 'path', 0]) {
      expect(isFailedEdgeOverrideRule(absent)).toBe(false);
    }
  });
});

// ── Backwards compatibility ───────────────────────────────

describe('the shipped rule is the shipped behaviour', () => {
  it('reproduces computeFailedEdgeScores digit for digit, contradicted callees included', () => {
    for (const rule of [undefined, 'override' as const]) {
      expect([...ledger(CHAIN, rule).scores]).toEqual([...computeFailedEdgeScores(CHAIN, NODES)]);
    }
  });

  it('still credits a contradicted callee when the rule is not asked for', () => {
    // A guard on the fixture itself: if `b` were not credited here, the `return-path` cases below would pass for
    // the wrong reason.
    expect(ledger(CHAIN, 'override').scores.get('b')).toBe(1);
  });

  it('reads an explicitly undefined rule as the shipped one', () => {
    expect([...ledger(CHAIN, undefined).scores]).toEqual([...ledger(CHAIN, 'override').scores]);
  });
});

// ── What is contradicted ─────────────────────────────────

describe('a callee contradicted by its own outgoing failures', () => {
  it('loses its charge, and the service its failures point at keeps the override', () => {
    const scores = ledger(CHAIN, 'return-path').scores;
    expect(scores.has('b')).toBe(false);
    expect(scores.has('a')).toBe(false);
    expect(scores.get('c')).toBe(1);
  });

  it('leaves a one-way chain into a leaf alone — the common case', () => {
    // `a → b` only. `a` is not charged by anything, so nothing contradicts `b`, and the term keeps its answer.
    const scores = ledger([edge('a', 'b', 5)], 'return-path').scores;
    expect([...scores]).toEqual([['b', 1]]);
  });

  it('rescales the survivors, so the new winner is saturated rather than dented', () => {
    // The removal is before normalisation: `c` was 3/5 = 0.6 against a max of 5, and is 1.0 once the two
    // contradicted charges are gone. A rule that only zeroed the winner would leave `c` at 0.6 and could lose to
    // a service the rule never looked at.
    const scores = ledger(CHAIN, 'return-path').scores;
    expect(scores.get('c')).toBe(1);
    expect(ledger(CHAIN, 'override').scores.get('c')).toBeCloseTo(0.6, 12);
  });

  it('keeps the charges that POINT at a contradicted callee', () => {
    // `b` is contradicted, but `a → b` is still a real failure of a real call. The rule removes the callee that
    // cannot support the override, not the evidence about it.
    const scores = ledger(CHAIN, 'return-path').scores;
    expect(scores.has('b')).toBe(false);
    expect(scores.get('c')).toBe(1);
  });

  it('returns an empty channel when every credited callee is contradicted', () => {
    // `a → b` and `b → a` are mutual (dropped first under `credit` they are kept, and both are contradicted), so
    // with nothing left the channel must be empty rather than name a service it cannot support.
    const only = [edge('a', 'b', 5), edge('b', 'a', 4)];
    const result = ledger(only, 'return-path');
    expect(result.scores.size).toBe(0);
    expect(result.evidence.topService).toBeUndefined();
    expect(result.evidence.fraction).toBeUndefined();
  });
});

// ── What is NOT contradicted ─────────────────────────────

describe('rows the signal never counted cannot contradict', () => {
  it('ignores a rise the pre-injection baseline explains', () => {
    // `b → c` fails 3 times after the injection and 3 times before it: no net rise, so `c` is not charged and `b`
    // has nothing to be contradicted by.
    const edges = [edge('a', 'b', 5), edge('b', 'c', 3, 3)];
    const scores = ledger(edges, 'return-path').scores;
    expect(scores.get('b')).toBe(1);
    expect(scores.has('c')).toBe(false);
  });

  it('ignores a self-call', () => {
    // A client span inside its own service carries no direction, which is why the ledger drops it. If the rule
    // read the raw edges instead of the counted ones it would contradict `b` on its own self-traffic.
    const edges = [edge('a', 'b', 5), edge('b', 'b', 9)];
    expect([...ledger(edges, 'return-path').scores]).toEqual([['b', 1]]);
  });

  it('ignores an endpoint outside the rankable graph', () => {
    const edges = [edge('a', 'b', 5), edge('b', 'z', 9)];
    expect([...ledger(edges, 'return-path').scores]).toEqual([['b', 1]]);
  });

  it('ignores a callee below the record floor, which is not a candidate at all', () => {
    // `b` has two contributing edges and clears the floor; `c` has one and does not. `c`'s charge is real, but it
    // is not a credit the term could spend, so it cannot be the thing that removes `b`.
    const edges = [edge('a', 'b', 5), edge('e', 'b', 5), edge('b', 'c', 3)];
    const scores = ledger(edges, 'return-path', 2).scores;
    expect(scores.get('b')).toBe(1);
    expect(scores.has('c')).toBe(false);
  });

  it('ignores a pair the mutual rule already removed', () => {
    // `a ⇄ b` is mutual, so under `drop` both charges are gone before the return-path test. `b → c` then has a
    // caller that is no longer credited, and `c` is not contradicted by a service the channel already refused.
    const edges = [edge('a', 'b', 5), edge('b', 'a', 4), edge('b', 'c', 3)];
    const result = computeFailedEdgeLedger(
      edges,
      NODES,
      'sum',
      1,
      undefined,
      'constant',
      'drop',
      'return-path',
    );
    expect(result.scores.get('c')).toBe(1);
    expect(result.scores.has('a')).toBe(false);
    expect(result.scores.has('b')).toBe(false);
  });
});

// ── The evidence follows the surviving channel ────────────

describe('the evidence is the channel the GATE saw, not the one the rule left', () => {
  // The rule removes a callee's charge, and removing a large charge RAISES the share of the survivors — so an
  // evidence report taken after the rule would let it turn the gate's silence into speech. That is not a
  // hypothetical: on the RE3 arm it happened on 105 cases, 9 of which displaced a correct answer.
  it('is identical under both rules, case for case', () => {
    const calls = new Map([
      ['b', 10],
      ['c', 6],
      ['a', 2],
    ]);
    expect(ledger(CHAIN, 'return-path', 1, calls).evidence).toEqual(
      ledger(CHAIN, 'override', 1, calls).evidence,
    );
  });

  it('names the loudest charge of the channel the gate scored', () => {
    const calls = new Map([
      ['b', 10],
      ['c', 6],
      ['a', 2],
    ]);
    const result = ledger(CHAIN, 'return-path', 1, calls);
    // `b` is the callee the rule refuses, and it is also the one the GATE reads — which is the point: the gate
    // asked whether this case's failed calls are enough to speak, and its answer cannot depend on what the rule
    // later decided about the speakers.
    expect(result.evidence.topService).toBe('b');
    expect(result.evidence.topNet).toBe(5);
    expect(result.evidence.topCalls).toBe(10);
    expect(result.evidence.netTotal).toBe(9);
    expect(result.evidence.callees).toBe(3);
    expect(result.evidence.fraction).toBeCloseTo(0.5, 12);
  });

  it('reports no fraction when the gate-winning callee has no counted calls', () => {
    const result = ledger(CHAIN, 'return-path');
    expect(result.evidence.topService).toBe('b');
    expect(result.evidence.fraction).toBeUndefined();
  });

  it('still reports an empty channel when the rule removed every callee', () => {
    const only = [edge('a', 'b', 5), edge('b', 'a', 4)];
    const result = ledger(only, 'return-path');
    expect(result.evidence.topService).toBeUndefined();
    expect(result.evidence.netTotal).toBe(0);
    expect(result.evidence.callees).toBe(0);
  });
});

// ── Engine level ─────────────────────────────────────────

describe('TreePruner — the rule decides whether the term may override at all', () => {
  const GATEWAY = 'ts-gateway';
  const CALLER = 'ts-ui-dashboard';
  const MUTED = 'ts-travel-service';
  const SOURCE = 'ts-basic-service';

  function makeNode(id: string): ServiceNode {
    return { id, name: id, namespace: 'default', labels: {} };
  }

  function makeTimeSeries(label: string, values: readonly number[]): TimeSeries {
    return {
      label,
      timestamps: values.map((_, i) => i * 60_000),
      values: new Float64Array(values),
      unit: 'count',
    };
  }

  const caseOf = (): [ServiceCallGraph, MetricMap] => {
    const nodes = new Map<string, ServiceNode>(
      [GATEWAY, CALLER, MUTED, SOURCE].map((id) => [id, makeNode(id)]),
    );
    const link = (from: string, to: string) => ({
      from,
      to,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    });
    return [
      {
        nodes,
        edges: [
          link(GATEWAY, CALLER),
          link(GATEWAY, MUTED),
          link(CALLER, MUTED),
          link(MUTED, SOURCE),
        ],
        systemLoad: 0.3,
      },
      new Map<string, readonly TimeSeries[]>([
        [GATEWAY, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 1, 1, 1, 1])]],
        [CALLER, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
        [MUTED, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
        [SOURCE, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
      ]),
    ];
  };

  // The gateway charges the caller, the caller charges MUTED, MUTED charges SOURCE. All three are callees of a
  // failing edge, so all three clear the floor — and the two ends of each of the first two edges are BOTH credited.
  const failures = [
    { caller: GATEWAY, callee: CALLER, failed: 8, baseline: 0 },
    { caller: CALLER, callee: MUTED, failed: 20, baseline: 0 },
    { caller: MUTED, callee: SOURCE, failed: 3, baseline: 0 },
  ];

  const CALLS = new Map([
    [CALLER, 20],
    [MUTED, 40],
    [SOURCE, 3],
  ]);

  function winner(rule: FailedEdgeOverrideRule | undefined): string | undefined {
    const pruner = new TreePruner({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'evidence',
      failedEdgeGateShare: 0.001,
      failedEdgeOverrideRule: rule,
    });
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: [],
      failedEdgeCalls: CALLS,
    });
    return pruner.analyze(graph, 4)[0]?.serviceId;
  }

  it('names the loudest callee when the override is unconditional', () => {
    expect(winner('override')).toBe(MUTED);
  });

  it('names the service at the end of the failing path when the override needs support', () => {
    // CALLER and MUTED are both contradicted by their own outgoing failure, so the only credited callee left is
    // SOURCE — the service the chain actually ends at.
    expect(winner('return-path')).toBe(SOURCE);
  });

  it('reads an explicitly undefined rule as the shipped one', () => {
    expect(winner(undefined)).toBe(MUTED);
  });
});
