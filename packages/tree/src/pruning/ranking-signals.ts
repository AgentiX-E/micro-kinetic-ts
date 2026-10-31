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
  FaultEdgeLatency,
  FaultFailedEdge,
  FaultLogEntry,
  MetricMap,
  ServiceId,
  TraceActivityCounts,
} from '@agentix-e/micro-kinetic-core';

import { isLatencyMetric, medianOfRange } from '../causal/topology-fault-graph.js';

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
 * Every log-signal mode, as a `Record` over the union.
 *
 * Exhaustive by construction: a new member of {@link LogSignalMode} is a COMPILE error here
 * until it is named. The value is unused; the keys are the vocabulary.
 *
 * It lives beside the union rather than in either runner because it was written twice by hand
 * and the two copies disagreed. `fse26-cli.ts` argued for exactly this shape in its own
 * docblock — "a list of names cannot be checked against a union" — and then closed it for ONE
 * runner: the FSE'26 parser consulted it, while the RCAEval parser kept a hand-written PAIR
 * (`mode === 'novelty' ? 'novelty' : 'count'`) and so replaced the other four members with
 * `count` in silence. A dispatch asking for `all` therefore ran `count` and printed a
 * confident number for a configuration nobody had asked for — the same defect the FSE'26 side
 * records having closed, left open one module away. One union, one owner.
 */
export const LOG_SIGNAL_MODES: Readonly<Record<LogSignalMode, true>> = {
  count: true,
  novelty: true,
  logicHttp: true,
  logicHttpJoint: true,
  logicHttpDominant: true,
  all: true,
};

/**
 * Whether a raw argument names a log-signal mode.
 *
 * `hasOwnProperty.call` rather than `in`: a `Record` is an object, so the prototype chain makes
 * `toString`, `constructor` and `__proto__` reachable and `in` would accept all three — and
 * `toString` is a token a dispatch can really send.
 */
export function isLogSignalMode(value: string): value is LogSignalMode {
  return Object.prototype.hasOwnProperty.call(LOG_SIGNAL_MODES, value);
}

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
/**
 * Level 1 of the log gate: whether a mode's SOURCE-SIGNATURE filter admits one row.
 *
 * Exported as a pure function of `(mode, log)` so the rule has ONE owner. The scorer below calls it, and so does
 * the benchmark census that attributes an empty log TIER (`benchmarks/src/log-route.ts`), because "the tier is
 * empty" has four mechanisms and the second of them is exactly this function returning false for every row. A
 * census that re-spelled the rule — "admit it if `isLogicException`" — would be a second answer to a question
 * this repository has already had answered twice in the same shape (`--log-signal-mode` accepting two of the six
 * modes; the latency views spelled at three call sites), and it would be free to drift from the scorer.
 *
 * `count` admits self-caused logic exceptions. `logicHttp`, `logicHttpJoint` and `logicHttpDominant` admit logic
 * exceptions PLUS framework HTTP exceptions — both are source signatures. `all` admits every ERROR/FATAL row, so
 * a source that floods a propagated HTTP error still scores.
 *
 * @param mode - The scoring mode, whose filter this is.
 * @param log - One log row.
 * @returns Whether level 1 admits the row. Level 2 may still withdraw an HTTP row — see `computeLogScores`.
 */
export function logLineAdmittedByMode(mode: LogSignalMode, log: FaultLogEntry): boolean {
  if (mode === 'all') return true;
  if (log.isLogicException === true) return true;
  if (log.isHttpException === true) {
    return mode === 'logicHttp' || mode === 'logicHttpJoint' || mode === 'logicHttpDominant';
  }
  return false;
}

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
  // Level 1 is `logLineAdmittedByMode` above — a module-level export rather than
  // a closure here, because the benchmark census that attributes an empty log
  // tier must read the SAME rule; the split into levels is why its counts can
  // say "retained but not admitted" as a state distinct from "not addressable".
  //
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
    if (!logLineAdmittedByMode(mode, log)) continue;
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
 * Compute the topological-source score for each service: `1 − maxCalleeExplanation`,
 * where `maxCalleeExplanation(v)` is the largest `propagationWeight(v→c) × anomaly(c)`
 * over v's **callees**.
 *
 * The intuition: an edge `v → c` means `v` CALLS `c`, and a fault at `c` makes
 * `v` wait — so a node whose anomaly is strongly explained by an already-anomalous
 * CALLEE is a caller reacting to it, i.e. a symptom, while a node whose callees are
 * healthy is a candidate source. Both terms are bounded, so the explanation is
 * clamped to [0, 1]: a callee with anomaly 1 and edge weight 1 fully explains its
 * caller.
 *
 * ### The direction was the other way round, and the direction is what was wrong
 *
 * This function explained the CHILD by its PARENT — the caller by its callee's
 * caller, so to speak — for the whole life of the term, and its own option
 * docblock carried the caveat: *"The direction of the call-graph edges is a known
 * assumption to validate via ablation — resource faults can propagate callee →
 * caller, in which case this directed penalty would misfire."* It does misfire, and
 * the direction has now been measured rather than argued. On RCAEval
 * RE1-OnlineBoutique (125 cases, one variable):
 *
 * | direction | weight 0.1 | 0.2 | 0.5 | 1 | 2 |
 * | --- | ---: | ---: | ---: | ---: | ---: |
 * | caller explains callee (the old code) | — | — | **57.6** | 50.4 | 40.0 |
 * | **callee explains caller (this code)** | **85.6** | 84.8 | 82.4 | 80.0 | 77.6 |
 * | shipped (weight 0) | 82.4 at every weight | | | | |
 *
 * The old direction costs **24.8 pp at weight 0.5**; the corrected one costs nothing
 * at that weight and reads **+3.2 pp at 0.1** — with no fault type regressed
 * (cpu 92.0, delay 92.0, disk 100.0, loss 48.0, mem 96.0 against 92.0 / 88.0 / 92.0 /
 * 48.0 / 92.0). It also explains the FSE'26 verdict this term carries: **−42.4 /
 * −37.8 / −3.1 cases** on three suites, measured with the sign that this table says
 * is backwards.
 *
 * The correction is behaviour-NEUTRAL in the shipped configuration because the
 * weight is `DEFAULT_TOPO_WEIGHT = 0`, so no published cell moves; a weight above
 * zero is a separate decision and is dispatched separately.
 *
 * @param edges - Call graph edges (caller → callee).
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
    const calleeAnomaly = anomalyScores.get(edge.to) ?? 0;
    const weight = propagationWeights[i] ?? 0;
    const explanation = calleeAnomaly * weight;
    const prev = maxExplanation.get(edge.from) ?? 0;
    if (explanation > prev) maxExplanation.set(edge.from, explanation);
  }

  const scores = new Map<ServiceId, number>();
  for (const [nodeId] of anomalyScores) {
    const explained = Math.min(1, maxExplanation.get(nodeId) ?? 0);
    scores.set(nodeId, 1 - explained);
  }
  return scores;
}

