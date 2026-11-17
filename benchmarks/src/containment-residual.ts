/**
 * The factorisation residual ρ of a pair's out-of-band indicators, aggregated over the corpus.
 *
 * ## The statement
 *
 * H2 (iteration-294 pre-registration): for a pair joined by a call edge, a genuine propagation makes the two
 * services' post-injection deviations **co-move more than independence predicts**:
 *
 *     ρ(a,b) = P(δa out of band ∧ δb out of band) − P(δa out of band) · P(δb out of band)
 *
 * This is the Stosszahlansatz used as a TEST rather than a weight — the assumption that joint behaviour
 * factorises unless an interaction exists — and it is the principled form of the crude record that removed five
 * losses in iteration 293 (a count of failed calls on the pair's own interface). The interface record answers
 * "did anything pass between these two"; ρ asks "did their movements co-move".
 *
 * ## What is counted, and what is refused
 *
 * - A pair whose **either** side the profile could not measure contributes NOTHING. Reading the missing side as
 *   "in band" would inflate the denominator with observations that were never made, and the residual would then
 *   be a statement about the profile's coverage rather than about the corpus.
 * - `δ = excursion > 0`, and `0` is a measurement (the service stayed inside its band), so it is counted. The
 *   distinction between `0` and *absent* is the whole reason `latencyExcursions` omits a service rather than
 *   zeroing it, and this module is where that distinction has to survive.
 * - The pair is keyed **unordered**, because ρ is symmetric: the joint probability and both marginals are.
 *   Keying by direction would split one edge's observations into two half-populations and halve the estimate
 *   exactly where it is thinnest.
 * - A population smaller than {@link MIN_POPULATION} yields no residual at all rather than a number, for the
 *   reason the estimator's own algebra gives: with `n` observations the sampling error of ρ is about `1/√n`, so
 *   a residual over six cases cannot be distinguished from zero and reporting it would be reporting noise.
 *
 * ## Why the discrimination is an AUC and not an accuracy
 *
 * The label ("this inversion moved the case") is rare — 38 of 43, or 5 of 43 — so an accuracy at any threshold
 * would be dominated by the class that is already the majority. The AUC asks the only question the residual has
 * to answer before it may be used as a gate: **given one gain and one loss, how often is the gain's ρ the
 * larger one?** Ties count half, and a population with one class yields `null` rather than `0.5`.
 *
 * @module benchmarks/containment-residual
 */

import type { ContainmentCaseRow, ContainmentPairRow } from './containment-rows.js';

/** The smallest population a residual is reported over. See the module docblock for the derivation. */
export const MIN_POPULATION = 10;

/** One edge's counts. `a` is the lexicographically smaller service, so the key is canonical. */
export interface EdgeCounts {
  /** Observations in which both sides were measured. */
  readonly measured: number;
  /** Observations in which both sides were out of band. */
  readonly bothOut: number;
  /** Observations in which `a` was out of band. */
  readonly aOut: number;
  /** Observations in which `b` was out of band. */
  readonly bOut: number;
}

/** One edge's residual, or `null` when the population cannot support an estimate. */
export interface EdgeResidual {
  readonly a: string;
  readonly b: string;
  readonly counts: EdgeCounts;
  /** `bothOut/n − (aOut/n)(bOut/n)`, or `null` below {@link MIN_POPULATION}. */
  readonly rho: number | null;
  /**
   * The same covariance divided by `√(p(1−p)·q(1−q))` — the φ coefficient, i.e. ρ at its natural scale.
   *
   * ## Why the raw residual is not comparable across edges
   *
   * ρ is a covariance of two Bernoulli indicators, and a covariance is bounded by the marginals rather than by
   * the coupling: with `p = q = 1` the joint is forced to 1 and ρ is 0 **however perfectly the two services move
   * together**, while with `p = q = 0.5` the same coupling reads 0.25. So an edge whose two ends are always out
   * of band — the most propagation-like measurement there is — scores ZERO on the pre-registered statistic, and
   * an edge that moved together half the time scores the maximum. That is a property of the estimator and not of
   * the corpus, and it is recorded here beside the number rather than discovered after a failed gate.
   *
   * φ is the standard correction and costs nothing: it divides by the joint's own standard deviation, so the
   * ceiling becomes 1 at every marginal configuration. The pre-registered statistic stays {@link rho} — a
   * hypothesis is judged by the number it fixed — and φ is read beside it, so a separation that ρ loses to its
   * own scale is visible in the same artifact rather than needing a second corpus walk.
   *
   * `null` when either marginal is degenerate (`p ∈ {0, 1}`), because the correlation is then undefined and no
   * value would be a measurement.
   */
  readonly phi: number | null;
}

