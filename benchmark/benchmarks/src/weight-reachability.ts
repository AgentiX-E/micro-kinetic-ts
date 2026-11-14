/**
 * The reachability of a case under the weight vector: whether ANY weight vector could rank its answer first.
 *
 * ## The theorem this module computes
 *
 * A candidate's score is `Σᵢ wᵢ · paidᵢ(v)` — a linear functional of the candidate's own paid vector. Write
 * `a` for the accepted candidate's vector and `V` for the others'. If `a` lies in the convex hull of `V`, say
 * `a = Σᵢ λᵢ vᵢ` with `λ` on the simplex, then for EVERY `w`
 *
 *     w·a = Σᵢ λᵢ (w·vᵢ) ≤ maxᵢ (w·vᵢ)
 *
 * so some other candidate scores at least as high and `a` cannot be STRICTLY first. Conversely, if `a` is
 * outside that hull, the separating hyperplane theorem hands a `w` with `w·(a − vᵢ) > 0` for every `i`, and that
 * `w` ranks `a` first. Reachability is therefore not a search over weights: it is a convex-hull membership
 * question, and it has a yes/no answer per case that no amount of sweeping can improve on.
 *
 * This is why the axis needed this module rather than another grid. `docs/term-weight-landscape.md` swept 28
 * single-term points and `docs/weight-resolution-floor.md` swept 84 more; both are samples of a space whose
 * exact boundary was never computed, and a sample that finds nothing says only that the sampled points were
 * empty. The hull decides every case at once, with a certificate.
 *
 * ## Why both verdicts come with a witness
 *
 * A verdict is only worth as much as the reader's ability to check it, so neither side is reported as "the
 * solver said so":
 *
 * - `separable` carries the weight vector, and the module RE-RANKS the case with it before reporting. A witness
 *   that does not actually put the answer first is not a witness, and the case falls through to `undecided`
 *   rather than being counted.
 * - `in-hull` carries the combination, and the module reconstructs `a` from it. A combination whose residual
 *   exceeds {@link COMBINATION_TOLERANCE} proves nothing about the hull and the case is `undecided` too.
 *
 * The linear program is a PROPOSER, not an authority: every number it returns is substituted back into the
 * definition and either survives or is refused. That is the same fence `term-weight-screen.ts` puts around the
 * score identity, for the same reason — a solver that is wrong in the last digit must not be able to publish a
 * promoted case.
 *
 * ## Why one program answers both questions
 *
 * Maximise the margin `t` subject to `(vᵢ − a)·w + t ≤ 0` and `|w| ≤ 1`. At the optimum `t > 0` iff a separator
 * exists, and when it does the `w` at the optimum IS the separator. At `t = 0` the dual multipliers on the case
 * rows are a non-negative combination of `vᵢ − a` summing to zero — the hull certificate — because the dual's
 * constraint on the `t` column forces `Σ yᵢ ≥ 1` and the box columns force the combination to cancel. So one
 * tableau yields both witnesses, and a second solve for the hull is avoided.
 *
 * @module benchmarks/weight-reachability
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { PreparedCase, PreparedCorpus } from './term-weight-screen.js';

/**
 * Which space the weight vector is read in.
 *
 * `slope` is the whole weight space: a candidate's score under any `w` is `Σᵢ wᵢ · slopeᵢ(v)`, so a direction in
 * slope space IS a weight vector, and a term the formula ships at zero is a dimension the direction may turn on.
 *
 * `paid` freezes the SUPPORT: the vectors are the `weight × slope` columns the formula actually pays, so a
 * direction only re-weights the terms that already carry weight. A term at zero stays at zero. The two spaces
 * answer different questions — "is any weight vector enough" against "is any re-weighting of the terms that pay
 * enough" — and the difference between their ceilings is the cost of the support, which is a property of the
 * formula rather than of the corpus.
 */
export type WeightBasis = 'slope' | 'paid';

/** One case, with the name order its vectors were built on. */
export interface ReachCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly accepted: ReadonlySet<string>;
  /** Candidate ids in the dump's order, so index order IS the engine's tie-break. */
  readonly ids: readonly string[];
  /** The term names, in the order every vector below is laid out on. */
  readonly names: readonly string[];
  readonly vectors: readonly Float64Array[];
}

/** What a case's answer is worth under the whole weight dimension. */
export type ReachKind = 'hit' | 'separable' | 'in-hull' | 'undecided';

/** One case's verdict. */
export interface ReachReading {
  readonly datapack: string;
  readonly faultType: string;
  readonly kind: ReachKind;
  /** The accepted candidate the verdict is about, or `null` for a hit. */
  readonly answer: string | null;
  /** For `separable`: the weight vector that ranks the answer first, by term name. */
  readonly witness: Readonly<Record<string, number>> | null;
  /** For `separable`: the smallest gap the witness opens over any competitor, in score units. */
  readonly margin: number | null;
  /** For `in-hull`: the coefficients that rebuild the answer out of its competitors, by candidate id. */
  readonly combination: Readonly<Record<string, number>> | null;
}

