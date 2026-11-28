/**
 * A resolver may not take an answer away from a head that is itself loud — priced, not assumed.
 *
 * ## The claim, and why it is a precedence rule rather than a new signal
 *
 * Iteration 331 pre-registered this rule before any number was read
 * (`docs-repository:preregistration-331.md`). The resolver's premise is "the service you named is a conduit, not a
 * source". A head whose own standardised departure is loud did work of its own, so it is not a conduit, so the
 * premise the resolver needs is false — and refusing is what the resolver already does when its premise fails. The
 * rule therefore adds no evidence channel; it applies an existing premise to a candidate the resolver never
 * examined: the fusion order's first choice.
 *
 * ## Why the guard is scoped to the two resolvers
 *
 * The model is the answer's SOURCE, not a resolver. A guard that rewrote the model's answers would not be this rule
 * under another name; it would be a different rule that deletes the model's contribution while claiming to police a
 * resolver. {@link modelAnswersTouched} exists so that claim is checked at runtime rather than asserted in prose: the
 * runner prints it, and a non-zero reading voids the price.
 *
 * ## What the guard is NOT allowed to read
 *
 * The truth. `headSpeaks` sees the case's chain, the case's profiles and which channel settled the answer, and
 * nothing else — so the populations in {@link loudnessUnder} can be split by side for the pre-registered asymmetry
 * without the rule itself ever consulting the split.
 *
 * @module benchmarks/head-precedence
 */

import type { ChannelDeparture } from './channel-kind.js';
import { type Profiles, foldOf } from './channel-split.js';

/** The gain, in cases, the rule must produce on EACH held-out fold. Seven is the reference improvement. */
export const MIN_PRECEDENCE_GAIN = 7;

/** The two channels that rename an answer rather than produce one. */
const RESOLVERS: readonly ResolvedBy[] = ['entry', 'interface'];

/** Which channel settled a case's answer, as the artifact records it. */
export type ResolvedBy = 'entry' | 'interface' | 'prior' | 'model';

/** A case in the fields this rule reads. `QueryArmRow` satisfies it structurally once `answeredBy` is renamed. */
export interface PrecedenceCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly truth: readonly string[];
  readonly answer: string | null;
  readonly entry: string | null;
  /** The channel that settled the answer, or `null` when the artifact does not say. */
  readonly by: ResolvedBy | null;
}

/** The part of a containment artifact this rule reads: the fusion order, strongest first. */
export interface ChainOrder {
  readonly order: readonly string[];
}

/**
 * The head of a chain.
 *
 * @param chain - The case's chain, or `undefined` when the artifact carries none.
 * @returns The fusion order's first choice, or `null` when there is no chain and no head to speak of.
 */
export function headOf(chain: ChainOrder | undefined): string | null {
  if (chain === undefined) return null;
  return chain.order[0] ?? null;
}

/**
 * A service's loudest STANDARDISED channel.
 *
 * The symptom columns are excluded on purpose. They are rates, not standardised rises, and the corpus's own reader
 * refuses to standardise them exactly where they become diagnostic (a rate flat at zero before the injection), so a
 * maximum that admitted them would compare two quantities with different units and call the larger one louder.
 *
 * @param departure - The service's profile, or `null` when the case carries none for it.
 * @returns The largest of resource, traffic and other, or `null` when none of them could be standardised.
 */
export function loudestChannel(departure: ChannelDeparture | null): number | null {
  if (departure === null) return null;
  let loudest: number | null = null;
  for (const value of [departure.resource, departure.traffic, departure.other]) {
    if (value === null) continue;
    if (loudest === null || value > loudest) loudest = value;
  }
  return loudest;
}

