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

import type { CallEdge, FaultLogEntry, ServiceId } from '@agentix-e/micro-kinetic-core';

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
  const idf = (cls: string): number => Math.log(1 + n / (1 + (df.get(cls) ?? 0)));

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
 * Compute the directional-source score for each service: the (max-normalised)
 * softplus of the difference between the fraction of a node's ANOMALOUS
 * children and the fraction of its ANOMALOUS parents.
 *
 * ## Motivation
 *
 * `computeTopoSourceScores` only looks UPSTREAM — it rewards a node with no
 * anomalous parent, but ignores whether the node actually PROPAGATES its fault
 * downstream. A directional signal (TraceRCA's `in_out_diff`) separates the
 * three roles in the anomalous subgraph:
 *
 * - **Source**: anomalous children (its fault spreads outward), healthy parents
 *   → `out ≫ in`.
 * - **Middle symptom**: anomalous children AND an anomalous parent → `out ≈ in`.
 * - **Leaf symptom (sink)**: anomalous parent, no anomalous children → `in ≫
 *   out`.
 *
 * ## Why a BINARY anomaly flag (not magnitude)
 *
 * Using the raw anomaly MAGNITUDE would re-introduce the exact failure this
 * signal exists to fix: in a code-level fault the anomaly magnitude grows
 * monotonically toward the collapse (source rise 0.35 → leaf collapse 1.0), so
 * a magnitude-based `out − in` would crown the leaf's PARENT, not the source.
 * Binarising "anomalous" (vs the per-case median) collapses that gradient to
 * the structural question that actually matters — *who is the source of the
 * anomalous subgraph?* — and is insensitive to the rise/collapse asymmetry.
 *
 * ## Formula
 *
 * Let `τ = median(anomalyScores)` (a data-driven threshold, no magic constant)
 * and `a(v) = 𝟙[anomaly(v) > τ]`. With fan-out `d⁺(v)` and fan-in `d⁻(v)`:
 *
 * ```
 * out(v) = (1 / d⁺(v)) · Σ_{v→u} a(u)      (0 when d⁺ = 0)
 * in(v)  = (1 / d⁻(v)) · Σ_{p→v} a(p)      (0 when d⁻ = 0)
 * raw(v) = softplus(out(v) − in(v))          = ln(1 + e^{out − in})
 * ```
 *
 * Fan-normalisation makes the score insensitive to degree (a hub with many
 * anomalous children does not automatically out-rank a single-child source).
 * `softplus` is log-concave, positive-definite and smooth, so the score decays
 * gracefully from a strong source (`out − in = 1`) down to a sink (`= −1`).
 * The map is max-normalised to [0, 1] exactly as the log signal is.
 *
 * @param edges - Call graph edges (parent → child).
 * @param anomalyScores - Per-service anomaly score in [0, 1].
 * @returns Per-service directional-source score in [0, 1]; empty when no node
 *   carries an anomaly (or the graph has no edges).
 */
export function computeDirectionSourceScores(
  edges: readonly CallEdge[],
  anomalyScores: ReadonlyMap<ServiceId, number>,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (anomalyScores.size === 0) return scores;

  // Data-driven anomaly threshold: the per-case median anomaly. Services at or
  // below the median are "normal", above it are "anomalous".
  const values = [...anomalyScores.values()].sort((x, y) => x - y);
  const mid = values.length >> 1;
  const threshold = values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
  const isAnomalous = (id: ServiceId): number => ((anomalyScores.get(id) ?? 0) > threshold ? 1 : 0);

  const outSum = new Map<ServiceId, number>();
  const outDeg = new Map<ServiceId, number>();
  const inSum = new Map<ServiceId, number>();
  const inDeg = new Map<ServiceId, number>();

  for (const edge of edges) {
    const childFlag = isAnomalous(edge.to);
    const parentFlag = isAnomalous(edge.from);
    outSum.set(edge.from, (outSum.get(edge.from) ?? 0) + childFlag);
    outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1);
    inSum.set(edge.to, (inSum.get(edge.to) ?? 0) + parentFlag);
    inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1);
  }

  const raw = new Map<ServiceId, number>();
  let max = 0;
  for (const [nodeId] of anomalyScores) {
    const dOut = outDeg.get(nodeId) ?? 0;
    const dIn = inDeg.get(nodeId) ?? 0;
    const avgOut = dOut > 0 ? (outSum.get(nodeId) ?? 0) / dOut : 0;
    const avgIn = dIn > 0 ? (inSum.get(nodeId) ?? 0) / dIn : 0;
    const r = Math.log(1 + Math.exp(avgOut - avgIn));
    raw.set(nodeId, r);
    if (r > max) max = r;
  }

  // Every node has softplus ≥ ln 2 > 0, so max > 0 whenever the map is non-empty.
  for (const [nodeId] of anomalyScores) {
    scores.set(nodeId, (raw.get(nodeId) ?? 0) / max);
  }
  return scores;
}
