/**
 * Real RCAEval benchmark — industry-standard per-system, per-dataset evaluation.
 *
 * Follows the RCAEval paper (arXiv:2412.17015) methodology:
 * - Cases grouped by benchmark system (OnlineBoutique/SockShop/TrainTicket)
 * - Cases grouped by dataset suite (RE1/RE2/RE3)
 * - Per-fault-type breakdown matching Table 6 format
 * - Results directly comparable with published baselines
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-rcaeval.ts [--data-dir <path>] [--system ob|ss|tt] [--max-cases <n>]
 *
 * @module benchmarks/run-rcaeval
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Container, DI_TOKENS } from '../../packages/core/src/index.js';
import {
  BenchmarkRunner,
  RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type { BenchmarkCase, BenchmarkSuite } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import type { RunResult } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  RegexFaultClassifier,
  DEFAULT_CLASSIFICATION_RULES,
} from '../../packages/core/src/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { buildRCAEvalCallGraph } from './rcaeval-topology.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  dataDir: string;
  maxCases: number;
  /** Filter to specific system: 'ob', 'ss', 'tt', or 'all' */
  system: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { dataDir: join(homedir(), 'RCAEval-json'), maxCases: 0, system: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length) opts.maxCases = parseInt(args[++i]!, 10) || 0;
    else if (args[i] === '--system' && i + 1 < args.length) opts.system = args[++i]!;
  }
  return opts;
}

// ── DI Assembly ───────────────────────────────────────────

function createContainer(): Container {
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
  return container;
}

// ── System Identification ─────────────────────────────────

/** Parsed case metadata from directory name. */
interface CaseMeta {
  suite: 'RE1' | 'RE2' | 'RE3';
  system: 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | 'Unknown';
  service: string;
  faultType: string;
  instance: number;
  dirPath: string;
}

function parseCaseDir(dirPath: string): CaseMeta | null {
  const name = basename(dirPath);
  // Pattern: re{1-3}{ob|ss|tt}_{service}_{fault}_{instance}
  const match = name.match(/^re([123])(ob|ss|tt)_(.+?)_(cpu|mem|disk|delay|loss|socket)_(\d+)$/i);
  if (!match) return null;

  const suiteNum = match[1]!;
  const sysCode = match[2]!;
  return {
    suite: `RE${suiteNum}` as CaseMeta['suite'],
    system: sysCode === 'ob' ? 'OnlineBoutique' : sysCode === 'ss' ? 'SockShop' : 'TrainTicket',
    service: match[3]!,
    faultType: match[4]!.toLowerCase(),
    instance: parseInt(match[5]!, 10),
    dirPath,
  };
}

// ── Case Discovery ────────────────────────────────────────

function discoverAllCases(dataDir: string): CaseMeta[] {
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    return [];
  }

  const cases: CaseMeta[] = [];
  const queue = [dataDir];

  while (queue.length > 0) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      const hasMetrics = entries.some(
        (e) => e.isFile() && (e.name === 'metrics.json' || e.name === 'inject_time.txt'),
      );
      if (hasMetrics) {
        const meta = parseCaseDir(current);
        if (meta) cases.push(meta);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch { /* skip */ }
  }

  return cases;
}

// ── Loader ────────────────────────────────────────────────

