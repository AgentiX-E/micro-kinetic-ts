/**
 * Ranking signal helpers — pure, unit-testable derivations of the three
 * dataset-decoupled causality signals that augment the raw self-anomaly
 * ranking in {@link performTreeRCA}.
 *
 * Each helper maps a set of graph inputs to a per-service score in [0, 1],
 * independent of any engine state, so the signals can be (a) computed once
 * in `buildFaultGraph` and stored on the graph, (b) ablated individually via
 * their feature toggles, and (c) unit-tested without constructing a full
 * engine.
 *
 * ## Signals
 *
 * 1. **Log signal** (`computeLogScores`) — the min-max normalised count of
 *    ERROR/FATAL log lines emitted at/after the fault injection time. A
 *    code-level fault (uncaught exception, stack trace) is often visible only
 *    in logs, so this targets the cases metric-shape signals cannot see.
 *
 * 2. **Topological source** (`computeTopoSourceScores`) — `1 − maxParentExplanation`,
 *    where `maxParentExplanation` is the largest `propagationWeight(p→v) ×
 *    anomaly(p)` over a node's upstream parents. A source (no strongly
 *    anomalous parent) scores 1; a symptom whose anomaly is fully explained
 *    by a parent scores 0. A pure STRUCTURAL signal — no fan-in amplification,
 *    no collision-type sensitivity — deliberately distinct from the nonlinear
 *    Boltzmann collision gain so the two can be ablated independently.
 *
 * @module pruning/ranking-signals
 */

import type {
  CallEdge,
  FaultLogEntry,
  ServiceId,
  TraceActivityCounts,
} from '@agentix-e/micro-kinetic-core';

/**
 * The log signal's scoring mode.
 *
 * - `count` (default): the max-normalised count of self-caused logic-exception
 *   lines per service — the original, benchmark-validated behaviour (#219/#220).
 * - `novelty`: each logic-exception line is weighted by the inverse document
 *   frequency (IDF) of its DEEPEST `Caused by:` exception class, so a service
 *   emitting a rare, specific root-cause exception out-scores one emitting a
 *   shared wrapper. Targets the code-level fault whose error signature is
 *   otherwise indistinguishable from the propagated 5xx cascade.
 * - `logicHttp`: counts logic exceptions PLUS framework HTTP exceptions
 *   (`isHttpException` — Spring's `HttpClientErrorException`/`HttpServerErrorException`/
 *   `ResourceAccessException` kin). Both are SOURCE signatures: a programming
 *   error is self-caused, and a framework HTTP exception means the service's
 *   own downstream calls failed (FSE'26 fault-injection floods this in the
 *   SOURCE at 10–16× the victim rate). Business/AMQP text and connectivity
 *   exceptions (which victims flood) are still excluded. Ablated against
 *   `count` and `all` (run 34450240928) as the zero-regression refinement of
 *   the blunt `all` mode.
 * - `logicHttpJoint`: like `logicHttp`, but the framework-HTTP half is gated
 *   by call-graph TOPOLOGY. A framework HTTP exception is DIRECTION-SYMMETRIC:
 *   the source emits it when the fault breaks ITS outgoing REST calls (its
 *   downstream — the callee — stays healthy), while a victim emits the SAME
 *   exception when its callee (the silent memory/bandwidth/killed source) is
 *   genuinely broken. `logicHttp` therefore regressed 15 cases by boosting
 *   victims whose callee was the real source. The joint mode suppresses the
 *   framework-HTTP count for a service that has a MORE-anomalous callee (that
 *   callee is the source, so the emitter is the victim), keeping the
 *   replace-code gain while removing the resource/network regression.
 *   **Falsified as measured** (run 34478297401, −19.4pp vs `logicHttp`), but
 *   the cause is NOT the one originally recorded. That record blamed
 *   `rankNormalization` ("the comparison operates on rank positions, not anomaly
 *   magnitudes, so a cascade puts the source's own callees above it"). That is
 *   impossible: `computeHttpVictimSet` evaluates only `callee > emitter`, and
 *   both rescales the builder ships (min-max, average-rank) are strictly
 *   monotone, so neither can change a strict inequality — the victim set is
 *   provably identical under raw, min-max and rank inputs (see the invariance
 *   suite in `ranking-signals.test.ts`). The real cause is still open; what IS
 *   fixed is the gate's denominator, which used to be taken after suppression
 *   and so let a withdrawal PROMOTE a mid-tier emitter to 1.0 — i.e. a
 *   supposedly subtractive gate could re-rank the case onto a service it never
 *   selected. Do not re-attempt this mode without a fresh ablation on current
 *   data. See docs/fse26-logicHttpJoint-falsified.md.
 * - `logicHttpDominant`: like `logicHttp`, but the framework-HTTP half is gated
 *   by EMITTER CONCENTRATION, not topology. A framework-HTTP flood is a source
 *   signature only when it is CONCENTRATED on one emitter — the source's own
 *   downstream calls all fail, so one service dominates at 10–16× the victim
 *   rate. A SPREAD flood across many callers is a victim cascade (each victim
 *   reports the same broken callee). The mode measures
 *   `dominance = topEmitterHttpCount / totalHttpCount` and suppresses the
 *   framework-HTTP half ENTIRELY when `dominance < httpDominanceThreshold`
 *   (spread → cascade), keeping it when concentrated. Unlike `logicHttpJoint`
 *   this never compares anomaly scores, so it is rank-normalisation-proof.
 *   **Falsified** (run 34482091814, diagnosed BEFORE ablation): the victim
 *   flood in the source-silent types is itself concentrated ~70% of the time
 *   (dominance ≥ 0.5 on a high-traffic VICTIM), so concentration does NOT
 *   separate source from victim. See docs/fse26-emitter-dominance-falsified.md.
 * - `all`: the max-normalised count of EVERY ERROR/FATAL line (the
 *   `isLogicException` gate is dropped). Targets fault classes where the SOURCE
 *   — not the symptom — floods errors with a non-logic exception (e.g. FSE'26
 *   HTTPResponseReplaceCode, whose source storms `HttpClientErrorException`
 *   lines while the logic-exception discriminator scores it 0). It is opt-in:
 *   for resource/network faults the symptom floods, so `all` misfires and must
 *   be ablated against `count` before it can ship.
 */
