/**
 * How much of the corpus a RERANKER can reach: the ceiling as a function of what it is shown.
 *
 * Every agentic arm this project has run hands a model some prefix of the engine's ranking and asks it to reorder
 * what it was given. That shape has an accuracy ceiling the model cannot lift, and the ceiling is a property of the
 * WIDTH, not of the model:
 *
 *     ceiling(K) = |{ cases : 1 ≤ rank(truth) ≤ K }| / cases
 *
 * A case whose truth the engine placed at rank 12 cannot be repaired by any reranker shown five candidates, no
 * matter how good the model is. The number is not a forecast; it is arithmetic over the per-case artifact, and it
 * has to be read BEFORE an arm is bought, because an arm measured under a ceiling below the target cannot succeed
 * and its failure says nothing about the model.
 *
 * ## What it is not
 *
 * The ceiling is not "the accuracy a good model reaches". It is the accuracy of a PERFECT reranker, so it is an
 * upper bound and only ever that. The gap between it and a measured arm is the model's error; the gap between it
 * and the benchmark's leader is what no arm at that width can close.
 *
 * ## Why `rank = 0` is a separate statement
 *
 * The per-case artifact writes `truthRank = 0` for a case whose results do not hold the truth at all. That case is
 * unreachable at EVERY width — the candidate a reranker would have to promote is not in the list it is shown —
 * so it is counted as unrecoverable rather than treated as a large rank. Folding it into the maximum would make a
 * corpus with one absent truth read as a corpus needing one more slot.
 *
 * @module benchmarks/presentation-ceiling
 */

/** One width's ceiling. */
export interface CeilingPoint {
  /** How many candidates the reranker is shown, i.e. the width of the presentation. */
  readonly width: number;
  /** Cases whose truth sits at or inside that width. */
  readonly recoverable: number;
  /** `recoverable / cases`, in `[0, 1]`. */
  readonly ceiling: number;
  /** Cases the width cannot reach, i.e. `cases − recoverable`. */
  readonly outOfReach: number;
}

/**
 * Refuse a rank list the per-case artifact could not have written.
 *
 * The artifact's convention is `1`-based with `0` meaning "the results do not hold this truth", so a negative,
 * fractional or non-finite value is a producer defect rather than a corpus fact. Coercing it — rounding, clamping
 * to zero, dropping the row — would silently change the denominator of every ceiling computed from the list, and a
 * denominator that moved without a reader being told is the failure mode this repository's parsers exist to
 * prevent.
 *
 * @param ranks - The truth's rank per case, as the artifact wrote them.
 * @throws RangeError when a rank is not a finite, non-negative integer.
 */
function assertRanks(ranks: readonly number[]): void {
  for (let index = 0; index < ranks.length; index += 1) {
    const rank = ranks[index]!;
    if (!Number.isFinite(rank) || !Number.isInteger(rank) || rank < 0) {
      throw new RangeError(
        `presentation-ceiling: rank at index ${index} is ${String(rank)}; expected a non-negative integer`,
      );
    }
  }
}

/**
 * Sort and de-duplicate the requested widths, refusing the ones a presentation cannot have.
 *
 * Widths arrive from a caller — a CLI ladder, a report's row set — and an unsorted or repeated ladder is a display
 * choice rather than an error, so it is normalised instead of refused. A NEGATIVE or fractional width is refused:
 * "shown 2.5 candidates" is not a presentation, and a module that rounded it would answer a question about a
 * different presentation than the one that was named.
 *
 * @param widths - The requested widths.
 * @returns The widths, ascending, without repeats.
 * @throws RangeError when a width is negative, fractional or not finite.
 */
function normaliseWidths(widths: readonly number[]): number[] {
  for (const width of widths) {
    if (!Number.isFinite(width) || !Number.isInteger(width) || width < 0) {
      throw new RangeError(
        `presentation-ceiling: width ${String(width)}; expected a non-negative integer`,
      );
    }
  }
  return [...new Set(widths)].sort((left, right) => left - right);
}

