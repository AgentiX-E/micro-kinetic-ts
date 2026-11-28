/**
 * The neighbour rerank probe: is the ordering headroom a PROPAGATION problem?
 *
 * ## The question this answers, and the one it does not
 *
 * §362 scored the Hard bucket and found `ranked` = 1.0000 in every cell: the labelled service is inside every
 * ranking, so all 34.9 pp of headroom is ORDER. It then characterised the misses — 50.0 % of them lead with a
 * graph neighbour of the truth — and stopped, because a characterisation is not a mechanism. This module turns
 * that sentence into a priced arm.
 *
 * It is **not** a re-run of `topoWeight`. That field is an ADDITIVE prior on the engine's own score scale, and it
 * was refused twice for a reason the register names: on TrainTicket the graph builder rank-normalises the anomaly,
 * so an additive term's relative effect is linear in the population (§`docs/closed-axes-register.md`, and the
 * `topoDiscount` docblock in `packages/tree/src/pruning/pruner.ts` records −46.4 pp on RE1-TrainTicket at
 * `topoWeight = 0.1`). This probe's operator is scale-free BY CONSTRUCTION: every score is first mapped into
 * `[0, 1]` within its own case, so the blend is a convex combination of two quantities on one scale and cannot
 * grow with the size of the pool.
 *
 * ## The operator, and why it is this one
 *
 * For a case whose engine ranking is `r₁ … rₙ` with scores `sᵢ`, let `xᵢ = (sᵢ − min s) / (max s − min s)` and let
 * `N(i)` be the case's undirected call-graph neighbours. The arm is
 *
 *     xᵢ′ = (1 − α)·xᵢ + α·mean_{j ∈ N(i)} xⱼ
 *
 * Three choices are load-bearing and each is stated rather than left to a reader:
 *
 * - **`mean`, not `sum`.** The kinetic collision term is a sum over collision partners, so a sum is the naive
 *   transliteration and it is wrong here: it pays a node for its DEGREE. §362 measured in-degree and found it does
 *   not separate the misses (`≥ 3`: 0.571, `< 3`: 0.504), so a degree-paying operator would be fitting a
 *   mechanism the corpus has already refuted. `mean` is the expected value over partners — one collision, not
 *   degree many.
 * - **Undirected, both ways.** §362's 50.0 % statement was measured on undirected adjacency, and this arm has to
 *   be a test of THAT sentence or it is a test of another one. The direction split is reported as a diagnostic and
 *   decides nothing.
 * - **A partner the ranking does not contain contributes nothing** rather than contributing zero. Zero is a
 *   measurement (someone read this service and found it quiet); absence is not, and averaging a measurement with
 *   two absences is how a mean of three becomes a third of a measurement.
 *
 * `α = 0` is the engine, bit for bit — `xᵢ′ = xᵢ` and the ordering is the engine's own, tie-break included — and
 * that identity is asserted by a caller rather than assumed, so a probe that disagreed with the engine at `α = 0`
 * could not report a gain at `α = 0.2` either. `α = 1` is the **neighbour-only baseline**: the own score survives
 * only as the tie-break, which is the strongest possible reading of "the ordering is propagation".
 *
 * ## What the sweep may and may not conclude
 *
 * Six values of `α` are tested, so a nominal 5 % test at the best of them is not a 5 % test. {@link decide} divides
 * the bar by the number of arms it was shown, refuses a cell that moved DOWN even when the total moved up, and
 * names the clause that failed. The sweep is printed in full because the shape is the finding: an interior maximum
 * is a correction, a monotone rise to `α = 1` says the engine's score is not carrying the ordering at all, and a
 * maximum at `α = 0` says the neighbour channel has nothing to add.
 *
 * @module benchmarks/src/neighbour-rerank
 */

import { bestAcceptedRank } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import type { CellScore } from './cloudopsbench-score.js';
import { ALL_SYSTEMS, scoreByCell } from './cloudopsbench-score.js';
import type { CellTruth } from './cloudopsbench-suite.js';

/** One candidate exactly as the engine published it. */
export interface RankedCandidate {
  readonly serviceId: string;
  /** The engine's `finalScore` for this candidate. Negative values are possible: two terms carry a signed weight. */
  readonly score: number;
}

