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

import type { CandidateFingerprint, ChannelFingerprint } from './hypothesis-space.js';

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
  /**
   * Evidence mode only: no channel on either side is both out of band and rarer than the case's median, so there is
   * nothing to count. Distinct from a tie for the reason `degenerate` is distinct from a band miss: the rule was
   * never consulted, because the quantity it reads did not exist on this case.
   */
  'evidence-none',
  /** Evidence mode only: the pick and the leader own the same number of qualifying channels. The rule is strict. */
  'evidence-tie',
  /** Evidence mode only: the pick owns strictly fewer qualifying channels than the leader. */
  'evidence-behind',
  /** Evidence mode only, `count-and-rarity`: the count was won and the pick's rarest channel is not rarer. */
  'rarity-miss',
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
  /**
   * The second admission rule. **Absent means `band`**, so every caller that predates it keeps the rule every
   * published number was measured on, and the two rules cannot be selected at once.
   */
  readonly evidence?: EvidenceOptions;
}

/**
 * The two evidence rules, which are different claims rather than two settings of one.
 *
 * `count` says "more out-of-band channels than the leader is enough"; `count-and-rarity` says "…and the rarest of
 * them is rarer than anything the leader has". The second is strictly narrower, which is what makes the pair
 * bracket the criterion instead of tuning it: A1 ≥ A2 in overrides by construction.
 */
export type EvidenceVariant = 'count' | 'count-and-rarity';

/**
 * What the evidence rule reads, and where its population comes from.
 *
 * `candidates` is the case's fingerprint list — the SAME artifact the nomination was made against, carrying each
 * candidate's channels with their fault-free bands and rates. The median is taken over **every channel of every
 * candidate in it**, not over the two candidates being compared, for the reason {@link gatePromotion}'s spread is
 * taken over the whole order: a statistic normalised by a pair inherits the pair.
 */
export interface EvidenceOptions {
  readonly variant: EvidenceVariant;
  readonly candidates: readonly CandidateFingerprint[];
}

/** What the evidence rule read, reported so a census can say why and not only what. */
export interface EvidenceReading {
  /** Qualifying channels on the pick: out of band AND rarer than {@link median}. */
  readonly pick: number;
  /** The same count on the leader the pick would displace. */
  readonly leader: number;
  /** The rate the counts were taken under — the lower median over the population's channels, or `null` if none. */
  readonly median: number | null;
  /** The pick's rarest qualifying rate, or `null` when it owns no qualifying channel. */
  readonly rarestPick: number | null;
  /** The leader's, under the same rule. */
  readonly rarestLeader: number | null;
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
  /**
   * What the evidence rule read, or `null` in `band` mode.
   *
   * The two readings are mutually exclusive by construction and each is `null` when its rule was not the one
   * running, which is the property that lets a reader attribute an outcome to a rule without reading the caller.
   */
  readonly evidence: EvidenceReading | null;
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
  const blind: Pick<PromotionDecision, 'relGap' | 'spread' | 'evidence'> = {
    relGap: null,
    spread: null,
    evidence: null,
  };

  // The evidence rule is selected by the PRESENCE of its options, before the threshold is looked at: `null` is the
  // band's control and means nothing to a rule that has no dial.
  if (options.evidence !== undefined) {
    return gateByEvidence(order, nomination, options.evidence, nothing);
  }

  if (options.threshold === null) {
    return { order, outcome: 'off', ...nothing, ...blind };
  }

  const challenger = nomination[0];
  const leader = published[0];
  if (challenger === undefined || leader === undefined) {
    return { order, outcome: 'unranked', ...nothing, ...blind };
  }
  if (!order.includes(challenger)) {
    return { order, outcome: 'unranked', ...nothing, ...blind };
  }

  const second = published[1];
  if (second === undefined) {
    // One candidate: there is no second score, so there is no gap. Reported rather than defaulted, because a
    // default of zero would read as "the engine is perfectly decided" on a case that never had a pair.
    //
    // The outcome is written as `agrees` rather than as a ternary on whether the two name the same service: this
    // branch is only reached with `challenger` inside `order`, and `order` has one element, so the two are the same
    // service by construction. The ternary's other arm was a branch no input can reach.
    return { order, outcome: 'agrees', ...nothing, ...blind };
  }

