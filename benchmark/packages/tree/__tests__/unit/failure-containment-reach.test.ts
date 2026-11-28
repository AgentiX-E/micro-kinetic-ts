/**
 * The containment rule's REACH: adjacency, the wide traversal, and the evidence guard.
 *
 * Iteration 313 measured a partition over the same flows — rank every residual-positive candidate first — at
 * 1 049 against the control's 1 156 `Top@1`, and the loss families share one property the failure probe then
 * showed directly: their ground truth carries **no failure record at all** (`docs/failure-containment-reach.md`).
 * A rule that may compare a candidate the channel never measured against one it did has no evidence about the
 * node it demotes, and `unexplainedFailures(undefined) = 0` reads that silence as a full explanation.
 *
 * So the reach is a switch with three states, and this file pins the three properties that make it one:
 *
 *   1. `'adjacent'` is the shipped traversal, bit for bit — the wide traversal may only be believed if the
 *      narrow one it generalises is unchanged;
 *   2. `'global'` reaches a pair the fusion placed apart, which is the reach the shipped pass cannot describe;
 *   3. `'global-measured'` refuses the pair whose CALLER the channel did not measure, and that refusal is the
 *      difference between the two wide states.
 *
 * The traversals share one predicate (`qualifies`), so the refusals — no rise, equal residuals, the degenerate
 * relay — are asserted under every scope: a scope that also changed the rule would confound the measurement it
 * exists to make.
 *
 * @module __tests__/unit/failure-containment-reach
 */

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';
import type {
  FailingEdge,
  FailureContainmentScope,
  FailureFlow,
} from '@agentix-e/micro-kinetic-tree';