/** A directed call edge, as the graph the engine consumed states it. */
export interface ProbeEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * One case, in the three objects this probe reads and no fourth.
 *
 * The ranking is the engine's own output rather than a re-scored list: a probe that re-derived the score would be
 * a second owner of the formula, and every number it printed would then be a statement about THAT owner.
 */
export interface ProbeCase {
  readonly caseId: string;
  /** The engine's ranking, best first. */
  readonly ranking: readonly RankedCandidate[];
  /** The edges of the call graph the ranking was computed on. */
  readonly edges: readonly ProbeEdge[];
  /** Every accepted answer. A ranking that leads with any of them is a hit. */
  readonly accepted: readonly string[];
}

/**
 * The `α` values the sweep prints.
 *
 * `0` is the engine and `1` is the neighbour-only baseline, so both ends of the axis are arms rather than
 * annotations. The interior points are uneven on purpose: the interesting region for a CORRECTION is below a
 * half, and `0.25`–`0.35` is where a quarter-weight blend would have to earn its place.
 */
export const ALPHA_GRID: readonly number[] = Object.freeze([0, 0.05, 0.1, 0.2, 0.3, 0.5, 1]);

/** The `α` at which the own score survives only as a tie-break. */
export const NEIGHBOUR_ONLY_ALPHA = 1;

/**
 * The mirror grid: the same operator with the sign reversed.
 *
 * Registered as a SEPARATE arm set, and labelled post-hoc in the record, because its direction came from the first
 * sweep's monotone sign rather than from a hypothesis held before it ran. What it tests is a different claim from
 * the first grid — not "propagate the neighbours' loudness" but "a candidate whose neighbours are loud is a symptom
 * rather than a source" — and a channel that is refused in one direction and adopted in the other is a sign, not a
 * weight, and must be reported as such.
 */
export const MIRROR_GRID: readonly number[] = Object.freeze([
  0, -0.05, -0.1, -0.15, -0.2, -0.3, -0.5,
]);

/**
 * Map a case's published scores into `[0, 1]`, monotonically.
 *
 * Min–max rather than a rank transform: a rank transform would throw away every gap the engine measured, and the
 * blend has to be able to inherit the engine's CONFIDENCE as well as its order. A case whose candidates all share
 * one score maps to `0` everywhere, which leaves the neighbour term as the only signal — the honest answer for a
 * case where the engine had no opinion, and the one that makes the ordering fall back to the tie-break.
 *
 * @param ranking - The engine's ranking, best first.
 * @returns Candidate id → unit score, in the same order.
 */
export function unitScores(ranking: readonly RankedCandidate[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (ranking.length === 0) return scores;
  let min = Infinity;
  let max = -Infinity;
  for (const one of ranking) {
    if (one.score < min) min = one.score;
    if (one.score > max) max = one.score;
  }
  const span = max - min;
  for (const one of ranking) scores.set(one.serviceId, span > 0 ? (one.score - min) / span : 0);
  return scores;
}

/**
 * The undirected neighbourhood of every candidate, restricted to candidates the ranking contains.
 *
 * A self-loop is dropped rather than counted: a service that calls itself has one partner and it is itself, and
 * averaging a node with itself would make the blend the identity for that node while looking like a transfer.
 *
 * @param edges - The case's call edges.
 * @param present - The ids the ranking contains; an edge to anything else is not a partner.
 * @returns Candidate id → its partners, deduplicated; a candidate with none maps to an empty list.
 */
export function undirectedNeighbourhood(
  edges: readonly ProbeEdge[],
  present: ReadonlySet<string>,
): Map<string, readonly string[]> {
  const partners = new Map<string, Set<string>>();
  for (const id of present) partners.set(id, new Set());
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    if (!present.has(edge.from) || !present.has(edge.to)) continue;
    partners.get(edge.from)!.add(edge.to);
    partners.get(edge.to)!.add(edge.from);
  }
  const frozen = new Map<string, readonly string[]>();
  for (const [id, set] of partners) frozen.set(id, [...set]);
  return frozen;
}

