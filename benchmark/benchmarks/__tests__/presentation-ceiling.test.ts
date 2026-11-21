/**
 * Unit tests for the presentation ceiling.
 *
 * The module answers one question — how many cases a reranker shown `K` candidates could possibly repair — and the
 * tests hold the four statements that make the answer usable as a gate on a paid arm rather than as a description:
 *
 *  1. the ceiling is MONOTONE in the width, because a presentation that shows more cannot reach less;
 *  2. a truth the results do not hold (`rank = 0`) is unreachable at EVERY width, because it is not a rank the
 *     corpus can be read at;
 *  3. the smallest width that reaches a target is the SMALLEST, since an arm priced at a larger width is an arm
 *     bought with tokens it did not need;
 *  4. a rank or a width the per-case artifact could not have written is REFUSED, because normalising it would move
 *     the denominator of every ceiling computed from the list.
 *
 * @module benchmarks/__tests__/presentation-ceiling
 */

import { describe, expect, it } from 'vitest';

import {
  minimumWidth,
  presentationCeiling,
  rankDistribution,
  widestRank,
} from '../src/presentation-ceiling.js';

describe('the ceiling at a width', () => {
  it('counts every case whose truth is inside the width and nothing else', () => {
    const ranks = [1, 1, 2, 3, 5];
    const points = presentationCeiling(ranks, [1, 2, 3, 5]);
    expect(points.map((point) => point.recoverable)).toEqual([2, 3, 4, 5]);
    expect(points.map((point) => point.ceiling)).toEqual([0.4, 0.6, 0.8, 1]);
  });

  it('reports the cases it cannot reach as the complement of the ones it can', () => {
    const [point] = presentationCeiling([1, 1, 4], [2]);
    expect(point).toEqual({ width: 2, recoverable: 2, ceiling: 2 / 3, outOfReach: 1 });
  });

  it('is zero at width zero, because a presentation of nothing shows nothing', () => {
    const [point] = presentationCeiling([1, 2, 3], [0]);
    expect(point).toEqual({ width: 0, recoverable: 0, ceiling: 0, outOfReach: 3 });
  });

  it('is monotone in the width', () => {
    const ranks = [1, 1, 1, 2, 4, 4, 9, 12];
    const points = presentationCeiling(ranks, [0, 1, 2, 3, 4, 5, 9, 12, 20]);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.recoverable).toBeGreaterThanOrEqual(points[index - 1]!.recoverable);
    }
    expect(points.at(-1)!.ceiling).toBe(1);
  });

  it('normalises an unsorted, repeated ladder into one ascending point per width', () => {
    const points = presentationCeiling([1, 2], [5, 1, 5, 2]);
    expect(points.map((point) => point.width)).toEqual([1, 2, 5]);
  });

  it('does not mutate the input it was given', () => {
    const ranks = [3, 1, 2];
    const widths = [5, 1];
    presentationCeiling(ranks, widths);
    expect(ranks).toEqual([3, 1, 2]);
    expect(widths).toEqual([5, 1]);
  });

  it('reports a ceiling of zero over no cases, and refuses to read that as a failure', () => {
    const points = presentationCeiling([], [1, 5]);
    expect(points).toEqual([
      { width: 1, recoverable: 0, ceiling: 0, outOfReach: 0 },
      { width: 5, recoverable: 0, ceiling: 0, outOfReach: 0 },
    ]);
  });
});

describe('a truth the results do not hold', () => {
  it('is unreachable at every width, including the widest one', () => {
    const ranks = [0, 2, 3];
    const points = presentationCeiling(ranks, [0, 1, 2, 3, 40]);
    expect(points.map((point) => point.recoverable)).toEqual([0, 0, 1, 2, 2]);
    expect(points.at(-1)!.ceiling).toBeCloseTo(2 / 3, 12);
  });

  it('is left out of the histogram rather than counted at rank zero', () => {
    expect([...rankDistribution([0, 1, 0, 2])]).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('does not become the widest rank, which is what a "show everything" dispatch means', () => {
    expect(widestRank([0, 0, 7])).toBe(7);
    expect(widestRank([0, 0])).toBe(0);
  });
});

describe('the smallest width that reaches a target', () => {
  it('is the smallest one, not the first convenient one', () => {
    const ranks = [1, 1, 2, 3, 4];
    expect(minimumWidth(ranks, 0.4)).toBe(1);
    expect(minimumWidth(ranks, 0.6)).toBe(2);
    expect(minimumWidth(ranks, 0.8)).toBe(3);
    expect(minimumWidth(ranks, 1)).toBe(4);
  });

  it('rounds the target UP, because a width is a whole number of candidates', () => {
    // 3 of 7 cases is 0.4286, so a target of 0.43 needs four cases and therefore a wider presentation.
    const ranks = [1, 1, 1, 2, 2, 3, 3];
    expect(minimumWidth(ranks, 3 / 7)).toBe(1);
    expect(minimumWidth(ranks, 0.43)).toBe(2);
  });

  it('is undefined when even the widest presentation falls short', () => {
    expect(minimumWidth([0, 1, 2], 1)).toBeUndefined();
  });

  it('walks past a rank no case occupies without losing the count', () => {
    // No case sits at rank 2, so the search has to step through an empty rung rather than stop at it.
    expect(minimumWidth([1, 1, 3], 1)).toBe(3);
    expect(minimumWidth([1, 1, 3], 2 / 3)).toBe(1);
  });

  it('is zero for a target at or below zero, and undefined above one', () => {
    expect(minimumWidth([1, 2], 0)).toBe(0);
    expect(minimumWidth([1, 2], -1)).toBe(0);
    expect(minimumWidth([1, 2], 1.5)).toBeUndefined();
    expect(minimumWidth([1, 2], Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(minimumWidth([1, 2], Number.NaN)).toBeUndefined();
  });

  it('is undefined over no cases, so an empty artifact cannot claim a target is met', () => {
    expect(minimumWidth([], 0.5)).toBeUndefined();
    expect(minimumWidth([], 0)).toBe(0);
  });
});

describe('the refusals', () => {
  it('refuses a rank the artifact could not have written', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => presentationCeiling([bad], [1])).toThrow(RangeError);
      expect(() => rankDistribution([bad])).toThrow(/non-negative integer/);
      expect(() => widestRank([bad])).toThrow(RangeError);
      expect(() => minimumWidth([bad], 0.5)).toThrow(RangeError);
    }
  });

  it('refuses a width a presentation cannot have', () => {
    for (const bad of [-1, 2.5, Number.NaN]) {
      expect(() => presentationCeiling([1], [bad])).toThrow(RangeError);
    }
  });

  it('names the offending value, so a producer defect is traceable to its row', () => {
    expect(() => presentationCeiling([1, 1, -3], [1])).toThrow(/index 2 is -3/);
    expect(() => presentationCeiling([1], [1.25])).toThrow(/width 1.25/);
  });
});
