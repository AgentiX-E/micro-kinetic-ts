/**
 * TDD for the CIE split study: the corrected probe, and the contamination it measures.
 *
 * The §1.28.4 probe called the row's all-channel surprise the "internal" axis — but that max includes latency,
 * which is CIE's EXTERNAL channel. The shape it counted was therefore not CIE's shape. These tests pin the three
 * distinctions the correction has to draw: internal channels are cpu/mem/disk/socket only; a channel family that
 * was never measured is absent, not zero; and the contaminated and genuine axes are counted side by side so the
 * inflation from the shared channel is a number rather than an argument.
 *
 * @module benchmarks/__tests__/cie-split-study
 */

import { describe, expect, it } from 'vitest';

import {
  cieSplitVerdict,
  internalDirectionOf,
  readCieSplit,
  splitChannelExcursions,
  victimShapeOf,
  type CieCaseInput,
  type FingerprintChannel,
} from '../src/cie-split-study.js';

/** A measured channel: band [0, 10], post 20 => one band width outside. */
function channel(
  label: string,
  post: number,
  band: readonly [number, number] = [0, 10],
): FingerprintChannel {
  return { label, post, band };
}

describe('splitChannelExcursions', () => {
  it('separates internal (cpu/mem/disk/socket) from external channels', () => {
    const split = splitChannelExcursions([
      channel('container.cpu.time', 20),
      channel('latency_p99', 40),
    ]);
    expect(split.internal).toBe(1);
    expect(split.external).toBe(3);
    expect(split.hasInternal).toBe(true);
    expect(split.hasExternal).toBe(true);
  });

  it('reports a family that stayed inside its band as measured zero, not absent', () => {
    const split = splitChannelExcursions([channel('memory.rss', 5)]);
    expect(split.internal).toBe(0);
    expect(split.hasInternal).toBe(true);
    expect(split.hasExternal).toBe(false);
  });

  it('takes the worst channel in each family, in band widths', () => {
    const split = splitChannelExcursions([
      channel('cpu.0', 15),
      channel('cpu.1', 35),
      channel('error_rate', 25),
      channel('throughput', 5),
    ]);
    expect(split.internal).toBe(2.5);
    expect(split.external).toBe(1.5);
  });

  it('marks a family absent when no channel of it is present', () => {
    const split = splitChannelExcursions([channel('http.server.request.duration', 30)]);
    expect(split.hasInternal).toBe(false);
    expect(split.hasExternal).toBe(true);
  });

  it('refuses a non-positive or non-finite band rather than dividing by it', () => {
    const split = splitChannelExcursions([
      channel('cpu', 20, [5, 5]),
      channel('mem', 20, [Number.NaN, 10]),
      channel('disk', Number.POSITIVE_INFINITY, [0, 10]),
    ]);
    expect(split.hasInternal).toBe(false);
    expect(split.internal).toBe(0);
  });

  it('normalises a departure BELOW the band as a positive excursion', () => {
    const split = splitChannelExcursions([channel('cpu', -10, [0, 10])]);
    expect(split.internal).toBe(1);
  });
});

describe('victimShapeOf / internalDirectionOf', () => {
  const split = (
    internal: number,
    external: number,
  ): ReturnType<typeof splitChannelExcursions> => ({
    internal,
    external,
    hasInternal: true,
    hasExternal: true,
  });

  it('calls the CIE victim shape: external outranked but internal outranked by the truth', () => {
    expect(victimShapeOf(split(0.2, 2), split(1.4, 1))).toBe('victim-shape');
  });

  it('is not the shape when the winner also wins on internal', () => {
    expect(victimShapeOf(split(2, 2), split(1, 1))).toBe('no-shape');
  });

  it('is not the shape when the winner loses on external', () => {
    expect(victimShapeOf(split(0.2, 1), split(2, 3))).toBe('no-shape');
  });

  it('refuses the shape when either axis is unmeasured, rather than reading absence as zero', () => {
    const unmeasured = { internal: 0, external: 0, hasInternal: false, hasExternal: false };
    expect(victimShapeOf(unmeasured, split(1, 1))).toBe('unmeasured');
    expect(victimShapeOf(split(1, 1), unmeasured)).toBe('unmeasured');
  });

  it('reads the internal direction, including the tie', () => {
    expect(internalDirectionOf(split(0.5, 0), split(1, 0))).toBe('truth-higher');
    expect(internalDirectionOf(split(2, 0), split(1, 0))).toBe('winner-higher');
    expect(internalDirectionOf(split(1, 0), split(1, 0))).toBe('tie');
    expect(
      internalDirectionOf(
        { internal: 0, external: 0, hasInternal: false, hasExternal: false },
        split(1, 0),
      ),
    ).toBe('unmeasured');
  });
});