export type LogSignalMode =
  'count' | 'novelty' | 'logicHttp' | 'logicHttpJoint' | 'logicHttpDominant' | 'all';

/**
 * The call-graph context the `logicHttpJoint` mode needs to disambiguate a
 * framework HTTP exception's DIRECTION: whether the emitter is the source
 * (its own downstream calls failed) or a victim (its callee is the broken
 * source).
 */
export interface HttpSourceJointContext {
  /** Call graph edges, `from` = caller, `to` = callee. */
  readonly edges: readonly CallEdge[];
  /**
   * Per-service anomaly score. Only the ORDER of these values is ever read, so
   * any strictly monotone rescale is equivalent: the shipped `rankNormalization`
   * (average rank over ties) and the min-max default produce identical victim
   * sets, as does the raw pre-normalisation score. See the invariance suite in
   * `ranking-signals.test.ts`.
   */
  readonly anomalyScores: ReadonlyMap<ServiceId, number>;
}

/**
 * Compute the set of services whose framework-HTTP exception is a VICTIM
 * signature, not a source signature.
 *
 * A framework HTTP exception means "the emitting service observed a 4xx/5xx
 * (or a failed connection) from a downstream dependency it called". That
 * observation is ambiguous about WHO broke:
 *
 * - If the emitter's callee (the service it called) is NOT more anomalous than
 *   the emitter, the emitter's own fault broke the call → the emitter is the
 *   SOURCE (FSE'26 `HTTPResponseReplaceCode`).
 * - If the emitter's callee IS more anomalous than the emitter, the callee is
 *   the real fault source and the emitter merely reports it → the emitter is a
 *   VICTIM (FSE'26 `JVMMemoryStress`/`ContainerKill`/`NetworkBandwidth`, whose
 *   silent source drives the victim's `HttpServerErrorException` flood).
 *
 * @param edges - Call graph edges (from = caller, to = callee).
 * @param anomalyScores - Per-service anomaly score. Read by ORDER only
 *   (`callee > emitter`), so the result is identical for raw, min-max and rank
 *   inputs — a strictly monotone rescale cannot change a strict inequality.
 * @returns The services that have at least one callee more anomalous than
 *   themselves — the victim set whose framework-HTTP count should be suppressed.
 *
 * @remarks
 * The predicate is EXISTENTIAL over a service's callees, so its selectivity
 * depends on graph density: on a dense cascade most services have at least one
 * more-anomalous callee, and the victim set approaches the whole graph. That is
 * the leading open candidate for why `logicHttpJoint` cost 98 replace-code cases
 * (`docs/fse26-logicHttpJoint-falsified.md`) — normalisation is ruled out above.
 */
export function computeHttpVictimSet(
  edges: readonly CallEdge[],
  anomalyScores: ReadonlyMap<ServiceId, number>,
): Set<ServiceId> {
  const victims = new Set<ServiceId>();
  for (const edge of edges) {
    const fromAnomaly = anomalyScores.get(edge.from) ?? 0;
    const toAnomaly = anomalyScores.get(edge.to) ?? 0;
    if (toAnomaly > fromAnomaly) victims.add(edge.from);
  }
  return victims;
}

/**
 * The framework-HTTP emitter concentration of a case.
 *
 * A framework-HTTP exception is DIRECTION-SYMMETRIC: a source floods it when
 * the fault breaks ITS OWN downstream calls, while a victim floods the SAME
 * exception when its callee (the silent source) breaks. The distinguishing
 * feature is not "which service is more anomalous" but "is the flood
 * CONCENTRATED on one emitter (a source) or SPREAD across many callers (a
 * cascade)". This measure operationalises that split.
 */
