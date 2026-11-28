/**
 * The gate, fitted: what a weight vector may change without costing a fault family a case.
 *
 * ## The two readings this module exists to separate
 *
 * A case is answered when the engine's first candidate is an accepted one. On the artifact that rule has a second
 * reading — the optimistic one — where a candidate level with the answer keeps its earlier position, and the
 * artifact's position IS the recorded order. The two readings agree on every real weight vector measured so far
 * (one case in 1 422 carries a tie under the shipped weights) and disagree completely at `w = 0`, where every
 * candidate ties and the recorded order therefore wins by default. That is not a curiosity: the zero vector scores
 * the published run exactly, so any ascent over the artifact has a false optimum at the origin and any linear
 * program over it inherits one. {@link readUnder} therefore reports BOTH readings and {@link strictCount} reads the
 * one a weight change may be credited with.
 *
 * ## Why the gate is a lexicographic objective and not a penalty
 *
 * The pre-registered gate is `Top@1` must not fall and no family with `n ≥ 20` may lose a case it answered
 * (`term-weight-screen.ts`). A penalty weighted into a single objective trades the two against each other by
 * construction, and the trade it picks is whatever the weight happened to be; measured on this corpus, a perceptron
 * with gate weights from 4 to 256 buys between 52 and 145 cases at a cost of 21 to 116 lost gate cases, so the
 * exchange rate is a property of the weight, not of the corpus. {@link fitUnderGate} instead refuses the trade
 * outright: a promotion is APPLIED only if the gate still holds afterwards, and a state that breaks the gate is
 * never kept. The fit is then a sequence of admissible moves, and every number it reports is a state the gate
 * admits.
 *
 * ## What the fit is not
 *
 * It is a greedy ascent, not an optimum. The count is a sum of indicators over a union of cones, and the exact
 * maximiser is the maximum-depth point of a hyperplane arrangement with tens of thousands of hyperplanes in 14
 * dimensions — no exact method applies at this size. What is claimed is the weaker and checkable thing: **this
 * vector keeps every family above the floor and answers this many cases**, with both numbers recomputed from the
 * dump by a reader who runs the same command.
 *
 * @module benchmarks/gate-fit
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';
import type { ReachCase } from './weight-reachability.js';
import { nextRandom } from './weight-reachability.js';

/** One case's reading under one weight vector, in both senses of "answered". */
export interface StrictReading {
  /** The accepted candidate strictly outscored every rejected one. This is the reading a change is credited with. */
  readonly answers: boolean;
  /** The engine's own rule: the first candidate of the ranking is accepted. Ties resolve by position. */
  readonly optimistic: boolean;
  /** Index of the highest-scoring accepted candidate, or `-1` when the ranking carries none. */
  readonly accepted: number;
  /** Index of the highest-scoring rejected candidate, or `-1` when the ranking carries none. */
  readonly competitor: number;
  /** `accepted − competitor`; `-Infinity` when no accepted candidate is listed, `+Infinity` when no competitor is. */
  readonly gap: number;
}

/** One fault family's reading against the baseline, which is what the gate is stated on. */
export interface GateFamilyRow {
  readonly faultType: string;
  readonly cases: number;
  /** Cases the baseline answers strictly. */
  readonly before: number;
  /** Cases the vector answers strictly. */
  readonly after: number;
  /** Baseline cases the vector no longer answers, in id order. */
  readonly lost: readonly string[];
  /** Whether this family is above the pre-registered floor, and therefore whether its losses are a verdict. */
  readonly aboveFloor: boolean;
}

/** What one weight vector does to the corpus and to the gate. */
export interface GateReading {
  readonly cases: number;
  /** Strict answers under the vector. */
  readonly answers: number;
  /** Cases answered optimistically, which is the count the artifact reports without a tie rule. */
  readonly optimistic: number;
  /** Baseline cases in families above the floor that the vector no longer answers. */
  readonly gateLost: number;
  /** Families above the floor that lost at least one case. */
  readonly familiesLost: number;
  /** The families' own readings, largest first. */
  readonly families: readonly GateFamilyRow[];
}

