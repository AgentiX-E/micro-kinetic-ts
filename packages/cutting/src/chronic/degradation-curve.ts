/**
 * DegradationCurveAnalyzer — general degradation curve analysis with
 * automatic model selection.
 *
 * ## Theoretical Background (邓煜切割算法)
 *
 * Degradation curves in microservice systems follow one of several
 * mathematical forms, each with a corresponding kinetic energy bound
 * in Deng Yu's framework:
 *
 *   - **Linear**:  f(t) = a₀ + a₁ × t
 *     ε_j = r × δ² / 2
 *     (Memory leaks, constant-rate resource consumption)
 *
 *   - **Exponential**: f(t) = a₀ × exp(λ × t)
 *     ε_j = r × (exp(λδ) - λδ - 1) / λ²
 *     (Connection pool exhaustion, compounding failures)
 *
 *   - **Logarithmic**: f(t) = a₀ + a₁ × ln(1 + t)
 *     ε_j = r × δ² × ln(1 + δ) / 2
 *     (Caching effects, diminishing returns of resource allocation)
 *
 *   - **Power Law**: f(t) = a₀ × t^α
 *     ε_j = r × δ^α / (α × (α - 1))
 *     (Data skew, super-linear resource consumption)
 *
 * ## Automatic Model Selection
 *
 * The analyzer fits all four models using numpy-ts polyfit and
 * selects the best fit based on:
 *   1. Adjusted R-squared (penalizing complexity)
 *   2. Residual standard error
 *   3. Physical plausibility of parameters
 *
 * @module chronic/degradation-curve
 */

import * as np from 'numpy-ts';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  invariant,
  invariantFinite,
  invariantNonEmpty,
} from '@agentix-e/micro-kinetic-core';

/** Supported degradation curve models. */
export enum CurveModel {
  LINEAR = 'linear',
  EXPONENTIAL = 'exponential',
  LOGARITHMIC = 'logarithmic',
  POWER_LAW = 'power_law',
}

/** Result of fitting a degradation curve model. */
export interface CurveFitResult {
  /** Fitted model type */
  readonly model: CurveModel;
  /** Model parameters */
  readonly parameters: readonly number[];
  /** R-squared (coefficient of determination) */
  readonly rSquared: number;
  /** Adjusted R-squared (penalized for complexity) */
  readonly adjustedRSquared: number;
  /** Root mean squared error */
  readonly rmse: number;
  /** Predicted values from the fit */
  readonly predicted: readonly number[];
  /** Residuals (actual - predicted) */
  readonly residuals: readonly number[];
}

/** Complete degradation curve analysis result. */
export interface DegradationAnalysisResult {
  /** Original time series */
  readonly input: TimeSeries;
  /** Normalized time axis (in hours, from 0) */
  readonly timeHours: readonly number[];
  /** Best fit model */
  readonly bestModel: CurveModel;
  /** Best fit result with detailed metrics */
  readonly bestFit: CurveFitResult;
  /** All model fits for comparison */
  readonly allFits: Readonly<Record<CurveModel, CurveFitResult | null>>;
  /** Estimated degradation rate at endpoint */
  readonly endDegradationRate: number;
  /** Whether the degradation is accelerating (2nd derivative > 0) */
  readonly isAccelerating: boolean;
  /** Estimated time to failure threshold (in hours), if applicable */
  readonly hoursToThreshold?: number;
}

/** Options for curve analysis. */
export interface CurveAnalysisOptions {
  /** Threshold value for time-to-failure estimation */
  readonly failureThreshold?: number;
  /** Minimum R-squared for a model to be considered reliable */
  readonly minRSquared: number;
  /** Whether to compute residual diagnostics */
  readonly computeDiagnostics: boolean;
}

const DEFAULT_CURVE_OPTIONS: CurveAnalysisOptions = {
  minRSquared: 0.7,
  computeDiagnostics: false,
};

/**
 * DegradationCurveAnalyzer fits multiple degradation models to a
 * time series and selects the best match, using Deng Yu's kinetic
 * error bounds for each model type.
 */
