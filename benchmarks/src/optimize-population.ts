/**
 * What the L2 weight search's corpus actually contained, as data a test can check.
 *
 * ## Why this exists
 *
 * `optimize-rcaeval-results` reported `loaded 199 cases`, `split: train=140 val=27 test=32` and three
 * accuracies — and nothing about WHICH cases those were. Three questions a reader of that artifact cannot
 * answer, all of which decide whether its numbers mean what they appear to mean:
 *
 * 1. **Did the search see all three systems?** The down-sample preserves each `system:suite` stratum's share
 *    (`strata` are `ob:re1`, `ss:re2`, …), so it SHOULD — but an artifact that says "RCAEval" and reports one
 *    number cannot show it, and the thing being tuned is a set of weights applied to all three.
 * 2. **Is every fault type represented in the held-out splits?** The train/val/test split strata are
 *    `system:suite:fault` — 54 possible — and `val=27` / `test=32` cannot hold one case of each. Which fault
 *    types are MISSING from the set the "Generalization (held-out)" line is measured on is not a detail: a
 *    fault type absent from test contributes nothing to that number and nothing says so.
 * 3. **Was `rankNormalization` even acting on this corpus?** The engine's topology guard is
 *    `nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD`, so on a corpus of small graphs the rescale this repository
 *    keeps ON is INERT — and the previous iteration's prediction that the alignment would move this
 *    artifact's numbers could not be checked because the artifact never said how many cases were large
 *    enough for it to act.
 *
 * The third is the one that was actually load-bearing, and it is the reason this module takes the node count
 * rather than a summary of it: whether a run's flag acted is a property of the POPULATION, and a population
 * that is not stated cannot be reasoned about after the fact.
 *
 * @module benchmarks/optimize-population
 */

import { ANOMALY_NORMALIZE_NODE_THRESHOLD } from '../../packages/tree/src/index.js';

/** The parts of a loaded case this report needs. Structural, so a test needs no loader. */
export interface PopulationCase {
  /** `system:suite:fault` — the split's stratum key, as `run-optimize.ts` builds it. */
  readonly stratum: string;
  /** The case's service-graph node count; the guard compares it to the threshold. */
  readonly nodes: number;
}

/** A stratified summary, with every partition summing to the total it came from. */
export interface PopulationSummary {
  readonly total: number;
  readonly bySystem: Readonly<Record<string, number>>;
  readonly bySuite: Readonly<Record<string, number>>;
  readonly byFault: Readonly<Record<string, number>>;
  /**
   * The cases at or above {@link ANOMALY_NORMALIZE_NODE_THRESHOLD} nodes — the only ones on which the
   * rank-normalization flag can act. A run with `acting.count === 0` reports numbers that are entirely
   * independent of that axis, whatever the flag says.
   */
  readonly acting: {
    readonly count: number;
    readonly bySystem: Readonly<Record<string, number>>;
  };
}

/**
 * The three parts of a stratum key, tolerant of a key that does not have three.
 *
 * `unknown` rather than a throw: this describes artifacts that already exist, and refusing to summarise one
 * because a stratum is malformed would hide the corpus instead of naming the gap.
 *
 * @param stratum - A `system:suite:fault` key.
 * @returns Its parts, with `unknown` where a part is absent.
 */
export function parseStratum(stratum: string): {
  system: string;
  suite: string;
  fault: string;
} {
  const [system, suite, ...rest] = stratum.split(':');
  return {
    system: system !== undefined && system !== '' ? system : 'unknown',
    suite: suite !== undefined && suite !== '' ? suite : 'unknown',
    // A fault name may itself contain a colon; everything after the suite is the fault.
    fault: rest.length > 0 ? rest.join(':') : 'unknown',
  };
}

/**
 * Count a corpus by system, suite and fault, and by whether the normalization guard would act on it.
 *
 * @param cases - The cases, with their node counts.
 * @returns The summary. Every partition sums to `total`.
 */
export function summarizePopulation(cases: readonly PopulationCase[]): PopulationSummary {
  const bump = (into: Record<string, number>, key: string): void => {
    into[key] = (into[key] ?? 0) + 1;
  };
  const bySystem: Record<string, number> = {};
  const bySuite: Record<string, number> = {};
  const byFault: Record<string, number> = {};
  const actingBySystem: Record<string, number> = {};
  let acting = 0;

  for (const c of cases) {
    const { system, suite, fault } = parseStratum(c.stratum);
    bump(bySystem, system);
    bump(bySuite, suite);
    bump(byFault, fault);
    // `>=`, matching the engine's own guard: a graph exactly at the threshold IS normalized, and an
    // off-by-one here would misreport the one case a reader is most likely to check.
    if (c.nodes >= ANOMALY_NORMALIZE_NODE_THRESHOLD) {
      acting += 1;
      bump(actingBySystem, system);
    }
  }
  return {
    total: cases.length,
    bySystem,
    bySuite,
    byFault,
    acting: { count: acting, bySystem: actingBySystem },
  };
}

/**
 * The number of strata a split covers, against the number the whole corpus has.
 *
 * The held-out splits are small by construction, so "which fault types are absent from test" is a question
 * with an answer rather than a caveat — this is that answer.
 *
 * @param cases - The cases in the split.
 * @returns How many distinct strata the split holds.
 */
export function strataCovered(cases: readonly PopulationCase[]): number {
  return new Set(cases.map((c) => c.stratum)).size;
}

/**
 * Render a summary as the lines an artifact carries.
 *
 * Every count is printed ascending by key so two runs of the same corpus render identically — a summary that
 * reorders itself between runs is a summary a diff cannot read.
 *
 * @param summary - The summary to render.
 * @param label - What this population is (e.g. `corpus`, `train`, `test`).
 * @returns One line per partition, plus the acting population.
 */
export function formatPopulation(summary: PopulationSummary, label: string): string[] {
  const render = (counts: Readonly<Record<string, number>>, total: number): string =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v} (${((v / total) * 100).toFixed(1)}%)`)
      .join(' ');
  return [
    `population[${label}]: total=${summary.total} | system: ${render(summary.bySystem, summary.total)}`,
    `population[${label}]: suite: ${render(summary.bySuite, summary.total)} | fault: ${render(
      summary.byFault,
      summary.total,
    )}`,
    // The decisive line: on how much of this corpus the shipped rank-normalization value can act at all.
    `population[${label}]: rankNormalization acts on ${summary.acting.count}/${summary.total} cases ` +
      `(nodes >= ${ANOMALY_NORMALIZE_NODE_THRESHOLD})` +
      (summary.acting.count === 0
        ? ' — this corpus cannot distinguish the flag from its opposite'
        : ` | acting system: ${render(summary.acting.bySystem, summary.acting.count)}`),
  ];
}
