/**
 * CLI entry point for the surface comparison.
 *
 * Deliberately thin, for the reason every other CLI in this directory is: the reading, the refusals and the report
 * all live in `surface-diff.ts`, because this file runs at import time and a test cannot load it. What remains here
 * is file I/O and the fold map.
 *
 * The folds are handed over only when the caller names the answers file, because that file is where a case's fault
 * type lives. A comparison without it is still a comparison — it just cannot say whether the movement is positive in
 * both held-out folds, and the report says so by not printing a fold line at all.
 *
 * @module benchmarks/run-surface-diff
 */

import { readFileSync } from 'node:fs';

import {
  diffSurfaces,
  foldAssignment,
  formatSurfaceDiff,
  parseSurfaceLine,
  type SurfaceRow,
} from './surface-diff.js';

/** The flags this runner accepts. */
interface Args {
  readonly before: string;
  readonly after: string;
  readonly answers: string;
}

/** Read an ndjson file into parsed values, keeping the line number for a refusal. */
function readLines(path: string): unknown[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((one) => one.line !== '')
    .map((one) => {
      try {
        return JSON.parse(one.line) as unknown;
      } catch (error) {
        throw new Error(
          `surface-diff: ${path} line ${one.index + 1} is not JSON — ${String(error)}`,
        );
      }
    });
}

/** Read a surface file. */
function readSurface(path: string): SurfaceRow[] {
  return readLines(path).map((raw, index) => parseSurfaceLine(raw, index + 1));
}

/** Read the fault type of every case, keyed by id. */
function readFaultTypes(path: string): Map<string, string> {
  const types = new Map<string, string>();
  for (const raw of readLines(path)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const row = raw as Record<string, unknown>;
    const id = row['datapack'];
    const faultType = row['faultType'];
    if (typeof id !== 'string' || id === '') continue;
    types.set(id, typeof faultType === 'string' ? faultType : '');
  }
  return types;
}

/** Parse the flags. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const before = map.get('before') ?? '';
  const after = map.get('after') ?? '';
  if (before === '' || after === '') throw new Error('--before and --after are required');
  return { before, after, answers: map.get('answers') ?? '' };
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
    const diff = diffSurfaces(readSurface(args.before), readSurface(args.after));
    const fold = args.answers === '' ? undefined : foldAssignment(readFaultTypes(args.answers));
    process.stdout.write(`${formatSurfaceDiff(diff, fold)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
