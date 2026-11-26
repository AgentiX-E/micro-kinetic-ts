/**
 * The dual-family membership's four cells — which candidate the flag paid, and whether that was the right one.
 *
 * `benchmarks/src/dual-family-census.ts` already answers "how WIDE is the family"; it reports a density and a truth
 * share. Iteration 364 needed the other question: of the Hard bucket's 76 misses, 15 were decided by `dualFamily`,
 * and a weight sweep on those 15 came back as a swap (+0.6 pp overall for TrainTicket −3 cases). A swap has two
 * possible causes and they call for different work — a MISPRICED term has one value that pays everywhere, a MIS-FIRED
 * one selects the wrong components at every price — and the density cannot tell them apart, because a family can be
 * narrow and correct or wide and wrong.
 *
 * The distinction is a joint property of the two candidates a miss is about:
 *
 * | winner paid | truth paid | reading |
 * | --- | --- | --- |
 * | yes | yes | the flag cannot separate them; it is FLAT on this case and its price is irrelevant |
 * | yes | **no** | the flag EXCLUDED the truth and paid the winner — the only cell where the membership can cause a miss |
 * | **no** | yes | the flag found the truth and not the symptom — the cell the term was designed for |
 * | no | no | the flag did not fire |
 *
 * ## The two readings the cells license, and the one they do not
 *
 * A grid alone would leave a reader unable to say whether the harmful cell is repairable, so it travels with
 * {@link gapToFlip}: the extra weight the SAME membership would need to put the truth first. `flipBudget` splits the
 * harmful cell by that number, and the split is what makes "5 of 15" a measurement rather than a coincidence — those
 * are the cases one weight change actually flips, and the rest are cases the term touches but does not decide.
 *
 * What the cells do NOT license is a re-derivation of the membership. Every count here is read from the ranking's own
 * `dualFamily` row, the same array the correctness checks are counted from, because a second implementation of
 * `min(Sⁱ, Sᵉ) ≥ gate × max` would disagree with the engine on exactly the cases the reading is about.
 *
 * @module benchmarks/dual-family-membership
 */

import type { ScoreTerm } from '../../packages/core/src/types/faults.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** The term's name in the breakdown, as the formula spells it. */
const TERM = 'dualFamily';

/** One candidate as the engine ranked it. */
export interface FlagCandidate {
  readonly serviceId: string;
  /** The exact value the engine sorted by — `finalScore`, or `confidence` for a producer that sets only that. */
  readonly score: number;
  /** The candidate's `dualFamily` contribution — `0` when it is not a member. */
  readonly dual: number;
  /** Whether the flag paid this candidate. */
  readonly member: boolean;
}

/** One case, reduced to what the membership question needs. */
export interface FlagCase {
  readonly caseId: string;
  /** The cell it belongs to, as `<system>/<category>`. */
  readonly cell: string;
  /** Every service the corpus accepts as the root cause; `[0]` is the truth these readings use. */
  readonly accepted: readonly string[];
  /** The ranking, best first. */
  readonly order: readonly FlagCandidate[];
}

/** The four membership cells over one population. */
export interface MembershipGrid {
  /** The flag paid the winner and the truth alike, so it cannot separate them. */
  readonly bothIn: number;
  /** The flag paid the winner and NOT the truth — the only cell in which the membership can cause the miss. */
  readonly winnerOnly: number;
  /** The flag paid the truth and not the winner — the cell the term exists for. */
  readonly truthOnly: number;
  /** The flag paid neither. */
  readonly neither: number;
  /** Cases whose truth the engine never ranked, so membership is unanswerable rather than false. */
  readonly truthAbsent: number;
}

/** What the flag did to one population. */
export interface MembershipReading {
  readonly cases: number;
  /** Cases with an EMPTY family, i.e. the flag could not participate at all. */
  readonly emptyFamilies: number;
  /**
   * The LOWER median of the family sizes, taken over the cases with a non-empty family, and `0` when there are none.
   *
   * The lower median rather than the average of the middle two: a family size is a count of real candidates, and a
   * median of `3.5` would be a number no case in the population has. An even-sized population is reported as its
   * smaller middle observation, which is what a reader can check against a case.
   */
  readonly medianMembers: number;
  readonly hits: MembershipGrid & { readonly cases: number };
  readonly misses: MembershipGrid & { readonly cases: number };
  /**
   * Of the cases whose WINNER is a member, the share where the truth is one too.
   *
   * `NaN` when no winner is a member. A share over an empty population is not a zero, and a zero here would read as
   * "the flag always excludes the truth" — the opposite of what an unmeasured population says.
   */
  readonly precision: number;
}

