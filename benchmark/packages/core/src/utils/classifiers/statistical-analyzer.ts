/**
 * Layer 2 — Statistical time-series feature analyzer.
 *
 * Extracts mathematical features from time-series data to classify
 * fault types based on statistical patterns. Complements the regex-based
 * rule engine (Layer 1) by distinguishing faults with similar metric names
 * but different behavioral signatures.
 *
 * Key discriminants:
 *   CPU fault: low variance, high mean, preserved periodicity
 *   MEM fault: monotonic increase, zero autocorrelation
 *   DISK fault: burst/spike pattern, high variance-to-mean ratio
 *   DELAY fault: high P99/P95 ratio, mean shift without variance change
 *   LOSS fault: sudden value jumps, high coefficient of variation
 *   SOCKET fault: capacity ceiling, mean near constant, variance spikes
 *
 * @module utils/classifiers/statistical-analyzer
 */

import type {
  FaultClassifierContext,
  FaultTypeHypothesis,
  IStatisticalAnalyzer,
  TimeSeriesFeatures,
} from '../../interfaces/fault-classifier.js';

import type { TimeSeries } from '../../types/time-series.js';

// ── Configuration ─────────────────────────────────────────

/** Configuration for the statistical analyzer. */
export interface StatisticalAnalyzerConfig {
  /** Anomaly detection threshold (mean deviation multiplier). */
  readonly anomalyThreshold: number;
  /** Minimum data points required for analysis. */
  readonly minDataPoints: number;
}

const DEFAULT_CONFIG: StatisticalAnalyzerConfig = {
  anomalyThreshold: 1.5,
  minDataPoints: 3,
};

// ── Implementation ────────────────────────────────────────

/**
 * Statistical time-series fault type analyzer (Layer 2).
 *
 * Extracts features and classifies faults based on behavioral
 * patterns. This layer is invoked when Layer 1 (regex rules)
 * produces ambiguous or low-confidence results.
 */
export class StatisticalAnalyzer implements IStatisticalAnalyzer {
  readonly method = 'statistical' as const;
  private readonly config: StatisticalAnalyzerConfig;