/**
 * Whether the guard fires: the answer was RENAMED by a resolver, and the head it was taken from is loud.
 *
 * Every refusal here is a different statement, and each has been a defect somewhere in this programme's history:
 *
 * 1. **`kappa === null`** is the shipped pipeline. A guard that fired in the disabled state would be a rule nobody
 *    measured, dressed as the status quo.
 * 2. **No answer** is a gate refusal, not a quiet service.
 * 3. **The model or the prior settled it** — not a resolver, so not this rule's population.
 * 4. **No chain** means no head to preserve.
 * 5. **The head IS the entry** means the resolver had nothing to undo.
 * 6. **No profile** is the producer's refusal, and reading a refusal as a measured quiet is how an unmeasurable
 *    channel comes to decide a verdict.
 *
 * @param one - The case.
 * @param profiles - Every case's service profiles.
 * @param heads - Every case's fusion order.
 * @param kappa - The bar, or `null` for the shipped pipeline.
 * @returns True when the rule would keep the head's answer.
 */
export function headSpeaks(
  one: PrecedenceCase,
  profiles: Profiles,
  heads: ReadonlyMap<string, ChainOrder>,
  kappa: number | null,
): boolean {
  if (kappa === null) return false;
  if (one.answer === null) return false;
  if (one.by === null || !RESOLVERS.includes(one.by)) return false;
  const head = headOf(heads.get(one.datapack));
  if (head === null) return false;
  if (head === one.entry) return false;
  const loudest = loudestChannel(profiles.get(one.datapack)?.get(head) ?? null);
  if (loudest === null) return false;
  return loudest > kappa;
}

/**
 * The answer a case settles on under the guard.
 *
 * `kappa === null` is the shipped surface, byte for byte: the artifact's own answer.
 *
 * @param one - The case.
 * @param profiles - Every case's service profiles.
 * @param heads - Every case's fusion order.
 * @param kappa - The bar, or `null` for the shipped pipeline.
 * @returns The settled answer.
 */
export function precedenceUnder(
  one: PrecedenceCase,
  profiles: Profiles,
  heads: ReadonlyMap<string, ChainOrder>,
  kappa: number | null,
): string | null {
  if (!headSpeaks(one, profiles, heads, kappa)) return one.answer;
  return headOf(heads.get(one.datapack));
}

/**
 * How many answers the guard rewrites outside the resolvers' population.
 *
 * Read by the runner as the scope check P4 of the pre-registration asks for. It is zero by construction, and it is
 * computed rather than asserted because a construction is only trustworthy when something observes it.
 *
 * @param cases - The corpus.
 * @param profiles - Every case's service profiles.
 * @param heads - Every case's fusion order.
 * @param kappa - The bar.
 * @returns The number of cases whose answer the guard changes although no resolver settled it.
 */
export function modelAnswersTouched(
  cases: readonly PrecedenceCase[],
  profiles: Profiles,
  heads: ReadonlyMap<string, ChainOrder>,
  kappa: number,
): number {
  // Expressed as two filters rather than as a counter with an increment: the increment would be a statement no input
  // can reach — the guard refuses a case whose answer no resolver settled, so the rewrite it would count cannot
  // happen — and this repository does not ship statements it cannot reach. The filters run, and their length is the
  // number P4 asks for.
  const outside = cases.filter((one) => one.by === null || !RESOLVERS.includes(one.by));
  return outside.filter((one) => precedenceUnder(one, profiles, heads, kappa) !== one.answer)
    .length;
}

/** What the two populations of resolver overrides look like at one bar. Predictions P1 and P2 read this. */
export interface LoudnessReading {
  readonly kappa: number;
  /** Overrides that took a CORRECT head away: the population the rule exists for. */
  readonly overriddenWrong: number;
  /** Of those, the ones whose head clears the bar. */
  readonly ofWhichLoud: number;
  /** Overrides whose result was correct. */
  readonly overriddenRight: number;
  /** Of those, the ones whose head clears the bar: the population the rule would silence. */
  readonly ofWhichLoudRight: number;
}

/**
 * Split the resolver's overrides by side and count how loud their heads were.
 *
 * The split by side is a DIAGNOSTIC and not part of the rule: nothing here feeds {@link headSpeaks}, which never
 * sees a truth. That is the only way the pre-registered asymmetry can be read without the rule reading it.
 *
 * @param cases - The corpus.
 * @param profiles - Every case's service profiles.
 * @param heads - Every case's fusion order.
 * @param kappa - The bar.
 * @returns The four counts.
 */
