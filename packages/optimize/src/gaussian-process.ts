/**
 * Gaussian Process surrogate model with RBF kernel and Cholesky inference.
 *
 * Mathematical formulation:
 *   Prior:  f ∼ GP(0, k(x, x'))
 *   Kernel: k(x, x') = σ² · exp(-||x - x'||² / (2ℓ²))
 *   Noise:  y = f(x) + ε,  ε ∼ N(0, σₙ²)
 *   Posterior (given observations X, y):
 *     μ(x*) = k*^T · (K + σₙ²I)^{-1} · y
 *     σ²(x*) = k** - k*^T · (K + σₙ²I)^{-1} · k*
 *
 * Cholesky decomposition: K + σₙ²I = L·L^T
 *   α = L^{-T} · L^{-1} · y
 *   μ* = k*^T · α
 *   v = L^{-1} · k*
 *   σ²* = k** - v^T · v
 *
 * Reference: Rasmussen & Williams (2006), Algorithm 2.1
 */

import type { ConfigSpace } from './config-space.js';
import { DEFAULT_CONFIG_SPACE } from './config-space.js';

// ── Types ──

export interface GPOptions {
  /** Signal variance (kernel amplitude σ²) */
  readonly signalVariance: number;
  /** Length-scale ℓ (one per dimension or scalar) */
  readonly lengthScale: number | readonly number[];
  /** Observation noise variance σₙ² */
  readonly noiseVariance: number;
  /** RBF kernel: exp(-r²/(2ℓ²)) */
  readonly kernelType: 'rbf';
}

export interface GPObservation {
  /** Configuration vector (unit-cube representation) */
  readonly x: Float64Array;
  /** Observed accuracy (reward) */
  readonly y: number;
}

export interface GPPrediction {
  /** Posterior mean */
  readonly mean: number;
  /** Posterior variance */
  readonly variance: number;
  /** Standard deviation */
  readonly std: number;
}

// ── Defaults ──

const DEFAULT_OPTIONS: GPOptions = {
  signalVariance: 0.5,
  lengthScale: 0.3,
  noiseVariance: 1e-4,
  kernelType: 'rbf',
};

// ── GP Implementation ──

export class GaussianProcess {
  private readonly dim: number;
  private readonly options: GPOptions;
  private readonly space: ConfigSpace;
  private X: Float64Array[] = [];
  private y: Float64Array = new Float64Array(0);
  private L: Float64Array | null = null;
  private alpha: Float64Array | null = null;

  constructor(dim: number, options?: Partial<GPOptions>, space?: ConfigSpace) {
    this.dim = dim;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.space = space ?? DEFAULT_CONFIG_SPACE;
  }

  /** Number of observations */
  get observationCount(): number {
    return this.X.length;
  }

  /** Observation inputs (snapshot accessor for persistence). */
  get observationXs(): readonly Float64Array[] {
    return this.X;
  }

  /** Observation targets (snapshot accessor for persistence). */
  get observationYs(): Float64Array {
    return this.y;
  }

  /** Kernel length-scale hyperparameter (scalar or per-dimension array). */
  get lengthScale(): number | readonly number[] {
    return this.options.lengthScale;
  }

  /** Kernel signal variance (amplitude σ²). */
  get signalVariance(): number {
    return this.options.signalVariance;
  }

  /** Observation noise variance σₙ². */
  get noiseVariance(): number {
    return this.options.noiseVariance;
  }

  /** Add a single observation and update posterior */
  addObservation(x: Float64Array, y: number): void {
    this.X.push(new Float64Array(x));
    const newY = new Float64Array(this.y.length + 1);
    newY.set(this.y, 0);
    newY[this.y.length] = y;
    this.y = newY;
    this.recomputeCholesky();
  }

  /** Add multiple observations at once */
  addObservations(xs: readonly Float64Array[], ys: readonly number[]): void {
    for (let i = 0; i < xs.length; i++) {
      this.X.push(new Float64Array(xs[i]!));
    }
    const newY = new Float64Array(this.y.length + ys.length);
    newY.set(this.y, 0);
    for (let i = 0; i < ys.length; i++) newY[this.y.length + i] = ys[i]!;
    this.y = newY;
    this.recomputeCholesky();
  }

  /** Predict posterior at test point x* */
  predict(xStar: Float64Array): GPPrediction {
    if (this.X.length === 0) {
      return {
        mean: 0.6, // Optimistic prior for RCA accuracy
        variance: this.options.signalVariance + this.options.noiseVariance,
        std: Math.sqrt(this.options.signalVariance + this.options.noiseVariance),
      };
    }

    const kStar = this.computeKStar(xStar);
    const kStarStar = this.computeKernel(xStar, xStar);

    // μ* = k*^T · α
    let mean = 0;
    for (let i = 0; i < kStar.length; i++) {
      mean += kStar[i]! * this.alpha![i]!;
    }

    // v = L^{-1} · k*
    const v = this.solveL(kStar);
    let ktV = 0;
    for (let i = 0; i < v.length; i++) ktV += v[i]! * v[i]!;

    const variance = Math.max(1e-12, kStarStar - ktV);

    return {
      mean,
      variance,
      std: Math.sqrt(variance),
    };
  }