/**
 * Blend each candidate's own unit score with its partners' mean, at weight `α`.
 *
 * @param ranking - The engine's ranking, best first — the source of the own scores.
 * @param neighbourhood - {@link undirectedNeighbourhood}'s output.
 * @param alpha - The weight on the partners, in `[0, 1]`.
 * @returns Candidate id → blended score.
 */
export function blendedScores(
  ranking: readonly RankedCandidate[],
  neighbourhood: ReadonlyMap<string, readonly string[]>,
  alpha: number,
): Map<string, number> {
  const own = unitScores(ranking);
  const blended = new Map<string, number>();
  for (const one of ranking) {
    const partners = neighbourhood.get(one.serviceId) ?? [];
    const self = own.get(one.serviceId)!;
    if (partners.length === 0) {
      // One partner is no transfer: with nobody to average, `α` has nothing to weight, and returning `self` keeps
      // the node where the engine put it instead of dragging it to the bottom of the scale.
      blended.set(one.serviceId, self);
      continue;
    }
    let sum = 0;
    for (const partner of partners) sum += own.get(partner) ?? 0;
    blended.set(one.serviceId, (1 - alpha) * self + alpha * (sum / partners.length));
  }
  return blended;
}

/**
 * Order candidates by a score, breaking a tie the way the engine did.
 *
 * The tie-break is the engine's own rank and not the id: a comparator that fell back to a string comparison would
 * print a different table on a machine with a different collation, and one that fell back to nothing would make
 * the output depend on the sort implementation. `α = 0` therefore reproduces the engine's order exactly, which is
 * the identity this module's every claim rests on.
 *
 * @param ranking - The engine's ranking, best first — the tie-break order.
 * @param scores - The scores to order by.
 * @returns The candidate ids, best first.
 */
export function orderByScores(
  ranking: readonly RankedCandidate[],
  scores: ReadonlyMap<string, number>,
): readonly string[] {
  const rows = ranking.map((one, index) => ({
    serviceId: one.serviceId,
    score: scores.get(one.serviceId)!,
    index,
  }));
  rows.sort((a, b) => b.score - a.score || a.index - b.index);
  return rows.map((one) => one.serviceId);
}

/**
 * Rerank one case at one `α`.
 *
 * @param one - The case.
 * @param alpha - The weight on the partners.
 * @returns The case's candidates, best first.
 */
export function rerankCase(one: ProbeCase, alpha: number): readonly string[] {
  const present = new Set(one.ranking.map((candidate) => candidate.serviceId));
  const neighbourhood = undirectedNeighbourhood(one.edges, present);
  return orderByScores(one.ranking, blendedScores(one.ranking, neighbourhood, alpha));
}

/**
 * Present one arm's ordering as the record the scorer already reads.
 *
 * The scorer is NOT duplicated here. `scoreByCell` is the single owner of "what a cell's `CA@1` counts", and this
 * function's whole job is to hand it a record whose two load-bearing fields say what this arm did: `correct` is
 * `top1 ∈ accepted`, and `truthRank` is the first accepted answer's rank in THIS ordering.
 *
 * @param one - The case.
 * @param order - The arm's ordering for it.
 * @returns A prediction record.
 */
export function asPrediction(one: ProbeCase, order: readonly string[]): CasePrediction {
  const declared = one.accepted[0];
  if (declared === undefined) {
    throw new Error(
      `${one.caseId}: the case states no accepted answer, so no arm can be scored on it`,
    );
  }
  const top1 = order[0];
  const rank = bestAcceptedRank(
    order.map((serviceId) => ({ serviceId })),
    one.accepted,
  );
  return {
    caseId: one.caseId,
    truth: declared,
    top1,
    correct: top1 !== undefined && one.accepted.includes(top1),
    // `0` from `bestAcceptedRank` is "not ranked", and the scorer distinguishes that from a rank — so the
    // conversion happens here, once, rather than in a consumer that would read `rank <= 3` as false for both.
    truthRank: rank === 0 ? undefined : rank,
    pool: order.length,
  };
}

/** One arm of the sweep: the weight and the cells it scores. */
export interface ArmRow {
  readonly alpha: number;
  readonly cells: readonly CellScore[];
}

