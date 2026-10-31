/**
 * The latent-term census: the weight window each ranking term would need, read off ONE run.
 *
 * ## The question this exists to answer
 *
 * Sixteen terms are assembled into `finalScore`, and fourteen of them ship at weight 0. Each was measured once, on
 * one cell, at a handful of weights, and rejected — and the record of every rejection is a table of accuracies.
 * That is a measurement of the ARM and not of the TERM: it says "at this weight the cell moved like this", which
 * confounds four things the corpus can separate — whether the term pointed the right way on the misses at all, how
 * far it had to move to win one back, how far it could move before a correct case was lost, and whether it had an
 * input. Two years of arms is a slow way to ask which of fourteen is worth a dispatch.
 *
 * A ranking score is affine in every weight it is summed with: `score(w') = score(w) + (w' − w) × slope`. Every
 * term in the breakdown therefore has, per candidate, an exact linear response — the `slope` the ranking now
 * records beside each contribution — and a case is decided by the DIFFERENCE of two such responses. This module
 * differences them:
 *
 * - On a miss, the truth needs `w' > w + gap / (slope_truth − slope_winner)` to be placed above the candidate that
 *   beat it. Finite only when the term reads the truth higher than the winner, which is the term "pointing the
 *   right way" expressed as a number rather than as an opinion.
 * - On a correct case, the runner-up takes the truth's place at `w' > w + margin / (slope_runner − slope_truth)`.
 *   The smallest such bound over the cell is the **cap**: the weight at which this term costs the cell its first
 *   case.
 *
 * The pair is the decision: a term that wins back `k` misses below its cap gains `k` net cases for free, and every
 * term can be compared on that one number. The caps are computed from the cell's own correct cases rather than
 * from a chosen tolerance, which is what makes the reading a measurement of this corpus rather than a convention.
 *
 * ## Why the census is exact and where it stops being exact
 *
 * Exactness comes from the breakdown and not from an assumption about the engine: every entry is `weight × value`,
 * so a weight change moves that entry by `Δw × value` and moves nothing else. The claim therefore holds for the
 * sixteen terms and NOT for an operator that runs between them — the topological deduction rescales the anomaly the
 * base term reads before any term is assembled, so it is not a member of this list and cannot be read through it.
 * A term whose weight also decides which candidates exist (a gate) is affine conditional on the population it
 * admits; the caps are computed on the population the run had, and a weight that changes admission moves every
 * candidate and is out of scope here.
 *
 * ## What it refuses to collapse
 *
 * - A case whose sides carry no terms is `unmeasured`: the subtraction has no meaning, and calling it a gap of
 *   zero would file "the ranking did not run" under "the term did not help".
 * - A correct case with no runner-up recorded is `unguarded` (it appears in records written before `top2Terms`
 *   existed): the cell loses a cap, not an infinity. A census with `guarded=0` therefore reports `inf` caps, which
 *   is a statement about the artifact rather than about the term.
 * - An absent slope is a `0` for the arithmetic and a different fact for the reading: a term with no measurement
 *   cannot be moved by its weight on that candidate, which is exactly what `0` means, and the presence question is
 *   the one `WEIGHT_ZERO` versus `INPUT_*` already answers elsewhere.
 *
 * @module benchmarks/latent-term-census
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** One term's reading over a cell. */
export interface LatentTermReading {
  /** The term's name, as the ranking formula spells it. */
  readonly name: string;
  /** The weight the run carried; the anchor every required weight and cap is expressed against. */
  readonly weight: number;
  /** The first weight at which a GUARDED correct case in this cell loses its place, or `Infinity`. */
  readonly cap: number;
  /** Misses whose required weight is strictly below {@link cap}: the net cases this term wins back for free. */
  readonly flips: number;
  /** The smallest weight that wins any miss back, whatever it costs; `Infinity` when no miss is reachable. */
  readonly minRequired: number;
}

/** The running totals for one cell. */
export interface LatentTermCensus {
  /** Failing cases where both sides carried terms. */
  misses: number;
  /** Correct cases that carry a runner-up breakdown, i.e. the cases a cap is defined on. */
  guarded: number;
  /** Correct cases with no runner-up breakdown. */
  unguarded: number;
  /** Failing cases where a side carried no terms, so no gap exists. */
  unmeasured: number;
  /**
   * Failing cases whose recorded score is already at or above the winner's.
   *
   * A miss is decided on the SERVICE ID, and a tie in score is broken by name; such a case is reachable at the
   * current weight already, so including it would credit a term with a case it did not win. Reported rather than
   * silently dropped, because a non-zero count would mean the ranking and this census disagree about who won.
   */
  tied: number;
  readonly terms: Map<string, { weight: number; cap: number; required: number[] }>;
}

/**
 * How many terms the line prints.
 *
 * Bounded for the reason every census line here is: the head is what decides the next arm and the tail would make
 * the line a table. Sorted by net gain, so the head is the answer.
 */
export const LATENT_TERM_TOP = 5;

/**
 * A census with nothing in it.
 *
 * @returns Zeroed totals, ready for {@link accumulateLatentTermCensus}.
 */
