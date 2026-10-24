/**
 * CLI entry point for the metric-family ablation.
 *
 * Deliberately thin, for the reason every other CLI in this directory is: the parsing, the fidelity
 * control and the table all live in `rcaeval-metric-ablation.ts`, because this file calls `main()` at
 * import time and a test cannot load it. What remains here is file I/O.
 *
 * @module benchmarks/ablate-rcaeval-dump
 */

import { readFileSync } from 'node:fs';

import { parseAblationArgs, runAblation } from './rcaeval-metric-ablation.js';

/**
 * Read the dump named on the command line and print the ablation.
 *
 * @param argv - Arguments after the script name.
 * @returns The process exit code.
 */
export function main(argv: readonly string[]): number {
  try {
    const opts = parseAblationArgs(argv);
    process.stdout.write(`${runAblation(readFileSync(opts.dump, 'utf8'))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

process.exit(main(process.argv.slice(2)));