/** The population's reading. */
export interface ReachReport {
  readonly cases: number;
  readonly hits: number;
  readonly separable: number;
  readonly inHull: number;
  readonly undecided: number;
  /** `hits + separable`: every case some weight vector can answer, counted once. */
  readonly ceiling: number;
}

/** One fault family's reachability, which is what says WHERE the headroom is. */
export interface FamilyReach {
  readonly faultType: string;
  readonly cases: number;
  readonly hits: number;
  readonly separable: number;
  readonly inHull: number;
  readonly undecided: number;
  /** `hits + separable` over `cases`. */
  readonly ceiling: number;
}

/** What one linear program returns. A solve that did not finish throws rather than returning one of these. */
export interface MaximiseResult {
  /** The objective at the optimum. */
  readonly value: number;
  /** The primal solution, one entry per structural column. */
  readonly solution: Float64Array;
  /** The dual price on each row, which is a certificate BECAUSE the optimum was reached. */
  readonly duals: Float64Array;
}

/** The linear program's own answer, before any verification. */
interface MarginSolve {
  /** The optimal margin; `0` when no separator exists. */
  readonly margin: number;
  /** The separating direction, or `null` when the margin is not positive. */
  readonly direction: Float64Array | null;
  /** The multipliers on the case rows: a hull combination when the margin is zero. */
  readonly multipliers: Float64Array;
}

/** A weight vector below this margin is a tie, and a tie is not a separation. */
const MARGIN_TOLERANCE = 1e-9;

/** How far a combination may miss the answer before it proves nothing about the hull. */
const COMBINATION_TOLERANCE = 1e-9;

/** A pivot is only allowed on a coefficient above this, so a degenerate row cannot cycle on noise. */
const PIVOT_TOLERANCE = 1e-12;

/**
 * Solve `max c·x` subject to `A x ≤ b`, `x ≥ 0`, for `b ≥ 0` — the only shape this file needs.
 *
 * Bland's rule on both ends (smallest entering index, smallest leaving basis index on a ratio tie) rather than
 * Dantzig's: the constraint right-hand sides here are mostly zero, which is exactly the degenerate case that
 * makes the largest-coefficient rule cycle, and a solver that can cycle is a solver whose verdict depends on how
 * long it was allowed to run.
 *
 * ## Why an unfinished solve throws
 *
 * Bland's rule is safe but slow: it removes one negative reduced cost per pivot and prefers the lowest index, so a
 * program whose right-hand sides are zero crawls through degenerate vertices. This function therefore carries a
 * pivot budget, and a program large enough can exhaust it. When that happens the tableau is still FEASIBLE but no
 * longer provably optimal, and a caller that reads the value as an optimum — or the duals as a certificate — is
 * reading an unfinished computation. Until iteration 276 the budget was silent, and that is exactly how a measurer
 * lies: a 592-row program returned a point whose `‖w‖₁` was 10.9 against a box that said 1, with no signal that
 * anything had gone wrong, and the number was read as "the gate cannot be cleared". It now throws, so a verdict
 * that depends on an optimum cannot be published from a solve that never reached one.
 *
 * Exported because the solver's contract is worth pinning on its own: the reachability verdicts are only as good
 * as this tableau, and a caller that reads the duals has to know what they are the duals OF.
 *
 * @param objective - `c`, the coefficients being maximised.
 * @param rows - `A`, one constraint per row.
 * @param rhs - `b`, one right-hand side per row; each must be non-negative for the slack basis to be feasible.
 * @param budget - The largest number of pivots to take; the default is computed from the program's size. A finite
 * value exists so a test can pin the exhaustion path deterministically.
 * @returns The value, the primal solution and the dual prices on the rows.
 * @throws When the program is unbounded, which no caller in this file can construct — the margin is boxed.
 * @throws When the pivot budget is exhausted before an optimum is reached, because a partial tableau is not an
 * answer and returning one is how a solver lies.
 */