/**
 * Score every arm on the same cases.
 *
 * @param cases - The probe population.
 * @param truths - Case id → cell.
 * @param grid - The weights to test; {@link ALPHA_GRID} by default, {@link MIRROR_GRID} for the mirror arm set.
 * @returns One row per weight, in the grid's order.
 */
export function sweep(
  cases: readonly ProbeCase[],
  truths: ReadonlyMap<string, CellTruth>,
  grid: readonly number[] = ALPHA_GRID,
): readonly ArmRow[] {
  return grid.map((alpha) => ({
    alpha,
    cells: scoreByCell(
      cases.map((one) => asPrediction(one, rerankCase(one, alpha))),
      truths,
    ),
  }));
}

/**
 * Exact two-sided McNemar test on one paired comparison.
 *
 * The comparison a benchmark arm makes is paired and binary: a case is gained, lost, or untouched. The test is
 * therefore a sign test on the DISCORDANT pairs, and its exact form is used rather than a χ² approximation because
 * the discordant count here is small enough that the approximation's error is larger than the effect being read.
 *
 * @param low - Discordant pairs in one direction.
 * @param high - Discordant pairs in the other. The test is symmetric in the two.
 * @returns The two-sided p-value: twice the smaller binomial tail, capped at 1.
 */
export function mcnemarExact(low: number, high: number): number {
  const n = low + high;
  if (n === 0) return 1;
  const smaller = Math.min(low, high);
  // `C(n, i)·2^-n` accumulated from `i = 0`, with the binomial coefficient built iteratively so no factorial is
  // ever formed: 170! is the last one a double holds, and a 200-case cell is not far off.
  let coefficient = 1;
  let tail = 0;
  for (let i = 0; i <= smaller; i += 1) {
    if (i > 0) coefficient = (coefficient * (n - i + 1)) / i;
    tail += coefficient * Math.pow(2, -n);
  }
  return Math.min(1, 2 * tail);
}

/**
 * The probability mass function of a sum of independent Bernoulli draws with different probabilities.
 *
 * A count of "how many misses named a neighbour" is a Poisson-binomial variate and not a binomial one, because each
 * miss carries its OWN probability: the truth's share of the graph. The truth in a case with 15 services and 6
 * neighbours has a 6/14 chance of being called by any particular wrong winner, and one in a case with 51 services
 * and 3 has 3/50. Averaging those into a single `p` and calling the result binomial would understate the variance
 * on a population whose degrees differ by a factor of twenty, which is exactly this corpus.
 *
 * @param probabilities - Each draw's own success probability.
 * @returns `pmf[k]` = the probability that exactly `k` draws succeed.
 */
export function poissonBinomialPmf(probabilities: readonly number[]): Float64Array {
  let pmf = new Float64Array(1);
  pmf[0] = 1;
  for (const p of probabilities) {
    const next = new Float64Array(pmf.length + 1);
    for (let k = 0; k < pmf.length; k += 1) {
      const weight = pmf[k]!;
      // The two masses a draw can land on, added into the next row: a `p` of 0 or 1 then moves every mass to one
      // side without needing a special case.
      next[k] = next[k]! + weight * (1 - p);
      next[k + 1] = next[k + 1]! + weight * p;
    }
    pmf = next;
  }
  return pmf;
}

/**
 * One tail of a Poisson-binomial distribution.
 *
 * @param pmf - {@link poissonBinomialPmf}'s output.
 * @param from - The first index to include, inclusive.
 * @returns `P(X ≥ from)`.
 */
export function tailAtLeast(pmf: Float64Array, from: number): number {
  let tail = 0;
  for (let k = Math.max(0, from); k < pmf.length; k += 1) tail += pmf[k]!;
  return Math.min(1, tail);
}

/**
 * The opposite tail.
 *
 * @param pmf - {@link poissonBinomialPmf}'s output.
 * @param to - The last index to include, inclusive.
 * @returns `P(X ≤ to)`.
 */
export function tailAtMost(pmf: Float64Array, to: number): number {
  let tail = 0;
  for (let k = 0; k <= to && k < pmf.length; k += 1) tail += pmf[k]!;
  return Math.min(1, tail);
}