function loadCases(
  metas: CaseMeta[],
  loader: RCAEvalLoader,
  maxCases: number,
): { cases: BenchmarkCase[]; errors: string[] } {
  const loaded: BenchmarkCase[] = [];
  const errors: string[] = [];
  const selected = maxCases > 0 ? metas.slice(0, maxCases) : metas;

  for (const meta of selected) {
    try {
      const rawCase = loader.loadCase(meta.dirPath);
      const serviceIds = Object.keys(rawCase.metrics);
      const callGraph = buildRCAEvalCallGraph(rawCase.benchmark, serviceIds);
      const suiteName = meta.suite === 'RE1' ? 'rcaeval-re1' as const
        : meta.suite === 'RE2' ? 'rcaeval-re2' as const
        : 'rcaeval-re3' as const;
      loaded.push(loader.toBenchmarkCase(rawCase, callGraph, suiteName));
    } catch (err) {
      errors.push(`${meta.dirPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { cases: loaded, errors };
}

// ── Output — Industry-Standard Table ──────────────────────

/**
 * Print a table in the RCAEval paper format:
 *
 *   Method | Metric | CPU | MEM | DISK | SOCKET | DELAY | LOSS | AVERAGE
 */
function printResultsTable(
  systemName: string,
  suiteName: string,
  results: Map<string, RunResult>,
): void {
  const faultTypes = ['cpu', 'mem', 'disk', 'delay', 'loss'];

  // Header
  console.log('');
  console.log(`╔${'═'.repeat(80)}╗`);
  console.log(`║  ${systemName.padEnd(30)} ${suiteName.padEnd(15)} ${'Micro-Kinetic'.padEnd(20)} ║`);
  console.log(`╠${'═'.repeat(80)}╣`);

  // Column headers
  let header = '║ Method              | Metric |';
  for (const ft of faultTypes) header += ` ${ft.toUpperCase().padEnd(6)} |`;
  header += ' AVERAGE ║';
  console.log(header);

  console.log(`╠${'═'.repeat(80)}╣`);

  // Metric rows: AC@1, Avg@5, LA, TA
  const metrics: Array<{ key: keyof RunResult; label: string }> = [
    { key: 'avgTop1', label: 'AC@1  ' },
    { key: 'avgTop5', label: 'Avg@5 ' },
    { key: 'locationAccuracy', label: 'LA    ' },
    { key: 'typeAccuracy', label: 'TA    ' },
  ];

  for (const metric of metrics) {
    const averages: number[] = [];
    let row = `║ Micro-Kinetic       | ${metric.label} |`;
    for (const ft of faultTypes) {
      const r = results.get(ft);
      if (r) {
        const perFault = r.perFaultType.get(ft);
        const val = perFault ? perFault.accuracy : 0;
        row += ` ${(val * 100).toFixed(1).padStart(5)}% |`;
        averages.push(val * 100);
      } else {
        row += `   N/A |`;
      }
    }
    const avg = averages.length > 0 ? averages.reduce((s, v) => s + v, 0) / averages.length : 0;
    row += ` ${avg.toFixed(1).padStart(5)}% ║`;
    console.log(row);
  }

  console.log(`╚${'═'.repeat(80)}╝`);
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('Micro-Kinetic — RCAEval Industry-Standard Benchmark');
  console.log('═'.repeat(65));
  console.log(`Data:  ${opts.dataDir}`);
  console.log(`Filter: ${opts.system}${opts.maxCases > 0 ? ` (max ${opts.maxCases} cases)` : ''}`);

  const allCases = discoverAllCases(opts.dataDir);
  console.log(`Cases discovered: ${allCases.length}`);

  // Group by system + suite
  const groups = new Map<string, CaseMeta[]>();
  for (const c of allCases) {
    if (opts.system !== 'all' && c.system !== 'OnlineBoutique' && c.system !== 'SockShop' && c.system !== 'TrainTicket') continue;
    // TODO: filter by system code
    const groupKey = `${c.system}:${c.suite}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(c);
  }

  if (groups.size === 0) {
    console.log('No cases found. Exiting.');
    return;
  }

  const container = createContainer();
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const runner = new BenchmarkRunner(container, classifier);
  const loader = new RCAEvalLoader();

  for (const [groupKey, metas] of groups) {
    const [systemName, suiteName] = groupKey.split(':') as [string, string];
    const caseLimit = opts.maxCases > 0 ? Math.min(opts.maxCases, metas.length) : 0;
    const { cases, errors } = loadCases(metas, loader, caseLimit);

    if (errors.length > 0) {
      console.log(`\nLoad errors (${systemName}/${suiteName}):`);
      for (const e of errors.slice(0, 3)) console.log(`  - ${e}`);
    }
    if (cases.length === 0) continue;

    // Split by fault type (matching paper's Table 6 format)
    const byFaultType = new Map<string, BenchmarkCase[]>();
    for (const c of cases) {
      const ft = c.groundTruth?.faultType?.toLowerCase() ?? 'unknown';
      if (!byFaultType.has(ft)) byFaultType.set(ft, []);
      byFaultType.get(ft)!.push(c);
    }

    // Print topology diagnostics
    const diagNode = cases[0]?.callGraph.nodes.values().next().value;
    if (diagNode?.labels?._diag_system) {
      const l = diagNode.labels;
      console.log(`  [] topo: ${l._diag_matched} edges, ${l._diag_svc_matched} svcs matched, ${l._diag_unconnected} unconnected`);
    }

    // Run each fault type separately
    const results = new Map<string, RunResult>();
    for (const [ft, ftCases] of byFaultType) {
      if (ftCases.length === 0) continue;
      const suite: BenchmarkSuite = {
        name: `${systemName}-${suiteName}-${ft}`,
        cases: ftCases,
        totalCases: ftCases.length,
      };
      results.set(ft, await runner.runSuite(suite));
    }

    printResultsTable(systemName, suiteName, results);
  }

  console.log(`\nTotal duration: ${Date.now() - startTime}ms`);
}

main().catch((err) => {
  console.error('RCAEval benchmark failed:', err);
  process.exit(1);
});
