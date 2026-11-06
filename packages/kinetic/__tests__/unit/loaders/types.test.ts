/**
 * The accepted-answer rule, which one corpus and two runners had three versions of.
 *
 * These functions are two lines each, and they exist because the RULE they encode was written three
 * times: `run-fse26.ts` scored `accepted.includes(rank[0])`, `benchmark-runner.ts` scored
 * `rank[0] === serviceId`, and `BenchmarkGroundTruth.serviceIds`' own docblock said the first. On the
 * 1,422-pack RCABench corpus the two readings differed by **148 cases (32.28% vs 42.69%)**, so the
 * test that matters here is not that the function returns an array — it is that every shape a corpus
 * can hand it maps to the set the corpus meant.
 */

import { describe, expect, it } from 'vitest';

import {
  acceptedTruthServiceIds,
  bestAcceptedRank,
} from '../../../src/benchmarks/loaders/types.js';
import type { BenchmarkGroundTruth } from '../../../src/benchmarks/loaders/types.js';

/** A ground truth with the fields the rule reads. */
function gt(serviceId: string, serviceIds?: readonly string[]): BenchmarkGroundTruth {
  return serviceIds === undefined
    ? { serviceId, faultType: 'cpu' }
    : { serviceId, serviceIds, faultType: 'cpu' };
}

describe('acceptedTruthServiceIds', () => {
  it('accepts exactly the single label when the corpus declares no set', () => {
    // Every RCAEval directory is this shape, which is why the nine published cells cannot move.
    expect(acceptedTruthServiceIds(gt('ts-order-service'))).toEqual(['ts-order-service']);
  });

  it('passes a declared set through in the corpus order, unchanged', () => {
    // Order matters downstream: `serviceId` is documented to be the set's FIRST member, and a reader
    // that sorts or dedupes here would break that for every diagnostic that prints both.
    expect(acceptedTruthServiceIds(gt('mysql', ['mysql', 'ts-order-service']))).toEqual([
      'mysql',
      'ts-order-service',
    ]);
  });

  it('treats an empty declared set as no set rather than as "nothing is correct"', () => {
    // An empty array is what a bridge writes when a pack declares no service-level truth. Answering `[]`
    // would make the case unwinnable by construction and would report the engine's miss as its own fault.
    expect(acceptedTruthServiceIds(gt('ts-order-service', []))).toEqual(['ts-order-service']);
  });

  it('keeps a one-member declared set rather than substituting the label', () => {
    // The loader only records a set with more than one member, so this shape arrives from a corpus that
    // states its own single answer. Honouring it means one rule for "the corpus told us" everywhere.
    expect(acceptedTruthServiceIds(gt('ignored', ['ts-config-service']))).toEqual([
      'ts-config-service',
    ]);
  });

  it('accepts the empty label when that is all a case has', () => {
    // A malformed case must not throw inside the scoring loop: `['']` matches no ranking, which is the
    // verdict the single-label rule gave it too.
    expect(acceptedTruthServiceIds(gt(''))).toEqual(['']);
  });
});

describe('bestAcceptedRank', () => {
  const ranking = [{ serviceId: 'a' }, { serviceId: 'b' }, { serviceId: 'c' }];

  it('reports the rank of the first accepted answer, not of the first declared one', () => {
    // The case this exists for: rank 1 is the SECOND accepted label. Before the set rule this was a
    // recorded miss at rank 2 and an unrecorded hit at rank 1 simultaneously.
    expect(bestAcceptedRank(ranking, ['z', 'b'])).toBe(2);
  });

  it('reports rank 1 when the top prediction is any accepted answer', () => {
    expect(bestAcceptedRank(ranking, ['z', 'a'])).toBe(1);
  });

  it('reports 0 when nothing accepted is ranked', () => {
    // 0 rather than `undefined` because the failure diagnostic prints `ABSENT` for it and a rank of 0
    // is unrepresentable in the ranking — the two facts the census separates.
    expect(bestAcceptedRank(ranking, ['z'])).toBe(0);
  });

  it('reports 0 for an empty ranking', () => {
    expect(bestAcceptedRank([], ['a'])).toBe(0);
  });

  it('reports 0 for an empty accepted set rather than matching everything', () => {
    expect(bestAcceptedRank(ranking, [])).toBe(0);
  });
});
