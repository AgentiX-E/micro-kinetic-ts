/**
 * The residual spent as a TERM rather than as a licence on the pair.
 *
 * ## The failure this exists to answer
 *
 * `docs/containment-order.md` §15.9 read the residual used as a REQUIREMENT (`ρ > 0` in place of the
 * failed-interface record) at `+27 / −3` and refused it: all three losses were one edge, `ts-preserve-service`
 * → `ts-security-service`, in three cases whose fused answer was already correct. The mechanism is not a
 * statistical accident — **the callee is the victim, and a victim moves more than its root** — so no threshold
 * on ρ can save a step, because a step spends the same amount whether the fusion led by 0.01 or by 4.
 *
 * A term spends an amount proportional to what the residual can pay, and the amount is bounded:
 *
 * ```
 * pair (u above, v below), both measured, x_v > x_u + margin
 * a       = (x_v − x_u) / (x_v + x_u)        ∈ (0, 1]
 * term(v) += λ · φ(edge) · a                  ≤ λ
 * ```
 *
 * ## Why φ and not ρ
 *
 * The residual module recorded ρ's ceiling before any gate existed: with `p = q = 1` the joint is forced and
 * **ρ = 0 however perfectly the two services move together**, while `p = q = 0.5` reads 0.25 for the same
 * coupling. As a threshold that costs one refusal. As a **weight** it zeroes the most propagation-like edge in
 * the corpus and pays the most to an edge that co-moved half the time — which is a weight with the wrong sign in
 * the wrong place. φ is the same covariance over `√(p(1−p)·q(1−q))`, so one λ means one thing on every edge.
 * ρ stays the statistic of record for the gate: a hypothesis is judged by the number it fixed.
 *
 * ## What the term deliberately does not do
 *
 * - **It does not demote the caller.** The mechanism's claim is one-directional — the callee's movement is the
 *   source — and punishing the caller is a second claim whose counter-example is exactly the three losses.
 *   Single-sided is also what makes the bound `≤ λ` true, which is the property the pre-registration's
 *   "cannot reproduce the three losses" reduces to.
 * - **It does not spend a negative φ.** An anti-correlated edge is evidence that the pair is not propagating,
 *   and turning that into a demotion would be a signed push — a different mechanism, unmeasured here. The
 *   transfer is still REPORTED with `delta = 0`, so a census can tell "the corpus fitted φ ≤ 0 on this edge"
 *   from "nobody fitted this edge", which is the distinction the gate keeps as `prior-below` vs `prior-absent`.
 * - **It does not touch a candidate outside the chain.** Only pairs the sweep examined qualify, so a candidate
 *   below the published depth never receives one. That is a property of the population, not a finding.
 *
 * @module benchmarks/containment-term
 */

import { edgeKeyOf, residuals, type EdgeCounts } from './containment-residual.js';
import type { ContainmentCaseRow } from './containment-rows.js';

/**
 * One adjacent pair as the dump records it: the caller above, the callee below.
 *
 * Structural rather than the dump's `ContainmentPairRow`, because the term reads exactly four fields of it and
 * a narrower input is a narrower thing to get wrong. A pair whose side the profile could not measure is passed
 * with that side absent, never zeroed.
 */
export interface TermPair {
  /** The candidate that sat higher: the CALLER, since the sweep only examines pairs the call graph joins. */
  readonly upper: string;
  /** The candidate that sat lower: the CALLEE. */
  readonly lower: string;
  /** The upper candidate's excursion in band widths, when the profile could measure it. */
  readonly upperExcursion?: number | undefined;
  /** The lower candidate's excursion in band widths, when the profile could measure it. */
  readonly lowerExcursion?: number | undefined;
}

/** What the term paid to one callee. */
export interface TermTransfer {
  /** The caller, i.e. the candidate the callee is being promoted over. */
  readonly caller: string;
  /** The callee receiving the bonus. */
  readonly callee: string;
  /** The edge's fitted φ. */
  readonly phi: number;
  /** `(x_callee − x_caller) / (x_callee + x_caller)`. Always in `(0, 1]` when a transfer exists. */
  readonly asymmetry: number;
  /** `λ · max(0, φ) · a`, the score points added to the callee. */
  readonly delta: number;
}

/** What {@link termTransfers} needs. */
export interface TermInput {
  /** The pairs the sweep examined, in sweep order. */
  readonly pairs: readonly TermPair[];
  /** Fitted φ per edge, keyed by {@link edgeKeyOf}. An edge absent from this map was never fitted. */
  readonly phi: ReadonlyMap<string, number>;
  /** The score points a fully coupled edge pays at full asymmetry. */
  readonly lambda: number;
  /** The sweep's margin, in band widths. */
  readonly margin: number;
}

/**
 * How much further out the callee moved, on a scale where 1 is "the caller did not move at all".
 *
 * @param upperExcursion - The caller's excursion, or `undefined` when unmeasured.
 * @param lowerExcursion - The callee's excursion, or `undefined` when unmeasured.
 * @returns The asymmetry in `[−1, 1]`, or `null` when the two cannot carry a denominator.
 */
export function asymmetryOf(
  upperExcursion: number | undefined,
  lowerExcursion: number | undefined,
): number | null {
  if (upperExcursion === undefined || lowerExcursion === undefined) return null;
  // Both in band is `0 / 0`. The pair cannot qualify anyway, but a NaN here would reach a bonus and turn a
  // no-op into a sorting accident, so the absence is spelled.
  const total = upperExcursion + lowerExcursion;
  if (!(total > 0)) return null;
  return (lowerExcursion - upperExcursion) / total;
}

