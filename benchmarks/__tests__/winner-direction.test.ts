/**
 * The winner's DIRECTION — the column every artifact in `docs/` was missing.
 *
 * ## The debt this pays
 *
 * `docs/topo-share.md` §11 reads the 94 misses of the enrolled arm and names a band: 31 cases where the truth
 * is at rank 2, one promotion from correct. It then attributes them by NAME — six to `ts-admin-travel-service`,
 * three to `front-end`, "twenty-two to the truth's own CALLEE" — and that last attribution is a guess. A service
 * id does not carry its edge direction, and the census did not record the graph.
 *
 * So the record contains a claim it cannot count, which is the exact failure `docs/benchmark-corpus-completeness.md`
 * §11 was written about: `Blast Radius Bench` publishes a **reversed-causality count** — "how many edges the
 * model inverted, claiming a downstream victim caused an upstream service" — and calls it the single most
 * diagnostic error in incident reasoning. This engine reports the truth's RANK in every artifact and the
 * DIRECTION of its loss in none.
 *
 * ## What the classification is, and what it deliberately is not
 *
 * The call graph is `caller → callee` (a caller depends on a callee), and a fault at a callee propagates to its
 * caller. So for a miss with ground truth `t` and winner `w`:
 *
 * - `caller` — `w` reaches `t` by call edges, i.e. **`w` is a victim of `t`**. This is Blast Radius's
 *   reversed-causality error: the ranking blamed something downstream of the cause.
 * - `callee` — `t` reaches `w`: the ranking blamed something the truth DEPENDS ON, which the truth's own fault
 *   cannot have caused. The opposite inversion, and a different repair.
 * - `unrelated` — neither reaches the other. No topological operator can repair these; they are a scoring
 *   question, and filing them with the other two would make a direction fix look responsible for them.
 * - `self` — the winner IS the truth. Only reachable for a correct case, and present so the function is total.
 *
 * `hops` is the shortest distance, because six of the twenty-two "callee" claims are one hop and the rest are
 * not, and a repair that only crosses one edge cannot be evaluated on a population that mixes the two.
 *
 * A pair inside a cycle reaches both ways and has NO direction. That is reported rather than resolved into
 * either answer: the nearer side wins, and on a tie `caller`, because the counter exists to measure the
 * reversed-causality error and a tie is at least that.
 */

import { describe, expect, it } from 'vitest';

import type { CallEdge, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';
import {
  classifyWinnerRelation,
  formatWinnerDirection,
  type LossRecord,
  summarizeWinnerDirection,
} from '../src/loss-census.js';

function edge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 };
}

/** A graph from an edge list, with the nodes derived so a fixture cannot disagree with itself. */
function graphOf(...pairs: readonly (readonly [string, string])[]): ServiceCallGraph {
  const edges = pairs.map(([from, to]) => edge(from, to));
  const ids = new Set(pairs.flat());
  return {
    nodes: new Map([...ids].map((id) => [id, { id, name: id }])),
    edges,
  } as unknown as ServiceCallGraph;
}

/** A miss, with the two fields the direction census reads. */
function miss(
  truth: string,
  predicted: string | undefined,
  cell = 'RE1:OnlineBoutique',
): LossRecord {
  return {
    caseId: `${cell}:${truth}`,
    cell,
    faultType: 'cpu',
    truth,
    predicted,
    correct: predicted === truth,
    pool: 12,
    truthInGraph: true,
  } as unknown as LossRecord;
}

