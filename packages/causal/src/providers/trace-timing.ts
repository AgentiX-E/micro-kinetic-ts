/**
 * Trace Timing Provider — highest-confidence tier.
 *
 * Infers causal direction from distributed tracing span data:
 *
 * 1. Parent-Child Direction: If span(A) is the parent of span(B),
 *    then A calls B. Direction is A → B. This is the definitive
 *    signal source (tier: 'trace').
 *
 * 2. Temporal Ordering: Within the same trace, compare span start
 *    times. If startTime(A) < startTime(B) for all spans with
 *    matching edges, direction is A → B.
 *
 * 3. Error Propagation: If A's error spans precede B's error spans
 *    in the same trace, the fault likely propagated A → B.
 *
 * Cost: zero (data already available from tracing infrastructure).
 * Accuracy: highest — spans carry definitive parent-child edges.
 *
 * @module causal/providers/trace-timing
 */

import type {
  CallEdge,
  CausalDirection,
  ITimingProvider,
  TemporalContext,
  TimingProviderMeta,
} from '@agentix-e/micro-kinetic-core';
import type { SpanTiming } from '../types/index.js';

/** Trace timing provider metadata. */
const TRACE_TIMING_META: TimingProviderMeta = {
  id: 'trace-timing',
  description:
    'Infers causal direction from distributed tracing span parent-child relationships and start time ordering',
  tier: 'trace',
  availability: 'conditional',
};

/**
 * TraceTimingProvider — infers causal direction from tracing spans.
 *
 * Priority 1 in the causal direction detection chain. Uses span parent-child
 * relationships as the definitive signal for propagation direction.
 *
 * @example
 * ```typescript
 * const provider = new TraceTimingProvider();
 * const context: TemporalContext = {
 *   injectionTime: 1704067200000,
 *   timings: spanTimingsToServiceTimings(parsedSpans),
 *   metadata: { spans: rawSpanTimings },
 * };
 * const directions = await provider.inferDirection(edges, context);
 * ```
 */
export class TraceTimingProvider implements ITimingProvider {
  readonly meta: TimingProviderMeta = TRACE_TIMING_META;

