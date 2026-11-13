/**
 * The budget, certified: what a bound may be claimed to cost once the count is read as a sample rather than a census.
 *
 * The loss ladder prices a condition on the corpus in front of it. That price is an **estimate**, and the difference
 * between an estimate and a guarantee is the difference between a finding and a claim: a family observed losing two
 * cases of a thousand is consistent, at 95 %, with a rate as high as `0.0077` — which is eight cases per thousand,
 * not two. This module states the guarantee and prices it.
 *
 * The statistic is the **Clopper–Pearson upper end**: the smallest loss proportion `p` whose binomial tail
 * `P(X ≤ lost; n, p)` has fallen to the level. It is exact rather than asymptotic, which matters here because the
 * counts are small — two, four, seven — and a normal approximation is worst exactly where this corpus is.
 *
 * The selection rule is conformal risk control over an ordered grid. With a loss that is non-decreasing in the bound,
 * the feasible set is a prefix, so "the widest bound whose worst family is still inside the budget" is the rule, and
 * the level is split across families by a union bound: `δ/F` each. That split is not a detail — splitting one family
 * into two tightens the level each half must clear, so a corpus with more families buys less. That is a property of
 * simultaneous claims rather than of this implementation, and the tests hold it.
 *
 * This module performs no admission of its own. Losses are read from `FrontierPoint.regressed`, which the frontier
 * computed, because a second implementation of "what this bound does" is a second definition of the gate.
 *
 * Two consequences are worth stating before the numbers, because both overturn something a reader would assume:
 *
 *   - **A clean family is not free.** Zero losses of `n` only rules out rates above `−ln δ / n`, so even a corpus
 *     with no regressions at all needs a budget of **three** at 95 % — the rule of three. The standing acceptance
 *     condition ("no regressed fault type") is therefore not certifiable at a budget of zero, at any corpus size.
 *   - **More data does not buy a smaller count.** `n · upper(lost, n)` converges from below to roughly
 *     `lost + z·√lost`, so a family losing two cases is certifiable at seven whatever `n` is. What a larger corpus
 *     buys is a smaller *fraction* given away, not a smaller number of cases.
 *
 * @module benchmarks/risk-control
 */

import type { FrontierPoint, RejectorCase } from './gate-rejector.js';

/** The level a caller that names none is read at. */
export const DEFAULT_DELTA = 0.05;

/**
 * The corpus size the floor is read at.
 *
 * `n · upper(lost, n)` rises with `n` and converges fast — 6.2408 at 245 cases, 6.2863 at 1 422, 6.2958 at a
 * million, all of which ceiling to 7 — so a million cases states the limit to four decimals at a cost of eight terms
 * of the tail. The alternative would be a closed form, and only the zero-loss case has one.
 */
const FLOOR_N = 1_000_000;

/** The population a guarantee is about: how many cases, and which families they fall in. */
export interface RiskPopulation {
  /** Cases in the corpus. */
  readonly n: number;
  /** Every family present, by name. Independent of which bound breaks which — this is the width of the claim. */
  readonly families: readonly string[];
}

/** One family's exposure at one bound. */
export interface FamilyRisk {
  readonly faultType: string;
  /** Cases of this family the bound loses, against the run. */
  readonly lost: number;
  /** The `1 - δ` upper end of the loss proportion, over the whole corpus. */
  readonly upper: number;
}

/** A bound that survives its own interval, and what it answers. */
export interface CertifiedPoint {
  readonly bound: number;
  /** Cases answered, over the whole corpus. */
  readonly cases: number;
  /** `cases` minus the run's own total. */
  readonly delta: number;
  /** The family whose interval binds, with its count and its upper end. */
  readonly worst: FamilyRisk;
}

/** One rung of a certified ladder: a budget, the share of the corpus it permits, and the bound it buys. */
export interface CertifiedRung {
  readonly budget: number;
  /** `budget / n`: the loss proportion the budget demands, which is what the interval must fall below. */
  readonly alpha: number;
  /** The widest point inside the budget, or `null` when no point is. */
  readonly point: CertifiedPoint | null;
}