/**
 * The canonical key of an unordered pair.
 *
 * @param x - One service.
 * @param y - The other.
 * @returns `a\u0000b` with `a < b`, so one edge has one key however the sweep ordered it.
 */
export function edgeKeyOf(x: string, y: string): string {
  return x < y ? `${x}\u0000${y}` : `${y}\u0000${x}`;
}

/**
 * Split a canonical key back into its two services.
 *
 * @param key - A key from {@link edgeKeyOf}.
 * @returns The two services, smaller first.
 */
export function edgeEndpoints(key: string): { a: string; b: string } {
  const separator = key.indexOf('\u0000');
  // Two branches rather than a destructure with defaults, because `a ?? ''` can never fire: `split` always yields
  // a first element. Written this way the reader can see that BOTH sides are total on a malformed key.
  return separator < 0
    ? { a: key, b: '' }
    : { a: key.slice(0, separator), b: key.slice(separator + 1) };
}

/**
 * The rows of one arm's sweep.
 *
 * The two arms keep separate traces because they are separate walks — an inversion in one changes the
 * adjacencies the other goes on to examine — so a reader that wants "what did this arm do" has to name the arm
 * rather than read a second column off one row. See `containment-rows.ts`.
 *
 * @param row - The case's sweep rows.
 * @param arm - Which arm's trace to read.
 * @returns That arm's pair rows, in sweep order.
 */
export function armTrace(
  row: ContainmentCaseRow,
  arm: 'gated' | 'ungated',
): readonly ContainmentPairRow[] {
  return arm === 'gated' ? row.pairs : row.ungatedPairs;
}

/**
 * Accumulate the out-of-band counts of every pair an arm EXAMINED and could measure on both sides.
 *
 * ## The population is the examined pairs, and that is not a preference
 *
 * The pre-registration fixes it in words — "for every adjacent pair the containment sweep considers" — and the
 * corpus proved it the hard way. Restricting the population to the pairs the arm INVERTED makes the statistic
 * **identically zero**, by a two-line argument that was measured before it was understood:
 *
 *     an inversion requires  excursion(lower) > excursion(upper) + margin, margin = 0
 *     ⇒ excursion(lower) > 0 in EVERY observation  ⇒  p_lower = 1
 *     ⇒ ρ = P(δupper ∧ δlower) − p_upper·1, and δupper ⇒ δlower, so P(both) = p_upper
 *     ⇒ ρ = p_upper − p_upper = 0.
 *
 * Run `43993982158` read exactly that: thirty edges, every residual `0.0000`, and an AUC of exactly `0.5` over 28
 * gains and 2 losses — because every point was tied. φ was undefined on all of them for the same reason (`p = 1`
 * is a degenerate marginal). The estimator was not weak on that population; it was CONSTANT on it.
 *
 * Over the examined pairs the implication does not hold: a pair the arm refused can have its upper side out of
 * band while the lower one is inside it, so both marginals sit strictly between 0 and 1 and the residual varies.
 * That is the population the residual is a property of — an edge's tendency to move as one, measured on every
 * occasion the sweep looked at it, and then asked whether the occasions it CHOSE to act on were the co-moving ones.
 *
 * @param rows - The corpus's sweep rows.
 * @param arm - Which arm's trace defines the examined set (the two traces are different walks).
 * @returns One entry per edge, keyed by {@link edgeKeyOf}.
 */
