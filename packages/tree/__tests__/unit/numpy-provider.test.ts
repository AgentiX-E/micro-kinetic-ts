import { describe, it, expect, vi } from 'vitest';
import { NumpyTsMatrixOps } from '@agentix-e/micro-kinetic-tree';

// Mock numpy-ts
vi.mock('numpy-ts', () => {
  class MockNDArray {
    data: Float64Array;
    flags = { C_CONTIGUOUS: true };
    _shape: number[];

    constructor(data: Float64Array | number[], shape?: number[]) {
      this.data = data instanceof Float64Array ? data : new Float64Array(data);
      this._shape = shape ?? [this.data.length];
    }

    reshape(shape: number[]) {
      return createMockNDArray(this.data, shape);
    }

    copy() {
      return createMockNDArray(new Float64Array(this.data), this._shape);
    }

    tolist() {
      return Array.from(this.data);
    }
  }

  function createMockNDArray(data: Float64Array, shape?: number[]) {
    const arr = new MockNDArray(data);
    if (shape) arr._shape = shape;
    return arr as any;
  }

  function array(data: Float64Array | number[]) {
    const d = data instanceof Float64Array ? data : new Float64Array(data);
    return createMockNDArray(d, [d.length]);
  }

  function dot(a: any, b: any) {
    const aData = a.data as Float64Array;
    const bData = b.data as Float64Array;
    const aShape = a._shape || [aData.length];
    const bShape = b._shape || [bData.length];
    const m = aShape[0];
    const k = aShape[1] || 1;
    const n = bShape[1] || 1;
    const result = new Float64Array(m * n);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        let sum = 0;
        for (let p = 0; p < k; p++) {
          sum += (aData[i + p * m] ?? 0) * (bData[p + j * k] ?? 0);
        }
        result[i + j * m] = sum;
      }
    }
    return createMockNDArray(result, [m, n]);
  }

  function polyfit(x: any, y: any, degree: number) {
    // Simple linear regression
    const xData = x.data as Float64Array;
    const yData = y.data as Float64Array;
    const n = xData.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = xData[i]!;
      const yi = yData[i]!;
      sx += xi; sy += yi; sxy += xi * yi; sx2 += xi * xi;
    }
    const denom = n * sx2 - sx * sx;
    if (Math.abs(denom) < 1e-12) {
      return createMockNDArray(new Float64Array([0]));
    }
    const slope = (n * sxy - sx * sy) / denom;
    const intercept = (sy * sx2 - sx * sxy) / denom;
    return createMockNDArray(new Float64Array([slope, intercept]));
  }

  function polyval(coeffs: any, x: any) {
    const c = coeffs.data as Float64Array;
    const xd = x.data as Float64Array;
    const result = new Float64Array(xd.length);
    for (let i = 0; i < xd.length; i++) {
      let val = 0;
      for (let j = 0; j < c.length; j++) {
        val += (c[j] ?? 0) * Math.pow(xd[i]!, c.length - 1 - j);
      }
      result[i] = val;
    }
    return createMockNDArray(result);
  }

  const linalg = {
    eigvalsh(matrix: any, _uplo?: string) {
      const m = matrix as any;
      const data = m.data as Float64Array;
      const shape = m._shape || [data.length];
      const n = shape[0];

      // For a simple symmetric matrix, compute eigenvalues
      // For 2x2: [[a, b], [b, d]] eigenvalues = (a+d ± sqrt((a-d)² + 4b²)) / 2
      if (n === 2) {
        const a = data[0]!; // col-major: position 0
        const b = data[1]!; // col-major: position 1 (= position n of row-major)
        const c2 = data[2]!; // col-major: position 2
        const d = data[3]!; // col-major: position 3
        const trace = a + d;
        const det = a * d - b * c2;
        const disc = Math.sqrt(trace * trace - 4 * det);
        const eig1 = (trace + disc) / 2;
        const eig2 = (trace - disc) / 2;
        return createMockNDArray(new Float64Array([eig1, eig2]));
      }
      // For diagonal matrix, eigenvalues are the diagonal elements
      const evals = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        evals[i] = data[i * n + i] ?? 0;
      }
      return createMockNDArray(evals);
    },

    svd(matrix: any, _fullMatrices: boolean, _computeUvh: boolean) {
      const m = matrix as any;
      const data = m.data as Float64Array;
      const shape = m._shape || [];
      const rows = shape[0] || 1;
      const cols = shape[1] || 1;

      // Compute SVD for small matrices using basic approach
      // Singular values: sqrt(eigenvalues of A^T A)
      const ata = new Float64Array(cols * cols);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < cols; j++) {
          let sum = 0;
          for (let k = 0; k < rows; k++) {
            sum += (data[k + i * rows] ?? 0) * (data[k + j * rows] ?? 0);
          }
          ata[i + j * cols] = sum;
        }
      }

      // For 2x2, compute eigenvalues of ATA directly
      let sigVals: number[];
      if (cols <= 2) {
        const a11 = ata[0] ?? 0;
        const a12 = ata[1] ?? 0;
        const a22 = ata[3] ?? 0;
        const tr = a11 + a22;
        const det = a11 * a22 - a12 * a12;
        const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det));
        sigVals = [Math.max(0, (tr + disc) / 2), Math.max(0, (tr - disc) / 2)]
          .map(Math.sqrt);
      } else {
        sigVals = [];
        for (let i = 0; i < cols; i++) {
          sigVals.push(Math.sqrt(ata[i + i * cols] ?? 0));
        }
      }

      // Create identity-like U and Vt
      const u = new Float64Array(rows * rows);
      const vt = new Float64Array(cols * cols);
      for (let i = 0; i < rows; i++) u[i + i * rows] = 1;
      for (let i = 0; i < cols; i++) vt[i + i * cols] = 1;

      return {
        u: createMockNDArray(u, [rows, rows]),
        s: createMockNDArray(new Float64Array(sigVals)),
        vt: createMockNDArray(vt, [cols, cols]),
      };
    },
  };

  return {
    array,
    dot,
    polyfit,
    polyval,
    linalg,
    NDArray: MockNDArray,
    default: { array, dot, polyfit, polyval, linalg, NDArray: MockNDArray },
  };
});

