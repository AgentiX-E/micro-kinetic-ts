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

import type { FrontierPoint } from './gate-rejector.js';

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

/**
 * Cases one family loses under whatever is being priced.
 *
 * The ledger form is the primitive: a frontier point's losses, a screen row's losses and a hand-written vector all
 * reduce to this, so the claim has one input rather than one per instrument that asks for it.
 */
export interface LossCount {
  readonly faultType: string;
  readonly lost: number;
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
export function populationOf(rows: readonly { readonly faultType: string }[]): RiskPopulation {
  return { n: rows.length, families: [...new Set(rows.map((row) => row.faultType))].sort() };
}

/**
 * The losses a frontier point carries, in ledger form.
 *
 * @param point - The point.
 * @returns One entry per family the point regressed, in the frontier's order.
 */
export function lossesOf(point: FrontierPoint): LossCount[] {
  return point.regressed.map((loss) => ({ faultType: loss.faultType, lost: -loss.delta }));
}

/**
 * The families a claim covers: the population's, plus any a ledger names and the population does not.
 *
 * A ledger that names a family outside the population means the caller's population is wrong, and the claim has to
 * widen rather than drop the loss: a certificate that ignores a regression it was handed is a certificate about a
 * different corpus. The population's order comes first so two claims about one corpus print their families alike; the
 * extras are appended in sorted order for the same reason.
 *
 * @param losses - The ledger.
 * @param population - The corpus.
 * @returns The families, in a stable order.
 */
function familiesOf(losses: readonly LossCount[], population: RiskPopulation): string[] {
  const known = new Set(population.families);
  const extras = [...new Set(losses.map((loss) => loss.faultType))].filter(
    (faultType) => !known.has(faultType),
  );
  return extras.length === 0
    ? [...population.families]
    : [...population.families, ...extras.sort()];
}

/**
 * What a ledger loses in EVERY family the claim covers, priced.
 *
 * @param losses - The ledger.
 * @param population - The corpus it was measured on.
 * @param delta - The level, already divided across families when a caller is making simultaneous claims.
 * @returns One entry per family, in the order {@link familiesOf} states.
 */
export function risksOf(
  losses: readonly LossCount[],
  population: RiskPopulation,
  delta: number,
): FamilyRisk[] {
  const level = levelOf(delta);
  return familiesOf(losses, population).map((faultType) => {
    const loss = losses.find((entry) => entry.faultType === faultType);
    const lost = loss === undefined ? 0 : Math.max(0, loss.lost);
    return { faultType, lost, upper: exactUpperOf(lost, population.n, level) };
  });
}

/**
 * The family a budget has to clear.
 *
 * The largest upper end is what the budget must fall below; a tie goes to the family that lost more cases, so a table
 * names the family that is actually in trouble rather than the first one alphabetically.
 *
 * @param risks - The priced families, from {@link risksOf}.
 * @returns The binding family.
 */
export function worstOf(risks: readonly FamilyRisk[]): FamilyRisk {
  let worst = risks[0]!;
  for (const risk of risks) {
    if (risk.upper > worst.upper || (risk.upper === worst.upper && risk.lost > worst.lost)) {
      worst = risk;
    }
  }
  return worst;
}

/** What one bound loses in every family, priced. Kept as the frontier's own way into {@link risksOf}. */
export function risksAt(
  point: FrontierPoint,
  population: RiskPopulation,
  delta: number,
): FamilyRisk[] {
  return risksOf(lossesOf(point), population, delta);
}

/** The rule that decides whether a vector of family readings supports the claim. */
export type Correction = 'union' | 'holm';

/**
 * The number of looks a level is paid for.
 *
 * A claim about the best of `M` candidates has to pay for the `M` looks that named it, and a malformed count is read as
 * one look — the same direction as {@link levelOf}, and for the same reason: zero looks is a selection nobody made, and
 * dividing by it would certify every claim the module can express.
 *
 * @param examined - The count, as supplied.
 * @returns A positive integer.
 */
function examinedOf(examined: number | undefined): number {
  if (examined === undefined || !Number.isFinite(examined) || examined < 1) return 1;
  return Math.floor(examined);
}

/**
 * Every point of the grid, with its families priced and its binding family named.
 *
 * The level each family is held to depends on the correction: a union bound holds every family to `δ/F`, while Holm's
 * step-down lets the least extreme family be read at `δ` itself. The priced interval follows the rule rather than the
 * other way round, so the number printed next to a rung is the number that rung had to clear.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param delta - The family-wise level.
 * @param correction - The rule the level is split by.
 * @param examined - How many candidates the selection looked at, which the level pays for.
 * @returns One entry per point, in the grid's order.
 */
function pricedOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  delta: number,
  correction: Correction,
  examined: number,
): { point: FrontierPoint; risks: FamilyRisk[]; worst: FamilyRisk }[] {
  const level = levelOf(delta) / examinedOf(examined);
  const families = population.families.length;
  // Simultaneity is bought with the level, and how much it costs depends on the rule: a union bound holds every family
  // to δ/F, Holm holds the least extreme one to δ. With no families there is no claim to split and the level stands.
  const perFamily = families > 0 && correction === 'union' ? level / families : level;
  return frontier.map((point) => {
    const risks = risksOf(lossesOf(point), population, perFamily);
    return { point, risks, worst: worstOf(risks) };
  });
}