/**
 * The fewest samples a latency channel needs before it can carry a level at each end.
 *
 * Six, because the estimator reads a THIRD at each end and neither window may be smaller than two
 * samples: a one-sample "level" is the two-sample reading the transient guard already paid for
 * (`docs/transient-guard-window.md`), and at six samples the two thirds are `[0,2)` and `[4,6)`.
 */
export const SELF_TIME_MIN_SAMPLES = 6;

/**
 * The share of a service's OWN transport disturbance that nothing downstream can explain.
 *
 * ## The defect this measures
 *
 * A caller's response time CONTAINS its callees'. When a fault makes a callee slow, the caller's
 * own latency metric rises with it — and on RCAEval's rank-normalised graphs the caller then
 * outranks the service that actually broke. The measurement that named the mechanism is
 * `docs/transient-guard-window.md` §4: on `adservice_disk_1` the winner `cartservice` — a CALLER —
 * carries `latency-90` at 25.89× against the truth's `cpu` at 14.35×, and the seventeen cases the
 * window estimator lost were eleven single-rank-step losses caused by restoring the caller's
 * channel. The guard had been damping that advantage as a side effect; this term replaces the side
 * effect with a mechanism.
 *
 * ## The statistic
 *
 * ```
 *   L(v)       = log₁₀(1 + (post(v) − pre(v)) / pre(v))     over v's latency channels, max
 *   inherited  = max over callees c of L(c)
 *   share(v)   = max(0, L(v) − inherited) / L(v)            ∈ [0, 1]
 * ```
 *
 * This is the transport counterpart of a **collision source**: in Deng Yu's picture a disturbance is
 * *created* at a point and carried along the transport afterwards, so the observable question is not
 * how far a node moved but how much of its movement nothing upstream of the transport can account
 * for. A leaf scores `1` whenever it moved, and that is the definition rather than the degree
 * artefact `topoSource` inherits — a service that calls nothing has no callee whose time its own
 * response time could contain.
 *
 * ## Why this is not a closed row
 *
 * `topoSource` and its mirror (Direction 2, `docs/reverse-propagation-falsified.md`) both read TOTAL
 * anomaly and both answer "is this node explained by a neighbour", which their own falsification
 * shows cannot be right: a source's neighbours are anomalous in both directions, so any
 * explained-by-a-neighbour test discounts the source. This statistic is not that test. It is defined
 * on the TRANSPORT channel alone, it asks a question with a physical answer (`response time ≥
 * inherited response time`), and it is a SHARE rather than a signed bonus, so a node's own quiet
 * resource channels neither help nor hurt it.
 *
 * ## The estimator, and why it is not the engine's deviation
 *
 * `deviation` exists only for metrics the guards KEPT, and the guard deletes the propagation-symptom
 * latency channels — including, on fourteen RE1 failure blocks, the faulted service's own. A
 * relational measure that reads an absent level as 0 reports the CALLER's whole rise as self-created
 * on exactly the cases it exists for. So the level is estimated from the raw series with a median of
 * the first and last thirds, and a node whose level is unknown is ABSENT rather than zero: the term
 * contributes nothing where it cannot see. The median is what makes a 721-sample window's two ends a
 * measurement of a level; the same estimator was REFUSED as a guard trigger because a guard needs an
 * ABSOLUTE judgement, while a share compares two nodes measured identically and the common-mode error
 * cancels in the ratio.
 *
 * @param edges - Call graph edges (caller → callee).
 * @param metrics - Raw per-service metric series, the same map the anomaly features read.
 * @param minSamples - Series floor; defaults to {@link SELF_TIME_MIN_SAMPLES}.
 * @returns Per-service share in [0, 1]. A service is ABSENT when it carries no measurable latency
 *   channel, or when any callee it has carries none — a caller with one undecidable callee cannot be
 *   judged, because that callee may be the one it inherited from.
 */