export interface HttpEmitterDominance {
  /** The service with the most framework-HTTP lines (undefined when none). */
  readonly topEmitter: ServiceId | undefined;
  /** The top emitter's framework-HTTP line count. */
  readonly topCount: number;
  /** The framework-HTTP line count summed across all services. */
  readonly totalCount: number;
  /**
   * `topCount / totalCount` ∈ [0, 1] — the top emitter's share of the flood.
   * 0 when `totalCount` is 0 (no framework-HTTP lines).
   */
  readonly dominance: number;
}

/**
 * Default `dominance` threshold for the `logicHttpDominant` mode: the top
 * emitter must own at least half the framework-HTTP flood for it to be read as
 * a concentrated source signature rather than a spread victim cascade. Tuned
 * against the measured FSE'26 replace-code source at 10–16× the victim rate
 * (dominance ≈ 0.6–0.9) vs the memory/bandwidth/kill cascade spread across
 * many callers (dominance ≈ 1/N ≲ 0.3). Subject to ablation.
 */
export const DEFAULT_HTTP_DOMINANCE_THRESHOLD = 0.5;

/**
 * Compute the framework-HTTP emitter concentration of a case.
 *
 * Counts post-injection ERROR/FATAL lines flagged `isHttpException` per
 * in-graph service, then returns the top emitter, its count, the total, and
 * the `dominance` ratio. A high dominance means ONE service floods the
 * exception (a source whose own downstream calls failed); a low dominance
 * means the flood is SPREAD (a cascade where many callers each report the same
 * broken callee).
 *
 * @param logs - Raw log lines (may be undefined → zeroed result).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @returns The emitter concentration summary (all-zero when no framework-HTTP
 *   line survives filtering).
 */
export function computeHttpEmitterDominance(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): HttpEmitterDominance {
  if (!logs || logs.length === 0 || nodeIds.size === 0) {
    return { topEmitter: undefined, topCount: 0, totalCount: 0, dominance: 0 };
  }

  const counts = new Map<ServiceId, number>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (log.isHttpException !== true) continue;
    counts.set(log.service, (counts.get(log.service) ?? 0) + 1);
  }

  let topEmitter: ServiceId | undefined;
  let topCount = 0;
  let totalCount = 0;
  for (const [service, count] of counts) {
    totalCount += count;
    if (count > topCount) {
      topCount = count;
      topEmitter = service;
    }
  }

  return {
    topEmitter,
    topCount,
    totalCount,
    dominance: totalCount > 0 ? topCount / totalCount : 0,
  };
}

/**
 * Compute the log signal score for each service: the SELF-CAUSED logic-exception
 * volume emitted at/after the fault injection time, normalised by the maximum
 * count.
 *
 * The count is restricted to services present in `nodeIds` (a log line for a
 * service absent from the call graph cannot contribute a ranking signal) and,
 * when `injectTimeMs` is known, to lines emitted at/after that instant (a
 * pre-existing error storm is part of the normal regime, not the fault).
 *
 * Normalisation is `count(v) / maxCount`, so the top erroring service scores
 * 1, zero-error services score 0, and a lone erroring service scores 1 against
 * its silent peers — the code-level-fault signature (only the faulting service
 * emits self-caused logic exceptions).
 *
 * ## Logic-exception (self-caused) discriminator
 *
 * Error VOLUME alone is not a reliable source/symptom discriminator: in a
 * resource/network fault (RCAEval RE2) the SYMPTOM services flood ERROR logs
 * (a "connection refused" / "timeout" cascade), so max-count would boost the
 * symptom. Benchmark #219's exception-type diagnostic showed the causal split:
 *
 * - RE3 code-level faults flood LOGIC exceptions (NullPointerException,
 *   ConcurrentModificationException, JsonMappingException, AttributeError, …)
 *   in the SOURCE — a programming error is SELF-CAUSED.
 * - RE2 resource faults flood CONNECTIVITY exceptions (ConnectionException,
 *   SocketTimeoutException, MongoSocketException, UnknownHostException, …)
 *   in the SYMPTOMS — a connection failure is PROPAGATED.
 *
 * The `count` mode therefore counts only lines flagged `isLogicException`
 * (self-caused) and ignores connectivity/other errors. A resource cascade with
 * no logic exceptions yields an empty map (neutral); a code-level fault
 * concentrates the count on the source.
 *
 * ## `all` mode
 *
 * The `all` mode drops the logic-exception gate and counts every ERROR/FATAL
 * line. This is the right discriminator for fault classes where the SOURCE is
 * the error emitter with a NON-logic exception — FSE'26 HTTPResponseReplaceCode
 * storms `HttpClientErrorException` in the source (the code replacement makes
 * the source's downstream calls fail) at 10–16× the victim rate. It is opt-in
 * because it inverts the discriminator for resource/network faults (there the
 * symptom is the emitter), so it must be ablated net-positive before shipping.
 *
 * @param logs - Raw log lines (may be undefined → empty map).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @param mode - Scoring mode (`count` default; `novelty` for IDF weighting;
 *   `logicHttp` for logic + framework HTTP exceptions; `logicHttpJoint` for
 *   logic + topology-gated framework HTTP; `logicHttpDominant` for logic +
 *   concentration-gated framework HTTP; `all` for every error).
 * @param joint - Call-graph context for `logicHttpJoint` (ignored otherwise):
 *   the framework-HTTP half is suppressed for a service that has a
 *   more-anomalous callee (see {@link computeHttpVictimSet}).
 * @param httpDominanceThreshold - Concentration threshold for
 *   `logicHttpDominant` (ignored otherwise): the framework-HTTP half is
 *   suppressed ENTIRELY when the top emitter's share of the flood is below
 *   this value (see {@link computeHttpEmitterDominance}). Default
 *   {@link DEFAULT_HTTP_DOMINANCE_THRESHOLD}.
 * @returns Per-service log score in [0, 1]; empty when no signal.
 */
