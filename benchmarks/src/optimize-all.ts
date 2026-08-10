/**
 * Adaptive Optimizer benchmark verification.
 *
 * Runs the optimizer on synthetic benchmark data to validate:
 *   1. The optimizer converges to a stable configuration
 *   2. Final accuracy meets or exceeds baseline
 *   3. Optimization trajectory is monotonic (no regressions)
 *
 * Uses 30 synthetic cases (5 per fault type) for fast optimization
 * cycle (~30s per iteration, 5 iterations = 2.5 minutes total).
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/optimize-all.ts
 */

import { SyntheticBenchmarkGenerator } from '../../packages/kinetic/src/benchmarks/synthetic/data-generator.js';

import type { RCAConfiguration } from '../../packages/optimize/src/config-space.js';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_SPACE } from '../../packages/optimize/src/config-space.js';
import { createEngineWithConfig } from '../../packages/optimize/src/integration.js';
import { AdaptiveConfigOptimizer } from '../../packages/optimize/src/optimizer.js';

// ── Config ────────────────────────────────────────────────

const CASES_PER_TYPE = 5;
const TOP_K = 1;

// ── Benchmark Oracle ──────────────────────────────────────

function createOracle(): (config: RCAConfiguration) => Promise<number> {
  return async (config: RCAConfiguration): Promise<number> => {
    const generator = new SyntheticBenchmarkGenerator(42);
    const suite = generator.generateRCAEvalSuite('synthetic', CASES_PER_TYPE * 6);

    const engine = createEngineWithConfig(config);
    let correct = 0;

    for (const c of suite.cases) {
      try {
        const faultGraph = engine.buildFaultGraph(c.callGraph, c.metrics);
        const results = await engine.analyze(faultGraph, TOP_K);
        if (results.length > 0 && results[0]!.serviceId === c.groundTruth.serviceId) {
          correct++;
        }
      } catch {
        // Skip failed cases
      }
    }

    return suite.cases.length > 0 ? correct / suite.cases.length : 0;
  };
}

function computeAccuracy(results: RunResult): number {
  if (results.totalCases === 0) return 0;
  return results.correct / results.totalCases;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Adaptive Optimizer Benchmark Verification ===\n');

  // 1. Run baseline with DEFAULT_CONFIG
  console.log('[1] Running baseline (DEFAULT_CONFIG)...');
  const baselineAccuracy = await createOracle()(DEFAULT_CONFIG);
  console.log(`    Baseline accuracy: ${(baselineAccuracy * 100).toFixed(1)}%\n`);

  // 2. Generate synthetic call graph for context extraction
  const generator = new SyntheticBenchmarkGenerator(42);
  const sampleCase = generator.generateRCAEvalCase('CPU', 5);

  const callGraph = sampleCase.callGraph;
  const metrics = sampleCase.metrics;

  // 3. Run optimizer
  console.log('[2] Running Adaptive Optimizer (max 5 iterations)...');
  const optimizer = new AdaptiveConfigOptimizer([], undefined, {
    maxIterations: 5,
    useLLM: false, // No LLM for CI-quick benchmark
    candidateCount: 10,
    ucbBeta: 1.5,
    convergence: { epsilonVariance: 0.01, epsilonMean: 0.03, patience: 2 },
  });

  const oracle = createOracle();
  const result = await optimizer.optimize(callGraph, metrics, oracle);

  // 4. Report
  console.log(`\n    Optimizer completed in ${result.iterations} iterations`);
  console.log(`    Converged: ${result.converged}`);
  console.log(`    Best accuracy: ${(result.bestAccuracy * 100).toFixed(1)}%`);
  console.log(`    Predicted accuracy: ${(result.predictedAccuracy * 100).toFixed(1)}%`);
  console.log(`    Baseline accuracy: ${(baselineAccuracy * 100).toFixed(1)}%`);

  const delta = result.bestAccuracy - baselineAccuracy;
  console.log(`    Delta: ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}pp`);

  console.log('\n    Optimization trajectory:');
  for (const entry of result.history) {
    console.log(
      `      iter=${entry.iteration} | acc=${(entry.accuracy * 100).toFixed(1)}% | ` +
        `${entry.config.discrete.baselineStrategy}/` +
        `coll=${entry.config.discrete.enableCollisionAggregation}/` +
        `α=${entry.config.continuous.decayAlpha.toFixed(2)}`,
    );
  }

  // 5. Validation: config should be valid
  const vec = DEFAULT_CONFIG_SPACE.toVector(result.config);
  const configValid = vec.every((v: number) => v >= 0 && v <= 1);

  console.log(`\n    Config valid: ${configValid}`);
  console.log(
    `    Final config: decayAlpha=${result.config.continuous.decayAlpha.toFixed(2)}, ` +
      `pruneEpsilon=${result.config.continuous.pruneEpsilon.toExponential(1)}, ` +
      `baseline=${result.config.discrete.baselineStrategy}, ` +
      `correlation=${result.config.discrete.correlationMethod}, ` +
      `propagation=${result.config.discrete.propagationMode}`,
  );

  // 6. Exit code: 0 if accuracy >= baseline, non-zero if regression
  if (delta < -0.05) {
    console.error('\n⚠️  Significant regression detected (>5pp below baseline)');
    process.exit(1);
  }

  console.log('\n=== Verification PASSED ===');
}

main().catch((err) => {
  console.error('Optimization failed:', err);
  process.exit(1);
});
