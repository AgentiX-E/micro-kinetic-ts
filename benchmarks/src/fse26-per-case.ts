/**
 * The per-case verdict file: one line per case, in the order the cases were scored.
 *
 * ## Why this exists
 *
 * Every RCABench number this repository publishes is an **average**, and an average over a corpus cannot be
 * re-scored under a different judgement. That mattered the moment a competitor was run on the same 1,422 cases:
 * RCABench's ground truth is a SET for edge-shaped faults (both endpoints of the edge), so `top-1` means one
 * thing when the injected endpoint must be named and a slightly different thing when either endpoint counts.
 * The corpus itself carries both answers — `ground_truth.service` has the set, the case's `injection.json` has
 * `display_config.injection_point.app_name` — but the run artifact carries neither, so the judgement could not
 * be moved after the fact and the run had to be repeated to ask a second question.
 *
 * A verdict file makes the judgement a POST-processing decision. It records what the engine answered and what
 * the corpus accepted — and, since iteration 310, the three facts about the POOL that answer could be drawn from:
 * how wide the pool was, where the accepted answer sat in it, and its own anomaly before the topological
 * deduction charged anything. It still carries no score of the engine's own and no judgement: a reader who wants
 * strict, loose, Top-3 or `MRR` computes it from the same file, and two engines' files are comparable row by row
 * because the fields are the corpus's own.
 *
 * The three pool columns are not a score and are not a judgement, and the distinction is what keeps them inside
 * the format's argument: they are properties of the ORDER (its width, its position of the accepted set) and of the
 * case's own anomaly map (a number the builder wrote before `analyze` ran). Their purpose is narrow and stated in
 * `docs/topo-discount-scope.md` §7.4 — an absent truth and a low-ranked truth are different failures with
 * different owners — and before them a five-wide row reported both as `absent`.
 *
 * ## Why JSONL and not one array
 *
 * A 1,422-case run can be interrupted, and an array is only readable if the closing bracket was written. One
 * line per case means a truncated file still holds every case that finished — the same reason the diagnostic
 * dumps are line-oriented.
 *
 * @module benchmarks/fse26-per-case
 */

import { readFileSync, writeFileSync } from 'node:fs';

// The direct module rather than the benchmarks barrel: `bestAcceptedRank` has one owner and this file reads it
// from where it is defined, which is also how every other runner here imports it (`run-rcaeval.ts`).
import { bestAcceptedRank } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

/**
 * How many ranked services a verdict row carries.
 *
 * ## Five is a reporting width, and the reason it is five is not a reason
 *
 * This constant truncates the **artifact**. The engine sorts the whole node set and slices at the end, so `Top@5`
 * is a prefix of a total order that already exists; only a reader of this file sees five. The first version of
 * this docblock justified the value with "Top@5 is the deepest `At-K` this suite reports", which is the artifact
 * citing itself — the suite reports five because the row holds five — and a justification that runs in a circle
 * is how a **reporting** choice becomes available to a later argument as a **method** bound.
 *
 * It was taken as one. `docs/agentic-layer-plan.md` §6 reasoned from `Top@5` that "no layer can beat 87.8 %
 * without the ranking improving first", while the same document's own ceiling table, one page down, quotes
 * `Top@20 = 92.12 %` from the depth ladder (`docs/agentic-headroom.md` §10). Both numbers were measured; only the
 * sentence was wrong, and it was wrong for a reason this constant can state: **it omitted its own width**.
 *
 * So the value stays at five — the published format is five and every number in this repository was read from it
 * — and nothing may read it as a bound on what the ranking contains. `benchmarks/src/ranking-depth.ts` owns the
 * measurement that says what it does contain, and `DEPTH_TOP_LIMIT` now runs to the width of the corpus's orders
 * rather than to this constant (`docs/rank-depth.md` §2: every answer is inside the order, at rank 49 of 49 at the
 * worst). Since iteration 310 the verdict line carries that depth itself, in {@link PerCaseVerdict.truthRank} and
 * {@link PerCaseVerdict.pool}: the truncation above is a property of `ranked`, and reading it as a property of the
 * order is the mistake this paragraph exists to forbid.
 */
export const PER_CASE_RANK_LIMIT = 5;