/** One half's reading inside a fit. */
export interface FitHalf {
  readonly cases: number;
  readonly baseline: number;
  readonly after: number;
  /** Baseline cases this half's own families above the floor no longer answer. */
  readonly gateLost: number;
}

/** A gate-respecting fit. */
export interface GateFitReport {
  /** The fitted weights, by term name. */
  readonly weights: Readonly<Record<string, number>>;
  /** The half the fit moved through. */
  readonly train: FitHalf;
  /** The half it never moved through — the only number that speaks about the corpus. */
  readonly held: FitHalf;
  /** How many promotions the fit applied, and how many it refused because they would have broken the gate. */
  readonly applied: number;
  readonly refused: number;
}

/** The fit's parameters. */
export interface GateFitOptions {
  /** Passes over the training half. */
  readonly epochs: number;
  /** Which alternating half trains: `0` takes the even positions, `1` the odd ones. `-1` trains on all of them. */
  readonly orientation: number;
  readonly seed: number;
  /** Step size of the first pass; it decays to `learningRate / (1 + 0.1·epoch)`. */
  readonly learningRate: number;
  /** The pre-registered family floor, in cases. */
  readonly familyFloor: number;
}

/** The defaults the console uses: enough passes to reach a gate-clean state, small enough to finish in minutes. */
export const DEFAULT_GATE_FIT: GateFitOptions = {
  epochs: 60,
  orientation: -1,
  seed: 20261113,
  learningRate: 0.05,
  familyFloor: 20,
};

/** Score one candidate grid under one direction. */
function scoresOf(kase: ReachCase, direction: Float64Array): Float64Array {
  const scores = new Float64Array(kase.vectors.length);
  for (let index = 0; index < kase.vectors.length; index += 1) {
    const vector = kase.vectors[index]!;
    let score = 0;
    for (let term = 0; term < vector.length; term += 1) score += direction[term]! * vector[term]!;
    scores[index] = score;
  }
  return scores;
}

/**
 * Read one candidate grid in both senses of "answered".
 *
 * The single owner of the tie rule: `optimistic` is the first maximum in the dump's order, `answers` needs the best
 * accepted candidate to beat the best rejected one outright. Every reader in this repository that has scores in hand
 * — a direction over term values, the artifact's own per-candidate coefficients, an arm that switches one term — goes
 * through here, because a second copy of this loop is a second definition of what the artifact scored, and iteration
 * 277 found two of them disagreeing by 42 cases.
 *
 * @param ids - Candidate ids in the dump's order, which is the engine's tie-break.
 * @param accepted - The case's accepted answers.
 * @param scores - One score per candidate, aligned with `ids`.
 * @returns The reading.
 */
export function readScores(
  ids: readonly string[],
  accepted: ReadonlySet<string>,
  scores: Float64Array,
): StrictReading {
  let acceptedIndex = -1;
  let competitor = -1;
  let bestAccepted = -Infinity;
  let bestCompetitor = -Infinity;
  let top = -Infinity;
  let first = -1;
  for (let index = 0; index < scores.length; index += 1) {
    const score = scores[index]!;
    if (score > top) {
      top = score;
      first = index;
    }
    if (accepted.has(ids[index]!)) {
      if (score > bestAccepted) {
        bestAccepted = score;
        acceptedIndex = index;
      }
    } else if (score > bestCompetitor) {
      bestCompetitor = score;
      competitor = index;
    }
  }
  const gap =
    acceptedIndex < 0 ? -Infinity : competitor < 0 ? Infinity : bestAccepted - bestCompetitor;
  return {
    answers: gap > 0,
    optimistic: first >= 0 && accepted.has(ids[first]!),
    accepted: acceptedIndex,
    competitor,
    gap,
  };
}

/**
 * Read one case under one direction.
 *
 * @param kase - The case, vectors on a shared name order.
 * @param direction - The weight vector.
 * @returns The reading.
 */
export function readUnder(kase: ReachCase, direction: Float64Array): StrictReading {
  return readScores(kase.ids, kase.accepted, scoresOf(kase, direction));
}

