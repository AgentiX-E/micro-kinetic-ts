/**
 * The per-case verdict file: one line per case, in the order the cases were scored.
 *
 * ## Why this exists
 *
 * Every RCABench number this repository publishes is an **average**, and an average over a corpus cannot be
 * re-scored under a different judgement. That mattered the moment a competitor was run on the same 1,422 cases:
 * RCABench's ground truth is a SET for edge-shaped faults (both endpoints of the edge), so `top-1` means one
 * thing when the injected endpoint must be named and a slightly different thing when either endpoint counts.
 * The corpus itself carries both answers — `ground_truth.service` has the set, the case's `injection.json` has
 * `display_config.injection_point.app_name` — but the run artifact carries neither, so the judgement could not
 * be moved after the fact and the run had to be repeated to ask a second question.
 *
 * A verdict file makes the judgement a POST-processing decision. It records what the engine answered and what
 * the corpus accepted, and nothing else: no score, no judgement, no derived count. A reader who wants strict,
 * loose, Top-3 or `MRR` computes it from the same file, and two engines' files are comparable row by row
 * because the fields are the corpus's own.
 *
 * ## Why JSONL and not one array
 *
 * A 1,422-case run can be interrupted, and an array is only readable if the closing bracket was written. One
 * line per case means a truncated file still holds every case that finished — the same reason the diagnostic
 * dumps are line-oriented.
 *
 * @module benchmarks/fse26-per-case
 */

import { readFileSync, writeFileSync } from 'node:fs';

/** How many ranked services a row carries. Five, because Top@5 is the deepest `At-K` this suite reports. */
export const PER_CASE_RANK_LIMIT = 5;

/** One case's answer beside the corpus's own label set. */
export interface PerCaseVerdict {
  /** The case directory's name, which is the corpus's stable id for the case. */
  readonly datapack: string;
  /** The corpus's fault type for the case (`unknown` when it declared none). */
  readonly faultType: string;
  /** The accepted services, in the corpus's order — the whole set, never truncated. */
  readonly accepted: readonly string[];
  /** The engine's ranking, best first, truncated to {@link PER_CASE_RANK_LIMIT}. */
  readonly ranked: readonly string[];
}

/**
 * Render one verdict as a single JSON line, **without** its newline.
 *
 * The fields are written in a fixed order (`datapack`, `faultType`, `accepted`, `ranked`) rather than via a
 * spread, so a diff between two runs is a diff of values and not of key insertion order.
 *
 * @param verdict - The case's answer and label set.
 * @returns The JSON text of one line.
 */
export function formatPerCaseVerdict(verdict: PerCaseVerdict): string {
  return JSON.stringify({
    datapack: verdict.datapack,
    faultType: verdict.faultType,
    accepted: [...verdict.accepted],
    ranked: verdict.ranked.slice(0, PER_CASE_RANK_LIMIT),
  });
}

/**
 * Write every verdict to `path`, one line each, replacing any file already there.
 *
 * Replacement rather than append is deliberate: a second run against the same path is a second measurement,
 * and appending would produce a file whose row count silently disagrees with the run that wrote it.
 *
 * @param path - Destination file. Its directory must already exist; creating one is the caller's decision.
 * @param verdicts - The rows, in scoring order.
 * @returns How many lines were written, so a caller can compare it with the cases it scored.
 */
export function writePerCaseVerdicts(path: string, verdicts: readonly PerCaseVerdict[]): number {
  const body = verdicts.map((verdict) => `${formatPerCaseVerdict(verdict)}\n`).join('');
  writeFileSync(path, body);
  return verdicts.length;
}

/** Refuses a string array that carries an empty or non-string entry. */
function stringsAt(value: unknown, field: string, line: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    throw new Error(`${field} on line ${line} is not an array of non-empty strings`);
  }
  return value as string[];
}

/**
 * Read a verdict file back.
 *
 * The reader exists because the format's own argument is that a judgement may be chosen AFTER a run: an artifact
 * only a human can read is an artifact whose judgement cannot be re-derived. Blank lines are skipped (a file that
 * ends with a newline is not an error); every other unrecognised shape is refused by line number, because a
 * silently-coerced row would be scored as a different case than the one the corpus states.
 *
 * @param text - The ndjson contents.
 * @returns One verdict per non-blank line, in file order.
 * @throws Error when a line is not a row this module would have written.
 */
export function parsePerCaseVerdicts(text: string): PerCaseVerdict[] {
  const verdicts: PerCaseVerdict[] = [];
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
    const row = raw as Record<string, unknown>;
    if (typeof row.datapack !== 'string' || row.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof row.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    verdicts.push({
      datapack: row.datapack,
      faultType: row.faultType,
      accepted: stringsAt(row.accepted, `accepted on line ${lineNumber}`, lineNumber),
      ranked: stringsAt(row.ranked, `ranked on line ${lineNumber}`, lineNumber),
    });
  }
  return verdicts;
}

/**
 * Read a verdict file from disk.
 *
 * @param path - The ndjson file.
 * @returns One verdict per case.
 */
export function readPerCaseVerdicts(path: string): PerCaseVerdict[] {
  return parsePerCaseVerdicts(readFileSync(path, 'utf8'));
}