describe('NumpyTsMatrixOps', () => {
  const ops = new NumpyTsMatrixOps();

  describe('multiply', () => {
    it('multiplies 2×2 matrices', () => {
      // A = [[1, 2], [3, 4]], B = [[5, 6], [7, 8]]
      // C = A × B = [[19, 22], [43, 50]]
      // Column-major: A = [1, 3, 2, 4], B = [5, 7, 6, 8]
      const a = new Float64Array([1, 3, 2, 4]);
      const b = new Float64Array([5, 7, 6, 8]);
      const c = ops.multiply(a, b, 2, 2, 2);
      expect(c[0]).toBeCloseTo(19, 5);
      expect(c[1]).toBeCloseTo(43, 5);
      expect(c[2]).toBeCloseTo(22, 5);
      expect(c[3]).toBeCloseTo(50, 5);
    });

    it('multiplies by identity matrix', () => {
      // I = [[1, 0], [0, 1]] col-major: [1, 0, 0, 1]
      const a = new Float64Array([1, 3, 2, 4]); // [[1,2],[3,4]]
      const i = new Float64Array([1, 0, 0, 1]);
      const c = ops.multiply(a, i, 2, 2, 2);
      expect(c[0]).toBeCloseTo(1);
      expect(c[1]).toBeCloseTo(3);
      expect(c[2]).toBeCloseTo(2);
      expect(c[3]).toBeCloseTo(4);
    });

    it('multiplies by zero matrix produces zeros', () => {
      const a = new Float64Array([1, 2, 3, 4]);
      const z = new Float64Array([0, 0, 0, 0]);
      const c = ops.multiply(a, z, 2, 2, 2);
      for (let i = 0; i < c.length; i++) {
        expect(c[i]).toBeCloseTo(0);
      }
    });

    it('multiplies 3×2 by 2×3', () => {
      const a = new Float64Array([1, 4, 7, 2, 5, 8]); // 3x2
      const b = new Float64Array([1, 3, 2, 4]);       // 2x2
      const c = ops.multiply(a, b, 3, 2, 2);
      expect(c.length).toBe(6);
    });

    it('throws on dimension mismatch', () => {
      const a = new Float64Array([1, 2, 3, 4]);
      const b = new Float64Array([5, 6, 7, 8]);
      expect(() => ops.multiply(a, b, 2, 3, 2)).toThrow();
    });

    it('1×1 multiplication', () => {
      const a = new Float64Array([3]);
      const b = new Float64Array([5]);
      const c = ops.multiply(a, b, 1, 1, 1);
      expect(c[0]).toBe(15);
    });
  });

  describe('eigenvalues', () => {
    it('computes eigenvalues of 2×2 diagonal matrix', () => {
      // [[3, 0], [0, 1]] col-major: [3, 0, 0, 1]
      const m = new Float64Array([3, 0, 0, 1]);
      const evals = ops.eigenvalues(m, 2);
      expect(evals[0]).toBeCloseTo(3);
      expect(evals[1]).toBeCloseTo(1);
    });

    it('returns eigenvalues in descending order', () => {
      const m = new Float64Array([1, 0, 0, 3]); // [[1, 0], [0, 3]]
      const evals = ops.eigenvalues(m, 2);
      expect(evals[0]).toBeCloseTo(3);
      expect(evals[1]).toBeCloseTo(1);
    });

    it('handles 3×3 symmetric matrix', () => {
      const m = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 1]);
      const evals = ops.eigenvalues(m, 3);
      expect(evals.length).toBe(3);
      expect(evals[0]).toBeCloseTo(3);
      expect(evals[1]).toBeCloseTo(2);
      expect(evals[2]).toBeCloseTo(1);
    });

    it('throws on non-square matrix', () => {
      const m = new Float64Array([1, 2, 3]);
      expect(() => ops.eigenvalues(m, 2)).toThrow();
    });
  });

  describe('svd', () => {
    it('computes SVD of 2×2 matrix', () => {
      const m = new Float64Array([1, 0, 0, 1]);
      const result = ops.svd(m, 2, 2);
      expect(result.u).toBeDefined();
      expect(result.s).toBeDefined();
      expect(result.vt).toBeDefined();
      expect(result.s.length).toBeGreaterThanOrEqual(1);
    });

    it('computes SVD of 3×3 matrix', () => {
      const m = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 1]);
      const result = ops.svd(m, 3, 3);
      expect(result.u.length).toBe(9);
      expect(result.s.length).toBe(3);
    });

    it('throws on dimension mismatch', () => {
      const m = new Float64Array([1, 2, 3]);
      expect(() => ops.svd(m, 2, 2)).toThrow();
    });
  });

  describe('graphSpectrum', () => {
    it('computes spectrum of 2×2 adjacency', () => {
      const adj = new Float64Array([0, 1, 1, 0]); // [[0,1],[1,0]]
      const spectrum = ops.graphSpectrum(adj, 2);
      expect(spectrum.eigenvalues.length).toBe(2);
      expect(spectrum.spectralRadius).toBeGreaterThan(0);
      expect(typeof spectrum.spectralGap).toBe('number');
      expect(typeof spectrum.algebraicConnectivity).toBe('number');
    });

    it('handles identity (no edges)', () => {
      const adj = new Float64Array([0, 0, 0, 0]);
      const spectrum = ops.graphSpectrum(adj, 2);
      expect(spectrum.eigenvalues.length).toBe(2);
    });

    it('throws on dimension mismatch', () => {
      const adj = new Float64Array([1, 2, 3]);
      expect(() => ops.graphSpectrum(adj, 2)).toThrow();
    });
  });
});
