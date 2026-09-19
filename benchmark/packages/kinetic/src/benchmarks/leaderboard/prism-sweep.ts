/**
 * PrismWeight sweep analysis — the zero-regression frontier of fusing the
 * PRISM graph-free signal into the production ranking at a continuum of
 * weights.
 *
 * The fusion ceiling showed the deterministic engine and PRISM are strongly
 * complementary (union 87.5% vs 76.1% / 76.7% separately), but a single fixed
 * `prismWeight = 1` is NET POSITIVE (+5.18pp) yet violates the zero-regression
 * criterion (5 cells regress, all in delay/socket + already-100% cells, where
 * PRISM's max-normalised score overrides the engine's correct top-1). The
 * question this module answers is: does a SINGLE GLOBAL weight exist that is
 * both net-positive and zero-regression? If yes, the default flips to that
 * weight; if not, per-context routing is required.
 *
 * Given per-cell (system × fault-type) AC@1 measured at each sweep weight, the
 * analysis computes (1) the weighted overall curve, (2) the zero-regression
 * frontier — the set of weights where NO cell's AC@1 falls below its weight-0
 * baseline — and (3) the frontier weight with the highest overall AC@1.
 *
 * This module is a pure aggregation over the sweep measurements; it performs
 * no I/O and makes no assumption about how the accuracies were produced.
 *
 * @module benchmarks/leaderboard/prism-sweep
 */

/** Per-cell (system × fault-type) AC@1 measured across the sweep weights. */
export interface SweepCell {
  /** Stable cell key (e.g. "re1/OnlineBoutique/cpu"). */
  readonly key: string;
  /** Unique case count for this cell (the weighted-average denominator). */
  readonly cases: number;
  /** AC@1 fraction in [0, 1], one entry per weight (aligned with `weights`). */
  readonly accuracy: readonly number[];
}

/** One sweep point: the fused engine at a single `prismWeight`. */
export interface SweepPoint {
  /** The prismWeight this point was measured at. */
  readonly weight: number;
  /** Weighted overall AC@1 across all cells. */
  readonly overall: number;
  /** Cells whose AC@1 fell below their weight-0 baseline at this weight. */
  readonly regressingCells: readonly string[];
}

/** The full sweep analysis. */
export interface PrismSweepAnalysis {
  /** The sweep weights, in ascending order (weights[0] is the baseline). */
  readonly weights: readonly number[];
  /** Weighted overall AC@1 per weight (parallel to `weights`). */
  readonly overall: readonly number[];
  /** Per-weight detail (parallel to `weights`). */
  readonly points: readonly SweepPoint[];
  /** Weights where NO cell regresses (the zero-regression frontier). */
  readonly zeroRegressionWeights: readonly number[];
  /**
   * The zero-regression weight with the highest overall AC@1, or `null` when
   * there are no cells (no comparative information). `gain` is the overall
   * delta vs the weight-0 baseline.
   */
  readonly bestZeroRegression: {
    readonly weight: number;
    readonly overall: number;
    readonly gain: number;
  } | null;
}

/**
 * Absolute tolerance for the regression comparison. AC@1 fractions derive from
 * integer counts (correct / cases), so the smallest meaningful difference is
 * `1 / cases` (≥ 1e-5 for realistic cell sizes) — far above float noise. The
 * epsilon only absorbs sub-ULP float error.
 */
const REGRESSION_EPSILON = 1e-9;

/**
 * Analyze a prismWeight sweep and derive the zero-regression frontier.
 *
 * @param weights - Sweep weights in ascending order; `weights[0]` is the
 *   baseline (the production config with prismWeight 0).
 * @param cells - Per-cell AC@1 measured at every weight, aligned to `weights`.
 * @returns The overall curve, per-weight regression detail, the zero-regression
 *   frontier, and the best zero-regression weight (or `null` for empty input).
 * @throws {TypeError} If any cell's `accuracy` length does not match
 *   `weights.length`.
 */
export function analyzePrismSweep(
  weights: readonly number[],
  cells: readonly SweepCell[],
): PrismSweepAnalysis {
  const n = weights.length;
  for (const c of cells) {
    if (c.accuracy.length !== n) {
      throw new TypeError(`cell "${c.key}" has ${c.accuracy.length} accuracies for ${n} weights`);
    }
  }

  let totalCases = 0;
  for (const c of cells) totalCases += c.cases;

  const overall: number[] = Array.from({ length: n }, () => 0);
  const regressingByWeight: string[][] = Array.from({ length: n }, () => []);

  for (let w = 0; w < n; w++) {
    let correct = 0;
    for (const c of cells) {
      correct += c.cases * c.accuracy[w]!;
      // A cell regresses iff its accuracy at this weight falls strictly below
      // its weight-0 baseline (modulo float noise).
      if (c.accuracy[w]! + REGRESSION_EPSILON < c.accuracy[0]!) {
        regressingByWeight[w]!.push(c.key);
      }
    }
    overall[w] = totalCases > 0 ? correct / totalCases : 0;
  }

  const zeroRegressionWeights: number[] = [];
  const points: SweepPoint[] = [];
  for (let w = 0; w < n; w++) {
    points.push({
      weight: weights[w]!,
      overall: overall[w]!,
      regressingCells: regressingByWeight[w]!,
    });
    if (regressingByWeight[w]!.length === 0) {
      zeroRegressionWeights.push(weights[w]!);
    }
  }

  // Best zero-regression weight = argmax overall; for empty cells there is no
  // comparative information so the best is undefined.
  let best: PrismSweepAnalysis['bestZeroRegression'] = null;
  if (cells.length > 0) {
    let bestWeight = zeroRegressionWeights[0]!;
    let bestOverall = 0;
    let bestIdx = -1;
    for (let w = 0; w < n; w++) {
      if (regressingByWeight[w]!.length !== 0) continue;
      if (bestIdx < 0 || overall[w]! > bestOverall) {
        bestIdx = w;
        bestWeight = weights[w]!;
        bestOverall = overall[w]!;
      }
    }
    if (bestIdx >= 0) {
      best = {
        weight: bestWeight,
        overall: bestOverall,
        gain: bestOverall - overall[0]!,
      };
    }
  }

  return {
    weights,
    overall,
    points,
    zeroRegressionWeights,
    bestZeroRegression: best,
  };
}
