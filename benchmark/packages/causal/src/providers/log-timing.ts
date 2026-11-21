/**
 * Log Timing Provider — second-highest confidence tier.
 *
 * Infers causal direction from structured log anomaly timestamps:
 *
 * 1. Inflection Point Detection: For each service, find the timestamp
 *    where normal logs transition to error/anomaly logs. If service A's
 *    inflection point is before B's, the fault likely A → B.
 *
 * 2. Error Propagation Chain: If service A has log errors at T and
 *    service B has correlated log errors at T + Δt, direction is A → B.
 *
 * 3. Cascading Pattern: Multiple services with tightly clustered
 *    inflection points suggest a cascade; the earliest inflection is
 *    the root.
 *
 * Data source: structured logs parsed by @agentix-e/log-parser-core
 * (template extraction + anomaly pattern detection).
 *
 * Cost: zero (log data already available, parsing is offline).
 * Accuracy: high — millisecond-precision timestamps.
 *
 * @module causal/providers/log-timing
 */

import type {
  CallEdge,
  CausalDirection,
  ITimingProvider,
  TemporalContext,
  TimingProviderMeta,
} from '@agentix-e/micro-kinetic-core';
import type { LogAnomalyPoint } from '../types/index.js';

const LOG_TIMING_META: TimingProviderMeta = {
  id: 'log-timing',
  description: 'Infers causal direction from structured log anomaly inflection point timestamps',
  tier: 'log',
  availability: 'conditional',
};

/**
 * LogTimingProvider — infers causal direction from log anomaly timestamps.
 *
 * Priority 2 in the causal direction detection chain. Uses log anomaly
 * inflection points to determine fault propagation direction.
 */
export class LogTimingProvider implements ITimingProvider {
  readonly meta: TimingProviderMeta = LOG_TIMING_META;

  /**
   * Infer causal direction from log anomaly inflection points.
   */
  async inferDirection(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<readonly CausalDirection[]> {
    const anomalyPoints = this.extractAnomalyPoints(context);
    if (anomalyPoints.length === 0) return [];

    const pointMap = new Map(anomalyPoints.map((p) => [p.service.toLowerCase(), p]));
    const results: CausalDirection[] = [];

    for (const edge of edges) {
      const fromPoint = pointMap.get(edge.from.toLowerCase());
      const toPoint = pointMap.get(edge.to.toLowerCase());

      if (!fromPoint || !toPoint) continue;

      // Strategy 1: Compare first anomaly timestamps
      const result = this.inferFromAnomalyOnset(fromPoint, toPoint, edge);
      if (result) {
        results.push(result);
      }
    }

    // Strategy 2: Cascading pattern — find earliest inflection across all services
    this.enrichWithCascadeInfo(results, anomalyPoints);

    return results;
  }

  async canInfer(context: TemporalContext): Promise<boolean> {
    return this.extractAnomalyPoints(context).length > 0;
  }

  async estimateConfidence(context: TemporalContext): Promise<number> {
    const points = this.extractAnomalyPoints(context);
    if (points.length === 0) return 0;

    // More anomaly points = higher confidence
    const countWeight = Math.tanh(points.length / 10);
    // Temporal spread indicates clear cascade vs simultaneous failure
    const allTimestamps = points.map((p) => p.firstAnomalyMs).filter((t) => t > 0);
    if (allTimestamps.length < 2) return 0.2;

    const range = Math.max(...allTimestamps) - Math.min(...allTimestamps);
    const spreadConfidence = range > 1000 ? 0.8 : (range / 1000) * 0.8;

    return Math.min(0.9, 0.3 * countWeight + 0.7 * spreadConfidence);
  }

  // ── Private Methods ────────────────────────────────────

  private extractAnomalyPoints(context: TemporalContext): LogAnomalyPoint[] {
    const raw = context.metadata?.logAnomalyPoints;
    if (!raw || !Array.isArray(raw)) return [];
    return raw as LogAnomalyPoint[];
  }

  /**
   * Compare first anomaly timestamps to infer direction.
   *
   * If service A's first anomaly occurs before service B's,
   * A is the more likely root cause.
   */
  private inferFromAnomalyOnset(
    fromPoint: LogAnomalyPoint,
    toPoint: LogAnomalyPoint,
    edge: CallEdge,
  ): CausalDirection | null {
    const delta = toPoint.firstAnomalyMs - fromPoint.firstAnomalyMs;

    if (Math.abs(delta) < 1) {
      // Simultaneous anomalies — cannot infer direction
      return null;
    }

    if (delta > 0) {
      // from's anomaly precedes to's → from → to
      const confidence = Math.min(0.85, delta / 10000 + 0.4);
      return {
        source: edge.from,
        target: edge.to,
        tier: 'log',
        confidence,
        reasoning: `Log anomaly onset: ${edge.from} anomaly at ${fromPoint.firstAnomalyMs}, ${edge.to} anomaly at ${toPoint.firstAnomalyMs} (Δ=${delta}ms)`,
        provider: 'log-timing',
      };
    }

    // to's anomaly precedes from's → to → from
    const confidence = Math.min(0.85, Math.abs(delta) / 10000 + 0.4);
    return {
      source: edge.to,
      target: edge.from,
      tier: 'log',
      confidence,
      reasoning: `Log anomaly onset: ${edge.to} anomaly at ${toPoint.firstAnomalyMs}, ${edge.from} anomaly at ${fromPoint.firstAnomalyMs} (Δ=${Math.abs(delta)}ms)`,
      provider: 'log-timing',
    };
  }

  /**
   * Enrich results with cascade pattern information.
   *
   * Find the service with the globally earliest anomaly inflection point
   * and boost its confidence slightly.
   */
  private enrichWithCascadeInfo(
    results: CausalDirection[],
    anomalyPoints: readonly LogAnomalyPoint[],
  ): void {
    if (anomalyPoints.length < 2) return;

    // Find the earliest anomaly point
    const earliest = anomalyPoints.reduce((min, p) =>
      p.firstAnomalyMs > 0 && p.firstAnomalyMs < min.firstAnomalyMs ? p : min,
    );

    // Boost confidence for results where the global earliest is the source
    for (const result of results) {
      if (result.source.toLowerCase() === earliest.service.toLowerCase()) {
        // Adjust confidence in place (mutable for cascade enrichment)
        (result as { confidence: number }).confidence = Math.min(0.95, result.confidence + 0.05);
      }
    }
  }
}
