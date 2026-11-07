/**
 * The channel scope of the topological deduction, and the one predicate that decides it.
 *
 * The deduction has now been refused twice — once as an additive term at a mis-scaled weight, once as a
 * ratio that deducted a callee-origin's own `cpu` reading — and both refusals are recorded on
 * `TreePrunerOptions.topoDiscount`. What the third form adds is a QUESTION about the channel, so the answer
 * to it is the axis this file holds: `isResponseChannel` names the only channels a call boundary carries, and
 * `TopoDiscountScope` decides whether the deduction may look at anything else.
 *
 * The source fence at the bottom is the part that keeps the refusal closed. A reader can re-introduce the
 * ratio form by writing one multiplication, and the case that would catch it is a corpus measurement rather
 * than a unit test — so the formula itself is pinned here as text, in the same spirit as the anchor census's
 * fence over `drift <= tolerance`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  DEFAULT_TOPO_DISCOUNT_SCOPE,
  TOPO_DISCOUNT_SCOPES,
  deductExplainedAnomalies,
  isResponseChannel,
  isTopoDiscountScope,
  type TopoDeductionInput,
  type TopoDiscountScope,
} from '../../src/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** An edge with the only three fields the deduction reads, filled to the type. */
function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/**
 * One caller/caller pair, each endpoint's dominant metric named.
 *
 * The two labels are the whole of the input: the deduction reads `dominantMetrics` and nothing else to decide
 * whether a channel crosses a call boundary, so a fixture that carried a third field would be testing a
 * question the operator does not ask.
 */
function pair(
  callerLabel: string,
  calleeLabel: string,
  callerAnomaly = 2,
  calleeAnomaly = 1,
): TopoDeductionInput {
  const edges = [edge('caller', 'callee')];
  return {
    anomalies: new Map([
      ['caller', callerAnomaly],
      ['callee', calleeAnomaly],
    ]) as Map<ServiceId, number>,
    edges,
    propagationWeights: new Float64Array([1]),
    dominantMetrics: new Map([
      ['caller', { label: callerLabel }],
      ['callee', { label: calleeLabel }],
    ]),
  };
}

/** The discounted anomaly of the fixture's caller, at the maximal weight and no gate. */
const charged = (input: TopoDeductionInput, scope: TopoDiscountScope): number =>
  deductExplainedAnomalies(input, 1, scope, 0, 'max', 'off').discounted.get('caller')!;

describe('isResponseChannel', () => {
  it('admits every channel a call boundary carries', () => {
    // Each of these is observable AT the boundary: a caller inherits a callee's response time, its failures,
    // its dropped packets and its exhausted sockets. The list is the RCAEval label vocabulary, which is where
    // the two suffixes matter — `latency-50` and `latency-90` are percentiles, not a different family.
    for (const label of [
      'latency',
      'latency-50',
      'latency-90',
      'delay',
      'error',
      'loss',
      'socket',
    ]) {
      expect(isResponseChannel(label), label).toBe(true);
    }
  });

  it('refuses internal resource readings', () => {
    // `cpu`, `mem` and `disk` are properties of the component's OWN machine: no callee can produce them, so
    // no callee may explain them away. This is the whole of the third form's difference.
    for (const label of ['cpu', 'mem', 'memory_rss_bytes', 'diskio', 'disk_write_iops']) {
      expect(isResponseChannel(label), label).toBe(false);
    }
  });

  it('refuses the demand channels', () => {
    // `workload` and `load` measure what was HANDED to the component — the opposite direction from a
    // response — and are the family the decisive-evidence guard already excludes. Discounting on them would
    // let a busy caller be explained by its busy callee.
    for (const label of ['workload', 'load', 'PassthroughCluster_load']) {
      expect(isResponseChannel(label), label).toBe(false);
    }
  });

  it('is case-insensitive, because the converter does not normalise labels', () => {
    expect(isResponseChannel('LATENCY-90')).toBe(true);
    expect(isResponseChannel('Error')).toBe(true);
    expect(isResponseChannel('CPU')).toBe(false);
  });
});

describe('isTopoDiscountScope', () => {
  it('admits exactly the three scopes', () => {
    expect(isTopoDiscountScope('all')).toBe(true);
    expect(isTopoDiscountScope('external')).toBe(true);
    expect(isTopoDiscountScope('caller')).toBe(true);
    expect(Object.keys(TOPO_DISCOUNT_SCOPES).sort()).toEqual(['all', 'caller', 'external']);
  });

  it('refuses anything else, including the prototype chain', () => {
    // `Record` is an object, so `in` would accept `toString`, `constructor` and `__proto__` — all of which a
    // dispatch can really send. The lookup is `hasOwnProperty` for that reason, and this is the assertion
    // that keeps it that way.
    for (const value of ['', 'ALL', 'External', 'none', 'toString', 'constructor', '__proto__']) {
      expect(isTopoDiscountScope(value), value).toBe(false);
    }
  });
});

