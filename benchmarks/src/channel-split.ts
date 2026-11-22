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
import { departureOf, trafficOnly } from './channel-kind.js';
import { ENTRY_PRIOR_SURPRISE, entryAttribution, interfaceAttribution } from './query-agent.js';

/**
 * The bars the sweep reads, in units of a service's own pre-window spread.
 *
 * The same six values the earlier pricing swept, kept rather than tightened: a grid that moved with the previous
 * peak would be a second selection on top of the first.
 */
export const KAPPA_GRID: readonly number[] = [30, 100, 200, 300, 500, 750];

/** The gain, in cases, a bar must produce on EACH held-out fold. Seven is the size of the reference improvement. */
export const MIN_CHANNEL_GAIN = 7;

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
  const seen = new Map<string, number>();
  const foldOfRow: (0 | 1)[] = [];
  for (const one of rows) {
    const index = seen.get(one.faultType) ?? 0;
    seen.set(one.faultType, index + 1);
    foldOfRow.push(foldOf(one.faultType, index));
  }
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

/** One service's profile from a case's series, re-exported so a census does not import two modules to write one row. */
export { departureOf, trafficOnly };
