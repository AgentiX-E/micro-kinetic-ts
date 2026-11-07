/**
 * Convergence detection for Gaussian Process optimization.
 *
 * Detects when the GP posterior variance has collapsed below a threshold,
 * indicating the optimizer has found a stable optimum.  Uses two conditions:
 *
 * 1. Variance criterion: max σ²(θ) over a fixed set of test points < ε_σ
 * 2. Stability criterion: mean change in consecutive iterations < ε_μ
 * 3. Patience: both conditions must hold for P consecutive iterations
 *
 * This prevents premature stopping from random variance drops.
 */

import type { GPPrediction } from './gaussian-process.js';

// ── Types ──

export interface ConvergenceOptions {
  /** Variance threshold: stop when max σ² < ε_σ */
  readonly epsilonVariance: number;
  /** Mean stability threshold: stop when |μ_t - μ_{t-1}| < ε_μ */
  readonly epsilonMean: number;
  /** Patience: consecutive iterations below thresholds */
  readonly patience: number;
}

export interface ConvergenceState {
  /** Number of consecutive converged iterations */
  readonly consecutiveConverged: number;
  /** Best accuracy so far */
  readonly bestAccuracy: number;
  /** Iteration of best accuracy */
  readonly bestIteration: number;
  /** Variance history for analysis */
  readonly varianceHistory: readonly number[];
  /** Mean history for analysis */
  readonly meanHistory: readonly number[];
}

// ── Defaults ──

const DEFAULTS: ConvergenceOptions = {
  epsilonVariance: 0.005,
  epsilonMean: 0.01,
  patience: 2,
};

// ── Implementation ──

export class ConvergenceChecker {
  private readonly options: ConvergenceOptions;
  private state: ConvergenceState;

  constructor(options?: Partial<ConvergenceOptions>) {
    this.options = { ...DEFAULTS, ...options };
    this.state = {
      consecutiveConverged: 0,
      bestAccuracy: -Infinity,
      bestIteration: -1,
      varianceHistory: [],
      meanHistory: [],
    };
  }

  /** Current state */
  get currentState(): ConvergenceState {
    return { ...this.state };
  }

  /** Check if optimization has converged */
  checkConvergence(
    predictions: readonly GPPrediction[],
    accuracy: number,
    iteration: number,
  ): boolean {
    // Update best tracking
    if (accuracy > this.state.bestAccuracy) {
      this.state = {
        ...this.state,
        bestAccuracy: accuracy,
        bestIteration: iteration,
      };
    }

    // Variance check: max posterior variance across test points
    let maxVariance = 0;
    let avgMean = 0;
    for (const p of predictions) {
      if (p.variance > maxVariance) maxVariance = p.variance;
      avgMean += p.mean;
    }
    avgMean /= predictions.length;

    // Mean stability: compare with previous mean
    let meanStable = true;
    const prevMeans = this.state.meanHistory;
    if (prevMeans.length > 0) {
      const prevMean = prevMeans[prevMeans.length - 1]!;
      meanStable = Math.abs(avgMean - prevMean) < this.options.epsilonMean;
    }

    // Accumulate history
    const varHistory = [...this.state.varianceHistory, maxVariance];
    const meanHistory = [...this.state.meanHistory, avgMean];

    const varianceConverged = maxVariance < this.options.epsilonVariance;
    const bothCriteria = varianceConverged && meanStable;

    this.state = {
      ...this.state,
      consecutiveConverged: bothCriteria ? this.state.consecutiveConverged + 1 : 0,
      varianceHistory: varHistory,
      meanHistory,
    };

    return this.state.consecutiveConverged >= this.options.patience;
  }

  /** Reset checker for a new optimization run */
  reset(): void {
    this.state = {
      consecutiveConverged: 0,
      bestAccuracy: -Infinity,
      bestIteration: -1,
      varianceHistory: [],
      meanHistory: [],
    };
  }
}
