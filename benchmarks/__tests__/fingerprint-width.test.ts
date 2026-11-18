/**
 * Tests for the ordering a fingerprint is built from.
 *
 * The subject is one decision with three branches, and the branch that matters most is the one that does
 * **nothing**: at the published width the function must hand back the array it was given, by identity. A test
 * that only checked "the result equals the published order" would pass on a slice, on a filtered copy and on a
 * re-rank that happened to agree — three implementations that each break the default path in a different way.
 *
 * @module benchmarks/__tests__/fingerprint-width
 */

import { describe, expect, it, vi } from 'vitest';

import type { RootCauseResult } from '../../packages/kinetic/src/index.js';

import { fingerprintSourceOrder } from '../src/fingerprint-width.js';

/**
 * A ranking of `n` services, named so a wrong slice is visible rather than merely a different LENGTH.
 *
 * The function under test reads two things from a row — the service and the order — and the rest are the minimum
 * a `RootCauseResult` needs in order to exist, filled with values no assertion depends on.
 */
function order(n: number): RootCauseResult[] {
  return Array.from({ length: n }, (_, index) => ({
    serviceId: `s${index + 1}`,
    faultType: { category: 'CPU' as const, subType: 'stress', severity: 'major' as const },
    confidence: (n - index) / n,
    rank: index + 1,
    finalScore: n - index,
    evidenceMetrics: [],
    propagationDepth: 0,
    propagationErrorBound: 0,
    viaTreeSearch: false,
  }));
}

const PUBLISHED = order(5);

/** A `widen` that records its calls, so "the narrower path paid for no pass" is asserted rather than assumed. */
function spyWiden(rows: ReturnType<typeof order> = order(50)) {
  return vi.fn((_k: number) => rows);
}

describe('fingerprintSourceOrder', () => {
  it('hands back the published array ITSELF at the published width', () => {
    const widen = spyWiden();
    const result = fingerprintSourceOrder({
      published: PUBLISHED,
      width: 5,
      nodeCount: 50,
      widen,
    });
    // Identity, not equality: a slice of length five equals the array and is not it, and the difference is what
    // makes the default path the code path that existed before the flag.
    expect(result).toBe(PUBLISHED);
    expect(widen).not.toHaveBeenCalled();
  });

  it('slices when the width is narrower, and does not re-rank', () => {
    const widen = spyWiden();
    const result = fingerprintSourceOrder({
      published: PUBLISHED,
      width: 2,
      nodeCount: 50,
      widen,
    });
    expect(result.map((row) => row.serviceId)).toEqual(['s1', 's2']);
    // The published order is a total order cut at the end, so its first k rows ARE the answer at width k. A
    // second pass would be two orderings of one graph whose agreement is assumed.
    expect(widen).not.toHaveBeenCalled();
  });

  it('re-ranks when the width is wider, at exactly the requested width', () => {
    const widen = spyWiden();
    const result = fingerprintSourceOrder({
      published: PUBLISHED,
      width: 20,
      nodeCount: 50,
      widen,
    });
    expect(widen).toHaveBeenCalledTimes(1);
    expect(widen).toHaveBeenCalledWith(20);
    expect(result).toHaveLength(50);
    expect(result).not.toBe(PUBLISHED);
  });

  it('resolves zero to the case node count, which is the only party that knows it', () => {
    // `0` is "every candidate", the sentence `--containment-depth` uses for it.
    const widen = spyWiden(order(50));
    fingerprintSourceOrder({ published: PUBLISHED, width: 0, nodeCount: 50, widen });
    expect(widen).toHaveBeenCalledWith(50);
  });

  it('does not spend a pass on a case that has no more candidates than the published order', () => {
    // The clamp: a request wider than the graph can only return the order the graph already produced, so it must
    // be answered by THAT order rather than by a second `analyze` that would produce a third one.
    const widen = spyWiden(order(3));
    const three = order(3);
    const result = fingerprintSourceOrder({ published: three, width: 0, nodeCount: 3, widen });
    expect(result).toBe(three);
    expect(widen).not.toHaveBeenCalled();

    const five = order(5);
    const clamped = fingerprintSourceOrder({ published: five, width: 20, nodeCount: 5, widen });
    expect(clamped).toBe(five);
    expect(widen).not.toHaveBeenCalled();
  });

  it('narrows a case whose published order is longer than the request', () => {
    // The other side of the clamp: three candidates asked for out of a five-wide published order is a slice, so
    // the arm sees a NARROWER window than the run published. Nothing about the run moves.
    const widen = spyWiden();
    const result = fingerprintSourceOrder({ published: PUBLISHED, width: 3, nodeCount: 50, widen });
    expect(result.map((row) => row.serviceId)).toEqual(['s1', 's2', 's3']);
    expect(widen).not.toHaveBeenCalled();
  });
});
