/**
 * The deduction's PRECEDENCE — whether a call boundary can carry a movement backwards in time.
 *
 * ## The defect this measures
 *
 * `deductExplainedAnomalies` subtracts from a caller what its callees "explain": `explained(v) = ⊕ w(v→c)·a(c)`.
 * That is an influx balance, and an influx has a DIRECTION in time as well as in the graph. A callee whose
 * movement starts AFTER its caller's cannot be the reason the caller moved, and the operator has never asked:
 * it reads magnitudes and the call graph, and nothing else.
 *
 * The corpus says the omission is not academic. Of the ninety-four misses on battery `41188083576`, twelve are
 * cases where the truth is in the graph and is not in the ranking at all, and **six of those twelve carry a
 * pre-deduction anomaly of 0.73 to 1.87** — a node that had plainly moved, deleted by an operator that found a
 * louder callee. Every one of the six sits at one hop from its winner. The published name for the repair is
 * temporal precedence (TopoEvo, `arXiv:2605.15611`, 3.44 pp on root-cause localisation), and the test it
 * prescribes is the one these tests pin: the cause's onset precedes the victim's.
 *
 * ## The three distinctions the tests exist to hold apart
 *
 * 1. **Absence is not lateness.** A service whose dominant metric never left its baseline has no onset —
 *    `MAX_SAFE_INTEGER` in the graph's own map — and that is a MISSING measurement, not an infinitely late
 *    one. Reading it as lateness would let a gap in the telemetry withhold a charge.
 * 2. **A tie is not an order.** At the corpus's sampling interval two services that start in the same bucket
 *    cannot be told apart. The guard acts only where the data separates the two, and the shipped charge is
 *    kept where it abstains.
 * 3. **The guard can only give anomaly back.** Every edge it withholds removes one term from a maximum (or a
 *    sum), so `discounted` under `onset` is never BELOW `discounted` under `off` on any node, for any graph.
 *    That is what makes the arm's cost population exactly the cases where a charge was withheld, and it is
 *    asserted as a property rather than argued in prose.
 *
 * `off` is the shipped value and is the identity: at `off` the operator does not read `onsets` at all, so the
 * nine published cells are unchanged by construction rather than by the accident that the guard happened to
 * abstain on them.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  deductExplainedAnomalies,
  type TopoDeductionInput,
  type TopoPrecedence,
} from '../../src/index.js';

/** An edge with the only three fields the deduction reads, filled to the type. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/** The graph's own sentinel for "this service never left its baseline". */
const NO_ONSET = Number.MAX_SAFE_INTEGER;

/**
 * An input with every node on a response channel, so `external` scope admits all of them.
 *
 * @param anomalies - Pre-deduction anomalies, in deviation space.
 * @param edges - The call edges to explain through.
 * @param onsets - Per-node onset indices; a node absent from the map has no measured onset.
 * @param weight - The propagation weight on every edge.
 */
function inputOf(
  anomalies: Record<string, number>,
  edges: readonly CallEdge[],
  onsets?: Record<string, number>,
  weight = 1,
): TopoDeductionInput {
  const nodeIds = new Set([...Object.keys(anomalies), ...edges.flatMap((e) => [e.from, e.to])]);
  return {
    anomalies: new Map(Object.entries(anomalies)) as Map<ServiceId, number>,
    edges,
    propagationWeights: new Float64Array(edges.length).fill(weight),
    dominantMetrics: new Map([...nodeIds].map((id) => [id, { label: 'latency_p99' }])),
    ...(onsets === undefined
      ? {}
      : { onsets: new Map(Object.entries(onsets)) as Map<ServiceId, number> }),
  };
}

const deduct = (
  input: TopoDeductionInput,
  precedence: TopoPrecedence,
  options: { rho?: number; gate?: number; closure?: 'max' | 'sum' } = {},
) =>
  deductExplainedAnomalies(
    input,
    options.rho ?? 1,
    'external',
    options.gate ?? 0,
    options.closure ?? 'max',
    precedence,
  );