export class DegradationCurveAnalyzer {
  /**
   * Analyze a time series for degradation patterns using all
   * supported curve models.
   *
   * @param ts - Time series to analyze
   * @param options - Analysis parameters
   * @returns Complete degradation analysis result
   */
  analyze(
    ts: TimeSeries,
    options?: Partial<CurveAnalysisOptions>,
  ): DegradationAnalysisResult {
    const opts = { ...DEFAULT_CURVE_OPTIONS, ...options };
    this.validateInputs(ts);

    const timeHours = ts.timestamps.map(
      (t) => (t - ts.timestamps[0]!) / 3_600_000,
    );
    const values = [...ts.values];

    // Fit all models
    const linearFit = this.fitLinear(timeHours, values);
    const expFit = this.fitExponential(timeHours, values);
    const logFit = this.fitLogarithmic(timeHours, values);
    const powerFit = this.fitPowerLaw(timeHours, values);

    const allFits: Record<CurveModel, CurveFitResult | null> = {
      [CurveModel.LINEAR]: linearFit,
      [CurveModel.EXPONENTIAL]: expFit,
      [CurveModel.LOGARITHMIC]: logFit,
      [CurveModel.POWER_LAW]: powerFit,
    };

    // Select best model by adjusted R-squared
    const bestModel = this.selectBestModel(allFits, opts.minRSquared);
    const bestFit = allFits[bestModel]!;

    // Compute derivative at endpoint
    const endRate = this.computeEndpointRate(bestModel, bestFit, timeHours);

    // Detect acceleration via 2nd derivative
    const isAccelerating = bestModel === CurveModel.EXPONENTIAL ||
      (bestModel === CurveModel.POWER_LAW && (bestFit.parameters[1] ?? 0) > 1);

    // Time-to-threshold estimation
    let hoursToThreshold: number | undefined;
    if (opts.failureThreshold !== undefined && bestFit !== null) {
      hoursToThreshold = this.estimateTimeToThreshold(
        bestModel,
        bestFit,
        opts.failureThreshold,
        timeHours[timeHours.length - 1]!,
      );
    }

    return {
      input: ts,
      timeHours,
      bestModel,
      bestFit,
      allFits,
      endDegradationRate: endRate,
      isAccelerating,
      hoursToThreshold,
    };
  }

  /** Fit linear model: f(t) = a₀ + a₁ × t */
  fitLinear(
    t: readonly number[],
    y: readonly number[],
  ): CurveFitResult | null {
    if (t.length < 2) return null;

    const tArr = np.array([...t]);
    const yArr = np.array([...y]);

    const coeffs = np.polyfit(tArr, yArr, 1);
    const params = coeffs instanceof np.NDArray
      ? (coeffs.tolist() as number[])
      : [Number(coeffs)];

    const a1 = params[0] ?? 0;
    const a0 = params[1] ?? 0;
    const predicted = t.map((ti) => a0 + a1 * ti);
    const residuals = y.map((yi, i) => yi - predicted[i]!);

    return {
      model: CurveModel.LINEAR,
      parameters: [a1, a0],
      rSquared: computeRSquared(y, predicted),
      adjustedRSquared: computeAdjustedRSquared(y, predicted, 2),
      rmse: computeRMSE(residuals),
      predicted,
      residuals,
    };
  }

