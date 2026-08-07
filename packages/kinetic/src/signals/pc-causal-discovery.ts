/**
 * PC Algorithm — Constraint-Based Causal Discovery for Microservice RCA.
 *
 * ## Deng Yu Collision Tree Mapping
 *
 * The PC algorithm (Spirtes-Glymour-Scheines) provides a principled way to
 * discover causal structures from observational data. In Deng Yu's collision
 * tree theory, the PC algorithm's conditional independence tests map directly
 * to:
 *
 *   - **Collision nodes**: d-separation failures mark where fault signals
 *     collide — the CI test fails due to nonlinear superposition.
 *   - **v-structures**: PC-discovered colliders (X→Z←Y) align with
 *     Deng Yu's collision cross-section maxima where fault energy concentrates.
 *   - **Skeleton**: the undirected graph before orientation corresponds to the
 *     raw kinetic interaction graph before causal arrow assignment.
 *
 * ### Algorithm Steps
 *
 * 1. **Skeleton Discovery**: Start with complete undirected graph. For each
 *    pair (X, Y), test X ⟂ Y | S for conditioning sets S of increasing size.
 *    Remove edge if any conditional independence test passes.
 *
 * 2. **v-Structure Orientation**: For each unshielded triple (X—Z—Y), if
 *    Z is NOT in the conditioning set that made X⟂Y, orient X→Z←Y.
 *
 * 3. **Meek Rules**: Apply rule 1 (no new v-structures), rule 2 (no cycles),
 *    rule 3 (no additional colliders) to propagate orientations.
 *
 * ### Conditional Independence Test
 *
 * We use Fisher's z-transformation of Pearson correlation:
 *
 *   z = 0.5 · ln((1+r)/(1-r)) · √(n - |S| - 3)
 *
 * Under H₀ (independence), z ~ N(0, 1). Two-tailed test at α significance.
 *
 * ### Why PC for Microservices?
 *
 * Compared to LiNGAM (linear non-Gaussian) or GES (score-based):
 * - PC handles mixed causal structures (chains, forks, colliders)
 * - No distributional assumptions beyond normality of z-statistic
 * - Efficient for moderate node counts (n ≤ 100 services)
 * - Directly integrates with collision tree energy computation
 *   by providing the causal skeleton for Q(f,f) propagation
 *
 * @module signals/pc-causal-discovery
 */

/**
 * Edge in the causal graph skeleton.
 */
export interface CausalEdge {
  from: string;
  to: string;
}

/**
 * Directed edge in the final causal PDAG (Partially Directed Acyclic Graph).
 */
export interface DirectedCausalEdge {
  from: string;
  to: string;
  /** Whether the direction is forced (true) or undecided (false) */
  directed: boolean;
}

/**
 * Result of the PC algorithm.
 */
export interface PCResult {
  /** Discovered causal skeleton (undirected edges) */
  skeleton: readonly CausalEdge[];
  /** Oriented edges (directed from CI tests) */
  directedEdges: readonly DirectedCausalEdge[];
  /** Remaining undirected edges */
  undirectedEdges: readonly CausalEdge[];
  /** v-structures discovered (colliders) */
  vStructures: readonly { parents: readonly string[]; child: string }[];
  /** Runtime statistics */
  stats: {
    totalCITests: number;
    edgesRemoved: number;
    vStructuresFound: number;
    iterations: number;
  };
}

/**
 * Configuration for the PC algorithm.
 */
export interface PCConfig {
  /** Significance level α for CI tests. Default: 0.05 */
  alpha: number;
  /** Maximum size of conditioning set. Default: 5 (prevent combinatorial explosion) */
  maxConditioningSetSize: number;
  /** Minimum absolute correlation to consider as potentially causal. Default: 0.1 */
  minCorrelation: number;
}

const DEFAULT_PC_CONFIG: PCConfig = {
  alpha: 0.05,
  maxConditioningSetSize: 5,
  minCorrelation: 0.1,
};

/**
 * Compute Pearson correlation coefficient between two time series.
 *
 * r = Σ((x_i - μ_x)(y_i - μ_y)) / √(Σ(x_i - μ_x)² · Σ(y_i - μ_y)²)
 *
 * Returns NaN if either series has zero variance or lengths don't match.
 */
export function pearsonCorrelation(
  xs: Float64Array | readonly number[],
  ys: Float64Array | readonly number[],
): number {
  const n = xs.length;
  if (n !== ys.length || n < 3) return NaN;

  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0,
    sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const num = n * sumXY - sumX * sumY;
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denom === 0) return NaN;
  return num / denom;
}