  /**
   * Infer causal direction from span parent-child relationships.
   */
  async inferDirection(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<readonly CausalDirection[]> {
    const spanTimings = this.extractSpanTimings(context);
    if (spanTimings.length === 0) return [];

    const spanMap = new Map(spanTimings.map((s) => [s.service.toLowerCase(), s]));
    const results: CausalDirection[] = [];

    for (const edge of edges) {
      const from = spanMap.get(edge.from.toLowerCase());
      const to = spanMap.get(edge.to.toLowerCase());

      if (!from || !to) continue;

      // Strategy 1: Parent-child direction from callers/callees
      const parentResult = this.inferFromCallGraph(from, to, edge);
      if (parentResult) {
        results.push(parentResult);
        continue;
      }

      // Strategy 2: Temporal ordering within traces
      const temporalResult = this.inferFromTemporalOrder(from, to, edge);
      if (temporalResult) {
        results.push(temporalResult);
        continue;
      }

      // Strategy 3: Error propagation order
      const errorResult = this.inferFromErrorPropagation(from, to, edge);
      if (errorResult) {
        results.push(errorResult);
      }
    }

    return results;
  }

  /**
   * Can infer if we have span timing data available in the context.
   */
  async canInfer(context: TemporalContext): Promise<boolean> {
    const sp = this.extractSpanTimings(context);
    return sp.length > 0;
  }

  /**
   * Confidence estimate based on span data quality.
   */
  async estimateConfidence(context: TemporalContext): Promise<number> {
    const sp = this.extractSpanTimings(context);
    if (sp.length === 0) return 0;

    // Higher confidence with more spans and caller/callee data
    const totalSpans = sp.reduce((sum, s) => sum + s.spanCount, 0);
    const hasCallerData = sp.some((s) => s.callers.length > 0 || s.callees.length > 0);

    // Sigmoid-like confidence: 0.5 + 0.5 * tanh(totalSpans / 100)
    const spanWeight = Math.tanh(totalSpans / 100);
    const callerBonus = hasCallerData ? 0.3 : 0;

    return Math.min(1, 0.5 + 0.5 * spanWeight + callerBonus);
  }

  // ── Private Methods ────────────────────────────────────

  /**
   * Extract raw span timings from temporal context metadata.
   */
  private extractSpanTimings(context: TemporalContext): SpanTiming[] {
    const raw = context.metadata?.spans;
    if (!raw || !Array.isArray(raw)) return [];
    return raw as SpanTiming[];
  }

  /**
   * Infer direction from caller/callee relationships.
   *
   * If 'from' service lists 'to' as a callee (it calls 'to'),
   * direction is from → to.
   */
  private inferFromCallGraph(
    from: SpanTiming,
    to: SpanTiming,
    edge: CallEdge,
  ): CausalDirection | null {
    const fromCallsTo = from.callees.some((c) => c.toLowerCase() === edge.to.toLowerCase());
    const toCallsFrom = to.callers.some((c) => c.toLowerCase() === edge.from.toLowerCase());

    if (fromCallsTo || toCallsFrom) {
      return {
        source: edge.from,
        target: edge.to,
        tier: 'trace',
        confidence: 0.95,
        reasoning: `Span parent-child: ${edge.from} calls ${edge.to} (observed in traces)`,
        provider: 'trace-timing',
      };
    }

    // Check reverse direction
    const toCallsFrom2 = to.callees.some((c) => c.toLowerCase() === edge.from.toLowerCase());
    if (toCallsFrom2) {
      return {
        source: edge.to,
        target: edge.from,
        tier: 'trace',
        confidence: 0.95,
        reasoning: `Span parent-child: ${edge.to} calls ${edge.from} (observed in traces)`,
        provider: 'trace-timing',
      };
    }

    return null;
  }

  /**
   * Infer direction from temporal ordering of span start times.
   *
   * If all spans for service A start before all spans for service B,
   * A likely calls B (or B's processing is downstream of A).
   */
  private inferFromTemporalOrder(
    from: SpanTiming,
    to: SpanTiming,
    edge: CallEdge,
  ): CausalDirection | null {
    // Direction: from.start < to.start → from calls to
    if (from.earliestStartMs < to.earliestStartMs) {
      const delta = to.earliestStartMs - from.earliestStartMs;
      const confidence = Math.min(1, delta / 1000); // Higher confidence with larger gaps
      return {
        source: edge.from,
        target: edge.to,
        tier: 'trace',
        confidence: Math.max(0.6, confidence),
        reasoning: `Temporal order: ${edge.from} spans start ${delta}ms before ${edge.to} spans`,
        provider: 'trace-timing',
      };
    }

    // Reverse: to.start < from.start
    if (to.earliestStartMs < from.earliestStartMs) {
      const delta = from.earliestStartMs - to.earliestStartMs;
      return {
        source: edge.to,
        target: edge.from,
        tier: 'trace',
        confidence: Math.max(0.6, Math.min(1, delta / 1000)),
        reasoning: `Temporal order: ${edge.to} spans start ${delta}ms before ${edge.from} spans`,
        provider: 'trace-timing',
      };
    }

    return null;
  }

  /**
   * Infer direction from error propagation order.
   *
   * If both services have error spans, the one with earlier error
   * start time is likely the source.
   */
  private inferFromErrorPropagation(
    from: SpanTiming,
    to: SpanTiming,
    edge: CallEdge,
  ): CausalDirection | null {
    if (from.errorSpanCount === 0 || to.errorSpanCount === 0) return null;

    // Both have errors — earlier errors suggest root cause
    if (from.earliestStartMs < to.earliestStartMs) {
      const delta = to.earliestStartMs - from.earliestStartMs;
      return {
        source: edge.from,
        target: edge.to,
        tier: 'trace',
        confidence: Math.min(0.8, delta / 5000),
        reasoning: `Error propagation: ${edge.from} errors precede ${edge.to} errors by ${delta}ms`,
        provider: 'trace-timing',
      };
    }

    if (to.earliestStartMs < from.earliestStartMs) {
      const delta = from.earliestStartMs - to.earliestStartMs;
      return {
        source: edge.to,
        target: edge.from,
        tier: 'trace',
        confidence: Math.min(0.8, delta / 5000),
        reasoning: `Error propagation: ${edge.to} errors precede ${edge.from} errors by ${delta}ms`,
        provider: 'trace-timing',
      };
    }

    return null;
  }
}
