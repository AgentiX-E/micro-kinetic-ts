/**
 * The topology brief as an artifact: one record, written by the run that measured and read by the arm that asks.
 *
 * ## Why this is a file and not an argument
 *
 * The brief is a property of the CORPUS — one union graph over every case a run read — so it cannot be typed on a
 * command line, and it must not be derived by the consumer. A consumer that derived it would need the call graphs,
 * which only a corpus pass has; a consumer that accepted it as a string would let a dispatch attach a topology
 * nobody measured. Writing it beside the dumps makes the run the single owner of the text, and the arm's `digest`
 * line makes a replay name the exact bytes it used.
 *
 * ## Why it refuses more than one record
 *
 * `agentic-presentation-width.md` records the class of defect this file is written against: an artifact whose
 * contract two readers assume differently. A brief is constant over the population it was measured on, and the
 * corpus this repository reads declares no per-case system — the datapack prefix is a batch id, not a deployment
 * (all ten prefixes carry the same 49 services). So a file holding two briefs cannot say which case belongs to
 * which system, and the honest answer is a refusal that names the reason rather than a rule invented at read time.
 * When a corpus does declare a system per case, this is the function that learns to read it.
 *
 * @module benchmarks/topology-brief-file
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import { digestOf } from '../../packages/ai/src/agent/index.js';

/** The one record a corpus-level brief file holds. */
export interface TopologyBriefRecord {
  /** A label for the corpus, for a reader of the file and not for the prompt. */
  readonly system: string;
  /** Cases whose call graphs were unioned. */
  readonly cases: number;
  /** Distinct services the union held. */
  readonly services: number;
  /** Distinct call edges the union held. */
  readonly edges: number;
  /** 16 hex characters over {@link brief}, checked on read. */
  readonly digest: string;
  /** The section itself, verbatim. */
  readonly brief: string;
}

/** What a dump wrote, for the run's own log line. */
export interface TopologyBriefDumpSummary {
  readonly path: string;
  readonly records: number;
  readonly chars: number;
}

/**
 * Render one record as a single JSON line, **without** its newline.
 *
 * Keys are written expressly rather than spread, so a record that gains a field is a compile error here rather
 * than a silently wider file.
 *
 * @param record - The union's rendering.
 * @returns The JSON text of one line.
 */
export function formatTopologyBriefRecord(record: TopologyBriefRecord): string {
  return JSON.stringify({
    system: record.system,
    cases: record.cases,
    services: record.services,
    edges: record.edges,
    digest: record.digest,
    brief: record.brief,
  });
}

/** A count a brief record is allowed to hold. */
function countAt(raw: Record<string, unknown>, key: string, line: number): number {
  const value = raw[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} on line ${line} is not a number`);
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key} on line ${line} is not a non-negative integer`);
  }
  return value;
}

/**
 * Read a brief file back.
 *
 * Blank lines are skipped; every other unrecognised shape is refused by line number. The digest is re-derived and
 * compared, because a file whose digest disagrees with its own text is a file whose `digest` line in a run log
 * would describe a topology the prompt never carried.
 *
 * @param text - The ndjson contents.
 * @returns One record per non-blank line, in file order.
 * @throws Error when a line is not a record this module would have written.
 */
export function parseTopologyBriefs(text: string): TopologyBriefRecord[] {
  const records: TopologyBriefRecord[] = [];
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
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`line ${lineNumber} is not an object`);
    }
    const record = raw as Record<string, unknown>;
    if (typeof record['system'] !== 'string' || record['system'] === '') {
      throw new Error(`system on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record['digest'] !== 'string' || !/^[0-9a-f]{16}$/.test(record['digest'])) {
      throw new Error(`digest on line ${lineNumber} is not 16 hex characters`);
    }
    if (typeof record['brief'] !== 'string') {
      throw new Error(`brief on line ${lineNumber} is not a string`);
    }
    if (record['brief'] === '') {
      throw new Error(`brief on line ${lineNumber} is empty: "no brief" is the absence of a file`);
    }
    // The digest is re-derived rather than trusted: it is the value a run log prints and a claim is keyed by, and a
    // record that disagrees with its own text would name a topology the prompt never carried.
    const expected = digestOf(record['brief']);
    if (record['digest'] !== expected) {
      throw new Error(
        `digest on line ${lineNumber} is ${record['digest']} but its brief hashes to ${expected}`,
      );
    }
    records.push({
      system: record['system'],
      cases: countAt(record, 'cases', lineNumber),
      services: countAt(record, 'services', lineNumber),
      edges: countAt(record, 'edges', lineNumber),
      digest: record['digest'],
      brief: record['brief'],
    });
  }
  return records;
}

/**
 * Read the ONE brief a corpus-level file must hold.
 *
 * @param path - The artifact `--topology-brief` names.
 * @returns The text and record, or why the file cannot be used as one corpus's topology.
 */
export function readOneTopologyBrief(
  path: string,
):
  | { readonly ok: true; readonly brief: string; readonly record: TopologyBriefRecord }
  | { readonly ok: false; readonly why: string } {
  let records: TopologyBriefRecord[];
  try {
    records = parseTopologyBriefs(readFileSync(path, 'utf8'));
  } catch (error) {
    // `String(error)` and not an `instanceof` ternary: the only two throwers reachable from here are this module's
    // own `new Error(...)` and `readFileSync`'s, so the non-Error arm of that ternary would be a branch no test can
    // reach and no reader can see — the shape this repository keeps deleting rather than documenting.
    return { ok: false, why: `${path}: ${String(error)}` };
  }
  if (records.length === 0) {
    return { ok: false, why: `${path} holds no brief, so --topology-brief would attach nothing` };
  }
  if (records.length > 1) {
    return {
      ok: false,
      why:
        `${path} holds ${records.length} briefs and this corpus declares no per-case system, so no case can be ` +
        'attributed to one of them',
    };
  }
  const record = records[0]!;
  return { ok: true, brief: record.brief, record };
}

/**
 * Append-only writer for the brief file.
 *
 * Constructing it TRUNCATES the file, on the rule `TermDump` and `FingerprintDump` record: a dispatch that ran
 * twice into one path must not read as a single run with two topologies.
 */
export class TopologyBriefDump {
  #records = 0;
  #chars = 0;
  readonly #path: string;

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(path: string) {
    this.#path = path;
    writeFileSync(path, '');
  }

  /**
   * Write one record.
   *
   * @param record - The union's rendering.
   */
  record(record: TopologyBriefRecord): void {
    appendFileSync(this.#path, `${formatTopologyBriefRecord(record)}\n`);
    this.#records += 1;
    this.#chars += record.brief.length;
  }

  /** What was written, for the run's log line. */
  get summary(): TopologyBriefDumpSummary {
    return { path: this.#path, records: this.#records, chars: this.#chars };
  }
}