export function createLatentTermCensus(): LatentTermCensus {
  return { misses: 0, guarded: 0, unguarded: 0, unmeasured: 0, tied: 0, terms: new Map() };
}

/** One name's summed factors on one candidate. */
interface Factors {
  /** Summed contribution, which is what the score was built from. */
  contribution: number;
  /** The configured weight; occurrences of one name share it, so the first one read is the term's. */
  weight?: number;
  /** Summed slope, so a name assembled from several entries responds as their sum. */
  slope?: number;
}

/**
 * Fold one candidate's terms into per-name factors.
 *
 * Names are SUMMED rather than overwritten: some families emit one entry per contributing edge, and recording the
 * last would describe a candidate whose score was built from the most evidence as the one with the least. The
 * weight is taken from the first occurrence that carries one, which is exact because a name's occurrences are
 * emitted under one configured weight — the field is per-term, not per-entry.
 *
 * @param terms - One candidate's breakdown.
 * @returns Per-name factors; names with no recorded weight still appear, carrying their contribution.
 */
function factorsOf(terms: readonly ScoreTerm[]): Map<string, Factors> {
  const out = new Map<string, Factors>();
  for (const term of terms) {
    const current = out.get(term.name) ?? { contribution: 0 };
    current.contribution += term.contribution;
    if (term.weight !== undefined && current.weight === undefined) current.weight = term.weight;
    if (term.slope !== undefined) current.slope = (current.slope ?? 0) + term.slope;
    out.set(term.name, current);
  }
  return out;
}

/**
 * Total of a breakdown, which is the score it was built from.
 *
 * @param factors - The per-name factors of one candidate.
 * @returns The sum of the contributions.
 */
function totalOf(factors: ReadonlyMap<string, Factors>): number {
  let total = 0;
  for (const one of factors.values()) total += one.contribution;
  return total;
}

/**
 * The entry for a name, created on first use and anchored to the weight it was read at.
 *
 * @param census - The running totals, mutated in place.
 * @param name - The term's name.
 * @param weight - The weight the run carried for this term.
 * @returns The mutable entry.
 */
function entryFor(
  census: LatentTermCensus,
  name: string,
  weight: number,
): { weight: number; cap: number; required: number[] } {
  let entry = census.terms.get(name);
  if (entry === undefined) {
    entry = { weight, cap: Number.POSITIVE_INFINITY, required: [] };
    census.terms.set(name, entry);
  }
  return entry;
}

/**
 * Fold one case's prediction into the census.
 *
 * @param census - The running totals, mutated in place.
 * @param prediction - The runner's record for one case, carrying all three sides' terms.
 */
export function accumulateLatentTermCensus(
  census: LatentTermCensus,
  prediction: CasePrediction,
): void {
  if (prediction.correct) accumulateGuarded(census, prediction);
  else accumulateMiss(census, prediction);
}

/**
 * A correct case: the truth is the top candidate, and the cap is the first weight at which ANY other candidate
 * takes its place.
 *
 * Against every candidate rather than against the runner-up, because the weight that costs the cell a case is set
 * by whichever rival breaks FIRST and the runner-up is only the one closest at the weight the run happened to
 * carry. Measured: a screen that bounded the cap against the runner-up alone predicted two cases recoverable on
 * RE3-SockShop at `prismWeight = 0.30` and the arm recovered one — the case it lost was broken by a third
 * candidate, and the arithmetic that would have said so was in this field and not in the runner-up's entry.
 *
 * @param census - The running totals.
 * @param prediction - The record, whose `top1Terms` are the truth's own.
 */
function accumulateGuarded(census: LatentTermCensus, prediction: CasePrediction): void {
  const truthSide = prediction.top1Terms;
  const ranked = prediction.rankedTerms;
  if (truthSide === undefined || ranked === undefined || ranked.length < 2) {
    census.unguarded += 1;
    return;
  }
  census.guarded += 1;
  const truth = factorsOf(truthSide);
  const truthTotal = totalOf(truth);
  for (let at = 1; at < ranked.length; at++) {
    const rival = factorsOf(ranked[at]!);
    const margin = truthTotal - totalOf(rival);
    for (const name of new Set([...truth.keys(), ...rival.keys()])) {
      const truthFactor = truth.get(name);
      const rivalFactor = rival.get(name);
      // A term with no recorded weight cannot be moved, and one whose slope is no higher on the rival cannot lift
      // it at any weight — both are skipped rather than recorded as an infinite cap, which would claim the term is
      // safe here when the truth is that it is inert here.
      const weight = truthFactor?.weight ?? rivalFactor?.weight;
      if (weight === undefined) continue;
      const advantage = (rivalFactor?.slope ?? 0) - (truthFactor?.slope ?? 0);
      if (advantage <= 0) continue;
      // `margin` may be negative when the run's own order and its scores disagree by an ulp or by a name tiebreak;
      // the bound is then below the current weight, which is the honest reading: this candidate is already a threat.
      const bound = weight + margin / advantage;
      const entry = entryFor(census, name, weight);
      if (bound < entry.cap) entry.cap = bound;
    }
  }
}

