/**
 * Meta-Learner: weighted k-NN prior from historical benchmark data.
 *
 * Given a new SystemContext x, predicts the optimal RCAConfiguration θ₀
 * by querying k nearest historical (context, config, accuracy) tuples.
 *
 * Distance metric: Euclidean on normalized context features (each feature
 * divided by its standard deviation across the historical corpus to ensure
 * equal dimensional contribution).
 *
 * Weighting: w_i = accuracy_i / (distance_i + ε)
 * This upweights high-accuracy configurations and downweights distant ones.
 *
 * Discrete params: weighted majority vote (argmax Σ w_i).
 * Continuous params: weighted average (Σ w_i · v_i / Σ w_i).
 *
 * Storage: ~50KB for 5 historical tuples.  Inference: < 1ms.
 */

import type { RCAConfiguration } from './config-space.js';
import { DEFAULT_CONFIG } from './config-space.js';
import type { SystemContext } from './types.js';

// ── Types ──

export interface HistoricalRecord {
  readonly system: string;
  readonly suite: string;
  readonly context: SystemContext;
  readonly config: HistoricalConfig;
  readonly accuracy: number;
}

export interface HistoricalConfig {
  readonly baselineStrategy: string;
  readonly correlationMethod: string;
  readonly propagationMode: string;
  readonly enableCollisionAggregation: boolean;
  readonly useTemporalCausality: boolean;
  readonly decayAlpha: number;
  readonly pruneEpsilon: number;
  readonly temporalBonus: number;
  readonly defaultWeight: number;
  readonly childContributionCap: number;
  /** Ranking fusion weights (log-space source/symptom priors). */
  readonly sourceWeight: number;
  readonly temporalWeight: number;
  readonly collisionWeight: number;
  readonly topoWeight: number;
  readonly logWeight: number;
}

export interface MetaLearnerOptions {
  /** Number of nearest neighbors */
  readonly k: number;
  /** Distance epsilon to avoid division by zero */
  readonly epsilon: number;
}

// ── Context feature names for normalization ──

const CONTEXT_FEATURES: readonly (keyof SystemContext)[] = [
  'serviceCount',
  'graphDensity',
  'degreeCV',
  'maxDepth',
  'traceCoverage',
  'metricCV',
  'spikeDominanceRatio',
  'anomalyConcentration',
  'systemLoad',
  'faultTypeCount',
  'avgCasesPerType',
];

// ── Implementation ──

export class MetaLearner {
  private readonly records: readonly HistoricalRecord[];
  private readonly options: MetaLearnerOptions;
  private readonly featureMeans: Float64Array;
  private readonly featureStds: Float64Array;

  constructor(records: readonly HistoricalRecord[], options?: Partial<MetaLearnerOptions>) {
    this.records = records;
    this.options = { k: 3, epsilon: 0.01, ...options };

    // Compute per-feature normalization stats
    const n = records.length;
    const fCount = CONTEXT_FEATURES.length;
    this.featureMeans = new Float64Array(fCount);
    this.featureStds = new Float64Array(fCount);

    if (n > 0) {
      for (let j = 0; j < fCount; j++) {
        let sum = 0;
        for (let i = 0; i < n; i++) {
          sum += records[i]!.context[CONTEXT_FEATURES[j]!];
        }
        this.featureMeans[j] = sum / n;
      }
      for (let j = 0; j < fCount; j++) {
        let sqSum = 0;
        for (let i = 0; i < n; i++) {
          const diff = records[i]!.context[CONTEXT_FEATURES[j]!] - this.featureMeans[j]!;
          sqSum += diff * diff;
        }
        // Bessel-corrected std: σ² = Σ(x - μ)² / (n-1)
        this.featureStds[j] = n > 1 ? Math.sqrt(sqSum / (n - 1)) : 1.0;
      }
    }
  }

  /** Number of training records */
  get recordCount(): number {
    return this.records.length;
  }