export function computeLogScores(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
  mode: LogSignalMode = 'count',
  joint?: HttpSourceJointContext,
  httpDominanceThreshold: number = DEFAULT_HTTP_DOMINANCE_THRESHOLD,
): Map<ServiceId, number> {
  if (mode === 'novelty') return computeLogNoveltyScores(logs, nodeIds, injectTimeMs);

  const scores = new Map<ServiceId, number>();
  if (!logs || logs.length === 0 || nodeIds.size === 0) return scores;

  // `count` gates on `isLogicException` (self-caused only); `logicHttp` counts
  // logic exceptions PLUS framework HTTP exceptions (both source signatures);
  // `logicHttpJoint` additionally suppresses the framework-HTTP half for a
  // service whose callee is MORE anomalous (that callee is the source, so the
  // emitter is a victim); `logicHttpDominant` suppresses the framework-HTTP half
  // ENTIRELY when the flood is SPREAD across many callers (a victim cascade)
  // rather than concentrated on one emitter (a source); `all` counts every error
  // line so a source that floods a propagated HTTP error still scores.
  const victims =
    mode === 'logicHttpJoint' && joint
      ? computeHttpVictimSet(joint.edges, joint.anomalyScores)
      : new Set<ServiceId>();
  // For `logicHttpDominant`, the framework-HTTP half is case-level: kept only
  // when ONE emitter owns ≥ the threshold share of the flood (concentrated
  // source), suppressed entirely otherwise (spread cascade). This never
  // compares anomaly scores, so it is immune to the rank-normalisation defeat
  // that falsified `logicHttpJoint`.
  const concentrated =
    mode === 'logicHttpDominant'
      ? computeHttpEmitterDominance(logs, nodeIds, injectTimeMs).dominance >= httpDominanceThreshold
      : false;
  // The gate is split in two levels, and the split is load-bearing rather than
  // cosmetic. Level 1 is the mode's SOURCE-SIGNATURE filter and it defines the
  // scale of the signal; level 2 is the mode's DIRECTION gate and it may only
  // withdraw a line level 1 already admitted.
  //
  // Level 1 — source signatures. `count` admits self-caused logic exceptions.
  // `logicHttp`, `logicHttpJoint` and `logicHttpDominant` admit logic exceptions
  // PLUS framework HTTP exceptions (both are source signatures). `all` admits
  // every ERROR/FATAL line so a source that floods a propagated HTTP error still
  // scores.
  const isSourceSignature = (log: FaultLogEntry): boolean => {
    if (mode === 'all') return true;
    if (log.isLogicException === true) return true;
    if (log.isHttpException === true) {
      return mode === 'logicHttp' || mode === 'logicHttpJoint' || mode === 'logicHttpDominant';
    }
    return false;
  };
  // Level 2 — direction. `logicHttpJoint` withdraws the framework-HTTP half for a
  // service whose callee is MORE anomalous (that callee is the source, so the
  // emitter is a victim); `logicHttpDominant` withdraws it ENTIRELY when the
  // flood is SPREAD across many callers (a victim cascade) rather than
  // concentrated on one emitter (a source). A self-caused logic exception is
  // never withdrawn: it is self-evidently a source signature.
  const isSuppressed = (log: FaultLogEntry): boolean => {
    if (log.isLogicException === true) return false;
    if (log.isHttpException !== true) return false;
    if (mode === 'logicHttpJoint') return victims.has(log.service);
    if (mode === 'logicHttpDominant') return !concentrated;
    return false;
  };

  // Count ERROR/FATAL lines per service, filtered by time and membership. The
  // logic-exception gate (when not `all`) ignores propagated cascade noise and
  // non-error lines — they would misfire max-count onto symptoms.
  //
  // `admitted` and `counts` are accumulated together but kept apart on purpose.
  // `counts` is the NUMERATOR (what the mode believes is a source signature) and
  // `admitted` sets the DENOMINATOR (the case-wide flood). Deriving the
  // denominator from the post-suppression counts would make the gate
  // scale-dependent: withdrawing the top emitter would shrink the denominator and
  // promote a mid-tier emitter to 1.0, so a subtractive gate would end up
  // manufacturing signal and re-ranking the case onto a service it never
  // selected. Keeping the denominator on level 1 makes withdrawal monotone — a
  // suppressing mode can only ever lower a score, never raise one.
  const counts = new Map<ServiceId, number>();
  const admitted = new Map<ServiceId, number>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (!isSourceSignature(log)) continue;
    admitted.set(log.service, (admitted.get(log.service) ?? 0) + 1);
    if (isSuppressed(log)) continue;
    counts.set(log.service, (counts.get(log.service) ?? 0) + 1);
  }

  // No matching signature lines → no signal (a resource cascade is neutral in
  // `count` mode; the suppressing modes reach this when they withdraw every
  // framework-HTTP line, which must stay neutral rather than promote a survivor).
  if (counts.size === 0) return scores;

  // The denominator is the level-1 max, so it is independent of the mode's
  // direction gate. `max >= 1` is guaranteed here: `counts` is non-empty and
  // `counts` is a sub-multiset of `admitted`, so `admitted` is non-empty too.
  let max = 0;
  for (const count of admitted.values()) {
    if (count > max) max = count;
  }

  for (const nodeId of nodeIds) {
    scores.set(nodeId, (counts.get(nodeId) ?? 0) / max);
  }
  return scores;
}

