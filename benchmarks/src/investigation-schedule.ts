/**
 * The investigation's SCHEDULE: which service to look at next, held by the harness instead of shown in the prompt.
 *
 * ## The distinction this module exists to draw
 *
 * Iteration 318 measured a **seeded** arm — the engine's order printed into the prompt — and it scored *worse* than
 * the free arm. The reason is not mysterious once the two mechanisms are named: a list in the prompt invites the
 * model to anchor on its first entry and to re-rank it, which is the shape this repository has already priced at
 * chance (`z = −9.26` over 5 335 claims). A **schedule** is the other thing entirely: the order stays in the
 * harness, the model asks for "the next one" and receives one service, and nothing in its prompt discloses the
 * sequence it is following. Same information budget, different reader.
 *
 * Iteration 341 found the population this is aimed at: of the 94 published misses, **74 never queried the labelled
 * culprit at all** (5.20 % of the corpus) while the evidence sat in the case's own `metrics` and `traceEdges` in
 * every one of them, and the arm spent 4.99 of its ten allowed tool calls. That is not a budget failure and not a
 * reasoning failure by construction; it is a *selection* failure, and a schedule is the cheapest instrument that
 * can act on one.
 *
 * ## Two numbers, and why printing only the first would be a lie
 *
 * `reachable` is a **structural ceiling**: the misses whose culprit sits inside the first `width` positions of the
 * engine's own order, i.e. the cases a schedule of that width would have queried. It is not an expectation, because
 * querying a service is not the same act as reading it — 20 of the 74 misses in 341 *did* query the culprit and
 * still answered wrong. So this module also reports the **conversion** measured on the cases where the arm did query
 * the culprit (`hitsQueried / (hitsQueried + queriedMisses)`), and multiplies the ceiling by it. The product is a
 * point estimate; the ceiling is an upper bound; the two are printed one under the other, and a test asserts that a
 * conversion below one makes them differ. A reader who took the ceiling for the estimate would over-report by the
 * exact size of the reasoning residue.
 *
 * The conversion carries a selection effect in the honest direction and it is stated rather than corrected: a case
 * the model chose to investigate is not a random case, so the rate is measured on investigations the model *wanted*
 * to make. That is the right rate for this decision anyway — a schedule does not change who the model is, only
 * where it looks — but the number is a property of this artifact and not a law, and `formatConversion` says so.
 *
 * ## What this module refuses to do
 *
 * * It does not re-rank. `positionOf` reads the engine's order as given; a schedule that sorted it would be a second
 *   ranker and every number here would be a statement about that ranker instead.
 * * It does not drop an unmeasured row into a measured bucket. A miss with no `calls` column is `unrecordedMisses`,
 *   never `unqueriedMisses` — the defect 340's certainty census was written to close, in its third appearance.
 * * It does not call a case reachable when the pool never held the answer. `positionOf` returns `null` there, and
 *   `null` is the `unreachable` bucket, not position infinity.
 *
 * @module benchmarks/investigation-schedule
 */

import { DEFAULT_QUERY_BUDGET, type QueryBudget } from './query-agent.js';

/**
 * The calls a budget can actually EXECUTE, which is not the same as the number it states.
 *
 * The loop takes the last of its turns as an answer-only turn (`forcing` when `rounds === maxRounds`), so an arm
 * configured with six rounds executes at most **five** tool calls however many `maxToolCalls` allows. Read off the
 * shipped artifact rather than argued: 1 416 of 1 422 rows carry exactly five calls and the other six carry four, and
 * not one carries more.
 *
 * This is the correction that re-prices the whole schedule question. `DEFAULT_QUERY_BUDGET` states ten calls and six
 * rounds, so the second number was never reachable and the first was never binding; the budget the arm actually
 * spends is five, and a schedule's zero-cost width is five — not ten. Iteration 341 read "4.99 of ten, stopped early
 * with half its budget unspent" off the stated number, and that sentence is withdrawn here: 4.99 of five is a budget
 * spent to the last call.
 *
 * @param budget - Rounds, calls and transcript size.
 * @returns The number of tool calls the loop can execute, `≥ 0`.
 */
export function usableCallsOf(budget: QueryBudget): number {
  return Math.max(0, Math.min(budget.maxToolCalls, budget.maxRounds - 1));
}

