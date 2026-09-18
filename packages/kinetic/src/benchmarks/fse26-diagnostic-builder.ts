/**
 * Assemble an FSE'26 signal diagnostic from the engine's own objects.
 *
 * The WRITE half of the dump, kept beside the formatter so the format has one reader
 * (`benchmarks/src/fse26-diagnose-analyze.ts`) and one writer. It exists as a module of its own
 * because it answers a different question from `formatFSE26Diagnostic`: not "how is this rendered"
 * but "what does the engine already know" — and the answer is not dataset-specific. Every field is
 * read from the {@link BenchmarkCase} the engine scored, the {@link FaultPropagationGraph} it built,
 * and the ranking it produced, so a second runner can emit the SAME dump without a second builder.
 *
 * That matters because the dump is what every offline screen takes as input: a weight solved on one
 * benchmark and vetoed on another can only be reconciled if both benchmarks produce an artifact the
 * same instrument can read. A private copy per runner would give the analyzer two formats that look
 * alike, which is the failure mode this whole file is arranged to avoid.
 *
 * Nothing here re-derives a signal the engine already computed: `dominantMetrics`, `anomalyScores`,
 * `logScores`, `failedEdgeScores`, `metricDiagnostics` and `postInjectOnsetDelays` are read off the
 * graph, so a dump reports what the ranking USED rather than a second computation free to disagree
 * with it. The two exceptions are counted HERE, from the case's own records, because the engine does
 * not expose them: how many failed-edge RECORDS name a callee (a count, not a score) and the largest
 * inbound latency rise per callee.
 *
 * @module benchmarks/fse26-diagnostic-builder
 */