/**
 * Compute the log signal in `novelty` mode: each self-caused logic-exception
 * line is weighted by the inverse document frequency (IDF) of its DEEPEST
 * exception class, then summed and max-normalised per service.
 *
 * ## Rationale
 *
 * Spring's `HttpServerErrorException` is a non-discriminative HTTP wrapper: a
 * client throws it for ANY upstream 5xx, so every downstream symptom logs it.
 * The actual fault signature is the DEEPEST `Caused by:` class — e.g.
 * `IllegalArgumentException` — which is rare and unique to the source. Counting
 * volume (`count` mode) can misfire when a symptom floods more wrapper lines
 * than the source emits root-cause lines; weighting by rarity corrects for this.
 *
 * ## Formula
 *
 * Let `df(c)` = number of distinct services emitting logic-exception lines whose
 * deepest class is `c`, and `N = |nodeIds|`. The IDF weight is
 *
 * ```
 * idf(c) = log(1 + N / (1 + df(c)))
 * ```
 *
 * — a rare class (df = 1) weighs ≈ 2.4× a ubiquitous class (df = N/2). A
 * service's raw score is `Σ_c count(v, c) · idf(c)`; the map is then
 * max-normalised exactly as in `count` mode. The `isLogicException` gate is
 * retained so connectivity cascades (RE2) stay neutral.
 *
 * @param logs - Raw log lines (may be undefined → empty map).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @returns Per-service log score in [0, 1]; empty when no signal.
 */
export function computeLogNoveltyScores(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!logs || logs.length === 0 || nodeIds.size === 0) return scores;

  // Pass 1: per-service counts of logic-exception lines keyed by their deepest
  // exception class (post-inject, node member, self-caused logic only).
  const perService = new Map<ServiceId, Map<string, number>>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (!log.isLogicException) continue;
    const cls = log.deepestExceptionClass ?? 'Unknown';
    let svcMap = perService.get(log.service);
    if (!svcMap) {
      svcMap = new Map<string, number>();
      perService.set(log.service, svcMap);
    }
    svcMap.set(cls, (svcMap.get(cls) ?? 0) + 1);
  }

  if (perService.size === 0) return scores;

  // Pass 2: document frequency — how many distinct services emit each deepest
  // class. A class emitted by one service is the source signature; a class
  // emitted by many is a propagated wrapper.
  const df = new Map<string, number>();
  for (const svcMap of perService.values()) {
    for (const cls of svcMap.keys()) {
      df.set(cls, (df.get(cls) ?? 0) + 1);
    }
  }
  const n = nodeIds.size;
  // Every class referenced in pass 3 was written into `df` during pass 2, so the
  // document-frequency lookup is always defined.
  const idf = (cls: string): number => Math.log(1 + n / (1 + df.get(cls)!));

  // Pass 3: raw score per service, then max-normalise.
  const raw = new Map<ServiceId, number>();
  let max = 0;
  for (const [svc, svcMap] of perService) {
    let sum = 0;
    for (const [cls, count] of svcMap) sum += count * idf(cls);
    raw.set(svc, sum);
    if (sum > max) max = sum;
  }

  for (const nodeId of nodeIds) {
    scores.set(nodeId, (raw.get(nodeId) ?? 0) / max);
  }
  return scores;
}

/**
 * Compute the topological-source score for each service: `1 − maxParentExplanation`,
 * where `maxParentExplanation(v)` is the largest `propagationWeight(p→v) ×
 * anomaly(p)` over v's upstream parents.
 *
 * The intuition: a fault PROPAGATES along call edges, so a node whose anomaly
 * is strongly explained by an already-anomalous parent is a symptom, while a
 * node with no such parent (or only weakly-explaining parents) is a candidate
 * source. Both terms are bounded so the explanation is clamped to [0, 1]:
 * a parent with anomaly 1 and edge weight 1 fully explains the child.
 *
 * @param edges - Call graph edges (parent → child).
 * @param propagationWeights - Edge weights, aligned with `edges` by index.
 * @param anomalyScores - Per-service anomaly score in [0, 1].
 * @returns Per-service topological-source score in [0, 1].
 */
