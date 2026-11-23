/**
 * The channel split, priced as a HELD-OUT reading.
 *
 * ## What this module exists to prevent
 *
 * The split's first pricing read **1 277** at one bar against 1 270 at none, and the sweep around that bar read
 * **1 248, 1 274, 1 277, 1 269, 1 260, 1 250**. A peak at one value on one corpus is the signature of a parameter
 * fitted to the cases it is then scored on, and this programme has already refused that shape twice (321's margin
 * sweep, 324's overshoot gate). So the axis is not shipped on its in-sample maximum. It is shipped only if a bar
 * chosen on one half of the corpus still pays on the other half, in BOTH directions, and if the two halves choose
 * bars within one grid step of each other.
 *
 * ## Why the folds are by family and parity
 *
 * A hash of the datapack would do, and it would let one fold carry a family the other does not — which makes the
 * held-out reading a statement about the FAMILIES in it rather than about the rule. The fold is therefore
 * `(hash(family) + index-in-family) mod 2`: both folds carry every family, in as even a split as the family's size
 * allows, and no fold is chosen after a number is seen.
 *
 * ## Why the profiles come from a corpus walk and not from the artifact
 *
 * Because the answer is a property of a DISPATCH and the profile is a property of the CASE. Walking once writes
 * every service's channel profile for all 1 422 cases, and every bar in the sweep — and every future policy, and
 * both sides of every fallback — is then priced against that one file at zero cost. A pricing that needed a
 * dispatch per bar would price one bar.
 *
 * @module benchmarks/channel-split
 */

import type { ChannelDeparture } from './channel-kind.js';
import { conduitUnder, departureOf, trafficOnly } from './channel-kind.js';
import {
  ENTRY_PRIOR_SURPRISE,
  entryAttribution,
  entryPremise,
  interfaceAttribution,
} from './query-agent.js';

/**
 * The bars the sweep reads, in units of a service's own pre-window spread.
 *
 * The same six values the earlier pricing swept, kept rather than tightened: a grid that moved with the previous
 * peak would be a second selection on top of the first.
 */
export const KAPPA_GRID: readonly number[] = [30, 100, 200, 300, 500, 750];

/** The gain, in cases, a bar must produce on EACH held-out fold. Seven is the size of the reference improvement. */
export const MIN_CHANNEL_GAIN = 7;

/**
 * The error-rate floors the CONDITIONED rule is swept over, in errors per request.
 *
 * Rates rather than standardised units, because that is the measurand: an error rate is flat at zero before the
 * injection, so its pre-window has no spread to divide by and the standardised rise refuses on exactly the series
 * the clause is for. A floor of one hundredth of a percent is the smallest rise this corpus can be expected to
 * distinguish; a quarter is the largest that a real failing service would not already exceed.
 */
export const SYMPTOM_GRID: readonly number[] = [0.0001, 0.001, 0.01, 0.05, 0.1];

/**
 * The precision a conditioning column must reach to be worth sweeping.
 *
 * **Not a number invented here.** 328 derived the corpus's base-rate law: a single pooled bar needs precision
 * **0.813** to break even against the fallback it invokes, and the reachable/at-risk split needs **0.68**. That is
 * the number this module reads, so the separability criterion and the pricing it gates are stated in one currency.
 */
export const MIN_SEPARATION_PRECISION = 0.68;

/** One case, in the fields the rule reads. `QueryArmRow` and `PriceableRow` both satisfy it structurally. */
export interface SplitCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  /** The answer the artifact published, i.e. already renamed by whatever resolver that run dispatched. */
  readonly answer: string | null;
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  readonly belowFails: boolean | null;
  readonly answerSurprise: number | null;
  /** The witness's caller for this case, or `null`. Read so the priced surface is `applyResolver`, not a subset. */
  readonly novelCaller: string | null;
  /** That interface's novel-call count, or `null`. */
  readonly novelRise: number | null;
}

/** Every case's service profiles, keyed by datapack and then by service id. */
export type Profiles = ReadonlyMap<string, ReadonlyMap<string, ChannelDeparture>>;

