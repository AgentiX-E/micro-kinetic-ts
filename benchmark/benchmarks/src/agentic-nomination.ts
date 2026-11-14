/**
 * The nomination arm: a recorded ranking per case, verified, fused, and scored.
 *
 * ## What this file is for
 *
 * The elimination line measured a **protocol ceiling** — 79.4 % on the 1 422-case corpus, against a posterior whose
 * recall at five is 87.8 %. The 8.4-point difference is spent on expressing a promotion: an elimination has to
 * cite a channel printed on both rows and outside the removed row's band, and a case with one discriminating
 * channel but not three cannot say what it knows. This module scores the protocol that can.
 *
 * ## Three readings, and why the control is one of them
 *
 * | arm        | what it is                                                                 |
 * | ---------- | -------------------------------------------------------------------------- |
 * | `engine`   | the shipped ranking, untouched. The denominator every delta is against.     |
 * | `oracle`   | the best any nomination of this posterior can reach — the truth at rank 0.  |
 * | `nominate` | the model's ranking, verified and fused at the given weight.                 |
 *
 * The oracle arm is not a method. It is the number that separates "the protocol cannot express this" from "the
 * model did not see it": with a posterior of width 5 it is 87.8 %, and no protocol can beat it.
 *
 * ## Why refusals are counted rather than dropped
 *
 * A nomination naming a service the posterior does not carry is not an abstention, and pooling the two would let a
 * model that answers about another case score as a model that stayed silent. Every refusal is tallied by family
 * *and* the refused case keeps its engine answer, so the denominator stays the corpus under every reading.
 *
 * @module benchmarks/agentic-nomination
 */

import {
  NOMINATION_PROTOCOL,
  fuseNomination,
  parseNominationReply,
  verifyNomination,
  type CandidateFingerprint,
  type NominationRejection,
  type RankStrategy,
} from '../../packages/ai/src/agent/index.js';

import type { HeadroomCase } from './agentic-headroom.js';

/** One case's answer. `ranking: []` is a legitimate answer — the model agrees with the engine. */
export interface NominationRecord {
  readonly datapack: string;
  /** The model the endpoint reported serving. */
  readonly model: string;
  /** {@link NOMINATION_PROTOCOL} at the time of the call. */
  readonly protocol: number;
  /** The prompt digest the answer belongs to. */
  readonly digest: string;
  /** The services the model ranked, best first, exactly as it wrote them (before verification). */
  readonly ranking: readonly string[];
  /** Why the reply could not be read, when it could not. Mutually exclusive with a readable `ranking`. */
  readonly malformed?: string;
  readonly ms: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
}

/**
 * Render one record as a single JSON line, without its newline.
 *
 * Field order is fixed and `malformed` is omitted when absent, so two runs that produced the same answers produce
 * the same bytes — the property that lets a diff of two artifacts be a diff of two runs.
 *
 * @param record - The record.
 * @returns The JSON text of one line.
 */
export function formatNominationRecord(record: NominationRecord): string {
  return JSON.stringify({
    datapack: record.datapack,
    model: record.model,
    protocol: record.protocol,
    digest: record.digest,
    ranking: [...record.ranking],
    ...(record.malformed === undefined ? {} : { malformed: record.malformed }),
    ms: record.ms,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
  });
}

/**
 * Read a nominations file back, refusing anything the writer could not have produced.
 *
 * @param text - The file's contents.
 * @returns Records by case, or the first line that is not one.
 */
