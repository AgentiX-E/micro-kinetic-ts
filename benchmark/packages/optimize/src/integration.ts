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
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import type { RCAConfiguration } from './config-space.js';
import { DEFAULT_CONFIG } from './config-space.js';

/**
 * Map an RCAConfiguration to TreePrunerOptions.
 * Returns DEFAULT_TREE_PRUNER_OPTIONS overridden by config values.
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
