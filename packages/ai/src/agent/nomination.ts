/**
 * The second expression protocol: a ranking instead of a sequence of eliminations.
 *
 * ## Why a second protocol exists, stated as an arithmetic fact about the first one
 *
 * The elimination protocol asks for a *move* — "remove this candidate, keep that one" — and each move must cite a
 * channel that both rows carry and that reads outside the removed row's fault-free band. On the 1 422-case corpus
 * that constraint costs more than it buys: an arm that is allowed to remove **every candidate the truth needs
 * removed, and nothing else** reaches 79.4 %, while an arm allowed to name the truth outright reaches 87.8 %. The
 * gap is not a modelling error, it is the protocol's: expressing "promote rank 3 to rank 0" costs three moves and
 * three shared out-of-band channels, and a case that has one discriminating channel but not three cannot say what
 * it knows. This module lets it say what it knows in one sentence.
 *
 * ## What is NOT relaxed
 *
 * Everything a claim had to be true about, a ranking still has to be true about. A nomination may name a service
 * the posterior does not carry only by being refused (`unknown-candidate`); it may not repeat one
 * (`duplicate-candidate`); it cannot insert a service the engine never ranked, because {@link fuseNomination}
 * scores the engine's order and a nomination can only reorder it. The refusal census stays a first-class reading,
 * so a model that answers about another case is counted as answering about another case rather than as abstaining.
 *
 * ## Why a partial ranking is legal, and an empty one is
 *
 * A ranking is a statement about the top of the posterior, and a model that is sure of one service and unsure of
 * the rest should be able to say so. Requiring a full permutation would force it to invent the positions it cannot
 * support, and the fusion would then weight those inventions equally with its one confident statement. `[]` is the
 * complete answer "the engine is right", and it fuses to a no-op under every strategy by construction.
 *
 * @module packages/ai/src/agent/nomination
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

import { digestOf } from './eliminator.js';
import { channelsByEvidence } from './evidence.js';
import { fuseRanks, type RankFusionOptions } from './fusion.js';
import type { CandidateFingerprint } from './hypothesis-space.js';
import { renderCandidateTable } from './table.js';

/**
 * The version of this question.
 *
 * `1` is the first publication. It exists for the same reason {@link ELIMINATOR_PROTOCOL} does: a recorded answer
 * is only an answer to the question that produced it, and the number is what lets a replay tell a stale answer from
 * a wrong one.
 */
export const NOMINATION_PROTOCOL = 1;

/**
 * Why a nomination was refused.
 *
 * Both members are failures of the answer as an answer — it named something the case does not contain, or it named
 * the same thing twice. Neither is a judgement about whether the ranking is *right*: that is what the accuracy
 * number measures, and a verifier that also policed judgement would be a second scorer hidden in the layer.
 */
export const NOMINATION_REJECTIONS = ['unknown-candidate', 'duplicate-candidate'] as const;

/** One of {@link NOMINATION_REJECTIONS}. */
export type NominationRejection = (typeof NOMINATION_REJECTIONS)[number];

/** How much of the fingerprint one prompt carries. Both are parameters because both are ablations. */
export interface NominationOptions {
  /** Candidates presented, in rank order. A nomination can promote at most from this depth. */
  readonly maxCandidates: number;
  /** Channels printed per candidate, most informative first. */
  readonly maxChannels: number;
  /** How many services a reply may rank. Equal to the window unless a caller narrows it. */
  readonly maxRanked: number;
}

/** Defaults: the same presentation the elimination protocol publishes, and a ranking of the whole window. */
export const DEFAULT_NOMINATION_OPTIONS: NominationOptions = {
  maxCandidates: 5,
  maxChannels: 8,
  maxRanked: 5,
};

/** One question, as it will be sent. */
export interface NominationPrompt {
  readonly system: string;
  readonly user: string;
  /** 16 hex characters over both messages. The cache key, and the identity of the question asked. */
  readonly digest: string;
  /** How many candidates the table carries: `min(maxCandidates, candidates.length)`. */
  readonly presented: number;
}

/** What reading a reply concluded. `ok` with an empty order is a legitimate "the ranking is right". */
export type ParsedNomination =
  | { readonly ok: true; readonly order: readonly ServiceId[] }
  | { readonly ok: false; readonly why: string };

/** What verifying a nomination concluded. A refusal carries the offending service, not just the family. */
export type NominationVerdict =
  | { readonly ok: true; readonly order: readonly ServiceId[] }
  | {
      readonly ok: false;
      readonly reason: NominationRejection;
      readonly culprit: ServiceId;
    };

const SYSTEM_PROMPT = [
  'You audit a root-cause ranking that a deterministic engine produced for one fault injection.',
  'Exactly one of the candidates is the injected source. The others are services whose telemetry moved because',
  'the fault propagated to them, and a symptom can outrank the source.',
  '',
  'Each candidate carries channels summarised before and after the injection. `band` is the interval the channel',
  'stays inside when nothing is wrong, and `rate` is the fraction of fault-free windows in which it left that band',
  'anyway, so a channel with a high rate is one that always swings. `onset` is the time in milliseconds after the',
  'injection at which the channel first left its band; `-` means it never left. Channels are listed most',
  'informative first: those that left their band come before those that stayed inside it, and among them the ones',
  'whose band is rarest crossed come first.',
  '',
  'Answer with a RANKING of the candidates, best first. A PARTIAL ranking is allowed and is the better answer when',
  'you are sure of the leader and unsure of the rest: name only the services you can support, in the order you',
  'would put them. Reply with an empty ranking when the engine is already right — that is a valid answer and it is',
  'counted as one. Do not pad the ranking to the full width with services you cannot support.',
  '',
  'Reply with JSON ONLY, in exactly this shape, naming each service exactly once, spelled as the table spells it:',
  '{"ranking":["<service>","<service>"]}',
].join('\n');

