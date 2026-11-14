/**
 * The zero-information baseline: what an arm would score if its claims said nothing about the case.
 *
 * This module exists because of a measurement that took fifteen iterations to make. The paid arm was built, run
 * on 1 422 cases, and read −602 against the engine — and the interesting question was not "how do we improve it"
 * but "does it contain any information at all". Both are answerable from the same artifact, and only the second
 * one decides whether a better prompt is a repair or a waste of money.
 *
 * Two nulls are computed, and they answer different questions:
 *
 * * **The uniform null** answers "is the model's choice better than a coin, given the same options". For a claim
 *   that removes `A` and keeps `B`, the null draws `B` uniformly from the other presented candidates and asks how
 *   often it would land in the truth set. The expectation is computed per claim, from that claim's own candidate
 *   pool, so a case whose truth set is large does not inflate the baseline for a case whose truth set is one
 *   service. The variance is the Bernoulli sum, so the reading comes with a z rather than with a percentage a
 *   reader has to compare by eye.
 * * **The constant-swap null** answers "is the model doing anything a fixed rule would not also do". Swapping the
 *   engine's top two on every case is the dumbest arm that can still be written as a one-line function, and its
 *   delta is a number with no model in it. An arm whose claims are 77 % "promote rank 1" is not a reasoner if its
 *   delta is the constant-swap delta: it is that function, at the price of 3.2 M prompt tokens.
 *
 * Both are pure functions of the artifact. Neither touches the network, and neither takes a model.
 */

import type { EliminationClaim } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from './agentic-headroom.js';

/**
 * What one claim set looks like against the uniform null.
 *
 * `expected` is a sum of per-claim probabilities, not a product of averages: the null must be the null for *this*
 * population, or a corpus with deeper candidate lists would appear to make the model smarter.
 */
export interface NullReading {
  /** Claims that named both a removed and a kept service inside their case. */
  readonly claims: number;
  /** Claims whose kept service is in the truth set. */
  readonly hits: number;
  /** Expected hits under "the kept service is drawn uniformly from the other presented candidates". */
  readonly expected: number;
  /** Sum of the per-claim Bernoulli variances, i.e. the null's own variance. */
  readonly variance: number;
  /** `(hits − expected) / sqrt(variance)`; `0` when the variance is zero. */
  readonly z: number;
  /** Claims whose kept service is the engine's rank 1 — the constant, content-free choice. */
  readonly promotingRank1: number;
  /** Claims that are exactly "remove rank 0, keep rank 1". */
  readonly swappingTopTwo: number;
  /** Claims whose kept service the engine did not present, so the null has no pool to draw from. */
  readonly outside: number;
}

/**
 * Read a claim set against the uniform null.
 *
 * A claim naming a case the corpus does not hold is counted in `outside` rather than dropped: a replay that
 * silently discards its unreadable records is a replay that improves by shrinking its own denominator, which is
 * the failure mode `replayOf` was built to make visible.
 *
 * @param cases - The joined corpus, whose candidate order is the engine's.
 * @param claims - Recorded claims, each paired with the datapack it answers.
 * @returns The counts, the null's expectation and the z against it.
 */
export function nullReadingOf(
  cases: readonly HeadroomCase[],
  claims: readonly { readonly datapack: string; readonly claims: readonly EliminationClaim[] }[],
): NullReading {
  const byPack = new Map<string, HeadroomCase>();
  for (const entry of cases) byPack.set(entry.datapack, entry);
  let total = 0;
  let hits = 0;
  let expected = 0;
  let variance = 0;
  let promotingRank1 = 0;
  let swappingTopTwo = 0;
  let outside = 0;
  for (const record of claims) {
    const entry = byPack.get(record.datapack);
    if (entry === undefined) {
      outside += record.claims.length;
      continue;
    }
    const order = entry.candidates.map((candidate) => candidate.service);
    const truth = new Set(entry.accepted);
    for (const claim of record.claims) {
      const keptAt = order.indexOf(claim.keep);
      if (keptAt < 0) {
        outside += 1;
        continue;
      }
      const others = order.filter((service) => service !== claim.remove);
      if (others.length === 0) {
        outside += 1;
        continue;
      }
      total += 1;
      if (truth.has(claim.keep)) hits += 1;
      let share = 0;
      for (const service of others) if (truth.has(service)) share += 1;
      const probability = share / others.length;
      expected += probability;
      variance += probability * (1 - probability);
      if (keptAt === 1) promotingRank1 += 1;
      if (keptAt === 1 && order[0] === claim.remove) swappingTopTwo += 1;
    }
  }
  const z = variance > 0 ? (hits - expected) / Math.sqrt(variance) : 0;
  return { claims: total, hits, expected, variance, z, promotingRank1, swappingTopTwo, outside };
}

/**
 * The constant-swap arm: promote the engine's rank 1 on every case, and nothing else.
 *
 * This is the arm a model has to beat before any of its tokens are worth buying. It is measured on the corpus
 * rather than derived from the claim set, because a model that promotes rank 1 only where it "seems wrong" is a
 * different arm from one that promotes it always, and only the corpus can tell the two deltas apart.
 *
 * @param cases - The joined corpus.
 * @returns The engine's own correct count, and the count after the swap.
 */
export function swapTopTwo(cases: readonly HeadroomCase[]): {
  readonly engine: number;
  readonly swapped: number;
  readonly cases: number;
} {
  let engine = 0;
  let swapped = 0;
  for (const entry of cases) {
    const truth = new Set(entry.accepted);
    const first = entry.candidates[0];
    const second = entry.candidates[1];
    if (first !== undefined && truth.has(first.service)) engine += 1;
    const promoted = second ?? first;
    if (promoted !== undefined && truth.has(promoted.service)) swapped += 1;
  }
  return { engine, swapped, cases: cases.length };
}