export function maximise(
  objective: readonly number[],
  rows: readonly (readonly number[])[],
  rhs: readonly number[],
  budget?: number,
): MaximiseResult {
  const width = objective.length;
  const height = rows.length;
  // One slack per row plus the right-hand side: the tableau is small enough that the dense form is the clear one.
  const columns = width + height + 1;
  const table: Float64Array[] = [];
  for (let row = 0; row < height; row += 1) {
    const line = new Float64Array(columns);
    for (let column = 0; column < width; column += 1) line[column] = rows[row]![column]!;
    line[width + row] = 1;
    line[columns - 1] = rhs[row]!;
    table.push(line);
  }
  const objectiveRow = new Float64Array(columns);
  for (let column = 0; column < width; column += 1) objectiveRow[column] = -objective[column]!;
  table.push(objectiveRow);
  const basis: number[] = [];
  for (let row = 0; row < height; row += 1) basis.push(width + row);

  // Every pivot removes one negative reduced cost and Bland's rule bounds how often that can happen; the cap is a
  // guard against a numerical tie the rule cannot see, not a budget the method is expected to reach at the sizes
  // this file solves. A caller that hands in a bigger program can raise it.
  const limit = budget ?? 200 * (height + width) + 1000;
  let converged = false;
  for (let step = 0; step < limit; step += 1) {
    let entering = -1;
    for (let column = 0; column < width + height; column += 1) {
      if (table[height]![column]! < -PIVOT_TOLERANCE) {
        entering = column;
        break;
      }
    }
    if (entering < 0) {
      converged = true;
      break;
    }
    let bestRatio = Infinity;
    for (let row = 0; row < height; row += 1) {
      const coefficient = table[row]![entering]!;
      if (coefficient <= PIVOT_TOLERANCE) continue;
      bestRatio = Math.min(bestRatio, table[row]![columns - 1]! / coefficient);
    }
    // Bland's tie-break, as a second pass: among the rows that achieve the ratio, the smallest basis index leaves.
    // A single pass cannot express it, because the winner is only known once every ratio has been seen.
    let leaving = -1;
    for (let row = 0; row < height; row += 1) {
      const coefficient = table[row]![entering]!;
      if (coefficient <= PIVOT_TOLERANCE) continue;
      if (table[row]![columns - 1]! / coefficient > bestRatio + 1e-15) continue;
      if (leaving < 0 || basis[row]! < basis[leaving]!) leaving = row;
    }
    if (leaving < 0) throw new Error('the program is unbounded');
    const pivotRow = table[leaving]!;
    const pivot = pivotRow[entering]!;
    for (let column = 0; column < columns; column += 1)
      pivotRow[column] = pivotRow[column]! / pivot;
    for (let row = 0; row <= height; row += 1) {
      if (row === leaving) continue;
      const factor = table[row]![entering]!;
      if (factor === 0) continue;
      const line = table[row]!;
      for (let column = 0; column < columns; column += 1)
        line[column] = line[column]! - factor * pivotRow[column]!;
    }
    basis[leaving] = entering;
  }

  const solution = new Float64Array(width);
  for (let row = 0; row < height; row += 1) {
    const column = basis[row]!;
    if (column < width) solution[column] = table[row]![columns - 1]!;
  }
  // The objective row's entry under a slack is that row's dual price: it starts at zero, and every pivot subtracts
  // a multiple of the pivot row from it, which is exactly the elimination that builds `c_B B⁻¹`.
  if (!converged) throw new Error('the pivot budget was exhausted');
  const duals = new Float64Array(height);
  for (let row = 0; row < height; row += 1) duals[row] = table[height]![width + row]!;
  return { value: table[height]![columns - 1]!, solution, duals };
}

/**
 * Maximise the margin between one vector and a set of others, and return both certificates.
 *
 * The variables are `w⁺`, `w⁻` and `t`, all non-negative, with `w = w⁺ − w⁻`; the box `w⁺ + w⁻ ≤ 1` bounds the
 * direction so the margin cannot run to infinity, and every case row is divided by its own largest coefficient so
 * a term measured in milliseconds and a term measured in a ratio take part in the same pivot.
 *
 * @param target - The accepted candidate's vector.
 * @param others - Every other candidate's, in the dump's order after the target is removed.
 * @returns The margin, the direction and the multipliers.
 */
function solveMargin(target: Float64Array, others: readonly Float64Array[]): MarginSolve {
  const width = target.length;
  const cases = others.length;
  const rows: number[][] = [];
  const rhs: number[] = [];
  for (const other of others) {
    const row = Array.from<number>({ length: 2 * width + 1 }).fill(0);
    let scale = 0;
    for (let index = 0; index < width; index += 1) {
      const delta = other[index]! - target[index]!;
      row[index] = delta;
      row[width + index] = -delta;
      scale = Math.max(scale, Math.abs(delta));
    }
    row[2 * width] = 1;
    // A row of zeros is a candidate identical to the answer: it leaves `t ≤ 0` behind, which is the correct
    // "no separation" reading, and dividing by zero here would hand the tableau a NaN instead.
    const divisor = scale > 1 ? scale : 1;
    for (let index = 0; index < row.length; index += 1) row[index] = row[index]! / divisor;
    rows.push(row);
    rhs.push(0);
  }
  for (let index = 0; index < width; index += 1) {
    const row = Array.from<number>({ length: 2 * width + 1 }).fill(0);
    row[index] = 1;
    row[width + index] = 1;
    rows.push(row);
    rhs.push(1);
  }
  const objective = Array.from<number>({ length: 2 * width + 1 }).fill(0);
  objective[2 * width] = 1;

  const solved = maximise(objective, rows, rhs);
  const direction = new Float64Array(width);
  for (let index = 0; index < width; index += 1) {
    direction[index] = solved.solution[index]! - solved.solution[width + index]!;
  }
  const multipliers = new Float64Array(cases);
  for (let index = 0; index < cases; index += 1)
    multipliers[index] = Math.max(0, solved.duals[index]!);
  return {
    margin: solved.value,
    direction: solved.value > MARGIN_TOLERANCE ? direction : null,
    multipliers,
  };
}

