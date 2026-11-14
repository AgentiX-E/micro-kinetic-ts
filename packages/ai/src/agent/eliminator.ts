/**
 * The eliminator's wire protocol: one table in, one JSON reply out, and the rule that reads the reply.
 *
 * `hypothesis-space.ts` decides what an agent is **allowed** to say. This module decides what it is **asked**, and
 * how its answer is read — the two halves of the same contract, because a claim space with no question attached is
 * a verifier nobody can feed.
 *
 * Three properties are load-bearing, and each one is a refusal rather than a preference:
 *
 * * **The prompt is a pure function of the fingerprint.** No clock, no case id, no corpus statistic, no sampled
 *   context. Two runs of the same artifact produce the same bytes, so the reply cache is a cache and not a corpus
 *   of anecdotes — and an ablation that re-scores a recorded reply is scoring the SAME question, which is what
 *   makes the control arm free (`docs/agentic-layer-plan.md` §3).
 * * **Every number in the reply is copied, never computed.** The value a claim cites is printed in the table
 *   exactly as the fingerprint holds it (`String(v)` — the shortest representation that round-trips), so
 *   {@link verifyClaim}'s equality check cannot refuse a faithful copy. A derived quantity — `post − pre` — is
 *   deliberately absent from the table and from the protocol, because a number the model had to compute would be
 *   refused for arithmetic error and the refusal would read as fabrication.
 * * **A reply is applied whole or not at all.** A truncated or half-parsed answer is not a smaller answer: the
 *   claims of a cut-off response are the ones the model was most confident about only by accident of generation
 *   order, and admitting them would make the arm's accuracy a function of `max_tokens`.
 *
 * What this module does NOT do: judge. A reply that parses is returned as claims and every semantic question —
 * is that service in the posterior, is that channel on both candidates, is the removed candidate actually outside
 * its band — belongs to {@link verifyClaim}. Two refusals in two places means a refusal names which one fired.
 */

import type {
  CandidateFingerprint,
  ChannelFingerprint,
  ClaimStatistic,
  EliminationClaim,
} from './hypothesis-space.js';

/**
 * Version of the prompt text and the reply contract.
 *
 * Bumped whenever either changes, and carried in every cached reply: a cache hit is only an answer to the
 * question that was asked, and the version is what lets a reader tell a stale answer from a wrong one.
 */
export const ELIMINATOR_PROTOCOL = 1;

/**
 * The statistics a prompt may ask about.
 *
 * `delta` is one of the claim statistics and is not a member of this list: the table prints `pre` and
 * `post`, so `delta` is the one statistic a model would have to compute, and a subtraction that rounds is
 * indistinguishable from a value that was invented. A claim may still rest on `delta` — the evidence arm computes
 * it exactly — but this prompt does not offer it.
 */
export const PROMPTABLE_STATISTICS = ['post', 'onset'] as const;

/** How much of the fingerprint one prompt carries. All three are parameters because all three are ablations. */
export interface EliminatorOptions {
  /** Candidates presented, in rank order. The arm can promote at most to this depth. */
  readonly maxCandidates: number;
  /** Channels printed per candidate, most informative first. */
  readonly maxChannels: number;
  /**
   * Eliminations a reply may carry.
   *
   * `maxCandidates − 1` is the coherent default: promoting the deepest presented candidate takes one elimination
   * per candidate above it, so a smaller bound would make the presentation a promise the protocol cannot keep.
   */
  readonly maxClaims: number;
}

/** Defaults: the published presentation (top five), six channels, and every elimination a promotion needs. */
export const DEFAULT_ELIMINATOR_OPTIONS: EliminatorOptions = {
  maxCandidates: 5,
  maxChannels: 6,
  maxClaims: 4,
};

/** One question, as it will be sent. */
export interface EliminatorPrompt {
  readonly system: string;
  readonly user: string;
  /** 16 hex characters: two independent FNV-1a passes over `system` and `user`. The cache key's other half. */
  readonly digest: string;
  /** How many candidates the table carries: `min(maxCandidates, candidates.length)`. */
  readonly presented: number;
}

/** What reading a reply concluded. `ok` with an empty list is a legitimate "the ranking is right". */
export type ParsedReply =
  | { readonly ok: true; readonly claims: readonly EliminationClaim[] }
  | { readonly ok: false; readonly why: string };

