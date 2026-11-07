/**
 * Guards on the finite cycle certificate.
 *
 * ## What is being guarded
 *
 * The certificate replaces an inherited Boltzmann–Grad asymptotics with a finite-size bound: in a digraph with
 * `n` nodes and maximum in-degree `d`, cycles of length ≥ 3 contribute at most
 * `n · (dα)³ / (1 − dα)` whenever `dα < 1`. The fences below are about the three ways a bound like this goes
 * wrong while looking right — using a quantity that does not bound walks, certifying at the divergence boundary,
 * and collapsing "no bound exists" into "the bound is large".
 *
 * @module optimize/__tests__/unit/cycle-bound
 */

import { describe, expect, it } from 'vitest';

import {
  cycleCertificate,
  formatAttenuation,
  formatCycleCertificate,
  measureAttenuation,
  type DirectedEdge,
} from '../../src/cycle-bound.js';

const EDGES: DirectedEdge[] = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'a' }, // a 3-cycle
  { from: 'd', to: 'c' }, // gives c an in-degree of 2
];

describe('the finite cycle certificate', () => {
  it('bounds with the IN-degree, because a closed walk chooses an incoming edge each step', () => {
    // Using the out-degree here would still look like a bound and would be the wrong quantity: a service's
    // walk-extension is limited by how many callers it has, not by how many services it calls.
    const c = cycleCertificate(EDGES, 4, { alpha: 0.1, epsilon: 1 });
    expect(c.nodes).toBe(4);
    expect(c.edges).toBe(4);
    expect(c.maxInDegree).toBe(2); // `c` is called by `b` and `d`
    expect(c.geometricRatio).toBeCloseTo(0.2, 10);
    expect(c.bounded).toBe(true);
    expect(c.bound).toBeCloseTo((4 * 0.2 ** 3) / (1 - 0.2), 10);
    expect(c.certified).toBe(true);
  });

  it('treats the divergence boundary as UNBOUNDED rather than as a large number', () => {
    // At `dα = 1` the series is 1 + 1 + 1 + …, which diverges. Rounding it into a finite bound would certify a
    // graph the algebra does not cover — and it is exactly the boundary a tuned α would land on.
    const atBoundary = cycleCertificate(EDGES, 4, { alpha: 0.5, epsilon: 1 }); // dα = 1
    expect(atBoundary.bounded).toBe(false);
    expect(atBoundary.bound).toBe(Number.POSITIVE_INFINITY);
    expect(atBoundary.certified).toBe(false);
    expect(formatCycleCertificate(atBoundary, { alpha: 0.5, epsilon: 1 })).toContain('NOT BOUNDED');

    const above = cycleCertificate(EDGES, 4, { alpha: 0.9, epsilon: 1 }); // dα = 1.8
    expect(above.bounded).toBe(false);
    expect(above.certified).toBe(false);
  });

  it('separates "convergent but above tolerance" from "no bound exists"', () => {
    // Two different findings about a case: one refutes the reduction's use, the other only says this attenuation
    // is not enough to prove it. Collapsing them into a boolean would hide which case a reader is looking at.
    const loose = cycleCertificate(EDGES, 4, { alpha: 0.1, epsilon: 1e-6 });
    expect(loose.bounded).toBe(true);
    expect(loose.certified).toBe(false);
    expect(formatCycleCertificate(loose, { alpha: 0.1, epsilon: 1e-6 })).toContain('UNCERTIFIED');
  });

  it('is tightest where the graph is: a denser fan-in needs a smaller α to certify', () => {
    // The certificate is a statement about the GRAPH, so the threshold must move with the in-degree — otherwise
    // it is a constant wearing a formula.
    const star: DirectedEdge[] = Array.from({ length: 40 }, (_, i) => ({ from: `s${i}`, to: 'hub' }));
    const sparse = cycleCertificate(EDGES, 4, { alpha: 0.2, epsilon: 1 });
    const dense = cycleCertificate(star, 41, { alpha: 0.2, epsilon: 1 }); // d = 40, dα = 8
    expect(sparse.certified).toBe(true);
    expect(dense.bounded).toBe(false);
    expect(dense.certified).toBe(false);
  });

  it('certifies a graph with no edges, and ignores a duplicated edge', () => {
    // No edges means no cycles, so the reduction holds trivially; a duplicated edge is the same choice and must
    // not inflate `d` into a stricter bound than the graph deserves.
    const empty = cycleCertificate([], 3, { alpha: 0.5, epsilon: 1 });
    expect(empty.maxInDegree).toBe(0);
    expect(empty.certified).toBe(true);
    const duplicated = cycleCertificate([...EDGES, ...EDGES], 4, { alpha: 0.1, epsilon: 1 });
    expect(duplicated.edges, 'distinct edges only').toBe(4);
    expect(duplicated.maxInDegree).toBe(2);
  });

  it('prints its own parameters, so a verdict cannot be read without them', () => {
    // The same graph is certified at one α and refuted at another; a line that omitted them would let a reader
    // compare two incomparable verdicts.
    const c = cycleCertificate(EDGES, 4, { alpha: 0.05, epsilon: 1e-3 });
    const line = formatCycleCertificate(c, { alpha: 0.05, epsilon: 1e-3 });
    expect(line).toContain('alpha=0.05');
    expect(line).toContain('maxInDegree=2');
    expect(line).toContain('d*alpha=0.1000');
  });
});

describe('measuring the attenuation the certificate needs', () => {
  it('summarises without assuming a shape, and reports the tail', () => {
    // A fault's per-hop transmission has a long right tail — a victim can look worse than its source — so the
    // MEDIAN is the headline and the p90 is reported beside it: the certificate is a worst-case bound, and a
    // reader needs to see how much of the distribution would fail it.
    const e = measureAttenuation([0.1, 0.2, 0.3, 0.4, 0.5, 8]);
    expect(e).toBeDefined();
    expect(e!.samples).toBe(6);
    expect(e!.median).toBe(0.3);
    expect(e!.p90).toBe(0.5);
    expect(e!.max).toBe(8);
    expect(e!.mean).toBeCloseTo((0.1 + 0.2 + 0.3 + 0.4 + 0.5 + 8) / 6, 10);
  });

  it('returns NOTHING for no samples, because an absent measurement is not a zero', () => {
    // Returning `median: 0` would certify every graph — the single most damaging way for this estimator to be
    // wrong, since the certificate it feeds is a claim of proof.
    expect(measureAttenuation([])).toBeUndefined();
    expect(measureAttenuation([Number.NaN, Number.POSITIVE_INFINITY, -1])).toBeUndefined();
  });

  it('drops the samples no ratio can be formed from, rather than clamping them', () => {
    // An infinite ratio is an upstream of zero, which carries no transmission measurement; a negative one is not
    // a ratio. Clamping either into the distribution would move the estimate with arithmetic that did not happen.
    const e = measureAttenuation([0.2, Number.POSITIVE_INFINITY, -1, Number.NaN, 0.4]);
    expect(e!.samples).toBe(2);
    expect(e!.median).toBe(0.2);
    expect(e!.max).toBe(0.4);
  });

  it('names which estimator a line is about, since two of them are reported', () => {
    const line = formatAttenuation(measureAttenuation([0.25])!, 'anomaly-score ratio');
    expect(line).toContain('attenuation[anomaly-score ratio]');
    expect(line).toContain('median=0.2500');
    expect(line).toContain('range=[0.2500, 0.2500]');
  });
});
