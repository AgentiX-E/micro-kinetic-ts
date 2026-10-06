/**
 * The ablation runner's engine arguments, and the configuration line its artifact carries.
 *
 * ## Why this exists
 *
 * This is the repository's THIRD engine construction site — `run-fse26.ts`, `run-rcaeval.ts` and this one
 * — and the first two were each extracted for the same reason, recorded in
 * `fse26-engine-options.ts` and `rcaeval-engine-options.ts`: a runner that calls `main()` at import time
 * cannot be imported, so neither its option assembly nor the line that records it can be called by a test.
 * Here the cost was visible in the ARTIFACT rather than in the code: `ablation-re1-results` printed
 * `Running: BASELINE (all OFF)` and a JSON record of twelve BOOLEANS, and **not one weight**.
 *
 * That artifact is the register's ablation reference, and a reader could not reconstruct a single run from
 * it:
 *
 * - the flags are the ablation's INPUTS; the run is decided by the numbers they map to
 *   (`flags.logSignal ? 1.0 : 0.0`), and that mapping lived only in the runner's source;
 * - six weights were not named by the flags OR the artifact, because the construction site simply did not
 *   pass them — `latWeight`, `latMinRise`, `poolMetricPenaltyWeight`, `stabilityWeight`, `temporalWeight`
 *   and `onsetShape` fell through to `DEFAULT_TREE_PRUNER_OPTIONS`;
 * - so the row labelled **`BASELINE (all OFF)`** ran with the four terms that dominate the shipped ranking
 *   ON. The label asserted a configuration the run did not have.
 *
 * ## What the repair does, and does not, change
 *
 * The six inherited terms are now passed EXPLICITLY, read from the engine's own constants. Their values are
 * byte-identical to the defaults they were already receiving, so no number in the artifact may move — the
 * change is that the artifact can now SAY them. The flags keep their meaning, the base row keeps its
 * measurements, and the label is corrected because a label is a claim.
 *
 * The line is rendered with the same `signals: name=value …` shape the golden half's artifact carries, so
 * one reader covers both artifacts: the ablation's reference and the configuration it was measured against
 * are then comparable by eye, which they were not.
 *
 * @module benchmarks/ablation-engine-options
 */

import type { LogSignalMode, OnsetShape } from '../../packages/tree/src/index.js';
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_LOG_SIGNAL_MODE,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  DEFAULT_TEMPORAL_WEIGHT,
} from '../../packages/tree/src/index.js';

/**
 * The features this study switches, one boolean each.
 *
 * These are the ablation's INPUTS and they are recorded as such: the `Flags:` line the artifact carries
 * keeps naming them, because the study's design is the flags. What was missing is the CONFIGURATION they
 * produce, which is what {@link formatAblationConfigLine} now states.
 */
export interface AblationFeatureFlags {
  /** Collision tree aggregator with Boltzmann Q(f,f). */
  collisionAggregation: boolean;
  /** Trace topology augmentation. */
  traceAugmentation: boolean;
  /** Online weight calibration (self-evolving). */
  selfLearning: boolean;
  /** Log signal: reward post-injection ERROR/FATAL volume (logWeight). */
  logSignal: boolean;
  /** Topological-source signal: reward no-anomalous-parent nodes (topoWeight). */
  topoSignal: boolean;
  /** Collision-energy signal: penalise upstream-inherited energy (collisionWeight). */
  collisionSignal: boolean;
  /** Direction-aware deviation: discount the DROP component (collapseDiscount). */
  collapseDiscount: boolean;
  /** Metric-direction signal: reward source RISE, penalise symptom COLLAPSE (riseWeight). */
  riseSignal: boolean;
  /** Trace span-activity rise signal: reward the service whose spans rise post-injection. */
  traceSignal: boolean;
  /** Rank-based anomaly-score normalization on large topologies (≥ 20 nodes). */
  rankNormalization: boolean;
  /** Extend the transient guard to idle-start transients (near-zero-baseline latency spike). */
  suppressIdleTransients: boolean;
  /** PRISM graph-free signal: reward the node anomalous in BOTH internal and external channels. */
  prismSignal: boolean;
}

/**
 * The first constructor argument: `Partial<TreePrunerOptions>`.
 *
 * The seven fields the study VARIES come first, then the seven it holds at the shipped value. The second
 * group exists because leaving them out is what made the artifact unreadable: an option that is not passed
 * is not absent from the run, it is INHERITED, and the artifact had no way to say either.
 */
