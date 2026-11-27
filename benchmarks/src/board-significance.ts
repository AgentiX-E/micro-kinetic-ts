/**
 * Whether a published margin is a margin.
 *
 * ## Why a delta is not a lead
 *
 * `board-metrics.md` §7 measured this engine against RCABench's official leaderboard on all six of its metrics and
 * read strict dominance on every one. One of those six margins is **ten cases out of 1 422** (`Top@5`, this engine
 * `1 282` against `SimpleRCA`'s `1 272`). Ten cases is `0.70 pp`, and on a sample of 1 422 a difference that small
 * is not a finding — it is the shape sampling error takes. The documents said "dominance" because `ours − board`
 * was positive, which is a statement about two point estimates and not about the system behind them.
 *
 * That is the same defect this register has recorded four times in four iterations, one level up: a claim
 * **inferred** from a neighbouring artifact instead of computed from the one that defines it. The number was right
 * and the word attached to it was not, and the word is what a reader carries away.
 *
 * ## The two instruments, and why the choice is forced
 *
 * The board publishes, for every row, its `cases` and each metric to fifteen decimals. It does not publish the
 * per-case files. That single absence decides the statistic:
 *
 * - **`Top@k` is a count.** Nine rows are scored on the same 1 422 cases, so the comparison is a 2 × 2 table with
 *   both margins known and the **exact conditional (Fisher) test** is available — no approximation, no assumption.
 *   It is also the right one at these sizes: the smaller margins in this programme are ten to a few hundred cases,
 *   exactly the region where the normal approximation is the larger error.
 * - **`MRR` and `Avg@k` are means of bounded per-case values** (`1/rank ∈ [0,1]`, `Top@j ∈ {0,1}`). Their
 *   variance depends on the rival's per-case distribution, which is not published, so a t-test would be an
 *   assumption wearing a number. **Hoeffding's inequality** needs only the two means and the two sample sizes and
 *   holds for any joint dependence inside each sample: for `X̄`, `Ȳ` means of `n` values in `[0, 1]`,
 *   `P(|X̄ − Ȳ| ≥ t) ≤ 4·exp(−nt²/2)` under the null. Nothing is assumed, and the bound is what it says it is.
 *
 * The two are reported differently on purpose: Fisher's is an equality (`p = 0.577`), Hoeffding's is an inequality
 * (`p ≤ 8.2e-10`), and a renderer that printed them the same way would be claiming an exactness it does not have.
 *
 * ## The third thing this module answers
 *
 * "How many cases would make the claim true" is more useful than "the claim is not true". {@link requiredExtraHits}
 * inverts the exact test — the smallest number of additional hits that clears `alpha` — so the depth headroom stops
 * being an open-ended project and becomes a target with a denominator. On the published cell it returns **22**,
 * against a measured headroom of 140 cases at ranks 6–49, **80** of them in two HTTP families.
 *
 * ## What it refuses
 *
 * A population of zero; a count outside `[0, cases]`; a mean outside `[0, 1]`; an `alpha` outside `(0, 1)`. And it
 * never takes two different denominators: the 2 × 2 is built from one `cases`, because the board comparison one
 * layer up already refuses two populations and a test that re-admitted them would undo that refusal silently.
 *
 * @module benchmarks/board-significance
 */

/** Which test produced a claim, so a reader knows whether the p-value is an equality or a bound. */
export type ClaimKind = 'fisher-exact' | 'hoeffding-bounded';

/** One metric's margin, with the evidence that it is larger than sampling error. */
export interface MetricClaim {
  /** The instrument. */
  readonly kind: ClaimKind;
  /** `ours − theirs`, on the metric's own scale: a proportion for `Top@k`, a mean for `MRR` and `Avg@k`. */
  readonly delta: number;
  /** The two-sided p-value. An equality for `fisher-exact`, an upper bound for `hoeffding-bounded`. */
  readonly p: number;
  /** The lower end of the 95 % interval on {@link delta}. */
  readonly lower: number;
  /** The upper end of the same interval. */
  readonly upper: number;
  /**
   * `p < alpha`: the difference is larger than sampling error resolves.
   *
   * The sign is {@link delta}'s, not this flag's. `false` does not mean the engine is behind — it means the corpus
   * cannot tell, which is a weaker and more useful statement than either "we lead" or "we trail"; and `true` does
   * not mean the engine is ahead, it means the gap is real and `delta` says which way it points.
   */
  readonly defensible: boolean;
}

