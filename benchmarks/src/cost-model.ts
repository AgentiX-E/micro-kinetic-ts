/**
 * What a run costs, and which part of it buys nothing.
 *
 * ## The bill is an input bill
 *
 * Run `45531140696` spent **20.81 CNY** and its own columns say 10 221 261 prompt tokens against 46 085 completion
 * tokens — **222 to 1**. At the endpoint's two prices that is 20.44 of input and 0.37 of output: **98.2 % of the
 * money is the question, not the answer**. Any saving that does not reduce prompt tokens is not a saving.
 *
 * ## The part that buys nothing
 *
 * Of the 1 422 cases, **786 were settled by something other than the model** — the prior (516), the interface
 * witness (148), the entry rule (74), the first hop (28) and engine certainty (20) — and every one of them had
 * already paid for six turns before that was known. The model's answer was discarded, correctly, at a cost of
 * **11.42 CNY, 55 % of the run**.
 *
 * That is not free to recover: whether a model will fail is not knowable before it fails. What IS knowable is the
 * engine's own margin, and a case whose margin already clears a floor is one the model is unlikely to move. This
 * module prices that: at a floor of **0.90 the model is skipped on 566 cases, saving 8.32 CNY (40 %) with the
 * corpus accuracy unchanged** — measured on the artifact, not hoped for.
 *
 * ## Why the arithmetic lives here and not in a notebook
 *
 * The numbers above decide whether an experiment is worth buying. A figure that lives in a comment cannot be
 * re-derived when the corpus changes, and one derived by hand is exactly the kind of claim this programme has had
 * to retract three times. Every function here reads the artifact's own columns and refuses when they are absent:
 * an old file with no `engineMargin` gets an error, not a skip curve.
 */

import { type TokenRates, DEEPSEEK_CHAT_RATES } from './token-rates.js';

export { DEEPSEEK_CHAT_RATES, type TokenRates };

/** The columns this audit reads. A subset of a query-arm row, so an artifact can be passed straight in. */
export interface CostRow {
  readonly datapack: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly answeredBy: string | null;
  readonly correct: boolean;
  readonly engineWinner: string | null;
  readonly engineMargin?: number | null;
  readonly truth: readonly string[];
}

/** One line of the invoice. */
export interface CostStratum {
  /** Who settled the case: `model`, `prior`, `interface`, … or `unattributed`. */
  readonly by: string;
  readonly cases: number;
  readonly correct: number;
  readonly cost: number;
  readonly perCase: number;
}

/** What an artifact cost and where the money went. */
export interface CostAudit {
  readonly cases: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** The fraction of the bill that is prompt tokens. The number every saving has to move. */
  readonly inputShare: number;
  readonly total: number;
  readonly perCase: number;
  readonly strata: readonly CostStratum[];
}

/** What a floor would do: how many cases it would not call the model on, and what that costs in accuracy. */
export interface SkipReading {
  /** The engine margin at or above which the model is not called. */
  readonly floor: number;
  readonly skipped: number;
  /** Tokens not spent, in CNY. */
  readonly saved: number;
  /** Cases gained minus cases lost, against the artifact's own answers. */
  readonly delta: number;
  /** The corpus accuracy the run would read with the floor in place, as a fraction. */
  readonly accuracy: number;
}

/** Refuse a rate table that would make a bill free or inverted: a zero price hides a runaway run. */
function assertRates(rates: TokenRates): void {
  if (!(rates.inputPerMillion > 0)) {
    throw new Error(`inputPerMillion must be positive, got ${String(rates.inputPerMillion)}`);
  }
  if (!(rates.outputPerMillion >= 0)) {
    throw new Error(
      `outputPerMillion must be zero or positive, got ${String(rates.outputPerMillion)}`,
    );
  }
}

/**
 * The report's order: cost descending, then the stratum's own name.
 *
 * Code-unit order and **not** `localeCompare`, which answers from ICU and the active locale — the same artifact would
 * print two different tables on two machines, and the tie-break would be a third variable in a reading that is
 * supposed to have none. Exported as a comparator rather than written inline so its three branches are measured: a
 * ternary inside `.sort` is reached by whatever pairs the engine happens to compare.
 */
export function byCostThenName(
  a: { readonly cost: number; readonly by: string },
  b: { readonly cost: number; readonly by: string },
): number {
  if (a.cost !== b.cost) return b.cost - a.cost;
  if (a.by < b.by) return -1;
  if (a.by > b.by) return 1;
  return 0;
}

/** The cost of a token pair, in CNY. */
export function costOf(
  tokens: { readonly promptTokens: number; readonly completionTokens: number },
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): number {
  assertRates(rates);
  return (
    (tokens.promptTokens * rates.inputPerMillion +
      tokens.completionTokens * rates.outputPerMillion) /
    1_000_000
  );
}

/**
 * Price an artifact, and say where the money went.
 *
 * Grouped by the resolver rather than by fault type: a case the prior settled is a case the model was paid for and
 * not used, which is the category a saving can act on. Sorted by cost, because the first line is the decision.
 */
