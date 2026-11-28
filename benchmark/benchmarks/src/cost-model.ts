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
 * module prices that, in the units the decision is taken in: at the certainty guard's own bar the floor silences
 * **360 cases (25.3 %) for 2.83 CNY (25.4 %)**, and at the corpus's fitted frontier of 0.87 it silences **580
 * (40.8 %) for 4.56 CNY (40.9 %)** with **zero repairs and zero breaks** — not a net zero, a per-case identity.
 * {@link ruleEdges} says why: above 0.8630 the engine's answer and the shipped answer agree on every case, so the
 * floor there changes no answer at all.
 *
 * ## The rule this module must price is the rule the arm ships
 *
 * `skipAt` credits a skipped case with the ENGINE's answer, so the floor must settle on the engine's answer. It does:
 * `runQueryAgent` ships `engine.top1`, which is what the certainty guard ships for the same margin. Iteration 348
 * shipped the fallback's first name instead, and the artifact would then have priced a rule the arm never ran — the
 * defect iteration 322 paid a dispatch to learn, and the reason the comparison here is strict (`>`) exactly as
 * `engineCertainty`'s is.
 *
 * ## Why the arithmetic lives here and not in a notebook
 *
 * The numbers above decide whether an experiment is worth buying. A figure that lives in a comment cannot be
 * re-derived when the corpus changes, and one derived by hand is exactly the kind of claim this programme has had
 * to retract three times. Every function here reads the artifact's own columns and refuses when they are absent:
 * an old file with no `engineMargin` gets an error, not a skip curve.
 */

import { type Tariff, type TokenRates, DEEPSEEK_CHAT_RATES } from './token-rates.js';

export { DEEPSEEK_CHAT_RATES, type Tariff, type TokenRates };

/** The columns this audit reads. A subset of a query-arm row, so an artifact can be passed straight in. */
export interface CostRow {
  readonly datapack: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  /**
   * Prompt tokens the endpoint reported as cache hits, or absent on an artifact written before the column existed.
   *
   * Absent is not zero: it means the run PROBABLY had a cache and the record cannot say how much, which is a different
   * statement from a run that hit nothing.
   */
  readonly cacheHitTokens?: number | null;
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
  /**
   * Prompt tokens the endpoint served from cache, or `null` when no row declares the column.
   *
   * `null` and `0` are different readings and the audit keeps them apart: a null says this artifact cannot state its
   * cache behaviour, a zero says the cache served nothing. Conflating them is how iteration 349 withdrew a 75 %
   * saving on the strength of a probe that measured a 191-token prompt instead of a workload.
   */
  readonly cacheHitTokens: number | null;
  /** `cacheHitTokens / inputTokens`, or `null` when unrecorded. */
  readonly cacheHitShare: number | null;
  readonly total: number;
  readonly perCase: number;
  readonly strata: readonly CostStratum[];
}

/** What a floor would do: how many cases it would not call the model on, and what that costs in accuracy. */
export interface SkipReading {
  /** The engine margin above which the model is not called. Exclusive, because the guard it mirrors is. */
  readonly floor: number;
  readonly skipped: number;
  /** Tokens not spent, in CNY. */
  readonly saved: number;
  /**
   * Cases the floor would REPAIR, and cases it would BREAK, reported apart from their difference.
   *
   * `delta` alone cannot tell a no-op from a coin flip: a floor that repairs 30 cases and breaks 30 reads as a net
   * zero and is not one — it is a rule that changes 60 answers and happens to sum to nothing, and the next corpus
   * would move it. The pair is the reading; the net is the summary.
   */
  readonly gains: number;
  readonly losses: number;
  /** Cases gained minus cases lost, against the artifact's own answers. */
  readonly delta: number;
  /** The corpus accuracy the run would read with the floor in place, as a fraction. */
  readonly accuracy: number;
}

/**
 * Where the engine's own answer stops being interchangeable with what the arm shipped.
 *
 * The floor's risk is one-sided and measurable per case: shipping `engine.top1` on a case the model got right destroys
 * it, and on a case the model got wrong it repairs it. Both events have a margin, so both have a maximum, and above
 * the larger of the two the rule changes NO case — which is a stronger statement than "the corpus accuracy did not
 * move", because it holds case by case and it says where the next corpus would break it.
 */
