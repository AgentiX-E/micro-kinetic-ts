/**
 * FSE'26 RCABench runner — fault-propagation-aware microservice RCA.
 *
 * RCABench (arXiv:2510.04711) is the hardest public RCA target: 1,430 validated
 * failure cases on Train Ticket (50+ services), 25 fault types across 6
 * categories, with dynamic workloads and hierarchical ground-truth labels. The
 * 11 SOTA models re-evaluated on it average only 0.21 Top@1 (best 0.37).
 *
 * The Parquet bridge (`scripts/fse26_convert.py`) normalises each datapack into
 * a single `case.json`; this runner consumes that JSON via {@link FSE26Loader}
 * and scores the production {@link TreePruner} engine against the benchmark's
 * dual-label ground truth (network faults accept BOTH the injection point's
 * source and target service).
 *
 * Unlike the RCAEval runner, the engine is invoked directly (not through the
 * {@link BenchmarkRunner}) so the dual-label accepted set is scored exactly —
 * the shared runner scores against `groundTruth.serviceId` (the FIRST label),
 * which would under-count a correct target-service prediction on a network
 * fault.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-fse26.ts [--data-dir <json-root>] \
 *     [--max-cases N] [--log-weight <w>] [--no-rank-normalization] [--output <path>] \
 *     [--diagnose <fault-types>] [--diagnose-limit N] [--drop-metrics <names>]
 *
 * `--drop-metrics` is the component-ablation switch: it filters the named
 * metric series out of every case before scoring, so a ranking change can be
 * attributed to one of the bridge's metric sources without a cache rebuild.
 * Read-only: never writes to the data directory.
 *
 * @module benchmarks/run-fse26
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FaultPropagationGraph, RootCauseResult } from '../../packages/core/src/index.js';

import type {
  BenchmarkCase,
  FSE26DiagnosticService,
  FSE26RawCase,
} from '../../packages/kinetic/src/benchmarks/index.js';
import {
  FSE26Loader,
  computeAvgAtKMultiLabel,
  dropFSE26MetricNames,
  formatFSE26Diagnostic,
} from '../../packages/kinetic/src/benchmarks/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';

import { parseFSE26Args } from './fse26-cli.js';
import { buildFSE26Report, formatFSE26ConfigLine, type FSE26RunConfig } from './fse26-report.js';

/**
 * Discover every case directory (a `case.json` present) under `dataDir`, via a
 * breadth-first walk. Datapack directories are flat under the bridge output
 * root, but the walk tolerates a nested layout without matching on names.
 */
function discoverCaseDirs(dataDir: string): string[] {
  const dirs: string[] = [];
  const queue = [dataDir];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasCase = entries.some((e) => e.isFile() && e.name === 'case.json');
    if (hasCase) {
      dirs.push(cur);
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) queue.push(join(cur, e.name));
    }
  }
  dirs.sort();
  return dirs;
}

/** The published FSE'26 anchor: 11 SOTA models average 0.21 Top@1 (best 0.37). */
const ANCHOR_AVG = 0.21;
const ANCHOR_BEST = 0.37;

/** Per-fault-type accuracy accumulator. */
interface FaultCell {
  total: number;
  correct: number;
}

/**
 * Assemble a per-service signal diagnostic for one case, for the `--diagnose`
 * flag. It reads the raw case, the loaded {@link BenchmarkCase}, and the built
 * fault graph — the exact inventory the engine scored — so a weak fault type
 * can be traced to whether the source's signature is present in the data and
 * rewarded by a ranking signal.
 */
