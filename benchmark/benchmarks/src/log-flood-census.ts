/**
 * The log flood census: what the log term's `1.0` is worth, read off the corpus rather than assumed.
 *
 * ## The question this exists to answer
 *
 * `computeLogScores` divides each service's admitted count by the case's largest admitted count, so the top
 * emitter is `1.0` BY CONSTRUCTION on every case that admits one line. `logWeight` is 1.0 — the largest single
 * weight in the ranking — and the term therefore claims its full price on a case whose entire fleet-wide
 * evidence is a single log line. Whether that is a defect is not a matter of taste: it depends on how many lines
 * a `1.0` usually stands for, on how often the ground truth is that emitter, and on how often the ground truth
 * admits NOTHING while a neighbour floods. Those are three properties of the corpus, and this module measures
 * them.
 *
 * The census reads the engine's own level-1 admission rule (`logLineAdmittedByMode`, imported rather than
 * re-spelled) and applies the same level and window filters the engine applies, so the counts it reports are the
 * counts the ranking divides — a census with a second spelling of the rule would be a census of the second
 * spelling. That is why the admission rule was made a module-level export in the first place, and
 * `docs/fse26-log-flood-verdict.md` is the record of what happens when a reader spells it again.
 *
 * ## What it refuses to collapse
 *
 * - A case with **no flood** is not a case with a quiet flood. Its weight is irrelevant because every score is
 *   zero, and folding it into the volume distribution would drag every quantile toward zero while the ranking
 *   never read a single one of those cases. `withFlood` and `zeroFlood` are therefore separate counts.
 * - A case where the truth **ties** for the top count is not a case where the truth is the emitter: `max` pays
 *   every tied service `1.0`, so the term has said "one of these" and not "this one". `tied` and
 *   `truthIsChampion` are separate counts for that reason, and `truthIsChampion` is computed as `atTruth == max`
 *   with `max > 0` so it cannot be satisfied by a case whose flood is empty.
 * - A `max` of one is reported (`atMostOne`) rather than left to the quantiles, because the corpus's median case
 *   admits EIGHT lines and a reader who reads only `p50` will not see the third of the corpus that admits one or
 *   none.
 *
 * ## Where the numbers land
 *
 * On FSE'26's second wave (711 datapacks, `--log-mode logicHttp`): median top count 8, 34.5% of cases at or below
 * one line, 32.3% with no flood at all, the truth the top emitter in 38.1%, and the truth SILENT under a
 * neighbour's flood in 16.9%. Those are the numbers `docs/log-volume-scale.md` reasons from, and the reason the
 * scale axis closes as a family: in the 16.9% the term's ideal weight is exactly zero and in the 38.1% it is at
 * least one, so the ideal is bimodal and no divisor can express it.
 *
 * @module benchmarks/log-flood-census
 */

import type { FaultLogEntry } from '../../packages/core/src/interfaces/rca-engine.js';
import {
  type LogSignalMode,
  logLineAdmittedByMode,
} from '../../packages/tree/src/pruning/ranking-signals.js';

/** One datapack's flood, counted exactly as the ranking counts it. */
export interface LogFloodInput {
  /** The case's identifier, carried for the row and never read. */
  readonly id: string;
  /** The fault type, so a population can be read per family rather than as a corpus average. */
  readonly faultType: string;
  /** The case's log lines, as the engine receives them (`undefined` = the case has no log channel). */
  readonly logs: readonly FaultLogEntry[] | undefined;
  /** The services in the case's call graph; a line from outside it is not a candidate. */
  readonly nodeIds: ReadonlySet<string>;
  /** Fault injection time in Unix milliseconds; `0` means unknown, and then no line is filtered by time. */
  readonly injectTimeMs: number;
  /** The ground-truth service ids the case is scored against. */
  readonly groundTruth: readonly string[];
}

/** One case's census row. */
export interface LogFloodRow {
  readonly id: string;
  readonly faultType: string;
  /** The largest admitted count in the case — the divisor `max`-normalisation uses. */
  readonly max: number;
  /** The admitted count summed across every service — the divisor `share` uses. */
  readonly total: number;
  /** How many services tie at `max`; every one of them is paid `1.0` by `max`. */
  readonly tied: number;
  /** The largest admitted count among the ground-truth services (`0` = the truth is log-silent). */
  readonly atTruth: number;
}

