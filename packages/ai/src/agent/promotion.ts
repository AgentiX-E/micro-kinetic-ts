/**
 * The promotion gate: when the model's first choice may replace the engine's, and why the default is "never".
 *
 * ## The question this module answers, stated as the thing that was wrong with every earlier arm
 *
 * Every fusion arm in this project took the model's ranking and mixed it into the engine's order under a weight,
 * and every one of them lost. `agentic-fusion.md` §3-4 read that as "the operator was never the problem" and
 * concluded the proposal set carries information below chance. The conclusion is true of the proposal set as a
 * whole: applied verbatim to all 1 422 cases the model scores 1 103 against the engine's 1 156.
 *
 * It is false of a nameable part of it. Where the engine's own first two candidates are within a few per cent of
 * each other **and** no structural rule has already reordered them, the model's first choice is right far more
 * often than the engine's is — 15 fixes against 6 breaks on the 122 cases that satisfy both conditions. The
 * operator was not the problem; the **admission criterion** was, because none of those arms had one.
 *
 * ## Why this is not a fusion, and must not be written as one
 *
 * A fusion distributes a weight over positions, so it moves several candidates at once and its effect on any one
 * case is a function of the model's whole ranking. A promotion moves exactly one candidate to the front. The
 * difference matters for measurement: an arm whose only question is "may I take the model's first choice" has one
 * degree of freedom, and a one-degree-of-freedom arm has a null it can be compared against — the engine's second
 * candidate, the engine's third, a random draw. A weighted fusion has no such null, which is why five sweeps of it
 * could not tell a bad operator from a bad population.
 *
 * `weight` therefore does not appear here at all. The dial is a **threshold on a measured gap**, and the two
 * settings that matter are a number and `null`.
 *
 * ## The gap, and the two mistakes it took to get it right
 *
 * The obvious statistic is `(s₁ − s₂) / s₁`. It is wrong twice on this corpus, and both failures are documented in
 * `docs/agentic-promotion-gate.md` §2 because both were made here first:
 *
 * 1. **The published order is not score-sorted.** The containment pass reorders adjacent caller/callee pairs after
 *    scoring, so on 83 of 1 422 cases the published leader scores below the second row. A relative gap read on such
 *    a pair is negative, and a band like `relGap < 0.05` silently absorbs it into "the engine is unsure" when what
 *    it says is "a rule already acted". {@link gatePromotion} reports those as `reversed` and never promotes them.
 * 2. **A score can be at or below zero** — the pool penalty is subtracted — so dividing by `s₁` is not a
 *    normalisation. The denominator here is the case's own spread, `s₁ − min(score)`, which is a property of the
 *    case and positive whenever the case has any spread at all.
 *
 * The spread is taken from the **minimum over the whole order**, not from the last row. On a score-sorted order the
 * two are the same number; on a reordered one they are not, and the last row is then a position rather than a
 * quantity. A statistic normalised by something that moves with a structural pass inherits that pass.
 *
 * ## Why `null` and `0` are different values
 *
 * `null` is the control: the gate does not look, so it promotes nothing and reports no gap. `0` is a threshold: the
 * gate measures, and because the band is a strict `<`, it promotes only a top-two tie that is exactly zero apart —
 * which the strict comparison then declines. Keeping them apart is what lets one function produce both arms, and a
 * delta produced by one code path is the only kind this repository trusts.
 *
 * @module packages/ai/src/agent/promotion
 */

/** One candidate as the engine published it: what to name, and what it scored. */
export interface PublishedCandidate {
  readonly service: string;
  /** The engine's score. Carried because the gate is a margin rule and a margin needs scores. */
  readonly score: number;
}

/**
 * Everything that can happen to a nomination, in the order the checks run.
 *
 * A census over these is exhaustive by construction, which is the property `SKIP_REASONS` and
 * `CLAIM_REJECTIONS` were given for: a count that cannot name a case is a count that has lost one.
 */
export const PROMOTION_OUTCOMES = [
  /** No threshold was supplied. The control arm. */
  'off',
  /** The model's first choice is not in the published order, so there is nothing to move. */
  'unranked',
  /** The model named the leader the engine named. Not an override. */
  'agrees',
  /** The published pair is not score-sorted: a structural rule has already moved these two. */
  'reversed',
  /** The case has no spread, so no ratio against it exists. */
  'degenerate',
  /** The gap is at or above the threshold: the engine has decided. */
  'band-miss',
  /** Inside the band, sorted, and the model disagrees. The one outcome that changes an answer. */
  'promoted',
] as const;

/** One of {@link PROMOTION_OUTCOMES}. */
export type PromotionOutcome = (typeof PROMOTION_OUTCOMES)[number];

/**
 * How to gate a promotion.
 *
 * `threshold` is the band's half-width as a fraction of the case's spread, and `null` switches the gate off. There
 * is no "default weight" and no second dial on purpose: the arm this module exists for is one rule with one number,
 * and `docs/agentic-promotion-gate.md` §4.1 states why the number is a plateau rather than a tuned maximum.
 */
export interface PromotionOptions {
  readonly threshold: number | null;
}

/**
 * The threshold the pre-registration fixed.
 *
 * `preregistration-304.md` names this value before the confirmatory replay is dispatched, and
 * `docs/agentic-promotion-gate.md` §4.1 records the curve it sits on — `+1 / +3 / +6 / +9 / +7 / +2 / +4 / −3`
 * across `0.005 … 0.20`, with both id-hash halves positive across `0.01–0.05`. It is the middle of a plateau and
 * not the argmax of a sweep, which is the difference between a pre-registered rule and a fitted one.
 */
export const DEFAULT_PROMOTION_THRESHOLD = 0.03;

