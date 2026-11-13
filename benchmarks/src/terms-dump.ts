/**
 * The per-candidate TERM dump, written by a benchmark run for offline weight screens.
 *
 * ## Why this exists as one writer rather than two
 *
 * A score is a sum of terms, and every term is affine in its own weight, so a run that records
 * `(weight, slope)` per candidate lets any weight vector be re-scored WITHOUT the engine:
 *
 *     score'(v) = Σᵢ w'ᵢ · slopeᵢ(v)
 *
 * `scripts/terms-oracle.py` re-scores such a dump and `scripts/terms-fit.py` measures what is left
 * in the weights at all. Both read ONE format, and the two benchmark runners — FSE'26 and RCAEval —
 * must produce it identically, because a screen that reads two corpora has to be able to subtract
 * one column from the other. The format was inline in the FSE'26 runner first; it is a module now
 * that a second runner needs it, and the alternative (a second copy) is the shape of drift this
 * repository has already paid for.
 *
 * The READER lives here for the same reason the writer does: a format with one owner is a format
 * whose round trip can be asserted, and {@link parseTermsDump} refuses every shape the writer would
 * not have emitted rather than coercing it. The two Python scripts predate the reader and stay for
 * the weight screens they implement; `benchmarks/src/term-decomposition.ts` is the TypeScript
 * consumer, and it needs the same refusal for the same reason.
 *
 * ## Why `null` rather than `0`
 *
 * A term whose source did not carry this candidate records neither weight nor slope. That absence
 * is NOT a measured slope of zero: an absent term has no slope at all, so it cannot be re-weighted
 * into existence. A dump that wrote `0` would let a screen claim it could promote a candidate on
 * evidence the engine never collected.
 *
 * ## Why the whole ranking
 *
 * Every published number is read from the top five, and a dump of the top five would be useless to
 * a screen: re-weighting can promote a candidate the shipped ranking never showed, so a screen
 * restricted to five could only report promotions it was unable to make. Callers therefore pass a
 * ranking computed over the WHOLE node set — the same engine, the same terms, a different `topK`.
 * The first five of that order are the five that were reported, because the ranking is a total
 * order sliced at the end.
 *
 * @module benchmarks/terms-dump
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import type { RootCauseResult } from '../../packages/core/src/index.js';

/** One term's `[name, weight, slope]` triple, with `null` for a factor the term never had. */
export type TermDumpTriple = readonly [string, number | null, number | null];

/** One candidate's row: the service, the score the run ordered by, and its terms. */
export interface TermDumpCandidate {
  readonly id: string;
  /** The `finalScore` the sort used, or `null` when the producer did not populate one. */
  readonly score: number | null;
  readonly terms: readonly TermDumpTriple[];
}

/** One case: what the corpus asked for and what the engine answered over. */
export interface TermDumpEntry {
  /** The case's directory or id — the key a screen joins on. */
  readonly datapack: string;
  readonly faultType: string;
  /** Every accepted answer, so a screen scores against the same set the run did. */
  readonly accepted: readonly string[];
  readonly ranking: readonly RootCauseResult[];
}

/** Cumulative record of what a dump wrote. */
export interface TermDumpSummary {
  readonly path: string;
  readonly cases: number;
  readonly candidates: number;
}

/** One candidate read back: what it was ordered by, and the triples it carried. */
export interface ParsedTermCandidate {
  readonly id: string;
  /** The score the sort used, or `null` for a producer that did not populate one. */
  readonly score: number | null;
  readonly terms: readonly TermDumpTriple[];
}

/** One case read back. Field names are the writer's, so a dump round-trips unchanged. */
export interface ParsedTermCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly accepted: readonly string[];
  /** The ranking, best first, WHOLE — the dump never truncates it. */
  readonly candidates: readonly ParsedTermCandidate[];
}

/**
 * Append-only writer for the term dump.
 *
 * Constructing it TRUNCATES the file: a dispatch that ran twice into the same path must not read as
 * one run with twice the cases, and the failure mode of an append-only artifact is a plausible
 * number rather than an error.
 */
export class TermDump {
  private caseCount = 0;
  private candidateCount = 0;

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(readonly path: string) {
    writeFileSync(path, '');
  }

