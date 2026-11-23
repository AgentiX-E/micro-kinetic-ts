/**
 * The engine-certainty guard: a resolver may not overwrite a first choice the engine itself did not hesitate over.
 *
 * ## What this is, and what it is not
 *
 * Iteration 331 refuted a guard keyed on the ANSWER's loudness — *"a resolver may not take an answer away from a head
 * that is itself loud"* — and the refutation was mechanical: loudness is the resolver's own premise read backwards, so
 * the two rules cannot both hold on one case. This guard reads a different quantity, and it reads it about the
 * **engine** rather than about the answer: the score margin between the engine's first and second candidate. A margin
 * of three is the engine saying it is not close; a resolver that renames such a case is overriding evidence it never
 * looked at.
 *
 * The two are therefore independent: a case can have a quiet answer (the front door's premise holds) and a decided
 * engine ranking (this guard holds), and that intersection is exactly the population where the front door has been
 * costing cases — measured at **12 of 81** overrides wrong on R1, with a median margin of 3.34 against 0.03 on the 69
 * it got right.
 *
 * ## Why the margin and not the rank gap
 *
 * A rank gap is discrete and ties are common; the corpus's own ranking is saturated at the top. The margin is the
 * quantity the engine already computed to place one candidate above another, it needs no new measurement, and — the
 * reason it can be a coefficient at all — it is comparable within a case and never across cases, so the bar is a
 * statement about one case's internal separation rather than about the corpus.
 *
 * @module benchmarks/engine-certainty
 */

import { foldOf } from './channel-split.js';

/** The margin at which the engine is treated as decided. A coefficient, so every reading states it. */
export const CERTAINTY_MARGIN = 1.5;

/** The margins to sweep. `null` is the shipped pipeline and is not a grid point. */
export const CERTAINTY_GRID: readonly number[] = [0.5, 1, 1.5, 2, 3, 4, 5];

/**
 * The gain each held-out fold must show, in cases.
 *
 * Four rather than the first-hop rule's seven, and the number is a statement about what this rule IS: a guard that
 * prevents damage does not find cases the way a rule that names them does, and its whole value is that its losses are
 * zero. The binding gate is therefore {@link MIN_CERTAINTY_PRECISION}; four is the floor that keeps a fold's reading
 * outside the run-to-run band of the endpoint (±10 cases is the measured band, so a fold's gain must clear a quarter
 * of it before the sign is worth reading).
 */
export const MIN_CERTAINTY_GAIN = 4;

/**
 * The precision the guard must show on the cases it moves.
 *
 * Higher than the first-hop rule's 0.75 because the comparison is asymmetric: that rule replaces a fallback and its
 * losses are new errors, while this one only refuses an existing override, so a break is a case the pipeline had right
 * and the guard took away. Nine in ten is the floor a "do no harm" statement has to clear.
 */
export const MIN_CERTAINTY_PRECISION = 0.9;

/** One case, in the fields this guard reads. */
export interface CertaintyCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  /** The answer the shipped surface settles on, before this guard. */
  readonly answer: string | null;
  /** The engine's own first choice, or `null` when the case carried no ranking. */
  readonly engineTop1: string | null;
  /** The score margin between the engine's first and second candidate, or `null` when it cannot be computed. */
  readonly margin: number | null;
}

/**
 * The answer the guard settles on.
 *
 * `null` is the shipped pipeline, byte for byte: a `null` margin is an UNMEASURED boundary rather than a zero, and the
 * guard refuses on it for the reason iteration 329 paid for — a rule that fires on an artifact which predates its
 * column is a rule whose most important clause was never checked.
 *
 * @param one - The case.
 * @param margin - The bar, or `null` to price the shipped pipeline.
 * @returns The settled answer.
 */
export function certaintyUnder(one: CertaintyCase, margin: number | null): string | null {
  if (margin === null) return one.answer;
  if (one.answer === null) return null;
  if (one.engineTop1 === null) return one.answer;
  if (one.margin === null) return one.answer;
  if (one.margin <= margin) return one.answer;
  if (one.answer === one.engineTop1) return one.answer;
  return one.engineTop1;
}

/** One bar's reading. */
export interface CertaintyBar {
  readonly margin: number;
  readonly correct: readonly [number, number];
  readonly repairs: number;
  readonly breaks: number;
}

/** What the held-out reading concluded. */
export interface CertaintyValidation {
  readonly sizes: readonly [number, number];
  /** Correct cases under the SHIPPED surface, per fold. */
  readonly shipped: readonly [number, number];
  readonly sweep: readonly CertaintyBar[];
  readonly selected: readonly [number, number];
  readonly heldOut: readonly [number, number];
  readonly deltas: readonly [number, number];
  readonly precision: readonly [number, number];
  readonly reasons: readonly string[];
  readonly passes: boolean;
}

/** Which fold each case landed in, by family and parity — the partition every axis here shares. */
function foldsOf(cases: readonly CertaintyCase[]): (0 | 1)[] {
  const seen = new Map<string, number>();
  return cases.map((one) => {
    const index = seen.get(one.faultType) ?? 0;
    seen.set(one.faultType, index + 1);
    return foldOf(one.faultType, index);
  });
}