export function computeSelfTimeScores(
  edges: readonly CallEdge[],
  metrics: MetricMap,
  minSamples = SELF_TIME_MIN_SAMPLES,
): Map<ServiceId, number> {
  const levels = new Map<ServiceId, number>();
  for (const [serviceId, seriesList] of metrics) {
    let best: number | undefined;
    for (const ts of seriesList) {
      if (!isLatencyMetric(ts.label)) continue;
      const level = latencyLevel(ts.values, minSamples);
      if (level === undefined) continue;
      if (best === undefined || level > best) best = level;
    }
    if (best !== undefined) levels.set(serviceId, best);
  }
  if (levels.size === 0) return new Map();

  const inherited = new Map<ServiceId, number>();
  const undecided = new Set<ServiceId>();
  for (const edge of edges) {
    const calleeLevel = levels.get(edge.to);
    if (calleeLevel === undefined) {
      undecided.add(edge.from);
      continue;
    }
    const previous = inherited.get(edge.from);
    if (previous === undefined || calleeLevel > previous) {
      inherited.set(edge.from, calleeLevel);
    }
  }

  const scores = new Map<ServiceId, number>();
  for (const [serviceId, level] of levels) {
    if (undecided.has(serviceId)) continue;
    // No callee at all is a MEASURED zero inheritance, not a missing one: this is the leaf case.
    const downstream = inherited.get(serviceId) ?? 0;
    if (level <= 0) {
      scores.set(serviceId, 0);
      continue;
    }
    const created = level - downstream;
    scores.set(serviceId, created > 0 ? created / level : 0);
  }
  return scores;
}

/**
 * The transport level of one latency channel: `log₁₀(1 + rise)`, or `undefined` when the window
 * cannot carry one.
 *
 * @param values - The channel's samples.
 * @param minSamples - Series floor.
 * @returns The level (0 for a fall or a flat series), or `undefined` for an unusable channel.
 * @internal
 */
function latencyLevel(values: Float64Array, minSamples: number): number | undefined {
  const n = values.length;
  const width = Math.max(2, Math.floor(n / 3));
  // Two non-overlapping thirds, and never fewer samples than the declared floor.
  if (n < minSamples || n < 2 * width) return undefined;
  const pre = medianOfRange(values, 0, width);
  const post = medianOfRange(values, n - width, n);
  // A non-positive pre-fault level has no relative rise — the idle-percentile artifact
  // `near-zero-rise-suppression-falsified.md` documents. It carries no level, rather than a big one.
  // Written as `!(pre > 0)` rather than `pre <= 0` so the NaN arm is the same arm: `NaN <= 0` is false,
  // which would let an unusable channel through to a comparison it cannot win.
  if (!(pre > 0)) return undefined;
  const rise = (post - pre) / pre;
  // A FALL creates nothing: the share measures disturbance a node created, and a service that got
  // faster while its peers broke did not create any. The finiteness guard is load-bearing rather than
  // defensive: a pre-fault level small enough to be positive yet denormal makes the ratio overflow to
  // `Infinity`, and a share of `Infinity` poisons every score in the case rather than scoring one.
  return rise > 0 && Number.isFinite(rise) ? Math.log10(1 + rise) : 0;
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
 * The metric family whose rise is a SHARED-RESOURCE symptom rather than a
 * service's own work: the DB connection pool.
 *
 * Carries its trailing DOT, because the separator is what makes the match a family
 * instead of a prefix coincidence: without it a series named
 * `db.client.connectionsTotal` would be classified as a pool measurement, and the
 * position of the boundary would be decided by whatever a future converter happens
 * to call an unrelated series.
 *
 * The single owner of the family. The offline pre-screen that measured this signal
 * (`benchmarks/src/fse26-term-oracle.ts`) imports it rather than restating it: a
 * screen that validates a different family than the engine penalises is a screen
 * that validates nothing.
 */
export const POOL_METRIC_PREFIX = 'db.client.connections.';

/**
 * The DB-connection-pool dominance indicator: 1 when the metric that won a
 * service's anomaly maximum is a connection-pool series, 0 otherwise.
 *
 * ## Why this is a signal and not a metric guard
 *
 * A pool's `use_time`/`wait_time` maxima are the largest numbers any service
 * carries in this benchmark and they rise for every service sharing the
 * saturated database, so the series wins a service's anomaly maximum whenever
 * contention exists — including for services that are only WAITING. The census
 * over the shipped dump's 672 misses says exactly that: **128 wrong rank-1
 * winners have a pool-dominant anomaly against 48 ground-truth sources** (a
 * margin of +80, the largest winner-side margin of any family).
 *
 * The term is therefore a PENALTY ON THE EVIDENCE, and it is neither of the two
 * metric-layer shapes already closed in the register:
 *
 * - not a transform of the score — it is a function of WHICH series won, so it
 *   is constant across a service's anomaly magnitude and cannot be written as a
 *   reshaping of it (a service at 0.9 and one at 0.3 with the same dominant
 *   series receive the same value);
 * - not an input ablation — nothing is removed, so a service whose SECOND
 *   metric would have taken the case over keeps its score. That takeover is
 *   exactly why dropping the pool LABEL recovered only 2 of the 56 cases its
 *   bound predicted (`docs/fse26-httpnet-miss-verdict.md`).
 *
 * An unmeasured dominance is 0, never 1: a service with no attributable metric
 * carries no evidence that it is pool-dominant, and defaulting it to the
 * penalised state would subtract from a service the engine never scored.
 *
 * @param dominantMetrics - Per-service dominant metric (label + head/tail).
 * @param nodeIds - Services present in the call graph.
 * @returns Per-service indicator in {0, 1}; empty when no dominance was measured.
 */
export function computePoolMetricScores(
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
    const label = dominantMetrics.get(nodeId)?.label ?? '';
    scores.set(nodeId, label.startsWith(POOL_METRIC_PREFIX) ? 1 : 0);
  }
  return scores;
}

