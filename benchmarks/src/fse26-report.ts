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
}

/** One fault type's cell in the summary. */
export interface FSE26FaultCell {
  readonly total: number;
  readonly correct: number;
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