  /**
   * Write one case.
   *
   * @param entry - The case, its accepted answers, and the FULL ranking the engine produced.
   */
  record(entry: TermDumpEntry): void {
    const candidates: TermDumpCandidate[] = entry.ranking.map((result) => ({
      id: result.serviceId,
      score: result.finalScore ?? null,
      // `[name, weight, slope]` rather than an object per term: the dump is tens of candidates ×
      // eighteen terms × every case, and the repeated keys would be most of the bytes.
      terms: (result.terms ?? []).map((term): TermDumpTriple => [
        term.name,
        term.weight ?? null,
        term.slope ?? null,
      ]),
    }));
    appendFileSync(
      this.path,
      `${JSON.stringify({
        datapack: entry.datapack,
        faultType: entry.faultType,
        accepted: entry.accepted,
        candidates,
      })}\n`,
    );
    this.caseCount += 1;
    this.candidateCount += candidates.length;
  }

  /**
   * What was written. Reported rather than assumed, so a dispatch can state that its artifact
   * carries the cases it claims to.
   *
   * @returns The path, the case count and the candidate count.
   */
  summary(): TermDumpSummary {
    return { path: this.path, cases: this.caseCount, candidates: this.candidateCount };
  }
}

/**
 * A number the dump may have written as `null`, refused if it is anything else.
 *
 * @param value - The parsed JSON field.
 * @param field - Its name, for the error.
 * @param line - The line it came from, so a broken row is a location rather than a file.
 * @returns The number, or `null` when the producer recorded no factor.
 * @throws Error when the value is neither `null` nor a finite number.
 */
function factorAt(value: unknown, field: string, line: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} on line ${line} is neither null nor a finite number`);
  }
  return value;
}

/**
 * One `[name, weight, slope]` triple.
 *
 * The arity is checked rather than assumed: a fourth element would be a factor the writer emits and this reader
 * ignores, so a screen would re-score a candidate against three of the four numbers its score was built from.
 *
 * @param value - The parsed JSON element.
 * @param line - The line it came from.
 * @returns The triple.
 * @throws Error when the shape is not one this module writes.
 */
function tripleAt(value: unknown, line: number): TermDumpTriple {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`a term on line ${line} is not a [name, weight, slope] triple`);
  }
  const [name, weight, slope] = value as unknown[];
  if (typeof name !== 'string' || name === '') {
    throw new Error(`a term name on line ${line} is not a non-empty string`);
  }
  return [name, factorAt(weight, 'weight', line), factorAt(slope, 'slope', line)] as const;
}

/**
 * One candidate.
 *
 * @param value - The parsed JSON element.
 * @param line - The line it came from.
 * @returns The candidate.
 * @throws Error when the shape is not one this module writes.
 */
function candidateAt(value: unknown, line: number): ParsedTermCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`a candidate on line ${line} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id === '') {
    throw new Error(`a candidate id on line ${line} is not a non-empty string`);
  }
  if (!Array.isArray(record.terms)) {
    throw new Error(`terms on candidate ${record.id} of line ${line} is not an array`);
  }
  // The terms are validated BEFORE the score, because a broken triple is a finding about the breakdown and
  // reporting it as a broken score would send a reader to the wrong field.
  const terms = record.terms.map((term) => tripleAt(term, line));
  return {
    id: record.id,
    score: factorAt(record.score, `score on candidate ${record.id}`, line),
    terms,
  };
}

/**
 * Read a term dump back.
 *
 * Blank lines are skipped, so a file ending with a newline is not an error. Every other unrecognised shape is
 * refused by line number, because a coerced row is a candidate whose score is re-derived from fewer terms than
 * produced it — and the resulting number would be a promotion the screen cannot make, reported as one it made.
 *
 * Nothing is sorted or deduplicated here: the dump's order IS the ranking, and a reader that reordered it would
 * be reporting the depth of a different order.
 *
 * @param text - The ndjson contents.
 * @returns One case per non-blank line, in file order.
 * @throws Error when a line is not a case this module would have written.
 */
export function parseTermsDump(text: string): ParsedTermCase[] {
  const cases: ParsedTermCase[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
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
    if (typeof record.datapack !== 'string' || record.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    if (
      !Array.isArray(record.accepted) ||
      record.accepted.some((entry) => typeof entry !== 'string' || entry === '')
    ) {
      throw new Error(`accepted on line ${lineNumber} is not an array of non-empty strings`);
    }
    if (!Array.isArray(record.candidates)) {
      throw new Error(`candidates on line ${lineNumber} is not an array`);
    }
    cases.push({
      datapack: record.datapack,
      faultType: record.faultType,
      accepted: record.accepted as string[],
      candidates: record.candidates.map((candidate) => candidateAt(candidate, lineNumber)),
    });
  }
  return cases;
}

/**
 * Read a term dump from disk.
 *
 * @param path - The ndjson file.
 * @returns One case per line.
 */
export function readTermsDump(path: string): ParsedTermCase[] {
  return parseTermsDump(readFileSync(path, 'utf8'));
}