/** One case's answer beside the corpus's own label set, and the pool the answer was drawn from. */
export interface PerCaseVerdict {
  /** The case directory's name, which is the corpus's stable id for the case. */
  readonly datapack: string;
  /** The corpus's fault type for the case (`unknown` when it declared none). */
  readonly faultType: string;
  /** The accepted services, in the corpus's order — the whole set, never truncated. */
  readonly accepted: readonly string[];
  /** The engine's ranking, best first, truncated to {@link PER_CASE_RANK_LIMIT}. */
  readonly ranked: readonly string[];
  /**
   * The best rank among {@link accepted} over the WHOLE order the run computed, `0` when the pool held none.
   *
   * A column rather than a judgement: `Top@1` is `truthRank === 1` and `Top@20` no longer needs a second run, and
   * — the reason it exists — `0` beside a positive {@link truthAnomalyBefore} is a candidate the topological
   * deduction REMOVED, which a five-wide row reports as the same absence as a truth it ranked ninth.
   * Absent on a row written before this column existed, and on one a caller built without an order.
   */
  readonly truthRank?: number;
  /** How many candidates the order held — the set the deduction decided. See {@link truthRank}. */
  readonly pool?: number;
  /**
   * The accepted answer's own anomaly BEFORE the deduction, or `null` when none of the accepted ids is a node of
   * the graph. Read against zero: `0` is a silent origin, `> 0` with {@link truthRank} `0` is an explained one.
   */
  readonly truthAnomalyBefore?: number | null;
}

/**
 * The pool columns for one case, derived from the order the run computed.
 *
 * One owner for the three questions a re-scorable row has to answer about its own pool, so the runner cannot
 * answer them with a second rule: the rank is {@link bestAcceptedRank} — the same function the accuracy counters
 * take — and the anomaly is looked up for the service that rank placed, falling back to the first DECLARED
 * accepted id when nothing was ranked, which is the only way an absent answer can still say whether it moved.
 *
 * @param ranking - The engine's order, best first, at its FULL width rather than the reporting width.
 * @param accepted - The accepted service ids, in the corpus's order.
 * @param anomalyBefore - The case's pre-deduction anomaly for a service, `undefined` when it is not a node.
 * @returns `truthRank` (0 = absent), `pool` (the order's width) and `truthAnomalyBefore` (`null` = off-graph).
 */
export function poolColumns(
  ranking: readonly { readonly serviceId: string }[],
  accepted: readonly string[],
  anomalyBefore: (serviceId: string) => number | undefined,
): Pick<PerCaseVerdict, 'truthRank' | 'pool' | 'truthAnomalyBefore'> {
  const truthRank = bestAcceptedRank(ranking, accepted);
  const caseTruth = truthRank > 0 ? ranking[truthRank - 1]!.serviceId : accepted[0];
  const before = caseTruth === undefined ? undefined : anomalyBefore(caseTruth);
  return { truthRank, pool: ranking.length, truthAnomalyBefore: before ?? null };
}

/**
 * Render one verdict as a single JSON line, **without** its newline.
 *
 * The fields are written in a fixed order (`datapack`, `faultType`, `accepted`, `ranked`) rather than via a
 * spread, so a diff between two runs is a diff of values and not of key insertion order.
 *
 * @param verdict - The case's answer and label set.
 * @returns The JSON text of one line.
 */
export function formatPerCaseVerdict(verdict: PerCaseVerdict): string {
  // The four published fields first, always. The pool columns follow, and each is written only when the row
  // carries it: a caller with no graph and no order builds a re-serialisation or a fixture, and a `0` written on
  // its behalf would report a measurement ("nothing moved", "nothing was ranked") where the truth is an absence.
  const line: Record<string, unknown> = {
    datapack: verdict.datapack,
    faultType: verdict.faultType,
    accepted: [...verdict.accepted],
    ranked: verdict.ranked.slice(0, PER_CASE_RANK_LIMIT),
  };
  if (verdict.truthRank !== undefined) line.truthRank = verdict.truthRank;
  if (verdict.pool !== undefined) line.pool = verdict.pool;
  // `null` is a VALUE here and is written: it says none of the accepted ids is a node of the graph, which is a
  // different fact from the column being absent (a row from before the column existed).
  if (verdict.truthAnomalyBefore !== undefined) {
    line.truthAnomalyBefore = verdict.truthAnomalyBefore;
  }
  return JSON.stringify(line);
}

