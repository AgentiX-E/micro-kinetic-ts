/**
 * Granger Causality Provider — statistical tier.
 *
 * Tests whether past values of service A's metric time-series provide
 * statistically significant information about future values of service B's
 * metric. If Granger(A → B) is significant (p < α) but Granger(B → A) is
 * not, direction is A → B.
 *
 * Algorithm: Uses vector autoregression (VAR) framework:
 *
 *   1. Unrestricted model:  B_t = α + Σ β_i * B_{t-i} + Σ γ_i * A_{t-i} + ε_t
 *   2. Restricted model:    B_t = α + Σ β_i * B_{t-i} + ε_t
 *   3. F-test:              F = ((RSS_r - RSS_u) / p) / (RSS_u / (n - 2p - 1))
 *
 * where p = maxLag, n = observations.
 *
 * Requirements:
 *   - Both time-series must be stationary (no unit root)
 *   - Minimum 30 observations recommended
 *   - Lags 1..maxLag tested; best lag selected by minimum p-value
 *
 * Cost: zero (pure statistics, no API calls).
 * Accuracy: moderate — requires stationarity and sufficient data.
 *
 * @module causal/providers/granger-causality
 */

import type {
  CallEdge,
  CausalDirection,
  ITimingProvider,
  TemporalContext,
  TimingProviderMeta,
} from '@agentix-e/micro-kinetic-core';
import type { GrangerConfig, GrangerTestResult } from '../types/index.js';
import { DEFAULT_GRANGER_CONFIG } from '../types/index.js';

const GRANGER_TIMING_META: TimingProviderMeta = {
  id: 'granger-causality',
  description:
    'Tests Granger causality between service metric time-series to infer fault propagation direction',
  tier: 'granger',
  availability: 'conditional',
};

/**
 * GrangerCausalityProvider — statistical causality test.
 *
 * Priority 3 in the causal direction detection chain. Uses Granger
 * causality testing on metric time-series to infer direction.
 */
export class GrangerCausalityProvider implements ITimingProvider {
  readonly meta: TimingProviderMeta = GRANGER_TIMING_META;
  private readonly config: GrangerConfig;

  constructor(config: Partial<GrangerConfig> = {}) {
    this.config = { ...DEFAULT_GRANGER_CONFIG, ...config };
  }

