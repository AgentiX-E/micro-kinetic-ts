/**
 * Graph spectrum of the cascade's transport operator.
 *
 * The cascade integrates a kinetic equation on a service call graph. Its linear part is the
 * generator of a reversible transport process, and for a symmetric coupling that generator is the
 * graph Laplacian `L = D - S`. The Laplacian's spectrum is what the package's decay claim has
 * always been about — `computeDecayCurve` publishes `τ = 1 / spectralGap` — so the gap is computed
 * here, once, from the SAME operator the trajectory is integrated with, and with an exact
 * algorithm instead of a random restart.
 *
 * ## Why not power iteration with deflation
 *
 * The previous implementation drew a random starting vector (`Math.random()`), ran power iteration
 * for the dominant eigenvalue, subtracted the rank-one approximation and iterated again. Three
 * separate defects came out of that:
 *
 * 1. **The result was not reproducible.** Two runs of the same graph returned different gaps, so
 *    `decayConstant` and every number derived from it differed between two measurements of the same
 *    input. A benchmark whose inputs are random has no error bar to report.
 * 2. **Deflation is only exact for a symmetric matrix**, and the matrix it was given was the
 *    *directed* adjacency with a unit diagonal — asymmetric, so `λ₂` was not an eigenvalue of
 *    anything and the published gap was a quantity with no spectral meaning.
 * 3. **The dominant eigenvalue of an adjacency matrix is not a gap between equilibria.** For a
 *    diffusion the slowest mode is the *second smallest* Laplacian eigenvalue (algebraic
 *    connectivity), not `λ₁ - λ₂` of an adjacency.
 *
 * A cyclic Jacobi sweep is deterministic, exact to machine precision for a symmetric matrix, and
 * gives the whole spectrum at once, which is what makes the analytic checks in the test suite
 * possible: a path, a cycle, a star and a complete graph all have closed-form spectra.
 *
 * @module wave/cascade/graph-spectrum
 */

/** A symmetric matrix's spectrum, sorted ascending, with its algebraic connectivity. */
export interface GraphSpectrum {
  /** Every eigenvalue, ascending (length = node count) */
  readonly eigenvalues: readonly number[];
  /**
   * Algebraic connectivity — the second smallest eigenvalue of the Laplacian.
   *
   * It is the decay rate of the slowest non-constant mode of `dn/dt = -speed · L n`, i.e. the
   * quantity `computeDecayCurve` inverts to publish a decay constant. Zero means the graph is
   * disconnected (or has a single node), so nothing decorrelates across the split.
   */
  readonly gap: number;
}

/**
 * The symmetric transport coupling of a call graph.
 *
 * `S(i,j) = max(A(i,j), A(j,i))`: an alert crosses the edge between two services at the rate of the
 * stronger direction, because the two mechanisms that carry it — a callee degrading its callers,
 * and a caller's retries loading its callee — are both real and the graph records only one of them
 * per edge. The diagonal is zero: a service does not transport to itself, and the unit diagonal the
 * previous adjacency carried made every degree one larger than the number of edges, which is what
 * turned the interaction kernel's self term into the only non-zero term it had.
 *
 * @param edges - Directed edges with their call rate and error rate
 * @param index - Map from service id to matrix index
 * @param n - Matrix dimension
 * @returns Flattened symmetric coupling matrix (row-major), diagonal zero
 */
export function buildTransportCoupling(
  edges: readonly {
    readonly from: string;
    readonly to: string;
    readonly callRate: number;
    readonly errorRate: number;
  }[],
  index: ReadonlyMap<string, number>,
  n: number,
): Float64Array {
  const coupling = new Float64Array(n * n);
  for (const edge of edges) {
    const from = index.get(edge.from);
    const to = index.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;

    // A call that fails never carries the alert: the surviving share is what transports.
    const rate = Math.tanh(edge.callRate / 100) * (1 - edge.errorRate);
    const weight = Math.max(0, Math.min(1, rate));
    const slot = from * n + to;
    if (weight > coupling[slot]!) {
      coupling[slot] = weight;
      coupling[to * n + from] = weight;
    }
  }
  return coupling;
}

/**
 * Laplacian spectrum of a symmetric coupling matrix.
 *
 * @param coupling - Flattened symmetric N×N matrix (row-major), zero diagonal
 * @param n - Matrix dimension
 * @returns Ascending eigenvalues and the algebraic connectivity
 */
export function laplacianSpectrum(coupling: Float64Array, n: number): GraphSpectrum {
  if (n <= 1) return { eigenvalues: [0], gap: 0 };

  const laplacian = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    let degree = 0;
    for (let j = 0; j < n; j++) {
      const w = i === j ? 0 : coupling[i * n + j]!;
      laplacian[i * n + j] = -w;
      degree += w;
    }
    laplacian[i * n + i] = degree;
  }

  const eigenvalues = symmetricEigenvalues(laplacian, n);
  // Round-off can put a structural zero a few ulps below zero; the spectrum is non-negative by
  // construction for a Laplacian, so the sign is restored rather than reported.
  const cleaned = eigenvalues.map((value) => (value < 0 && value > -1e-9 ? 0 : value));
  // `n >= 2` here is not a guard: the single-node case returned above, so there are always at least
  // two eigenvalues to read and a ternary on the condition would be a branch nothing can take.
  return { eigenvalues: cleaned, gap: Math.max(0, cleaned[1]!) };
}

/**
 * Eigenvalues of a symmetric matrix by cyclic Jacobi rotations.
 *
 * Deterministic by construction: no starting vector, no iteration count that depends on the data,
 * and the same input always produces the same output to the last bit. The sweep stops when the
 * off-diagonal Frobenius norm falls below `1e-12 · ‖A‖`, which for the matrices this package sees
 * (n ≤ 200, entries in [0, 1]) is reached in a handful of sweeps.
 *
 * @param input - Flattened symmetric N×N matrix (row-major), not modified
 * @param n - Matrix dimension
 * @returns Eigenvalues ascending
 */
export function symmetricEigenvalues(input: Float64Array, n: number): number[] {
  const a = Float64Array.from(input);

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) off += a[i * n + j]! * a[i * n + j]!;
    }
    if (Math.sqrt(2 * off) < 1e-13) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q]!;
        if (Math.abs(apq) < 1e-300) continue;

        const app = a[p * n + p]!;
        const aqq = a[q * n + q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p]!;
          const akq = a[k * n + q]!;
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k]!;
          const aqk = a[q * n + k]!;
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
      }
    }
  }

  const eigenvalues: number[] = [];
  for (let i = 0; i < n; i++) eigenvalues.push(a[i * n + i]!);
  return eigenvalues.sort((x, y) => x - y);
}
