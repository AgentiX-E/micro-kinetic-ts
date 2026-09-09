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
 *     [--max-cases N] [--log-weight <w>] [--no-rank-normalization] [--output <path>]
 *
 * Read-only: never writes to the data directory.
 *
 * @module benchmarks/run-fse26
 */

import { readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { RootCauseResult } from '../../packages/core/src/index.js';

import {
  FSE26Loader,
  computeAvgAtKMultiLabel,
} from '../../packages/kinetic/src/benchmarks/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';

interface CliOptions {
  dataDir: string;
  maxCases: number;
  /** Strength of the log signal (self-caused logic-exception volume). */
  logWeight: number;
  /** Rank-based anomaly-score normalization on large topologies (≥ 20 nodes). */
  rankNormalization: boolean;
  /** Emit a JSON result document to this path (optional). */
  output: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCABench-json'),
    maxCases: 0,
    logWeight: 1.0,
    rankNormalization: true,
    output: '',
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length)
      opts.maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--log-weight' && i + 1 < args.length)
      opts.logWeight = parseFloat(args[++i]!) || 0;
    else if (args[i] === '--no-rank-normalization') opts.rankNormalization = false;
    else if (args[i] === '--output' && i + 1 < args.length) opts.output = args[++i]!;
  }
  return opts;
}

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

async function main(): Promise<void> {
  const opts = parseArgs();
  const loader = new FSE26Loader();

  // Production ranking config: the log signal is shipped enabled (benchmark
  // #220 net-positive, zero regression); every other causal prior is opt-in.
  // Rank normalization is load-bearing on Train Ticket's large topologies.
  const pruner = new TreePruner(
    { logWeight: opts.logWeight, logSignalMode: 'count' },
    { rankNormalization: opts.rankNormalization },
  );

  console.log("Micro-Kinetic — FSE'26 RCABench");
  console.log('═'.repeat(65));
  console.log(`Data:   ${opts.dataDir}`);
  console.log(`Config: logWeight=${opts.logWeight} rankNormalization=${opts.rankNormalization}`);
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

  for (const dir of selected) {
    let raw;
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
    const benchCase = loader.toBenchmarkCase(raw);
    // Dual-label accepted set: the raw case's full ground-truth list (two
    // labels for network faults, one otherwise).
    const accepted =
      raw.groundTruthServices.length > 0
        ? [...raw.groundTruthServices]
        : [benchCase.groundTruth.serviceId];
    const faultType = benchCase.groundTruth.faultType ?? 'unknown';

    let ranking: RootCauseResult[] = [];
    try {
      if (benchCase.callGraph.edges.length === 0) {
        // The engine requires ≥ 1 edge; a single-service case is degenerate.
        emptyGraphs++;
      } else {
        const faultGraph = pruner.buildFaultGraph(benchCase.callGraph, benchCase.metrics, {
          injectTimeMs: benchCase.injectTime,
          logs: benchCase.logs,
        });
        ranking = pruner.analyze(faultGraph, 5);
      }
    } catch {
      engineErrors++;
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
    const report = {
      dataset: 'fse26',
      anchor: { sotaAvgTop1: ANCHOR_AVG, sotaBestTop1: ANCHOR_BEST },
      config: { logWeight: opts.logWeight, rankNormalization: opts.rankNormalization },
      cases: predictionsPerCase.length,
      top1,
      top3,
      top5,
      deltaVsSotaAvg: delta,
      loadErrors,
      engineErrors,
      emptyGraphs,
      perFaultType: Object.fromEntries(
        sortedFaults.map(([ft, cell]) => [
          ft,
          {
            total: cell.total,
            correct: cell.correct,
            top1: cell.total > 0 ? cell.correct / cell.total : 0,
          },
        ]),
      ),
    };
    writeFileSync(opts.output, JSON.stringify(report, null, 2));
    console.log(`\nResults written to ${opts.output}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
