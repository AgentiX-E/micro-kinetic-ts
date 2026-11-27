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

import {
  DEFAULT_FAILURE_CONTAINMENT_SCOPE,
  type ContainmentDecision,
  type ContainmentPrior,
} from '../../packages/tree/src/index.js';

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
  /**
   * Which flow-pass scope the walkable rows state, and how many state each — `'absent'` for a row that predates
   * the field.
   *
   * A census rather than one value because a dump is a FILE and two runs can be concatenated into one: a reading
   * that took the first row's scope would silently re-walk half the corpus at the other half's configuration.
   */
  readonly scopes: Readonly<Record<string, number>>;
  /**
   * Which sweep WIDTH the walkable rows state, and how many state each — `'absent'` for a row that predates the
   * field.
   *
   * The second configuration this reading has to census, and for the same reason: ρ is fitted per edge over the
   * pairs a run examined, so two widths in one file are two populations and the halves are not halves of anything.
   */
  readonly depths: Readonly<Record<string, number>>;
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
  // `record-silent` is a decision only a CASE-SCOPED walk can reach, and every arm this module walks reads the
  // record per edge — so the column exists and stays zero. It is present rather than omitted because the counters
  // are a `Record` over the union: a missing key would make the census silently partial the day a scoped arm is
  // recorded through it, and §301 already cost this repository a defect of exactly that shape.
  const decisions: Record<ContainmentDecision, number> = {
    inverted: 0,
    'record-silent': 0,
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
  const scopes: Record<string, number> = {};
  const depths: Record<string, number> = {};

  for (const row of rows) {
    const answers = accepted.get(row.datapack);
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const gated = replayCase(row, {
      kind: 'prior',
      prior: priors.get(foldOf(row.datapack))!.prior,
    });
    if (base !== null) {
      replayable += 1;
      const scope = row.chain?.scope ?? ABSENT_SCOPE;
      scopes[scope] = (scopes[scope] ?? 0) + 1;
      const depth = row.depth === undefined ? ABSENT_SCOPE : String(row.depth);
      depths[depth] = (depths[depth] ?? 0) + 1;
    }
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
    scopes,
    depths,
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

/** The census token for a row whose chain does not state the scope the flow pass ran at. */
export const ABSENT_SCOPE = 'absent';

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
 * The criterion as it applies to THIS corpus.
 *
 * `shippedTop1` records 1 156, the shipped arm's Top@1 on the archive the pre-registration was written against,
 * and the clause it carries is "the arm must EXCEED the shipped arm". On a corpus whose own shipped arm answers
 * 1 186 — the same archive under `--failure-containment-scope global-measured` — a floor pinned at 1 156 lets an
 * arm that **loses sixteen cases** satisfy the only clause about the LEVEL rather than the movement.
 *
 * So the bar is the higher of the record and this corpus's own shipped arm: the record never lowers, and a corpus
 * better than the record is judged against itself. The two are equal on every healthy artifact, because the
 * disagreement check already guarantees the shipped arm reproduces the recorded number.
 *
 * @param reading - The gate's reading.
 * @param criterion - The standing gate, or another one.
 * @returns The criterion with the level clause bound to the corpus.
 */
export function gateBar(
  reading: GateReading,
  criterion: GateCriterion = STANDING_CRITERION,
): GateCriterion {
  const own = reading.arms.shipped.top1;
  return own > criterion.shippedTop1 ? { ...criterion, shippedTop1: own } : criterion;
}

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
  // Two configurations in one file is not a population: the prior is fitted on half the corpus and applied to the
  // other, and a fold whose rows were walked at another scope is not the other half of anything.
  const stated = Object.keys(reading.scopes).filter((scope) => scope !== ABSENT_SCOPE);
  if (stated.length > 1) {
    return {
      verdict: 'unmeasured',
      reason: `the dump states ${stated.length} flow-pass scopes (${stated.join(', ')}), so its rows are not one configuration`,
    };
  }
  // The same rule for the sweep WIDTH, and it is a rule rather than a nicety: the prior is fitted on one half and
  // applied to the other, and ρ is a ratio over the pairs the run examined — a file that mixed a five-wide half
  // with a pool-wide half would fit an edge statistic over two populations.
  const widths = Object.keys(reading.depths).filter((depth) => depth !== ABSENT_SCOPE);
  if (widths.length > 1) {
    return {
      verdict: 'unmeasured',
      reason: `the dump states ${widths.length} sweep widths (${widths.join(', ')}), so its pairs are not one population`,
    };
  }
  if (reading.disagreements > 0) {
    // The scope is named in the refusal because a mismatch on a dump that states NONE is a missing word rather
    // than a broken chain, and a reader told only "the chain is incomplete" would go looking in the wrong file.
    const walked =
      stated[0] === undefined
        ? `${DEFAULT_FAILURE_CONTAINMENT_SCOPE}, ASSUMED (the dump states no scope)`
        : `stated ${stated[0]}`;
    return {
      verdict: 'unmeasured',
      reason: `${reading.disagreements} case(s) did not reproduce the recorded top-1, so the chain is incomplete at the scope ${walked}`,
    };
  }
  return judgeArm(reading.arms.prior, gateBar(reading, criterion));
}

/**
 * Order two edge keys by code unit.
 *
 * `localeCompare` would answer from ICU and the active locale — machine state — and this comparison exists so
 * that two runs of one corpus produce artifacts a reader can diff. Named rather than inlined so that the equality
 * case is expressible: a `Map` cannot hold a duplicate key, so an inline comparator's `=== 0` arm is unreachable
 * and untestable, and an unreachable arm in a sort is exactly the one that would be wrong when it mattered.
 *
 * @param a - One key.
 * @param b - The other.
 * @returns `-1`, `0` or `1`.
 */
export function compareEdgeKeys(a: string, b: string): number {
  // The equality arm is the whole point: the `? -1 : 1` shape this repository audits answers `1` in BOTH
  // directions for a pair of equal keys, which is the inconsistency `docs/comparator-consistency-audit.md`
  // measured. This one answers `0`, so it is consistent for every pair and not only for a unique-keyed list.
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The reading as JSON, with the priors' residual maps made serialisable.
 *
 * `JSON.stringify` writes a `Map` as `{}`, so the first artifact of this reading recorded `"residuals": {}` and
 * kept `fitted`/`admitted` while losing **which edges** they were — the one thing §15.2 of
 * `docs/containment-order.md` exists to guarantee, since a reader with the JSON alone could not reproduce an
 * admission. Recorded in §15.9 as a defect of that artifact rather than patched into it; this is the fix, and it
 * changes the artifact only for runs after it.
 *
 * The map becomes an array of `[edgeKey, residual]` pairs sorted by key, so two runs of one corpus diff cleanly
 * instead of reordering themselves.
 *
 * @param reading - The gate's reading.
 * @returns A JSON-ready object: the reading with each prior's residuals as sorted entries.
 */
export function gateReadingToJson(reading: GateReading): object {
  return {
    ...reading,
    priors: reading.priors.map((prior) => ({
      ...prior,
      prior: {
        threshold: prior.prior.threshold,
        residuals: [...prior.prior.residuals.entries()].sort(([left], [right]) =>
          compareEdgeKeys(left, right),
        ),
      },
    })),
  };
}

/**
 * The criterion's three numbers, applied to one arm.
 *
 * Split out so that a second arm — the residual spent as a term rather than as a gate — is judged by THIS
 * implementation and not by a copy of it. Two arms judged by two copies of a criterion is how a repository ends up
 * with two bars that both call themselves the standing one.
 *
 * @param arm - The arm's Top@1 and its ± against the no-pass baseline.
 * @param criterion - The standing gate, or another one.
 * @returns `'pass'`, or `'fail'` with the number that failed.
 */
export function judgeArm(
  arm: GateArmScore,
  criterion: GateCriterion = STANDING_CRITERION,
): { readonly verdict: 'pass' | 'fail'; readonly reason: string } {
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