/**
 * The distribution of the truth's rank, over the cases the results hold.
 *
 * Cases with `rank = 0` are excluded from the histogram and counted separately by {@link presentationCeiling},
 * because they are not a rank this corpus can be read at: they are the absence of one.
 *
 * @param ranks - The truth's rank per case.
 * @returns Rank to case count, ascending by rank; empty when no case was ranked.
 */
export function rankDistribution(ranks: readonly number[]): Map<number, number> {
  assertRanks(ranks);
  const counts = new Map<number, number>();
  for (const rank of ranks) {
    if (rank === 0) continue;
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  return new Map([...counts.entries()].sort((left, right) => left[0] - right[0]));
}

/**
 * The deepest place the truth occupies in any case, or `0` when it is ranked nowhere.
 *
 * This is the smallest width at which the ceiling stops being limited by the presentation, so it is the width a
 * "show everything" dispatch means. It is also the width at which a case with `rank = 0` is still unreachable —
 * the two facts are different and the caller has to hold both, which is why this function returns a width rather
 * than a ceiling.
 *
 * @param ranks - The truth's rank per case.
 * @returns The maximum rank, or `0`.
 */
export function widestRank(ranks: readonly number[]): number {
  assertRanks(ranks);
  let widest = 0;
  for (const rank of ranks) if (rank > widest) widest = rank;
  return widest;
}

/**
 * The ceiling at each requested width.
 *
 * @param ranks - The truth's rank per case; `0` marks a truth the results do not hold.
 * @param widths - The widths to price. Duplicates and order are normalised away.
 * @returns One point per distinct width, ascending. A list with no cases reports `ceiling = 0` at every width,
 * because a fraction of no cases is a statement about nothing and `0` is the only value that cannot be misread as
 * "the reranker fails" — the `cases` field of the caller's report is what distinguishes the two.
 */
export function presentationCeiling(
  ranks: readonly number[],
  widths: readonly number[],
): CeilingPoint[] {
  assertRanks(ranks);
  const cases = ranks.length;
  return normaliseWidths(widths).map((width) => {
    let recoverable = 0;
    for (const rank of ranks) if (rank >= 1 && rank <= width) recoverable += 1;
    return {
      width,
      recoverable,
      ceiling: cases === 0 ? 0 : recoverable / cases,
      outOfReach: cases - recoverable,
    };
  });
}

/**
 * The smallest width whose ceiling reaches a target, or `undefined` when no width can.
 *
 * The search is over `[0, widestRank]` rather than over the caller's ladder, because the question is "what would
 * have to be shown", not "which of the widths I already priced succeeds". A target at or below zero is reached at
 * width `0` — a presentation of nothing recovers nothing, which is exactly the target — and that answer is stated
 * rather than refused so a caller looping over targets does not have to special-case the first one.
 *
 * @param ranks - The truth's rank per case.
 * @param target - The fraction of cases the width must make reachable, in `[0, 1]`.
 * @returns The width, or `undefined` when even `widestRank` falls short; also `undefined` for a target above 1 or
 * a non-finite one, since no presentation makes more than all cases reachable.
 */
export function minimumWidth(ranks: readonly number[], target: number): number | undefined {
  assertRanks(ranks);
  if (!Number.isFinite(target)) return undefined;
  if (target <= 0) return 0;
  if (target > 1) return undefined;
  const cases = ranks.length;
  // A corpus with no cases cannot reach a positive target: `0 / 0` is not a ceiling, and reporting width 0 as the
  // answer would let an empty artifact claim that the target is already met.
  if (cases === 0) return undefined;
  const widest = widestRank(ranks);
  const needed = Math.ceil(target * cases);
  let recoverable = 0;
  const byRank = rankDistribution(ranks);
  for (let width = 1; width <= widest; width += 1) {
    recoverable += byRank.get(width) ?? 0;
    if (recoverable >= needed) return width;
  }
  return undefined;
}
