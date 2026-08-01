/**
 * PatternClassifier — classify chronic fault patterns in time series
 * data using Deng Yu's degradation curve analysis and kinetic energy
 * signatures.
 *
 * ## Theoretical Background (邓煜切割算法)
 *
 * Different chronic fault types exhibit distinct signatures in
 * Deng Yu's kinetic energy framework:
 *
 *   - **memory_leak**:
 *     Linear degradation with monotonic increase
 *     ε_j = r × δ² / 2 grows quadratically, temporal correlation ≈ 1
 *
 *   - **connection_pool_exhaustion**:
 *     Exponential degradation with monotonic decrease
 *     ε_j = r × (exp(λδ) - λδ - 1) / λ², accelerating growth
 *
 *   - **data_skew**:
 *     Power-law degradation with load-dependent scaling
 *     ε_j = r × δ^α / (α(α-1)), α typically 1.5–3.0
 *
 *   - **gradual_degradation**:
 *     Slow, possibly non-monotonic trend with moderate correlation
 *     ε_j modest — the system degrades but hasn't crossed thresholds
 *
 * ## Classification Approach
 *
 * The classifier runs multiple detectors and combine their results
 * to determine the dominant fault pattern. Each detector computes
 * a domain-specific confidence score, and the pattern with the
 * highest combined score wins.
 *
 * @module chronic/pattern-classifier
 */

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import type { FaultCategory } from '@agentix-e/micro-kinetic-core';
import {
  invariant,
  invariantNonEmpty,
} from '@agentix-e/micro-kinetic-core';

import { MemoryLeakDetector } from './memory-leak.js';
import { ConnectionPoolDetector } from './connection-pool.js';
import {
  DegradationCurveAnalyzer,
  CurveModel,
} from './degradation-curve.js';

/** Recognized chronic fault pattern types. */
export enum ChronicPattern {
  MEMORY_LEAK = 'memory_leak',
  CONNECTION_POOL_EXHAUSTION = 'connection_pool_exhaustion',
  DATA_SKEW = 'data_skew',
  GRADUAL_DEGRADATION = 'gradual_degradation',
  UNKNOWN = 'unknown',
}

/** Classification result for a chronic fault pattern. */
export interface PatternClassificationResult {
  /** Detected pattern type */
  readonly pattern: ChronicPattern;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Mapped fault category for integration with RCA engine */
  readonly faultCategory: FaultCategory;
  /** Metric label used for classification */
  readonly metric: string;
  /** Detailed reason for the classification */
  readonly reason: string;
  /** Sub-scores for each pattern (for transparency) */
  readonly scores: Readonly<Record<ChronicPattern, number>>;
  /** Whether the pattern was positively detected */
  readonly detected: boolean;
}

/** Options for pattern classification. */
export interface PatternClassificationOptions {
  /** Confidence threshold for positive detection (default 0.5) */
  readonly confidenceThreshold: number;
  /** Whether to run all detectors (vs. early exit on first match) */
  readonly exhaustive: boolean;
}

const DEFAULT_CLASSIFICATION_OPTIONS: PatternClassificationOptions = {
  confidenceThreshold: 0.5,
  exhaustive: false,
};

/**
 * PatternClassifier classifies chronic fault patterns by running
 * specialized detectors and aggregating their confidence scores.
 *
 * Each detector contributes a weighted score:
 * - MemoryLeakDetector → memory_leak score
 * - ConnectionPoolDetector → connection_pool_exhaustion score
 * - DegradationCurveAnalyzer → data_skew / gradual_degradation scores
 */
export class PatternClassifier {
  private readonly memoryLeakDetector: MemoryLeakDetector;
  private readonly connectionPoolDetector: ConnectionPoolDetector;
  private readonly curveAnalyzer: DegradationCurveAnalyzer;

  constructor() {
    this.memoryLeakDetector = new MemoryLeakDetector();
    this.connectionPoolDetector = new ConnectionPoolDetector();
    this.curveAnalyzer = new DegradationCurveAnalyzer();
  }

  /**
   * Classify the chronic fault pattern from a time series.
   *
   * @param ts - Time series for a specific metric
   * @param options - Classification parameters
   * @returns PatternClassificationResult
   */
  classify(
    ts: TimeSeries,
    options?: Partial<PatternClassificationOptions>,
  ): PatternClassificationResult {
    const opts = { ...DEFAULT_CLASSIFICATION_OPTIONS, ...options };
    this.validateInputs(ts);

    const scores: Record<ChronicPattern, number> = {
      [ChronicPattern.MEMORY_LEAK]: 0,
      [ChronicPattern.CONNECTION_POOL_EXHAUSTION]: 0,
      [ChronicPattern.DATA_SKEW]: 0,
      [ChronicPattern.GRADUAL_DEGRADATION]: 0,
      [ChronicPattern.UNKNOWN]: 0,
    };

    // Run memory leak detector
    const leakResult = this.memoryLeakDetector.detect(ts);
    scores[ChronicPattern.MEMORY_LEAK] = leakResult.confidence;

    // Run connection pool detector
    const poolResult = this.connectionPoolDetector.detect(ts);
    scores[ChronicPattern.CONNECTION_POOL_EXHAUSTION] = poolResult.confidence;

    // Run general curve analysis for data_skew and gradual_degradation
    try {
      const curveResult = this.curveAnalyzer.analyze(ts);

      switch (curveResult.bestModel) {
        case CurveModel.POWER_LAW:
          scores[ChronicPattern.DATA_SKEW] = curveResult.bestFit.adjustedRSquared;
          break;
        case CurveModel.EXPONENTIAL:
          scores[ChronicPattern.CONNECTION_POOL_EXHAUSTION] = Math.max(
            scores[ChronicPattern.CONNECTION_POOL_EXHAUSTION],
            curveResult.bestFit.adjustedRSquared,
          );
          break;
        case CurveModel.LINEAR:
        case CurveModel.LOGARITHMIC:
          if (curveResult.isAccelerating) {
            scores[ChronicPattern.DATA_SKEW] = Math.max(
              scores[ChronicPattern.DATA_SKEW],
              curveResult.bestFit.adjustedRSquared * 0.7,
            );
          } else {
            scores[ChronicPattern.GRADUAL_DEGRADATION] =
              curveResult.bestFit.adjustedRSquared;
          }
          break;
      }
    } catch {
      // Curve analysis failed — use detector results only
    }

    // Determine dominant pattern
    const dominant = this.selectPattern(scores);

    const confidence = scores[dominant];
    const detected = confidence >= opts.confidenceThreshold;

    const reason = this.buildReason(dominant, confidence, leakResult, poolResult);

    return {
      pattern: dominant,
      confidence,
      faultCategory: chronicPatternToFaultCategory(dominant),
      metric: ts.label,
      reason,
      scores,
      detected,
    };
  }

