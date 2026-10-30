/**
 * The deduction's SHARE — the quantity its gate reads, and the one no artifact could report.
 *
 * Iteration 195 measured the gate on the nine cells and left one debt in `docs/topo-discount-gate.md` §6:
 * the arm that would have settled the remaining cell could not be chosen, because an artifact records the
 * truth's POST-deduction anomaly and the share is a property of the PRE-deduction one. The gate's own
 * decision — "was this node mostly explained by what it calls" — was therefore only observable by running a
 * grid and watching cells move, which is tuning a number rather than reading a mechanism.
 *
 * These tests are written against the operator that answers that question, and they are written to pin the
 * three distinctions that make the answer usable:
 *
 * 1. **A share of 0 and NO share are different measurements.** A node the operator considered and found
 *    unexplained has share 0; a node the scope never looked at, or one with no anomaly to explain, has no
 *    entry at all. Reporting the second as the first would let a configuration fact (`scope = external`
 *    skipped this node) read as a corpus fact (nothing explained it) — the defect `classifyTermZero` exists
 *    to prevent one level up.
 * 2. **The share is capped, and the cap is the honest reading.** When the linearisation says a callee
 *    accounts for six times its caller's anomaly, the share is 1, not 6: the gate lives in [0, 1] and a
 *    share outside it cannot be compared with a threshold.
 * 3. **The share does not depend on the gate.** The gate decides WHETHER to charge; the share says HOW MUCH
 *    was explained. A share that moved with the gate would be a second answer to the gate's own question,
 *    and the artifact would have to say which configuration produced it before a reader could use it.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  deductExplainedAnomalies,
  type TopoDeductionInput,
  type TopoDiscountScope,
} from '../../src/index.js';

/** An edge with the only three fields the deduction reads, filled to the type. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/**
 * An input whose every node carries the same dominant channel, so the scope admits all of them.
 *
 * `latency_p99` is a response channel, which is what `external` scope requires on both sides of a
 * deduction: a caller may be deducted and a callee may explain only through a channel a call boundary
 * actually transmits. The label map is keyed on EVERY node — an anomaly key that appears on no edge is
 * still a service the graph scored — because a node the fixture forgot to label would leave the scope
 * without a channel to admit it through, and the absence under test would then be the fixture's.
 */
function inputOf(
  anomalies: Record<string, number>,
  edges: readonly CallEdge[],
  weight = 1,
  label = 'latency_p99',
  labels: Record<string, string> = {},
): TopoDeductionInput {
  const nodeIds = new Set([...Object.keys(anomalies), ...edges.flatMap((e) => [e.from, e.to])]);
  return {
    anomalies: new Map(Object.entries(anomalies)) as Map<ServiceId, number>,
    edges,
    propagationWeights: new Float64Array(edges.length).fill(weight),
    dominantMetrics: new Map([...nodeIds].map((id) => [id, { label: labels[id] ?? label }])),
  };
}

const deduct = (
  input: TopoDeductionInput,
  rho: number,
  scope: TopoDiscountScope = 'external',
  gate = 0,
) => deductExplainedAnomalies(input, rho, scope, gate, 'max');

