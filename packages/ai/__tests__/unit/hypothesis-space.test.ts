import { describe, expect, it } from 'vitest';

import type {
  CandidateFingerprint,
  ChannelFingerprint,
  EliminationClaim,
} from '../../src/agent/hypothesis-space.js';
import {
  DEFAULT_CONSULTATION_OPTIONS,
  applyClaims,
  decideConsultation,
  verifyClaim,
} from '../../src/agent/hypothesis-space.js';

/** A channel that sits outside its band after injection: the shape every claim in these tests cites. */
function fired(label: string, post: number, band: readonly [number, number]): ChannelFingerprint {
  return { label, pre: band[0], post, band, rate: 0 };
}

/** A channel that never left its band. */
function quiet(label: string, value: number, band: readonly [number, number]): ChannelFingerprint {
  return { label, pre: value, post: value, band, rate: 0 };
}

function candidate(
  service: string,
  rank: number,
  score: number,
  channels: readonly ChannelFingerprint[],
): CandidateFingerprint {
  return { service, rank, score, channels };
}

const auth = candidate('ts-auth-service', 0, 1.0, [
  fired('latency_p99', 91, [11, 14.2]),
  quiet('error', 0, [0, 0]),
]);
const order = candidate('ts-order-service', 1, 0.8, [
  fired('latency_p99', 40, [11, 14.2]),
  fired('cpu', 0.9, [0.1, 0.3]),
]);
const posterior = [auth, order];

/** A claim that the fingerprint supports: order's latency is outside its band by less than auth's. */
const grounded: EliminationClaim = {
  remove: 'ts-order-service',
  keep: 'ts-auth-service',
  because: { channel: 'latency_p99', statistic: 'post', observed: 40, band: [11, 14.2] },
};

