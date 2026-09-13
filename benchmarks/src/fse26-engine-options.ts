/**
 * Map parsed command-line options onto the engine's constructor arguments.
 *
 * This lived inside `run-fse26.ts`'s `main()`, which calls itself on import and
 * therefore cannot be called from a test — so nothing could check that an option
 * reached the engine. That gap is not hypothetical for this file's neighbours: a
 * dispatch input that the workflow accepted and the runner dropped would run the
 * CONTROL while the `Config:` line reported the ablation, and the run would
 * "prove" the ablation changes nothing. `dropMetrics` had no test at all, and
 * `logMode` was once hardcoded in the workflow so the published number was 24.2pp
 * below the best-measured one.
 *
 * Extracting the mapping makes both halves checkable: {@link
 * buildFse26EngineOptions} returns the exact objects the constructor receives,
 * and {@link NON_ENGINE_OPTION_KEYS} names the options that are deliberately not
 * forwarded — so a NEW option fails the completeness test until it is classified
 * as one or the other.
 *
 * @module benchmarks/fse26-engine-options
 */

import type { LogSignalMode, TopologyFaultGraphConfig } from '../../packages/tree/src/index.js';

import type { Fse26CliOptions } from './fse26-cli.js';

/** Ranking-signal options, consumed by the pruner's first constructor argument. */
export interface Fse26SignalOptions {
  readonly logWeight: number;
  readonly logSignalMode: LogSignalMode;
}

/** The two constructor arguments, named so a test can assert both. */
export interface Fse26EngineOptions {
  readonly signals: Fse26SignalOptions;
  readonly topology: Partial<TopologyFaultGraphConfig>;
}

/**
 * Parsed options that must NOT reach the engine.
 *
 * `dropMetrics` is applied at LOAD time — the bridge filters the named series out
 * of each case before scoring, so it changes the input rather than the engine.
 * The rest are run harness concerns: where the data is, how many cases to take,
 * where to write the artifact, and which fault types to dump a diagnostic for.
 */
export const NON_ENGINE_OPTION_KEYS = [
  'dataDir',
  'maxCases',
  'output',
  'diagnose',
  'diagnoseLimit',
  'dropMetrics',
] as const;

/**
 * Build the engine's constructor arguments from parsed options.
 *
 * @param opts - Parsed command-line options.
 * @returns The signal options and the topology config the engine is built with.
 */
export function buildFse26EngineOptions(opts: Fse26CliOptions): Fse26EngineOptions {
  return {
    signals: { logWeight: opts.logWeight, logSignalMode: opts.logMode },
    topology: {
      // Load-bearing on Train Ticket's large topologies.
      rankNormalization: opts.rankNormalization,
      // Ablation switches; both are bit-identical to the shipped scoring when
      // they are at their defaults.
      metricRiseCeiling: opts.metricRiseCeiling,
      metricFleetBaseline: opts.metricFleetBaseline,
    },
  };
}