/**
 * Score every candidate under one direction, and report the smallest gap the target opens.
 *
 * The tie rule is the caller's, and it is strict for a reason worth stating here: the engine sorts stably, so a
 * candidate level with the target keeps its earlier position, and the target is never the earlier one — it was
 * not first to begin with. A level case is therefore NOT separated.
 *
 * @param target - The accepted candidate's vector.
 * @param others - The rest, in dump order.
 * @param direction - The candidate separator.
 * @returns The margin when the target wins outright, or `null` when it does not.
 */
export function separates(
  target: Float64Array,
  others: readonly Float64Array[],
  direction: Float64Array,
): number | null {
  let targetScore = 0;
  for (let index = 0; index < target.length; index += 1)
    targetScore += direction[index]! * target[index]!;
  let margin = Infinity;
  for (const other of others) {
    let score = 0;
    for (let index = 0; index < other.length; index += 1)
      score += direction[index]! * other[index]!;
    const gap = targetScore - score;
    // A tie is not a separation: the engine's stable sort keeps the earlier candidate, and a case that is only
    // level with its competitor is a case a weight vector cannot PROMOTE.
    if (gap <= 0) return null;
    margin = Math.min(margin, gap);
  }
  return margin;
}

/**
 * Rebuild the target from a combination of the others, and report the largest coordinate error.
 *
 * @param target - The accepted candidate.
 * @param others - Every other candidate, in dump order.
 * @param weights - The multipliers, one per entry of `others`.
 * @returns The residual, or `null` when the multipliers are not a convex combination at all.
 */
export function combinationError(
  target: Float64Array,
  others: readonly Float64Array[],
  weights: Float64Array,
): number | null {
  let total = 0;
  for (const weight of weights) {
    if (weight < -COMBINATION_TOLERANCE) return null;
    total += weight;
  }
  if (total <= 0) return null;
  let worst = 0;
  for (let index = 0; index < target.length; index += 1) {
    let rebuilt = 0;
    for (let candidate = 0; candidate < others.length; candidate += 1) {
      rebuilt += (weights[candidate]! / total) * others[candidate]![index]!;
    }
    worst = Math.max(worst, Math.abs(rebuilt - target[index]!));
  }
  return worst;
}

/**
 * Build one case's vectors over a shared name order.
 *
 * A name the candidate never carried is a zero, not a missing term: the score is a sum over the terms the formula
 * has, and a term that did not fire contributed nothing to it.
 *
 * @param kase - One prepared case.
 * @param names - The name order to lay the vectors out on.
 * @param basis - Which column of each term the vector is built from.
 * @returns The case, ready for the program.
 */
export function reachCaseOf(
  kase: PreparedCase,
  names: readonly string[],
  basis: WeightBasis = 'slope',
): ReachCase {
  const ids: string[] = [];
  const vectors: Float64Array[] = [];
  for (const candidate of kase.candidates) {
    const row = new Float64Array(names.length);
    for (let index = 0; index < names.length; index += 1) {
      const term = candidate.terms.get(names[index]!);
      row[index] = term === undefined ? 0 : basis === 'slope' ? term.slope : term.paid;
    }
    ids.push(candidate.id);
    vectors.push(row);
  }
  return {
    datapack: kase.datapack,
    faultType: kase.faultType,
    accepted: kase.accepted,
    names,
    ids,
    vectors,
  };
}

/**
 * The name order every vector is laid out on.
 *
 * Sorted, because a witness has to be printable as a weight per name and two reports of the same run have to list
 * them in the same order.
 *
 * @param corpus - The prepared dump.
 * @returns Every term name any candidate carried.
 */
export function namesOf(corpus: PreparedCorpus): string[] {
  const names = new Set<string>();
  for (const kase of corpus.cases) {
    for (const candidate of kase.candidates)
      for (const name of candidate.terms.keys()) names.add(name);
  }
  return [...names].sort();
}

/**
 * Render a vector as weights by name, dropping nothing.
 *
 * @param names - The name order.
 * @param vector - The vector.
 * @returns The weights, by name.
 */
function byName(names: readonly string[], vector: Float64Array): Record<string, number> {
  const record: Record<string, number> = {};
  for (let index = 0; index < names.length; index += 1) record[names[index]!] = vector[index]!;
  return record;
}

/**
 * Render a combination as coefficients by candidate id, dropping the zeros a simplex vertex leaves behind.
 *
 * @param ids - The candidate ids, aligned with `weights`.
 * @param weights - The multipliers, possibly unnormalised.
 * @returns The combination, by id.
 */