/**
 * The decisive-stability prior: how STEADY each service's dominant metric is, RANKED within the case.
 *
 *   score(v) = (n − 1 − rank(v)) / (n − 1),   rank ascending in the dominant metric's `cv` BONUS
 *
 * The direction is the separator's own (`docs/fse26-separator-verdict.md` §6.2): across the miss
 * pairs the true source's decisive metric is the LESS dispersed one, AUC 0.718 on the
 * inventory-matched stratum. The window solved over all 1422 cases of run `35107871516` gains six
 * cases and loses none (`docs/fse26-cv-screen.md` §4).
 *
 * RANKED rather than linear in the bonus, and that is not a preference: `MetricBreakdown.cv` is
 * `cv > 0.5 ? min(cv, 1.5) × 0.05 : 0`, a CLAMPED bonus confined to `{0} ∪ [0.025, 0.075]`, with
 * 43.6% of services on one of the two endpoints. Its magnitude carries two bits of information and
 * its order carries the rest, so a magnitude-shaped sibling would be a different term on the same
 * three values.
 *
 * Tie groups share the AVERAGE of the ranks they occupy — the same rule `rankNormalizeScores`
 * applies to tied anomaly scores, so two services this statistic cannot separate are not separated
 * by whichever one a sort happened to leave first. A service whose dominant metric carries no
 * composition is ABSENT from the result rather than present with 0: `undefined` is not a measured
 * `cv` of zero, and the bonus IS zero for a fifth of the services whose raw cv is at or below 0.5.
 *
 * @param dominantMetrics - Per-service dominant metric, of which only `breakdown.cv` is read.
 * @param nodeIds - Services present in the call graph.
 * @returns Per-service score in [0, 1]; empty when fewer than two services were measured, because
 *   one bonus is not a comparison.
 */
export function computeStabilityScores(
  dominantMetrics:
    ReadonlyMap<ServiceId, { readonly breakdown?: { readonly cv: number } }> | undefined,
  nodeIds: ReadonlySet<ServiceId>,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!dominantMetrics || nodeIds.size === 0) return scores;
  const measured: { readonly id: ServiceId; readonly cv: number }[] = [];
  for (const nodeId of nodeIds) {
    const cv = dominantMetrics.get(nodeId)?.breakdown?.cv;
    if (cv === undefined || !Number.isFinite(cv)) continue;
    measured.push({ id: nodeId, cv });
  }
  const n = measured.length;
  if (n < 2) return scores;
  const ascending = [...measured].sort((a, b) => a.cv - b.cv);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && ascending[j + 1]!.cv === ascending[i]!.cv) j++;
    const shared = (n - 1 - (i + j) / 2) / (n - 1);
    for (let k = i; k <= j; k++) scores.set(ascending[k]!.id, shared);
    i = j + 1;
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
 * the other causal priors already rank such cases. The four thresholds are
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
  /**
   * Minimum `growth / drift` — how many times the FLEET's own median move the
   * candidate has to rise — for the vote to be cast. Default 2; `0` disables
   * the test, so `growth / drift >= 0` holds always.
   *
   * A rise is evidence only against a baseline, and until this option existed
   * the only baseline was the absolute threshold above. That made the vote deaf
   * to the one thing the measured corpus actually separates on: the fleet's own
   * move. On the twenty-one TrainTicket/OnlineBoutique RE3 votes the rise does
   * NOT separate the hits from the misses — 1.16 appears on both sides — while
   * the fleet's median move does, by a factor of more than five:
   *
   * - 15 hits: `growth` 1.17–2.22 with the fleet at `drift` 0.05–0.11, so the
   *   candidate rose 10.6–38.2 times the fleet's median. Every service around
   *   it collapsed; this one did more work per request. That is the signature.
   * - 6 misses: `growth` 1.15–1.47 with the fleet at 0.79–1.04, so the quotient
   *   is 1.15–1.85. Nothing distinguishes the candidate from ordinary churn —
   *   the "unique riser" is the ordinary spread of a busy fleet.
   *
   * The second population is not hypothetical: four of the five TrainTicket
   * misses are `ts-station-service` on route faults, and two of those six cases
   * had the truth at rank 2, i.e. the wrong vote was the ONLY thing between the
   * engine and a correct answer. A term that charges a full unit for a rise the
   * fleet also made is charging for noise.
   *
   * `2` is the smallest integer above the largest measured miss (1.85) and well
   * below the smallest measured hit (10.56); every value in [2, 10] classifies
   * all twenty-one votes identically, and a four-floor sweep at
   * 2/3/5/8 returned byte-identical vote counts. The value is therefore an
   * interpolation across a 5.7× gap, not a fit to the sample.
   */
  readonly minFleetShare: number;
}

/** Default thresholds for {@link computeTraceActivityScores}. */
export const DEFAULT_TRACE_ACTIVITY_OPTIONS: TraceActivityOptions = {
  minPreCount: 500,
  minPostCount: 1,
  riseThreshold: 1.15,
  minFleetShare: 2,
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
 * The unique candidate must then also clear `minFleetShare`: its growth divided
 * by the FLEET's median growth (`drift`, the unweighted median of `post / pre`
 * over every measured member — the same estimator the `[trace-z]` instrument
 * reports) must be at least the configured factor. This is the third term of
 * one test rather than a second mechanism: "did it rise" (absolute),
 * "did anything else rise" (uniqueness), "did it rise more than the fleet"
 * (contrast). Uniqueness alone is the weak form of the third — it asks only
 * whether a second service crossed a FIXED threshold, which on a churning fleet
 * is a coin flip, and the measurement says exactly that: the five TrainTicket
 * route misses all have a unique riser and all have it wrong.
 *
 * The contrast is skipped when `drift` is not positive, which happens only when
 * at least half the measured fleet emitted nothing after the injection. The
 * quotient has no rate to divide by there, and a service that rose while the
 * fleet went to zero is the one case where the absolute rise is all the
 * evidence there is. No vote in the measured corpus takes this arm.
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

  const { minPreCount, minPostCount, riseThreshold, minFleetShare } = {
    ...DEFAULT_TRACE_ACTIVITY_OPTIONS,
    ...options,
  };

  let candidate: ServiceId | undefined;
  let candidateCount = 0;
  let candidateGrowth = 0;
  for (const nodeId of nodeIds) {
    const c = counts.get(nodeId);
    if (!c) continue;
    if (c.pre < minPreCount || c.post < minPostCount) continue;
    if (c.pre <= 0) continue;
    const growth = c.post / c.pre;
    if (growth < riseThreshold) continue;
    candidateCount++;
    candidate = nodeId;
    candidateGrowth = growth;
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

  // CONTRAST gate: a rise is evidence only against the fleet that did not rise.
  // `drift` is the unweighted median of `post / pre` over the measured members,
  // which is the estimator the `[trace-z]` instrument reports for the same
  // case, so the two cannot disagree about what the fleet did. A candidate that
  // rose no more than the fleet's median move is ordinary churn wearing the
  // rise's clothes, and the measured corpus has six of those.
  const drift = traceFleetDrift(counts, nodeIds);
  if (drift > 0 && candidateGrowth / drift < minFleetShare) return scores;

  scores.set(candidate, 1);
  return scores;
}

