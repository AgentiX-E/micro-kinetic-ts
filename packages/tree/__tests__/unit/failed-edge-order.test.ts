/**
 * The failed-edge partition's contract, stated as behaviour rather than as an implementation.
 *
 * The rule is a STABLE PARTITION of the ranking: credited candidates first, everything else behind, and each
 * half in the order the base ranking gave it. Every test below is one clause of that sentence, and the last
 * group is the one that matters for a default-off switch: a case with no evidence must return the caller's own
 * array, not a copy that happens to compare equal.
 *
 * @module __tests__/unit/failed-edge-order
 */

import { describe, expect, it } from 'vitest';

import { orderFailedEdgeFirst } from '../../src/pruning/failed-edge-order.js';

/** A candidate as the ranking hands it over: an id and nothing else the rule may read. */
const row = (serviceId: string): { serviceId: string } => ({ serviceId });

/** The ranking, best first, with the ledger's credits beside it. */
const ranking = [row('a'), row('b'), row('c'), row('d'), row('e')];

describe('orderFailedEdgeFirst partitions the ranking', () => {
  it('puts every credited candidate ahead of every uncredited one', () => {
    const ordered = orderFailedEdgeFirst(
      ranking,
      new Map([
        ['c', 1],
        ['e', 0.004],
      ]),
    );
    expect(ordered.map((r) => r.serviceId)).toEqual(['c', 'e', 'a', 'b', 'd']);
  });

  it('preserves the relative order inside each half', () => {
    const ordered = orderFailedEdgeFirst(
      ranking,
      new Map([
        ['b', 1],
        ['d', 1],
      ]),
    );
    // `b` before `d` — the base ranking's own order — and `a`, `c`, `e` unchanged behind them.
    expect(ordered.map((r) => r.serviceId)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  it('is stable for a ranking whose credits are all equal', () => {
    const all = new Map(ranking.map((r) => [r.serviceId, 1]));
    const ordered = orderFailedEdgeFirst(ranking, all);
    expect(ordered).toBe(ranking);
  });

  it('does not mutate the array it was given', () => {
    const input = [...ranking];
    orderFailedEdgeFirst(
      input,
      new Map([
        ['e', 1],
        ['a', 1],
      ]),
    );
    expect(input.map((r) => r.serviceId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('a case with no evidence costs nothing', () => {
  it('returns the caller\u2019s array when the ledger was never built', () => {
    expect(orderFailedEdgeFirst(ranking, undefined)).toBe(ranking);
  });

  it('returns the caller\u2019s array when the ledger is empty', () => {
    expect(orderFailedEdgeFirst(ranking, new Map())).toBe(ranking);
  });

  it('returns the caller\u2019s array when no candidate is credited', () => {
    const credits = new Map([
      ['a', 0],
      ['b', -0],
      ['c', Number.NaN],
    ]);
    expect(orderFailedEdgeFirst(ranking, credits)).toBe(ranking);
  });

  it('returns the caller\u2019s array when every candidate is credited', () => {
    const credits = new Map(ranking.map((r) => [r.serviceId, 0.5]));
    expect(orderFailedEdgeFirst(ranking, credits)).toBe(ranking);
  });

  it('treats a zero credit as no credit rather than as a small one', () => {
    // The distinction the ledger's own docblock makes: a computed zero is the ledger saying it counted and
    // found nothing, which is not a membership. A `>= 0` test here would promote every node the walk touched.
    const credits = new Map([
      ['d', 0],
      ['a', 1],
    ]);
    expect(orderFailedEdgeFirst(ranking, credits).map((r) => r.serviceId)).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
    ]);
  });
});

describe('the partition is monotone and idempotent', () => {
  it('is idempotent in VALUE — a second pass moves nothing', () => {
    const credits = new Map([
      ['c', 1],
      ['e', 2],
    ]);
    const once = orderFailedEdgeFirst(ranking, credits);
    const twice = orderFailedEdgeFirst(once, credits);
    // Value, not identity: the second call still sees two non-empty halves, so it returns a fresh array with
    // the same members in the same order. Claiming identity would require scanning the input for "already
    // partitioned", which is a pass the rule does not need to make.
    expect(twice).toStrictEqual(once);
    expect(twice.map((r) => r.serviceId)).toEqual(['c', 'e', 'a', 'b', 'd']);
  });

  it('never changes the SET of candidates it was given', () => {
    const credits = new Map([['c', 1]]);
    const ordered = orderFailedEdgeFirst(ranking, credits);
    expect([...ordered].sort((x, y) => (x.serviceId < y.serviceId ? -1 : 1))).toEqual(
      [...ranking].sort((x, y) => (x.serviceId < y.serviceId ? -1 : 1)),
    );
  });

  it('handles a credit entry for a node that is not in the ranking', () => {
    // The ledger is built from the case's calls, the ranking from the case's scored nodes, and the two
    // populations are not the same: a callee can be credited without being a candidate. An entry for an absent
    // node must not create a member.
    const credits = new Map([
      ['ghost', 1],
      ['b', 1],
    ]);
    expect(orderFailedEdgeFirst(ranking, credits).map((r) => r.serviceId)).toEqual([
      'b',
      'a',
      'c',
      'd',
      'e',
    ]);
  });
});