/**
 * How many services a schedule can look at for the SHIPPED budget — five, because that is what the loop can spend.
 *
 * A width of ten is reachable, but only by widening `maxRounds` to eleven, which doubles the model calls per case and
 * therefore the price of every reading taken at that width. The two widths are kept as two readings rather than one
 * number: `scheduleReadingOf(cases, 5)` answers "what does a schedule buy for the budget already authorised", and
 * `scheduleReadingOf(cases, 10)` answers "what would the next five calls buy" — a question with a price attached.
 */
export const SCHEDULE_WIDTH = usableCallsOf(DEFAULT_QUERY_BUDGET);

/** One case, in the fields a schedule reading needs. */
export interface ScheduledCase {
  /** Stable case id, carried so a report can name the case it is about. */
  readonly datapack: string;
  /** The labelled services, any of which is a correct answer. */
  readonly truth: readonly string[];
  /** Candidate ids in the ENGINE's order, best first. A tie keeps the producer's order. */
  readonly order: readonly string[];
  /** Whether the surface being measured answered the case correctly. */
  readonly correct: boolean;
  /** The services the arm queried, or `null` when the artifact carries no such column. */
  readonly calls: readonly string[] | null;
}

/**
 * The calls a schedule of this width would make, in order.
 *
 * De-duplicated at first occurrence and with empty names dropped, because both are rank arithmetic rather than
 * cosmetics: a repeated id would consume a slot of the budget and a blank would consume one without naming anything.
 * The same rule `seedNames` applies to a prompt, applied here to a dispatch.
 *
 * @param order - Candidate ids, best first.
 * @param width - How many calls the schedule may spend.
 * @returns At most `width` distinct, non-empty ids.
 */
export function scheduleOf(order: readonly string[], width: number = SCHEDULE_WIDTH): string[] {
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`the schedule width must be a non-negative integer, got ${String(width)}`);
  }
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (kept.length >= width) break;
    if (id === '') continue;
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

/**
 * Where the earliest labelled culprit sits in the engine's order, one-based, or `null` when the order cannot hold it.
 *
 * The MINIMUM over the truth set rather than the first member of it, because a case with two acceptable answers is
 * reached as soon as either is, and reading the first entry of the label list would report one label's position as
 * the case's. `null` is not "infinitely far": it is the pool refusal, and the two are different findings — a pool
 * failure cannot be fixed by any schedule, while a position of 21 can be fixed by a wider one.
 *
 * @param order - Candidate ids, best first.
 * @param truth - The labelled services.
 * @returns The one-based position, or `null`.
 */
export function positionOf(order: readonly string[], truth: readonly string[]): number | null {
  let best: number | null = null;
  for (const [index, id] of order.entries()) {
    if (!truth.includes(id)) continue;
    // First occurrence wins, and the loop stops: a later duplicate cannot be nearer than the one already found.
    best = index + 1;
    break;
  }
  return best;
}

/** The buckets a missed, unqueried case's position is reported in. Fixed edges, so two readings can be compared. */
export const REACH_BUCKETS = ['top5', 'top10', 'top20', 'beyond', 'unreachable'] as const;

/** One bucket's name. */
export type ReachBucket = (typeof REACH_BUCKETS)[number];

/**
 * The bucket a position falls in.
 *
 * The edges are 5, 10 and 20 rather than a function of the width, because the buckets answer a different question
 * from the width: the width says what THIS schedule spends, the buckets say how deep the engine had to go. With the
 * shipped width of ten they agree on the first two, and a width of five moves only `reachableUnqueried`.
 *
 * @param position - A one-based position, or `null` for a truth the pool never held.
 * @returns The bucket.
 */
export function bucketOf(position: number | null): ReachBucket {
  if (position === null) return 'unreachable';
  if (position <= 5) return 'top5';
  if (position <= 10) return 'top10';
  if (position <= 20) return 'top20';
  return 'beyond';
}

