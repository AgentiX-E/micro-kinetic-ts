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

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI ───────────────────────────────────────────────────

interface CliOptions {
  output?: string;
  cases: number;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = { cases: 50 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' && i + 1 < args.length) {
      opts.output = args[++i]!;
    } else if (args[i] === '--cases' && i + 1 < args.length) {
      opts.cases = parseInt(args[++i]!, 10) || 50;
    }
  }

  return opts;
}

// ── Helpers ───────────────────────────────────────────────

function createMockEngine() {
  return {
    buildFaultGraph: (
      callGraph: { nodes: Map<string, unknown>; edges: unknown[] },
      _metrics: unknown,
    ) => ({
      callGraph,
      propagationWeights: new Float64Array(0),
      anomalyScores: new Map(),
      detectedCycles: [],
      totalCycleContribution: 0,
      pruneThreshold: 0.001,
    }),
    analyze: async (_graph: unknown, topK = 5) => {
      const results = [];
      for (let i = 1; i <= Math.min(topK, 5); i++) {
        results.push({
          serviceId: `service_${i}`,
          faultType: { category: 'CPU', subType: '', severity: 'major' },
          confidence: 1 / i,
          rank: i,
          timestamp: Date.now(),
          evidenceMetrics: [],
          propagationDepth: i,
          propagationErrorBound: 0.01,
          viaTreeSearch: true,
        });
      }
      return results;
    },
    getCycleContributionBound: () => 0,
  };
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  const startTime = Date.now();

  const container = new Container();
  container.register(DI_TOKENS.RCA_ENGINE, () => createMockEngine());

  const generator = new SyntheticBenchmarkGenerator(42);
  const suite = generator.generateRCAEvalSuite('synthetic-bench', opts.cases);

  const runner = new BenchmarkRunner(container);
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