export function edgeCounts(
  rows: readonly ContainmentCaseRow[],
  arm: 'gated' | 'ungated' = 'ungated',
): Map<string, EdgeCounts> {
  const counts = new Map<
    string,
    { measured: number; bothOut: number; aOut: number; bOut: number }
  >();
  for (const row of rows) {
    for (const pair of armTrace(row, arm)) {
      const upperOut = pair.upperExcursion;
      const lowerOut = pair.lowerExcursion;
      if (upperOut === undefined || lowerOut === undefined) continue;
      const key = edgeKeyOf(pair.upper, pair.lower);
      const { a, b } = edgeEndpoints(key);
      const bucket = counts.get(key) ?? { measured: 0, bothOut: 0, aOut: 0, bOut: 0 };
      const outA = (a === pair.upper ? upperOut : lowerOut) > 0;
      const outB = (b === pair.upper ? upperOut : lowerOut) > 0;
      bucket.measured += 1;
      if (outA) bucket.aOut += 1;
      if (outB) bucket.bOut += 1;
      if (outA && outB) bucket.bothOut += 1;
      counts.set(key, bucket);
    }
  }
  return counts;
}

/**
 * Turn counts into residuals.
 *
 * @param counts - One entry per edge, from {@link edgeCounts}.
 * @returns One residual per edge, in key order, each `rho: null` below {@link MIN_POPULATION}.
 */
export function residuals(counts: ReadonlyMap<string, EdgeCounts>): EdgeResidual[] {
  const out: EdgeResidual[] = [];
  for (const key of [...counts.keys()].sort()) {
    const { a, b } = edgeEndpoints(key);
    const entry = counts.get(key)!;
    let rho: number | null = null;
    let phi: number | null = null;
    if (entry.measured >= MIN_POPULATION && entry.measured > 0) {
      const pA = entry.aOut / entry.measured;
      const pB = entry.bOut / entry.measured;
      rho = entry.bothOut / entry.measured - pA * pB;
      const variance = pA * (1 - pA) * (pB * (1 - pB));
      // A degenerate marginal is not "no correlation measured" — it is "no correlation definable", and a zero
      // there would read as independence.
      phi = variance > 0 ? rho / Math.sqrt(variance) : null;
    }
    out.push({ a, b, counts: entry, rho, phi });
  }
  return out;
}

/**
 * Whether one case's top-1 answer is correct.
 *
 * `null` is "no answer", which is neither correct nor incorrect: a case the engine could not score has no
 * position in the arm comparison, and counting it as wrong would credit an arm for a case it never saw.
 *
 * @param top1 - The arm's first candidate.
 * @param accepted - The case's accepted set.
 * @returns `true`, `false`, or `null` when the arm produced no answer.
 */
export function top1Correct(top1: string | null, accepted: readonly string[]): boolean | null {
  if (top1 === null) return null;
  return accepted.includes(top1);
}

/** Why one inversion carries no label, or the label it carries. */
export type InversionLabel =
  | { readonly kind: 'gain' }
  | { readonly kind: 'loss' }
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'unanswered' }
  | { readonly kind: 'ambiguous'; readonly candidates: number };

/**
 * Attribute an arm's top-1 movement to the ONE pair that caused it.
 *
 * The rule is deliberately strict, and its strictness is the measurement's honesty: an arm that inverted three
 * pairs and moved the answer could have been helped by any of them, and a residual fitted to a guess about which
 * one would be fitted to the guess. Only a case whose arm inverted exactly one pair, and whose answer moved, is
 * labelled.
 *
 * "Moved" is read against the FUSION order, not against the other arm: the label has to mean "this inversion
 * produced a correct answer that the control did not", which is the quantity the pre-registration's 38 gains and
 * 5 losses are.
 *
 * @param row - The case's sweep rows.
 * @param accepted - The case's accepted answers.
 * @param arm - The arm whose inversions are labelled.
 * @returns The label, and for `ambiguous` how many pairs were in contention.
 */
export function attributeInversion(
  row: ContainmentCaseRow,
  accepted: readonly string[],
  arm: 'gated' | 'ungated' = 'ungated',
): InversionLabel {
  const base = top1Correct(row.fusionTop1, accepted);
  const moved = top1Correct(arm === 'gated' ? row.gatedTop1 : row.ungatedTop1, accepted);
  if (base === null || moved === null) return { kind: 'unanswered' };
  if (base === moved) return { kind: 'unchanged' };
  const inverted = armTrace(row, arm).filter((pair) => pair.decision === 'inverted');
  if (inverted.length !== 1) return { kind: 'ambiguous', candidates: inverted.length };
  return moved ? { kind: 'gain' } : { kind: 'loss' };
}

/** Which residual the discrimination test is run on. */
export type ResidualScore = 'rho' | 'phi';

