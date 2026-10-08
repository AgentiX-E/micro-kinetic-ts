/**
 * PRISM sweep analysis — the zero-regression frontier of fusing the PRISM
 * graph-free signal into the production ranking, over the axis the fusion
 * decision is actually made on.
 *
 * The fusion ceiling showed the deterministic engine and PRISM are strongly
 * complementary (union 87.5% vs 76.1% / 76.7% separately), but a single fixed
 * `prismWeight = 1` is NET POSITIVE (+5.18pp) yet violates the zero-regression
 * criterion (5 cells regress, all in delay/socket + already-100% cells). The
 * question this module answers is: does a single GLOBAL configuration exist that
 * is both net-positive and zero-regression? If yes, the default flips to it; if
 * not, per-context routing is required.
 *
 * ## Why the axis is POINTS rather than weights, and why that is a correction
 *
 * The fusion axis has **two** dimensions, and until the PRISM pooling was enrolled in
 * the engine (`TreePrunerOptions.prismPooling`) only one of them was reachable: the
 * engine's single call site omitted the pooling argument, so every point of the
 * weight ladder was measured with `conjunctive` unreachable. The frontier the ladder
 * produced — *"`{0}` only"* — is therefore a statement about **one slice** of the space
 * the decision is made in, and a statement about a slice is not a statement about the
 * space. This module takes the axis as a LIST OF POINTS, each naming its own weight and
 * pooling, so a frontier can be re-taken over the whole space and cannot be reported
 * without saying which pooling won.
 *
 * The module remains a pure aggregation over measurements: no I/O, and no assumption
 * about how the accuracies were produced.
 *
 * ## Three things it REFUSES, because each is a way to report a frontier that is not one
 *
 * 1. **An axis that does not start at the shipped configuration.** The whole output is
 *    "no cell fell below the baseline", so the baseline is not a point among points —
 *    it is the definition of the comparison, and it has exactly one value.
 * 2. **A duplicated point.** Two columns of one measurement double-count a cell in the
 *    weighted overall and name one configuration twice on the frontier.
 * 3. **A label that disagrees with the point it labels.** The label is derived from the
 *    point, so a hand-written one that differs is a column whose printed name is not its
 *    configuration — the same defect as naming the wrong column.
 *
 * @module benchmarks/leaderboard/prism-sweep
 */

import { DEFAULT_PRISM_POOLING, type PrismPooling } from '@agentix-e/micro-kinetic-core';

export {
  DEFAULT_PRISM_POOLING,
  isPrismPooling,
  PRISM_POOLINGS,
} from '@agentix-e/micro-kinetic-core';
export type { PrismPooling } from '@agentix-e/micro-kinetic-core';

/**
 * One point of the swept axis: the configuration a column was measured at.
 *
 * `label` is DERIVED from (`weight`, `pooling`) by {@link axisPoint} rather than supplied,
 * because a frontier line that prints `weight=1` is ambiguous between two configurations —
 * one of which can regress and the other not — and the ambiguity is precisely what the
 * second dimension introduced.
 */
export interface AxisPoint {
  /** The `prismWeight` this point measured at. */
  readonly weight: number;
  /** The pooling `prismScore` was built with at this point. */
  readonly pooling: PrismPooling;
  /** The point's own name, e.g. `w=0.5/additive`. Derived; never supplied. */
  readonly label: string;
}

/**
 * Build an axis point, deriving its label.
 *
 * The ONLY supported way to make one: the analyzer refuses a point whose label disagrees
 * with its own configuration, so a point not built here cannot pass as one.
 *
 * @param weight - The `prismWeight` for the point.
 * @param pooling - The pooling for the point.
 * @returns The point, labelled `w=<weight>/<pooling>`.
 */
export function axisPoint(weight: number, pooling: PrismPooling): AxisPoint {
  return { weight, pooling, label: `w=${weight}/${pooling}` };
}

/** Per-cell (system × fault-type) AC@1 measured across the axis points. */
export interface SweepCell {
  /** Stable cell key (e.g. "re1/OnlineBoutique/cpu"). */
  readonly key: string;
  /** Unique case count for this cell (the weighted-average denominator). */
  readonly cases: number;
  /** AC@1 fraction in [0, 1], one entry per axis point (aligned with the axis). */
  readonly accuracy: readonly number[];
}

/** One measured column: the point it was measured at, and what it read. */
export interface SweepReading {
  /** The axis point this column was measured at. */
  readonly point: AxisPoint;
  /** Weighted overall AC@1 across all cells at this point. */
  readonly overall: number;
  /** Cells whose AC@1 fell below their baseline (the axis's first point) here. */
  readonly regressingCells: readonly string[];
}

