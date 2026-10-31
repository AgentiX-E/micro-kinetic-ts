/**
 * PRISM (Graph-Free Root Cause Analysis) — faithful reimplementation.
 *
 * Reproduces the method of Luan Pham, arXiv:2601.21359 ("Graph-Free Root
 * Cause Analysis", Jan 2026) so we can run a head-to-head comparison on the
 * SAME 735 RCAEval cases our engine already evaluates. PRISM is graph-free:
 * it needs only per-service metrics and the fault injection time.
 *
 * The core insight is an internal/external asymmetry:
 *   - a root cause is anomalous in BOTH internal properties (cpu / memory /
 *     disk I/O / socket count) AND external properties (response time /
 *     error rate / throughput);
 *   - an affected (downstream) component is anomalous in external properties
 *     ONLY, because faults propagate through observable interfaces and do not
 *     penetrate internal state.
 *
 * Algorithm (Section 3 of the paper):
 *   1. Classify each metric as internal or external.
 *   2. Score each metric with a deviation-based anomaly scorer
 *      S(P) = |mean_fault − mean_baseline| / scale (z-score).
 *   3. Pool per-component: S^I = max over internal, S^E = max over external.
 *   4. Combine (additive, the paper's default):
 *        M(C) = S^I + S^E − log(1 + S^I + S^E)
 *      (conjunctive alternative: M(C) = min(S^I, S^E)).
 *   5. Rank components by M descending; the top component is the root cause.
 *
 * The scoring primitives (channel classification, deviation z-score, and the
 * M-score combination) are the shared source of truth in
 * `@agentix-e/micro-kinetic-core` (`anomaly/prism`), so the standalone
 * evaluator here and the ranking-fusion signal in the tree engine never
 * drift apart. This module only adds the per-component pooling and ranking
 * on top of those primitives.
 *
 * This module is an independent baseline evaluator. It does NOT touch the
 * production ranking pipeline (TreePruner).
 *
 * @module benchmarks/leaderboard/prism
 */

import {
  classifyMetricChannel,
  combinePrismScore,
  deviationZScore,
  type MetricChannel,
  type PrismPooling,
} from '@agentix-e/micro-kinetic-core';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// Re-export the shared primitives so the benchmark barrel remains the single
// import site for PRISM without exposing which package owns the formula.
export { classifyMetricChannel, combinePrismScore, deviationZScore };
export type { MetricChannel, PrismPooling };

/** PRISM's per-component score. */
export interface PrismServiceScore {
  /** Service (component) id. */
  readonly serviceId: string;
  /** Internal anomaly score S^I (max over internal properties). */
  readonly internalScore: number;
  /** External anomaly score S^E (max over external properties). */
  readonly externalScore: number;
  /** Final root-cause score M (additive or conjunctive). */
  readonly score: number;
}

/**
 * Rank services by PRISM's root-cause score, descending.
 *
 * The returned array is ordered so that `[0]` is PRISM's predicted root
 * cause. Ties are broken deterministically by service id so the ranking is
 * stable across runs.
 *
 * @param metrics - Per-service time series, keyed by service id.
 * @param injectTimeMs - Fault injection time (Unix ms).
 * @param opts.pooling - Combination function; `additive` (paper default) or
 *   `conjunctive`.
 */
export function computePrismRanking(
  metrics: ReadonlyMap<string, readonly TimeSeries[]>,
  injectTimeMs: number,
  opts?: { readonly pooling?: PrismPooling },
): readonly PrismServiceScore[] {
  const pooling: PrismPooling = opts?.pooling ?? 'additive';

  const scores: PrismServiceScore[] = [];
  for (const [serviceId, series] of metrics) {
    let internalScore = 0;
    let externalScore = 0;
    for (const ts of series) {
      const s = deviationZScore(ts, injectTimeMs);
      if (classifyMetricChannel(ts.label) === 'internal') {
        if (s > internalScore) internalScore = s;
      } else if (s > externalScore) {
        externalScore = s;
      }
    }

    const score = combinePrismScore(internalScore, externalScore, pooling);

    scores.push({ serviceId, internalScore, externalScore, score });
  }

  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break. Service ids are unique Map keys, so the
    // two-way comparison is total (no equal-id branch is reachable).
    return a.serviceId < b.serviceId ? -1 : 1;
  });

  return scores;
}

/**
 * Convenience: PRISM's Top-1 predicted root cause for a case, or `undefined`
 * when the case carries no metrics.
 */
export function prismTop1(
  metrics: ReadonlyMap<string, readonly TimeSeries[]>,
  injectTimeMs: number,
  opts?: { readonly pooling?: PrismPooling },
): string | undefined {
  return computePrismRanking(metrics, injectTimeMs, opts)[0]?.serviceId;
}
