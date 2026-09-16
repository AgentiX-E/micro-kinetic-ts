/**
 * PRISM graph-free root-cause scoring primitives.
 *
 * Faithful reimplementation of the method of Luan Pham, arXiv:2601.21359
 * ("Graph-Free Root Cause Analysis", Jan 2026). PRISM localises the root
 * cause from per-service metric time series alone — no call-graph topology —
 * so these primitives are the single source of truth shared by:
 *
 * - the standalone head-to-head evaluator (`kinetic/benchmarks/leaderboard/prism.ts`),
 * - the ranking signal fused into the collision-tree engine (`tree/pruning/prism-signal.ts`).
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
 *
 * These primitives are PURE functions over {@link TimeSeries} and numbers: no
 * engine state, no topology, no I/O. They live in core because the `tree`
 * package depends only on core (never on `kinetic`), and the ranking fusion
 * needs them without introducing a cyclic dependency.
 *
 * @module anomaly/prism
 */

import type { TimeSeries } from '../types/time-series.js';

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
 *
 * @param metricName - Raw metric label.
 * @returns `internal` for resource-state metrics, `external` otherwise.
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
 *
 * @param ts - The metric series (timestamps in Unix ms, aligned with values).
 * @param injectTimeMs - Fault injection time (Unix ms); splits base/fault windows.
 * @returns The standardized mean shift (≥ 0).
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

/**
 * Combine a component's pooled internal and external anomaly scores into the
 * PRISM root-cause score M(C).
 *
 * This is the SINGLE source of truth for the paper's combination step, shared
 * by the standalone evaluator and the ranking-fusion signal so the two can
 * never drift apart:
 *
 * - `additive` (paper default): `M = S^I + S^E − log(1 + S^I + S^E)`. The
 *   `−log(1+·)` term is a sub-linear dampener: it preserves the monotone
 *   reward for being anomalous in BOTH channels while softening the
 *   contribution of a single very large score (so a massive external-only
 *   symptom does not swamp a genuine internal+external source).
 * - `conjunctive`: `M = min(S^I, S^E)`. A component is a root cause only if
 *   it is anomalous in BOTH channels, so the score is gated by the weaker
 *   channel — an external-only symptom scores 0.
 *
 * @param internalScore - Pooled internal anomaly score S^I (≥ 0).
 * @param externalScore - Pooled external anomaly score S^E (≥ 0).
 * @param pooling - Combination function (`additive` default).
 * @returns The component's PRISM score M(C) (≥ 0).
 */
export function combinePrismScore(
  internalScore: number,
  externalScore: number,
  pooling: PrismPooling = 'additive',
): number {
  if (pooling === 'conjunctive') return Math.min(internalScore, externalScore);
  const sum = internalScore + externalScore;
  return sum - Math.log1p(sum);
}