/** One labelled point in the discrimination test. */
export interface ResidualPoint {
  /** The residual of the edge the inversion was taken on. */
  readonly rho: number;
  /** `1` for a gain, `0` for a loss. */
  readonly positive: 0 | 1;
}

/** The arm's labelling census: what was labelled and what was refused, side by side. */
export interface ArmCensus {
  readonly gains: number;
  readonly losses: number;
  readonly unchanged: number;
  readonly unanswered: number;
  readonly ambiguous: number;
  /** Gains and losses whose edge had a residual the population could support. */
  readonly scoredGains: number;
  readonly scoredLosses: number;
}

/** The discrimination test's result, which is a number or a refusal with a reason. */
export interface Discrimination {
  readonly arm: 'gated' | 'ungated';
  /** Which statistic was scored: the pre-registered `rho`, or its scale-corrected sibling `phi`. */
  readonly score: ResidualScore;
  readonly census: ArmCensus;
  /** Mann–Whitney AUC of ρ against the gain label, or `null` when one class is absent. */
  readonly auc: number | null;
  /** Why `auc` is `null`, for a reader who needs the population rather than the number. */
  readonly unavailable?: string | undefined;
}

/**
 * Rank a set of scores, assigning ties the average of the ranks they span.
 *
 * The tie handling is not a detail: ρ is a ratio of small counts and equal values are common, and a ranking
 * that broke ties by input order would make the AUC depend on the file's line order.
 *
 * @param scores - The scores, in any order.
 * @returns One rank per input position, 1-based.
 */
export function averageRanks(scores: readonly number[]): number[] {
  const order = scores.map((score, index) => ({ score, index }));
  order.sort((x, y) => x.score - y.score);
  const ranks = Array.from({ length: scores.length }, () => 0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.score === order[i]!.score) j++;
    // Ranks are 1-based and the tie group spans i+1..j+1, whose mean is (i + j)/2 + 1.
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.index] = rank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Mann–Whitney AUC: the probability that a randomly chosen positive outscores a randomly chosen negative.
 *
 * @param points - Labelled residuals.
 * @returns The AUC in `[0, 1]`, or `null` when the population has only one class — a screen that cannot be
 *   separated is not a screen with an AUC of 0.5, and reporting 0.5 would read as "no discrimination measured"
 *   when the truth is "no comparison was possible".
 */
export function discriminationAuc(points: readonly ResidualPoint[]): number | null {
  const positives = points.filter((point) => point.positive === 1).length;
  const negatives = points.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const ranks = averageRanks(points.map((point) => point.rho));
  let rankSum = 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i]!.positive === 1) rankSum += ranks[i]!;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/**
 * Build the labelled population for one arm.
 *
 * A label is only usable when the case's inverted edge has a residual, and the census counts the two refusals
 * separately because they mean different things: an edge below {@link MIN_POPULATION} is a population problem
 * (the corpus is too thin to answer) while an ambiguous case is a rule problem (the attribution cannot name the
 * pair). Merging them would make a thin corpus look like a weak instrument.
 *
 * @param rows - The corpus's sweep rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @param arm - The arm whose inversions are labelled.
 * @returns The points, and the census they came from.
 */