/** A miss whose winner has no internal evidence but high external, truth has internal evidence. */
function victimCase(overrides: Partial<CieCaseInput> = {}): CieCaseInput {
  return {
    datapack: 'dp',
    winner: 'w',
    accepted: ['t'],
    external: { w: 2, t: 1 },
    // The contaminated internal axis: an all-channel max where BOTH sides include the same latency channel.
    surprise: { w: 6, t: 4 },
    channels: {
      w: [channel('latency_p99', 30), channel('cpu', 10)],
      t: [channel('latency_p99', 20), channel('cpu', 20)],
    },
    ...overrides,
  };
}

describe('readCieSplit', () => {
  it('counts a genuine victim shape separately from the contaminated one', () => {
    // Genuine: winner external 2 >= truth 1, winner internal 0 < truth 1 -> victim shape.
    // Contaminated: winner surprise 6 >= truth 4, so NOT the shape (the shared latency flips the direction).
    const reading = readCieSplit([victimCase()]);
    expect(reading.cases).toBe(1);
    expect(reading.hits).toBe(0);
    expect(reading.misses).toBe(1);
    expect(reading.scored).toBe(1);
    expect(reading.genuine.victimShape).toBe(1);
    expect(reading.contaminated.victimShape).toBe(0);
    expect(reading.contamination).toBe(1);
  });

  it('does not count a hit as a miss', () => {
    const reading = readCieSplit([victimCase({ accepted: ['w'] })]);
    expect(reading.hits).toBe(1);
    expect(reading.misses).toBe(0);
    expect(reading.scored).toBe(0);
  });

  it('counts a missing internal family as unmeasured on the genuine axis but still spoke on the contaminated one', () => {
    // This asymmetry is the whole defect: with no internal channels, CIE's axiom cannot speak, but the
    // all-channel proxy still returned a verdict — which is exactly how §1.28.4 counted a larger population.
    const reading = readCieSplit([
      victimCase({
        channels: { w: [channel('latency_p99', 30)], t: [channel('latency_p99', 20)] },
      }),
    ]);
    expect(reading.scored).toBe(0);
    expect(reading.genuine.unmeasured).toBe(1);
    expect(reading.contaminated.unmeasured).toBe(0);
    expect(reading.contaminated.noShape).toBe(1);
  });

  it('lets the contaminated axis speak on a truth the fingerprint never listed', () => {
    // §1.28.4 used the row's maps, which cover pruned truths too; coupling the proxy to the fingerprint would
    // under-report the reading being corrected.
    const reading = readCieSplit([
      victimCase({
        channels: { w: [channel('latency_p99', 30), channel('cpu', 10)] },
      }),
    ]);
    expect(reading.genuine.unmeasured).toBe(1);
    expect(reading.contaminated.victimShape).toBe(0);
    expect(reading.contaminated.noShape).toBe(1);
    expect(reading.contaminated.unmeasured).toBe(0);
  });

  it('refuses the contaminated axis when the row carries no surprise map', () => {
    const reading = readCieSplit([victimCase({ surprise: undefined })]);
    expect(reading.genuine.victimShape).toBe(1);
    expect(reading.contaminated.unmeasured).toBe(1);
  });

  it('counts the internal direction on the genuine split', () => {
    const reading = readCieSplit([
      victimCase({
        channels: {
          w: [channel('latency_p99', 30), channel('cpu', 30)],
          t: [channel('latency_p99', 20), channel('cpu', 10)],
        },
      }),
    ]);
    expect(reading.genuine.winnerHigher).toBe(1);
    expect(reading.genuine.truthHigher).toBe(0);
  });

  it('evaluates every accepted answer and takes the strongest evidence for the claim', () => {
    const reading = readCieSplit([
      victimCase({
        accepted: ['t0', 't1'],
        external: { w: 2, t0: 1, t1: 1 },
        surprise: { w: 6, t0: 4, t1: 4 },
        channels: {
          w: [channel('latency_p99', 30), channel('cpu', 10)],
          t0: [channel('latency_p99', 20), channel('cpu', 10)],
          t1: [channel('latency_p99', 20), channel('cpu', 20)],
        },
      }),
    ]);
    expect(reading.genuine.victimShape).toBe(1);
    expect(reading.genuine.truthHigher).toBe(1);
  });

  it('refuses a non-finite row external on the contaminated axis rather than invent an ordering', () => {
    // The genuine split reads its external family from the fingerprint channels, so it still speaks; the row's
    // external map exists only to reproduce §1.28.4, and a NaN there refuses that reproduction.
    const reading = readCieSplit([victimCase({ external: { w: Number.NaN, t: 1 } })]);
    expect(reading.scored).toBe(1);
    expect(reading.genuine.victimShape).toBe(1);
    expect(reading.contaminated.unmeasured).toBe(1);
  });

  it('skips an accepted answer that has no channels or no external measurement', () => {
    // A second, unmeasurable accepted answer must not be read as a no-shape and dilute the real one.
    const reading = readCieSplit([
      victimCase({
        accepted: ['t-absent', 't'],
        channels: {
          w: [channel('latency_p99', 30), channel('cpu', 10)],
          t: [channel('latency_p99', 20), channel('cpu', 20)],
        },
      }),
    ]);
    expect(reading.scored).toBe(1);
    expect(reading.genuine.victimShape).toBe(1);
  });

  it('counts a scored no-shape with winner-higher internal, where the contaminated axis sees a shape', () => {
    // Genuine: winner internal 2 > truth internal 0 -> no victim shape, winner-higher.
    // Contaminated: winner surprise 1 < truth surprise 5 with winner external higher -> victim shape. The shared
    // channel manufactures a shape the disjoint split refutes.
    const reading = readCieSplit([
      victimCase({
        external: { w: 2, t: 1 },
        surprise: { w: 1, t: 5 },
        channels: {
          w: [channel('latency_p99', 30), channel('cpu', 30)],
          t: [channel('latency_p99', 20), channel('cpu', 10)],
        },
      }),
    ]);
    expect(reading.scored).toBe(1);
    expect(reading.genuine.noShape).toBe(1);
    expect(reading.genuine.winnerHigher).toBe(1);
    expect(reading.contaminated.victimShape).toBe(1);
    expect(reading.contamination).toBe(0);
  });

  it('counts a tie internal direction', () => {
    const reading = readCieSplit([
      victimCase({
        external: { w: 2, t: 1 },
        surprise: { w: 3, t: 3 },
        channels: {
          w: [channel('latency_p99', 30), channel('cpu', 20)],
          t: [channel('latency_p99', 20), channel('cpu', 20)],
        },
      }),
    ]);
    expect(reading.genuine.tie).toBe(1);
    expect(reading.genuine.noShape).toBe(1);
  });
});