describe('the boundary a call cannot carry backwards', () => {
  // `front-end` (a) calls `carts` (b) over the whole of its traffic. `carts` carries 4 units and `front-end`
  // carries 2, so at `rho = 1` the ungated operator charges `front-end` its entire 2 and deletes it — the
  // shape of the six misses this axis exists for.
  const fanIn = () => inputOf({ a: 2, b: 4 }, [edge('a', 'b')]);

  it('charges the caller at `off`, whatever the onsets say', () => {
    const late = deduct(inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: 3, b: 9 }), 'off');
    expect(late.discounted.get('a')).toBe(0);
    // The identity is total, not merely true on this fixture: `off` reads no onset at all, so an input that
    // carries them and one that does not are the same call.
    const bare = deduct(fanIn(), 'off');
    expect(bare.discounted.get('a')).toBe(late.discounted.get('a'));
  });

  it('withholds the charge when the callee moved STRICTLY later, so the caller keeps its anomaly', () => {
    // `front-end` moves at bucket 3 and `carts` at bucket 9: the boundary points the wrong way in time, and the
    // influx the operator was about to subtract had not arrived when the caller moved.
    const result = deduct(inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: 3, b: 9 }), 'onset');
    expect(result.discounted.get('a')).toBe(2);
    // …and the share the gate reads is the explanation the operator USED, not the one it could have built:
    // a share of 2 would keep the gate comparing the caller against an influx the guard had already refused.
    expect(result.share.get('a')).toBe(0);
  });

  it('keeps the charge when the callee moved strictly earlier, because that is the case the operator is for', () => {
    const result = deduct(inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: 9, b: 3 }), 'onset');
    expect(result.discounted.get('a')).toBe(0);
    expect(result.share.get('a')).toBe(1);
  });

  it('keeps the charge on a TIE, because the sample cannot order two services in one bucket', () => {
    // Both moved at bucket 4. "The callee did not move first" and "the data cannot say who moved first" are
    // different findings, and only the first licenses withholding a charge the shipped arm makes.
    const result = deduct(inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: 4, b: 4 }), 'onset');
    expect(result.discounted.get('a')).toBe(0);
  });

  it('keeps the charge when the CALLEE has no measured onset, because absence is not lateness', () => {
    // `carts` never left its baseline, so the graph records the sentinel. Read as a number, `MAX_SAFE_INTEGER`
    // is the latest possible onset and the charge would be withheld on a gap in the telemetry.
    const result = deduct(
      inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: 3, b: NO_ONSET }),
      'onset',
    );
    expect(result.discounted.get('a')).toBe(0);
  });

  it('keeps the charge when the CALLER has no measured onset, for the same reason on the other side', () => {
    const result = deduct(
      inputOf({ a: 2, b: 4 }, [edge('a', 'b')], { a: NO_ONSET, b: 3 }),
      'onset',
    );
    expect(result.discounted.get('a')).toBe(0);
  });

  it('keeps the charge when no onset map was supplied at all', () => {
    // A graph that measured no onset is a corpus fact, and a guard that switched the operator off on it would
    // report a missing input as a measured precedence.
    const result = deduct(fanIn(), 'onset');
    expect(result.discounted.get('a')).toBe(0);
  });

  it('drops only the late edge under the sum closure, so a fan-out is charged for the branches that had arrived', () => {
    // `a` waits on both `b` and `c`. `b` moved first and accounts for 1 unit of the 3; `c` moved after `a` and
    // accounts for 2. The sum closure therefore sees 1, and the caller loses 1 rather than 3.
    const result = deduct(
      inputOf({ a: 3, b: 1, c: 2 }, [edge('a', 'b'), edge('a', 'c')], { a: 5, b: 1, c: 9 }),
      'onset',
      { closure: 'sum' },
    );
    expect(result.discounted.get('a')).toBeCloseTo(2, 12);
    expect(result.share.get('a')).toBeCloseTo(1 / 3, 12);
  });

  it('never lowers a charge anywhere, on any graph — the property that bounds the arm to its cost cases', () => {
    // Exhaustive over a small space rather than sampled: two nodes, one edge in each direction, anomalies in
    // {1, 2, 4} and onsets in {0, 1, 2, none}. The guard removes terms from a maximum, so no node can end up
    // with LESS anomaly than the shipped arm gave it.
    const anomalies = [1, 2, 4];
    const onsets = [0, 1, 2, NO_ONSET] as const;
    let cases = 0;
    for (const from of ['a', 'b'] as const) {
      const to = from === 'a' ? 'b' : 'a';
      for (const first of onsets) {
        for (const second of onsets) {
          for (const firstAnomaly of anomalies) {
            for (const secondAnomaly of anomalies) {
              const input = inputOf(
                { [from]: firstAnomaly, [to]: secondAnomaly },
                [edge(from, to)],
                {
                  [from]: first,
                  [to]: second,
                },
              );
              const shipped = deduct(input, 'off').discounted;
              const guarded = deduct(input, 'onset').discounted;
              for (const [node, value] of guarded)
                expect(value).toBeGreaterThanOrEqual(shipped.get(node)!);
              cases += 1;
            }
          }
        }
      }
    }
    // The sweep is asserted to have run: a loop that silently iterated nothing would satisfy every assertion
    // above and measure nothing.
    expect(cases).toBe(2 * onsets.length * onsets.length * anomalies.length * anomalies.length);
  });

  it('refuses a precedence it does not implement, because a typo would run the shipped arm in silence', () => {
    expect(() =>
      deductExplainedAnomalies(
        fanIn(),
        1,
        'external',
        0,
        'max',
        'earliest' as unknown as TopoPrecedence,
      ),
    ).toThrow(/topoPrecedence/);
  });
});
