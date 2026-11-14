/**
 * The resolution floor of a ranking term: the smallest weight at which it can change any answer.
 *
 * ## The question this answers, and why the answer is a floor rather than a gain
 *
 * Every negative result in this project's weight register has the same shape — "closed at every weight swept" —
 * and that sentence has an implicit lower bound: the smallest non-zero point of the grid. Between zero and that
 * point the term was never asked about, and a reader has no way to tell whether the interval is empty or merely
 * unvisited. It matters, because the terms that carry weight 0 in the shipped formula are the ones a revival
 * would move, and their revival weights are small: a term whose slope is `0.5` pays `0.005` at a weight of
 * `0.01`, which is the same order as several of the gaps this corpus actually decides on.
 *
 * The floor is computed rather than swept. For one missed case, the leader scores `gap` above the best accepted
 * candidate, and raising the term's weight by `δ` moves both by `δ × slope`, so the truth catches the leader at
 * `δ = gap / Δslope` — provided the term pays the truth MORE (`Δslope > 0`). The floor is the minimum of that
 * ratio over the corpus, and it needs no engine: the dump already carries every candidate's slope on every term.
 *
 * ## What a floor does and does not claim
 *
 * Below a term's floor the term is **provably gain-free**: no case on the corpus can be recovered at any weight in
 * `(0, floor]`, which is a statement about the interval rather than about the sampled points. That is what
 * entitles a sweep to be called complete — the interval below the floor is not "unswept", it cannot contain a gain.
 *
 * It does NOT make the interval empty. A term below its floor still moves scores, and a case the run answers can
 * be pushed DOWN by the same slope that would have lifted a miss: `prism` at `0.01` on RCAEval RE1 recovers
 * nothing (its floor there is `7.2e-2`) and costs two cases. So the floor bounds what a term can PAY, never what
 * it can COST, and a reading that treated the two as one would describe a weight as safe because it is small.
 *
 * Above the floor the response is whatever the sweep measures, and this module reports the headroom
 * ({@link ResolutionReading.curve}) so a gain can be read against the ceiling it came out of: a term that reaches
 * 3 cases can never gain 4.
 *
 * ## Why the tie is not a recovery
 *
 * At exactly `gap / Δslope` the two candidates are level, and the engine's sort keeps the original order for a
 * tie, so the leader stays first. The comparison is therefore strict. A reader that used `>=` would put every
 * floor one tick low and then report a recovery the engine never produced.
 */

import type { PreparedCorpus } from './term-weight-screen.js';
import { prepareCases } from './term-weight-screen.js';
import type { ParsedTermCase } from './terms-dump.js';

/**
 * The weights the CLI reads by default.
 *
 * Log-spaced from `1e-4`, which is below every floor measured on this project's corpora (the smallest is
 * `3.0e-3`), to `2`, which is above the heaviest shipped weight. The grid is a default rather than a claim: its
 * only job is to include the interval below the floors, so a reader who runs the tool without arguments still
 * sees where the response begins.
 */
export const DEFAULT_RESOLUTION_WEIGHTS: readonly number[] = [
  1e-4, 3e-4, 1e-3, 3e-3, 0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 0.5, 1, 2,
];

/** One sampled weight and how many missed cases the term can recover at it. */
export interface ResolutionPoint {
  /** The weight ADDED to the term's shipped value. */
  readonly weight: number;
  /** Missed cases whose Top@1 this term would overtake at that weight. */
  readonly reachable: number;
}

/** One term's floor and its headroom curve. */
export interface ResolutionReading {
  /** The term, by the name the dump records. */
  readonly term: string;
  /**
   * The smallest added weight at which the term can recover any missed case, or `null` when it cannot at any
   * weight — either because it pays every truth no more than its leader, or because no case carries it.
   */
  readonly floor: number | null;
  /** The case that sets the floor, so the number is checkable against one row of the dump. */
  readonly at: string | null;
  /** The headroom curve, in the order the weights were given. */
  readonly curve: readonly ResolutionPoint[];
}

/** What the formatter needs that no reading carries. */
export interface ResolutionRequest {
  /** The denominator: cases the screen could score. */
  readonly cases: number;
  /** Cases refused because their triples do not rebuild their own score. */
  readonly refused: number;
  /** `Top@1` at the shipped weights, which is what the reach is headroom OF. */
  readonly baseline: number;
  /** The weights the dump was produced under, for the header. */
  readonly shipped?: readonly { readonly name: string; readonly weight: number }[];
}

/** One case that could be recovered, reduced to the two numbers that decide its weight. */
interface Candidate {
  readonly datapack: string;
  /** `score(leader) − score(best accepted)`, which is what the term has to close. */
  readonly gap: number;
  /** `slope(term, best accepted) − slope(term, leader)`, which is what it pays. */
  readonly spread: number;
}