export function computeTopoSourceScores(
  edges: readonly CallEdge[],
  propagationWeights: Float64Array,
  anomalyScores: ReadonlyMap<ServiceId, number>,
): Map<ServiceId, number> {
  const maxExplanation = new Map<ServiceId, number>();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]!;
    const parentAnomaly = anomalyScores.get(edge.from) ?? 0;
    const weight = propagationWeights[i] ?? 0;
    const explanation = parentAnomaly * weight;
    const prev = maxExplanation.get(edge.to) ?? 0;
    if (explanation > prev) maxExplanation.set(edge.to, explanation);
  }

  const scores = new Map<ServiceId, number>();
  for (const [nodeId] of anomalyScores) {
    const explained = Math.min(1, maxExplanation.get(nodeId) ?? 0);
    scores.set(nodeId, 1 - explained);
  }
  return scores;
}

/**
 * Compute the metric direction (RISE vs COLLAPSE) per service, derived from
 * the DOMINANT metric's pre/post-injection levels.
 *
 *   direction(v) = mean(tail) / (mean(head) + mean(tail))   ∈ [0, 1]
 *
 * 1 = a pure rise (tail ≫ head), 0 = a pure collapse (tail ≪ head), 0.5 =
 * unchanged. A "wrong value" code-level fault (RCAEval RE3) makes the SOURCE
 * do MORE work so its dominant metric RISES (→ 1), while a losing SYMPTOM's
 * COLLAPSES (→ 0). Measured on the CLEAN head↔tail change rather than the
 * baseline-relative rise/drop ratios, whose tiny-baseline spurious rise
 * `collapseDiscount` could not discount (benchmark #226/227: the source's
 * workload 0.4→1.4 was outranked by a symptom's cpu whose 9.8× "rise" was an
 * artifact of a ~0.4 baseline).
 *
 * The direction is LEFT RAW here — the caller gates the collapse half by the
 * log signal via {@link gatedRiseContribution}, because a collapse is the
 * SOURCE's signature for some fault classes (crash) and the SYMPTOM's for
 * others, so it must not be penalised unconditionally.
 *
 * @param dominantMetrics - Per-service dominant metric (label + head/tail).
 * @param nodeIds - Services present in the call graph.
 * @returns Per-service direction in [0, 1]; 0.5 (neutral) when unknown.
 */
export function computeRiseScores(
  dominantMetrics:
    | ReadonlyMap<
        ServiceId,
        { readonly label: string; readonly head: number[]; readonly tail: number[] }
      >
    | undefined,
  nodeIds: ReadonlySet<ServiceId>,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!dominantMetrics || nodeIds.size === 0) return scores;

  for (const nodeId of nodeIds) {
    const dm = dominantMetrics.get(nodeId);
    if (!dm || dm.head.length === 0 || dm.tail.length === 0) {
      scores.set(nodeId, 0.5);
      continue;
    }
    let headSum = 0;
    for (const v of dm.head) headSum += v;
    let tailSum = 0;
    for (const v of dm.tail) tailSum += v;
    const headMean = headSum / dm.head.length;
    const tailMean = tailSum / dm.tail.length;
    const denom = headMean + tailMean;
    scores.set(nodeId, denom <= 0 ? 0.5 : tailMean / denom);
  }
  return scores;
}

/**
 * Combine a raw metric direction with the log signal into a single rise
 * contribution in [−1, 1].
 *
 *   dir = 2 × (direction − 0.5)          ∈ [−1, 1]   (+1 rise, −1 collapse)
 *   contribution = dir ≥ 0 ? dir : (hasLogicException ? 0 : dir)
 *
 * A RISE is always rewarded (the source does more work). A COLLAPSE is
 * penalised ONLY when the service has NO logic exception — a silent collapse
 * is the SYMPTOM's signature — and is NEUTRAL when it has one, because a
 * logic-exception collapse is the SOURCE's own crash (e.g. an
 * `NullPointerException` that takes the service down). This is the gate that
 * lets the collapse penalty lift TrainTicket (silent symptoms) without
 * regressing OnlineBoutique (logic-exception sources).
 *
 * @param direction - Raw metric direction in [0, 1] (see computeRiseScores).
 * @param hasLogicException - Whether the service emitted a logic exception.
 * @returns The gated contribution in [−1, 1].
 */
export function gatedRiseContribution(direction: number, hasLogicException: boolean): number {
  const dir = 2 * (direction - 0.5);
  if (dir >= 0) return dir;
  return hasLogicException ? 0 : dir;
}

