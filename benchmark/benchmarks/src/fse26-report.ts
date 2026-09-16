/**
 * The structured FSE'26 result summary written to `--output`.
 *
 * This object is the machine-readable half of a benchmark run: the CI workflow
 * uploads it as an artifact and every downstream reader — a diff job, a report,
 * a later investigation — works from it. It therefore has to carry **the
 * configuration that produced the numbers**, not just the numbers. The plain
 * text report prints that configuration in a header line, so a gap here is
 * invisible to whoever reads the log and fatal to whoever reads the JSON.
 *
 * It used to be assembled inline inside `run-fse26.ts`'s `main()`, which is why
 * it could drift from the header: `main()` runs on import and cannot be called
 * from a test, so nothing could check that the two agreed. Extracting it makes
 * the shape testable, and {@link buildFSE26Report} takes the whole run
 * configuration as one object so a new field cannot be silently dropped.
 *
 * @module benchmarks/fse26-report
 */

/** The published SOTA anchor the run is compared against. */
export interface FSE26Anchor {
  readonly sotaAvgTop1: number;
  readonly sotaBestTop1: number;
}

import type { FaultFailedEdge } from '../../packages/core/src/index.js';
import type { OnsetShape } from '../../packages/tree/src/index.js';

/**
 * Everything that determines the reported numbers.
 *
 * Every field here can change the headline metric on its own: `logMode` is
 * worth ~24pp, `dropMetrics` selects an ablation, `logWeight` scales the log
 * signal and `rankNormalization` is load-bearing on Train Ticket's large
 * topologies. A reader who cannot see these cannot attribute the artifact.
 */
export interface FSE26RunConfig {
  /** Weight of the log signal in the ranking fusion. */
  readonly logWeight: number;
  /** Log-signal scoring mode (`count` | `logicHttp` | `all` | ...). */
  readonly logSignalMode: string;
  /** Whether ranking scores are rank-normalised before fusion. */
  readonly rankNormalization: boolean;
  /** Metric names dropped for this run (empty = no ablation). */
  readonly dropMetrics: readonly string[];
  /**
   * Ceiling on one metric's relative deviation (0 = unbounded, the shipped
   * behaviour). An ablation switch for the anomaly score's dynamic range: the
   * RISE direction is unbounded while a DROP is capped at `log10(2)`, so a
   * service's score can be handed to whichever of its metrics has the widest
   * range. A run at a non-zero ceiling is a different configuration and has to
   * say so, or its numbers cannot be compared with the published ones.
   */
  readonly metricRiseCeiling: number;
  /**
   * Whether each metric's cross-service median is subtracted before the service
   * maximum (`false` = the shipped absolute score). The ONLY operation that can
   * reorder two services on the metric axis, so a run that uses it is a
   * different configuration and has to say so.
   */
  readonly metricFleetBaseline: boolean;
  /**
   * Weight of the failed-edge-DIRECTION signal (0 = disabled, the shipped
   * configuration). It charges each post-injection failed call to its CALLEE —
   * the inverse of the log signal's credit to the emitter — so a non-zero value
   * is a different ranking and has to say so.
   */
  readonly failedEdgeWeight: number;
  /**
   * How a callee's failed calls were aggregated (`sum` = the shipped one). A
   * run using `mean` ranks differently, so it has to say so.
   */
  readonly failedEdgeMode: string;
  /** Minimum contributing edges a callee needs to be credited (1 = shipped). */
  readonly failedEdgeMinRecords: number;
  /**
   * Weight of the per-edge LATENCY-rise signal. The shipped configuration carries
   * it ON — unlike `failedEdgeWeight` above, whose shipped value is 0 — so this
   * field is always rendered, and a run at `0` is the ablation that scores 47.33%.
   */
  readonly latWeight: number;
  /**
   * Rise a service must clear before the latency term credits it. The shipped value
   * is 1, so it is rendered only when it differs — like the failed-edge floor, and
   * unlike the weight above, whose shipped value is not zero.
   */
  readonly latMinRise: number;
  /**
   * Weight of the DB-connection-pool dominance penalty. Required here for the same
   * reason the weights above are: this line is the only record of which
   * configuration produced a number.
   */
  readonly poolMetricPenaltyWeight: number;
  /** Weight of the injection-anchored temporal prior; `0` = the shipped configuration. */
  readonly temporalWeight: number;
  /** Which shape the prior reads the onsets in; inert while the weight is 0. */
  readonly onsetShape: OnsetShape;
}

