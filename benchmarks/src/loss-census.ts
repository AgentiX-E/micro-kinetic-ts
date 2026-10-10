/**
 * Two instruments that make a MISS readable, and the reason both were needed.
 *
 * A Top-1 accuracy is a single number, and it hides two completely different failures. A benchmark whose
 * root cause never entered the candidate set cannot be improved by ranking, and one whose root cause entered
 * it and was placed second can be. The distinction is not academic: the framework this project is measured
 * against reports `Avg@5`, so a miss there may be a retrieval miss or a reranking miss and the published
 * table cannot say which — and a competitor's recent decomposition of exactly that question is why this
 * module exists.
 *
 * **Neither instrument is a new measurement.** Both read what a run already produced:
 *
 * - {@link formatRankingLadder} renders a ranked list, and it exists because the shipped renderer printed a
 *   quantity that is not the one the order came from, which made every ladder line unverifiable.
 * - {@link classifyLoss} consumes a {@link LossRecord} — one case, its candidate pool, and where the truth
 *   was placed in it — and names the failure. {@link summarizeLoss} counts them per (suite, system).
 *
 * **The pool is the graph.** A case's candidate set is the node set of the call graph this pipeline
 * constructed for it, which is the set the ranker can output; a truth that is not a node cannot be returned
 * by any ranking of it, however good. {@link LossRecord.pool} records the size of that set beside
 * {@link LossRecord.truthInGraph}, because a fraction without a denominator is not a rate.
 *
 * @module benchmarks/loss-census
 */

/**
 * One entry of a ranked candidate list, as the diagnostic carries it.
 *
 * `finalScore` is the value the ranking sorted by; `confidence` is a display value that folds in
 * propagation-depth and error-bound penalties and therefore does NOT have to decrease with rank. Both are
 * carried, and the ladder prints the one it ordered by.
 */
export interface RankedService {
  /** The candidate service. */
  readonly serviceId: string;
  /** The display confidence, which need not be monotone in rank. */
  readonly confidence: number;
  /**
   * The exact value the ranking sorted by, or `undefined` when the artifact predates this field.
   *
   * Optional rather than defaulted, because substituting `confidence` for a missing sort key is precisely
   * the defect this field was added to remove.
   */
  readonly finalScore?: number | undefined;
  /** Propagation depth from the root, as the engine reported it. */
  readonly depth: number;
}

/** The decimal places the ladder prints for a ranking score. */
export const LADDER_SCORE_DECIMALS = 3;

/**
 * Render a ranked list as one line.
 *
 * **The contract is that the printed number is the sort key.** `finalScore` decreases with rank by
 * construction — the engine sorts by it, tie-broken on service id — so a reader can check the line against
 * itself, and a line whose numbers rise is a bug rather than a puzzle. Where the score is absent the cell
 * reads `-`, which is a statement that this artifact does not carry it: never a silent substitution of the
 * display value, because a reader has no way to tell a substituted quantity from a measured one.
 *
 * @param entries - The ranked candidates, best first.
 * @returns The rendered line, ending without a newline.
 */
export function formatRankingLadder(entries: readonly RankedService[]): string {
  const cells = entries.map((e) => {
    const score = e.finalScore === undefined ? '-' : e.finalScore.toFixed(LADDER_SCORE_DECIMALS);
    return `${e.serviceId}(${score},d${e.depth})`;
  });
  return `    Top-K: ${cells.join(' | ')}`;
}

/** How deep in the ranking a miss still counts as a *shallow* one. */
export const DEFAULT_SHALLOW_DEPTH = 5;

/**
 * Why a case was missed.
 *
 * `RETRIEVAL` means the truth is not in the set the engine ranked, so **no ranking of that set could have
 * returned it** — the definition is about the pool and not about the mechanism that emptied it of the truth.
 * Why it is absent is reported separately (see {@link LossRow.retrievalNotInGraph} and
 * {@link LossRow.retrievalNotRanked}), because the two mechanisms have different owners and the record cannot
 * always tell them apart; asserting one of them here would be asserting more than was measured.
 */
export type LossClass = 'CORRECT' | 'ENGINE_ERROR' | 'RETRIEVAL' | 'RERANK_SHALLOW' | 'RERANK_DEEP';

