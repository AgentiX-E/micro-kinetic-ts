/**
 * Math Provider interface — abstraction over numerical backends.
 *
 * This interface decouples algorithmic logic from specific math
 * libraries, enabling runtime hot-swapping between:
 * - numpy-ts (default, pure TS + WASM, 94% NumPy API)
 * - ubique (Rust nalgebra → WASM, up to 26x faster det)
 * - ml-matrix (pure JS fallback when WASM unavailable)
 *
 * Deng Yu's work relies heavily on rigorous numerical analysis.
 * The math provider abstraction ensures reproducibility regardless
 * of the underlying backend.
 *
 * @module interfaces/math-provider
 */

/** Result of singular value decomposition. */
export interface SVDResult {
  /** Left singular vectors (U), flattened column-major, m×m */
  readonly u: Float64Array;
  /** Singular values (Σ), length min(m,n) */
  readonly s: Float64Array;
  /** Right singular vectors (V^T), flattened row-major, n×n */
  readonly vt: Float64Array;
}

/** Result of LU decomposition. */
export interface LUResult {
  /** Lower triangular matrix L (unit diagonal implicit) */
  readonly l: Float64Array;
  /** Upper triangular matrix U */
  readonly u: Float64Array;
  /** Permutation matrix P (as pivot indices) */
  readonly p: Int32Array;
}

/** Result of rolling statistics computation. */
export interface RollingStatsResult {
  /** Rolling mean, length = n - window + 1 */
  readonly mean: Float64Array;
  /** Rolling variance */
  readonly variance: Float64Array;
  /** Rolling standard deviation */
  readonly stddev: Float64Array;
  /** Window size used */
  readonly windowSize: number;
}

/** Result of kernel density estimation. */
export interface KDEResult {
  /** Evaluation points (length m) */
  readonly x: Float64Array;
  /** Density estimates at evaluation points (length m) */
  readonly density: Float64Array;
  /** Bandwidth used */
  readonly bandwidth: number;
}

/** Result of a statistical test. */
export interface TestResult {
  /** p-value */
  readonly pValue: number;
  /** Test statistic value */
  readonly statistic: number;
  /** Whether null hypothesis is rejected at α=0.05 */
  readonly significant: boolean;
}

/** Parameters for the coupling strength computation. */
export interface CouplingParams {
  /** Minimum co-occurrence required */
  readonly minCooccurrence: number;
  /** Time window for co-occurrence (ms) */
  readonly timeWindowMs: number;
  /** Smoothing factor for mutual information (0 = no smoothing) */
  readonly smoothingFactor: number;
}

/** Spectral properties of a graph. */
export interface GraphSpectrum {
  /** Eigenvalues in descending order */
  readonly eigenvalues: Float64Array;
  /** Spectral gap λ₁ - λ₂ */
  readonly spectralGap: number;
  /** Algebraic connectivity (Fiedler value) */
  readonly algebraicConnectivity: number;
  /** Spectral radius */
  readonly spectralRadius: number;
}

/**
 * Matrix operations interface — basic linear algebra.
 */
export interface IMatrixOps {
  /**
   * General matrix multiplication: C = A × B.
   * A: m×k, B: k×n → C: m×n
   */
  multiply(
    a: Float64Array,
    b: Float64Array,
    m: number,
    k: number,
    n: number,
  ): Float64Array;

  /**
   * Compute eigenvalues of a symmetric matrix.
   * @param matrix - Flattened n×n symmetric matrix (column-major)
   * @param n - Matrix dimension
   * @returns Eigenvalues in descending order
   */
  eigenvalues(matrix: Float64Array, n: number): Float64Array;

  /**
   * Singular value decomposition.
   * @param matrix - Flattened m×n matrix
   */
  svd(matrix: Float64Array, m: number, n: number): SVDResult;

  /**
   * Compute the spectral properties of a graph from its adjacency matrix.
   */
  graphSpectrum(adjacency: Float64Array, n: number): GraphSpectrum;
}

/**
 * Statistics interface — statistical computations.
 */
export interface IStatistics {
  /**
   * Compute rolling statistics over a sliding window.
   */
  rollingStats(data: Float64Array, windowSize: number): RollingStatsResult;

  /**
   * Kernel density estimation.
   */
  kde(samples: Float64Array, bandwidth?: number): KDEResult;

  /**
   * Test for independence between two variables.
   * Uses chi-squared test for categorical or
   * Hoeffding's D for continuous.
   */
  independenceTest(x: Float64Array, y: Float64Array): TestResult;

  /**
   * Compute the mutual information between two alert time series.
   * Used for coupling matrix construction in Stosszahlansatz denoising.
   */
  mutualInformation(
    x: Float64Array,
    y: Float64Array,
    params?: CouplingParams,
  ): number;

  /**
   * Fit a linear regression y = β₀ + β₁x.
   */
  linearRegression(x: Float64Array, y: Float64Array): {
    readonly slope: number;
    readonly intercept: number;
    readonly rSquared: number;
  };

  /**
   * Compute Pearson correlation coefficient.
   */
  correlation(x: Float64Array, y: Float64Array): number;
}

/**
 * Linear algebra interface — advanced matrix operations.
 */
export interface ILinearAlgebra {
  /**
   * Solve linear system Ax = b.
   * @param A - Flattened n×n matrix (column-major)
   * @param b - Right-hand side vector, length n
   * @param n - System dimension
   */
  solve(A: Float64Array, b: Float64Array, n: number): Float64Array;

  /**
   * LU decomposition with partial pivoting.
   */
  lu(matrix: Float64Array, n: number): LUResult;

  /**
   * Matrix inverse.
   */
  inverse(matrix: Float64Array, n: number): Float64Array;

  /**
   * Matrix determinant.
   */
  det(matrix: Float64Array, n: number): number;
}

/**
 * Arbitrary precision interface — for computations requiring
 * precision beyond IEEE 754 double.
 *
 * Used in independence decomposition error computation where
 * floating-point cancellation can destroy significance.
 */
export interface IArbitraryPrecision {
  /**
   * Multiply two numbers with arbitrary precision.
   */
  multiply(a: string, b: string): string;

  /**
   * Compute natural logarithm with arbitrary precision.
   */
  ln(value: string): string;

  /**
   * Compute exponential with arbitrary precision.
   */
  exp(value: string): string;

  /**
   * Compute x^y with arbitrary precision.
   */
  pow(base: string, exponent: string): string;

  /**
   * Set the precision (number of significant digits).
   */
  setPrecision(digits: number): void;
}
