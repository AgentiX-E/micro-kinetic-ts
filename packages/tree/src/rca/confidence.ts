/**
 * ConfidenceEstimator — error bound and confidence estimation.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * In the collision tree model, each propagation hop introduces
 * cumulative uncertainty. Deng Yu's analysis of the BBGKY hierarchy
 * provides rigorous error bounds:
 *
 *   ε_k = 1 - α^{k}
 *
 * where α is the one-hop propagation accuracy (decay factor) and
 * k is the number of hops from the root cause to the leaf.
 *
 * This means confidence = (1 - ε_k) = α^{k}, which decays exponentially
 * with propagation depth. This is consistent with the kinetic theory
 * result that collision tree truncation errors are bounded by a
 * geometric series in the rarefied regime.
 *
 * @module rca/confidence
 */

import {
  invariant,
  invariantRange,
  invariantPositiveInt,
} from '@agentix-e/micro-kinetic-core';

/**
 * Default one-hop propagation accuracy.
 */
const DEFAULT_ALPHA = 0.85;

/**
 * Options for confidence estimation.
 */
export interface ConfidenceOptions {
  /** One-hop propagation accuracy α ∈ (0, 1] */
  readonly alpha: number;
  /** Whether to apply depth penalty */
  readonly applyDepthPenalty: boolean;
  /** Logarithmic depth penalty coefficient */
  readonly depthPenaltyCoeff: number;
}

const DEFAULT_CONFIDENCE_OPTIONS: ConfidenceOptions = {
  alpha: DEFAULT_ALPHA,
  applyDepthPenalty: true,
  depthPenaltyCoeff: 1.0,
};

/**
 * ConfidenceEstimator — estimates error bounds and confidence
 * for root cause candidates on a pruned propagation tree.
 *
 * ## Deng Yu Mapping
 *
 * | Feature | Kinetic Theory | AIOps |
 * |---------|---------------|-------|
 * | α | single-collision survival probability | 1-hop propagation accuracy |
 * | k | number of collision events | propagation depth (hops) |
 * | ε_k | cumulative truncation error | propagation error bound |
 * | α^k | probability of k collisions without dissipation | confidence in k-hop RCA |
 */
export class ConfidenceEstimator {
  private readonly options: ConfidenceOptions;

  constructor(options?: Partial<ConfidenceOptions>) {
    this.options = { ...DEFAULT_CONFIDENCE_OPTIONS, ...options };
    invariantRange(this.options.alpha, 0, 1, 'alpha');
  }

  /**
   * Estimate the cumulative error bound after k propagation hops.
   *
   *   ε_k = 1 - α^k
   *
   * This is the geometric series bound from the BBGKY hierarchy:
   * each hop attenuates the signal by α, and the total "missing
   * signal" after k hops is 1 - α^k.
   *
   * **Invariant:** depth must be ≥ 0
   *
   * @param depth - Propagation depth (number of hops)
   * @returns Error bound ε_k in [0, 1]
   */
  estimateErrorBound(depth: number): number {
    invariant(depth >= 0, 'depth must be non-negative');
    invariant(Number.isInteger(depth), 'depth must be an integer');

    if (depth === 0) return 0;
    return 1 - Math.pow(this.options.alpha, depth);
  }

  /**
   * Compute confidence from score, depth, and error bound.
   *
   *   confidence = score × (1 - errorBound) × depth_penalty
   *
   * The depth penalty accounts for the fact that deeper propagation
   * paths have higher cumulative uncertainty:
   *
   *   depth_penalty = 1 / (1 + c × ln(depth + 1))
   *
   * where c is the depth penalty coefficient.
   *
   * In Deng Yu's theory, this reflects the super-exponential decay
   * of higher-order correlation terms in the BBGKY hierarchy.
   *
   * @param score - Total RCA score in [0, 1]
   * @param errorBound - Propagation error bound
   * @param depth - Propagation depth
   * @returns Confidence in [0, 1]
   */
  computeConfidence(
    score: number,
    errorBound: number,
    depth: number,
  ): number {
    invariantRange(score, 0, 1, 'score');
    invariantRange(errorBound, 0, 1, 'errorBound');
    invariant(depth >= 0, 'depth must be non-negative');

    let confidence = score * (1 - errorBound);

    if (this.options.applyDepthPenalty && depth > 0) {
      const depthPenalty =
        1 / (1 + this.options.depthPenaltyCoeff * Math.log(depth + 1));
      confidence *= depthPenalty;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Estimate confidence for a path with given propagation weights.
   *
   * For a path with edges e₁, e₂, ..., e_k, the path confidence is:
   *
   *   confidence = ∏_{i=1}^{k} p(e_i)
   *
   * where p(e_i) is the propagation probability of edge i.
   *
   * This corresponds to the joint survival probability of a
   * k-collision trajectory in the kinetic transport equation.
   *
   * @param pathWeights - Propagation weights along the path
   * @returns Path confidence in [0, 1]
   */
  pathConfidence(pathWeights: readonly number[]): number {
    invariant(pathWeights.length > 0, 'pathWeights must be non-empty');
    for (const w of pathWeights) {
      invariantRange(w, 0, 1, 'pathWeight');
    }

    let confidence = 1.0;
    for (const w of pathWeights) {
      confidence *= w;
    }
    return Math.max(0, confidence);
  }

  /**
   * Compute the confidence drop between two adjacent propagation depths.
   *
   *   Δ(k) = α^k - α^{k+1} = α^k × (1 - α)
   *
   * This is useful for adaptive stopping — when Δ(k) falls below a
   * tolerance, further propagation analysis adds negligible value.
   *
   * @param depth - Current depth k
   * @returns Confidence drop Δ(k)
   */
  confidenceDrop(depth: number): number {
    invariant(depth >= 0, 'depth must be non-negative');
    return Math.pow(this.options.alpha, depth) * (1 - this.options.alpha);
  }

  /**
   * Get the current alpha value.
   */
  get alpha(): number {
    return this.options.alpha;
  }
}

/**
 * Convenience function: estimate error bound at depth k.
 *
 * @param depth - Propagation depth
 * @param alpha - 1-hop propagation accuracy (default 0.85)
 * @returns Error bound in [0, 1]
 */
export function estimateErrorBound(
  depth: number,
  alpha: number = DEFAULT_ALPHA,
): number {
  invariantRange(alpha, 0, 1, 'alpha');
  const estimator = new ConfidenceEstimator({ alpha });
  return estimator.estimateErrorBound(depth);
}

/**
 * Convenience function: convert error bound to confidence.
 *
 * @param score - RCA score in [0, 1]
 * @param errorBound - Cumulative error bound
 * @param depth - Propagation depth
 * @returns Confidence in [0, 1]
 */
export function boundToConfidence(
  score: number,
  errorBound: number,
  depth: number,
): number {
  const estimator = new ConfidenceEstimator();
  return estimator.computeConfidence(score, errorBound, depth);
}
