/**
 * Simple-statistics-based statistics provider.
 *
 * Implements the IStatistics interface using simple-statistics
 * for statistical computations required by the denoising engine.
 *
 * Deng Yu Theorem Mapping:
 *   The Stosszahlansatz independence proof relies on:
 *   - Mutual information estimation for coupling matrix C_{ij}
 *   - Independence testing via chi-squared / Hoeffding's D
 *   - The bound: sup|P(a,b) - P(a)P(b)| ≤ K/N  (Deng Yu, 2026)
 *
 * @module noise/math/statistics-provider
 */

import * as ss from 'simple-statistics';
import type {
  IStatistics,
  RollingStatsResult,
  KDEResult,
  TestResult,
  CouplingParams,
} from '@agentix-e/micro-kinetic-core';
import { invariant, invariantNonEmpty, invariantPositiveInt } from '@agentix-e/micro-kinetic-core';

/** Default mutual information parameters. */
const DEFAULT_MI_PARAMS: CouplingParams = {
  minCooccurrence: 5,
  timeWindowMs: 60000,
  smoothingFactor: 0.01,
};

/**
 * Simple-statistics-based statistics provider.
 *
 * Implements IStatistics for the denoising engine's statistical
 * operations: rolling statistics, KDE, independence testing,
 * mutual information, linear regression, and correlation.
 */
export class StatisticsProvider implements IStatistics {
  /**
   * Compute rolling statistics over a sliding window.
   *
   * Maps to: Deng Yu's time-windowed alert pattern analysis
   * used in short-time Stosszahlansatz verification.
   */
  public rollingStats(data: Float64Array, windowSize: number): RollingStatsResult {
    invariantPositiveInt(windowSize, 'windowSize');
    invariant(data.length >= windowSize, `data length (${data.length}) must be >= windowSize (${windowSize})`);

    const n = data.length;
    const resultLen = n - windowSize + 1;
    const mean = new Float64Array(resultLen);
    const variance = new Float64Array(resultLen);
    const stddev = new Float64Array(resultLen);

    for (let i = 0; i < resultLen; i++) {
      const window = Array.from(data.slice(i, i + windowSize));
      const m = ss.mean(window);
      const v = ss.sampleVariance(window);
      mean[i] = m;
      variance[i] = v;
      stddev[i] = Math.sqrt(v);
    }

    return { mean, variance, stddev, windowSize };
  }

  /**
   * Kernel density estimation.
   *
   * Uses Gaussian kernel with Silverman's rule-of-thumb bandwidth
   * if no bandwidth is provided.
   *
   * Maps to: Probability density estimation for P(a_i) marginal
   * distributions in the Stosszahlansatz factorisation.
   */
  public kde(samples: Float64Array, bandwidth?: number): KDEResult {
    invariantNonEmpty(samples, 'samples');

    const arr = Array.from(samples);
    const n = arr.length;

    // Silverman's rule of thumb
    const stddev = ss.sampleStandardDeviation(arr);
    const iqr = ss.quantile(arr, 0.75) - ss.quantile(arr, 0.25);
    const h = bandwidth ?? 0.9 * Math.min(stddev, iqr / 1.34) * Math.pow(n, -0.2);

    const m = Math.min(512, Math.ceil(n * 2));
    const minVal = ss.min(arr)!;
    const maxVal = ss.max(arr)!;
    const x = new Float64Array(m);
    const density = new Float64Array(m);

    for (let i = 0; i < m; i++) {
      x[i] = minVal + (i / (m - 1)) * (maxVal - minVal);
    }

    for (let i = 0; i < m; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        const z = (x[i]! - arr[j]!) / h;
        sum += gaussianKernel(z);
      }
      density[i] = sum / (n * h);
    }

