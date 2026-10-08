/**
 * Integration bridge: wire RCAConfiguration into the RCA pipeline.
 *
 * Provides factory functions that create configured engine instances
 * without modifying existing package internals.  The TreePruner
 * constructor already accepts partial TreePrunerOptions — we map
 * RCAConfiguration's fields onto those options.
 *
 * This keeps the optimize package decoupled from the tree/kinetic
 * packages: only this single file imports from them.
 */

import type { TreePrunerOptions } from '@agentix-e/micro-kinetic-tree';
import {
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
  DEFAULT_ONSET_SHAPE,
  DEFAULT_POOL_METRIC_PENALTY_WEIGHT,
  DEFAULT_STABILITY_WEIGHT,
  TreePruner,
} from '@agentix-e/micro-kinetic-tree';
import type { RCAConfiguration } from './config-space.js';
import { DEFAULT_CONFIG } from './config-space.js';

/**
 * The `TreePrunerOptions` fields {@link configToPrunerOptions} does NOT set, each with the reason.
 *
 * A field that a mapping does not set is not absent from the run — it INHERITS the engine's default — and
 * this record is what turns that inheritance from invisible into stated. It exists because of what its
 * absence cost: the L2 weight search builds its engine through this mapping, and its artifact reported
 * *"baseline (default weights)"* and *"tuned weights: source=… log=1.00 …"* — seven of the twenty-seven
 * options the engine was actually constructed with. A reader could not tell that `latWeight`,
 * `latMinRise`, `poolMetricPenaltyWeight` and `stabilityWeight` — the four terms that dominate the shipped
 * ranking — were ON in that search, inherited, and outside its search space.
 *
 * `Record` rather than a list, for the reason `OPERATIONAL_OPTIONS` is not a list: "deliberately not
 * searched" and "forgotten" are the same shape in a set, and the reason is the only thing that separates
 * them. The guard asserts the exact key set, so a field that starts being mapped — or stops — has to be
 * moved here on purpose.
 */
export const HELD_AT_ENGINE_DEFAULT: Readonly<Record<string, string>> = {
  defaultTopK: 'pruning breadth; the search space does not carry it',
  maxPropagationDepth: 'pruning depth; the search space does not carry it',
  decayBeta: 'the second decay exponent; only decayAlpha is a search axis',
  useTwoHopDecay: 'a propagation shape the search space does not carry',
  maxCycles: 'a cycle-solver bound, not a ranking decision',
  onsetShape: 'the temporal shape; the search tunes temporalWeight, not its shape',
  logSignalMode: 'which log lines count; the search tunes the log WEIGHT only',
  edgeLatency: 'whether the latency term reads per-edge durations at all',
  latWeight:
    'the largest shipped ranking weight, solved by an FSE-26 screen and held OUT of this search space',
  latMinRise:
    'the latency term\u2019s rise floor; measured as a PAIR with latWeight, so never searched alone',
  poolMetricPenaltyWeight: 'the pool penalty, solved outside this search space',
  prismPooling:
    'which of PRISM\u2019s two combination functions its signal uses; the search tunes the PRISM WEIGHT only, and the pooling is a per-context CHOICE rather than a weight',
  stabilityWeight: 'the decisive-stability prior, solved outside this search space',
  failedEdgeWeight: 'ships at 0, so the direction term is off for every run this mapping builds',
  failedEdgeMode: 'meaningless without a weight to aggregate (see failedEdgeWeight)',
  failedEdgeMinRecords: 'meaningless without a weight to threshold (see failedEdgeWeight)',
};

/**
 * The engine's SECOND constructor argument, which {@link createEngineWithConfig} does not pass at all.
 *
 * `TreePruner(options, topologyConfig)` takes two, and this mapping supplies one, so the fault graph is
 * built with ITS OWN defaults.
 *
 * **That used to be a mismatch and is no longer one.** When this constant was added, the engine's default for
 * `rankNormalization` was `false` while the golden set `true` from its parser's default — so the search and
 * the published numbers were different configurations in an axis this repository keeps ON, and nothing in
 * either artifact said so. Iteration 52 made the ENGINE's default the shipped value
 * (`DEFAULT_RANK_NORMALIZATION`), which is what it should always have been: a caller who passes nothing now
 * gets the configuration the published numbers were measured under. The flag is inert below
 * `ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes, so the correction moves small topologies not at all.
 *
 * The constant stays, with the field it names, because the FACT is still true and still worth stating: this
 * path supplies one argument, so every topology option it does not name is the engine's default, and a
 * reader of the search's artifact should be able to see that rather than infer it.
 */
export const UNPASSED_SECOND_ARGUMENT = true;

/** The held fields {@link formatEngineConfigLine} names by value; the rest it refers to by record. */
const HELD_PRINTED: readonly string[] = [
  'latWeight',
  'latMinRise',
  'poolMetricPenaltyWeight',
  'stabilityWeight',
  'onsetShape',
];

/**
 * Map an RCAConfiguration to TreePrunerOptions.
 * Returns DEFAULT_TREE_PRUNER_OPTIONS overridden by config values.
 *
 * Every field it does not return is named in {@link HELD_AT_ENGINE_DEFAULT}: the mapping's coverage of the
 * engine's option surface is the union of the two, and the guard asserts that partition rather than trusting
 * this comment.
 */