/** One fault type's cell in the summary. */
export interface FSE26FaultCell {
  readonly total: number;
  readonly correct: number;
}

/**
 * How much failed-edge evidence a run's cases actually carry.
 *
 * A ranking signal can report "no change" for two very different reasons: the
 * signal is not informative, or it never received any input. The two are
 * indistinguishable from the headline number, and the second looks exactly like
 * a result — so the input has to be counted, not assumed. This is the counter:
 * how many cases carry the field at all, how many records there are, how many
 * name a CALLEE that is actually rankable in that case's graph (the signal drops
 * the rest), and the total post-injection failures those in-graph edges carry
 * net of their own baselines.
 *
 * All four zero means the signal was driven by nothing; `casesWithEdges: 0` is
 * the specific shape of an empty evidence class.
 */
export interface FailedEdgeCoverage {
  /** Cases in the run. */
  readonly cases: number;
  /** Cases carrying at least one failed-edge record. */
  readonly casesWithEdges: number;
  /** Failed-edge records across all cases. */
  readonly edges: number;
  /** Records whose CALLEE is a graph node — the ones the signal can use. */
  readonly inGraphEdges: number;
  /** In-graph failures net of each edge's own pre-injection baseline. */
  readonly netFailures: number;
}

/**
 * Count the failed-edge evidence a run actually loaded.
 *
 * Takes a deliberately compact per-case projection rather than the loaded case:
 * a case's metric SERIES are large and the runner releases them after scoring,
 * so a counter that retained them would hold the whole dataset in memory. The
 * metric KEYS are the graph nodes (`toBenchmarkCase` builds one node per service
 * with metric series), so `metricKeys.has(callee)` is the same test the signal
 * performs, without this module depending on the kinetic package.
 *
 * A self-edge (`caller === callee`) counts as a RECORD but not as in-graph
 * evidence, because the signal drops it: it says nothing about direction. Same
 * for a callee with no metric series.
 *
 * @param cases - One compact projection per evaluated case.
 * @returns The coverage counters.
 */
export function summariseFailedEdgeCoverage(
  cases: ReadonlyArray<{
    readonly failedTraceEdges?: readonly FaultFailedEdge[];
    readonly metricKeys: ReadonlySet<string>;
  }>,
): FailedEdgeCoverage {
  let casesWithEdges = 0;
  let edges = 0;
  let inGraphEdges = 0;
  let netFailures = 0;

  for (const oneCase of cases) {
    const list = oneCase.failedTraceEdges;
    if (!list || list.length === 0) continue;
    casesWithEdges += 1;
    edges += list.length;
    for (const { caller, callee, failed, baseline } of list) {
      if (caller === callee) continue;
      if (!oneCase.metricKeys.has(callee)) continue;
      inGraphEdges += 1;
      netFailures += Math.max(0, failed - baseline);
    }
  }

  return { cases: cases.length, casesWithEdges, edges, inGraphEdges, netFailures };
}

/**
 * Render {@link summariseFailedEdgeCoverage} as one line for the run's header.
 *
 * Printed unconditionally, unlike an ablation line: a run whose signal received
 * nothing must be indistinguishable from one that received everything only in
 * the numbers, never in the log.
 *
 * @param coverage - The counters.
 * @returns One human-readable line, without a trailing newline.
 */
