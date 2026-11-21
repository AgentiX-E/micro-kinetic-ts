/**
 * The exact test for an edge's pair-independence, and the multiplicity a map of edges creates.
 *
 * ## Why an exact test rather than a floor
 *
 * `MIN_POPULATION = 10` in `containment-residual.ts` stands in for a p-value with the marginals collapsed to their
 * worst case: "with `n` observations the sampling error of ρ is about `1/√n`". The sentence is right about the
 * scaling and wrong about the constant, because the evidence an edge carries depends on its **margins** as much as
 * on its count. At `n = 10` a balanced edge that couples perfectly is worth `1/C(10,5) = 0.00397`, and an edge
 * whose margins both sit at `0.9` is worth `0.1` at the same coupling and **cannot reach significance at any
 * coupling at all**. A flat floor admits both and refuses neither.
 *
 * ## The test is the permutation test, in closed form
 *
 * Fix the `n` observations of an edge, `a` of which have side a out of band and `b` of which have side b out of
 * band. Under independence the joint count is what you get by permuting the b-indicators among the observations
 * with both margins held fixed, and that permutation distribution is exactly hypergeometric:
 *
 *     X = bothOut ~ Hypergeometric(n, a, b),   P(X = k) = C(a,k)·C(n−a,b−k) / C(n,b)
 *
 * so the one-sided p-value is `P(X ≥ bothOut)`. Enumerating that sum IS the permutation test — a shuffled version
 * would be a Monte Carlo approximation of a number available in closed form, and would report a p-value that moves
 * between identical runs. The sum is therefore taken exactly, in log space, because `C(191,50)` is about 10⁴⁹ and a
 * direct ratio overflows to `NaN` at the very populations this corpus reaches.
 *
 * ## The multiplicity the floor was hiding
 *
 * A floor never had to face the fact that it tests nothing. Testing `m` edges at `α = 0.05` admits about `0.05·m`
 * of them under a global null, so "`p ≤ 0.05`" is not the criterion — a family-wise procedure is. The one fixed
 * here is Benjamini–Hochberg at `q = 0.05`, for reasons that are about this gate rather than about fashion: an
 * admission is a LICENCE to invert one adjacent pair, and a false admission costs one blocked pair, which is
 * counted — not a published falsehood, which would argue for family-wise control. Bonferroni at `m = 64` demands
 * `p ≤ 7.8·10⁻⁴` of the smallest p and would turn the gate into a test of corpus size.
 *
 * The adjusted values are reported rather than the raw p's, because they are what a reader needs: `q` is
 * comparable across maps of different sizes and `p` is not.
 *
 * @module benchmarks/containment-significance
 */

import type { EdgeCounts } from './containment-residual.js';

/** The false-discovery level the gate uses. Fixed by `docs/preregistration-297.md` before any reading. */
export const DEFAULT_LEVEL = 0.05;

/**
 * `log(n!)`, extended on demand.
 *
 * A table rather than a gamma function: the arguments are small integers, the recurrence is exact to the last bit
 * for each step, and it makes the result independent of how any particular `lgamma` implementation rounds.
 */
const LOG_FACTORIALS: number[] = [0];

/** `log(k!)`, growing the table to `k`. */
function logFactorial(k: number): number {
  for (let i = LOG_FACTORIALS.length; i <= k; i++) {
    LOG_FACTORIALS[i] = LOG_FACTORIALS[i - 1]! + Math.log(i);
  }
  return LOG_FACTORIALS[k]!;
}

/**
 * `log C(n, k)`, for `0 ≤ k ≤ n`.
 *
 * The domain is a precondition rather than a guard: every call site derives `k` from the support of the table it
 * is summing, so a check here would be a branch no correct table can reach — and a branch no correct table can
 * reach is not a defence, it is a line that will be reported as untested forever.
 *
 * @param n - The population.
 * @param k - The draw, in `[0, n]`.
 * @returns The log of the binomial coefficient.
 */