export function parseNominationRecords(
  text: string,
):
  | { readonly ok: true; readonly records: Map<string, NominationRecord> }
  | { readonly ok: false; readonly why: string } {
  const records = new Map<string, NominationRecord>();
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return { ok: false, why: `line ${index + 1}: not JSON` };
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, why: `line ${index + 1}: not an object` };
    }
    const row = parsed as Record<string, unknown>;
    if (typeof row['datapack'] !== 'string' || row['datapack'] === '') {
      return { ok: false, why: `line ${index + 1}: datapack is not a name` };
    }
    if (typeof row['digest'] !== 'string') {
      return { ok: false, why: `line ${index + 1}: digest is not a string` };
    }
    if (typeof row['protocol'] !== 'number' || !Number.isFinite(row['protocol'])) {
      return { ok: false, why: `line ${index + 1}: protocol is not a number` };
    }
    const ranking = row['ranking'];
    if (!Array.isArray(ranking) || ranking.some((entry) => typeof entry !== 'string')) {
      return { ok: false, why: `line ${index + 1}: ranking is not an array of service names` };
    }
    const malformed = row['malformed'];
    if (malformed !== undefined && typeof malformed !== 'string') {
      return { ok: false, why: `line ${index + 1}: malformed is not a string` };
    }
    for (const key of ['ms', 'promptTokens', 'completionTokens'] as const) {
      const value = row[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return { ok: false, why: `line ${index + 1}: ${key} is not a number` };
      }
    }
    records.set(row['datapack'], {
      datapack: row['datapack'],
      model: typeof row['model'] === 'string' ? row['model'] : 'unknown',
      protocol: row['protocol'],
      digest: row['digest'],
      ranking: ranking as string[],
      ...(malformed === undefined ? {} : { malformed }),
      ms: row['ms'] as number,
      promptTokens: row['promptTokens'] as number,
      completionTokens: row['completionTokens'] as number,
    });
  }
  return { ok: true, records };
}

/** What one nomination arm did over one population. */
export interface NominationOutcome {
  readonly strategy: RankStrategy;
  readonly weight: number;
  readonly cases: number;
  readonly correct: number;
  readonly top1: number;
  /** Cases whose top-1 changed from the engine's. */
  readonly moved: number;
  /** Cases the model answered with a non-empty ranking. */
  readonly ranked: number;
  /** Cases the model left to the engine with an empty ranking. */
  readonly declined: number;
  /** Cases whose recorded reply could not be read. */
  readonly unreadable: number;
  /** Cases with no record at all. */
  readonly missing: number;
  /** Refusals by family. */
  readonly refused: Readonly<Record<NominationRejection, number>>;
  /** Cases where the truth is not in the posterior, so no arm could have reached it. */
  readonly truthAbsent: number;
  /** Correct answers, per fault family. */
  readonly byFamily: Readonly<Record<string, number>>;
}

/** An empty refusal tally, as a fresh object so a caller cannot share one. */
function emptyRefusals(): Record<NominationRejection, number> {
  return { 'unknown-candidate': 0, 'duplicate-candidate': 0 };
}

/** The engine's order, best first. */
export function engineOrderOf(candidates: readonly CandidateFingerprint[]): readonly string[] {
  return candidates.map((candidate) => candidate.service);
}

/** True when `order`'s first element is an accepted answer. */
function answered(order: readonly string[], accepted: readonly string[]): boolean {
  const first = order[0];
  return first !== undefined && accepted.includes(first);
}

/**
 * Score the nomination arm over a population.
 *
 * The control is this same function at `weight = 0`, not a second loop: an arm's number and the control's number
 * produced by one piece of code is what makes a delta mean something.
 *
 * A case with no record is **not** dropped. It keeps its engine answer and is counted under `missing`, because a
 * run that answered 900 of 1 422 cases must not report an accuracy over 900.
 *
 * @param cases - The paired population.
 * @param records - Recorded answers, keyed by case.
 * @param options - Strategy and weight.
 * @returns Counts and rates. Fractions are over `cases`, never over the answered subset.
 */
export function scoreNomination(
  cases: readonly HeadroomCase[],
  records: ReadonlyMap<string, NominationRecord>,
  options: { readonly strategy: RankStrategy; readonly weight: number; readonly rrfK?: number },
): NominationOutcome {
  const refused = emptyRefusals();
  const byFamily: Record<string, number> = {};
  let correct = 0;
  let moved = 0;
  let ranked = 0;
  let declined = 0;
  let unreadable = 0;
  let missing = 0;
  let truthAbsent = 0;

  for (const oneCase of cases) {
    const engine = engineOrderOf(oneCase.candidates);
    const acceptedSet = new Set(oneCase.accepted);
    if (!engine.some((service) => acceptedSet.has(service))) truthAbsent += 1;

    const record = records.get(oneCase.datapack);
    let order = engine;
    if (record === undefined) {
      missing += 1;
    } else if (record.malformed !== undefined) {
      unreadable += 1;
    } else {
      const verified = verifyNomination(record.ranking, oneCase.candidates);
      if (!verified.ok) {
        refused[verified.reason] += 1;
      } else if (verified.order.length === 0) {
        declined += 1;
      } else {
        ranked += 1;
        order = fuseNomination(engine, verified.order, {
          strategy: options.strategy,
          weight: options.weight,
          rrfK: options.rrfK ?? 60,
        });
      }
    }

    if (answered(order, oneCase.accepted)) {
      correct += 1;
      byFamily[oneCase.faultType] = (byFamily[oneCase.faultType] ?? 0) + 1;
    }
    if (order[0] !== engine[0]) moved += 1;
  }

  return {
    strategy: options.strategy,
    weight: options.weight,
    cases: cases.length,
    correct,
    top1: cases.length === 0 ? 0 : correct / cases.length,
    moved,
    ranked,
    declined,
    unreadable,
    missing,
    refused,
    truthAbsent,
    byFamily,
  };
}