export function loudnessUnder(
  cases: readonly PrecedenceCase[],
  profiles: Profiles,
  heads: ReadonlyMap<string, ChainOrder>,
  kappa: number,
): LoudnessReading {
  let overriddenWrong = 0;
  let ofWhichLoud = 0;
  let overriddenRight = 0;
  let ofWhichLoudRight = 0;
  for (const one of cases) {
    if (one.by === null || !RESOLVERS.includes(one.by)) continue;
    if (one.answer === null) continue;
    const head = headOf(heads.get(one.datapack));
    if (head === null) continue;
    if (head === one.entry) continue;
    const loud = headSpeaks(one, profiles, heads, kappa);
    if (one.truth.includes(head) && !one.truth.includes(one.answer)) {
      overriddenWrong += 1;
      if (loud) ofWhichLoud += 1;
    } else if (one.truth.includes(one.answer)) {
      overriddenRight += 1;
      if (loud) ofWhichLoudRight += 1;
    }
  }
  return { kappa, overriddenWrong, ofWhichLoud, overriddenRight, ofWhichLoudRight };
}

/** One bar's reading. */
export interface PrecedenceBar {
  readonly kappa: number;
  /** Correct cases in each fold, in fold order. */
  readonly correct: readonly [number, number];
  /** Cases the bar turned from wrong into right, across both folds. */
  readonly repairs: number;
  /** Cases it turned from right into wrong. */
  readonly breaks: number;
}

/** What the two-fold reading concluded. */
export interface PrecedenceValidation {
  readonly sizes: readonly [number, number];
  /** Correct cases under the SHIPPED surface, per fold. The comparison every bar is stated against. */
  readonly mixed: readonly [number, number];
  readonly sweep: readonly PrecedenceBar[];
  /** The bar each fold chose, in fold order. */
  readonly selected: readonly [number, number];
  /** The reading on each fold under the bar chosen on the OTHER fold. */
  readonly heldOut: readonly [number, number];
  /** `heldOut − mixed`, per fold. */
  readonly deltas: readonly [number, number];
  /** Which clauses refused the rule, in the order they are checked. Empty when it passes. */
  readonly reasons: readonly string[];
  readonly passes: boolean;
}