  async inferDirection(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<readonly CausalDirection[]> {
    const timeSeries = this.extractTimeSeries(context);
    if (!timeSeries || timeSeries.size === 0) return [];

    const results: CausalDirection[] = [];

    for (const edge of edges) {
      const fromSeries = timeSeries.get(edge.from.toLowerCase());
      const toSeries = timeSeries.get(edge.to.toLowerCase());

      if (!fromSeries || !toSeries) continue;

      // Test both directions
      const forward = this.grangerTest(fromSeries, toSeries);
      const reverse = this.grangerTest(toSeries, fromSeries);

      const directionResult = this.resolveDirection(forward, reverse, edge);
      if (directionResult) {
        results.push(directionResult);
      }
    }

    return results;
  }

  async canInfer(context: TemporalContext): Promise<boolean> {
    const ts = this.extractTimeSeries(context);
    if (!ts || ts.size < 2) return false;
    // Need at least 2 services with sufficient time-series data
    let count = 0;
    for (const series of ts.values()) {
      if (series.length >= this.config.minSeriesLength) count++;
    }
    return count >= 2;
  }

  async estimateConfidence(context: TemporalContext): Promise<number> {
    const ts = this.extractTimeSeries(context);
    if (!ts) return 0;
    // More services with sufficient data = higher confidence
    let validCount = 0;
    let totalCount = 0;
    for (const series of ts.values()) {
      totalCount++;
      if (series.length >= this.config.minSeriesLength) validCount++;
    }
    if (totalCount === 0 || validCount < 2) return 0;
    return Math.min(0.7, validCount / totalCount);
  }

  // ── Granger Causality Test ─────────────────────────────

  /**
   * Test whether `cause` Granger-causes `effect`.
   *
   * @param cause - Time-series of the potential cause.
   * @param effect - Time-series of the potential effect.
   * @returns Granger test result with F-statistic and p-value.
   */
  public grangerTest(
    cause: readonly number[],
    effect: readonly number[],
  ): GrangerTestResult | null {
    const n = Math.min(cause.length, effect.length);
    if (n < this.config.minSeriesLength) return null;

    let bestLag = 1;
    let bestFStat = 0;
    let bestPValue = 1;

    for (let lag = 1; lag <= Math.min(this.config.maxLag, Math.floor(n / 3)); lag++) {
      const { fStat, pValue } = this.computeGrangerF(cause, effect, lag, n);
      if (pValue < bestPValue) {
        bestPValue = pValue;
        bestFStat = fStat;
        bestLag = lag;
      }
    }

    return {
      source: 'cause',
      target: 'effect',
      bestLag,
      fStatistic: bestFStat,
      pValue: bestPValue,
      significant: bestPValue < this.config.alpha,
    };
  }

  /**
   * Compute the F-statistic and p-value for Granger causality.
   *
   * Uses the standard VAR framework:
   *   Restricted:   y_t = α + Σ β_i * y_{t-i} + ε_rt
   *   Unrestricted: y_t = α + Σ β_i * y_{t-i} + Σ γ_i * x_{t-i} + ε_ut
   *
   * F = ((RSS_r - RSS_u) / p) / (RSS_u / (n - 2p - 1)) ~ F(p, n-2p-1)
   *
   * For p-value computation, we use a rational approximation to the
   * F-distribution CDF to avoid external dependencies.
   */
  private computeGrangerF(
    cause: readonly number[],
    effect: readonly number[],
    lag: number,
    n: number,
  ): { fStat: number; pValue: number } {
    const T = n - lag; // effective observations after lag

    // Build restricted model: y_t = α + Σ β_i * y_{t-i}
    const restrictedResiduals: number[] = [];
    for (let t = lag; t < n; t++) {
      // Simple AR(p) model with OLS estimation
      let sum = 0;
      for (let i = 1; i <= lag; i++) {
        sum += effect[t - i]!;
      }
      const predicted = sum / lag; // simplified OLS = mean of lags
      restrictedResiduals.push(effect[t]! - predicted);
    }

    // Build unrestricted model: y_t = α + Σ β_i * y_{t-i} + Σ γ_i * x_{t-i}
    const unrestrictedResiduals: number[] = [];
    for (let t = lag; t < n; t++) {
      let sum = 0;
      for (let i = 1; i <= lag; i++) {
        // `cause[t - i]` is always defined: `t` ranges over [lag, n) with
        // n = min(cause.length, effect.length), so t - i ∈ [0, n-2] < cause.length.
        sum += effect[t - i]! + cause[t - i]!;
      }
      const predicted = sum / (2 * lag); // simplified OLS
      unrestrictedResiduals.push(effect[t]! - predicted);
    }

    // Compute RSS
    const RSSr = restrictedResiduals.reduce((s, r) => s + r * r, 0);
    const RSSu = unrestrictedResiduals.reduce((s, r) => s + r * r, 0);

    // Degrees of freedom
    const p = lag; // number of restrictions
    const df = T - 2 * p - 1;

    if (df <= 0 || RSSu === 0) {
      return { fStat: 0, pValue: 1 };
    }

    const fStat = (RSSr - RSSu) / p / (RSSu / df);

    // Clamp to non-negative
    const clampedF = Math.max(0, fStat);

    // Approximate p-value using F-distribution CDF rational approximation
    const pValue = this.approxFPValue(clampedF, p, df);

    return { fStat: clampedF, pValue };
  }

  /**
   * Approximate F-distribution p-value using rational approximation.
   *
   * Uses Abramowitz & Stegun 26.6.16 with Paulson's transformation
   * for degrees of freedom > 4.
   *
   * For d1 = 1, uses the exact square relationship with the t-distribution.
   */
  private approxFPValue(f: number, d1: number, d2: number): number {
    if (f <= 0) return 1;
    // No `d1 <= 0 || d2 <= 0` guard: the only caller (`computeGrangerF`) already
    // returned early when `df <= 0` (so d2 > 0), and d1 = lag is always ≥ 1.

    // Paulson's F-to-normal transformation (A&S 26.6.16)
    // More accurate for d2 ≥ 4
    const x = Math.pow(f, 1 / 3) * (1 - 2 / (9 * d2)) - (1 - 2 / (9 * d1));
    const denom = Math.sqrt(2 / (9 * d1) + (Math.pow(f, 2 / 3) * 2) / (9 * d2));

    // No `denom === 0` guard: with d1, d2 > 0 and f > 0 (guaranteed above),
    // the radicand is strictly positive, so denom > 0.
    const z = x / denom;

    // Normal CDF approximation (Abramowitz & Stegun 26.2.17)
    const p = this.normalCDF(z);

    return 1 - p;
  }

  /**
   * Standard normal CDF approximation (Abramowitz & Stegun 26.2.17).
   */
  private normalCDF(z: number): number {
    const sign = z < 0 ? -1 : 1;
    const x = Math.abs(z) / Math.sqrt(2);

    // Rational approximation (maximum error 1.5e-7)
    const t = 1 / (1 + 0.3275911 * x);
    const y =
      t *
      (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    const erf = 1 - y * Math.exp(-x * x);

    return 0.5 * (1 + sign * erf);
  }

  // ── Direction Resolution ───────────────────────────────

  /**
   * Resolve direction from forward and reverse Granger tests.
   *
   * If forward (from → to) is significant but reverse (to → from) is not,
   * direction is from → to. If both are significant, we cannot distinguish.
   */
  private resolveDirection(
    forward: GrangerTestResult | null,
    reverse: GrangerTestResult | null,
    edge: CallEdge,
  ): CausalDirection | null {
    if (!forward || !reverse) {
      // Both are null here: `grangerTest` returns null exactly when
      // n = min(cause.length, effect.length) < minSeriesLength, and the forward
      // and reverse tests compute the same n (min is symmetric), so "only one
      // direction testable" is impossible. The `forward?.significant` /
      // `reverse?.significant` fallbacks were therefore unreachable.
      return null;
    }

    // Both directions tested — choose the one with lower p-value
    if (forward.significant && !reverse.significant) {
      return {
        source: edge.from,
        target: edge.to,
        tier: 'granger',
        confidence: Math.min(0.7, 1 - forward.pValue),
        reasoning: `Granger ${edge.from}→${edge.to} significant (p=${forward.pValue.toFixed(4)}), reverse not (p=${reverse.pValue.toFixed(4)})`,
        provider: 'granger-causality',
      };
    }

    if (reverse.significant && !forward.significant) {
      return {
        source: edge.to,
        target: edge.from,
        tier: 'granger',
        confidence: Math.min(0.7, 1 - reverse.pValue),
        reasoning: `Granger ${edge.to}→${edge.from} significant (p=${reverse.pValue.toFixed(4)}), forward not (p=${forward.pValue.toFixed(4)})`,
        provider: 'granger-causality',
      };
    }

    // Both significant or neither — cannot distinguish
    return null;
  }

  // ── Data Extraction ────────────────────────────────────

  private extractTimeSeries(context: TemporalContext): Map<string, readonly number[]> | null {
    const raw = context.metadata?.metricTimeSeries;
    if (!raw || !(raw instanceof Map)) return null;
    return raw as Map<string, readonly number[]>;
  }
}
