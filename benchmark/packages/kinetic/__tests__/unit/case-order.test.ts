/**
 * The order convention: code units, one owner, and the pair where it differs from `localeCompare`.
 *
 * This package owns it because `rcaeval-loader.ts` — which sorts a SUITE's case directories — lives here, and a
 * comparator placed in `benchmarks/src` could only be read back from the loader through a dependency inversion.
 * The behavioural half (the walk that uses it, under an injected scrambled traversal) is
 * `benchmarks/__tests__/case-corpus-walk.test.ts`; what is asserted here is the convention itself, because that
 * is what every OTHER site will be judged against.
 */

import { describe, expect, it } from 'vitest';

import { compareCasePaths, inCaseOrder } from '../../src/benchmarks/case-order.js';

describe('compareCasePaths', () => {
  it('is code-unit order and answers ZERO for equal keys', () => {
    // Three arms, and the third is the one a two-arm comparator cannot answer. `Array.prototype.sort` asks
    // whether two keys are equal, and answering `1` there claims an order for two paths that have none.
    expect(compareCasePaths('a', 'b')).toBe(-1);
    expect(compareCasePaths('b', 'a')).toBe(1);
    expect(compareCasePaths('identical', 'identical')).toBe(0);
  });

  it('orders by code unit where `localeCompare` orders by collation', () => {
    // The pair, asserted in BOTH directions so the test cannot pass by accident on a machine whose collation
    // happens to agree. `'é'` is U+00E9 and `'z'` is U+007A, so the bytes put `z` first; French collation puts
    // the accented letter first. The corpus's order has to be the byte order, because the other one changes
    // when the machine's ICU version or `LANG` does — and a changed order changes which cases `slice(0, n)`
    // selects, i.e. a published population.
    expect(compareCasePaths('é', 'z')).toBeGreaterThan(0);
    expect('é'.localeCompare('z')).toBeLessThan(0);
  });

  it('orders digits, upper case and lower case the way the bytes do', () => {
    // The shapes an RCAEval corpus actually carries. `U+0030..39` < `U+0041..5A` < `U+0061..7A`, and a case
    // that compares case-insensitively would interleave the third pair differently.
    expect(compareCasePaths('re2ob_0', 're2ob_A')).toBeLessThan(0);
    expect(compareCasePaths('re2ob_A', 're2ob_a')).toBeLessThan(0);
    expect(compareCasePaths('re2ob_10', 're2ob_9')).toBeLessThan(0);
  });

  it('agrees with the default `Array.prototype.sort` on strings', () => {
    // The claim that makes this comparator a CONVENTION rather than a behaviour: wherever a site sorts strings
    // with no comparator, it already has code-unit order. So adopting this one changes nothing there, and the
    // sites that used `localeCompare` are the whole of the change.
    const hostile = ['re2ob_B', 're2ob_a', 'é', 'z', 're2ob_10', 're2ob_9', 'A', '_', ''];
    expect([...hostile].sort(compareCasePaths)).toEqual([...hostile].sort());
  });
});

describe('inCaseOrder', () => {
  it('returns a COPY, so the caller’s array is not reordered by a function named "in order"', () => {
    // The sequences this orders are often `readonly` views of a cache or of another module's array, and a
    // function whose name states a property must not acquire a second effect.
    const input = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    const ordered = inCaseOrder(input, (item) => item.id);
    expect(ordered.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(input.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('is idempotent, so ordering an already-ordered sequence is a no-op', () => {
    const once = inCaseOrder(['b', 'a', 'c'], (s) => s);
    expect(inCaseOrder(once, (s) => s)).toEqual(once);
  });

  it('orders an EMPTY and a SINGLE-element sequence without special-casing either', () => {
    expect(inCaseOrder([], (s: string) => s)).toEqual([]);
    expect(inCaseOrder(['only'], (s) => s)).toEqual(['only']);
  });
});
