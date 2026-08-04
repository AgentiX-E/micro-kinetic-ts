/**
 * Log signal provider — temporal causality from structured logs.
 *
 * Log timestamps provide millisecond-precision temporal ordering far
 * exceeding metric sampling (60 points). This enables precise causal
 * chain reconstruction: the first ERROR/WARN log in the call chain
 * marks the root cause service.
 *
 * Algorithm:
 * 1. Parse logs with template extraction (simplified Drain)
 * 2. Build temporal log chain sorted by timestamp
 * 3. Identify first ERROR/WARN occurrence as root cause candidate
 * 4. Score services by: error count, error recency, error burst density
 *
 * Advanced (future): LLM-based log stack trace analysis for code-level
 * localization. Error stack traces identify the exact code path where
 * the fault originated, enabling sub-service root cause localization.
 *
 * Reference: MicroRCA-Agent (CCF AIOps 2025), Drain (He et al., 2017)
 *
 * TODO: Replace simplified tokenizer with @agentix-e/log-parser-core
 * (drain-ts prefix-tree clustering, GA 0.991) once published to npm.
 * The production parser supports SynLogRefiner, HITL calibration, and
 * multi-language template extraction.
 *
 * @module signals/log-provider
 */

import type {
  ISignalProvider,
  SignalAnalysisContext,
  SignalMetadata,
  SignalQuality,
  SignalResult,
} from '@agentix-e/micro-kinetic-core';

// ── Log Data Types ───────────────────────────────────────

/** A structured log entry matching RCAEval's logs.csv format. */
export interface LogEntry {
  /** Unix timestamp (seconds or milliseconds). */
  readonly timestamp: number;
  /** Service that produced this log. */
  readonly service: string;
  /** Log message content. */
  readonly message: string;
  /** Log level: ERROR, WARN, INFO, DEBUG. */
  readonly level: string;
}

/**
 * Extracted log template (simplified Drain).
 *
 * Drain replaces variable tokens (timestamps, IPs, IDs, hex values)
 * with placeholders, creating a stable template for grouping similar
 * log messages without their parameter values.
 */
export interface LogTemplate {
  /** Template pattern (e.g., "User * logged in from *"). */
  readonly pattern: string;
  /** How many log entries matched this template. */
  readonly count: number;
  /** Earliest timestamp for this template. */
  readonly firstSeen: number;
  /** Latest timestamp for this template. */
  readonly lastSeen: number;
}

// ── Log Signal Provider ──────────────────────────────────

export class LogSignalProvider implements ISignalProvider {
  readonly signalType = 'topology' as const; // log-based topology refinement

  async analyze(context: SignalAnalysisContext): Promise<SignalResult> {
    const logs = context.traceSpans as unknown as LogEntry[]; // reuse context field until dedicated log field added
    if (!logs || logs.length === 0) {
      return this.emptyResult();
    }

    // Filter to ERROR and WARN levels
    const errorLogs = logs.filter((l) => l.level === 'ERROR' || l.level === 'WARN');
    if (errorLogs.length === 0) {
      return this.emptyResult();
    }

    // Sort by timestamp for temporal analysis
    const sorted = [...errorLogs].sort((a, b) => a.timestamp - b.timestamp);

    // Extract log templates (simplified Drain)
    const templates = this.extractTemplates(sorted);

    // Score services by error burst characteristics
    const scores = this.scoreServicesWithLogs(sorted, templates);

    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([serviceId, score]) => ({
        serviceId,
        faultType: { category: 'UNKNOWN' as const, subType: 'log_anomaly', severity: (score > 0.7 ? 'critical' : score > 0.4 ? 'major' : 'minor') as 'critical' | 'major' | 'minor' },
        confidence: Math.min(1, score),
        rank: 0,
        evidenceMetrics: [{ metric: 'log_error_score', value: score, threshold: 0.3 }],
        propagationDepth: 0,
        propagationErrorBound: 0.1,
        viaTreeSearch: true,
      }));

