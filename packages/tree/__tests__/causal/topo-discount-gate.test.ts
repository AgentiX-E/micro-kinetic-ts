/**
 * The topological deduction's GATE: a share of the anomaly, not a weight on the operator.
 *
 * Iteration 158 put the operator in deviation space and the nine cells read `631 → 635` at `rho = 1`
 * with three cells down a case or two each (`docs/anomaly-space.md` §6.2). The remaining cost is not
 * the operator and not its space: it is that `rho` charges a node whose callee explains a *little* of
 * its anomaly exactly as it charges one whose callee explains *everything*, and only the second kind is
 * the symptom §2 of `docs/topo-discount-scope.md` describes. That document names the untested fix in
 * its own words —
 *
 * > …or to gate the deduction on `explained / anomaly >= θ`, so a node that a callee explains only
 * > slightly is not moved at all.
 *
 * These tests are written against that sentence, and against the property that makes the gate
 * admissible at all: **at `θ = 0` it is not merely close to the shipped behaviour, it is the shipped
 * behaviour**, because `explained >= 0` holds for every node, so the condition is vacuous. A gate that
 * merely defaulted to "on" would have to be defended against the published nine cells; this one is
 * bit-identical by construction, which is the same standard `topoDiscount = 0` is held to.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_TOPO_DISCOUNT_GATE,
  deductExplainedAnomalies,
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
  gate = 0,
): ReadonlyMap<ServiceId, number> => deductExplainedAnomalies(input, rho, scope, gate).discounted;

describe('the gate, which decides WHICH nodes the deduction may move', () => {
  it('ships at the boundary, so the published nine cells are the FILTER reading', () => {
    // The value is a named constant rather than a literal at the one call site, on the rule
    // `DEFAULT_SELF_ANOMALY_WEIGHT` follows: a shipped number that no name owns is a number no census
    // can require a claimant to declare. It read 0 until iteration 163, when the two populations were
    // measured at the boundary and the partial-charge probes were read against them: 641/735 against 631
    // with no cell and no fault type down, and 60.5 % FSE'26 against the same 60.5 % it shipped at.
    expect(DEFAULT_TOPO_DISCOUNT_GATE).toBe(1);
  });

  it('charges no more at the shipped boundary than the degenerate threshold does, on every input', () => {
    // Two properties that hold across the whole grid, and they are the reason the boundary can only take
    // charges AWAY: the charge is monotone in the gate (a higher gate admits a subset of the nodes), and
    // it never takes a node below zero (the charge is `min(a, e)` at most). `gate = 0` is the degenerate
    // threshold where `explained >= 0 * anomaly` holds even for a silent callee, so it is the maximal
    // charging arm of this family and the shipped one is compared against it rather than against itself.
    const cases: readonly (readonly [TopoDeductionInput, number, TopoDiscountScope])[] = [
      [inputOf({ a: 3, b: 0 }, [edge('a', 'b')]), 0.5, 'external'],
      [inputOf({ a: 2, b: 4 }, [edge('a', 'b')], 1), 0.5, 'external'],
      [inputOf({ a: 2, b: 0.8 }, [edge('a', 'b')], 0.5), 1, 'external'],
      [inputOf({ a: 2, b: 2 }, [edge('a', 'b')], 1, 'cpu_usage'), 1, 'all'],
      [inputOf({ a: 2, b: 1, c: 0.6 }, [edge('a', 'b'), edge('a', 'c')], 1), 0.25, 'external'],
    ];
    for (const [input, rho, scope] of cases) {
      const atZero = deductExplainedAnomalies(input, rho, scope, 0).discounted;
      const atShipped = deductExplainedAnomalies(
        input,
        rho,
        scope,
        DEFAULT_TOPO_DISCOUNT_GATE,
      ).discounted;
      for (const [id, anomaly] of input.anomalies) {
        expect(atShipped.get(id) ?? anomaly).toBeGreaterThanOrEqual(atZero.get(id) ?? anomaly);
        expect(atShipped.get(id) ?? anomaly).toBeLessThanOrEqual(anomaly);
      }
    }
  });

  it('leaves a BARELY explained node untouched, where the ungated operator charges it', () => {
    // The cost the nine cells paid. `a = 2`, its callee explains `0.2 × 2 = 0.4`, so a fifth of `a` is
    // accounted for — a node in this position is usually the source of a fault whose callee happens to
    // be moving, and `rho = 1` would have removed that fifth for no reason the physics supports.
    const input = inputOf({ a: 2, b: 2 }, [edge('a', 'b')], 0.2);
    // The ungated reading, for the contrast: 0.4 explained of 2.0, so a full deduction removes 0.4.
    expect(deduct(input, 1, 'external', 0).get('a')).toBeCloseTo(1.6, 12);
    // At a gate of 0.5 the node's share is 0.2, below it, so the operator does not run on this node.
    expect(deduct(input, 1, 'external', 0.5).get('a')).toBe(2);
  });

  it('charges a MOSTLY explained node exactly as the ungated operator does', () => {
    // `a = 2`, explained `0.9 × 2 = 1.8` — a share of 0.9, which is the symptom the operator is FOR.
    // The gate does not scale the charge down: it decides whether the charge applies, and where it
    // applies the charge is the ungated one. A gate that scaled would be a second weight, which is the
    // form three earlier attempts at this term were refused for.
    const input = inputOf({ a: 2, b: 2 }, [edge('a', 'b')], 0.9);
    expect(deduct(input, 1, 'external', 0).get('a')).toBeCloseTo(0.2, 12);
    expect(deduct(input, 1, 'external', 0.5).get('a')).toBeCloseTo(0.2, 12);
    expect(deduct(input, 0.5, 'external', 0.5).get('a')).toBeCloseTo(1.1, 12);
  });

  it('is inclusive at the threshold, so a node exactly at the gate is charged', () => {
    // `>=` rather than `>`: with `>`, a gate of 0.5 would skip a node whose share is exactly one half,
    // and the boundary is not a measure-zero accident here — `explained` is a product of a propagation
    // weight and a callee's anomaly, so exact halves are what a grid of weights produces.
    const input = inputOf({ a: 2, b: 1 }, [edge('a', 'b')], 1);
    // explained = 1, share = 1/2 exactly.
    expect(deduct(input, 0.5, 'external', 0.5).get('a')).toBeCloseTo(1.5, 12);
    // One ulp above the node's share and the operator must not run.
    expect(deduct(input, 0.5, 'external', 1.5 / 2 + Number.EPSILON).get('a')).toBe(2);
  });

  it('measures the share on the CAPPED explanation, not on the raw one', () => {
    // `explained` is `w × a_callee` and the linearisation allows it to exceed the caller's whole
    // anomaly; the operator's own charge is capped at `min(a, e)`, so the share has to be capped the
    // same way or the two halves of one sentence would disagree. Here `e = 10` against `a = 2` is a raw
    // share of 5 — and a capped share of 1, which no gate inside [0, 1] can exclude.
    const input = inputOf({ a: 2, b: 10 }, [edge('a', 'b')], 1);
    expect(deduct(input, 1, 'external', 1).get('a')).toBe(0);
  });

  it('never touches a node whose callee is silent, at any gate', () => {
    // A source has no anomalous callee by definition, so its share is 0 and the only gate that could
    // charge it is one below zero — which the range check refuses.
    const input = inputOf({ a: 3, b: 0 }, [edge('a', 'b')]);
    for (const gate of [0, 0.25, 0.5, 1]) {
      expect(deduct(input, 1, 'external', gate).get('a')).toBe(3);
    }
  });

  it('never touches a node the SCOPE excludes, at any gate', () => {
    // The two fields are orthogonal and both must hold: an internal-channel callee transmits nothing
    // across a boundary whatever the caller's share of explanation is.
    const input = inputOf({ a: 2, b: 2 }, [edge('a', 'b')], 1, 'cpu_usage');
    expect(deduct(input, 1, 'external', 0).get('a')).toBe(2);
    expect(deduct(input, 1, 'external', 1).get('a')).toBe(2);
  });

  it('refuses a gate outside [0, 1], or one that is not a finite number', () => {
    // `invariantFinite` before `invariantRange`, for the reason the module's `rho` check records: a NaN
    // passes a range check and would then poison every node's anomaly with a comparison that is always
    // false — the deduction silently switching off while the configuration line says it is on.
    const input = inputOf({ a: 2, b: 2 }, [edge('a', 'b')]);
    expect(() => deduct(input, 1, 'external', -0.1)).toThrow(/topoDiscountGate/);
    expect(() => deduct(input, 1, 'external', 1.1)).toThrow(/topoDiscountGate/);
    expect(() => deduct(input, 1, 'external', Number.NaN)).toThrow(/topoDiscountGate/);
    expect(() => deduct(input, 1, 'external', Number.POSITIVE_INFINITY)).toThrow(
      /topoDiscountGate/,
    );
  });

  it('is monotone in the gate: raising it can only remove charges, never add them', () => {
    // The property that makes the weight sweep interpretable. A fleet of callers with every share from
    // 0 to 1 is the population a gate is chosen on, and each node's deducted value must be a
    // non-decreasing function of the gate — otherwise a higher gate could lower a cell for a reason no
    // one could state.
    const anomalies: Record<string, number> = {};
    const edges: CallEdge[] = [];
    for (let i = 0; i < 11; i++) {
      const share = i / 10;
      anomalies[`caller${i}`] = 2;
      anomalies[`callee${i}`] = 2 * share;
      edges.push(edge(`caller${i}`, `callee${i}`));
    }
    const input = inputOf(anomalies, edges, 1);
    const gates = [0, 0.1, 0.25, 0.5, 0.75, 1];
    for (let i = 0; i < 11; i++) {
      const values = gates.map((g) => deduct(input, 1, 'external', g).get(`caller${i}`)!);
      for (let k = 1; k < values.length; k++) {
        expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!);
      }
      // …and each node flips at exactly its own share: charged below it, whole at or above it. A share
      // of zero is the node with a silent callee, which has nothing to charge at any gate — the gate's
      // condition is satisfied there but the quantity it gates is zero.
      const share = i / 10;
      for (const g of gates) {
        const charged = deduct(input, 1, 'external', g).get(`caller${i}`)! < 2;
        expect(charged).toBe(share > 0 && share >= g);
      }
    }
  });
});
