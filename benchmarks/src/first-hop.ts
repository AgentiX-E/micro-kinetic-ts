/**
 * The first hop: when requests fail as they enter the system, the door is the answer.
 *
 * ## The statement, and why it is a boundary rather than a coefficient
 *
 * §320 of the register refused every form of "make the entry point's own numbers louder", and it gave the reason as
 * arithmetic: the entry sits 18–45 metric ranks below the winner in the cases that matter, a log-space gap of about
 * 0.18–0.45 against a term whose admissible contribution is at most 0.005. That refusal is about the SCORE. This rule
 * does not touch the score, does not promote the entry in any ranking, and does not read the entry's numbers to do its
 * work: it reads the case's **failure boundary** — whether any edge below the door failed, whether a child of the door
 * reported errors, and how many requests failed on the edge that enters the system — and when the failure never
 * travelled below the door, it overrides the answers of every channel.
 *
 * ## Why the count and not a rate
 *
 * The edge carries the load generator's whole traffic and its denominator is in no artifact this programme publishes.
 * A count is what the corpus records, it is comparable across cases because the load profile is fixed, and a rate
 * would need a denominator nobody measured.
 *
 * ## Why every unmeasured column refuses
 *
 * `entryChildErrors = null` and `belowFails = null` are the producer's refusals, not measured zeroes: a premise
 * written with comparisons alone would fire on every row of an artifact that predates the columns, and this programme
 * has paid for that mistake once already (329).
 *
 * @module benchmarks/first-hop
 */

import { foldOf } from './channel-split.js';

/** The gain, in cases, the rule must produce on EACH held-out fold. Seven is the reference improvement. */
export const MIN_FIRST_HOP_GAIN = 7;

/**
 * The precision the rule must show on the population it fires on.
 *
 * 328 derived the corpus's base-rate law: a single pooled rule needs precision **0.813** to break even against the
 * fallback it invokes. The gate here is 0.75 rather than 0.813 because the comparison is not the same one — this rule
 * is measured against the shipped answers case by case, and its losses are counted, not inferred. The number is
 * therefore stated as a calibration floor rather than as the law's own constant, and the register records both.
 */
export const MIN_FIRST_HOP_PRECISION = 0.75;

/** The bars the sweep reads, in failures on the edge into the entry. */
export const BETA_GRID: readonly number[] = [0, 5, 10, 25, 50, 100, 200, 400, 800];

/** One case, in the fields this rule reads. */
export interface HopCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  /** Largest symptom rise among the entry's callees, or `null` when the column was never measured. */
  readonly entryChildErrors: number | null;
  /** Whether a measured edge below the entry failed, or `null` when the column was never measured. */
  readonly belowFails: boolean | null;
  /** Failures above the pre-injection baseline on the edge into the entry, or `null` when never measured. */
  readonly inboundFails: number | null;
}

/**
 * Whether the case's failure never travelled below the door.
 *
 * Six refusals, each a different statement: a child that errored says the failure travelled; `belowFails` says the
 * same of a measured edge; both `null` columns are unmeasured rather than zero; and a case with no entry or no answer
 * has nothing for the rule to name or to replace.
 *
 * @param one - The case.
 * @returns True when the boundary says the failure stopped at the door.
 */
export function premiseHolds(one: HopCase): boolean {
  if (one.entry === null) return false;
  if (one.answer === null) return false;
  if (one.entryChildErrors !== 0) return false;
  if (one.belowFails !== false) return false;
  return true;
}

/**
 * Whether the rule speaks.
 *
 * @param one - The case.
 * @param beta - The bar, or `null` for the shipped pipeline.
 * @returns True when the failure stopped at the door AND the edge into it failed above the bar.
 */
export function doorSpeaks(one: HopCase, beta: number | null): boolean {
  if (beta === null) return false;
  if (!premiseHolds(one)) return false;
  if (one.answer === one.entry) return false;
  if (one.inboundFails === null) return false;
  return one.inboundFails > beta;
}

/**
 * The answer a case settles on.
 *
 * `beta === null` is the shipped surface, byte for byte.
 *
 * @param one - The case.
 * @param beta - The bar, or `null`.
 * @returns The settled answer.
 */
export function firstHopUnder(one: HopCase, beta: number | null): string | null {
  if (!doorSpeaks(one, beta)) return one.answer;
  return one.entry;
}

/** One bar's reading. */
export interface FirstHopBar {
  readonly beta: number;
  readonly correct: readonly [number, number];
  readonly repairs: number;
  readonly breaks: number;
}

/** What the held-out reading concluded. */
export interface FirstHopValidation {
  readonly sizes: readonly [number, number];
  /** Correct cases under the SHIPPED surface, per fold. */
  readonly mixed: readonly [number, number];
  readonly sweep: readonly FirstHopBar[];
  readonly selected: readonly [number, number];
  readonly heldOut: readonly [number, number];
  readonly deltas: readonly [number, number];
  /** `repairs / (repairs + breaks)` at each fold's chosen cell, or `1` when that cell fires on nothing. */
  readonly precision: readonly [number, number];
  /** Cases the rule changed although the boundary premise does not hold. Must be zero. */
  readonly firedOutsidePopulation: number;
  readonly reasons: readonly string[];
  readonly passes: boolean;
}

/** Which fold each case landed in, by family and parity — the partition every axis here shares. */
function foldsOf(cases: readonly HopCase[]): (0 | 1)[] {
  const seen = new Map<string, number>();
  return cases.map((one) => {
    const index = seen.get(one.faultType) ?? 0;
    seen.set(one.faultType, index + 1);
    return foldOf(one.faultType, index);
  });
}