/** The corpus-level reading of a set of rows. */
export interface LogFloodSummary {
  /** Cases censused. */
  readonly cases: number;
  /** Cases that admit at least one line, i.e. the population the term can speak about at all. */
  readonly withFlood: number;
  /** Cases that admit no line: the term is identically zero and its weight is irrelevant. */
  readonly zeroFlood: number;
  /** Cases whose top count is at most one — the `1.0` that stands for a single line. */
  readonly atMostOne: number;
  /** Cases in which several services tie at the top and are all paid `1.0`. */
  readonly tiedCases: number;
  /** Cases where the ground truth IS the top emitter (necessary, not sufficient, for the term to be right). */
  readonly truthIsChampion: number;
  /** Cases where a flood exists and the ground truth admits NOTHING: the term can only point away. */
  readonly truthSilent: number;
  /** Quantiles of the top count over ALL censused cases, both flooding and silent. */
  readonly quantiles: {
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
    readonly p99: number;
  };
  /** Mean of `max / total` over the FLOODING cases: the weight `share` would claim on an average case. */
  readonly meanConcentration: number;
  /** Median of the same ratio. */
  readonly medianConcentration: number;
}

/**
 * Count one case's flood.
 *
 * @param input - The case's logs, graph membership, window and ground truth.
 * @param mode - The log-signal mode whose level-1 rule decides admission (default `logicHttp`, the shipped mode).
 * @returns The row, with `max`, `total`, `tied` and `atTruth` all zero on a case with no admitted line.
 */
export function censusLogFlood(
  input: LogFloodInput,
  mode: LogSignalMode = 'logicHttp',
): LogFloodRow {
  const counts = new Map<string, number>();
  for (const log of input.logs ?? []) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!input.nodeIds.has(log.service)) continue;
    if (input.injectTimeMs > 0 && log.timestamp < input.injectTimeMs) continue;
    if (!logLineAdmittedByMode(mode, log)) continue;
    counts.set(log.service, (counts.get(log.service) ?? 0) + 1);
  }

  const groundTruth = new Set(input.groundTruth);
  let max = 0;
  let total = 0;
  let atTruth = 0;
  for (const [service, count] of counts) {
    total += count;
    if (count > max) max = count;
    if (groundTruth.has(service) && count > atTruth) atTruth = count;
  }
  // Ties matter to `max`-normalisation and to nothing else: a tied top hands `1.0` to every member, so the
  // term has asserted "one of these" rather than "this one".
  let tied = 0;
  for (const count of counts.values()) {
    if (count === max && count > 0) tied += 1;
  }
  return { id: input.id, faultType: input.faultType, max, total, tied, atTruth };
}

/** Nearest-rank quantile of an ASCENDING array; `0` on an empty one rather than `undefined`. */
function quantile(ascending: readonly number[], fraction: number): number {
  if (ascending.length === 0) return 0;
  const index = Math.min(
    ascending.length - 1,
    Math.max(0, Math.round(fraction * (ascending.length - 1))),
  );
  return ascending[index]!;
}

/**
 * Summarise a set of rows.
 *
 * Quantiles are taken over ALL censused cases, because the question they answer is "how much evidence does a
 * `1.0` stand for on this corpus" and the silent cases are evidence of zero. The concentration statistics are
 * taken over the FLOODING cases only, because `max / total` is `0 / 0` on a silent one and reporting a mean that
 * had silently absorbed 230 zeros would understate the weight the arm claims wherever it acts.
 *
 * @param rows - The censused rows.
 * @returns The summary; every count is `0` and every statistic is `0` on an empty population.
 */
export function summariseLogFlood(rows: readonly LogFloodRow[]): LogFloodSummary {
  const ascending = rows.map((row) => row.max).sort((left, right) => left - right);
  const concentrations: number[] = [];
  let withFlood = 0;
  let atMostOne = 0;
  let tiedCases = 0;
  let truthIsChampion = 0;
  let truthSilent = 0;
  for (const row of rows) {
    if (row.max === 0) continue;
    withFlood += 1;
    if (row.max <= 1) atMostOne += 1;
    if (row.tied > 1) tiedCases += 1;
    if (row.atTruth === row.max) truthIsChampion += 1;
    if (row.atTruth === 0) truthSilent += 1;
    concentrations.push(row.max / row.total);
  }
  concentrations.sort((left, right) => left - right);
  const meanConcentration =
    concentrations.length === 0
      ? 0
      : concentrations.reduce((sum, value) => sum + value, 0) / concentrations.length;
  return {
    cases: rows.length,
    withFlood,
    zeroFlood: rows.length - withFlood,
    atMostOne,
    tiedCases,
    truthIsChampion,
    truthSilent,
    quantiles: {
      p25: quantile(ascending, 0.25),
      p50: quantile(ascending, 0.5),
      p75: quantile(ascending, 0.75),
      p90: quantile(ascending, 0.9),
      p99: quantile(ascending, 0.99),
    },
    meanConcentration,
    medianConcentration: quantile(concentrations, 0.5),
  };
}
