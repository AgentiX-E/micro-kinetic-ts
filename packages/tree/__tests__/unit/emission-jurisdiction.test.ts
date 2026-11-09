/**
 * The emission term's jurisdiction, measured two ways: on the order it produces, and on the engine.
 *
 * The unit half pins the ORDER with fixtures small enough that every position can be argued for. The engine half
 * runs the two corpus cases the arm lost, in miniature, and asserts the pair of properties that matter: a node
 * the map cannot measure is not overtaken, and a node it CAN measure still is.
 *
 * @module __tests__/unit/emission-jurisdiction
 */

import type { CallEdge, MetricMap, ServiceNode, TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_EMISSION_WEIGHT,
  orderWithEmissionJurisdiction,
  TreePruner,
  type EmissionJurisdictionRow,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

const row = (
  serviceId: string,
  score: number,
  baseScore: number,
  measured: boolean,
): EmissionJurisdictionRow => ({ serviceId, score, baseScore, measured });

const ids = (rows: readonly EmissionJurisdictionRow[]): string[] => rows.map((r) => r.serviceId);

describe('orderWithEmissionJurisdiction', () => {
  it('orders by the term when every candidate is measured', () => {
    // The promoted case, in miniature: `carts` emits 0.339 per request against `front-end`'s 0.096, so the term
    // lifts it above a node that wins on its own anomaly alone. With both nodes measurable the term decides.
    const ordered = orderWithEmissionJurisdiction([
      row('front-end', 2.026, 2.026, true),
      row('carts', 2.6, 1.157, true),
    ]);
    expect(ids(ordered)).toEqual(['carts', 'front-end']);
  });

  it('leaves the base order alone when no candidate is measured', () => {
    // An inert term must cost nothing: the map is empty, so every `score` equals its `baseScore` and the answer
    // is the base ranking.
    const ordered = orderWithEmissionJurisdiction([
      row('b', 1.5, 1.5, false),
      row('a', 2.0, 2.0, false),
      row('c', 0.9, 0.9, false),
    ]);
    expect(ids(ordered)).toEqual(['a', 'b', 'c']);
  });

  it('does not let a measured node overtake the only unmeasured node above it', () => {
    // `re3ob_cartservice_f1_1`: the truth carries no `error` channel, `frontend` does, and the additive term
    // handed the case to `frontend`. The term's contribution is 9.0 here — far larger than the base gap — so a
    // score-only rule would invert the pair; the jurisdiction does not.
    const ordered = orderWithEmissionJurisdiction([
      row('cartservice', 2.0, 2.0, false),
      row('frontend', 11.0, 2.0, true),
    ]);
    expect(ids(ordered)).toEqual(['cartservice', 'frontend']);
  });

  it('keeps the stratum boundary and permutes inside it', () => {
    // Base: A(u) 5.0, B(m) 4.0, C(u) 3.0, D(m) 2.0. The term lifts D above B. The measured nodes may only
    // occupy the slots the base ranking gave them — positions 1 and 3 — so the answer is A, D, C, B and never
    // D, A, B, C.
    const ordered = orderWithEmissionJurisdiction([
      row('A', 5.0, 5.0, false),
      row('B', 4.0, 4.0, true),
      row('C', 3.0, 3.0, false),
      row('D', 9.0, 2.0, true),
    ]);
    expect(ids(ordered)).toEqual(['A', 'D', 'C', 'B']);
  });

  it('reads the base order from the base score, not from the caller’s array order', () => {
    // The same candidates handed over in a different array order must produce the same answer, because a slice's
    // iteration order is not a ranking.
    const rows = [
      row('D', 9.0, 2.0, true),
      row('C', 3.0, 3.0, false),
      row('B', 4.0, 4.0, true),
      row('A', 5.0, 5.0, false),
    ];
    expect(ids(orderWithEmissionJurisdiction(rows))).toEqual(['A', 'D', 'C', 'B']);
    expect(ids(orderWithEmissionJurisdiction([...rows].reverse()))).toEqual(['A', 'D', 'C', 'B']);
  });

  it('breaks ties by id on both orders', () => {
    // Two nodes with the same base score and the same final score: the comparator's tie-break is the id, so the
    // answer is deterministic rather than dependent on insertion order.
    const ordered = orderWithEmissionJurisdiction([
      row('zeta', 1.0, 1.0, true),
      row('alpha', 1.0, 1.0, true),
      row('mike', 1.0, 1.0, false),
    ]);
    expect(ids(ordered)).toEqual(['alpha', 'mike', 'zeta']);
  });

  it('is a permutation: same members, same length', () => {
    const rows = [
      row('a', 3.0, 1.0, true),
      row('b', 1.0, 3.0, true),
      row('c', 2.0, 2.0, false),
      row('d', 4.0, 0.5, false),
    ];
    const ordered = orderWithEmissionJurisdiction(rows);
    expect(ordered).toHaveLength(rows.length);
    expect(new Set(ids(ordered))).toEqual(new Set(ids(rows)));
  });

  it('returns an empty answer for an empty input', () => {
    expect(orderWithEmissionJurisdiction([])).toEqual([]);
  });
});

function node(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

function ts(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: Float64Array.from(values),
    unit: 'count',
  };
}

/**
 * A step AT the injection: samples `0..at−1` hold `pre`, samples `at..11` hold `post`.
 *
 * The boundary is index 3 because the fixtures inject at 180000 with 60000 between samples, and the emission
 * term's post window is `[inject, inject + span)` — a step anywhere else lands in the wrong window and the
 * fixture would measure nothing (which is how the first draft of these tests failed).
 */
function step(pre: number, post: number, at = 3, n = 12): number[] {
  return [...Array<number>(at).fill(pre), ...Array<number>(n - at).fill(post)];
}

const INJECT = 180_000;

/**
 * `front-end` calls `carts`. Both carry a `cpu` step so both are candidates (an all-flat node is not in the pool
 * at all); `carts` carries the larger cpu rise, which is what the engine sees. Emission is added per test.
 */
function graphMetrics(extra: Record<string, readonly TimeSeries[]>): MetricMap {
  const map = new Map<string, readonly TimeSeries[]>();
  // `front-end` carries the LARGER cpu step, so it wins the base ranking — measured: 0.849 against 0.442. That
  // is the shape the corpus arm lost: the truth is ahead before the term speaks, and the term is what moves it.
  map.set('front-end', [ts('cpu', step(1, 4.0)), ...(extra['front-end'] ?? [])]);
  map.set('carts', [ts('cpu', step(1, 1.2)), ...(extra['carts'] ?? [])]);
  return map;
}

const callGraph = {
  nodes: new Map<string, ServiceNode>([
    ['front-end', node('front-end')],
    ['carts', node('carts')],
  ]),
  edges: [edge('front-end', 'carts')],
  systemLoad: 0.3,
};

/** `carts` emits 0.34 errors per request after the injection and none before — a source, per `Δλ`. */
const cartsEmits = {
  carts: [ts('error', step(0, 340)), ts('workload', step(1000, 1000))],
};

/** `front-end` emits 0.09 per request — a tenth of `carts`' rate, and measurable. */
const frontEndEmits = {
  'front-end': [ts('error', step(0, 216)), ts('workload', step(2400, 2400))],
};

describe('TreePruner under the emission term', () => {
  it('promotes the measured emitter when every candidate is measured', () => {
    // Both nodes carry both channels, so the term has jurisdiction over both and `carts` — the larger Δλ — takes
    // rank 1 even though `front-end` wins the base anomaly. The weight is large enough that the term dominates,
    // which is the point: the case is decided by the instrument, exactly as `re3ss_carts_f1_1` was.
    const pruner = new TreePruner({ emissionWeight: 50 });
    const graph = pruner.buildFaultGraph(
      callGraph,
      graphMetrics({ ...cartsEmits, ...frontEndEmits }),
      {
        injectTimeMs: INJECT,
      },
    );
    const results = pruner.analyze(graph, 2);
    expect(results[0]!.serviceId).toBe('carts');
  });

  it('does not overturn a leader the map cannot measure', () => {
    // The only difference from the test above: `front-end` has no `error` channel, which is `cartservice`'s
    // situation in `re3ob_cartservice_f1_1`. The identical weight must now leave the ranking alone.
    const pruner = new TreePruner({ emissionWeight: 50 });
    const graph = pruner.buildFaultGraph(callGraph, graphMetrics(cartsEmits), {
      injectTimeMs: INJECT,
    });
    const results = pruner.analyze(graph, 2);
    expect(results[0]!.serviceId).toBe('front-end');
    // And the term is still READ, so the ranking is not protected by the weight being ignored: `carts` carries a
    // non-zero emission contribution while `front-end`'s is an absence.
    const carts = results.find((r) => r.serviceId === 'carts')!;
    const frontEnd = results.find((r) => r.serviceId === 'front-end')!;
    expect(carts.terms?.find((t) => t.name === 'emission')?.contribution).toBeGreaterThan(0);
    expect(frontEnd.terms?.find((t) => t.name === 'emission')?.cause).toBe('INPUT_ENTRY_ABSENT');
  });

  it('reaches the engine at the shipped default, and does not exist at zero', () => {
    // The ternary iteration 254 moved: the DEFAULT now carries the term. What a fixture can check about that is
    // that the default is FORWARDED rather than merely declared — a weight with three owners is the defect
    // `rank-normalization-default-audit.md` records — so the shipped run is compared to the explicit arm and to
    // the `w = 0` control, on the same case.
    expect(DEFAULT_EMISSION_WEIGHT).toBe(0.5);
    const shipped = new TreePruner();
    const shippedGraph = shipped.buildFaultGraph(
      callGraph,
      graphMetrics({ ...cartsEmits, ...frontEndEmits }),
      { injectTimeMs: INJECT },
    );
    const shippedResults = shipped.analyze(shippedGraph, 2);
    expect(shippedGraph.emissionScores?.size).toBe(2);
    // The contribution is the weight times the share, at the shipped configuration: `carts` carries the case's
    // largest `Δλ`, so its share is 1 and the contribution is the weight itself.
    const cartsEmission = shippedResults
      .find((r) => r.serviceId === 'carts')!
      .terms!.find((t) => t.name === 'emission')!;
    expect(cartsEmission.contribution).toBeCloseTo(0.5, 12);
    // `front-end` emits a tenth as much per request, so the term reads 27% of the weight on it — the term is
    // doing arithmetic on a population, not switching a flag.
    expect(
      shippedResults
        .find((r) => r.serviceId === 'front-end')!
        .terms!.find((t) => t.name === 'emission')!.contribution,
    ).toBeCloseTo((0.5 * (216 / 2400)) / (340 / 1000), 9);

    const explicit = new TreePruner({ emissionWeight: 0.5 });
    const explicitGraph = explicit.buildFaultGraph(
      callGraph,
      graphMetrics({ ...cartsEmits, ...frontEndEmits }),
      { injectTimeMs: INJECT },
    );
    expect(explicit.analyze(explicitGraph, 2).map((r) => [r.serviceId, r.finalScore])).toEqual(
      shippedResults.map((r) => [r.serviceId, r.finalScore]),
    );

    const off = new TreePruner({ emissionWeight: 0 });
    const offGraph = off.buildFaultGraph(
      callGraph,
      graphMetrics({ ...cartsEmits, ...frontEndEmits }),
      {
        injectTimeMs: INJECT,
      },
    );
    expect(offGraph.emissionScores).toBeUndefined();
    expect(
      off
        .analyze(offGraph, 2)
        .find((r) => r.serviceId === 'carts')!
        .terms?.find((t) => t.name === 'emission')?.cause,
    ).toBe('WEIGHT_ZERO');
  });
});
