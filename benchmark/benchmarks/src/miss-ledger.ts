/**
 * The miss ledger: every remaining miss, named, and the rules that were priced against it.
 *
 * ## Why the surface needs a ledger rather than a count
 *
 * The shipped surface answers 1 328 of 1 422 cases. The 94 that are left are not one population, and every earlier
 * plan that priced "the misses" over-paid for that reason: a case whose truth the model never saw cannot be repaired
 * by a prompt, a case a channel settled without the model cannot be repaired by a wider seed, and a case the engine
 * led with the truth is the price of a rule that earns far more than it costs. The ledger separates the three by
 * fields the product already writes, so the classification is a join and not an experiment.
 *
 * ## Why the promotion sweep belongs here
 *
 * The obvious repair for the precedence residue is "publish the engine's own first choice when the pipeline moved
 * away from it". The register has refuted three variants of that family (§331 on the answer's loudness, §332 on the
 * head, §336 on the margin), and this module prices the remaining three at once, on the shipped surface, so the next
 * iteration does not have to rediscover that a promotion rule is not free. A rule's price is `repairs − breaks` over
 * the whole corpus, and its honesty is its precision on the population it fires upon.
 *
 * ## Why the concentration statistic is here and does not ship
 *
 * §336 named the next axis as the margin's **stability** — whether a case is decided by one number at the injection
 * time or by the whole window. The cheapest reading of "one number" is the score's own term decomposition: the score
 * is a weighted sum, so the share of the margin carried by its largest single term is exactly computable per case.
 * The module reports that share for the cases the guard repairs and for the cases it breaks, and `separates` states
 * whether any floor on it can keep the first and drop the second. On this corpus it cannot, and the register records
 * the refutation rather than a constant.
 *
 * @module benchmarks/miss-ledger
 */

import { SEED_WIDTH } from './retrieval-block.js';

/** Which of the three failures a miss is, read from the row the product publishes. */
export type LedgerClass = 'hit' | 'engine-was-right' | 'seen-not-taken' | 'breadth' | 'absent';

/** Every class but the hit. */
export type MissClass = Exclude<LedgerClass, 'hit'>;

/** The class order the cross-tab is printed in: the residue first, the two budgets last. */
export const CLASS_ORDER: readonly MissClass[] = [
  'engine-was-right',
  'seen-not-taken',
  'breadth',
  'absent',
];

/** The ratio below which an answer is "quiet" against the engine's own first choice. */
export const QUIET_ANSWER_RATIO = 0.5;

/** One case, in the fields the ledger reads. Every optional column may be absent on an older artifact. */
export interface LedgerCase {
  readonly datapack: string;
  /** The labelled services, any of which is a correct answer. */
  readonly truth: readonly string[];
  /** What the pipeline published, after every rule that precedes the guard this module prices. */
  readonly published: string | null;
  /** Which channel settled the published answer. */
  readonly answeredBy: string;
  /** The engine's own first choice, or `null` when the artifact does not carry one. */
  readonly engineTop1: string | null;
  /** The truth's best rank among the engine's FULL candidates, or `null` when it is not a candidate. */
  readonly truthRank: number | null;
  /** The engine's margin between its first two published candidates, or unmeasured. */
  readonly margin?: number | null | undefined;
  /** Per-term contributions of the first published candidate, or absent when unmeasured. */
  readonly top1Terms?: Readonly<Record<string, number>> | undefined;
  /** Per-term contributions of the second published candidate, or absent when unmeasured. */
  readonly top2Terms?: Readonly<Record<string, number>> | undefined;
  /** The candidate names the model's own raw answer carried, or absent when the model never answered. */
  readonly rawNames?: readonly string[] | undefined;
  /** The published answer's own self-anomaly term, or unmeasured. */
  readonly answerAnomaly?: number | null | undefined;
  /** The engine's first choice's self-anomaly term, or unmeasured. */
  readonly engineAnomaly?: number | null | undefined;
}

/** One row of the class × channel cross-tab. */
export interface ChannelRow {
  readonly class: MissClass;
  readonly channel: string;
  readonly cases: number;
}