/**
 * Read a level a caller supplied.
 *
 * A level of zero would demand certainty and a level of one would demand nothing, so both are malformed, and a
 * malformed level is read at {@link DEFAULT_DELTA} rather than at whichever end of the interval the typo named: the
 * end at one would certify every bound the module can express.
 *
 * @param delta - The family-wise level, as supplied.
 * @returns A level strictly inside `(0, 1)`.
 */
function levelOf(delta: number): number {
  return Number.isFinite(delta) && delta > 0 && delta < 1 ? delta : DEFAULT_DELTA;
}

/**
 * `P(X ≤ lost)` for `X ~ Binomial(n, p)`, summed in log space.
 *
 * The pmf is built by recurrence from the zero term rather than from log-gamma values, because the recurrence
 * multiplies ratios of small integers while the gamma route subtracts three numbers of order `n ln n` — at a million
 * cases that subtraction would leave six digits, and a floor read off a six-digit quantile is a floor that can flip.
 *
 * @param lost - The count, which may be any real; values below zero are none and at or above `n` are certainties.
 * @param n - The corpus size.
 * @param p - The rate under test.
 * @returns The left tail, in `[0, 1]`.
 */
export function binomCdfUpTo(lost: number, n: number, p: number): number {
  if (!Number.isFinite(n) || n <= 0) return lost >= 0 ? 1 : 0;
  if (lost < 0) return 0;
  if (lost >= n) return 1;
  // A rate that is not above zero makes every observation certain, and one at or above one makes none below the last
  // case possible. Both ends are read here rather than inside a logarithm, which cannot represent either.
  if (!(p > 0)) return 1;
  if (p >= 1) return 0;
  const logP = Math.log(p);
  const logQ = Math.log1p(-p);
  const terms: number[] = [n * logQ];
  let term = n * logQ;
  for (let index = 0; index < lost; index += 1) {
    term += Math.log((n - index) / (index + 1)) + logP - logQ;
    terms.push(term);
  }
  let largest = Number.NEGATIVE_INFINITY;
  for (const value of terms) if (value > largest) largest = value;
  let total = 0;
  for (const value of terms) total += Math.exp(value - largest);
  return Math.min(1, Math.exp(largest + Math.log(total)));
}

/**
 * The Clopper–Pearson upper end: the smallest rate whose tail has fallen to the level.
 *
 * Solved by bisection on a monotone function rather than by an incomplete-beta inverse, because the tail is the
 * definition and the inverse is a numerical convenience: `exactUpperOf` is checked by plugging its own answer back
 * into {@link binomCdfUpTo} and reading the level off.
 *
 * @param lost - Cases the family lost.
 * @param n - The corpus size.
 * @param delta - The level.
 * @returns The upper end, in `[0, 1]`.
 */
export function exactUpperOf(lost: number, n: number, delta: number): number {
  const level = levelOf(delta);
  if (!Number.isFinite(n) || n <= 0) return 1;
  if (!Number.isFinite(lost)) return 1;
  const count = Math.max(0, Math.floor(lost));
  // Every case lost leaves no rate below one consistent with the observation, so there is no interval to invert.
  if (count >= n) return 1;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 80; step += 1) {
    const mid = (low + high) / 2;
    if (binomCdfUpTo(count, n, mid) > level) low = mid;
    else high = mid;
  }
  return high;
}

/**
 * The population a corpus of cases states: its size and the width of the claim.
 *
 * Families are collected from every case and not only from the ones a bound breaks. A family with no losses still
 * carries an interval, and that interval is what a budget must clear before its owner can say the family is
 * protected; a population read off the regressions would let a corpus certify itself by testing only its failures.
 *
 * @param rows - The cases.
 * @returns The size and the family names, sorted so two runs print the same claim.
 */
export function populationOf(rows: readonly RejectorCase[]): RiskPopulation {
  return { n: rows.length, families: [...new Set(rows.map((row) => row.faultType))].sort() };
}

/**
 * What one bound loses in EVERY family, priced.
 *
 * @param point - The frontier point being certified.
 * @param population - The corpus it was measured on.
 * @param delta - The level, already divided across families when a caller is making simultaneous claims.
 * @returns One entry per family, in the population's order.
 */
