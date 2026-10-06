import { describe, expect, it } from 'vitest';

import { minimumStratumSizeForHeldOutCoverage, stratifiedSplit } from '../../src/split.js';

interface Item {
  readonly id: number;
  readonly kind: string;
}

function items(n: number, kindOf?: (i: number) => string): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    kind: kindOf ? kindOf(i) : `k${i % 4}`,
  }));
}

describe('stratifiedSplit', () => {
  it('is exhaustive and disjoint', () => {
    const src = items(100);
    const { train, val, test } = stratifiedSplit(src, (x) => x.kind, {
      train: 0.7,
      val: 0.15,
      test: 0.15,
    });

    expect(train.length + val.length + test.length).toBe(100);

    const ids = new Set<number>();
    for (const x of [...train, ...val, ...test]) {
      expect(ids.has(x.id)).toBe(false);
      ids.add(x.id);
    }
    expect(ids.size).toBe(100);
  });

  it('honours the target ratios within rounding', () => {
    const src = items(1000);
    const { train, val, test } = stratifiedSplit(src, (x) => x.kind, {
      train: 0.6,
      val: 0.2,
      test: 0.2,
    });

    expect(train.length).toBeGreaterThanOrEqual(590);
    expect(train.length).toBeLessThanOrEqual(610);
    expect(val.length).toBeGreaterThanOrEqual(190);
    expect(val.length).toBeLessThanOrEqual(210);
    expect(test.length).toBeGreaterThanOrEqual(190);
    expect(test.length).toBeLessThanOrEqual(210);
  });

  it('is deterministic for a fixed seed', () => {
    const src = items(100);
    const a = stratifiedSplit(src, (x) => x.kind, { train: 0.7, val: 0.15, test: 0.15 }, 42);
    const b = stratifiedSplit(src, (x) => x.kind, { train: 0.7, val: 0.15, test: 0.15 }, 42);

    const idsOf = (xs: readonly Item[]) => xs.map((x) => x.id).join(',');
    expect(idsOf(a.train)).toBe(idsOf(b.train));
    expect(idsOf(a.val)).toBe(idsOf(b.val));
    expect(idsOf(a.test)).toBe(idsOf(b.test));
  });

  it('preserves every stratum in every split (no empty strata leak)', () => {
    // 3 strata × 10 items; ratios 0.6/0.2/0.2 give each stratum 6/2/2, so all
    // three strata appear in every split.
    const src: Item[] = [];
    for (let i = 0; i < 30; i++) src.push({ id: i, kind: ['a', 'b', 'c'][i % 3]! });

    const { train, val, test } = stratifiedSplit(src, (x) => x.kind, {
      train: 0.6,
      val: 0.2,
      test: 0.2,
    });

    for (const split of [train, val, test]) {
      const kinds = new Set(split.map((x) => x.kind));
      expect(kinds).toEqual(new Set(['a', 'b', 'c']));
    }
  });

  it('returns empty val/test when their ratios are zero', () => {
    const src = items(50);
    const { train, val, test } = stratifiedSplit(src, (x) => x.kind, {
      train: 1,
      val: 0,
      test: 0,
    });

    expect(train.length).toBe(50);
    expect(val.length).toBe(0);
    expect(test.length).toBe(0);
  });

  it('rejects a zero total ratio', () => {
    expect(() =>
      stratifiedSplit(items(3), (x) => x.kind, { train: 0, val: 0, test: 0 }),
    ).toThrow(/positive/);
  });

  it('rejects a non-positive train ratio', () => {
    expect(() =>
      stratifiedSplit(items(3), (x) => x.kind, { train: 0, val: 0.5, test: 0.5 }),
    ).toThrow(/train/);
  });

  it('rejects a negative val or test ratio', () => {
    expect(() =>
      stratifiedSplit(items(3), (x) => x.kind, { train: 0.7, val: -0.1, test: 0.4 }),
    ).toThrow(/non-negative/);
    expect(() =>
      stratifiedSplit(items(3), (x) => x.kind, { train: 0.7, val: 0.4, test: -0.1 }),
    ).toThrow(/non-negative/);
  });

  it('handles empty input', () => {
    const { train, val, test } = stratifiedSplit([], (x: Item) => x.kind, {
      train: 0.7,
      val: 0.15,
      test: 0.15,
    });
    expect(train).toHaveLength(0);
    expect(val).toHaveLength(0);
    expect(test).toHaveLength(0);
  });
});