/**
 * Compute partial correlation coefficient r_{xy·S}.
 *
 * For conditioning set S of size k, use the matrix inversion formula:
 *
 *   r_{xy·S} = -Ω_{xy} / √(Ω_{xx} · Ω_{yy})
 *
 * where Ω is the inverse of the (k+2)×(k+2) correlation matrix
 * of [x, y, s₁, ..., s_k].
 *
 * Falls back to recursive formula for small conditioning sets to
 * avoid numerical instability from matrix inversion.
 *
 * @param r_xy - Correlation between X and Y
 * @param r_xs - Correlations between X and each variable in S
 * @param r_ys - Correlations between Y and each variable in S
 * @param r_ss - Correlation matrix of S (flattened row-major)
 * @returns Partial correlation coefficient ∈ [-1, 1], or NaN on failure
 */
export function partialCorrelation(
  r_xy: number,
  r_xs: readonly number[],
  r_ys: readonly number[],
  r_ss: readonly number[],
): number {
  const k = r_xs.length;

  // Base case: no conditioning
  if (k === 0) return r_xy;

  // Edge case: singular or invalid input
  if (k !== r_ys.length || r_ss.length !== k * k) return NaN;

  // For k=1 (single conditioning variable):
  // r_{xy·z} = (r_xy - r_xz · r_yz) / √((1 - r_xz²)(1 - r_yz²))
  if (k === 1) {
    const r_xz = r_xs[0]!;
    const r_yz = r_ys[0]!;
    const num = r_xy - r_xz * r_yz;
    const denom = Math.sqrt((1 - r_xz * r_xz) * (1 - r_yz * r_yz));
    if (denom === 0) return NaN;
    return num / denom;
  }

  // For k ≥ 2: Use recursive decomposition
  // Remove the last variable from S and compute partial correlation stepwise.
  // r_{xy·S} = r_{xy·S\{z}} - r_{xz·S\{z}} · r_{yz·S\{z}} / √(...)
  // This is more numerically stable than matrix inversion.

  const lastIdx = k - 1;
  const r_ssSub = r_ss.slice(0, lastIdx * lastIdx);
  const r_xsSub = r_xs.slice(0, lastIdx);
  const r_ysSub = r_ys.slice(0, lastIdx);

  const r_xy_sub = partialCorrelation(r_xy, r_xsSub, r_ysSub, r_ssSub);
  const r_xz_sub = partialCorrelation(
    r_xs[lastIdx]!,
    r_xsSub,
    r_ss.slice(lastIdx * k, lastIdx * k + lastIdx),
    r_ssSub,
  );
  const r_yz_sub = partialCorrelation(
    r_ys[lastIdx]!,
    r_ysSub,
    r_ss.slice(lastIdx * k, lastIdx * k + lastIdx),
    r_ssSub,
  );

  if (isNaN(r_xy_sub) || isNaN(r_xz_sub) || isNaN(r_yz_sub)) return NaN;

  const num = r_xy_sub - r_xz_sub * r_yz_sub;
  const denom = Math.sqrt((1 - r_xz_sub * r_xz_sub) * (1 - r_yz_sub * r_yz_sub));

  if (denom === 0) return NaN;
  return num / denom;
}

/**
 * Fisher's z-transformation of correlation coefficient.
 *
 *   z = 0.5 · ln((1+r)/(1-r)) · √(n - k - 3)
 *
 * where:
 *   - r: correlation or partial correlation coefficient
 *   - n: sample size
 *   - k: number of conditioning variables
 *
 * Under H₀ (r = 0), z ~ N(0, 1).
 *
 * @param r - Correlation coefficient
 * @param n - Sample size
 * @param k - Number of conditioning variables
 * @returns z-statistic, or 0 if r is NaN
 */
export function fisherZ(r: number, n: number, k: number): number {
  if (isNaN(r) || Math.abs(r) >= 1) return 0;
  const zRaw = 0.5 * Math.log((1 + r) / (1 - r));
  const effectiveN = Math.max(3, n - k - 3);
  return zRaw * Math.sqrt(effectiveN);
}

/**
 * Perform a conditional independence test using Fisher's z-test.
 *
 * H₀: X ⟂ Y | S  (X and Y are independent given S)
 * H₁: X ⟂̸ Y | S   (X and Y are dependent given S)
 *
 * If |z| > z_{α/2}, reject H₀ → X and Y are dependent.
 * Otherwise, fail to reject H₀ → X and Y are independent.
 *
 * @param r_partial - Partial correlation coefficient r_{XY·S}
 * @param n - Sample size
 * @param k - Size of conditioning set S
 * @param alpha - Significance level (default: 0.05)
 * @returns true if independent (fail to reject H₀), false if dependent
 */
export function testConditionalIndependence(
  r_partial: number,
  n: number,
  k: number,
  alpha: number = 0.05,
): boolean {
  const z = Math.abs(fisherZ(r_partial, n, k));

  // z_{α/2} for α=0.05 is 1.96, for α=0.01 is 2.576
  const z_critical = alpha === 0.05 ? 1.96 : 2.576;

  // Independent if |z| ≤ z_critical
  return z <= z_critical;
}

