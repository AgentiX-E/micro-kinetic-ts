/**
 * The deduction's THIRD admission question: did THIS edge carry the explanation?
 *
 * ## The defect this measures
 *
 * Everything `deductExplainedAnomalies` decides is decided by one vocabulary test — `isResponseChannel` on a
 * metric label. It is the right test where the telemetry names responses and it is unavailable where it does
 * not: FSE'26 records 87 metric names and every one is `container.*` or `k8s.*`, so `external` scope's two
 * predicates are false for every node of every case, the operator returns its input unchanged, and four knobs
 * (weight, gate, scope, closure) have been refused on two corpora without any of them moving a byte. Four
 * refusals, one cause: the channel does not exist in that telemetry.
 *
 * The channel exists in the TRACE. `traceEdgeLatency` records, per edge, the mean span duration before and
 * after the injection as measured by the caller, and an edge that multiplied is a response that degraded —
 * observed rather than named. `edgeLatencyRises` is that array aligned with the call graph, and `topoEdgeRise`
 * is the threshold at which it may stand in for the channel:
 *
 *     explainsThrough(v → c) ⇐ isResponseChannel(dominant(c))  OR  rise(v → c) ≥ θ
 *     deductibleOn(v)        ⇐ isResponseChannel(dominant(v))  OR  max out-rise(v) ≥ θ
 *
 * ## The five distinctions these tests exist to hold apart
 *
 * 1. **An absent measurement is not a rise.** `NaN` marks an edge the dump never mentioned, and `NaN >= θ` is
 *    false for every θ — which is what makes the operator inert on a corpus that records no span durations
 *    (every RCAEval case) rather than merely untuned there.
 * 2. **The callee side reads THE EDGE and the caller side reads a MAXIMUM.** They ask different questions of
 *    one array. "Did this call degrade" cannot be answered by a maximum over the caller's other calls, and
 *    "is this reading partly somebody else's work" is settled by any one of them.
 * 3. **One measurement relaxes BOTH sides.** The arm was first written with the callee side alone, and on a
 *    `container.*` corpus that version cannot fire: `deductibleOn` is false for every node and the operator is
 *    inert again. A predicate that cannot fire is a spelling, not an arm.
 * 4. **`null` is the shipped reading and is inert by construction.** Not by the accumulator happening to
 *    abstain: the predicate is not consulted, the array is not walked, and the output map is the one the
 *    channel predicate produced.
 * 5. **The threshold is a POSITIVE number or nothing.** Zero would admit every edge the dump mentions,
 *    including the ones that got faster, which is the opposite of the physical statement; `NaN` would make
 *    every comparison false while the configuration line reported the arm on.
 *
 * The source fence at the bottom pins the two asymmetries a behavioural test could satisfy by accident: which
 * side reads the edge, which side reads the maximum, and that a shipped run does no work for a predicate it
 * never consults.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CallEdge, FaultEdgeLatency, ServiceId } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOPO_EDGE_RISE,
  TreePruner,
  deductExplainedAnomalies,
  formatTopoEdgeRise,
  parseTopoEdgeRise,
  type TopoDeductionInput,
  type TopoEdgeRise,
} from '../../src/index.js';
import { computeEdgeLatencyRises } from '../../src/pruning/ranking-signals.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A metric label no call boundary carries — the FSE'26 vocabulary in miniature. */
const RESOURCE = 'container_cpu_usage_seconds_total';
/** A label a call boundary does carry, for the fixtures that need the channel predicate to say yes. */
const RESPONSE = 'latency-90';

/** An edge with the only three fields the deduction reads, filled to the type. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/** One row of the dump, in the units `postMeanMs / preMeanMs` is read in. */
function row(caller: string, callee: string, pre: number, post: number): FaultEdgeLatency {
  return { caller, callee, preMeanMs: pre, postMeanMs: post };
}

/**
 * An input whose every node carries the SAME dominant label, with rises aligned to its edges.
 *
 * The label is the fixture's one degree of freedom: `RESOURCE` is the corpus where the operator is inert and
 * the arm exists, `RESPONSE` is the corpus where the channel predicate already works and the arm must add
 * nothing. Everything else — the edges, the anomalies, the weights — is held fixed so a reading difference can
 * only come from the threshold.
 *
 * @param anomalies - Pre-deduction anomalies, in deviation space.
 * @param edges - The call edges to explain through.
 * @param rises - One value per edge, or `undefined` for a case that measured nothing at all.
 * @param label - The dominant metric label every node carries.
 * @param weight - The propagation weight on every edge.
 * @returns An input the deduction accepts.
 */