/** Which fold each case landed in, by family and parity — the same partition `channel-split` uses. */
function foldsOf(cases: readonly PrecedenceCase[]): (0 | 1)[] {
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
 * The selection, the tie-break and the refusals are all fixed here so that no caller can choose a flattering reading:
 * each fold picks the bar with the most correct cases on ITS half (ties go to the narrower bar, i.e. the one that
 * fires less), the published number is the bar chosen on the OTHER half applied to this one, and three clauses can
 * refuse the rule whatever it reads.
 *
 * @param cases - The corpus, in the artifact's own order.
 * @param profiles - Every case's service profiles.
 * @param heads - Every case's fusion order.
 * @param grid - The bars to sweep, in ascending order.
 * @param minGain - The gain each fold must show.
 * @returns The reading, its refusals, and whether it passes.
 */
export function crossValidatePrecedence(
  cases: readonly PrecedenceCase[],
  profiles: Profiles,
  heads: ReadonlyMap<string, ChainOrder>,
  grid: readonly number[],
  minGain: number,
): PrecedenceValidation {
  const fold = foldsOf(cases);
  const sizes: [number, number] = [0, 0];
  const mixed: [number, number] = [0, 0];
  for (let index = 0; index < cases.length; index += 1) {
    const one = cases[index]!;
    const side = fold[index]!;
    sizes[side] += 1;
    const shipped = precedenceUnder(one, profiles, heads, null);
    if (shipped !== null && one.truth.includes(shipped)) mixed[side] += 1;
  }
  const sweep: PrecedenceBar[] = grid.map((kappa) => {
    const correct: [number, number] = [0, 0];
    let repairs = 0;
    let breaks = 0;
    for (let index = 0; index < cases.length; index += 1) {
      const one = cases[index]!;
      const side = fold[index]!;
      const shipped = precedenceUnder(one, profiles, heads, null);
      const settled = precedenceUnder(one, profiles, heads, kappa);
      const wasRight = shipped !== null && one.truth.includes(shipped);
      const isRight = settled !== null && one.truth.includes(settled);
      if (isRight) correct[side] += 1;
      if (!wasRight && isRight) repairs += 1;
      if (wasRight && !isRight) breaks += 1;
    }
    return { kappa, correct, repairs, breaks };
  });
  const selected: [number, number] = [pick(sweep, 0), pick(sweep, 1)];
  // `selected` holds BARS, and the sweep is indexed by POSITION in the grid: reading `sweep[selected[1]]` would index
  // a six-cell table by a bar of 600 and find nothing, which is a defect the first test run found and not a style.
  const heldOut: [number, number] = [
    sweep[grid.indexOf(selected[1])]!.correct[0],
    sweep[grid.indexOf(selected[0])]!.correct[1],
  ];
  const deltas: [number, number] = [heldOut[0] - mixed[0], heldOut[1] - mixed[1]];
  const reasons: string[] = [];
  if (deltas[0] < minGain) reasons.push(`fold 0 gains ${deltas[0]}`);
  if (deltas[1] < minGain) reasons.push(`fold 1 gains ${deltas[1]}`);
  const corner = grid.length - 1;
  const apart = Math.abs(grid.indexOf(selected[0]) - grid.indexOf(selected[1]));
  if (apart > 1) reasons.push('the folds chose bars more than one step apart');
  if ([0, corner].some((edge) => selected[0] === grid[edge] || selected[1] === grid[edge])) {
    reasons.push('the chosen bar is on the grid corner, so it is unmeasured');
  }
  return { sizes, mixed, sweep, selected, heldOut, deltas, reasons, passes: reasons.length === 0 };
}

/** The bar one fold chose: the most correct cases on that half, ties to the narrower bar. */
function pick(sweep: readonly PrecedenceBar[], side: 0 | 1): number {
  let best = sweep[0]!;
  for (const one of sweep) if (one.correct[side] > best.correct[side]) best = one;
  return best.kappa;
}

/**
 * The report, in the order the pre-registered questions have to be answered.
 *
 * @param reading - The held-out reading.
 * @param loudness - The population readings, one per bar.
 * @param touched - How many answers outside the resolvers' population the guard rewrote.
 * @returns The report as one string, so a caller cannot print half of it.
 */
export function formatPrecedenceReport(
  reading: PrecedenceValidation,
  loudness: readonly LoudnessReading[],
  touched: number,
): string {
  const lines: string[] = [];
  lines.push('P1/P2 -- the head is loud where the override was wrong, quiet where it was right');
  lines.push('   bar   overridden-wrong  loud   overridden-right  loud');
  for (const one of loudness) {
    lines.push(
      `  ${String(one.kappa).padStart(4)}   ${String(one.overriddenWrong).padStart(16)}  ` +
        `${String(one.ofWhichLoud).padStart(4)}   ${String(one.overriddenRight).padStart(16)}  ` +
        `${String(one.ofWhichLoudRight).padStart(4)}`,
    );
  }
  lines.push('');
  lines.push('P3 -- held out, selected on one fold and read on the other');
  lines.push('   bar   fold0  fold1   repairs  breaks');
  for (const one of reading.sweep) {
    lines.push(
      `  ${String(one.kappa).padStart(4)}   ${String(one.correct[0]).padStart(5)}  ` +
        `${String(one.correct[1]).padStart(5)}   ${String(one.repairs).padStart(7)}  ` +
        `${String(one.breaks).padStart(6)}`,
    );
  }
  lines.push(
    `  shipped ${reading.mixed[0]} / ${reading.mixed[1]}, chosen ${reading.selected[0]} / ${reading.selected[1]}, ` +
      `held out ${reading.heldOut[0]} / ${reading.heldOut[1]}, delta ${reading.deltas[0]} / ${reading.deltas[1]}`,
  );
  lines.push('');
  lines.push(`P4 -- model answers touched ${touched}, which must be zero`);
  lines.push(
    reading.passes
      ? 'verdict: passes every clause'
      : `verdict: does not pass -- ${reading.reasons.join('; ')}`,
  );
  return lines.join('\n');
}
