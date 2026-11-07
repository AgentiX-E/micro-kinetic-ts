import { describe, expect, it } from 'vitest';
import {
  buildTransportCoupling,
  laplacianSpectrum,
  symmetricEigenvalues,
} from '../../../src/cascade/graph-spectrum.js';

// ── Helpers ─────────────────────────────────────────────────
//
// Unit-weight matrices are built by hand so the spectrum has a closed form to compare against. The
// point of these tests is that the number the cascade reports as a decay rate is a real eigenvalue
// of a real operator: every previous assertion on it was `> 0`, which a constant satisfies.

function dense(n: number, pairs: readonly (readonly [number, number])[]): Float64Array {
  const matrix = new Float64Array(n * n);
  for (const [a, b] of pairs) {
    matrix[a * n + b] = 1;
    matrix[b * n + a] = 1;
  }
  return matrix;
}

function path(n: number): Float64Array {
  const pairs: [number, number][] = [];
  for (let i = 0; i + 1 < n; i++) pairs.push([i, i + 1]);
  return dense(n, pairs);
}

function cycle(n: number): Float64Array {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) pairs.push([i, (i + 1) % n]);
  return dense(n, pairs);
}

function complete(n: number): Float64Array {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  return dense(n, pairs);
}

function star(leaves: number): Float64Array {
  const pairs: [number, number][] = [];
  for (let leaf = 1; leaf <= leaves; leaf++) pairs.push([0, leaf]);
  return dense(leaves + 1, pairs);
}

// ── The Laplacian spectrum has closed forms ─────────────────

describe('laplacianSpectrum', () => {
  it('reproduces the path spectrum 2 - 2cos(kπ/n)', () => {
    // Analytic, not fitted: the gap of P_n is 2 - 2cos(π/n).
    for (const n of [3, 4, 10, 70]) {
      const { eigenvalues, gap } = laplacianSpectrum(path(n), n);
      expect(gap).toBeCloseTo(2 - 2 * Math.cos(Math.PI / n), 9);
      expect(eigenvalues.length).toBe(n);
      expect(eigenvalues[0]).toBeCloseTo(0, 9);
      expect(eigenvalues[n - 1]!).toBeCloseTo(2 + 2 * Math.cos(Math.PI / n), 9);
    }
  });

  it('reproduces the cycle spectrum 2 - 2cos(2πk/n)', () => {
    for (const n of [4, 6, 20]) {
      const { gap } = laplacianSpectrum(cycle(n), n);
      expect(gap).toBeCloseTo(2 - 2 * Math.cos((2 * Math.PI) / n), 9);
    }
  });

  it('reproduces the complete graph spectrum: 0 and n with multiplicity n-1', () => {
    for (const n of [3, 5, 12]) {
      const { eigenvalues, gap } = laplacianSpectrum(complete(n), n);
      expect(gap).toBeCloseTo(n, 9);
      expect(eigenvalues[1]).toBeCloseTo(n, 9);
      expect(eigenvalues[n - 1]).toBeCloseTo(n, 9);
    }
  });

  it('reproduces the star spectrum: the gap of a star is 1, whatever its size', () => {
    // The star is the counter-example to "more edges means faster mixing": its gap is 1 for every
    // leaf count, so a cascade through a fan-out hub decorrelates at a fixed rate.
    for (const leaves of [2, 5, 30]) {
      expect(laplacianSpectrum(star(leaves), leaves + 1).gap).toBeCloseTo(1, 9);
    }
  });

  it('reports zero for a graph with no edges, and for a single node', () => {
    expect(laplacianSpectrum(new Float64Array(9), 3).gap).toBe(0);
    expect(laplacianSpectrum(new Float64Array(1), 1)).toEqual({ eigenvalues: [0], gap: 0 });
  });

  it('reports zero gap for a disconnected graph, from the block structure', () => {
    // Two disjoint edges: the spectrum carries two zeros, so the second smallest is still zero.
    const n = 4;
    const { eigenvalues, gap } = laplacianSpectrum(
      dense(n, [
        [0, 1],
        [2, 3],
      ]),
      n,
    );
    expect(gap).toBe(0);
    expect(eigenvalues[0]).toBeCloseTo(0, 9);
    expect(eigenvalues[1]).toBeCloseTo(0, 9);
  });
});

// ── Determinism ─────────────────────────────────────────────

describe('symmetricEigenvalues', () => {
  it('is bit-for-bit deterministic across calls', () => {
    // The implementation this replaced drew `Math.random()` for its starting vector, so two runs of
    // the same graph produced different decay constants. A measurement has to be repeatable to have
    // an error bar, and this is the assertion that makes that true.
    const matrix = path(25);
    const first = symmetricEigenvalues(matrix, 25);
    const second = symmetricEigenvalues(matrix, 25);
    expect(second).toEqual(first);
  });

  it('does not mutate its input', () => {
    const matrix = path(6);
    const copy = Float64Array.from(matrix);
    symmetricEigenvalues(matrix, 6);
    expect(Array.from(matrix)).toEqual(Array.from(copy));
  });

  it('returns ascending eigenvalues', () => {
    const values = symmetricEigenvalues(complete(7), 7);
    for (let i = 1; i < values.length; i++)
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
  });
});

// ── The coupling the operator is built from ─────────────────

describe('buildTransportCoupling', () => {
  const index = new Map([
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ]);
  // Indices are read from the map rather than written as `0 * 3 + 1`: the literal is the same number
  // but it hides which services the assertion is about, and the linter is right to say so.
  const at = (id: string): number => index.get(id)!;

  it('symmetrises a one-way call, because an alert crosses the edge both ways', () => {
    const coupling = buildTransportCoupling(
      [{ from: 'a', to: 'b', callRate: 1000, errorRate: 0 }],
      index,
      3,
    );
    expect(coupling[at('a') * 3 + at('b')]).toBeCloseTo(Math.tanh(10), 12);
    expect(coupling[at('b') * 3 + at('a')]).toBeCloseTo(Math.tanh(10), 12);
  });

  it('keeps the STRONGER direction when both are recorded', () => {
    const coupling = buildTransportCoupling(
      [
        { from: 'a', to: 'b', callRate: 1000, errorRate: 0 },
        { from: 'b', to: 'a', callRate: 10, errorRate: 0 },
      ],
      index,
      3,
    );
    expect(coupling[at('a') * 3 + at('b')]).toBeCloseTo(Math.tanh(10), 12);
  });

  it('has a zero diagonal — a service does not transport to itself', () => {
    const coupling = buildTransportCoupling(
      [{ from: 'a', to: 'a', callRate: 1000, errorRate: 0 }],
      index,
      3,
    );
    expect(coupling[0]).toBe(0);
  });

  it('weights the surviving share: a call that always fails transports nothing', () => {
    const coupling = buildTransportCoupling(
      [{ from: 'a', to: 'b', callRate: 1000, errorRate: 1 }],
      index,
      3,
    );
    expect(coupling[at('a') * 3 + at('b')]).toBe(0);
  });

  it('ignores edges whose endpoints are not in the index', () => {
    const coupling = buildTransportCoupling(
      [{ from: 'a', to: 'ghost', callRate: 1000, errorRate: 0 }],
      index,
      3,
    );
    expect(Array.from(coupling).every((value) => value === 0)).toBe(true);
  });
});