/**
 * `P(X ≤ lost)` for every family, at one candidate budget's rate.
 *
 * This is the tail whose inversion {@link exactUpperOf} solves, read the other way round: at a fixed rate, the tail is
 * the p-value of "this family's loss rate is at most the budget", and it is what both corrections compare against.
 *
 * @param losses - The ledger.
 * @param population - The corpus it was measured on.
 * @param alpha - The rate the budget permits.
 * @returns One probability per family, in the order {@link familiesOf} states.
 */
function psFrom(losses: readonly LossCount[], population: RiskPopulation, alpha: number): number[] {
  return familiesOf(losses, population).map((faultType) => {
    const loss = losses.find((entry) => entry.faultType === faultType);
    return binomCdfUpTo(loss === undefined ? 0 : Math.max(0, loss.lost), population.n, alpha);
  });
}

/**
 * Whether a vector of family readings supports "every family is inside this budget".
 *
 * Both rules reject a family when its tail falls to the level it is read at, and both are exact at finite `n`. They
 * differ in what "its level" means: the union bound pays `δ/F` for every family, which is valid and loose; Holm's
 * step-down sorts the tails and pays `δ/(F−i+1)` for the `i`-th smallest, which is valid at the same level and never
 * more expensive, because the evidence that a clean family is clean is spent on the families that are not.
 *
 * Holm's guarantee is a family-wise error rate, so rejecting every family at its own step is exactly the claim this
 * module makes: if all `F` are rejected at level `δ`, then with probability at least `1 − δ` every family's rate is
 * inside the budget. The ordering is what buys the tighter level — a step-down procedure is allowed to test the least
 * extreme hypothesis at the full level because reaching it required rejecting every other one first.
 *
 * @param ps - The tails, from {@link psOf}.
 * @param delta - The family-wise level.
 * @param correction - The rule.
 * @returns Whether the claim holds.
 */
function supports(ps: readonly number[], delta: number, correction: Correction): boolean {
  // No families is no claim: an empty `every` would otherwise certify every bound in the grid for a corpus that is not
  // there, which is the defect the first version of this module shipped and a test caught.
  if (ps.length === 0) return false;
  if (correction === 'holm') {
    const sorted = [...ps].sort((left, right) => left - right);
    return sorted.every((p, index) => p <= delta / (sorted.length - index));
  }
  const level = delta / ps.length;
  return ps.every((p) => p <= level);
}

/** The cheapest budget that certifies anything, and the point it certifies. */
export interface ThresholdPoint {
  readonly budget: number;
  readonly point: CertifiedPoint;
}

/** A claim that holds: the budget it holds at, the families it covers, and the one that binds. */
export interface CertifiedClaim {
  /** The smallest per-family loss the corpus cannot refute at this level. */
  readonly budget: number;
  /** Every family's exposure at that budget, extras from the ledger included. */
  readonly risks: readonly FamilyRisk[];
  /** The family the budget had to clear. */
  readonly worst: FamilyRisk;
}

/**
 * The smallest budget at which one ledger's claim holds.
 *
 * The claim only gets easier as the budget grows — a wider budget raises the permitted rate, which lowers every tail —
 * so the smallest such budget is found by bisection rather than by scanning a corpus-sized range. `ceil(n · upper)` is
 * the same number for the union bound and is not the same number for Holm, which is why this is computed by the rule
 * the caller asked for rather than by one formula.
 *
 * This is the one place a claim about a set of counts is decided, so every reader of the module — the frontier's
 * ladder, and the screen's rows — prices its losses through it. A second implementation would be a second definition of
 * "certifiable", and two instruments that price the same losses differently is the defect the module exists to prevent.
 *
 * @param losses - The ledger: how many cases each family loses, any families not listed being clean.
 * @param population - The corpus it was measured on.
 * @param delta - The family-wise level.
 * @param correction - The rule the level is read under.
 * @param examined - How many candidates the selection looked at, which the level pays for; one by default.
 * @returns The claim, or `null` for a corpus that cannot state one at any budget.
 */