/** One case, as the census records it. */
export interface LossRecord {
  /** Stable case identifier. */
  readonly caseId: string;
  /** System-level cell key, e.g. `RE1:OnlineBoutique`. */
  readonly cell: string;
  /** Lowercase fault type. */
  readonly faultType: string;
  /** Ground-truth root-cause service id. */
  readonly truth: string;
  /** The engine's top-1 prediction, or `undefined` when it produced none. */
  readonly predicted?: string | undefined;
  /** Whether the top-1 prediction is the ground truth. */
  readonly correct: boolean;
  /** How many services the ranker could choose between. */
  readonly pool: number;
  /** Whether the ground truth is a node of the case's constructed graph. */
  readonly truthInGraph: boolean;
  /**
   * The truth's 1-based rank in the engine's FULL ranking, or `undefined` when it does not appear.
   *
   * Full, and not a top-5 prefix: a prefix cannot tell a truth at rank 6 from one at rank 40, and the
   * difference between those two is most of what a reranking fix is worth.
   */
  readonly truthRank?: number | undefined;
  /**
   * Whether the engine threw before producing a ranking.
   *
   * Its own class rather than a kind of miss, because such a case has no candidate pool to be inside or
   * outside of — `truthInGraph` would be a statement about a graph that was never built.
   */
  readonly errored?: boolean | undefined;
}

/**
 * Name the failure in one case.
 *
 * @param record - One case's census row.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns The class.
 */
export function classifyLoss(
  record: LossRecord,
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): LossClass {
  if (record.errored === true) return 'ENGINE_ERROR';
  if (record.correct) return 'CORRECT';
  // The pool is the set the engine ranked, so absence is decided by the rank and not by the graph: a truth the
  // graph holds but the ranking never surfaces is still one no ranking of THIS pool could have returned.
  if (record.truthRank === undefined) return 'RETRIEVAL';
  return record.truthRank <= shallowDepth ? 'RERANK_SHALLOW' : 'RERANK_DEEP';
}

/** The counts for one (suite, system) group. */
export interface LossRow {
  /** Suite name, as the case id declared it. */
  readonly suite: string;
  /** System name. */
  readonly system: string;
  /** Cases in the group. */
  readonly cases: number;
  /** Cases answered correctly. */
  readonly correct: number;
  /** Cases whose analysis threw: no ranking exists, so they are neither retrieved nor reranked. */
  readonly engineError: number;
  /** Misses whose truth is not in the candidate pool: no ranking of that pool could have returned it. */
  readonly retrieval: number;
  /** Of those, the truth was never a node of the case's graph. */
  readonly retrievalNotInGraph: number;
  /**
   * Of those, the truth IS a node of the case's graph and the ranking never surfaces it.
   *
   * Reported as a mechanism rather than as a verdict: the pruner may legitimately have removed the node from
   * what it scored, and separating that from a ranker that dropped a candidate it was handed needs the scored
   * set, which this record does not carry. Both are retrieval failures; only one would be a defect.
   */
  readonly retrievalNotRanked: number;
  /** Misses whose truth was in the pool and placed inside the shallow depth. */
  readonly rerankShallow: number;
  /** Misses whose truth was in the pool and placed deeper than the shallow depth. */
  readonly rerankDeep: number;
  /** The median candidate-pool size, so the retrieval half has a denominator. */
  readonly poolMedian: number;
}

/** The suite and system a cell key declares, or `('unrecognised', 'unrecognised')`. */
export function splitCell(cell: string): readonly [string, string] {
  const at = cell.indexOf(':');
  if (at <= 0 || at === cell.length - 1) return ['unrecognised', 'unrecognised'];
  return [cell.slice(0, at), cell.slice(at + 1)];
}

/**
 * Count the classes per (suite, system).
 *
 * @param records - Every case's census row.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns One row per group, ordered by suite then system.
 */
export function summarizeLoss(
  records: readonly LossRecord[],
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): LossRow[] {
  const groups = new Map<string, LossRecord[]>();
  for (const r of records) {
    const at = groups.get(r.cell);
    if (at === undefined) groups.set(r.cell, [r]);
    else at.push(r);
  }
  const rows: LossRow[] = [];
  for (const cell of [...groups.keys()].sort()) {
    const members = groups.get(cell)!;
    const [suite, system] = splitCell(cell);
    const counts: Record<LossClass, number> = {
      CORRECT: 0,
      ENGINE_ERROR: 0,
      RETRIEVAL: 0,
      RERANK_SHALLOW: 0,
      RERANK_DEEP: 0,
    };
    let notInGraph = 0;
    for (const m of members) {
      counts[classifyLoss(m, shallowDepth)]++;
      if (classifyLoss(m, shallowDepth) === 'RETRIEVAL' && !m.truthInGraph) notInGraph++;
    }
    rows.push({
      suite,
      system,
      cases: members.length,
      correct: counts.CORRECT,
      engineError: counts.ENGINE_ERROR,
      retrieval: counts.RETRIEVAL,
      retrievalNotInGraph: notInGraph,
      retrievalNotRanked: counts.RETRIEVAL - notInGraph,
      rerankShallow: counts.RERANK_SHALLOW,
      rerankDeep: counts.RERANK_DEEP,
      poolMedian: median(members.map((m) => m.pool)),
    });
  }
  return rows;
}