function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/** Reject anything that is not a count, before any arithmetic can turn it into a plausible number. */
function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, read ${String(value)}`);
  }
}

/**
 * The one-sided exact p-value of an edge's 2×2 table: `P(X ≥ bothOut)` under hypergeometric `X`.
 *
 * ## The two refusals, and why they are errors rather than `null`
 *
 * A table with `bothOut > min(a,b)`, or with `a + b − bothOut > n`, is not a weak table — it is an impossible one,
 * and the counts that produced it came from an accumulator that lost an observation. Returning a number for it
 * would hide a defect in the caller behind a p-value that looks like evidence.
 *
 * @param n - Observations in which both sides were measured.
 * @param a - Observations in which the first side was out of band.
 * @param b - Observations in which the second side was out of band.
 * @param x - Observations in which both were out of band.
 * @returns The upper tail, in `[0, 1]`.
 * @throws RangeError - If any argument is not a count, or the four cannot describe one table.
 */
export function exactUpperTail(n: number, a: number, b: number, x: number): number {
  assertCount(n, 'n');
  assertCount(a, 'a');
  assertCount(b, 'b');
  assertCount(x, 'x');
  if (a > n) throw new RangeError(`a (${a}) cannot exceed n (${n})`);
  if (b > n) throw new RangeError(`b (${b}) cannot exceed n (${n})`);
  if (x > Math.min(a, b))
    throw new RangeError(`x (${x}) cannot exceed min(a, b) = ${Math.min(a, b)}`);
  if (a + b - x > n) {
    throw new RangeError(`a + b − x = ${a + b - x} cannot exceed n (${n}): no such table exists`);
  }
  // The smallest joint count the margins allow. Asking for a tail from there or below is asking for certainty,
  // and returning it by construction rather than as the sum of the whole distribution keeps the answer exact.
  const supportLow = Math.max(0, a + b - n);
  if (x <= supportLow) return 1;

  const denominator = logChoose(n, b);
  let total = 0;
  for (let k = x; k <= Math.min(a, b); k++) {
    // `x > supportLow` means `b − k ≤ n − a` at every step, so both coefficients below are inside their domain.
    total += Math.exp(logChoose(a, k) + logChoose(n - a, b - k) - denominator);
  }
  // A tail just below 1 can round to just above it, and a p-value outside `[0, 1]` would be refused by the
  // multiplicity step as malformed input; the clamp keeps accumulated rounding from becoming a caller's bug.
  return Math.min(1, total);
}

/**
 * The p-value of one edge, read from the counts the corpus already records.
 *
 * @param counts - One edge's counts, from `edgeCounts` in `containment-residual.ts`.
 * @returns `P(X ≥ bothOut)`, or `null` when nothing was measured — which is not the same as `p = 1`, because an
 * edge nobody observed is absent from the map rather than admitted at chance.
 */
export function independenceP(counts: EdgeCounts): number | null {
  if (counts.measured === 0) return null;
  return exactUpperTail(counts.measured, counts.aOut, counts.bOut, counts.bothOut);
}

/** One hypothesis's raw and adjusted p-value, and the decision the adjusted one carries. */
export interface AdjustedP {
  readonly p: number;
  readonly q: number;
  readonly admitted: boolean;
}

/**
 * Benjamini–Hochberg adjusted p-values, in the order the p-values were given.
 *
 * `q₍ₖ₎ = min_{j ≥ k} (m/j)·p₍ⱼ₎` over the ascending sort, so the adjusted values are non-decreasing in rank by
 * construction rather than by a second pass, and they are capped at 1 because a probability above one is not a
 * stronger refusal. Ties share one adjusted value automatically: `(m/j)·p` falls as `j` grows, so the reverse
 * minimum over a group of equal p's lands on the group's last member and propagates to the whole group. Reporting
 * different `q`'s for equal evidence would make the answer depend on the order the file listed the edges in.
 *
 * @param pValues - Raw p-values, one per hypothesis.
 * @param level - The false-discovery level, in `(0, 1]`.
 * @returns One entry per input position.
 * @throws RangeError - If the level is out of range, or a p-value is not in `[0, 1]`.
 */
export function benjaminiHochberg(
  pValues: readonly number[],
  level: number = DEFAULT_LEVEL,
): AdjustedP[] {
  if (!(level > 0) || level > 1) {
    throw new RangeError(`the false-discovery level must be in (0, 1], read ${String(level)}`);
  }
  for (const p of pValues) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`a p-value must be in [0, 1], read ${String(p)}`);
    }
  }
  const m = pValues.length;
  if (m === 0) return [];

  const order = pValues.map((p, index) => ({ p, index }));
  order.sort((left, right) => left.p - right.p || left.index - right.index);

  const adjusted = Array.from<number>({ length: m });
  let running = 1;
  for (let rank = m - 1; rank >= 0; rank--) {
    const entry = order[rank]!;
    const raw = Math.min(1, (m / (rank + 1)) * entry.p);
    running = Math.min(running, raw);
    adjusted[entry.index] = running;
  }

  return pValues.map((p, index) => ({
    p,
    q: adjusted[index]!,
    admitted: adjusted[index]! <= level,
  }));
}

/** One edge's test, with the key that says which edge it is. */
export interface SignificanceEntry extends AdjustedP {
  /** The canonical unordered key, from `edgeKeyOf`. */
  readonly key: string;
}

/**
 * Test every measurable edge in a count map, and admit the ones that survive the whole map's multiplicity.
 *
 * The map's size IS the multiplicity: an edge is judged against the number of edges that could be tested, so the
 * same table is admitted alone and refused beside 63 nulls. That is the property a population floor cannot have,
 * and the reason this module exists.
 *
 * @param counts - One entry per edge, from `edgeCounts`.
 * @param level - The false-discovery level.
 * @returns One entry per measurable edge, in key order.
 */
export function significanceEntries(
  counts: ReadonlyMap<string, EdgeCounts>,
  level: number = DEFAULT_LEVEL,
): SignificanceEntry[] {
  const keys = [...counts.keys()].sort();
  const tested: { key: string; p: number }[] = [];
  for (const key of keys) {
    const p = independenceP(counts.get(key)!);
    if (p !== null) tested.push({ key, p });
  }
  const adjusted = benjaminiHochberg(
    tested.map((entry) => entry.p),
    level,
  );
  return tested.map((entry, index) => ({ key: entry.key, ...adjusted[index]! }));
}