describe('cieSplitVerdict', () => {
  const reading = (
    over: Partial<ReturnType<typeof readCieSplit>> = {},
  ): ReturnType<typeof readCieSplit> => ({
    cases: 100,
    hits: 80,
    misses: 20,
    scored: 20,
    genuine: {
      victimShape: 16,
      noShape: 4,
      unmeasured: 0,
      truthHigher: 16,
      winnerHigher: 4,
      tie: 0,
    },
    contaminated: {
      victimShape: 18,
      noShape: 2,
      unmeasured: 0,
      truthHigher: 18,
      winnerHigher: 2,
      tie: 0,
    },
    contamination: 3,
    ...over,
  });

  it('reports unmeasured when nothing could be scored', () => {
    expect(cieSplitVerdict(reading({ scored: 0 })).verdict).toBe('unmeasured');
  });

  it('reports unmeasured when the rows carry no cases at all', () => {
    expect(cieSplitVerdict(reading({ cases: 0 })).verdict).toBe('unmeasured');
  });

  it('calls a signal when the genuine shape is lopsided and above the floor', () => {
    const verdict = cieSplitVerdict(reading());
    expect(verdict.verdict).toBe('signal');
  });

  it('calls no-signal when the genuine shape is not lopsided', () => {
    // victimShape clears the floor, so the ONLY reason to refuse is the direction — this exercises the lopsided
    // guard rather than the earlier floor guard.
    const verdict = cieSplitVerdict(
      reading({
        genuine: {
          victimShape: 16,
          noShape: 4,
          unmeasured: 0,
          truthHigher: 9,
          winnerHigher: 11,
          tie: 0,
        },
      }),
    );
    expect(verdict.verdict).toBe('no-signal');
    expect(verdict.reason).toContain('not lopsided');
  });

  it('calls no-signal when the genuine shape is below the case floor', () => {
    const verdict = cieSplitVerdict(
      reading({
        genuine: {
          victimShape: 3,
          noShape: 17,
          unmeasured: 0,
          truthHigher: 3,
          winnerHigher: 17,
          tie: 0,
        },
      }),
    );
    expect(verdict.verdict).toBe('no-signal');
  });
});
