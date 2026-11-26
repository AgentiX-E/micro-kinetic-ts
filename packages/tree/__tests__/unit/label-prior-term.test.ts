/**
 * The label-prior term, end to end through the pruner.
 *
 * The unit tests for `computeLabelPriorValues` establish what the value is; these establish that the value REACHES
 * the ranking, that the margin gate decides whether it does, and that the four ways the term can be silent are the
 * four the breakdown names — a weight of zero, no history, an empty history, and a ranking with no room.
 *
 * The last of those is the one this arm is about. The same corpus and the same profile are scored twice with
 * different gates, and the assertion is not "the score moved" but "the score moved only in the ranking that had
 * room": a gate that were read from the gated score would pass every arithmetic test above and still decide with
 * its own answer.
 *
 * @module __tests__/unit/label-prior-term
 */

import type {
  CallEdge,
  LabelPriorProfile,
  MetricMap,
  RootCauseResult,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
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
 * `a` rises by a factor of ten and `b` by three, so the base term orders `a` first and only an external term can
 * reverse it. The reversal is the test: a term that cannot reverse an order has not been wired, whatever its
 * arithmetic says.
 */
function corpus(): { callGraph: ServiceCallGraph; metrics: MetricMap; injectTimeMs: number } {
  const callGraph = graphOf(['a', 'b'], [['a', 'b']]);
  const metrics = new Map<string, readonly TimeSeries[]>([
    ['a', [series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100])]],
    ['b', [series('cpu', [10, 10, 10, 10, 10, 30, 30, 30, 30, 30])]],
  ]);
  return { callGraph, metrics, injectTimeMs: 8 };
}

/** A history in which `a` has never been the answer and `b` almost always has. */
function priorOf(counts: Record<string, number>, labelled: number): LabelPriorProfile {
  return { counts: new Map(Object.entries(counts)), labelled };
}

interface Arm {
  readonly weight: number;
  readonly gate?: number;
  readonly prior?: LabelPriorProfile;
}