/** What one artifact's misses say about where a schedule would have taken the investigation. */
export interface ScheduleReading {
  /** The width the reading was taken at. */
  readonly width: number;
  /** Answer rows read. */
  readonly cases: number;
  /** Rows answered correctly. */
  readonly hits: number;
  /** `cases − hits`. */
  readonly misses: number;
  /** Misses whose truth the arm queried and still got wrong — the population a schedule cannot add to. */
  readonly queriedMisses: number;
  /** Misses it never queried — the population a schedule acts on. */
  readonly unqueriedMisses: number;
  /** Misses with no `calls` column, which are neither of the two above. */
  readonly unrecordedMisses: number;
  /** Of {@link unqueriedMisses}, the ones inside the first `width` positions — the structural ceiling. */
  readonly reachableUnqueried: number;
  /** Of {@link unqueriedMisses}, the ones past the width but inside the pool. */
  readonly beyondUnqueried: number;
  /** Of {@link unqueriedMisses}, the ones the pool never held. */
  readonly unreachableUnqueried: number;
  /** Hits whose truth the arm queried — the numerator of the conversion below. */
  readonly hitsQueried: number;
  /** Hits whose truth it never queried. */
  readonly hitsUnqueried: number;
  /** The position distribution of {@link unqueriedMisses}, one count per bucket. */
  readonly buckets: Readonly<Record<ReachBucket, number>>;
}

/**
 * Read an artifact against a schedule of this width.
 *
 * @param cases - Every answer row, each with the case's engine order.
 * @param width - How many calls the schedule may spend.
 * @returns The reading.
 */
export function scheduleReadingOf(
  cases: readonly ScheduledCase[],
  width: number = SCHEDULE_WIDTH,
): ScheduleReading {
  if (!Number.isInteger(width) || width < 0) {
    throw new Error(`the schedule width must be a non-negative integer, got ${String(width)}`);
  }
  let hits = 0;
  let queriedMisses = 0;
  let unqueriedMisses = 0;
  let unrecordedMisses = 0;
  let reachableUnqueried = 0;
  let beyondUnqueried = 0;
  let unreachableUnqueried = 0;
  let hitsQueried = 0;
  let hitsUnqueried = 0;
  const buckets: Record<ReachBucket, number> = {
    top5: 0,
    top10: 0,
    top20: 0,
    beyond: 0,
    unreachable: 0,
  };
  for (const one of cases) {
    const asked = one.calls === null ? null : one.calls.some((name) => one.truth.includes(name));
    if (one.correct) {
      hits += 1;
      if (asked === true) hitsQueried += 1;
      else hitsUnqueried += 1;
      continue;
    }
    if (asked === null) {
      unrecordedMisses += 1;
      continue;
    }
    if (asked) {
      queriedMisses += 1;
      continue;
    }
    unqueriedMisses += 1;
    const position = positionOf(one.order, one.truth);
    buckets[bucketOf(position)] += 1;
    if (position !== null && position <= width) reachableUnqueried += 1;
    else if (position === null) unreachableUnqueried += 1;
    else beyondUnqueried += 1;
  }
  return {
    width,
    cases: cases.length,
    hits,
    misses: cases.length - hits,
    queriedMisses,
    unqueriedMisses,
    unrecordedMisses,
    reachableUnqueried,
    beyondUnqueried,
    unreachableUnqueried,
    hitsQueried,
    hitsUnqueried,
    buckets,
  };
}

/** A count with a thin space between thousands, matching the register's own tables. */
function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** A share, or the word that says the denominator was empty rather than zero. */
function share(numerator: number, denominator: number): string {
  if (denominator === 0) return 'undefined — the denominator is empty';
  return `${((100 * numerator) / denominator).toFixed(2)} %`;
}

/**
 * The reading as lines a report can carry.
 *
 * Three lines, each a different question: where the misses sat, what a schedule reaches, and what it cannot reach.
 * The third is not decoration — it is the 20 cases whose failure is reasoning rather than reach, and a schedule's
 * report that omitted them would be read as a claim over all 94.
 *
 * @param reading - The reading.
 * @returns The lines.
 */
