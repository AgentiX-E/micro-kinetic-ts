/**
 * AdaptiveConfigOptimizer: LLM-Guided Bayesian Optimization for RCA.
 *
 * Core orchestration algorithm:
 *
 *   1. Extract system context x from ServiceCallGraph + metrics
 *   2. Meta-learner predicts prior θ₀ from historical (xᵢ, θ*ᵢ, r*ᵢ) tuples
 *   3. Initialize GP surrogate with RBF kernel, prior centered at θ₀
 *   4. For t = 1..maxIterations:
 *      a. Thompson sample N candidates from GP posterior
 *      b. Optional: LLM advisor ranks candidates by domain knowledge
 *      c. Select θ_t via UCB-LLM acquisition
 *      d. Evaluate f(θ_t) via benchmark oracle
 *      e. Update GP with (θ_t, r_t)
 *      f. Check convergence: σ² < ε for P consecutive iterations
 *   5. Return θ* = argmax μ(θ)
 *   6. Persist learned model for future predictions
 *
 * Cost budget: ≤ 5 iterations × $0.05/LLM call = $0.25 per system.
 * Convergence: guaranteed for RBF kernel with bounded information gain.
 */

import type { MetricMap, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';

import type { ConfigSpace, RCAConfiguration } from './config-space.js';
import { DEFAULT_CONFIG, DEFAULT_CONFIG_SPACE } from './config-space.js';
import { extractSystemContext } from './context-extractor.js';
import type { ConvergenceOptions } from './convergence-checker.js';
import { ConvergenceChecker } from './convergence-checker.js';
import type { GPOptions, GPPrediction } from './gaussian-process.js';
import { GaussianProcess } from './gaussian-process.js';
import type { ExperimentRecord, LLMAdvisorOptions } from './llm-advisor.js';
import { LLMAdvisor } from './llm-advisor.js';
import type { HistoricalRecord } from './meta-learner.js';
import { MetaLearner } from './meta-learner.js';

// ── Types ──

/** Benchmark oracle: evaluates a configuration and returns accuracy */
export type BenchmarkOracle = (config: RCAConfiguration) => Promise<number>;

/** Extended info for an experiment iteration */
export interface IterationRecord {
  readonly iteration: number;
  readonly config: RCAConfiguration;
  readonly accuracy: number;
  readonly posteriorMean: number;
  readonly posteriorStd: number;
  readonly llmConsulted: boolean;
}

export interface OptimizationResult {
  /** Optimal RCA configuration found */
  readonly config: RCAConfiguration;
  /** Predicted accuracy at optimum */
  readonly predictedAccuracy: number;
  /** Number of iterations taken */
  readonly iterations: number;
  /** Whether convergence was reached */
  readonly converged: boolean;
  /** Per-iteration records */
  readonly history: readonly IterationRecord[];
  /** Best observed accuracy */
  readonly bestAccuracy: number;
}

export interface OptimizerOptions {
  readonly maxIterations: number;
  readonly ucbBeta: number;
  readonly candidateCount: number;
  readonly useLLM: boolean;
  readonly gpOptions: Partial<GPOptions>;
  readonly convergence: Partial<ConvergenceOptions>;
  readonly onProgress?: (iteration: number, config: RCAConfiguration, accuracy: number) => void;
  readonly configSpace?: ConfigSpace;
}

// ── Defaults ──

const DEFAULTS: OptimizerOptions = {
  maxIterations: 10,
  ucbBeta: 2.0,
  candidateCount: 20,
  useLLM: true,
  gpOptions: {
    signalVariance: 0.5,
    lengthScale: 0.3,
    noiseVariance: 1e-4,
  },
  convergence: {
    epsilonVariance: 0.005,
    epsilonMean: 0.01,
    patience: 2,
  },
};

// ── Implementation ──

export class AdaptiveConfigOptimizer {
  private readonly options: OptimizerOptions;
  private readonly metaLearner: MetaLearner | null;
  private readonly llmAdvisor: LLMAdvisor | null;
  private readonly space: ConfigSpace;

  constructor(
    historicalRecords?: readonly HistoricalRecord[],
    llmOptions?: Partial<LLMAdvisorOptions>,
    options?: Partial<OptimizerOptions>,
  ) {
    this.options = { ...DEFAULTS, ...options };
    this.space = this.options.configSpace ?? DEFAULT_CONFIG_SPACE;
    this.metaLearner =
      historicalRecords && historicalRecords.length > 0 ? new MetaLearner(historicalRecords) : null;

    this.llmAdvisor = this.options.useLLM ? new LLMAdvisor(llmOptions) : null;
  }

  /**
   * Run the full optimization loop for a given system.
   *
   * @param callGraph - Service call graph (for context extraction)
   * @param metrics - Metric time series (for context extraction)
   * @param oracle - Benchmark evaluation function
   */
  async optimize(
    callGraph: ServiceCallGraph,
    metrics: MetricMap,
    oracle: BenchmarkOracle,
  ): Promise<OptimizationResult> {
    // Step 1: Extract context
    const context = extractSystemContext(callGraph, metrics);

    // Step 2: Meta-learner prior
    let priorConfig = DEFAULT_CONFIG;
    if (this.metaLearner) {
      priorConfig = this.metaLearner.predict(context);
    }

    // Step 3: Initialize GP
    const gp = new GaussianProcess(this.space.dimension, this.options.gpOptions, this.space);

    // Optionally seed GP with prior config at low accuracy to center the mean
    const priorVec = this.space.toVector(priorConfig);
    gp.addObservation(priorVec, 0.6); // Soft prior: trust but verify

    // Step 4: Main loop
    const checker = new ConvergenceChecker(this.options.convergence);
    const history: IterationRecord[] = [];
    const experimentHistory: ExperimentRecord[] = [];

    // Reset LLM advisor cycle
    this.llmAdvisor?.resetCycle();

    let converged = false;
    let bestAccuracy = 0;

    for (let t = 1; t <= this.options.maxIterations; t++) {
      // 4a. Generate candidates via Thompson sampling
      const center = this.space.toVector(priorConfig);
      const variance = new Float64Array(center.length).fill(0.05);
      const candidates = this.space.sampleThompson(center, variance, this.options.candidateCount);

      // 4b. LLM advisor ranking (if enabled)
      let scores: number[] = Array.from({ length: candidates.length }, () => 1.0);
      let llmConsulted = false;

      if (this.llmAdvisor && experimentHistory.length > 1) {
        const rankResult = await this.llmAdvisor.rank(
          experimentHistory,
          candidates.map((c) => this.space.fromVector(c)),
          context,
        );
        if (rankResult.confidence > 0 && !rankResult.fromCache) {
          llmConsulted = true;
          // Convert ranking to scores: best=1.0, worst=1/n
          for (let i = 0; i < rankResult.ranking.length; i++) {
            scores[rankResult.ranking[i]!] = 1.0 - i / rankResult.ranking.length;
          }
        }
      }

      // 4c. UCB-LLM acquisition
      let bestScore = -Infinity;
      let bestCandidate: Float64Array = candidates[0]!;
      let bestPredMean = 0;
      let bestPredStd = 0;

      for (let i = 0; i < candidates.length; i++) {
        const pred = gp.predict(candidates[i]!);
        const ucb = pred.mean + this.options.ucbBeta * pred.std * scores[i]!;
        if (ucb > bestScore) {
          bestScore = ucb;
          bestCandidate = candidates[i]!;
          bestPredMean = pred.mean;
          bestPredStd = pred.std;
        }
      }

      const selectedConfig = this.space.fromVector(bestCandidate);

      // 4d. Evaluate via benchmark oracle
      const accuracy = await oracle(selectedConfig);
      if (accuracy > bestAccuracy) bestAccuracy = accuracy;

      // 4e. Update GP
      gp.addObservation(bestCandidate, accuracy);
      experimentHistory.push({ config: selectedConfig, accuracy });

      // Record iteration
      history.push({
        iteration: t,
        config: selectedConfig,
        accuracy,
        posteriorMean: bestPredMean,
        posteriorStd: bestPredStd,
        llmConsulted,
      });

      this.options.onProgress?.(t, selectedConfig, accuracy);

      // 4f. Convergence check
      const testPoints = this.generateTestPoints();
      const predictions: GPPrediction[] = [];
      for (const tp of testPoints) {
        predictions.push(gp.predict(tp));
      }

      converged = checker.checkConvergence(predictions, accuracy, t);
      if (converged) break;
    }

    // Step 5: Return best configuration
    const best = gp.bestObservation;
    const bestConfig =
      best.idx >= 0 && best.idx < experimentHistory.length
        ? experimentHistory[best.idx]!.config
        : priorConfig;

    return {
      config: bestConfig,
      predictedAccuracy: best.mean,
      iterations: history.length,
      converged,
      history,
      bestAccuracy,
    };
  }

  /** Generate test points for convergence variance check */
  private generateTestPoints(): Float64Array[] {
    const points: Float64Array[] = [];
    // Grid of 9 points: center + 8 corners of a box at 0.2/0.8
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const p = new Float64Array(this.space.dimension);
        p[0] = 0.1 + i * 0.4;
        p[1] = 0.1 + j * 0.4;
        points.push(p);
      }
    }
    return points;
  }
}

/** Re-export for convenience */
export type { MetricMap, ServiceCallGraph } from '@agentix-e/micro-kinetic-core';