function inputOf(
  anomalies: Record<string, number>,
  edges: readonly CallEdge[],
  rises: readonly number[] | undefined,
  label = RESOURCE,
  weight = 1,
): TopoDeductionInput {
  const dominantMetrics = new Map<ServiceId, { label: string }>();
  for (const node of Object.keys(anomalies)) dominantMetrics.set(node, { label });
  for (const node of edges.flatMap((entry) => [entry.from, entry.to])) {
    if (!dominantMetrics.has(node)) dominantMetrics.set(node, { label });
  }
  return {
    anomalies: new Map(Object.entries(anomalies)) as Map<ServiceId, number>,
    edges,
    propagationWeights: Float64Array.from(edges.map(() => weight)),
    dominantMetrics,
    edgeLatencyRises: rises === undefined ? undefined : Float64Array.from(rises),
  };
}

/**
 * The axis a bare number names, spelled once.
 *
 * Most fixtures below test the MAGNITUDE, and `2` reads as the magnitude while `{ threshold: 2, against:
 * 'absolute' }` reads as a data structure. The conversion lives here rather than at twenty call sites, and the
 * fixtures that are about the axis itself spell it in full.
 */
const asAxis = (threshold: TopoEdgeRise | number | null): TopoEdgeRise | null =>
  typeof threshold === 'number' ? { threshold, against: 'absolute' } : threshold;

/** The ratio reading: an edge must rise by this multiple of the CALLER's own inbound rise. */
const inbound = (threshold: number): TopoEdgeRise => ({ threshold, against: 'inbound' });

/** The deduction at the maximal weight and the ungated reading, so a charge is visible as a zeroed caller. */
const charged = (
  input: TopoDeductionInput,
  threshold: TopoEdgeRise | number | null,
  scope: 'all' | 'external' | 'caller' = 'external',
): number =>
  deductExplainedAnomalies(input, 1, scope, 0, 'max', 'off', asAxis(threshold)).discounted.get(
    'caller',
  )!;

describe('computeEdgeLatencyRises — the array, and the three things it refuses to invent', () => {
  const callEdges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];

  it('is absent when the case measured nothing, which is every RCAEval case', () => {
    // `undefined` rather than a zero-filled array: an array of zeroes is the claim "every edge was measured
    // and none of them rose", and a corpus that records no span durations did not measure anything. The
    // difference is the whole of the golden half's inertness.
    expect(computeEdgeLatencyRises(undefined, callEdges)).toBeUndefined();
    expect(computeEdgeLatencyRises([], callEdges)).toBeUndefined();
  });

  it('is indexed by the CALL GRAPH, not by the order the dump happened to write', () => {
    // The array's contract is alignment with `edges`, because the deduction reads `rises[i]` inside the loop
    // it is already running. A dump written in another order — which nothing forbids — must produce the same
    // array, and the assertion is on positions rather than on a sorted view of the values.
    const written = [row('a', 'c', 1, 9), row('a', 'b', 1, 4), row('b', 'c', 1, 2)];
    const rises = computeEdgeLatencyRises(written, callEdges)!;
    expect([...rises]).toEqual([4, 2, 9]);
  });

  it('reads NaN on an edge the dump does not mention, rather than a zero', () => {
    // A zero is a measured DECREASE, and an unmeasured edge is not one. The distinction is load-bearing
    // because the admission test is a `>=`: a fabricated zero would sit below every threshold and be
    // indistinguishable from a real drop, so a consumer could not report the difference to a reader.
    const rises = computeEdgeLatencyRises([row('a', 'b', 1, 4)], callEdges)!;
    expect(rises[0]).toBe(4);
    expect(Number.isNaN(rises[1]!)).toBe(true);
    expect(Number.isNaN(rises[2]!)).toBe(true);
  });

  it('keeps the LARGEST of two rows for one pair, on the inbound aggregation’s rule', () => {
    // The dump can carry one row per observed window. Averaging a sustained rise against identical repeats
    // would dilute the measurement that matters, which is the reason `aggregateInboundLatency` takes a max.
    const rises = computeEdgeLatencyRises([row('a', 'b', 1, 3), row('a', 'b', 2, 40)], callEdges)!;
    expect(rises[0]).toBe(20);
  });

  it('drops a row whose baseline is zero instead of storing Infinity', () => {
    // `post / 0` is not a rise; it is a division that did not happen. Storing it would satisfy `>= θ` for
    // every θ and admit an edge no measurement supports — the loudest possible defect, because it would look
    // like the strongest possible evidence.
    const rises = computeEdgeLatencyRises([row('a', 'b', 0, 500)], callEdges)!;
    expect(Number.isNaN(rises[0]!)).toBe(true);
  });

  it('keeps a rise below one, because a response that got FASTER is a measurement', () => {
    const rises = computeEdgeLatencyRises([row('a', 'b', 10, 1)], callEdges)!;
    expect(rises[0]).toBeCloseTo(0.1, 12);
  });

  it('separates pairs a concatenated key would join', () => {
    // `a->b` + `c` and `a` + `b->c` are different edges and the same string under a `'->'` join. The
    // separator is a character no service id can carry, and this is the fixture that would fail without it.
    const collided = [edge('a->b', 'c'), edge('a', 'b->c')];
    const rises = computeEdgeLatencyRises([row('a->b', 'c', 1, 7)], collided)!;
    expect(rises[0]).toBe(7);
    expect(Number.isNaN(rises[1]!)).toBe(true);
  });
});