/** The null a neighbour share has to be read against. */
export interface NeighbourNull {
  /** Misses that carry a defined probability — every miss whose truth the graph can reach. */
  readonly misses: number;
  /** Misses whose top-1 is a graph neighbour of the truth. */
  readonly observed: number;
  /**
   * The count a uniformly random wrong winner would produce — `Σ deg(truth) / (n − 1)` over the misses.
   *
   * This is the number §362's "50.0 % of misses are neighbours" did not have. A graph in which the truth is
   * adjacent to a third of the pool produces a neighbour-led miss a third of the time from a ranker that knew
   * nothing, so the share is a finding only to the extent that it exceeds this.
   */
  readonly expected: number;
  /** Two-sided exact Poisson-binomial p-value: twice the smaller tail, capped at 1. */
  readonly p: number;
}

/**
 * Compare the neighbour share of the misses with the share the graph itself produces.
 *
 * @param cases - The probe population.
 * @param base - The engine's per-case verdicts, in the same order.
 * @returns The null reading, or `null` when the two lists are not one population.
 */
export function neighbourNull(
  cases: readonly ProbeCase[],
  base: readonly CasePrediction[],
): NeighbourNull | null {
  if (cases.length !== base.length) return null;
  const probabilities: number[] = [];
  let observed = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const one = cases[i]!;
    if (base[i]!.correct) continue;
    const top1 = one.ranking[0]?.serviceId;
    const truth = one.accepted[0];
    if (top1 === undefined || truth === undefined) continue;
    const present = new Set(one.ranking.map((candidate) => candidate.serviceId));
    const partners = undirectedNeighbourhood(one.edges, present).get(truth) ?? [];
    // A pool of one has no OTHER candidate to be adjacent to, so its probability is zero rather than a division by
    // zero: the case cannot contribute to the null and must not be able to.
    const reachable = present.size > 1 ? partners.length / (present.size - 1) : 0;
    if (partners.includes(top1)) observed += 1;
    probabilities.push(reachable);
  }
  const pmf = poissonBinomialPmf(probabilities);
  const p = Math.min(1, 2 * Math.min(tailAtMost(pmf, observed), tailAtLeast(pmf, observed)));
  let expected = 0;
  for (const one of probabilities) expected += one;
  return { misses: probabilities.length, observed, expected, p };
}

/**
 * The four ways a miss can sit against the truth in the graph.
 *
 * The two directional fields are the mechanism question: an engine that leads with what the truth CALLS is blaming
 * a downstream symptom, and one that leads with what calls it is blaming an upstream consumer. The two have
 * opposite repairs, so a population dominated by one of them wants a signed rule and a population split evenly
 * between them cannot have one — which is the fact that decides whether {@link MIRROR_GRID} could ever ship.
 */
export interface DirectionSplit {
  readonly misses: number;
  /** Top-1 is a CALLEE of the truth: the engine blamed what the truth calls. */
  readonly downstream: number;
  /** Top-1 is a CALLER of the truth: the engine blamed something that calls the truth. */
  readonly upstream: number;
  /** A reciprocal edge, so neither direction explains the miss. */
  readonly both: number;
  /** No edge either way, so the miss is not a neighbour miss at all. */
  readonly neither: number;
}

/**
 * Classify every miss by the direction of its top-1 against the truth.
 *
 * @param cases - The probe population.
 * @param base - The engine's per-case verdicts, in the same order.
 * @returns The four counts; they sum to the misses by construction, and a test asserts it.
 */
export function directionSplit(
  cases: readonly ProbeCase[],
  base: readonly CasePrediction[],
): DirectionSplit {
  if (cases.length !== base.length) {
    throw new Error(`${cases.length} cases against ${base.length} verdicts cannot be joined`);
  }
  let downstream = 0;
  let upstream = 0;
  let both = 0;
  let neither = 0;
  let misses = 0;
  for (let i = 0; i < cases.length; i += 1) {
    const one = cases[i]!;
    if (base[i]!.correct) continue;
    misses += 1;
    const top1 = one.ranking[0]?.serviceId;
    const truth = one.accepted[0];
    if (top1 === undefined || truth === undefined) {
      neither += 1;
      continue;
    }
    let calls = false;
    let called = false;
    for (const edge of one.edges) {
      if (edge.from === truth && edge.to === top1) calls = true;
      if (edge.from === top1 && edge.to === truth) called = true;
    }
    if (calls && called) both += 1;
    else if (calls) downstream += 1;
    else if (called) upstream += 1;
    else neither += 1;
  }
  return { misses, downstream, upstream, both, neither };
}

