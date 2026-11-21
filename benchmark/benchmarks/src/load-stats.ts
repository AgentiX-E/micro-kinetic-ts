/**
 * The RCAEval loader's per-cell statistics, and the fold that makes memory slicing exact.
 *
 * Lives beside the runner rather than inside it for one reason: the runner calls `main()` at import time, so
 * anything defined in it cannot be imported by a test. The fold is the piece of slicing that has to be provably
 * exact — every published nine-cell reading is now the fold of its slices — so it is the piece that must be
 * reachable from a test.
 *
 * @module benchmarks/load-stats
 */

import type { InjectionAnchorProvenance } from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type { BenchmarkCase } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import {
  summarizeLatencyRoutes,
  type LatencyRouteCensus,
  type LatencyRouteEntry,
} from './directional-evidence.js';
import { summarizeLogRoutes, type LogRouteCensus, type LogRouteEntry } from './log-route.js';
import { summarizeInjectionAnchors, type InjectionAnchorCensus } from './rcaeval-corpus.js';

export interface LoadStats {
  cases: BenchmarkCase[];
  /**
   * The per-case failed-edge coverage rows, carried so the cell can report the coverage its slices measured.
   *
   * A summary would not fold: "cases carrying per-edge latency" is a count over cases, and the line also reports how
   * many of a case's metric keys the records covered — a property of the rows. The rows therefore cross the slice
   * boundary and the owner's summariser runs once, exactly as for the log and latency censuses.
   */
  failedEdgeCases: ReadonlyArray<{
    failedTraceEdges?: BenchmarkCase['failedTraceEdges'];
    metricKeys: ReadonlySet<string>;
  }>;
  errors: string[];
  errorSamples: Map<string, number>; // error message → count
  /** Number of cases that got per-service trace-activity counts computed. */
  traceActivityCases: number;
  /**
   * How many cases the loader was ASKED for, whether or not they loaded.
   *
   * `traceStats.avgEdgesBefore` is divided by this rather than by `cases.length`, because a case that failed to
   * load still occupies a slot in the group and the mean has always been over the group. It is carried as its own
   * field so a fold of slices divides by the sum of what each slice considered rather than by the number of cases
   * that came back — the two differ on exactly the runs where a load error matters.
   */
  considered: number;
  traceStats: {
    total: number;
    pruned: number;
    avgEdgesBefore: number;
    avgEdgesAfter: number;
    /** Raw traces.csv header (comma-joined column names). */
    header: string;
  };
  /** Semantic enhancement statistics (only when enhancer is configured). */
  semanticStats: {
    totalServices: number;
    semanticallyResolved: number;
    embeddingResolved: number;
    llmResolved: number;
    exactMatched: number;
  };
  /**
   * The latency-route census over this group's cases, from the owner's own summariser.
   *
   * Reported by {@link reportLatencyRoutes} with the owner's own renderer. It exists because the corpus is an
   * AXIS of this runner since iteration 89: a run can rank on the `shipped`, `capped` or `whole-file` view, and
   * an artifact that named the choice without counting what the chosen view HELD could not distinguish a corpus
   * that supplied rows from one that supplied none — the two are the same nine cells and different causes.
   */
  latencyRoutes: LatencyRouteCensus;
  /**
   * The SAME population, addressable by the case it describes.
   *
   * The census above is the population reduced to counts, and a sum cannot name its own rows: a reader of the
   * artifact can see that RE3 TrainTicket supplied 2006 rows and cannot ask which of its thirty cases carried
   * them. The channel's remaining question is a ROUTING one — whether a case wants the whole-file view or the
   * published composition — and its unit is the case, so the supply is kept beside the summary rather than
   * discarded one line after it is computed. The two cannot disagree about which cases exist: the summary is
   * derived FROM this map, and this map is the only collection that holds the entries.
   */
  latencyRouteByCaseId: ReadonlyMap<string, LatencyRouteEntry>;
  /**
   * The log channel's four levels over this group's cases, from this module's own summariser.
   *
   * `logWeight` is 1.0 and its input was an empty map on 719 of the run's 735 cases, while the same artifact
   * reports that the corpus supplied logs on all 270 RE2 and all 90 RE3 cases. `INPUT_MAP_EMPTY` cannot say which
   * of four mechanisms produced that, and this is the line that can: how many rows were read, how many the owner
   * retained, how many the MODE's gate admits, and how many of those name a graph node. Reported by
   * {@link reportLogRoutes} with the owner's own renderer.
   */
  logRoutes: LogRouteCensus;
  /**
   * Where each of this group's cases got its injection boundary.
   *
   * Beside `latencyRoutes` because the two read one another: that census counts `no anchor`, and this one says
   * how many of the anchors that are no longer "no anchor" were DERIVED rather than read. Without it, repairing
   * a boundary would silently convert fourteen unanchored cases into anchored ones and the artifact would report
   * a corpus that never had the defect.
   */
  anchors: InjectionAnchorCensus;
  /**
   * The same population as `logRoutes`, as the ROWS the summariser folds.
   *
   * Carried because a cell is processed in memory SLICES (see `sliceForMemory`) and the summary of a cell is the
   * summary of all its slices. A summary is not foldable — the four levels of a slice are not a cell's four
   * levels — but the rows it is derived from are, so the rows cross the slice boundary and the summary is
   * recomputed once. Without them the only options would be to keep every slice's cases resident (the defect this
   * slicing exists to avoid) or to add a second summariser that folds summaries, which is a second owner of the
   * same arithmetic.
   */
  logRouteEntries: ReadonlyArray<LogRouteEntry>;
  /** The same population as `anchors`, as the ROWS the summariser folds. See `logRouteEntries`. */
  anchorProvenances: ReadonlyArray<InjectionAnchorProvenance>;
  /** Log-loading diagnostics (RE2/RE3): whether logs flow to the engine. */
  logStats: {
    /** Cases carrying at least one log entry. */
    total: number;
    /** Total ERROR/FATAL entries (after severity derivation). */
    errorEntries: number;
    /** Raw logs.csv header (comma-joined column names). */
    header: string;
    /** First log entry's timestamp (ms), level, service, and message sample. */
    sampleTs: number;
    sampleLevel: string;
    sampleService: string;
    sampleMsg: string;
    /** ERROR/FATAL entries flagged as stack traces (code-level evidence). */
    stackTraceEntries: number;
    /** First stack-trace entry's message prefix (eyeball the gate's target). */
    sampleStackTraceMsg: string;
  };
  /**
   * The distinct exception/error type names seen in ERROR/FATAL messages, in corpus order.
   *
   * The LIST is the data; the line that prints it is a rendering with its own cap (`MAX_EXCEPTION_NAMES_SHOWN`).
   * A rendered string would not fold — concatenating two renderings repeats every name the slices share — so the
   * names cross the slice boundary and are joined once, at the cap, where they are shown.
   */
  exceptionNames: ReadonlyArray<string>;
}