/** A zero row for one population. */
function emptyGrid(): MembershipGrid & { cases: number } {
  return { cases: 0, bothIn: 0, winnerOnly: 0, truthOnly: 0, neither: 0, truthAbsent: 0 };
}

/** The term's row in a candidate's breakdown, if it carries one. */
function dualOf(terms: readonly ScoreTerm[] | undefined): number {
  const term = terms?.find((one) => one.name === TERM);
  return term?.contribution ?? 0;
}

/**
 * Read one runner record as a membership case.
 *
 * The score is `finalScore` when the producer set it and `confidence` otherwise — the pruner is the only producer that
 * sets both, and `confidence` folds in the propagation-depth and error-bound penalties, so substituting it silently
 * would measure a different ordering. `finalScore` is the exact value the sort used, which is what a flip gap is a gap
 * in.
 *
 * @param record - The record the runner handed over.
 * @param cell - The cell it belongs to, as `<system>/<category>`.
 * @returns The case; `accepted` is the corpus's own list, so a multi-service label is read rather than truncated.
 */
export function toFlagCase(record: DiagnosedCaseRecord, cell: string): FlagCase {
  const accepted = record.case.groundTruth.serviceIds ?? [record.case.groundTruth.serviceId];
  return {
    caseId: record.case.id,
    cell,
    accepted: [...accepted],
    order: record.ranking.map((one) => {
      const dual = dualOf(one.terms);
      return {
        serviceId: one.serviceId,
        score: one.finalScore ?? one.confidence,
        dual,
        member: dual > 0,
      };
    }),
  };
}

/**
 * Whether a case's first-ranked candidate is one the corpus accepts.
 *
 * @param one - The case.
 * @returns Whether the ranking's head is an accepted root cause.
 */
export function isHit(one: FlagCase): boolean {
  const top = one.order[0];
  return top !== undefined && one.accepted.includes(top.serviceId);
}

/**
 * Add one case to a grid.
 *
 * A truth the engine never ranked is counted in `truthAbsent` and in no other cell: a truth that was never offered to
 * the flag has no membership answer, and filing it as `neither` would report an absence as a measured exclusion.
 *
 * @param grid - The grid to extend; mutated.
 * @param winnerIn - Whether the flag paid the winner.
 * @param truthIn - Whether the flag paid the truth, or `undefined` when it was never ranked.
 */
function charge(
  grid: MembershipGrid & { cases: number },
  winnerIn: boolean,
  truthIn: boolean | undefined,
): void {
  grid.cases += 1;
  if (truthIn === undefined) {
    (grid as { truthAbsent: number }).truthAbsent += 1;
    return;
  }
  if (winnerIn && truthIn) (grid as { bothIn: number }).bothIn += 1;
  else if (winnerIn) (grid as { winnerOnly: number }).winnerOnly += 1;
  else if (truthIn) (grid as { truthOnly: number }).truthOnly += 1;
  else (grid as { neither: number }).neither += 1;
}

/**
 * Count the four cells over the hits and the misses separately.
 *
 * The two populations are kept apart because the SAME cell means opposite things in them. On a MISS, `winnerOnly` is
 * the flag excluding the truth and paying a symptom, which is the only cell in which membership causes the loss; on a
 * HIT it is unreachable for a single-label case, because a hit's winner IS the truth — so a non-zero count there is a
 * corruption check rather than a finding. `truthOnly` is the mirror: on a miss it says the flag found the truth and
 * the rest of the score outvoted it, and on a hit it is reachable only when the corpus accepts several services and
 * the winner is one of the others.
 *
 * @param cases - The population.
 * @returns The reading; `hits.cases + misses.cases` equals `cases`, and `emptyFamilies` is a property of a case
 *   rather than a cell of the grid.
 */
