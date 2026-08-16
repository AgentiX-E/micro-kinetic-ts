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
 * Compute the log signal score for each service: the ERROR/FATAL volume
 * emitted at/after the fault injection time, normalised by the maximum count.
 *
 * The count is restricted to services present in `nodeIds` (a log line for a
 * service absent from the call graph cannot contribute a ranking signal) and,
 * when `injectTimeMs` is known, to lines emitted at/after that instant (a
 * pre-existing error storm is part of the normal regime, not the fault).
 *
 * Normalisation is `count(v) / maxCount`, so the top erroring service scores
 * 1, zero-error services score 0, and a lone erroring service scores 1 against
 * its silent peers — which is exactly the code-level-fault signature (only the
 * faulting service emits stack traces).
 *
 * ## Code-level gate
 *
 * Error VOLUME alone is not a reliable source/symptom discriminator: in a
 * resource/network fault (RCAEval RE2) the SYMPTOM services flood ERROR logs
 * (a "connection refused" / "timeout" cascade), so max-count would boost the
 * symptom. A code-level fault (RE3) instead emits STACK TRACES concentrated in
 * the source. The signal is therefore gated: it is only emitted when at least
 * one ERROR/FATAL line carries a stack-trace signature (`isStackTrace`), i.e.
 * when there is code-level-fault evidence. Otherwise the map is empty and the
 * caller treats the log signal as neutral, avoiding the cascade regression.
 *
 * @param logs - Raw log lines (may be undefined → empty map).
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (0 = unknown → no time filter).
 * @returns Per-service log score in [0, 1]; empty when no signal.
 */
export function computeLogScores(
  logs: readonly FaultLogEntry[] | undefined,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  if (!logs || logs.length === 0 || nodeIds.size === 0) return scores;

  // Count ERROR/FATAL lines per service, filtered by time and membership.
  // Track whether any surviving error line is a stack trace — the gate that
  // distinguishes a code-level fault from a resource/network cascade.
  const counts = new Map<ServiceId, number>();
  let stackTraceCount = 0;
  for (const log of logs) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    if (!nodeIds.has(log.service)) continue;
    if (injectTimeMs > 0 && log.timestamp < injectTimeMs) continue;
    counts.set(log.service, (counts.get(log.service) ?? 0) + 1);
    if (log.isStackTrace) stackTraceCount++;
  }

  // No error logs, or no code-level evidence (stack trace) → no signal. The
  // latter is deliberate: without a stack trace the errors are most likely a
  // resource/network cascade, where max-count would misfire onto symptoms.
  if (counts.size === 0 || stackTraceCount === 0) return scores;

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