describe('the shipped reading, which consults no edge', () => {
  const edges = [edge('caller', 'callee')];

  it('leaves a resource-only corpus alone, which is the state the arm exists to repair', () => {
    // The load-bearing negative: `external` scope's channel predicate is false for both nodes, so nothing is
    // admitted and the caller keeps its whole anomaly. This is the published behaviour on FSE'26 and the
    // reading the arm is measured against.
    expect(charged(inputOf({ caller: 2, callee: 1 }, edges, [500]), null)).toBe(2);
  });

  it('does not read the rises at all, so a permutation of them cannot move the output', () => {
    // The `null` branch is not "the threshold happened to be above every rise": it is "the array is never
    // walked". Permuting the rises on a graph with two callees changes nothing, and that is the assertion
    // that separates an inert default from a small one.
    const two = [edge('caller', 'left'), edge('caller', 'right')];
    const anomalies = { caller: 2, left: 1, right: 1 };
    const first = deductExplainedAnomalies(
      inputOf(anomalies, two, [500, 0.1]),
      1,
      'external',
      0,
      'max',
      'off',
      null,
    );
    const second = deductExplainedAnomalies(
      inputOf(anomalies, two, [0.1, 500]),
      1,
      'external',
      0,
      'max',
      'off',
      null,
    );
    expect([...first.discounted]).toEqual([...second.discounted]);
    // …and the reading is the channel predicate's, not the edge's: `RESOURCE` admits nothing.
    expect(first.discounted.get('caller')).toBe(2);
  });

  it('ships as `null`, so a flag nobody passes reproduces a published configuration', () => {
    expect(DEFAULT_TOPO_EDGE_RISE).toBeNull();
  });
});

