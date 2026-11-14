/**
 * `run-agentic-eliminator` — the command that runs one elimination study.
 *
 * The study itself is `agentic-eliminator-study.ts`: argv parsing, the join, the proposal, the replay and the table.
 * This file is the entry point, and it exists as its own file for one reason — an entry point cannot be measured by
 * a test that imports it, because the guard that runs the study only fires when the file IS the process's script.
 * Splitting the two is what lets the arithmetic be gated at 100 % while the two lines that launch it stay two lines.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-agentic-eliminator.ts \
 *     --fingerprints <ndjson> --verdicts <ndjson> [--claims <ndjson>] [--propose] \
 *     [--weight W] [--model NAME] [--concurrency N] [--limit N] [--max-candidates K] [--delta D]
 *
 * @module benchmarks/run-agentic-eliminator
 */

import { pathToFileURL } from 'node:url';

import { runStudy } from './agentic-eliminator-study.js';

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // A thrown error is the study's own refusal — a malformed claims file, an unreadable artifact — and it belongs on
  // stderr with a non-zero exit rather than as an unhandled rejection after a stack of progress lines.
  runStudy(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