/** Ascending numeric order, named so the comparator is a value rather than an inline closure. */
function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * The median of a NON-EMPTY list of numbers.
 *
 * The precondition is real rather than defensive, and it is stated here because the obvious guard is an arm no
 * input can reach: the only caller passes a group's members, and a group is created by pushing its first
 * member — so there is no empty group to take the median of, and a `values.length === 0` branch would be dead
 * code that the coverage gate would then be reporting as an uncovered arm.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort(ascending);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const pct = (hit: number, of: number): string =>
  of === 0 ? 'n/a' : `${((hit / of) * 100).toFixed(1)}%`;

/**
 * The report, as lines. Pure, so every arm of it is testable without a corpus.
 *
 * The two totals are the reading: **retrieval** is the part of the loss no ranking change can recover, and
 * **reranking** is the part a ranking change can. A report that printed only the accuracy would make the
 * two indistinguishable — which is the whole reason this module exists.
 *
 * @param rows - The per-group counts.
 * @param shallowDepth - The deepest rank still called *shallow*.
 * @returns The report lines.
 */
export function formatLossReport(
  rows: readonly LossRow[],
  shallowDepth: number = DEFAULT_SHALLOW_DEPTH,
): string[] {
  if (rows.length === 0) {
    return ['no cases found: nothing to census, and saying so beats printing a zero.'];
  }
  const lines = [
    `  loss decomposition (a miss at rank <= ${shallowDepth} is RERANK_SHALLOW; beyond it, RERANK_DEEP)`,
    `  ${'suite'.padEnd(6)} ${'system'.padEnd(15)} ${'cases'.padStart(6)} ${'correct'.padStart(8)} ` +
      `${'RETRIEVAL'.padStart(10)} ${'shallow'.padStart(8)} ${'deep'.padStart(6)} ` +
      `${'notG'.padStart(5)} ${'ERR'.padStart(5)} ${'pool'.padStart(6)}`,
  ];
  let cases = 0;
  let correct = 0;
  let engineError = 0;
  let retrieval = 0;
  let shallow = 0;
  let deep = 0;
  let notInGraph = 0;
  for (const r of rows) {
    cases += r.cases;
    correct += r.correct;
    engineError += r.engineError;
    retrieval += r.retrieval;
    shallow += r.rerankShallow;
    deep += r.rerankDeep;
    notInGraph += r.retrievalNotInGraph;
    lines.push(
      `  ${r.suite.padEnd(6)} ${r.system.padEnd(15)} ${String(r.cases).padStart(6)} ` +
        `${String(r.correct).padStart(8)} ${String(r.retrieval).padStart(10)} ` +
        `${String(r.rerankShallow).padStart(8)} ${String(r.rerankDeep).padStart(6)} ` +
        `${String(r.retrievalNotInGraph).padStart(5)} ${String(r.engineError).padStart(5)} ` +
        `${r.poolMedian.toFixed(1).padStart(6)}`,
    );
  }
  const misses = cases - correct;
  lines.push(
    `  ${'TOTAL'.padEnd(6)} ${''.padEnd(15)} ${String(cases).padStart(6)} ${String(correct).padStart(8)} ` +
      `${String(retrieval).padStart(10)} ${String(shallow).padStart(8)} ${String(deep).padStart(6)} ` +
      `${String(notInGraph).padStart(5)} ${String(engineError).padStart(5)}`,
    `  accuracy ${pct(correct, cases)} · of ${misses} misses: RETRIEVAL ${pct(retrieval, misses)} ` +
      `(no ranking change can recover these; ${notInGraph} were never a graph node and ` +
      `${retrieval - notInGraph} a node the ranking does not surface), ` +
      `RERANKING ${pct(shallow + deep, misses)} (shallow ${pct(shallow, misses)}, deep ${pct(deep, misses)}), ` +
      `ENGINE ERROR ${pct(engineError, misses)}`,
  );
  return lines;
}
