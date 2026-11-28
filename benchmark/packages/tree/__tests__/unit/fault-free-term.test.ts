/**
 * The fault-free term, end to end through the pruner.
 *
 * The unit tests for `computeFaultFreeScores` establish what the score is; these establish that the score
 * REACHES the ranking, and — the half that decides whether the ablation is honest — that a weight of zero
 * makes the term unreachable rather than merely weightless.
 *
 * The two arms are deliberately the same corpus: one pruner is built with a profile and weight 0, the other
 * with no profile and weight 0, and the two rankings must be identical to the last bit. A term that read a
 * map at zero would pass every assertion about its own arithmetic and still move a published number.
 *
 * @module pruning/fault-free-term.test
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type { FaultFreeProfile } from '@agentix-e/micro-kinetic-tree';
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

function node(id: string): ServiceNode {
  return { id, name: id, namespace: 'default', labels: {} };
}

function graphOf(
  ids: readonly string[],
  pairs: ReadonlyArray<readonly [string, string]>,
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of ids) nodes.set(id, node(id));
  const edges: CallEdge[] = pairs.map(([from, to]) => ({
    from,
    to,
    type: 'REST',
    callRate: 100,
    p99Latency: 10,
    errorRate: 0.01,
  }));
  return { nodes, edges, systemLoad: 0.3 };
}

function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: new Float64Array(values),
    unit: 'count',
  };
}

/**
 * A two-service case whose leader is `a`.
 *
 * `a` rises by a factor of ten and `b` by three, so the base term orders `a` first and the fault-free
 * prior is the only thing that can reverse it. That reversal is the test: a term that cannot reverse an
 * order has not been wired, whatever its arithmetic says.
 */
function corpus(): { callGraph: ServiceCallGraph; metrics: MetricMap; injectTimeMs: number } {
  const callGraph = graphOf(['a', 'b'], [['a', 'b']]);
  const metrics = new Map<string, readonly TimeSeries[]>([
    ['a', [series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100])]],
    ['b', [series('cpu', [10, 10, 10, 10, 10, 30, 30, 30, 30, 30])]],
  ]);
  return { callGraph, metrics, injectTimeMs: 8 };
}

/** A profile in which `a`'s channel fires in every fault-free window and `b`'s in none. */
function profileOf(rates: Record<string, number>): FaultFreeProfile {
  const byService = new Map<
    string,
    Map<string, { label: string; centre: number; scale: number; rate: number; windows: number }>
  >();
  for (const [service, rate] of Object.entries(rates)) {
    byService.set(
      service,
      new Map([['cpu', { label: 'cpu', centre: 1, scale: 1, rate, windows: 5 }]]),
    );
  }
  return byService as unknown as FaultFreeProfile;
}

function rank(weight: number, profile: FaultFreeProfile | undefined): string[] {
  const { callGraph, metrics, injectTimeMs } = corpus();
  const pruner = new TreePruner({
    faultFreeWeight: weight,
    ...(profile === undefined ? {} : { faultFreeProfile: profile }),
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs });
  return pruner.analyze(graph, 5).map((result) => result.serviceId);
}

// ── Tests ─────────────────────────────────────────────────

describe('the fault-free term in the ranking', () => {
  it('orders the case by the base evidence when the weight is zero', () => {
    expect(rank(0, undefined)[0]).toBe('a');
  });

  it('is bit-identical at zero whether or not a profile was supplied', () => {
    // The ablation, stated as the property that makes it one: weight 0 does not READ the map, so the
    // profile's presence cannot be observed. An `?? 0` fallback around a map lookup would fail here.
    expect(rank(0, profileOf({ a: 1, b: 0 }))).toEqual(rank(0, undefined));
  });

  it('is inert at a positive weight when no profile was supplied', () => {
    // The second half of the same argument: a weight alone cannot score anything, because the quantity it
    // weights is not in the case. A run that forgot the profile is the control, not an arm.
    expect(rank(25, undefined)).toEqual(rank(0, undefined));
  });

  it('reverses the order when the leader is the channel that always fires', () => {
    const ordered = rank(25, profileOf({ a: 1, b: 0 }));
    expect(ordered[0]).toBe('b');
    expect(ordered).toContain('a');
  });

  it('leaves the order alone when the prior agrees with the base term', () => {
    // The control in the other direction: a profile that trusts the leader and distrusts the runner-up
    // must not move anything, or the reversal above would only be showing that any profile moves the case.
    expect(rank(25, profileOf({ a: 0, b: 1 }))[0]).toBe('a');
  });

  it('names the term in the breakdown, at the weight it was given', () => {
    const { callGraph, metrics, injectTimeMs } = corpus();
    const pruner = new TreePruner({
      faultFreeWeight: 3,
      faultFreeProfile: profileOf({ a: 0.5, b: 0.5 }),
    });
    const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs });
    const results = pruner.analyze(graph, 5);
    const term = results[0]!.terms?.find((one) => one.name === 'faultFree');
    expect(term).toBeDefined();
    expect(term?.weight).toBe(3);
    expect(term?.slope).toBeCloseTo(0.5, 12);
  });

  it('contributes exactly weight × slope to the total', () => {
    const { callGraph, metrics, injectTimeMs } = corpus();
    const pruner = new TreePruner({
      faultFreeWeight: 4,
      faultFreeProfile: profileOf({ a: 0, b: 0.75 }),
    });
    const graph = pruner.buildFaultGraph(callGraph, metrics, { injectTimeMs });
    const result = pruner.analyze(graph, 5).find((one) => one.serviceId === 'b')!;
    const term = result.terms!.find((one) => one.name === 'faultFree')!;
    expect(term.slope).toBeCloseTo(0.25, 12);
    expect(term.contribution).toBeCloseTo(1, 12);
  });
});
