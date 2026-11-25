/**
 * CLI entry point for the paired comparison of two arm artifacts.
 *
 * Thin for the reason every CLI in this directory is: the refusals, the statistics and the report live in
 * `arm-comparison.ts`, because this file runs at import time and a test cannot load it.
 *
 * The four inputs are not optional. A comparison that can be printed from two row files alone is a comparison that
 * never reads the record saying which two configurations it is comparing — which is exactly how a `gate contrast,
 * fallback engine, resolve edge-novel` artifact came to be compared with a bare arm and the difference published as
 * a 236-case model drift.
 *
 * @module benchmarks/run-arm-comparison
 */

import { readFileSync } from 'node:fs';

import {
  comparisonRefusal,
  formatComparison,
  pairedComparisonOf,
  type ArmRow,
} from './arm-comparison.js';
import type { RunMetadata } from './run-metadata.js';

/** The flags this runner accepts. */
interface Args {
  readonly first: string;
  readonly second: string;
  readonly firstMeta: string;
  readonly secondMeta: string;
  /** The `arms` keys the comparison is allowed to vary. Empty is a comparison of two identical configurations. */
  readonly axis: readonly string[];
  readonly firstLabel: string;
  readonly secondLabel: string;
}

/** Parse the flags. */
function parseArgs(argv: readonly string[]): Args {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    map.set(key.slice(2), argv[index + 1] ?? '');
  }
  const required = (name: string): string => {
    const value = map.get(name) ?? '';
    if (value === '') throw new Error(`--${name} is required`);
    return value;
  };
  const first = required('first');
  const second = required('second');
  return {
    first,
    second,
    firstMeta: required('first-meta'),
    secondMeta: required('second-meta'),
    axis: (map.get('axis') ?? '')
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== ''),
    firstLabel: map.get('first-label') ?? first,
    secondLabel: map.get('second-label') ?? second,
  };
}

/** Read an ndjson artifact as the two fields the comparison reads. */
function readRows(path: string): ArmRow[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, index) => {
      const row = JSON.parse(line) as { datapack?: string; correct?: boolean };
      if (typeof row.datapack !== 'string') {
        throw new Error(`${path} line ${String(index + 1)} carries no \`datapack\``);
      }
      return { datapack: row.datapack, correct: row.correct as boolean };
    });
}

/** Read a metadata record. */
function readMeta(path: string): RunMetadata {
  return JSON.parse(readFileSync(path, 'utf8')) as RunMetadata;
}

/**
 * Entry point.
 *
 * @param argv - Arguments after the script name.
 * @returns The process exit code: 0 for a printed comparison, 1 for a refusal.
 */
export function main(argv: readonly string[]): number {
  try {
    const args = parseArgs(argv);
    const refusal = comparisonRefusal(
      readMeta(args.firstMeta),
      readMeta(args.secondMeta),
      args.axis,
    );
    // The refusal is an exit code and not a warning: a table printed beside a warning is a table that gets quoted
    // without it, and this programme has now quoted one of those for three iterations.
    if (refusal !== null) throw new Error(refusal);
    const counts = pairedComparisonOf(readRows(args.first), readRows(args.second));
    process.stdout.write(`${formatComparison(args.firstLabel, args.secondLabel, counts)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