function byCandidate(ids: readonly string[], weights: Float64Array): Record<string, number> {
  // The caller only reaches here after `combinationError` accepted these multipliers, which it does only for a
  // non-negative set with a positive total — so the division is guarded by the certificate rather than by a second
  // check that no case can take.
  let total = 0;
  for (const weight of weights) total += weight;
  const record: Record<string, number> = {};
  for (let index = 0; index < ids.length; index += 1) {
    const share = weights[index]! / total;
    if (share > COMBINATION_TOLERANCE) record[ids[index]!] = share;
  }
  return record;
}

/**
 * Decide one case: is its answer reachable by some weight vector, or inside the hull of its competitors?
 *
 * @param kase - The case, with vectors on a shared name order.
 * @returns The verdict, with whichever certificate survived verification.
 */
export function reachabilityOf(kase: ReachCase): ReachReading {
  const base = { datapack: kase.datapack, faultType: kase.faultType };
  const top = kase.ids[0]!;
  if (kase.accepted.has(top)) {
    return { ...base, kind: 'hit', answer: top, witness: null, margin: null, combination: null };
  }
  // A case may declare several accepted answers, and one of them being INSIDE the hull says nothing about the
  // others: a single endpoint that happens to be a combination of the candidates must not condemn a case whose
  // other endpoint is separable. So only a proven separation returns early, and the weaker verdicts are decided
  // after every endpoint has had its certificate read.
  let inHull: ReachReading | null = null;
  // How many endpoints came back with a certificate of one kind or the other. An endpoint the ranking never
  // carried has none, and neither has one whose proposed certificate failed substitution — so `in-hull` is the
  // verdict only when every endpoint has one, and a case with an uncertified endpoint is `undecided`.
  let certified = 0;
  for (const answer of kase.accepted) {
    const index = kase.ids.indexOf(answer);
    // An accepted answer the ranking never listed has no vector, so nothing about the weights can be said about
    // it: that is a retrieval failure, and calling it `in-hull` would blame the weights for it.
    if (index < 0) continue;
    const target = kase.vectors[index]!;
    const kept: string[] = [];
    const others: Float64Array[] = [];
    for (let position = 0; position < kase.vectors.length; position += 1) {
      if (position === index) continue;
      kept.push(kase.ids[position]!);
      others.push(kase.vectors[position]!);
    }
    const solved = solveMargin(target, others);
    const margin = solved.direction === null ? null : separates(target, others, solved.direction);
    if (solved.direction !== null && margin !== null) {
      return {
        ...base,
        kind: 'separable',
        answer,
        witness: byName(kase.names, solved.direction),
        margin,
        combination: null,
      };
    }
    const residual =
      solved.direction === null ? combinationError(target, others, solved.multipliers) : null;
    if (residual !== null && residual <= COMBINATION_TOLERANCE) {
      inHull ??= {
        ...base,
        kind: 'in-hull',
        answer,
        witness: null,
        margin: null,
        combination: byCandidate(kept, solved.multipliers),
      };
      certified += 1;
    }
    // Nothing here records a failure. An endpoint whose certificate did not survive substitution simply does not
    // increment `certified`, and the verdict falls out of the count at the end — which is also what makes an
    // uncertified endpoint and an unlisted one the same case rather than two branches to be covered separately.
  }
  if (inHull !== null && certified === kase.accepted.size) return inHull;
  return {
    ...base,
    kind: 'undecided',
    answer: null,
    witness: null,
    margin: null,
    combination: null,
  };
}

/**
 * Read every case's reachability.
 *
 * @param corpus - The prepared dump.
 * @param names - The name order.
 * @param basis - Which column of each term the vectors are built from.
 * @returns One reading per case, in the dump's order.
 */
export function reachabilityTable(
  corpus: PreparedCorpus,
  names: readonly string[],
  basis: WeightBasis = 'slope',
): ReachReading[] {
  return corpus.cases.map((kase) => reachabilityOf(reachCaseOf(kase, names, basis)));
}

/**
 * Count the verdicts.
 *
 * @param readings - One reading per case.
 * @returns The population's totals, with the ceiling the weight dimension can reach.
 */
export function summariseReach(readings: readonly ReachReading[]): ReachReport {
  let hits = 0;
  let separable = 0;
  let inHull = 0;
  let undecided = 0;
  for (const reading of readings) {
    if (reading.kind === 'hit') hits += 1;
    else if (reading.kind === 'separable') separable += 1;
    else if (reading.kind === 'in-hull') inHull += 1;
    else undecided += 1;
  }
  return { cases: readings.length, hits, separable, inHull, undecided, ceiling: hits + separable };
}

/** An empty report, for a corpus with no cases at all. */
export const EMPTY_REACH_REPORT: ReachReport = {
  cases: 0,
  hits: 0,
  separable: 0,
  inHull: 0,
  undecided: 0,
  ceiling: 0,
};

/**
 * The same totals, split by fault family, largest first.
 *
 * A ceiling is a property of a corpus and a family ceiling is a property of a fault class: a family at 100% has
 * nothing left to win and a family at 60% is where the next term has to come from, and the aggregate hides the
 * difference.
 *
 * @param readings - One reading per case.
 * @returns One row per family, by descending size.
 */
