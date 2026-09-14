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
 *   finalScore(v) = log1p(selfAnomaly(v))
 *                 + sourceWeight    × sourceScore(v)
 *                 + temporalWeight  × 2 × (earliness(v) − 0.5)
 *                 − collisionWeight × ratioContrib(v)
 *                 + topoWeight      × topoSource(v)
 *                 + logWeight       × logScore(v)
 *                 + riseWeight      × 2 × (riseScore(v) − 0.5)
 *                 + traceWeight     × traceActivity(v)
 *                 + prismWeight     × prismScore(v)
 *                 + failedEdgeWeight × failedEdgeScore(v)
 *                 + latWeight       × latScore(v)
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
   * (post-injection level above pre-injection); penalises a COLLAPSE only when
   * the node emitted no logic exception. OPTIONAL: absent means 0 (disabled).
   */
  readonly riseWeight?: number;
  /**
   * Trace-activity prior: rewards the UNIQUE service whose post-injection
   * trace span count rises significantly above its pre-injection count — the
   * silent-source signature (RCAEval RE3 "wrong value" faults emit no
   * exception, only a workload rise). OPTIONAL: absent means 0 (disabled).
   */
  readonly traceWeight?: number;
  /**
   * PRISM graph-free prior: rewards a service that is anomalous in BOTH its
   * internal (cpu/memory/disk/socket) AND external (latency/error/throughput)
   * properties, the internal/external asymmetry of PRISM (arXiv:2601.21359).
   * A root cause is anomalous in both channels; a downstream symptom is
   * external-only. `prismScore(v)` is PRISM's M-score (additive combination),
   * max-normalised to [0, 1] — see `computePrismScores`. OPTIONAL: absent
   * means 0 (disabled).
   */
  readonly prismWeight?: number;
  /**
   * Failed-call-direction prior: rewards a service that its callers' FAILED
   * calls were made AGAINST (the callee of a failed edge).
   *
   *   finalScore(v) += failedEdgeWeight × failedEdgeScore(v)
   *
   * `failedEdgeScore(v)` is the max-normalised sum over edges `(caller → v)` of
   * `failed − baseline`, where both counts come from the same edge measured
   * over the post- and pre-injection windows. It is the INVERSE of the log
   * signal: the log signal credits whoever EMITS an error (the caller, which is
   * usually the victim), this one credits whoever the error was emitted ABOUT
   * (the callee, which is the source). That is the direction the log signal
   * cannot express, and it is why this is a separate signal rather than another
   * log mode.
   *
   * OPTIONAL: absent means 0 (disabled).
   */
  readonly failedEdgeWeight?: number;
  /**
   * Per-edge latency-rise prior: rewards a service that its CALLERS' spans
   * spent longer waiting on (the callee of an edge whose mean span duration
   * rose after the injection).
   *
   *   finalScore(v) += latWeight × latScore(v)
   *
   * `latScore(v)` is the largest `postMeanMs / preMeanMs` over the edges
   * `caller → v`, compressed with `log1p(max(0, rise − 1))` and max-normalised
   * into [0, 1].
   *
   * The CONTINUOUS counterpart of {@link RankingWeights.failedEdgeWeight}: that
   * one counts FAILURES, so a call that became slow but still succeeded is
   * invisible to it, and so is a case where no call failed at all — 70 of the
   * 291 silent-source cases. Duration is what the caller recorded about the
   * callee, so this carries the same direction and exists exactly where the
   * counts are zero.
   *
   * Measured on FSE'26: a JVM memory-stress source's inbound rise is 3.574 at
   * the median and 14.79 at p90 against a ReplaceCode source's 0.976, and
   * ranking on this term alone reaches 33.3% on that block against a shipped
   * 2.3%. It is inert on ReplaceCode, so it is a term for the silent-source
   * faults rather than a repair for that type.
   *
   * OPTIONAL: absent means 0 (disabled).
   */
  readonly latWeight?: number;
}