export function labelledPoints(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
  arm: 'gated' | 'ungated' = 'ungated',
  score: ResidualScore = 'rho',
): { points: ResidualPoint[]; census: ArmCensus } {
  const counts = edgeCounts(rows, arm);
  const byEdge = new Map<string, EdgeResidual>();
  for (const residual of residuals(counts)) {
    byEdge.set(edgeKeyOf(residual.a, residual.b), residual);
  }
  let gains = 0;
  let losses = 0;
  let unchanged = 0;
  let unanswered = 0;
  let ambiguous = 0;
  let scoredGains = 0;
  let scoredLosses = 0;
  const points: ResidualPoint[] = [];

  for (const row of rows) {
    const answers = accepted.get(row.datapack);
    // A row with no joinable verdict is not a label of "wrong": it is a case the acceptance file did not carry,
    // and counting it either way would move the census on the strength of a missing file.
    if (answers === undefined) continue;
    const label = attributeInversion(row, answers, arm);
    if (label.kind === 'unchanged') {
      unchanged += 1;
      continue;
    }
    if (label.kind === 'unanswered') {
      unanswered += 1;
      continue;
    }
    if (label.kind === 'ambiguous') {
      ambiguous += 1;
      continue;
    }
    if (label.kind === 'gain') gains += 1;
    else losses += 1;
    // `attributeInversion` returns a gain or a loss only when the arm recorded EXACTLY ONE inversion, and every
    // inverted pair's edge is in `byEdge` because `edgeCounts` counted it. Both facts together are why this
    // lookup needs no guard: a guard here would be a branch no input can take. What the residual CAN be is
    // `null`, when the edge's population is below the floor — which is a measurement and not an absence.
    const [inverted] = armTrace(row, arm).filter((pair) => pair.decision === 'inverted');
    const residual = byEdge.get(edgeKeyOf(inverted!.upper, inverted!.lower))!;
    const value = score === 'rho' ? residual.rho : residual.phi;
    if (value === null) continue;
    if (label.kind === 'gain') scoredGains += 1;
    else scoredLosses += 1;
    points.push({ rho: value, positive: label.kind === 'gain' ? 1 : 0 });
  }

  return {
    points,
    census: { gains, losses, unchanged, unanswered, ambiguous, scoredGains, scoredLosses },
  };
}

/**
 * The whole discrimination test for one arm.
 *
 * @param rows - The corpus's sweep rows.
 * @param accepted - The accepted answers, keyed by `datapack`.
 * @param arm - The arm to test.
 * @returns The AUC, or a refusal carrying the reason the population could not support one.
 */
export function discriminate(
  rows: readonly ContainmentCaseRow[],
  accepted: ReadonlyMap<string, readonly string[]>,
  arm: 'gated' | 'ungated' = 'ungated',
  score: ResidualScore = 'rho',
): Discrimination {
  const { points, census } = labelledPoints(rows, accepted, arm, score);
  const auc = discriminationAuc(points);
  if (auc === null) {
    const reason =
      census.scoredGains === 0 && census.scoredLosses === 0
        ? 'no labelled inversion had a residual'
        : `one class is empty (gains=${census.scoredGains}, losses=${census.scoredLosses})`;
    return { arm, census, score, auc: null, unavailable: reason };
  }
  return { arm, census, score, auc };
}

/** The pre-registered bar: a screen that cannot separate 43 cases is not a rule. */
export const DISCRIMINATION_BAR = 0.8;

/**
 * The pre-registered verdict, as a value rather than a sentence in a log.
 *
 * @param discrimination - One arm's result.
 * @returns `'pass'`, `'fail'` (the AUC was measured and is below the bar), or `'unmeasured'` (no AUC).
 */
export function verdictOf(discrimination: Discrimination): 'pass' | 'fail' | 'unmeasured' {
  if (discrimination.auc === null) return 'unmeasured';
  return discrimination.auc > DISCRIMINATION_BAR ? 'pass' : 'fail';
}

/**
 * How many edges carry enough observations for a residual, and how the corpus's pairs distribute over them.
 *
 * @param counts - One entry per edge.
 * @returns The census a reader needs before quoting any single ρ.
 */
export function populationCensus(counts: ReadonlyMap<string, EdgeCounts>): {
  edges: number;
  scoredEdges: number;
  observations: number;
  largest: number;
  median: number;
} {
  const sizes = [...counts.values()].map((entry) => entry.measured).sort((x, y) => x - y);
  const observations = sizes.reduce((sum, size) => sum + size, 0);
  const median =
    sizes.length === 0
      ? 0
      : sizes.length % 2 === 1
        ? sizes[(sizes.length - 1) / 2]!
        : (sizes[sizes.length / 2 - 1]! + sizes[sizes.length / 2]!) / 2;
  return {
    edges: sizes.length,
    scoredEdges: sizes.filter((size) => size >= MIN_POPULATION).length,
    observations,
    largest: sizes.length === 0 ? 0 : sizes[sizes.length - 1]!,
    median,
  };
}

/** Narrow a pair row's measured excursions into the indicator pair ρ reads. */
export function indicatorsOf(pair: ContainmentPairRow): {
  upperOut: boolean;
  lowerOut: boolean;
} | null {
  if (pair.upperExcursion === undefined || pair.lowerExcursion === undefined) return null;
  return { upperOut: pair.upperExcursion > 0, lowerOut: pair.lowerExcursion > 0 };
}
