/**
 * The deduction's CLOSURE — how a caller's explanation is aggregated over its callees.
 *
 * ## Why this is a modelling choice and not a constant
 *
 * `explained(v) = max_c w·a_c` has been the operator's definition since iteration 158, and the reason was
 * written into the module: "the caller's traffic splits across its callees, so the fractions do not compose
 * into a total". That sentence is about a fan-out that ALTERNATES between callees — a caller whose request
 * goes to one branch or another. It is not true of a request that fans OUT and waits for every branch: such
 * a caller's anomaly is the influx from all of them, and its response time is the slowest branch's
 * (`max`), while its error count is the sum of theirs (`sum`).
 *
 * So the aggregation is a property of the CHANNEL and of the request's shape, and the operator holds it as
 * a named choice rather than as a literal. This file pins three things:
 *
 * 1. **The two closures differ exactly where a fan-out of mild callees is involved** — which is the defect
 *    `docs/topo-share.md` §11 measured on the rank-2 band: a node that calls everything and is called by
 *    nothing (TrainTicket's `ts-admin-travel-service`, SockShop's `front-end`) has an anomaly that is an
 *    aggregate of nine or ten callees, and a `max` over them can never reach it.
 * 2. **`sum` is bounded the same way `max` is.** The cap lives on the EXPLAINED quantity, inside the
 *    `min(a, e)`, so a sum that exceeds the whole reads as "entirely explained" and never as a negative
 *    anomaly. Nothing about the closure relaxes the bound that keeps `rho` bounded.
 * 3. **The gate still decides.** At `gate = 1` a partial sum is refused exactly as a partial maximum was,
 *    which is what makes the two closures comparable on one population rather than two operators.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_TOPO_CLOSURE,
  TOPO_CLOSURES,
  deductExplainedAnomalies,
  isTopoClosure,
  type TopoClosure,
  type TopoDeductionInput,
  type TopoDiscountScope,
} from '../../src/index.js';

/** An edge with the only fields the deduction reads. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/**
 * An input over a fan-out, with every node labelled so `external` scope admits all of them.
 *
 * `weights` is aligned with `edges` rather than constant, because the whole subject here is what happens
 * when a caller's traffic is SPLIT: a fixture that gave every edge the same weight could not distinguish a
 * fan-out of three from a single link of weight 1.
 */
function fanOut(
  anomalies: Record<string, number>,
  edges: readonly CallEdge[],
  weights: readonly number[],
  labels: Record<string, string> = {},
): TopoDeductionInput {
  const nodeIds = new Set([...Object.keys(anomalies), ...edges.flatMap((e) => [e.from, e.to])]);
  return {
    anomalies: new Map(Object.entries(anomalies)) as Map<ServiceId, number>,
    edges,
    propagationWeights: Float64Array.from(weights),
    dominantMetrics: new Map(
      [...nodeIds].map((id) => [id, { label: labels[id] ?? 'latency_p99' }]),
    ),
  };
}

const deduct = (
  input: TopoDeductionInput,
  rho: number,
  closure: TopoClosure,
  scope: TopoDiscountScope = 'external',
  gate = 0,
) => deductExplainedAnomalies(input, rho, scope, gate, closure);

/** Three callees, a third of the traffic each, every one of them as anomalous as the caller. */
const OBSERVER = fanOut(
  { observer: 1, left: 1, right: 1, middle: 1 },
  [edge('observer', 'left'), edge('observer', 'right'), edge('observer', 'middle')],
  [1 / 3, 1 / 3, 1 / 3],
);