export function familyReach(readings: readonly ReachReading[]): FamilyReach[] {
  const byFamily = new Map<string, ReachReading[]>();
  for (const reading of readings) {
    const family = byFamily.get(reading.faultType) ?? [];
    family.push(reading);
    byFamily.set(reading.faultType, family);
  }
  return [...byFamily.entries()]
    .map(([faultType, family]) => ({ faultType, ...summariseReach(family) }))
    .sort(
      (left, right) =>
        right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
    );
}

/**
 * One half's reading, before and after a single weight vector was fitted on the other half.
 *
 * `before` is the shipped weights' `Top@1`; `after` is the fitted vector's. The pair is the whole point: a fit
 * that raises its own half and lowers the other one has found a direction that belongs to the cases it saw, not
 * to the corpus, and the module prints both because either alone invites the wrong conclusion.
 */
export interface FitReading {
  /** `Top@1` this half was RECORDED at, which is the run the dump came from and the number to beat. */
  readonly recorded: number;
  /** `Top@1` on this half under the starting weights, which is what the fit is charged against. */
  readonly before: number;
  /** `Top@1` on this half under the fitted vector. */
  readonly after: number;
  readonly cases: number;
}

/** A held-out fit: the vector, and what it did on each side. */
export interface FitReport {
  /** The half the vector was fitted on. */
  readonly train: FitReading;
  /** The half it never saw, which is the only number that speaks about the corpus. */
  readonly held: FitReading;
  /** The fitted weights, by term name. */
  readonly weights: Readonly<Record<string, number>>;
}

/**
 * Whether one case, scored under one direction, answers correctly.
 *
 * Strictly greater keeps the earlier candidate on a tie: the engine's own rule, applied here so a preset cannot
 * be credited with a promotion the engine would refuse.
 *
 * @param kase - The case.
 * @param direction - The weight vector.
 * @returns Whether the top-scoring candidate is accepted.
 */