/**
 * Count the cases a direction answers strictly.
 *
 * @param cases - The corpus, as reachability cases.
 * @param direction - The weight vector.
 * @returns The strict count and the optimistic one, which differ only where ties decide a case.
 */
export function countUnder(
  cases: readonly ReachCase[],
  direction: Float64Array,
): { answers: number; optimistic: number } {
  let answers = 0;
  let optimistic = 0;
  for (const kase of cases) {
    const reading = readUnder(kase, direction);
    if (reading.answers) answers += 1;
    if (reading.optimistic) optimistic += 1;
  }
  return { answers, optimistic };
}

/**
 * The per-family size of a corpus.
 *
 * @param cases - The corpus.
 * @returns Family size, by fault type.
 */
export function familySizes(cases: readonly ReachCase[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const kase of cases) sizes.set(kase.faultType, (sizes.get(kase.faultType) ?? 0) + 1);
  return sizes;
}

/**
 * Mark the cases the gate protects: answered by the baseline, in a family at or above the floor.
 *
 * @param cases - The corpus.
 * @param baseline - One reading per case, in order, from {@link readUnder}.
 * @param familyFloor - The pre-registered floor, in cases.
 * @returns One flag per case.
 */
export function gateMask(
  cases: readonly ReachCase[],
  baseline: readonly StrictReading[],
  familyFloor: number,
): boolean[] {
  const sizes = familySizes(cases);
  // `!`: every case's own family was counted from the same list, so a missing size is a broken invariant rather
  // than a family of zero — and a zero would be below every floor, silently unprotecting the whole corpus.
  return cases.map((kase, index) => {
    if (sizes.get(kase.faultType)! < familyFloor) return false;
    return baseline[index]!.answers;
  });
}

/**
 * Read a vector against the baseline, family by family.
 *
 * @param cases - The corpus.
 * @param baseline - The baseline readings, one per case.
 * @param direction - The vector to read.
 * @param familyFloor - The pre-registered floor, in cases.
 * @returns The corpus reading, with the families in it.
 */
export function gateReading(
  cases: readonly ReachCase[],
  baseline: readonly StrictReading[],
  direction: Float64Array,
  familyFloor: number,
): GateReading {
  const sizes = familySizes(cases);
  const rows = new Map<string, { before: number; after: number; lost: string[] }>();
  let answers = 0;
  let optimistic = 0;
  for (const [index, kase] of cases.entries()) {
    const reading = readUnder(kase, direction);
    if (reading.answers) answers += 1;
    if (reading.optimistic) optimistic += 1;
    const row = rows.get(kase.faultType) ?? { before: 0, after: 0, lost: [] };
    if (baseline[index]!.answers) {
      row.before += 1;
      if (!reading.answers) row.lost.push(kase.datapack);
    }
    if (reading.answers) row.after += 1;
    rows.set(kase.faultType, row);
  }
  // `!` rather than a default: every key here came from a case in `cases`, and `sizes` was built from the same
  // cases, so a missing key is a broken invariant and not a family of size zero — which would be BELOW the floor
  // and would quietly delete the family from the verdict.
  const families: GateFamilyRow[] = [...rows.entries()]
    .map(([faultType, row]) => ({
      faultType,
      cases: sizes.get(faultType)!,
      before: row.before,
      after: row.after,
      lost: [...row.lost].sort(compareCasePaths),
      aboveFloor: sizes.get(faultType)! >= familyFloor,
    }))
    .sort(
      (left, right) =>
        right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
    );
  let gateLost = 0;
  let familiesLost = 0;
  for (const family of families) {
    if (!family.aboveFloor) continue;
    gateLost += family.lost.length;
    if (family.lost.length > 0) familiesLost += 1;
  }
  return { cases: cases.length, answers, optimistic, gateLost, familiesLost, families };
}

