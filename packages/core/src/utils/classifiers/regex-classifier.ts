/**
 * Layer 1 — Regex-based deterministic fault classifier.
 *
 * This is the fastest classification layer (~0.1ms). It matches
 * metric names against DI-injected classification rules using
 * priority-ordered regex patterns. Rules are registered via the
 * DI container, enabling production customization without code changes.
 *
 * Architecture:
 *   Rules are injected as ClassificationRule[] via DI tokens.
 *   Each rule has a priority — higher priorities are evaluated first.
 *   The first matching rule wins; ties are broken by confidence.
 *
 * @module utils/classifiers/regex-classifier
 */

import type {
  ClassificationRule,
  FaultClassifierContext,
  FaultTypeHypothesis,
  IFaultClassifier,
} from '../../interfaces/fault-classifier.js';

import type { FaultCategory, FaultType } from '../../types/faults.js';
import type { TimeSeries } from '../../types/time-series.js';

/**
 * Default classification rules shipped with the framework.
 *
 * These cover the six standard fault categories recognized by
 * the AIOps2025 and RCAEval benchmarks. Production deployments
 * should merge these with environment-specific rules.
 */
export const DEFAULT_CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  {
    pattern: /(?:^|_)cpu(?:_|$)|processor/,
    category: 'CPU',
    priority: 100,
    confidence: 0.85,
    description: 'CPU utilization or processor metrics',
  },
  {
    pattern: /(?:^|_)mem(?:ory)?(?:_|$)|heap|(?:^|_)gc(?:_|$)|alloc(?:at(?:ed|ion))?/,
    category: 'MEM',
    priority: 95,
    confidence: 0.82,
    description: 'Memory, heap, GC, or allocation metrics',
  },
  {
    pattern: /(?:^|_)disk(?:_|$)|iops|read_bytes|write_bytes|fs_|storage/,
    category: 'DISK',
    priority: 90,
    confidence: 0.78,
    description: 'Disk I/O, filesystem, or storage metrics',
  },
  {
    pattern: /(?:^|_)latency(?:_|$)|delay|response_time|duration(?:_|$)|p99|p95|request_time/,
    category: 'DELAY',
    priority: 85,
    confidence: 0.82,
    description: 'Latency, delay, or response time metrics',
  },
  {
    pattern: /(?:^|_)loss(?:_|$)|(?:^|_)error(?:_|$)|(?:^|_)fail(?:_|$)|drop_rate|timeout/,
    category: 'LOSS',
    priority: 80,
    confidence: 0.78,
    description: 'Error rate, packet loss, timeout, or failure metrics',
  },
  {
    pattern: /(?:^|_)socket(?:_|$)|connection|port(?:_|$)|tcp_|network_io|bytes_sent|bytes_recv/,
    category: 'SOCKET',
    priority: 75,
    confidence: 0.75,
    description: 'Socket, connection, port, or network I/O metrics',
  },
];

// ── Implementation ────────────────────────────────────────

/**
 * Regex-based fault classifier (Layer 1).
 *
 * Evaluates classification rules in priority order against
 * time-series metric names. For each anomalous series, the
 * first matching rule contributes a vote. The category with
 * the most votes wins.
 *
 * Configuration via dependency injection:
 * ```typescript
 * container.register(DI_TOKENS.CLASSIFICATION_RULES, () => [
 *   ...DEFAULT_CLASSIFICATION_RULES,
 *   { pattern: /gpu/, category: 'GPU', priority: 100, confidence: 0.9 },
 * ]);
 * ```
 */
export class RegexFaultClassifier implements IFaultClassifier {
  readonly method = 'rule' as const;

  private readonly sortedRules: readonly ClassificationRule[];

  constructor(rules: readonly ClassificationRule[]) {
    // Sort by priority descending; stable for same-priority rules
    this.sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Classify fault type from time-series metrics.
   *
   * Algorithm:
   * 1. For each time series, check if it exceeds the anomaly threshold.
   * 2. For anomalous series, match metric name against sorted rules.
   * 3. Accumulate votes per category.
   * 4. Return ranked hypotheses by vote confidence.
   *
   * @param metricSeries - Time series data.
   * @param context - Classification context.
   * @returns Ranked fault type hypotheses.
   */
  classify(
    metricSeries: readonly TimeSeries[],
    _context: FaultClassifierContext,
  ): FaultTypeHypothesis[] {
    if (metricSeries.length === 0) {
      return this.emptyResult();
    }

    const votes = new Map<string, { count: number; maxConfidence: number; evidence: string[] }>();

    for (const series of metricSeries) {
      const matched = this.matchSeries(series);
      if (!matched) continue;

      const existing = votes.get(matched.category);
      if (existing) {
        existing.count++;
        existing.evidence.push(series.label);
        if (matched.confidence > existing.maxConfidence) {
          existing.maxConfidence = matched.confidence;
        }
      } else {
        votes.set(matched.category, {
          count: 1,
          maxConfidence: matched.confidence,
          evidence: [series.label],
        });
      }
    }

    if (votes.size === 0) {
      return this.emptyResult();
    }

    // Compute confidence from vote ratio × max rule confidence
    const totalAnomalous = [...votes.values()].reduce((s, v) => s + v.count, 0);
    const hypotheses: FaultTypeHypothesis[] = [];

    for (const [category, v] of votes) {
      const voteRatio = v.count / totalAnomalous;
      const confidence = voteRatio * v.maxConfidence;
      hypotheses.push({
        category,
        confidence: Math.min(confidence, 1),
        evidence: v.evidence,
        method: 'rule',
        severity: this.inferSeverity(voteRatio),
      });
    }

    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }

  // ── Private Helpers ─────────────────────────────────────

  /**
   * Match a single time series against all rules.
   * Returns the first (highest-priority) match.
   */
  private matchSeries(
    series: TimeSeries,
  ): { category: string; confidence: number } | null {
    const lower = series.label.toLowerCase();
    for (const rule of this.sortedRules) {
      if (rule.pattern.test(lower)) {
        return { category: rule.category, confidence: rule.confidence };
      }
    }
    return null;
  }

  /**
   * Produce a default "unknown" result when no rules match.
   */
  private emptyResult(): FaultTypeHypothesis[] {
    return [
      {
        category: 'UNKNOWN',
        confidence: 0,
        evidence: [],
        method: 'rule',
        severity: 'info',
      },
    ];
  }

  /**
   * Infer severity from vote concentration.
   */
  private inferSeverity(voteRatio: number): FaultTypeHypothesis['severity'] {
    if (voteRatio >= 0.8) return 'critical';
    if (voteRatio >= 0.5) return 'major';
    if (voteRatio >= 0.2) return 'minor';
    if (voteRatio > 0) return 'warning';
    return 'info';
  }
}

/**
 * Utility: convert a FaultTypeHypothesis to the standard FaultType format.
 */
export function hypothesisToFaultType(h: FaultTypeHypothesis): FaultType {
  return {
    category: h.category as FaultCategory,
    subType: '',
    severity: h.severity,
  };
}

/**
 * Pick the best hypothesis and convert to FaultType.
 * Returns UNKNOWN if no hypotheses are available.
 */
export function bestHypothesisToFaultType(hypotheses: readonly FaultTypeHypothesis[]): FaultType {
  if (hypotheses.length === 0) {
    return { category: 'UNKNOWN' as FaultCategory, subType: '', severity: 'info' };
  }
  return hypothesisToFaultType(hypotheses[0]!);
}