export function risksAt(
  point: FrontierPoint,
  population: RiskPopulation,
  delta: number,
): FamilyRisk[] {
  const level = levelOf(delta);
  return population.families.map((faultType) => {
    const regression = point.regressed.find((loss) => loss.faultType === faultType);
    const lost = regression === undefined ? 0 : -regression.delta;
    return { faultType, lost, upper: exactUpperOf(lost, population.n, level) };
  });
}

/**
 * Every point of the grid, with its families priced and its binding family named.
 *
 * The binding family is the one with the largest upper end, which is the number a budget has to clear; a tie goes to
 * the family that lost more cases, so the table names the family that is actually in trouble rather than the first one
 * alphabetically.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param delta - The family-wise level.
 * @returns One entry per point, in the grid's order.
 */
function pricedOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  delta: number,
): { point: FrontierPoint; risks: FamilyRisk[]; worst: FamilyRisk }[] {
  const level = levelOf(delta);
  const families = population.families.length;
  // Simultaneity is bought with the level: F families each held to δ is not a claim at δ, so each is held to δ/F. With
  // no families there is no claim to split and the level stands.
  const perFamily = families > 0 ? level / families : level;
  return frontier.map((point) => {
    const risks = risksAt(point, population, perFamily);
    let worst = risks[0]!;
    for (const risk of risks) {
      if (risk.upper > worst.upper || (risk.upper === worst.upper && risk.lost > worst.lost)) {
        worst = risk;
      }
    }
    return { point, risks, worst };
  });
}

/** The cheapest budget that certifies anything, and the point it certifies. */
export interface ThresholdPoint {
  readonly budget: number;
  readonly point: CertifiedPoint;
}

/**
 * The smallest budget at this level that certifies any point of the grid.
 *
 * A caller's ladder is a set of questions, and every one of them can come back empty for a reason that has nothing to
 * do with the grid: the level may be split across so many families that no rung on it is wide enough. That is not the
 * same finding as "the statistic buys nothing", and it is not visible from the rungs, so the answer is computed
 * instead of inferred: this is `ceil(n · worst upper)` minimised over the grid, which is the budget below which no
 * point exists at all.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param delta - The family-wise level.
 * @returns The cheapest certifiable budget and its point, earliest on a tie; `null` for a corpus with no claim.
 */
export function thresholdOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  delta: number,
): ThresholdPoint | null {
  if (population.n <= 0 || population.families.length === 0) return null;
  let best: ThresholdPoint | null = null;
  for (const entry of pricedOf(population, frontier, delta)) {
    const budget = Math.ceil(population.n * entry.worst.upper);
    const point: CertifiedPoint = {
      bound: entry.point.bound,
      cases: entry.point.cases,
      delta: entry.point.delta,
      worst: entry.worst,
    };
    if (
      best === null ||
      budget < best.budget ||
      (budget === best.budget && point.cases > best.point.cases)
    ) {
      best = { budget, point };
    }
  }
  return best;
}

/**
 * The best point whose every family clears the budget, with the interval that admitted it.
 *
 * "Clears" means the whole upper end sits at or below `budget / n`, not the observed count: a point is certified when
 * the data cannot rule out the budget, not when the data agrees with it. Ties go to the point answering more cases,
 * which is the rule every other reader in this repository uses, so two tables of the same corpus cannot disagree
 * about which point they describe.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param budgets - The rungs, read at zero when malformed.
 * @param delta - The family-wise level.
 * @returns One rung per budget, in the order given.
 */
export function certifyOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  budgets: readonly number[],
  delta: number,
): CertifiedRung[] {
  const families = population.families.length;
  const priced = pricedOf(population, frontier, delta);
  // A claim needs something to be about. With no cases there is no corpus and with no families there is nothing to hold
  // to the level, and an empty `every` would otherwise certify every bound in the grid for a corpus that is not there.
  const claims = population.n > 0 && families > 0;
  return budgets.map((supplied) => {
    const budget = Number.isFinite(supplied) && supplied > 0 ? supplied : 0;
    const alpha = claims ? budget / population.n : 0;
    let best: CertifiedPoint | null = null;
    for (const entry of claims ? priced : []) {
      if (!entry.risks.every((risk) => risk.upper <= alpha)) continue;
      const candidate: CertifiedPoint = {
        bound: entry.point.bound,
        cases: entry.point.cases,
        delta: entry.point.delta,
        worst: entry.worst,
      };
      if (best === null || candidate.cases > best.cases) best = candidate;
    }
    return { budget, alpha, point: best };
  });
}

