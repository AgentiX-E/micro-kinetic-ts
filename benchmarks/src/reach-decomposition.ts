/**
 * The retrieval decomposition, split by what the arm did — the second axis of the schedule argument.
 *
 * ## Why the field's headline number does not transfer
 *
 * `DecompRCA v2` reports microservice retrieval as "nearly solved (98–100 %)" and concludes that the bottleneck is
 * downstream of retrieval. On this corpus that sentence is true of exactly one population and false of the other, and
 * the two populations are separated by a column the arm's own artifact carries:
 *
 * | split | n | `Retrieval@1` | `@5` | `@10` |
 * | ----- | -: | ------------: | ---: | ----: |
 * | the arm queried the culprit | 1 198 | 88.23 % | **99.25 %** | 99.67 % |
 * | it never did | 224 | 7.14 % | **26.79 %** | 37.50 % |
 *
 * The first row is the field's number and it is real. The second is the population the 74 published misses come from,
 * and retrieval there is not solved at all. One number over the whole corpus (87.79 % at five) averages a solved
 * problem with an unsolved one, which is why the split is the reading rather than a refinement of it.
 *
 * ## What the split proves about the schedule
 *
 * The two rows are also the mechanism. `Retrieval@1 = 88.23 %` inside the queried split against `7.14 %` outside it
 * says the arm looks where the engine points — it spends its 1.888 distinct-service calls on the engine's first
 * positions — so the misses it never investigated are the ones the engine ranked third to fifth, exactly the slots a
 * schedule of width five adds. That is the causal chain behind `schedule-not-seed-342.md` §1.2, measured rather than
 * argued, and it is why the schedule is a selector and not a ranker.
 *
 * ## The refusals
 *
 * * A row with no `calls` column is its own split, never folded into "unqueried": an absent record is not a negative
 *   one, and this is the third instrument in a row to make that distinction.
 * * A split with no cases reports `null` rates rather than zero, because a rate over an empty population is the defect
 *   the cutoff module's census reader already refuses.
 * * A truth the pool never held counts against retrieval and cannot count for it: the rate's denominator is the split's
 *   whole population, so an unreachable label lowers retrieval, which is what "retrieval failed" means.
 *
 * @module benchmarks/reach-decomposition
 */

import { positionOf, type ScheduledCase } from './investigation-schedule.js';

/** The three populations an arm's own call record separates. */
export const REACH_SPLITS = ['queried', 'unqueried', 'unrecorded'] as const;

/** One split's name. */
export type ReachSplit = (typeof REACH_SPLITS)[number];

/** Which split a case belongs to, from its own call record. */
export function splitOf(one: ScheduledCase): ReachSplit {
  if (one.calls === null) return 'unrecorded';
  return one.calls.some((name) => one.truth.includes(name)) ? 'queried' : 'unqueried';
}

/** One split's `Retrieval@k` and `Rerank@1`. */
export interface SplitReading {
  /** The population. */
  readonly split: ReachSplit;
  /** Cases in it. */
  readonly cases: number;
  /** Cases whose nearest acceptable answer sits inside the first `k` positions. */
  readonly retrieved: number;
  /** Cases whose nearest acceptable answer sits at position 1. */
  readonly atOne: number;
  /** Cases the surface answered correctly — carried so a split can be read against its own outcome. */
  readonly hits: number;
  /** `retrieved / cases`, or `null` for an empty split. */
  readonly retrieval: number | null;
  /** `atOne / retrieved`, or `null` when nothing was retrieved. */
  readonly rerank: number | null;
}

/**
 * Split one population by the arm's own record, at one cutoff.
 *
 * The cutoff is a parameter rather than a constant because the two published comparisons use different ones: this
 * repository reports `Avg@5` and `Retrieval@5`, and a schedule of width five is defined at the same edge. `k` must be
 * a positive integer; anything else is refused rather than floored, since a cutoff of zero would make every rate zero
 * and read as a retrieval failure.
 *
 * @param cases - The population, each case with its engine order.
 * @param k - The cutoff.
 * @returns One reading per split, in {@link REACH_SPLITS} order.
 */
export function reachDecompositionOf(cases: readonly ScheduledCase[], k: number): SplitReading[] {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`the cutoff must be a positive integer, got ${String(k)}`);
  }
  const tally = new Map<
    ReachSplit,
    { cases: number; retrieved: number; atOne: number; hits: number }
  >();
  for (const split of REACH_SPLITS) tally.set(split, { cases: 0, retrieved: 0, atOne: 0, hits: 0 });
  for (const one of cases) {
    const bucket = tally.get(splitOf(one))!;
    bucket.cases += 1;
    if (one.correct) bucket.hits += 1;
    const position = positionOf(one.order, one.truth);
    if (position !== null && position <= k) bucket.retrieved += 1;
    if (position === 1) bucket.atOne += 1;
  }
  return REACH_SPLITS.map((split) => {
    const bucket = tally.get(split)!;
    return {
      split,
      cases: bucket.cases,
      retrieved: bucket.retrieved,
      atOne: bucket.atOne,
      hits: bucket.hits,
      retrieval: bucket.cases === 0 ? null : bucket.retrieved / bucket.cases,
      rerank: bucket.retrieved === 0 ? null : bucket.atOne / bucket.retrieved,
    };
  });
}

/** A rate, or the word that says the population was empty rather than the rate zero. */
function rate(value: number | null): string {
  return value === null ? 'undefined' : `${(100 * value).toFixed(2)} %`;
}

/**
 * The split as a table.
 *
 * The first line names the two things a reader would otherwise assume: that the cutoff is the same for every row, and
 * that `unrecorded` is a population and not a rounding of `unqueried`.
 *
 * @param rows - The readings.
 * @param k - The cutoff they were taken at.
 * @returns The table.
 */
export function formatReachDecomposition(rows: readonly SplitReading[], k: number): string {
  const lines = [
    `retrieval at ${String(k)}, split by what the arm's own record says it did`,
    `${'split'.padEnd(11)} ${'n'.padStart(5)}  ${'Retrieval@k'.padStart(12)}  ${'Rerank@1'.padStart(9)}  ` +
      `${'hits'.padStart(5)}`,
  ];
  for (const one of rows) {
    lines.push(
      `${one.split.padEnd(11)} ${String(one.cases).padStart(5)}  ${rate(one.retrieval).padStart(12)}  ` +
        `${rate(one.rerank).padStart(9)}  ${String(one.hits).padStart(5)}`,
    );
  }
  const observed = rows.filter((one) => one.split !== 'unrecorded');
  const cases = observed.reduce((sum, one) => sum + one.cases, 0);
  const retrieved = observed.reduce((sum, one) => sum + one.retrieved, 0);
  lines.push(
    `the two observed splits: ${String(retrieved)} of ${String(cases)} cases have the culprit inside the first ` +
      `${String(k)} (${rate(cases === 0 ? null : retrieved / cases)}) — one number over the whole corpus averages ` +
      'a solved population with an unsolved one',
  );
  const absent = rows.find((one) => one.split === 'unrecorded')!;
  if (absent.cases === 0) {
    lines.push('no row lacks a call column, so the two observed splits are the whole population');
  } else {
    lines.push(
      `${String(absent.cases)} rows carry no call column: unmeasured, and therefore in neither observed split`,
    );
  }
  return lines.join('\n');
}
