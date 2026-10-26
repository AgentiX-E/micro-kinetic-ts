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
  OnsetShape,
  PrismPooling,
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
  /** Weight on the decisive-stability prior. Required for the same reason as the pool penalty. */
  readonly stabilityWeight: number;
  /**
   * Weight on the SELF-TIME prior. Required for the same reason as the pool penalty: a PARTIAL
   * passed through here would be a silent no-op if the key were ever misspelled, and the term's
   * shipped value is 0, which is exactly the value a silent no-op produces.
   */
  readonly selfTimeWeight: number;
  /** Weight on the internal/external symmetry mask. Required for the same reason as the pool penalty. */
  readonly victimWeight: number;
  /**
   * Weight of the injection-anchored temporal prior. Required for the same reason as
   * every weight above: a PARTIAL passed through here would be a silent no-op if the
   * key were ever misspelled, and this file exists precisely because a dropped option
   * ran the control while the `Config:` line reported the ablation.
   */
  readonly temporalWeight: number;
  /**
   * Which shape the temporal prior reads the onset delays in.
   *
   * Not a weight, so it cannot be omitted-when-default: it is forwarded unconditionally,
   * and it is inert while `temporalWeight` is 0 — which is exactly why the shape is
   * `runner`-owned and can be flipped without a second measured configuration.
   */
  readonly onsetShape: OnsetShape;
  /**
   * The five knobs the mirror of iteration 96 added, all required for the reason every field above is:
   * a PARTIAL passed through here would be a silent no-op if a key were ever misspelled, which is the
   * defect this file exists for.
   *
   * They are grouped rather than each carrying its own measurement, because their measurements live on the
   * surfaces the census sends a reader to (`KNOBS`' `owner` field per knob), and a second copy of a number
   * here is how this repo published one 24.2pp off the best-measured value.
   */
  readonly traceWeight: number;
  readonly topoWeight: number;
  readonly collisionWeight: number;
  readonly prismWeight: number;
  readonly prismPooling: PrismPooling;
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
 * where to write the artifact, which fault types to dump a diagnostic for, and
 * at what precision that diagnostic renders its per-service fields — the last
 * being a property of the written ARTIFACT that a reader derives its error bar
 * from, and of nothing the engine computes.
 */
export const NON_ENGINE_OPTION_KEYS = [
  'dataDir',
  'maxCases',
  'output',
  'diagnose',
  'diagnoseLimit',
  'diagnoseDecimals',
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
      stabilityWeight: opts.stabilityWeight,
      selfTimeWeight: opts.selfTimeWeight,
      victimWeight: opts.victimWeight,
      temporalWeight: opts.temporalWeight,
      onsetShape: opts.onsetShape,
      // The five the golden half could state alone until `docs/dispatch-surface-audit.md`'s Finding 6
      // registered the mirror. They belong in THIS object and not in `topology` below for the reason that
      // document's own split records: these are consumed by the pruner's first constructor argument, and a
      // value placed in the wrong object is a silent no-op rather than an error.
      traceWeight: opts.traceWeight,
      topoWeight: opts.topoWeight,
      collisionWeight: opts.collisionWeight,
      prismWeight: opts.prismWeight,
      prismPooling: opts.prismPooling,
    },
    topology: {
      // Load-bearing on Train Ticket's large topologies.
      rankNormalization: opts.rankNormalization,
      // …and the node count that decides which topologies count as large. Named on the artifact for the same
      // reason: this corpus is the large-graph one, so the flag above acts on nearly every case here, and a
      // reader cannot tell that from the boolean alone.
      anomalyNormalizeNodeThreshold: opts.anomalyNormalizeNodeThreshold,
      // Ablation switches; both are bit-identical to the shipped scoring when
      // they are at their defaults.
      metricRiseCeiling: opts.metricRiseCeiling,
      metricFleetBaseline: opts.metricFleetBaseline,
      // …and the three that belong to the FAULT GRAPH rather than to the ranking fusion: the drop-half
      // discount and the two suppression switches. They are forwarded unconditionally rather than
      // omitted-when-default, which is this object's difference from the rendered line: the line may omit a
      // default because its own rule makes the omission readable, while a PARTIAL here with a key left out
      // would be a silent revert to the engine's default with nothing failing.
      collapseDiscount: opts.collapseDiscount,
      anomalyTrendWeight: opts.anomalyTrendWeight,
      anomalyBurstWeight: opts.anomalyBurstWeight,
      anomalyCvWeight: opts.anomalyCvWeight,
      anomalyBreadthWeight: opts.anomalyBreadthWeight,
      anomalyBreadthGate: opts.anomalyBreadthGate,
      suppressIdleTransients: opts.suppressIdleTransients,
      suppressNearZeroBaselineRise: opts.suppressNearZeroBaselineRise,
      suppressZeroBaselineLatency: opts.suppressZeroBaselineLatency,
      capTrendBonusAtDeviation: opts.capTrendBonusAtDeviation,
      suppressDemandMetrics: opts.suppressDemandMetrics,
    },
  };
}
