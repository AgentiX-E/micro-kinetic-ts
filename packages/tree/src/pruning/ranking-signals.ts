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
 */
export type LogSignalMode = 'count' | 'novelty';

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
 * The signal therefore counts only lines flagged `isLogicException` (self-caused)
 * and ignores connectivity/other errors. A resource cascade with no logic
 * exceptions yields an empty map (neutral); a code-level fault concentrates the
 * count on the source.
 *
 * @param logs - Raw log lines (may be undefined → empty map).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @param mode - Scoring mode (`count` default; `novelty` for IDF weighting).
 * @returns Per-service log score in [0, 1]; empty when no signal.
 */
export function computeLogScores(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
  mode: LogSignalMode = 'count',
): Map<ServiceId, number> {
  if (mode === 'novelty') return computeLogNoveltyScores(logs, nodeIds, injectTimeMs);

  const scores = new Map<ServiceId, number>();
  if (!logs || logs.length === 0 || nodeIds.size === 0) return scores;

  // Count only SELF-CAUSED logic exceptions per service, filtered by time and
  // membership. Connectivity exceptions (propagated cascade noise) and non-
  // error lines are ignored — they would misfire max-count onto symptoms.
  const counts = new Map<ServiceId, number>();
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    if (!log.isLogicException) continue;
    counts.set(log.service, (counts.get(log.service) ?? 0) + 1);
  }

  // No self-caused logic errors → no signal (a resource cascade is neutral).
  if (counts.size === 0) return scores;

  let max = 0;
  for (const count of counts.values()) {
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
 * ONLY about the candidate itself, never about unrelated graph services. When
 * the unique riser is a member of `logicExceptionServices` (it emitted a
 * self-caused logic exception), that service is NOT silent — the log signal
 * (always on) already ranks it — and the vote is suppressed.
 *
 * The gate is deliberately PER-CANDIDATE rather than case-level. The previous
 * case-level gate (`hasLogicExceptionEvidence: boolean`) suppressed the vote
 * whenever ANY graph service threw, which is precisely wrong for the silent
 * wrong-value fault (TrainTicket RE3 f2): there the SOURCE
 * (`ts-auth-service`) is silent, while a DOWNSTREAM WRAPPER
 * (`ts-order-other-service`) throws `IllegalArgumentException: Invalid UUID
 * string`. The wrapper's exception is a SYMPTOM of the wrong value, not
 * evidence the case is non-silent — yet the case-level gate used it to
 * suppress the ONLY signal that names the source. The per-candidate gate
 * votes the silent riser and only defers when the riser ITSELF threw.
 *
 * @param counts - Per-service pre/post span counts (may be undefined → empty).
 * @param nodeIds - Services present in the call graph.
 * @param options - Threshold overrides (merged over the defaults).
 * @param logicExceptionServices - The set of services that emitted a
 *   self-caused logic exception. Suppresses the vote ONLY when the unique
 *   significant riser is itself a member. Default empty.
 * @returns Sparse `{service: 1}` map, or empty when no unique significant riser
 *   or when the unique riser itself threw a logic exception.
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
  // The per-candidate gate is applied to the WINNER only — a throwing riser is
  // still counted toward uniqueness, so a throwing-riser + silent-riser pair
  // stays neutral rather than collapsing into a single (possibly wrong) vote.
  if (candidateCount === 1 && candidate !== undefined) {
    // A riser that itself threw a logic exception is not silent — the log
    // signal already ranks it, so defer rather than double-reward.
    if (!logicExceptionServices.has(candidate)) {
      scores.set(candidate, 1);
    }
  }
  return scores;
}