describe('the closure — one aggregate over a caller’s callees', () => {
  it('ships `max`, and names exactly two reachable values', () => {
    // The shipped value cannot change without this assertion moving. `max` is what every published number
    // on the golden nine cells was read under, and it is the readable definition for a request that takes
    // one branch: the caller is as bad as the worst thing it depends on.
    expect(DEFAULT_TOPO_CLOSURE).toBe('max');
    expect(Object.keys(TOPO_CLOSURES).sort()).toEqual(['max', 'sum']);
    // A parser must be able to refuse a third name rather than silently running the default.
    expect(isTopoClosure('sum')).toBe(true);
    expect(isTopoClosure('max')).toBe(true);
    expect(isTopoClosure('mean')).toBe(false);
    expect(isTopoClosure('')).toBe(false);
  });

  it('explains a fan-out by the sum, which is the influx the caller actually received', () => {
    // The subject of the whole file: a caller with three callees at a third of its traffic each, every one
    // of them as anomalous as the caller. `max` sees a third of the anomaly explained; `sum` sees the whole
    // of it, and at `rho = 1` the caller is charged all of it.
    const max = deduct(OBSERVER, 1, 'max');
    const sum = deduct(OBSERVER, 1, 'sum');
    expect(max.share.get('observer')).toBeCloseTo(1 / 3, 12);
    expect(max.discounted.get('observer')).toBeCloseTo(2 / 3, 12);
    expect(sum.share.get('observer')).toBeCloseTo(1, 12);
    expect(sum.discounted.get('observer')).toBe(0);
  });

  it('leaves a source alone under BOTH closures, because its callees are quiet', () => {
    // The property that makes `sum` admissible: a node whose own reading is the fault has callees that did
    // not move, so the sum is small. A closure that charged it would be charging every service that calls
    // anything, which is the operator without a subject.
    const source = fanOut(
      { source: 2, a: 0.05, b: 0.04, c: 0.03 },
      [edge('source', 'a'), edge('source', 'b'), edge('source', 'c')],
      [0.4, 0.35, 0.25],
    );
    for (const closure of ['max', 'sum'] as const) {
      expect(deduct(source, 1, closure, 'external', 1).discounted.get('source')).toBe(2);
    }
    // …and the sum is the larger reading of the two, so the agreement is not vacuous.
    expect(deduct(source, 1, 'sum').share.get('source')!).toBeGreaterThan(
      deduct(source, 1, 'max').share.get('source')!,
    );
  });

  it('caps a sum that exceeds the whole, exactly as it caps a single callee', () => {
    // `min(a, e)` is where the bound lives, so it binds the sum the same way: six times the caller's
    // anomaly reads as entirely explained, never as a negative remainder and never as a share of 6.
    const heavy = fanOut(
      { caller: 1, a: 3, b: 3 },
      [edge('caller', 'a'), edge('caller', 'b')],
      [1, 1],
    );
    const result = deduct(heavy, 1, 'sum');
    expect(result.share.get('caller')).toBe(1);
    expect(result.discounted.get('caller')).toBe(0);
  });

  it('agrees with `max` on a chain, where there is only one callee to aggregate', () => {
    // The two closures are one operator on a tree: a sum over one term IS that term. This is the assertion
    // that keeps `sum` from being a different deduction rather than a different aggregation of the same one.
    const chain = fanOut({ a: 4, b: 2, c: 1 }, [edge('a', 'b'), edge('b', 'c')], [0.5, 0.5]);
    for (const gate of [0, 0.25, 0.5, 1]) {
      for (const rho of [0, 0.5, 1]) {
        expect(
          [...deduct(chain, rho, 'sum', 'external', gate).discounted.entries()].sort(),
        ).toEqual([...deduct(chain, rho, 'max', 'external', gate).discounted.entries()].sort());
      }
    }
  });

  it('is still refused by the gate when the sum only partly explains the node', () => {
    // The gate decides WHETHER, the closure decides HOW MUCH — the two halves stay independent, which is
    // what lets the two closures be measured at one gate on one population.
    const partial = fanOut(
      { caller: 1, a: 0.6, b: 0.2 },
      [edge('caller', 'a'), edge('caller', 'b')],
      [1, 1],
    );
    // A sum of 0.8 against an anomaly of 1: charged at gate 0, refused at gate 1.
    expect(deduct(partial, 1, 'sum', 'external', 0).discounted.get('caller')).toBeCloseTo(0.2, 12);
    expect(deduct(partial, 1, 'sum', 'external', 1).discounted.get('caller')).toBe(1);
    // …and the max reads 0.6 of the same node, which the gate then judges on ITS share (0.6) rather than on
    // the sum's (0.8): charged at gate 0, refused at gate 1. The two closures differ in the number the gate
    // reads before they differ in the ranking, and that is the whole reason both are measured at one gate.
    expect(deduct(partial, 1, 'max', 'external', 0).discounted.get('caller')).toBeCloseTo(0.4, 12);
    expect(deduct(partial, 1, 'max', 'external', 1).discounted.get('caller')).toBe(1);
  });

  it('scales linearly with rho under the sum, so the charge stays bounded by the weight', () => {
    const values = [0, 0.25, 0.5, 0.75, 1].map((rho) =>
      deduct(OBSERVER, rho, 'sum').discounted.get('observer')!,
    );
    expect(values).toEqual([1, 0.75, 0.5, 0.25, 0]);
  });

  it('reads only the channels the scope admits, on both sides, under the sum too', () => {
    // A callee whose dominant channel is internal (`cpu`) contributes nothing through a call boundary: the
    // scope is about what a call can TRANSMIT, and an aggregation that read every channel would make `sum`
    // the only closure with a different scope, which is a second axis smuggled into the first.
    const mixed = fanOut(
      { caller: 1, cpuCal: 1, netCal: 1 },
      [edge('caller', 'cpuCal'), edge('caller', 'netCal')],
      [0.5, 0.5],
      { cpuCal: 'cpu_usage' },
    );
    expect(deduct(mixed, 1, 'sum').share.get('caller')).toBeCloseTo(0.5, 12);
  });

  it('ignores an edge that carries no traffic, rather than adding a zero-weight term', () => {
    // A weight of 0 is a link the caller does not route through; it is not a callee that explained nothing.
    // The distinction matters for `sum` alone, because a sum has a term to add where a max has a candidate.
    const dark = fanOut(
      { caller: 1, live: 1, dark: 5 },
      [edge('caller', 'live'), edge('caller', 'dark')],
      [0.5, 0],
    );
    expect(deduct(dark, 1, 'sum').share.get('caller')).toBeCloseTo(0.5, 12);
  });

  it('refuses a closure it was not built with, instead of reading it as the default', () => {
    // The type is a union, but the function is public and JavaScript has no unions: a string from a config
    // file would otherwise fall through to whichever branch happened to be `else`, and the artifact would
    // then report a closure the run did not use.
    expect(() => deduct(OBSERVER, 1, 'mean' as TopoClosure)).toThrow(/topoClosure/);
  });
});
