/**
 * The candidate pool is a DECISION, and this is where it is measured as one.
 *
 * `performTreeRCA` has always admitted a node to the ranking only when its post-deduction self-anomaly is
 * positive, which makes "the pool" `{v : selfScore(v) > 0}` rather than the graph's node set. The two sets
 * coincide on almost every case, and they differ exactly where the topological deduction ran: a node whose
 * anomaly a callee accounts for in full reads 0 and is therefore **absent**, not last (see
 * `docs/topo-discount-scope.md` §7.4). Twelve of the 94 misses in the published arm are a truth of that shape —
 * `truthInGraph: true`, `truthRank: null` — so the set the ranking covers is a live axis and not a detail.
 *
 * `poolAdmission` names it as one: `positive` is the shipped behaviour and every published number was measured
 * under it, `graph` admits every node the engine was handed. The tests below pin three properties that make the
 * arm readable when it is dispatched: the shipped value is bit-identical (nothing moves unless it is asked to),
 * the admitted node really appears, and it appears with a score of its own rather than at the top.
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_POOL_ADMISSION,
  isPoolAdmission,
  POOL_ADMISSIONS,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

function makeCallGraph(nodeIds: string[], edgePairs: Array<[string, string]>): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of nodeIds) nodes.set(id, makeNode(id));
  return { nodes, edges: edgePairs.map(([f, t]) => makeEdge(f, t)), systemLoad: 0.3 };
}

function makeTimeSeries(label: string, values: number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60000),
    values: new Float64Array(values),
    unit: 'count',
  };
}

function makeMetrics(nodeData: Record<string, number[]>): MetricMap {
  const map = new Map<string, readonly TimeSeries[]>();
  for (const [nodeId, vals] of Object.entries(nodeData))
    map.set(nodeId, [makeTimeSeries('cpu_usage', vals)]);
  return map;
}

/** Flat at 10 — the shape whose deviation is zero, i.e. the node the shipped pool drops. */
const SILENT = [10, 10, 10, 10, 10];

/** Flat, then a step at the injection: the shape every ranking is about. */
const MOVED = [10, 10, 10, 10, 90];

describe('pool admission: the set the ranking covers is a named decision', () => {
  it('ships `positive`, so a bare engine is bit-identical to every published number', () => {
    expect(DEFAULT_POOL_ADMISSION).toBe('positive');
    expect(POOL_ADMISSIONS[DEFAULT_POOL_ADMISSION]).toBe(true);
  });

  it('recognises exactly the two admissions', () => {
    expect(isPoolAdmission('positive')).toBe(true);
    expect(isPoolAdmission('graph')).toBe(true);
    expect(isPoolAdmission('all')).toBe(false);
    expect(isPoolAdmission('')).toBe(false);
  });

  it('drops the silent node under the shipped admission', async () => {
    const pruner = new TreePruner();
    const graph = pruner.buildFaultGraph(
      makeCallGraph(
        ['edge', 'svc-b', 'svc-c'],
        [
          ['edge', 'svc-b'],
          ['edge', 'svc-c'],
        ],
      ),
      makeMetrics({ edge: SILENT, 'svc-b': MOVED, 'svc-c': MOVED }),
    );
    const results = await pruner.analyze(graph, 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.serviceId === 'edge')).toBe(false);
  });

  it('admits the same node when the pool is the graph, and ranks it by its own score', async () => {
    const pruner = new TreePruner({ poolAdmission: 'graph' });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(
        ['edge', 'svc-b', 'svc-c'],
        [
          ['edge', 'svc-b'],
          ['edge', 'svc-c'],
        ],
      ),
      makeMetrics({ edge: SILENT, 'svc-b': MOVED, 'svc-c': MOVED }),
    );
    const results = await pruner.analyze(graph, 10);
    const admitted = results.find((r) => r.serviceId === 'edge');
    expect(admitted).toBeDefined();
    // Last rather than first: admission is not a promotion, and a node with no deviation of its own cannot
    // outrank one with a step in it unless a prior carries it — which is the question the arm exists to ask,
    // not a property of admission itself.
    expect(results.indexOf(admitted!)).toBe(results.length - 1);
    expect(admitted!.finalScore).toBe(0);
  });

  it('changes nothing on a case whose every node deviated', async () => {
    const metrics = makeMetrics({ 'svc-a': MOVED, 'svc-b': MOVED });
    const callGraph = makeCallGraph(['svc-a', 'svc-b'], [['svc-a', 'svc-b']]);
    const shipped = await new TreePruner().analyze(
      new TreePruner().buildFaultGraph(callGraph, metrics),
      10,
    );
    const wide = await new TreePruner({ poolAdmission: 'graph' }).analyze(
      new TreePruner({ poolAdmission: 'graph' }).buildFaultGraph(callGraph, metrics),
      10,
    );
    expect(wide.map((r) => r.serviceId)).toEqual(shipped.map((r) => r.serviceId));
    expect(wide.map((r) => r.finalScore)).toEqual(shipped.map((r) => r.finalScore));
  });

  it('keeps the deduction’s deletions out of the ranking it was already out of', async () => {
    // The deduction charges a caller its callee's explanation; at `rho = 1`, `gate = 1` a fully explained node
    // reads 0 and the shipped pool drops it. Under `graph` it is admitted — with score 0 — which is the whole
    // difference between "deleted" and "ranked last", stated in the engine's own arithmetic.
    const pruner = new TreePruner({ poolAdmission: 'graph', topoDiscount: 1, topoDiscountGate: 1 });
    const graph = pruner.buildFaultGraph(
      makeCallGraph(['caller', 'callee'], [['caller', 'callee']]),
      makeMetrics({ caller: SILENT, callee: MOVED }),
    );
    const results = await pruner.analyze(graph, 10);
    expect(results.some((r) => r.serviceId === 'caller')).toBe(true);
  });
});