/** The corpus, split by cause and by the channel that settled each miss. */
export interface Ledger {
  readonly cases: number;
  readonly hit: number;
  readonly misses: number;
  readonly classes: Readonly<Record<MissClass, number>>;
  readonly byClassAndChannel: readonly ChannelRow[];
  /**
   * The breadth misses no seed widening can reach, because a channel that does not read the seed answered them.
   *
   * This is the number the next plan reads: widening pays tokens on every case it is applied to, and on these rows
   * the model is never asked, so the widening would buy nothing at any width.
   */
  readonly unwidenable: number;
}

/** Whether the published answer is one of the labelled services. */
function isHit(one: LedgerCase): boolean {
  return one.published !== null && one.truth.includes(one.published);
}

/**
 * Which failure a case is, or a hit.
 *
 * The rank is the truth's rank among the engine's whole candidate list, not among the seed: a case whose truth sits
 * at rank 6 is a breadth failure whatever width the arm happened to be shown, and reading the seed here would move
 * cases between two classes whenever a configuration changed.
 *
 * @param one - The case.
 * @returns The class.
 */
export function classOf(one: LedgerCase): LedgerClass {
  if (isHit(one)) return 'hit';
  if (one.truthRank === null) return 'absent';
  if (one.truthRank === 1) return 'engine-was-right';
  if (one.truthRank <= SEED_WIDTH) return 'seen-not-taken';
  return 'breadth';
}

/** The comparison used for keys, stated rather than left to the locale. */
function byClassThenChannel(a: ChannelRow, b: ChannelRow): number {
  const classDelta = CLASS_ORDER.indexOf(a.class) - CLASS_ORDER.indexOf(b.class);
  if (classDelta !== 0) return classDelta;
  // Two rows of one class can never share a channel: the map's key is the pair, so the equality arm
  // would be a branch no input reaches.
  return a.channel < b.channel ? -1 : 1;
}

/**
 * The corpus, split.
 *
 * @param cases - Every case on the surface.
 * @returns The ledger.
 */
export function ledgerOf(cases: readonly LedgerCase[]): Ledger {
  const classes: Record<MissClass, number> = {
    'engine-was-right': 0,
    'seen-not-taken': 0,
    breadth: 0,
    absent: 0,
  };
  const channels = new Map<string, ChannelRow>();
  let hit = 0;
  let unwidenable = 0;
  for (const one of cases) {
    const label = classOf(one);
    if (label === 'hit') {
      hit += 1;
      continue;
    }
    classes[label] += 1;
    const key = `${label}\u0000${one.answeredBy}`;
    const row = channels.get(key);
    if (row === undefined) channels.set(key, { class: label, channel: one.answeredBy, cases: 1 });
    else channels.set(key, { ...row, cases: row.cases + 1 });
    // Every channel but the model answers without reading the seed, so no width reaches these rows.
    if (label === 'breadth' && one.answeredBy !== 'model') unwidenable += 1;
  }
  const misses =
    classes['engine-was-right'] + classes['seen-not-taken'] + classes.breadth + classes.absent;
  return {
    cases: cases.length,
    hit,
    misses,
    classes,
    byClassAndChannel: [...channels.values()].sort(byClassThenChannel),
    unwidenable,
  };
}

/** The promotion rules this module prices. */
export type PromotionName =
  'model-agrees-with-engine' | 'engine-over-model' | 'engine-over-any' | 'engine-over-quiet-answer';

/** One rule's price over the corpus. */
export interface PromotionReading {
  readonly rule: PromotionName;
  readonly fires: number;
  readonly repairs: number;
  readonly breaks: number;
  readonly precision: number | null;
}

/** The rules, in the order they are printed. */
const PROMOTIONS: readonly PromotionName[] = [
  'model-agrees-with-engine',
  'engine-over-model',
  'engine-over-any',
  'engine-over-quiet-answer',
];

