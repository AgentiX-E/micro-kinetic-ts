/**
 * The topological deduction's SPACE, which is the whole reason iteration 158 exists.
 *
 * Iteration 157 shipped the deduction as a subtraction and measured it on nine cells: +1.6 pp on
 * RE1:OnlineBoutique, −5.6 pp on RE1:TrainTicket, −2.2 on RE2:TrainTicket. The direction was right and
 * the algebra was right; what was wrong is that the operator ran on whatever the graph happened to
 * report, and the graph reports a RANK above `anomalyNormalizeNodeThreshold`.
 *
 * These tests are written against that sentence. The first asserts the algebra in the space it is
 * defined on, the second computes what the rank surface does to it — the population law, arithmetically
 * — and the third asserts the property the fix buys: the same relative configuration gets the same
 * relative deduction whatever the fleet's size.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  applyAnomalyNormalization,
  deductExplainedAnomalies,
  rankNormalizeScores,
  type TopoDeductionInput,
  type TopoDiscountScope,
} from '../../src/index.js';

/** An edge with the only three fields the deduction reads, filled to the type. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

function inputOf(
  anomalies: Record<string, number>,
  edges: readonly CallEdge[],
  weight = 1,
  label = 'latency_p99',
): TopoDeductionInput {
  return {
    anomalies: new Map(Object.entries(anomalies)) as Map<ServiceId, number>,
    edges,
    propagationWeights: new Float64Array(edges.length).fill(weight),
    dominantMetrics: new Map(edges.flatMap((e) => [e.from, e.to]).map((id) => [id, { label }])),
  };
}

const deduct = (
  input: TopoDeductionInput,
  rho: number,
  scope: TopoDiscountScope = 'external',
): Map<ServiceId, number> => deductExplainedAnomalies(input, rho, scope);

describe('the deduction in deviation space', () => {
  it('leaves a node with nothing anomalous to call entirely alone', () => {
    // `a` calls a healthy `b`, so nothing explains `a`. The deduction is about what a callee ACCOUNTS
    // FOR, not about being a caller: a source has no anomalous callee by definition.
    const input = inputOf({ a: 3, b: 0 }, [edge('a', 'b')]);
    const result = deduct(input, 0.5);
    expect(result.get('a')).toBe(3);
    expect(result.get('b')).toBe(0);
  });

  it('removes exactly rho of the explained part and never more than the whole', () => {
    // `a = 2` and its callee explains `1 × 4 = 4` of it — more than the whole, which the linearisation
    // allows and the operator must not. The admissible reading is "entirely explained", so `a` keeps
    // `2 × (1 − rho)`.
    const input = inputOf({ a: 2, b: 4 }, [edge('a', 'b')], 1);
    expect(deduct(input, 0.5).get('a')).toBeCloseTo(1, 12);
    expect(deduct(input, 0.25).get('a')).toBeCloseTo(1.5, 12);
    // At a full deduction an entirely explained node reads exactly zero — and not `-0`, which the
    // ranking's tie-break would see as a different value from a node whose anomaly genuinely was zero.
    const full = deduct(input, 1).get('a')!;
    expect(full).toBe(0);
    expect(Object.is(full, -0)).toBe(false);
  });

  it('removes rho of the explained part when the callee explains only a fraction', () => {
    // `a = 2`, explained `0.5 × 0.8 = 0.4`, so the deduction is `rho × 0.4` — the cap does not bind, and
    // the result is the plain subtraction.
    const input = inputOf({ a: 2, b: 0.8 }, [edge('a', 'b')], 0.5);
    expect(deduct(input, 1).get('a')).toBeCloseTo(1.6, 12);
    expect(deduct(input, 0.5).get('a')).toBeCloseTo(1.8, 12);
  });

  it('takes the largest explaining callee, not the sum', () => {
    // A caller's traffic splits across its callees, so two mildly anomalous callees do not compose into
    // an explanation; the maximum is the one that can account for the caller.
    const edges = [edge('a', 'b'), edge('a', 'c')];
    const input: TopoDeductionInput = {
      ...inputOf({ a: 2, b: 1, c: 0.6 }, edges, 1),
    };
    // explained = max(1, 0.6) = 1, so at rho = 1 the caller loses exactly 1.
    expect(deduct(input, 1).get('a')).toBeCloseTo(1, 12);
  });

  it('ignores an internal-channel callee under the external scope and honours it under all', () => {
    const input = inputOf({ a: 2, b: 2 }, [edge('a', 'b')], 1, 'cpu_usage');
    // `cpu_usage` is a property of the machine: no call boundary transmits it, so nothing is explained.
    expect(deduct(input, 1, 'external').get('a')).toBe(2);
    // The ablation arm is the same operator with the channel question answered "everything".
    expect(deduct(input, 1, 'all').get('a')).toBe(0);
  });

  it('refuses a mismatched weight vector instead of producing a NaN anomaly', () => {
    // The weight vector is aligned with the edge array by construction upstream, and this function is
    // public: a shorter vector would read `undefined`, and a NaN anomaly is invisible to every ranking.
    const input: TopoDeductionInput = {
      anomalies: new Map([
        ['a', 2],
        ['b', 1],
      ]),
      edges: [edge('a', 'b')],
      propagationWeights: new Float64Array(0),
    };
    expect(() => deduct(input, 0.5)).toThrow(/must match edges length/);
  });

  it('refuses a rho outside [0, 1] or one that is not a number', () => {
    const input = inputOf({ a: 2, b: 1 }, [edge('a', 'b')]);
    expect(() => deduct(input, 1.5)).toThrow(/topoDiscount/);
    expect(() => deduct(input, -0.5)).toThrow(/topoDiscount/);
    expect(() => deduct(input, Number.NaN)).toThrow(/topoDiscount/);
  });
});

describe('the population law, which is what the rank surface does to the same operator', () => {
  /**
   * A fleet whose healthy floor is CLUSTERED, which is what a measured fleet looks like: one source,
   * one victim that inherits from it, and everything else near the noise floor.
   *
   * The shape matters. Rank normalisation replaces "the floor is far away" with a uniform density over
   * [0, 1], and an extensive operator reads that density as competition; a fleet whose anomalies are
   * spread evenly would hide the effect the real corpus shows.
   */
  function fleet(n: number): Map<ServiceId, number> {
    const raw = new Map<ServiceId, number>();
    raw.set('source', 3);
    raw.set('victim', 1.5);
    for (let i = 0; i < n - 2; i++) raw.set(`h${i}`, 0.02 + 0.0005 * i);
    return raw;
  }

  const EDGES = [edge('victim', 'source')];
  const WEIGHTS = new Float64Array([0.5]);
  const LABELS = new Map([
    ['victim', { label: 'latency_p99' }],
    ['source', { label: 'latency_p99' }],
  ]);

  /** The victim's 0-indexed rank — the only quantity @1/@3/@5 can see. */
  function positionOf(scores: ReadonlyMap<ServiceId, number>): number {
    const victim = scores.get('victim')!;
    let above = 0;
    for (const [id, value] of scores) {
      if (id !== 'victim' && value > victim) above++;
    }
    return above;
  }

  /** How many services the deduction OVERTAKES — its cost in ranks, which is what @1/@3/@5 reads. */
  function positionsLost(n: number, after: ReadonlyMap<ServiceId, number>): number {
    return positionOf(after) - positionOf(fleet(n));
  }

  it('makes the deduction cross the fleet on a RANK surface, in proportion to its size', () => {
    // The old call site in one line: deduct on `graph.anomalyScores`. On a rank map a deduction of
    // `rho × w × a_calleep` is compared against gaps of `1/(n−1)`, so it overtakes `rho·w·(n−1)`
    // services — 15 on TrainTicket's 63 nodes, 2 on OnlineBoutique's 12. Same operator, same
    // configuration, a verdict that depends on how many services the fleet has.
    const lost = (n: number): number =>
      positionsLost(
        n,
        deduct(
          {
            anomalies: rankNormalizeScores(fleet(n)),
            edges: EDGES,
            propagationWeights: WEIGHTS,
            dominantMetrics: LABELS,
          },
          0.5,
        ),
      );
    expect(lost(12)).toBeLessThanOrEqual(3);
    expect(lost(63)).toBeGreaterThanOrEqual(12);
    expect(lost(63)).toBeGreaterThan(lost(12) * 4);
  });

  it('crosses NOTHING in deviation space, at either fleet size', () => {
    // The fix: the same configuration, deducted where the excess is a quantity and re-ranked after.
    // The healthy floor stays far below the victim, so the reordering is empty — and it is empty at
    // both sizes, which is the population invariance the axis needed.
    const lost = (n: number): number =>
      positionsLost(
        n,
        applyAnomalyNormalization(
          deduct(
            {
              anomalies: fleet(n),
              edges: EDGES,
              propagationWeights: WEIGHTS,
              dominantMetrics: LABELS,
            },
            0.5,
          ),
          'rank',
        ),
      );
    expect(lost(12)).toBe(0);
    expect(lost(63)).toBe(0);
  });

  it('gives the same relative deduction at either fleet size in DEVIATION space', () => {
    // The property, as an equation rather than as a count: whichever fleet the configuration is
    // embedded in, the fraction of its own anomaly a node loses is a function of the configuration.
    const relative = (n: number): number => {
      const raw = fleet(n);
      const after = deduct(
        { anomalies: raw, edges: EDGES, propagationWeights: WEIGHTS, dominantMetrics: LABELS },
        0.5,
      ).get('victim')!;
      return (raw.get('victim')! - after) / raw.get('victim')!;
    };
    expect(relative(12)).toBeCloseTo(0.5, 12);
    expect(relative(63)).toBeCloseTo(0.5, 12);
    // …and the fraction is the one the configuration names, capped at `rho` because the callee explains
    // `0.5 × 3 = 1.5`, exactly the victim's whole anomaly.
    expect(relative(63)).toBeCloseTo(0.5 * Math.min(1, 1.5 / 1.5), 12);
  });

  it('returns its result to the space the graph reports, so the ranking reads one unit', () => {
    // The round trip is what the pruner does: deduct on deviations, map back with the graph's own
    // transform. Asserted here because a caller that skipped the map-back would hand the ranking a
    // deviation where it expects a rank, and every downstream term is scaled to the latter.
    const raw = fleet(63);
    const deducted = new Map(raw);
    deducted.set('victim', raw.get('victim')! - 1);
    const back = applyAnomalyNormalization(deducted, 'rank');
    // A rank map: one entry per service, all in [0, 1], and the deduction still orders `source` above
    // `victim`.
    expect(back.size).toBe(63);
    for (const value of back.values()) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(back.get('source')!).toBeGreaterThan(back.get('victim')!);
    // `none` is the identity, and it COPIES: the caller's map is not aliased into the ranking.
    const identity = applyAnomalyNormalization(deducted, 'none');
    expect(identity.get('victim')).toBe(deducted.get('victim'));
    identity.set('victim', 0);
    expect(deducted.get('victim')).not.toBe(0);
  });
});
