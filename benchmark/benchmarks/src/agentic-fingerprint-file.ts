/**
 * The per-case fingerprint dump: one JSON line per case, written by a benchmark run and read by an arm.
 *
 * ## Why a dump rather than a call
 *
 * An elimination arm can be paid for in two ways. It can call a model inside the runner, in which case every
 * weight, threshold and skip-rule variant is a new run of the whole corpus and a new bill; or the runner can
 * write down **exactly what a model would have been allowed to see** and every arm can then be computed offline,
 * against the same bytes, for nothing. The second is what this file makes possible, and it is the same argument
 * `--terms-dump` records for weight screens: an expensive question becomes a local computation over one run.
 *
 * ## Why it carries no label
 *
 * The dump deliberately omits the case's accepted answers even though the runner knows them. An arm that reads a
 * fingerprint and a label in one object is an arm that can accidentally condition on the label, and the failure
 * would be invisible — a suspiciously good number is not a stack trace. The label lives in the per-case verdict
 * file the run already writes, and the two are joined on `datapack` by whoever is scoring.
 *
 * ## Why the reader validates
 *
 * Every consumer of this file computes an accuracy from it. A line whose `band` is `null` (what `JSON` writes for
 * a non-finite number) would make every claim citing that channel unverifiable and would read as
 * "the model abstained", not as "the dump is corrupt" — so the reader refuses the file by line number instead of
 * defaulting the field.
 *
 * @module benchmarks/agentic-fingerprint-file
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import type {
  CandidateFingerprint,
  ChannelFingerprint,
} from '../../packages/ai/src/agent/index.js';

import type { FingerprintCensus } from './agentic-fingerprint.js';

/** One case's fingerprint, as the dump stores it. */
export interface FingerprintRecord {
  /** The case directory's name — the key the per-case verdict file joins on. */
  readonly datapack: string;
  readonly faultType: string;
  /** Unix ms. Written beside the fingerprint because an onset is meaningless without it. */
  readonly injectTimeMs: number;
  readonly candidates: readonly CandidateFingerprint[];
  readonly census: FingerprintCensus;
}

/** What a dump wrote, for the run's own log line. */
export interface FingerprintDumpSummary {
  readonly path: string;
  readonly cases: number;
  readonly candidates: number;
  readonly channels: number;
  readonly census: FingerprintCensus;
}

/** The census fields, in the order every rendering writes them. */
const CENSUS_FIELDS = [
  'considered',
  'offered',
  'unmeasurable',
  'unprofiled',
  'shadowed',
  'capped',
] as const;

/** Order a channel's keys so two dumps of one case diff as values rather than as insertion order. */
function channelToJson(channel: ChannelFingerprint): Record<string, unknown> {
  return {
    label: channel.label,
    pre: channel.pre,
    post: channel.post,
    band: [channel.band[0], channel.band[1]],
    rate: channel.rate,
    ...(channel.onset === undefined ? {} : { onset: channel.onset }),
  };
}

/**
 * Render one record as a single JSON line, **without** its newline.
 *
 * @param record - The case's fingerprint.
 * @returns The JSON text of one line.
 */
export function formatFingerprintRecord(record: FingerprintRecord): string {
  return JSON.stringify({
    datapack: record.datapack,
    faultType: record.faultType,
    injectTimeMs: record.injectTimeMs,
    candidates: record.candidates.map((candidate) => ({
      service: candidate.service,
      rank: candidate.rank,
      score: candidate.score,
      channels: candidate.channels.map(channelToJson),
    })),
    census: Object.fromEntries(CENSUS_FIELDS.map((field) => [field, record.census[field]])),
  });
}

/**
 * Append-only writer for the fingerprint dump.
 *
 * Constructing it TRUNCATES the file, on the rule `TermDump` records: a dispatch that ran twice into one path
 * must not read as a single run with twice the cases, and an append-only artifact fails as a plausible number
 * rather than as an error.
 */
export class FingerprintDump {
  #cases = 0;
  #candidates = 0;
  #channels = 0;
  #census: Record<(typeof CENSUS_FIELDS)[number], number> = {
    considered: 0,
    offered: 0,
    unmeasurable: 0,
    unprofiled: 0,
    shadowed: 0,
    capped: 0,
  };

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(readonly path: string) {
    writeFileSync(path, '');
  }

  /**
   * Write one case.
   *
   * @param record - The case's fingerprint.
   */
  record(record: FingerprintRecord): void {
    appendFileSync(this.path, `${formatFingerprintRecord(record)}\n`);
    this.#cases += 1;
    this.#candidates += record.candidates.length;
    for (const candidate of record.candidates) this.#channels += candidate.channels.length;
    for (const field of CENSUS_FIELDS) this.#census[field] += record.census[field];
  }

  /** What was written. The census is summed over cases, so it describes the dump rather than one case. */
  get summary(): FingerprintDumpSummary {
    return {
      path: this.path,
      cases: this.#cases,
      candidates: this.#candidates,
      channels: this.#channels,
      census: { ...this.#census },
    };
  }
}

