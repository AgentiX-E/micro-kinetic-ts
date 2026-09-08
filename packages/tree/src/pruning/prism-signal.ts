/**
 * PRISM ranking-fusion signal.
 *
 * Fuses PRISM's graph-free internal/external asymmetry (arXiv:2601.21359)
 * into the collision-tree engine as an eighth ranking prior. PRISM localises
 * the root cause from per-service metric time series ALONE — no topology — so
 * it is genuinely complementary to the topology-aware collision/topo/trace
 * signals: it sees a root cause as anomalous in BOTH internal properties
 * (cpu / memory / disk / socket) AND external properties (latency / error /
 * throughput), while a downstream symptom is external-only.
 *
 * The signal is deliberately INDEPENDENT of the engine's anomaly scoring:
 * it reuses the shared PRISM primitives from `@agentix-e/micro-kinetic-core`
 * (`classifyMetricChannel`, `deviationZScore`, `combinePrismScore`) rather than
 * the engine's own deviation/trend/cv/burst feature pipeline, so it contributes
 * a signal the engine's self-anomaly term cannot already see.
 *
 * ## Formula
 *
 * For each graph member v:
 *
 *   S^I(v) = max over internal metrics  of |mean_fault − mean_baseline|/scale
 *   S^E(v) = max over external metrics of |mean_fault − mean_baseline|/scale
 *   M(v)   = combinePrismScore(S^I(v), S^E(v), pooling)
 *   prismScore(v) = M(v) / max_w M(w)   ∈ [0, 1]
 *
 * The map is MAX-NORMALISED to [0, 1] (like the log/topo signals) so the
 * fusion weight is dimensionally comparable to the other priors. It is EMPTY
 * (neutral) when the injection time is unknown or when no service carries any
 * deviation — the caller then contributes nothing, exactly as the other
 * opt-in signals do.
 *
 * @module pruning/prism-signal
 */

import type { ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import {
  classifyMetricChannel,
  combinePrismScore,
  deviationZScore,
  type PrismPooling,
} from '@agentix-e/micro-kinetic-core';

/**
 * Compute the PRISM root-cause score for each graph member, max-normalised to
 * [0, 1].
 *
 * Restricted to `nodeIds` (a metric series for a service absent from the call
 * graph cannot contribute a ranking signal) and gated on a known injection
 * time (PRISM needs the clean pre-injection baseline to split the windows).
 * A graph member with no metrics, or with only flat metrics, scores 0 against
 * its anomalous peers; when NO member is anomalous the map is empty (neutral).
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param nodeIds - Services present in the call graph.
 * @param injectTimeMs - Fault injection time (Unix ms; 0 = unknown → empty).
 * @param pooling - Combination function (`additive` default; `conjunctive`
 *   gates an external-only symptom to 0).
 * @returns Per-service PRISM score in [0, 1]; empty when no signal.
 */
export function computePrismScores(
  metrics: ReadonlyMap<ServiceId, readonly TimeSeries[]>,
  nodeIds: ReadonlySet<ServiceId>,
  injectTimeMs: number,
  pooling: PrismPooling = 'additive',
): Map<ServiceId, number> {
  const scores = new Map<ServiceId, number>();
  // PRISM needs the injection instant to split the clean pre-fault baseline
  // from the post-fault observation; without it every metric reads as
  // all-post-injection (empty baseline) and deviationZScore returns 0, so the
  // signal would be a pointless constant. Return neutral instead.
  if (injectTimeMs <= 0 || metrics.size === 0 || nodeIds.size === 0) return scores;

  const raw = new Map<ServiceId, number>();
  let max = 0;
  for (const nodeId of nodeIds) {
    const series = metrics.get(nodeId);
    if (!series || series.length === 0) continue;
    let internal = 0;
    let external = 0;
    for (const ts of series) {
      const s = deviationZScore(ts, injectTimeMs);
      if (classifyMetricChannel(ts.label) === 'internal') {
        if (s > internal) internal = s;
      } else if (s > external) {
        external = s;
      }
    }
    const m = combinePrismScore(internal, external, pooling);
    raw.set(nodeId, m);
    if (m > max) max = m;
  }

  // No member carries any deviation — nothing to discriminate, stay neutral.
  if (max <= 0) return scores;

  for (const nodeId of nodeIds) {
    scores.set(nodeId, (raw.get(nodeId) ?? 0) / max);
  }
  return scores;
}