describe('the callee side — THIS edge, and not the caller’s other edges', () => {
  const edges = [edge('caller', 'left'), edge('caller', 'right')];
  const anomalies = { caller: 3, left: 1, right: 1 };

  it('admits a callee whose channel is internal when its own edge rose', () => {
    // The corpus's shape: no response channel anywhere, and a call that multiplied. At `max` closure the
    // largest admissible explanation is 1, so the caller loses it.
    expect(charged(inputOf(anomalies, edges, [500, 1]), 2)).toBe(2);
  });

  it('refuses a callee whose own edge did not rise, even when the caller has another edge that did', () => {
    // The distinction a per-caller maximum would erase. Only `left` rose, so only `left` may explain; at
    // `max` closure the charge is `left`'s 1 either way — which is why the assertion is on the SHARE, the
    // quantity that names WHICH callee was admitted.
    const result = deductExplainedAnomalies(
      inputOf(anomalies, edges, [500, 1]),
      1,
      'external',
      0,
      'max',
      'off',
      asAxis(2),
    );
    expect(result.share.get('caller')).toBeCloseTo(1 / 3, 12);
    // `right` alone, with both thresholds: nothing admissible, so the caller keeps everything.
    const flat = deductExplainedAnomalies(
      inputOf(anomalies, edges, [1, 1]),
      1,
      'external',
      0,
      'max',
      'off',
      asAxis(2),
    );
    expect(flat.discounted.get('caller')).toBe(3);
    // The share is ABSENT rather than zero: `deductibleOn` refused the node, so the operator never asked how
    // much of it was explained. That is the distinction `TopoDeductionResult` documents — a 0 would be a
    // measured reading ("its callees accounted for none of it"), and this node was not measured at all.
    expect(flat.share.has('caller')).toBe(false);
  });

  it('admits on `>=` and refuses one part in a thousand below it', () => {
    // The boundary belongs to the number rather than to a rounding: a rise of exactly θ admits, because the
    // statement is "at least doubled". A `<` here would make the threshold's own value the one value that
    // fails it, which is the sort of off-by-one a grid over θ = 2, 4, 8 would never show.
    expect(charged(inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], [2]), 2)).toBe(1);
    expect(charged(inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], [1.999]), 2)).toBe(
      2,
    );
  });
});

describe('the caller side — one measurement, both questions', () => {
  const edges = [edge('caller', 'callee')];

  it('charges a resource-channel caller that waited on a risen edge', () => {
    // Without this half the arm cannot fire on a `container.*` corpus at all: `deductibleOn` would be false
    // for the caller and the operator would return its input however loud the callee's edge was. The fixture
    // is the shipped arm's own failure mode, asserted as a refusal rather than described in a comment.
    expect(charged(inputOf({ caller: 2, callee: 1 }, edges, [500]), null)).toBe(2);
    expect(charged(inputOf({ caller: 2, callee: 1 }, edges, [500]), 2)).toBe(1);
  });

  it('reads the MAXIMUM over the caller’s out-edges, because the question is not which callee', () => {
    // "Is this node's reading partly somebody else's work" is settled by any one degraded response, and the
    // identity of that callee is not part of the question. `right` is the one that rose; the caller must still
    // be deductible, and the charge is `right`'s own contribution.
    const two = [edge('caller', 'left'), edge('caller', 'right')];
    expect(charged(inputOf({ caller: 3, left: 1, right: 2 }, two, [1, 500]), 2)).toBe(1);
  });

  it('refuses when no out-edge rose, so a caller with nothing to wait for keeps its anomaly', () => {
    expect(charged(inputOf({ caller: 2, callee: 1 }, edges, [1.2]), 2)).toBe(2);
  });

  it('is inert on a node with no out-edges at all', () => {
    // A leaf cannot have waited for anyone, and the arm may not invent a reason to charge it either.
    const input = inputOf({ caller: 2, callee: 1 }, edges, [500]);
    const stray = { ...input, anomalies: new Map([['sink', 5]]) as Map<ServiceId, number> };
    expect(
      deductExplainedAnomalies(stray, 1, 'external', 0, 'max', 'off', asAxis(2)).discounted.get(
        'sink',
      ),
    ).toBe(5);
  });
});

describe('on a corpus the channel predicate can already answer', () => {
  it('charges exactly what it charged at `null`, so the arm is a superset and not a swap', () => {
    // The regression this guards is the quiet one: a threshold that ADMITS nothing new can still REFUSE
    // something old, if it is written as an alternative rather than as an addition. On a response-channel
    // corpus the operator already works, so the arm must be invisible there — a rise of 1 (no rise at all) at
    // θ = 2 changes nothing, and the two readings are the same number for the same reason.
    const input = inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], [1], RESPONSE);
    expect(charged(input, 2)).toBe(charged(input, null));
    expect(charged(input, 2)).toBe(1);
  });
});

