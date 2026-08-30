/**
 * Ranking fusion weights for root-cause candidate ordering.
 *
 * These are the five tunable weights that blend the raw self-anomaly score
 * with four independent, dataset-decoupled causality signals. Every weight
 * is opt-in (default 0), so a weight vector of all zeros reduces the ranking
 * to pure self-anomaly ordering. The structure is the single, serializable
 * contract between the ranking engine (tree package) and the offline
 * optimizer (optimize package, L2) — it is deliberately independent of any
 * concrete engine so the optimizer can tune it without coupling to the
 * engine's internal representation.
 *
 * @module types/ranking-weights
 */

/**
 * The ranking fusion weights applied in log space:
 *
 *   finalScore(v) = log(selfAnomaly(v))
 *                 + sourceWeight    × sourceScore(v)
 *                 + temporalWeight  × 2 × (earliness(v) − 0.5)
 *                 − collisionWeight × ratioContrib(v)
 *                 + topoWeight      × topoSource(v)
 *                 + logWeight       × logScore(v)
 *                 + riseWeight      × 2 × (riseScore(v) − 0.5)
 *
 * All weights are dimensionless and default to 0 (signal disabled).
 */
export interface RankingWeights {
  /**
   * LOCAL source-likelihood prior: the fraction of a node's causal
   * neighbours whose index-based anomaly onset is LATER than its own.
   * Cause precedes effect (Deng Yu's mean free time τ). Default 0 — the
   * naive onset detection regressed the benchmark (#193).
   */
  readonly sourceWeight: number;
  /**
   * GLOBAL temporal-earliness prior anchored to the fault injection time.
   * Default 0 — measured a net −2.5pp regression on RCAEval (#207/#208).
   */
  readonly temporalWeight: number;
  /**
   * Collision-energy prior: penalises a node whose fault energy is mostly
   * INHERITED from upstream (ratioContrib → 1) rather than self-generated.
   * A source has ratioContrib ≈ 0, a fan-in symptom ≈ 1. Default 0.
   */
  readonly collisionWeight: number;
  /**
   * Topological-source prior: rewards a node with NO strongly anomalous
   * upstream parent (topoSource → 1). A pure structural signal, distinct
   * from the nonlinear collision gain. Default 0.
   */
  readonly topoWeight: number;
  /**
   * Log-signal prior: rewards a node whose post-injection ERROR/FATAL log
   * volume is highest (min-max normalised). Targets code-level faults
   * (stack traces) that metric shape cannot detect. Default 0.
   */
  readonly logWeight: number;
  /**
   * Metric-direction prior: rewards a node whose DOMINANT metric RISES
   * (post-injection level above pre-injection) and penalises a COLLAPSE.
   * A code-level-fault SOURCE's dominant metric rises while a SYMPTOM's
   * collapses. OPTIONAL: absent means 0 (disabled).
   */
  readonly riseWeight?: number;
}