/**
 * Write every verdict to `path`, one line each, replacing any file already there.
 *
 * Replacement rather than append is deliberate: a second run against the same path is a second measurement,
 * and appending would produce a file whose row count silently disagrees with the run that wrote it.
 *
 * @param path - Destination file. Its directory must already exist; creating one is the caller's decision.
 * @param verdicts - The rows, in scoring order.
 * @returns How many lines were written, so a caller can compare it with the cases it scored.
 */
export function writePerCaseVerdicts(path: string, verdicts: readonly PerCaseVerdict[]): number {
  const body = verdicts.map((verdict) => `${formatPerCaseVerdict(verdict)}\n`).join('');
  writeFileSync(path, body);
  return verdicts.length;
}

/** Refuses a string array that carries an empty or non-string entry. */
function stringsAt(value: unknown, field: string, line: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    throw new Error(`${field} on line ${line} is not an array of non-empty strings`);
  }
  return value as string[];
}

/**
 * One of the two COUNT columns, or `undefined` when the row predates it.
 *
 * A count is a non-negative integer and nothing else: `-1` is not "one above absent", and `1.5` is not a rank.
 * The distinction the two states carry is the module's own rule — absent means the row was written without an
 * order, so a reader must report `unmeasured` rather than fold it into either answer.
 */
function countAt(value: unknown, field: string, line: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  throw new Error(`${field} on line ${line} is not a non-negative integer`);
}

/**
 * The pre-deduction anomaly, `null` when the accepted id is not a graph node, `undefined` when the row predates
 * the column — three states, and the writer emits all three distinctly for exactly that reason.
 */
function anomalyAt(value: unknown, field: string, line: number): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${field} on line ${line} is neither a finite number nor null`);
}

/**
 * Read a verdict file back.
 *
 * The reader exists because the format's own argument is that a judgement may be chosen AFTER a run: an artifact
 * only a human can read is an artifact whose judgement cannot be re-derived. Blank lines are skipped (a file that
 * ends with a newline is not an error); every other unrecognised shape is refused by line number, because a
 * silently-coerced row would be scored as a different case than the one the corpus states.
 *
 * @param text - The ndjson contents.
 * @returns One verdict per non-blank line, in file order.
 * @throws Error when a line is not a row this module would have written.
 */
export function parsePerCaseVerdicts(text: string): PerCaseVerdict[] {
  const verdicts: PerCaseVerdict[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${lineNumber} is not JSON`);
    }
    if (typeof raw !== 'object' || raw === null)
      throw new Error(`line ${lineNumber} is not an object`);
    const row = raw as Record<string, unknown>;
    if (typeof row.datapack !== 'string' || row.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof row.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    // Read in the file's own field order, and each one validated by its own rule: a row that carries a pool
    // column the format would never have written is refused here rather than scored as a case with an odd answer.
    const truthRank = countAt(row.truthRank, 'truthRank', lineNumber);
    const pool = countAt(row.pool, 'pool', lineNumber);
    const truthAnomalyBefore = anomalyAt(row.truthAnomalyBefore, 'truthAnomalyBefore', lineNumber);
    verdicts.push({
      datapack: row.datapack,
      faultType: row.faultType,
      accepted: stringsAt(row.accepted, `accepted on line ${lineNumber}`, lineNumber),
      ranked: stringsAt(row.ranked, `ranked on line ${lineNumber}`, lineNumber),
      ...(truthRank === undefined ? {} : { truthRank }),
      ...(pool === undefined ? {} : { pool }),
      ...(truthAnomalyBefore === undefined ? {} : { truthAnomalyBefore }),
    });
  }
  return verdicts;
}

/**
 * Read a verdict file from disk.
 *
 * @param path - The ndjson file.
 * @returns One verdict per case.
 */
export function readPerCaseVerdicts(path: string): PerCaseVerdict[] {
  return parsePerCaseVerdicts(readFileSync(path, 'utf8'));
}
