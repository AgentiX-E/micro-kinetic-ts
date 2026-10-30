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

import {
  DEFAULT_TOPO_DISCOUNT_SCOPE,
  TOPO_DISCOUNT_SCOPES,
  isResponseChannel,
  isTopoDiscountScope,
} from '../../src/causal/topology-fault-graph.js';

const HERE = dirname(fileURLToPath(import.meta.url));

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
  it('admits exactly the two scopes', () => {
    expect(isTopoDiscountScope('all')).toBe(true);
    expect(isTopoDiscountScope('external')).toBe(true);
    expect(Object.keys(TOPO_DISCOUNT_SCOPES).sort()).toEqual(['all', 'external']);
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

  it('decides both sides of the deduction with ONE predicate', () => {
    // The explaining callee and the deducted caller answer the same question — does this channel cross a call
    // boundary — and two predicates would be free to disagree about which channels do.
    expect(deduction).toMatch(/const explicable = \(nodeId: ServiceId\): boolean =>/);
    expect(deduction).toMatch(/isResponseChannel\(dominant\.label\)/);
  });
});
