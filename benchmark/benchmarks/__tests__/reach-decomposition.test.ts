import { describe, expect, it } from 'vitest';

import type { ScheduledCase } from '../src/investigation-schedule.js';
import {
  formatReachDecomposition,
  REACH_SPLITS,
  reachDecompositionOf,
  splitOf,
  type SplitReading,
} from '../src/reach-decomposition.js';

/** One case: an engine order, its labels, whether the surface was right, and what the arm queried. */
function one(
  order: readonly string[],
  truth: readonly string[],
  correct: boolean,
  calls: readonly string[] | null,
): ScheduledCase {
  return { datapack: `c${order.length}-${truth.join('')}`, truth, order, correct, calls };
}

describe('which split a case belongs to', () => {
  it('reads a case whose investigation queried the culprit as queried', () => {
    expect(splitOf(one(['a', 'b'], ['b'], false, ['b']))).toBe('queried');
  });

  it('reads a case that queried other services as unqueried, because the question is about the culprit', () => {
    expect(splitOf(one(['a', 'b'], ['b'], false, ['a']))).toBe('unqueried');
  });

  it('keeps a row with no call column out of both measured splits', () => {
    expect(splitOf(one(['a', 'b'], ['b'], false, null))).toBe('unrecorded');
  });

  it('counts any of several acceptable answers as the culprit', () => {
    expect(splitOf(one(['a', 'b'], ['b', 'a'], true, ['a']))).toBe('queried');
  });

  it('has exactly three splits, so a new one cannot be added without this file failing', () => {
    expect(REACH_SPLITS).toEqual(['queried', 'unqueried', 'unrecorded']);
  });
});

describe('the decomposition at one cutoff', () => {
  function population(): ScheduledCase[] {
    return [
      // queried: rank 1, hit
      one(['a', 'b'], ['a'], true, ['a']),
      // queried: rank 3, miss
      one(['a', 'b', 'c'], ['c'], false, ['c']),
      // unqueried: rank 2, hit (the engine found it even though the arm did not look)
      one(['a', 'b'], ['b'], true, ['a']),
      // unqueried: rank 6 at k=5, miss
      one(['a', 'b', 'c', 'd', 'e', 'f'], ['f'], false, ['a']),
      // unqueried: absent from the pool, miss
      one(['a', 'b'], ['z'], false, ['a']),
      // unrecorded: rank 1, hit
      one(['a', 'b'], ['a'], true, null),
    ];
  }

  it('keeps every split disjoint and exhaustive', () => {
    const rows = reachDecompositionOf(population(), 5);
    expect(rows.reduce((sum, row) => sum + row.cases, 0)).toBe(6);
    expect(rows.map((row) => row.cases)).toEqual([2, 3, 1]);
  });

  it('measures retrieval over the split whole population, so an absent label lowers it', () => {
    const rows = reachDecompositionOf(population(), 5);
    const unqueried = rows.find((row) => row.split === 'unqueried')!;
    // Two of the three unqueried cases are inside five; the absent one cannot be.
    expect(unqueried.retrieved).toBe(1);
    expect(unqueried.retrieval).toBeCloseTo(1 / 3, 10);
  });

  it('measures rerank over what was RETRIEVED, which is the denominator that makes it a reranker rate', () => {
    const rows = reachDecompositionOf(population(), 5);
    const unqueried = rows.find((row) => row.split === 'unqueried')!;
    expect(unqueried.atOne).toBe(0);
    expect(unqueried.rerank).toBe(0);
    const queried = rows.find((row) => row.split === 'queried')!;
    // Two of the two queried cases were retrieved and one of them is at rank 1, so the rate is over RETRIEVED — 1/2 —
    // and not over the population, which would be 1/2 as well by coincidence here and 1 057/1 198 on the real corpus.
    expect(queried.retrieved).toBe(2);
    expect(queried.atOne).toBe(1);
    expect(queried.rerank).toBe(0.5);
  });

  it('carries each split own outcome, so a rate can be read against what the surface actually did', () => {
    const rows = reachDecompositionOf(population(), 5);
    expect(rows.map((row) => row.hits)).toEqual([1, 1, 1]);
  });

  it('moves the retrieved count with the cutoff and leaves the population alone', () => {
    const five = reachDecompositionOf(population(), 5);
    const six = reachDecompositionOf(population(), 6);
    expect(five.map((row) => row.cases)).toEqual(six.map((row) => row.cases));
    expect(six.find((row) => row.split === 'unqueried')!.retrieved).toBe(2);
  });

  it('reports a null rate for a split with no cases rather than a zero', () => {
    const rows = reachDecompositionOf([one(['a'], ['a'], true, ['a'])], 5);
    const unrecorded = rows.find((row) => row.split === 'unrecorded')!;
    expect(unrecorded.cases).toBe(0);
    expect(unrecorded.retrieval).toBeNull();
    expect(unrecorded.rerank).toBeNull();
  });

  it('reports a null rerank when nothing in the split was retrieved', () => {
    const rows = reachDecompositionOf([one(['a', 'b'], ['z'], false, ['a'])], 1);
    const unqueried = rows.find((row) => row.split === 'unqueried')!;
    expect(unqueried.retrieved).toBe(0);
    expect(unqueried.retrieval).toBe(0);
    expect(unqueried.rerank).toBeNull();
  });

  it('refuses a cutoff that is not a positive integer', () => {
    for (const k of [0, -1, 1.5, Number.NaN]) {
      expect(() => reachDecompositionOf([], k)).toThrow(/positive integer/);
    }
  });
});