export interface AblationSignalOptions {
  readonly enableCollisionAggregation: boolean;
  readonly collisionWeight: number;
  readonly topoWeight: number;
  readonly logWeight: number;
  readonly riseWeight: number;
  readonly traceWeight: number;
  readonly prismWeight: number;
  readonly logSignalMode: LogSignalMode;
  readonly latWeight: number;
  readonly latMinRise: number;
  readonly poolMetricPenaltyWeight: number;
  readonly stabilityWeight: number;
  readonly temporalWeight: number;
  readonly onsetShape: OnsetShape;
}

/** The second constructor argument: `Partial<TopologyFaultGraphConfig>`. */
export interface AblationTopologyOptions {
  readonly collapseDiscount: number;
  readonly rankNormalization: boolean;
  readonly suppressIdleTransients: boolean;
}

/** The engine's two constructor arguments, named so a test can assert both. */
export interface AblationEngineOptions {
  readonly signals: AblationSignalOptions;
  readonly topology: AblationTopologyOptions;
}

/**
 * Build BOTH of the engine's constructor arguments for one ablation configuration.
 *
 * @param flags - The configuration's feature flags.
 * @param prismWeightOverride - The PRISM sweep's weight, when this config is a sweep point.
 * @returns `signals` and `topology`.
 */
export function buildAblationEngineOptions(
  flags: AblationFeatureFlags,
  prismWeightOverride?: number,
): AblationEngineOptions {
  return {
    signals: {
      enableCollisionAggregation: flags.collisionAggregation,
      collisionWeight: flags.collisionSignal ? 1.0 : 0.0,
      topoWeight: flags.topoSignal ? 1.0 : 0.0,
      logWeight: flags.logSignal ? 1.0 : 0.0,
      riseWeight: flags.riseSignal ? 1.0 : 0.0,
      traceWeight: flags.traceSignal ? 1.0 : 0.0,
      prismWeight: prismWeightOverride ?? (flags.prismSignal ? 1.0 : 0.0),
      // The seven the study holds at the shipped value, named from their owners so the artifact can state
      // them. Passing them is value-identical to inheriting them, and that is the point: an inherited
      // option is a configuration the artifact used to be unable to describe.
      logSignalMode: DEFAULT_LOG_SIGNAL_MODE,
      latWeight: DEFAULT_LAT_WEIGHT,
      latMinRise: DEFAULT_LAT_MIN_RISE,
      poolMetricPenaltyWeight: DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
      stabilityWeight: DEFAULT_STABILITY_WEIGHT,
      temporalWeight: DEFAULT_TEMPORAL_WEIGHT,
      onsetShape: DEFAULT_ONSET_SHAPE,
    },
    topology: {
      collapseDiscount: flags.collapseDiscount ? 1.0 : 0.0,
      rankNormalization: flags.rankNormalization,
      suppressIdleTransients: flags.suppressIdleTransients,
    },
  };
}

/**
 * The configuration, as one line, in the shape the golden half's artifact uses.
 *
 * @param flags - The configuration's feature flags.
 * @param prismWeightOverride - The PRISM sweep's weight, when this config is a sweep point.
 * @returns One line naming every field of both constructor arguments.
 */
export function formatAblationConfigLine(
  flags: AblationFeatureFlags,
  prismWeightOverride?: number,
): string {
  const { signals, topology } = buildAblationEngineOptions(flags, prismWeightOverride);
  // Every name here is the ENGINE's option name, not the study's flag name: the artifact has to be
  // joinable against the source it describes, and the fence holds it to exactly that. `collisionAggregation`
  // is the flag; `enableCollisionAggregation` is the option it sets.
  return (
    `signals: enableCollisionAggregation=${signals.enableCollisionAggregation} ` +
    `collisionWeight=${signals.collisionWeight} topoWeight=${signals.topoWeight} ` +
    `logWeight=${signals.logWeight} logSignalMode=${signals.logSignalMode} ` +
    `riseWeight=${signals.riseWeight} traceWeight=${signals.traceWeight} ` +
    `prismWeight=${signals.prismWeight} latWeight=${signals.latWeight} ` +
    `latMinRise=${signals.latMinRise} poolMetricPenaltyWeight=${signals.poolMetricPenaltyWeight} ` +
    `stabilityWeight=${signals.stabilityWeight} collapseDiscount=${topology.collapseDiscount} ` +
    `rankNormalization=${topology.rankNormalization} ` +
    `suppressIdleTransients=${topology.suppressIdleTransients} ` +
    `temporalWeight=${signals.temporalWeight} onsetShape=${signals.onsetShape}`
  );
}
