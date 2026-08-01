import { describe, it, expect, vi } from 'vitest';
import { UbiqueLinearAlgebra } from '@agentix-e/micro-kinetic-tree';

// Mock ubique
vi.mock('ubique', () => {
  function lu(matrix: number[][]) {
    const n = matrix.length;
    // Identity LU for identity matrix; crude LU for simple cases
    const L: number[][] = [];
    const U: number[][] = [];
    const P: number[] = [];
    for (let i = 0; i < n; i++) {
      L.push(new Array(n).fill(0));
      U.push(new Array(n).fill(0));
      P.push(i);
      L[i]![i] = 1;
    }
    // Simple: just copy upper part to U
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i <= j) {
          U[i]![j] = matrix[i]![j]!;
        } else {
          L[i]![j] = matrix[i]![j]!;
        }
      }
    }
    // For non-singular matrices, adjust
    // Actually return Naive LU decomposition
    return { L, U, P, S: [] };
  }

  function linsolve(A: number[][], b: number[]) {
    const n = A.length;
    // Simple 2x2 solver for testing
    if (n === 2) {
      const det = A[0]![0]! * A[1]![1]! - A[0]![1]! * A[1]![0]!;
      if (Math.abs(det) < 1e-12) {
        throw new Error('Singular matrix');
      }
      const x0 = (b[0]! * A[1]![1]! - b[1]! * A[0]![1]!) / det;
      const x1 = (A[0]![0]! * b[1]! - A[1]![0]! * b[0]!) / det;
      return [x0, x1];
    }
    // Identity solve for identity matrix
    return [...b];
  }

  function inv(matrix: number[][]) {
    const n = matrix.length;
    if (n === 2) {
      const a = matrix.map(row => [...row]);
      const det = a[0]![0]! * a[1]![1]! - a[0]![1]! * a[1]![0]!;
      if (Math.abs(det) < 1e-12) {
        throw new Error('Matrix is singular');
      }
      return [
        [a[1]![1]! / det, -a[0]![1]! / det],
        [-a[1]![0]! / det, a[0]![0]! / det],
      ];
    }
    // Return identity as placeholder
    const id: number[][] = [];
    for (let i = 0; i < n; i++) {
      id.push(new Array(n).fill(0));
      id[i]![i] = 1;
    }
    return id;
  }

  function det(matrix: number[][]) {
    const n = matrix.length;
    if (n === 2) {
      return matrix[0]![0]! * matrix[1]![1]! - matrix[0]![1]! * matrix[1]![0]!;
    }
    // Simple for diagonal-like matrices
    let d = 1;
    for (let i = 0; i < n; i++) {
      d *= matrix[i]![i] ?? 0;
    }
    return d;
  }

  return { lu, linsolve, inv, det, default: { lu, linsolve, inv, det } };
});

describe('UbiqueLinearAlgebra', () => {
  const alg = new UbiqueLinearAlgebra();

  describe('solve', () => {
    it('solves 2×2 linear system', () => {
      // [[2, 1], [1, 2]] * x = [4, 5]
      // col-major: [2, 1, 1, 2]
      const A = new Float64Array([2, 1, 1, 2]);
      const b = new Float64Array([4, 5]);
      const x = alg.solve(A, b, 2);
      expect(x.length).toBe(2);
      // x = [1, 2]
      expect(x[0]).toBeCloseTo(1, 5);
      expect(x[1]).toBeCloseTo(2, 5);
    });

    it('solves identity system Ax=b where A=I', () => {
      const A = new Float64Array([1, 0, 0, 1]);
      const b = new Float64Array([7, 3]);
      const x = alg.solve(A, b, 2);
      expect(x[0]).toBeCloseTo(7, 5);
      expect(x[1]).toBeCloseTo(3, 5);
    });

    it('solves 3×3 system', () => {
      const A = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 1]);
      const b = new Float64Array([4, 9, 7]);
      const x = alg.solve(A, b, 3);
      expect(x.length).toBe(3);
    });

    it('throws on dimension mismatch', () => {
      const A = new Float64Array([1, 2, 3]);
      const b = new Float64Array([4]);
      expect(() => alg.solve(A, b, 2)).toThrow();
    });

    it('throws on vector length mismatch', () => {
      const A = new Float64Array([1, 0, 0, 1]);
      const b = new Float64Array([1, 2, 3]);
      expect(() => alg.solve(A, b, 2)).toThrow();
    });
  });

  describe('lu', () => {
    it('performs LU decomposition of 2×2 matrix', () => {
      const m = new Float64Array([2, 1, 1, 2]);
      const result = alg.lu(m, 2);
      expect(result.l).toBeDefined();
      expect(result.u).toBeDefined();
      expect(result.p).toBeDefined();
      expect(result.l.length).toBe(4);
      expect(result.u.length).toBe(4);
    });

    it('performs LU of 3×3 matrix', () => {
      const m = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 1]);
      const result = alg.lu(m, 3);
      expect(result.l.length).toBe(9);
      expect(result.u.length).toBe(9);
    });

    it('throws on dimension mismatch', () => {
      const m = new Float64Array([1, 2, 3]);
      expect(() => alg.lu(m, 2)).toThrow();
    });
  });

  describe('inverse', () => {
    it('computes inverse of 2×2 matrix', () => {
      // [[2, 0], [0, 3]] inverse = [[1/2, 0], [0, 1/3]]
      const m = new Float64Array([2, 0, 0, 3]);
      const inv = alg.inverse(m, 2);
      expect(inv.length).toBe(4);
      expect(inv[0]).toBeCloseTo(0.5, 5);
      expect(inv[3]).toBeCloseTo(1 / 3, 5);
    });

    it('computes inverse of identity', () => {
      const m = new Float64Array([1, 0, 0, 1]);
      const inv = alg.inverse(m, 2);
      expect(inv[0]).toBeCloseTo(1);
      expect(inv[3]).toBeCloseTo(1);
    });

    it('handles 3×3 matrix', () => {
      const m = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 1]);
      const inv = alg.inverse(m, 3);
      expect(inv.length).toBe(9);
    });

    it('throws on singular matrix', () => {
      // [[1, 2], [2, 4]] is singular (det=0)
      const m = new Float64Array([1, 2, 2, 4]);
      expect(() => alg.inverse(m, 2)).toThrow();
    });

    it('throws on dimension mismatch', () => {
      const m = new Float64Array([1, 2, 3]);
      expect(() => alg.inverse(m, 2)).toThrow();
    });
  });

  describe('det', () => {
    it('computes determinant of 2×2', () => {
      const m = new Float64Array([2, 0, 0, 3]);
      expect(alg.det(m, 2)).toBeCloseTo(6);
    });

    it('determinant of identity is 1', () => {
      const m = new Float64Array([1, 0, 0, 1]);
      expect(alg.det(m, 2)).toBeCloseTo(1);
    });

    it('determinant of zero matrix is 0', () => {
      const m = new Float64Array([0, 0, 0, 0]);
      expect(alg.det(m, 2)).toBeCloseTo(0);
    });

    it('computes 3×3 determinant', () => {
      const m = new Float64Array([2, 0, 0, 0, 3, 0, 0, 0, 4]);
      expect(alg.det(m, 3)).toBeCloseTo(24);
    });

    it('throws on dimension mismatch', () => {
      const m = new Float64Array([1, 2, 3]);
      expect(() => alg.det(m, 2)).toThrow();
    });
  });
});
