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
 * This module is an independent baseline evaluator. It does NOT touch the
 * production ranking pipeline (TreePruner).
 *
 * @module benchmarks/leaderboard/prism
 */

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

/** Which PRISM property class a metric belongs to. */
export type MetricChannel = 'internal' | 'external';

/** PRISM's component-level score combination function. */
export type PrismPooling = 'additive' | 'conjunctive';

/**
 * Classify a metric name as an internal or external property.
 *
 * Internal properties are local resource states not directly observable by
 * other components: CPU usage, memory utilization, disk I/O, and socket
 * count. External properties are observable at component boundaries:
 * response time (latency/delay), error rate, throughput/workload, and
 * network loss. The classification is keyword-based and case-insensitive so
 * it is robust to the varied metric-name spellings across RCAEval systems
 * (`cpu`, `cpu_usage`, `memory_rss_bytes`, `disk_write_iops`, `socket_count`,
 * `latency_ms`, `error_rate`, `throughput`, `workload`, `loss`).
 */
export function classifyMetricChannel(metricName: string): MetricChannel {
  const lower = metricName.toLowerCase();
  if (
    lower.includes('cpu') ||
    lower.includes('mem') ||
    lower.includes('memory') ||
    lower.includes('disk') ||
    lower.includes('socket')
  ) {
    return 'internal';
  }
  // Everything else is boundary-observable: latency/delay, error, loss,
  // throughput, workload, request/response counts.
  return 'external';
}

/**
 * Deviation-based anomaly score for a single metric time series.
 *
 * Uses the pre-injection window as the reference distribution and the
 * post-injection window as the fault observation. The score is the absolute
 * standardized mean shift (a robust z-score / Cohen's-d form):
 *
 *   S(P) = |mean_fault − mean_baseline| / scale
 *
 * where `scale` is the baseline standard deviation when it is positive,
 * otherwise the baseline mean magnitude (a relative change) when non-zero,
 * and otherwise 1 (absolute change — the degenerate exactly-zero baseline).
 *
 * Returns 0 when either window is empty (no change to measure).
 */
export function deviationZScore(ts: TimeSeries, injectTimeMs: number): number {
  const { timestamps, values } = ts;
  let baseSum = 0;
  let baseCount = 0;
  let faultSum = 0;
  let faultCount = 0;

  for (let i = 0; i < values.length; i++) {
    // `timestamps` and `values` are aligned by construction, so the `!`
    // non-null assertions are safe within the `i < values.length` bound.
    const t = timestamps[i]!;
    const v = values[i]!;
    if (t < injectTimeMs) {
      baseSum += v;
      baseCount++;
    } else {
      faultSum += v;
      faultCount++;
    }
  }

  if (baseCount === 0 || faultCount === 0) return 0;

  const baseMean = baseSum / baseCount;
  const faultMean = faultSum / faultCount;

  // Standard deviation over the baseline window.
  let varSum = 0;
  for (let i = 0; i < values.length; i++) {
    const t = timestamps[i]!;
    if (t < injectTimeMs) {
      const d = values[i]! - baseMean;
      varSum += d * d;
    }
  }
  const std = Math.sqrt(varSum / baseCount);

  let scale: number;
  if (std > 1e-9) {
    scale = std;
  } else if (Math.abs(baseMean) > 1e-9) {
    scale = Math.abs(baseMean);
  } else {
    scale = 1;
  }

  return Math.abs(faultMean - baseMean) / scale;
}

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

    const sum = internalScore + externalScore;
    const score =
      pooling === 'conjunctive' ? Math.min(internalScore, externalScore) : sum - Math.log1p(sum);

    scores.push({ serviceId, internalScore, externalScore, score });
  }

  scores.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break.
    return a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0;
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
