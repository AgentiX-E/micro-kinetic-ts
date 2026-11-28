/**
 * Rank fusion: how two orders become one, and why the obvious answer is the wrong one.
 *
 * The layer above this one (`hypothesis-space.ts`) states what a claim must satisfy to be *admissible*; the layer
 * beside it (`eliminator.ts`) states what a model is *asked*. This module answers a third question that the first
 * two deliberately leave open: given the engine's order and a second signal, **how do two rankings become one**.
 *
 * Three shapes are implemented and none of them is "add a bonus to a score". That is a decision with a reason,
 * and the reason is measurable. The displacement operator the shipped arm used is a *unary* rule — it multiplies
 * one candidate's score by `1 − weight`, so `weight = 1` erases the engine's first place rather than outvoting it,
 * and a claim that promotes rank 1 does so by deleting rank 0. A rank-fusion operator is *pairwise*: it says where
 * two orders disagree and resolves the disagreement by position, so no weight can delete a candidate unless a
 * second order ranks something above it. On the 1 422-case corpus that is the whole difference between "the arm
 * lost 602 cases" and "an operator existed that could have expressed a tie".
 *
 * Two families, because the inputs differ and pretending otherwise hides a semantic choice:
 *
 * * {@link fuseRanks} fuses two **orders** (`rrf`, `borda`). Its second input is a permutation of services, from
 *   anywhere — another engine, a survey, a human.
 * * {@link fuseClaims} fuses an order with a **claim set** (`rrf`, `borda`, `veto`). `veto` only exists here,
 *   because it is defined pair by pair on what a claim literally says, and an order alone cannot express which
 *   pairs were stated and which were inferred.
 *
 * The properties below are why this module is a pure function:
 *
 * * **No truth, no clock, no case id.** A fusion reads an order and a second signal. That is what lets one
 *   artifact be re-scored under every strategy without a second dispatch, and what makes a strategy comparison a
 *   computation rather than an experiment.
 * * **`weight = 0` is the control, for every strategy and by construction.** Not "approximately the engine": the
 *   functions return the engine's order unchanged, so a delta measured against the zero weight is a delta against
 *   the engine itself and not against a re-implementation of it.
 * * **Fusion does not verify.** An inadmissible claim fuses exactly as well as an admissible one, so a caller that
 *   wants refusals to matter must filter first. Keeping the two apart is what stops "the arm was refused" and "the
 *   arm was outvoted" from collapsing into one number in the table a reader uses to tell them apart.
 */

import type { EliminationClaim } from './hypothesis-space.js';

/** The operators that read two orders. */
export const RANK_STRATEGIES = ['rrf', 'borda'] as const;
export type RankStrategy = (typeof RANK_STRATEGIES)[number];

/**
 * The operators a claim set can be fused with.
 *
 * `rrf` is reciprocal rank fusion (Cormack, Clarke & Büttcher, 2009); `borda` is positional scoring; `veto` is the
 * set-shaped operator, present because it is the only one that expresses what a claim literally says — "B should
 * stand before A" — without inventing a strength the claim does not carry.
 */
export const FUSION_STRATEGIES = ['rrf', 'borda', 'veto'] as const;
export type FusionStrategy = (typeof FUSION_STRATEGIES)[number];

/**
 * How to fuse two orders.
 *
 * `weight` is the second order's share and `0` is the control. `rrfK` is RRF's smoothing constant; 60 is the
 * literature's default, and its effect is that one first place is worth less than two second places — the property
 * that makes the operator survive one order being wrong.
 */
export interface RankFusionOptions {
  readonly strategy: RankStrategy;
  readonly weight: number;
  readonly rrfK: number;
}

/**
 * How to fuse an order with a claim set.
 *
 * For `veto`, `weight` is a **gate, not a dial**: the operator fires at `weight >= 1` and does nothing below it,
 * because a veto that fires halfway has no definition anybody wrote down, and a scale that exists only because the
 * code accepted it is what this repository refuses elsewhere too (see `departureOf`'s zero-width band, which
 * returns infinity rather than a made-up floor).
 */
export interface FusionOptions {
  readonly strategy: FusionStrategy;
  readonly weight: number;
  readonly rrfK: number;
}