describe('the shipped scope', () => {
  it('is `external`, the arm that leaves RE3/SockShop unmoved', () => {
    // Not a preference: the ratio form's internal half is what cost RE3/SockShop two cases per weight while
    // RE1/OnlineBoutique gained, and restricting the deduction to response channels separates them.
    expect(DEFAULT_TOPO_DISCOUNT_SCOPE).toBe('external');
  });
});

describe('the channel predicate, which is two questions and not one', () => {
  // The two sides of the deduction were decided by ONE predicate for three iterations, on the argument that
  // "does this channel cross a call boundary" is one question. It is two, and the physical statement only
  // holds for one of them:
  //
  //   - the CALLEE side asks "may this node's deviation be an explanation its callers inherit?" — and the
  //     answer cannot depend on the callee's channel, because a callee saturated on `cpu` injects DELAY into
  //     its caller. That is queueing, not a modelling choice: the caller's response is the observable, and
  //     the callee's internal state is what produces it.
  //   - the CALLER side asks "may this node's deviation be explained away?" — and the answer does depend on
  //     the caller's channel, because an internal reading (`cpu`, `mem`, `diskio`) is the component's own
  //     work. No callee produces a caller's CPU.
  //
  // Requiring both is what `external` does, and the cost is measurable: a `cpu` fault at `carts` produces an
  // `error` rise at `front-end`, and `external` refuses to charge `front-end` for it (RE3/SockShop,
  // `re3ss_carts_f1_1`). Dropping both is what `all` does, and its cost is the mirror: `carts`' own `cpu` is
  // charged by `carts-db`'s unrelated `diskio`. `caller` keeps the conjunct that is physical and drops the one
  // that is not.

  it('lets a RESPONSE caller be charged by an INTERNAL callee, which `external` refuses', () => {
    // `front-end` (error) waits on `carts` (cpu). The caller's error rise is the callee's saturation, and no
    // reading of the corpus changes that — so the charge belongs, and `external`'s refusal is the defect.
    const input = pair('error', 'cpu');
    expect(charged(input, 'caller')).toBeCloseTo(1);
    expect(charged(input, 'external')).toBeCloseTo(2);
  });

  it('still refuses to charge an INTERNAL caller, which is what `all` does', () => {
    // `carts` (cpu) calls `carts-db` (cpu:diskio in the corpus). The caller's own CPU is the caller's own work,
    // and this is the half of `all` that cost RE3/SockShop four cases in the local readback.
    const input = pair('cpu', 'diskio');
    expect(charged(input, 'caller')).toBeCloseTo(2);
    expect(charged(input, 'all')).toBeCloseTo(1);
  });

  it('agrees with `external` wherever `external` charges, so it is a superset and never a replacement', () => {
    // The arm is defined by which cases it ADDS, and this is the assertion that keeps it from also subtracting:
    // on the response/response pair both scopes must return the same number.
    const input = pair('latency', 'latency');
    expect(charged(input, 'caller')).toBeCloseTo(charged(input, 'external'));
    expect(charged(input, 'caller')).toBeCloseTo(1);
  });

  it('leaves the callee-side channel out of the decision, but not the callee’s anomaly', () => {
    // A callee with no anomaly explains nothing at any scope: the predicate is about which channels may
    // participate, and the ANOMALY is what the participation is worth.
    const silent = pair('error', 'cpu', 2, 0);
    expect(charged(silent, 'caller')).toBeCloseTo(2);
    // …and a callee larger than its caller is capped at the caller's whole, as it is under every scope.
    const dominant = pair('error', 'cpu', 1, 9);
    expect(charged(dominant, 'caller')).toBeCloseTo(0);
  });
});

