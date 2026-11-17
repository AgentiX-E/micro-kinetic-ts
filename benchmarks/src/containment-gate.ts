/**
 * H2's second criterion: the residual as the containment pass's requirement, fitted on one half and read on the
 * other.
 *
 * ## The question, and why a split is not a nicety
 *
 * The pre-registration's first criterion asks whether ρ separates a gain from a loss (an AUC), and the second
 * asks whether requiring ρ > 0 would make the pass BETTER — read as +15 / −0 and a Top@1 above the shipped
 * 1 156. The second cannot be answered on the same cases the first was fitted on: a case contributes its own
 * two indicators to its edge's residual, so gating a case with a residual it helped compute grades it on its own
 * answer. With 809 observations over 64 edges the leak is small in aggregate and unbounded per case — one case
 * can move the residual of a thin edge across the threshold by itself — and "small" is not the standard this
 * repository holds its own numbers to.
 *
 * So the corpus is cut in two, each half's residual is fitted from the OTHER half, and every case is gated
 * exactly once by a prior it did not contribute to. Both halves are then read together, which is what keeps the
 * result comparable to the whole-corpus 1 156 rather than to a half-sized number.
 *
 * ## The fold is a hash, not a line number
 *
 * The dump is in the loader's directory order, which on this corpus groups cases by fault family. Cutting every
 * other line would interleave within a family only while the family's block length is what the arithmetic
 * assumes; cutting on a hash of the case name makes the split independent of the file's order by construction,
 * and a reader can reproduce any case's fold from the name alone. The cost is that the halves are not exactly
 * equal in size — which no reading here depends on.
 *
 * ## Two statistics, and the pre-registered one decides
 *
 * The prior can be fitted from ρ or from φ, and both are reported. ρ is the pre-registered statistic and the
 * only one whose verdict counts: a hypothesis is judged by the number it fixed. φ is read beside it because ρ's
 * ceiling depends on the marginals — an edge whose two ends are always out of band scores 0 however perfectly
 * they move — and if the gate separates on φ and not on ρ, that is the ceiling talking and the record should say
 * so in the same artifact rather than after a second corpus walk.
 *
 * @module benchmarks/containment-gate
 */

import type { ContainmentDecision, ContainmentPrior } from '../../packages/tree/src/index.js';

import { headOf, replayAgrees, replayCase } from './containment-replay.js';
import { edgeCounts, residuals, type ResidualScore } from './containment-residual.js';
import type { ContainmentCaseRow } from './containment-rows.js';

/**
 * The pre-registered threshold: `ρ > 0`.
 *
 * Zero rather than a tuned number, for the reason the margin is zero: `ρ = 0` is exactly the independence the
 * mechanism claims a propagating pair departs from, so any positive threshold would be a number with no
 * derivation and any negative one would admit the pairs the hypothesis is about.
 */
export const GATE_THRESHOLD = 0;

/** Which half of the corpus. */
export type CorpusFold = 'a' | 'b';

/** The other half. */
export function otherFold(fold: CorpusFold): CorpusFold {
  return fold === 'a' ? 'b' : 'a';
}

/**
 * Assign a case to a fold.
 *
 * FNV-1a over the case name, low bit. Chosen for the two properties a split needs and an index does not have:
 * it is a function of the NAME (so a reader holding one row can place it), and it is independent of the file's
 * order (so a dump sorted by directory, which on this corpus is sorted by fault family, does not put a family on
 * one side).
 *
 * @param datapack - The case directory's name.
 * @returns The fold the case belongs to.
 */
export function foldOf(datapack: string): CorpusFold {
  let hash = 0x811c9dc5;
  for (let i = 0; i < datapack.length; i++) {
    hash ^= datapack.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 1) === 0 ? 'a' : 'b';
}

/** A prior and the census of the half it came from. */
export interface FittedPrior {
  /** The half the residual was fitted on. */
  readonly fittedOn: CorpusFold;
  /** The half it may be applied to. The other one, always. */
  readonly appliesTo: CorpusFold;
  /** What the gate requires. */
  readonly prior: ContainmentPrior;
  /** Which statistic the prior was fitted from. */
  readonly score: ResidualScore;
  /** Edges the fitting half examined. */
  readonly edges: number;
  /** Edges whose population reached the residual module's floor. */
  readonly fitted: number;
  /** Edges admitted by the threshold. */
  readonly admitted: number;
  /** Observations the fit had. */
  readonly observations: number;
  /**
   * Edges the fitting half could not fit, and which therefore refuse every inversion on the other half.
   *
   * Named because it is the gate's real price: a requirement fitted on half a corpus refuses edges the whole
   * corpus could have measured, and a report that showed only `admitted` would hide the cases the gate refused
   * for want of data rather than for want of co-movement.
   */
  readonly unfitted: number;
}

