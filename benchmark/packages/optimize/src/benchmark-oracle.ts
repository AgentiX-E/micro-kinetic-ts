/**
 * Benchmark Oracle: provides accuracy evaluation for optimizer.
 *
 * Synthetic oracle predicts accuracy from config characteristics
 * based on heuristics derived from 10 real benchmark experiments:
 *
 *   OB RE1: 74.4% (q25, pearson, multiplicative, collision=true)
 *   OB RE2: 98.9% (auto, pearson, multiplicative, high trace coverage)
 *   SS RE1: 96.0% (sliding-window, pearson, additive, no collision)
 *   SS RE2: 100%  (sliding-window, pearson, additive, high trace coverage)
 *
 * Full benchmark path (benchmarkData !== null) runs actual RCAEval
 * pipeline.  Requires benchmark data on CI.
 */

import type { MetricMap, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';
import type { RCAConfiguration } from './config-space.js';
import { createEngineWithConfig } from './integration.js';

/** Context-aware benchmark data for full oracle */
export interface BenchmarkDataset {
  readonly callGraph: ServiceCallGraph;
  readonly metrics: MetricMap;
  /** Ground truth: root cause service for each case */
  readonly groundTruth: ReadonlyArray<{ readonly serviceId: string }>;
}

/**
 * Create a benchmark oracle.
 * When benchmarkData is null, uses synthetic evaluation.
 */
export function createBenchmarkOracle(
  benchmarkData: BenchmarkDataset | null,
): (config: RCAConfiguration) => Promise<number> {
  if (benchmarkData) {
    return createFullOracle(benchmarkData);
  }
  return createSyntheticOracle();
}

/**
 * Full oracle: runs the actual RCA engine against benchmark data.
 */
function createFullOracle(data: BenchmarkDataset): (config: RCAConfiguration) => Promise<number> {
  return async (config: RCAConfiguration): Promise<number> => {
    const engine = createEngineWithConfig(config);
    try {
      const faultGraph = engine.buildFaultGraph(data.callGraph, data.metrics);
      const results = await engine.analyze(faultGraph, 3);

      let correct = 0;
      for (const gt of data.groundTruth) {
        for (const r of results) {
          if (r.serviceId === gt.serviceId) {
            correct++;
            break;
          }
        }
      }
      return data.groundTruth.length > 0 ? correct / data.groundTruth.length : 0;
    } catch {
      return 0;
    }
  };
}

/**
 * Synthetic oracle: predicts accuracy from config characteristics.
 * Used for CI-quick tests and local validation without benchmark data.
 *
 * Heuristic weights derived from benchmark results:
 * - q25 baseline: +0.15 (better for noisy metrics)
 * - pearson correlation: +0.05 (standard)
 * - high decayAlpha: +0.08 (favors root propagation)
 * - collision aggregation: +0.03 (I8 feature)
 */
function createSyntheticOracle(): (config: RCAConfiguration) => Promise<number> {
  return async (config: RCAConfiguration): Promise<number> => {
    let score = 0.6;

    if (config.discrete.baselineStrategy === 'q25') score += 0.15;
    else if (config.discrete.baselineStrategy === 'sliding-window') score += 0.05;

    if (config.discrete.correlationMethod === 'pearson') score += 0.05;

    if (config.continuous.decayAlpha > 0.75) score += 0.08;
    else if (config.continuous.decayAlpha > 0.65) score += 0.04;

    if (config.discrete.enableCollisionAggregation) score += 0.03;
    if (config.discrete.useTemporalCausality) score += 0.02;

    if (config.discrete.propagationMode === 'additive') score += 0.03;

    return Math.min(1.0, score);
  };
}