export function configToPrunerOptions(config: RCAConfiguration): Partial<TreePrunerOptions> {
  return {
    decayAlpha: config.continuous.decayAlpha,
    pruneEpsilon: config.continuous.pruneEpsilon,
    enableCollisionAggregation: config.discrete.enableCollisionAggregation,
    criticalLoadThreshold: 0.7,
    // Ranking fusion weights — the L2 optimizer tunes these directly.
    sourceWeight: config.ranking.sourceWeight,
    temporalWeight: config.ranking.temporalWeight,
    collisionWeight: config.ranking.collisionWeight,
    topoWeight: config.ranking.topoWeight,
    logWeight: config.ranking.logWeight,
    riseWeight: config.ranking.riseWeight ?? 0,
    traceWeight: config.ranking.traceWeight ?? 0,
    prismWeight: config.ranking.prismWeight ?? 0,
  };
}

/**
 * Create a TreePruner instance configured from an RCAConfiguration.
 */
export function createEngineWithConfig(config: RCAConfiguration): TreePruner {
  const options = configToPrunerOptions(config);
  return new TreePruner(options);
}

/**
 * The configuration an engine built by {@link createEngineWithConfig} actually runs, as one line.
 *
 * Written where the mapping lives, so the line and the mapping cannot disagree — and written at all because
 * they DID: the L2 weight search's artifact reported a baseline and a tuned set of SEVEN weights while the
 * engine was constructed with twenty-seven options, and the four terms that dominate the shipped ranking
 * were among the ones it did not name.
 *
 * Three parts, in the order a reader needs them:
 *
 * 1. what the SEARCH sets,
 * 2. what is held at the engine's default and is therefore ON (or off) in every candidate it evaluates —
 *    the four dominant ranking terms among them,
 * 3. the engine's second constructor argument, which this path does not pass, and the term that costs.
 *
 * @param config - The configuration to describe.
 * @returns One line, without a trailing newline.
 */
export function formatEngineConfigLine(config: RCAConfiguration): string {
  const o = configToPrunerOptions(config);
  return (
    `engine: sourceWeight=${o.sourceWeight} temporalWeight=${o.temporalWeight} ` +
    `collisionWeight=${o.collisionWeight} topoWeight=${o.topoWeight} logWeight=${o.logWeight} ` +
    `riseWeight=${o.riseWeight} traceWeight=${o.traceWeight} prismWeight=${o.prismWeight} | ` +
    `held at the engine default: latWeight=${DEFAULT_LAT_WEIGHT} latMinRise=${DEFAULT_LAT_MIN_RISE} ` +
    `poolMetricPenaltyWeight=${DEFAULT_POOL_METRIC_PENALTY_WEIGHT} ` +
    `stabilityWeight=${DEFAULT_STABILITY_WEIGHT} onsetShape=${DEFAULT_ONSET_SHAPE} ` +
    // `logSignalMode` is held too and is enumerated in HELD_AT_ENGINE_DEFAULT with its reason, but it is not
    // printed here: this package consumes the engine through its BUILT typings, so a constant the engine
    // exported after the last build is not nameable from here. Naming it as a literal would be a second
    // owner of a value the engine ships, which is worse than a reader following the record. The count is
    // DERIVED, so a held field added below needs no edit here.
    `(plus ${Object.keys(HELD_AT_ENGINE_DEFAULT).length - HELD_PRINTED.length} more, ` +
    `see HELD_AT_ENGINE_DEFAULT) | ` +
    `second constructor argument NOT PASSED: every topology option is the engine's default, which since ` +
    `iteration 52 IS the shipped configuration`
  );
}

/**
 * Create a TreePruner with default configuration.
 * Equivalent to `new TreePruner()`.
 */
export function createDefaultEngine(): TreePruner {
  return createEngineWithConfig(DEFAULT_CONFIG);
}

/**
 * Map RCAConfiguration to TopologyFaultGraphConfig for
 * use in buildTopologyFaultGraph().  The TreePruner's
 * buildFaultGraph() passes this config through.
 */
export interface TopologyFaultGraphConfig {
  readonly minDataPoints: number;
  readonly temporalBonus: number;
  readonly defaultWeight: number;
  readonly useTemporalCausality: boolean;
  readonly baselineStrategy: 'auto' | 'q25' | 'sliding-window';
  readonly correlationMethod: 'pearson' | 'spearman';
  readonly adaptiveDecay: boolean;
  readonly usePropagationVelocity: boolean;
}

/**
 * Extract topology-level config from RCAConfiguration.
 */
export function configToTopologyConfig(config: RCAConfiguration): TopologyFaultGraphConfig {
  return {
    minDataPoints: 3,
    temporalBonus: config.continuous.temporalBonus,
    defaultWeight: config.continuous.defaultWeight,
    useTemporalCausality: config.discrete.useTemporalCausality,
    baselineStrategy: config.discrete.baselineStrategy,
    correlationMethod: config.discrete.correlationMethod,
    adaptiveDecay: true,
    usePropagationVelocity: true,
  };
}
