/**
 * Cloud-OpsBench cells, scored from the runner's own per-case verdicts.
 *
 * ## Why this is a separate module from the adapter
 *
 * Cloud-OpsBench publishes a **component accuracy** (`CA`) per system and a **joint** score (`JRA`) that also
 * requires the evidence the answer implied. This engine can be scored on the first and not the second
 * (`docs/closed-axes-register.md` §361: 0 of 754 cases have every milestone inside a metric/log/edge surface), so
 * the only honest cell is `CA`. Writing that cell means counting verdicts, and counting is exactly where a
 * benchmark reading goes wrong silently:
 *
 * - `correct` is read from the runner's verdict rather than recomputed as `top1 === truth`, so this table and the
 *   runner's `avgTop1` cannot become two readings of one run;
 * - `truthRank` is read as the rank it is, and a truth the engine never ranked stays OUT of the `Top@k` numerator
 *   instead of being credited as "rank 0 ≤ k";
 * - a case id the cell map does not know THROWS. A mapping that silently skipped an unmapped case would print a
 *   cell over a smaller denominator than the suite it claims to score, which is the one error a reader of a rate
 *   cannot detect.
 *
 * ## What `CA` is, and what it is not
 *
 * `CA` is the fraction of cases whose first-ranked entity is the labelled one. It is NOT the corpus's `JRA`,
 * which multiplies that by evidence closure; a reader comparing the two columns must not take them for two values
 * of one quantity. {@link CellScore.jointComparable} exists to make that explicit in the artifact.
 *
 * @module benchmarks/src/cloudopsbench-score
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

import type { CellTruth } from './cloudopsbench-suite.js';

/** One cell's verdict counts. Every field is a COUNT; a rate is derived at print time. */
export interface CellScore {
  readonly system: string;
  readonly category: string;
  /** Cases in the cell. */
  readonly cases: number;
  /** Cases whose first-ranked entity is the labelled one — the corpus's `CA`. */
  readonly top1: number;
  /** Cases whose labelled entity appears in the first three. */
  readonly top3: number;
  /** Cases whose labelled entity appears in the first five. */
  readonly top5: number;
  /**
   * Cases whose labelled entity appears in the ranking at ALL.
   *
   * Separated from `top5` because the two answer different questions: a truth at rank 40 is a RERANKING problem
   * and one absent from the ranking is a RETRIEVAL problem, and a cell where `ranked` exceeds `top5` by a wide
   * margin is telling a reader the candidate set is right and the scoring is not.
   */
  readonly ranked: number;
  /**
   * Whether this cell's numerator can be compared with the corpus's own published `CA`.
   *
   * Always `true` for this module, and stated rather than assumed: the comparison is `CA` to `CA`, never `CA` to
   * the corpus's joint `JRA`.
   */
  readonly jointComparable: false;
}

/** The aggregate row, filed under this system name. */
export const ALL_SYSTEMS = 'all';

/**
 * Count one cell's verdicts.
 *
 * @param system - The cell's system slug.
 * @param category - The cell's category slug.
 * @param predictions - The cell's per-case records, in case order.
 * @returns The cell's counts.
 */
function countCell(
  system: string,
  category: string,
  predictions: readonly CasePrediction[],
): CellScore {
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  let ranked = 0;
  for (const one of predictions) {
    if (one.correct) top1 += 1;
    const rank = one.truthRank;
    // `undefined` means the truth is not in the ranking at all, which is neither a rank of zero nor a rank beyond
    // the pool — it is the absence of a rank, and crediting it to `rank <= 3` because `undefined <= 3` is false
    // would be right for the wrong reason on a day the comparison changed sign.
    if (rank === undefined) continue;
    ranked += 1;
    if (rank <= 3) top3 += 1;
    if (rank <= 5) top5 += 1;
  }
  return {
    system,
    category,
    cases: predictions.length,
    top1,
    top3,
    top5,
    ranked,
    jointComparable: false,
  };
}

/**
 * Group the runner's verdicts into the corpus's cells and count each.
 *
 * @param predictions - Every case the suite produced, in case order.
 * @param truths - Case id → cell, built by whoever owns the case → id mapping.
 * @returns One row per cell, ordered by system then category, then the `all` row.
 */
export function scoreByCell(
  predictions: readonly CasePrediction[],
  truths: ReadonlyMap<string, CellTruth>,
): readonly CellScore[] {
  const groups = new Map<string, { truth: CellTruth; rows: CasePrediction[] }>();
  for (const one of predictions) {
    const truth = truths.get(one.caseId);
    if (truth === undefined) {
      // A case the map does not know is a mapping defect, and reporting it as a smaller cell would hide it.
      throw new Error(
        `${one.caseId}: no cell recorded for this case, so no cell can claim to score it`,
      );
    }
    const key = `${truth.system}\u0000${truth.category}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, { truth, rows: [one] });
    else bucket.rows.push(one);
  }

  const cells: CellScore[] = [];
  for (const { truth, rows } of groups.values()) {
    cells.push(countCell(truth.system, truth.category, rows));
  }
  // `compareCasePaths` and not `localeCompare`: the order convention this repository enforces has ONE owner, and a
  // locale comparison here would print a different table on a machine with a different ICU collation.
  cells.sort(
    (a, b) => compareCasePaths(a.system, b.system) || compareCasePaths(a.category, b.category),
  );
  cells.push(countCell(ALL_SYSTEMS, ALL_SYSTEMS, predictions));
  return cells;
}

/**
 * A rate as a fixed-width fraction, or `n/a` when the cell is empty.
 *
 * @param numerator - The count.
 * @param denominator - The cases it is out of.
 * @returns `0.8129`-shaped text, or `n/a`.
 */
export function formatRate(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return (numerator / denominator).toFixed(4);
}

/**
 * Render the cell table as a fixed-width table with a header.
 *
 * @param cells - The rows {@link scoreByCell} produced.
 * @returns Text ending in a newline.
 */
export function formatCellTable(cells: readonly CellScore[]): string {
  const header = ['system', 'category', 'cases', 'CA@1', 'Top@3', 'Top@5', 'ranked'];
  const rows = cells.map((one) => [
    one.system,
    one.category,
    String(one.cases),
    formatRate(one.top1, one.cases),
    formatRate(one.top3, one.cases),
    formatRate(one.top5, one.cases),
    formatRate(one.ranked, one.cases),
  ]);
  const widths = header.map((name, index) =>
    Math.max(name.length, ...rows.map((row) => row[index]!.length)),
  );
  const line = (row: readonly string[]): string =>
    row
      .map((cell, index) =>
        index < 2 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!),
      )
      .join('  ');
  return [line(header), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)]
    .map((one) => `${one}\n`)
    .join('');
}