/**
 * Render the four-way split on one line, with its own identity check beside it.
 *
 * The sum is printed because the four branches are an exhaustive classification: a line whose sum is not the miss
 * count is a line about a different population, and a reader can check that without re-deriving any of the four.
 *
 * @param split - {@link directionSplit}'s output.
 * @returns Text ending in a newline.
 */
export function formatDirectionSplit(split: DirectionSplit): string {
  const sum = split.downstream + split.upstream + split.both + split.neither;
  return `misses ${split.misses}: downstream ${split.downstream}, upstream ${split.upstream}, reciprocal ${split.both}, unrelated ${split.neither} (sum ${sum})\n`;
}

/**
 * What one arm did to the population, as counts rather than rates.
 *
 * No `α` field on purpose: the movement is a property of the PAIR of lists it was computed from, and a record that
 * carried a weight would be a record that could disagree with the row it is printed beside.
 */
export interface Movement {
  /** Cases this arm gets right and the engine does not. */
  readonly gained: number;
  /** Cases the engine gets right and this arm does not. */
  readonly lost: number;
  /** The exact two-sided McNemar p-value over the two discordant counts. */
  readonly p: number;
}

/**
 * Count what one arm gained and lost against the engine, case by case.
 *
 * @param base - The engine's per-case verdicts.
 * @param arm - The arm's, over the same cases in the same order.
 * @returns The movement, or `null` when the two lists are not the same population — a comparison over a
 *   mismatched set would report a movement on a denominator neither list states.
 */
export function movementOf(
  base: readonly CasePrediction[],
  arm: readonly CasePrediction[],
): Movement | null {
  if (base.length !== arm.length) return null;
  let gained = 0;
  let lost = 0;
  for (let i = 0; i < base.length; i += 1) {
    const before = base[i]!;
    const after = arm[i]!;
    if (before.caseId !== after.caseId) return null;
    if (after.correct && !before.correct) gained += 1;
    if (before.correct && !after.correct) lost += 1;
  }
  return { gained, lost, p: mcnemarExact(gained, lost) };
}

/** The verdict on the sweep, with the clause that produced it. */
export interface Verdict {
  /** Whether the best arm cleared every clause. */
  readonly adopted: boolean;
  /** The arm the rule selected, or `null` when the sweep had no interior arm to select. */
  readonly alpha: number | null;
  /** Which clause decided it, in the rule's own words. */
  readonly reason: string;
}

/** The nominal level the rule divides by the number of arms. */
export const NOMINAL_LEVEL = 0.05;

/**
 * The pre-registered decision rule.
 *
 * Four clauses, all of which must hold, and each of them is a way this could have been adopted wrongly:
 *
 * 1. **The total rises.** A best arm that does not beat `α = 0` on the population it was chosen on is noise.
 * 2. **No cell falls.** "No cell and no fault type down" is the standard this record holds every weight to, and a
 *    total that rises while one cell pays is exactly the shape §362's MAD onset had (+0.6 pp overall, +3.4 in the
 *    cell it was built for, −4.8 and −2.1 in the other two) and refused.
 * 3. **The exact paired test clears a Bonferroni bar.** Six arms were tested; the bar is `0.05 / k` for `k` arms,
 *    so the selected arm's p-value is read against a level one sixth of the one a single test would use.
 * 4. **The maximum is interior.** An arm that is best at `α = 1` says the engine's own score is not carrying the
 *    ordering, which is a statement about the formula and not a tuning result — adopting it would be adopting a
 *    different method on the strength of one sweep.
 *
 * The rule is code rather than prose so that the arm this iteration reports and the arm a later iteration would
 * have to beat are the same arm.
 *
 * @param rows - The sweep.
 * @param moves - The movement of each arm against the engine, in the same order.
 * @returns The verdict and the first clause that failed.
 */