function answersWith(kase: ReachCase, direction: Float64Array): boolean {
  let bestIndex = 0;
  let bestScore = -Infinity;
  for (let index = 0; index < kase.vectors.length; index += 1) {
    const vector = kase.vectors[index]!;
    let score = 0;
    for (let term = 0; term < vector.length; term += 1) score += direction[term]! * vector[term]!;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return kase.accepted.has(kase.ids[bestIndex]!);
}

/**
 * Count one half's hits as the dump recorded them, which is the run a fitted vector has to beat.
 *
 * @param cases - The half.
 * @returns The recorded hits.
 */
function recordedOf(cases: readonly ReachCase[]): number {
  let hits = 0;
  for (const kase of cases) if (kase.accepted.has(kase.ids[0]!)) hits += 1;
  return hits;
}

/**
 * Count one half's hits under one direction.
 *
 * @param cases - The half.
 * @param direction - The weight vector.
 * @returns The hits and the size of the half.
 */
function hitsOf(cases: readonly ReachCase[], direction: Float64Array): number {
  let hits = 0;
  for (const kase of cases) if (answersWith(kase, direction)) hits += 1;
  return hits;
}

/** The parameters of the held-out fit. */
export interface FitOptions {
  /** Passes over the training half. */
  readonly epochs: number;
  /** Seed for the pass order, so two runs of the report agree to the digit. */
  readonly seed: number;
  /**
   * Which alternating half trains: `0` takes the even positions, `1` the odd ones.
   *
   * Both are needed, because a fit that gains on one orientation and loses on the other has found the split
   * rather than the corpus, and only running both can tell the two apart.
   */
  readonly orientation: 0 | 1;
  /** Step size at the first pass; it decays to `learningRate / (1 + 0.15 · epoch)`. */
  readonly learningRate: number;
  /** Pull per update, which keeps the vector from growing without bound on a half it can separate. */
  readonly shrinkage: number;
}

/** The defaults the report uses: enough passes to converge on this corpus, small enough to finish in seconds. */
export const DEFAULT_FIT: FitOptions = {
  epochs: 40,
  seed: 0,
  orientation: 0,
  learningRate: 0.05,
  shrinkage: 1e-4,
};

/**
 * A deterministic generator, because a fit has to be reproducible by a reader who runs the same command.
 *
 * Exported rather than duplicated: two modules that fit a vector must shuffle the same way, or a report that says
 * "seed 0" names two different orders in two files and neither is reproducible.
 *
 * @param state - The state.
 * @returns The next state and a value in `[0, 1)`.
 */
export function nextRandom(state: number): { state: number; value: number } {
  // Numerical Recipes' linear congruential pair: 32-bit state, no dependency, and identical on every platform.
  const advanced = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return { state: advanced, value: advanced / 0x1_0000_0000 };
}

/**
 * Fit ONE weight vector on half the corpus and read it on the other half.
 *
 * The per-case theorem says every case has a vector of its own. It says nothing about whether one vector can
 * serve them all, and that is the question a deployable weight set asks. So this fits a ranking perceptron on
 * alternating cases and reports both halves: if the held half rises too, the direction generalises and the
 * shipped weights were simply not it; if only the training half rises, the reachable set is not co-satisfiable
 * and the headroom is a SELECTION problem rather than a parameter one.
 *
 * Alternating rather than a hash split because the dump's order already groups nothing: a hash split would make
 * the halves depend on a hash function, and the reader could not reproduce them without reading this file.
 *
 * @param corpus - The prepared dump.
 * @param names - The name order.
 * @param start - The weight vector the fit starts from, by name.
 * @param options - The fit's parameters.
 * @param basis - Which column of each term the vectors are built from.
 * @returns The fitted weights and both halves' readings.
 */
export function heldOutFit(
  corpus: PreparedCorpus,
  names: readonly string[],
  start: Readonly<Record<string, number>>,
  options: FitOptions = DEFAULT_FIT,
  basis: WeightBasis = 'slope',
): FitReport {
  const cases = corpus.cases.map((kase) => reachCaseOf(kase, names, basis));
  const train: ReachCase[] = [];
  const held: ReachCase[] = [];
  for (const [index, kase] of cases.entries()) {
    if (index % 2 === options.orientation) train.push(kase);
    else held.push(kase);
  }
  const weights = new Float64Array(names.length);
  for (let index = 0; index < names.length; index += 1) weights[index] = start[names[index]!] ?? 0;
  const trainingBefore = hitsOf(train, weights);
  const heldBefore = hitsOf(held, weights);
  const trainingRecorded = recordedOf(train);
  const heldRecorded = recordedOf(held);

  let state = options.seed >>> 0;
  let best = weights.slice();
  let bestTrain = trainingBefore;
  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const order = train.map((_, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const drawn = nextRandom(state);
      state = drawn.state;
      const swap = Math.floor(drawn.value * (index + 1));
      const held = order[index]!;
      order[index] = order[swap]!;
      order[swap] = held;
    }
    const rate = options.learningRate / (1 + 0.15 * epoch);
    for (const position of order) {
      const kase = train[position]!;
      let bestAccepted = -Infinity;
      let bestAcceptedIndex = -1;
      let bestOther = -Infinity;
      let bestOtherIndex = -1;
      for (let index = 0; index < kase.vectors.length; index += 1) {
        const vector = kase.vectors[index]!;
        let score = 0;
        for (let term = 0; term < vector.length; term += 1) score += weights[term]! * vector[term]!;
        if (kase.accepted.has(kase.ids[index]!)) {
          if (score > bestAccepted) {
            bestAccepted = score;
            bestAcceptedIndex = index;
          }
        } else if (score > bestOther) {
          bestOther = score;
          bestOtherIndex = index;
        }
      }
      if (bestAcceptedIndex < 0 || bestOtherIndex < 0 || bestAccepted >= bestOther) continue;
      const good = kase.vectors[bestAcceptedIndex]!;
      const bad = kase.vectors[bestOtherIndex]!;
      for (let term = 0; term < weights.length; term += 1) {
        weights[term] =
          weights[term]! + rate * (good[term]! - bad[term]!) - options.shrinkage * weights[term]!;
      }
    }
    const reached = hitsOf(train, weights);
    if (reached > bestTrain) {
      bestTrain = reached;
      best = weights.slice();
    }
  }

  const byNameWeights: Record<string, number> = {};
  for (let index = 0; index < names.length; index += 1) byNameWeights[names[index]!] = best[index]!;
  return {
    train: {
      recorded: trainingRecorded,
      before: trainingBefore,
      after: bestTrain,
      cases: train.length,
    },
    held: {
      recorded: heldRecorded,
      before: heldBefore,
      after: hitsOf(held, best),
      cases: held.length,
    },
    weights: byNameWeights,
  };
}

/** One fault family under one fitted vector. */
export interface FamilyFit {
  readonly faultType: string;
  readonly cases: number;
  /** `Top@1` the dump recorded for this family. */
  readonly recorded: number;
  /** `Top@1` under the vector. */
  readonly after: number;
  readonly delta: number;
}

/**
 * Read one vector family by family.
 *
 * The aggregate is the number a fitted vector is advertised on and the last one a reviewer should trust: a move
 * worth `+47` by taking thirty cases from one fault family to give seventy to another is the exact trade the
 * corpus-level count cannot show, and the pre-registered gate in `term-weight-screen.ts` exists because that
 * trade has already happened once on this corpus.
 *
 * @param corpus - The prepared dump.
 * @param names - The name order.
 * @param direction - The vector to read, by name.
 * @param basis - Which column of each term the vectors are built from.
 * @returns One row per family, largest first.
 */
export function familyOfVector(
  corpus: PreparedCorpus,
  names: readonly string[],
  direction: Readonly<Record<string, number>>,
  basis: WeightBasis = 'slope',
): FamilyFit[] {
  const vector = new Float64Array(names.length);
  for (let index = 0; index < names.length; index += 1)
    vector[index] = direction[names[index]!] ?? 0;
  const rows = new Map<string, { cases: number; recorded: number; after: number }>();
  for (const kase of corpus.cases) {
    const reach = reachCaseOf(kase, names, basis);
    const row = rows.get(reach.faultType) ?? { cases: 0, recorded: 0, after: 0 };
    row.cases += 1;
    if (kase.accepted.has(reach.ids[0]!)) row.recorded += 1;
    if (answersWith(reach, vector)) row.after += 1;
    rows.set(reach.faultType, row);
  }
  return [...rows.entries()]
    .map(([faultType, row]) => ({ faultType, ...row, delta: row.after - row.recorded }))
    .sort(
      (left, right) =>
        right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
    );
}

/**
 * Format the family reading.
 *
 * @param rows - One row per family.
 * @returns The table, as one string.
 */
export function formatFamilyFit(rows: readonly FamilyFit[]): string {
  const lines = [
    `${'faultType'.padEnd(32)} ${'n'.padStart(5)} ${'recorded'.padStart(8)} ${'fitted'.padStart(6)} ${'delta'.padStart(6)}`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.faultType.padEnd(32)} ${String(row.cases).padStart(5)} ${String(row.recorded).padStart(8)} ${String(row.after).padStart(6)} ${`${row.delta >= 0 ? '+' : ''}${row.delta}`.padStart(6)}`,
    );
  }
  return lines.join('\n');
}

/**
 * Format the held-out reading.
 *
 * @param report - The fit.
 * @returns The report, as one string.
 */
export function formatFitReport(report: FitReport): string {
  const line = (label: string, reading: FitReading): string =>
    `${label.padEnd(5)} ${String(reading.cases).padStart(5)} cases   recorded ${String(reading.recorded).padStart(5)}   start ${String(reading.before).padStart(5)}   fitted ${String(reading.after).padStart(5)}   vs recorded ${reading.after - reading.recorded >= 0 ? '+' : ''}${reading.after - reading.recorded}`;
  return [
    `HELD-OUT FIT`,
    `  ${line('train', report.train)}`,
    `  ${line('held', report.held)}`,
  ].join('\n');
}

/**
 * Format the report a reader can check a claim against.
 *
 * @param report - The population's totals.
 * @param families - The same, by family.
 * @param basis - Which space the verdicts were read in, named in the header so two reports cannot be confused.
 * @returns The report, as one string.
 */
export function formatReachReport(
  report: ReachReport,
  families: readonly FamilyReach[],
  basis: WeightBasis,
): string {
  const share = (value: number): string =>
    report.cases === 0 ? '0.00%' : `${((100 * value) / report.cases).toFixed(2)}%`;
  const lines = [
    `basis ${basis}`,
    `cases ${report.cases}`,
    `  hit         ${report.hits} (${share(report.hits)})`,
    `  separable   ${report.separable} (${share(report.separable)})`,
    `  in-hull     ${report.inHull} (${share(report.inHull)})`,
    `  undecided   ${report.undecided}`,
    `CEILING       ${report.ceiling} (${share(report.ceiling)})`,
    '',
    `${'faultType'.padEnd(32)} ${'n'.padStart(5)} ${'hit'.padStart(5)} ${'sep'.padStart(5)} ${'hull'.padStart(5)} ${'ceil%'.padStart(7)}`,
  ];
  for (const family of families) {
    const ratio = family.cases === 0 ? 0 : (100 * family.ceiling) / family.cases;
    lines.push(
      `${family.faultType.padEnd(32)} ${String(family.cases).padStart(5)} ${String(family.hits).padStart(5)} ${String(family.separable).padStart(5)} ${String(family.inHull).padStart(5)} ${ratio.toFixed(1).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

/** The arguments the reachability console takes. */
export interface ReachArgs {
  readonly terms: string;
  /** Whether to fit a single vector on half the corpus and read it on the other half. */
  readonly fit: boolean;
  readonly basis: WeightBasis;
}

/**
 * Parse the console's arguments.
 *
 * @param argv - The arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseReachArgs(argv: readonly string[]): ReachArgs {
  let terms: string | null = null;
  let fit = false;
  let basis: WeightBasis = 'slope';
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--terms') {
      terms = argv[index + 1] ?? null;
      if (terms === null) throw new Error('--terms expects a dump path');
      index += 1;
      continue;
    }
    if (flag === '--basis') {
      const value = argv[index + 1] ?? '';
      if (value !== 'slope' && value !== 'paid') throw new Error('--basis expects slope or paid');
      basis = value;
      index += 1;
      continue;
    }
    if (flag === '--fit') {
      fit = true;
      continue;
    }
    throw new Error(`unknown argument: ${flag}`);
  }
  if (terms === null) throw new Error('--terms is required');
  return { terms, fit, basis };
}
