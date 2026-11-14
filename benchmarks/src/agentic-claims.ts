/**
 * The claims artifact: what a model answered, one line per case, with the question it answered recorded beside it.
 *
 * This file is the reason the model arm is cheap to iterate on. A proposal costs money and a round trip; scoring it
 * costs nothing, and every ablation after the first — weight, skip rule, presentation width — is a re-read of the
 * same file. `docs/agentic-layer-plan.md` §7 calls it a cache, but that undersells it: a cache is an optimisation of
 * a recomputation, and this is the artifact that makes the arm **replayable**, which is the property an ablation
 * needs and a cache does not promise.
 *
 * Three fields are provenance rather than content, and each one exists because of a specific way this could lie:
 *
 * * `digest` — the prompt the answer belongs to. A claims file scored against a *different* prompt would report an
 *   accuracy for a question nobody asked, so a replay refuses every record whose digest disagrees with the prompt
 *   the current build produces.
 * * `protocol` — the version of the reply contract. A v1 answer read by v2's parser is not a wrong answer; it is
 *   an answer to a different question, and the two must not be pooled into one score.
 * * `malformed` — why a reply could not be read, when it could not. An unreadable reply is recorded rather than
 *   dropped, so the denominator stays the corpus and a run that broke its own parser cannot look like a run that
 *   was simply cautious.
 */

import type { EliminationClaim } from '../../packages/ai/src/agent/index.js';
import { ELIMINATOR_PROTOCOL } from '../../packages/ai/src/agent/index.js';

/** One case's answer. `claims: []` is a legitimate answer — the model agrees with the engine. */
export interface ClaimRecord {
  readonly datapack: string;
  /** The model the endpoint reported serving. */
  readonly model: string;
  /** {@link ELIMINATOR_PROTOCOL} at the time of the call. */
  readonly protocol: number;
  /** The prompt digest the answer belongs to. */
  readonly digest: string;
  readonly claims: readonly EliminationClaim[];
  /** Why the reply could not be read, when it could not. Mutually exclusive with a non-empty `claims`. */
  readonly malformed?: string;
  /** Wall time of the call, in milliseconds. Provenance, never an input to any decision. */
  readonly ms: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Render one record as a single JSON line, without its newline.
 *
 * Field order is fixed and `because.rate` is omitted when absent, so two runs that produced the same answers
 * produce the same bytes — which is what lets a diff of two artifacts be a diff of two runs.
 *
 * @param record - The record.
 * @returns The JSON text of one line.
 */
export function formatClaimRecord(record: ClaimRecord): string {
  return JSON.stringify({
    datapack: record.datapack,
    model: record.model,
    protocol: record.protocol,
    digest: record.digest,
    claims: record.claims.map((claim) => ({
      remove: claim.remove,
      keep: claim.keep,
      because: {
        channel: claim.because.channel,
        statistic: claim.because.statistic,
        observed: claim.because.observed,
        band: [claim.because.band[0], claim.because.band[1]],
        ...(claim.because.rate === undefined ? {} : { rate: claim.because.rate }),
      },
    })),
    ...(record.malformed === undefined ? {} : { malformed: record.malformed }),
    ms: record.ms,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  });
}

/** A field that must be a finite number, or the reason it is not. */
function numberField(source: Record<string, unknown>, key: string, line: number): number | string {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value))
    return `line ${line}: ${key} is not a number`;
  return value;
}

/** Read one claim back, refusing anything the writer could not have produced. */
function claimFrom(raw: unknown, line: number): EliminationClaim | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return `line ${line}: a claim is not an object`;
  }
  const record = raw as Record<string, unknown>;
  const because = record['because'];
  if (typeof because !== 'object' || because === null || Array.isArray(because)) {
    return `line ${line}: a claim carries no basis`;
  }
  const basis = because as Record<string, unknown>;
  const band = basis['band'];
  if (
    !Array.isArray(band) ||
    band.length !== 2 ||
    typeof band[0] !== 'number' ||
    typeof band[1] !== 'number'
  ) {
    return `line ${line}: a claim's band is not two numbers`;
  }
  if (typeof record['remove'] !== 'string' || typeof record['keep'] !== 'string') {
    return `line ${line}: a claim does not name both a removed and a kept service`;
  }
  if (typeof basis['channel'] !== 'string') return `line ${line}: a claim names no channel`;
  const statistic = basis['statistic'];
  if (statistic !== 'post' && statistic !== 'delta' && statistic !== 'onset') {
    return `line ${line}: a claim cites an unknown statistic`;
  }
  if (typeof basis['observed'] !== 'number' || !Number.isFinite(basis['observed'])) {
    return `line ${line}: a claim's observed value is not a number`;
  }
  if (
    basis['rate'] !== undefined &&
    (typeof basis['rate'] !== 'number' || !Number.isFinite(basis['rate']))
  ) {
    return `line ${line}: a claim's rate is not a number`;
  }
  const built: {
    channel: string;
    statistic: 'post' | 'delta' | 'onset';
    observed: number;
    band: readonly [number, number];
    rate?: number;
  } = {
    channel: basis['channel'],
    statistic,
    observed: basis['observed'],
    band: [band[0], band[1]],
  };
  // A conditional spread rather than an assignment behind an `if`: the reader has to agree with the WRITER about
  // whether an absent rate is absent, and one expression that either adds the field or does not is that agreement.
  const withRate = typeof basis['rate'] === 'number' ? { ...built, rate: basis['rate'] } : built;
  return { remove: record['remove'], keep: record['keep'], because: withRate };
}