/** Whether a number was measured rather than left absent. */
function measured(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Whether a rule fires on a case, given the engine's first choice as the candidate to promote.
 *
 * Every rule refuses a case the pipeline already agreed with the engine on: there is nothing to promote, and counting
 * it as a fire would inflate the denominator with rows the rule cannot help or hurt.
 */
function promotionFires(rule: PromotionName, one: LedgerCase): boolean {
  const candidate = one.engineTop1;
  if (candidate === null) return false;
  if (candidate === one.published) return false;
  switch (rule) {
    case 'model-agrees-with-engine':
      return (one.rawNames ?? []).includes(candidate);
    case 'engine-over-model':
      return one.answeredBy === 'model';
    case 'engine-over-any':
      return true;
    case 'engine-over-quiet-answer': {
      const answer = one.answerAnomaly;
      const engine = one.engineAnomaly;
      if (!measured(answer) || !measured(engine)) return false;
      if (engine <= 0) return false;
      return answer / engine < QUIET_ANSWER_RATIO;
    }
  }
}

/**
 * Price every promotion rule on one corpus.
 *
 * @param cases - Every case on the surface.
 * @returns One reading per rule, in {@link PROMOTIONS}'s order, including the rules that never fired.
 */
export function promotionReadings(cases: readonly LedgerCase[]): readonly PromotionReading[] {
  return PROMOTIONS.map((rule) => {
    let fires = 0;
    let repairs = 0;
    let breaks = 0;
    for (const one of cases) {
      if (!promotionFires(rule, one)) continue;
      fires += 1;
      const candidate = one.engineTop1!;
      const candidateRight = one.truth.includes(candidate);
      const publishedRight = isHit(one);
      if (candidateRight && !publishedRight) repairs += 1;
      if (publishedRight && !candidateRight) breaks += 1;
    }
    // Precision is read on the cases the rule MOVES, not on the cases it fires upon: a promotion of a
    // case the pipeline was already wrong about changes nothing, and counting it would let a rule with
    // one repair and eight hundred no-ops report itself as accurate.
    const decided = repairs + breaks;
    return { rule, fires, repairs, breaks, precision: decided === 0 ? null : repairs / decided };
  });
}

/** A distribution over a population, with the population's size stated beside it. */
export interface Spread {
  readonly measured: number;
  readonly min: number | null;
  readonly median: number | null;
  readonly max: number | null;
}

/** What the concentration statistic reads on the cases the guard moves. */
export interface StabilityReading {
  readonly bar: number;
  /** The cases the guard would move at this bar. */
  readonly fired: number;
  readonly repairs: Spread;
  readonly breaks: Spread;
  /** Whether a floor on the concentration keeps every repair and drops every break. */
  readonly separates: boolean;
}

/** Three decimals: enough to see a 1 % difference, few enough to compare by eye. */
function round3(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

/**
 * The share of the margin carried by its largest single term.
 *
 * `finalScore = log1p(selfAnomaly) + Σ weight × signal`, so the margin is a sum of per-term differences and the
 * largest of them measures how much of the decision rests on one instrument. `null` when the margin or the terms were
 * never measured, and `null` for a zero margin: a share of zero has no meaning, and `Infinity` would sort as decided.
 *
 * @param one - The case.
 * @returns The share, or `null`.
 */
export function separationConcentration(one: LedgerCase): number | null {
  const margin = one.margin;
  if (!measured(margin) || margin === 0) return null;
  const first = one.top1Terms;
  const second = one.top2Terms;
  if (first === undefined || second === undefined) return null;
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  if (keys.size === 0) return null;
  let widest = 0;
  for (const key of keys) {
    const difference = Math.abs((first[key] ?? 0) - (second[key] ?? 0));
    if (difference > widest) widest = difference;
  }
  return widest / Math.abs(margin);
}

/** The distribution of one population's concentrations, with nulls refused rather than counted as zero. */
function spreadOf(values: readonly (number | null)[]): Spread {
  const kept = values
    .filter((one): one is number => one !== null)
    .map(round3)
    .sort((a, b) => a - b);
  if (kept.length === 0) return { measured: 0, min: null, median: null, max: null };
  const middle =
    kept.length % 2 === 0
      ? (kept[kept.length / 2 - 1]! + kept[kept.length / 2]!) / 2
      : kept[(kept.length - 1) / 2]!;
  return {
    measured: kept.length,
    min: kept[0]!,
    median: round3(middle),
    max: kept[kept.length - 1]!,
  };
}

/**
 * Read the concentration statistic on the population the engine-certainty guard moves.
 *
 * @param cases - Every case, with `published` holding the answer the sweep for the guard is priced on.
 * @param bar - The margin above which the guard fires.
 * @returns The reading.
 */
export function stabilityReading(cases: readonly LedgerCase[], bar: number): StabilityReading {
  const repairShares: (number | null)[] = [];
  const breakShares: (number | null)[] = [];
  let fired = 0;
  for (const one of cases) {
    const margin = one.margin;
    if (!measured(margin) || margin <= bar) continue;
    const candidate = one.engineTop1;
    if (candidate === null || candidate === one.published) continue;
    fired += 1;
    const share = separationConcentration(one);
    const candidateRight = one.truth.includes(candidate);
    const publishedRight = isHit(one);
    if (candidateRight && !publishedRight) repairShares.push(share);
    else if (publishedRight && !candidateRight) breakShares.push(share);
  }
  const repairs = spreadOf(repairShares);
  const breaks = spreadOf(breakShares);
  const disjoint =
    repairs.min !== null &&
    repairs.max !== null &&
    breaks.min !== null &&
    breaks.max !== null &&
    (repairs.max < breaks.min || breaks.max < repairs.min);
  return { bar, fired, repairs, breaks, separates: disjoint };
}

/** One aligned table, so the printed reading is the same shape everywhere in this programme. */
function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = headers.map((head, column) =>
    Math.max(head.length, ...rows.map((cells) => cells[column]!.length)),
  );
  // Every caller of this printer passes a full row for the header it asked for, so the index is total:
  // a `?? ''` here would be a branch that no input can reach, which is the kind of dead arm this
  // programme refuses to carry as coverage.
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column]!))
      .join('  ')
      .trimEnd();
  return [line(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)];
}

