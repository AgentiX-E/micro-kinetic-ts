/**
 * A re-scorable census of the first/second score margin.
 *
 * ## Why a module and not a table in `docs/rank-depth.md`
 *
 * §5 of that document records a "calibration curve" of the relative gap `(s₁ − s₂)/|s₁|`: 103 cases below
 * 0.02, 19.4 % accurate, truth twice as often at rank 3 as at rank 2. It was written on 2026-11-20 against an
 * engine that answered 1 141/1 422 cases at rank 1, and it quote-carries no artifact id. When the shipped engine
 * moved to 1 192 rank-1 answers, the curve could be neither re-scored nor refuted — a number with no owner.
 * This module gives the claim one: it reads the scored rows as DATA and returns the histogram, the sub-0.02
 * truth-rank distribution and the twin direction, so a plan built on the curve (item 3's run-off) must read its
 * premise off the artifact instead of asserting it from a document written against a different engine.
 *
 * ## The two confusions pinned here
 *
 * 1. **published order is not score order.** `top1Score`/`top2Score` are the scores of the two candidates the
 *    run PLACED first and second; two relational passes permute a finished list. On the shipped artifact 217 of
 *    1 422 rows carry `top2Score > top1Score`, so their relative gap is negative — not a close call but evidence
 *    of a permutation. `relativeGap` returns the signed value; `bandOf` sends negatives to a sentinel band that
 *    the calibration histogram never mixes with the real bands.
 * 2. **the stratum cutoff has one owner.** `STRATUM_GAP` is the single 0.02. Every consumer — the band edges,
 *    the stratum filter and the tests — reads it, so a cutoff cannot drift between the table and the plan.
 *
 * This module is pure: no IO, no corpus, no clock. It scores whatever rows a caller supplies, which is what makes
 * the old table re-scorable against a new artifact rather than merely re-asserted.
 *
 * @module benchmarks/score-gap-census
 */

/** The sub-0.02 stratum cutoff — the one owner of the number §5's table and item 3's plan both use. */
export const STRATUM_GAP = 0.02;

/**
 * The upper edges of the finite calibration bands, in ascending order. The last band is open (`≥ 0.3`), so it
 * has no finite edge and is represented by the slot AFTER the final edge. `bandOf` therefore returns a value in
 * `[-1, BAND_EDGES.length]`: `-1` is the negative-permutation sentinel, `0..length-1` are the finite bands and
 * `length` is the open top band.
 */
export const BAND_EDGES = [0.005, 0.01, STRATUM_GAP, 0.05, 0.1, 0.3] as const;

/** One scored row: the published pair's scores and the rank the accepted answer actually took. */
export interface ScoredGap {
  readonly top1Score: number;
  readonly top2Score: number;
  /** 1-based rank of the truth, `0` when the pool held none. */
  readonly truthRank: number;
}

/** A row of the band histogram. `accuracy` is `top1 / cases`, `0` for an empty band. */
export interface GapBand {
  readonly label: string;
  readonly cases: number;
  readonly top1: number;
  readonly accuracy: number;
}

/** The truth-rank histogram restricted to the sub-`STRATUM_GAP` band. Index 1..5 are ranks one..five. */
export interface StratumRanks {
  readonly 1: number;
  readonly 2: number;
  readonly 3: number;
  readonly 4: number;
  readonly 5: number;
  /** Ranks beyond five, at or above six. */
  readonly deeper: number;
  /** The truth was absent from the pool (`truthRank === 0`). */
  readonly absent: number;
}

/** The whole re-scorable result. */
export interface GapCensus {
  readonly total: number;
  readonly bands: readonly GapBand[];
  /** Rows whose published pair ran score-wise backwards (`top2Score > top1Score`). */
  readonly negativeGaps: number;
  readonly stratum: {
    readonly cases: number;
    readonly top1: number;
    readonly ranks: StratumRanks;
  };
}

/** Which twin direction the stratum supports, if any. */
export type TwinDirection = 'rank2' | 'rank3' | 'none';

/** The relative gap `(s₁ − s₂)/|s₁|` of the published pair — SIGNED, so a permutation is visible. */
export function relativeGap(row: ScoredGap): number {
  const { top1Score: s1, top2Score: s2 } = row;
  if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
    throw new Error('score-gap: scores must be finite');
  }
  if (s1 === 0) return Number.POSITIVE_INFINITY;
  return (s1 - s2) / Math.abs(s1);
}