/** The control configuration, in both shapes: zero weight is the engine, and the strategy is then irrelevant. */
export const DEFAULT_RANK_FUSION_OPTIONS: RankFusionOptions = {
  strategy: 'rrf',
  weight: 0,
  rrfK: 60,
};
export const DEFAULT_FUSION_OPTIONS: FusionOptions = DEFAULT_RANK_FUSION_OPTIONS;

/**
 * Fuse an engine order with a second order, by position.
 *
 * Each service's score is a sum over the orders that carry it, with the second order's contribution scaled by
 * `weight`:
 *
 * * `rrf` — `1 / (k + engineRank) + weight / (k + modelRank)`, ranks 1-based.
 * * `borda` — `(n − engineRank) + weight · (n − modelRank)`.
 *
 * A service the second order does not carry scores on the engine's order alone — it keeps its standing and forgoes
 * the contribution it never had. The alternative, ranking an absent service just after the second order's last
 * entry, was implemented first and failed its own test: a second order naming one service out of five would rank
 * the other four as "second", which turns a nearly empty opinion into a nearly full one. Absence is absence.
 *
 * The result always holds exactly the engine's services, best first: a second order that names a service the
 * engine did not rank cannot insert it, because an insertion has no `from` position for a caller to report.
 *
 * Ties break on the engine's rank, so a fusion cannot reorder two services the engine tied unless the second order
 * separates them.
 *
 * @param engineOrder - The engine's services, best first.
 * @param modelOrder - The second order. Need not be a permutation of the first; repeats are read at first sight.
 * @param options - Strategy, weight and RRF's constant.
 * @returns A new order over the engine's services; `engineOrder` itself when `weight` is zero.
 */
export function fuseRanks(
  engineOrder: readonly string[],
  modelOrder: readonly string[],
  options: RankFusionOptions = DEFAULT_RANK_FUSION_OPTIONS,
): readonly string[] {
  if (options.weight === 0 || engineOrder.length === 0) return [...engineOrder];
  const modelRank = new Map<string, number>();
  for (const [index, service] of modelOrder.entries()) {
    if (!modelRank.has(service)) modelRank.set(service, index + 1);
  }
  const size = engineOrder.length;
  const scored = engineOrder.map((service, position) => {
    const at = position + 1;
    const by = modelRank.get(service);
    const own = options.strategy === 'rrf' ? 1 / (options.rrfK + at) : size - at;
    const theirs =
      by === undefined
        ? 0
        : options.strategy === 'rrf'
          ? options.weight / (options.rrfK + by)
          : options.weight * (size - by);
    return { service, score: own + theirs, at };
  });
  // `at` is the tie-break rather than the array index, so the rule survives a caller that hands the engine's order
  // over already permuted by an earlier fusion.
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.at - b.at));
  return scored.map((row) => row.service);
}

/**
 * The order a claim set implies, on its own.
 *
 * Each claim is a preference: `keep` should stand before `remove`, which is read as **a promotion of `keep`** and
 * nothing else. Counting removals as well was implemented first and produced an order no claim asked for: two
 * services the model never mentioned outranked one it named as the thing to remove, because "never mentioned"
 * scored higher than "mentioned as wrong". A service can be demoted only by something else being promoted over it,
 * which is what the count states.
 *
 * Counting rather than topologically sorting, because claim sets routinely contain cycles (A before B, B before A)
 * and a cycle has no topological order. A count is "how many claims agree with this position" rather than a claim
 * about a total order the data does not support.
 *
 * Ties break on the engine's order, which is what makes an empty claim set — a legitimate answer meaning "the
 * ranking is already right" — return the engine's order **exactly**, so it fuses to a no-op under every strategy
 * instead of to an arbitrary permutation.
 *
 * @param engineOrder - The engine's services, best first. Seeds the tie-break and the tail order.
 * @param claims - The claims to read, in recorded order.
 * @returns The implied order; equal element-wise to `engineOrder` when no claim names a ranked service.
 */