/** The part of an artifact row this axis reads. `QueryArmRow` satisfies it structurally. */
export interface ArmRow {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  readonly entryChildErrors: number | null;
  readonly belowFails: boolean | null;
  readonly rawAnswer: string | null;
  /** The model's own departure, recorded per SIDE. */
  readonly rawSurprise: number | null;
  /** The prior's departure, on the same measurement. */
  readonly priorSurprise: number | null;
  readonly novelCaller: string | null;
  readonly novelRise: number | null;
}

/**
 * Read an artifact row as a case, on the side the answer actually came from.
 *
 * ## The defect this exists to prevent, which shipped for one dispatch
 *
 * The artifact records the surprise per SIDE (`rawSurprise`, `priorSurprise`) and has no `answerSurprise` key at
 * all. Reading a row through this module's own `SplitCase` shape therefore produced `undefined` in every row, and
 * `entryAttribution` narrows that field by MEASUREMENT (`Number.isFinite`) precisely so an older artifact cannot
 * fire — so the rule refused on all 1 422 rows, every bar of the sweep read exactly the shipped surface, and the
 * table looked like a refuted hypothesis rather than like an instrument that was never connected.
 *
 * TypeScript could not catch it because `readNdjson<T>` asserts a shape it does not check. The guard is therefore
 * at the boundary: a row carrying NEITHER column is refused by name, because a null and an absent key mean
 * different things and only one of them is a measurement.
 *
 * @param row - The artifact row.
 * @returns The case, with `answerSurprise` read on the settled side.
 * @throws When the row carries neither surprise column at all.
 */
export function toSplitCase(row: ArmRow): SplitCase {
  // Read as an unvalidated record for the guard, because the declared type says the columns exist and the runtime
  // is what decides: `readNdjson<T>` asserts a shape it never checks, which is the hole this function closes.
  const columns = row as unknown as Record<string, unknown>;
  if (!('rawSurprise' in columns) && !('priorSurprise' in columns)) {
    throw new Error(
      `${String(columns.datapack)}: the row carries no surprise column, so this artifact predates the axis it is being priced on`,
    );
  }
  const settledIsTheModels = row.answer !== null && row.answer === row.rawAnswer;
  const answerSurprise = settledIsTheModels
    ? (row.rawSurprise ?? null)
    : (row.priorSurprise ?? row.rawSurprise ?? null);
  return {
    datapack: row.datapack,
    faultType: row.faultType,
    truth: row.truth,
    answer: row.answer,
    entry: row.entry,
    entryChildErrors: row.entryChildErrors,
    belowFails: row.belowFails,
    answerSurprise,
    novelCaller: row.novelCaller,
    novelRise: row.novelRise,
  };
}

/** One bar's reading. */
export interface KappaReading {
  readonly kappa: number;
  /** Correct cases in each fold, in fold order. */
  readonly correct: readonly [number, number];
  /** Cases the bar turned from wrong into right, across both folds. */
  readonly repairs: number;
  /** Cases it turned from right into wrong. */
  readonly breaks: number;
}

/** What the two-fold cross-validation concluded. */
export interface CrossValidation {
  /** Cases in each fold, in fold order. A fold of zero is a reading of nothing and cannot pass. */
  readonly sizes: readonly [number, number];
  /** Correct cases under the SHIPPED surface, per fold. The comparison every bar is measured against. */
  readonly mixed: readonly [number, number];
  readonly sweep: readonly KappaReading[];
  /** The bar each fold chose, in fold order: `[chosen on fold 0, chosen on fold 1]`. */
  readonly selected: readonly [number, number];
  /** The reading on each fold under the bar chosen on the OTHER fold. The published number is their mean. */
  readonly heldOut: readonly [number, number];
  /** `heldOut − mixed`, per fold. */
  readonly deltas: readonly [number, number];
  readonly passes: boolean;
}