/**
 * The band index for a gap: `-1` for a negative (permuted) gap, `0..edges.length-1` for the finite bands and
 * `edges.length` for the open top band. A gap exactly on an edge starts the band at that edge.
 */
export function bandOf(gap: number): number {
  if (!Number.isFinite(gap)) {
    // Infinity is a legitimate top-band value (relativeGap returns it for a zero leader); NaN is not.
    if (Number.isNaN(gap)) throw new Error('score-gap: gap must not be NaN');
    return BAND_EDGES.length;
  }
  if (gap < 0) return -1;
  for (let i = 0; i < BAND_EDGES.length; i += 1) {
    if (gap < BAND_EDGES[i]!) return i;
  }
  return BAND_EDGES.length;
}

/**
 * Human-readable band label, derived from the same edges so a label cannot drift from its bucket. `index` is
 * always in `0..BAND_EDGES.length` here: negative gaps are counted in `negativeGaps` and never rendered as a
 * band, so there is deliberately no `-1` arm to make reachable.
 */
function bandLabel(index: number): string {
  if (index === BAND_EDGES.length) {
    return `[${BAND_EDGES[BAND_EDGES.length - 1]!.toFixed(3)}, inf)`;
  }
  const lo = index === 0 ? 0 : BAND_EDGES[index - 1]!;
  const hi = BAND_EDGES[index]!;
  return `[${lo.toFixed(3)}, ${hi.toFixed(3)})`;
}

/** Mutable accumulator behind the readonly {@link StratumRanks} result. */
interface MutableRanks {
  one: number;
  two: number;
  three: number;
  four: number;
  five: number;
  deeper: number;
  absent: number;
}

function emptyRanks(): MutableRanks {
  return { one: 0, two: 0, three: 0, four: 0, five: 0, deeper: 0, absent: 0 };
}

/** Increment the stratum rank histogram for one in-stratum row. */
function addRank(ranks: MutableRanks, truthRank: number): void {
  if (truthRank === 0) ranks.absent += 1;
  else if (truthRank === 1) ranks.one += 1;
  else if (truthRank === 2) ranks.two += 1;
  else if (truthRank === 3) ranks.three += 1;
  else if (truthRank === 4) ranks.four += 1;
  else if (truthRank === 5) ranks.five += 1;
  else ranks.deeper += 1;
}

/** Build the full census over a set of scored rows. Pure; no artifact is read. */
export function buildCensus(rows: readonly ScoredGap[]): GapCensus {
  const n = BAND_EDGES.length + 1;
  const cases = Array.from({ length: n }, () => 0);
  const top1 = Array.from({ length: n }, () => 0);
  let negativeGaps = 0;
  let stratumCases = 0;
  let stratumTop1 = 0;
  const ranks = emptyRanks();

  for (const row of rows) {
    const gap = relativeGap(row);
    const band = bandOf(gap);
    if (band === -1) {
      negativeGaps += 1;
      continue;
    }
    const isHit = row.truthRank === 1;
    cases[band] = cases[band]! + 1;
    if (isHit) top1[band] = top1[band]! + 1;

    // The stratum is gap < STRATUM_GAP, strictly: a gap exactly on 0.02 is band 2, not the stratum.
    if (gap < STRATUM_GAP) {
      stratumCases += 1;
      if (isHit) stratumTop1 += 1;
      addRank(ranks, row.truthRank);
    }
  }

  const bands: GapBand[] = cases.map((c, i) => ({
    label: bandLabel(i),
    cases: c,
    top1: top1[i]!,
    accuracy: c === 0 ? 0 : top1[i]! / c,
  }));

  const strataRanks: StratumRanks = {
    1: ranks.one,
    2: ranks.two,
    3: ranks.three,
    4: ranks.four,
    5: ranks.five,
    deeper: ranks.deeper,
    absent: ranks.absent,
  };

  return {
    total: rows.length,
    bands,
    negativeGaps,
    stratum: { cases: stratumCases, top1: stratumTop1, ranks: strataRanks },
  };
}

/**
 * The twin direction the stratum supports. Returns `rank3` only when rank 3 strictly outnumbers rank 2 — the
 * §5 premise — and `rank2` when the artifact says the opposite. A tie or an empty stratum supports neither.
 */
export function twinDirection(census: GapCensus): TwinDirection {
  const { 2: r2, 3: r3 } = census.stratum.ranks;
  if (r3 > r2) return 'rank3';
  if (r2 > r3) return 'rank2';
  return 'none';
}