describe('the deduction formula, fenced at the source', () => {
  // The formula lives in its own module since iteration 158, because it turned out to be a function of the
  // anomaly map and the edges and of nothing else — and because its SPACE had to become an explicit argument
  // once the rank surface was measured to change its verdict.
  const deduction = readFileSync(resolve(HERE, '../../src/causal/topo-deduction.ts'), 'utf8');
  const pruner = readFileSync(resolve(HERE, '../../src/pruning/pruner.ts'), 'utf8');

  it('is a subtraction of the explained anomaly, not a ratio of the node’s own', () => {
    // The refused form multiplied the node's anomaly by `1 − ρ·(1 − topoSource)`. That form deducts an
    // internal anomaly because the node's CALLER carries a response anomaly, which is physically backwards.
    // Re-introducing it would compile, pass every behavioural test on a single-channel fixture, and only show
    // up as a corpus regression — so the shape is pinned here.
    expect(deduction).not.toMatch(/1\s*-\s*rho\s*\*\s*\(\s*1\s*-/);
    expect(deduction).toMatch(/anomaly\s*-\s*chargeable/);
    // The cap goes on the EXPLAINED quantity, inside the weight: `rho × min(a, e)`. Clamping the result
    // instead (`max(0, a − rho·e)`) bounds nothing, and it is the form that zeroed TrainTicket's cells.
    // The cap is a named binding since the gate exists, because the gate reads the SAME capped quantity
    // the charge does — two expressions of "how much was explained" would be free to disagree, and the
    // one a reader checked would not be the one the charge used.
    expect(deduction).toMatch(/const capped = Math\.min\(anomaly,/);
    expect(deduction).toMatch(/rho \* capped/);
    expect(deduction).not.toMatch(/Math\.max\(0,/);
    // The GATE compares against `gate × anomaly` rather than dividing by `anomaly`, which is not
    // guaranteed positive: a division there would answer `NaN` on a silent node and switch the deduction
    // off for it while the configuration line still reported it on. The division does exist now — the
    // SHARE is a ratio — so the fence pins both halves: the ratio is guarded by `anomaly > 0` on the same
    // line, and the comparison is not written as one.
    expect(deduction).toMatch(/capped >= gate \* anomaly/);
    expect(deduction).not.toMatch(/gate \* anomaly\s*\//);
    expect(deduction).toMatch(/if \(anomaly > 0\) share\.set\(nodeId, capped \/ anomaly\);/);
  });

  it('takes its input from the DEVIATION map and returns through the graph’s own transform', () => {
    // The defect iteration 157 could not see from inside its own tests: the operator is extensive and the
    // reported anomaly is a rank above `anomalyNormalizeNodeThreshold`, so the relative deduction was
    // `rho·w·(n−1)/k` — proportional to how many services the fleet has. Pinned at the call site because a
    // one-word edit (`anomalyScores`) puts it back, and only a nine-cell dispatch would notice.
    expect(pruner).toMatch(/anomalies:\s*graph\.rawAnomalyScores/);
    expect(pruner).not.toMatch(/anomalies:\s*graph\.anomalyScores/);
    expect(pruner).toMatch(
      /applyAnomalyNormalization\(deducted\.discounted,\s*graph\.anomalyNormalization\)/,
    );
    // The SHARE is not mapped through that transform, and that is the point of the instrument: a share
    // read back from a rank surface is a fraction of a step count, not of an anomaly (§3 of
    // `docs/topo-share.md`). Pinned here because the one-word edit that would do it —
    // `applyAnomalyNormalization(deducted.share, …)` — compiles and returns a plausible number.
    expect(pruner).not.toMatch(/applyAnomalyNormalization\(deducted\.share/);
  });

  it('decides the two sides with TWO predicates, because they are two questions', () => {
    // This fence used to assert the opposite — one `explicable` used on both sides, on the argument that two
    // predicates "would be free to disagree about which channels cross a call boundary". The argument is
    // sound and the premise is not: the callee side is not asked whether the channel crosses a boundary, it is
    // asked whether a callee's deviation can be an explanation at all, and a saturated callee explains its
    // caller's response in every channel. The two names ARE the matrix, so a reader can see which conjunct
    // each scope keeps without running anything:
    //
    //   `all`      — explainsThrough: always        deductibleOn: always
    //   `external` — explainsThrough: response only  deductibleOn: response only
    //   `caller`   — explainsThrough: always        deductibleOn: response only
    expect(deduction).toMatch(/const explainsThrough = \(nodeId: ServiceId\): boolean =>/);
    expect(deduction).toMatch(/const deductibleOn = \(nodeId: ServiceId\): boolean =>/);
    // The matrix, pinned by which scope name appears in which predicate: `external` is the only scope that
    // restricts the CALLEE side, and `all` the only one that frees the CALLER side. A single predicate cannot
    // satisfy both patterns, which is the regression this replaces `expect(...explicable...)` with.
    expect(deduction).toMatch(
      /const explainsThrough[\s\S]{0,240}scope === 'external'[\s\S]{0,80}isResponseChannelOf/,
    );
    expect(deduction).toMatch(
      /const deductibleOn[\s\S]{0,240}scope === 'all'[\s\S]{0,80}isResponseChannelOf/,
    );
    expect(deduction).toMatch(/isResponseChannel\(dominant\.label\)/);
    // The callee side must be consulted where the explanation is FOLDED, and the caller side where the charge
    // is applied: a swapped pair would compile, pass every same-channel fixture, and only a corpus would see it.
    expect(deduction).toMatch(/if \(!explainsThrough\(edge\.to\)\) continue;/);
    expect(deduction).toMatch(/if \(!deductibleOn\(nodeId\)\) \{/);
  });
});