/** The two-sided 95 % normal quantile, used only to build the score intervals. */
const Z_95 = 1.959963984540054;

/** `log(n!)`, cached. The largest table this module builds is `2 × cases`, so the cache is short and shared. */
const logFacts: number[] = [0];

/** `log(n!)` for a non-negative integer, memoised across calls. */
function logFactorial(n: number): number {
  for (let index = logFacts.length; index <= n; index++) {
    logFacts.push(logFacts[index - 1]! + Math.log(index));
  }
  return logFacts[n]!;
}

/**
 * `log(n choose k)`.
 *
 * No support guard: its one caller walks `x` over `[max(0, column − n), min(n, column)]`, which is exactly the set
 * of `x` with `0 ≤ x ≤ n` and `0 ≤ column − x ≤ n`. A guard here would be a branch no input can reach, and this
 * repository counts an unreachable branch as a defect in the module rather than as robustness.
 */
function logChoose(n: number, k: number): number {
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

/**
 * `log(exp(a) + exp(b))`, correct when either term is `-Infinity` — `log1p(exp(-Infinity))` is `0`, so the finite
 * term survives — and requiring at least one finite argument, which every hypergeometric log-probability is.
 */
function logAdd(a: number, b: number): number {
  const high = Math.max(a, b);
  return high + Math.log1p(Math.exp(Math.min(a, b) - high));
}

/** Refuse a population that is not a positive integer. */
function casesOf(cases: number, field: string): number {
  if (!Number.isInteger(cases) || cases < 1) {
    throw new Error(`${field}: cases must be a positive integer, got ${String(cases)}`);
  }
  return cases;
}

/** Refuse a count outside the population it is a count of. */
function countOf(count: number, cases: number, field: string): number {
  if (!Number.isInteger(count) || count < 0 || count > cases) {
    throw new Error(`${field}: ${String(count)} is not a count of at most ${String(cases)} cases`);
  }
  return count;
}

/** Refuse a rate or a mean outside `[0, 1]`, which no bounded score can leave. */
function boundedOf(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field}: ${String(value)} is outside [0, 1]`);
  }
  return value;
}

/** Refuse a significance level outside `(0, 1)`. */
function alphaOf(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error(`alpha: ${String(alpha)} is not a significance level in (0, 1)`);
  }
  return alpha;
}

/**
 * The exact two-sided Fisher test on a 2 × 2 table built from two proportions over ONE population.
 *
 * The table is `[[ourHits, n − ourHits], [theirHits, n − theirHits]]`. With both margins fixed, the probability of
 * a table whose first cell is `x` is hypergeometric; the p-value is the total probability of every table no more
 * likely than the observed one — the conventional "sum of small p-values" definition, not the doubled one-sided
 * value, because the latter is not a test of a two-sided alternative when the table is not symmetric.
 *
 * The sum is accumulated in LOG space: at this corpus's sizes the far tail reaches `1e-144` and a linear
 * accumulation would silently return zero, which reads as "impossible" rather than "very unlikely". The exponent
 * is therefore the primitive ({@link fisherLogTwoSided}), because a table of `1 422` against `0` on `1 422` cases
 * has `p = e^−1 967` — a true value no double can hold, so `prob = 0` would be a limit of the arithmetic printed
 * as a property of the world.
 *
 * @param ourHits - This engine's count inside the rung.
 * @param theirHits - The board row's count inside the same rung, on the same cases.
 * @param cases - The shared population.
 * @returns `log` of the two-sided p-value, an equality.
 * @throws Error when `cases` is not a positive integer or either count lies outside `[0, cases]`.
 */
export function fisherLogTwoSided(ourHits: number, theirHits: number, cases: number): number {
  const n = casesOf(cases, 'fisher exact');
  const ours = countOf(ourHits, n, 'fisher exact: our hits');
  const theirs = countOf(theirHits, n, 'fisher exact: their hits');
  const total = 2 * n;
  const column = ours + theirs;
  const logDenominator = logChoose(total, column);
  const logProbability = (x: number): number =>
    logChoose(n, x) + logChoose(n, column - x) - logDenominator;
  const observed = logProbability(ours);
  // The relaxed comparison is the standard guard against a table being excluded from its own p-value by a
  // floating-point difference in the last bit of two log-factorials that are mathematically equal.
  const ceiling = observed + 1e-9;
  let accumulated = Number.NEGATIVE_INFINITY;
  for (let x = Math.max(0, column - n); x <= Math.min(n, column); x++) {
    const value = logProbability(x);
    if (value <= ceiling) accumulated = logAdd(accumulated, value);
  }
  // `accumulated` cannot be `-Infinity` — the observed table always qualifies.
  return accumulated;
}

/**
 * The two-sided exact (Fisher) p-value for two counts over one population.
 *
 * The value, not its logarithm. A table so extreme that `e^log p` is below the smallest positive double returns
 * `0`, and that zero is arithmetic rather than evidence — `proportionClaim` classifies it correctly because a
 * floating-point floor is still far below any significance level, but a reader who wants the exponent itself has
 * {@link fisherLogTwoSided}.
 *
 * @param ourHits - This engine's count inside the rung.
 * @param theirHits - The board row's count inside the same rung, on the same cases.
 * @param cases - The shared population.
 * @returns The two-sided p-value in `[0, 1]`.
 * @throws Error when `cases` is not a positive integer or either count lies outside `[0, cases]`.
 */
export function fisherTwoSided(ourHits: number, theirHits: number, cases: number): number {
  return Math.min(1, Math.exp(fisherLogTwoSided(ourHits, theirHits, cases)));
}

/**
 * The Wilson score interval for one proportion.
 *
 * Used to build {@link newcombeDifference}; reported on its own only through the claim, because the interval a
 * reader wants is the one on the DIFFERENCE.
 *
 * @param hits - The count.
 * @param cases - The population, a positive integer.
 * @param z - The normal quantile, `1.96` for 95 %.
 * @returns `[lower, upper]`, both inside `[0, 1]`.
 * @throws Error when the count is outside `[0, cases]` or the population is not positive.
 */
export function wilson(hits: number, cases: number, z = Z_95): readonly [number, number] {
  const n = casesOf(cases, 'wilson');
  const count = countOf(hits, n, 'wilson: hits');
  const rate = count / n;
  const z2 = z * z;
  const centre = (rate + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n));
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Newcombe's hybrid score interval for the difference of two independent proportions.
 *
 * The interval is the difference plus and minus a square root of the two score-interval arms that point away from
 * it — `√((p₁ − l₁)² + (u₂ − p₂)²)` downward and `√((u₁ − p₁)² + (p₂ − l₂)²)` upward. It is the standard method
 * with coverage close to nominal at these sizes and it never produces an interval that excludes a difference the
 * exact test calls indistinguishable, which is the property that matters here: an interval and a p-value that
 * disagree make a table unreadable.
 *
 * @param ourHits - This engine's count.
 * @param theirHits - The board row's count, on the same cases.
 * @param cases - The shared population.
 * @returns `[lower, upper]` on `ourRate − theirRate`.
 * @throws Error on a count outside `[0, cases]` or a non-positive population.
 */
export function newcombeDifference(
  ourHits: number,
  theirHits: number,
  cases: number,
): readonly [number, number] {
  const n = casesOf(cases, 'newcombe');
  const ours = countOf(ourHits, n, 'newcombe: our hits');
  const theirs = countOf(theirHits, n, 'newcombe: their hits');
  const [ourLow, ourHigh] = wilson(ours, n);
  const [theirLow, theirHigh] = wilson(theirs, n);
  const p1 = ours / n;
  const p2 = theirs / n;
  const delta = p1 - p2;
  return [
    delta - Math.sqrt((p1 - ourLow) ** 2 + (theirHigh - p2) ** 2),
    delta + Math.sqrt((ourHigh - p1) ** 2 + (p2 - theirLow) ** 2),
  ];
}

/**
 * Hoeffding's upper bound on the two-sided p-value for the difference of two bounded means.
 *
 * `P(|X̄ − Ȳ| ≥ t) ≤ 4·exp(−nt²/2)` for `n` values in `[0, 1]` per sample. No normality, no equal variances, no
 * assumption about the shape of either per-case distribution — which is exactly what is needed when one side's
 * per-case file is not published.
 *
 * @param delta - `ours − theirs`, in `[−1, 1]`.
 * @param cases - The shared sample size, a positive integer.
 * @returns A p-value bound in `[0, 1]`; `1` when `delta` is zero.
 * @throws Error on a delta outside `[−1, 1]` or a non-positive population.
 */
export function hoeffdingBound(delta: number, cases: number): number {
  const n = casesOf(cases, 'hoeffding');
  if (!Number.isFinite(delta) || Math.abs(delta) > 1) {
    throw new Error(`hoeffding: delta ${String(delta)} is outside [-1, 1]`);
  }
  return Math.min(1, 4 * Math.exp((-n * delta * delta) / 2));
}

/**
 * The half-width of Hoeffding's confidence interval on a difference of two bounded means.
 *
 * `t = √(2·ln(4/α)/n)`, the inversion of the bound above. Printed beside a mean's delta so the reader sees the
 * resolution the corpus supports: on 1 422 cases at 95 % it is `0.0785`, which is why a mean difference of
 * `0.23` is a finding and one of `0.007` — the `Top@5` margin, were it a mean — would not be.
 *
 * @param cases - The shared sample size, a positive integer.
 * @param alpha - The significance level, in `(0, 1)`.
 * @returns The half-width in the metric's own units.
 * @throws Error on a non-positive population or an alpha outside `(0, 1)`.
 */
export function hoeffdingHalfWidth(cases: number, alpha = 0.05): number {
  const n = casesOf(cases, 'hoeffding half-width');
  return Math.sqrt((2 * Math.log(4 / alphaOf(alpha))) / n);
}

/**
 * Test a count against a count: the board's `Top@k` columns.
 *
 * @param ourHits - This engine's count inside the rung.
 * @param theirHits - The board row's count inside the same rung.
 * @param cases - The shared population.
 * @param alpha - The significance level, in `(0, 1)`.
 * @returns The claim: the exact p, the score interval and whether it clears `alpha`.
 * @throws Error when the counts or the population are not admissible.
 */
export function proportionClaim(
  ourHits: number,
  theirHits: number,
  cases: number,
  alpha = 0.05,
): MetricClaim {
  const level = alphaOf(alpha);
  const p = fisherTwoSided(ourHits, theirHits, cases);
  const [lower, upper] = newcombeDifference(ourHits, theirHits, cases);
  return {
    kind: 'fisher-exact',
    delta: (ourHits - theirHits) / cases,
    p,
    lower,
    upper,
    defensible: p < level,
  };
}

/**
 * Test a mean against a mean: the board's `MRR` and `Avg@k` columns.
 *
 * @param ourMean - This engine's mean.
 * @param theirMean - The board row's mean, on the same cases.
 * @param cases - The shared population.
 * @param alpha - The significance level, in `(0, 1)`.
 * @returns The claim, carrying Hoeffding's bound rather than an exact p.
 * @throws Error when a mean is outside `[0, 1]` or the population is not positive.
 */
export function boundedMeanClaim(
  ourMean: number,
  theirMean: number,
  cases: number,
  alpha = 0.05,
): MetricClaim {
  const level = alphaOf(alpha);
  const ours = boundedOf(ourMean, 'bounded mean: ours');
  const theirs = boundedOf(theirMean, 'bounded mean: theirs');
  const delta = ours - theirs;
  const p = hoeffdingBound(delta, cases);
  const half = hoeffdingHalfWidth(cases, level);
  return {
    kind: 'hoeffding-bounded',
    delta,
    p,
    lower: Math.max(-1, delta - half),
    upper: Math.min(1, delta + half),
    defensible: p < level,
  };
}

/**
 * The smallest number of additional hits that would make the exact test clear `alpha`.
 *
 * This is the question a plan asks. "We lead by ten cases and cannot show it" becomes "twenty-two more cases and
 * we can", and a project target with a denominator is a different object from an ambition.
 *
 * The scan is linear from the observed count rather than a binary search, and the reason is not caution but
 * shape: the two-sided p is **not** monotone in one count. Against a fixed rival it rises as our count approaches
 * theirs, is 1 where they meet, and falls again on the far side — a difference is a difference in either
 * direction, and a binary search on a V-shaped function returns whichever arm the midpoint happened to land in.
 * The linear scan returns the FIRST count that clears the level, which is the smallest number of additional hits
 * and exactly the quantity a plan wants; a test pins the shape at twenty-one points so the claim is measured.
 *
 * @param ourHits - This engine's current count inside the rung.
 * @param theirHits - The board row's count, which is held fixed: it is a published figure, not ours to move.
 * @param cases - The shared population.
 * @param alpha - The significance level, in `(0, 1)`.
 * @returns The number of additional hits, `0` when the claim is already defensible, or `null` when no attainable
 *   count clears `alpha` — a perfect rival row leaves no headroom to win.
 * @throws Error when the counts or the population are not admissible.
 */
export function requiredExtraHits(
  ourHits: number,
  theirHits: number,
  cases: number,
  alpha = 0.05,
): number | null {
  const level = alphaOf(alpha);
  const n = casesOf(cases, 'required extra hits');
  const ours = countOf(ourHits, n, 'required extra hits: our hits');
  countOf(theirHits, n, 'required extra hits: their hits');
  for (let extra = 0; ours + extra <= n; extra++) {
    if (fisherTwoSided(ours + extra, theirHits, n) < level) return extra;
  }
  return null;
}

/**
 * Render a p-value: three decimals for a value a reader can compare, scientific notation for one they cannot.
 *
 * The scientific branch is `toExponential(1)` and nothing else. It used to end in `.replace('e', 'e')`, a
 * no-op replacement that CodeQL reports as an identity rewrite and that a reader cannot tell from an intended
 * normalisation — two spellings of one exponent, `e-71` and `e-071`, would have been the reason for such a call
 * and neither of this engine's formatters produces the second. Removed rather than explained: an expression that
 * computes nothing is a place a future reader will assume something was meant.
 */
function formatPValue(p: number): string {
  if (p >= 0.001) return p.toFixed(3);
  return p.toExponential(1);
}

/**
 * One claim as a reader sees it: the instrument, the value, and whether it cleared the level.
 *
 * The comparator carries the difference between the two instruments. `fisher-exact` prints `=`, because the number
 * is the p-value; `hoeffding-bounded` prints `≤`, because the number is a ceiling and printing it as an equality
 * would overstate what a distribution-free bound delivers.
 *
 * @param claim - The claim.
 * @param alpha - The level it was tested at, so the label can name it.
 * @returns One clause, suitable for appending to a table row.
 */
export function formatClaim(claim: MetricClaim, alpha = 0.05): string {
  const level = alphaOf(alpha);
  const instrument = claim.kind === 'fisher-exact' ? 'Fisher exact' : 'Hoeffding bound';
  const comparator = claim.kind === 'fisher-exact' ? '=' : '≤';
  const verdict = claim.defensible
    ? 'defensible'
    : `NOT distinguishable from zero at ${String(level)}`;
  const interval = `[${(claim.lower * 100).toFixed(2)}, ${(claim.upper * 100).toFixed(2)}] pp`;
  return `p ${comparator} ${formatPValue(claim.p)} (${instrument}), 95 % ${interval} — ${verdict}`;
}

/**
 * The fewest INDEPENDENT cases the claim survives, given how much the corpus's cases are correlated.
 *
 * The exact test conditions on the case count, which is right when the cases are independent draws. Fault injections
 * in a benchmark corpus are not obviously independent — a family of injections sharing a service and a rewrite rule
 * can fail together — and the standard correction is a design effect: a rate's variance under clustering is `D`
 * times the independent-sample variance, with `D = 1 + (m − 1)ρ` for clusters of size `m`. The claim still clears
 * `alpha` when `delta > z·√D·se`, so `D* = (delta / (z·se))²` is the largest inflation it survives and `n / D*` is
 * the smallest effective sample size it holds at.
 *
 * Read it as a FLOOR on how correlated the corpus may be, not as a strength score: the `Top@1` margin holds if the
 * corpus is worth as few as **16** independent cases, and this corpus has **16** fault-type families, so the head
 * conclusion survives even perfect within-family correlation — the most pessimistic model the corpus can support.
 * The `Top@3` margin holds at **59**. The `Top@5` margin holds at no number at all: its `D*` is `0.10`, below one,
 * so it fails on an INDEPENDENT corpus before any correlation is assumed.
 *
 * This is a diagnostic on the NORMAL approximation that shares the exact test's point estimate and null — not a
 * property of the exact p-value, which assumes independence and cannot be repaired by rescaling. It is reported
 * because it converts "significant" into "significant, and here is the clustering that would stop it being so",
 * which is the question a reader of a benchmark table actually has.
 *
 * @param ourHits - This engine's count inside the rung.
 * @param theirHits - The board row's count, on the same cases.
 * @param cases - The shared population.
 * @param alpha - The significance level, in `(0, 1)`.
 * @returns The effective sample size the claim holds at, or `null` when no effective size does — which is the
 *   answer for a margin that fails even with every case independent.
 * @throws Error when the counts or the population are not admissible.
 */
export function minimumIndependentCases(
  ourHits: number,
  theirHits: number,
  cases: number,
  alpha = 0.05,
): number | null {
  const level = alphaOf(alpha);
  const n = casesOf(cases, 'minimum independent cases');
  const ours = countOf(ourHits, n, 'minimum independent cases: our hits');
  const theirs = countOf(theirHits, n, 'minimum independent cases: their hits');
  const p1 = ours / n;
  const p2 = theirs / n;
  const delta = p1 - p2;
  // Equal counts: no margin, so there is no correlation short of zero that would make one.
  if (delta === 0) return null;
  // The normal quantile for the level, so the floor moves with `alpha` rather than being pinned to 95 %.
  const z = normalQuantile(1 - level / 2);
  const variance = (p1 * (1 - p1)) / n + (p2 * (1 - p2)) / n;
  // Two degenerate proportions (one arm at 0, the other at 1) leave no variance to inflate and no correlation that
  // could hide the difference.
  if (variance === 0) return 0;
  const designEffect = (delta / (z * Math.sqrt(variance))) ** 2;
  // A design effect at or below one is the arithmetic saying the claim already fails when the cases are
  // independent, so there is no effective size at which it holds — not a small one, and not the corpus.
  if (designEffect <= 1) return null;
  return Math.min(n, Math.round(n / designEffect));
}

/**
 * The standard normal quantile for `p ∈ (0, 1)`, by bisection on the error function.
 *
 * `Math` has no inverse normal, and pulling a statistics package into a benchmark reader for one number is the kind
 * of dependency this repository keeps refusing. Bisection on a monotone function is exact to the bit after sixty
 * steps and needs no table.
 *
 * @param p - The probability, in `(0, 1)`.
 * @returns The quantile.
 * @throws Error when `p` is outside `(0, 1)`.
 */
export function normalQuantile(p: number): number {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`normal quantile: ${String(p)} is not a probability in (0, 1)`);
  }
  // Abramowitz & Stegun 7.1.26, |ε| < 1.5e-7 — the tolerance the bisection below converges well inside. `erf` takes
  // x, and the √2 in Φ(x) = ½(1 + erf(x/√2)) belongs to the CALLER: folding it into both places is how a quantile
  // comes out √2 too large at one end and √2 too small at the other. It did both, in two consecutive drafts, and the
  // test that compares the answer against 1.96 caught both.
  const errorFunction = (x: number): number => {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * z);
    const poly =
      t *
      (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const value = 1 - poly * Math.exp(-z * z);
    return x < 0 ? -value : value;
  };
  let low = -10;
  let high = 10;
  for (let step = 0; step < 120; step++) {
    const middle = (low + high) / 2;
    if (0.5 * (1 + errorFunction(middle / Math.SQRT2)) < p) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