/**
 * The cases a positive weight can reach, with the ratio that decides each one.
 *
 * A case is skipped when the run already answers it (there is nothing to recover), when it declares no accepted
 * candidate (nothing to recover TO), or when the term pays the leader at least as much as the truth (no positive
 * weight closes a deficit that grows with the weight).
 *
 * @param corpus - The prepared dump.
 * @param term - The term's name.
 * @returns One entry per reachable case, in the dump's order.
 */
function reachableCases(corpus: PreparedCorpus, term: string): Candidate[] {
  const out: Candidate[] = [];
  for (const kase of corpus.cases) {
    if (kase.candidates.length === 0) continue;
    let leader = kase.candidates[0]!;
    for (const candidate of kase.candidates) if (candidate.base > leader.base) leader = candidate;
    if (kase.accepted.has(leader.id)) continue;
    let truth: (typeof kase.candidates)[number] | undefined;
    for (const candidate of kase.candidates) {
      if (!kase.accepted.has(candidate.id)) continue;
      if (truth === undefined || candidate.base > truth.base) truth = candidate;
    }
    if (truth === undefined) continue;
    // A candidate that never carried the term has slope 0 on it, which is a reading and not a missing value:
    // the formula built no term for it, so the sum contains nothing from it.
    const spread = (truth.terms.get(term)?.slope ?? 0) - (leader.terms.get(term)?.slope ?? 0);
    if (spread <= 0) continue;
    out.push({ datapack: kase.datapack, gap: leader.base - truth.base, spread });
  }
  return out;
}

/**
 * Measure one term's resolution floor and headroom.
 *
 * @param cases - The dump's cases.
 * @param term - The term's name.
 * @param weights - The added weights to sample. Must be positive, finite and strictly ascending; a descending
 * list is refused rather than sorted, because the caller asked a question about an order and silently reordering
 * it would answer a different one.
 * @returns The floor, the case that sets it, and the reach at each weight.
 */
export function resolutionOf(
  cases: readonly ParsedTermCase[],
  term: string,
  weights: readonly number[],
): ResolutionReading {
  return resolutionPrepared(prepareCases(cases), term, weights);
}

/**
 * {@link resolutionOf} over an already-prepared dump.
 *
 * Split out so a caller measuring nineteen terms reconstructs the corpus once: `prepareCases` rebuilds every
 * candidate from its triples, and doing that once per term would be nineteen times the work for one answer.
 *
 * @param corpus - The prepared dump.
 * @param term - The term's name.
 * @param weights - The added weights to sample.
 * @returns The reading.
 */
export function resolutionPrepared(
  corpus: PreparedCorpus,
  term: string,
  weights: readonly number[],
): ResolutionReading {
  if (term === '') throw new Error('a term is required');
  if (weights.length === 0) throw new Error('at least one weight is required');
  for (const weight of weights) {
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new Error(`every weight must be a positive finite number, got ${String(weight)}`);
    }
  }
  for (let index = 1; index < weights.length; index += 1) {
    if (weights[index]! <= weights[index - 1]!) {
      throw new Error('the weights must strictly ascend');
    }
  }

  const reachable = reachableCases(corpus, term);
  let floor: number | null = null;
  let at: string | null = null;
  for (const candidate of reachable) {
    const weight = candidate.gap / candidate.spread;
    // A tie on the floor is broken by case id rather than by dump order: two runs of the same corpus enumerate
    // in the same order, but a regenerated dump need not, and a named case that moves between runs is a number
    // a reader cannot check.
    if (
      floor === null ||
      weight < floor ||
      (weight === floor && at !== null && candidate.datapack < at)
    ) {
      floor = weight;
      at = candidate.datapack;
    }
  }

  const curve = weights.map((weight) => ({
    weight,
    reachable: reachable.filter((candidate) => weight * candidate.spread > candidate.gap).length,
  }));
  return { term, floor, at, curve };
}

/**
 * Measure every named term over one dump.
 *
 * @param cases - The dump's cases.
 * @param terms - The terms to measure, in the order the report should print them.
 * @param weights - The added weights to sample, applied to every term.
 * @returns One reading per term, in the order asked.
 */
export function resolutionTable(
  cases: readonly ParsedTermCase[],
  terms: readonly string[],
  weights: readonly number[],
): ResolutionReading[] {
  return resolutionTablePrepared(prepareCases(cases), terms, weights);
}

/**
 * {@link resolutionTable} over an already-prepared dump.
 *
 * @param corpus - The prepared dump.
 * @param terms - The terms to measure.
 * @param weights - The added weights to sample.
 * @returns One reading per term, in the order asked.
 */
export function resolutionTablePrepared(
  corpus: PreparedCorpus,
  terms: readonly string[],
  weights: readonly number[],
): ResolutionReading[] {
  return terms.map((term) => resolutionPrepared(corpus, term, weights));
}

/** Every term name the dump records, in first-appearance order. */
export function termsOf(cases: readonly ParsedTermCase[]): string[] {
  const seen = new Set<string>();
  for (const kase of cases) {
    for (const candidate of kase.candidates) {
      for (const [name] of candidate.terms) seen.add(name);
    }
  }
  return [...seen];
}