/**
 * Price every pair the term can speak about.
 *
 * Three outcomes, and they are three because they mean different things to a reader of the census:
 * a pair the predicate refuses pays nothing and is not reported; a pair whose edge nobody fitted pays nothing
 * and is not reported (there is no number to report); a pair whose edge was fitted is reported with the delta it
 * paid — **including a delta of zero**, which is the corpus saying the edge is not coupled rather than saying
 * nothing about it.
 *
 * @param input - The examined pairs, the fitted φ map, λ and the margin.
 * @returns One transfer per fitted, qualifying pair, in the order the pairs were examined.
 */
export function termTransfers(input: TermInput): TermTransfer[] {
  const transfers: TermTransfer[] = [];
  for (const pair of input.pairs) {
    const asymmetry = asymmetryOf(pair.upperExcursion, pair.lowerExcursion);
    // `asymmetry === null` covers an unmeasured side and the 0/0 case; `≤ 0` covers a callee that did not
    // outrun its caller. Both are refusals by measurement, and neither is a candidate for the term.
    if (asymmetry === null || !(asymmetry > 0)) continue;
    const upper = pair.upperExcursion!;
    const lower = pair.lowerExcursion!;
    if (!(lower > upper + input.margin)) continue;
    const phi = input.phi.get(edgeKeyOf(pair.upper, pair.lower));
    if (phi === undefined) continue;
    // Clamped at zero rather than passed through: see the module docblock. A negative δ would demote the callee,
    // which is a signed push this arm does not claim.
    const delta = Math.max(0, input.lambda * phi * asymmetry);
    transfers.push({ caller: pair.upper, callee: pair.lower, phi, asymmetry, delta });
  }
  return transfers;
}

/**
 * Fit φ per edge from one half's counts.
 *
 * A thin edge and a degenerate one (a marginal at 0 or 1) both produce no entry rather than an entry of 0: the
 * residual module already refuses to define φ there, and a weight of zero would be a statement the corpus did
 * not make. The term then pays nothing on those edges and the census counts them as unfitted.
 *
 * @param counts - One entry per edge, from `edgeCounts`.
 * @returns φ per edge key, for the edges that have one.
 */
export function phiByEdge(counts: ReadonlyMap<string, EdgeCounts>): Map<string, number> {
  const phi = new Map<string, number>();
  for (const entry of residuals(counts)) {
    if (entry.phi === null) continue;
    phi.set(edgeKeyOf(entry.a, entry.b), entry.phi);
  }
  return phi;
}

/**
 * The pairs the term pays on: the FUSION order's own adjacencies that carry a call edge.
 *
 * Read from the fusion order rather than from a sweep's trace, and that is the point: a term is not a step, so
 * it must not depend on a walk an arm took. The fusion order is a pure input of the case, so a candidate's bonus
 * is a function of the case and of the fitted φ map alone — which is the property that lets the same φ be paid
 * by two arms and the arms compared.
 *
 * The consequence is worth naming: this population is the fusion's adjacency, while §15.9's φ was fitted on the
 * UNGATED sweep's adjacency. The two coincide on every case the ungated sweep did not invert, which is all but
 * the 52 cases §15.9 counts as moved; the study reports the divergence rather than assuming it away.
 *
 * @param row - The case's dump row.
 * @returns One pair per adjacent position carrying an edge, in order. Empty when the row has no chain.
 */
export function fusionPairs(row: ContainmentCaseRow): TermPair[] {
  const chain = row.chain;
  if (chain === undefined) return [];
  const calls = new Set<string>();
  for (const [from, to] of chain.edges) calls.add(`${from}\u0000${to}`);
  const pairs: TermPair[] = [];
  for (let i = 0; i + 1 < chain.order.length; i++) {
    const upper = chain.order[i]!;
    const lower = chain.order[i + 1]!;
    if (!calls.has(`${upper}\u0000${lower}`)) continue;
    const upperExcursion = chain.excursions[upper];
    const lowerExcursion = chain.excursions[lower];
    pairs.push({
      upper,
      lower,
      ...(upperExcursion === undefined ? {} : { upperExcursion }),
      ...(lowerExcursion === undefined ? {} : { lowerExcursion }),
    });
  }
  return pairs;
}

/** What {@link gradeByTerm} needs. */ export interface GradeInput {
  /** The fusion order, best first — the order the terms refine and the tie-break they fall back to. */
  readonly order: readonly string[];
  /** The score the fusion gave each candidate. */
  readonly scores: ReadonlyMap<string, number>;
  /** The transfers, from {@link termTransfers}. */
  readonly transfers: readonly TermTransfer[];
}

/**
 * The order the fusion and the term produce together.
 *
 * `score + Σδ` descending, ties broken by the fusion's own order — a tie is not a decision, and a sort that
 * broke it on the service name would let the alphabet rank a case.
 *
 * @param input - The fusion order, the scores, and the transfers.
 * @returns The graded order, or `null` when a candidate has no finite score.
 */
export function gradeByTerm(input: GradeInput): readonly string[] | null {
  const bonus = new Map<string, number>();
  for (const transfer of input.transfers) {
    bonus.set(transfer.callee, (bonus.get(transfer.callee) ?? 0) + transfer.delta);
  }
  const scored: { service: string; value: number; index: number }[] = [];
  for (const [index, service] of input.order.entries()) {
    const score = input.scores.get(service);
    // A candidate the engine could not score has no place in a sort BY SCORE, and putting it anywhere would be
    // inventing one. The whole case is refused instead, and the caller counts the refusal.
    if (score === undefined || !Number.isFinite(score)) return null;
    scored.push({ service, value: score + (bonus.get(service) ?? 0), index });
  }
  scored.sort((left, right) => right.value - left.value || left.index - right.index);
  return scored.map((entry) => entry.service);
}
