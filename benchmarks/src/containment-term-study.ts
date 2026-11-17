/**
 * Price the residual spent as a TERM, on the same artifact that refused it as a gate.
 *
 * ## What this reads, and why the reading is not a second implementation
 *
 * Every number here comes from the corpus walk the engine already published: the case's fusion order, its call
 * edges, its excursions and its published top-1 are in `containment.ndjson`, and the score the fusion gave each
 * candidate is in `depth.ndjson`. The two files come from one run of one commit, and the `shipped` arm is walked
 * again beside the new one and compared with the top-1 the run recorded — so the artifact is checked against
 * itself on every read rather than trusted once. On run `44013268053` that check is exact over 1 422 cases.
 *
 * The consequence is worth stating plainly: a NEW arm can be priced without a new dispatch, because the
 * expensive part of the question is the corpus walk and the walk records its own inputs
 * (`containment-rows.ts`, `chain`). An arm is then a local computation on a record.
 *
 * ## The cross-fit, and the re-check of an old number
 *
 * φ is fitted on one half and paid on the other, in both directions, for the reason the gate gives: a case that
 * contributed its observations to an edge's φ and is then moved by it is being graded on its own answer. The
 * `prior` arm — the gate, with its ρ — is walked in the same pass, so the report carries the `+27 / −3` / 1 165
 * reading beside the new arm and a reader can see whether the old number reproduces.
 *
 * @module benchmarks/containment-term-study
 */

import {
  foldOf,
  judgeArm,
  otherFold,
  priorsFor,
  STANDING_CRITERION,
  type CorpusFold,
  type GateArmScore,
  type GateCriterion,
} from './containment-gate.js';
import { headOf, replayAgrees, replayCase, type ReplayedCase } from './containment-replay.js';
import {
  countObservations,
  edgeKeyOf,
  top1Correct,
  type EdgeCounts,
} from './containment-residual.js';
import type { ContainmentCaseRow } from './containment-rows.js';
import { fusionPairs, phiByEdge, termTransfers } from './containment-term.js';

/** The score the fusion gave each candidate of each case, keyed `datapack → service → score`. */
export type ScoreTable = ReadonlyMap<string, ReadonlyMap<string, number>>;

/** What one half's φ fit saw. */
export interface TermFit {
  /** The half the φ map was fitted on. */
  readonly fittedOn: CorpusFold;
  /** The half it was paid on. The other one, always. */
  readonly appliesTo: CorpusFold;
  /** Edges the fitting half examined, over the fusion order's own adjacencies. */
  readonly edges: number;
  /** Edges whose population reached the residual module's floor and whose φ is defined. */
  readonly fitted: number;
  /** Of those, the edges with φ > 0 — the only ones that can pay anything. */
  readonly positive: number;
  /** Pairs the fit counted. */
  readonly observations: number;
}

/**
 * What the term did over the pairs it examined.
 *
 * The four numbers satisfy `qualified = unfitted + paid + silent`, and that identity is the census's own
 * correctness check: a pair that qualified and is in none of the three buckets has been lost by the walk, which
 * is a different finding from a term that paid nothing.
 */
export interface TermCensus {
  /** Pairs the predicate qualified: both sides measured, callee outran the caller by more than the margin. */
  readonly qualified: number;
  /** Of those, pairs on an edge nobody fitted. They pay nothing and are counted apart from a zero. */
  readonly unfitted: number;
  /** Pairs that paid a positive δ. */
  readonly paid: number;
  /** Pairs on a fitted edge that paid exactly zero: the corpus measured no coupling, or measured it against. */
  readonly silent: number;
  /** Pairs that did not qualify: unmeasured, or the callee did not outrun its caller. */
  readonly refused: number;
}

/**
 * How far a promotion reached, and what it was worth.
 *
 * One row per rank the promoted candidate held in the fusion order, counting only the cases whose PUBLISHED head
 * changed and whose correctness changed with it. This is the term's mechanism made countable: an adjacent swap can
 * only ever promote the candidate at rank 2, while a term can lift anything, and the two are not the same bet at
 * different distances.
 */
