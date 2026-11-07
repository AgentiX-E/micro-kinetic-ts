/**
 * The anomaly's SPACE, as the graph reports it.
 *
 * `buildTopologyFaultGraph` silently changes what a number means: below `anomalyNormalizeNodeThreshold`
 * a service's score is a deviation, and at or above it the score is a rank. Everything downstream that
 * treats the anomaly as a quantity — the deduction in iteration 158 is the first, `log1p` in
 * `finalScore` is the second — is defined on the deviation, so the graph now reports which space a run
 * is in and keeps the deviation it transformed.
 *
 * These tests assert the RECONSTRUCTION rather than the intent: for every configuration, applying the
 * named transform to `rawAnomalyScores` must reproduce `anomalyScores` exactly. A flag that merely
 * claimed a space would be satisfied by a label; a flag that reproduces the map is a fact about the run.
 */

import { describe, expect, it } from 'vitest';

import type {
  CallEdge,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import { applyAnomalyNormalization, minMaxNormalizeScores, scoreRange } from '../../src/index.js';
// The builder is reached by its module rather than through the package index: it is the PRUNER's
// constructor argument, not part of the surface a consumer assembles a pipeline from.
import {
  ANOMALY_NORMALIZE_NODE_THRESHOLD,
  buildTopologyFaultGraph,
} from '../../src/causal/topology-fault-graph.js';

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

function makeTimeSeries(label: string, values: number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60000),
    values: new Float64Array(values),
    unit: 'count',
  };
}

/**
 * A fleet of `n` services in a chain, the first two anomalous and the rest at a clustered floor — the
 * shape a measured fleet has, and the shape whose rank image is uniform.
 */
function fleetOf(
  n: number,
  anomalyAt: 'top' | 'none' = 'top',
): {
  callGraph: ServiceCallGraph;
  metrics: Map<string, readonly TimeSeries[]>;
} {
  const ids = Array.from({ length: n }, (_, i) => `svc${i}`);
  const nodes = new Map(ids.map((id) => [id, makeNode(id)]));
  const edges = ids.slice(1).map((id, i) => makeEdge(ids[i]!, id));
  const metrics = new Map<string, readonly TimeSeries[]>();
  for (let i = 0; i < n; i++) {
    const base = [1, 1, 1, 1, 1, 1];
    // `svc0` is the source and `svc1` inherits: two deviations well clear of the floor, then a floor
    // whose members differ by less than any of the deductions this file is about.
    const tail =
      anomalyAt === 'top' && i === 0
        ? [3, 3, 3, 3, 3, 3]
        : anomalyAt === 'top' && i === 1
          ? [2.4, 2.4, 2.4, 2.4, 2.4, 2.4]
          : anomalyAt === 'none'
            ? [1.1, 1.1, 1.1, 1.1, 1.1, 1.1]
            : [
                1.1 + 0.001 * i,
                1.1 + 0.001 * i,
                1.1 + 0.001 * i,
                1.1 + 0.001 * i,
                1.1 + 0.001 * i,
                1.1 + 0.001 * i,
              ];
    metrics.set(ids[i]!, [makeTimeSeries('latency_p99', [...base, ...tail])]);
  }
  return { callGraph: { nodes, edges, systemLoad: 0.3 }, metrics };
}

describe('the space a graph reports its anomalies in', () => {
  it('is the DEVIATION below the normalisation threshold, and says so', () => {
    // OnlineBoutique and SockShop live here (12–14 services), which is why every published number on
    // those cells is unchanged by iteration 158: there is no space to be wrong about.
    const { callGraph, metrics } = fleetOf(ANOMALY_NORMALIZE_NODE_THRESHOLD - 1);
    const graph = buildTopologyFaultGraph(callGraph, metrics);

    expect(graph.anomalyNormalization).toBe('none');
    expect([...graph.rawAnomalyScores]).toEqual([...graph.anomalyScores]);
    // The reconstruction is the identity here, asserted through the same round trip the deduction uses.
    expect([...applyAnomalyNormalization(graph.rawAnomalyScores, 'none')]).toEqual([
      ...graph.anomalyScores,
    ]);
  });

  it('is the RANK at the threshold, and the deviation is recoverable as the input of that rank', () => {
    // TrainTicket lives here (63–69 services). The rank is exact: applying it to the kept deviation
    // reproduces the reported map, which is what makes "deduct on `rawAnomalyScores`, then rank" the
    // same statement as "deduct on what the ranking would have read, had it not been ranked".
    const { callGraph, metrics } = fleetOf(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    const graph = buildTopologyFaultGraph(callGraph, metrics);

    expect(graph.anomalyNormalization).toBe('rank');
    // Compared as an object rather than as an entry list: a `Map`'s iteration order is insertion order,
    // and the reconstruction deliberately walks the DEVIATION map, which the builder filled by service.
    expect(Object.fromEntries(applyAnomalyNormalization(graph.rawAnomalyScores, 'rank'))).toEqual(
      Object.fromEntries(graph.anomalyScores),
    );
    // …and the two spaces really are different, so the test above is not passing on a degenerate map:
    // the source's rank is 1 while its deviation is a deviation.
    expect(graph.anomalyScores.get('svc0')).toBe(1);
    expect(graph.rawAnomalyScores.get('svc0')).not.toBe(1);
  });

  it('is the MIN-MAX rescale when rank normalisation is off, and the rescale is reproducible', () => {
    const { callGraph, metrics } = fleetOf(ANOMALY_NORMALIZE_NODE_THRESHOLD);
    const graph = buildTopologyFaultGraph(callGraph, metrics, { rankNormalization: false });

    expect(graph.anomalyNormalization).toBe('minmax');
    expect(Object.fromEntries(applyAnomalyNormalization(graph.rawAnomalyScores, 'minmax'))).toEqual(
      Object.fromEntries(graph.anomalyScores),
    );
  });

  it('reports NO transform when there is no range to amplify', () => {
    // Every service identical: `minMaxNormalizeScores` returns the map unchanged (dividing by a zero
    // width is the alternative), so the honest flag is `none` and not `minmax` — otherwise a reader
    // would be told about a rescaling that did not happen, and `applyAnomalyNormalization` would claim
    // to reproduce a map it does not.
    const { callGraph, metrics } = fleetOf(ANOMALY_NORMALIZE_NODE_THRESHOLD, 'none');
    const graph = buildTopologyFaultGraph(callGraph, metrics, { rankNormalization: false });

    expect(graph.anomalyNormalization).toBe('none');
    expect([...graph.rawAnomalyScores]).toEqual([...graph.anomalyScores]);
  });
});

describe('minMaxNormalizeScores and scoreRange', () => {
  it('rescales onto [0, 1] preserving order and the relative gaps', () => {
    const rescaled = minMaxNormalizeScores(
      new Map([
        ['a', 0.1],
        ['b', 0.5],
        ['c', 1.0],
      ]),
    );
    expect(rescaled.get('a')).toBeCloseTo(0, 12);
    expect(rescaled.get('b')).toBeCloseTo(0.4 / 0.9, 12);
    expect(rescaled.get('c')).toBeCloseTo(1, 12);
  });

  it('copies rather than aliases when there is no range', () => {
    const flat = new Map([
      ['a', 2],
      ['b', 2],
    ]);
    const rescaled = minMaxNormalizeScores(flat);
    expect([...rescaled]).toEqual([...flat]);
    expect(rescaled).not.toBe(flat);
    expect(scoreRange(flat)).toBe(0);
    expect(scoreRange(new Map())).toBe(-Infinity);
  });
});