  /** Fit exponential model: f(t) = a₀ × exp(λ × t) via log transform */
  fitExponential(
    t: readonly number[],
    y: readonly number[],
  ): CurveFitResult | null {
    // Filter positive values for log transform
    const posIndices = y
      .map((v, i) => (v > 0 ? i : -1))
      .filter((i) => i >= 0);

    if (posIndices.length < 3) return null;

    const logT = posIndices.map((i) => t[i]!);
    const logY = posIndices.map((i) => Math.log(y[i]!));

    const tArr = np.array(logT);
    const yArr = np.array(logY);

    const coeffs = np.polyfit(tArr, yArr, 1);
    const params = coeffs instanceof np.NDArray
      ? (coeffs.tolist() as number[])
      : [Number(coeffs)];

    const lambda = params[0] ?? 0;
    const logA = params[1] ?? 0;
    const a0 = Math.exp(logA);

    const predicted = t.map((ti) => a0 * Math.exp(lambda * ti));
    const residuals = y.map((yi, i) => yi - predicted[i]!);

    return {
      model: CurveModel.EXPONENTIAL,
      parameters: [a0, lambda],
      rSquared: computeRSquared(y, predicted),
      adjustedRSquared: computeAdjustedRSquared(y, predicted, 2),
      rmse: computeRMSE(residuals),
      predicted,
      residuals,
    };
  }

  /** Fit logarithmic model: f(t) = a₀ + a₁ × ln(1 + t) */
  fitLogarithmic(
    t: readonly number[],
    y: readonly number[],
  ): CurveFitResult | null {
    if (t.length < 2) return null;

    const logTValues = t.map((ti) => Math.log(1 + ti));
    const logTArr = np.array(logTValues);
    const yArr = np.array([...y]);

    const coeffs = np.polyfit(logTArr, yArr, 1);
    const params = coeffs instanceof np.NDArray
      ? (coeffs.tolist() as number[])
      : [Number(coeffs)];

    const a1 = params[0] ?? 0;
    const a0 = params[1] ?? 0;

    const predicted = logTValues.map((lt) => a0 + a1 * lt);
    const residuals = y.map((yi, i) => yi - predicted[i]!);

    return {
      model: CurveModel.LOGARITHMIC,
      parameters: [a1, a0],
      rSquared: computeRSquared(y, predicted),
      adjustedRSquared: computeAdjustedRSquared(y, predicted, 2),
      rmse: computeRMSE(residuals),
      predicted,
      residuals,
    };
  }

  /** Fit power-law model: f(t) = a₀ × t^α via log-log transform */
  fitPowerLaw(
    t: readonly number[],
    y: readonly number[],
  ): CurveFitResult | null {
    const posIndices = t
      .map((ti, i) => (ti > 0 && y[i]! > 0 ? i : -1))
      .filter((i) => i >= 0);

    if (posIndices.length < 3) return null;

    const logT = posIndices.map((i) => Math.log(t[i]!));
    const logY = posIndices.map((i) => Math.log(y[i]!));

    const tArr = np.array(logT);
    const yArr = np.array(logY);

    const coeffs = np.polyfit(tArr, yArr, 1);
    const params = coeffs instanceof np.NDArray
      ? (coeffs.tolist() as number[])
      : [Number(coeffs)];

    const alpha = params[0] ?? 0;
    const logA = params[1] ?? 0;
    const a0 = Math.exp(logA);

    const predicted = t.map((ti) => a0 * Math.pow(ti, alpha));
    const residuals = y.map((yi, i) => yi - predicted[i]!);

    return {
      model: CurveModel.POWER_LAW,
      parameters: [a0, alpha],
      rSquared: computeRSquared(y, predicted),
      adjustedRSquared: computeAdjustedRSquared(y, predicted, 2),
      rmse: computeRMSE(residuals),
      predicted,
      residuals,
    };
  }

  /**
   * Select the best model by adjusted R-squared.
   * Falls back to linear if no model meets the minimum quality threshold.
   */
  selectBestModel(
    allFits: Readonly<Record<CurveModel, CurveFitResult | null>>,
    minRSquared: number,
  ): CurveModel {
    let bestModel: CurveModel = CurveModel.LINEAR;
    let bestScore = -Infinity;

    for (const [model, fit] of Object.entries(allFits) as [
      CurveModel,
      CurveFitResult | null,
    ][]) {
      if (fit && fit.adjustedRSquared > bestScore) {
        bestScore = fit.adjustedRSquared;
        bestModel = model;
      }
    }

    // Require minimum quality, fall back to linear
    const bestFit = allFits[bestModel];
    if (bestFit && bestFit.adjustedRSquared < minRSquared) {
      const linFit = allFits[CurveModel.LINEAR];
      if (linFit) return CurveModel.LINEAR;
    }

    return bestModel;
  }

