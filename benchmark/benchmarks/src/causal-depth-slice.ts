/**
 * The causal-depth slice: which cases are deep, and how many of those a reading gets right.
 *
 * ## Why this module exists rather than a dispatch
 *
 * The leader's stratified table (`79 / 67 / 37` by causal depth, `arXiv:2608.21310` v2) is a statement about the
 * CORPUS: the depth is how far the injected service sits from the entry, and it is therefore readable from the call
 * graph the containment artifact already carries. It is not a property of our answer, and measuring it costs no
 * model call — which is the whole difference between this module and the dispatch that was reserved for it.
 *
 * The other quantity called "depth" in this repository is `ranking-depth.ts`'s: where the truth sat in OUR ranking.
 * A rule that promotes a candidate by rank depth is a reranker; a slice that groups cases by causal depth is a
 * population table. Conflating them is how a 12-case slice came to be priced like a benchmark-wide arm.
 *
 * ## What the report refuses to hide
 *
 * A case whose truth the entry cannot reach has no depth. It is named in `unattached` rather than dropped, because a
 * table that silently loses rows reports a denominator it does not have — the same refusal 330's rung made, for the
 * same reason.
 *
 * @module benchmarks/causal-depth-slice
 */

import { distancesFrom, type CallGraph } from './channel-ancestry.js';

/** One case, as the artifact that answered it wrote it. */
export interface SliceRow {
  /** The datapack, which is also the identity a graph is looked up by. */
  readonly datapack: string;
  /** The ground-truth services. Multi-service truths are common on this corpus. */
  readonly truth: readonly string[];
  /** The answer the reading settled on, or `null` when it settled on none. */
  readonly answer: string | null;
}

/** One depth's population and share. */
export interface SliceReading {
  /** Distance from the entry to the fault, counting the entry itself as 0. */
  readonly depth: number;
  /** Cases at this depth whose truth the entry can reach. */
  readonly cases: number;
  /** Of those, the ones the answer named. */
  readonly correct: number;
  /** `cases - correct`, stated so the table adds up without the reader doing arithmetic. */
  readonly misses: number;
  /** `correct / cases`, two decimals. A depth is only tabulated once a case lands on it, so it has no zero case. */
  readonly share: string;
}

/** The whole table, plus the denominators it has to be read against. */
export interface SliceReport {
  readonly readings: readonly SliceReading[];
  /** Cases with no depth: truth unreachable from the entry, or a graph the artifact does not carry. */
  readonly unattached: readonly string[];
  /** Rows read, so `answered` and `correct` can be read as shares of the file rather than of the table. */
  readonly rows: number;
  /** Rows whose answer is not `null`. */
  readonly answered: number;
  /** Rows the answer got right, over the whole file — the baseline the slices are a partition of. */
  readonly correct: number;
}

/**
 * How far the entry sits from the nearest member of the truth.
 *
 * The SMALLEST reachable distance, not the deepest: a multi-service truth (`['mysql', 'ts-order-service']`) is as
 * shallow as its easiest member, and taking the deepest would move a case into the hard slice on the strength of one
 * label it happens to carry.
 *
 * @param distances - The entry's distances, as `distancesFrom` computes them.
 * @param truth - The case's ground-truth services.
 * @returns The depth, or `null` when the entry reaches no member of the truth.
 */
export function causalDepthOf(
  distances: ReadonlyMap<string, number>,
  truth: readonly string[],
): number | null {
  let best: number | null = null;
  for (const service of truth) {
    const at = distances.get(service);
    if (at === undefined) continue;
    if (best === null || at < best) best = at;
  }
  return best;
}

/**
 * Group the rows by causal depth and count each group's hits.
 *
 * @param rows - The cases, as the answering artifact wrote them.
 * @param graphFor - The call graph a case was read with, or `null` when the artifact carries none for it.
 * @param entry - The service the depth is measured from.
 * @returns The table, the unattached cases by name, and the file's own denominators.
 */
export function sliceByCausalDepth(
  rows: readonly SliceRow[],
  graphFor: (datapack: string) => CallGraph | null,
  entry: string,
): SliceReport {
  const byDepth = new Map<number, { cases: number; correct: number }>();
  const unattached: string[] = [];
  let answered = 0;
  let correct = 0;

  for (const row of rows) {
    const graph = graphFor(row.datapack);
    const depth = graph === null ? null : causalDepthOf(distancesFrom(graph, entry), row.truth);
    if (depth === null) {
      unattached.push(row.datapack);
      continue;
    }
    const hit = row.answer !== null && row.truth.includes(row.answer);
    const cell = byDepth.get(depth) ?? { cases: 0, correct: 0 };
    cell.cases += 1;
    if (hit) cell.correct += 1;
    byDepth.set(depth, cell);
    if (row.answer !== null) answered += 1;
    if (hit) correct += 1;
  }

  const readings = [...byDepth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([depth, cell]) => ({
      depth,
      cases: cell.cases,
      correct: cell.correct,
      misses: cell.cases - cell.correct,
      // `cell.cases >= 1` by construction: a depth is only entered when a case lands on it.
      share: ((cell.correct / cell.cases) * 100).toFixed(2),
    }));

  return { readings, unattached, rows: rows.length, answered, correct };
}

/**
 * Render the table.
 *
 * @param report - What `sliceByCausalDepth` returned.
 * @param entry - The service the depths were measured from, named so the table cannot be read against another one.
 * @returns A printable block.
 */
export function formatSliceReport(report: SliceReport, entry: string): string {
  const head =
    `Causal depth from entry \`${entry}\` ` +
    `(cases=${report.rows}, answered=${report.answered}, correct=${report.correct})`;
  const lines = [
    head,
    '   depth   cases  correct   misses    share',
    ...report.readings.map(
      (one) =>
        `${String(one.depth).padStart(8)} ${String(one.cases).padStart(7)} ` +
        `${String(one.correct).padStart(8)} ${String(one.misses).padStart(8)} ` +
        `${one.share.padStart(8)}`,
    ),
    `   unattached ${report.unattached.length}` +
      ' (truth the entry cannot reach, or a graph the artifact does not carry)',
  ];
  return lines.join('\n');
}
