/**
 * The bounded hypothesis space an agentic layer is allowed to act on.
 *
 * This module is the difference between the layer removed in `0d6ae609` and the one this repository is willing to
 * measure. The retired investigator let a model read an evidence dump and answer in prose; the answer could not be
 * checked, so a wrong answer and a right one were the same object until the score was tallied.
 * Here the model's only output is an {@link EliminationClaim} — "remove this candidate, keep that one, because
 * this channel reads this value against this band" — and every field of it is re-derived from the fingerprint the
 * engine already built. A claim that cites a channel nobody observed, a value nobody measured, or a band that
 * disagrees with the profile artifact is **refused**, and the refusal is counted rather than smoothed over.
 *
 * That property is what makes a cheap model sufficient. Comparing two numbers against a band is not a reasoning
 * problem, and it does not matter how the comparison was proposed: if it is wrong, {@link verifyClaim} says so
 * before the ranking moves. See `docs/agentic-layer-plan.md` §3–§4.
 *
 * Zero IO, no clock, no randomness: everything here is a pure function of its arguments, so the whole layer can be
 * replayed byte for byte from a cache (the property that makes every ablation after the first one free).
 *
 * **What the verifier is not.** It refuses FABRICATION, not bad judgement. A claim whose every field is true and
 * whose conclusion is wrong is accepted here, because whether the conclusion is right is what the accuracy number
 * measures — a verifier that also policed judgement would be a second scorer hidden inside the layer, and the
 * reported score would be a function of two things with only one of them published.
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

/** The statistic a claim compares. `onset` is the time the channel left its band, in milliseconds after `t0`. */
export const CLAIM_STATISTICS = ['post', 'delta', 'onset'] as const;

/** One of {@link CLAIM_STATISTICS}. */
export type ClaimStatistic = (typeof CLAIM_STATISTICS)[number];

/** Why a claim was refused. Each member is a failure family a reader can act on, not a generic "invalid". */
export const CLAIM_REJECTIONS = [
  'unknown-candidate',
  'same-candidate',
  'unknown-channel',
  'channel-not-observed-on-both',
  'unsupported-statistic',
  'band-disagrees-with-fingerprint',
  'value-disagrees-with-fingerprint',
  'rate-disagrees-with-fingerprint',
  'removed-candidate-is-inside-its-band',
] as const;

/** One of {@link CLAIM_REJECTIONS}. */
export type ClaimRejection = (typeof CLAIM_REJECTIONS)[number];

/**
 * One channel of one candidate, summarised so that an agent can compare it without seeing the series.
 *
 * `band` is the fault-free band from the Expected-Outlier-Baseline profile built in iteration 265: the interval a
 * channel stays inside in a fault-free window. `rate` is the fraction of fault-free windows in which the channel
 * left that band anyway — the number that separates evidence from a channel that always swings.
 */
export interface ChannelFingerprint {
  /** Channel label exactly as the engine reports it (`cpu`, `latency_p99`, `error`, ...). */
  readonly label: string;
  /** Mean (or level) over the pre-injection segment. */
  readonly pre: number;
  /** Mean over the post-injection segment. */
  readonly post: number;
  /** Fault-free band, inclusive on both ends. */
  readonly band: readonly [number, number];
  /** Fraction of fault-free windows in which this channel left {@link band}. Zero when never observed to. */
  readonly rate: number;
  /** Milliseconds after `t0` at which the channel first left {@link band}; absent when it never did. */
  readonly onset?: number;
}

/** One ranked candidate and the channels that rank it. */
export interface CandidateFingerprint {
  readonly service: ServiceId;
  /** Rank in the engine's posterior, 0-based. Carried so a claim can name what it is displacing. */
  readonly rank: number;
  /** The engine's own score for this candidate. Monotone with {@link rank}; carried for margin rules. */
  readonly score: number;
  readonly channels: readonly ChannelFingerprint[];
}

/** The evidence field a claim rests on. */
export interface ClaimBasis {
  /** Channel label. Must exist on BOTH the removed and the kept candidate. */
  readonly channel: string;
  /** Which statistic of that channel the claim compares. */
  readonly statistic: ClaimStatistic;
  /** The value the claim asserts — verified against the fingerprint, never taken on trust. */
  readonly observed: number;
  /** The band the claim asserts — verified against the fingerprint, never taken on trust. */
  readonly band: readonly [number, number];
  /**
   * The expected-outlier rate the claim asserts for the cited channel on the REMOVED candidate.
   *
   * Optional because a claim may rest on the band alone, and the two are different arguments: the band says
   * "this moved", the rate says "and it moves like this when nothing is wrong". A proposer that makes the
   * second argument must state the number it is making it with, and stating it is what subjects it to
   * {@link verifyClaim}'s check — a claim may assert less, never something other than what the profile says.
   */
  readonly rate?: number;
}

/** The only thing an agent may say: remove one candidate, keep another, for a checkable reason. */
export interface EliminationClaim {
  readonly remove: ServiceId;
  readonly keep: ServiceId;
  readonly because: ClaimBasis;
}

