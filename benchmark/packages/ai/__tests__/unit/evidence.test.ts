import { describe, expect, it } from 'vitest';

import {
  channelsByEvidence,
  compareChannelEvidence,
  departureOf,
  evidenceOf,
} from '../../src/agent/evidence.js';
import type { ChannelFingerprint } from '../../src/agent/hypothesis-space.js';

function fired(
  label: string,
  post: number,
  band: readonly [number, number],
  onset?: number,
  rate = 0,
): ChannelFingerprint {
  return { label, pre: band[0], post, band, rate, ...(onset === undefined ? {} : { onset }) };
}

function quiet(
  label: string,
  value: number,
  band: readonly [number, number],
  rate = 0,
): ChannelFingerprint {
  return { label, pre: value, post: value, band, rate };
}

const labels = (channels: readonly ChannelFingerprint[]): readonly string[] =>
  channels.map((channel) => channel.label);

describe('departureOf', () => {
  it('is zero inside the band and measured in band widths outside it', () => {
    expect(departureOf(quiet('cpu', 0.2, [0.1, 0.3]))).toBe(0);
    // 0.3 is the top of the band, width 0.2, and 0.9 is 0.6 above it: three widths.
    expect(departureOf(fired('cpu', 0.9, [0.1, 0.3]))).toBeCloseTo(3, 12);
    expect(departureOf(fired('cpu', -0.1, [0.1, 0.3]))).toBeCloseTo(1, 12);
  });

  it('reads a move off a zero-width band as unbounded, not as a made-up scale', () => {
    // `error` sits at exactly zero in a fault-free window, so its band is the single point [0, 0]. A channel that
    // reports 0.5 there has moved by an unbounded number of widths, and a finite number would be a scale nobody
    // chose — so the departure is infinite, which also makes it sort as the strongest evidence there is.
    expect(departureOf(fired('error', 0.5, [0, 0]))).toBe(Number.POSITIVE_INFINITY);
    expect(departureOf({ label: 'error', pre: 0, post: 0, band: [0, 0], rate: 0 })).toBe(0);
    // An inverted band is a malformed fingerprint rather than a narrow one; it is read the same way.
    expect(departureOf(fired('cpu', 0.9, [0.3, 0.1]))).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads an unmeasurable value as an infinite departure rather than as no evidence', () => {
    expect(departureOf({ label: 'cpu', pre: 0, post: NaN, band: [0, 1], rate: 0 })).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(
      departureOf({ label: 'cpu', pre: 0, post: 2, band: [0, Number.POSITIVE_INFINITY], rate: 0 }),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures a byte-scaled channel in its own band, so a raw large number is not a large departure', () => {
    // The defect this module was written to remove: `post` 1.2 GB against a band one gigabyte wide is a fifth of a
    // band, and 0.5 against a band a tenth wide is four bands. Ranked in absolute units the first wins by 1e9.
    expect(departureOf(fired('bytes', 1.2e9, [0, 1e9]))).toBeCloseTo(0.2, 12);
    expect(departureOf(fired('ratio', 0.5, [0, 0.1]))).toBeCloseTo(4, 12);
  });
});

describe('evidenceOf', () => {
  it('carries the channel it measured, so a caller never re-derives the departure', () => {
    const channel = fired('cpu', 0.9, [0.1, 0.3], 4200, 0.02);
    // identity, not equality: a copied channel is a second object a caller could mutate out from under the order.
    expect(evidenceOf(channel).channel).toBe(channel);
    expect(evidenceOf(channel).departure).toBeCloseTo(3, 12);
  });
});

describe('compareChannelEvidence', () => {
  it('puts an out-of-band channel above an in-band one whatever their rates are', () => {
    // A channel inside its band cannot be cited at all — the verifier refuses it — so a rare in-band channel still
    // belongs below a noisy out-of-band one. Rarity is a tie-break among evidence, not a substitute for it.
    const rareInside = evidenceOf(quiet('rare-inside', 0.2, [0.1, 0.3], 0));
    const noisyOutside = evidenceOf(fired('noisy-outside', 0.9, [0.1, 0.3], 100, 0.99));
    expect(compareChannelEvidence(rareInside, noisyOutside)).toBeGreaterThan(0);
    expect(compareChannelEvidence(noisyOutside, rareInside)).toBeLessThan(0);
  });

  it('prefers the rarer excursion even when the other channel is far further out', () => {
    // The 1 422-case corpus's defect, in one comparison: `container.filesystem.available` sits sixteen band widths
    // outside a band it leaves in 99 % of fault-free windows, and it led every table it appeared in.
    const noisy = fired('filesystem', 1.6e10, [1.7977e10, 1.8203e10], 1788, 0.99);
    const rare = fired('latency_p99', 14.9, [11, 14.2], 4200, 0.02);
    expect(departureOf(noisy)).toBeGreaterThan(departureOf(rare) * 10);
    expect(labels(channelsByEvidence([noisy, rare], 2))).toEqual(['latency_p99', 'filesystem']);
    expect(labels(channelsByEvidence([rare, noisy], 2))).toEqual(['latency_p99', 'filesystem']);
  });

  it('breaks a rate tie on onset, and an onset tie on departure, in both directions', () => {
    const wide = fired('wide', 3.9, [0.1, 0.3], 100);
    const near = fired('near', 0.5, [0.1, 0.3], 100);
    const later = fired('later', 3.9, [0.1, 0.3], 200);
    expect(labels(channelsByEvidence([near, wide, later], 3))).toEqual(['wide', 'near', 'later']);
    expect(labels(channelsByEvidence([later, wide, near], 3))).toEqual(['wide', 'near', 'later']);
    expect(labels(channelsByEvidence([wide, near], 2))).toEqual(['wide', 'near']);
    expect(labels(channelsByEvidence([near, wide], 2))).toEqual(['wide', 'near']);
  });

  it('sorts a channel that never fired after every one that did, whatever its label', () => {
    // Absent onset is sorted last by construction rather than read as zero: a channel that never left its band has
    // no time, and a zero would place it at the injection instant.
    const neverFired = quiet('alpha', 0.2, [0.1, 0.3]);
    const firedLate = fired('zeta', 0.9, [0.1, 0.3], 30000);
    expect(labels(channelsByEvidence([neverFired, firedLate], 2))).toEqual(['zeta', 'alpha']);
  });

  it('orders two channels that agree on every key by label, so the digest cannot depend on array order', () => {
    const left = quiet('beta', 0.2, [0.1, 0.3]);
    const right = quiet('alpha', 0.2, [0.1, 0.3]);
    expect(labels(channelsByEvidence([left, right], 2))).toEqual(['alpha', 'beta']);
    expect(labels(channelsByEvidence([right, left], 2))).toEqual(['alpha', 'beta']);
  });

  it('treats two channels that are identical in every key as equal rather than as ordered', () => {
    // A duplicate label on one candidate is a malformed fingerprint, and the comparator still has to answer: it
    // answers zero, which is the only answer that does not invent a difference the data does not state.
    const twice = [quiet('cpu', 0.2, [0.1, 0.3]), quiet('cpu', 0.2, [0.1, 0.3])];
    expect(channelsByEvidence(twice, 2)).toHaveLength(2);
    expect(labels(channelsByEvidence(twice, 2))).toEqual(['cpu', 'cpu']);
  });

  it('compares two unbounded departures without producing NaN', () => {
    // Two channels off zero-width bands: `∞ − ∞` is `NaN`, and a `NaN` comparator leaves the order to the sort
    // implementation. The comparison is written as an inequality so the pair falls through to the label.
    const first = fired('error', 0.5, [0, 0], 100, 0.01);
    const second = fired('fault', 0.9, [0, 0], 100, 0.01);
    expect(departureOf(first)).toBe(Number.POSITIVE_INFINITY);
    expect(departureOf(second)).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(compareChannelEvidence(evidenceOf(first), evidenceOf(second)))).toBe(false);
    expect(labels(channelsByEvidence([second, first], 2))).toEqual(['error', 'fault']);
  });
});

describe('channelsByEvidence', () => {
  it('keeps at most the limit, and nothing at all at a limit of zero or below', () => {
    const channels = [
      fired('latency_p99', 98.25, [11, 14.2], 4200, 0.01),
      quiet('error', 0, [0, 0]),
    ];
    expect(labels(channelsByEvidence(channels, 1))).toEqual(['latency_p99']);
    expect(channelsByEvidence(channels, 0)).toEqual([]);
    // A negative limit is a caller's arithmetic slip, not a request for everything.
    expect(channelsByEvidence(channels, -3)).toEqual([]);
  });

  it('returns an empty order for a candidate with no profiled channel', () => {
    expect(channelsByEvidence([], 6)).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const channels = [quiet('beta', 0.2, [0.1, 0.3]), quiet('alpha', 0.2, [0.1, 0.3])];
    const before = labels(channels);
    channelsByEvidence(channels, 2);
    expect(labels(channels)).toEqual(before);
  });
});