/**
 * Compute, per service, the most DISTINCTIVE deepest `Caused by:` exception
 * class among its post-injection logic-exception log lines.
 *
 * A service emits many error lines; the one that identifies it as a fault
 * source is the RAREST root-cause class across the whole system. A ubiquitous
 * wrapper (Spring's `HttpServerErrorException`) is shared by every symptom, so
 * it is not distinctive; a rare class (`MalformedJwtException`,
 * `NullPointerException`) is the fingerprint of the service that actually
 * produces (or first detects) the fault. Rarity is document frequency:
 * `df(c)` = number of DISTINCT services emitting logic-exception lines whose
 * deepest class is `c`; the rarest class wins, tie-broken by per-service count
 * then lexicographic order for determinism.
 *
 * This feeds the evidence-grounded LLM reranker's `deepestLogException` field
 * (previously declared but never populated), so the model can reason over the
 * actual exception identity rather than only metric shift.
 *
 * @param logs - Raw log lines (may be undefined → empty map).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @returns Per-service deepest exception class; absent when the service emits
 *   no logic exception.
 */
export function computeDeepestExceptions(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): Map<ServiceId, string> {
  const result = new Map<ServiceId, string>();
  if (!logs || logs.length === 0 || nodeIds.size === 0) return result;

  // Pass 1: document frequency per class, and per-service class counts.
  const docServices = new Map<string, Set<ServiceId>>();
  const perService = new Map<ServiceId, Map<string, number>>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (!log.isLogicException) continue;
    const cls = log.deepestExceptionClass ?? 'Unknown';
    let svcSet = docServices.get(cls);
    if (!svcSet) {
      svcSet = new Set();
      docServices.set(cls, svcSet);
    }
    svcSet.add(log.service);
    let clsCount = perService.get(log.service);
    if (!clsCount) {
      clsCount = new Map();
      perService.set(log.service, clsCount);
    }
    clsCount.set(cls, (clsCount.get(cls) ?? 0) + 1);
  }

  // Class → document frequency (number of DISTINCT services emitting it).
  const dfByClass = new Map<string, number>();
  for (const [cls, svcSet] of docServices) {
    dfByClass.set(cls, svcSet.size);
  }

  // Pass 2: pick the rarest class per service. The sort key orders by
  // (df ASC, count DESC, class ASC) so the rarest, most frequent, then
  // lexicographically smallest class wins deterministically.
  for (const [svc, clsCount] of perService) {
    let best: string | undefined;
    let bestKey = '';
    for (const [cls, count] of clsCount) {
      // Every class in perService was inserted into docServices (and thus
      // dfByClass) during pass 1, so the lookup is always defined.
      const df = dfByClass.get(cls)!;
      const key = `${String(df).padStart(12, '0')}_${String(1_000_000_000 - count)}_${cls}`;
      if (best === undefined || key < bestKey) {
        best = cls;
        bestKey = key;
      }
    }
    if (best !== undefined) result.set(svc, best);
  }
  return result;
}

/**
 * Tunable thresholds for {@link computeTraceActivityScores}.
 *
 * The signal's job is to name the UNIQUE silent-source service with high
 * confidence, and stay NEUTRAL (empty map) otherwise — a false positive on a
 * route/latency fault (whose GT does not rise) is worse than no signal, since
 * the other causal priors already rank such cases. The three thresholds are
 * tuned against the measured TrainTicket RE3 span counts (see the signal's
 * documentation for the empirical basis).
 */
export interface TraceActivityOptions {
  /**
   * Minimum PRE-injection span count a service must have to be a candidate.
   * Filters low-volume services whose tiny pre baseline makes a small absolute
   * post gain look like a spurious "rise" (a 30→60 span doubling on an
   * idle-payment edge is not a fault signature). Default 500.
   */
  readonly minPreCount: number;
  /**
   * Minimum POST-injection span count a candidate must have. Guards against a
   * pure collapse (post → 0) being read as a "rise" when `pre` is also tiny.
   * Default 1.
   */
  readonly minPostCount: number;
  /**
   * Minimum post/pre count ratio to be a "significant riser". A flat service
   * sits at ≈1.00–1.02 (post ≈ pre); a real silent-source rise is ≥1.15.
   * Default 1.15.
   */
  readonly riseThreshold: number;
}

/** Default thresholds for {@link computeTraceActivityScores}. */
export const DEFAULT_TRACE_ACTIVITY_OPTIONS: TraceActivityOptions = {
  minPreCount: 500,
  minPostCount: 1,
  riseThreshold: 1.15,
};