  // The spread is taken over the WHOLE order and from the minimum, not from the last row: on an order the
  // containment pass has permuted, the last row is a position and the minimum is a quantity.
  const spread = leader.score - Math.min(...published.map((row) => row.score));
  const relGap = spread <= 0 ? null : (leader.score - second.score) / spread;

  if (challenger === leader.service) {
    return { order, outcome: 'agrees', ...nothing, relGap, spread, evidence: null };
  }
  if (relGap === null) {
    // Every candidate scored the same. Reported as `degenerate` rather than as a band miss, because the threshold
    // was never consulted: there was no ratio to compare it against.
    return { order, outcome: 'degenerate', ...nothing, relGap: null, spread, evidence: null };
  }
  if (leader.score < second.score) {
    return { order, outcome: 'reversed', ...nothing, relGap, spread, evidence: null };
  }
  if (relGap >= options.threshold) {
    return { order, outcome: 'band-miss', ...nothing, relGap, spread, evidence: null };
  }

  return {
    order: [challenger, ...order.filter((service) => service !== challenger)],
    outcome: 'promoted',
    promote: true,
    promotedService: challenger,
    relGap,
    spread,
    evidence: null,
  };
}

/**
 * The evidence rule: admit the model's first choice when it owns strictly more out-of-band channels than the leader.
 *
 * ## Why a count of channels and not a margin
 *
 * The band admits on **proximity** — how close the second score is to the first — and proximity is not evidence: a
 * case whose top two are within three per cent of the spread but whose leader owns the only rare out-of-band channel
 * should not be overridden. This rule reads the case instead of the pair. It touches no score, so `relGap` and
 * `spread` come back `null` — not "zero", not "unmeasured": the rule has no such quantity.
 *
 * ## Why the median is over the population
 *
 * A channel that leaves its fault-free band on more than half of fault-free windows is not evidence of a fault, and
 * "more than half" has to be a number the case supplies rather than a constant, because the corpora differ in how
 * noisy their channels are. The threshold is therefore the case's **own lower median over every channel of every
 * candidate**, and the lower median is chosen so that the threshold is always a rate some channel actually carries —
 * an interpolated median can sit exactly between two channels and turn a strict `<` into a coin toss.
 *
 * ## What it refuses, and why each refusal is named
 *
 * `evidence-none` when no channel survives the filter (the rule was never consulted), `evidence-tie` when the counts
 * are equal (the rule is strict), `evidence-behind` when the pick owns fewer, and `rarity-miss` when the count was
 * won and the narrower variant's rarity clause was not. A refusal that names itself is a count that cannot lose a
 * case, which is what `PROMOTION_OUTCOMES` exists for.
 *
 * @param order - The published order, best first.
 * @param nomination - The model's ranking, verified, best first.
 * @param evidence - The variant and the case's fingerprint list — the population both counts are taken over.
 * @param nothing - The two fields every refusal shares.
 * @returns The decision, with its evidence reading always populated.
 */