/** The gate switched off. The control arm, as a value a caller can pass. */
export const PROMOTION_OFF: PromotionOptions = { threshold: null };

/** What the gate concluded, and the order it implies. */
export interface PromotionDecision {
  /**
   * The order to score. When nothing was promoted this is the published order element for element, so a caller
   * never has to decide whether to apply the decision — the decision *is* the order.
   */
  readonly order: readonly string[];
  readonly outcome: PromotionOutcome;
  /** True exactly when `outcome` is `promoted`. Stated, rather than left to a string comparison at every call. */
  readonly promote: boolean;
  /** The service that was moved to the front, or `null` when nothing was. */
  readonly promotedService: string | null;
  /** `(s₁ − s₂) / spread`, or `null` when the gate did not look or the case has no spread. */
  readonly relGap: number | null;
  /** `s₁ − min(score)`, or `null` when the gate did not look or there were fewer than two candidates. */
  readonly spread: number | null;
}

/**
 * Decide whether the model's first choice replaces the engine's, and return the resulting order.
 *
 * The checks run in a fixed order and each one is a refusal that names itself:
 *
 * 1. no threshold → `off`;
 * 2. the model named nothing, or named a service the order does not carry → `unranked`;
 * 3. fewer than two candidates → the gap is unmeasurable, so it is left `null` and the case is decided by whether
 *    the two agree;
 * 4. the model named the leader → `agrees`;
 * 5. no positive spread → `degenerate`;
 * 6. the pair is not score-sorted → `reversed`;
 * 7. the gap is at or above the threshold → `band-miss`;
 * 8. otherwise → `promoted`.
 *
 * A promotion moves the model's first choice to the front and leaves every other pair in the engine's relative
 * order. It is not a re-ranking: the gate has an opinion about one position and states nothing about the rest.
 *
 * @param published - The engine's order, **as published**, best first, with scores. Pass the whole order and not a
 *   presentation slice: the spread is read from it, and a spread read from a five-wide cut is that cut's property.
 * @param nomination - The model's ranking, verified and best first. Need not be a permutation of `published`.
 * @param options - The threshold, or `null` to switch the gate off.
 * @returns The decision, carrying the order to score.
 */
export function gatePromotion(
  published: readonly PublishedCandidate[],
  nomination: readonly string[],
  options: PromotionOptions,
): PromotionDecision {
  const order = published.map((row) => row.service);
  const nothing: Pick<PromotionDecision, 'promote' | 'promotedService'> = {
    promote: false,
    promotedService: null,
  };

  if (options.threshold === null) {
    return { order, outcome: 'off', ...nothing, relGap: null, spread: null };
  }

  const challenger = nomination[0];
  const leader = published[0];
  if (challenger === undefined || leader === undefined) {
    return { order, outcome: 'unranked', ...nothing, relGap: null, spread: null };
  }
  if (!order.includes(challenger)) {
    return { order, outcome: 'unranked', ...nothing, relGap: null, spread: null };
  }

  const second = published[1];
  if (second === undefined) {
    // One candidate: there is no second score, so there is no gap. Reported rather than defaulted, because a
    // default of zero would read as "the engine is perfectly decided" on a case that never had a pair.
    //
    // The outcome is written as `agrees` rather than as a ternary on whether the two name the same service: this
    // branch is only reached with `challenger` inside `order`, and `order` has one element, so the two are the same
    // service by construction. The ternary's other arm was a branch no input can reach.
    return { order, outcome: 'agrees', ...nothing, relGap: null, spread: null };
  }

  // The spread is taken over the WHOLE order and from the minimum, not from the last row: on an order the
  // containment pass has permuted, the last row is a position and the minimum is a quantity.
  const spread = leader.score - Math.min(...published.map((row) => row.score));
  const relGap = spread <= 0 ? null : (leader.score - second.score) / spread;

  if (challenger === leader.service) {
    return { order, outcome: 'agrees', ...nothing, relGap, spread };
  }
  if (relGap === null) {
    // Every candidate scored the same. Reported as `degenerate` rather than as a band miss, because the threshold
    // was never consulted: there was no ratio to compare it against.
    return { order, outcome: 'degenerate', ...nothing, relGap: null, spread };
  }
  if (leader.score < second.score) {
    return { order, outcome: 'reversed', ...nothing, relGap, spread };
  }
  if (relGap >= options.threshold) {
    return { order, outcome: 'band-miss', ...nothing, relGap, spread };
  }

  return {
    order: [challenger, ...order.filter((service) => service !== challenger)],
    outcome: 'promoted',
    promote: true,
    promotedService: challenger,
    relGap,
    spread,
  };
}

/**
 * Render a promotion census, one line per outcome, with the population each count is over.
 *
 * @param census - Counts by outcome. Every key of {@link PROMOTION_OUTCOMES} must be present.
 * @param cases - The population, so a reader can see what the outcomes do not account for.
 * @returns The census, as text.
 */
export function formatPromotionCensus(
  census: Readonly<Record<PromotionOutcome, number>>,
  cases: number,
): string {
  const lines: string[] = [];
  let total = 0;
  for (const outcome of PROMOTION_OUTCOMES) {
    const count = census[outcome];
    total += count;
    const share = cases === 0 ? 0 : 100 * (count / cases);
    lines.push(
      `  ${outcome.padEnd(11)} ${String(count).padStart(6)}  ${share.toFixed(1).padStart(5)}%`,
    );
  }
  if (total !== cases) {
    // Not thrown: a census that does not add up is a reading a caller wants to see, and turning it into an
    // exception would delete the artefact that explains it.
    lines.push(`  unaccounted ${String(cases - total).padStart(6)}  of ${String(cases)} cases`);
  }
  return lines.join('\n');
}
