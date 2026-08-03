/**
 * Real RCAEval benchmark — runs against 735 converted cases.
 *
 * Reads case directories from ~/RCAEval-json (produced by the pandas bridge
 * in benchmark-rcaeval.yml), parses them via the existing RCAEvalLoader,
 * and runs through BenchmarkRunner with the fault classifier.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-rcaeval.ts [--data-dir <path>] [--max-cases <n>]
 *
 * @module benchmarks/run-rcaeval
 */

import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Container, DI_TOKENS } from '../../packages/core/src/index.js';
import {
  BenchmarkRunner,
  RCAEvalLoader,
} from '../../packages/kinetic/src/benchmarks/index.js';
import type { BenchmarkCase, BenchmarkSuite } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/synthetic/data-generator.js';
import {
  RegexFaultClassifier,
  DEFAULT_CLASSIFICATION_RULES,
} from '../../packages/core/src/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  dataDir: string;
  maxCases: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    dataDir: join(homedir(), 'RCAEval-json'),
    maxCases: 0, // 0 = unlimited
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' && i + 1 < args.length) opts.dataDir = args[++i]!;
    else if (args[i] === '--max-cases' && i + 1 < args.length) opts.maxCases = parseInt(args[++i]!, 10) || 0;
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

// ── Case Discovery ────────────────────────────────────────

/**
 * Discover case directories in the RCAEval JSON directory tree.
 *
 * A case directory is identified by the presence of metrics.json
 * and inject_time.txt (or their equivalents).
 */
function discoverCases(dataDir: string, maxCases: number): string[] {
  if (!existsSync(dataDir)) {
    console.error(`Data directory not found: ${dataDir}`);
    console.error('Run benchmark-rcaeval.yml first to populate the cache.');
    return [];
  }

  const caseDirs: string[] = [];
  const queue = [dataDir];

  while (queue.length > 0 && (maxCases === 0 || caseDirs.length < maxCases)) {
    const current = queue.shift()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });

      // Check if this directory contains metrics.json → it's a case directory
      const hasMetrics = entries.some(
        (e) => e.isFile() && (e.name === 'metrics.json' || e.name === 'inject_time.txt'),
      );
      if (hasMetrics) {
        caseDirs.push(current);
        continue;
      }

      // Otherwise, recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          queue.push(join(current, entry.name));
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  return caseDirs;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('Micro-Kinetic — RCAEval Real Dataset Benchmark');
  console.log('═'.repeat(65));
  console.log(`Data directory: ${opts.dataDir}`);

  // Discover cases
  const caseDirs = discoverCases(opts.dataDir, opts.maxCases);
  if (caseDirs.length === 0) {
    console.log('No RCAEval cases found. Exiting.');
    return;
  }
  console.log(`Cases discovered: ${caseDirs.length}`);

  // Setup
  const container = createContainer();
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const runner = new BenchmarkRunner(container, classifier);
  const loader = new RCAEvalLoader();

  // Load cases
  const loadedCases: BenchmarkCase[] = [];
  const loadErrors: string[] = [];

  for (const caseDir of caseDirs) {
    try {
      const rawCase = loader.loadCase(caseDir);
      const callGraph = loader['buildFallbackCallGraph']?.(rawCase) ??
        buildSimpleCallGraph(Object.keys(rawCase.metrics));
      const benchCase = loader.toBenchmarkCase(
        rawCase,
        callGraph,
        'rcaeval-re1' as const,
      );
      loadedCases.push(benchCase);
    } catch (err) {
      loadErrors.push(`${caseDir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Loaded:  ${loadedCases.length} cases`);
  console.log(`Errors:  ${loadErrors.length}`);
  if (loadErrors.length > 0 && loadErrors.length <= 5) {
    for (const e of loadErrors) console.log(`  - ${e}`);
  }

  // Run benchmark
  if (loadedCases.length === 0) {
    console.log('No valid cases to benchmark.');
    return;
  }

  // Debug: print first case structure
  const first = loadedCases[0]!;
  console.log('');
  console.log(`First case:  ${first.id}`);
  console.log(`  Nodes:    ${first.callGraph.nodes.size}`);
  console.log(`  Edges:    ${first.callGraph.edges.length}`);
  console.log(`  Metrics:  ${[...first.metrics.keys()].join(', ').slice(0, 80)}`);
  console.log(`  GT svc:   ${first.groundTruth?.serviceId ?? '?'}`);
  console.log(`  GT type:  ${first.groundTruth?.faultType ?? '?'}`);

  const suite: BenchmarkSuite = {
    name: 'RCAEval Real',
    cases: loadedCases,
    totalCases: loadedCases.length,
  };

  console.log('');
  console.log('Running benchmark...');
  const result = await runner.runSuite(suite);
  const totalMs = Date.now() - startTime;

  // Results
  console.log('');
  console.log('═'.repeat(65));
  console.log('  Benchmark Results');
  console.log('═'.repeat(65));
  console.log(`  Total Cases:      ${result.totalCases}`);
  console.log(`  Avg@1:            ${(result.avgTop1 * 100).toFixed(1)}%`);
  console.log(`  Avg@5:            ${(result.avgTop5 * 100).toFixed(1)}%`);
  console.log(`  Location Accuracy: ${(result.locationAccuracy * 100).toFixed(1)}%`);
  console.log(`  Type Accuracy:     ${(result.typeAccuracy * 100).toFixed(1)}%`);
  console.log(`  Failures:          ${result.failures.length}`);
  console.log(`  Duration:          ${totalMs}ms`);
  console.log('');

  // Per-fault-type breakdown
  if (result.perFaultType.size > 0) {
    console.log('  Per-Fault-Type Breakdown:');
    for (const [ft, metric] of result.perFaultType) {
      console.log(`    ${ft.padEnd(20)} ${String(metric.cases).padStart(4)} cases  ${(metric.accuracy * 100).toFixed(1).padStart(6)}%`);
    }
    console.log('');
  }

  // Top failures
  if (result.failures.length > 0) {
    console.log(`  Top Failures (${Math.min(5, result.failures.length)}/${result.failures.length}):`);
    for (const f of result.failures.slice(0, 5)) {
      const reason = f.reason || '(empty reason)';
      console.log(`    - ${f.caseId}`);
      console.log(`      expected: ${f.expectedService}/${f.expectedFaultType}`);
      console.log(`      actual:   ${f.actualTop ?? 'none'}/${f.actualFaultType ?? 'none'}`);
      console.log(`      ${reason}`);
    }
  }

  console.log('═'.repeat(65));
}

// ── Helpers ───────────────────────────────────────────────

function buildSimpleCallGraph(serviceIds: string[]): import('@agentix-e/micro-kinetic-core').ServiceCallGraph {
  const nodes = new Map<string, import('@agentix-e/micro-kinetic-core').ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: id, namespace: 'rca-eval', labels: {} });
  }
  const edges: import('@agentix-e/micro-kinetic-core').CallEdge[] = [];
  // Create a ring topology so every service has at least one edge
  // This satisfies the TreePruner invariant: edges.length > 0
  if (serviceIds.length >= 2) {
    for (let i = 0; i < serviceIds.length; i++) {
      const next = (i + 1) % serviceIds.length;
      edges.push({
        from: serviceIds[i]!,
        to: serviceIds[next]!,
        type: 'REST',
        callRate: 100,
        p99Latency: 50,
        errorRate: 0.01,
      });
    }
  }
  return { nodes, edges, systemLoad: 0.5 };
}

main().catch((err) => {
  console.error('RCAEval benchmark failed:', err);
  process.exit(1);
});
