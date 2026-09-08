/**
 * Fusion-ceiling analysis for two root-cause engines.
 *
 * Given two engines' per-case top-1 predictions (e.g. our deterministic
 * engine and the PRISM graph-free baseline), the fusion ceiling is the set of
 * cases at least one engine gets right — the score a perfect case-level oracle
 * would achieve by always picking the correct engine. Comparing that union
 * against either single engine's accuracy tells us whether a fusion signal is
 * worth building: a union that barely exceeds the better single engine means
 * the two engines fail on the same cases (no complementarity), while a union
 * well above it means the engines are complementary and fusion has headroom.
 *
 * This module is a pure aggregation over prediction records; it performs no
 * I/O and makes no assumption about how the predictions were produced.
 *
 * @module benchmarks/leaderboard/fusion-ceiling
 */

/** A single case's top-1 prediction from two engines, plus the ground truth. */
export interface FusionCasePrediction {
  /** Stable case identifier (joins the two engines' outputs). */
  readonly caseId: string;
  /** Grouping key for per-cell breakdown (e.g. "RE2:OnlineBoutique"). */
  readonly cell: string;
  /** Ground-truth root-cause service id. */
  readonly truth: string;
  /** Our engine's top-1 prediction, or `undefined` if it produced none. */
  readonly engineTop1: string | undefined;
  /** PRISM's top-1 prediction, or `undefined` if it produced none. */
  readonly prismTop1: string | undefined;
}

/** Aggregate fusion-ceiling counts over a set of cases. */
export interface FusionCeiling {
  /** Number of cases evaluated. */
  readonly total: number;
  /** Cases our engine got right. */
  readonly engineCorrect: number;
  /** Cases PRISM got right. */
  readonly prismCorrect: number;
  /** Cases both engines got right. */
  readonly bothCorrect: number;
  /** Cases only our engine got right. */
  readonly engineOnly: number;
  /** Cases only PRISM got right. */
  readonly prismOnly: number;
  /** Cases neither engine got right. */
  readonly bothWrong: number;
  /** Union of the two correct sets (the perfect-oracle ceiling). */
  readonly union: number;
  /** `union / total`, in [0, 1]. */
  readonly unionRate: number;
}

/** Whether a top-1 prediction matches the ground-truth service. */
function isCorrect(top1: string | undefined, truth: string): boolean {
  return top1 !== undefined && top1 === truth;
}

/**
 * Aggregate the fusion ceiling over a set of per-case predictions.
 *
 * @param records - Per-case predictions from both engines.
 * @returns The aggregate ceiling counts; `unionRate` is 0 for empty input.
 */
export function computeFusionCeiling(records: readonly FusionCasePrediction[]): FusionCeiling {
  let engineCorrect = 0;
  let prismCorrect = 0;
  let bothCorrect = 0;
  let bothWrong = 0;

  for (const r of records) {
    const e = isCorrect(r.engineTop1, r.truth);
    const p = isCorrect(r.prismTop1, r.truth);
    if (e) engineCorrect++;
    if (p) prismCorrect++;
    if (e && p) bothCorrect++;
    if (!e && !p) bothWrong++;
  }

  const total = records.length;
  const engineOnly = engineCorrect - bothCorrect;
  const prismOnly = prismCorrect - bothCorrect;
  const union = bothCorrect + engineOnly + prismOnly;

  return {
    total,
    engineCorrect,
    prismCorrect,
    bothCorrect,
    engineOnly,
    prismOnly,
    bothWrong,
    union,
    unionRate: total > 0 ? union / total : 0,
  };
}

/**
 * Group a set of per-case predictions by their `cell` key and aggregate the
 * fusion ceiling for each cell.
 *
 * @param records - Per-case predictions from both engines.
 * @returns A map from cell key to its ceiling, in first-seen insertion order.
 */
export function computeFusionCeilingByCell(
  records: readonly FusionCasePrediction[],
): ReadonlyMap<string, FusionCeiling> {
  const byCell = new Map<string, FusionCasePrediction[]>();
  for (const r of records) {
    let bucket = byCell.get(r.cell);
    if (!bucket) {
      bucket = [];
      byCell.set(r.cell, bucket);
    }
    bucket.push(r);
  }
  const out = new Map<string, FusionCeiling>();
  for (const [cell, bucket] of byCell) {
    out.set(cell, computeFusionCeiling(bucket));
  }
  return out;
}
