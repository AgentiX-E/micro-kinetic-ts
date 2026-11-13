/**
 * The term-weight screen: what a weight is worth, computed from one dump and no engine.
 *
 * A score is `Σ (weight × slope)`, so every term is affine in its own weight and a change from `w` to `w′` moves
 * a candidate by `(w′ − w) × slope` — one multiplication per candidate per moved term. The whole landscape of
 * weights therefore needs no run: it is arithmetic over an artifact that already holds every candidate of every
 * case, and the confirmation is one dispatch rather than one per grid point.
 *
 * ## Why this is a module and not the script it used to be
 *
 * `docs/term-weight-landscape.md` published the landscape from a 60-line script that lived outside the tree. A
 * number that cannot be re-derived by running the repository is a number a reader has to take on trust, and the
 * table it produced prints "the best of each row" — a selection whose rule lives in whoever wrote the script.
 * The module removes both: the grid is a literal, every point is printed, and the argument parser refuses a
 * typo rather than screening the wrong artifact.
 *
 * ## Why the identity is checked before any weight moves
 *
 * The screen reconstructs each candidate's score from its own triples. If the reconstruction misses the
 * `finalScore` the sort used, then the terms in the dump are not the terms the score was built from, and every
 * re-scored number is a promotion the screen cannot make while claiming it did. So a case that fails the
 * identity is REFUSED and counted, at a tolerance of {@link RESIDUAL_TOLERANCE} — the same constant
 * `term-decomposition.ts` refuses on, because two readers of one dump disagreeing about which cases are usable
 * is the defect both exist to prevent.
 *
 * At `Δw = 0` the screen must reproduce the shipped run case for case. That is not a sanity check; it is the only
 * thing that entitles the other rows, and it is why {@link screenGrid} computes its own baseline rather than
 * trusting `before` from a caller.
 *
 * ## Why the gate is not "did `Top@1` rise"
 *
 * `Top@1` is a sum over a corpus, and a sum hides the thing the gate is for: a move worth `+13` cases by taking
 * one from each of two fault families is a move that made the engine worse at two kinds of fault to be better at
 * the average. The pre-registered rule is that no family with `n ≥ 20` may lose a case the shipped run answered,
 * which is the same floor and the same reason `term-decomposition.ts` applies its bar only above it — a family of
 * four cannot sentence a term, and it cannot license one either.
 *
 * @module benchmarks/term-weight-screen
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import { MIN_FAMILY_CASES, RESIDUAL_TOLERANCE } from './term-decomposition.js';

import type { ParsedTermCase } from './terms-dump.js';

/** One term's weight, set to an absolute value rather than a delta. */
export interface WeightMove {
  readonly name: string;
  readonly weight: number;
}

/** One question the screen is asked. */
export interface GridPoint {
  /** What the row is called. Empty means "derive it from the moves". */
  readonly label: string;
  readonly moves: readonly WeightMove[];
}

/** One case's verdict under one weight vector. */
export interface CaseOutcome {
  readonly datapack: string;
  readonly faultType: string;
  /** The candidate the moved weights rank first. */
  readonly winner: string;
  /** Zero-based position of the first accepted candidate in the MOVED order, or `-1` when it holds none. */
  readonly depth: number;
  /** Whether the winner is an accepted answer. */
  readonly hit: boolean;
}

/** One weight vector's reading. */
export interface WeightEvaluation {
  /** Cases the screen could score. The denominator of every rate below. */
  readonly cases: number;
  /** Cases refused because their triples do not rebuild their own score. */
  readonly refused: number;
  readonly hits: number;
  /** One entry per scored case, in the dump's order — so two evaluations zip index for index. */
  readonly outcomes: readonly CaseOutcome[];
}

/** One fault family a move costs. */
export interface FamilyLoss {
  readonly faultType: string;
  /** The family's size, which is what the floor is applied to. */
  readonly cases: number;
  readonly before: number;
  readonly after: number;
  /** The cases it answered under the shipped weights and no longer answers, in id order. */
  readonly lost: readonly string[];
  /** The cases it did not answer and now does, in id order. */
  readonly gained: readonly string[];
}

