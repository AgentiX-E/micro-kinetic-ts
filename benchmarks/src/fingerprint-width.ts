/**
 * Which ordering a fingerprint is built from, at a requested width.
 *
 * ## Why this is a function and not three lines inside the runner's loop
 *
 * The flag it serves (`--fingerprint-top-k`) exists to widen an ARTIFACT while leaving the published ranking
 * alone, and that property is the whole scientific content of the arm it prices: a presentation-width arm is
 * only interpretable if the engine's answer, and therefore every number the run reports, is the one it is
 * differenced against. A three-line conditional inside a loop that also builds graphs, ranks them and writes
 * five dumps cannot be driven by a test, and a property nothing can drive is a property nobody can check.
 *
 * So the decision is here, it takes the two orderings a caller already has, and it is answered by a test rather
 * than by a comment.
 *
 * ## The three cases, and why each is not the others
 *
 * - **Narrower than the published width.** A slice, and not a second `analyze`: the published ranking is a total
 *   order cut at the end, so its first `k` rows *are* the engine's answer at width `k`. Re-ranking to obtain them
 *   would be a second pass over the same graph whose equality with the first is assumed rather than guaranteed —
 *   and this file's sibling (`run-fse26.ts`) records that two `analyze` calls over one graph are two orderings
 *   of it.
 * - **Wider.** A real second pass, because the engine has no answer beyond the width it was asked for. This is
 *   the operation the terms dump already performs for the same reason, and it is the only case that costs
 *   anything.
 * - **Exactly the published width.** The published array **itself**, by identity, so the default path is
 *   literally the code path that existed before the flag: not a slice that equals the array, not a re-rank that
 *   should agree with it, but the same object.
 *
 * `0` is "every candidate" — the sentence `--containment-depth` already uses for it — and it resolves to the
 * case's node count for the reason that dump gives: the caller is the only party that knows how many candidates
 * a case has.
 *
 * @module benchmarks/fingerprint-width
 */

import type { RootCauseResult } from '../../packages/kinetic/src/index.js';

/** What a caller has in hand when it asks this question. */
export interface FingerprintWidthInput {
  /**
   * The order the run publishes.
   *
   * Its LENGTH is the width the engine actually reached, which is why no separate "published width" is taken:
   * a case with three nodes answers at three however wide the request was, and a comparison against the nominal
   * five would slice a three-row array against itself and call the result a narrowing.
   */
  readonly published: readonly RootCauseResult[];
  /** How many candidates the fingerprint was asked for. `0` means every candidate. */
  readonly width: number;
  /** How many candidates the case has. Read only when `width` is `0`, and used to clamp the request. */
  readonly nodeCount: number;
  /**
   * Rank the graph again at `k` candidates.
   *
   * Called only when `width` exceeds `publishedWidth`, which is why it is a callback: the narrower cases must not
   * pay for a pass they do not need, and a caller that passed an eager value would pay for it on every case.
   */
  readonly widen: (k: number) => readonly RootCauseResult[];
}

/**
 * Choose the ordering a fingerprint is built from.
 *
 * @param input - The published order, the requested width, and how to widen it.
 * @returns The ordering to fingerprint. Identical to `input.published` when the width is the published one.
 */
export function fingerprintSourceOrder(input: FingerprintWidthInput): readonly RootCauseResult[] {
  const available = Math.max(1, input.nodeCount);
  const asked = input.width === 0 ? available : input.width;
  // Clamped to what the case HAS, so a request wider than the graph is answered off the published order rather
  // than by a pass that can only return that order again.
  const target = Math.min(asked, available);
  if (target === input.published.length) return input.published;
  if (target < input.published.length) return input.published.slice(0, target);
  return input.widen(target);
}