const SYSTEM_PROMPT = [
  'You audit a root-cause ranking that a deterministic engine produced for one fault injection.',
  'Exactly one of the candidates is the injected source. The others are services whose telemetry moved because',
  'the fault propagated to them, and a symptom can outrank the source.',
  '',
  'Each candidate carries channels summarised before and after the injection. `band` is the interval the channel',
  'stays inside when nothing is wrong, and `rate` is the fraction of fault-free windows in which it left that band',
  'anyway, so a channel with a high rate is one that always swings. `onset` is the time in milliseconds after the',
  'injection at which the channel first left its band; `-` means it never left, and a channel that never left',
  'cannot be cited as evidence.',
  '',
  'You may only ELIMINATE candidates, and only by citing one channel that the candidate you eliminate left:',
  'a claim that removes a candidate whose cited channel is inside its own band is refused, and so is a claim whose',
  'quoted numbers disagree with the table.',
  '',
  'To promote the candidate at rank r, emit one elimination for each candidate ranked above it, all citing the',
  'same discriminating channel. If the ranking is already right, emit an empty list — that is a valid answer and',
  'it is counted as one.',
  '',
  'Reply with JSON ONLY, in exactly this shape, quoting every number verbatim from the table:',
  '{"eliminate":[{"remove":"<service>","keep":"<service>","channel":"<label>",',
  '"statistic":"post","observed":<number>,"band":[<low>,<high>],"rate":<number>}]}',
  "`statistic` is `post` or `onset`. `band` and `rate` are the removed candidate's, copied from its row.",
].join('\n');

/** `String(v)` for a finite number, `nan` otherwise, so a printed value round-trips to the same double. */
function num(value: number): string {
  return Number.isFinite(value) ? String(value) : 'nan';
}

/**
 * How far outside its band a channel sits, in units of the band's own width.
 *
 * Zero means inside. A zero-width band — the shape a channel takes when it is exactly one value in every fault-free
 * window, e.g. `error` at 0 — has no width to measure in, and any move off it is unbounded in those units: the
 * result is a positive infinity rather than a division by a made-up floor, because a finite number there would be
 * a scale nobody chose.
 *
 * @param channel - The channel to measure.
 * @returns Zero inside the band, a positive distance outside it, and infinity when there is no scale to state.
 */
export function departureOf(channel: ChannelFingerprint): number {
  const [low, high] = channel.band;
  const value = channel.post;
  if (!Number.isFinite(value) || !Number.isFinite(low) || !Number.isFinite(high)) {
    return Number.POSITIVE_INFINITY;
  }
  if (value >= low && value <= high) return 0;
  const width = high - low;
  if (width <= 0) return Number.POSITIVE_INFINITY;
  const distance = value > high ? value - high : low - value;
  return distance / width;
}

/**
 * The channels worth showing, most informative first.
 *
 * Out-of-band channels before in-band ones, then earliest onset, then widest departure, then label — a total order
 * with no dependence on the array the fingerprint happened to arrive in, which is what keeps the prompt digest
 * stable across two runs of one artifact.
 *
 * @param channels - A candidate's channels.
 * @param limit - How many to keep.
 * @returns At most `limit` channels.
 */
export function shownChannels(
  channels: readonly ChannelFingerprint[],
  limit: number,
): readonly ChannelFingerprint[] {
  const ranked = [...channels].sort((left, right) => {
    const leftOutside = departureOf(left) > 0 ? 0 : 1;
    const rightOutside = departureOf(right) > 0 ? 0 : 1;
    if (leftOutside !== rightOutside) return leftOutside - rightOutside;
    const leftOnset = left.onset ?? Number.POSITIVE_INFINITY;
    const rightOnset = right.onset ?? Number.POSITIVE_INFINITY;
    if (leftOnset !== rightOnset) return leftOnset < rightOnset ? -1 : 1;
    const leftDeparts = departureOf(left);
    const rightDeparts = departureOf(right);
    if (leftDeparts !== rightDeparts) return rightDeparts > leftDeparts ? 1 : -1;
    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0;
  });
  return ranked.slice(0, Math.max(0, limit));
}

/** One candidate as the table renders it. */
function candidateBlock(
  candidate: CandidateFingerprint,
  channels: readonly ChannelFingerprint[],
): string {
  const lines = [
    `### rank ${candidate.rank} — ${candidate.service} — score ${num(candidate.score)}`,
    '| channel | pre | post | band | rate | onset |',
    '| --- | ---: | ---: | --- | ---: | ---: |',
  ];
  for (const channel of channels) {
    lines.push(
      `| ${channel.label} | ${num(channel.pre)} | ${num(channel.post)} | ` +
        `[${num(channel.band[0])}, ${num(channel.band[1])}] | ${num(channel.rate)} | ` +
        `${channel.onset === undefined ? '-' : num(channel.onset)} |`,
    );
  }
  return lines.join('\n');
}