/**
 * Read a claims file.
 *
 * Blank lines are skipped — a trailing newline is not a record — and anything else that does not parse throws with
 * its line number. A reader that silently dropped an unreadable line would report an accuracy over a corpus it did
 * not read, which is the failure this whole artifact exists to make impossible.
 *
 * @param text - The file's contents.
 * @returns One record per non-empty line, in file order.
 */
export function parseClaimRecords(text: string): ClaimRecord[] {
  const records: ClaimRecord[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    const at = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`claims line ${at} is not JSON`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`claims line ${at} is not an object`);
    }
    const source = parsed as Record<string, unknown>;
    if (typeof source['datapack'] !== 'string' || source['datapack'] === '') {
      throw new Error(`claims line ${at} names no case`);
    }
    if (typeof source['model'] !== 'string') throw new Error(`claims line ${at} names no model`);
    if (typeof source['digest'] !== 'string')
      throw new Error(`claims line ${at} carries no prompt digest`);
    const protocol = numberField(source, 'protocol', at);
    if (typeof protocol === 'string') throw new Error(protocol);
    const ms = numberField(source, 'ms', at);
    if (typeof ms === 'string') throw new Error(ms);
    const promptTokens = numberField(source, 'promptTokens', at);
    if (typeof promptTokens === 'string') throw new Error(promptTokens);
    const completionTokens = numberField(source, 'completionTokens', at);
    if (typeof completionTokens === 'string') throw new Error(completionTokens);
    if (source['malformed'] !== undefined && typeof source['malformed'] !== 'string') {
      throw new Error(`claims line ${at} carries a malformed reason that is not text`);
    }
    const raw = source['claims'];
    if (!Array.isArray(raw)) throw new Error(`claims line ${at} carries no claims array`);
    const claims: EliminationClaim[] = [];
    for (const one of raw) {
      const claim = claimFrom(one, at);
      if (typeof claim === 'string') throw new Error(claim);
      claims.push(claim);
    }
    records.push({
      datapack: source['datapack'],
      model: source['model'],
      protocol,
      digest: source['digest'],
      claims,
      ...(source['malformed'] === undefined ? {} : { malformed: source['malformed'] }),
      ms,
      promptTokens,
      completionTokens,
    });
  }
  return records;
}

/** What a replay could pair, and what it refused. Both counts are printed, never inferred. */
export interface ClaimReplay {
  /** Cases whose recorded answer belongs to the prompt this build produces. */
  readonly byCase: ReadonlyMap<string, readonly EliminationClaim[]>;
  /** Cases whose answer was reused. */
  readonly reused: number;
  /** Cases whose recorded digest disagrees with the current prompt: the answer is about a different question. */
  readonly stale: readonly string[];
  /** Cases whose recorded protocol version is not the current one. */
  readonly foreignProtocol: readonly string[];
  /** Cases in the file that the population does not hold. */
  readonly unknown: readonly string[];
  /** Cases whose reply was recorded as unreadable, so the arm abstained there. */
  readonly malformed: number;
}

/**
 * Pair recorded answers with the questions this build asks.
 *
 * Three refusals rather than one, because they mean different things: a stale digest is a prompt that changed, a
 * foreign protocol is a parser that changed, and an unknown case is a file scored against the wrong population.
 * Pooling them would let a run report one number for three different mistakes.
 *
 * @param records - The claims file, in file order.
 * @param digests - The prompt digest for every case in the population.
 * @returns The replay, with each refusal named.
 */
export function replayOf(
  records: readonly ClaimRecord[],
  digests: ReadonlyMap<string, string>,
): ClaimReplay {
  const byCase = new Map<string, readonly EliminationClaim[]>();
  const stale: string[] = [];
  const foreignProtocol: string[] = [];
  const unknown: string[] = [];
  let malformed = 0;
  for (const record of records) {
    const expected = digests.get(record.datapack);
    if (expected === undefined) {
      unknown.push(record.datapack);
      continue;
    }
    // The protocol is checked first: an answer read by a parser it was not written for is not a wrong answer to
    // this question, it is a record of a different contract, and its digest is then a comparison of two things
    // that were never the same kind of number.
    if (record.protocol !== ELIMINATOR_PROTOCOL) {
      foreignProtocol.push(record.datapack);
      continue;
    }
    if (record.digest !== expected) {
      stale.push(record.datapack);
      continue;
    }
    if (record.malformed !== undefined) {
      malformed += 1;
      byCase.set(record.datapack, []);
      continue;
    }
    byCase.set(record.datapack, record.claims);
  }
  return { byCase, reused: byCase.size, stale, foreignProtocol, unknown, malformed };
}