describe('classifyWinnerRelation — the direction of a loss, from the graph alone', () => {
  it('names a direct caller of the truth as REVERSED: the winner is a victim', () => {
    // SockShop: `front-end` calls `carts`. A fault in `carts` propagates UP to `front-end`, so a ranking that
    // answers `front-end` has blamed the victim — the error Blast Radius Bench counts as most diagnostic.
    const g = graphOf(['front-end', 'carts']);
    expect(classifyWinnerRelation(g, 'carts', 'front-end')).toEqual({
      relation: 'caller',
      hops: 1,
    });
  });

  it('names a direct callee of the truth as the OPPOSITE inversion, at one hop', () => {
    // TrainTicket: `ts-order-service` calls `ts-inside-payment-service`. A fault in the caller cannot be caused
    // by the callee, so answering the callee is not reversed causality — it is the mirror error, and a repair
    // for one is not a repair for the other.
    const g = graphOf(['ts-order-service', 'ts-inside-payment-service']);
    expect(classifyWinnerRelation(g, 'ts-order-service', 'ts-inside-payment-service')).toEqual({
      relation: 'callee',
      hops: 1,
    });
  });

  it('counts hops, because a one-hop repair cannot be judged on a two-hop population', () => {
    const g = graphOf(['front-end', 'checkout'], ['checkout', 'cart'], ['cart', 'currency']);
    expect(classifyWinnerRelation(g, 'currency', 'front-end')).toEqual({
      relation: 'caller',
      hops: 3,
    });
    expect(classifyWinnerRelation(g, 'front-end', 'currency')).toEqual({
      relation: 'callee',
      hops: 3,
    });
  });

  it('takes the SHORTEST path when the graph offers two', () => {
    // `a` reaches `d` directly and through `c`; the distance a repair would have to cross is the direct one.
    const g = graphOf(['a', 'd'], ['a', 'c'], ['c', 'd']);
    expect(classifyWinnerRelation(g, 'd', 'a')).toEqual({ relation: 'caller', hops: 1 });
  });

  it('reports a sibling pair as UNRELATED rather than as a direction it did not measure', () => {
    // `orders` calls both `payment` and `shipping`; neither can explain the other, and filing this under either
    // inversion would credit a direction fix with a case no topological operator can reach.
    const g = graphOf(['orders', 'payment'], ['orders', 'shipping']);
    expect(classifyWinnerRelation(g, 'payment', 'shipping')).toEqual({
      relation: 'unrelated',
      hops: 0,
    });
  });

  it('reports a cycle as the nearer side, and as `caller` on a tie', () => {
    // A ↔ B is a genuine mutual dependency, so the pair has no direction: both readings are one hop and the
    // graph cannot prefer either. The counter exists for the reversed-causality error, so an undecidable pair
    // is counted there rather than in `unrelated` — calling it unrelated would understate the error the metric
    // is about, and calling it `callee` would hide it.
    const two = graphOf(['a', 'b'], ['b', 'a']);
    expect(classifyWinnerRelation(two, 'a', 'b')).toEqual({ relation: 'caller', hops: 1 });
    // A longer cycle IS decidable, because the two distances differ: in a→b→c→a the truth's caller is one hop
    // and its callee is two, on every pair. The tie rule above therefore cannot reach a ring of three, which is
    // the assertion that keeps the rule from being a general-purpose coin.
    const ring = graphOf(['a', 'b'], ['b', 'c'], ['c', 'a']);
    expect(classifyWinnerRelation(ring, 'a', 'b')).toEqual({ relation: 'callee', hops: 1 });
    expect(classifyWinnerRelation(ring, 'a', 'c')).toEqual({ relation: 'caller', hops: 1 });
    expect(classifyWinnerRelation(ring, 'b', 'a')).toEqual({ relation: 'caller', hops: 1 });
  });

  it('is total on the degenerate inputs a corpus actually produces', () => {
    const g = graphOf(['a', 'b']);
    // The winner is the truth: a correct case, and the only reading at zero hops.
    expect(classifyWinnerRelation(g, 'a', 'a')).toEqual({ relation: 'self', hops: 0 });
    // A node that is not in this case's graph reaches nothing — including a service the corpus knows about.
    expect(classifyWinnerRelation(g, 'a', 'ghost')).toEqual({ relation: 'unrelated', hops: 0 });
    // An empty graph is a case whose topology failed to load, not a direction.
    expect(classifyWinnerRelation(graphOf(), 'a', 'b')).toEqual({ relation: 'unrelated', hops: 0 });
  });
});

