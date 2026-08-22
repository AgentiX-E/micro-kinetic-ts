/**
 * Micro-Kinetic benchmark runner CLI.
 *
 * Runs synthetic benchmark suites for all 6 fault types, produces
 * per-fault-type breakdown, and outputs results in github-action-benchmark
 * compatible JSON format.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-all.ts [--output <path>]
 *   pnpm exec tsx benchmarks/src/run-all.ts --cases 30   (mixed mode)
 *
 * Output formats:
 *   1. Console table with per-fault-type Avg@1, Avg@5, LA, TA
 *   2. github-action-benchmark JSON (stdout + optional file)
 *
 * @module benchmarks/run-all
 */

import { resolve, dirname } from 'node:path';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Container, DI_TOKENS } from '../../packages/core/src/index.js';
import { BenchmarkRunner } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import type { RunResult } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/synthetic/data-generator.js';
import {
  RegexFaultClassifier,
  DEFAULT_CLASSIFICATION_RULES,
} from '../../packages/core/src/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────

const FAULT_TYPES: ReadonlyArray<{ type: string; count: number }> = [
  { type: 'CPU', count: 30 },
  { type: 'MEM', count: 30 },
  { type: 'DISK', count: 30 },
  { type: 'DELAY', count: 30 },
  { type: 'LOSS', count: 30 },
  { type: 'SOCKET', count: 25 },
];

const TOTAL_CASES = FAULT_TYPES.reduce((s, f) => s + f.count, 0);

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  output?: string;
  perFaultType: boolean;
  cases: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { cases: TOTAL_CASES, perFaultType: true };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) opts.output = args[++i]!;
    else if (args[i] === '--cases' && i + 1 < args.length) {
      opts.cases = parseInt(args[++i]!, 10) || TOTAL_CASES;
      opts.perFaultType = false;
    }
  }
  return opts;
}

// ── DI Assembly ───────────────────────────────────────────

function createBenchmarkContainer(): Container {
  const container = new Container();
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());
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
  const runner = new BenchmarkRunner(container, classifier);

  if (opts.perFaultType) {
    await runPerFaultType(generator, runner, opts, startTime);
  } else {
    await runMixed(generator, runner, opts, startTime);
  }
}

// ── Per-Fault-Type Mode ──────────────────────────────────

async function runPerFaultType(
  generator: SyntheticBenchmarkGenerator,
  runner: BenchmarkRunner,
  opts: CliOptions,
  startTime: number,
): Promise<void> {
  console.log('');
  console.log('Micro-Kinetic v0.1.0 — Synthetic Benchmark Validation');
  console.log('═'.repeat(75));
  console.log('');

  const results: Array<{ faultType: string; result: RunResult }> = [];

  for (const ft of FAULT_TYPES) {
    const suite = generator.generateRCAEvalSuite(`fault-${ft.type}`, ft.count);
    const result = await runner.runSuite(suite);
    results.push({ faultType: ft.type, result });

    console.log(
      `  ${ft.type.padEnd(8)} ${String(ft.count).padStart(4)} cases  ` +
      `Avg@1: ${(result.avgTop1 * 100).toFixed(1)}%  ` +
      `Avg@5: ${(result.avgTop5 * 100).toFixed(1)}%  ` +
      `LA: ${(result.locationAccuracy * 100).toFixed(1)}%  ` +
      `TA: ${(result.typeAccuracy * 100).toFixed(1)}%  ` +
      `${result.duration}ms`,
    );
  }

  // Summary
  const totalCases = results.reduce((s, r) => s + r.result.totalCases, 0);
  const weightedAvg1 = totalCases > 0
    ? results.reduce((s, r) => s + r.result.avgTop1 * r.result.totalCases, 0) / totalCases
    : 0;
  const weightedAvg5 = totalCases > 0
    ? results.reduce((s, r) => s + r.result.avgTop5 * r.result.totalCases, 0) / totalCases
    : 0;
  const weightedLA = totalCases > 0
    ? results.reduce((s, r) => s + r.result.locationAccuracy * r.result.totalCases, 0) / totalCases
    : 0;
  const weightedTA = totalCases > 0
    ? results.reduce((s, r) => s + r.result.typeAccuracy * r.result.totalCases, 0) / totalCases
    : 0;

  console.log('');
  console.log('  ' + '═'.repeat(60));
  console.log(`  Overall   ${String(totalCases).padStart(4)} cases  ` +
    `Avg@1: ${(weightedAvg1 * 100).toFixed(1)}%  ` +
    `Avg@5: ${(weightedAvg5 * 100).toFixed(1)}%  ` +
    `LA: ${(weightedLA * 100).toFixed(1)}%  ` +
    `TA: ${(weightedTA * 100).toFixed(1)}%`);
  console.log('');

  // github-action-benchmark JSON
  const totalMs = Date.now() - startTime;
  const json = JSON.stringify([
    { name: 'Total Duration', value: totalMs, unit: 'ms', range: '± 50' },
    { name: 'Avg@1 Accuracy', value: Number(weightedAvg1.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Avg@5 Accuracy', value: Number(weightedAvg5.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Location Accuracy', value: Number(weightedLA.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Type Accuracy', value: Number(weightedTA.toFixed(4)), unit: 'ratio', range: '0-1' },
  ], null, 2);

  if (opts.output) {
    writeFileSync(resolve(__dirname, '..', '..', opts.output), json, 'utf-8');
    console.log(`Results written to ${opts.output}`);
  }
  console.log(json);
}

// ── Mixed Mode (backward compat) ──────────────────────────

async function runMixed(
  generator: SyntheticBenchmarkGenerator,
  runner: BenchmarkRunner,
  opts: CliOptions,
  startTime: number,
): Promise<void> {
  const suite = generator.generateRCAEvalSuite('synthetic-bench', opts.cases);
  const result = await runner.runSuite(suite);
  const totalMs = Date.now() - startTime;

  const json = JSON.stringify([
    { name: 'Total Duration', value: totalMs, unit: 'ms', range: '± 50' },
    { name: 'Avg@1 Accuracy', value: Number(result.avgTop1.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Avg@5 Accuracy', value: Number(result.avgTop5.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Location Accuracy', value: Number(result.locationAccuracy.toFixed(4)), unit: 'ratio', range: '0-1' },
    { name: 'Type Accuracy', value: Number(result.typeAccuracy.toFixed(4)), unit: 'ratio', range: '0-1' },
  ], null, 2);

  if (opts.output) {
    writeFileSync(resolve(__dirname, '..', '..', opts.output), json, 'utf-8');
  }
  console.log(json);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