export function formatScheduleReading(reading: ScheduleReading): string {
  const {
    width,
    cases,
    hits,
    misses,
    queriedMisses,
    unqueriedMisses,
    unrecordedMisses,
    reachableUnqueried,
    beyondUnqueried,
    unreachableUnqueried,
    buckets,
  } = reading;
  if (cases === 0) return 'schedule reach: 0 answers';
  const lines = [
    `schedule reach at width ${String(width)} — ${count(cases)} answers, ${count(hits)} hits, ` +
      `${count(misses)} misses`,
    `  the ${count(unqueriedMisses)} misses that never queried the culprit sit at: top 5 ${count(buckets.top5)}, ` +
      `6–10 ${count(buckets.top10)}, 11–20 ${count(buckets.top20)}, beyond 20 ${count(buckets.beyond)}, ` +
      `not in the pool ${count(buckets.unreachable)}`,
    `  inside the first ${String(width)}: ${count(reachableUnqueried)} of ${count(unqueriedMisses)} ` +
      `(${share(reachableUnqueried, unqueriedMisses)}) — a stated schedule reaches ` +
      `${((100 * reachableUnqueried) / cases).toFixed(2)} pp of this corpus, and no more`,
    `  already queried it and still missed: ${count(queriedMisses)} — a schedule cannot add these`,
  ];
  if (unrecordedMisses > 0) {
    lines.push(
      `  rows with no call column: ${count(unrecordedMisses)} — unmeasured, and therefore in neither population`,
    );
  }
  if (beyondUnqueried > 0 || unreachableUnqueried > 0) {
    lines.push(
      `  past the width: ${count(beyondUnqueried)} inside the pool, ${count(unreachableUnqueried)} the pool ` +
        'never held',
    );
  }
  return lines.join('\n');
}

/**
 * What the ceiling becomes once the arm's own record of reading is applied.
 *
 * `rate` is `hitsQueried / (hitsQueried + queriedMisses)`: among the investigations that DID query the culprit, the
 * share that answered correctly. `expected` multiplies the reachable population by it, and is a point estimate
 * rather than a guarantee for the two reasons the module header states — the population is self-selected, and a
 * scheduled query is not the same act as a chosen one.
 */
export interface ConversionReading {
  /** Investigations that queried the culprit: {@link ScheduleReading.hitsQueried} plus `queriedMisses`. */
  readonly queried: number;
  /** Of those, the ones that answered correctly. */
  readonly converted: number;
  /** `converted / queried`, or `null` when nothing in the artifact queried the culprit. */
  readonly rate: number | null;
  /** `reachableUnqueried × rate`, or `null` when {@link rate} is `null`. */
  readonly expected: number | null;
}

/**
 * Derive the conversion from a reading.
 *
 * @param reading - The reading.
 * @returns The conversion.
 */
export function conversionOf(reading: ScheduleReading): ConversionReading {
  const queried = reading.hitsQueried + reading.queriedMisses;
  if (queried === 0) return { queried: 0, converted: 0, rate: null, expected: null };
  const rate = reading.hitsQueried / queried;
  return {
    queried,
    converted: reading.hitsQueried,
    rate,
    expected: reading.reachableUnqueried * rate,
  };
}

/**
 * The conversion as lines, with the two numbers kept apart.
 *
 * The wording is the point of this function: `ceiling` and `point estimate` are printed on the two numbers, because
 * a report that showed only the first would claim the 20 reasoning failures the schedule cannot touch.
 *
 * @param reading - The reading the conversion was derived from.
 * @param conversion - The conversion.
 * @returns Two or three lines.
 */
export function formatConversion(reading: ScheduleReading, conversion: ConversionReading): string {
  if (conversion.rate === null) {
    return (
      'conversion: undefined — no investigation in this artifact queried the culprit, so the ceiling stands ' +
      'unadjusted'
    );
  }
  const rate = `${(100 * conversion.rate).toFixed(2)} %`;
  const head =
    `conversion on the investigations that DID query the culprit: ${count(conversion.converted)} of ` +
    `${count(conversion.queried)} answered correctly (${rate})`;
  if (reading.reachableUnqueried === 0) {
    return `${head}\n  nothing is reachable at width ${String(reading.width)}, so there is nothing to convert`;
  }
  const expected = conversion.expected!;
  // `reading.cases > 0` here is not an assumption: `reachableUnqueried > 0` means at least one answer row exists, and
  // the empty case returned above. A zero-denominator guard would be a branch no corpus can reach, and this package
  // does not report an unreachable branch as coverage.
  const pp = ((100 * expected) / reading.cases).toFixed(2);
  return [
    head,
    `  ${count(reading.reachableUnqueried)} reachable × ${rate} = ${expected.toFixed(2)} cases — ${pp} pp, a ` +
      `POINT estimate; ${((100 * reading.reachableUnqueried) / reading.cases).toFixed(2)} pp is the ceiling`,
  ].join('\n');
}