describe('summarizeWinnerDirection — the counter, per cell, with its absences', () => {
  it('counts the three directions and the one-hop share of the reversed half', () => {
    const records = [
      miss('carts', 'front-end'), // caller, 1 hop
      miss('carts', 'front-end'),
      miss('orders', 'orders-db'), // callee, 1 hop
      miss('payment', 'shipping'), // unrelated
      miss('carts', 'carts'), // correct: not a miss, and counted as such
    ];
    // The relation is a property of the CASE, so the summariser reads it off the record rather than the graph:
    // a second graph walk here would be a second answer to a question the record already answered.
    const withRelations = records.map((r, i) => ({
      ...r,
      winnerRelation: (['caller', 'caller', 'callee', 'unrelated', 'self'] as const)[i],
      winnerHops: ([1, 1, 1, 0, 0] as const)[i],
    }));
    const rows = summarizeWinnerDirection(withRelations);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({
      suite: 'RE1',
      system: 'OnlineBoutique',
      cases: 5,
      correct: 1,
      misses: 4,
      caller: 2,
      directCaller: 2,
      callee: 1,
      unrelated: 1,
      unstated: 0,
    });
  });

  it('separates a record that predates the instrument from one that measured `unrelated`', () => {
    // An artifact written before this field existed cannot say a winner was unrelated — it did not look. Filing
    // the absence as `unrelated` would report a corpus fact ("no topological path") for what is a fact about
    // the artifact, which is the defect `classifyTermZero` exists to prevent one level down.
    const rows = summarizeWinnerDirection([
      miss('a', 'b'),
      { ...miss('c', 'd'), winnerRelation: 'unrelated', winnerHops: 0 },
    ]);
    expect(rows[0]).toMatchObject({ misses: 2, unrelated: 1, unstated: 1 });
  });

  it('counts a case that produced no winner as unstated rather than as a direction', () => {
    const rows = summarizeWinnerDirection([
      { ...miss('a', undefined), winnerRelation: 'unrelated', winnerHops: 0 },
    ]);
    // A record whose `predicted` is absent has no winner to place relative to the truth, whatever the
    // neighbouring field says; the ordering of the two checks is the assertion.
    expect(rows[0]).toMatchObject({ misses: 1, unrelated: 0, unstated: 1 });
  });

  it('groups by cell, in the order the report prints', () => {
    const rows = summarizeWinnerDirection([
      { ...miss('a', 'b', 'RE2:SockShop'), winnerRelation: 'callee' as const, winnerHops: 1 },
      { ...miss('a', 'b', 'RE1:OnlineBoutique'), winnerRelation: 'caller' as const, winnerHops: 2 },
    ]);
    expect(rows.map((r) => `${r.suite}:${r.system}`)).toEqual([
      'RE1:OnlineBoutique',
      'RE2:SockShop',
    ]);
  });
});

describe('formatWinnerDirection — the reading, and the sentence it refuses to print', () => {
  it('prints the three directions beside the misses they are a share of', () => {
    const lines = formatWinnerDirection(
      summarizeWinnerDirection([
        { ...miss('a', 'b'), winnerRelation: 'caller' as const, winnerHops: 1 },
        { ...miss('c', 'd'), winnerRelation: 'unrelated' as const, winnerHops: 0 },
      ]),
    );
    expect(lines[0]).toContain('reversed');
    expect(lines.join('\n')).toContain('50.0%');
    expect(lines.join('\n')).toContain('RE1:OnlineBoutique');
  });

  it('says so instead of printing a table over nothing', () => {
    expect(formatWinnerDirection([])).toEqual([
      'no misses to place: nothing to census, and saying so beats printing a zero.',
    ]);
  });
});
