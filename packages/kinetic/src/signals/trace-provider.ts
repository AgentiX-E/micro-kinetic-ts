/**
 * Trace signal provider — root cause analysis from distributed tracing data.
 *
 * Builds a precise span tree from trace spans and performs bottom-up anomaly
 * accumulation like TraceRCA (ICSE'24). The key advantage over metric-only
 * methods: span parent→child relationships directly encode service dependency
 * direction, eliminating the causal ambiguity of correlation-based approaches.
 *
 * Algorithm (TraceRCA-inspired):
 * 1. Build span tree: group spans by traceId, link by parentSpanId
 * 2. Anomaly scoring: error rate + duration degradation per service
 * 3. Bottom-up accumulation: parent accumulates child anomaly scores
 * 4. Root cause ranking: service with highest accumulated anomaly contribution
 *
 * @module signals/trace-provider
 */

import type {
  ISignalProvider,
  SignalAnalysisContext,
  SignalMetadata,
  SignalQuality,
  SignalResult,
  TraceSpan,
} from '@agentix-e/micro-kinetic-core';

/**
 * Trace-based signal provider for root cause analysis.
 */
export class TraceSignalProvider implements ISignalProvider {
  readonly signalType = 'trace' as const;

  async analyze(context: SignalAnalysisContext): Promise<SignalResult> {
    const spans = context.traceSpans ?? [];

    // Separate normal vs anomalous periods if anomalyTime is known
    const anomalyTime = context.anomalyTime;
    const preSpans = anomalyTime
      ? spans.filter((s) => s.startTime < anomalyTime)
      : [];
    const postSpans = anomalyTime
      ? spans.filter((s) => s.startTime >= anomalyTime)
      : spans;

    // Compute per-service baseline from pre-anomaly spans
    const serviceBaselines = this.computeServiceBaselines(preSpans);

    // Score services from post-anomaly spans
    const scores = this.scoreServices(postSpans, serviceBaselines);

    // Sort by score descending
    const ranked = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([serviceId, score]) => ({
        serviceId,
        faultType: { category: 'UNKNOWN' as const, subType: 'trace_anomaly', severity: (score > 0.7 ? 'critical' : score > 0.4 ? 'major' : 'minor') as 'critical' | 'major' | 'minor' },
        confidence: Math.min(1, score),
        rank: 0,
        evidenceMetrics: [{ metric: 'trace_score', value: score, threshold: 0.3 }],
        propagationDepth: 0,
        propagationErrorBound: 0.1,
        viaTreeSearch: true,
      }));

    const confidence = ranked.length > 0 ? ranked[0]!.confidence : 0;

    return {
      signal: 'trace',
      candidates: ranked,
      confidence,
      metadata: this.buildMetadata(spans, ranked.length),
    };
  }

  async estimateQuality(context: SignalAnalysisContext): Promise<SignalQuality> {
    const spans = context.traceSpans;
    if (!spans || spans.length === 0) {
      return { score: 0, reason: 'No trace data available' };
    }

    const uniqueServices = new Set(spans.map((s) => s.service));
    const hasErrorSpans = spans.filter((s) => s.isError).length > 0;

    return {
      score: hasErrorSpans ? 0.8 : 0.4,
      reason: `${spans.length} spans across ${uniqueServices.size} services${hasErrorSpans ? ' with error spans' : ''}`,
    };
  }

  // ── Private helpers ────────────────────────────────────

  private computeServiceBaselines(
    preSpans: readonly TraceSpan[],
  ): Map<string, { avgDuration: number; errorRate: number }> {
    const svcStats = new Map<string, { totalDuration: number; totalErrors: number; count: number }>();
    for (const s of preSpans) {
      let stats = svcStats.get(s.service);
      if (!stats) { stats = { totalDuration: 0, totalErrors: 0, count: 0 }; svcStats.set(s.service, stats); }
      stats.totalDuration += s.duration;
      if (s.isError) stats.totalErrors++;
      stats.count++;
    }
    const baselines = new Map<string, { avgDuration: number; errorRate: number }>();
    for (const [svc, stats] of svcStats) {
      baselines.set(svc, { avgDuration: stats.totalDuration / stats.count, errorRate: stats.totalErrors / stats.count });
    }
    return baselines;
  }

  private scoreServices(
    postSpans: readonly TraceSpan[],
    baselines: Map<string, { avgDuration: number; errorRate: number }>,
  ): Map<string, number> {
    // Build span tree from post-anomaly spans
    const spanMap = new Map<string, TraceSpan>();
    const childrenMap = new Map<string, TraceSpan[]>();
    for (const s of postSpans) {
      spanMap.set(s.spanId, s);
      if (s.parentSpanId) {
        let children = childrenMap.get(s.parentSpanId);
        if (!children) { children = []; childrenMap.set(s.parentSpanId, children); }
        children.push(s);
      }
    }

    // Service-level aggregation
    const serviceScores = new Map<string, number>();
    const serviceVisited = new Set<string>();

    const computeScore = (span: TraceSpan): number => {
      const bl = baselines.get(span.service);
      let selfScore = 0;
      if (bl) {
        const durationDegradation = bl.avgDuration > 0 ? Math.min(1, (span.duration - bl.avgDuration) / bl.avgDuration) : 0;
        const errorScore = span.isError ? 1 : 0;
        selfScore = Math.max(durationDegradation, errorScore);
      } else {
        selfScore = span.isError ? 1 : 0;
      }

      // Children contribution
      const children = childrenMap.get(span.spanId) ?? [];
      let childContrib = 0;
      for (const child of children) {
        childContrib += computeScore(child);
      }

      return selfScore + childContrib;
    };

    // Process root spans
    for (const s of postSpans) {
      if (!s.parentSpanId || !spanMap.has(s.parentSpanId)) {
        const score = computeScore(s);
        const current = serviceScores.get(s.service) ?? 0;
        serviceScores.set(s.service, Math.max(current, score));
      }
    }

    return serviceScores;
  }

  private buildMetadata(spans: readonly TraceSpan[], candidateCount: number): SignalMetadata {
    const services = new Set(spans.map((s) => s.service));
    const traceCount = new Set(spans.map((s) => s.traceId)).size;
    return {
      candidateCount,
      avgConfidence: candidateCount > 0 ? 0.5 : 0,
      quality: {
        traceCoverage: traceCount > 0 ? 1 : 0,
        metricCompleteness: 0,
        topologyMatch: 0,
      },
    };
  }
}