export interface TermReach {
  /** The rank, 1-based, the promoted candidate held in the fusion order. */
  readonly rank: number;
  /** Cases where the promotion was right. */
  readonly gains: number;
  /** Cases where it was wrong. */
  readonly losses: number;
}

/** The term arm's whole reading. */
export interface TermReading {
  /** Rows in the dump. */
  readonly cases: number;
  /** Rows carrying a chain, i.e. rows that can be walked. */
  readonly replayable: number;
  /** Rows whose `shipped` replay did NOT reproduce the recorded top-1. Zero on a healthy artifact. */
  readonly disagreements: number;
  /** Rows the graded arm refused to order, because a candidate had no finite score. */
  readonly unordered: number;
  /** The λ this reading was taken at. */
  readonly lambda: number;
  /** The two fits. */
  readonly fits: readonly TermFit[];
  /**
   * The population the fit used, against the one the gate used.
   *
   * `fusion` counts the adjacent pairs of the fusion order carrying an edge, `ungated` the pairs the ungated
   * sweep examined, and `shared` the cases on which the two counts agree. The term must fit on the first because
   * it runs no sweep; the difference is reported rather than assumed away.
   */
  readonly population: {
    readonly fusion: number;
    readonly ungated: number;
    readonly shared: number;
  };
  /** What the term did, summed over both halves. */
  readonly census: TermCensus;
  /** Cases whose graded head differs from the fusion head, before the flow pass. */
  readonly moved: number;
  /** Precision by how far the promotion reached, over the cases whose published answer changed. */
  readonly reach: readonly TermReach[];
  /** The four arms. `fusion` is the no-pass baseline at 1 141. */
  readonly arms: {
    readonly fusion: GateArmScore;
    readonly shipped: GateArmScore;
    readonly prior: GateArmScore;
    readonly graded: GateArmScore;
  };
}

/** An arm's running tally. */
interface Tally {
  correct: number;
  gains: number;
  losses: number;
}

/** The three answers one case gives, or `null` where an arm produced none. */
type Outcomes = Record<'fusion' | 'shipped' | 'prior' | 'graded', boolean | null>;

/**
 * One arm's answer for one case: the head it published and whether that head is accepted.
 *
 * Both halves of the answer together, because they are the same question asked twice and computing them apart is
 * how the reach census and the tally could end up describing two different answers. `head` is `null` when the arm
 * published nothing — an empty order, or no walk at all — and `correct` is `null` with it, so the guard in
 * {@link readTerm} drops the case from every column at once.
 *
 * @param replayed - The arm's walk, or `null` when it produced none.
 * @param answers - The case's accepted set.
 * @returns The published head and whether it is accepted, each possibly `null`.
 */
function answerOf(
  replayed: ReplayedCase | null,
  answers: readonly string[],
): { readonly head: string | null; readonly correct: boolean | null } {
  if (replayed === null) return { head: null, correct: null };
  const head = headOf(replayed.published);
  return { head, correct: top1Correct(head, answers) };
}

/** One half's φ map, plus the census of how it was obtained. */
function fitHalf(
  rows: readonly ContainmentCaseRow[],
  fittedOn: CorpusFold,
): { readonly fit: TermFit; readonly phi: Map<string, number> } {
  const subset = rows.filter((row) => foldOf(row.datapack) === fittedOn);
  const counts: Map<string, EdgeCounts> = countObservations(subset.map((row) => fusionPairs(row)));
  const phi = phiByEdge(counts);
  let observations = 0;
  for (const entry of counts.values()) observations += entry.measured;
  let positive = 0;
  for (const value of phi.values()) if (value > 0) positive += 1;
  return {
    fit: {
      fittedOn,
      appliesTo: otherFold(fittedOn),
      edges: counts.size,
      fitted: phi.size,
      positive,
      observations,
    },
    phi,
  };
}

/**
 * Read the term arm over the whole corpus, cross-fitted.
 *
 * @param rows - The containment dump's rows.
 * @param scores - The depth dump's scores, keyed `datapack → service → score`.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @param lambda - The score points a fully coupled edge pays at full asymmetry.
 * @returns The four arms, the two fits, the population census and the transfers' census.
 */
