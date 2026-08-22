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
 * represented in each split (subject to integer rounding). The split is
 * exhaustive and disjoint: every item lands in exactly one bucket.
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