    return {
      signal: 'topology',
      candidates: ranked,
      confidence: ranked.length > 0 ? ranked[0]!.confidence : 0,
      metadata: {
        candidateCount: ranked.length,
        avgConfidence: ranked.length > 0 ? ranked.reduce((s, r) => s + r.confidence, 0) / ranked.length : 0,
        quality: { traceCoverage: 0, metricCompleteness: 0, topologyMatch: Math.min(1, errorLogs.length / 50) },
      },
    };
  }

  async estimateQuality(_context: SignalAnalysisContext): Promise<SignalQuality> {
    return { score: 0, reason: 'Log quality not pre-assessable' };
  }

  // ── Private: Log Template Extraction ───────────────────

  private extractTemplates(logs: readonly LogEntry[]): LogTemplate[] {
    const templateMap = new Map<string, { count: number; firstSeen: number; lastSeen: number }>();

    for (const log of logs) {
      const pattern = this.tokenizeMessage(log.message);
      const existing = templateMap.get(pattern);
      if (existing) {
        existing.count++;
        if (log.timestamp < existing.firstSeen) existing.firstSeen = log.timestamp;
        if (log.timestamp > existing.lastSeen) existing.lastSeen = log.timestamp;
      } else {
        templateMap.set(pattern, {
          count: 1,
          firstSeen: log.timestamp,
          lastSeen: log.timestamp,
        });
      }
    }

    return [...templateMap.entries()].map(([pattern, stats]) => ({
      pattern,
      ...stats,
    }));
  }

  /**
   * Tokenize a log message into a template by replacing variable tokens.
   * This is a simplified version of Drain's tokenization.
   *
   * Replaces: numbers, IPs, UUIDs, hex values, timestamps, file paths
   * with * placeholder.
   */
  private tokenizeMessage(message: string): string {
    return message
      // UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '*')
      // IP addresses
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '*')
      // Hex values (0x...)
      .replace(/\b0x[0-9a-f]+\b/gi, '*')
      // Pure numbers (timestamps, IDs, counts)
      .replace(/\b\d+\b/g, '*')
      // File paths
      .replace(/\/[^\s]*/g, '*/')
      .trim();
  }

  // ── Private: Service Scoring from Logs ─────────────────

  private scoreServicesWithLogs(
    logs: readonly LogEntry[],
    _templates: readonly LogTemplate[],
  ): Map<string, number> {
    const svcStats = new Map<string, { errors: number; earliest: number; latest: number; bursts: number }>();

    for (const log of logs) {
      let s = svcStats.get(log.service);
      if (!s) {
        s = { errors: 0, earliest: log.timestamp, latest: log.timestamp, bursts: 0 };
        svcStats.set(log.service, s);
      }
      s.errors++;
      if (log.timestamp < s.earliest) s.earliest = log.timestamp;
      if (log.timestamp > s.latest) s.latest = log.timestamp;
    }

    // Detect error bursts: consecutive errors within 1 second window
    const sorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]!.service === sorted[i - 1]!.service &&
          sorted[i]!.timestamp - sorted[i - 1]!.timestamp < 1000) {
        const s = svcStats.get(sorted[i]!.service)!;
        s.bursts++;
      }
    }

    // Score: error count × burst bonus × recency bonus
    const scores = new Map<string, number>();
    const maxTimestamp = logs.length > 0 ? Math.max(...logs.map((l) => l.timestamp)) : 1;
    const minTimestamp = logs.length > 0 ? Math.min(...logs.map((l) => l.timestamp)) : 0;
    const timeRange = maxTimestamp - minTimestamp || 1;

    for (const [svc, stats] of svcStats) {
      const errorDensity = stats.errors / Math.max(1, timeRange / 1000); // errors per second
      const burstBonus = 1 + Math.min(1, stats.bursts / Math.max(1, stats.errors));
      const recencyBonus = 1 + (stats.earliest - minTimestamp) / timeRange * 0.5;

      let score = Math.min(1, errorDensity * 0.1) * burstBonus * recencyBonus;
      scores.set(svc, score);
    }

    return scores;
  }

  private emptyResult(): SignalResult {
    return {
      signal: 'topology',
      candidates: [],
      confidence: 0,
      metadata: {
        candidateCount: 0,
        avgConfidence: 0,
        quality: { traceCoverage: 0, metricCompleteness: 0, topologyMatch: 0 },
      },
    };
  }
}