/** One row of the landscape. */
export interface ScreenRow {
  readonly label: string;
  readonly moves: readonly WeightMove[];
  /** `Top@1` under the shipped weights, recomputed by this screen. */
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly gained: readonly string[];
  readonly lost: readonly string[];
  /**
   * Families above the floor that lost a case, so the row's `delta` can be read against what it cost.
   *
   * Only families with `n ≥ MIN_FAMILY_CASES` appear: a family below the floor cannot license a move, and its
   * loss is therefore reported in {@link lost} without being a verdict here.
   */
  readonly losses: readonly FamilyLoss[];
  /** `delta ≥ 0` and no family above the floor lost a case. */
  readonly admissible: boolean;
}

/** One name's share of one candidate, as its triples recorded it. */
export interface RebuiltTerm {
  /** `Σ (weight × slope)` over the triples carrying this name. */
  readonly paid: number;
  /** `Σ slope` over the same triples, so a moved name's new share is one multiplication. */
  readonly slope: number;
}

/** A candidate rebuilt from its own triples. */
export interface Reconstructed {
  readonly id: string;
  /** `Σ paid` over every triple, which must equal the recorded score. */
  readonly base: number;
  /** Per name. ONE map rather than two, so a name cannot be in one and missing from the other. */
  readonly terms: ReadonlyMap<string, RebuiltTerm>;
}

/** One case, reconstructed once and then scored under any number of weight vectors. */
export interface PreparedCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly accepted: ReadonlySet<string>;
  readonly candidates: readonly Reconstructed[];
}

/** A dump, reconstructed once. */
export interface PreparedCorpus {
  /** The cases the identity holds on, in the dump's order. */
  readonly cases: readonly PreparedCase[];
  /** The cases it does not, which no row of any screen may include. */
  readonly refused: number;
}

/** A whole screening: the population it was taken over and one row per grid point. */
export interface ScreenReport {
  /** The denominator: cases the screen could score. */
  readonly cases: number;
  /** The cases it refused, which no row includes. */
  readonly refused: number;
  /** `Top@1` at `Δw = 0`, which is what every row's `delta` is against. */
  readonly baseline: number;
  /** One row per grid point, in the grid's order. */
  readonly rows: readonly ScreenRow[];
}

/**
 * Reconstruct one case from its triples, or refuse it.
 *
 * A candidate with no recorded score is refused with the case: the engine ordered by a number this dump does not
 * carry, so there is nothing to reproduce and nothing to move.
 *
 * @param kase - One case, as the dump read it.
 * @returns The candidates, or `undefined` when the case cannot be rebuilt.
 */
function reconstructCase(kase: ParsedTermCase): Reconstructed[] | undefined {
  const rebuilt: Reconstructed[] = [];
  for (const candidate of kase.candidates) {
    if (candidate.score === null) return undefined;
    const terms = new Map<string, RebuiltTerm>();
    let base = 0;
    for (const [name, weight, slope] of candidate.terms) {
      if (weight === null || slope === null) continue;
      const paid = weight * slope;
      const running = terms.get(name);
      terms.set(name, { paid: (running?.paid ?? 0) + paid, slope: (running?.slope ?? 0) + slope });
      base += paid;
    }
    if (Math.abs(base - candidate.score) > RESIDUAL_TOLERANCE) return undefined;
    rebuilt.push({ id: candidate.id, base, terms });
  }
  return rebuilt;
}

/**
 * Reconstruct a dump once, so a grid of thirty points does not rebuild it thirty times.
 *
 * @param cases - The dump's cases.
 * @returns The rebuildable cases and the count of the others.
 */
export function prepareCases(cases: readonly ParsedTermCase[]): PreparedCorpus {
  const prepared: PreparedCase[] = [];
  let refused = 0;
  for (const kase of cases) {
    const candidates = reconstructCase(kase);
    if (candidates === undefined) {
      refused += 1;
      continue;
    }
    prepared.push({
      datapack: kase.datapack,
      faultType: kase.faultType,
      accepted: new Set(kase.accepted),
      candidates,
    });
  }
  return { cases: prepared, refused };
}

