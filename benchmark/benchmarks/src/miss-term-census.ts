/**
 * Which TERM decided each miss — the census that names the 34.9 pp instead of describing it.
 *
 * ## Why this is the successor to the neighbour axis
 *
 * §362 found `ranked` = 1.0000 in every cell: the labelled service is inside every ranking, so the whole headroom on
 * the Hard bucket is ORDER. §363 then priced the two structural explanations that ordering could have had — the
 * call graph (an ablation worth **0 of 156** cases) and neighbour propagation (refused at both signs) — and both came
 * back empty. What is left is the score itself, and the score is a weighted sum of named terms whose rows the engine
 * already publishes. So the next question is not "which channel" but "**which term**", and every result in
 * `rankedTerms` carries rows that sum exactly to its `finalScore`.
 *
 * ## What is counted, and the three readings it separates
 *
 * For each miss, `decompose` names the term whose contribution favoured the winner most over the truth. Counting
 * those names per cell separates three findings that a single "the formula is wrong" sentence would merge:
 *
 * - **`selfAnomalyLog1p` decides.** Every other term is a correction applied to it, so no weight can repair the case;
 *   the work is to the anomaly itself — which metric, over which window, against which baseline.
 * - **a PRIOR decides.** The engine was handed a signal that pointed at the winner, and the sign and size of that
 *   misdirection are in `deltas`. That IS a weight question.
 * - **the truth is absent, or the two scored identically.** A set decision taken before any score, and a tie. Both
 *   are named rather than filed under a term, because a decomposition of a difference that does not exist would be a
 *   list of zeros presented as a measurement.
 *
 * ## What this module deliberately does not do
 *
 * It does not re-derive a score, a rank or a term. `rankedTerms` is the engine's own breakdown in the engine's own
 * order, `truthRank` is the runner's own rank, and the arithmetic is `tableOf` + `decompose` — the two functions
 * `miss-anatomy.ts` already owns. The only new thing here is the COUNT, and a count is where a reading of this kind
 * goes wrong: a case whose truth was never ranked must not be counted as a miss decided by its smallest term.
 *
 * @module benchmarks/src/miss-term-census
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import type { CellTruth } from './cloudopsbench-suite.js';
import { decompose, tableOf } from './miss-anatomy.js';

/** The aggregate row of a cell, filed under this name. */
export const ALL_CELLS = 'all/all';

/** One miss, in the formula's own terms. */
export interface TermMiss {
  readonly caseId: string;
  /** The cell it belongs to, as `<system>/<category>`. */
  readonly cell: string;
  /** The term that favoured the winner most, or `miss-anatomy`'s `truth-not-ranked` / `scored-tie` name. */
  readonly decisiveTerm: string;
  /** That term's `winner − truth`, or `0` when there is no difference to name. */
  readonly decisiveDelta: number;
  /** Where the truth sat, 1-based, or `undefined` when the engine never ranked it. */
  readonly truthRank: number | undefined;
}

/** One term's share of a cell's misses. */
export interface TermShare {
  readonly term: string;
  readonly count: number;
  /** The middle `decisiveDelta` over the misses this term decided; `0` when it decided none. */
  readonly medianDelta: number;
}

/** One cell's census. */
export interface CellTermCensus {
  readonly cell: string;
  readonly cases: number;
  readonly misses: number;
  /** One row per decisive term, ordered by count descending then by name. */
  readonly terms: readonly TermShare[];
}

/**
 * The middle value of a list, with the conventional mean of the two middles for an even count.
 *
 * @param values - The values, in any order.
 * @returns The median, or `0` for an empty list — a cell with no miss has no middle, and `NaN` in a printed table
 *   reads as a measurement that failed rather than as a population that is absent.
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Decompose one case's miss into the term that decided it.
 *
 * @param one - The runner's per-case record.
 * @param cell - The cell the case belongs to.
 * @returns The decomposition, or `null` when the case is a hit — a hit has no gap to decompose, and filing one under
 *   a term would inflate every term's count by the population the engine already gets right.
 */