/**
 * Compute the trace-activity score: the UNIQUE significant span-count riser,
 * or nothing.
 *
 * ## Motivation — the silent-source ceiling
 *
 * TrainTicket RE3's `ts-auth-service` "wrong value" fault (RCAEval RE3) is
 * the case that defeats every prior ranking signal: the faulting service
 * throws NO exception (no log signal), emits NO error span (no status signal),
 * and its metric only rises mildly (a 3.5× workload rise that the metric-shape
 * signals cannot separate from symptoms). The ONE deterministic signature it
 * leaves is a RISE IN SPAN COUNT — the wrong value makes the service do MORE
 * work per request, so it emits more spans after injection while its peers
 * stay flat or fall (route/latency symptoms actually COLLAPSE).
 *
 * Measured per-service pre/post span counts across the TrainTicket RE3 sample
 * (window is symmetric ≈900s/900s, so the count ratio is the rate ratio):
 *
 * - `ts-auth-service` (GT, auth faults) is the ONLY service with post/pre >
 *   1.15 (1.398 / 1.408 / 2.178); every non-GT service is ≤ 0.20.
 * - route f1's GT does NOT rise (post/pre ≈ 0.90), but three low-volume edge
 *   services spuriously rise 1.4–2.0× on a tiny pre baseline (30–76 spans),
 *   and several mid-volume services sit at ≈1.00–1.02 (flat, not rising).
 *
 * The thresholds therefore encode the split: `minPreCount = 500` rejects the
 * low-volume spurious risers (pre = 30–76) while the auth GT (pre = 1770–1895)
 * passes; `riseThreshold = 1.15` rejects the ≈1.00–1.02 flat services; and the
 * UNIQUENESS rule makes the route case (GT flat + no qualifying service) yield
 * an empty map — neutral, no misfire — rather than a wrong winner.
 *
 * ## Gate
 *
 * A service is a CANDIDATE iff it is a graph member, has `pre ≥ minPreCount`,
 * `post ≥ minPostCount`, and `post / pre ≥ riseThreshold`. The signal returns
 * `{candidate: 1}` only when EXACTLY ONE candidate exists, otherwise an empty
 * map (neutral). This is the binary dual of {@link gatedRiseContribution}'s
 * three-state gate: here a single high-confidence vote, not a graded reward.
 *
 * ## Silent-source condition
 *
 * The signal is a SILENT-SOURCE detector: it must defer to exception evidence
 * about the WHOLE case. When ANY graph service emitted a self-caused logic
 * exception (`logicExceptionServices` is non-empty), the case is NOT silent —
 * the log signal (always on) already ranks that thrower — and the vote is
 * suppressed.
 *
 * The gate is deliberately CASE-LEVEL. The previous per-candidate gate (commit
 * `56ddf7a`) suppressed the vote only when the WINNER itself threw, which was
 * needed to work around the loader's misclassification of a downstream WRAPPER's
 * `IllegalArgumentException: Invalid UUID string` (an empty-value parse failure)
 * as self-caused. That misclassification is now fixed in the loader: an
 * empty-value parse failure is a PROPAGATED wrong-value symptom and is flagged
 * `isLogicException === false`, so the wrapper no longer appears in
 * `logicExceptionServices`. With the wrapper excluded, a case-level gate is
 * once again correct:
 *
 * - TrainTicket RE3 f2 (silent source + throwing wrapper): the wrapper is
 *   excluded, so `logicExceptionServices` is empty and the silent
 *   `ts-auth-service` riser receives the vote.
 * - OnlineBoutique RE3 f4 (throwing source): the source emits a self-caused
 *   NullPointerException, so `logicExceptionServices` is non-empty and the
 *   detector defers to the log signal — no trace/log interference.
 * - RE2 memory faults (throwing source): likewise non-empty → defer, so trace
 *   no longer misfires on the resource-fault suite.
 *
 * @param counts - Per-service pre/post span counts (may be undefined → empty).
 * @param nodeIds - Services present in the call graph.
 * @param options - Threshold overrides (merged over the defaults).
 * @param logicExceptionServices - The set of services that emitted a
 *   self-caused logic exception. Suppresses the vote whenever the set is
 *   non-empty (the case is not silent). Default empty.
 * @returns Sparse `{service: 1}` map, or empty when no unique significant riser
 *   or when any service threw a self-caused logic exception.
 */
export function computeTraceActivityScores(
  counts: ReadonlyMap<ServiceId, TraceActivityCounts> | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  options?: Partial<TraceActivityOptions>,
  logicExceptionServices: ReadonlySet<ServiceId> = new Set(),
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!counts || counts.size === 0 || nodeIds.size === 0) return scores;

  const { minPreCount, minPostCount, riseThreshold } = {
    ...DEFAULT_TRACE_ACTIVITY_OPTIONS,
    ...options,
  };

  let candidate: ServiceId | undefined;
  let candidateCount = 0;
  for (const nodeId of nodeIds) {
    const c = counts.get(nodeId);
    if (!c) continue;
    if (c.pre < minPreCount || c.post < minPostCount) continue;
    if (c.pre <= 0) continue;
    if (c.post / c.pre < riseThreshold) continue;
    candidateCount++;
    candidate = nodeId;
  }

  // Only a UNIQUE qualifying riser is a confident silent-source vote; zero or
  // multiple candidates carry no discriminative information and stay neutral.
  if (candidateCount !== 1 || candidate === undefined) return scores;

  // CASE-LEVEL gate: when ANY graph service emitted a self-caused logic
  // exception, the case is NOT silent — the always-on log signal already ranks
  // that thrower — so this silent-source detector defers ENTIRELY. A
  // downstream wrapper throwing a PROPAGATED empty-value parse failure is NOT
  // in `logicExceptionServices` (`isLogicException` now excludes it, see the
  // loader), so the silent wrong-value source still receives the vote.
  if (logicExceptionServices.size > 0) return scores;

  scores.set(candidate, 1);
  return scores;
}