/**
 * Fold a cell's memory slices into the cell's own statistics.
 *
 * The counterpart of `mergeRunResults`, and it exists for the same reason: a cell is processed in slices, so every
 * number a cell reports has to be reconstructible from its slices or the slicing has changed the cell. What a
 * slice boundary does NOT preserve is `cases` — releasing them is the point of slicing — so the fold returns an
 * empty array there and its docblock says so rather than leaving a caller to discover it.
 *
 * Three kinds of field, three kinds of fold:
 *
 * - **Counts** are added (`considered`, `traceActivityCases`, each `semanticStats` counter, `traceStats.total`,
 *   `traceStats.pruned`, the three `logStats` counters).
 * - **Means over those counts** are re-derived from the sums (`traceStats.avgEdgesBefore`/`avgEdgesAfter` divide
 *   the recovered sum by the recovered `considered`), never averaged. `errorSamples` is a count per message and is
 *   added per key.
 * - **Samples** — the one header, timestamp, message and stack-trace prefix each cell prints — are taken from the
 *   first slice that HAS one. They are samples of the corpus, so any slice's answer is the cell's answer, and
 *   picking the first non-empty one keeps the line identical to what a single pass would have printed.
 *
 * The censuses (`latencyRoutes`, `logRoutes`, `anchors`) are NOT folded as summaries: their ROWS are concatenated
 * and the owner's summariser is called once, which is the same arithmetic a single pass performs.
 *
 * @param parts - Slice statistics of one cell, in slice order.
 * @returns The statistics a single `loadCases` over the whole cell would have produced, except `cases`.
 */