function buildDiagnostic(
  raw: FSE26RawCase,
  benchCase: BenchmarkCase,
  faultGraph: FaultPropagationGraph,
  ranking: RootCauseResult[],
  logSignalMode: string,
): string {
  const injectTime = benchCase.injectTime;
  const services: FSE26DiagnosticService[] = [];
  for (const serviceId of benchCase.callGraph.nodes.keys()) {
    const series = benchCase.metrics.get(serviceId) ?? [];
    const metricNames = [...new Set(series.map((s) => s.label))].sort();
    const dominantMetric = faultGraph.dominantMetrics?.get(serviceId)?.label;
    const selfAnomaly = faultGraph.anomalyScores.get(serviceId) ?? 0;
    const logScore = faultGraph.logScores?.get(serviceId) ?? 0;
    const metricOutcomes = faultGraph.metricDiagnostics?.get(serviceId);

    let errorCount = 0;
    let fatalCount = 0;
    let logicExceptionCount = 0;
    let httpExceptionCount = 0;
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
      errorCount,
      fatalCount,
      logicExceptionCount,
      httpExceptionCount,
      sampleErrorMessages,
      exceptionClasses: [...exceptionClassSet].sort(),
      metricOutcomes,
    });
  }

  return formatFSE26Diagnostic({
    datapack: raw.datapack,
    faultType: raw.faultType,
    groundTruthServices: raw.groundTruthServices,
    services,
    topPredictions: ranking.map((r) => r.serviceId),
    logSignalMode,
  });
}

