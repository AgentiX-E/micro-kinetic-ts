/**
 * The direction term's CREDIT — how much of its weight the evidence is allowed to buy.
 *
 * The gate decides WHETHER the term may speak (§`failed-edge-evidence.test.ts`). This file is about the size of
 * what it says, and it exists because the two were conflated:
 *
 *   score(callee) = net(callee) / max(net)   →   the winner is 1.0 BY CONSTRUCTION
 *
 * so the term's contribution on every case it fires is exactly its weight — 3.000 — against a `selfAnomalyLog1p`
 * contribution whose median is 0.617. A callee failing 10% of its calls and a callee failing 100% of them are
 * credited identically, and no other term can outvote either. Measured consequence (iteration 234): 26 breaks, all
 * of them cases the baseline had already answered, all at full weight.
 *
 * The evidence the gate reads is a RATE — `net / calls` — and it was being consumed as a boolean. Multiplying the
 * normalised score by that rate keeps the ordering (`sum`/`mean` still decide who is first) and adds the magnitude
 * the ordering threw away, with no new constant: the multiplier is the same measured quantity, over the same
 * filters, from the same walk.
 *
 * Everything below is written before the implementation, because each case is a decision about what the number
 * MEANS rather than an exercise of the code path:
 *
 * 1. `constant` must reproduce the shipped scores exactly — the mode ships default and may not move a published
 *    cell, and a test that only asserted "it is a Map" would not notice if it did.
 * 2. `proportional` must NOT renormalise. A single callee receiving one failed call out of a thousand must score
 *    0.001, not 1.0; renormalising would restore exactly the saturation the change exists to remove.
 * 3. A callee with no counted calls is credited ZERO rather than given a default: an absent divisor is an absent
 *    measurement, and crediting it would let a producer that counts nothing keep the full force the change is
 *    calibrated against.
 * 4. The rate is the callee's own traffic, so a callee with 50 failures over 1 000 calls outranks one with 20 over
 *    20 — the ordering by rate and the ordering by count are allowed to disagree, and this is the case that says
 *    which one the multiplier expresses.
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FailedEdgeCredit } from '@agentix-e/micro-kinetic-tree';
import {
  computeFailedEdgeLedger,
  computeFailedEdgeScores,
  DEFAULT_FAILED_EDGE_CREDIT,
  FAILED_EDGE_CREDITS,
  isFailedEdgeCredit,
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
  calls: ReadonlyMap<string, number> | undefined,
  credit?: FailedEdgeCredit,
): Map<string, number> {
  return computeFailedEdgeLedger(edges, NODES, 'sum', 1, calls, credit).scores;
}

// ── The vocabulary ────────────────────────────────────────

describe('the credit vocabulary', () => {
  it('names exactly two credits, and the shipped one is the constant', () => {
    expect([...FAILED_EDGE_CREDITS]).toEqual(['constant', 'proportional']);
    expect(DEFAULT_FAILED_EDGE_CREDIT).toBe('constant');
  });

  it('recognises its own members and refuses anything else', () => {
    for (const credit of FAILED_EDGE_CREDITS) {
      expect(isFailedEdgeCredit(credit)).toBe(true);
    }
    for (const absent of [undefined, null, '', 'Constant', 'rate', 0]) {
      expect(isFailedEdgeCredit(absent)).toBe(false);
    }
  });
});

// ── Backwards compatibility ───────────────────────────────

describe('the constant credit is the shipped behaviour', () => {
  it('reproduces computeFailedEdgeScores digit for digit, with and without calls', () => {
    const edges = [edge('a', 'b', 10, 0), edge('a', 'c', 4, 0), edge('a', 'd', 1, 0)];
    const calls = new Map([
      ['b', 100],
      ['c', 10],
      ['d', 1000],
    ]);
    for (const credit of [undefined, 'constant' as const]) {
      const ledger = computeFailedEdgeLedger(edges, NODES, 'sum', 1, calls, credit).scores;
      expect([...ledger]).toEqual([...computeFailedEdgeScores(edges, NODES, 'sum', 1)]);
    }
  });

  it('still saturates the top callee at 1.0 — the property the other credit removes', () => {
    const out = scores([edge('a', 'b', 1, 0)], new Map([['b', 1000]]), 'constant');
    expect(out.get('b')).toBe(1);
  });
});

// ── The proportional credit ───────────────────────────────

describe('the proportional credit multiplies by the channel’s own rate', () => {
  it('scales each callee by its own failures over its own traffic', () => {
    // b: 10 failures over 100 calls → 0.10 ; c: 4 over 10 → 0.40 ; d: 1 over 1000 → 0.001
    const edges = [edge('a', 'b', 10, 0), edge('a', 'c', 4, 0), edge('a', 'd', 1, 0)];
    const calls = new Map([
      ['b', 100],
      ['c', 10],
      ['d', 1000],
    ]);
    const out = scores(edges, calls, 'proportional');
    // max(net) = 10, so the normalised standing is 1, 0.4, 0.1 — then the rate.
    expect(out.get('b')).toBeCloseTo(1 * 0.1, 12);
    expect(out.get('c')).toBeCloseTo(0.4 * 0.4, 12);
    expect(out.get('d')).toBeCloseTo(0.1 * 0.001, 12);
  });

  it('does not renormalise: one failure out of a thousand is a thousandth, not a whole', () => {
    const out = scores([edge('a', 'b', 1, 0)], new Map([['b', 1000]]), 'proportional');
    expect(out.get('b')).toBeCloseTo(0.001, 12);
  });

  it('credits a callee with no counted calls zero rather than a default', () => {
    const edges = [edge('a', 'b', 5, 0), edge('a', 'c', 5, 0)];
    const out = scores(edges, new Map([['b', 100]]), 'proportional');
    expect(out.get('b')).toBeCloseTo(0.05, 12);
    expect(out.get('c')).toBe(0);
  });

  it('credits every callee zero when the producer counted nothing at all', () => {
    const out = scores([edge('a', 'b', 5, 0)], undefined, 'proportional');
    expect(out.get('b')).toBe(0);
  });

  it('orders by rate where the count orders the other way, and keeps both numbers reachable', () => {
    // e has the larger COUNT, b the larger RATE.
    const edges = [edge('a', 'b', 20, 0), edge('a', 'c', 50, 0)];
    const calls = new Map([
      ['b', 20],
      ['c', 1000],
    ]);
    const constant = scores(edges, calls, 'constant');
    const proportional = scores(edges, calls, 'proportional');
    expect(constant.get('b')!).toBeLessThan(constant.get('c')!);
    expect(proportional.get('b')!).toBeGreaterThan(proportional.get('c')!);
    expect(proportional.get('b')).toBeCloseTo(0.4, 12);
    expect(proportional.get('c')).toBeCloseTo(0.05, 12);
  });

  it('subtracts the baseline before it divides, so a pre-existing failure earns nothing', () => {
    // 30 failures, 30 of them already there before the injection → net 0 → no entry at all.
    const out = scores([edge('a', 'b', 30, 30)], new Map([['b', 100]]), 'proportional');
    expect(out.has('b')).toBe(false);
  });

  it('applies the same filters as the constant credit: self-edges, unknown endpoints, the record floor', () => {
    const edges = [
      edge('b', 'b', 9, 0), // self-edge
      edge('x', 'b', 9, 0), // caller outside the graph
      edge('a', 'y', 9, 0), // callee outside the graph
      edge('a', 'b', 2, 0),
    ];
    const calls = new Map([
      ['b', 10],
      ['y', 10],
    ]);
    const out = scores(edges, calls, 'proportional');
    expect([...out.keys()]).toEqual(['b']);
    expect(out.get('b')).toBeCloseTo(0.2, 12);
  });

  it('leaves the evidence untouched: the credit changes the score, not the measurement', () => {
    const edges = [edge('a', 'b', 10, 0), edge('a', 'c', 4, 0)];
    const calls = new Map([
      ['b', 100],
      ['c', 10],
    ]);
    const constant = computeFailedEdgeLedger(edges, NODES, 'sum', 1, calls, 'constant');
    const proportional = computeFailedEdgeLedger(edges, NODES, 'sum', 1, calls, 'proportional');
    expect(proportional.evidence).toEqual(constant.evidence);
    expect(proportional.evidence.topService).toBe('b');
    expect(proportional.evidence.fraction).toBeCloseTo(0.1, 12);
  });
});

// ── The engine: the credit decides who wins, not only by how much ──

describe('TreePruner — a proportional credit lets the rate decide', () => {
  const GATEWAY = 'ts-gateway';
  const CALLER = 'ts-ui-dashboard';
  const NOISY = 'ts-order-service';
  const BROKEN = 'ts-seat-service';

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
      [GATEWAY, CALLER, NOISY, BROKEN].map((id) => [id, makeNode(id)]),
    );
    return [
      {
        nodes,
        edges: [
          {
            from: GATEWAY,
            to: CALLER,
            type: 'REST' as const,
            callRate: 100,
            p99Latency: 50,
            errorRate: 0.01,
          },
          {
            from: CALLER,
            to: NOISY,
            type: 'REST' as const,
            callRate: 100,
            p99Latency: 50,
            errorRate: 0.01,
          },
          {
            from: CALLER,
            to: BROKEN,
            type: 'REST' as const,
            callRate: 100,
            p99Latency: 50,
            errorRate: 0.01,
          },
        ],
        systemLoad: 0.3,
      },
      new Map<string, readonly TimeSeries[]>([
        [GATEWAY, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
        [CALLER, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 1, 1, 1, 1])]],
        // Both callees must carry a self-anomaly of their own, or the pruner's tree never reaches them and the
        // credit has nothing to decide. The signal under test is the DIRECTION term, so the metric rise is only
        // what puts the candidate in play.
        [NOISY, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 2, 2, 2, 2])]],
        [BROKEN, [makeTimeSeries('container_cpu_usage_seconds_total', [1, 1, 1, 1, 3, 3, 3, 3])]],
      ]),
    ];
  };

  // The channel sees ten times more failures at NOISY, but NOISY serves a thousand times the traffic:
  // NOISY 100 / 10 000 = 1%, BROKEN 10 / 10 = 100%.
  const failures = [
    { caller: CALLER, callee: NOISY, failed: 100, baseline: 0 },
    { caller: CALLER, callee: BROKEN, failed: 10, baseline: 0 },
  ];
  const calls = new Map([
    [NOISY, 10_000],
    [BROKEN, 10],
  ]);

  const contributions = (credit: FailedEdgeCredit) => {
    const pruner = new TreePruner({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'evidence',
      failedEdgeGateShare: 0.001,
      failedEdgeCredit: credit,
    });
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: [],
      failedEdgeCalls: calls,
    });
    const results = pruner.analyze(graph, 4);
    const termOf = (id: string) =>
      results.find((r) => r.serviceId === id)?.terms?.find((e) => e.name === 'failedEdge')
        ?.contribution ?? 0;
    return { noisy: termOf(NOISY), broken: termOf(BROKEN) };
  };

  it('reads an explicitly undefined credit as the shipped one', () => {
    // The merge `{...DEFAULT_TREE_PRUNER_OPTIONS, ...options}` keeps a key that a caller passes as an explicit
    // `undefined`, so the engine's fallback is reachable rather than decorative — and what it falls back TO is a
    // decision: an unset credit must behave as `constant`, or a caller that spread a partial object would
    // silently run an unmeasured configuration.
    const pruner = new TreePruner({
      failedEdgeWeight: 3,
      failedEdgeGateMode: 'evidence',
      failedEdgeGateShare: 0.001,
      failedEdgeCredit: undefined,
    });
    const [callGraph, metrics] = caseOf();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: failures,
      edgeLatency: [],
      failedEdgeCalls: calls,
    });
    const results = pruner.analyze(graph, 4);
    const noisy = results
      .find((r) => r.serviceId === NOISY)
      ?.terms?.find((e) => e.name === 'failedEdge')?.contribution;
    expect(noisy).toBeCloseTo(3, 12);
  });

  it('gives the loudest callee the full weight under the shipped credit', () => {
    const out = contributions('constant');
    expect(out.noisy).toBeCloseTo(3, 12);
    expect(out.broken).toBeCloseTo(0.3, 12);
  });

  it('gives the same case to the failing interface under the proportional credit', () => {
    // NOISY: standing 1.0 × rate 0.01 = 0.01 → 0.03. BROKEN: standing 0.1 × rate 1.0 = 0.1 → 0.30.
    const out = contributions('proportional');
    expect(out.noisy).toBeCloseTo(0.03, 12);
    expect(out.broken).toBeCloseTo(0.3, 12);
  });
});