/**
 * The fleet's common-mode drift: the unweighted median of `post / pre` over
 * every graph member that emitted a span before the injection.
 *
 * One observation per SERVICE and not per span, so a single service's deviation
 * — however large that service is — moves the estimate by one vote. A volume
 * ratio (`Σpost / Σpre`) would let the fault's own service, which on TrainTicket
 * carries a large share of the fleet's spans, absorb its own fall into the
 * denominator.
 *
 * The population and both exclusions are the ones the `[trace-z]` instrument
 * applies, and this function is that instrument's estimator rather than a copy
 * of it: `traceSignificanceOf` calls it, so the vote and the artifact printed
 * beside it cannot disagree about what the fleet did. A service the graph does
 * not carry cannot be ranked, so measuring it here would let an unrankable
 * service move every ranked one's baseline; and `post / 0` is not a level of
 * anything, so a member without a baseline carries no estimate to vote with.
 *
 * @param counts - Per-service pre/post span counts; absent or empty means no
 *   trace file was read.
 * @param nodeIds - Services present in the call graph.
 * @returns The median ratio, or `NaN` when no member carries a pre-injection
 *   baseline. `NaN` rather than `0`: a fleet with no rate and a fleet that
 *   stopped are different findings, and only the second is a level.
 */
export function traceFleetDrift(
  counts: ReadonlyMap<ServiceId, TraceActivityCounts> | undefined,
  nodeIds: ReadonlySet<ServiceId>,
): number {
  if (counts === undefined) return Number.NaN;
  const ratios: number[] = [];
  for (const nodeId of nodeIds) {
    const c = counts.get(nodeId);
    if (c === undefined || c.pre <= 0) continue;
    ratios.push(c.post / c.pre);
  }
  if (ratios.length === 0) return Number.NaN;
  return medianOfRange(Float64Array.from(ratios), 0, ratios.length);
}

/**
 * Failed-edge-DIRECTION signal: the callee of a failed call is the candidate,
 * the caller is only where the error was reported.
 *
 * The log signal rewards whoever EMITS an error. When a service is broken, the
 * services that call it are the ones that log — so on a propagation-carrying
 * fault the log signal points at a VICTIM. This signal is its inverse: for each
 * edge `caller → callee` it charges the failures to the CALLEE, so the service
 * whose interface is failing collects the evidence.
 *
 * The count per edge is `failed − baseline`, clamped at zero, where both counts
 * are measured on the SAME edge over the post- and pre-injection windows. Two
 * properties follow, and both are load-bearing:
 *
 * - Subtracting the baseline removes edges that were ALREADY broken before the
 *   injection. A permanently failing dependency is a deployment property, and
 *   charging it to the callee would make a pre-existing defect look like this
 *   fault's signature.
 * - Clamping at zero keeps the signal a non-negative REWARD. A broken edge that
 *   got better after injection must not hand its callee a penalty, because the
 *   weight is defined as a reward and a negative term would be an unexplained
 *   second mechanism inside one switch.
 *
 * The result is max-normalised into [0, 1] like the log signal, so the two
 * weights are directly comparable and the score is invariant under the
 * absolute call volume of the case.
 *
 * @param edges - Per-edge failed-call counts (undefined → empty → neutral).
 * @param nodeIds - Services present in the call graph; an edge to any other
 *   service is ignored, including in the normalisation denominator, because
 *   the engine can only rank nodes it has metrics for.
 * @returns Sparse `{callee: score}` map, or empty when no edge carries
 *   post-injection failures beyond its own baseline.
 */
export type FailedEdgeMode = 'sum' | 'mean';

/**
 * The shipped aggregation of {@link FailedEdgeMode}, which is `'sum'`.
 *
 * This is the strongest member of the class `docs/ranking-default-owners.md` records, and it is the one whose
 * owner was in the WRONG PACKAGE. `'sum'` was declared in **four** files — this module's own function default
 * (below), the engine's defaults table, the FSE'26 runner's option object (where it was exported as
 * `DEFAULT_FAILED_EDGE_MODE`, a name in the package that does not own the value), and the workflow's
 * `failed_edge_mode` description — so a reader could reach a name for it and still not reach the owner.
 *
 * `'mean'` divides a callee's net failures by its contributing edges, which is the aggregation that makes the
 * signal comparable across fan-in; the axis is measured and closed (`fse26-failed-edge-verdict.md`: the
 * direction signal gains +5.8pp but regresses two fault types, and the weight is SOLVED rather than swept —
 * the 62 cases it fixes need `w ≥ 0.580` while the 5 it breaks tolerate `w ≤ 0.261`, so no weight exists).
 * The mode is a property of the SIGNAL rather than of its weight, and the shipped value is the one every
 * measurement was taken with.
 */