export function missOf(one: CasePrediction, cell: string): TermMiss | null {
  if (one.correct) return null;
  const ranked = one.rankedTerms;
  const rank = one.truthRank;
  // `rankedTerms` is aligned with the ranking, so a truth at rank `r` carries its rows at `r − 1`. A missing array
  // and an unranked truth are the same statement here: there is no truth side, so the decomposition is the absence.
  const truthTerms: readonly ScoreTerm[] | null =
    rank === undefined || ranked === undefined ? null : (ranked[rank - 1] ?? null);
  const winnerTerms: readonly ScoreTerm[] = ranked?.[0] ?? [];
  const decomposition = decompose(
    truthTerms === null ? null : tableOf(truthTerms),
    tableOf(winnerTerms),
  );
  return {
    caseId: one.caseId,
    cell,
    decisiveTerm: decomposition.decisiveTerm,
    decisiveDelta: decomposition.decisiveDelta,
    truthRank: rank,
  };
}

/**
 * Count the decisive terms, per cell.
 *
 * @param predictions - Every case the runner scored, in case order.
 * @param cells - Case id → cell, built by whoever owns the case → cell mapping.
 * @returns One row per cell in `compareCasePaths` order, then the `all/all` row.
 * @throws When a case has no cell — a mapping that silently skipped one would print a census over a smaller
 *   population than the run, which is the one error a reader of a share cannot detect.
 */
export function censusByCell(
  predictions: readonly CasePrediction[],
  cells: ReadonlyMap<string, CellTruth>,
): readonly CellTermCensus[] {
  const groups = new Map<string, CasePrediction[]>();
  for (const one of predictions) {
    const truth = cells.get(one.caseId);
    if (truth === undefined) {
      throw new Error(
        `${one.caseId}: no cell recorded for this case, so no cell can claim to score it`,
      );
    }
    const key = `${truth.system}/${truth.category}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [one]);
    else bucket.push(one);
  }
  const keys = [...groups.keys()].sort(compareCasePaths);
  const rows = keys.map((key) => summarise(key, groups.get(key)!));
  rows.push(summarise(ALL_CELLS, predictions));
  return rows;
}

/**
 * Build one cell's census from its cases.
 *
 * @param cell - The cell name.
 * @param cases - Its cases.
 * @returns The census.
 */
function summarise(cell: string, cases: readonly CasePrediction[]): CellTermCensus {
  const deltas = new Map<string, number[]>();
  let misses = 0;
  for (const one of cases) {
    const miss = missOf(one, cell);
    if (miss === null) continue;
    misses += 1;
    const bucket = deltas.get(miss.decisiveTerm);
    if (bucket === undefined) deltas.set(miss.decisiveTerm, [miss.decisiveDelta]);
    else bucket.push(miss.decisiveDelta);
  }
  const terms: TermShare[] = [...deltas.entries()].map(([term, values]) => ({
    term,
    count: values.length,
    medianDelta: median(values),
  }));
  // Count descending, then the term's own name in CODE UNITS rather than in a collation: two terms with the same
  // count must print in the same order on every machine, and `localeCompare` answers from ICU.
  terms.sort((a, b) => b.count - a.count || compareCasePaths(a.term, b.term));
  return { cell, cases: cases.length, misses, terms };
}

/**
 * Render the census as a fixed-width table.
 *
 * @param rows - {@link censusByCell}'s output.
 * @returns Text ending in a newline.
 */
export function formatCensus(rows: readonly CellTermCensus[]): string {
  const header = ['cell', 'cases', 'misses', 'decisive term', 'count', 'share', 'median δ'];
  const body: string[][] = [];
  for (const row of rows) {
    if (row.terms.length === 0) {
      body.push([row.cell, String(row.cases), String(row.misses), '(no miss)', '0', 'n/a', 'n/a']);
      continue;
    }
    for (const term of row.terms) {
      body.push([
        row.cell,
        String(row.cases),
        String(row.misses),
        term.term,
        String(term.count),
        (term.count / row.misses).toFixed(4),
        term.medianDelta.toFixed(4),
      ]);
    }
  }
  const widths = header.map((name, index) =>
    Math.max(name.length, ...body.map((row) => row[index]!.length)),
  );
  const line = (row: readonly string[]): string =>
    row
      .map((cell, index) =>
        index < 4 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!),
      )
      .join('  ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...body.map(line)]
    .map((one) => `${one}\n`)
    .join('');
}