/**
 * Count the gate violations of one direction over a subset, which is what the ascent tests before it keeps a move.
 *
 * Only the families above the floor count, and only over the cases the subset names: a fit on half the corpus may
 * not spend the other half's cases to buy its own.
 *
 * @param cases - The corpus.
 * @param baseline - The baseline readings.
 * @param gate - One flag per case, from {@link gateMask}.
 * @param direction - The vector to test.
 * @param subset - One flag per case: which cases this fit answers for.
 * @returns How many gate cases the vector has lost.
 */
export function gateViolations(
  cases: readonly ReachCase[],
  gate: readonly boolean[],
  direction: Float64Array,
  subset: readonly boolean[],
): number {
  let lost = 0;
  for (let index = 0; index < cases.length; index += 1) {
    if (!subset[index]! || !gate[index]!) continue;
    if (!readUnder(cases[index]!, direction).answers) lost += 1;
  }
  return lost;
}

/**
 * The protected cases one step could take away.
 *
 * The ascent has to know whether a promotion opened the gate, and re-reading every protected case after every
 * promotion is what makes that check cost more than the promotion. A step `s` moves one candidate's score by `s·v`,
 * which is at most `‖s‖₂·‖v‖₂`; both sides of a gap can move, so a gap can close by `2·‖s‖₂·max‖v‖₂` at most. A
 * protected case whose gap exceeds that cannot be taken away by this step and is not re-read. The bound is
 * conservative and the ascent's answer does not depend on it: it decides which cases are cheaper to skip, and a case
 * it skips provably kept its answer.
 *
 * Only cases that ARE answered are returned: a case the gate has already lost is not something a promotion can take
 * away, and refusing promotions for it would freeze the fit on a loss the repair pass is responsible for.
 *
 * @param cases - The corpus.
 * @param gate - The gate flags.
 * @param subset - Which cases this fit answers for.
 * @param direction - The vector the gaps are read under, BEFORE the step.
 * @param bound - The largest gap change one step can cause.
 * @returns One flag per case: whether it must be re-read after the step.
 */
export function fragileMask(
  cases: readonly ReachCase[],
  gate: readonly boolean[],
  subset: readonly boolean[],
  direction: Float64Array,
  bound: number,
): boolean[] {
  return cases.map((kase, index) => {
    if (!subset[index]! || !gate[index]!) return false;
    const reading = readUnder(kase, direction);
    return reading.answers && reading.gap <= bound;
  });
}