export function impliedOrder(
  engineOrder: readonly string[],
  claims: readonly EliminationClaim[],
): readonly string[] {
  const rows = new Map<
    string,
    { readonly service: string; promotions: number; readonly at: number; engine: number }
  >();
  const note = (
    service: string,
  ): { readonly service: string; promotions: number; readonly at: number; engine: number } => {
    const existing = rows.get(service);
    if (existing !== undefined) return existing;
    const created = { service, promotions: 0, at: rows.size, engine: Number.POSITIVE_INFINITY };
    rows.set(service, created);
    return created;
  };
  for (const [index, service] of engineOrder.entries()) {
    const row = note(service);
    // A repeated engine service keeps the first position it was seen at, because that is the rank the tie-break
    // would have used and a later duplicate is a defect in the caller's order, not a second opinion.
    if (row.engine === Number.POSITIVE_INFINITY) row.engine = index;
  }
  for (const claim of claims) {
    note(claim.keep).promotions += 1;
    note(claim.remove);
  }
  const ordered = [...rows.values()];
  ordered.sort((a, b) => {
    if (a.promotions !== b.promotions) return b.promotions - a.promotions;
    // Subtraction rather than a ternary: `Infinity − finite` is the sign the comparison wants, and the `!==` above
    // has already excluded the one pair that would produce `NaN`. A ternary here had an arm the comparator can
    // never reach — a ranked service is always seated before an unranked one — and an arm nobody can reach is a
    // branch nobody measures.
    if (a.engine !== b.engine) return a.engine - b.engine;
    return a.at - b.at;
  });
  return ordered.map((row) => row.service);
}

/**
 * Fuse an engine order with the order its claim set implies, or with the moves it states.
 *
 * `rrf` and `borda` delegate to {@link fuseRanks} on {@link impliedOrder}. `veto` does not: it walks the claims
 * and applies each stated move, which is a different operator on purpose — counting credits lets a service the
 * model never mentioned drift, while a veto touches only the pairs the model actually wrote down.
 *
 * @param engineOrder - The engine's services, best first.
 * @param claims - The claims to read. Unverified is fine (see the module docblock).
 * @param options - Strategy, weight and RRF's constant.
 * @returns A new order over the engine's services.
 */
export function fuseClaims(
  engineOrder: readonly string[],
  claims: readonly EliminationClaim[],
  options: FusionOptions = DEFAULT_FUSION_OPTIONS,
): readonly string[] {
  if (options.weight === 0 || engineOrder.length === 0) return [...engineOrder];
  if (options.strategy !== 'veto') {
    return fuseRanks(engineOrder, impliedOrder(engineOrder, claims), {
      strategy: options.strategy,
      weight: options.weight,
      rrfK: options.rrfK,
    });
  }
  return vetoOrder(engineOrder, claims, options.weight);
}

/**
 * Apply each claim as one move: the kept service is placed immediately before the removed one.
 *
 * Moves are applied from the deepest engine position to the shallowest, so a move cannot shift the anchor another
 * move is about to use; equal anchors keep the recorded order, which makes the result a function of the artifact
 * rather than of a set iteration. A pair stated in both directions is applied once, in its first-recorded
 * direction — otherwise "A before B" and "B before A" would undo each other and the result would depend on which
 * was read last.
 *
 * A claim naming a service the engine did not rank is skipped, and so is a claim whose kept service already stands
 * first: a move to where the service already is has nothing to state.
 * `weight < 1` is a no-op because a veto has no half.
 */
function vetoOrder(
  engineOrder: readonly string[],
  claims: readonly EliminationClaim[],
  weight: number,
): readonly string[] {
  if (weight < 1) return [...engineOrder];
  const anchor = new Map<string, number>();
  for (const [index, service] of engineOrder.entries()) anchor.set(service, index);
  const stated = new Set<string>();
  const moves: { readonly keep: string; readonly remove: string; readonly at: number }[] = [];
  for (const claim of claims) {
    const at = anchor.get(claim.remove);
    if (at === undefined || !anchor.has(claim.keep) || claim.keep === claim.remove) continue;
    const pair =
      claim.keep < claim.remove
        ? `${claim.keep}\u0000${claim.remove}`
        : `${claim.remove}\u0000${claim.keep}`;
    if (stated.has(pair)) continue;
    stated.add(pair);
    moves.push({ keep: claim.keep, remove: claim.remove, at });
  }
  moves.sort((a, b) => b.at - a.at);
  let order = [...engineOrder];
  for (const move of moves) {
    const from = order.indexOf(move.keep);
    const to = order.indexOf(move.remove);
    if (from < to) continue;
    order = [...order.slice(0, to), move.keep, ...order.slice(to).filter((s) => s !== move.keep)];
  }
  return order;
}
