/**
 * Unit tests for the temporal prior's SHAPES.
 *
 * The term is `temporalWeight × slope`, so a shape decides WHAT the term says and the
 * weight decides how much it matters. Two properties carry the whole design and are
 * asserted here rather than argued:
 *
 * 1. `earliness` is EXACTLY the expression the engine used before shapes existed
 *    (`2 × (earliness − 0.5)`), so enrolling the field could not move a published
 *    number — the equality is asserted, not approximated.
 * 2. Every other shape is inert too, in the sense that matters: it reads only the
 *    ORDER, and it credits nothing when there is no order to read.
 *
 * @module __tests__/unit/onset-shapes
 */

import { describe, expect, it } from 'vitest';

import {
  computeOnsetSlopes,
  computeTemporalEarliness,
  DEFAULT_ONSET_SHAPE,
  isOnsetShape,
  ONSET_SHAPES,
} from '../../src/index.js';

/** A case's onset delays, as the graph builder hands them over. */
function delays(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

const ANCHOR = 1_700_000_000_000;

describe('computeOnsetSlopes — the ENGINE’s own shape is the expression it replaced', () => {
  it('equals 2 × (earliness − 0.5) for every service, exactly', () => {
    // The claim behind enrolling the shape without moving a number. If this held only
    // approximately, every published headline would have to be re-measured; because it
    // is the same arithmetic — `computeTemporalEarliness` then a multiplication by a
    // power of two, which is exact — it does not.
    const input = delays({ a: 0, b: 1000, c: 60000, d: -1 });
    const earliness = computeTemporalEarliness(input, ANCHOR);
    const slopes = computeOnsetSlopes(input, ANCHOR, 'earliness');

    expect(earliness.size).toBe(3);
    expect(slopes.size).toBe(3);
    for (const [id, value] of earliness) {
      expect(slopes.get(id)).toBe(2 * (value - 0.5));
    }
    // The undetermined service is in NEITHER map: absence is the engine's spelling for
    // "no credit", and a 0.5-valued neutral would make it indistinguishable from a
    // service that genuinely measured the middle of the span.
    expect(slopes.has('d')).toBe(false);
  });

  it('is the default shape, so the field is optional at every call site', () => {
    const input = delays({ a: 0, b: 1000 });
    expect(DEFAULT_ONSET_SHAPE).toBe('earliness');
    expect([...computeOnsetSlopes(input, ANCHOR)]).toEqual([
      ...computeOnsetSlopes(input, ANCHOR, 'earliness'),
    ]);
  });

  it('credits nobody when all delays are tied', () => {
    // A zero span carries no ordering information. The earliness shape reports its
    // neutral 0.5 (slope 0) and the rank shape has no neutral to report at all, so both
    // end at 0 — from different rules, and for the same reason.
    const tied = delays({ a: 5000, b: 5000, c: 5000 });
    expect([...computeOnsetSlopes(tied, ANCHOR, 'earliness').values()]).toEqual([0, 0, 0]);
    expect([...computeOnsetSlopes(tied, ANCHOR, 'order').values()]).toEqual([0, 0, 0]);
    // The one-sided shapes still credit the tied set: with every delay equal, "who
    // moved first" has an answer — everybody — and it is the same answer for "who
    // moved last".
    expect([...computeOnsetSlopes(tied, ANCHOR, 'earliest-only').values()]).toEqual([1, 1, 1]);
    expect([...computeOnsetSlopes(tied, ANCHOR, 'latest-only').values()]).toEqual([-1, -1, -1]);
  });
});

describe('computeOnsetSlopes — the shapes that read the order', () => {
  const three = delays({ early: 0, middle: 30000, late: 60000 });

  it('spaces `order` by RANK, so one late outlier cannot flatten the rest', () => {
    // The engine's own shape is min-max in the DELAY: a service that moves ten minutes
    // late compresses everyone else onto earliness ≈ 1. On FSE'26 that is not
    // hypothetical — 1088 of 1422 cases have a unique first mover, but the span can be
    // arbitrarily long — which is why a shape that reads the rank is a different
    // candidate rather than a rescaling.
    const spread = delays({ first: 0, second: 1000, third: 600000 });
    const order = computeOnsetSlopes(spread, ANCHOR, 'order');
    const earliness = computeOnsetSlopes(spread, ANCHOR, 'earliness');

    expect(order.get('first')).toBeCloseTo(1, 12);
    expect(order.get('second')).toBeCloseTo(0, 12);
    expect(order.get('third')).toBeCloseTo(-1, 12);
    // Under the delay's own shape the second service sits within 0.2% of the first.
    expect(earliness.get('second')!).toBeGreaterThan(0.99);
  });

  it('gives an even field of three the corners and the middle', () => {
    const order = computeOnsetSlopes(three, ANCHOR, 'order');
    expect(order.get('early')).toBeCloseTo(1, 12);
    expect(order.get('middle')).toBeCloseTo(0, 12);
    expect(order.get('late')).toBeCloseTo(-1, 12);
  });

  it('credits ONLY the boundary set in the one-sided shapes, ties included', () => {
    const tied = delays({ a: 0, b: 0, c: 60000, d: 60000 });
    const earliest = computeOnsetSlopes(tied, ANCHOR, 'earliest-only');
    const latest = computeOnsetSlopes(tied, ANCHOR, 'latest-only');

    expect(earliest.get('a')).toBe(1);
    expect(earliest.get('b')).toBe(1);
    // ABSENT, not zero, for the services the shape does not credit: the ranking reads a
    // missing entry through `?? 0`, so the two are the same number to it — but only one
    // of them is a statement about the shape, and a screen that filled the map would be
    // unable to tell "not credited" from "credited nothing".
    expect(earliest.has('c')).toBe(false);
    expect(earliest.has('d')).toBe(false);
    expect(latest.get('c')).toBe(-1);
    expect(latest.get('d')).toBe(-1);
    expect(latest.has('a')).toBe(false);
    expect(latest.has('b')).toBe(false);
  });

  it('is reproducible: the tie inside a boundary set does not depend on insertion order', () => {
    // A shape whose entire claim is about simultaneity cannot inherit the map's
    // insertion order. Both spellings of one tie set must produce one answer.
    const forwards = computeOnsetSlopes(delays({ a: 0, b: 0, c: 100 }), ANCHOR, 'earliest-only');
    const backwards = computeOnsetSlopes(delays({ c: 100, b: 0, a: 0 }), ANCHOR, 'earliest-only');
    expect([...forwards.entries()].sort()).toEqual([...backwards.entries()].sort());
  });
});

describe('computeOnsetSlopes — the engine’s precondition, applied to every shape', () => {
  it('credits nothing without an anchor', () => {
    // No injection time means no delay is anchored to anything, which is the engine's
    // own gate: `injectTimeMs = 0` is "unknown", not "at the epoch".
    for (const shape of ONSET_SHAPES) {
      expect(computeOnsetSlopes(delays({ a: 0, b: 1000 }), 0, shape).size).toBe(0);
    }
  });

  it('credits nothing with fewer than two defined onsets', () => {
    // One onset cannot establish a before/after order, so there is no order to read —
    // for ANY shape, including the one-sided ones whose whole input is the boundary.
    for (const shape of ONSET_SHAPES) {
      expect(computeOnsetSlopes(delays({ a: 0, b: -1 }), ANCHOR, shape).size).toBe(0);
      expect(computeOnsetSlopes(delays({ a: -1 }), ANCHOR, shape).size).toBe(0);
      expect(computeOnsetSlopes(delays({}), ANCHOR, shape).size).toBe(0);
      expect(computeOnsetSlopes(undefined, ANCHOR, shape).size).toBe(0);
    }
  });

  it('treats a negative anchor as unknown, not as an instant before the epoch', () => {
    // The engine's gate is `> 0`, and a negative injection time is not a time at all —
    // it is a caller that never supplied one. Folding it into the epoch would anchor
    // every delay to 1970 and make the shape depend on the platform's clock.
    for (const shape of ONSET_SHAPES) {
      expect(computeOnsetSlopes(delays({ a: 0, b: 1000 }), -1, shape).size).toBe(0);
    }
  });

  it('drops a non-finite delay in the engine’s OWN shape too, not only in the reader', () => {
    // `computeOnsetSlopes` filters before it calls the engine for the rank-based shapes,
    // so the NaN has to reach `computeTemporalEarliness` for the engine's own filter to
    // be exercised — and it does, because the earliness shape passes the raw map.
    const input = delays({ a: 0, b: Number.NaN, c: 1000 });
    expect([...computeOnsetSlopes(input, ANCHOR, 'earliness').keys()].sort()).toEqual(['a', 'c']);
  });

  it('drops a non-finite delay rather than ordering by it', () => {
    // `NaN` sorts nowhere and would make the boundary set depend on the comparator.
    // The remaining pair still forms an order, and the earliest of THEM is the boundary.
    const input = delays({ a: 0, b: Number.NaN, c: 1000 });
    expect([...computeOnsetSlopes(input, ANCHOR, 'earliest-only').keys()]).toEqual(['a']);
    expect([...computeOnsetSlopes(input, ANCHOR, 'latest-only').keys()]).toEqual(['c']);
    expect(computeOnsetSlopes(input, ANCHOR, 'order').size).toBe(2);
  });
});

describe('computeTemporalEarliness — the primitive keeps its own guards', () => {
  it('returns an empty map for each of the three ways it cannot act', () => {
    // Asserted on the PRIMITIVE, not through `computeOnsetSlopes`: the wrapper returns
    // early on the same conditions, so a test that only went through it would leave
    // these branches unexecuted — and unexecuted is how a guard silently disappears in
    // a refactor. The primitive is exported and is what a caller with its own delay map
    // reaches for.
    expect(computeTemporalEarliness(undefined, ANCHOR).size).toBe(0);
    expect(computeTemporalEarliness(delays({ a: 0, b: 1000 }), 0).size).toBe(0);
    expect(computeTemporalEarliness(delays({ a: 0, b: 1000 }), -1).size).toBe(0);
    // One onset, or none: no order to establish.
    expect(computeTemporalEarliness(delays({ a: 0 }), ANCHOR).size).toBe(0);
    expect(computeTemporalEarliness(delays({ a: -1, b: -1 }), ANCHOR).size).toBe(0);
  });

  it('normalises the earliest to 1 and the latest to 0', () => {
    // The value the shipped shape is built from, stated once where it is defined rather
    // than only through the slope it is multiplied into.
    const earliness = computeTemporalEarliness(delays({ a: 0, b: 500, c: 1000 }), ANCHOR);
    expect(earliness.get('a')).toBe(1);
    expect(earliness.get('b')).toBe(0.5);
    expect(earliness.get('c')).toBe(0);
  });
});

describe('isOnsetShape', () => {
  it('accepts every declared shape and nothing else', () => {
    for (const shape of ONSET_SHAPES) expect(isOnsetShape(shape)).toBe(true);
    expect(isOnsetShape('earliest')).toBe(false);
    expect(isOnsetShape('')).toBe(false);
  });
});
