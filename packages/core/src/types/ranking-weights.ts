/**
 * Ranking fusion weights for root-cause candidate ordering.
 *
 * These are the tunable weights that blend the raw self-anomaly score with the
 * independent, dataset-decoupled causality signals. Every weight is opt-in
 * (default 0), so a weight vector of all zeros reduces the ranking to pure
 * self-anomaly ordering. The COUNT is deliberately not stated: it was five, then
 * ten, and a sentence that counts a growing list is wrong more often than it is
 * right — the formula below is the list. The structure is the single, serializable
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
 *                 − poolMetricPenaltyWeight × poolMetricScore(v)
 *                 + stabilityWeight × stabilityScore(v)
 *                 + selfTimeWeight  × selfTimeShare(v)
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
  /**
   * Pool-dominance penalty: subtracts when the metric that won a service's
   * anomaly maximum is a DB connection-pool series (`db.client.connections.*`).
   *
   *   finalScore(v) −= poolMetricPenaltyWeight × poolMetricScore(v)
   *
   * `poolMetricScore(v)` ∈ {0, 1} is a function of WHICH metric won, not of the
   * score, so this is a penalty on the EVIDENCE rather than a reshaping of the
   * anomaly — the metric term's own shape is closed in the register, and so is
   * every input ablation.
   *
   * A pool's maxima are the largest numbers any service carries here and they
   * rise for every service sharing the saturated database, so the series wins a
   * service's anomaly maximum whenever contention exists — including for services
   * that are only waiting. The census over the shipped dump's 672 misses is that
   * statement: 128 wrong rank-1 winners are pool-dominant against 48 sources.
   *
   * OPTIONAL: absent means 0 (disabled). The documented interface intentionally
   * keeps every fusion weight optional — the shipped constant and the measured
   * value are the engine's own (see `DEFAULT_TREE_PRUNER_OPTIONS`), so a stored
   * weight vector written before this term existed still loads and means "off".
   */
  readonly poolMetricPenaltyWeight?: number;
  /**
   * Decisive-stability prior: rewards a node whose DOMINANT metric's dispersion bonus is the
   * LOWEST in the case.
   *
   *   finalScore(v) += stabilityWeight × stabilityScore(v)
   *
   * `stabilityScore(v)` is the node's rank among the case's candidates by ASCENDING dominant-metric
   * `cv` bonus, mapped to `(n − 1 − rank) / (n − 1)` with tie groups averaged — the same
   * rank-normalisation `rankNormalizeScores` applies to the anomaly, over a different statistic.
   * Nodes whose dominant metric carries no composition are ABSENT from the map, and the term reads
   * them as 0 — `undefined` is not a measured `cv` of zero.
   *
   * The statistic it reads is `MetricBreakdown.cv`, which is a CLAMPED BONUS
   * (`cv > 0.5 ? min(cv, 1.5) × 0.05 : 0`) rather than a coefficient of variation, so only its
   * ORDER is usable — the magnitude saturates at 0.075 and 43.6% of services sit on one of the two
   * endpoints. That is why this term is rank-shaped and there is no magnitude-shaped sibling.
   *
   * Evidence: across the miss pairs of the shipped FSE'26 dump the true source's decisive `cv` bonus
   * is the LOWER one (AUC 0.718 on the inventory-matched stratum, `docs/fse26-separator-verdict.md`
   * §6.2), and the zero-regression window solved over all 1422 cases of run `35107871516` gains SIX
   * cases with none lost — `[0.029860, 0.030480]`, `docs/fse26-cv-screen.md` §4. That window is the
   * FSE'26 half ALONE, and its midpoint `0.030170` was REJECTED for moving four of the nine golden
   * cells, one by 15.8pp; what ships is the intersection's midpoint instead.
   *
   * OPTIONAL: absent means 0 (disabled) here, because THIS structure is the optimizer's serializable
   * search space, where a zero weight is how a signal is switched off. It is not the engine's
   * default: the engine ships the term ON, at `DEFAULT_STABILITY_WEIGHT`, with BOTH halves of the
   * kill criterion measured at that value (`35411806524` FSE'26 `757/1422`, `35411810992` golden
   * 9 of 9 byte-identical) and the DEFAULT path re-measured afterwards (`35416576350`).
   */
  readonly stabilityWeight?: number;
  /**
   * Weight on the internal/external SYMMETRY mask — PRISM's axiom as a bounded discount on a candidate's
   * own evidence:
   *
   *   finalScore(v) −= victimWeight × (1 − symmetry(v)) × log1p(selfAnomaly(v))
   *
   * The mask form rather than a score, because `prismWeight`'s own six-arm sweep measured the additive
   * form trading one population for another (RE3-TrainTicket +9, RE1 −37 at `conjunctive 0.75`). Ships at
   * 0, where the symmetry map is not even built.
   */
  readonly victimWeight?: number;
  /**
   * Weight on the DUAL-FAMILY presence bonus — PRISM's shape test as a bounded 0/1 indicator:
   *
   *   finalScore(v) += dualFamilyWeight × 1[v has a moving channel in BOTH families]
   *
   * Imported as PRESENCE rather than as a score because the score form was measured in three variants and
   * refused (`docs/prism-symmetry-mask.md`): each brought its own z-scale into a ranking fourteen terms already
   * tune. Ships at **0.25**, enrolled on a sweep with no cell down (RE3 52 → 55, RE1 and RE2 byte-identical).
   */
  readonly dualFamilyWeight?: number;
  /**
   * Self-time prior: rewards a service for the share of its OWN latency rise that no callee can
   * explain.
   *
   *   finalScore(v) += selfTimeWeight × selfTimeShare(v)
   *
   * `selfTimeShare(v) = max(0, L(v) − max over callees c of L(c)) / L(v)` where `L` is the transport
   * (latency-channel) level. A caller's response time CONTAINS its callees', so a rise that a slow
   * callee explains is inherited rather than created — the distinction a maximum-over-metrics anomaly
   * cannot make, and the reason a caller outranks the callee that broke on rank-normalised graphs.
   * A leaf (no callees) keeps its whole rise, which is the definition rather than a degree artefact:
   * nothing downstream exists that could have created it.
   *
   * Shares are ABSENT, not zero, for a service with no measurable latency channel or with any callee
   * that has none — unknown is not a measured 0.
   *
   * OPTIONAL: absent means 0 (disabled).
   */
  readonly selfTimeWeight?: number;
}
