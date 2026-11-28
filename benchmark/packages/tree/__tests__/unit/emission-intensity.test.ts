/**
 * `computeEmissionScores` — the collision-source instrument that compares a node's own emission INTENSITY.
 *
 * Every number in the fixtures below is a reading of the corpus this term was proposed against
 * (`docs/rcaeval-error-scale.md` §1), restated in the corpus' own units: `error` is a per-second count and
 * `workload` is that node's per-second request count, so their ratio is errors per REQUEST and the term is the
 * ABSOLUTE change in it. The point of the fixtures is the discrimination the engine's relative deviation cannot
 * make: a source whose rate rises 8× at 2 req/s against a victim whose rate rises 6× at 25 req/s.
 *
 * @module __tests__/unit/emission-intensity
 */

import type { MetricMap, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { computeEmissionScores, EMISSION_MIN_RISE } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

/** A step series: `pre` for the samples before the boundary, `post` for the samples at or after it. */
function step(pre: number, post: number, n = 20): number[] {
  const first = Math.floor(n / 2);
  return [...Array<number>(first).fill(pre), ...Array<number>(n - first).fill(post)];
}

const series = (label: string, values: readonly number[], offsetMs = 0): TimeSeries => ({
  label,
  timestamps: values.map((_, i) => offsetMs + i * 1000),
  values: Float64Array.from(values),
  unit: '',
});

const mapOf = (entries: Record<string, readonly TimeSeries[]>): MetricMap =>
  new Map(Object.entries(entries));

/** The boundary the fixtures split on, with the 20-sample series above. */
const INJECT = 10_000;

describe('computeEmissionScores', () => {
  it('separates a source from a victim that the relative rise cannot separate', () => {
    // The corpus case, in its own units. `orders` emits 0.36 errors/s against 2.14 req/s before the injection
    // and 3.13 against 2.11 after, so its per-request rate rises 0.8427 → 8.8× in relative terms. `front-end`
    // emits 0.46 against 24.75 before and 2.81 against 24.74 after: a 6.1× rise, and a rate change of 0.0722.
    //
    // The relative reading prefers the VICTIM (6× is what the engine sees as a large deviation either way, and
    // a near-zero baseline inflates it further); the absolute reading prefers the SOURCE by 11.7×. That gap is
    // the whole reason this term exists, so it is the first thing asserted.
    const metrics = mapOf({
      orders: [series('error', step(0.36, 3.13)), series('workload', step(2.14, 2.11))],
      'front-end': [series('error', step(0.46, 2.81)), series('workload', step(24.75, 24.74))],
    });
    const scores = computeEmissionScores(metrics, INJECT);

    // The reading, restated in the fixture's own arithmetic: the source's change is 3.13/2.11 − 0.36/2.14 and
    // the victim's is 2.81/24.74 − 0.46/24.75, so the share IS the second over the first.
    const source = 3.13 / 2.11 - 0.36 / 2.14;
    const victim = 2.81 / 24.74 - 0.46 / 24.75;
    expect(scores.get('orders')).toBe(1);
    expect(scores.get('front-end')).toBeCloseTo(victim / source, 12);
    // Stated as the ratio a reader checks rather than as two decimals: the source's emission change is an
    // order of magnitude larger, and that is the claim.
    expect(scores.get('orders')! / scores.get('front-end')!).toBeGreaterThan(10);
  });

  it('is invariant to a common rescaling of the corpus, because the quantity is per request', () => {
    // The transform that was tried and refused (`toPerRequestError`) divided the error channel by a PER-SERVICE
    // workload and moved nothing — correctly, because a per-service constant scale cancels inside a relative
    // rise. This term is not that transform: it divides INSIDE each sample's rate and then compares the
    // resulting absolute change ACROSS nodes, so a common factor on both channels is invisible here too, but
    // for the opposite reason — it cancels in a ratio, not in a deviation.
    const base = {
      a: [series('error', step(1, 9)), series('workload', step(4, 4))],
      b: [series('error', step(1, 2)), series('workload', step(4, 4))],
    };
    const scaled = {
      a: [series('error', step(3, 27)), series('workload', step(12, 12))],
      b: [series('error', step(3, 6)), series('workload', step(12, 12))],
    };
    const one = computeEmissionScores(mapOf(base), INJECT);
    const two = computeEmissionScores(mapOf(scaled), INJECT);
    expect(two.get('a')).toBeCloseTo(one.get('a')!, 12);
    expect(two.get('b')).toBeCloseTo(one.get('b')!, 12);
    // And the common factor is not what decides: `a` changes by 2 errors/request and `b` by 0.25.
    expect(one.get('a')).toBe(1);
    expect(one.get('b')).toBeCloseTo(0.25 / 2, 12);
  });

  it('refuses a node whose two channels are not sampled at the same instants', () => {
    // An element-wise quotient across two series that merely happen to be the same LENGTH pairs an error count
    // from one instant with a request count from another, and a misaligned denominator is not a denominator.
    // The refusal is the same one the refused input transform made, and it is asserted here so a future
    // "optimisation" that drops the alignment check fails a test rather than a claim.
    const metrics = mapOf({
      skewed: [
        series('error', step(1, 9)),
        {
          label: 'workload',
          timestamps: step(4, 4).map((_, i) => i * 1000 + 1),
          values: Float64Array.from(step(4, 4)),
          unit: '',
        },
      ],
      aligned: [series('error', step(1, 9)), series('workload', step(4, 4))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.has('skewed')).toBe(false);
    expect(scores.has('aligned')).toBe(true);
  });

  it('needs BOTH channels, and a denominator that is not zero', () => {
    const metrics = mapOf({
      noError: [series('workload', step(4, 4))],
      noWorkload: [series('error', step(1, 9))],
      idle: [series('error', step(1, 9)), series('workload', step(0, 0))],
      measured: [series('error', step(1, 9)), series('workload', step(4, 4))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.has('noError')).toBe(false);
    expect(scores.has('noWorkload')).toBe(false);
    expect(scores.has('idle')).toBe(false);
    expect(scores.has('measured')).toBe(true);
  });

  it('admits a node that emitted nothing before the boundary, which is the case the term exists for', () => {
    // A source whose error channel is quiet before the fault and loud after is not an idle instrument — the
    // zero is a measurement ("no errors were returned"), and a term that refused it would be refusing exactly
    // the signature it is looking for.
    const metrics = mapOf({
      quiet: [series('error', step(0, 2)), series('workload', step(2, 2))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.get('quiet')).toBe(1);
  });

  it('is EMPTY, not zeros, when no node changed its emission measurably', () => {
    // The map is sparse in the same sense every sparse map in this engine is: "this case carries no emission
    // evidence" is an ABSENCE. A zero would be indistinguishable from a measured zero change, and the term
    // would then be reporting a reading it does not have.
    const tiny = EMISSION_MIN_RISE / 100;
    const metrics = mapOf({
      a: [series('error', step(0.001, 0.001 + tiny)), series('workload', step(1000, 1000))],
      b: [series('error', step(0.001, 0.001)), series('workload', step(1000, 1000))],
    });
    expect(computeEmissionScores(metrics, INJECT).size).toBe(0);
  });

  it('admits a case whose best emission change clears the floor', () => {
    const metrics = mapOf({
      a: [series('error', step(0, 2)), series('workload', step(10, 10))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.size).toBe(1);
    expect(scores.get('a')).toBe(1);
  });

  it('refuses the whole case when the boundary is unknown', () => {
    // No injection instant, no split, and a split made anywhere else would be a split at an arbitrary sample.
    const metrics = mapOf({ a: [series('error', step(1, 9)), series('workload', step(4, 4))] });
    expect(computeEmissionScores(metrics, 0).size).toBe(0);
  });

  it('leaves a node whose emission FELL out of the map entirely', () => {
    // A collision source emits more; a node that emitted less is not a source under this instrument, and a
    // negative share would let the term reward a node for recovering.
    const metrics = mapOf({
      recovered: [series('error', step(9, 1)), series('workload', step(4, 4))],
      rose: [series('error', step(1, 2)), series('workload', step(4, 4))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.has('recovered')).toBe(false);
    expect(scores.get('rose')).toBe(1);
  });

  it('normalises by the case maximum, so the term is a share and not a unit-bearing magnitude', () => {
    // The term is additive beside `log1p(anomaly)` and the other terms, so it has to live on the same [0, 1]
    // scale. What survives the normalisation is the ORDER and the relative gaps, which is what a ranking reads.
    const metrics = mapOf({
      big: [series('error', step(0, 8)), series('workload', step(2, 2))],
      mid: [series('error', step(0, 4)), series('workload', step(2, 2))],
      small: [series('error', step(0, 1)), series('workload', step(2, 2))],
    });
    const scores = computeEmissionScores(metrics, INJECT);
    expect(scores.get('big')).toBe(1);
    expect(scores.get('mid')).toBeCloseTo(0.5, 12);
    expect(scores.get('small')).toBeCloseTo(0.125, 12);
  });

  it('measures an equal-length window on each side of the boundary, and stops at its end', () => {
    // The post window is `[inject, inject + span)` with `span` the recording's own pre-injection length, so the
    // two means are taken over the same amount of time and a decaying fault is not diluted by a longer tail.
    // The fixture decays back to its baseline for 400 samples after a 20-sample fault, which is the shape the
    // corpus' `carts` cases carry: a window that ran to the end of the recording would read 0.69 instead of
    // 1.385 and the term would be measuring the recording's length.
    // The reference node's change is exactly 4 errors/request, so the measured node's share IS its change over
    // that reference — a fixed scale rather than the case maximum, which is the node itself.
    const values = [
      ...Array<number>(20).fill(0.36),
      ...Array<number>(20).fill(3.13),
      ...Array<number>(400).fill(0.36),
    ];
    const metrics = mapOf({
      a: [series('error', values), series('workload', Array<number>(440).fill(2))],
      // The reference rises at the FIRST sample and stays up, so its change is 8/2 = 4 errors per request in
      // any window that starts inside the rise.
      ref: [
        series('error', [...Array<number>(20).fill(0), ...Array<number>(420).fill(8)]),
        series('workload', Array<number>(440).fill(2)),
      ],
    });
    const scores = computeEmissionScores(metrics, 20_000);
    // a: 3.13/2 − 0.36/2 = 1.385 over the window; the 400-sample tail is OUTSIDE it.
    expect(scores.get('ref')).toBe(1);
    expect(scores.get('a')).toBeCloseTo(1.385 / 4, 6);
  });
});
