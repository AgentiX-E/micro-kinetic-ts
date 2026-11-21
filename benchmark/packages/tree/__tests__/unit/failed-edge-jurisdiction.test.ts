/**
 * The failed-edge partition, measured on the ENGINE rather than on the helper.
 *
 * `failed-edge-order.test.ts` states the rule; this file states that the pruner actually applies it, and that it
 * applies it to the whole order rather than to the reported window. Both are failures the helper's own tests
 * cannot see: an option that is parsed and never read, and a partition applied after truncation (which would only
 * ever permute the five rows a caller asked for).
 *
 * The fixture is deliberately small and its anomaly order is deliberate: the caller has the LARGEST deviation and
 * the callee of the failed call has the second, so the partition has to invert a pair the score got right in the
 * only sense a score can be right — a case where the credited node is already first proves nothing.
 *
 * @module __tests__/unit/failed-edge-jurisdiction
 */

import type {
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { DEFAULT_FAILED_EDGE_FIRST, TreePruner } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

const RESOURCE = 'container_cpu_usage_seconds_total';
const GATEWAY = 'ts-gateway';
const CALLER = 'ts-ui-dashboard';
const CALLEE = 'ts-order-service';
/** A node with the largest deviation in the case and NO failed inbound call — the node the partition must pass. */
const BYSTANDER = 'ts-search-service';

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

/** The ranking the fixture produces, as ids, at the width asked for. */
function rank(
  options: ConstructorParameters<typeof TreePruner>[0],
  width = 3,
  failures: ReadonlyArray<{ caller: string; callee: string; failed: number; baseline: number }> = [
    { caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 },
  ],
): string[] {
  const pruner = new TreePruner(options);
  const [callGraph, metrics] = fixture();
  const graph = pruner.buildFaultGraph(callGraph, metrics, { failedTraceEdges: failures });
  return pruner.analyze(graph, width).map((result) => result.serviceId);
}

/**
 * Four nodes, and the deviations are chosen so that the SCORE prefers a node with no failed inbound call:
 * `ts-search-service` rises `1 → 8`, the caller `1 → 4`, the credited callee `1 → 2`. A partition that merely
 * confirmed the score order would pass a fixture whose credited node was already first, and the first version of
 * this file was exactly that fixture — the baseline answered `ts-order-service` before the switch was read, so the
 * test could not tell the pass from the term's own gate.
 */
function fixture(): [ServiceCallGraph, MetricMap] {
  return [
    makeCallGraph([
      [GATEWAY, CALLER],
      [CALLER, CALLEE],
      [CALLER, BYSTANDER],
    ]),
    new Map<string, readonly TimeSeries[]>([
      [GATEWAY, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1])]],
      [CALLER, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 4, 4, 4, 4])]],
      [CALLEE, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 2, 2, 2, 2])]],
      [BYSTANDER, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 8, 8, 8, 8])]],
    ]),
  ];
}

/**
 * A RELAY and a SOURCE on one path: `gateway → relay → source`, with failures on both edges.
 *
 * The relay has the largest deviation in the case and a failure on each side of it — the shape a stress or a kill
 * downstream produces at the entry point. The source has only an inbound failure, which is the shape a genuine
 * fault at a leaf produces. The two readings of the partition have to disagree about which one leads, because a
 * reading that cannot tell them apart is the reading that measured −170.
 */
function relayFixture(): [ServiceCallGraph, MetricMap] {
  return [
    makeCallGraph([
      [GATEWAY, CALLER],
      [CALLER, CALLEE],
    ]),
    new Map<string, readonly TimeSeries[]>([
      [GATEWAY, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1])]],
      [CALLER, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 8, 8, 8, 8])]],
      [CALLEE, [makeTimeSeries(RESOURCE, [1, 1, 1, 1, 2, 2, 2, 2])]],
    ]),
  ];
}

const BOTH_EDGES_FAILED = [
  { caller: GATEWAY, callee: CALLER, failed: 10, baseline: 0 },
  { caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 },
];