import type { FaultPropagationGraph, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';

import { formatFSE26Diagnostic, type FSE26DiagnosticService } from './fse26-diagnose.js';
import type { BenchmarkCase } from './loaders/types.js';

/** Everything the dump needs that the engine does not already hold. */
export interface DiagnosticCaseInput {
  /** The loaded case the engine scored — the source of every per-service magnitude. */
  readonly case: BenchmarkCase;
  /** The graph the engine built and consumed. */
  readonly graph: FaultPropagationGraph;
  /**
   * The engine's ranking, best first.
   *
   * Typed by the ONE field the dump reads rather than by `RootCauseResult`: the block prints an
   * order and nothing else, so a caller that has only service ids — a replayed artifact, a fixture —
   * can emit the same block without impersonating a full result.
   */
  readonly ranking: readonly { readonly serviceId: string }[];
  /**
   * The call graph the engine consumed.
   *
   * Passed whole rather than as a list of edges, so the services the dump iterates and the edges it
   * prints cannot disagree: `edges` is derived from this one object, and a second parameter carrying
   * "the same graph" is exactly how a dump comes to describe a topology the ranking never saw.
   */
  readonly callGraph: ServiceCallGraph;
  /** The dump's case identifier. */
  readonly datapack: string;
  /** The case's fault type, as the benchmark labels it. */
  readonly faultType: string;
  /**
   * Every accepted root-cause service, in the benchmark's own order.
   *
   * Supplied by the caller rather than read from `case.groundTruth.serviceIds` because a runner may
   * score an ACCEPTED SET wider than the case declares (FSE'26's edge-injected network faults accept
   * both the injection point's source and target), and the dump has to show the set that was scored.
   */
  readonly groundTruthServices: readonly string[];
  /** The log-signal mode this configuration ran under. */
  readonly logSignalMode: string;
  /** The case's fault-injection time in ms, or `0` for "the engine had no anchor". */
  readonly injectTimeMs: number;
  /**
   * How many decimals to render the per-service decimal fields with.
   *
   * Optional, and deliberately NOT defaulted here: the ONE default is
   * {@link formatFSE26Diagnostic}'s, so a builder that invented a second one would be a second copy
   * of a value a reader's error bar is derived from. Omitted means "the producer's default", which
   * is what every caller that predates this field means.
   */
  readonly fieldDecimals?: number | undefined;
}

/**
 * Render one case's diagnostic block.
 *
 * @param input - The case, the graph, the ranking, and the labels the dump carries.
 * @returns The block, as `formatFSE26Diagnostic` renders it.
 */
export function buildFSE26Diagnostic(input: DiagnosticCaseInput): string {
  const { case: benchCase, graph } = input;
  const injectTime = input.injectTimeMs;

  // Raw record counts per callee, counted here rather than in the engine so the dump can separate
  // "more evidence" from "a higher score" — the two changes have different fixes.
  //
  // Read from the LOADED case rather than from a raw record: `BenchmarkCase.failedTraceEdges` is the
  // loader's normalised form of exactly this list, mapped one record to one entry, and a runner that
  // counted a raw array it still had in hand would be a second source for a number the case already
  // carries. A dataset whose loader does not populate it — RCAEval carries no per-edge failed-call
  // counts — reports `0`, which is the truth about the engine's input rather than an omission.
  const failedEdgeRecordsByCallee = new Map<string, number>();
  for (const row of benchCase.failedTraceEdges ?? []) {
    failedEdgeRecordsByCallee.set(row.callee, (failedEdgeRecordsByCallee.get(row.callee) ?? 0) + 1);
  }

  // Inbound latency per service: the LARGEST rise any caller measured, plus how many callers
  // measured at all. The maximum rather than the mean because one caller going from 1 ms to 2 s is
  // the signal, and averaging it against twenty unchanged callers would bury it.
  //
  // `post / pre` is computed WITHOUT the guard the raw reader used to need: `FaultEdgeLatency` is
  // the loader's own type and its converter drops a row whose durations are not finite and positive
  // (see `toFSE26EdgeLatency`), so `pre > 0` holds by construction and the division is finite. A
  // defensive branch here could never fire — and if one ever did, the formatter's `nonfinite` render
  // is the tripwire, which is louder than a silently skipped row.
  const latencyByCallee = new Map<string, { rise: number; count: number }>();
  for (const row of benchCase.edgeLatency ?? []) {
    const previous = latencyByCallee.get(row.callee);
    const rise = row.postMeanMs / row.preMeanMs;
    latencyByCallee.set(row.callee, {
      rise: previous === undefined ? rise : Math.max(previous.rise, rise),
      count: (previous?.count ?? 0) + 1,
    });
  }

  const services: FSE26DiagnosticService[] = [];
  for (const serviceId of input.callGraph.nodes.keys()) {
    const series = benchCase.metrics.get(serviceId) ?? [];
    const metricNames = [...new Set(series.map((s) => s.label))].sort();
    const dominantMetric = graph.dominantMetrics?.get(serviceId)?.label;
    const selfAnomaly = graph.anomalyScores.get(serviceId) ?? 0;
    const logScore = graph.logScores?.get(serviceId) ?? 0;
    const failedEdgeScore = graph.failedEdgeScores?.get(serviceId) ?? 0;
    const metricOutcomes = graph.metricDiagnostics?.get(serviceId);

    let errorCount = 0;
    let fatalCount = 0;
    let logicExceptionCount = 0;
    let httpExceptionCount = 0;
    // The two signatures are counted independently and a line may carry both, so the union — the
    // quantity the engine's level-1 gate actually admits — needs this third counter. Without it a
    // reader has to add two overlapping sets.
    let bothExceptionCount = 0;
    const sampleErrorMessages: string[] = [];
    const exceptionClassSet = new Set<string>();
    if (benchCase.logs) {
      for (const log of benchCase.logs) {
        if (log.service !== serviceId) continue;
        if (injectTime > 0 && log.timestamp < injectTime) continue;
        const isError = log.level === 'ERROR' || log.level === 'FATAL';
        if (log.level === 'ERROR') errorCount++;
        else if (log.level === 'FATAL') fatalCount++;
        if (isError && log.isLogicException) logicExceptionCount++;
        if (isError && log.isHttpException) httpExceptionCount++;
        if (isError && log.isLogicException && log.isHttpException) bothExceptionCount++;
        if (isError && sampleErrorMessages.length < 3) sampleErrorMessages.push(log.message);
        if (isError && log.deepestExceptionClass) exceptionClassSet.add(log.deepestExceptionClass);
      }
    }

    services.push({
      serviceId,
      metricNames,
      dominantMetric,
      selfAnomaly,
      logScore,
      failedEdgeScore,
      failedEdgeRecords: failedEdgeRecordsByCallee.get(serviceId) ?? 0,
      latRise: latencyByCallee.get(serviceId)?.rise,
      latEdges: latencyByCallee.get(serviceId)?.count ?? 0,
      // Read from the graph like every other term above, so the dump reports the engine's own delay
      // rather than a re-derivation. Passed through RAW: the engine's `-1` ("undetermined") is data,
      // and the formatter decides how it renders, so no call site can quietly turn it into a 0 or an
      // omission.
      onsetDelayMs: graph.postInjectOnsetDelays?.get(serviceId),
      errorCount,
      fatalCount,
      logicExceptionCount,
      httpExceptionCount,
      bothExceptionCount,
      sampleErrorMessages,
      exceptionClasses: [...exceptionClassSet].sort(),
      metricOutcomes,
    });
  }

  return formatFSE26Diagnostic({
    datapack: input.datapack,
    faultType: input.faultType,
    groundTruthServices: input.groundTruthServices,
    services,
    topPredictions: input.ranking.map((r) => r.serviceId),
    logSignalMode: input.logSignalMode,
    // The graph the engine actually consumed, so a dump can answer structural questions —
    // upstream/downstream, reachability — that no per-service scalar can. Emitted here rather than
    // per service because every reader wants the whole case's graph at once.
    edges: input.callGraph.edges.map((edge) => `${edge.from}>${edge.to}`),
    // The anchor every `onset` above is measured from. Emitted as read from the case, including a 0
    // — the engine's own "no anchor" — because a screen that cannot distinguish "the engine had no
    // injection time" from "the dump omits the field" would report a temporal window for a case the
    // engine left inert.
    injectTimeMs: injectTime,
    // Passed through UNCHANGED, including `undefined`: the default lives in the formatter, so a
    // builder that supplied one would be the second owner of the number a reader's box comes from.
    fieldDecimals: input.fieldDecimals,
  });
}