export function readTerm(
  rows: readonly ContainmentCaseRow[],
  scores: ScoreTable,
  accepted: ReadonlyMap<string, readonly string[]>,
  lambda: number,
): TermReading {
  const halved = ([...new Set(rows.map((row) => foldOf(row.datapack)))] as CorpusFold[])
    .sort()
    .map((fittedOn) => fitHalf(rows, fittedOn));
  const byApplies = new Map<CorpusFold, ReadonlyMap<string, number>>();
  for (const half of halved) byApplies.set(half.fit.appliesTo, half.phi);

  const population = { fusion: 0, ungated: 0, shared: 0 };
  const census = { qualified: 0, unfitted: 0, paid: 0, silent: 0, refused: 0 };
  const priors = priorsFor(rows, 'rho');
  const tally: Record<keyof Outcomes, Tally> = {
    fusion: { correct: 0, gains: 0, losses: 0 },
    shipped: { correct: 0, gains: 0, losses: 0 },
    prior: { correct: 0, gains: 0, losses: 0 },
    graded: { correct: 0, gains: 0, losses: 0 },
  };
  const reach = new Map<number, { gains: number; losses: number }>();
  let replayable = 0;
  let disagreements = 0;
  let unordered = 0;
  let moved = 0;

  for (const row of rows) {
    const chain = row.chain;
    if (chain === undefined) continue;
    replayable += 1;

    // The population census: one case measured two ways. Not a diagnostic for its own sake — the term's φ is
    // fitted on the first and §15.9's on the second, so the two arms' readings are comparable only to the extent
    // these agree, and that extent is a number rather than a belief.
    if (chain.order.length > 1) {
      const fusion = fusionPairs(row).length;
      population.fusion += fusion;
      population.ungated += row.ungatedPairs.length;
      if (fusion === row.ungatedPairs.length) population.shared += 1;
    }

    const pairs = fusionPairs(row);
    const phi = byApplies.get(foldOf(row.datapack)) ?? new Map<string, number>();
    // Every pair the fusion's adjacency offers is classified exactly once, so the census adds up to the pairs
    // examined rather than to a subset of them.
    for (const pair of pairs) {
      const measured = pair.upperExcursion !== undefined && pair.lowerExcursion !== undefined;
      if (!measured || !(pair.lowerExcursion! > pair.upperExcursion! + row.margin)) {
        census.refused += 1;
        continue;
      }
      census.qualified += 1;
      if (!phi.has(edgeKeyOf(pair.upper, pair.lower))) census.unfitted += 1;
    }
    const transfers = termTransfers({ pairs, phi, lambda, margin: row.margin });
    for (const transfer of transfers) {
      if (transfer.delta > 0) census.paid += 1;
      else census.silent += 1;
    }

    const pairScores = scores.get(row.datapack);
    const graded =
      pairScores === undefined
        ? null
        : replayCase(row, { kind: 'graded', transfers, scores: pairScores });
    if (graded === null) unordered += 1;
    const base = replayCase(row, { kind: 'off' });
    const shipped = replayCase(row, { kind: 'shipped' });
    const gated = replayCase(row, {
      kind: 'prior',
      prior: priors.get(foldOf(row.datapack))!.prior,
    });
    if (shipped !== null && !replayAgrees(row, shipped)) disagreements += 1;
    if (graded !== null && headOf(graded.containment) !== headOf(chain.order)) moved += 1;

    const answers = accepted.get(row.datapack);
    if (answers === undefined) continue;
    const answered = {
      fusion: answerOf(base, answers),
      shipped: answerOf(shipped, answers),
      prior: answerOf(gated, answers),
      graded: answerOf(graded, answers),
    };
    const outcomes: Outcomes = {
      fusion: answered.fusion.correct,
      shipped: answered.shipped.correct,
      prior: answered.prior.correct,
      graded: answered.graded.correct,
    };
    // A row an arm could not answer contributes to nothing: counting it as wrong would credit an arm for a case
    // it never saw, and counting it as right would do worse.
    if (Object.values(outcomes).some((outcome) => outcome === null)) continue;

    // The reach census: only the cases where the PUBLISHED head moved and the answer moved with it, because a
    // promotion that changes nothing is not a bet that was placed. The rank is the fusion's own, so "rank 2" means
    // the candidate the fusion already had second — the only one an adjacent swap can reach.
    const gradedHead = answered.graded.head;
    if (gradedHead !== null && gradedHead !== answered.fusion.head) {
      // The head came out of this order, so its rank is at least 1; no defensive branch, because a branch that
      // cannot be taken is a branch that cannot be tested.
      const rank = chain.order.indexOf(gradedHead) + 1;
      const bucket = reach.get(rank) ?? { gains: 0, losses: 0 };
      if (outcomes.graded === true && outcomes.fusion === false) bucket.gains += 1;
      if (outcomes.graded === false && outcomes.fusion === true) bucket.losses += 1;
      reach.set(rank, bucket);
    }
    for (const arm of ['fusion', 'shipped', 'prior', 'graded'] as const) {
      const ok = outcomes[arm];
      if (ok === true) tally[arm].correct += 1;
      // Gains and losses are against the BASELINE in every arm, the baseline included — where they are 0 / 0 by
      // construction, which is what makes the four columns one scale rather than four.
      if (ok === true && outcomes.fusion === false) tally[arm].gains += 1;
      if (ok === false && outcomes.fusion === true) tally[arm].losses += 1;
    }
  }

  return {
    cases: rows.length,
    replayable,
    disagreements,
    unordered,
    lambda,
    fits: halved.map((half) => half.fit),
    population,
    census,
    moved,
    reach: [...reach.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rank, bucket]) => ({ rank, gains: bucket.gains, losses: bucket.losses }))
      .filter((entry) => entry.gains + entry.losses > 0),
    arms: {
      fusion: { top1: tally.fusion.correct, gains: 0, losses: 0 },
      shipped: {
        top1: tally.shipped.correct,
        gains: tally.shipped.gains,
        losses: tally.shipped.losses,
      },
      prior: { top1: tally.prior.correct, gains: tally.prior.gains, losses: tally.prior.losses },
      graded: {
        top1: tally.graded.correct,
        gains: tally.graded.gains,
        losses: tally.graded.losses,
      },
    },
  };
}