/**
 * A 32-bit FNV-1a of a string.
 *
 * Written here rather than taken from a library because the only use is a fold assignment, and a fold that changed
 * with a dependency's version would change the published reading without changing the corpus.
 *
 * @param text - The string to hash.
 * @returns An unsigned 32-bit hash.
 */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // The multiply is FNV's prime, 16 777 619, spelled with shifts so it stays inside 32 bits.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Which fold a case lands in.
 *
 * @param faultType - The case's fault family.
 * @param indexInFamily - Its position within that family, in the artifact's own order.
 * @returns `0` or `1`.
 */
export function foldOf(faultType: string, indexInFamily: number): 0 | 1 {
  return (((stableHash(faultType) & 1) ^ (indexInFamily & 1)) === 0 ? 0 : 1) as 0 | 1;
}

/**
 * The answer a case settles on under one bar.
 *
 * `null` is the disabled state: it is the rule as iterations 324–327 shipped it, and it is the column the
 * comparison is read against. Anything else extends the prior's reach to an answer whose departure lives only in
 * the traffic channel.
 *
 * @param one - The case.
 * @param profiles - Every case's service profiles.
 * @param kappa - The resource ceiling, or `null` to price the shipped rule.
 * @returns The settled answer, which is `one.answer` when the rule does not fire.
 */
export function resolvedUnder(
  one: SplitCase,
  profiles: Profiles,
  kappa: number | null,
  symptomFloor: number | null = null,
): string | null {
  const evidence = {
    entry: one.entry,
    entryChildErrors: one.entryChildErrors,
    answerSurprise: one.answerSurprise,
    belowFails: one.belowFails,
    answerChannels: null,
    novelCaller: one.novelCaller,
    novelRise: one.novelRise,
  };
  // The witness first and, when it speaks, alone: `applyResolver` returns on it rather than letting the front door
  // read a second time. A pricing that let the bar re-name the witness's answer would be pricing a resolver this
  // repository does not ship.
  const witnessed = interfaceAttribution(one.answer, evidence);
  if (witnessed !== null) return witnessed;
  const departure =
    one.answer === null ? null : (profiles.get(one.datapack)?.get(one.answer) ?? null);
  return (
    entryAttribution(
      one.answer,
      { ...evidence, answerChannels: departure },
      ENTRY_PRIOR_SURPRISE,
      kappa,
      symptomFloor,
    ) ?? one.answer
  );
}

/** How many cases a bar gets right, across the whole corpus. */
export function correctUnder(
  rows: readonly SplitCase[],
  profiles: Profiles,
  kappa: number | null,
): number {
  let correct = 0;
  for (const one of rows) {
    const answer = resolvedUnder(one, profiles, kappa);
    if (answer !== null && one.truth.includes(answer)) correct += 1;
  }
  return correct;
}

/**
 * Which fold each row lands in, in the corpus's own order.
 *
 * One implementation for both pricings, because a conditioned sweep that assigned folds differently from the pooled
 * one would report two readings of two corpora and call them one comparison.
 *
 * @param rows - The corpus, in artifact order.
 * @returns One fold per row.
 */
export function foldAssignments(rows: readonly SplitCase[]): (0 | 1)[] {
  const seen = new Map<string, number>();
  const folds: (0 | 1)[] = [];
  for (const one of rows) {
    const index = seen.get(one.faultType) ?? 0;
    seen.set(one.faultType, index + 1);
    folds.push(foldOf(one.faultType, index));
  }
  return folds;
}

/**
 * Price every bar on both folds, then swap them.
 *
 * The selection is `argmax` over the sweep on the fold being SELECTED ON, with a tie broken towards the smaller
 * bar so the same grid always reports the same selection. The published reading is the held-out one, never the
 * selection one.
 *
 * @param rows - The corpus.
 * @param profiles - Every case's service profiles.
 * @param grid - The bars to sweep, ascending.
 * @param minGain - The gain each held-out fold must show.
 * @returns The report, whose `passes` is the only field that decides whether the bar ships.
 */