async function main(): Promise<void> {
  const opts = parseFSE26Args(process.argv.slice(2));
  const loader = new FSE26Loader();
  const dropSet = new Set(opts.dropMetrics);

  // The run configuration, built once. Both renderings of it — the header line
  // and the `config` object in the JSON artifact — come from this object, so
  // they cannot disagree about the mode; that is how the JSON lost `logMode`
  // while the line kept it, leaving two artifacts 24.2pp apart with byte-equal
  // `config` blocks.
  const runConfig: FSE26RunConfig = {
    logWeight: opts.logWeight,
    logSignalMode: opts.logMode,
    rankNormalization: opts.rankNormalization,
    dropMetrics: opts.dropMetrics,
  };

  // Production ranking config: the log signal is shipped enabled (benchmark
  // #220 net-positive, zero regression); every other causal prior is opt-in.
  // Rank normalization is load-bearing on Train Ticket's large topologies.
  const pruner = new TreePruner(
    { logWeight: opts.logWeight, logSignalMode: opts.logMode },
    { rankNormalization: opts.rankNormalization },
  );

  console.log("Micro-Kinetic — FSE'26 RCABench");
  console.log('═'.repeat(65));
  console.log(`Data:   ${opts.dataDir}`);
  console.log(formatFSE26ConfigLine(runConfig));
  if (opts.dropMetrics.length > 0) {
    console.log(`Ablation: dropping metric names [${opts.dropMetrics.join(', ')}]`);
  }
  console.log(`Anchor: SOTA avg=${ANCHOR_AVG} best=${ANCHOR_BEST} Top@1`);
  console.log('═'.repeat(65));

  const dirs = discoverCaseDirs(opts.dataDir);
  const selected = opts.maxCases > 0 ? dirs.slice(0, opts.maxCases) : dirs;
  console.log(`Cases discovered: ${dirs.length}; evaluated: ${selected.length}`);
  console.log('═'.repeat(65));

  // ── Per-case accumulation (small; the loaded cases are released per case) ──
  const predictionsPerCase: string[][] = [];
  const acceptedPerCase: string[][] = [];
  const faultTypeOfCase: string[] = [];
  const faultCells = new Map<string, FaultCell>();
  let loadErrors = 0;
  let engineErrors = 0;
  let emptyGraphs = 0;
  const diagnosed = new Map<string, number>();

  for (const dir of selected) {
    let raw: FSE26RawCase;
    try {
      raw = loader.loadCase(dir);
    } catch (err) {
      loadErrors++;
      // Surface the first few failures verbatim — a silent count hides the
      // root cause (e.g. non-finite values producing unparseable JSON).
      if (loadErrors <= 3) {
        console.error(`[loadError] ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    if (dropSet.size > 0) raw = dropFSE26MetricNames(raw, dropSet);
    const benchCase = loader.toBenchmarkCase(raw);
    // Dual-label accepted set: the raw case's full ground-truth list (two
    // labels for network faults, one otherwise).
    const accepted =
      raw.groundTruthServices.length > 0
        ? [...raw.groundTruthServices]
        : [benchCase.groundTruth.serviceId];
    const faultType = benchCase.groundTruth.faultType ?? 'unknown';

    let ranking: RootCauseResult[] = [];
    let faultGraph: FaultPropagationGraph | undefined;
    try {
      if (benchCase.callGraph.edges.length === 0) {
        // The engine requires ≥ 1 edge; a single-service case is degenerate.
        emptyGraphs++;
      } else {
        faultGraph = pruner.buildFaultGraph(benchCase.callGraph, benchCase.metrics, {
          injectTimeMs: benchCase.injectTime,
          logs: benchCase.logs,
        });
        ranking = pruner.analyze(faultGraph, 5);
      }
    } catch {
      engineErrors++;
    }

    // ── Optional per-case signal diagnostic (--diagnose) ──
    // Dump the source vs symptom signal inventory for a weak fault type so its
    // gap can be traced to a data gap or a signal gap.
    if (opts.diagnose.includes(faultType)) {
      const dumped = diagnosed.get(faultType) ?? 0;
      const unlimited = opts.diagnoseLimit === 0;
      if (unlimited || dumped < opts.diagnoseLimit) {
        diagnosed.set(faultType, dumped + 1);
        if (faultGraph) {
          console.log(buildDiagnostic(raw, benchCase, faultGraph, ranking, opts.logMode));
        }
      }
    }

    predictionsPerCase.push(ranking.map((r) => r.serviceId));
    acceptedPerCase.push(accepted);
    faultTypeOfCase.push(faultType);

    const cell = faultCells.get(faultType) ?? { total: 0, correct: 0 };
    cell.total++;
    if (ranking.length > 0 && accepted.includes(ranking[0]!.serviceId)) cell.correct++;
    faultCells.set(faultType, cell);
  }

  // ── Aggregate ────────────────────────────────────────────
  const top1 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 1);
  const top3 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 3);
  const top5 = computeAvgAtKMultiLabel(predictionsPerCase, acceptedPerCase, 5);

  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  console.log('');
  console.log(`${'═'.repeat(65)}`);
  console.log("  FSE'26 RCABench — Micro-Kinetic (production TreePruner)");
  console.log(`${'═'.repeat(65)}`);
  console.log(`  Top@1 = ${pct(top1)}   Top@3 = ${pct(top3)}   Top@5 = ${pct(top5)}`);
  console.log(
    `  Cases = ${predictionsPerCase.length}   loadErrors=${loadErrors} ` +
      `engineErrors=${engineErrors} emptyGraphs=${emptyGraphs}`,
  );
  console.log('');
  console.log(`  vs published anchor: SOTA avg ${pct(ANCHOR_AVG)} / best ${pct(ANCHOR_BEST)}`);
  const delta = top1 - ANCHOR_AVG;
  console.log(`  Δ vs SOTA avg: ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`);
  console.log('');
  console.log('  Per-fault-type Top@1:');
  const sortedFaults = [...faultCells.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [ft, cell] of sortedFaults) {
    const acc = cell.total > 0 ? cell.correct / cell.total : 0;
    console.log(
      `    ${ft.padEnd(24)} ${cell.correct.toString().padStart(3)}/${cell.total
        .toString()
        .padEnd(3)} ${pct(acc)}`,
    );
  }
  console.log(`${'═'.repeat(65)}`);

  // ── Structured output (for CI artifact) ──────────────────
  if (opts.output) {
    const report = buildFSE26Report({
      anchor: { sotaAvgTop1: ANCHOR_AVG, sotaBestTop1: ANCHOR_BEST },
      config: runConfig,
      cases: predictionsPerCase.length,
      top1,
      top3,
      top5,
      loadErrors,
      engineErrors,
      emptyGraphs,
      perFaultType: faultCells,
    });
    writeFileSync(opts.output, JSON.stringify(report, null, 2));
    console.log(`\nResults written to ${opts.output}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