/** The ranking the relay fixture produces under a given configuration. */
function rankRelay(options: ConstructorParameters<typeof TreePruner>[0]): string[] {
  const pruner = new TreePruner(options);
  const [callGraph, metrics] = relayFixture();
  const graph = pruner.buildFaultGraph(callGraph, metrics, { failedTraceEdges: BOTH_EDGES_FAILED });
  return pruner.analyze(graph, 3).map((result) => result.serviceId);
}

describe('the residual reading separates a source from a relay', () => {
  it('puts the RELAY first under the credited reading — the failure this arm was measured on', () => {
    expect(rankRelay({ failedEdgeFirst: true })[0]).toBe(CALLER);
  });

  it('puts the SOURCE first under the residual reading', () => {
    // `CALLER` reports a failure inbound AND outbound, so its residual is zero: it is the conduit, not the cause.
    // `CALLEE` receives one and emits none, so its residual is the whole rise.
    expect(rankRelay({ failedEdgeFirst: true, failedEdgeFirstScope: 'unexplained' })[0]).toBe(
      CALLEE,
    );
  });

  it('demotes the relay without deleting it', () => {
    const order = rankRelay({ failedEdgeFirst: true, failedEdgeFirstScope: 'unexplained' });
    expect(order).toHaveLength(3);
    expect(order).toEqual([CALLEE, CALLER, GATEWAY]);
  });

  it('is inert when the switch is off, whatever the scope says', () => {
    expect(rankRelay({ failedEdgeFirstScope: 'unexplained' })).toEqual(rankRelay({}));
  });
});

describe('the switch is a switch, and it ships off', () => {
  it('ships off, and off is the score order', () => {
    expect(DEFAULT_FAILED_EDGE_FIRST).toBe(false);
    // The bystander's deviation is the largest in the case, so the score answers with it — and it is exactly the
    // node the partition has to demote.
    expect(rank({}, 4)[0]).toBe(BYSTANDER);
  });

  it('leaves the ranking untouched when the option is absent rather than false', () => {
    expect(rank({})).toEqual(rank({ failedEdgeFirst: false }));
  });

  it('puts the credited callee first when it is on', () => {
    expect(rank({ failedEdgeFirst: true }, 4)[0]).toBe(CALLEE);
  });

  it('keeps the score order INSIDE each half', () => {
    const off = rank({}, 4);
    const on = rank({ failedEdgeFirst: true }, 4);
    expect(on).toEqual([CALLEE, ...off.filter((id) => id !== CALLEE)]);
  });

  it('lifts the credited node from beyond the reported window', () => {
    // The property the whole arm rests on: the partition is applied to the FULL order, not to the first `k`. At
    // width 2 the credited node is still reached, which a post-truncation partition could not do — it would only
    // have permuted the two rows the caller asked for.
    expect(rank({ failedEdgeFirst: true }, 2)[0]).toBe(CALLEE);
  });

  it('changes nothing when the case carries no failed calls', () => {
    // An inert case must cost nothing, and the array the caller gets must be the one the score produced.
    expect(rank({ failedEdgeFirst: true }, 4, [])).toEqual(rank({}, 4, []));
  });

  it('deletes nothing — the answer keeps every candidate it had', () => {
    // The difference between this rule and a filter, stated as a property: the set of candidates is the same
    // before and after, only their order differs.
    const off = [...rank({}, 4)].sort();
    const on = [...rank({ failedEdgeFirst: true }, 4)].sort();
    expect(on).toEqual(off);
    expect(on).toHaveLength(4);
  });

  it('renumbers the ranks so the answer is a ranking rather than a permutation', () => {
    const pruner = new TreePruner({ failedEdgeFirst: true });
    const [callGraph, metrics] = fixture();
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      failedTraceEdges: [{ caller: CALLER, callee: CALLEE, failed: 10, baseline: 0 }],
    });
    const results = pruner.analyze(graph, 3);
    expect(results.map((result) => result.rank)).toEqual([1, 2, 3]);
    expect(results[0]!.serviceId).toBe(CALLEE);
  });
});