export function readMembership(cases: readonly FlagCase[]): MembershipReading {
  const hits = emptyGrid();
  const misses = emptyGrid();
  const sizes: number[] = [];
  let emptyFamilies = 0;

  for (const one of cases) {
    const top = one.order[0];
    const truth = one.accepted[0];
    const members = one.order.filter((candidate) => candidate.dual > 0).length;
    if (members === 0) emptyFamilies += 1;
    else sizes.push(members);

    const winnerIn = top !== undefined && top.dual > 0;
    const truthRow = truth === undefined ? undefined : one.order.find((c) => c.serviceId === truth);
    // `undefined` rather than `false` for the absent case: `find` returning nothing means the truth was never ranked,
    // and collapsing that to `false` would count an unanswerable case as a measured exclusion.
    const truthIn = truthRow === undefined ? undefined : truthRow.dual > 0;

    charge(isHit(one) ? hits : misses, winnerIn, truthIn);
  }

  const considered = hits.bothIn + hits.winnerOnly + misses.bothIn + misses.winnerOnly;
  sizes.sort((a, b) => a - b);
  return {
    cases: cases.length,
    emptyFamilies,
    medianMembers: sizes.length === 0 ? 0 : sizes[Math.floor((sizes.length - 1) / 2)]!,
    hits,
    misses,
    precision: considered === 0 ? Number.NaN : (hits.bothIn + misses.bothIn) / considered,
  };
}

/**
 * The total weight on this membership that would put the truth first.
 *
 * The flag pays each member `dual`, so repricing it to a total weight `W` moves the winner by `(W / shipped − 1) ×
 * dual_w`. Writing `dᵢ ∈ {0, 1}` for membership, the truth overtakes exactly when
 *
 * > `W × (d_truth − d_winner) > score_winner − score_truth`
 *
 * so the answer exists only where the winner is a member and the truth is not — the harmful cell. Everywhere else the
 * flag either moves both alike (`d` equal, no weight can close anything) or already helps the truth, and returning a
 * number there would report a repair the axis cannot make.
 *
 * @param one - The case.
 * @returns The total weight needed, or `undefined` when no weight on this membership flips the case.
 */
export function weightToFlip(one: FlagCase): number | undefined {
  if (isHit(one)) return undefined;
  const top = one.order[0];
  const truth = one.accepted[0];
  if (top === undefined || truth === undefined) return undefined;
  const truthRow = one.order.find((c) => c.serviceId === truth);
  if (truthRow === undefined) return undefined;
  const perUnit = (truthRow.member ? 1 : 0) - (top.member ? 1 : 0);
  if (perUnit >= 0) return undefined;
  return (top.score - truthRow.score) / -perUnit;
}

/** How the harmful cell splits against one weight. */
export interface FlipBudget {
  /** Cases in the harmful cell, i.e. the ones the membership can be blamed for. */
  readonly harmful: number;
  /** Of those, the ones a total weight at or below `weight` already covers — turning the term off flips them. */
  readonly withinWeight: number;
  /** Of those, the ones it does not cover: the flag touches them and does not decide them. */
  readonly beyondWeight: number;
  /** The weights needed, ascending; empty when the flag harmed nothing. */
  readonly gaps: readonly number[];
}

/**
 * Split the harmful cell by whether the weight it needs is inside the current one.
 *
 * @param cases - The population.
 * @param weight - The bonus one membership is worth today.
 * @returns The split; `withinWeight + beyondWeight` equals `harmful` by construction.
 */
export function flipBudget(cases: readonly FlagCase[], weight: number): FlipBudget {
  const gaps: number[] = [];
  for (const one of cases) {
    if (isHit(one)) continue;
    const top = one.order[0];
    const truth = one.accepted[0];
    if (top === undefined || truth === undefined || !top.member) continue;
    const truthRow = one.order.find((c) => c.serviceId === truth);
    if (truthRow === undefined || truthRow.member) continue;
    // In the harmful cell the membership difference is exactly `-1` (the winner is paid, the truth is not), so
    // `weightToFlip`'s division is by one and the weight needed IS the score gap. Computing it here rather than
    // calling through keeps a `needed !== undefined` guard out of the loop — a guard no input can reach, because the
    // two `continue`s above already established every precondition that function checks.
    gaps.push(top.score - truthRow.score);
  }
  gaps.sort((a, b) => a - b);
  const within = gaps.filter((gap) => gap <= weight).length;
  return { harmful: gaps.length, withinWeight: within, beyondWeight: gaps.length - within, gaps };
}