import {
  applyFailureContainment,
  DEFAULT_FAILURE_CONTAINMENT_SCOPE,
  FAILURE_CONTAINMENT_SCOPES,
  failureEdgeKey,
  isFailureContainmentScope,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── Helpers ───────────────────────────────────────────────

/** One flow entry, as the 2×2 the pass reads. */
function flow(knownIn: number, knownOut: number, novelIn = 0, novelOut = 0): FailureFlow {
  return { knownIn, knownOut, novelIn, novelOut };
}

/** A failing-edge map from `[caller, callee, rise, novel?]` rows. */
function edges(
  rows: ReadonlyArray<readonly [string, string, number, number?]>,
): ReadonlyMap<string, FailingEdge> {
  return new Map(
    rows.map(([from, to, rise, novel]) => [
      failureEdgeKey(from, to),
      { rise, novel: novel ?? 0 } satisfies FailingEdge,
    ]),
  );
}

/**
 * Apply the pass and read the order back.
 *
 * @param ranking - Candidate ids, best first.
 * @param flows - The per-service flow map.
 * @param failingEdges - The edges that carried a net rise.
 * @param scope - Which reach to apply. Omitted means the shipped one.
 * @returns The order, as ids.
 */
function order(
  ranking: readonly string[],
  flows: ReadonlyMap<string, FailureFlow>,
  failingEdges: ReadonlyMap<string, FailingEdge>,
  scope?: FailureContainmentScope,
): string[] {
  return applyFailureContainment({
    ranking: ranking.map((service) => ({ service })),
    flows,
    failingEdges,
    ...(scope === undefined ? {} : { scope }),
  }).map((one) => one.service);
}

/**
 * A caller the channel measured whose own calls explain its inbound failures, and a callee whose failures they
 * do not: the pair the rule inverts. `barrier` is a candidate the channel never measured.
 */
const GRADIENT = new Map([
  ['caller', flow(400, 400)],
  ['callee', flow(500, 0)],
]);

const ONE_EDGE = edges([['caller', 'callee', 500]]);

// ── The states ────────────────────────────────────────────

describe('the scope switch', () => {
  it('ships at `adjacent` in the ENGINE, and the three states are a closed vocabulary', () => {
    // The engine default does not move with iteration 313's arm, and the reason is ownership rather than doubt:
    // the wide state reads 1 156 → 1 186 on the RCABench archive and is outcome-identical on the 735 RCAEval cases
    // across six protocols, so nothing measured argues against it — but an option has ONE default and the engine
    // owns it, so a runner-side copy would be a number published under a name its owner does not hold. The FSE'26
    // dispatch therefore STATES `--failure-containment-scope global-measured` on the invocation it runs, and its
    // artifact prints the token; this constant is what anything that does not ask reads.
    expect(DEFAULT_FAILURE_CONTAINMENT_SCOPE).toBe('adjacent');
    expect(FAILURE_CONTAINMENT_SCOPES).toEqual(['adjacent', 'global', 'global-measured']);
    for (const scope of FAILURE_CONTAINMENT_SCOPES)
      expect(isFailureContainmentScope(scope)).toBe(true);
  });

  it('recognises exactly the three scopes, and nothing else', () => {
    // A parser that mapped an unknown spelling onto the default would publish an arm's numbers under the
    // shipped configuration's name — the one failure the record cannot detect afterwards.
    for (const value of ['', 'glob', 'Adjacent', 'adjacent ', 'measured', null, undefined, 0, {}]) {
      expect(isFailureContainmentScope(value), String(value)).toBe(false);
    }
  });

  it('is the engine default when the scope is omitted', () => {
    // Omitted means the engine's default, which is the narrow traversal — and the wide readings stay reachable
    // only by asking for them. That is what makes the runner's default a separate, measurable decision.
    const explicit = order(['caller', 'x', 'callee'], GRADIENT, ONE_EDGE, 'adjacent');
    expect(order(['caller', 'x', 'callee'], GRADIENT, ONE_EDGE)).toStrictEqual(explicit);
    expect(explicit).toEqual(['caller', 'x', 'callee']);
  });
});

// ── Reach ─────────────────────────────────────────────────

describe('the reach the fusion hides', () => {
  it('leaves a pair the fusion placed apart alone under `adjacent`', () => {
    // The shipped pass is stated over NEIGHBOURS, so a correct inversion thirty positions away is invisible to
    // it. This is the case the wide scope exists for, asserted as a difference rather than described.
    expect(order(['caller', 'x', 'y', 'callee'], GRADIENT, ONE_EDGE, 'adjacent')).toEqual([
      'caller',
      'x',
      'y',
      'callee',
    ]);
  });

  it('lifts the callee to immediately above its caller under `global`', () => {
    // To the caller's position, not to the front: the pass states "this callee outranks this caller", never
    // "and everything between them" — the second claim is what iteration 313 measured at −107.
    expect(order(['caller', 'x', 'y', 'callee'], GRADIENT, ONE_EDGE, 'global')).toEqual([
      'callee',
      'caller',
      'x',
      'y',
    ]);
  });

  it('leaves a callee that already outranks its caller where it is', () => {
    const above = order(['callee', 'x', 'caller'], GRADIENT, ONE_EDGE, 'global');
    expect(above).toEqual(['callee', 'x', 'caller']);
    // Identity rather than coincidence: nothing qualifies, so nothing is spliced.
    expect(order(['callee', 'caller'], GRADIENT, ONE_EDGE, 'global')).toEqual(['callee', 'caller']);
  });

  it('reaches a fixed point, so one run can carry a lift past two callers', () => {
    // `top` calls `mid` calls `foot`, and each callee's failures are less explained than its caller's. The first
    // pass lifts `foot` above `mid` and then lifts `mid` above `top` (the `top → mid` pair is still the fusion's
    // adjacency, and its callee now sits at position 3); the second pass lifts `foot` again, past the caller it
    // has not yet passed. A single-pass traversal would stop at `[mid, top, foot]` and call it done.
    const flows = new Map([
      ['top', flow(100, 100)],
      ['mid', flow(200, 100)],
      ['foot', flow(300, 0)],
    ]);
    const chain = edges([
      ['top', 'mid', 100],
      ['mid', 'foot', 200],
    ]);
    expect(order(['top', 'mid', 'foot'], flows, chain, 'global')).toEqual(['foot', 'mid', 'top']);
  });

  it('keeps every candidate exactly once when the qualifying pairs form a cycle', () => {
    // A real call graph has no cycle, but a `failingEdges` map is data: a set that named both directions would
    // otherwise let two lifts swap one pair for ever. The pass is bounded by the candidate count, which is the
    // property this asserts — the multiset is preserved and the loop ends.
    const flows = new Map([
      ['a', flow(100, 100)],
      ['b', flow(200, 100)],
    ]);
    const bothWays = edges([
      ['a', 'b', 100],
      ['b', 'a', 100],
    ]);
    const out = order(['a', 'b', 'x'], flows, bothWays, 'global');
    expect([...out].sort()).toEqual(['a', 'b', 'x']);
    expect(out.length).toBe(3);
  });

  it('never mutates the ranking it was given', () => {
    const ranking = [{ service: 'caller' }, { service: 'callee' }];
    applyFailureContainment({ ranking, flows: GRADIENT, failingEdges: ONE_EDGE, scope: 'global' });
    expect(ranking.map((one) => one.service)).toEqual(['caller', 'callee']);
  });

  it('ignores an edge whose endpoints the ranking does not hold', () => {
    // The population is the INTERSECTION of the order and the edges, and a case can name a caller the pool
    // dropped. A reader that assumed both ends were present would splice at `-1`.
    expect(order(['caller'], GRADIENT, ONE_EDGE, 'global')).toEqual(['caller']);
  });

  it('ignores a key that is not one of its own', () => {
    // The key format belongs to `failureEdgeKey`; a map hand-built without the separator cannot name a pair,
    // and treating its halves as ids would compare two services no edge relates.
    const malformed = new Map<string, FailingEdge>([['callercallee', { rise: 500, novel: 0 }]]);
    expect(order(['caller', 'callee'], GRADIENT, malformed, 'global')).toEqual([
      'caller',
      'callee',
    ]);
  });
});

// ── Refusals, under every scope ───────────────────────────

describe('the refusals the scopes share', () => {
  it('refuses an edge that carried no rise', () => {
    const flat = edges([['caller', 'callee', 0]]);
    for (const scope of FAILURE_CONTAINMENT_SCOPES) {
      expect(order(['caller', 'callee'], GRADIENT, flat, scope), scope).toEqual([
        'caller',
        'callee',
      ]);
    }
  });

  it('refuses a pair whose residuals are equal, because the comparison is strict', () => {
    const tie = new Map([
      ['caller', flow(400, 400)],
      ['callee', flow(500, 500)],
    ]);
    for (const scope of FAILURE_CONTAINMENT_SCOPES) {
      expect(order(['caller', 'callee'], tie, ONE_EDGE, scope), scope).toEqual([
        'caller',
        'callee',
      ]);
    }
  });

  it('refuses the degenerate relay under `global` as it does under `adjacent`', () => {
    // One count travelling down one chain: the callee's inbound rise is the edge, the caller's outbound rise is
    // the edge, and the caller's inbound rise is the same number. The residual asymmetry is an artefact of
    // where the chain stops, and the wide scope must not become a way to read it as a source.
    const relay = new Map([
      ['caller', flow(500, 500)],
      ['callee', flow(500, 0)],
    ]);
    for (const scope of FAILURE_CONTAINMENT_SCOPES) {
      expect(order(['caller', 'x', 'callee'], relay, ONE_EDGE, scope), scope).toEqual([
        'caller',
        'x',
        'callee',
      ]);
    }
  });
});

// ── The evidence guard ────────────────────────────────────

describe('the candidate the channel never measured', () => {
  // The caller has NO flow row — silence, which `unexplainedFailures` reads as zero — and the callee's residual
  // is positive. Unguarded, the pair qualifies and the silence is demoted; guarded, it is refused.
  const silentCaller = new Map([['callee', flow(500, 0)]]);

  it('is demoted by `global`, which is the defect the guard exists for', () => {
    expect(order(['caller', 'callee'], silentCaller, ONE_EDGE, 'global')).toEqual([
      'callee',
      'caller',
    ]);
  });

  it('is refused by `global-measured`, on either side of the pair', () => {
    expect(order(['caller', 'callee'], silentCaller, ONE_EDGE, 'global-measured')).toEqual([
      'caller',
      'callee',
    ]);
    const silentCallee = new Map([['caller', flow(400, 400)]]);
    expect(order(['caller', 'callee'], silentCallee, ONE_EDGE, 'global-measured')).toEqual([
      'caller',
      'callee',
    ]);
  });

  it('does not stop the guard from lifting a pair it DID measure', () => {
    // The guard is about presence, not about magnitude: with both ends measured the wide scope still acts, which
    // is what makes it a guard rather than a second, quieter `adjacent`.
    expect(order(['caller', 'x', 'callee'], GRADIENT, ONE_EDGE, 'global-measured')).toEqual([
      'callee',
      'caller',
      'x',
    ]);
  });
});

// ── The engine, under each scope ──────────────────────────

function series(label: string, values: readonly number[]): TimeSeries {
  return {
    label,
    timestamps: values.map((_, i) => i * 60_000),
    values: new Float64Array(values),
    unit: 'ms',
  };
}

/**
 * Five services: `c` calls `a` calls `b`, `d` calls `b`, and `e` is a bystander on no failing edge.
 *
 * `e` exists for one reason: the fusion has to be able to place a candidate BETWEEN the caller and the callee,
 * because that is the population `'adjacent'` cannot describe. The deviations are ordered `a > e > b > c > d`, so
 * the fusion publishes `a, e, b, c, d` and the correct inversion is between positions 1 and 3.
 *
 * The failed-edge TERM is pinned to 0 for the same reason the bystander exists: at its shipped weight the term
 * credits `b` with 500 failed calls arriving at it and the fusion already answers `b, a, …`, which would leave the
 * reach with nothing to do and the fixture unable to tell the three scopes apart. The FLOWS are carried on the
 * graph regardless of the weight — that is a measurement, and the term's weight is a decision.
 */
function relayFixture(): { callGraph: ServiceCallGraph; metrics: MetricMap; injectTimeMs: number } {
  const nodes = new Map<string, ServiceNode>(
    ['a', 'b', 'c', 'd', 'e'].map((id) => [id, { id, name: id, namespace: 'default', labels: {} }]),
  );
  const pairs: ReadonlyArray<readonly [string, string]> = [
    ['a', 'b'],
    ['c', 'a'],
    ['d', 'b'],
    ['c', 'e'],
  ];
  const callGraph: ServiceCallGraph = {
    nodes,
    edges: pairs.map(([from, to]): CallEdge => ({
      from,
      to,
      type: 'REST',
      callRate: 100,
      p99Latency: 10,
      errorRate: 0.01,
    })),
    systemLoad: 0.3,
  };
  const metrics: MetricMap = new Map([
    ['a', [series('cpu', [10, 10, 10, 10, 10, 100, 100, 100, 100, 100])]],
    ['e', [series('cpu', [10, 10, 10, 10, 10, 50, 50, 50, 50, 50])]],
    ['b', [series('cpu', [10, 10, 10, 10, 10, 12, 12, 12, 12, 12])]],
    ['c', [series('cpu', [10, 10, 10, 10, 10, 11, 11, 11, 11, 11])]],
    ['d', [series('cpu', [10, 10, 10, 10, 10, 10.5, 10.5, 10.5, 10.5, 10.5])]],
  ]);
  return { callGraph, metrics, injectTimeMs: 300_000 };
}

const RELAY_FAILURES = [
  { caller: 'c', callee: 'a', failed: 200, baseline: 0 },
  { caller: 'a', callee: 'b', failed: 200, baseline: 0 },
  { caller: 'd', callee: 'b', failed: 300, baseline: 0 },
];

/**
 * Run the engine on {@link relayFixture} under one scope and read the published order.
 *
 * @param scope - Which reach the engine should apply.
 * @returns The published service order.
 */
function engineOrder(scope: FailureContainmentScope): string[] {
  const { callGraph, metrics, injectTimeMs } = relayFixture();
  const pruner = new TreePruner({
    failureContainment: true,
    failureContainmentScope: scope,
    failedEdgeWeight: 0,
  });
  const graph = pruner.buildFaultGraph(callGraph, metrics, {
    injectTimeMs,
    failedTraceEdges: RELAY_FAILURES,
  });
  return pruner.analyze(graph, 5).map((one) => one.serviceId);
}

describe('the engine under each scope', () => {
  it('publishes the fusion order when the pair is apart and the scope is adjacent', () => {
    // The fusion orders on deviation alone here (`a > e > b > c > d`); the shipped pass reads neighbours only and
    // has nothing to say about a pair three positions apart.
    expect(engineOrder('adjacent')).toEqual(['a', 'e', 'b', 'c', 'd']);
  });

  it('lifts the callee the fusion buried when the scope is wide', () => {
    // And the reach is the ONLY difference: the same flows, the same call graph, the same refusals — `b` rises
    // from position 3 to 1, and `e` keeps its place behind the caller it was never related to.
    for (const scope of ['global', 'global-measured'] as const) {
      expect(engineOrder(scope), scope).toEqual(['b', 'a', 'e', 'c', 'd']);
    }
  });

  it('renumbers the published rank after a lift', () => {
    const { callGraph, metrics, injectTimeMs } = relayFixture();
    const pruner = new TreePruner({
      failureContainment: true,
      failureContainmentScope: 'global',
      failedEdgeWeight: 0,
    });
    const graph = pruner.buildFaultGraph(callGraph, metrics, {
      injectTimeMs,
      failedTraceEdges: RELAY_FAILURES,
    });
    const results = pruner.analyze(graph, 5);
    expect(results.map((one) => one.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(results[0]!.serviceId).toBe('b');
  });
});