/**
 * The oracle arm: the truth at rank 0 wherever the posterior holds it.
 *
 * Not a method — a bound. With a width-5 posterior on this corpus it reads 87.8 %, and any protocol that scores
 * above the `nominate` arm but below this one is limited by what it can *say*, not by what the model saw.
 *
 * @param cases - The paired population.
 * @returns The number of cases whose top-1 is an accepted answer under a perfect reader.
 */
export function oracleTop1(cases: readonly HeadroomCase[]): number {
  let correct = 0;
  for (const oneCase of cases) {
    if (oneCase.candidates.some((candidate) => oneCase.accepted.includes(candidate.service))) {
      correct += 1;
    }
  }
  return correct;
}

/** Format a percentage the way every table in this repository prints one. */
function pct(value: number): string {
  return `${(100 * value).toFixed(1)}%`;
}

/**
 * Render the arm table.
 *
 * @param outcomes - One row per configuration, in publication order.
 * @param oracle - The ceiling, printed as its own row so no reader has to hold it in their head.
 * @param cases - The population size, for the oracle row's denominator.
 * @returns The table, as text.
 */
export function formatNominationTable(
  outcomes: readonly NominationOutcome[],
  oracle: number,
  cases: number,
): string {
  const lines = [
    'arm        strategy  weight  cases   top1    moved  ranked  declined  unreadable  missing  refused',
  ];
  lines.push(
    `oracle     -             -  ${String(cases).padStart(5)}  ${pct(cases === 0 ? 0 : oracle / cases)}` +
      '        -       -         -           -        -        -',
  );
  for (const outcome of outcomes) {
    const refused = outcome.refused['unknown-candidate'] + outcome.refused['duplicate-candidate'];
    lines.push(
      `nominate   ${outcome.strategy.padEnd(8)}  ${outcome.weight.toFixed(2).padStart(5)}  ` +
        `${String(outcome.cases).padStart(5)}  ${pct(outcome.top1).padStart(6)}  ` +
        `${String(outcome.moved).padStart(6)}  ${String(outcome.ranked).padStart(6)}  ` +
        `${String(outcome.declined).padStart(9)}  ${String(outcome.unreadable).padStart(10)}  ` +
        `${String(outcome.missing).padStart(7)}  ${String(refused).padStart(7)}`,
    );
  }
  return lines.join('\n');
}

/**
 * The refusal census, one line per family, with the fate of a refused case stated.
 *
 * @param outcomes - The scored arms; the first one's tally is reported, since verification does not depend on the
 *   fusion weight.
 * @returns The census, as text.
 */
export function formatNominationRefusals(outcomes: readonly NominationOutcome[]): string {
  const first = outcomes[0];
  if (first === undefined) return 'refusals: no arm was scored';
  const total = first.refused['unknown-candidate'] + first.refused['duplicate-candidate'];
  const lines = [
    `refusals: ${total} (each kept its engine answer, so the denominator stays the corpus)`,
  ];
  for (const [reason, count] of Object.entries(first.refused)) {
    lines.push(
      `  ${reason.padEnd(20)} ${String(count).padStart(6)}  ${pct(total === 0 ? 0 : count / total)} of refusals`,
    );
  }
  return lines.join('\n');
}

/** Re-exported so a CLI can parse a raw reply without importing the package's internals twice. */
export { NOMINATION_PROTOCOL, parseNominationReply };