export function mergeLoadStats(parts: readonly LoadStats[]): LoadStats {
  const first = (pick: (s: LoadStats) => string): string => {
    for (const part of parts) {
      const value = pick(part);
      if (value !== '') return value;
    }
    return '';
  };
  const firstNonZero = (pick: (s: LoadStats) => number): number => {
    for (const part of parts) {
      const value = pick(part);
      if (value !== 0) return value;
    }
    return 0;
  };

  const considered = parts.reduce((sum, p) => sum + p.considered, 0);
  const sum = (pick: (s: LoadStats) => number): number => parts.reduce((s, p) => s + pick(p), 0);
  const meanEdges = (pick: (s: LoadStats) => number): number =>
    considered > 0 ? parts.reduce((s, p) => s + pick(p) * p.considered, 0) / considered : 0;

  const latencyRouteByCaseId = new Map<string, LatencyRouteEntry>();
  for (const part of parts) {
    // A case id belongs to exactly one slice, so a collision here would mean the slice boundaries overlapped and
    // the fold would silently drop a case. Asserting is cheaper than a duplicated row in a published census.
    for (const [caseId, entry] of part.latencyRouteByCaseId)
      latencyRouteByCaseId.set(caseId, entry);
  }
  const logRouteEntries = parts.flatMap((p) => p.logRouteEntries);
  const anchorProvenances = parts.flatMap((p) => p.anchorProvenances);
  const exceptionNames = [...new Set(parts.flatMap((p) => p.exceptionNames))];

  const errorSamples = new Map<string, number>();
  for (const part of parts) {
    for (const [message, count] of part.errorSamples) {
      errorSamples.set(message, (errorSamples.get(message) ?? 0) + count);
    }
  }

  return {
    // Released, and this is the one field a fold cannot restore: the slices' cases are what the slicing exists to
    // let go of. Every caller of a merged result reads the aggregates, and the printing paths that used to read
    // `cases` read a digest carried beside this fold instead.
    cases: [],
    failedEdgeCases: parts.flatMap((p) => p.failedEdgeCases),
    errors: parts.flatMap((p) => p.errors),
    errorSamples,
    traceActivityCases: sum((p) => p.traceActivityCases),
    considered,
    traceStats: {
      total: sum((p) => p.traceStats.total),
      pruned: sum((p) => p.traceStats.pruned),
      avgEdgesBefore: meanEdges((p) => p.traceStats.avgEdgesBefore),
      avgEdgesAfter: meanEdges((p) => p.traceStats.avgEdgesAfter),
      header: first((p) => p.traceStats.header),
    },
    semanticStats: {
      totalServices: sum((p) => p.semanticStats.totalServices),
      semanticallyResolved: sum((p) => p.semanticStats.semanticallyResolved),
      embeddingResolved: sum((p) => p.semanticStats.embeddingResolved),
      llmResolved: sum((p) => p.semanticStats.llmResolved),
      exactMatched: sum((p) => p.semanticStats.exactMatched),
    },
    latencyRoutes: summarizeLatencyRoutes([...latencyRouteByCaseId.values()]),
    latencyRouteByCaseId,
    logRoutes: summarizeLogRoutes(logRouteEntries),
    logRouteEntries,
    anchors: summarizeInjectionAnchors(anchorProvenances),
    anchorProvenances,
    logStats: {
      total: sum((p) => p.logStats.total),
      errorEntries: sum((p) => p.logStats.errorEntries),
      header: first((p) => p.logStats.header),
      sampleTs: firstNonZero((p) => p.logStats.sampleTs),
      sampleLevel: first((p) => p.logStats.sampleLevel),
      sampleService: first((p) => p.logStats.sampleService),
      sampleMsg: first((p) => p.logStats.sampleMsg),
      stackTraceEntries: sum((p) => p.logStats.stackTraceEntries),
      sampleStackTraceMsg: first((p) => p.logStats.sampleStackTraceMsg),
    },
    exceptionNames,
  };
}
