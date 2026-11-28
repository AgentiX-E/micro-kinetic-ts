/**
 * Unit tests for {@link sliceForMemory}.
 *
 * The runner slices a cell because a case of the RCAEval corpus is up to 401 MB of CSV (TrainTicket's RE2 average is
 * 245 MB against SockShop's 23 MB) and a cell is up to 125 of them, which is more than the 8 GiB container the run
 * is dispatched in. Slicing is only a memory decision if it is a PARTITION: every case in exactly one slice, in
 * corpus order, nothing dropped and nothing repeated. Every fold downstream is a per-case sum, so a dropped or
 * duplicated case is a wrong published number rather than a crash.
 *
 * The BOUNDS are the other half, and the corpus is what makes both of them necessary at once: a count bound alone
 * is no bound at all on TrainTicket, whose sixteen cases are 3.9 GB, while a byte bound alone would put a hundred
 * tiny SockShop cases in one slice and pay a fold per slice for nothing.
 *
 * @module __tests__/case-slicing
 */

import { describe, expect, it } from 'vitest';

import { SLICE_BYTE_BUDGET, sliceForMemory } from '../src/case-slicing.js';

/** One case: its identifier and its corpus bytes. */
interface Sized {
  readonly id: string;
  readonly bytes: number;
}

const mb = (n: number): number => n * 1024 * 1024;
const sized = (n: number, bytes: number): Sized[] =>
  Array.from({ length: n }, (_, i) => ({ id: `case-${i}`, bytes }));
/** A measurer that reads the fixture's own field — the runner's reads the filesystem. */
const sizeOf = (one: Sized): number => one.bytes;

describe('sliceForMemory — a memory decision, not a population decision', () => {
  it('partitions the cell: same cases, same order, nothing dropped or repeated', () => {
    const all = sized(10, 1);
    const slices = sliceForMemory(all, 3, sizeOf);

    expect(slices.flat().map((c) => c.id)).toEqual(all.map((c) => c.id));
    expect(slices.every((s) => s.length > 0)).toBe(true);
  });

  it('closes a slice at the COUNT bound', () => {
    // Ten one-byte cases at three per slice is 3/3/3/1. The remainder is its own SHORT slice rather than being merged
    // backwards, which is what keeps the largest slice at `chunk`.
    const slices = sliceForMemory(sized(10, 1), 3, sizeOf);

    expect(slices.map((s) => s.length)).toEqual([3, 3, 3, 1]);
  });

  it('closes a slice at the BYTE bound even when the count bound is far away', () => {
    // The TrainTicket shape: 245 MB per case, sixteen would be 3.9 GB. At 512 MB per slice this is two cases.
    const slices = sliceForMemory(sized(6, mb(245)), 16, sizeOf);

    expect(slices.map((s) => s.length)).toEqual([2, 2, 2]);
  });

  it('closes on whichever bound is reached first', () => {
    // Three cases of 100 MB, count bound two: the count closes it, because 300 MB is under the byte budget.
    expect(sliceForMemory(sized(5, mb(100)), 2, sizeOf).map((s) => s.length)).toEqual([2, 2, 1]);
    // Three cases of 300 MB, count bound eight: the byte bound closes it after the first, since a second would be
    // 600 MB.
    expect(sliceForMemory(sized(3, mb(300)), 8, sizeOf).map((s) => s.length)).toEqual([1, 1, 1]);
  });

  it('gives a case larger than the whole budget a slice of its own', () => {
    // The corpus's largest case is 401 MB and the budget is 512 MB, so this is reachable: a case of 600 MB must not
    // be dropped (that would report a cell over a population that was not the cell) and must not be split (a case is
    // indivisible).
    const all: Sized[] = [
      { id: 'small', bytes: mb(1) },
      { id: 'huge', bytes: mb(600) },
      { id: 'small2', bytes: mb(1) },
    ];
    const slices = sliceForMemory(all, 16, sizeOf);

    expect(slices.map((s) => s.map((c) => c.id))).toEqual([['small'], ['huge'], ['small2']]);
  });

  it('never emits an empty slice, which would be a fold over nothing', () => {
    // An empty slice would still cost a `runSuite` call and, worse, would print a cell of zero cases mid-run.
    const slices = sliceForMemory(sized(7, mb(400)), 16, sizeOf);

    expect(slices.every((s) => s.length > 0)).toBe(true);
    expect(slices.flat()).toHaveLength(7);
  });

  it('falls back to the count bound when the bytes are unmeasurable', () => {
    // `corpusBytes` returns 0 on a filesystem error, so a corpus that cannot be sized must still be sliced rather
    // than becoming one resident cell. Zero bytes never closes a slice, which leaves the count bound in charge.
    const slices = sliceForMemory(sized(9, 0), 4, sizeOf);

    expect(slices.map((s) => s.length)).toEqual([4, 4, 1]);
  });

  it('treats a non-positive or non-finite chunk as "the whole cell"', () => {
    // `chunk <= 0` alone would let NaN through: `metas.length <= NaN` is false and the loop would push one slice per
    // case with the count bound never reached. The guard has to be "not a positive finite number".
    for (const chunk of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const slices = sliceForMemory(sized(5, mb(400)), chunk, sizeOf);
      expect(slices, String(chunk)).toHaveLength(1);
      expect(slices[0]).toHaveLength(5);
    }
  });

  it('slices an empty cell into one empty slice, not into none', () => {
    // The caller's loop is `for (const slice of slices)`; zero slices would skip the cell without a word.
    expect(sliceForMemory([], 8, sizeOf)).toEqual([[]]);
  });

  it('reproduces the corpus order at every bound', () => {
    // The published cells are order-independent (every fold is a sum), but the failure DIAGNOSTICS print "the first N
    // per fault type" and the dump is keyed by case id: a boundary that reordered cases would change which misses are
    // shown without changing a single number.
    const all = sized(11, mb(120));
    for (const chunk of [1, 2, 3, 5, 11, 100]) {
      expect(sliceForMemory(all, chunk, sizeOf).flat(), `chunk=${chunk}`).toEqual(all);
    }
  });

  it('declares a byte budget the corpus cannot exhaust in one case, except at its own tail', () => {
    // The budget is a CONSTANT because it is a safety bound rather than an experimental arm. This pins the reasoning
    // rather than the number: a 512 MB budget against a 401 MB largest case means every case fits, so the only
    // overshoot is a case that was already larger than the budget on its own.
    expect(SLICE_BYTE_BUDGET).toBeGreaterThan(mb(401));
  });
});
