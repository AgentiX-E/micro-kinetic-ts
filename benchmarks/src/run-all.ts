/**
 * Micro-Kinetic benchmark runner CLI.
 *
 * Runs the synthetic benchmark suite and outputs results in the
 * github-action-benchmark compatible JSON format.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-all.ts [--output <path>] [--cases <n>]
 *
 * Output format (github-action-benchmark customSmallerIsBetter):
 *   [
 *     { "name": "RCA Pipeline (synthetic)", "value": <ms>, "unit": "ms" },
 *     { "name": "Avg@1 Accuracy", "value": <0-1>, "unit": "ratio" },
 *     ...
 *   ]
 *
 * @module benchmarks/run-all
 */

import { resolve, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── Direct source imports (avoid package resolution, tsx handles .ts) ──
import { Container, DI_TOKENS } from '../../packages/core/src/index.js';
import { BenchmarkRunner } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/synthetic/data-generator.js';
import {
  RegexFaultClassifier,
  DEFAULT_CLASSIFICATION_RULES,
} from '../../packages/core/src/index.js';

// ── Real RCA engine — Collision Tree Pruner ────────────────
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  output?: string;
  cases: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { cases: 175 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      opts.output = args[++i]!;
    } else if (args[i] === '--cases' && i + 1 < args.length) {
      opts.cases = parseInt(args[++i]!, 10) || 50;
    }
  }

  return opts;
}


// ── DI Assembly ──────────────────────────────────────────

/**
 * Create a container with the real CollisionTreeRCAEngine
 * and NumpyTsMatrixOps math backend.
 *
 * Uses direct source imports instead of package names since
 * the benchmark CLI runs via tsx without package resolution.
 */
function createBenchmarkContainer(): Container {
  const container = new Container();

  // Math backend
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());

  // RCA Engine — collision tree pruning
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());

  // Root Cause Ranker — tree-based score accumulation
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());

  return container;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  const container = createBenchmarkContainer();
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const generator = new SyntheticBenchmarkGenerator(42);
  const suite = generator.generateRCAEvalSuite('synthetic-bench', opts.cases);
  const runner = new BenchmarkRunner(container, classifier);
  const result = await runner.runSuite(suite);
  const totalDurationMs = Date.now() - startTime;

  const output = [
    {
      name: 'Total Duration',
      value: totalDurationMs,
      unit: 'ms',
      range: '± 50',
    },
    {
      name: 'Avg@1 Accuracy',
      value: Number(result.avgTop1.toFixed(4)),
      unit: 'ratio',
      range: '0-1',
    },
    {
      name: 'Avg@5 Accuracy',
      value: Number(result.avgTop5.toFixed(4)),
      unit: 'ratio',
      range: '0-1',
    },
    {
      name: 'Location Accuracy',
      value: Number(result.locationAccuracy.toFixed(4)),
      unit: 'ratio',
      range: '0-1',
    },
    {
      name: 'Type Accuracy',
      value: result.typeAccuracy !== undefined
        ? Number(result.typeAccuracy.toFixed(4))
        : 0,
      unit: 'ratio',
      range: '0-1',
    },
    {
      name: 'Suite Time',
      value: result.duration,
      unit: 'ms',
      range: '± 20',
    },
  ];

  const json = JSON.stringify(output, null, 2);
  if (opts.output) {
    const outPath = resolve(__dirname, '..', '..', opts.output);
    writeFileSync(outPath, json, 'utf-8');
    console.log(`Benchmark results written to ${outPath}`);
  }
  console.log(json);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