export function decide(rows: readonly ArmRow[], moves: readonly Movement[]): Verdict {
  const bar = NOMINAL_LEVEL / Math.max(1, rows.length);
  const overall = (row: ArmRow): number => {
    const all = row.cells.find((one) => one.system === ALL_SYSTEMS && one.category === ALL_SYSTEMS);
    if (all === undefined)
      throw new Error('a sweep row carries no overall cell, so no arm can be ranked');
    return all.top1 / all.cases;
  };
  const base = rows[0];
  if (base === undefined) return { adopted: false, alpha: null, reason: 'the sweep is empty' };

  // Every row's overall rate, read once. Reading it here rather than inside the search makes the missing-cell
  // refusal a property of the SWEEP instead of a property of whether the search happened to look at that row — a
  // one-arm sweep would otherwise accept a row it could not rank.
  const rates = rows.map(overall);
  let best = 0;
  for (let i = 1; i < rows.length; i += 1) {
    // Strictly greater, so a tie keeps the SMALLER α: of two arms that score the same, the one that moves the
    // ordering less is the one that has to be preferred. The comparison is also why "the total does not rise" is
    // not a clause below: `best === 0` is exactly that statement, because the search would have moved otherwise.
    if (rates[i]! > rates[best]!) best = i;
  }
  const chosen = rows[best]!;
  const move = moves[best];

  if (best === 0)
    return { adopted: false, alpha: null, reason: 'no arm beats the engine, so α = 0 stands' };
  if (move === undefined)
    return { adopted: false, alpha: null, reason: 'the best arm has no paired movement' };
  for (let i = 0; i < chosen.cells.length; i += 1) {
    const before = base.cells[i]!;
    const after = chosen.cells[i]!;
    if (after.system !== before.system || after.category !== before.category) {
      throw new Error('two arms were scored over different cells, so no cell can be compared');
    }
    if (after.top1 < before.top1) {
      return {
        adopted: false,
        alpha: chosen.alpha,
        reason: `${before.system}/${before.category} falls by ${before.top1 - after.top1} case(s)`,
      };
    }
  }
  if (best === rows.length - 1) {
    return {
      adopted: false,
      alpha: chosen.alpha,
      reason: `the maximum sits on the grid's last arm (α = ${chosen.alpha}), which is the end of the range tested and not a weight inside it`,
    };
  }
  if (!(move.p < bar)) {
    return {
      adopted: false,
      alpha: chosen.alpha,
      reason: `p = ${move.p.toFixed(4)} does not clear ${bar.toFixed(4)} over ${rows.length} arms`,
    };
  }
  return {
    adopted: true,
    alpha: chosen.alpha,
    reason: `gained ${move.gained}, lost ${move.lost}, p = ${move.p.toFixed(4)} < ${bar.toFixed(4)}`,
  };
}

/**
 * Render the sweep as a fixed-width table, one row per `α` and one column per cell.
 *
 * @param rows - The sweep.
 * @param moves - The movement of each arm against the engine.
 * @returns Text ending in a newline.
 */
export function formatSweep(rows: readonly ArmRow[], moves: readonly Movement[]): string {
  const label = (one: CellScore): string => `${one.system}/${one.category}`;
  const headers = rows[0]?.cells.map(label) ?? [];
  const header = ['alpha', ...headers, 'gained', 'lost', 'p'];
  const body = rows.map((row, index) => {
    const move = moves[index];
    return [
      row.alpha.toFixed(2),
      ...row.cells.map((one) => (one.top1 / one.cases).toFixed(4)),
      String(move?.gained ?? 0),
      String(move?.lost ?? 0),
      (move?.p ?? 1).toFixed(4),
    ];
  });
  const widths = header.map((name, index) =>
    Math.max(name.length, ...body.map((row) => row[index]!.length)),
  );
  const line = (row: readonly string[]): string =>
    row
      .map((cell, index) =>
        index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!),
      )
      .join('  ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...body.map(line)]
    .map((one) => `${one}\n`)
    .join('');
}