/**
 * Price the rule as a held-out reading.
 *
 * @param cases - The corpus, in the artifact's own order.
 * @param grid - The bars to sweep, ascending.
 * @param minGain - The gain each fold must show.
 * @param minPrecision - The calibration floor at each chosen cell.
 * @returns The reading, its refusals, and whether it passes.
 */
export function crossValidateFirstHop(
  cases: readonly HopCase[],
  grid: readonly number[],
  minGain: number,
  minPrecision: number,
): FirstHopValidation {
  const fold = foldsOf(cases);
  const sizes: [number, number] = [0, 0];
  const mixed: [number, number] = [0, 0];
  for (let index = 0; index < cases.length; index += 1) {
    const one = cases[index]!;
    const side = fold[index]!;
    sizes[side] += 1;
    const shipped = firstHopUnder(one, null);
    if (shipped !== null && one.truth.includes(shipped)) mixed[side] += 1;
  }
  const sweep: FirstHopBar[] = grid.map((beta) => {
    const correct: [number, number] = [0, 0];
    let repairs = 0;
    let breaks = 0;
    for (let index = 0; index < cases.length; index += 1) {
      const one = cases[index]!;
      const side = fold[index]!;
      const shipped = firstHopUnder(one, null);
      const settled = firstHopUnder(one, beta);
      const wasRight = shipped !== null && one.truth.includes(shipped);
      const isRight = settled !== null && one.truth.includes(settled);
      if (isRight) correct[side] += 1;
      if (!wasRight && isRight) repairs += 1;
      if (wasRight && !isRight) breaks += 1;
    }
    return { beta, correct, repairs, breaks };
  });
  const selected: [number, number] = [pick(sweep, 0), pick(sweep, 1)];
  const heldOut: [number, number] = [
    sweep[grid.indexOf(selected[1])]!.correct[0],
    sweep[grid.indexOf(selected[0])]!.correct[1],
  ];
  const deltas: [number, number] = [heldOut[0] - mixed[0], heldOut[1] - mixed[1]];
  const precision: [number, number] = [
    calibration(sweep[grid.indexOf(selected[0])]!),
    calibration(sweep[grid.indexOf(selected[1])]!),
  ];
  const outside = cases.filter(
    (one) => !premiseHolds(one) && firstHopUnder(one, selected[0]) !== one.answer,
  );
  const reasons: string[] = [];
  if (deltas[0] < minGain) reasons.push(`fold 0 gains ${deltas[0]}`);
  if (deltas[1] < minGain) reasons.push(`fold 1 gains ${deltas[1]}`);
  const apart = Math.abs(grid.indexOf(selected[0]) - grid.indexOf(selected[1]));
  if (apart > 1) reasons.push('the folds chose bars more than one step apart');
  const last = grid.length - 1;
  if ([0, last].some((edge) => selected[0] === grid[edge] || selected[1] === grid[edge])) {
    reasons.push('the chosen bar is on the grid corner, so it is unmeasured');
  }
  if (Math.min(...precision) < minPrecision) {
    reasons.push(
      `precision ${precision.map((one) => one.toFixed(3)).join(' / ')} is below ${minPrecision}`,
    );
  }
  return {
    sizes,
    mixed,
    sweep,
    selected,
    heldOut,
    deltas,
    precision,
    firedOutsidePopulation: outside.length,
    reasons,
    passes: reasons.length === 0,
  };
}

/** The bar one fold chose: the most correct cases on that half, ties to the narrower bar. */
function pick(sweep: readonly FirstHopBar[], side: 0 | 1): number {
  let best = sweep[0]!;
  for (const one of sweep) if (one.correct[side] > best.correct[side]) best = one;
  return best.beta;
}

/**
 * The precision of one bar's firing population.
 *
 * A bar that fires on nothing reads `1`: it repaired nothing and broke nothing, so it is not miscalibrated, it is
 * inert — and inertness is what the gain gate is for.
 */
function calibration(one: FirstHopBar): number {
  const total = one.repairs + one.breaks;
  return total === 0 ? 1 : one.repairs / total;
}

/**
 * The report.
 *
 * @param reading - The held-out reading.
 * @returns The report as one string, so a caller cannot print half of it.
 */
export function formatFirstHopReport(reading: FirstHopValidation): string {
  const lines: string[] = [];
  lines.push('P1/P2/P3 -- held out, selected on one fold and read on the other');
  lines.push('  beta   fold0  fold1   repairs  breaks');
  for (const one of reading.sweep) {
    lines.push(
      `  ${String(one.beta).padStart(4)}   ${String(one.correct[0]).padStart(5)}  ` +
        `${String(one.correct[1]).padStart(5)}   ${String(one.repairs).padStart(7)}  ` +
        `${String(one.breaks).padStart(6)}`,
    );
  }
  lines.push(
    `  shipped ${reading.mixed[0]} / ${reading.mixed[1]}, chosen ${reading.selected[0]} / ${reading.selected[1]}, ` +
      `held out ${reading.heldOut[0]} / ${reading.heldOut[1]}, delta ${reading.deltas[0]} / ${reading.deltas[1]}`,
  );
  lines.push('');
  lines.push(`P4 -- precision ${reading.precision.map((one) => one.toFixed(3)).join(' / ')}`);
  lines.push(`P5 -- fired outside the population ${reading.firedOutsidePopulation}`);
  lines.push(
    reading.passes
      ? 'verdict: passes every clause'
      : `verdict: does not pass -- ${reading.reasons.join('; ')}`,
  );
  return lines.join('\n');
}