/**
 * The smallest budget any corpus size can certify a family that loses `lost` cases.
 *
 * This is the number that says whether the corpus or the statistic is the constraint, and the answer is the
 * statistic: `n · upper(lost, n)` converges to a constant in `n`, so a family losing two cases is certifiable at
 * seven however many cases are collected. A larger corpus buys a smaller share of itself given away, not a smaller
 * number of cases.
 *
 * @param lost - Cases the family lost.
 * @param delta - The level.
 * @returns The ceiling of the limit of `n · upper`, which is at least one above the count itself.
 */
export function floorOf(lost: number, delta: number): number {
  const level = levelOf(delta);
  const count = Number.isFinite(lost) ? Math.max(0, Math.floor(lost)) : 0;
  return Math.ceil(FLOOR_N * exactUpperOf(count, FLOOR_N, level));
}

/** Render a signed count the way the rest of the repository's tables do. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

/** Describe the point a rung certifies, in the words the footer uses. */
function describePoint(point: CertifiedPoint): string {
  return (
    `reach < ${point.bound.toFixed(3)} answers ${point.cases} (${signed(point.delta)}), worst family ` +
    `${point.worst.faultType} loses ${point.worst.lost} (upper ${point.worst.upper.toFixed(6)})`
  );
}

/**
 * Render a certified ladder.
 *
 * @param rungs - The rungs, from {@link certifyOf}.
 * @param n - The corpus size.
 * @param delta - The family-wise level.
 * @param families - How many families the level was split across.
 * @param threshold - The cheapest certifiable budget, from {@link thresholdOf}; printed only when the ladder itself
 * certifies nothing, so a table that is empty for the size of its own rungs says so instead of reading as a refusal.
 * @returns The report text.
 */
export function formatCertified(
  rungs: readonly CertifiedRung[],
  n: number,
  delta: number,
  families: number,
  threshold: ThresholdPoint | null = null,
): string {
  const share = families > 0 ? ` (${(levelOf(delta) / families).toFixed(6)} each)` : '';
  const lines = [
    `n ${n}   delta ${levelOf(delta)}   families ${families}${share}`,
    '',
    '  budget    alpha   bound   cases   delta  worst            lost     upper',
  ];
  for (const rung of rungs) {
    const head = `${String(rung.budget).padStart(7)}  ${rung.alpha.toFixed(5)}`;
    if (rung.point === null) {
      lines.push(`${head}  no bound  —  —  —  —  —`);
      continue;
    }
    lines.push(
      `${head}  ${rung.point.bound.toFixed(3)}  ${String(rung.point.cases).padStart(5)}  ` +
        `${signed(rung.point.delta).padStart(5)}  ${rung.point.worst.faultType.padEnd(15)}  ` +
        `${String(rung.point.worst.lost).padStart(4)}  ${rung.point.worst.upper.toFixed(6)}`,
    );
  }
  // The cheapest rung is tracked as a point rather than as a rung, so the footer has one thing to check rather than a
  // rung whose point is a second, redundant one.
  let cheapest: { budget: number; point: CertifiedPoint } | null = null;
  for (const rung of rungs) {
    if (rung.point === null) continue;
    if (cheapest === null || rung.budget < cheapest.budget) {
      cheapest = { budget: rung.budget, point: rung.point };
    }
  }
  lines.push('');
  if (cheapest !== null) {
    lines.push(`cheapest certifiable: ${cheapest.budget} — ${describePoint(cheapest.point)}`);
  } else if (threshold !== null) {
    lines.push(
      `no rung on this ladder certifies; the smallest budget that does is ${threshold.budget} — ` +
        describePoint(threshold.point),
    );
  } else {
    lines.push('cheapest certifiable: none — no budget on this ladder certifies a bound');
  }
  return lines.join('\n');
}