export const DEFAULT_FAILED_EDGE_MODE: FailedEdgeMode = 'sum';

/**
 * The shipped floor of {@link computeFailedEdgeScores}, which is `1`.
 *
 * Declared here rather than beside the weight because this module is where the floor is DEFAULTED (the
 * function's own parameter) and `pruner.ts` already imports FROM this module — a constant placed in
 * `pruner.ts` could only be read back through a cycle. It was a bare `1` here AND in the engine's defaults
 * table AND in the FSE'26 runner's option object AND in that runner's malformed-argument fallback: four sites,
 * which is the `docs/ranking-default-owners.md` class at its worst.
 *
 * One is the floor the signal shipped with rather than a round number: a single failed call is not a pattern
 * (see the function's own note), so the floor exists to require repetition, and `1` is its minimum.
 */
export const DEFAULT_FAILED_EDGE_MIN_RECORDS = 1;

/**
 * Failed-edge-DIRECTION signal: the callee of a failed call is the candidate,
 * the caller is only where the error was reported.
 *
 * The log signal rewards whoever EMITS an error. When a service is broken, the
 * services that call it are the ones that log — so on a propagation-carrying
 * fault the log signal points at a VICTIM. This signal is its inverse: for each
 * edge `caller -> callee` it charges the failures to the CALLEE, so the service
 * whose interface is failing collects the evidence.
 *
 * The count per edge is `failed - baseline`, clamped at zero, where both counts
 * are measured on the SAME edge over the post- and pre-injection windows. Two
 * properties follow, and both are load-bearing:
 *
 * - Subtracting the baseline removes edges that were ALREADY broken before the
 *   injection. A permanently failing dependency is a deployment property, and
 *   charging it to the callee would make a pre-existing defect look like this
 *   fault's signature.
 * - Clamping at zero keeps the signal a non-negative REWARD. A broken edge that
 *   got better after injection must not hand its callee a penalty, because the
 *   weight is defined as a reward and a negative term would be an unexplained
 *   second mechanism inside one switch.
 *
 * ## Why there are two aggregations
 *
 * `sum` is the direct reading and is the one that measured +5.8pp Top@1 — but it
 * cost two fault types, and the mechanism is visible in the totals: the FSE'26
 * cache carries ~211 net failures PER EDGE (1,013,406 over 4,805 records), so a
 * raw sum is dominated by how much traffic a service receives rather than by
 * whether it broke. A high-traffic SYMPTOM whose callers time out can therefore
 * out-accumulate the actual source.
 *
 * `mean` divides each callee's net failures by the number of DISTINCT callers that
 * saw failures against it, removing that fan-in/volume amplification. It is the
 * ablation switch for exactly that question, and it is noise-sensitive at low
 * counts (one caller with one failure scores as high as one with two hundred),
 * which is the measured risk rather than a reason to prefer it a priori.
 *
 * ## `mean` is now measured, and is WORSE — do not flip the default
 *
 * Matched pair, one commit and one cache, weight 1, only the mode changed (runs
 * `34766439438` and `34766441691`): `sum` 53.1% Top@1 with 755 correct,
 * `mean` 51.6% with 734 — **−1.5pp**. `mean` also did NOT repair the two fault
 * types that `sum` costs: `JVMMemoryStress` (1/171) and
 * `HTTPResponsePatchBody` (1/4) are identical under both. So the hypothesis is
 * refuted — a raw sum is not being dominated by traffic — and removing the
 * amplification only loses cases. The mode is retained, fully tested and off by
 * default, as the recorded answer to that question rather than a live option.
 *
 * @param edges - Per-edge failed-call counts (undefined -> empty -> neutral).
 * @param nodeIds - Services present in the call graph; an edge with EITHER
 *   endpoint outside it is ignored, including in the normalisation denominator,
 *   because the engine can only rank nodes it has metrics for.
 * @param mode - `sum` (default, the measured one) or `mean` (fan-in normalised).
 * @param minRecords - Minimum number of contributing edges a callee needs before
 *   it is credited at all. Default 1 (today's behaviour). The FSE'26 measurement
 *   found why a floor matters: five regressions all had a winner with exactly ONE
 *   contributing record, and max-normalisation turns that single record into the
 *   full weight, so one failed call — a timeout, a retry — purchases the signal
 *   and outranks a source whose own anomaly is maximal. One event is not a
 *   pattern; the same reason `computeTraceActivityScores` guards on span counts.
 * @returns Sparse `{callee: score}` map, or empty when no edge carries
 *   post-injection failures beyond its own baseline.
 */
