/**
 * CLI entry point for the schedule reading.
 *
 * Thin on purpose, for the reason every other CLI in this directory is: the reading, the refusals and the report live
 * in `investigation-schedule.ts`, because this file runs at import time and a test cannot load it. What remains is
 * file I/O and the one ordering decision the artifact forces — the term dump carries every candidate WITH its score,
 * so the engine's order is a descending sort here rather than a column read anywhere.
 *
 * The tie-break is the producer's own order and not the id, because a stable sort of the dump reproduces the ranking
 * the engine published; sorting on the id as well would silently re-rank every tie and every reading would then be a
 * statement about this file instead of about the engine.
 *
 * @module benchmarks/run-schedule-reading
 */

import { readFileSync } from 'node:fs';

import {
  conversionOf,
  formatConversion,
  formatScheduleReading,
  SCHEDULE_WIDTH,
  scheduleReadingOf,
  type ScheduledCase,
} from './investigation-schedule.js';
import { formatReachDecomposition, reachDecompositionOf } from './reach-decomposition.js';

/** The flags this runner accepts. */
interface Args {
  readonly answers: string;
  readonly terms: string;
  readonly surface: string;
  readonly width: number;
  /** The cutoff the retrieval split is taken at, or `null` when it is not asked for. */
  readonly splitAt: number | null;
}

/** Read an ndjson file into parsed objects, keeping the line number for a refusal. */
function readRows(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((one) => one.line !== '')
    .map((one) => {
      try {
        return JSON.parse(one.line) as unknown;
      } catch (error) {
        throw new Error(`schedule: ${path} line ${one.index + 1} is not JSON — ${String(error)}`);
      }
    })
    .map((raw) => {
      if (typeof raw !== 'object' || raw === null) {
        throw new Error(`schedule: ${path} carries a row that is not an object`);
      }
      return raw as Record<string, unknown>;
    });
}

/** A string field, or the empty string when the artifact does not carry it. */
function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : '';
}

/** A string list, refusing anything that is neither a list of strings nor absent. */
function names(row: Record<string, unknown>, key: string, source: string): string[] {
  const value = row[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`schedule: ${source} carries a non-list \`${key}\``);
  return value.filter((one): one is string => typeof one === 'string');
}

/** The engine's order per case, read off the term dump's scores. */
function readOrders(path: string): Map<string, string[]> {
  const orders = new Map<string, string[]>();
  for (const row of readRows(path)) {
    const id = text(row, 'datapack');
    if (id === '') continue;
    const candidates = row['candidates'];
    if (!Array.isArray(candidates)) continue;
    const scored: { id: string; score: number }[] = [];
    for (const one of candidates) {
      if (typeof one !== 'object' || one === null) continue;
      const entry = one as Record<string, unknown>;
      const name = entry['id'];
      const score = entry['score'];
      if (typeof name !== 'string' || name === '') continue;
      if (typeof score !== 'number' || !Number.isFinite(score)) continue;
      scored.push({ id: name, score });
    }
    // A stable sort on the score alone, so a tie keeps the producer's order.
    orders.set(
      id,
      scored.sort((a, b) => b.score - a.score).map((one) => one.id),
    );
  }
  return orders;
}

/** The published verdict per case, or `null` when no surface file was named. */
function readVerdicts(path: string): Map<string, boolean> | null {
  if (path === '') return null;
  const verdicts = new Map<string, boolean>();
  for (const row of readRows(path)) {
    const id = text(row, 'datapack');
    const correct = row['correct'];
    if (id === '' || typeof correct !== 'boolean') continue;
    verdicts.set(id, correct);
  }
  return verdicts;
}

/** Parse the flags. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const answers = map.get('answers') ?? '';
  const terms = map.get('terms') ?? '';
  if (answers === '' || terms === '') throw new Error('--answers and --terms are required');
  const raw = map.get('width') ?? '';
  const width = raw === '' ? SCHEDULE_WIDTH : Number(raw);
  if (!Number.isInteger(width) || width < 0)
    throw new Error(`--width must be a non-negative integer`);
  // The retrieval split is a SECOND reading and is asked for by name: a default cutoff would print a table nobody
  // requested and invite it to be quoted as the schedule's, which is the confusion this runner exists to prevent.
  const rawSplit = map.get('split-at') ?? '';
  const splitAt = rawSplit === '' ? null : Number(rawSplit);
  if (splitAt !== null && (!Number.isInteger(splitAt) || splitAt < 1)) {
    throw new Error('--split-at must be a positive integer');
  }
  return { answers, terms, surface: map.get('surface') ?? '', width, splitAt };
}

/**
 * Join the artifacts into the population the reading is over.
 *
 * A case missing from the term dump is skipped rather than defaulted to an empty order: an empty order would report
 * every one of its misses as a pool failure, which is a claim about the corpus made from a missing file.
 *
 * @param args - The parsed flags.
 * @returns The population, and how many rows the term dump could not describe.
 */
function populationOf(args: Args): { cases: ScheduledCase[]; skipped: number } {
  const orders = readOrders(args.terms);
  const verdicts = readVerdicts(args.surface);
  const cases: ScheduledCase[] = [];
  let skipped = 0;
  for (const row of readRows(args.answers)) {
    const id = text(row, 'datapack');
    if (id === '') continue;
    const order = orders.get(id);
    if (order === undefined) {
      skipped += 1;
      continue;
    }
    const correct = verdicts === null ? row['correct'] === true : verdicts.get(id);
    if (correct === undefined) {
      skipped += 1;
      continue;
    }
    const calls = row['calls'];
    cases.push({
      datapack: id,
      truth: names(row, 'truth', id),
      order,
      correct,
      calls: Array.isArray(calls) ? names(row, 'calls', id) : null,
    });
  }
  return { cases, skipped };
}

/**
 * Entry point.
 *
 * @param argv - Arguments after the script name.
 * @returns The process exit code.
 */
export function main(argv: readonly string[]): number {
  try {
    const args = parseArgs(argv);
    const { cases, skipped } = populationOf(args);
    const reading = scheduleReadingOf(cases, args.width);
    process.stdout.write(`${formatScheduleReading(reading)}\n`);
    process.stdout.write(`${formatConversion(reading, conversionOf(reading))}\n`);
    if (args.splitAt !== null) {
      process.stdout.write(
        `${formatReachDecomposition(reachDecompositionOf(cases, args.splitAt), args.splitAt)}\n`,
      );
    }
    if (skipped > 0) {
      process.stdout.write(
        `  ${String(skipped)} rows were not in the term dump and are excluded\n`,
      );
    }
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