/**
 * Score one case under one weight vector.
 *
 * The moved names are replaced, not adjusted: a moved name's contribution becomes `w′ × Σ slope`, which is exact
 * even when the triples carrying it recorded different weights, and which needs no assumption about the weight a
 * dump happened to write.
 *
 * @param kase - One prepared case.
 * @param weights - The moves, by name.
 * @returns The candidates in the moved order (score descending, the dump's index breaking ties), and the verdict.
 */
function scoreCase(kase: PreparedCase, weights: ReadonlyMap<string, number>): CaseOutcome {
  const scores: number[] = [];
  for (const candidate of kase.candidates) {
    let score = candidate.base;
    for (const [name, weight] of weights) {
      const term = candidate.terms.get(name);
      // A name the candidate never carried is a zero in the sum: no term to move, so nothing to replace. This is
      // a REACHED branch, not a fallback — the dump carries only the terms the formula built for that candidate.
      if (term === undefined) continue;
      score += weight * term.slope - term.paid;
    }
    scores.push(score);
  }
  const order = kase.candidates.map((_, index) => index);
  // Score descending, the dump's index ascending: a tie is not a flip, because the engine's own sort put the
  // earlier candidate first and a screen that re-tied them would report a promotion the engine never makes.
  order.sort((left, right) => scores[right]! - scores[left]! || left - right);
  let depth = -1;
  for (let position = 0; position < order.length; position += 1) {
    if (kase.accepted.has(kase.candidates[order[position]!]!.id)) {
      depth = position;
      break;
    }
  }
  return {
    datapack: kase.datapack,
    faultType: kase.faultType,
    winner: kase.candidates[order[0]!]!.id,
    depth,
    hit: depth === 0,
  };
}

/**
 * Score every prepared case under one weight vector.
 *
 * @param corpus - The prepared dump.
 * @param moves - The weights to set; every other term keeps the weight its triples recorded.
 * @returns The evaluation, with the denominator it was taken over.
 */
export function evaluatePrepared(
  corpus: PreparedCorpus,
  moves: readonly WeightMove[],
): WeightEvaluation {
  const weights = new Map<string, number>();
  for (const move of moves) weights.set(move.name, move.weight);
  const outcomes = corpus.cases.map((kase) => scoreCase(kase, weights));
  return {
    cases: outcomes.length,
    refused: corpus.refused,
    hits: outcomes.filter((outcome) => outcome.hit).length,
    outcomes,
  };
}

/**
 * Score a dump under one weight vector.
 *
 * @param cases - The dump's cases.
 * @param moves - The weights to set.
 * @returns The evaluation.
 */
export function evaluateWeights(
  cases: readonly ParsedTermCase[],
  moves: readonly WeightMove[],
): WeightEvaluation {
  return evaluatePrepared(prepareCases(cases), moves);
}

/**
 * The weight each term was shipped with, as the dump recorded it.
 *
 * First appearance wins rather than last: a name carried by several triples carries one weight, and a reader that
 * took the last would report whichever triple the writer happened to emit between them.
 *
 * Sorted by descending magnitude, because the header's job is to say which terms were LIVE — a formula of
 * nineteen terms where thirteen are zero is a fact about the run that a first-appearance listing buries.
 *
 * @param cases - The dump's cases.
 * @returns One move per name, heaviest first.
 */
export function shippedWeightsOf(cases: readonly ParsedTermCase[]): WeightMove[] {
  const seen = new Map<string, number>();
  for (const kase of cases) {
    for (const candidate of kase.candidates) {
      for (const [name, weight] of candidate.terms) {
        if (weight === null) continue;
        if (!seen.has(name)) seen.set(name, weight);
      }
    }
  }
  return [...seen.entries()]
    .map(([name, weight]) => ({ name, weight }))
    .sort(
      (left, right) =>
        Math.abs(right.weight) - Math.abs(left.weight) || byId(left.name, right.name),
    );
}

/** A move list as a row label: the moves in the order the point states them. */
function labelOf(moves: readonly WeightMove[]): string {
  return moves.map((move) => `${move.name} ${move.weight}`).join(' + ');
}