  /**
   * Predict optimal RCAConfiguration for a new system context.
   * Returns DEFAULT_CONFIG when no historical data is available.
   */
  predict(context: SystemContext): RCAConfiguration {
    const records = this.records;
    if (records.length === 0) return DEFAULT_CONFIG;

    const k = Math.min(this.options.k, records.length);

    // Compute distances to all records
    const distances = new Float64Array(records.length);
    for (let i = 0; i < records.length; i++) {
      distances[i] = this.contextDistance(context, records[i]!.context);
    }

    // Find k nearest neighbors
    const indices = Array.from({ length: records.length }, (_, i) => i);
    indices.sort((a, b) => distances[a]! - distances[b]!);
    const neighbors = indices.slice(0, k);

    // Compute weights: w_i = accuracy_i / (d_i + ε)
    const weights = new Float64Array(k);
    let totalWeight = 0;
    for (let i = 0; i < k; i++) {
      const idx = neighbors[i]!;
      const record = records[idx]!;
      const w = record.accuracy / (distances[idx]! + this.options.epsilon);
      weights[i] = w;
      totalWeight += w;
    }

    // Normalize weights
    if (totalWeight > 0) {
      for (let i = 0; i < k; i++) weights[i]! /= totalWeight;
    }

    // ── Continuous params: weighted average ──
    let decayAlpha = 0;
    let pruneEpsilon = 0;
    let temporalBonus = 0;
    let defaultWeight = 0;
    let childContributionCap = 0;
    let sourceWeight = 0;
    let temporalWeight = 0;
    let collisionWeight = 0;
    let topoWeight = 0;
    let logWeight = 0;

    for (let i = 0; i < k; i++) {
      const cfg = records[neighbors[i]!]!.config;
      decayAlpha += weights[i]! * cfg.decayAlpha;
      pruneEpsilon += weights[i]! * cfg.pruneEpsilon;
      temporalBonus += weights[i]! * cfg.temporalBonus;
      defaultWeight += weights[i]! * cfg.defaultWeight;
      childContributionCap += weights[i]! * cfg.childContributionCap;
      sourceWeight += weights[i]! * cfg.sourceWeight;
      temporalWeight += weights[i]! * cfg.temporalWeight;
      collisionWeight += weights[i]! * cfg.collisionWeight;
      topoWeight += weights[i]! * cfg.topoWeight;
      logWeight += weights[i]! * cfg.logWeight;
    }

    // ── Discrete params: weighted voting ──
    const baselineVotes = new Map<string, number>();
    const corrVotes = new Map<string, number>();
    const propVotes = new Map<string, number>();
    let collTrue = 0;
    let tempTrue = 0;

    for (let i = 0; i < k; i++) {
      const cfg = records[neighbors[i]!]!.config;
      const w = weights[i]!;
      baselineVotes.set(cfg.baselineStrategy, (baselineVotes.get(cfg.baselineStrategy) ?? 0) + w);
      corrVotes.set(cfg.correlationMethod, (corrVotes.get(cfg.correlationMethod) ?? 0) + w);
      propVotes.set(cfg.propagationMode, (propVotes.get(cfg.propagationMode) ?? 0) + w);
      if (cfg.enableCollisionAggregation) collTrue += w;
      if (cfg.useTemporalCausality) tempTrue += w;
    }

    const bestBaseline = argmax(baselineVotes) ?? 'auto';
    const bestCorr = argmax(corrVotes) ?? 'pearson';
    const bestProp = argmax(propVotes) ?? 'additive';

    return {
      continuous: {
        decayAlpha,
        pruneEpsilon,
        temporalBonus,
        defaultWeight,
        childContributionCap,
      },
      ranking: {
        sourceWeight,
        temporalWeight,
        collisionWeight,
        topoWeight,
        logWeight,
      },
      discrete: {
        baselineStrategy: bestBaseline as RCAConfiguration['discrete']['baselineStrategy'],
        correlationMethod: bestCorr as RCAConfiguration['discrete']['correlationMethod'],
        propagationMode: bestProp as RCAConfiguration['discrete']['propagationMode'],
        enableCollisionAggregation: collTrue >= 0.5,
        useTemporalCausality: tempTrue >= 0.5,
      },
    };
  }

  /** Euclidean distance on normalized context features */
  private contextDistance(a: SystemContext, b: SystemContext): number {
    let sqDist = 0;
    const fCount = CONTEXT_FEATURES.length;
    for (let j = 0; j < fCount; j++) {
      const key = CONTEXT_FEATURES[j]!;
      const std = this.featureStds[j]!;
      if (std < 1e-10) continue; // Skip features with zero variance
      const diff = (a[key] - b[key]) / std;
      sqDist += diff * diff;
    }
    return Math.sqrt(sqDist);
  }
}

// ── Helpers ──

/** Find key with maximum value in a Map */
function argmax(map: Map<string, number>): string | undefined {
  let bestKey: string | undefined;
  let bestVal = -Infinity;
  for (const [key, val] of map) {
    if (val > bestVal) {
      bestVal = val;
      bestKey = key;
    }
  }
  return bestKey;
}

/** Load MetaLearner from JSON data */
export function loadMetaLearner(data: readonly HistoricalRecord[]): MetaLearner {
  return new MetaLearner(data);
}