export function crossValidate(
  rows: readonly SplitCase[],
  profiles: Profiles,
  grid: readonly number[] = KAPPA_GRID,
  minGain: number = MIN_CHANNEL_GAIN,
): CrossValidation {
  const foldOfRow = foldAssignments(rows);
  const sizes: [number, number] = [0, 0];
  for (const fold of foldOfRow) sizes[fold] += 1;

  // The shipped surface, per fold, and each case's status under it — the baseline repairs and breaks are counted
  // against.
  const mixedCorrect: [number, number] = [0, 0];
  const base: boolean[] = [];
  rows.forEach((one, index) => {
    const answer = resolvedUnder(one, profiles, null);
    const hit = answer !== null && one.truth.includes(answer);
    base.push(hit);
    if (hit) mixedCorrect[foldOfRow[index]!] += 1;
  });

  const sweep: KappaReading[] = grid.map((kappa) => {
    const correct: [number, number] = [0, 0];
    let repairs = 0;
    let breaks = 0;
    rows.forEach((one, index) => {
      const answer = resolvedUnder(one, profiles, kappa);
      const hit = answer !== null && one.truth.includes(answer);
      if (hit) correct[foldOfRow[index]!] += 1;
      if (hit && !base[index]!) repairs += 1;
      if (!hit && base[index]!) breaks += 1;
    });
    return { kappa, correct, repairs, breaks };
  });

  /** The bar this fold would choose, ties going to the smaller kappa. */
  const choose = (fold: 0 | 1): number => {
    let best = sweep[0]!;
    for (const one of sweep) if (one.correct[fold] > best.correct[fold]) best = one;
    return best.kappa;
  };
  const selected: [number, number] = [choose(0), choose(1)];
  const at = (kappa: number, fold: 0 | 1): number =>
    sweep.find((one) => one.kappa === kappa)!.correct[fold];
  // Each fold is read under the bar the OTHER fold chose, which is the whole point of the swap.
  const heldOut: [number, number] = [at(selected[1], 0), at(selected[0], 1)];
  const deltas: [number, number] = [heldOut[0] - mixedCorrect[0], heldOut[1] - mixedCorrect[1]];
  const step = Math.abs(grid.indexOf(selected[0]) - grid.indexOf(selected[1]));
  const passes =
    sizes[0] > 0 && sizes[1] > 0 && deltas[0] >= minGain && deltas[1] >= minGain && step <= 1;
  return { sizes, mixed: mixedCorrect, sweep, selected, heldOut, deltas, passes };
}

/**
 * A case the front door's rule addresses: every premise holds, and the answer is therefore a NAME.
 *
 * The second half is not a separate clause but a consequence — `entryPremise` refuses a null answer — and it is
 * carried as a type so that a reader of the population cannot re-test it: an `answer === null` branch inside the
 * separation count would be a branch no case can reach, which is a dead branch wearing a guard's clothes.
 */
export type AddressedCase = SplitCase & { readonly answer: string };

/**
 * Whether the front door's premise holds for one case, read through the resolver's own function.
 *
 * This is the POPULATION definition, and it is the number every population table in the register is stated against
 * (74 reachable, 153 at risk as of 328). It reads `entryPremise` rather than restating the six clauses because the
 * alternative — a pricing that restated them — is how a rule comes to be priced by one implementation and shipped by
 * another.
 *
 * The two clauses outside the premise are the rule's own: the answer must have MOVED past the prior's threshold for
 * a bar to be consulted at all, and the witness must be silent, because `applyResolver` returns on the witness rather
 * than letting the front door read a second time.
 *
 * @param one - The case.
 * @returns True when the rule addresses this case before any bar is chosen.
 */
export function gateHolds(one: SplitCase): one is AddressedCase {
  if (one.novelCaller !== null) return false;
  if (!Number.isFinite(one.answerSurprise)) return false;
  if (one.answerSurprise! <= ENTRY_PRIOR_SURPRISE) return false;
  return (
    entryPremise(one.answer, {
      entry: one.entry,
      entryChildErrors: one.entryChildErrors,
      answerSurprise: one.answerSurprise,
      belowFails: one.belowFails,
      answerChannels: null,
    }) !== null
  );
}

