/**
 * Argument parsing for the FSE'26 benchmark runner.
 *
 * Extracted from `run-fse26.ts` so it can be tested: that file calls `main()` at
 * import time and therefore cannot be imported by a test, which is how the
 * `--log-mode` defect below survived review.
 *
 * ## Why the accepted modes are an exhaustive object rather than a list
 *
 * `--log-mode` used to be validated against a hand-written `||` chain. When the
 * default was flipped to the best-measured mode, that chain was rewritten and
 * **`count` was left out** — so `--log-mode count` matched nothing and fell back
 * to `logicHttp`. The `count` configuration became unreachable through the
 * workflow, and silently: a dispatch asking for `count` ran `logicHttp` and
 * printed a confident 47.3%. Two diagnostics dispatched to compare the two modes
 * came back byte-identical, which is what exposed it.
 *
 * A list of names cannot be checked against a union. `LOG_MODE_ACCEPTED` is a
 * `Record<LogSignalMode, true>` instead, so **adding a member to the union fails
 * to compile until it is added here**, and the fallback is reserved for values
 * that are genuinely not modes.
 *
 * @module benchmarks/fse26-cli
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type { LogSignalMode } from '../../packages/tree/src/index.js';

/**
 * The log-signal mode the benchmark reports.
 *
 * Measured, not guessed. Full 1422-case runs on one commit and one
 * provenance-verified cache:
 *
 *     logicHttp  Top@1 47.3% (673/1422)  — run 34604105028
 *     count      Top@1 23.1% (328/1422)  — run 34604119657
 *
 * The +24.2pp gain comes from the replace-code / replace-method / replace-path /
 * delay / abort classes, whose faulting service floods a propagated framework
 * HTTP error that the logic-exception-only gate discards. `Network*` and
 * `JVMException` do regress under it, but the net is strongly positive and
 * clears the published SOTA best of 37.0%, so this is the configuration that
 * gets reported.
 */
export const DEFAULT_FSE26_LOG_MODE: LogSignalMode = 'logicHttp';

/**
 * Every log-signal mode, as a `Record` over the union.
 *
 * Exhaustive by construction: a new member of `LogSignalMode` is a compile error
 * here until it is listed. The value is unused; the keys are the point.
 */
const LOG_MODE_ACCEPTED: Readonly<Record<LogSignalMode, true>> = {
  count: true,
  novelty: true,
  logicHttp: true,
  logicHttpJoint: true,
  logicHttpDominant: true,
  all: true,
};

/** Whether a raw argument names a log-signal mode. */
export function isLogSignalMode(value: string): value is LogSignalMode {
  return Object.prototype.hasOwnProperty.call(LOG_MODE_ACCEPTED, value);
}

/** Parsed command-line options for one benchmark run. */
export interface Fse26CliOptions {
  readonly dataDir: string;
  readonly maxCases: number;
  /** Strength of the log signal (self-caused logic-exception volume). */
  readonly logWeight: number;
  readonly logMode: LogSignalMode;
  /** Rank-based anomaly-score normalization on large topologies (≥ 20 nodes). */
  readonly rankNormalization: boolean;
  /** Emit a JSON result document to this path (empty = none). */
  readonly output: string;
  /** Fault types to dump a per-service signal diagnostic for (empty = none). */
  readonly diagnose: readonly string[];
  /** Max diagnostic dumps per matching fault type (0 = unlimited). */
  readonly diagnoseLimit: number;
  /**
   * Metric names to filter out of every case before scoring (empty = none).
   * Component-ablation switch: the bridge merges four metric sources into one
   * map, so removing a source's names here re-scores the same cases as if the
   * bridge had never emitted that source — without rebuilding the cache.
   */
  readonly dropMetrics: readonly string[];
}

/** Split a comma-separated flag value, dropping empty entries. */
function csv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse the runner's arguments.
 *
 * An UNRECOGNISED mode is never downgraded to a *different* configuration: it
 * falls back to {@link DEFAULT_FSE26_LOG_MODE}, so a typo reports the default
 * rather than an unmeasured mode. A RECOGNISED mode always takes effect — see
 * the module note for what happens when it does not.
 *
 * @param argv - Arguments after the script name (`process.argv.slice(2)`).
 * @returns The options, with every default applied.
 */
export function parseFSE26Args(argv: readonly string[]): Fse26CliOptions {
  const opts = {
    dataDir: join(homedir(), 'RCABench-json'),
    maxCases: 0,
    logWeight: 1.0,
    logMode: DEFAULT_FSE26_LOG_MODE as LogSignalMode,
    rankNormalization: true,
    output: '',
    diagnose: [] as string[],
    diagnoseLimit: 3,
    dropMetrics: [] as string[],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--data-dir' && i + 1 < argv.length) opts.dataDir = argv[++i]!;
    else if (arg === '--max-cases' && i + 1 < argv.length)
      opts.maxCases = parseInt(argv[++i]!, 10) || 0;
    else if (arg === '--log-weight' && i + 1 < argv.length)
      opts.logWeight = parseFloat(argv[++i]!) || 0;
    else if (arg === '--log-mode' && i + 1 < argv.length) {
      const mode = argv[++i]!;
      opts.logMode = isLogSignalMode(mode) ? mode : DEFAULT_FSE26_LOG_MODE;
    } else if (arg === '--no-rank-normalization') opts.rankNormalization = false;
    else if (arg === '--output' && i + 1 < argv.length) opts.output = argv[++i]!;
    else if (arg === '--diagnose' && i + 1 < argv.length) opts.diagnose = csv(argv[++i]!);
    else if (arg === '--diagnose-limit' && i + 1 < argv.length)
      opts.diagnoseLimit = parseInt(argv[++i]!, 10) || 0;
    else if (arg === '--drop-metrics' && i + 1 < argv.length) opts.dropMetrics = csv(argv[++i]!);
  }

  return opts;
}