export interface RuleEdges {
  /**
   * The highest engine margin at which shipping the engine's answer would have destroyed a correct one. Every floor
   * above it is a provable no-op on this corpus; `null` when the rule never destroys.
   */
  readonly destroys: number | null;
  /** The highest margin at which it would have repaired one. Above this the rule has nothing left to gain. */
  readonly repairs: number | null;
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
  // A hit that costs MORE than a miss is not a tariff, it is a typo that would invert every saving in the report.
  if (rates.cacheHitPerMillion !== undefined && !(rates.cacheHitPerMillion >= 0)) {
    throw new Error(
      `cacheHitPerMillion must be zero or positive, got ${String(rates.cacheHitPerMillion)}`,
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

/**
 * The cost of a token triple, in CNY.
 *
 * `promptTokens` is the endpoint's own total input, and `cacheHitTokens` is a SUBSET of it — `prompt_cache_hit_tokens`
 * plus `prompt_cache_miss_tokens` equals `prompt_tokens` in the endpoint's `usage`. So the miss count is the
 * difference, floored at zero: a record whose hit column exceeded its prompt column would be corrupt, and billing the
 * difference as negative input would turn a corrupt row into a discount.
 *
 * A rate table with no hit price bills every prompt token at the miss price. That is the no-cache bound, and it is the
 * default because a cheaper number nobody named must not appear in a report.
 */
export function costOf(
  tokens: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly cacheHitTokens?: number | null;
  },
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): number {
  assertRates(rates);
  const hit =
    rates.cacheHitPerMillion === undefined
      ? 0
      : Math.min(Math.max(tokens.cacheHitTokens ?? 0, 0), Math.max(tokens.promptTokens, 0));
  const miss = Math.max(tokens.promptTokens - hit, 0);
  return (
    (miss * rates.inputPerMillion +
      hit * (rates.cacheHitPerMillion ?? rates.inputPerMillion) +
      tokens.completionTokens * rates.outputPerMillion) /
    1_000_000
  );
}

/** The tokens a run spent, in the shape a bill reads. `cacheHitTokens: null` means unrecorded, not zero. */
export interface BillTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly cacheHitTokens?: number | null;
}

/** The hit tokens the bill was computed from — clamped to the prompt column, `null` when no row recorded one. */
function billedHits(totals: BillTotals): number | null {
  if (totals.cacheHitTokens === undefined || totals.cacheHitTokens === null) return null;
  return Math.min(Math.max(totals.cacheHitTokens, 0), Math.max(totals.promptTokens, 0));
}

/** The card, as the tail of a printed line: `1 / 4 / hit 0.02`, or `1 / 4, no hit price`. */
function cardLabel(rates: TokenRates): string {
  const head = `${rates.inputPerMillion} / ${rates.outputPerMillion}`;
  return rates.cacheHitPerMillion === undefined
    ? `${head}, no hit price`
    : `${head} / hit ${rates.cacheHitPerMillion}`;
}

/**
 * The one cost sentence a runner prints, priced by the same function the audit prices its table with.
 *
 * This used to be written inline in `run-query-agent.ts` as `prompt × 2 + completion × 8` and printed as "the declared
 * prices". It was the peak column, with every prompt token billed as a miss: run `45595943761` cost **1.69 CNY** and the
 * line beside its own artifact said **15.55**. The arithmetic is not restated here — it IS `costOf` — so the sentence
 * and the table can only disagree if this function stops being called.
 *
 * @param totals - The run's tokens, `cacheHitTokens` absent or `null` when the artifact never recorded the column.
 * @param rates - The card to price with. Its absence of a hit price is the no-cache bound, not an omission.
 * @param tariff - Which column `rates` is, named so a price cannot be read a fortnight later without its tier.
 */
export function billLine(totals: BillTotals, rates: TokenRates, tariff: Tariff): string {
  const hits = billedHits(totals);
  const share =
    hits === null
      ? 'cache unrecorded'
      : `${((totals.promptTokens === 0 ? 0 : hits / totals.promptTokens) * 100).toFixed(2)} % served from cache`;
  return (
    `tokens ${totals.promptTokens}+${totals.completionTokens} · ${share} · ` +
    `est. ¥${costOf(totals, rates).toFixed(2)} at the ${tariff} column (${cardLabel(rates)})`
  );
}

/**
 * What the line above would have read with no cache at all, or `null` when there is nothing to add.
 *
 * Printed rather than dropped because every cost figure this programme published before iteration 353 was that number,
 * and a reader comparing a new report with an old one has to be able to see where the difference came from. `null` when
 * the run served nothing from cache (the line already IS the no-cache reading) — a note that repeats the line is noise,
 * and noise beside a price is what teaches a reader to skip the note.
 */
export function billNote(totals: BillTotals, rates: TokenRates): string | null {
  const hits = billedHits(totals);
  const cost = costOf(totals, rates);
  if (hits === null) {
    return (
      `  no row recorded a cache, so ¥${cost.toFixed(2)} bills every prompt at the miss price — ` +
      'a bound, not an invoice'
    );
  }
  if (rates.cacheHitPerMillion === undefined) {
    return (
      `  the table names no hit price, so ¥${cost.toFixed(2)} bills every prompt at the miss price — ` +
      'a bound, not a discount'
    );
  }
  if (hits === 0) return null;
  const noCache =
    (totals.promptTokens * rates.inputPerMillion +
      totals.completionTokens * rates.outputPerMillion) /
    1_000_000;
  return (
    `  with every prompt at the miss price the same run would read ¥${noCache.toFixed(2)} — ` +
    'the number the two-number line printed'
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
  const recorded = rows.filter(
    (row): row is CostRow & { cacheHitTokens: number } =>
      row.cacheHitTokens !== undefined && row.cacheHitTokens !== null,
  );
  const cacheHitTokens =
    recorded.length === 0 ? null : recorded.reduce((sum, row) => sum + row.cacheHitTokens, 0);
  // Through `costOf` and not through the two column totals: the cache split is per ROW, and a total that multiplied
  // the summed prompt tokens by the miss price would report the no-cache bill beside strata priced with the cache —
  // two arithmetics in one table, which is the shape of every retraction in this file's history.
  const inputCost = rows.reduce((sum, row) => {
    const hit = Math.min(Math.max(row.cacheHitTokens ?? 0, 0), Math.max(row.promptTokens, 0));
    const miss = Math.max(row.promptTokens - hit, 0);
    return (
      sum +
      (miss * rates.inputPerMillion + hit * (rates.cacheHitPerMillion ?? rates.inputPerMillion)) /
        1_000_000
    );
  }, 0);
  const total = rows.reduce((sum, row) => sum + costOf(row, rates), 0);
  return {
    cases: rows.length,
    inputTokens,
    outputTokens,
    inputShare: total === 0 ? 0 : inputCost / total,
    cacheHitTokens,
    cacheHitShare:
      cacheHitTokens === null || inputTokens === 0 ? null : cacheHitTokens / inputTokens,
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
  let gains = 0;
  let losses = 0;
  let keptCorrect = 0;
  let skippedRight = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const margin = margins[index];
    // A null margin is not a high margin. A case whose engine opinion was never recorded keeps its model call,
    // because skipping it would be a decision taken on a number that does not exist.
    // The comparison is STRICT because the shipped floor is: it mirrors `engineCertainty`, which fires on
    // `margin > bar`, and a price that used `>=` would sell a case the arm would have investigated.
    if (margin === null || margin === undefined || margin <= floor) {
      if (row.correct) keptCorrect += 1;
      continue;
    }
    skipped += 1;
    saved += costOf(row, rates);
    const right = engineRight(row);
    if (right) skippedRight += 1;
    if (right === row.correct) continue;
    if (right) gains += 1;
    else losses += 1;
  }
  return {
    floor,
    skipped,
    saved,
    gains,
    losses,
    delta: gains - losses,
    accuracy: (keptCorrect + skippedRight) / rows.length,
  };
}

/**
 * The floors a report prints: sorted, and deduped by the value that is PRINTED.
 *
 * The cliff `ruleEdges` returns is a corpus margin like `0.8629602…`, so a reader who also asks for `0.863` would
 * otherwise see the same row twice under two spellings — and a table that lists one floor as two readings invites the
 * conclusion that the curve has a step there. Deduped at `5e-4`, which is the resolution the row is printed at.
 *
 * @param floors - The requested floors, in any order, with any duplicates.
 * @returns The same floors, ascending, one per printed value.
 */
export function distinctFloors(floors: readonly number[]): number[] {
  const kept: number[] = [];
  for (const floor of [...floors].sort((a, b) => a - b)) {
    const previous = kept[kept.length - 1];
    if (previous !== undefined && Math.abs(previous - floor) < 5e-4) continue;
    kept.push(floor);
  }
  return kept;
}

/**
 * The two margins at which the rule stops mattering.
 *
 * Read once per artifact and quoted beside the floor: a floor chosen BELOW `destroys` is a fit to this corpus, and a
 * floor chosen above it is a rule whose direction has been checked on every case the corpus carries. The distance
 * between the two numbers is what a reader needs to decide whether a saving has been proved or merely observed.
 */
export function ruleEdges(rows: readonly CostRow[]): RuleEdges {
  const margins = marginsOf(rows);
  let destroys: number | null = null;
  let repairs: number | null = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const margin = margins[index];
    if (margin === null || margin === undefined) continue;
    const right = engineRight(row);
    if (right === row.correct) continue;
    if (right) {
      if (repairs === null || margin > repairs) repairs = margin;
    } else if (destroys === null || margin > destroys) destroys = margin;
  }
  return { destroys, repairs };
}

/**
 * The floor that skips the most cases without losing one.
 *
 * Derived from {@link ruleEdges} rather than from its own walk, so the floor it returns and the floor {@link skipAt}
 * prices cannot be two different rules: the lowest threshold with zero losses is exactly the highest margin at which
 * the engine's answer would have destroyed a correct one, and the reading below is `skipAt` at that threshold. The
 * earlier version walked the sorted margins and stopped at the first net-negative step, which answers a different
 * question — a floor can be net-negative and still be quoting a threshold one case away from the one it measured.
 *
 * Returns `null` when the answer skips nothing: a floor that silences no case is not a saving, and reporting one as
 * the "loss-free floor" would put a zero in the column a reader scans for the decision.
 */
export function lossFreeFloor(
  rows: readonly CostRow[],
  rates: TokenRates = DEEPSEEK_CHAT_RATES,
): SkipReading | null {
  const margins = marginsOf(rows).filter((margin): margin is number => margin !== null);
  if (margins.length === 0) return null;
  const { destroys } = ruleEdges(rows);
  // Nothing is ever destroyed: the rule is loss-free at every threshold, so the maximal saving is the one that
  // silences every case with a measured margin.
  const floor = destroys ?? Math.min(...margins) - Number.EPSILON;
  const reading = skipAt(rows, floor, rates);
  return reading.skipped === 0 ? null : reading;
}