describe('the inbound divisor — the queueing split, which the absolute form cannot make', () => {
  // A caller's response time is its own work PLUS the waiting. If the fault is at the caller, both rise; if it
  // is at a callee, only the waiting does. `against: 'absolute'` cannot tell those apart and was measured and
  // refused for it (`docs/closed-axes-register.md` §317): on the 37 cases it moved, the charged node's out-rise
  // was ~200x where the charge was right and ~4x where it was wrong, because the corpus's ambient rise varies
  // by two orders of magnitude between cases. The ratio is the same fact in the units the case provides.

  it('charges a caller that waited far longer than it was waited on', () => {
    // Two edges: `gateway → caller` at 2x (this node's own response barely moved) and `caller → callee` at
    // 400x. The caller waited 200 times longer than it was waited on, so its rise is a dependent's.
    const edges = [edge('gateway', 'caller'), edge('caller', 'callee')];
    const input = inputOf({ gateway: 1, caller: 3, callee: 1 }, edges, [2, 400]);
    expect(charged(input, inbound(2))).toBe(2);
  });

  it('refuses a caller whose own response moved as much as its waiting did', () => {
    // The loss class's shape: a network fault at the node multiplies BOTH directions, so the ratio is ~1 and
    // the node is a victim of nothing. Charging it is what the absolute arm did 19 times and the truth paid
    // for — every one of its losses was a `1 -> k`.
    const edges = [edge('gateway', 'caller'), edge('caller', 'callee')];
    const input = inputOf({ gateway: 1, caller: 3, callee: 1 }, edges, [4, 4]);
    expect(charged(input, inbound(2))).toBe(3);
    // …and the ABSOLUTE form charges it, which is the difference between the two readings on one fixture.
    expect(charged(input, 2)).toBe(2);
  });

  it('refuses a node nothing was seen waiting on, because an absent divisor is not one', () => {
    // Fourteen of the nineteen wrong charges in the absolute arm's census were nodes with an out-edge and no
    // inbound measurement at all. `undefined` here must not read as the unit baseline: a node the corpus never
    // measured as a callee has not been shown to be a victim, and dividing by one would charge it on the
    // strength of a measurement that does not exist.
    const input = inputOf({ caller: 3, callee: 1 }, [edge('caller', 'callee')], [400]);
    expect(charged(input, inbound(2))).toBe(3);
    expect(charged(input, 2)).toBe(2);
  });

  it('applies the same divisor to the CALLEE side, because the caller is the same node', () => {
    // The edge `v → c` may explain `v` only if `v`'s waiting dominates `v`'s own response — the condition is a
    // property of the caller, so the two sides cannot disagree about it. `gateway` is the callee here and its
    // own inbound is 1x, so the edge `caller → gateway` clears a ratio of 2 and the charge lands.
    const edges = [edge('lb', 'gateway'), edge('gateway', 'caller'), edge('caller', 'callee')];
    const input = inputOf({ lb: 1, gateway: 3, caller: 3, callee: 1 }, edges, [1, 2, 40]);
    const result = deductExplainedAnomalies(input, 1, 'external', 0, 'max', 'off', inbound(2));
    // `gateway` waited 2x and was waited on 1x (ratio 2, admitted at the boundary), and `caller` waited 40x on
    // 2x — so the edge `gateway → caller` may explain `gateway`, and its 3 units account for all of them.
    expect(result.share.get('gateway')).toBeCloseTo(1, 12);
    expect(result.discounted.get('gateway')).toBe(0);
    // `lb`, by contrast, was waited on 1x and waited on nothing: it has no out-edge to admit, so it keeps its
    // anomaly even though its own reading is the smallest on the graph.
    expect(result.discounted.get('lb')).toBe(1);
  });
});

describe('the axis’s spelling — one reader, one renderer', () => {
  it('reads a bare number as the absolute form and a suffix as the divisor', () => {
    expect(parseTopoEdgeRise('2')).toEqual({ threshold: 2, against: 'absolute' });
    expect(parseTopoEdgeRise('2.5')).toEqual({ threshold: 2.5, against: 'absolute' });
    expect(parseTopoEdgeRise('2:inbound')).toEqual({ threshold: 2, against: 'inbound' });
    expect(parseTopoEdgeRise('1e-9')).toEqual({ threshold: 1e-9, against: 'absolute' });
  });

  it('refuses a zero, a negative, a word and a malformed suffix', () => {
    // Every one of these would otherwise configure an axis the operator cannot honour: zero admits edges that
    // got faster, a word is not a threshold, and a second colon is a spelling nobody declared.
    for (const bad of ['0', '-1', 'x', '', '2:', ':inbound', '2:foo', '2:inbound:3', 'NaN']) {
      expect(parseTopoEdgeRise(bad), bad).toBeNull();
    }
  });

  it('round-trips through the renderer, which is what a configuration line needs', () => {
    expect(formatTopoEdgeRise(null)).toBe('');
    expect(formatTopoEdgeRise({ threshold: 2, against: 'absolute' })).toBe('2');
    expect(formatTopoEdgeRise({ threshold: 2, against: 'inbound' })).toBe('2:inbound');
    for (const axis of [2, 2.5, 1e-9]) {
      const parsed = parseTopoEdgeRise(String(axis))!;
      expect(parseTopoEdgeRise(formatTopoEdgeRise(parsed))).toEqual(parsed);
    }
  });
});