/** A rate, or a dash when the denominator is zero — `0/0` is NaN and a NaN is a number a reader would read. */
function rate(numerator: number, denominator: number): string {
  return denominator === 0 ? '-' : `${((100 * numerator) / denominator).toFixed(2)}%`;
}

/**
 * Render the floors.
 *
 * The population and the baseline come first for the same reason they do in the landscape report: a ceiling over
 * a denominator nobody wrote down is a number without a subject.
 *
 * @param readings - The readings, in the order to print.
 * @param request - The population, the baseline and the shipped weights.
 * @returns The table, newline-separated, no trailing newline.
 */
export function formatResolutionReport(
  readings: readonly ResolutionReading[],
  request: ResolutionRequest,
): string {
  const lines: string[] = [];
  lines.push(
    'The weight resolution floor — the smallest weight at which a term can change an answer',
  );
  lines.push('='.repeat(78));
  lines.push(
    `  population: ${request.cases} cases scored, ${request.refused} refused (their triples do not rebuild their own score)`,
  );
  if (request.shipped !== undefined && request.shipped.length > 0) {
    lines.push(
      `  shipped:    ${request.shipped.map((move) => `${move.name} ${move.weight}`).join(', ')}`,
    );
  }
  lines.push(
    `  baseline:   ${request.baseline} / ${request.cases} = ${rate(request.baseline, request.cases)}`,
  );
  lines.push(
    '  reading:    the floor is an ADDED weight; below it the term cannot recover a missed case — and can still cost one',
  );
  lines.push('');
  const top =
    readings.length === 0 ? 0 : Math.max(...readings[0]!.curve.map((point) => point.weight));
  lines.push(
    `  ${'term'.padEnd(20)}${'floor'.padStart(11)}  ${'set by'.padEnd(40)}${`ceiling@${top}`.padStart(10)}`,
  );
  for (const reading of readings) {
    // Both `!` are construction invariants rather than assumptions: `resolutionOf` refuses an empty weight list, so
    // every reading carries at least one point, and it sets `at` in the same branch that sets `floor`. A fallback
    // here would be a branch no corpus can reach, which is the shape this project deletes rather than covers.
    const last = reading.curve[reading.curve.length - 1]!;
    const floor = reading.floor === null ? '-' : reading.floor.toExponential(2);
    lines.push(
      `  ${reading.term.padEnd(20)}${floor.padStart(11)}  ` +
        `${(reading.at === null ? '' : reading.at).padEnd(40)}${String(last.reachable).padStart(10)}`,
    );
  }
  lines.push('');
  lines.push(
    "  note: '-' means the term cannot recover a missed case at any weight — it pays every truth no",
  );
  lines.push(
    '        more than the leader it would have to overtake, or no case in the dump carries it. A floor',
  );
  lines.push(
    '        bounds what a term can PAY, not what it can COST: below it the term still moves scores.',
  );
  const ceilings = readings
    .map((reading) => ({
      term: reading.term,
      reach: reading.curve[reading.curve.length - 1]!.reachable,
    }))
    .filter((entry) => entry.reach > 0)
    .sort((left, right) => right.reach - left.reach);
  lines.push(
    ceilings.length === 0
      ? '  ceiling: no term can recover a case at any sampled weight'
      : `  ceiling: ${ceilings
          .map((entry) => `${entry.term} ${entry.reach}`)
          .join(', ')} — a gain on a term can never exceed its reach`,
  );
  return lines.join('\n');
}

/** What the CLI was asked for. */
export interface ResolutionArgs {
  /** Path to the terms dump. */
  readonly terms: string;
  /** The terms to measure; `undefined` means every term the dump records. */
  readonly names?: string[];
  /** The added weights to sample. */
  readonly weights: readonly number[];
}

/**
 * Parse the CLI's argv.
 *
 * `--names` defaults to every term the dump records rather than to a literal list, because a list in two places
 * is a list that falls behind the formula: the dump is the only thing that knows which terms exist.
 *
 * @param argv - The arguments after the script name.
 * @returns The request.
 */
export function parseResolutionArgs(argv: readonly string[]): ResolutionArgs {
  let terms: string | undefined;
  let names: string[] | undefined;
  let weights: readonly number[] = DEFAULT_RESOLUTION_WEIGHTS;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--terms') {
      if (value === undefined) throw new Error('--terms needs a path');
      terms = value;
      index += 1;
    } else if (flag === '--names') {
      if (value === undefined) throw new Error('--names needs a comma-separated list');
      names = value
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '');
      index += 1;
    } else if (flag === '--weights') {
      if (value === undefined) throw new Error('--weights needs a comma-separated list');
      weights = value.split(',').map((raw) => {
        const parsed = Number(raw.trim());
        if (!Number.isFinite(parsed))
          throw new Error(`a weight must be a finite number, got "${raw.trim()}"`);
        return parsed;
      });
      index += 1;
    } else {
      throw new Error(`unknown argument "${String(flag)}"`);
    }
  }
  if (terms === undefined) throw new Error('--terms is required');
  return names === undefined ? { terms, weights } : { terms, names, weights };
}