export function certifyLosses(
  losses: readonly LossCount[],
  population: RiskPopulation,
  delta: number,
  correction: Correction = 'union',
  examined = 1,
): CertifiedClaim | null {
  // A population with no families is not a corpus, and a ledger cannot stand in for one: its families would be the only
  // width the claim pays for, so an understated population would buy a narrower claim by saying less. Both halves of
  // that guard are needed — an empty `every` certifies every budget, and an empty population licenses the empty `every`.
  if (!Number.isFinite(population.n) || population.n <= 0) return null;
  if (population.families.length === 0) return null;
  const families = familiesOf(losses, population);
  const level = levelOf(delta) / examinedOf(examined);
  const holds = (budget: number): boolean =>
    supports(psFrom(losses, population, budget / population.n), level, correction);
  let low = 0;
  let high = Math.ceil(population.n);
  // A claim no budget supports is a claim about a corpus that is not there, which is `null` rather than the corpus's
  // own size: the ceiling of the range is the last budget that could ever hold, and it is checked rather than assumed.
  if (!holds(high)) return null;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (holds(mid)) high = mid;
    else low = mid + 1;
  }
  const perFamily = correction === 'union' ? level / families.length : level;
  const risks = risksOf(losses, population, perFamily);
  return { budget: low, risks, worst: worstOf(risks) };
}

/**
 * The smallest budget at this level that certifies any point of the grid.
 *
 * A caller's ladder is a set of questions, and every one of them can come back empty for a reason that has nothing to
 * do with the grid: the level may be split across so many families that no rung on it is wide enough. That is not the
 * same finding as "the statistic buys nothing", and it is not visible from the rungs, so the answer is computed
 * instead of inferred.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param delta - The family-wise level.
 * @param correction - The rule the level is read under.
 * @param examined - How many candidates a reader looked at before naming this one; one when the point was named in
 * advance, which is what a caller that passes nothing is claiming.
 * @returns The cheapest certifiable budget and its point, earliest on a tie; `null` for a corpus with no claim.
 */
export function thresholdOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  delta: number,
  correction: Correction = 'union',
  examined = 1,
): ThresholdPoint | null {
  if (population.n <= 0 || population.families.length === 0) return null;
  let best: ThresholdPoint | null = null;
  for (const entry of pricedOf(population, frontier, delta, correction, examined)) {
    const claim = certifyLosses(lossesOf(entry.point), population, delta, correction, examined);
    if (claim === null) continue;
    const point: CertifiedPoint = {
      bound: entry.point.bound,
      cases: entry.point.cases,
      delta: entry.point.delta,
      worst: entry.worst,
    };
    if (
      best === null ||
      claim.budget < best.budget ||
      (claim.budget === best.budget && point.cases > best.point.cases)
    ) {
      best = { budget: claim.budget, point };
    }
  }
  return best;
}

/**
 * The best point whose every family clears the budget, with the interval that admitted it.
 *
 * "Clears" means the claim holds at the whole interval, not at the observed count: a point is certified when the data
 * cannot rule out the budget, not when the data agrees with it. Ties go to the point answering more cases, which is
 * the rule every other reader in this repository uses, so two tables of the same corpus cannot disagree about which
 * point they describe.
 *
 * @param population - The corpus the points were measured on.
 * @param frontier - The points.
 * @param budgets - The rungs, read at zero when malformed.
 * @param delta - The family-wise level.
 * @param correction - The rule the level is read under; the union bound by default, which is the conservative one.
 * @param examined - How many rungs a reader will look at before taking one; the level pays for them. One by default.
 * @returns One rung per budget, in the order given.
 */
export function certifyOf(
  population: RiskPopulation,
  frontier: readonly FrontierPoint[],
  budgets: readonly number[],
  delta: number,
  correction: Correction = 'union',
  examined = 1,
): CertifiedRung[] {
  const level = levelOf(delta) / examinedOf(examined);
  const priced = pricedOf(population, frontier, delta, correction, examined);
  return budgets.map((supplied) => {
    const budget = Number.isFinite(supplied) && supplied > 0 ? supplied : 0;
    // A corpus with no cases has no rate to state, and a rate of zero would refuse every point anyway; `supports` is the
    // one place that decides a claim without families cannot be made.
    const alpha = population.n > 0 ? budget / population.n : 0;
    let best: CertifiedPoint | null = null;
    for (const entry of priced) {
      if (!supports(psFrom(lossesOf(entry.point), population, alpha), level, correction)) continue;
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
 * Read at `δ` rather than at `δ/F`, because it bounds the cost of a COUNT rather than the cost of a simultaneous claim:
 * the multiplicity a caller pays is a property of its population, and `pricedOf` is where it is applied.
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
 * @param population - The corpus the rungs were certified on.
 * @param delta - The family-wise level.
 * @param correction - The rule the level was read under, printed because a budget without its rule cannot be compared
 * with another budget.
 * @param threshold - The cheapest certifiable budget, from {@link thresholdOf}; printed only when the ladder itself
 * certifies nothing, so a table that is empty for the size of its own rungs says so instead of reading as a refusal.
 * @returns The report text.
 */
export function formatCertified(
  rungs: readonly CertifiedRung[],
  population: RiskPopulation,
  delta: number,
  correction: Correction = 'union',
  threshold: ThresholdPoint | null = null,
): string {
  const families = population.families.length;
  const share = families > 0 ? ` (${(levelOf(delta) / families).toFixed(6)} each)` : '';
  const lines = [
    `n ${population.n}   delta ${levelOf(delta)}   families ${families}${share}   correction ${correction}`,
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