/** The Euclidean norm of a difference of two candidate vectors, which bounds the score change of a step. */
function stepNorm(good: Float64Array, bad: Float64Array, scale: number): number {
  let sum = 0;
  for (let term = 0; term < good.length; term += 1) {
    const delta = (good[term]! - bad[term]!) * scale;
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

/** The largest candidate norm in a corpus, which turns a step norm into a score bound. */
function largestNorm(cases: readonly ReachCase[]): number {
  let largest = 0;
  for (const kase of cases) {
    for (const vector of kase.vectors) {
      let sum = 0;
      for (let term = 0; term < vector.length; term += 1) sum += vector[term]! * vector[term]!;
      largest = Math.max(largest, Math.sqrt(sum));
    }
  }
  return largest;
}

/**
 * Fit one weight vector under the gate: promote what the baseline misses, and refuse every move that would cost a
 * protected case.
 *
 * ## Why the gate is an invariant rather than a repair
 *
 * The obvious shape is "promote, notice the gate opened, repair it". It is also unnecessary: a step is normalised
 * to Euclidean norm `rate`, so it moves any candidate's score by at most `rate · max‖v‖`, and a gap can therefore
 * close by at most twice that. {@link fragileMask} admits exactly the protected cases whose gap is inside that
 * bound, and {@link gateViolations} reads them back after the step. So a protected case the guard clears by more
 * than the bound provably kept its answer, and the ones it does not clear were read and are rolled back. The gate
 * is therefore preserved by induction over the moves, and the repair pass that would otherwise exist has nothing
 * to do — which is the version that is worth having, because a pass that only fires when the guard failed would be
 * a pass nobody's test can reach.
 *
 * What the fit is not: a maximum. The count is a sum of indicators over a union of cones, and an exact maximiser
 * is the maximum-depth point of an arrangement with tens of thousands of hyperplanes in 14 dimensions. It reports
 * what it reached, and the reach is recomputable from the dump.
 *
 * @param cases - The corpus, as reachability cases.
 * @param start - The baseline weights, by name.
 * @param names - The name order every vector is laid out on.
 * @param options - The fit's parameters.
 * @returns The vector and both halves' readings.
 */
export function fitUnderGate(
  cases: readonly ReachCase[],
  start: Readonly<Record<string, number>>,
  names: readonly string[],
  options: GateFitOptions = DEFAULT_GATE_FIT,
): GateFitReport {
  const width = names.length;
  const weights = new Float64Array(width);
  for (let index = 0; index < width; index += 1) weights[index] = start[names[index]!] ?? 0;
  const baseline = cases.map((kase) => readUnder(kase, weights));
  const gate = gateMask(cases, baseline, options.familyFloor);
  const train = cases.map(
    (_, index) => options.orientation < 0 || index % 2 === options.orientation,
  );
  const held = train.map((isTrain) => !isTrain);
  const startTrain = countUnder(
    cases.filter((_, index) => train[index]!),
    weights,
  ).answers;
  const startHeld = countUnder(
    cases.filter((_, index) => held[index]!),
    weights,
  ).answers;

  const trainingIndex: number[] = [];
  const missedIndex: number[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    if (!train[index]!) continue;
    trainingIndex.push(index);
    if (!gate[index]! && !baseline[index]!.answers) missedIndex.push(index);
  }

  const reachBound = largestNorm(cases);
  let state = options.seed >>> 0;
  let applied = 0;
  let refused = 0;
  const best = weights.slice();
  let bestTrain = startTrain;
  // The pass order over the missed cases, reshuffled per epoch from the seed: the gate refuses most moves, so which
  // promotion is attempted while the margin is still open decides what the fit ends with, and a fixed order would
  // make the seed a parameter that changes nothing.
  const order: number[] = missedIndex.slice();

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    for (let index = order.length - 1; index > 0; index -= 1) {
      const drawn = nextRandom(state);
      state = drawn.state;
      const swap = Math.floor(drawn.value * (index + 1));
      const keep = order[index]!;
      order[index] = order[swap]!;
      order[swap] = keep;
    }
    const rate = options.learningRate / (1 + 0.1 * epoch);
    for (const index of order) {
      const kase = cases[index]!;
      const reading = readUnder(kase, weights);
      // `competitor < 0` needs no branch of its own: a case with no competitor has an infinite gap and is therefore
      // already `answers`, so the first test has taken it.
      if (reading.answers || reading.accepted < 0) continue;
      const good = kase.vectors[reading.accepted]!;
      const bad = kase.vectors[reading.competitor]!;
      const step = rate / (stepNorm(good, bad, 1) || 1);
      // Which protected cases this step could take away is a question about the vector BEFORE it, and only cases
      // that currently hold an answer are candidates for being taken away.
      const fragile = fragileMask(cases, gate, train, weights, 2 * rate * reachBound);
      for (let term = 0; term < width; term += 1) {
        weights[term] = weights[term]! + step * (good[term]! - bad[term]!);
      }
      if (gateViolations(cases, gate, weights, fragile) > 0) {
        for (let term = 0; term < width; term += 1) {
          weights[term] = weights[term]! - step * (good[term]! - bad[term]!);
        }
        refused += 1;
      } else {
        applied += 1;
      }
    }

    const trainCount = countUnder(
      cases.filter((_, index) => train[index]!),
      weights,
    ).answers;
    // The gate is an invariant of the moves above, so this reads zero; it is read anyway, because a number that is
    // only true by an argument in a comment is a number a reader cannot check.
    if (gateViolations(cases, gate, weights, train) === 0 && trainCount > bestTrain) {
      bestTrain = trainCount;
      best.set(weights);
    }
  }

  const byName: Record<string, number> = {};
  for (let index = 0; index < width; index += 1) byName[names[index]!] = best[index]!;
  const heldCount = countUnder(
    cases.filter((_, index) => held[index]!),
    best,
  ).answers;
  return {
    weights: byName,
    train: {
      cases: trainingIndex.length,
      baseline: startTrain,
      after: bestTrain,
      gateLost: gateViolations(cases, gate, best, train),
    },
    held: {
      cases: cases.length - trainingIndex.length,
      baseline: startHeld,
      after: heldCount,
      gateLost: gateViolations(cases, gate, best, held),
    },
    applied,
    refused,
  };
}

/**
 * Format a gate reading.
 *
 * @param reading - The reading.
 * @returns The table, newline-separated, no trailing newline.
 */
export function formatGateReading(reading: GateReading): string {
  const lines = [
    `cases ${reading.cases}   answers ${reading.answers}   optimistic ${reading.optimistic}`,
    `gate: ${reading.gateLost} case(s) lost, ${reading.familiesLost} famil(ies) above the floor affected`,
    `${'faultType'.padEnd(32)} ${'n'.padStart(5)} ${'before'.padStart(7)} ${'after'.padStart(6)} ${'lost'.padStart(5)}`,
  ];
  for (const family of reading.families) {
    const mark = family.aboveFloor ? '' : '  (below floor)';
    lines.push(
      `${family.faultType.padEnd(32)} ${String(family.cases).padStart(5)} ${String(family.before).padStart(7)} ${String(family.after).padStart(6)} ${String(family.lost.length).padStart(5)}${mark}`,
    );
  }
  return lines.join('\n');
}

/**
 * Format a fit.
 *
 * @param report - The fit.
 * @returns The two halves and the move counts.
 */
export function formatGateFit(report: GateFitReport): string {
  const line = (label: string, half: FitHalf): string =>
    `${label.padEnd(5)} ${String(half.cases).padStart(5)} cases   baseline ${String(half.baseline).padStart(5)}   after ${String(half.after).padStart(5)}   vs baseline ${half.after - half.baseline >= 0 ? '+' : ''}${half.after - half.baseline}   gate lost ${half.gateLost}`;
  return [
    `GATE FIT`,
    `  ${line('train', report.train)}`,
    `  ${line('held', report.held)}`,
    `  moves: ${report.applied} applied, ${report.refused} refused because they would have opened the gate`,
  ].join('\n');
}

/** The arguments the console takes. */
export interface GateArgs {
  readonly terms: string;
  readonly fit: boolean;
  readonly epochs: number;
  readonly seed: number;
  readonly orientation: number;
  readonly familyFloor: number;
}

/**
 * Parse the console's arguments.
 *
 * @param argv - The arguments after the script name.
 * @returns The parsed arguments.
 */
export function parseGateArgs(argv: readonly string[]): GateArgs {
  let terms: string | null = null;
  let fit = false;
  let epochs = DEFAULT_GATE_FIT.epochs;
  let seed = DEFAULT_GATE_FIT.seed;
  let orientation = DEFAULT_GATE_FIT.orientation;
  let familyFloor = DEFAULT_GATE_FIT.familyFloor;
  const number = (flag: string, raw: string | undefined): number => {
    const value = Number(raw);
    if (raw === undefined || !Number.isFinite(value)) throw new Error(`${flag} expects a number`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--terms') {
      terms = argv[index + 1] ?? null;
      if (terms === null) throw new Error('--terms expects a dump path');
      index += 1;
      continue;
    }
    if (flag === '--fit') {
      fit = true;
      continue;
    }
    if (flag === '--epochs') {
      epochs = number(flag, argv[index + 1]);
      index += 1;
      continue;
    }
    if (flag === '--seed') {
      seed = number(flag, argv[index + 1]);
      index += 1;
      continue;
    }
    if (flag === '--orientation') {
      orientation = number(flag, argv[index + 1]);
      if (orientation !== -1 && orientation !== 0 && orientation !== 1)
        throw new Error('--orientation expects -1, 0 or 1');
      index += 1;
      continue;
    }
    if (flag === '--floor') {
      familyFloor = number(flag, argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${flag}`);
  }
  if (terms === null) throw new Error('--terms is required');
  return { terms, fit, epochs, seed, orientation, familyFloor };
}