/**
 * Fit the prior on one half.
 *
 * The population is the UNGATED arm's examined pairs, and the choice is worth stating: the two arms are two
 * walks, and the arm that inverted more pairs examined more adjacencies. The residual is a property of an edge
 * over every occasion the sweep looked at it, so the wider trace is the better estimate — and it is also the
 * neutral one, because the gate is proposed as a REPLACEMENT for the interface record rather than as a filter
 * on top of it.
 *
 * @param rows - The corpus's dump rows.
 * @param fittedOn - The half to fit from.
 * @param score - `rho` (pre-registered) or `phi`.
 * @returns The prior, and the census that says how much of the half it could use.
 */
export function fitPrior(
  rows: readonly ContainmentCaseRow[],
  fittedOn: CorpusFold,
  score: ResidualScore = 'rho',
): FittedPrior {
  const half = rows.filter((row) => foldOf(row.datapack) === fittedOn);
  const counts = edgeCounts(half, 'ungated');
  const edges = residuals(counts);
  const residualsByKey = new Map<string, number>();
  let admitted = 0;
  let fitted = 0;
  for (const edge of edges) {
    const value = score === 'rho' ? edge.rho : edge.phi;
    // A `null` is a population that could not support an estimate; it is NOT a zero residual, and putting it in
    // the map would make the gate treat an unmeasurable edge as a measured independent one.
    if (value === null) continue;
    fitted += 1;
    // EVERY fitted residual goes into the map, including the ones the threshold refuses. Filtering here would
    // make a measured negative indistinguishable from a measurement that never happened, and the sweep would
    // then report the two under one name — the distinction its two `prior-*` decisions exist to keep.
    residualsByKey.set(`${edge.a}\u0000${edge.b}`, value);
    residualsByKey.set(`${edge.b}\u0000${edge.a}`, value);
    if (value > GATE_THRESHOLD) admitted += 1;
  }
  let observations = 0;
  for (const entry of counts.values()) observations += entry.measured;
  return {
    fittedOn,
    appliesTo: otherFold(fittedOn),
    prior: { residuals: residualsByKey, threshold: GATE_THRESHOLD },
    score,
    edges: edges.length,
    fitted,
    admitted,
    observations,
    unfitted: edges.length - fitted,
  };
}

/**
 * One prior per fold, each fitted on the other.
 *
 * Keyed by the fold it may be APPLIED to, so the caller cannot apply a prior to the half it came from: there is
 * no entry under that key.
 *
 * @param rows - The corpus's dump rows.
 * @param score - Which statistic to fit from.
 * @returns One fitted prior per fold.
 */
export function priorsFor(
  rows: readonly ContainmentCaseRow[],
  score: ResidualScore = 'rho',
): Map<CorpusFold, FittedPrior> {
  return new Map<CorpusFold, FittedPrior>([
    ['a', fitPrior(rows, 'b', score)],
    ['b', fitPrior(rows, 'a', score)],
  ]);
}

/** One arm's answer over the population it could be scored on. */
export interface GateArmScore {
  /** Cases whose first candidate is in the accepted set. */
  readonly top1: number;
  /** Cases this arm gets right and the fusion baseline does not. */
  readonly gains: number;
  /** Cases the fusion baseline gets right and this arm does not. */
  readonly losses: number;
}

/** The gate's whole reading. */
export interface GateReading {
  /** Rows in the dump. */
  readonly cases: number;
  /** Rows carrying a chain, i.e. rows that can be walked. */
  readonly replayable: number;
  /** Rows with an accepted set, a chain, and three walks — the population every number below is over. */
  readonly scored: number;
  /** Rows whose shipped replay did NOT reproduce the recorded top-1. Zero on a healthy artifact. */
  readonly disagreements: number;
  /** The two halves' priors, keyed by the half each applies to. */
  readonly priors: readonly FittedPrior[];
  /** The no-pass baseline, the shipped arm, and the residual-gated arm. */
  readonly arms: {
    readonly fusion: GateArmScore;
    readonly shipped: GateArmScore;
    readonly prior: GateArmScore;
  };
  /** What the gated walks decided, over every pair they examined. */
  readonly decisions: Readonly<Record<ContainmentDecision, number>>;
  /** Pairs the gate stopped that the sweep would otherwise have inverted, per reason. */
  readonly blocked: { readonly absent: number; readonly below: number };
}

/** Whether a case's answer is correct: `null` when the arm had no answer. */
function correct(answer: string | null, accepted: readonly string[]): boolean | null {
  if (answer === null) return null;
  return accepted.includes(answer);
}

/**
 * Read the gate over the whole corpus, cross-fitted.
 *
 * @param rows - The corpus's dump rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @param score - Which statistic the prior is fitted from.
 * @returns The three arms' numbers, the two priors, and the gated walks' census.
 */
