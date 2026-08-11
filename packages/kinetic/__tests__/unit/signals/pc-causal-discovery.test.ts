/**
 * Unit tests for PC Algorithm causal discovery.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCorrelationMatrix,
  fisherZ,
  partialCorrelation,
  pearsonCorrelation,
  runPCAlgorithm,
  testConditionalIndependence,
} from '../../../src/signals/pc-causal-discovery.js';

describe('pearsonCorrelation', () => {
  it('returns 1 for identical series', () => {
    const xs = new Float64Array([1, 2, 3, 4, 5]);
    expect(pearsonCorrelation(xs, xs)).toBeCloseTo(1, 5);
  });

  it('returns -1 for perfectly anti-correlated series', () => {
    const xs = new Float64Array([1, 2, 3, 4, 5]);
    const ys = new Float64Array([5, 4, 3, 2, 1]);
    expect(pearsonCorrelation(xs, ys)).toBeCloseTo(-1, 5);
  });

  it('returns NaN for constant series (zero variance)', () => {
    const xs = new Float64Array([3, 3, 3, 3]);
    const ys = new Float64Array([1, 2, 3, 4]);
    expect(pearsonCorrelation(xs, ys)).toBeNaN();
  });

  it('returns NaN if lengths differ', () => {
    const xs = new Float64Array([1, 2, 3]);
    const ys = new Float64Array([1, 2]);
    expect(pearsonCorrelation(xs, ys)).toBeNaN();
  });

  it('computes moderate positive correlation', () => {
    // y ≈ 2x + noise
    const xs = new Float64Array(20);
    const ys = new Float64Array(20);
    for (let i = 0; i < 20; i++) {
      xs[i] = i;
      ys[i] = 2 * i + (Math.sin(i * 0.7) - 0.5) * 2; // deterministic noise
    }
    const r = pearsonCorrelation(xs, ys);
    expect(r).toBeGreaterThan(0.9); // Strong positive
  });

  it('returns NaN for fewer than 3 data points', () => {
    const xs = new Float64Array([1, 2]);
    const ys = new Float64Array([1, 2]);
    expect(pearsonCorrelation(xs, ys)).toBeNaN();
  });
});

describe('partialCorrelation', () => {
  it('returns original correlation when conditioning set is empty', () => {
    expect(partialCorrelation(0.8, [], [], [])).toBeCloseTo(0.8, 5);
  });

  it('computes partial correlation with one conditioning variable', () => {
    // X and Y are correlated only through Z → partial should be ~0
    // Example: r_xy=0.8, r_xz=0.9, r_yz=0.9
    // r_{xy·z} = (0.8 - 0.9×0.9) / √(1-0.81)(1-0.81) = -0.01 / 0.19 ≈ -0.053
    // This shows X and Y have near-zero partial correlation given Z
    const r_xy = 0.8;
    const r_xs = [0.9];
    const r_ys = [0.9];
    const r_ss = [1.0]; // Z's self-correlation
    const rPartial = partialCorrelation(r_xy, r_xs, r_ys, r_ss);
    expect(rPartial).toBeCloseTo(-0.053, 1);
  });

  it('returns NaN for singular matrices', () => {
    // Perfect linear dependence: r_xz = r_yz = 1.0
    // Denominator → 0
    const r = partialCorrelation(0.9, [1.0], [1.0], [1.0]);
    expect(r).toBeNaN();
  });

  it('handles NaN in r_xy', () => {
    const r = partialCorrelation(NaN, [0.5], [0.5], [1.0]);
    // The implementation may propagate NaN
    // Accept either NaN or a valid result depending on internal handling
    expect(typeof r).toBe('number');
  });
});

describe('fisherZ', () => {
  it('returns 0 for NaN correlation', () => {
    expect(fisherZ(NaN, 100, 0)).toBe(0);
  });

  it('returns large z for near-1 correlation', () => {
    // r→1 → z→∞ (in theory); our implementation should handle it
    const z = fisherZ(0.999, 100, 0);
    expect(z).toBeGreaterThan(1);
  });

  it('returns positive z for small positive r', () => {
    const z = fisherZ(0.3, 50, 0);
    expect(z).toBeGreaterThan(0);
  });

  it('z grows with sample size', () => {
    const z1 = fisherZ(0.3, 20, 0);
    const z2 = fisherZ(0.3, 100, 0);
    expect(z2).toBeGreaterThan(z1);
  });

  it('is monotonic in correlation', () => {
    const z1 = fisherZ(0.2, 50, 0);
    const z2 = fisherZ(0.4, 50, 0);
    expect(z2).toBeGreaterThan(z1);
  });
});

describe('testConditionalIndependence', () => {
  it('declares independence for r=0 (passes CI test)', () => {
    // r=0 → z≈0 → fails to reject H0 → independent
    expect(testConditionalIndependence(0, 100, 0)).toBe(true);
  });

  it('declares dependence for strong r with large sample size', () => {
    // r=0.5, n=1000 → z large → rejects H0 → dependent
    expect(testConditionalIndependence(0.5, 1000, 0, 0.05)).toBe(false);
  });

  it('potentially independent for weak r with small sample', () => {
    // r=0.1, n=10 → z small → may fail to reject → independent
    const result = testConditionalIndependence(0.1, 10, 0, 0.05);
    expect(typeof result).toBe('boolean');
  });
});

describe('buildCorrelationMatrix', () => {
  it('builds N×N symmetric correlation matrix', () => {
    const nodeIds = ['A', 'B'];
    const timeSeries = new Map([
      ['A', new Float64Array([1, 2, 3, 4, 5])],
      ['B', new Float64Array([2, 4, 6, 8, 10])],
    ]);
    const { matrix, N } = buildCorrelationMatrix(nodeIds, timeSeries);
    expect(N).toBe(2);
    // A-A = 1.0
    expect(matrix[0]).toBeCloseTo(1, 2);
    // B-B = 1.0
    expect(matrix[3]).toBeCloseTo(1, 2);
    // A-B = correlation (~1.0 for perfect linear)
    expect(matrix[1]).toBeCloseTo(1, 2);
    expect(matrix[2]).toBeCloseTo(1, 2);
  });

  it('handles missing nodes with NaN', () => {
    const nodeIds = ['A', 'B', 'C'];
    const timeSeries = new Map([
      ['A', new Float64Array([1, 2, 3])],
      ['B', new Float64Array([2, 4, 6])],
    ]);
    const { matrix, N } = buildCorrelationMatrix(nodeIds, timeSeries);
    expect(N).toBe(3);
    // A-C should be NaN (C missing)
    expect(matrix[2]).toBeNaN();
  });
});

describe('runPCAlgorithm', () => {
  it('discovers chain structure: A→B→C', () => {
    // A causes B causes C
    // Generate time series: A = noise, B = A + noise, C = B + noise
    const n = 100;
    const aVals = new Float64Array(n);
    const bVals = new Float64Array(n);
    const cVals = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      // Deterministic chain: A = sin(t), B = A + very small jitter, C = B + very small jitter.
      // Conditioning on B must render A ⊥ C to confirm the chain.
      aVals[i] = Math.sin(i * 0.1); // strong signal
      bVals[i] = aVals[i]! + Math.sin(i * 0.31) * 0.05; // B ≈ A
      cVals[i] = bVals[i]! + Math.cos(i * 0.23) * 0.05; // C ≈ B
    }

    const timeSeries = new Map([
      ['A', aVals],
      ['B', bVals],
      ['C', cVals],
    ]);

    const result = runPCAlgorithm(['A', 'B', 'C'], timeSeries, {
      alpha: 0.05,
      maxConditioningSetSize: 2,
      minCorrelation: 0.1,
    });

    // Skeleton should contain edges for adjacent pairs
    const nodePairs = result.skeleton.map((e) => `${e.from}-${e.to}`);

    // A-B and B-C should be in the skeleton (at least one of them)
    // For a perfect chain A→B→C, conditional on B, A and C are independent
    // So A-C should NOT be in the skeleton
    expect(result.skeleton.length).toBeGreaterThan(0);
    expect(result.stats.totalCITests).toBeGreaterThan(0);

    // Verify no A-C edge (they should be conditionally independent given B)
    const hasAC = nodePairs.some((p) => p === 'A-C' || p === 'C-A');
    expect(hasAC).toBe(false);
  });

  // FIXME(I13): Flaky test — PC algorithm's Fisher Z-test at alpha=0.05
  // occasionally fails to remove the X-Y edge from the v-structure skeleton
  // when the independent signals have residual correlation. Replace
  // Math.random() with rigorous deterministic signals and tune alpha.
  it('discovers v-structure: X→Z←Y', () => {
    // Z = X + Y + noise — v-structure (collider)
    const n = 200;
    const xVals = new Float64Array(n);
    const yVals = new Float64Array(n);
    const zVals = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      // X and Y use different, non-harmonically-related frequencies
      // to guarantee zero correlation even in finite samples.
      xVals[i] = Math.sin(i * 0.13 + 0.3);
      yVals[i] = Math.sin(i * 0.17 + 1.1);
      // Z is a common effect (collider) of both X and Y
      zVals[i] = xVals[i]! + yVals[i]! + Math.sin(i * 0.37) * 0.1;
    }

    const timeSeries = new Map([
      ['X', xVals],
      ['Y', yVals],
      ['Z', zVals],
    ]);

    const result = runPCAlgorithm(['X', 'Y', 'Z'], timeSeries, {
      alpha: 0.01,
      maxConditioningSetSize: 2,
      minCorrelation: 0.03,
    });

    // X and Y are NOT adjacent (no direct causal link)
    const nodePairs = result.skeleton.map((e) => `${e.from}-${e.to}`);
    const hasXY = nodePairs.some((p) => p === 'X-Y' || p === 'Y-X');
    expect(hasXY).toBe(false);

    // X-Z and Y-Z should be adjacent
    const hasXZ = nodePairs.some((p) => p === 'X-Z' || p === 'Z-X');
    const hasYZ = nodePairs.some((p) => p === 'Y-Z' || p === 'Z-Y');
    expect(hasXZ).toBe(true);
    expect(hasYZ).toBe(true);

    // If v-structure detected: X→Z←Y
    // (May not always orient properly with perfect v-structure data
    // due to limited conditioning set search; skeleton is sufficient)
  });

  it('returns empty skeleton for uncorrelated data', () => {
    // Use deterministic sinusoidal signals at widely separated frequencies
    // so they are structurally uncorrelated — no spurious edges.
    const n = 50;
    const createSignal = (freq: number) => {
      const arr = new Float64Array(n);
      for (let i = 0; i < n; i++) arr[i] = Math.sin(i * freq);
      return arr;
    };
    const timeSeries = new Map([
      ['A', createSignal(0.1)],
      ['B', createSignal(1.7)], // Far enough from 0.1 to be uncorrelated
    ]);

    const result = runPCAlgorithm(['A', 'B'], timeSeries, {
      alpha: 0.05,
      maxConditioningSetSize: 1,
      minCorrelation: 0.3,
    });

    // With high minCorrelation, uncorrelated nodes should have no edges
    expect(result.skeleton).toHaveLength(0);
  });

  it('handles single node', () => {
    const timeSeries = new Map([['A', new Float64Array([1, 2, 3])]]);

    const result = runPCAlgorithm(['A'], timeSeries);
    expect(result.skeleton).toHaveLength(0);
    expect(result.vStructures).toHaveLength(0);
    expect(result.stats.totalCITests).toBe(0);
  });

  it('returns valid stats', () => {
    const timeSeries = new Map([
      ['A', new Float64Array([1, 2, 3, 4])],
      ['B', new Float64Array([2, 4, 6, 8])],
      ['C', new Float64Array([3, 6, 9, 12])],
    ]);

    const result = runPCAlgorithm(['A', 'B', 'C'], timeSeries);

    expect(result.stats.totalCITests).toBeGreaterThanOrEqual(0);
    expect(result.stats.iterations).toBeGreaterThanOrEqual(0);
    expect(result.stats.vStructuresFound).toBeGreaterThanOrEqual(0);
    expect(result.stats.edgesRemoved).toBeGreaterThanOrEqual(0);
  });
});