/** Render a precision, keeping "never fired" distinct from "always wrong". */
function showPrecision(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

/**
 * The ledger as text.
 *
 * @param ledger - The reading.
 * @returns The lines, joined by newlines.
 */
export function formatLedger(ledger: Ledger): string {
  const share = ledger.cases === 0 ? '0.00' : ((100 * ledger.hit) / ledger.cases).toFixed(2);
  const lines = [
    `${ledger.cases} cases, ${ledger.hit} hit (${share} %), ${ledger.misses} misses`,
    ...table(
      ['class', 'cases'],
      CLASS_ORDER.map((label) => [label, String(ledger.classes[label])]),
    ),
    '',
    ...table(
      ['class', 'channel', 'cases'],
      ledger.byClassAndChannel.map((one) => [one.class, one.channel, String(one.cases)]),
    ),
    '',
    `unwidenable ${ledger.unwidenable} — breadth misses a channel settled without reading the seed`,
  ];
  return lines.join('\n');
}

/**
 * The promotion sweep as text.
 *
 * @param readings - One reading per rule.
 * @returns The lines, joined by newlines.
 */
export function formatPromotion(readings: readonly PromotionReading[]): string {
  return table(
    ['rule', 'fires', 'repairs', 'breaks', 'delta', 'precision'],
    readings.map((one) => [
      one.rule,
      String(one.fires),
      String(one.repairs),
      String(one.breaks),
      `${one.repairs - one.breaks >= 0 ? '+' : ''}${one.repairs - one.breaks}`,
      showPrecision(one.precision),
    ]),
  ).join('\n');
}

/**
 * The concentration reading as text.
 *
 * @param reading - The reading.
 * @returns The lines, joined by newlines.
 */
export function formatStability(reading: StabilityReading): string {
  const show = (one: Spread): string =>
    one.measured === 0 ? '—' : `${one.measured} | ${one.min} / ${one.median} / ${one.max}`;
  const lines = [
    `bar ${reading.bar}: ${reading.fired} moved, ${reading.repairs.measured} repairs, ` +
      `${reading.breaks.measured} breaks`,
    ...table(
      ['population', 'measured | min / median / max'],
      [
        ['repairs', show(reading.repairs)],
        ['breaks', show(reading.breaks)],
      ],
    ),
    `separates ${reading.separates}`,
  ];
  return lines.join('\n');
}