export function formatFailedEdgeCoverageLine(coverage: FailedEdgeCoverage): string {
  return (
    `Data:   failed edges in ${coverage.casesWithEdges}/${coverage.cases} cases ` +
    `(${coverage.edges} records, ${coverage.inGraphEdges} in-graph, ` +
    `net ${coverage.netFailures} failures)`
  );
}

/** The complete summary object written to `--output`. */
export interface FSE26Report {
  readonly dataset: 'fse26';
  readonly anchor: FSE26Anchor;
  readonly config: FSE26RunConfig;
  readonly cases: number;
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly deltaVsSotaAvg: number;
  readonly loadErrors: number;
  readonly engineErrors: number;
  readonly emptyGraphs: number;
  readonly perFaultType: Readonly<Record<string, FSE26FaultCell & { readonly top1: number }>>;
}

/** Inputs to {@link buildFSE26Report}. */
export interface FSE26ReportInput {
  readonly anchor: FSE26Anchor;
  readonly config: FSE26RunConfig;
  readonly cases: number;
  readonly top1: number;
  readonly top3: number;
  readonly top5: number;
  readonly loadErrors: number;
  readonly engineErrors: number;
  readonly emptyGraphs: number;
  readonly perFaultType: ReadonlyMap<string, FSE26FaultCell>;
}

/**
 * The configuration fields a run artifact MUST carry to be attributable.
 *
 * Each of these can change the headline metric on its own, so an artifact that
 * omits one cannot be compared with another artifact — the difference is
 * unexplained. `logMode` alone is worth ~24pp on this benchmark, which is why
 * it is first on the list of things to check rather than a footnote.
 */
export const REPORTED_CONFIG_FIELDS = [
  'logWeight',
  'logSignalMode',
  'rankNormalization',
  'dropMetrics',
  'metricRiseCeiling',
  'metricFleetBaseline',
  'failedEdgeWeight',
  'failedEdgeMode',
  'failedEdgeMinRecords',
  'latWeight',
  'latMinRise',
  'poolMetricPenaltyWeight',
  'temporalWeight',
  'onsetShape',
] as const;

/**
 * Report which of {@link REPORTED_CONFIG_FIELDS} a configuration object omits.
 *
 * Takes `unknown` on purpose: its use is to audit a record that arrived from
 * somewhere else — an artifact read back from a workflow, a JSON pasted into an
 * issue — so the input is untrusted by construction and must not be described
 * by a type that assumes the answer. Returns `[]` when the object carries every
 * field.
 *
 * @param config - A candidate configuration object, typically parsed JSON.
 * @returns The names of the missing fields, in {@link REPORTED_CONFIG_FIELDS}
 *   order; empty when the object is attributable.
 */
export function missingReportedConfigFields(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) {
    return [...REPORTED_CONFIG_FIELDS];
  }
  const record = config as Record<string, unknown>;
  return REPORTED_CONFIG_FIELDS.filter((field) => record[field] === undefined);
}

/**
 * Render the run configuration as the single header line the text report prints.
 *
 * Both renderings of the configuration — this line and the `config` object in
 * the JSON — come from the SAME object on purpose. They used to be written out
 * independently, which is how the JSON lost `logMode` while the line kept it;
 * a test asserts they agree on every reported field.
 *
 * @param config - The run configuration.
 * @returns One human-readable line, without a trailing newline.
 */