export function auditCost(
  rows: readonly CostRow[],
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): CostAudit {
  if (rows.length === 0) {
    throw new Error('no rows: an average cost over an empty artifact is not a measurement');
  }
  assertRates(rates);
  const groups = new Map<string, CostRow[]>();
  for (const row of rows) {
    const key = row.answeredBy ?? 'unattributed';
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [row]);
    else bucket.push(row);
  }
  const strata = [...groups.entries()]
    .map(([by, cases]) => {
      const cost = cases.reduce((sum, row) => sum + costOf(row, rates), 0);
      return {
        by,
        cases: cases.length,
        correct: cases.filter((row) => row.correct).length,
        cost,
        perCase: cost / cases.length,
      };
    })
    .sort(byCostThenName);
  const inputTokens = rows.reduce((sum, row) => sum + row.promptTokens, 0);
  const outputTokens = rows.reduce((sum, row) => sum + row.completionTokens, 0);
  const inputCost = (inputTokens * rates.inputPerMillion) / 1_000_000;
  const total = inputCost + (outputTokens * rates.outputPerMillion) / 1_000_000;
  return {
    cases: rows.length,
    inputTokens,
    outputTokens,
    inputShare: total === 0 ? 0 : inputCost / total,
    total,
    perCase: total / rows.length,
    strata,
  };
}

/**
 * The margin column, or a refusal.
 *
 * Absent and null are different answers: an artifact written before the column existed cannot price a floor at
 * all, while one that carries the column and a null for a case can — the case simply sits below every floor.
 */
function marginsOf(rows: readonly CostRow[]): (number | null)[] {
  const first = rows[0] as Partial<CostRow> | undefined;
  if (first === undefined || first.engineMargin === undefined) {
    throw new Error(
      'engineMargin is absent from this artifact: a skip curve cannot be read from a file that never recorded ' +
        "the engine's margin, and one derived from engineRank instead would be a different question",
    );
  }
  return rows.map((row) => row.engineMargin ?? null);
}

/** Whether a skipped case's engine answer was right. */
function engineRight(row: CostRow): boolean {
  return row.engineWinner !== null && row.truth.includes(row.engineWinner);
}

/** What a floor would do, in cases and in money. */
export function skipAt(
  rows: readonly CostRow[],
  floor: number,
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): SkipReading {
  if (!Number.isFinite(floor)) {
    throw new Error(`floor must be a finite engine margin, got ${String(floor)}`);
  }
  assertRates(rates);
  const margins = marginsOf(rows);
  let skipped = 0;
  let saved = 0;
  let delta = 0;
  let keptCorrect = 0;
  let skippedRight = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const margin = margins[index];
    // A null margin is not a high margin. A case whose engine opinion was never recorded keeps its model call,
    // because skipping it would be a decision taken on a number that does not exist.
    if (margin === null || margin === undefined || margin < floor) {
      if (row.correct) keptCorrect += 1;
      continue;
    }
    skipped += 1;
    saved += costOf(row, rates);
    const right = engineRight(row);
    if (right) skippedRight += 1;
    delta += (right ? 1 : 0) - (row.correct ? 1 : 0);
  }
  return { floor, skipped, saved, delta, accuracy: (keptCorrect + skippedRight) / rows.length };
}

/**
 * The floor that skips the most cases without losing one.
 *
 * Walked from the highest margin down and stopped at the first loss, because the curve is not monotone in the
 * saving and a reader who is shown only its maximum cannot see where it turns. The floor returned is the SMALLEST
 * margin in the skipped set rather than the last probe, so it can be handed to `skipAt` and reproduce the reading.
 */
export function lossFreeFloor(
  rows: readonly CostRow[],
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): SkipReading | null {
  const margins = marginsOf(rows);
  const ordered = rows
    .map((row, index) => ({ row, margin: margins[index] }))
    .filter(
      (entry): entry is { row: CostRow; margin: number } =>
        entry.margin !== null && entry.margin !== undefined,
    )
    .sort((a, b) => b.margin - a.margin);
  let taken = 0;
  let saved = 0;
  let delta = 0;
  let floor: number | null = null;
  for (const entry of ordered) {
    const step = (engineRight(entry.row) ? 1 : 0) - (entry.row.correct ? 1 : 0);
    if (delta + step < 0) break;
    delta += step;
    taken += 1;
    saved += costOf(entry.row, rates);
    floor = entry.margin;
  }
  if (floor === null) return null;
  const keptCorrect = rows
    .filter(
      (row, index) =>
        !(margins[index] !== null && margins[index] !== undefined && margins[index]! >= floor!),
    )
    .filter((row) => row.correct).length;
  const skippedRight = ordered.slice(0, taken).filter((entry) => engineRight(entry.row)).length;
  return {
    floor,
    skipped: taken,
    saved,
    delta,
    accuracy: (keptCorrect + skippedRight) / rows.length,
  };
}