function gateByEvidence(
  order: readonly string[],
  nomination: readonly string[],
  evidence: EvidenceOptions,
  nothing: Pick<PromotionDecision, 'promote' | 'promotedService'>,
): PromotionDecision {
  const leader = order[0];
  const challenger = nomination[0];
  const rates = evidence.candidates.flatMap((candidate) =>
    candidate.channels.map((channel) => channel.rate),
  );
  const median = lowerMedian(rates);

  const unreadable = (reading: EvidenceReading): PromotionDecision => ({
    order,
    outcome: 'evidence-none',
    ...nothing,
    relGap: null,
    spread: null,
    evidence: reading,
  });

  if (challenger === undefined || leader === undefined || !order.includes(challenger)) {
    return {
      order,
      outcome: 'unranked',
      ...nothing,
      relGap: null,
      spread: null,
      evidence: { pick: 0, leader: 0, median, rarestPick: null, rarestLeader: null },
    };
  }
  if (challenger === leader) {
    return {
      order,
      outcome: 'agrees',
      ...nothing,
      relGap: null,
      spread: null,
      evidence: { pick: 0, leader: 0, median, rarestPick: null, rarestLeader: null },
    };
  }

  const leaderRow = evidence.candidates.find((candidate) => candidate.service === leader);
  const pickRow = evidence.candidates.find((candidate) => candidate.service === challenger);
  // The two are projections of one artifact, so a missing row cannot happen in a well-formed run. It is a refusal
  // rather than an empty side, because "the pick's opponent is absent" must not read as "the pick has more".
  if (median === null || leaderRow === undefined || pickRow === undefined) {
    return unreadable({ pick: 0, leader: 0, median, rarestPick: null, rarestLeader: null });
  }

  const pickRates = qualified(pickRow.channels, median);
  const leaderRates = qualified(leaderRow.channels, median);
  const reading: EvidenceReading = {
    pick: pickRates.length,
    leader: leaderRates.length,
    median,
    rarestPick: rarest(pickRates),
    rarestLeader: rarest(leaderRates),
  };

  if (reading.pick === 0 && reading.leader === 0) return unreadable(reading);
  if (reading.pick < reading.leader) {
    return {
      order,
      outcome: 'evidence-behind',
      ...nothing,
      relGap: null,
      spread: null,
      evidence: reading,
    };
  }
  if (reading.pick === reading.leader) {
    return {
      order,
      outcome: 'evidence-tie',
      ...nothing,
      relGap: null,
      spread: null,
      evidence: reading,
    };
  }
  // A leader with no qualifying channel has no rarity to beat, so the narrower variant adds nothing there rather
  // than refusing a win the count already established.
  if (
    evidence.variant === 'count-and-rarity' &&
    reading.rarestLeader !== null &&
    (reading.rarestPick === null || reading.rarestPick >= reading.rarestLeader)
  ) {
    return {
      order,
      outcome: 'rarity-miss',
      ...nothing,
      relGap: null,
      spread: null,
      evidence: reading,
    };
  }

  return {
    order: [challenger, ...order.filter((service) => service !== challenger)],
    outcome: 'promoted',
    promote: true,
    promotedService: challenger,
    relGap: null,
    spread: null,
    evidence: reading,
  };
}

/** Whether a channel left its fault-free band after the injection. Inclusive band, so the strict comparisons. */
function leftBand(channel: ChannelFingerprint): boolean {
  return channel.post < channel.band[0] || channel.post > channel.band[1];
}

/** The rates of a candidate's channels that are BOTH out of band AND rarer than the case's median. */
function qualified(channels: readonly ChannelFingerprint[], median: number): number[] {
  return channels
    .filter((channel) => leftBand(channel) && channel.rate < median)
    .map((c) => c.rate);
}

/** The smallest rate, or `null` for an empty set — `Math.min()` would answer `Infinity` for one. */
function rarest(rates: readonly number[]): number | null {
  return rates.length === 0 ? null : Math.min(...rates);
}

/**
 * The lower median of a list, as a member of the list.
 *
 * Lower rather than interpolated because the threshold is used in a strict comparison: the mean of two middle rates
 * is a number no channel carries, and a channel sitting exactly on it would then fall on the wrong side by
 * accident. Deterministic: no sort stability or summation order can move it.
 */
function lowerMedian(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1]!;
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
    // `?? 0` rather than a bare read: a caller whose census omits a member would otherwise sum `undefined` into the
    // total and report the whole population as unaccounted for, which is a wrong explanation of a real omission.
    const count = census[outcome] ?? 0;
    total += count;
    const share = cases === 0 ? 0 : 100 * (count / cases);
    lines.push(
      // `padEnd(16)` because the longest outcome is `evidence-behind` at fifteen characters: an eleven-wide pad
      // silently misaligns every row after the vocabulary grew, which is a defect a reader sees before a test does.
      `  ${outcome.padEnd(16)} ${String(count).padStart(6)}  ${share.toFixed(1).padStart(5)}%`,
    );
  }
  if (total !== cases) {
    // Not thrown: a census that does not add up is a reading a caller wants to see, and turning it into an
    // exception would delete the artefact that explains it.
    lines.push(`  unaccounted ${String(cases - total).padStart(6)}  of ${String(cases)} cases`);
  }
  return lines.join('\n');
}