/**
 * Price the guard as a held-out reading.
 *
 * @param cases - The corpus, in the artifact's own order.
 * @param grid - The margins to sweep, ascending.
 * @param minGain - The gain each fold must show.
 * @param minPrecision - The calibration floor at each chosen cell.
 * @returns The reading, its refusals, and whether it passes.
 */
export function crossValidateCertainty(
  cases: readonly CertaintyCase[],
  grid: readonly number[],
  minGain: number,
  minPrecision: number,
): CertaintyValidation {
  const fold = foldsOf(cases);
  const sizes: [number, number] = [0, 0];
  const shipped: [number, number] = [0, 0];
  for (let index = 0; index < cases.length; index += 1) {
    const one = cases[index]!;
    const side = fold[index]!;
    sizes[side] += 1;
    const settled = certaintyUnder(one, null);
    if (settled !== null && one.truth.includes(settled)) shipped[side] += 1;
  }
  const sweep: CertaintyBar[] = grid.map((margin) => {
    const correct: [number, number] = [0, 0];
    let repairs = 0;
    let breaks = 0;
    for (let index = 0; index < cases.length; index += 1) {
      const one = cases[index]!;
      const side = fold[index]!;
      const before = certaintyUnder(one, null);
      const after = certaintyUnder(one, margin);
      const was = before !== null && one.truth.includes(before);
      const now = after !== null && one.truth.includes(after);
      if (now) correct[side] += 1;
      if (!was && now) repairs += 1;
      if (was && !now) breaks += 1;
    }
    return { margin, correct, repairs, breaks };
  });
  const selected: [number, number] = [pick(sweep, 0), pick(sweep, 1)];
  const heldOut: [number, number] = [
    sweep[grid.indexOf(selected[1])]!.correct[0],
    sweep[grid.indexOf(selected[0])]!.correct[1],
  ];
  const deltas: [number, number] = [heldOut[0] - shipped[0], heldOut[1] - shipped[1]];
  const precision: [number, number] = [
    calibration(sweep[grid.indexOf(selected[0])]!),
    calibration(sweep[grid.indexOf(selected[1])]!),
  ];
  const reasons: string[] = [];
  if (deltas[0] < minGain) reasons.push(`fold 0 gains ${deltas[0]}`);
  if (deltas[1] < minGain) reasons.push(`fold 1 gains ${deltas[1]}`);
  const apart = Math.abs(grid.indexOf(selected[0]) - grid.indexOf(selected[1]));
  if (apart > 1) reasons.push('the folds chose margins more than one step apart');
  const last = grid.length - 1;
  if ([0, last].some((edge) => selected[0] === grid[edge] || selected[1] === grid[edge])) {
    reasons.push('the chosen margin is on the grid corner, so it is unmeasured');
  }
  if (Math.min(...precision) < minPrecision) {
    reasons.push(
      `precision ${precision.map((one) => one.toFixed(3)).join(' / ')} is below ${minPrecision}`,
    );
  }
  return {
    sizes,
    shipped,
    sweep,
    selected,
    heldOut,
    deltas,
    precision,
    reasons,
    passes: reasons.length === 0,
  };
}

/** The margin one fold chose: the most correct cases on that half, ties to the tighter guard. */
function pick(sweep: readonly CertaintyBar[], side: 0 | 1): number {
  let best = sweep[0]!;
  for (const one of sweep) if (one.correct[side] > best.correct[side]) best = one;
  return best.margin;
}

/** The precision of one margin's firing population; a guard that moves nothing is inert, not miscalibrated. */
function calibration(one: CertaintyBar): number {
  const total = one.repairs + one.breaks;
  return total === 0 ? 1 : one.repairs / total;
}

/**
 * The report.
 *
 * @param reading - The held-out reading.
 * @returns The reading as one string, so a caller cannot print half of it.
 */
export function formatCertaintyReport(reading: CertaintyValidation): string {
  const lines: string[] = [];
  lines.push('P1/P2/P3 -- held out, selected on one fold and read on the other');
  lines.push('  margin  fold0  fold1   repairs  breaks');
  for (const one of reading.sweep) {
    lines.push(
      `  ${one.margin.toFixed(1).padStart(6)}  ${String(one.correct[0]).padStart(5)}  ` +
        `${String(one.correct[1]).padStart(5)}   ${String(one.repairs).padStart(7)}  ` +
        `${String(one.breaks).padStart(6)}`,
    );
  }
  lines.push(
    `  shipped ${reading.shipped[0]} / ${reading.shipped[1]}, chosen ` +
      `${reading.selected[0]} / ${reading.selected[1]}, held out ` +
      `${reading.heldOut[0]} / ${reading.heldOut[1]}, delta ${reading.deltas[0]} / ${reading.deltas[1]}`,
  );
  lines.push('');
  lines.push(`P4 -- precision ${reading.precision.map((one) => one.toFixed(3)).join(' / ')}`);
  lines.push(
    reading.passes
      ? 'verdict: passes every clause'
      : `verdict: does not pass -- ${reading.reasons.join('; ')}`,
  );
  return lines.join('\n');
}