  /** UCB acquisition: argmax [μ(x) + β · σ(x)] */
  acquireUCB(
    candidates: readonly Float64Array[],
    beta = 2.0,
  ): { readonly index: number; readonly value: number; readonly point: Float64Array } {
    if (candidates.length === 0) throw new Error('No candidates provided');

    let bestIdx = 0;
    let bestValue = -Infinity;
    let bestPoint = candidates[0]!;

    for (let i = 0; i < candidates.length; i++) {
      const pred = this.predict(candidates[i]!);
      const ucb = pred.mean + beta * pred.std;
      if (ucb > bestValue) {
        bestValue = ucb;
        bestIdx = i;
        bestPoint = candidates[i]!;
      }
    }

    return { index: bestIdx, value: bestValue, point: bestPoint };
  }

  /** Maximum posterior mean across all observations */
  get bestObservation(): { readonly mean: number; readonly idx: number } {
    if (this.X.length === 0) return { mean: 0, idx: -1 };
    let bestMean = -Infinity;
    let bestIdx = 0;
    for (let i = 0; i < this.X.length; i++) {
      const pred = this.predict(this.X[i]!);
      if (pred.mean > bestMean) {
        bestMean = pred.mean;
        bestIdx = i;
      }
    }
    return { mean: bestMean, idx: bestIdx };
  }

  /** Log marginal likelihood for hyperparameter optimization */
  logMarginalLikelihood(): number {
    if (this.X.length === 0) return 0;
    const n = this.X.length;
    const logDet = 2 * this.logDiagL();
    const ytAlpha = this.dotProduct(this.y, this.alpha!);
    return -0.5 * (ytAlpha + logDet + n * Math.log(2 * Math.PI));
  }

  /** Compute kernel vector between all training points and x* */
  private computeKStar(xStar: Float64Array): Float64Array {
    const result = new Float64Array(this.X.length);
    for (let i = 0; i < this.X.length; i++) {
      result[i] = this.computeKernel(this.X[i]!, xStar);
    }
    return result;
  }

  /** RBF kernel: σ² · exp(-||x - x'||² / (2ℓ²)) */
  private computeKernel(x1: Float64Array, x2: Float64Array): number {
    const sig = this.options.signalVariance;
    const scales = this.options.lengthScale;
    const scaleArr = typeof scales === 'number' ? new Float64Array(this.dim).fill(scales) : scales;

    let sqDist = 0;
    for (let i = 0; i < this.dim; i++) {
      // `scaleArr` is already normalized to an array above, so the scalar
      // branch is unreachable here — index it directly.
      const diff = (x1[i]! - x2[i]!) / scaleArr[i]!;
      sqDist += diff * diff;
    }

    return sig * Math.exp(-0.5 * sqDist);
  }

  /** Recompute Cholesky factor L and α = L^{-T}L^{-1}y */
  private recomputeCholesky(): void {
    const n = this.X.length;
    if (n === 0) {
      this.L = null;
      this.alpha = null;
      return;
    }

    // Build kernel matrix K + σₙ²I
    const kn = n * n;
    const K = new Float64Array(kn);
    for (let i = 0; i < n; i++) {
      for (let j = i; j < n; j++) {
        let kij = this.computeKernel(this.X[i]!, this.X[j]!);
        if (i === j) kij += this.options.noiseVariance;
        K[i * n + j] = kij;
        K[j * n + i] = kij; // Symmetric
      }
    }

    // Cholesky decomposition K = L·L^T (in-place, lower triangular)
    this.L = new Float64Array(kn);
    this.L.set(K);
    const success = this.choleskyInPlace(this.L, n);
    if (!success) {
      // Cholesky failed — add jitter and retry
      for (let i = 0; i < n; i++) {
        K[i * n + i]! += 1e-6;
      }
      this.L.set(K);
      this.choleskyInPlace(this.L, n);
    }

    // Solve α = L^{-T} · (L^{-1} · y)
    this.alpha = this.solveL(this.y);
  }

  /** Cholesky decomposition (lower triangular, in-place) */
  private choleskyInPlace(A: Float64Array, n: number): boolean {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < j; k++) {
        s += A[j * n + k]! * A[j * n + k]!;
      }
      const diag = A[j * n + j]! - s;
      if (diag <= 0) return false;
      A[j * n + j] = Math.sqrt(diag);

      for (let i = j + 1; i < n; i++) {
        let sij = 0;
        for (let k = 0; k < j; k++) {
          sij += A[i * n + k]! * A[j * n + k]!;
        }
        A[i * n + j] = (A[i * n + j]! - sij) / A[j * n + j]!;
      }
    }
    return true;
  }

  /** Solve L · x = b (forward substitution, then L^T · α = x backward) */
  private solveL(b: Float64Array): Float64Array {
    const n = this.X.length;
    const L = this.L!;
    const result = new Float64Array(n);

    // Forward: L · y = b
    for (let i = 0; i < n; i++) {
      let sum = b[i]!;
      for (let j = 0; j < i; j++) {
        sum -= L[i * n + j]! * result[j]!;
      }
      result[i] = sum / L[i * n + i]!;
    }

    return result;
  }

  /** Log-diagonal of L for marginal likelihood computation */
  private logDiagL(): number {
    const L = this.L!;
    const n = this.X.length;
    let sumLog = 0;
    for (let i = 0; i < n; i++) {
      sumLog += Math.log(L[i * n + i]!);
    }
    return sumLog;
  }

  /** Dot product of two vectors */
  private dotProduct(a: Float64Array, b: Float64Array): number {
    let sum = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) sum += a[i]! * b[i]!;
    return sum;
  }
}