/**
 * A failing case: the weight at which the truth is placed above EVERY candidate that currently outranks it.
 *
 * Above every one, not above the recorded winner, for the reason the cap is taken from every candidate: raising a
 * weight lifts the truth over the first rival and can leave it under a third whose response to the same weight is
 * stronger. The requirement is therefore the MAXIMUM over the rivals of their individual requirements, and a
 * single rival that this term cannot pass at any weight (`slope_truth <= slope_rival`) makes the term unable to
 * win the case at all — which is a different statement from "expensive", and the case is dropped rather than
 * recorded with a large number.
 *
 * Measured against the arm: bounding the requirement by the recorded winner alone predicted two cases recoverable
 * on RE1-OnlineBoutique at `temporalWeight = 0.02` and the arm recovered one.
 *
 * @param census - The running totals.
 * @param prediction - The record, whose `truthEvidence` are the truth's terms and `top1Terms` the winner's.
 */
function accumulateMiss(census: LatentTermCensus, prediction: CasePrediction): void {
  const truthSide = prediction.truthEvidence?.terms;
  const winnerSide = prediction.top1Terms;
  if (truthSide === undefined || winnerSide === undefined) {
    census.unmeasured += 1;
    return;
  }
  census.misses += 1;
  const truth = factorsOf(truthSide);
  const truthTotal = totalOf(truth);
  const ranked = prediction.rankedTerms;
  const truthRank = prediction.truthRank;
  // The rivals above the truth, in rank order. Without the full ranking the recorded winner is the only one
  // available, which is an OPTIMISTIC reading and the reason the field exists; the fallback keeps the census exact
  // in what it does compute rather than absent.
  const rivals =
    ranked === undefined || truthRank === undefined
      ? [winnerSide]
      : ranked.slice(0, Math.max(1, truthRank - 1));
  // Each rival's factors and total are read ONCE: the loop below asks a per-name question of every rival, and a
  // rebuild inside it would be the same work done `names × rivals` times.
  const rivalFactors = rivals.map((side) => factorsOf(side));
  const rivalTotals = rivalFactors.map((one) => totalOf(one));
  if (rivalTotals[0]! - truthTotal <= 0) {
    census.tied += 1;
    return;
  }
  const names = new Set<string>(truth.keys());
  for (const rival of rivalFactors) for (const name of rival.keys()) names.add(name);
  for (const name of names) {
    const truthFactor = truth.get(name);
    const slopeTruth = truthFactor?.slope ?? 0;
    let weight: number | undefined = truthFactor?.weight;
    let required = Number.NEGATIVE_INFINITY;
    let blocked = false;
    for (let at = 0; at < rivalFactors.length; at++) {
      const rivalFactor = rivalFactors[at]!.get(name);
      weight ??= rivalFactor?.weight;
      // The truth's advantage over this rival: positive means a rising weight lifts the truth past it.
      const advantage = slopeTruth - (rivalFactor?.slope ?? 0);
      if (advantage <= 0) {
        blocked = true;
        break;
      }
      const need = (rivalTotals[at]! - truthTotal) / advantage;
      if (need > required) required = need;
    }
    if (blocked || weight === undefined) continue;
    entryFor(census, name, weight).required.push(weight + required);
  }
}

/**
 * The census as a line, or `undefined` when it has no failing case to speak about.
 *
 * @param census - The running totals.
 */
export function formatLatentTermLine(census: LatentTermCensus): string | undefined {
  if (census.misses === 0 && census.unmeasured === 0) return undefined;
  const readings: LatentTermReading[] = [...census.terms.entries()]
    .map(([name, entry]) => ({
      name,
      weight: entry.weight,
      cap: entry.cap,
      minRequired:
        entry.required.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...entry.required),
      flips: entry.required.filter((required) => required < entry.cap).length,
    }))
    .filter((one) => Number.isFinite(one.minRequired))
    .sort(
      (a, b) => b.flips - a.flips || a.minRequired - b.minRequired || (a.name < b.name ? -1 : 1),
    )
    .slice(0, LATENT_TERM_TOP);
  const counts = [`misses=${census.misses} guarded=${census.guarded}`];
  if (census.unguarded > 0) counts.push(`unguarded=${census.unguarded}`);
  if (census.unmeasured > 0) counts.push(`unmeasured=${census.unmeasured}`);
  if (census.tied > 0) counts.push(`tied=${census.tied}`);
  return `[latent] ${counts.join(' ')} | win: ${list(readings)}`;
}

/**
 * Render one reading as `name=flips(cap,min)`.
 *
 * `cap` is the weight at which the cell loses its first correct case and `min` the smallest weight that wins a miss
 * back, both in the term's own weight units — so a reader can see whether the term's window is empty (`min >= cap`,
 * i.e. `flips === 0`) without re-deriving anything.
 *
 * @param readings - The already-ranked slice.
 */
function list(readings: readonly LatentTermReading[]): string {
  if (readings.length === 0) return 'none';
  return readings
    .map(
      (r) =>
        `${r.name}=${r.flips}(${Number.isFinite(r.cap) ? r.cap.toFixed(3) : 'inf'},${r.minRequired.toFixed(3)})`,
    )
    .join(' ');
}
