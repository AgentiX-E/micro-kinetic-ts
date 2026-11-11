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

import { appendFileSync, writeFileSync } from 'node:fs';

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