export function computeFailedEdgeScores(
  edges: ReadonlyArray<FaultFailedEdge> | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  mode: FailedEdgeMode = DEFAULT_FAILED_EDGE_MODE,
  minRecords = DEFAULT_FAILED_EDGE_MIN_RECORDS,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!edges || edges.length === 0 || nodeIds.size === 0) return scores;

  const net = new Map<ServiceId, number>();
  // Contributing edges per callee: the evidence VOLUME behind a callee's score,
  // which `minRecords` gates. Counted after the same filters that build `net`,
  // so the guard and the score cannot disagree about what counted.
  const records = new Map<ServiceId, number>();
  // Distinct callers per callee. Only needed for `mean`, but tracked
  // unconditionally so the two modes cannot disagree about which edges counted.
  const callers = new Map<ServiceId, Set<ServiceId>>();

  for (const edge of edges) {
    // A `null`/`undefined` count out of a JSON tuple would make the difference
    // NaN, and NaN propagates through `Math.max` into every score, silently
    // poisoning the sort comparator. Drop the malformed edge instead.
    if (!Number.isFinite(edge.failed) || !Number.isFinite(edge.baseline)) continue;
    // A self-call carries no direction: it says the service's own calls
    // failed, not that anything upstream or downstream broke.
    if (edge.caller === edge.callee) continue;
    // BOTH endpoints must be rankable, the same invariant `buildFSE26CallGraph`
    // applies to trace edges. Checking only the callee would let a service with
    // no metric series — typically the load generator — pour its whole synthetic
    // failure volume into a callee's sum while contributing no caller to the
    // `mean` divisor, which is exactly the traffic distortion `mean` exists to
    // remove.
    if (!nodeIds.has(edge.caller) || !nodeIds.has(edge.callee)) continue;
    const contribution = Math.max(0, edge.failed - edge.baseline);
    if (contribution <= 0) continue;

    net.set(edge.callee, (net.get(edge.callee) ?? 0) + contribution);
    records.set(edge.callee, (records.get(edge.callee) ?? 0) + 1);
    const seen = callers.get(edge.callee);
    if (seen) {
      seen.add(edge.caller);
    } else {
      callers.set(edge.callee, new Set([edge.caller]));
    }
  }

  if (net.size === 0) return scores;

  const aggregate = new Map<ServiceId, number>();
  let max = 0;
  // Iterate the caller sets rather than the sums: a callee is in `net` exactly
  // when it has a caller set, and a caller set always has at least one member,
  // so the divisor is >= 1 by construction and needs no fallback that coverage
  // could never reach.
  for (const [callee, who] of callers) {
    // A callee with too little evidence is not credited AT ALL: it stays out of
    // the map, so its term is 0 rather than a fabricated score. Filtering here
    // (rather than in the loop above) means the dropped callee also leaves the
    // normalisation denominator — otherwise the services that remain would be
    // rescaled against evidence the signal refused to use.
    // `records` is filled in the same branch as `callers`, so every callee here
    // has an entry — no fallback, and none that coverage could never reach.
    if (records.get(callee)! < minRecords) continue;
    const value = mode === 'mean' ? net.get(callee)! / who.size : net.get(callee)!;
    aggregate.set(callee, value);
    if (value > max) max = value;
  }

  // `max > 0` whenever `aggregate` is non-empty (every inserted contribution is
  // positive, and `mean` divides by a caller count >= 1), and an empty
  // `aggregate` skips the loop entirely — so the division below never sees a
  // zero denominator and never emits NaN.
  for (const [callee, value] of aggregate) {
    scores.set(callee, value / max);
  }
  return scores;
}

/** One callee's inbound latency observation: the largest rise, and how many edges produced it. */
export interface InboundLatency {
  readonly rise: number;
  readonly count: number;
}

/**
 * Aggregate `post / pre` per CALLEE over the edges an acceptance predicate keeps.
 *
 * A callee is credited on its LARGEST inbound rise, never its mean: one caller going from 1 ms to
 * 2 s is the signal, and averaging it against twenty unchanged callers would bury it.
 *
 * The predicate is the parameter rather than a filter applied afterwards because the two differ.
 * Dropping a row after aggregation removes a callee but not the influence of that row on a
 * surviving callee's MAXIMUM — so a filtered-after map would still carry an out-of-graph caller's
 * rise, which is exactly the leak the term's own filter exists to prevent.
 *
 * @param edges - Per-edge latency records.
 * @param accept - Whether this row may contribute.
 * @returns The aggregation, empty when no row was accepted.
 * @internal
 */
function aggregateInboundLatency(
  edges: ReadonlyArray<FaultEdgeLatency>,
  accept: (edge: FaultEdgeLatency) => boolean,
): Map<ServiceId, InboundLatency> {
  const byCallee = new Map<ServiceId, InboundLatency>();
  for (const row of edges) {
    if (!accept(row)) continue;
    const previous = byCallee.get(row.callee);
    const rise = row.postMeanMs / row.preMeanMs;
    byCallee.set(row.callee, {
      rise: previous === undefined ? rise : Math.max(previous.rise, rise),
      count: (previous?.count ?? 0) + 1,
    });
  }
  return byCallee;
}

/**
 * Per-callee inbound latency rise, **RAW** — the observable the `lat` term is a shape over, and
 * the quantity the diagnostic dump renders as `latRise` / `latEdges`.
 *
 * Accepts EVERY row. That is the diagnostic's population by construction (it reads
 * `benchCase.edgeLatency` with no filter), and the gate that decides whether the failed-edge
 * direction term may act reads this map — so the number the engine decides on is the number the
 * artifact prints. A second, differently-filtered derivation would let the benchmark's measurement
 * and the engine's behaviour be about two quantities that merely share a name.
 *
 * NOT a ranking term: no `log1p`, no floor mask, no max-normalisation. Those belong to
 * {@link computeEdgeLatencyScores}, and a decision made in the dump's own units cannot read them —
 * rank normalisation puts the top candidate at the maximum of the term's range whatever the
 * input was, which is why a saturated term cannot be read to decide whether to trust it.
 *
 * @param edges - Per-edge latency records, or `undefined` when not recorded.
 * @returns The per-callee maximum rise with its contributing-edge count; empty when absent.
 */
export function computeEdgeLatencyByCallee(
  edges: ReadonlyArray<FaultEdgeLatency> | undefined,
): Map<ServiceId, InboundLatency> {
  if (edges === undefined || edges.length === 0) return new Map();
  return aggregateInboundLatency(edges, () => true);
}

