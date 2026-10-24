/**
 * Stratified train/validation/test split.
 *
 * A scientifically sound L2 weight search must never tune and evaluate on the
 * same cases — doing so fits the weights to the benchmark's idiosyncrasies and
 * overstates generalization. This module provides a deterministic, stratified
 * split: cases are partitioned by a caller-supplied stratum key (e.g.
 * `system + faultType`) so each split preserves the stratum distribution, and
 * a seeded PRNG makes the assignment reproducible.
 *
 * @module optimize/split
 */

// ── Types ─────────────────────────────────────────────────

export interface SplitRatios {
  /** Fraction assigned to training (∈ (0, 1)). */
  readonly train: number;
  /** Fraction assigned to validation (∈ [0, 1)). */
  readonly val: number;
  /** Fraction assigned to held-out test (∈ [0, 1)). */
  readonly test: number;
}

export interface SplitResult<T> {
  readonly train: readonly T[];
  readonly val: readonly T[];
  readonly test: readonly T[];
}

// ── Seeded PRNG (mulberry32) ──────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic in-place Fisher–Yates shuffle. */
function shuffle<T>(items: T[], rng: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
}

/**
 * Allocate a stratum of size `n` into (train, val, test) counts via the
 * largest-remainder method so the counts sum to exactly `n` and honour
 * `ratios` as closely as possible. Test receives the remainder, guaranteeing
 * the split is exhaustive regardless of rounding.
 *
 * ## The guarantee is weaker than "proportional", and the difference is a boundary
 *
 * `Math.round` is what decides a SMALL stratum, and rounding up is what makes the promise fail: at 70/15/15,
 * a stratum of one case gives `Math.round(0.7 × 1) = 1` to train and NOTHING to either held-out split, and a
 * stratum of five gives `Math.round(5 × 0.15) = 1` to validation and leaves test at zero. So a stratum is
 * represented in both held-out splits only from
 * {@link minimumStratumSizeForHeldOutCoverage} cases upward, and this function's callers — including the L2
 * weight search, whose corpus has 44 strata of which most are smaller than that — are the ones who have to
 * decide what to do about it.
 */
function allocateCounts(n: number, ratios: SplitRatios): [number, number, number] {
  const total = ratios.train + ratios.val + ratios.test;
  const rawTrain = (n * ratios.train) / total;
  const rawVal = (n * ratios.val) / total;
  // test takes the rest — no rounding drift.
  const train = Math.round(rawTrain);
  const val = Math.round(rawVal);
  const clampedTrain = Math.min(train, n);
  const clampedVal = Math.min(Math.max(0, val), n - clampedTrain);
  return [clampedTrain, clampedVal, n - clampedTrain - clampedVal];
}

// ── Implementation ────────────────────────────────────────

/**
 * Split `items` into train/validation/test, stratified by `keyOf`.
 *
 * Each stratum (unique key) is independently shuffled with the seeded PRNG and
 * assigned to the three buckets so that every stratum is proportionally
 * represented in each split **to the extent its SIZE allows** — see
 * {@link minimumStratumSizeForHeldOutCoverage}: below that size a stratum lands
 * entirely (or almost entirely) in training, which is arithmetic rather than a
 * defect, and a caller that reports a held-out number is the one who must say
 * which strata that number is missing. The split is exhaustive and disjoint:
 * every item lands in exactly one bucket.
 *
 * @param items - Items to split (not mutated).
 * @param keyOf - Maps an item to its stratum key (items with the same key stay
 *                grouped so each split preserves their relative share).
 * @param ratios - Target fractions; `train + val + test` should be 1.
 * @param seed - PRNG seed for reproducibility.
 */
export function stratifiedSplit<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  ratios: SplitRatios,
  seed = 0,
): SplitResult<T> {
  const total = ratios.train + ratios.val + ratios.test;
  if (total <= 0) {
    throw new RangeError('split ratios must sum to a positive value');
  }
  if (ratios.train <= 0) {
    throw new RangeError('train ratio must be positive');
  }
  if (ratios.val < 0 || ratios.test < 0) {
    throw new RangeError('val and test ratios must be non-negative');
  }

  // Group by stratum key, preserving first-seen order.
  const strata = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    let bucket = strata.get(key);
    if (!bucket) {
      bucket = [];
      strata.set(key, bucket);
    }
    bucket.push(item);
  }

  const train: T[] = [];
  const val: T[] = [];
  const test: T[] = [];
  const rng = mulberry32(seed);

  for (const bucket of strata.values()) {
    const shuffled = [...bucket];
    shuffle(shuffled, rng);

    const [trainCount, valCount, testCount] = allocateCounts(shuffled.length, ratios);
    for (let i = 0; i < trainCount; i++) train.push(shuffled[i]!);
    for (let i = 0; i < valCount; i++) val.push(shuffled[trainCount + i]!);
    for (let i = 0; i < testCount; i++) test.push(shuffled[trainCount + valCount + i]!);
  }

  return { train, val, test };
}

/**
 * The smallest stratum size at which BOTH held-out splits get at least one case, for `ratios`.
 *
 * Derived by RUNNING {@link stratifiedSplit} upwards, not by solving the rounding on paper: a closed form
 * here would be a second implementation of `allocateCounts`, free to disagree with it, and this value's whole
 * purpose is to describe what the splitter actually does. The experiment is cheap (a few hundred calls on
 * one-element corpora) and it is what a caller needs before claiming a held-out number means what it says.
 *
 * At 70/15/15 the answer is 6, and the boundary below it is where a corpus's held-out coverage quietly goes
 * missing: a 1-case stratum lands entirely in training, and a 5-case stratum reaches validation and leaves
 * test at zero.
 *
 * @param ratios - The split ratios to describe.
 * @param limit - The largest stratum size worth searching; beyond it the answer is not a boundary anyone acts on.
 * @returns The minimum size, or `-1` when no size qualifies — which is what `val: 0` produces, since no
 *          stratum size can populate a split that was not asked for.
 */
export function minimumStratumSizeForHeldOutCoverage(ratios: SplitRatios, limit = 512): number {
  for (let n = 1; n <= limit; n++) {
    const items = Array.from({ length: n }, (_, i) => i);
    const split = stratifiedSplit(items, () => 'stratum', ratios, 0);
    if (split.val.length > 0 && split.test.length > 0) return n;
  }
  return -1;
}

/**
 * How many cases full held-out coverage would cost, given a stratum count.
 *
 * The arithmetic is {@link minimumStratumSizeForHeldOutCoverage} times the number of strata — and it exists
 * because the two numbers are printed in different places while their PRODUCT is the thing that decides a
 * sampling decision. A corpus of 44 strata capped at 200 cases cannot give every stratum a presence in both
 * held-out splits, whatever the sampling objective: `44 × 6 = 264`, and no rearrangement of 200 cases reaches
 * it. A reader who has both numbers still has to multiply them, and a reader who multiplies the wrong pair
 * (the boundary for `val` alone, say) gets a plausible answer to a different question.
 *
 * @param strata - How many distinct strata the corpus has.
 * @param ratios - The split ratios the coverage would be measured under.
 * @returns The case count required, or `0` when nothing is required — no strata, or a ratio set that asks for
 *          no held-out split, in which case a positive answer would be a claim about a split that cannot exist.
 */
export function requiredCasesForHeldOutCoverage(strata: number, ratios: SplitRatios): number {
  const minimum = minimumStratumSizeForHeldOutCoverage(ratios);
  if (minimum === -1 || strata <= 0) return 0;
  return strata * minimum;
}