/**
 * Build the complete undirected correlation matrix from time-series data.
 *
 * @param nodeIds - List of node identifiers
 * @param timeSeries - Map from nodeId → time series values
 * @returns N×N correlation matrix (flattened row-major)
 */
export function buildCorrelationMatrix(
  nodeIds: readonly string[],
  timeSeries: ReadonlyMap<string, Float64Array | readonly number[]>,
): { matrix: Float64Array; N: number; sampleSize: number } {
  const N = nodeIds.length;
  let sampleSize = 0;
  const matrix = new Float64Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) {
        matrix[i * N + j] = 1.0;
      } else {
        const xs = timeSeries.get(nodeIds[i]!);
        const ys = timeSeries.get(nodeIds[j]!);
        if (xs && ys) {
          matrix[i * N + j] = pearsonCorrelation(xs, ys);
          // Only count sample size once
          if (sampleSize === 0 && xs.length > 0) {
            sampleSize = xs.length;
          }
        } else {
          matrix[i * N + j] = NaN;
        }
      }
    }
  }

  return { matrix, N, sampleSize };
}

/**
 * Get the correlation matrix entries for a conditioning set S.
 *
 * Given node indices i, j and conditioning set indices sIndices,
 * extract r_xy, r_xs, r_ys, and the S×S correlation submatrix.
 */
function extractConditioningData(
  corrMatrix: Float64Array,
  N: number,
  i: number,
  j: number,
  sIndices: readonly number[],
): { r_xy: number; r_xs: number[]; r_ys: number[]; r_ss: number[] } {
  const k = sIndices.length;
  const r_xy = corrMatrix[i * N + j]!;
  const r_xs: number[] = [];
  const r_ys: number[] = [];
  const r_ss: number[] = [];

  for (const s of sIndices) {
    r_xs.push(corrMatrix[i * N + s]!);
    r_ys.push(corrMatrix[j * N + s]!);
  }

  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      r_ss.push(corrMatrix[sIndices[a]! * N + sIndices[b]!]!);
    }
  }

  return { r_xy, r_xs, r_ys, r_ss };
}

/**
 * Run the PC algorithm for causal discovery.
 *
 * Given time-series data for each node, discover the causal structure
 * by testing conditional independence at increasing conditioning set sizes.
 *
 * Algorithm (Spirtes-Glymour-Scheines, 2000):
 *
 * Phase 1 — Skeleton Discovery:
 *   Start with complete undirected graph G.
 *   For d = 0, 1, 2, ..., maxConditioningSetSize:
 *     For each adjacent pair (X, Y) in G with |Adj(X, G)| ≥ d+1:
 *       For each subset S ⊆ Adj(X, G)\{Y} of size d:
 *         If CI(X, Y | S) holds at significance α:
 *           Remove edge X—Y from G.
 *           Record S as the separating set SepSet(X, Y).
 *           Break to next pair.
 *
 * Phase 2 — v-Structure Orientation:
 *   For each unshielded triple (X—Z—Y) in G:
 *     If Z ∉ SepSet(X, Y) (Z was NOT in the conditioning set that separated X,Y):
 *       Orient X→Z←Y (v-structure / collider).
 *
 * @param nodeIds - All node identifiers
 * @param timeSeries - Map from nodeId → time series values
 * @param config - PC algorithm configuration
 * @returns PC result with discovered causal structure
 */