/**
 * The case's own strongest inbound rise — the CHAMPION a fleet-relative gate is a share of.
 *
 * ## Why this is a function of the map rather than a second pass over the edges
 *
 * The gate that decides whether the failed-edge direction term may act reads `computeEdgeLatencyByCallee`,
 * the raw observable. A champion derived from `edgeLatency` directly would be a second implementation of
 * one statistic, and the two would agree until one of them was edited — the defect this repository names
 * as its oldest family. So this reads the map the decision already reads.
 *
 * ## Why the guards are on the VALUE and not on the map
 *
 * `rise` is `postMeanMs / preMeanMs`, so a callee whose pre-window mean is zero yields `Infinity`, and a
 * row carrying a `NaN` propagates one through `Math.max`. Both are bars no rise can be compared against:
 * `Infinity` would refuse every candidate and `NaN` would make every comparison false — two different
 * refusals that look like one. Dropping them is not a tolerance; it is the statement that a rise which is
 * not a positive finite number was not a measurement, and an unmeasured case has no champion at all
 * (`undefined`) rather than a champion of 0.
 *
 * @param byCallee - The raw per-callee inbound rises, or `undefined` when the case carried none.
 * @returns The largest positive finite rise, or `undefined` when nothing measurable was recorded.
 */
export function maxInboundRise(
  byCallee: ReadonlyMap<ServiceId, InboundLatency> | undefined,
): number | undefined {
  if (byCallee === undefined) return undefined;
  let max: number | undefined;
  for (const { rise } of byCallee.values()) {
    if (!Number.isFinite(rise) || rise <= 0) continue;
    if (max === undefined || rise > max) max = rise;
  }
  return max;
}

/**
 * Per-callee inbound latency rise, max-normalised into [0, 1].
 *
 * The CONTINUOUS counterpart of {@link computeFailedEdgeScores}. That one counts
 * FAILURES, so a call that became slow but still succeeded is invisible to it —
 * and so is a case where no call failed at all, which is 70 of the 291
 * silent-source cases. Duration is what the CALLER recorded about the callee, so
 * this carries the same direction and is defined exactly where the counts are
 * zero.
 *
 * Measured on FSE'26: a JVM memory-stress source's inbound rise is 3.574 at the
 * median and 14.79 at p90, against a ReplaceCode source's 0.976, and ranking on
 * this term alone reaches 33.3% on that block against a shipped 2.3%. It is inert
 * on ReplaceCode (source 0.976 vs winner 0.975), so it is a term for the
 * silent-source faults rather than a repair for that type.
 *
 * Three shape decisions:
 *
 * - a callee is credited on its LARGEST inbound rise, not its mean: one caller
 *   going from 1 ms to 2 s is the signal, and averaging it against twenty
 *   unchanged callers would bury it;
 * - the rise is compressed with `log1p(max(0, r − 1))` before normalising,
 *   because the measured range spans 0.3 to 2048 and a linear scale would let one
 *   pathological caller own every case;
 * - an edge with an endpoint outside the graph, or a self-call, is ignored —
 *   same rule as the failed-edge signal, and for the same reason: an unrankable
 *   service must not enter the normalisation every candidate is scored against.
 *
 * @param edges - Per-edge latency records, or `undefined` when not recorded.
 * @param nodeIds - The in-graph services.
 * @returns Normalised scores. A callee with no usable measurement is ABSENT from
 *   the map rather than present with a 0, so the term is 0 for it without
 *   fabricating a measurement that was never taken.
 */
export function computeEdgeLatencyScores(
  edges: ReadonlyArray<FaultEdgeLatency> | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  minRise = 1,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (edges === undefined || edges.length === 0) return scores;

  // The RANKING term's population: both endpoints rankable, no self-call, a finite positive
  // baseline. The raw observable below keeps the diagnostic's wider population — see
  // `computeEdgeLatencyByCallee` for why the two are not the same set and must not be merged.
  const rise = new Map<ServiceId, number>();
  for (const [callee, { rise: value }] of aggregateInboundLatency(edges, (edge) => {
    if (!nodeIds.has(edge.caller) || !nodeIds.has(edge.callee)) return false;
    if (edge.caller === edge.callee) return false;
    if (!Number.isFinite(edge.preMeanMs) || !Number.isFinite(edge.postMeanMs)) return false;
    // A non-positive baseline would divide to Infinity. The converter already
    // excludes it; the guard is here so a hand-built case cannot poison the
    // case maximum and thereby rescale every other candidate.
    return edge.preMeanMs > 0;
  })) {
    rise.set(callee, value);
  }
  if (rise.size === 0) return scores;

  let max = 0;
  const compressed = new Map<ServiceId, number>();
  for (const [callee, value] of rise) {
    // The floor is applied to the callee's MAXIMUM rise, not per edge: the signal
    // credits the largest rise over a callee's inbound edges, so a floor applied
    // earlier would let a callee's noisiest edge decide whether it is rankable.
    //
    // It is a MASK, not a compression, and that distinction is the whole point. It
    // removes rises strictly between 1 and `minRise`, so the surviving maximum is
    // always the case maximum, the divisor never moves, and no slope is ever raised.
    // Two consequences follow: the term can only ever lose votes, and it cannot
    // remove a spurious COMPETITOR without removing that same service as a CREDITEE.
    // A rise at or below 1 is never dropped — such a callee is present with magnitude
    // 0, exactly as the shipped shape has it, which is what makes `minRise = 1`
    // identical to the shipped term.
    if (value > 1 && value < minRise) continue;
    const magnitude = Math.log1p(Math.max(0, value - 1));
    compressed.set(callee, magnitude);
    if (magnitude > max) max = magnitude;
  }
  // Every measurable edge got FASTER, so there is no rise to normalise against.
  // Crediting nobody is the correct reading; dividing by a zero maximum would
  // emit NaN into every final score in the case instead.
  if (max <= 0) return scores;

  for (const [callee, value] of compressed) scores.set(callee, value / max);
  return scores;
}