/** What {@link verifyClaim} concluded. `ok: false` carries the reason and is counted, never applied. */
export type ClaimVerdict =
  | { readonly ok: true; readonly claim: EliminationClaim }
  | { readonly ok: false; readonly reason: ClaimRejection; readonly claim: EliminationClaim };

/** Reads the statistic a claim is about. Returns `undefined` when the channel does not carry it. */
function statisticOf(channel: ChannelFingerprint, statistic: ClaimStatistic): number | undefined {
  if (statistic === 'post') return channel.post;
  if (statistic === 'delta') return channel.post - channel.pre;
  return channel.onset;
}

/** Locates a channel on a candidate. */
function findChannel(
  candidate: CandidateFingerprint,
  label: string,
): ChannelFingerprint | undefined {
  return candidate.channels.find((channel) => channel.label === label);
}

/** True when `value` lies inside `band`, inclusive on both ends. NaN is never inside. */
function insideBand(value: number, band: readonly [number, number]): boolean {
  return value >= band[0] && value <= band[1];
}

/** Equality that treats two NaN as equal, because a claim about a NaN value is still a claim about that value. */
function sameNumber(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Checks a claim against the fingerprint it claims to be about.
 *
 * The order of the checks is the order a reader would ask the questions, and each one has its own rejection so
 * that a refusal names something actionable:
 *
 * 1. are both candidates in the posterior;
 * 2. are they different;
 * 3. does the channel exist on the removed one, on the kept one, and identically on both;
 * 4. does that channel carry the statistic the claim names;
 * 5. does the band match the one the profile published;
 * 6. does the observed value match the one the engine measured;
 * 7. does the asserted expected-outlier rate, when the claim asserts one, match the profile;
 * 8. and — the only judgement in the list — is the removed candidate actually outside that band? A claim that
 *    removes a candidate whose own evidence sits INSIDE its fault-free band is not comparing evidence, it is
 *    asserting a preference, and that is the failure family `arXiv:2608.21310` calls unsupported reasoning.
 *
 * @param claim - The claim to check.
 * @param candidates - The posterior the claim is about, in rank order.
 * @returns An ok verdict carrying the claim, or a refusal carrying the reason.
 */
export function verifyClaim(
  claim: EliminationClaim,
  candidates: readonly CandidateFingerprint[],
): ClaimVerdict {
  const removed = candidates.find((candidate) => candidate.service === claim.remove);
  const kept = candidates.find((candidate) => candidate.service === claim.keep);
  if (removed === undefined || kept === undefined) {
    return { ok: false, reason: 'unknown-candidate', claim };
  }
  if (removed.service === kept.service) {
    return { ok: false, reason: 'same-candidate', claim };
  }

  const onRemoved = findChannel(removed, claim.because.channel);
  const onKept = findChannel(kept, claim.because.channel);
  // Two refusals, not one branch. They were one branch until iteration 284 and the corpus showed what that cost:
  // 1 774 of 5 335 claims were refused as `unknown-channel`, and the published census could not say that 774 of
  // them named a channel the ELIMINATED row carried and the kept row did not — a rule the protocol enforced and
  // never stated. `channel-not-observed-on-both` was declared in `CLAIM_REJECTIONS` from the first commit and no
  // input could produce it, so the one number a reader needed to tell fabrication from an unstated rule was the one
  // number the table did not have.
  if (onRemoved === undefined) {
    return { ok: false, reason: 'unknown-channel', claim };
  }
  if (onKept === undefined) {
    return { ok: false, reason: 'channel-not-observed-on-both', claim };
  }

  const observedOnRemoved = statisticOf(onRemoved, claim.because.statistic);
  const observedOnKept = statisticOf(onKept, claim.because.statistic);
  if (observedOnRemoved === undefined || observedOnKept === undefined) {
    // `onset` is absent on a channel that never left its band. That absence is not a low value: it is the
    // strongest form of "no evidence", and comparing it as if it were zero would invert the claim.
    return { ok: false, reason: 'unsupported-statistic', claim };
  }

  if (onRemoved.band[0] !== claim.because.band[0] || onRemoved.band[1] !== claim.because.band[1]) {
    return { ok: false, reason: 'band-disagrees-with-fingerprint', claim };
  }
  if (!sameNumber(observedOnRemoved, claim.because.observed)) {
    return { ok: false, reason: 'value-disagrees-with-fingerprint', claim };
  }
  if (claim.because.rate !== undefined && !sameNumber(onRemoved.rate, claim.because.rate)) {
    return { ok: false, reason: 'rate-disagrees-with-fingerprint', claim };
  }
  if (insideBand(observedOnRemoved, onRemoved.band)) {
    return { ok: false, reason: 'removed-candidate-is-inside-its-band', claim };
  }
  return { ok: true, claim };
}

/**
 * Applies verified claims to a posterior by damping the removed candidates' scores.
 *
 * Damping rather than deleting, for three reasons. A weight of zero must be the identity, and deletion is not
 * continuous at zero. A damped candidate can be inspected in the trace — deletion leaves nothing to audit. And a
 * claim that turns out to be one of several that agree must not compound into an exclusion no single claim
 * justified: `(1 - weight)` applied once per candidate is bounded by construction.
 *
 * Ties are broken by the candidate's original rank, so the output is a total order with no dependence on array
 * order — the property that lets two runs be compared byte for byte.
 *
 * @param candidates - The posterior, in rank order.
 * @param verdicts - Verdicts to apply. Refusals are ignored; counting them is the caller's job.
 * @param weight - Damping factor in `[0, 1]`. Zero returns the input unchanged, in the same order.
 * @returns A new ordering. The input is not mutated.
 */
export function applyClaims(
  candidates: readonly CandidateFingerprint[],
  verdicts: readonly ClaimVerdict[],
  weight: number,
): readonly CandidateFingerprint[] {
  if (!(weight > 0)) return candidates;
  const kept = Math.min(weight, 1);
  const damped = new Map<ServiceId, number>();
  for (const verdict of verdicts) {
    if (verdict.ok) damped.set(verdict.claim.remove, kept);
  }
  if (damped.size === 0) return candidates;

  return (
    [...candidates]
      .map((candidate) => {
        const factor = damped.get(candidate.service);
        return factor === undefined
          ? candidate
          : { ...candidate, score: candidate.score * (1 - factor) };
      })
      .sort((a, b) => (a.score === b.score ? a.rank - b.rank : b.score - a.score))
      // A candidate whose position did not change is returned as the SAME object, so a caller can compare two
      // rankings by reference for the candidates nobody touched. Rebuilding every entry unconditionally would make
      // the identity contract of a weight-zero layer indistinguishable from a layer that moved nothing.
      .map((candidate, index) =>
        candidate.rank === index ? candidate : { ...candidate, rank: index },
      )
  );
}

/** Why an agent was or was not consulted. Both members are reasons a case resolved without one. */
export const SKIP_REASONS = ['margin', 'evidence', 'none'] as const;

/** One of {@link SKIP_REASONS}. `none` means the agent IS consulted. */
export type SkipReason = (typeof SKIP_REASONS)[number];

/** The deterministic rule that decides whether a case needs an agent at all. */
export interface ConsultationDecision {
  readonly consult: boolean;
  readonly reason: SkipReason;
  /** Relative gap between the top two scores. Zero when there is only one candidate. */
  readonly margin: number;
  /** How many of the top candidate's channels sit outside their own fault-free band. */
  readonly decisiveChannels: number;
}

/**
 * Decides whether a case is worth spending a model call on, without a model.
 *
 * The rule is the cost model's largest single saving and it is deliberately crude: a case where the engine's top
 * candidate leads by a wide margin AND is supported by several channels that are outside their fault-free bands is
 * a case an agent can only get wrong. Everything else — a close top two, or a leader resting on one channel — is
 * where the published agents earn their 47 points over a statistical ranker, and those are the cases this rule
 * routes to the agent.
 *
 * Both thresholds are parameters rather than constants because the fraction of cases skipped is itself a
 * measurement: on RCABench the prediction is that the rule skips about half, and if it skips 90 % the layer is
 * measuring a fifth of the benchmark while reporting a score for all of it.
 *
 * @param candidates - The posterior, in rank order.
 * @param options - Thresholds. `marginThreshold` is relative (see {@link ConsultationDecision.margin}).
 * @returns The decision, with the quantities that produced it, so a trace can be audited.
 */
export function decideConsultation(
  candidates: readonly CandidateFingerprint[],
  options: { readonly marginThreshold: number; readonly decisiveChannels: number },
): ConsultationDecision {
  const first = candidates[0];
  if (first === undefined) {
    // An empty posterior is a case the engine could not rank at all. An agent has nothing to eliminate from,
    // so the honest decision is to skip and let the empty answer be reported as empty.
    return { consult: false, reason: 'evidence', margin: 0, decisiveChannels: 0 };
  }
  const second = candidates[1];
  const margin =
    second === undefined || first.score <= 0 ? 0 : (first.score - second.score) / first.score;

  let decisive = 0;
  for (const channel of first.channels) {
    const value = channel.post;
    if (!insideBand(value, channel.band)) decisive += 1;
  }

  if (margin >= options.marginThreshold)
    return { consult: false, reason: 'margin', margin, decisiveChannels: decisive };
  if (decisive >= options.decisiveChannels) {
    return { consult: false, reason: 'evidence', margin, decisiveChannels: decisive };
  }
  return { consult: true, reason: 'none', margin, decisiveChannels: decisive };
}

/** Defaults for {@link decideConsultation}: a 5 % relative lead, or three out-of-band channels, resolves a case. */
export const DEFAULT_CONSULTATION_OPTIONS = {
  marginThreshold: 0.05,
  decisiveChannels: 3,
} as const;