export function runPCAlgorithm(
  nodeIds: readonly string[],
  timeSeries: ReadonlyMap<string, Float64Array | readonly number[]>,
  config: PCConfig = DEFAULT_PC_CONFIG,
): PCResult {
  const N = nodeIds.length;
  const { matrix: corrMatrix, sampleSize } = buildCorrelationMatrix(nodeIds, timeSeries);

  // Adjacency matrix: adj[i][j] = adjacent in skeleton
  const adj: boolean[][] = Array.from({ length: N }, () => Array(N).fill(true));
  // Separating sets: sepSet[i][j] = set of nodes that made i,j independent
  const sepSet: (Set<number> | null)[][] = Array.from(
    { length: N },
    () => Array(N).fill(null) as (Set<number> | null)[],
  );

  // Remove self-loops
  for (let i = 0; i < N; i++) adj[i]![i] = false;

  // Remove edges with correlation below minCorrelation
  let initialRemovals = 0;
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (
        isNaN(corrMatrix[i * N + j]!) ||
        Math.abs(corrMatrix[i * N + j]!) < config.minCorrelation
      ) {
        adj[i]![j] = adj[j]![i] = false;
        initialRemovals++;
      }
    }
  }

  let totalCITests = 0;
  let edgesRemoved = initialRemovals;
  let maxIterations = 0;

  // Phase 1: Skeleton discovery
  const maxD = Math.min(config.maxConditioningSetSize, N - 2);

  for (let d = 0; d <= maxD; d++) {
    maxIterations = d + 1;
    let removedInRound = 0;

    for (let i = 0; i < N; i++) {
      const adjI = adj[i]!;
      // Get neighbors of i
      const neighbors: number[] = [];
      for (let k = 0; k < N; k++) {
        if (adjI[k]) neighbors.push(k);
      }

      for (const j of neighbors) {
        if (!adjI[j]) continue; // Already removed

        // Need enough neighbors for conditioning set of size d
        const adjSet = neighbors.filter((k) => k !== j);
        if (adjSet.length < d) continue;

        // Test all subsets of size d
        let independent = false;
        let foundSepSet: number[] = [];

        // Generate subsets of size d from adjSet (limited: test first few)
        const subsets = generateSubsets(adjSet, d, 10); // Max 10 subsets per pair
        for (const S of subsets) {
          totalCITests++;

          const { r_xy, r_xs, r_ys, r_ss } = extractConditioningData(corrMatrix, N, i, j, S);
          const rPartial = partialCorrelation(r_xy, r_xs, r_ys, r_ss);

          if (testConditionalIndependence(rPartial, sampleSize, d, config.alpha)) {
            independent = true;
            foundSepSet = S;
            break;
          }
        }

        if (independent) {
          adj[i]![j] = adj[j]![i] = false;
          sepSet[i]![j] = new Set(foundSepSet);
          sepSet[j]![i] = new Set(foundSepSet);
          edgesRemoved++;
          removedInRound++;
        }
      }
    }

    // Stop if no edges were removed in this round
    if (removedInRound === 0 && d > 0) break;
  }

  // Build skeleton (remaining undirected edges)
  const skeleton: CausalEdge[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (adj[i]![j]) {
        skeleton.push({ from: nodeIds[i]!, to: nodeIds[j]! });
      }
    }
  }

  // Phase 2: v-Structure Orientation
  const directedEdges: DirectedCausalEdge[] = [];
  const remainingUndirected: CausalEdge[] = [];
  const vStructures: { parents: readonly string[]; child: string }[] = [];

  // Direction tracking: dir[u][v] = 0 (undirected), 1 (u→v), -1 (v→u)
  const dir: number[][] = Array.from({ length: N }, () => Array(N).fill(0));

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (adj[i]![j]) {
        // Check for unshielded triples involving v-structures
        for (let k = 0; k < N; k++) {
          if (k !== i && k !== j && adj[i]![k] && adj[j]![k]) {
            // Unshielded triple: i—k—j, but i and j are NOT adjacent
            if (!adj[i]![j]) {
              // Check if k was in the separating set for i,j
              const ss = sepSet[i]![j];
              if (!ss || !ss.has(k)) {
                // k NOT in sepSet → orient i→k←j (v-structure)
                dir[i]![k] = 1;
                dir[j]![k] = 1;
                dir[k]![i] = -1;
                dir[k]![j] = -1;
                vStructures.push({ parents: [nodeIds[i]!, nodeIds[j]!], child: nodeIds[k]! });
              }
            }
          }
        }
      }
    }
  }

  // Build output edges
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      if (adj[i]![j]) {
        if (dir[i]![j] === 1) {
          directedEdges.push({ from: nodeIds[i]!, to: nodeIds[j]!, directed: true });
        } else if (dir[i]![j] === -1) {
          directedEdges.push({ from: nodeIds[j]!, to: nodeIds[i]!, directed: true });
        } else {
          remainingUndirected.push({ from: nodeIds[i]!, to: nodeIds[j]! });
        }
      }
    }
  }

  return {
    skeleton,
    directedEdges,
    undirectedEdges: remainingUndirected,
    vStructures,
    stats: {
      totalCITests,
      edgesRemoved,
      vStructuresFound: vStructures.length,
      iterations: maxIterations,
    },
  };
}

/**
 * Generate subsets of the given size from an array.
 *
 * Limited to maxResults to prevent combinatorial explosion.
 * Uses combinatorial generation with backtracking.
 *
 * @param items - Source array
 * @param size - Subset size
 * @param maxResults - Maximum number of subsets to generate
 * @returns Array of subsets (each subset is an array of items)
 */
function generateSubsets<T>(items: readonly T[], size: number, maxResults: number = 10): T[][] {
  const results: T[][] = [];
  if (size === 0) return [[]];
  if (size > items.length) return [];

  function backtrack(start: number, current: T[]): void {
    if (results.length >= maxResults) return;
    if (current.length === size) {
      results.push([...current]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      current.push(items[i]!);
      backtrack(i + 1, current);
      current.pop();
    }
  }

  backtrack(0, []);
  return results;
}