export function readGate(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
  score: ResidualScore = 'rho',
): GateReading {
  const priors = priorsFor(rows, score);
  const decisions: Record<ContainmentDecision, number> = {
    inverted: 0,
    'no-failed-interface': 0,
    unmeasured: 0,
    'not-larger': 0,
    'prior-absent': 0,
    'prior-below': 0,
  };
  const tally = { fusion: 0, shipped: 0, prior: 0 };
  const gains = { shipped: 0, prior: 0 };
  const losses = { shipped: 0, prior: 0 };
  let replayable = 0;
  let scored = 0;
  let disagreements = 0;

  for (const row of rows) {
    const answers = accepted.get(row.datapack);
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const gated = replayCase(row, {
      kind: 'prior',
      prior: priors.get(foldOf(row.datapack))!.prior,
    });
    if (base !== null) replayable += 1;
    // The census is over every row that could be walked, including rows with no accepted answer: it describes
    // the gate's behaviour, which is a property of the sweep, not of the labels.
    if (gated !== null) {
      for (const verdict of gated.verdicts) decisions[verdict.decision] += 1;
    }
    // A row the replay cannot perform contributes to nothing: counting it as an arm that got the case wrong
    // would make a dump's coverage look like a capability.
    if (answers === undefined || base === null || shipped === null || gated === null) continue;
    if (!replayAgrees(row, shipped)) disagreements += 1;
    const baseOk = correct(headOf(base.published), answers);
    const shippedOk = correct(headOf(shipped.published), answers);
    const priorOk = correct(headOf(gated.published), answers);
    if (baseOk === null || shippedOk === null || priorOk === null) continue;
    scored += 1;
    if (baseOk) tally.fusion += 1;
    if (shippedOk) tally.shipped += 1;
    if (priorOk) tally.prior += 1;
    if (shippedOk && !baseOk) gains.shipped += 1;
    if (!shippedOk && baseOk) losses.shipped += 1;
    if (priorOk && !baseOk) gains.prior += 1;
    if (!priorOk && baseOk) losses.prior += 1;
  }

  return {
    cases: rows.length,
    replayable,
    scored,
    disagreements,
    priors: [priors.get('a')!, priors.get('b')!],
    arms: {
      fusion: { top1: tally.fusion, gains: 0, losses: 0 },
      shipped: { top1: tally.shipped, gains: gains.shipped, losses: losses.shipped },
      prior: { top1: tally.prior, gains: gains.prior, losses: losses.prior },
    },
    decisions,
    blocked: { absent: decisions['prior-absent'], below: decisions['prior-below'] },
  };
}

/** The standing gate's two numbers, as values so the verdict is a function and not a sentence in a log. */
export interface GateCriterion {
  /** The fewest gains the pass must add. */
  readonly gains: number;
  /** The most losses it may take. */
  readonly losses: number;
  /** The Top@1 the shipped corpus already holds. The arm must EXCEED it. */
  readonly shippedTop1: number;
}

/** The pre-registered criterion, as written in `docs/containment-order.md` §12/§14. */
export const STANDING_CRITERION: GateCriterion = { gains: 15, losses: 0, shippedTop1: 1_156 };

/**
 * The pre-registered verdict.
 *
 * @param reading - The gate's reading.
 * @param criterion - The standing gate, or another one.
 * @returns `'pass'`, `'fail'` with the arm's numbers, or `'unmeasured'` when nothing could be walked.
 */
export function gateVerdict(
  reading: GateReading,
  criterion: GateCriterion = STANDING_CRITERION,
): { readonly verdict: 'pass' | 'fail' | 'unmeasured'; readonly reason: string } {
  if (reading.replayable === 0) {
    return {
      verdict: 'unmeasured',
      reason: 'no row carries the sweep input, so no arm can be walked',
    };
  }
  if (reading.replayable < reading.cases) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.cases - reading.replayable} of ${reading.cases} rows carry no sweep input, so the gate would be read over a population the run did not declare`,
    };
  }
  if (reading.disagreements > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.disagreements} case(s) did not reproduce the recorded top-1, so the chain is incomplete`,
    };
  }
  const arm = reading.arms.prior;
  if (arm.gains < criterion.gains) {
    return {
      verdict: 'fail',
      reason: `+${arm.gains} is below the ${criterion.gains} the gate requires`,
    };
  }
  if (arm.losses > criterion.losses) {
    return {
      verdict: 'fail',
      reason: `${arm.losses} loss(es) against a requirement of ${criterion.losses}`,
    };
  }
  if (arm.top1 <= criterion.shippedTop1) {
    return {
      verdict: 'fail',
      reason: `Top@1 ${arm.top1} does not exceed the shipped ${criterion.shippedTop1}`,
    };
  }
  return {
    verdict: 'pass',
    reason: `Top@1 ${arm.top1} > ${criterion.shippedTop1} at +${arm.gains} / −${arm.losses}`,
  };
}
