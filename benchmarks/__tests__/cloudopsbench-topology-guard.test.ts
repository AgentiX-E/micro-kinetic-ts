/**
 * The graph guard: a registered system may not be scored on the ring fallback.
 *
 * This file deliberately contains no `initRCAEvalTopology()` call. The defect it guards was an ORDER — the
 * Cloud-OpsBench runner selected its cases before initialising the registry, so every graph came from the ring
 * fallback while every docblock claimed the shared graph builder — and an order can be got wrong again. The guard
 * lives in `callGraphOf` so it cannot, and this file is the only place in the suite that can see the world the
 * defect happened in, because module state is per file.
 */
import { describe, expect, it } from 'vitest';

import type { CaseSeries, CloudOpsCase } from '../src/cloudopsbench-case.js';
import { callGraphOf } from '../src/cloudopsbench-suite.js';

const T0 = 1_700_000_000_000;

function series(service: string, metric: string, values: readonly number[]): CaseSeries {
  return {
    service,
    metric,
    timestamps: values.map((_, index) => T0 + index * 5_000),
    values: [...values],
  };
}

/** A case naming a registered system, which is the population the guard is about. */
function registeredCase(system: string): CloudOpsCase {
  return {
    id: `${system}/performance/1`,
    system,
    category: 'performance',
    namespace: system,
    query: 'Service quality degradation.',
    difficulty: 'hard',
    services: ['adservice', 'cartservice'],
    series: [series('adservice', 'cpu', [0.1, 0.2]), series('cartservice', 'cpu', [0.1, 0.2])],
    alert: { startMs: T0 + 5_000, endMs: T0 + 10_000, entities: [] },
    faultObject: 'app/adservice',
    faultTaxonomy: 'Performance_Fault',
    rootCause: 'pod_cpu_overload',
    hasToolCache: false,
    metricsRows: 2,
  };
}

describe('a registered system without the registry', () => {
  it('refuses the ring fallback by name instead of scoring a deployment it did not read', () => {
    for (const system of ['boutique', 'trainticket']) {
      expect(() => callGraphOf(registeredCase(system))).toThrow(/ring instead of/);
    }
  });

  it('still builds a graph when the ring was ASKED for, which is the ablation arm', () => {
    const graph = callGraphOf(registeredCase('boutique'), 'ring');
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((one) => `${one.from}>${one.to}`)).toEqual([
      'adservice>cartservice',
      'cartservice>adservice',
    ]);
  });

  it('leaves a system the registry does not carry on the ring, because there is no deployment to read', () => {
    const graph = callGraphOf(registeredCase('some-other-shop'));
    expect(graph.edges.map((one) => `${one.from}>${one.to}`)).toEqual([
      'adservice>cartservice',
      'cartservice>adservice',
    ]);
    expect(graph.nodes.get('adservice')?.namespace).toBe('some-other-shop');
  });
});