/**
 * Build the question.
 *
 * The table is rendered by the same function the elimination prompt uses, so the two protocols are compared on the
 * same evidence — a difference between them is then a difference in what is asked, which is the only thing the
 * comparison is for.
 *
 * @param faultType - The case's injected fault type, as the corpus names it.
 * @param candidates - The posterior, in rank order.
 * @param options - How much to present.
 * @returns The two messages, the digest they hash to, and how many candidates survived the window.
 */
export function buildNominationPrompt(
  faultType: string,
  candidates: readonly CandidateFingerprint[],
  options: NominationOptions = DEFAULT_NOMINATION_OPTIONS,
): NominationPrompt {
  const window = candidates.slice(0, Math.max(0, options.maxCandidates));
  const blocks = window.map((candidate) =>
    renderCandidateTable(candidate, channelsByEvidence(candidate.channels, options.maxChannels)),
  );
  const user = [
    `FAULT TYPE: ${faultType}`,
    `CANDIDATES: ${window.length} (rank 0 is the engine's answer; a higher score is a stronger claim)`,
    '',
    ...(blocks.length === 0
      ? ['The engine returned no candidate. Reply with {"ranking":[]}.']
      : [blocks.join('\n\n')]),
    '',
    `At most ${options.maxRanked} service(s), best first.`,
  ].join('\n');
  return {
    system: SYSTEM_PROMPT,
    user,
    digest: digestOf(`${SYSTEM_PROMPT}\u0000${user}`),
    presented: window.length,
  };
}

/** Strip a Markdown fence, because a model that was asked for JSON may still wrap it. */
function unfence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const firstBreak = trimmed.indexOf('\n');
  if (firstBreak < 0) return trimmed;
  const body = trimmed.slice(firstBreak + 1);
  const lastFence = body.lastIndexOf('```');
  return (lastFence < 0 ? body : body.slice(0, lastFence)).trim();
}

/**
 * Read a reply.
 *
 * Shape only. Whether the named services exist is {@link verifyNomination}'s question, so a refusal says which of
 * the two fired: `ok: false` here means the text was not an answer to this question, and a refusal there means the
 * answer was about a different case.
 *
 * @param text - The model's message.
 * @param maxRanked - The bound the prompt stated. Defaults to no bound, for a caller scoring a recorded artifact.
 * @returns The order, or why the text is not a reply.
 */
export function parseNominationReply(
  text: string,
  maxRanked: number = Number.POSITIVE_INFINITY,
): ParsedNomination {
  const body = unfence(text);
  if (body === '') return { ok: false, why: 'the reply was empty' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, why: 'the reply is not JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, why: 'the reply is not a JSON object' };
  }
  const ranking = (parsed as Record<string, unknown>)['ranking'];
  if (!Array.isArray(ranking)) return { ok: false, why: 'the reply has no ranking array' };
  if (ranking.length > maxRanked) {
    return {
      ok: false,
      why: `the reply ranks ${ranking.length} services against a bound of ${maxRanked}`,
    };
  }
  const order: ServiceId[] = [];
  for (const [index, entry] of ranking.entries()) {
    if (typeof entry !== 'string' || entry === '') {
      return { ok: false, why: `ranking ${index} is not a service name` };
    }
    order.push(entry);
  }
  return { ok: true, order };
}

/**
 * Check a nomination against the posterior it claims to be about.
 *
 * Two checks, in the order a reader would ask them: does every named service exist, and is each named once. A
 * partial ranking passes; only answers that could not be about this case fail.
 *
 * @param order - The services the model ranked, best first.
 * @param candidates - The posterior, in rank order.
 * @returns The order, or the reason and the service that produced it.
 */
export function verifyNomination(
  order: readonly ServiceId[],
  candidates: readonly CandidateFingerprint[],
): NominationVerdict {
  const known = new Set(candidates.map((candidate) => candidate.service));
  const seen = new Set<ServiceId>();
  for (const service of order) {
    if (!known.has(service)) return { ok: false, reason: 'unknown-candidate', culprit: service };
    if (seen.has(service)) return { ok: false, reason: 'duplicate-candidate', culprit: service };
    seen.add(service);
  }
  return { ok: true, order };
}

/**
 * Fuse a nomination into the engine's order.
 *
 * Delegates to {@link fuseRanks} with the nomination as the second order, which is exactly what a nomination is:
 * a second opinion about position, carrying no strength the model did not state. A service the nomination never
 * named scores on the engine's order alone — absence is absence, not a low rank.
 *
 * @param engineOrder - The engine's services, best first.
 * @param order - The nominated services, best first. May be partial, may be empty.
 * @param options - Strategy, weight and RRF's constant.
 * @returns A new order over the engine's services; `engineOrder`'s contents unchanged when `weight` is zero.
 */
export function fuseNomination(
  engineOrder: readonly string[],
  order: readonly ServiceId[],
  options: RankFusionOptions,
): readonly string[] {
  return fuseRanks(engineOrder, order, options);
}