/**
 * Two independent FNV-1a passes over the text, as 16 hex characters.
 *
 * Not a cryptographic digest: the value's job is to tell a cache hit from a stale answer within one corpus of
 * ~1 500 prompts, and a 64-bit value whose collision probability is 1e-13 at that size is enough. Taking the same
 * bytes twice with different offsets is cheaper than carrying a hash dependency into a package with none.
 *
 * @param text - The text to digest.
 * @returns 16 lowercase hex characters.
 */
export function digestOf(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return first.toString(16).padStart(8, '0') + second.toString(16).padStart(8, '0');
}

/**
 * Build the question.
 *
 * The fault type is passed as text and rendered in the header: it is the one piece of context the fingerprint does
 * not carry, and withholding it would ask a model to infer from telemetry alone what the corpus already states.
 *
 * @param faultType - The case's injected fault type, as the corpus names it.
 * @param candidates - The posterior, in rank order.
 * @param options - How much to present.
 * @returns The two messages, the digest they hash to, and how many candidates survived the window.
 */
export function buildEliminatorPrompt(
  faultType: string,
  candidates: readonly CandidateFingerprint[],
  options: EliminatorOptions = DEFAULT_ELIMINATOR_OPTIONS,
): EliminatorPrompt {
  const window = candidates.slice(0, Math.max(0, options.maxCandidates));
  const blocks = window.map((candidate) =>
    candidateBlock(candidate, shownChannels(candidate.channels, options.maxChannels)),
  );
  const user = [
    `FAULT TYPE: ${faultType}`,
    `CANDIDATES: ${window.length} (rank 0 is the engine's answer; a higher score is a stronger claim)`,
    '',
    ...(blocks.length === 0
      ? ['The engine returned no candidate. Reply with {"eliminate":[]}.']
      : [blocks.join('\n\n')]),
    '',
    `At most ${options.maxClaims} elimination(s).`,
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

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStatistic(value: unknown): value is ClaimStatistic {
  return typeof value === 'string' && (PROMPTABLE_STATISTICS as readonly string[]).includes(value);
}

/**
 * Read one elimination out of a parsed JSON value.
 *
 * @param raw - One element of the reply's `eliminate` array.
 * @param index - Its position, for the refusal message.
 * @returns The claim, or a reason the element is not one.
 */
function claimOf(raw: unknown, index: number): EliminationClaim | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `elimination ${index} is not an object`;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record['remove'] !== 'string' || typeof record['keep'] !== 'string') {
    return `elimination ${index} does not name both a removed and a kept service`;
  }
  if (typeof record['channel'] !== 'string') return `elimination ${index} does not name a channel`;
  if (!isStatistic(record['statistic'])) {
    return `elimination ${index} cites statistic ${String(record['statistic'])}, and this prompt offers post or onset`;
  }
  const band = record['band'];
  if (!Array.isArray(band) || band.length !== 2 || !isNumber(band[0]) || !isNumber(band[1])) {
    return `elimination ${index} does not carry a two-number band`;
  }
  if (!isNumber(record['observed']))
    return `elimination ${index} does not carry a numeric observed value`;
  if (record['rate'] !== undefined && !isNumber(record['rate'])) {
    return `elimination ${index} carries a rate that is not a number`;
  }
  const because: {
    channel: string;
    statistic: ClaimStatistic;
    observed: number;
    band: readonly [number, number];
    rate?: number;
  } = {
    channel: record['channel'],
    statistic: record['statistic'],
    observed: record['observed'],
    band: [band[0], band[1]],
  };
  if (isNumber(record['rate'])) because.rate = record['rate'];
  return { remove: record['remove'], keep: record['keep'], because };
}

/**
 * Read a reply.
 *
 * The shape checks are here and the semantic ones are in `verifyClaim`, so a refusal names which of the two fired:
 * `ok: false` means the reply was not an answer to this question, and a claim refused later means the answer was
 * wrong about the case.
 *
 * @param text - The model's message, fences and prose tolerated only in that a fenced body is unwrapped.
 * @param maxClaims - The bound the prompt stated.
 * @returns The claims, or why the text is not a reply.
 */
export function parseEliminatorReply(text: string, maxClaims: number): ParsedReply {
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
  const eliminate = (parsed as Record<string, unknown>)['eliminate'];
  if (!Array.isArray(eliminate)) return { ok: false, why: 'the reply has no eliminate array' };
  if (eliminate.length > maxClaims) {
    return {
      ok: false,
      why: `the reply carries ${eliminate.length} eliminations against a bound of ${maxClaims}`,
    };
  }
  const claims: EliminationClaim[] = [];
  for (let index = 0; index < eliminate.length; index++) {
    const claim = claimOf(eliminate[index], index);
    if (typeof claim === 'string') return { ok: false, why: claim };
    claims.push(claim);
  }
  return { ok: true, claims };
}