/** A point whose label is derived from its moves. */
function point(moves: readonly WeightMove[]): GridPoint {
  return { label: labelOf(moves), moves };
}

/**
 * The weights the landscape is swept over, as absolute values.
 *
 * Absolute rather than multiples of the shipped weight, because `stability` shipped at `0.007352` — a move of any
 * size that matters to it is a move of two orders of magnitude, and a ratio sweep would spend every point in a
 * neighbourhood where nothing can flip. The three sweeps are the grid's axes; the pair and triple rows are where
 * two terms are worth more together than either is alone, which is the only shape in which the landscape has an
 * admissible point to find.
 */
const STABILITY_SWEEP = [0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.8, 1.6] as const;
const LAT_SWEEP = [0, 0.2, 0.4, 0.8, 1.2] as const;
const LOG_SWEEP = [0.3, 0.5, 0.8, 1.2, 1.6] as const;
const STABILITY_PAIRING = [0.1, 0.2, 0.3, 0.4] as const;
const STABILITY_TRIPLING = [0.2, 0.3] as const;

/** The default grid: 28 points, every one of them printed. */
export const DEFAULT_GRID: readonly GridPoint[] = [
  ...STABILITY_SWEEP.map((weight) => point([{ name: 'stability', weight }])),
  ...LAT_SWEEP.map((weight) => point([{ name: 'lat', weight }])),
  ...LOG_SWEEP.map((weight) => point([{ name: 'log', weight }])),
  ...STABILITY_PAIRING.map((weight) =>
    point([
      { name: 'stability', weight },
      { name: 'log', weight: 1.2 },
    ]),
  ),
  ...STABILITY_PAIRING.slice(0, 3).map((weight) =>
    point([
      { name: 'stability', weight },
      { name: 'lat', weight: 0.4 },
    ]),
  ),
  ...STABILITY_TRIPLING.map((weight) =>
    point([
      { name: 'stability', weight },
      { name: 'lat', weight: 0.4 },
      { name: 'log', weight: 1.2 },
    ]),
  ),
];

/** Compare two ids the way the corpus does, so two runs' loss lists are the same list. */
function byId(left: string, right: string): number {
  return compareCasePaths(left, right);
}

/**
 * Screen a grid over one prepared dump.
 *
 * The baseline is computed here rather than passed in, so a row's `before` and its `after` are always the same
 * measurement — a caller-supplied baseline would be a second reading of the same corpus, and two readings that
 * disagree by one case produce a `delta` no point on the grid produced.
 *
 * @param corpus - The prepared dump.
 * @param points - The grid. An empty grid returns no rows.
 * @returns The report: the population, the baseline and one row per point, in the grid's order.
 */