describe('the two scopes that were already free', () => {
  const edges = [edge('caller', 'callee')];
  const anomalies = { caller: 2, callee: 1 };

  it('cannot change the `all` scope, which admits both sides for every channel', () => {
    // `all` asks the channel question nowhere, so the threshold has nothing to add. Asserting equality
    // rather than "both are 1" is what says the arm is a RELAXATION of `external` and not a third reading of
    // `all` — the distinction `docs/topo-discount-scope.md` §7 draws between a scope and a weight.
    const off = deductExplainedAnomalies(
      inputOf(anomalies, edges, [1]),
      1,
      'all',
      0,
      'max',
      'off',
      null,
    );
    const on = deductExplainedAnomalies(
      inputOf(anomalies, edges, [1]),
      1,
      'all',
      0,
      'max',
      'off',
      asAxis(2),
    );
    expect([...on.discounted]).toEqual([...off.discounted]);
  });

  it('extends `caller`, whose callee side is free and whose caller side is the arm’s second half', () => {
    // `caller` already lets an internal callee explain a response caller; what it refuses is an internal
    // CALLER. On a resource-only corpus that refusal is total, and the threshold is the only thing that lifts
    // it — which is why the arm is stated as a predicate over BOTH sides rather than over the callee's.
    expect(charged(inputOf(anomalies, edges, [500]), 2, 'caller')).toBe(1);
    expect(charged(inputOf(anomalies, edges, [500]), null, 'caller')).toBe(2);
  });
});

describe('the absences', () => {
  it('is inert when the case recorded no per-edge measurement, whatever the threshold', () => {
    // P3 of the pre-registration as a test rather than as an argument: RCAEval carries no span durations, so
    // `edgeLatencyRises` is undefined on all 735 cases and the predicate is unreachable. A threshold of 1e-9
    // is the strongest form of the assertion — no admissible threshold can reach a measurement that is not
    // there.
    const input = inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], undefined);
    expect(
      deductExplainedAnomalies(input, 1, 'external', 0, 'max', 'off', asAxis(1e-9)).discounted.get(
        'caller',
      ),
    ).toBe(2);
  });

  it('refuses an unmeasured edge at any threshold, because NaN is below every number', () => {
    const input = inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], [Number.NaN]);
    expect(
      deductExplainedAnomalies(input, 1, 'external', 0, 'max', 'off', asAxis(1e-9)).discounted.get(
        'caller',
      ),
    ).toBe(2);
  });

  it('leaves a callee with no anomaly explained by nobody', () => {
    // The threshold admits edges, not callees. A silent node on an edge that multiplied still explains
    // nothing, because what explains is the anomaly and the edge only licenses the credit.
    expect(charged(inputOf({ caller: 2, callee: 0 }, [edge('caller', 'callee')], [500]), 2)).toBe(
      2,
    );
  });
});

