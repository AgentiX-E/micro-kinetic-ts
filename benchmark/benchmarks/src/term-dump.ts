/**
 * The reader both pool instruments share: term dump in, corpus out.
 *
 * ## Why a reader is a module
 *
 * Two instruments now read the same artifact — the marginal ledger and the conjunctive score — and both re-rank a
 * pool the engine produced. A reader that quietly dropped a candidate, or that read a `null` weight as `0`, would
 * move the denominator of every number either of them publishes while leaving the surface intact, so the failure
 * would look like a result. Every refusal here therefore throws with the line it happened on, and the runners that
 * call it print no reading unless the whole file parsed.
 *
 * ## What the dump is
 *
 * One JSON object per case: `{ datapack, candidates: [{ id, score, terms: [[name, weight, value], …] }] }`. The
 * terms are triples rather than objects because the file is written a hundred thousand times per run, and a
 * `(null, null)` pair is the dump's only way of saying "this term was not measured for this candidate" — which is
 * *not* the same as a weight of zero, and both instruments depend on the difference.
 *
 * @module benchmarks/term-dump
 */

import type { MarginalCandidate, MarginalCase, TermRow } from './term-marginal.js';

/** One case as the dump wrote it, before the accepted sets are joined in. */
export interface DumpRow {
  readonly datapack: string;
  readonly candidates: readonly MarginalCandidate[];
}

/** The accepted set of one case, as the arm's answers artifact carries it. */
export interface TruthRow {
  readonly datapack: string;
  readonly truth: readonly string[];
}

/** A record, or a refusal naming the field and the line. */
function recordOf(raw: unknown, line: number, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`line ${String(line)}: ${where} is not an object`);
  }
  return raw as Record<string, unknown>;
}

/** A finite number, or a refusal — a `NaN` score would sort silently and never announce itself. */
function finiteOf(raw: unknown, line: number, where: string): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    throw new Error(`line ${String(line)}: ${where} is not a finite number`);
  }
  return raw;
}

/** A non-empty string, or a refusal — an unnamed candidate cannot be published or joined. */
function nameOf(raw: unknown, line: number, where: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`line ${String(line)}: ${where} is not a non-empty string`);
  }
  return raw;
}

/** One term triple `[name, weight, value]`, where both measurements are `null` together or finite together. */
function termOf(raw: unknown, line: number): TermRow {
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error(`line ${String(line)}: a term is not a three-element array`);
  }
  const [name, weight, value] = raw as [unknown, unknown, unknown];
  const termName = nameOf(name, line, 'a term name');
  if (weight === null && value === null) return { name: termName, weight: null, value: null };
  return {
    name: termName,
    weight: finiteOf(weight, line, `the weight of ${termName}`),
    value: finiteOf(value, line, `the value of ${termName}`),
  };
}

/** One candidate: an id, the score it was published with, and its terms. */
function candidateOf(raw: unknown, line: number): MarginalCandidate {
  const row = recordOf(raw, line, 'a candidate');
  const terms = row['terms'];
  if (!Array.isArray(terms))
    throw new Error(`line ${String(line)}: a candidate's terms is not an array`);
  return {
    id: nameOf(row['id'], line, 'a candidate id'),
    score: finiteOf(row['score'], line, `the score of ${String(row['id'])}`),
    terms: terms.map((term) => termOf(term, line)),
  };
}

/** Parse one `terms.ndjson` line. */
export function parseTermLine(raw: unknown, line: number): DumpRow {
  const row = recordOf(raw, line, 'a dump line');
  const candidates = row['candidates'];
  if (!Array.isArray(candidates))
    throw new Error(`line ${String(line)}: candidates is not an array`);
  return {
    datapack: nameOf(row['datapack'], line, 'a datapack'),
    candidates: candidates.map((candidate) => candidateOf(candidate, line)),
  };
}

/** Parse one `query-agent.ndjson` line far enough to read the accepted set. */
export function parseAnswerLine(raw: unknown, line: number): TruthRow {
  const row = recordOf(raw, line, 'an answer line');
  const truth = row['truth'];
  if (!Array.isArray(truth)) throw new Error(`line ${String(line)}: truth is not an array`);
  return {
    datapack: nameOf(row['datapack'], line, 'a datapack'),
    truth: truth.map((entry) => nameOf(entry, line, 'an accepted service')),
  };
}

/**
 * Join the dump with the accepted sets.
 *
 * A dump case the answers file does not mention is kept with an empty accepted set rather than dropped: the marginal
 * ledger already treats an unlabelled case as ungraded and reports the population it graded, so dropping it here
 * would hide a mismatched pair of artifacts behind a clean-looking number.
 */
export function corpusOf(
  rows: readonly DumpRow[],
  truth: ReadonlyMap<string, readonly string[]>,
): readonly MarginalCase[] {
  return rows.map((row) => ({
    datapack: row.datapack,
    truth: truth.get(row.datapack) ?? [],
    candidates: row.candidates,
  }));
}