/** Refuses a value that is not a finite number, naming the field and the line. */
function finiteAt(value: unknown, field: string, line: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} on line ${line} is not a finite number: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Refuses a count that is not a non-negative integer. */
function countAt(value: unknown, field: string, line: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} on line ${line} is not a non-negative integer: ${String(value)}`);
  }
  return value;
}

/** Parses one channel, refusing anything the verifier could not re-check. */
function parseChannel(raw: unknown, line: number): ChannelFingerprint {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`channel on line ${line} is not an object`);
  const channel = raw as Record<string, unknown>;
  if (typeof channel.label !== 'string' || channel.label === '') {
    throw new Error(`channel label on line ${line} is not a non-empty string`);
  }
  const band = channel.band;
  if (!Array.isArray(band) || band.length !== 2) {
    throw new Error(`channel band on line ${line} is not a pair`);
  }
  const rate = finiteAt(channel.rate, `channel rate`, line);
  if (rate < 0 || rate > 1)
    throw new Error(`channel rate on line ${line} is outside [0, 1]: ${rate}`);
  const onset =
    channel.onset === undefined ? undefined : finiteAt(channel.onset, `channel onset`, line);
  const parsed: ChannelFingerprint = {
    label: channel.label,
    pre: finiteAt(channel.pre, `channel pre`, line),
    post: finiteAt(channel.post, `channel post`, line),
    band: [finiteAt(band[0], `channel band[0]`, line), finiteAt(band[1], `channel band[1]`, line)],
    rate,
    ...(onset === undefined ? {} : { onset }),
  };
  return parsed;
}

/** Parses one candidate, refusing a rank that would make two candidates claim one position. */
function parseCandidate(raw: unknown, line: number): CandidateFingerprint {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`candidate on line ${line} is not an object`);
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.service !== 'string' || candidate.service === '') {
    throw new Error(`candidate service on line ${line} is not a non-empty string`);
  }
  if (!Array.isArray(candidate.channels)) {
    throw new Error(`candidate channels on line ${line} is not an array`);
  }
  return {
    service: candidate.service,
    rank: countAt(candidate.rank, `candidate rank`, line),
    score: finiteAt(candidate.score, `candidate score`, line),
    channels: candidate.channels.map((channel: unknown) => parseChannel(channel, line)),
  };
}

/** Parses one census object, requiring every field so a new counter cannot arrive unread. */
function parseCensus(raw: unknown, line: number): FingerprintCensus {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`census on line ${line} is not an object`);
  const census = raw as Record<string, unknown>;
  return {
    considered: countAt(census.considered, `census.considered`, line),
    offered: countAt(census.offered, `census.offered`, line),
    unmeasurable: countAt(census.unmeasurable, `census.unmeasurable`, line),
    unprofiled: countAt(census.unprofiled, `census.unprofiled`, line),
    shadowed: countAt(census.shadowed, `census.shadowed`, line),
    capped: countAt(census.capped, `census.capped`, line),
  };
}

/**
 * Read a dump back.
 *
 * Blank lines are skipped, so a file that ends with a newline is not an error; every other unrecognised shape
 * is refused by line number.
 *
 * @param text - The ndjson contents.
 * @returns One record per non-blank line, in file order.
 * @throws Error when a line is not a record this module would have written.
 */
export function parseFingerprintDump(text: string): FingerprintRecord[] {
  const records: FingerprintRecord[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${lineNumber} is not JSON`);
    }
    if (typeof raw !== 'object' || raw === null)
      throw new Error(`line ${lineNumber} is not an object`);
    const record = raw as Record<string, unknown>;
    if (typeof record.datapack !== 'string' || record.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    if (!Array.isArray(record.candidates)) {
      throw new Error(`candidates on line ${lineNumber} is not an array`);
    }
    records.push({
      datapack: record.datapack,
      faultType: record.faultType,
      injectTimeMs: finiteAt(record.injectTimeMs, `injectTimeMs`, lineNumber),
      candidates: record.candidates.map((candidate: unknown) =>
        parseCandidate(candidate, lineNumber),
      ),
      census: parseCensus(record.census, lineNumber),
    });
  }
  return records;
}

/**
 * Read a dump from disk.
 *
 * @param path - The ndjson file.
 * @returns One record per case.
 */
export function readFingerprintFile(path: string): FingerprintRecord[] {
  return parseFingerprintDump(readFileSync(path, 'utf8'));
}