/** One reprice arm. */
export interface RepriceArm {
  readonly weight: number;
  /** `CA@1` over the whole population. */
  readonly overall: number;
  /** Per cell, `<system>/<category>` → `CA@1`. */
  readonly cells: ReadonlyMap<string, number>;
  /** The per-case verdicts, in the population's own order, so two arms can be compared case by case. */
  readonly correct: readonly boolean[];
}

/**
 * Re-rank every case with the flag repriced, holding the MEMBERSHIP fixed.
 *
 * The engine's `dualFamilyWeight` is non-negative by contract, so a negative arm — "a member is a symptom, discount
 * it" — cannot be produced by a command line. It can still be priced on a reading, and the difference is stated
 * rather than hidden: a negative arm here measures the axis, it is not a configuration the engine accepts.
 *
 * @param cases - The population.
 * @param weight - The bonus to give each member.
 * @param shipped - The weight the scores were produced with; the arm moves the bonus by the DIFFERENCE.
 * @returns The arm's score, its cells and its per-case verdicts.
 */
export function reprice(cases: readonly FlagCase[], weight: number, shipped = 0.25): RepriceArm {
  const cells = new Map<string, [number, number]>();
  const correct: boolean[] = [];
  for (const one of cases) {
    const rescored = one.order.map((candidate, index) => ({
      serviceId: candidate.serviceId,
      score: candidate.score + (candidate.member ? weight - shipped : 0),
      index,
    }));
    // Stable in the engine's own order: a reprice that broke a tie by service id would report a movement that is the
    // comparator's rather than the weight's, and this file's predecessor shipped exactly that defect once.
    rescored.sort((a, b) => b.score - a.score || a.index - b.index);
    const head = rescored[0];
    const ok = head !== undefined && one.accepted.includes(head.serviceId);
    correct.push(ok);
    const cur = cells.get(one.cell) ?? [0, 0];
    cur[0] += ok ? 1 : 0;
    cur[1] += 1;
    cells.set(one.cell, cur);
  }
  return {
    weight,
    overall: cases.length === 0 ? Number.NaN : correct.filter(Boolean).length / cases.length,
    cells: new Map([...cells].map(([key, [hit, total]]) => [key, hit / total])),
    correct,
  };
}

/** What one arm did to the population, as counts rather than rates. */
export interface ArmMovement {
  readonly gained: number;
  readonly lost: number;
  /** Exact two-sided McNemar p over the paired counts. */
  readonly p: number;
}

/**
 * Compare two arms case by case.
 *
 * @param base - The engine's own verdicts.
 * @param arm - The arm's verdicts, in the same order.
 * @returns The counts and the exact McNemar p, or `undefined` when the two are not the same population — a paired test
 *   over two different case sets is not a test.
 */
export function movementOf(
  base: readonly boolean[],
  arm: readonly boolean[],
): ArmMovement | undefined {
  if (base.length !== arm.length) return undefined;
  let gained = 0;
  let lost = 0;
  for (let index = 0; index < base.length; index += 1) {
    if (arm[index] === base[index]) continue;
    if (arm[index] === true) gained += 1;
    else lost += 1;
  }
  return { gained, lost, p: mcnemarExact(gained, lost) };
}

/**
 * The exact two-sided McNemar p.
 *
 * Exact rather than the chi-square approximation because the discordant counts here are single digits, which is
 * exactly the regime where the approximation is not valid.
 *
 * @param gained - Cases the arm fixed.
 * @param lost - Cases the arm broke.
 * @returns The p value, `1` when there is no discordant pair.
 */
export function mcnemarExact(gained: number, lost: number): number {
  const n = gained + lost;
  if (n === 0) return 1;
  const k = Math.min(gained, lost);
  let tail = 0;
  // Iterative binomial coefficients: `C(n,i) = C(n,i-1) × (n-i+1)/i`, kept in floating point because the largest
  // term is 2^n and `Math.comb` over 1 000 cases would overflow a long before the ratio did.
  let coefficient = 1;
  for (let i = 0; i <= k; i += 1) {
    if (i > 0) coefficient = (coefficient * (n - i + 1)) / i;
    tail += coefficient;
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}