  constructor(config?: Partial<StatisticalAnalyzerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Classify fault type from time-series metrics using statistical patterns.
   */
  classify(
    metricSeries: readonly TimeSeries[],
    _context: FaultClassifierContext,
  ): FaultTypeHypothesis[] {
    if (metricSeries.length < this.config.minDataPoints) {
      return this.emptyResult();
    }

    // Extract features for each series
    const features = metricSeries.map((s) => this.extractFeatures(s));

    // Compute aggregate signals
    const hasMonotonic = features.some((f) => f.isMonotonicIncreasing);
    const hasBurst = features.some((f) => f.hasBurst);
    const avgCV = features.reduce((s, f) => s + f.coefficientOfVariation, 0) / features.length;
    const avgAutoCorr = features.reduce((s, f) => s + f.autocorrelationLag1, 0) / features.length;
    const trendStrength =
      features.reduce((s, f) => s + Math.abs(f.trendSlope), 0) / features.length;

    const hypotheses: FaultTypeHypothesis[] = [];

    // ── MEM pattern: monotonic increase + low CV ──────────
    if (hasMonotonic && avgCV < 0.5) {
      hypotheses.push({
        category: 'MEM',
        confidence: Math.min(0.85, 0.5 + avgCV * 0.5),
        evidence: ['Monotonic increasing trend detected', `Avg CV: ${avgCV.toFixed(3)}`],
        method: 'statistical',
        severity: avgCV < 0.2 ? 'critical' : 'major',
      });
    }

    // ── DISK pattern: burst/spike + high CV ───────────────
    if (hasBurst && avgCV > 0.5) {
      hypotheses.push({
        category: 'DISK',
        confidence: Math.min(0.8, avgCV * 0.8),
        evidence: ['Burst/spike pattern detected', `Avg CV: ${avgCV.toFixed(3)}`],
        method: 'statistical',
        severity: avgCV > 1.0 ? 'critical' : 'major',
      });
    }

    // ── CPU pattern: high autocorrelation (periodicity) ────
    if (avgAutoCorr > 0.5 && !hasBurst) {
      hypotheses.push({
        category: 'CPU',
        confidence: Math.min(0.8, avgAutoCorr * 0.8),
        evidence: [`High autocorrelation: ${avgAutoCorr.toFixed(3)}`, 'Periodic pattern preserved'],
        method: 'statistical',
        severity: avgAutoCorr > 0.8 ? 'critical' : 'major',
      });
    }

    // ── DELAY pattern: strong trend + moderate CV ──────────
    if (trendStrength > 0.3 && avgCV < 0.8) {
      hypotheses.push({
        category: 'DELAY',
        confidence: Math.min(0.75, 0.4 + trendStrength * 0.5),
        evidence: [`Trend slope: ${trendStrength.toFixed(3)}`, `Avg CV: ${avgCV.toFixed(3)}`],
        method: 'statistical',
        severity: trendStrength > 0.7 ? 'critical' : 'major',
      });
    }

    // ── LOSS pattern: very high CV + low autocorrelation ───
    if (avgCV > 1.0 && avgAutoCorr < 0.3) {
      hypotheses.push({
        category: 'LOSS',
        confidence: Math.min(0.8, avgCV * 0.6),
        evidence: [`Very high CV: ${avgCV.toFixed(3)}`, 'Low autocorrelation — random pattern'],
        method: 'statistical',
        severity: avgCV > 1.5 ? 'critical' : 'major',
      });
    }

    // ── SOCKET pattern: moderate CV + variance spikes ──────
    if (avgCV > 0.3 && avgAutoCorr < 0.4 && !hasMonotonic) {
      const varianceSpikes = features.filter((f) => f.hasBurst).length;
      if (varianceSpikes > 0) {
        hypotheses.push({
          category: 'SOCKET',
          confidence: Math.min(0.7, 0.3 + (varianceSpikes / features.length) * 0.4),
          evidence: [
            `Variance spikes: ${varianceSpikes}/${features.length}`,
            `Avg CV: ${avgCV.toFixed(3)}`,
          ],
          method: 'statistical',
          severity: 'major',
        });
      }
    }

    if (hypotheses.length === 0) {
      return this.emptyResult();
    }

    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract statistical features from a single time series.
   *
   * Uses numpy-ts compatible algorithms for efficient computation.
   * All feature computation is O(n) in series length.
   */
  extractFeatures(series: TimeSeries): TimeSeriesFeatures {
    const n = series.values.length;
    if (n < 1) {
      return this.emptyFeatures();
    }

    // ── Basic statistics ──────────────────────────────────
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = series.values[i]!;
      sum += v;
      sumSq += v * v;
    }
    const mean = sum / n;
    const variance = n > 1 ? sumSq / n - mean * mean : 0;
    const stddev = n > 1 ? Math.sqrt(Math.max(0, variance)) : 0;

    // ── Median ─────────────────────────────────────────────
    const sorted = new Float64Array(series.values).sort();
    const median =
      n % 2 === 0 ? (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2 : sorted[Math.floor(n / 2)]!;

    // ── Trend slope (linear regression on last half) ─────
    const halfStart = Math.floor(n / 2);
    const halfN = n - halfStart;
    if (halfN < 2) {
      return {
        mean,
        stddev,
        variance,
        median,
        trendSlope: 0,
        coefficientOfVariation: mean !== 0 ? stddev / Math.abs(mean) : 0,
        isMonotonicIncreasing: false,
        hasBurst: false,
        autocorrelationLag1: 0,
      };
    }

    let sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let i = halfStart; i < n; i++) {
      const x = i - halfStart;
      const y = series.values[i]!;
      sx += x;
      sy += y;
      sxx += x * x;
      sxy += x * y;
    }
    const denominator = halfN * sxx - sx * sx;
    const trendSlope = denominator !== 0 ? (halfN * sxy - sx * sy) / denominator : 0;

    // ── Coefficient of variation ─────────────────────────
    const cv = mean !== 0 ? stddev / Math.abs(mean) : 0;

    // ── Monotonic increase check ─────────────────────────
    let isMonotonicIncreasing = true;
    for (let i = 1; i < n; i++) {
      if (series.values[i]! < series.values[i - 1]!) {
        isMonotonicIncreasing = false;
        break;
      }
    }

    // ── Burst detection (spike > 2× stddev above mean) ──
    let hasBurst = false;
    const spikeThreshold = mean + 2 * stddev;
    for (let i = 0; i < n; i++) {
      if (series.values[i]! > spikeThreshold) {
        hasBurst = true;
        break;
      }
    }

    // ── Lag-1 autocorrelation ────────────────────────────
    let autoNum = 0;
    let autoDen = 0;
    for (let i = 1; i < n; i++) {
      const d1 = series.values[i]! - mean;
      const d0 = series.values[i - 1]! - mean;
      autoNum += d1 * d0;
      autoDen += d0 * d0;
    }
    const autocorrelationLag1 = autoDen !== 0 ? autoNum / autoDen : 0;

    return {
      mean,
      stddev,
      variance,
      median,
      trendSlope,
      coefficientOfVariation: cv,
      isMonotonicIncreasing,
      hasBurst,
      autocorrelationLag1,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private emptyFeatures(): TimeSeriesFeatures {
    return {
      mean: 0,
      stddev: 0,
      variance: 0,
      median: 0,
      trendSlope: 0,
      coefficientOfVariation: 0,
      isMonotonicIncreasing: false,
      hasBurst: false,
      autocorrelationLag1: 0,
    };
  }

  private emptyResult(): FaultTypeHypothesis[] {
    return [
      {
        category: 'UNKNOWN',
        confidence: 0,
        evidence: ['Insufficient data for statistical analysis'],
        method: 'statistical',
        severity: 'info',
      },
    ];
  }
}