export function screenPrepared(corpus: PreparedCorpus, points: readonly GridPoint[]): ScreenReport {
  const baseline = evaluatePrepared(corpus, []);
  const population = {
    cases: corpus.cases.length,
    refused: corpus.refused,
    baseline: baseline.hits,
  };
  if (points.length === 0) return { ...population, rows: [] };
  const byFamily = new Map<string, { total: number; hits: number }>();
  for (const outcome of baseline.outcomes) {
    const bucket = byFamily.get(outcome.faultType) ?? { total: 0, hits: 0 };
    bucket.total += 1;
    if (outcome.hit) bucket.hits += 1;
    byFamily.set(outcome.faultType, bucket);
  }

  const rows = points.map((gridPoint): ScreenRow => {
    const evaluated = evaluatePrepared(corpus, gridPoint.moves);
    const gained: string[] = [];
    const lost: string[] = [];
    const familyAfter = new Map<string, number>();
    const familyLost = new Map<string, string[]>();
    const familyGained = new Map<string, string[]>();
    for (let index = 0; index < evaluated.outcomes.length; index += 1) {
      // Index-parallel, not a join: both evaluations score the SAME prepared cases in the same order, because
      // refusal depends on the triples and not on the weights.
      const after = evaluated.outcomes[index]!;
      const before = baseline.outcomes[index]!;
      if (after.hit && !before.hit) gained.push(after.datapack);
      if (!after.hit && before.hit) {
        lost.push(after.datapack);
        const bucket = familyLost.get(after.faultType) ?? [];
        bucket.push(after.datapack);
        familyLost.set(after.faultType, bucket);
      }
      if (after.hit && !before.hit) {
        const bucket = familyGained.get(after.faultType) ?? [];
        bucket.push(after.datapack);
        familyGained.set(after.faultType, bucket);
      }
      if (after.hit) familyAfter.set(after.faultType, (familyAfter.get(after.faultType) ?? 0) + 1);
    }
    gained.sort(byId);
    lost.sort(byId);

    // `!` rather than a default on the baseline lookups: every key here came from a case the baseline scored, and
    // a default would turn a broken invariant into a family of size 0 — which is BELOW the floor, so the row would
    // silently lose the loss it is being read for. Loud is the only safe direction for this one.
    const losses: FamilyLoss[] = [...familyLost.keys()]
      .filter((faultType) => byFamily.get(faultType)!.total >= MIN_FAMILY_CASES)
      .sort(byId)
      .map((faultType) => ({
        faultType,
        cases: byFamily.get(faultType)!.total,
        before: byFamily.get(faultType)!.hits,
        after: familyAfter.get(faultType) ?? 0,
        lost: [...familyLost.get(faultType)!].sort(byId),
        gained: [...(familyGained.get(faultType) ?? [])].sort(byId),
      }));

    const delta = evaluated.hits - baseline.hits;
    return {
      label: gridPoint.label === '' ? labelOf(gridPoint.moves) : gridPoint.label,
      moves: gridPoint.moves,
      before: baseline.hits,
      after: evaluated.hits,
      delta,
      gained,
      lost,
      losses,
      admissible: delta >= 0 && losses.length === 0,
    };
  });
  return { ...population, rows };
}

/**
 * Screen a grid over one dump.
 *
 * @param cases - The dump's cases.
 * @param points - The grid.
 * @returns The report.
 */
export function screenGrid(
  cases: readonly ParsedTermCase[],
  points: readonly GridPoint[],
): ScreenReport {
  return screenPrepared(prepareCases(cases), points);
}

/** A share rendered at the precision the table's rows are compared at. */
function rate(part: number, whole: number): string {
  return whole === 0 ? '-' : `${((part / whole) * 100).toFixed(2)}%`;
}

/** A delta with its sign, so a column of them reads as a direction. */
function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

/**
 * Render the landscape.
 *
 * The population and the baseline come first, because a table of deltas over a denominator nobody wrote down is
 * the failure mode this screen exists to avoid. Every row is printed — the published version printed "the best of
 * each row" of its two-dimensional moves, which is a selection whose rule was whoever wrote the script.
 *
 * @param report - The report, from {@link screenGrid}.
 * @param shipped - The weights the dump was produced under, for the header.
 * @returns The table, newline-separated, no trailing newline.
 */