describe('the share the gate reads', () => {
  it('reports the fraction of a node its callees account for, and 0 on one nothing explains', () => {
    // `a` calls `b` over a link that carries half of `a`'s traffic, so `b`'s 2 units explain 1 of `a`'s 4:
    // a share of 0.25. `c` calls nothing, so nothing explained it and its share is a MEASURED zero.
    const input = inputOf({ a: 4, b: 2, c: 3 }, [edge('a', 'b')], 0.5);
    const result = deduct(input, 1);
    expect(result.share.get('a')).toBeCloseTo(0.25, 12);
    expect(result.share.get('c')).toBe(0);
    // The charge is the share's own arithmetic at `rho = 1`: a quarter of `a`'s anomaly, not all of it.
    expect(result.discounted.get('a')).toBeCloseTo(3, 12);
  });

  it('caps the share at one when a callee accounts for more than the caller has', () => {
    // The linearisation says 20 units explain a 2-unit anomaly. The admissible reading is "entirely
    // explained"; a share of 10 would be outside the interval any threshold in [0, 1] can express, and the
    // ranking would then be reading a quantity that is not a share at all.
    const input = inputOf({ a: 2, b: 20 }, [edge('a', 'b')]);
    const result = deduct(input, 1);
    expect(result.share.get('a')).toBe(1);
    expect(result.discounted.get('a')).toBe(0);
  });

  it('never reports a share outside [0, 1], whatever the ratio between a caller and its callee', () => {
    // A sweep rather than a case: the cap is a property of the map, and a single fixture cannot state one.
    for (const callee of [0.5, 1, 2, 5, 20, 200]) {
      for (const caller of [0.5, 1, 2, 5, 20]) {
        const result = deduct(inputOf({ a: caller, b: callee }, [edge('a', 'b')]), 0.5);
        const share = result.share.get('a')!;
        expect(share).toBeGreaterThanOrEqual(0);
        expect(share).toBeLessThanOrEqual(1);
      }
    }
  });

  it('measures the same share at every gate, because the gate decides whether and the share how much', () => {
    // Five gates, one configuration. A share that moved here would be a second answer to the gate's own
    // question — and the artifact would then have to name the gate before the number meant anything.
    const input = inputOf({ a: 4, b: 2, c: 3 }, [edge('a', 'b')], 0.5);
    const shares = [0, 0.25, 0.5, 0.75, 1].map((gate) => deduct(input, 1, 'external', gate).share);
    for (const share of shares) {
      expect([...share.entries()]).toEqual([...shares[0]!.entries()]);
    }
    // And the gate does change the charge, so the two halves of the operator are not the same statement.
    expect(deduct(input, 1, 'external', 0).discounted.get('a')).toBeCloseTo(3, 12);
    expect(deduct(input, 1, 'external', 1).discounted.get('a')).toBe(4);
  });

  it('omits a node the scope never considered rather than reporting a measured zero', () => {
    // `a` is `cpu`-dominant, so `external` scope does not let a call boundary explain it: the operator never
    // looked at it. A 0 here would say "its callees explained nothing", which is a different claim about a
    // different subject — and the one an ablation of the scope would need to be able to refute.
    const input = inputOf({ a: 3, b: 5 }, [edge('a', 'b')], 1, 'latency_p99', { a: 'cpu' });
    const result = deduct(input, 1);
    expect(result.share.has('a')).toBe(false);
    expect(result.discounted.get('a')).toBe(3);
    // `b` was considered and nothing explains it, so its zero IS a measurement.
    expect(result.share.has('b')).toBe(true);
    expect(result.share.get('b')).toBe(0);
    // The `all` scope admits `a`, so the same node acquires a share: the absence above is the scope's, not
    // the corpus's, and this is the assertion that keeps the two apart.
    expect(deduct(input, 1, 'all').share.has('a')).toBe(true);
  });

  it('omits a node with no anomaly, because a share of nothing is not a quantity', () => {
    // `a` is healthy and calls an anomalous `b`. Nothing is deducted from `a` — a zero anomaly cannot be
    // reduced — and there is no whole for a share to be a fraction of, at any gate including the boundary.
    const input = inputOf({ a: 0, b: 5 }, [edge('a', 'b')]);
    for (const gate of [0, 0.5, 1]) {
      const result = deduct(input, 1, 'external', gate);
      expect(result.share.has('a')).toBe(false);
      expect(result.discounted.get('a')).toBe(0);
    }
  });

  it('reads the space its input is in, so the same ranks under a different fleet give a different share', () => {
    // The operator adds a callee's anomaly into a caller's, which is defined on deviations. On a rank
    // surface the same two nodes carry `k/(n−1)` instead, and the share moves with the fleet's size: 0.25
    // on the deviations below, 0.49 on the ranks of a fleet that happens to put them one step apart. That
    // is why the artifact has to record the share the DEVIATION-space operator computed, not a ratio
    // recovered from the reported scores — the second is a rank share and this test is the arithmetic.
    const deviations = deduct(inputOf({ a: 4, b: 2 }, [edge('a', 'b')], 0.5), 1);
    expect(deviations.share.get('a')).toBeCloseTo(0.25, 12);
    const ranks = deduct(inputOf({ a: 0.5, b: 0.49 }, [edge('a', 'b')], 0.5), 1);
    expect(ranks.share.get('a')).toBeCloseTo(0.49, 12);
    expect(ranks.share.get('a')! - deviations.share.get('a')!).toBeGreaterThan(0.2);
  });

  it('states the charge as rho × share × anomaly, so the share is the whole of the decision', () => {
    // The identity is the reason this value is worth recording: a reader holding the share, the weight and
    // the pre-deduction anomaly can reproduce the post-deduction one exactly, which is what makes an
    // artifact able to say WHY a truth moved rather than only that it did.
    const input = inputOf({ a: 4, b: 2, c: 3 }, [edge('a', 'b')], 0.5);
    const share = deduct(input, 1).share;
    for (const rho of [0, 0.25, 0.5, 1]) {
      for (const gate of [0, 0.5, 1]) {
        const result = deduct(input, rho, 'external', gate);
        for (const [id, anomaly] of input.anomalies) {
          const s = share.get(id);
          const charged = s !== undefined && s * anomaly >= gate * anomaly ? rho * s * anomaly : 0;
          expect(result.discounted.get(id)).toBeCloseTo(anomaly - charged, 12);
        }
      }
    }
  });

  it('leaves the input untouched, so a caller can read the pre-deduction anomaly beside the share', () => {
    // The artifact records both sides of the identity above, and it can only do that if the operator does
    // not rewrite the map it was handed.
    const input = inputOf({ a: 4, b: 2 }, [edge('a', 'b')], 0.5);
    deduct(input, 1);
    expect([...input.anomalies.entries()]).toEqual([
      ['a', 4],
      ['b', 2],
    ]);
  });
});