/**
 * Price the term across a grid of λ.
 *
 * The sweep exists because the pre-registration commits to it before the number exists: a single λ is a
 * parameter, and a curve over a 16-fold range is the smallest thing that can distinguish "the weight works" from
 * "the weight was chosen by whoever liked the number it gave".
 *
 * @param rows - The containment dump's rows.
 * @param scores - The depth dump's scores.
 * @param accepted - The accepted answers.
 * @param lambdas - The λ values to read, in order.
 * @returns One reading per λ.
 */
export function sweepTerm(
  rows: readonly ContainmentCaseRow[],
  scores: ScoreTable,
  accepted: ReadonlyMap<string, readonly string[]>,
  lambdas: readonly number[],
): TermReading[] {
  return lambdas.map((lambda) => readTerm(rows, scores, accepted, lambda));
}

/**
 * The pre-registered verdict for the term arm.
 *
 * The same three numbers as the gate, applied by the same {@link judgeArm}, because the point of the comparison
 * is that the bar did not move. The structural refusals are the gate's plus one: a case the graded arm declined
 * to order is a case whose candidates it could not compare, and reading the arm over the rest would be reading it
 * over the population it happened to be able to sort.
 *
 * @param reading - One λ's reading.
 * @param criterion - The standing gate, or another one.
 * @returns `'pass'`, `'fail'`, or `'unmeasured'` with the reason.
 */
export function termVerdict(
  reading: TermReading,
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
      reason: `${reading.cases - reading.replayable} of ${reading.cases} rows carry no sweep input`,
    };
  }
  if (reading.disagreements > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.disagreements} case(s) did not reproduce the recorded top-1, so the chain is incomplete`,
    };
  }
  if (reading.unordered > 0) {
    return {
      verdict: 'unmeasured',
      reason: `${reading.unordered} case(s) carry a candidate with no finite score, so the arm declined to order them`,
    };
  }
  return judgeArm(reading.arms.graded, criterion);
}