  /**
   * Classify multiple metrics simultaneously and return the
   * pattern with the highest confidence across all metrics.
   *
   * @param metrics - Map of metric label → TimeSeries
   * @param options - Classification parameters
   * @returns Best classification across all metrics
   */
  classifyMultiMetric(
    metrics: Readonly<Record<string, TimeSeries>>,
    options?: Partial<PatternClassificationOptions>,
  ): PatternClassificationResult {
    invariant(
      Object.keys(metrics).length > 0,
      'At least one metric required',
    );

    let bestResult: PatternClassificationResult | null = null;

    for (const [label, ts] of Object.entries(metrics)) {
      const result = this.classify(ts, options);
      if (!bestResult || result.confidence > bestResult.confidence) {
        bestResult = result;
      }
    }

    return bestResult!;
  }

  /**
   * Select the dominant pattern from multi-dimensional scores.
   */
  selectPattern(scores: Record<ChronicPattern, number>): ChronicPattern {
    let best: ChronicPattern = ChronicPattern.UNKNOWN;
    let bestScore = 0;

    for (const [pattern, score] of Object.entries(scores) as [
      ChronicPattern,
      number,
    ][]) {
      if (score > bestScore) {
        bestScore = score;
        best = pattern;
      }
    }

    return best;
  }

  private validateInputs(ts: TimeSeries): void {
    invariantNonEmpty(ts.timestamps, 'TimeSeries.timestamps');
    invariantNonEmpty((ts.values as unknown) as { length: number }, 'TimeSeries.values');
    invariant(
      ts.timestamps.length === ts.values.length,
      'Timestamps and values must match',
    );
  }

  private buildReason(
    pattern: ChronicPattern,
    confidence: number,
    leakResult: ReturnType<MemoryLeakDetector['detect']>,
    poolResult: ReturnType<ConnectionPoolDetector['detect']>,
  ): string {
    const parts: string[] = [];

    switch (pattern) {
      case ChronicPattern.MEMORY_LEAK:
        parts.push('Monotonic memory increase detected');
        parts.push(
          `rate=${leakResult.degradationRateKBs.toFixed(3)} KB/s`,
        );
        parts.push(`correlation=${leakResult.temporalCorrelation.toFixed(3)}`);
        if (leakResult.hoursToOOM !== undefined) {
          parts.push(`OOM in ${leakResult.hoursToOOM.toFixed(1)}h`);
        }
        break;

      case ChronicPattern.CONNECTION_POOL_EXHAUSTION:
        parts.push('Connection pool exponential depletion');
        parts.push(`λ=${poolResult.growthRate.toFixed(4)}`);
        parts.push(`utilization=${(poolResult.utilizationRatio * 100).toFixed(0)}%`);
        if (poolResult.hoursToExhaustion !== undefined) {
          parts.push(
            `exhaustion in ${poolResult.hoursToExhaustion.toFixed(1)}h`,
          );
        }
        break;

      case ChronicPattern.DATA_SKEW:
        parts.push('Power-law data skew pattern');
        parts.push(`confidence=${confidence.toFixed(2)}`);
        break;

      case ChronicPattern.GRADUAL_DEGRADATION:
        parts.push('Gradual degradation trend');
        parts.push(`confidence=${confidence.toFixed(2)}`);
        break;

      case ChronicPattern.UNKNOWN:
        parts.push('No clear chronic fault pattern detected');
        parts.push(
          `leak=${leakResult.confidence.toFixed(2)}, pool=${poolResult.confidence.toFixed(2)}`,
        );
        break;
    }

    return parts.join('; ');
  }
}

/**
 * Map a ChronicPattern to a FaultCategory.
 */
function chronicPatternToFaultCategory(
  pattern: ChronicPattern,
): FaultCategory {
  switch (pattern) {
    case ChronicPattern.MEMORY_LEAK:
      return 'MEMORY_LEAK';
    case ChronicPattern.CONNECTION_POOL_EXHAUSTION:
      return 'CONNECTION_POOL';
    case ChronicPattern.DATA_SKEW:
      return 'DATA_SKEW';
    case ChronicPattern.GRADUAL_DEGRADATION:
      return 'MEMORY';
    case ChronicPattern.UNKNOWN:
    default:
      return 'UNKNOWN';
  }
}
