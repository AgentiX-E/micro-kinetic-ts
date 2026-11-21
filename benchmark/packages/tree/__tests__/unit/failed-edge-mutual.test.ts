/**
 * A pair of services that fail each other's calls is not evidence about DIRECTION.
 *
 * The direction term charges every failed call to its callee, so `a → b` failing says "b". When `b → a` fails as
 * well, the same two services produce both statements, and no count can rank one above the other: whichever end
 * accumulated more traffic wins. That is not a hypothesis about the fault, it is a hypothesis about the graph's
 * weights, and iteration 236 measured exactly this signature on the 26 cases the evidence gate breaks — the
 * promoted callee is an ancestor of the truth, and the edge between them failed in both directions.
 *
 * The rule this file pins down is deliberately the narrowest one that removes that ambiguity and nothing else:
 * drop BOTH charges of a mutually failing pair, so neither end is credited with a direction it cannot support,
 * and let the term speak about the next candidate instead. It is `credit` by default, which must reproduce the
 * shipped map digit for digit.
 *
 * Every case below is a decision about what "mutual" means rather than an exercise of a branch:
 *
 * 1. `credit` is the shipped behaviour and may not move a published cell.
 * 2. `drop` removes both directions, not only the weaker one — a rule that kept the larger would be a tie-break,
 *    and a tie-break is the thing the measurement says cannot be justified.
 * 3. A pair where only one direction carries a net rise is NOT mutual: the pre-injection baseline, a self-edge, an
 *    endpoint outside the graph and the record floor are all applied BEFORE the rule, so a filtered row cannot
 *    silently mute the surviving direction.
 * 4. The drop happens before normalisation, so the surviving candidates are rescaled against what remains. This is
 *    the difference between "the term stays silent" and "the term speaks about the next candidate", and it is why
 *    the rule can repair a case rather than merely refuse it.
 * 5. The evidence is read from the same walk, so a census cannot report a channel the scores do not use.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FailedEdgeMutualRule } from '@agentix-e/micro-kinetic-tree';
import {
  computeFailedEdgeLedger,
  computeFailedEdgeScores,
  DEFAULT_FAILED_EDGE_MUTUAL_RULE,
  FAILED_EDGE_MUTUAL_RULES,
  isFailedEdgeMutualRule,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Fixtures ──────────────────────────────────────────────

function edge(caller: string, callee: string, failed: number, baseline: number) {
  return { caller, callee, failed, baseline };
}

const NODES = new Set(['a', 'b', 'c', 'd']);

function scores(
  edges: ReadonlyArray<{ caller: string; callee: string; failed: number; baseline: number }>,
  rule?: FailedEdgeMutualRule,
): Map<string, number> {
  return computeFailedEdgeLedger(edges, NODES, 'sum', 1, undefined, 'constant', rule).scores;
}

// ── The vocabulary ────────────────────────────────────────

describe('the mutual-pair vocabulary', () => {
  it('names exactly two rules, and the shipped one credits the pair', () => {
    expect([...FAILED_EDGE_MUTUAL_RULES]).toEqual(['credit', 'drop']);
    expect(DEFAULT_FAILED_EDGE_MUTUAL_RULE).toBe('credit');
  });

  it('recognises its own members and refuses anything else', () => {
    for (const rule of FAILED_EDGE_MUTUAL_RULES) {
      expect(isFailedEdgeMutualRule(rule)).toBe(true);
    }
    for (const absent of [undefined, null, '', 'Credit', 'mutual', 0]) {
      expect(isFailedEdgeMutualRule(absent)).toBe(false);
    }
  });
});

// ── Backwards compatibility ───────────────────────────────

describe('the shipped rule is the shipped behaviour', () => {
  it('reproduces computeFailedEdgeScores digit for digit, mutual pairs included', () => {
    const edges = [
      edge('a', 'b', 9, 0),
      edge('b', 'a', 4, 0),
      edge('a', 'c', 2, 0),
      edge('c', 'd', 1, 0),
    ];
    for (const rule of [undefined, 'credit' as const]) {
      expect([...scores(edges, rule)]).toEqual([
        ...computeFailedEdgeScores(edges, NODES, 'sum', 1),
      ]);
    }
  });

  it('still credits both ends of a mutual pair under the shipped rule', () => {
    const out = scores([edge('a', 'b', 9, 0), edge('b', 'a', 4, 0)]);
    expect([...out.keys()]).toEqual(['b', 'a']);
  });
});

// ── The drop rule ─────────────────────────────────────────

describe('the drop rule removes both charges of a mutually failing pair', () => {
  it('credits neither end, and leaves the rest of the map intact', () => {
    const out = scores([edge('a', 'b', 9, 0), edge('b', 'a', 4, 0), edge('a', 'c', 2, 0)], 'drop');
    expect(out.has('a')).toBe(false);
    expect(out.has('b')).toBe(false);
    expect(out.get('c')).toBe(1);
  });

  it('removes both directions even when one of them is much smaller', () => {
    // The asymmetry is exactly the case a tie-break would "solve" by keeping the larger; the rule refuses to
    // rank what the data cannot rank.
    const out = scores([edge('a', 'b', 500, 0), edge('b', 'a', 1, 0)], 'drop');
    expect(out.size).toBe(0);
  });

  it('does not touch a one-way pair — the common case', () => {
    const out = scores([edge('a', 'b', 5, 0), edge('c', 'd', 3, 0)], 'drop');
    expect([...out]).toEqual([
      ['b', 1],
      ['d', 3 / 5],
    ]);
  });

  it('renormalises what survives, so the term still speaks about the next candidate', () => {
    // Without the rule b is the champion at 1.0 and c follows at 0.2. With it, c is the champion — the rule
    // rescues a case rather than refusing it, which is the difference between this and a gate.
    const edges = [edge('a', 'b', 10, 0), edge('b', 'a', 6, 0), edge('a', 'c', 2, 0)];
    expect(scores(edges, 'credit').get('c')).toBeCloseTo(0.2, 12);
    expect(scores(edges, 'drop').get('c')).toBe(1);
  });
});

// ── What counts as mutual ─────────────────────────────────

describe('"mutual" is read after every filter the signal already applies', () => {
  it('is not mutual when the reverse edge carries no NET rise after its baseline', () => {
    // b → a failed 7 times after injection and 7 before: nothing about THIS fault, so it is not a statement
    // against a, and a's charge from a → b stands.
    const out = scores([edge('a', 'b', 9, 0), edge('b', 'a', 7, 7)], 'drop');
    expect(out.get('b')).toBe(1);
    expect(out.has('a')).toBe(false);
  });

  it('is not mutual when the reverse edge has an endpoint outside the rankable graph', () => {
    // `x` has no metrics, so the engine cannot rank it and the row is dropped before the rule — a caller the
    // engine never saw must not mute a charge it did count.
    const edges = [edge('a', 'b', 9, 0), edge('b', 'x', 9, 0)];
    expect([...scores(edges, 'drop').keys()]).toEqual(['b']);
  });

  it('is not mutual when one direction is a self-edge', () => {
    const edges = [edge('a', 'b', 9, 0), edge('b', 'b', 9, 0)];
    expect([...scores(edges, 'drop').keys()]).toEqual(['b']);
  });

  it('ignores malformed counts in the reverse direction', () => {
    const edges = [
      edge('a', 'b', 9, 0),
      { caller: 'b', callee: 'a', failed: Number.NaN, baseline: 0 },
    ];
    expect([...scores(edges, 'drop').keys()]).toEqual(['b']);
  });
});

// ── The ledger's other views ──────────────────────────────

describe('the evidence is read from the surviving channel', () => {
  it('reports the champion, the net and the fraction after the drop', () => {
    const edges = [edge('a', 'b', 10, 0), edge('b', 'a', 6, 0), edge('a', 'c', 2, 0)];
    const calls = new Map([['c', 40]]);
    const ledger = computeFailedEdgeLedger(edges, NODES, 'sum', 1, calls, 'constant', 'drop');
    expect(ledger.evidence.topService).toBe('c');
    expect(ledger.evidence.topNet).toBe(2);
    expect(ledger.evidence.netTotal).toBe(2);
    expect(ledger.evidence.callees).toBe(1);
    expect(ledger.evidence.fraction).toBeCloseTo(0.05, 12);
  });

  it('leaves the record floor counting EDGES, not pairs', () => {
    // Two rows between the same pair are one pair and two records. The floor is a statement about evidence
    // volume, so it keeps counting rows — the rule changes who is credited, never how much was seen.
    const edges = [edge('a', 'b', 4, 0), edge('a', 'b', 5, 0)];
    const ledger = computeFailedEdgeLedger(edges, NODES, 'sum', 2, undefined, 'constant', 'drop');
    expect(ledger.scores.get('b')).toBe(1);
  });

  it('drops a callee that the record floor would have credited when its only row is mutual', () => {
    const edges = [edge('a', 'b', 4, 0), edge('b', 'a', 1, 0)];
    const ledger = computeFailedEdgeLedger(edges, NODES, 'sum', 1, undefined, 'constant', 'drop');
    expect(ledger.scores.size).toBe(0);
    expect(ledger.evidence.topService).toBeUndefined();
    expect(ledger.evidence.fraction).toBeUndefined();
  });
});

// ── The engine ────────────────────────────────────────────

describe('TreePruner — the rule decides which service the direction term can name', () => {
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
        // The service the channel promotes under the shipped rule: loud, because everything calls it.
        [MUTED, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
        [SOURCE, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
      ]),
    ];
  };

  // The failing edges form one mutual pair (CALLER ⇄ MUTED) plus the edge that leaves it (MUTED → SOURCE).
  const failures = [
    { caller: CALLER, callee: MUTED, failed: 20, baseline: 0 },
    { caller: MUTED, callee: CALLER, failed: 8, baseline: 0 },
    { caller: MUTED, callee: SOURCE, failed: 2, baseline: 0 },
  ];

  // The gate reads the channel's own rate, so the fixture has to carry counted calls: without them `fraction` is
  // undefined by design and the term is refused, which would make both arms answer the baseline and the test
  // would pass for the wrong reason.
  const CALLS = new Map([
    [MUTED, 20],
    [SOURCE, 2],
  ]);

  function winner(rule: FailedEdgeMutualRule): string | undefined {
    const pruner = new TreePruner({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'evidence',
      failedEdgeGateShare: 0.001,
      failedEdgeMutualRule: rule,
    });
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: [],
      failedEdgeCalls: CALLS,
    });
    return pruner.analyze(graph, 4)[0]?.serviceId;
  }

  it('names the loudest callee when the pair is credited', () => {
    expect(winner('credit')).toBe(MUTED);
  });

  it('names the service the surviving charge points at when the pair is dropped', () => {
    // MUTED loses its whole charge (both of its rows are part of the pair's ambiguity, and the row it reports
    // against CALLER is dropped with the pair), so the only surviving callee is SOURCE.
    expect(winner('drop')).toBe(SOURCE);
  });

  it('reads an explicitly undefined rule as the shipped one', () => {
    const pruner = new TreePruner({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'evidence',
      failedEdgeGateShare: 0.001,
      failedEdgeMutualRule: undefined,
    });
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: [],
      failedEdgeCalls: CALLS,
    });
    expect(pruner.analyze(graph, 4)[0]?.serviceId).toBe(MUTED);
  });
});