describe('rendering the split', () => {
  function rows(
    over: Partial<Record<'queried' | 'unqueried' | 'unrecorded', Partial<SplitReading>>>,
  ): SplitReading[] {
    const base: Record<'queried' | 'unqueried' | 'unrecorded', SplitReading> = {
      queried: {
        split: 'queried',
        cases: 1_198,
        retrieved: 1_189,
        atOne: 1_057,
        hits: 1_178,
        retrieval: 1_189 / 1_198,
        rerank: 1_057 / 1_189,
      },
      unqueried: {
        split: 'unqueried',
        cases: 224,
        retrieved: 60,
        atOne: 16,
        hits: 150,
        retrieval: 60 / 224,
        rerank: 16 / 60,
      },
      unrecorded: {
        split: 'unrecorded',
        cases: 0,
        retrieved: 0,
        atOne: 0,
        hits: 0,
        retrieval: null,
        rerank: null,
      },
    };
    return [
      { ...base.queried, ...over.queried },
      { ...base.unqueried, ...over.unqueried },
      { ...base.unrecorded, ...over.unrecorded },
    ];
  }

  it('prints one row per split with a named cutoff', () => {
    const text = formatReachDecomposition(rows({}), 5);
    expect(text.split('\n')[0]).toBe(
      "retrieval at 5, split by what the arm's own record says it did",
    );
    expect(text).toContain('queried      1198       99.25 %    88.90 %   1178');
    expect(text).toContain('unqueried     224       26.79 %    26.67 %    150');
  });

  it('prints the pooled rate over the two observed splits only, and says what pooling hides', () => {
    const text = formatReachDecomposition(rows({}), 5);
    // 1 189 + 60 of 1 198 + 224.
    expect(text).toContain(
      'the two observed splits: 1249 of 1422 cases have the culprit inside the first 5 (87.83 %)',
    );
    expect(text).toContain('averages a solved population with an unsolved one');
  });

  it('says an unmeasured row is in neither split, and says so the other way when there are none', () => {
    expect(formatReachDecomposition(rows({}), 5)).toContain(
      'no row lacks a call column, so the two observed splits are the whole population',
    );
    expect(formatReachDecomposition(rows({ unrecorded: { cases: 9 } }), 5)).toContain(
      '9 rows carry no call column: unmeasured, and therefore in neither observed split',
    );
  });

  it('prints an empty rate as undefined rather than as zero', () => {
    expect(formatReachDecomposition(rows({ unrecorded: { cases: 2 } }), 5)).toContain(
      'unrecorded      2     undefined  undefined      0',
    );
  });

  it('reports the pooled rate as undefined when both observed splits are empty', () => {
    const text = formatReachDecomposition(
      rows({ queried: { cases: 0, retrieved: 0 }, unqueried: { cases: 0, retrieved: 0 } }),
      5,
    );
    expect(text).toContain('0 of 0 cases have the culprit inside the first 5 (undefined)');
  });
});
