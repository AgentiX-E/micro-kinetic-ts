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

import type {
  FailedEdgeMode,
  LogSignalMode,
  TopologyFaultGraphConfig,
} from '../../packages/tree/src/index.js';

import type { Fse26CliOptions } from './fse26-cli.js';

/** Ranking-signal options, consumed by the pruner's first constructor argument. */
export interface Fse26SignalOptions {
  readonly logWeight: number;
  readonly logSignalMode: LogSignalMode;
  /**
   * Failed-edge-direction weight. Carried as a required field with an explicit
   * default (0 = shipped/off) rather than an optional one: the engine's option
   * is optional so that `undefined` means disabled, but a PARTIAL passed through
   * here would be a silent no-op if the key were ever misspelled, and this file
   * exists precisely because a dropped option ran the control while the `Config:`
   * line reported the ablation.
   */
  readonly failedEdgeWeight: number;
  /**
   * Carried as a required field for the same reason as the weight above: a
   * PARTIAL passed through here would be a silent no-op if the key were ever
   * misspelled, and this file exists because a dropped option once ran the
   * control while the `Config:` line reported the ablation.
   */
  readonly failedEdgeMode: FailedEdgeMode;
  /** Required for the same reason as the two above: a silent no-op is the bug. */
  readonly failedEdgeMinRecords: number;
  /**
   * Weight of the per-edge LATENCY-rise signal. Required for the same reason as
   * the three above: a PARTIAL passed through here would be a silent no-op if
   * the key were ever misspelled.
   */
  readonly latWeight: number;
  /** Rise a service must clear before the latency term credits it (1 = shipped). */
  readonly latMinRise: number;
  /**
   * DB-connection-pool dominance penalty. Required for the same reason as the
   * weights above: a PARTIAL passed through here would be a silent no-op if the
   * key were ever misspelled.
   */
  readonly poolMetricPenaltyWeight: number;
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
    signals: {
      logWeight: opts.logWeight,
      logSignalMode: opts.logMode,
      failedEdgeWeight: opts.failedEdgeWeight,
      failedEdgeMode: opts.failedEdgeMode,
      failedEdgeMinRecords: opts.failedEdgeMinRecords,
      latWeight: opts.latWeight,
      latMinRise: opts.latMinRise,
      poolMetricPenaltyWeight: opts.poolMetricPenaltyWeight,
    },
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