/** One cell of the conditioned sweep: a resource ceiling and an error-rate floor. */
export interface CellReading {
  readonly kappa: number;
  readonly floor: number;
  /** Correct cases in each fold, in fold order. */
  readonly correct: readonly [number, number];
  readonly repairs: number;
  readonly breaks: number;
}

/** What the conditioned two-fold cross-validation concluded. */
export interface ConditionalValidation {
  readonly sizes: readonly [number, number];
  readonly mixed: readonly [number, number];
  /** Every cell, ordered by `kappa` then `floor`, so a report's rows are a function of the grids. */
  readonly cells: readonly CellReading[];
  /** The cell each fold chose, in fold order. */
  readonly selected: readonly [CellReading, CellReading];
  readonly heldOut: readonly [number, number];
  readonly deltas: readonly [number, number];
  readonly passes: boolean;
}

/**
 * Price the CONDITIONED rule on both folds, then swap them.
 *
 * The decision rule is 328's, extended by exactly one clause: the two folds' selected cells must lie within one grid
 * step **in both coordinates**. The second coordinate is not decoration — the pooled sweep was six cells and this one
 * is thirty, and a selection over thirty cells needs a stability test that scales with it.
 *
 * @param rows - The corpus.
 * @param profiles - Every case's service profiles.
 * @param kappaGrid - The resource ceilings, ascending.
 * @param floorGrid - The error-rate floors, ascending.
 * @param minGain - The gain each held-out fold must show.
 * @returns The report, whose `passes` is the only field that decides whether the conditioned rule ships.
 */
export function crossValidateConditioned(
  rows: readonly SplitCase[],
  profiles: Profiles,
  kappaGrid: readonly number[] = KAPPA_GRID,
  floorGrid: readonly number[] = SYMPTOM_GRID,
  minGain: number = MIN_CHANNEL_GAIN,
): ConditionalValidation {
  const foldOfRow = foldAssignments(rows);
  const sizes: [number, number] = [0, 0];
  for (const fold of foldOfRow) sizes[fold] += 1;

  const mixedCorrect: [number, number] = [0, 0];
  const base: boolean[] = [];
  rows.forEach((one, index) => {
    const answer = resolvedUnder(one, profiles, null);
    const hit = answer !== null && one.truth.includes(answer);
    base.push(hit);
    if (hit) mixedCorrect[foldOfRow[index]!] += 1;
  });

  const cells: CellReading[] = [];
  for (const kappa of kappaGrid) {
    for (const floor of floorGrid) {
      const correct: [number, number] = [0, 0];
      let repairs = 0;
      let breaks = 0;
      rows.forEach((one, index) => {
        const answer = resolvedUnder(one, profiles, kappa, floor);
        const hit = answer !== null && one.truth.includes(answer);
        if (hit) correct[foldOfRow[index]!] += 1;
        if (hit && !base[index]!) repairs += 1;
        if (!hit && base[index]!) breaks += 1;
      });
      cells.push({ kappa, floor, correct, repairs, breaks });
    }
  }

  /** The cell this fold would choose: most correct, ties to the smaller bar and then the smaller floor. */
  const choose = (fold: 0 | 1): CellReading => {
    let best = cells[0]!;
    for (const one of cells) if (one.correct[fold] > best.correct[fold]) best = one;
    return best;
  };
  const selected: [CellReading, CellReading] = [choose(0), choose(1)];
  const at = (kappa: number, floor: number, fold: 0 | 1): number =>
    cells.find((one) => one.kappa === kappa && one.floor === floor)!.correct[fold];
  const heldOut: [number, number] = [
    at(selected[1].kappa, selected[1].floor, 0),
    at(selected[0].kappa, selected[0].floor, 1),
  ];
  const deltas: [number, number] = [heldOut[0] - mixedCorrect[0], heldOut[1] - mixedCorrect[1]];
  const kappaStep = Math.abs(
    kappaGrid.indexOf(selected[0].kappa) - kappaGrid.indexOf(selected[1].kappa),
  );
  const floorStep = Math.abs(
    floorGrid.indexOf(selected[0].floor) - floorGrid.indexOf(selected[1].floor),
  );
  const passes =
    sizes[0] > 0 &&
    sizes[1] > 0 &&
    deltas[0] >= minGain &&
    deltas[1] >= minGain &&
    kappaStep <= 1 &&
    floorStep <= 1;
  return { sizes, mixed: mixedCorrect, cells, selected, heldOut, deltas, passes };
}