/** The full sweep analysis. */
export interface PrismSweepAnalysis {
  /** The axis, in the order it was measured. */
  readonly axis: readonly AxisPoint[];
  /** Weighted overall AC@1 per point (parallel to `axis`). */
  readonly overall: readonly number[];
  /** Per-point detail (parallel to `axis`). */
  readonly readings: readonly SweepReading[];
  /** Points where NO cell regresses (the zero-regression frontier). */
  readonly zeroRegressionPoints: readonly AxisPoint[];
  /**
   * The zero-regression point with the highest overall AC@1, or `null` when there
   * are no cells (no comparative information). It names its POINT, not just its
   * weight, so the pooling that won is part of the result. `gain` is the overall
   * delta vs the axis's first point.
   */
  readonly bestZeroRegression: {
    readonly point: AxisPoint;
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
 * Analyse a PRISM sweep over a two-dimensional axis and derive its frontier.
 *
 * @param axis - The measured points in column order; `axis[0]` MUST be the shipped
 *   configuration (`weight 0` with {@link DEFAULT_PRISM_POOLING}), because it is the
 *   zero-regression reference rather than a point among points.
 * @param cells - Per-cell AC@1 measured at every point, aligned to `axis`.
 * @returns The overall curve, per-point regression detail, the zero-regression
 *   frontier, and the best zero-regression point (or `null` for empty input).
 * @throws {TypeError} If a cell's `accuracy` length does not match `axis.length`, if
 *   `axis[0]` is not the shipped configuration, if any point is duplicated, or if a
 *   point's `label` disagrees with its own configuration.
 */
export function analyzePrismSweep(
  axis: readonly AxisPoint[],
  cells: readonly SweepCell[],
): PrismSweepAnalysis {
  const n = axis.length;
  for (const c of cells) {
    if (c.accuracy.length !== n) {
      throw new TypeError(`cell "${c.key}" has ${c.accuracy.length} accuracies for ${n} points`);
    }
  }

  // The baseline is the SHIPPED configuration, and it is identified by its two dimensions
  // rather than by its position: a frontier measured against anything else is a frontier
  // nobody can act on, and it is indistinguishable in the artifact from one that can.
  if (n > 0) {
    const first = axis[0]!;
    if (first.weight !== 0 || first.pooling !== DEFAULT_PRISM_POOLING) {
      throw new TypeError(
        `the first axis point must be the shipped configuration ` +
          `(weight 0, pooling "${DEFAULT_PRISM_POOLING}"), got "${first.label}"`,
      );
    }
  }

  // A point's identity is its configuration, and its label must BE that identity: a label
  // that disagrees prints a configuration the column was not measured at.
  const seen = new Set<string>();
  for (const p of axis) {
    const identity = axisPoint(p.weight, p.pooling).label;
    if (p.label !== identity) {
      throw new TypeError(`axis point label "${p.label}" does not name its configuration`);
    }
    if (seen.has(p.label)) throw new TypeError(`duplicate axis point "${p.label}"`);
    seen.add(p.label);
  }

  let totalCases = 0;
  for (const c of cells) totalCases += c.cases;

  const overall: number[] = Array.from({ length: n }, () => 0);
  const regressingByPoint: string[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    let correct = 0;
    for (const c of cells) {
      correct += c.cases * c.accuracy[i]!;
      // A cell regresses iff its accuracy at this point falls strictly below its
      // baseline (the axis's first point), modulo float noise.
      if (c.accuracy[i]! + REGRESSION_EPSILON < c.accuracy[0]!) {
        regressingByPoint[i]!.push(c.key);
      }
    }
    overall[i] = totalCases > 0 ? correct / totalCases : 0;
  }

  const zeroRegressionPoints: AxisPoint[] = [];
  const readings: SweepReading[] = [];
  for (let i = 0; i < n; i++) {
    readings.push({
      point: axis[i]!,
      overall: overall[i]!,
      regressingCells: regressingByPoint[i]!,
    });
    if (regressingByPoint[i]!.length === 0) {
      zeroRegressionPoints.push(axis[i]!);
    }
  }

  // Best zero-regression point = argmax overall; for empty cells there is no
  // comparative information so the best is undefined. Ties keep the EARLIER column,
  // so the choice is a property of the measured order rather than of an
  // iteration order nobody stated.
  let best: PrismSweepAnalysis['bestZeroRegression'] = null;
  if (cells.length > 0) {
    let bestIdx = -1;
    let bestOverall = 0;
    for (let i = 0; i < n; i++) {
      if (regressingByPoint[i]!.length !== 0) continue;
      if (bestIdx < 0 || overall[i]! > bestOverall) {
        bestIdx = i;
        bestOverall = overall[i]!;
      }
    }
    if (bestIdx >= 0) {
      best = {
        point: axis[bestIdx]!,
        overall: bestOverall,
        gain: bestOverall - overall[0]!,
      };
    }
  }

  return {
    axis,
    overall,
    readings,
    zeroRegressionPoints,
    bestZeroRegression: best,
  };
}