function analyze(arm: Arm): RootCauseResult[] {
  const { callGraph, metrics, injectTimeMs } = corpus();
  const pruner = new TreePruner({
    labelPriorWeight: arm.weight,
    ...(arm.gate === undefined ? {} : { labelPriorMarginGate: arm.gate }),
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, {
    injectTimeMs,
    ...(arm.prior === undefined ? {} : { labelPrior: arm.prior }),
  });
  // The pruner's analysis is synchronous in this build, and the annotation says so: the first draft wrote a
  // conditional type over `ReturnType<TreePruner['analyze']>`, whose false branch collapsed to `never` — every
  // `.map` and `.find` below then type-checked against `never` and every `as never` cast hid it. A test file that
  // compiles only because its subject is `never` cannot fail on a type error, which is the one thing a test file
  // must be able to do.
  return pruner.analyze(graph, 5);
}

function rank(arm: Arm): string[] {
  return analyze(arm).map((one) => one.serviceId);
}

function termOf(arm: Arm, service: string): Record<string, unknown> {
  const result = analyze(arm).find((one) => one.serviceId === service);
  const term = result?.terms?.find((one) => one.name === 'labelPrior');
  expect(term).toBeDefined();
  return term as unknown as Record<string, unknown>;
}

// ── Tests ─────────────────────────────────────────────────

describe('the label-prior term in the ranking', () => {
  it('orders the case by its own evidence at the shipped weight', () => {
    expect(rank({ weight: 0 })[0]).toBe('a');
  });

  it('is bit-identical at zero whether or not a history was supplied', () => {
    // The ablation, stated as the property that makes it one: at weight 0 the history is not read, so its presence
    // cannot be observed. A `?? 0` fallback around the lookup would fail here.
    expect(rank({ weight: 0, prior: priorOf({ b: 30 }, 31) })).toEqual(rank({ weight: 0 }));
  });

  it('is inert at a positive weight when the caller supplied no history', () => {
    // A weight times an absent history is the absence of evidence, not a zero reading of it: the run that forgot the
    // profile is the control, and its artifact must say `INPUT_MAP_ABSENT` rather than report a measured zero.
    expect(rank({ weight: 1 })).toEqual(rank({ weight: 0 }));
    expect(termOf({ weight: 1 }, 'a')['cause']).toBe('INPUT_MAP_ABSENT');
    expect(termOf({ weight: 1 }, 'a')['source']).toBe('labelPrior');
  });

  it('treats a history with no labelled incident as empty rather than as a flat prior', () => {
    // `labelled` is the denominator. Zero of them is the absence of a history, and the term names it as the empty
    // map it is instead of scoring every candidate at the floor of a distribution nobody measured.
    const arm = { weight: 1, prior: priorOf({}, 0) };
    expect(rank(arm)).toEqual(rank({ weight: 0 }));
    expect(termOf(arm, 'a')['cause']).toBe('INPUT_MAP_EMPTY');
  });

  it('reverses the order when the history says the runner-up is the answer', () => {
    // The gap the prior has to close is `log1p(100) − log1p(30)` in the base term plus whatever the other terms add,
    // so the weight here is deliberately larger than any shipped one: this is a wiring test, not a price.
    const ordered = rank({ weight: 1, prior: priorOf({ b: 400 }, 401) });
    expect(ordered[0]).toBe('b');
    expect(ordered).toContain('a');
  });

  it('leaves the order alone when the history agrees with the evidence', () => {
    // The control in the other direction: a history that trusts the leader must not move the case, or the reversal
    // above would only be showing that any history moves it.
    expect(rank({ weight: 1, prior: priorOf({ a: 400 }, 401) })[0]).toBe('a');
  });

  it('withholds the term when the ranking has no room, and says so in the breakdown', () => {
    // A gate above any margin this case can produce. The term is PRESENT in the array — every term is — with a zero
    // contribution and the gate's own name, which is the difference between "the arm was armed and refused" and
    // "the arm was off".
    const arm = { weight: 1, gate: 1_000, prior: priorOf({ b: 400 }, 401) };
    expect(rank(arm)).toEqual(rank({ weight: 0 }));
    const term = termOf(arm, 'a');
    expect(term['cause']).toBe('MASKED');
    expect(term['mask']).toBe('labelPriorMarginGate');
    expect(term['contribution']).toBe(0);
  });

  it('reports the weight and the log-probability as separate factors when it speaks', () => {
    // The breakdown's own contract: a reader must be able to re-price the term arithmetically, so the VALUE is on the
    // row beside the weight rather than folded into the contribution.
    const term = termOf({ weight: 1, prior: priorOf({ b: 400 }, 401) }, 'a');
    expect(term['weight']).toBe(1);
    // p(a) = (0 + 1/2) / 402 on a two-candidate case with 401 labelled incidents.
    expect(term['slope']).toBeCloseTo(Math.log(0.5 / 402), 12);
    expect(term['contribution']).toBeCloseTo(Math.log(0.5 / 402), 12);
  });

  it('keeps finalScore equal to the sum of its terms, prior included', () => {
    // The identity `sumScoreTerms` exists to protect, asserted on the one term that is added LAST: the total cannot
    // disagree with the breakdown even when the last row is the one a gate decided.
    const result = analyze({ weight: 1, prior: priorOf({ b: 400 }, 401) })[0]!;
    const total = (result.terms ?? []).reduce((sum, one) => sum + one.contribution, 0);
    expect(result.finalScore).toBeCloseTo(total, 12);
  });

  it('reads a gate of 0 as "speak everywhere", which is the arm that was refused', () => {
    // The shipped gate is a value, not a toggle: 0 is a legal arm and it is the ungated one. Pinned because the
    // difference between the two is 8.97 pp on the corpus and nothing in the type system separates them.
    expect(rank({ weight: 1, gate: 0, prior: priorOf({ b: 400 }, 401) })[0]).toBe('b');
  });
});