describe('verifyClaim', () => {
  it('accepts a claim every field of which the fingerprint supports', () => {
    const verdict = verifyClaim(grounded, posterior);
    expect(verdict.ok).toBe(true);
  });

  it('refuses a claim naming a candidate the posterior does not hold', () => {
    // Both arms are separate: a claim can be wrong about the removed candidate or about the kept one, and the
    // rejection is the same word but a different repair.
    expect(verifyClaim({ ...grounded, remove: 'ts-absent' }, posterior)).toMatchObject({
      ok: false,
      reason: 'unknown-candidate',
    });
    expect(verifyClaim({ ...grounded, keep: 'ts-absent' }, posterior)).toMatchObject({
      ok: false,
      reason: 'unknown-candidate',
    });
  });

  it('refuses a claim that removes the candidate it keeps', () => {
    const claim: EliminationClaim = {
      ...grounded,
      remove: 'ts-auth-service',
      keep: 'ts-auth-service',
    };
    expect(verifyClaim(claim, posterior)).toMatchObject({ ok: false, reason: 'same-candidate' });
  });

  it('refuses a claim citing a channel absent from either candidate', () => {
    // The channel exists on the removed candidate but not on the kept one: without both readings there is no
    // comparison, so the claim is not weak evidence, it is not evidence.
    expect(
      verifyClaim(
        { ...grounded, because: { ...grounded.because, channel: 'cpu', observed: 0.9 } },
        posterior,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-channel' });
    expect(
      verifyClaim(
        { ...grounded, because: { ...grounded.because, channel: 'nobody-measured' } },
        posterior,
      ),
    ).toMatchObject({ ok: false, reason: 'unknown-channel' });
  });

  it('refuses an onset claim when either channel never left its band', () => {
    // An absent onset is the strongest form of no evidence. Treating it as zero would make the quiet channel
    // look like the earliest one, which inverts the claim being made.
    const withOnset = candidate('a', 0, 1, [{ ...fired('lat', 9, [1, 2]), onset: 3_000 }]);
    const withoutOnset = candidate('b', 1, 0.5, [fired('lat', 5, [1, 2])]);
    const claim: EliminationClaim = {
      remove: 'b',
      keep: 'a',
      because: { channel: 'lat', statistic: 'onset', observed: 3_000, band: [1, 2] },
    };
    expect(verifyClaim(claim, [withOnset, withoutOnset])).toMatchObject({
      ok: false,
      reason: 'unsupported-statistic',
    });
    // And the mirror: the kept candidate is the one missing the onset.
    expect(
      verifyClaim({ ...claim, remove: 'a', keep: 'b' }, [withOnset, withoutOnset]),
    ).toMatchObject({
      ok: false,
      reason: 'unsupported-statistic',
    });
  });

  it('accepts an onset claim when both channels carry one', () => {
    const early = candidate('a', 0, 1, [{ ...fired('lat', 9, [1, 2]), onset: 3_000 }]);
    const late = candidate('b', 1, 0.5, [{ ...fired('lat', 5, [1, 2]), onset: 11_000 }]);
    const claim: EliminationClaim = {
      remove: 'b',
      keep: 'a',
      because: { channel: 'lat', statistic: 'onset', observed: 11_000, band: [1, 2] },
    };
    expect(verifyClaim(claim, [early, late]).ok).toBe(true);
  });

  it('refuses a band the profile did not publish', () => {
    // This is the failure a model makes when it guesses a plausible interval. It is refused on the band alone,
    // before the value is even looked at, because a claim about a band nobody measured is unfalsifiable.
    const claim: EliminationClaim = {
      ...grounded,
      because: { ...grounded.because, band: [0, 100] },
    };
    expect(verifyClaim(claim, posterior)).toMatchObject({
      ok: false,
      reason: 'band-disagrees-with-fingerprint',
    });
  });

  it('refuses an observed value the engine did not measure', () => {
    const claim: EliminationClaim = {
      ...grounded,
      because: { ...grounded.because, observed: 40.0001 },
    };
    expect(verifyClaim(claim, posterior)).toMatchObject({
      ok: false,
      reason: 'value-disagrees-with-fingerprint',
    });
  });

  it('refuses an expected-outlier rate the profile does not publish, and accepts one it does', () => {
    // The rate is the second thing a claim may rest on: the band says "this moved", the rate says "and it moves
    // like this when nothing is wrong". A claim that makes the second argument must state the number it is making
    // it with, and the number is checked like every other field.
    const faithful: EliminationClaim = {
      ...grounded,
      because: { ...grounded.because, rate: 0 },
    };
    expect(verifyClaim(faithful, posterior).ok).toBe(true);
    const invented: EliminationClaim = {
      ...grounded,
      because: { ...grounded.because, rate: 0.4 },
    };
    expect(verifyClaim(invented, posterior)).toMatchObject({
      ok: false,
      reason: 'rate-disagrees-with-fingerprint',
    });
  });

  it('checks the rate AFTER the value, so a claim wrong about both names the first disagreement', () => {
    const both: EliminationClaim = {
      ...grounded,
      because: { ...grounded.because, observed: 41, rate: 0.4 },
    };
    expect(verifyClaim(both, posterior)).toMatchObject({
      ok: false,
      reason: 'value-disagrees-with-fingerprint',
    });
  });

  it('treats a remembered NaN as the value it is, not as a mismatch', () => {
    // A channel whose post mean is NaN is a channel the engine could not measure. A claim copying that NaN is
    // faithful, so `sameNumber` must not reject it for the reason `NaN !== NaN` — the claim then fails or passes
    // on the band test, which is the honest ground.
    const broken = candidate('a', 0, 1, [fired('lat', Number.NaN, [1, 2])]);
    const other = candidate('b', 1, 0.5, [fired('lat', 5, [1, 2])]);
    const claim: EliminationClaim = {
      remove: 'a',
      keep: 'b',
      because: { channel: 'lat', statistic: 'post', observed: Number.NaN, band: [1, 2] },
    };
    // `NaN` is never inside a band, so the claim is accepted rather than rejected as a value mismatch.
    expect(verifyClaim(claim, [broken, other]).ok).toBe(true);
  });

  it('refuses to remove a candidate whose own evidence is inside its band', () => {
    // The claim is not wrong about a number; it is wrong about what the number means. This is the failure family
    // the trajectory study calls unsupported reasoning, and it is the only judgement in the verifier.
    const quietCandidate = candidate('q', 1, 0.5, [quiet('latency_p99', 12, [11, 14.2])]);
    const claim: EliminationClaim = {
      remove: 'q',
      keep: 'ts-auth-service',
      because: { channel: 'latency_p99', statistic: 'post', observed: 12, band: [11, 14.2] },
    };
    expect(verifyClaim(claim, [auth, quietCandidate])).toMatchObject({
      ok: false,
      reason: 'removed-candidate-is-inside-its-band',
    });
  });

  it('reads a delta claim from the difference of the two segments', () => {
    // Both candidates must carry the channel, so the riser is expressed on the channel the kept candidate has.
    const riser = candidate('r', 0, 1, [
      { label: 'latency_p99', pre: 11, post: 40, band: [11, 14.2], rate: 0 },
    ]);
    const claim: EliminationClaim = {
      remove: 'r',
      keep: 'ts-auth-service',
      because: { channel: 'latency_p99', statistic: 'delta', observed: 29, band: [11, 14.2] },
    };
    // A delta claim is about the segment difference, not the post level: 40 - 11 leaves the band while the post
    // value alone would have been judged by a different number. Reading the stored difference keeps the claim
    // checkable against the same arithmetic the engine used.
    expect(verifyClaim(claim, [riser, auth]).ok).toBe(true);
  });

  it('carries the refusal back with the claim, so a caller can report what was refused', () => {
    const verdict = verifyClaim({ ...grounded, remove: 'ts-absent' }, posterior);
    expect(verdict.claim).toEqual({ ...grounded, remove: 'ts-absent' });
  });
});

describe('applyClaims', () => {
  it('is the identity at weight zero, and returns the very same array', () => {
    // Identity rather than equality: the anchor asserts a ranking is bit-identical to a run that has no agentic
    // layer, and returning a copy would make that assertion depend on deep equality rather than on nothing
    // happening at all.
    const verdicts = [verifyClaim(grounded, posterior)];
    expect(applyClaims(posterior, verdicts, 0)).toBe(posterior);
  });

  it('is the identity for a negative weight, which no caller should pass but a parser might', () => {
    expect(applyClaims(posterior, [verifyClaim(grounded, posterior)], -0.5)).toBe(posterior);
  });

  it('is the identity when every verdict was refused', () => {
    const refused = [verifyClaim({ ...grounded, remove: 'ts-absent' }, posterior)];
    expect(applyClaims(posterior, refused, 0.5)).toBe(posterior);
  });

  it('damps the removed candidate and re-ranks, renumbering the ranks it returns', () => {
    const ranked = applyClaims(posterior, [verifyClaim(grounded, posterior)], 0.5);
    expect(ranked.map((entry) => entry.service)).toEqual(['ts-auth-service', 'ts-order-service']);
    expect(ranked[0]?.score).toBe(1.0);
    expect(ranked[1]?.score).toBe(0.4);
    expect(ranked.map((entry) => entry.rank)).toEqual([0, 1]);
  });

  it('can promote a candidate that was second', () => {
    // A claim removes a candidate, and the removed one may be the LEADER. With full weight the leader drops to
    // zero and the runner-up takes rank 0 — the arm that lets the layer correct the engine rather than only
    // confirm it, which is the whole reason the layer exists.
    const withCpu = [
      candidate('a', 0, 1.0, [fired('cpu', 0.9, [0, 0.1])]),
      candidate('b', 1, 0.9, [fired('cpu', 0.95, [0, 0.1])]),
    ];
    const promoting: EliminationClaim = {
      remove: 'a',
      keep: 'b',
      because: { channel: 'cpu', statistic: 'post', observed: 0.9, band: [0, 0.1] },
    };
    const verdict = verifyClaim(promoting, withCpu);
    expect(verdict.ok).toBe(true);
    const ranked = applyClaims(withCpu, [verdict], 1);
    expect(ranked.map((entry) => entry.service)).toEqual(['b', 'a']);
    expect(ranked[0]?.rank).toBe(0);
  });

  it('clamps a weight above one instead of erasing the candidate', () => {
    const ranked = applyClaims(posterior, [verifyClaim(grounded, posterior)], 5);
    expect(ranked[1]?.score).toBe(0);
  });

  it('breaks a score tie by the original rank, so the order does not depend on array order', () => {
    const tie = [
      candidate('a', 0, 0.5, [fired('cpu', 0.9, [0, 0.1])]),
      candidate('b', 1, 0.5, [fired('cpu', 0.9, [0, 0.1])]),
    ];
    const claim: EliminationClaim = {
      remove: 'b',
      keep: 'a',
      because: { channel: 'cpu', statistic: 'post', observed: 0.9, band: [0, 0.1] },
    };
    const damped = applyClaims(tie, [verifyClaim(claim, tie)], 0.5);
    expect(damped[0]?.service).toBe('a');
    expect(damped[1]?.service).toBe('b');
  });

  it('applies a candidate damped by two agreeing claims only once', () => {
    const twin: EliminationClaim = {
      ...grounded,
      because: { channel: 'cpu', statistic: 'post', observed: 0.9, band: [0.1, 0.3] },
    };
    const ranked = applyClaims(
      posterior,
      [verifyClaim(grounded, posterior), verifyClaim(twin, posterior)],
      0.5,
    );
    // Two claims about the same candidate must not compound into an exclusion neither justified.
    expect(ranked[1]?.score).toBe(0.4);
  });

  it('leaves candidates the claims did not name untouched, by reference', () => {
    const ranked = applyClaims(posterior, [verifyClaim(grounded, posterior)], 0.5);
    expect(ranked[0]).toBe(auth);
  });
});

describe('decideConsultation', () => {
  it('skips an empty posterior, because there is nothing to eliminate from', () => {
    expect(decideConsultation([], DEFAULT_CONSULTATION_OPTIONS)).toEqual({
      consult: false,
      reason: 'evidence',
      margin: 0,
      decisiveChannels: 0,
    });
  });

  it('asks for an agent when the top two are close and the leader rests on one channel', () => {
    const close = [
      candidate('a', 0, 1.0, [fired('cpu', 0.9, [0, 0.1])]),
      candidate('b', 1, 0.99, [fired('cpu', 0.8, [0, 0.1])]),
    ];
    const decision = decideConsultation(close, DEFAULT_CONSULTATION_OPTIONS);
    expect(decision.consult).toBe(true);
    expect(decision.reason).toBe('none');
    expect(decision.margin).toBeCloseTo(0.01, 10);
    expect(decision.decisiveChannels).toBe(1);
  });

  it('skips a case the engine already leads by a wide margin', () => {
    const decision = decideConsultation(posterior, DEFAULT_CONSULTATION_OPTIONS);
    expect(decision).toMatchObject({ consult: false, reason: 'margin' });
    expect(decision.margin).toBeCloseTo(0.2, 10);
  });

  it('skips a case whose leader is supported by several out-of-band channels', () => {
    const supported = [
      candidate('a', 0, 1.0, [
        fired('cpu', 0.9, [0, 0.1]),
        fired('mem', 0.9, [0, 0.1]),
        fired('lat', 9, [0, 1]),
      ]),
      candidate('b', 1, 0.99, [fired('cpu', 0.8, [0, 0.1])]),
    ];
    expect(decideConsultation(supported, DEFAULT_CONSULTATION_OPTIONS)).toMatchObject({
      consult: false,
      reason: 'evidence',
      decisiveChannels: 3,
    });
  });

  it('counts only channels outside their band, so a constant channel is not evidence', () => {
    const flat = [
      candidate('a', 0, 1.0, [quiet('error', 0, [0, 0]), quiet('queue', 0, [0, 0])]),
      candidate('b', 1, 0.99, [quiet('error', 0, [0, 0])]),
    ];
    expect(decideConsultation(flat, DEFAULT_CONSULTATION_OPTIONS).decisiveChannels).toBe(0);
  });

  it('reads a lone candidate as zero margin rather than dividing by a missing second score', () => {
    const decision = decideConsultation([auth], DEFAULT_CONSULTATION_OPTIONS);
    expect(decision.margin).toBe(0);
    // The single candidate still carries one out-of-band channel, below the default of three, so it is consulted.
    expect(decision.consult).toBe(true);
  });

  it('reads a non-positive leading score as zero margin, because a ratio would be negative', () => {
    const zero = [candidate('a', 0, 0, [fired('cpu', 0.9, [0, 0.1])]), candidate('b', 1, 0, [])];
    expect(decideConsultation(zero, DEFAULT_CONSULTATION_OPTIONS).margin).toBe(0);
  });
});