export function formatScreenReport(
  report: ScreenReport,
  shipped: readonly WeightMove[] = [],
): string {
  const lines: string[] = [];
  lines.push('The term-weight landscape — one screen over one dump, no engine');
  lines.push('='.repeat(78));
  lines.push(
    `  population: ${report.cases} cases scored, ${report.refused} refused` +
      ' (their triples do not rebuild their own score)',
  );
  if (shipped.length > 0) {
    lines.push(`  shipped:    ${shipped.map((move) => `${move.name} ${move.weight}`).join(', ')}`);
  }
  lines.push(
    `  baseline:   ${report.baseline} / ${report.cases} = ${rate(report.baseline, report.cases)}` +
      '   (dw = 0, the identity every row is read against)',
  );
  lines.push(
    `  gate:       Top@1 must not fall, and no family with n >= ${MIN_FAMILY_CASES} may lose a case`,
  );
  lines.push('');
  lines.push(
    `  ${'move'.padEnd(32)}${'Top@1'.padStart(7)}${'Δ'.padStart(5)}${'gain/loss'.padStart(11)}` +
      '  families that lose / verdict',
  );
  for (const row of report.rows) {
    // The losses below the floor are named as a remainder rather than dropped, so the row's own arithmetic adds up
    // on its face: `sum(listed) + remainder = lost`. Without it a row can read "no family above the floor lost a
    // case" while the `gain/loss` column says it lost one, and a reader has no way to see where the case went.
    const listed = row.losses.reduce((sum, loss) => sum + loss.lost.length, 0);
    const remainder = row.lost.length - listed;
    const below = remainder === 0 ? '' : ` (+${remainder} below the floor)`;
    const cost =
      row.losses.length === 0
        ? row.delta > 0
          ? `no family above the floor lost a case${below}  ADMISSIBLE`
          : 'nothing moved in either direction  NO-OP'
        : row.losses
            .map((loss) => `${loss.faultType} -${loss.lost.length} (n=${loss.cases})`)
            .join(', ') + below;
    lines.push(
      `  ${row.label.padEnd(32)}${String(row.after).padStart(7)}${signed(row.delta).padStart(5)}` +
        `${`${row.gained.length}/${row.lost.length}`.padStart(11)}  ${cost}`,
    );
  }
  // The net delta is a sum, and a sum is what the gate exists to distrust: `+13` can be `+25` against `-12`, which
  // is a move that made the engine worse at eight kinds of fault to be better on the average. The gross counts sit
  // in their own column so the arithmetic of a row is visible without recomputing it, and the verdict below is
  // decided on the LOSING side.
  const gaining = report.rows.filter((row) => row.admissible && row.delta > 0);
  const noOp = report.rows.filter((row) => row.admissible && row.delta === 0);
  lines.push('');
  lines.push(
    gaining.length === 0
      ? 'ADMISSIBLE SET: EMPTY — no point gains a case without taking one from a family with ' +
          `n >= ${MIN_FAMILY_CASES}`
      : `ADMISSIBLE SET: ${gaining.map((row) => row.label).join('; ')}`,
  );
  if (noOp.length > 0) {
    // Reported separately, because a point that neither gains nor loses satisfies "must not fall" by doing
    // nothing at all, and calling that admissible would let the identity stand as a policy.
    lines.push(
      `  and ${noOp.length} point(s) pass the gate by changing nothing (worth 0 cases): ` +
        noOp.map((row) => row.label).join(', '),
    );
  }
  return lines.join('\n');
}

/**
 * Read a grid from JSON.
 *
 * A file rather than a flag per point: a screen is only worth having if a new grid can be handed to it without
 * editing the tree, and a `--grid` string would be a second parser whose quoting rules nobody would remember.
 *
 * @param text - The file's contents: `[{ "label"?: string, "weights": { "term": number } }]`.
 * @returns The points, in file order.
 * @throws Error when the shape is not one this module writes, so a typo cannot screen a different grid.
 */
export function parseGridFile(text: string): GridPoint[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('the grid is not JSON');
  }
  if (!Array.isArray(raw)) throw new Error('the grid is not an array of points');
  const points: GridPoint[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry: unknown = raw[index];
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`grid point ${index} is not an object`);
    }
    const record = entry as Record<string, unknown>;
    const weights = record.weights;
    if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) {
      throw new Error(`grid point ${index} has no weights object`);
    }
    const moves: WeightMove[] = [];
    for (const [name, value] of Object.entries(weights as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`the weight of ${name} is not a finite number`);
      }
      moves.push({ name, weight: value });
    }
    if (moves.length === 0) throw new Error(`grid point ${index} moves nothing`);
    const label =
      typeof record.label === 'string' && record.label !== '' ? record.label : labelOf(moves);
    points.push({ label, moves });
  }
  return points;
}

/**
 * Parse the screen's arguments.
 *
 * @param argv - Arguments after the script name.
 * @returns The terms path and the grid path, the latter empty for {@link DEFAULT_GRID}.
 * @throws Error on an unknown flag or a missing value, so a typo cannot screen the wrong artifact.
 */
export function parseScreenArgs(argv: readonly string[]): { terms: string; grid: string } {
  let terms = '';
  let grid = '';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg !== '--terms' && arg !== '--grid') throw new Error(`unrecognised argument ${arg}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--terms') terms = value;
    else grid = value;
    index += 1;
  }
  if (terms === '') throw new Error('--terms is required');
  return { terms, grid };
}