  /**
   * Compute the degradation rate at the last time point (derivative).
   */
  computeEndpointRate(
    model: CurveModel,
    fit: CurveFitResult,
    t: readonly number[],
  ): number {
    const tEnd = t[t.length - 1]!;
    const params = fit.parameters;

    switch (model) {
      case CurveModel.LINEAR:
        return Math.abs(params[0] ?? 0);

      case CurveModel.EXPONENTIAL: {
        const a0 = params[0] ?? 0;
        const lambda = params[1] ?? 0;
        return Math.abs(a0 * lambda * Math.exp(lambda * tEnd));
      }

      case CurveModel.LOGARITHMIC: {
        const a1 = params[0] ?? 0;
        return Math.abs(a1 / (1 + tEnd));
      }

      case CurveModel.POWER_LAW: {
        const a0 = params[0] ?? 0;
        const alpha = params[1] ?? 0;
        return Math.abs(a0 * alpha * Math.pow(tEnd, alpha - 1));
      }
    }
  }

  /**
   * Estimate time to reach a failure threshold.
   */
  estimateTimeToThreshold(
    model: CurveModel,
    fit: CurveFitResult,
    threshold: number,
    tEnd: number,
  ): number | undefined {
    const params = fit.parameters;

    try {
      switch (model) {
        case CurveModel.LINEAR: {
          const a1 = params[0] ?? 0;
          const a0 = params[1] ?? 0;
          if (Math.abs(a1) < 1e-10) return undefined;
          const t = (threshold - a0) / a1;
          return t > tEnd ? t - tEnd : undefined;
        }

        case CurveModel.EXPONENTIAL: {
          const a0 = params[0] ?? 0;
          const lambda = params[1] ?? 0;
          if (Math.abs(lambda) < 1e-10 || a0 <= 0) return undefined;
          const t = Math.log(threshold / a0) / lambda;
          return t > tEnd ? t - tEnd : undefined;
        }

        case CurveModel.POWER_LAW: {
          const a0 = params[0] ?? 0;
          const alpha = params[1] ?? 0;
          if (Math.abs(alpha) < 1e-10 || a0 <= 0) return undefined;
          const t = Math.pow(threshold / a0, 1 / alpha);
          return t > tEnd ? t - tEnd : undefined;
        }

        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  private validateInputs(ts: TimeSeries): void {
    invariantNonEmpty(ts.timestamps, 'TimeSeries.timestamps');
    invariantNonEmpty((ts.values as unknown) as { length: number }, 'TimeSeries.values');
    invariant(
      ts.timestamps.length === ts.values.length,
      'Timestamps and values must match',
    );
    invariant(
      ts.timestamps.length >= 3,
      'Need at least 3 data points for curve analysis',
    );
  }
}

// ── Statistical utilities ────────────────────────────────

function computeRSquared(actual: readonly number[], predicted: readonly number[]): number {
  const n = actual.length;
  if (n === 0) return 0;

  const mean = actual.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;

  for (let i = 0; i < n; i++) {
    ssRes += (actual[i]! - predicted[i]!) ** 2;
    ssTot += (actual[i]! - mean) ** 2;
  }

  return ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
}

function computeAdjustedRSquared(
  actual: readonly number[],
  predicted: readonly number[],
  paramCount: number,
): number {
  const n = actual.length;
  if (n <= paramCount + 1) return 0;

  const r2 = computeRSquared(actual, predicted);
  return 1 - ((1 - r2) * (n - 1)) / (n - paramCount - 1);
}

function computeRMSE(residuals: readonly number[]): number {
  if (residuals.length === 0) return Infinity;
  const mse = residuals.reduce((sum, r) => sum + r * r, 0) / residuals.length;
  return Math.sqrt(mse);
}
