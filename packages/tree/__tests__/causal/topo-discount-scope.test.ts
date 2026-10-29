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
  const pruner = readFileSync(resolve(HERE, '../../src/pruning/pruner.ts'), 'utf8');

  it('is a subtraction of the explained anomaly, not a ratio of the node’s own', () => {
    // The refused form multiplied the node's anomaly by `1 − ρ·(1 − topoSource)`. That form deducts an
    // internal anomaly because the node's CALLER carries a response anomaly, which is physically backwards.
    // Re-introducing it would compile, pass every behavioural test on a single-channel fixture, and only show
    // up as a corpus regression — so the shape is pinned here.
    expect(pruner).not.toMatch(/1\s*-\s*rho\s*\*\s*\(\s*1\s*-/);
    expect(pruner).toMatch(/anomaly\s*-\s*deduction/);
  });

  it('decides both sides of the deduction with ONE predicate', () => {
    // The explaining callee and the deducted caller answer the same question — does this channel cross a call
    // boundary — and two predicates would be free to disagree about which channels do.
    expect(pruner).toMatch(/const explicable = \(nodeId: ServiceId\): boolean =>/);
    expect(pruner).toMatch(/isResponseChannel\(dominant\.label\)/);
  });
});
