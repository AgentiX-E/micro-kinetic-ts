/**
 * NumpyTsMatrixOps — IMatrixOps implementation backed by numpy-ts.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * Matrix operations are fundamental to Deng Yu's kinetic theory, where:
 * - **Eigenvalues** of the collision operator determine convergence rates
 * - **SVD** decomposes the Boltzmann collision kernel
 * - **Graph spectrum** determines spectral gap (relaxation time)
 * - **Matrix multiplication** models multi-step collision cascades
 *
 * numpy-ts provides a 94% NumPy-compatible API with WASM acceleration,
 * making it suitable for production AIOps workloads while maintaining
 * numerical accuracy compatible with Deng Yu's rigorous analysis.
 *
 * @module math/numpy-provider
 */

import {
  type GraphSpectrum,
  type IMatrixOps,
  invariant,
  invariantPositiveInt,
  type SVDResult,
} from '@agentix-e/micro-kinetic-core';
import * as np from 'numpy-ts';

/**
 * Convert a flattened Float64Array to a numpy-ts NDArray.
 *
 * @param data - Flattened column-major matrix data
 * @param rows - Number of rows
 * @param cols - Number of columns
 * @returns NDArray with shape [rows, cols]
 * @internal
 */
function toNDArray(data: Float64Array, rows: number, cols: number): ReturnType<typeof np.array> {
  const arr = np.array(data);
  return arr.reshape([rows, cols]) as ReturnType<typeof np.array>;
}

/**
 * Extract a Float64Array from a numpy-ts NDArray, handling non-contiguous views.
 *
 * @param ndarray - numpy-ts NDArray
 * @returns Contiguous Float64Array
 * @internal
 */
function toFloat64(ndarray: ReturnType<typeof np.array>): Float64Array {
  const copied = ndarray.copy();
  return copied.data as Float64Array;
}

/**
 * NumpyTsMatrixOps — implements IMatrixOps using numpy-ts.
 *
 * Provides matrix multiplication, eigenvalue decomposition, SVD,
 * and graph spectrum analysis.
 *
 * @example
 * ```typescript
 * const ops = new NumpyTsMatrixOps();
 * const C = ops.multiply(A, B, 3, 3, 3);
 * const spectrum = ops.graphSpectrum(adjacency, 5);
 * ```
 */
export class NumpyTsMatrixOps implements IMatrixOps {
  /**
   * General matrix multiplication: C = A × B.
   *
   * A: m×k, B: k×n → C: m×n
   *
   * Uses numpy's `dot` for optimal performance.
   *
   * **Invariant:** dimensions must be compatible:
   * A has m×k elements, B has k×n elements
   *
   * @param a - Flattened A matrix (column-major)
   * @param b - Flattened B matrix (column-major)
   * @param m - Rows of A
   * @param k - Columns of A / rows of B
   * @param n - Columns of B
   * @returns Flattened C matrix (column-major)
   */
  multiply(a: Float64Array, b: Float64Array, m: number, k: number, n: number): Float64Array {
    invariantPositiveInt(m, 'm');
    invariantPositiveInt(k, 'k');
    invariantPositiveInt(n, 'n');
    invariant(a.length === m * k, `a length ${a.length} must equal m*k = ${m * k}`);
    invariant(b.length === k * n, `b length ${b.length} must equal k*n = ${k * n}`);

    const A = toNDArray(a, m, k);
    const B = toNDArray(b, k, n);
    const C = np.dot(A, B);
    return toFloat64(C);
  }

  /**
   * Compute eigenvalues of a symmetric matrix.
   *
   * Uses numpy's `eigvalsh` for symmetric matrices (faster and
   * more numerically stable than `eigvals`).
   *
   * Returns eigenvalues sorted in descending order (λ₁ ≥ λ₂ ≥ ... ≥ λₙ).
   *
   * **Invariant:** matrix must be n×n (square)
   *
   * @param matrix - Flattened n×n symmetric matrix (column-major)
   * @param n - Matrix dimension
   * @returns Eigenvalues in descending order
   */
  eigenvalues(matrix: Float64Array, n: number): Float64Array {
    invariantPositiveInt(n, 'n');
    invariant(matrix.length === n * n, `matrix length ${matrix.length} must equal n*n = ${n * n}`);

    const M = toNDArray(matrix, n, n);
    const eigvals = np.linalg.eigvalsh(M, 'U');
    const result = toFloat64(eigvals);

    // Sort descending
    const sorted = new Float64Array(result);
    sorted.sort((a, b) => b - a);
    return sorted;
  }

  /**
   * Singular Value Decomposition (SVD).
   *
   *   A = U × Σ × V^T
   *
   * Decomposes m×n matrix A into:
   * - U: m×m left singular vectors
   * - Σ: min(m,n) singular values
   * - V^T: n×n right singular vectors
   *
   * Uses numpy's `svd` with full_matrices=true for the full decomposition.
   *
   * @param matrix - Flattened m×n matrix (column-major)
   * @param m - Number of rows
   * @param n - Number of columns
   * @returns SVD result { u, s, vt }
   */
  svd(matrix: Float64Array, m: number, n: number): SVDResult {
    invariantPositiveInt(m, 'm');
    invariantPositiveInt(n, 'n');
    invariant(matrix.length === m * n, `matrix length ${matrix.length} must equal m*n = ${m * n}`);

    const M = toNDArray(matrix, m, n);
    const result = np.linalg.svd(M, true, true) as {
      u: ReturnType<typeof np.array>;
      s: ReturnType<typeof np.array>;
      vt: ReturnType<typeof np.array>;
    };

    return {
      u: toFloat64(result.u),
      s: toFloat64(result.s),
      vt: toFloat64(result.vt),
    };
  }

  /**
   * Compute the spectral properties of a graph from its adjacency matrix.
   *
   * The graph spectrum reveals fundamental properties:
   * - **Spectral gap** (λ₁ - λ₂): Rate of convergence to equilibrium.
   *   Larger gap → faster convergence → easier RCA.
   * - **Algebraic connectivity** (Fiedler value λ_{n-1}): Measure of
   *   graph connectedness. Higher → more resilient to partitioning.
   * - **Spectral radius** (|λ₁|): Largest eigenvalue magnitude.
   *   Determines the growth bound for iterative methods.
   *
   * ### Deng Yu Mapping
   *
   * The spectral gap corresponds to the collision relaxation time τ:
   *   τ = 1 / (λ₁ - λ₂)
   *
   * Larger τ means slower relaxation → chronic fault patterns
   * persist longer → harder to detect but also harder to miss.
   *
   * @param adjacency - Flattened n×n adjacency matrix (column-major)
   * @param n - Matrix dimension (number of nodes)
   * @returns Graph spectrum analysis
   */
  graphSpectrum(adjacency: Float64Array, n: number): GraphSpectrum {
    invariantPositiveInt(n, 'n');
    invariant(
      adjacency.length === n * n,
      `adjacency length ${adjacency.length} must equal n*n = ${n * n}`,
    );

    const eigvals = this.eigenvalues(adjacency, n);

    const spectralRadius = Math.abs(eigvals[0]!);
    const lambda1 = eigvals[0]!;
    const lambda2 = eigvals.length >= 2 ? eigvals[1]! : 0;
    const spectralGap = lambda1 - lambda2;

    // Fiedler value: second smallest eigenvalue of Laplacian
    // For adjacency: use λ_{n-1} (descending order, so index n-2)
    const algebraicConnectivity = n >= 2 ? eigvals[n - 2]! : 0;

    return {
      eigenvalues: eigvals,
      spectralGap,
      algebraicConnectivity,
      spectralRadius,
    };
  }
}