    return { x, density, bandwidth: h };
  }

  /**
   * Test for independence between two variables.
   *
   * Uses Hoeffding's D statistic for continuous variables,
   * which maps to Deng Yu's decomposition error bound:
   *   sup|F(x,y) - F(x)F(y)|
   *
   * @returns TestResult with p-value, statistic, and significance
   */
  public independenceTest(x: Float64Array, y: Float64Array): TestResult {
    invariant(x.length === y.length, `x and y must have same length, got ${x.length} vs ${y.length}`);
    invariantNonEmpty(x, 'x');

    const arrX = Array.from(x);
    const arrY = Array.from(y);

    // Use Hoeffding's D for nonparametric independence testing
    const d = computeHoeffdingD(arrX, arrY);
    const n = arrX.length;
    const statistic = n * d;

    // Approximate p-value from chi-squared approximation
    // Under independence, n * D is approximately chi-squared with some df
    const df = 5; // heuristic for continuous
    const pValue = 1 - chiSquaredCDF(statistic, df);
    const significant = pValue < 0.05;

    return { pValue, statistic, significant };
  }

  /**
   * Compute mutual information between two alert time series.
   *
   * MI(X;Y) = H(X) + H(Y) - H(X,Y)
   * where H is Shannon entropy via empirical histogram.
   *
   * Maps to coupling strength C_{ij} = MI(alert_i, alert_j)
   * in the Stosszahlansatz coupling matrix.
   *
   * Deng Yu Theorem: If coupling is sparse (S > τ), then
   * the joint distribution factorizes with error O(1/N).
   */
  public mutualInformation(
    x: Float64Array,
    y: Float64Array,
    params?: CouplingParams,
  ): number {
    invariant(x.length === y.length, `x and y must have same length, got ${x.length} vs ${y.length}`);

    const p = { ...DEFAULT_MI_PARAMS, ...params };
    const bins = Math.max(10, Math.floor(Math.sqrt(x.length)));
    const smoothing = p.smoothingFactor;

    // Discretize into bins
    const xBins = discretize(x, bins);
    const yBins = discretize(y, bins);

    // Compute marginal and joint histogram
    const n = xBins.length;

    const hx: number[] = new Array(bins).fill(0);
    const hy: number[] = new Array(bins).fill(0);
    const hxy: number[][] = Array.from({ length: bins }, () => new Array(bins).fill(0));

    for (let i = 0; i < n; i++) {
      const bx = xBins[i]!;
      const by = yBins[i]!;
      hx[bx] = (hx[bx] ?? 0) + 1;
      hy[by] = (hy[by] ?? 0) + 1;
      hxy[bx]![by] = (hxy[bx]![by] ?? 0) + 1;
    }

    // Convert to probabilities with Laplace smoothing
    const px = hx.map(c => (c + smoothing) / (n + smoothing * bins));
    const py = hy.map(c => (c + smoothing) / (n + smoothing * bins));

    // Compute entropy H(X), H(Y), H(X,Y)
    let hX = 0;
    let hY = 0;
    let hXY = 0;

    const totalSmoothed = n + smoothing * bins * bins;

    for (let i = 0; i < bins; i++) {
      if (px[i]! > 1e-15) {
        hX -= px[i]! * Math.log2(px[i]!);
      }
      if (py[i]! > 1e-15) {
        hY -= py[i]! * Math.log2(py[i]!);
      }

      for (let j = 0; j < bins; j++) {
        const pxy = ((hxy[i]?.[j] ?? 0) + smoothing) / totalSmoothed;
        if (pxy > 1e-15) {
          hXY -= pxy * Math.log2(pxy);
        }
      }
    }

    return hX + hY - hXY;
  }

  /**
   * Fit a linear regression y = β₀ + β₁x.
   *
   * Maps to: Linear trend detection in fading alert correlations
   * for chronic fault classification.
   */
  public linearRegression(x: Float64Array, y: Float64Array): {
    readonly slope: number;
    readonly intercept: number;
    readonly rSquared: number;
  } {
    invariant(x.length === y.length, 'x and y must have same length');

    const arrX = Array.from(x);
    const arrY = Array.from(y);
    const result = ss.linearRegression(arrX.map((xi, i) => [xi, arrY[i]!]));

    const rSquared = ss.linearRegressionLine(result);

    return {
      slope: result.m,
      intercept: result.b,
      rSquared: ss.rSquared(arrX.map((xi, i) => [xi, arrY[i]!]), rSquared),
    };
  }

  /**
   * Compute Pearson correlation coefficient.
   *
   * Maps to: Linear correlation component of alert coupling.
   */
  public correlation(x: Float64Array, y: Float64Array): number {
    invariant(x.length === y.length, 'x and y must have same length');
    const arrX = Array.from(x);
    const arrY = Array.from(y);
    return ss.sampleCorrelation(arrX, arrY);
  }
}

// ── Internal helpers ──────────────────────────────────────

/**
 * Gaussian kernel function for KDE.
 */
function gaussianKernel(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

/**
 * Discretize a Float64Array into bin indices.
 */
function discretize(data: Float64Array, bins: number): Int32Array {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const result = new Int32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const idx = Math.min(bins - 1, Math.floor(((data[i]! - min) / range) * bins));
    result[i] = idx;
  }
  return result;
}

/**
 * Compute Hoeffding's D statistic for independence testing.
 *
 * D measures the distance between the joint CDF and the
 * product of marginal CDFs:
 *   ∫|F(x,y) - F(x)F(y)|² dF(x)dF(y)
 *
 * Maps to Deng Yu's sup-norm bound in Stosszahlansatz.
 */
function computeHoeffdingD(x: number[], y: number[]): number {
  const n = x.length;

  // Compute ranks
  const xRanks = computeRanks(x);
  const yRanks = computeRanks(y);

  // Build 5 auxiliary arrays
  const q: number[] = new Array(n).fill(0);

  for (let i = 0; i < n; i++) {
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (x[j]! <= x[i]! && y[j]! <= y[i]!) {
        count++;
      }
    }
    q[i] = count;
  }

  // Compute D
  let d1 = 0, d2 = 0, d3 = 0;

  for (let i = 0; i < n; i++) {
    const qi = q[i]!;
    d1 += qi * (qi - 1);
    d2 += (xRanks[i]! - 1) * (qi - 1);
    d3 += (yRanks[i]! - 1) * (qi - 1);
  }

  const denom = n * (n - 1) * (n - 2) * (n - 3) * (n - 4);
  if (denom === 0) return 0;

  const D = (d1 - 2 * d2 - 2 * d3) / denom;
  return Math.abs(D);
}

/**
 * Compute ranks for an array (1-based, average for ties).
 */
function computeRanks(values: number[]): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ value: v, index: i }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j]!.value === indexed[i]!.value) {
      j++;
    }
    const avgRank = ((i + 1) + j) / 2; // 1-based average
    for (let k = i; k < j; k++) {
      ranks[indexed[k]!.index] = avgRank;
    }
    i = j;
  }
  return ranks;
}

/**
 * Approximate chi-squared CDF using Wilson-Hilferty transformation.
 */
function chiSquaredCDF(x: number, df: number): number {
  if (x <= 0) return 0;
  const a = df;
  const z = (Math.pow(x / a, 1 / 3) - (1 - 2 / (9 * a))) / Math.sqrt(2 / (9 * a));
  return normalCDF(z);
}

/**
 * Approximate standard normal CDF.
 */
function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Approximation of the error function.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return sign * y;
}