describe('the threshold is a positive number or nothing', () => {
  const input = inputOf({ caller: 2, callee: 1 }, [edge('caller', 'callee')], [500]);

  it('refuses zero, a negative value, NaN and a non-finite one', () => {
    // Zero would admit every edge the dump mentions, including the ones that got faster — the opposite of the
    // physical statement — and NaN would make every comparison false while a configuration line reported the
    // arm on. Both are configuration defects with no execution path to a wrong number, so they must be loud.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        () => deductExplainedAnomalies(input, 1, 'external', 0, 'max', 'off', asAxis(bad)),
        String(bad),
      ).toThrow(/topoEdgeRise/);
    }
  });

  it('refuses a rise vector that is not aligned with the edges', () => {
    // A short array reads `undefined` at the tail, which the admission test turns into "did not rise" — an
    // arm that silently stops admitting halfway through a graph. The contract is checked where it is stated,
    // as the weight vector's is.
    const misaligned = { ...input, edgeLatencyRises: Float64Array.from([500, 500]) };
    expect(() =>
      deductExplainedAnomalies(misaligned, 1, 'external', 0, 'max', 'off', asAxis(2)),
    ).toThrow(/edgeLatencyRises/);
  });
});

describe('the gate and the share still decide, on the admitted population', () => {
  const edges = [edge('caller', 'callee')];

  it('charges only a mostly-explained node, and reports the share either way', () => {
    // The gate is orthogonal to the arm and must stay so: a threshold that admitted an edge whose callee
    // explains a sixth of the caller still may not charge it at `gate = 1`. The share is reported on the
    // refused node too, which is the instrument the gate's arm is read through.
    const input = inputOf({ caller: 6, callee: 1 }, edges, [500]);
    const refused = deductExplainedAnomalies(input, 1, 'external', 1, 'max', 'off', asAxis(2));
    expect(refused.discounted.get('caller')).toBe(6);
    expect(refused.share.get('caller')).toBeCloseTo(1 / 6, 12);
    const admitted = deductExplainedAnomalies(input, 1, 'external', 0, 'max', 'off', asAxis(2));
    expect(admitted.discounted.get('caller')).toBe(5);
  });

  it('keeps a `sum` closure additive over the edges the threshold admitted', () => {
    // The closure and the threshold compose the way they must: `sum` adds the admitted terms, so admitting a
    // second callee is worth its weight and not a re-reading of the first. A predicate that replaced the
    // aggregation rather than gating it would show here.
    const two = [edge('caller', 'left'), edge('caller', 'right')];
    const input = inputOf({ caller: 3, left: 1, right: 1 }, two, [500, 500]);
    const summed = deductExplainedAnomalies(input, 1, 'external', 0, 'sum', 'off', asAxis(2));
    expect(summed.discounted.get('caller')).toBe(1);
  });
});

