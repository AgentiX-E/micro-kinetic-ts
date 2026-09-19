import { describe, expect, it } from 'vitest';

import { stratifiedSplit } from '../../src/split.js';

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