describe('held-out coverage, measured rather than claimed', () => {
  /**
   * The ratios the L2 weight search uses. Both the search and the splitter's own doc claimed each stratum is
   * represented in each split "subject to integer rounding" — which is true in aggregate and false for the
   * strata that matter, and the difference is arithmetic a reader can check here.
   */
  const RATIOS = { train: 0.7, val: 0.15, test: 0.15 };

  /** A corpus of ONE stratum, so the split can only be judged on that stratum's size. */
  const oneStratum = (n: number): Item[] => items(n, () => 'only');

  /** The smallest n at which BOTH held-out splits are non-empty, found by running the splitter. */
  const measuredMinimum = (): number => {
    for (let n = 1; n <= 512; n++) {
      const s = stratifiedSplit(oneStratum(n), (i) => i.kind, RATIOS, 7);
      if (s.val.length > 0 && s.test.length > 0) return n;
    }
    return -1;
  };

  it('exports the minimum its own experiment finds', () => {
    // The exported value and the measurement are compared, so the constant cannot drift from the splitter it
    // describes: whatever a future change to `allocateCounts` does to the boundary, this fails.
    const measured = measuredMinimum();
    expect(measured).toBeGreaterThan(0);
    expect(minimumStratumSizeForHeldOutCoverage(RATIOS)).toBe(measured);
  });

  it('shows the guarantee failing below that size, with the arithmetic named', () => {
    const min = minimumStratumSizeForHeldOutCoverage(RATIOS);
    // At the minimum, both are populated; one below, at least one is EMPTY — that is the whole mechanism
    // behind the search corpus's missing strata, and the two concrete sizes below are what put 16 of its 44
    // combinations outside the test split.
    const at = stratifiedSplit(oneStratum(min), (i) => i.kind, RATIOS, 7);
    expect(at.val.length).toBeGreaterThan(0);
    expect(at.test.length).toBeGreaterThan(0);

    const below = stratifiedSplit(oneStratum(min - 1), (i) => i.kind, RATIOS, 7);
    expect(Math.min(below.val.length, below.test.length)).toBe(0);

    // A single-case stratum is the extreme and the common case in the corpus (`f2` and `f5` hold one case
    // each): ALL of it goes to train, because `Math.round(0.7 × 1) = 1`.
    const single = stratifiedSplit(oneStratum(1), (i) => i.kind, RATIOS, 7);
    expect(single.train.length).toBe(1);
    expect(single.val.length).toBe(0);
    expect(single.test.length).toBe(0);

    // And a 5-case stratum — `f4` — reaches val but not test, because `Math.round(5 × 0.7) = 4` and
    // `Math.round(5 × 0.15) = 1` leaves the remainder at zero.
    const five = stratifiedSplit(oneStratum(5), (i) => i.kind, RATIOS, 7);
    expect(five.train.length).toBe(4);
    expect(five.val.length).toBe(1);
    expect(five.test.length).toBe(0);
  });

  it('reports "no size qualifies" instead of inventing one when a split is not wanted', () => {
    // The down-sample call uses `{ train: r, val: 0, test: 1 − r }`: with no validation split, no stratum
    // size can populate it, and a helper that returned a number there would be answering a different
    // question than the caller asked.
    expect(minimumStratumSizeForHeldOutCoverage({ train: 0.7, val: 0, test: 0.3 })).toBe(-1);
  });

  it('agrees with the splitter for a range of ratios it was not tuned for', () => {
    // Derived rather than tabulated: three ratio sets, each checked against the experiment, so the helper is
    // a function of the ratios and not a hardcoded 6.
    for (const ratios of [
      { train: 0.8, val: 0.1, test: 0.1 },
      { train: 0.6, val: 0.2, test: 0.2 },
      { train: 0.34, val: 0.33, test: 0.33 },
    ]) {
      let measured = -1;
      for (let n = 1; n <= 512; n++) {
        const s = stratifiedSplit(oneStratum(n), (i) => i.kind, ratios, 7);
        if (s.val.length > 0 && s.test.length > 0) {
          measured = n;
          break;
        }
      }
      expect(minimumStratumSizeForHeldOutCoverage(ratios)).toBe(measured);
    }
  });
});