describe('the two asymmetries, fenced at the source', () => {
  const deduction = readFileSync(resolve(HERE, '../../src/causal/topo-deduction.ts'), 'utf8');
  const pruner = readFileSync(resolve(HERE, '../../src/pruning/pruner.ts'), 'utf8');

  it('asks the callee side about THE EDGE and the caller side about a MAXIMUM', () => {
    // A swapped pair would compile and pass every single-edge fixture in this file — both sides would read
    // the same number on a chain. The difference is visible only on a fan-out, which is exactly the shape the
    // census found (41 of 93 near misses won by two orchestrators), so the pairing is pinned as text.
    expect(deduction).toMatch(/const explainsThrough = \(edge: CallEdge, index: number\)/);
    expect(deduction).toMatch(/admitted\(edge\.from, riseOf\(index\)\)/);
    expect(deduction).toMatch(/const maxOutRise = new Map<ServiceId, number>\(\)/);
    expect(deduction).toMatch(/keepLargest\(maxOutRise, input\.edges\[i\]!\.from, rise\)/);
    expect(deduction).toMatch(/const out = maxOutRise\.get\(nodeId\)/);
  });

  it('relaxes BOTH sides, which one predicate alone does not', () => {
    // The arm's first form relaxed the callee side and nothing else, and on a `container.*` corpus that form
    // is inert — a predicate that cannot fire. The two relaxations are one measurement, and the source keeps
    // them adjacent so a reader cannot drop one without seeing the other.
    expect(deduction).toMatch(/return isResponseChannelOf\(edge\.to\) \|\| admitted\(edge\.from/);
    expect(deduction).toMatch(/return isResponseChannelOf\(nodeId\) \|\| waitedOn\(nodeId\)/);
    // ONE admission test for both sides, so a second spelling of "the edge cleared the threshold" cannot
    // appear: the callee side calls it with the edge's own rise, the caller side with the node's maximum.
    expect(deduction).toMatch(
      /const admitted = \(nodeId: ServiceId, rise: number\): boolean => \{/,
    );
    expect(deduction).toMatch(
      /const against = edgeRise\.against === 'inbound' \? maxInRise\.get\(nodeId\) : 1;/,
    );
    expect(deduction).toMatch(/if \(against === undefined\) return false;/);
  });

  it('does no work for the array when the shipped reading is in force', () => {
    // `null` must cost nothing, which is the standard `topoDiscountGate = 0` is held to: the scan that builds
    // the caller-side maximum is guarded, so a shipped run walks no array it never consults.
    expect(deduction).toMatch(/if \(edgeRise !== null\) \{/);
  });

  it('derives the array in the PRUNER, from the case, not in the operator', () => {
    // The array is a property of the CASE and the threshold is a property of the RUN. Building it inside the
    // operator would make a graph built once depend on the run that read it, and an artifact could then
    // disagree with a re-analysis of the same artifact about what the case contained.
    expect(pruner).toMatch(
      /const edgeLatencyRises = computeEdgeLatencyRises\(options\?\.edgeLatency, topologyGraph\.edges\)/,
    );
    expect(pruner).toMatch(/edgeLatencyRises: graph\.edgeLatencyRises/);
    expect(pruner).toMatch(/this\.options\.topoEdgeRise/);
  });
});

describe('the graph carries the array, so an artifact and a re-analysis agree', () => {
  /** A three-node chain: the smallest graph on which the alignment can be read positionally. */
  const chain = {
    nodes: new Map([
      ['a', { id: 'a', name: 'a', namespace: 'default', labels: {} }],
      ['b', { id: 'b', name: 'b', namespace: 'default', labels: {} }],
      ['c', { id: 'c', name: 'c', namespace: 'default', labels: {} }],
    ]),
    edges: [
      { from: 'a', to: 'b', type: 'REST' as const, callRate: 10, p99Latency: 5, errorRate: 0 },
      { from: 'b', to: 'c', type: 'REST' as const, callRate: 10, p99Latency: 5, errorRate: 0 },
    ],
    systemLoad: 0.2,
  };

  /** One flat series per node: the graph's anomalies are irrelevant to this block, its ALIGNMENT is not. */
  const flat = new Map(
    ['a', 'b', 'c'].map((id) => [
      id,
      [
        {
          label: RESOURCE,
          timestamps: [0, 60_000, 120_000, 180_000],
          values: Float64Array.from([1, 1, 1, 1]),
          unit: 'count',
        },
      ],
    ]),
  );

  it('is aligned with the graph’s own edges, not with the dump', () => {
    // The field's contract is `callGraph.edges`, and the assertion is positional: the SECOND edge of the
    // graph is the one the dump wrote FIRST, and it must still read in the second slot. A builder that
    // mapped over the dump would produce the same SET of numbers in a different order, which no aggregate
    // would ever notice.
    const pruner = new TreePruner({});
    const graph = pruner.buildFaultGraph(chain, flat, {
      edgeLatency: [row('b', 'c', 1, 30), row('a', 'b', 1, 4)],
    });
    expect(graph.edgeLatencyRises).toBeDefined();
    expect([...graph.edgeLatencyRises!]).toEqual([4, 30]);
  });

  it('is ABSENT when the case recorded no span durations, which is the golden half', () => {
    // Not an empty array: `undefined` is the statement that the corpus cannot answer the question, and it is
    // what makes the operator inert there rather than merely unthresholded.
    const pruner = new TreePruner({});
    expect(pruner.buildFaultGraph(chain, flat, {}).edgeLatencyRises).toBeUndefined();
  });

  it('is built whatever the RUN thinks of it, because it is a property of the CASE', () => {
    // The threshold is not consulted here at all: a graph built by a pruner whose `topoEdgeRise` is the
    // shipped `null` still carries the array, so the same artifact re-analysed under the arm reads the same
    // measurements the run that produced it had. Building it inside the operator would make a graph depend on
    // the run that read it, and an artifact could then disagree with its own re-analysis.
    const pruner = new TreePruner({ topoDiscount: 1 });
    expect(
      pruner.buildFaultGraph(chain, flat, { edgeLatency: [row('a', 'b', 1, 4)] }).edgeLatencyRises,
    ).toBeDefined();
  });
});