/** One floor's separation reading. */
export interface SeparationReading {
  readonly floor: number;
  /** Cases the rule is FOR that the condition admits. */
  readonly reachable: number;
  /** Cases it must not fire on that the condition admits. */
  readonly atRisk: number;
  /** `reachable / (reachable + atRisk)`, or `null` when the condition admits nothing. */
  readonly precision: number | null;
}

/** Whether a conditioning column separates the two populations it is being asked to cut. */
export interface Separation {
  readonly kappa: number;
  readonly reachableTotal: number;
  readonly atRiskTotal: number;
  readonly readings: readonly SeparationReading[];
  /** The floor with the best precision among those that admit anything, or `null`. */
  readonly best: SeparationReading | null;
  readonly separable: boolean;
}

/**
 * Whether the conditioning column separates the population the rule repairs from the one it breaks.
 *
 * ## Why this is measured before any bar is swept
 *
 * 328 refused the pooled axis because both populations occupy the same evidence region, and it cost one walk to
 * learn that a sweep could not cut it. The criterion this module states is therefore a PRE-condition of a sweep
 * rather than a reading of one: the condition must hold on at least `MIN_SEPARATION_PRECISION` of the cases it
 * admits being cases the rule is FOR. A column that fails it cannot be rescued by a bar, and no sweep is run.
 *
 * `reachable` is read under the SHIPPED surface: the answer is wrong, so the rule has something to repair. `at risk`
 * is a correct answer, so every fire costs a case. Both are restricted to `gateHolds`, which is the population the
 * rule addresses at all.
 *
 * @param rows - The corpus.
 * @param profiles - Every case's service profiles.
 * @param kappa - The resource ceiling to read the condition at.
 * @param floors - The floors to read, ascending.
 * @param minPrecision - The precision a floor must reach.
 * @returns The reading per floor, and whether any floor is separable.
 */
export function separationOf(
  rows: readonly SplitCase[],
  profiles: Profiles,
  kappa: number = KAPPA_GRID.at(-1)!,
  floors: readonly number[] = SYMPTOM_GRID,
  minPrecision: number = MIN_SEPARATION_PRECISION,
): Separation {
  const reachable: AddressedCase[] = [];
  const atRisk: AddressedCase[] = [];
  for (const one of rows) {
    if (!gateHolds(one)) continue;
    const answer = resolvedUnder(one, profiles, null);
    const hit = answer !== null && one.truth.includes(answer);
    if (hit) atRisk.push(one);
    else reachable.push(one);
  }
  const admits = (one: AddressedCase, floor: number): boolean =>
    conduitUnder(profiles.get(one.datapack)?.get(one.answer) ?? null, kappa, floor);
  const readings: SeparationReading[] = floors.map((floor) => {
    const yes = reachable.filter((one) => admits(one, floor)).length;
    const no = atRisk.filter((one) => admits(one, floor)).length;
    return { floor, reachable: yes, atRisk: no, precision: yes + no === 0 ? null : yes / (yes + no) };
  });
  // Narrowed by construction rather than by a cast at the end: a floor that admits nothing has no precision, and a
  // `best` is by definition a floor that admitted something.
  const qualifying = readings.filter(
    (one): one is SeparationReading & { readonly precision: number } => one.precision !== null,
  );
  let best: (SeparationReading & { readonly precision: number }) | null = null;
  for (const one of qualifying) if (best === null || one.precision > best.precision) best = one;
  return {
    kappa,
    reachableTotal: reachable.length,
    atRiskTotal: atRisk.length,
    readings,
    best,
    separable: best !== null && best.precision >= minPrecision,
  };
}

/** One service's profile from a case's series, re-exported so a census does not import two modules to write one row. */
export { departureOf, trafficOnly };