export function formatFSE26ConfigLine(config: FSE26RunConfig): string {
  let line =
    `Config: logWeight=${config.logWeight} logMode=${config.logSignalMode} ` +
    `rankNormalization=${config.rankNormalization}`;
  if (config.dropMetrics.length > 0) {
    line += ` dropMetrics=[${config.dropMetrics.join(', ')}]`;
  }
  // Printed only when it changes the configuration, like `dropMetrics`: the JSON
  // always carries it, and the line exists to make a NON-default run visible.
  if (config.metricRiseCeiling > 0) {
    line += ` riseCeiling=${config.metricRiseCeiling}`;
  }
  if (config.metricFleetBaseline) {
    line += ' fleetBaseline=true';
  }
  // Same rule as the two above: the shipped value is 0, so a zero-weight run's
  // line is byte-identical to the published one and a flipped switch is visible.
  if (config.failedEdgeWeight !== 0) {
    line += ` failedEdgeWeight=${config.failedEdgeWeight}`;
    // Only once the signal is on, and only when it is not the shipped mode:
    // the aggregation is meaningless without a weight to apply it to.
    if (config.failedEdgeMode !== 'sum') {
      line += ` failedEdgeMode=${config.failedEdgeMode}`;
    }
    if (config.failedEdgeMinRecords !== 1) {
      line += ` failedEdgeMinRecords=${config.failedEdgeMinRecords}`;
    }
  }
  // ALWAYS printed, unlike the three fields above. The rule that lets a field be
  // omitted when it holds its default only holds while that default is ZERO: the
  // omission then means "0" both before and after any change to the default, so two
  // different shipped configurations can never render the same line. The shipped
  // latency weight is not zero, so an omitted-when-default field would print a
  // byte-identical `Config:` line for the 694-case run and the 673-case ablation —
  // which is the exact defect this line exists to prevent. It is NOT nested under
  // the failed-edge weight either: the two terms are independent, and this one can
  // be on while that one is off.
  line += ` latWeight=${config.latWeight}`;
  // Only when it changes the configuration, like the failed-edge floor: the shipped
  // value is 1, so a run WITH a floor is a different term and has to say so.
  if (config.latMinRise !== 1) {
    line += ` latMinRise=${config.latMinRise}`;
  }
  // Unconditional, on the same rule as the latency weight: this term's shipped value
  // will be NON-zero once measured, so an omitted-when-default field would render a
  // byte-identical line for the shipped run and for `--pool-penalty 0`. Printing it
  // while the shipped value is still 0 costs one field and cannot go stale.
  line += ` poolMetricPenaltyWeight=${config.poolMetricPenaltyWeight}`;
  // Both unconditional, and for a stronger reason than the pool term's: a SHAPE is not a
  // weight, so there is no "default 0" it could be omitted against — and the weight's
  // own default is about to become non-zero, at which point an omitted-when-default
  // field would render the shipped run and its ablation byte-identically.
  line += ` temporalWeight=${config.temporalWeight}`;
  line += ` onsetShape=${config.onsetShape}`;
  return line;
}

/**
 * Build the structured summary for one run.
 *
 * Pure: it takes every number and the whole configuration, and derives only the
 * per-cell `top1` ratios. The fault-type cells are sorted by descending `total`
 * (then by name, so the order is total) because the artifact is diffed between
 * runs and an insertion-order map would make the JSON churn.
 *
 * @param input - Run configuration, headline metrics and per-fault-type cells.
 * @returns The summary object, ready to serialise.
 */
export function buildFSE26Report(input: FSE26ReportInput): FSE26Report {
  const cells = [...input.perFaultType.entries()].sort((a, b) => {
    if (b[1].total !== a[1].total) return b[1].total - a[1].total;
    return a[0] < b[0] ? -1 : 1;
  });

  const perFaultType: Record<string, FSE26FaultCell & { top1: number }> = {};
  for (const [faultType, cell] of cells) {
    perFaultType[faultType] = {
      total: cell.total,
      correct: cell.correct,
      top1: cell.total > 0 ? cell.correct / cell.total : 0,
    };
  }

  return {
    dataset: 'fse26',
    anchor: input.anchor,
    config: input.config,
    cases: input.cases,
    top1: input.top1,
    top3: input.top3,
    top5: input.top5,
    deltaVsSotaAvg: input.top1 - input.anchor.sotaAvgTop1,
    loadErrors: input.loadErrors,
    engineErrors: input.engineErrors,
    emptyGraphs: input.emptyGraphs,
    perFaultType,
  };
}
