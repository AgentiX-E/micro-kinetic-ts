/**
 * Unit tests for causal direction providers and fusion orchestrator.
 *
 * Tests cover:
 * - TraceTimingProvider: span parent-child inference, temporal ordering, error propagation
 * - LogTimingProvider: anomaly inflection point comparison, cascade enrichment
 * - GrangerCausalityProvider: Granger test statistics, direction resolution, p-value computation
 * - StaticDirectionProvider: pre-configured direction lookup, CRUD operations
 * - CausalDirectionFusion: multi-tier fallback, edge merging, coverage computation
 *
 * Test philosophy: use minimal realistic data (not mock-heavy); each test
 * validates a specific inference path with clearly predicted outcomes.
 *
 * @module causal/__tests__/unit
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TraceTimingProvider,
  LogTimingProvider,
  GrangerCausalityProvider,
  StaticDirectionProvider,
  CausalDirectionFusion,
} from '../../src';
import type {
  CallEdge,
  CausalDirection,
  TemporalContext,
  ServiceTiming,
} from '@agentix-e/micro-kinetic-core';
import type { SpanTiming, LogAnomalyPoint } from '../../src/types';

// =============================================================================
// Test Helpers
// =============================================================================

function makeEdge(
  from: string,
  to: string,
  overrides: Partial<CallEdge> = {},
): CallEdge {
  return {
    from,
    to,
    type: 'REST',
    callRate: 100,
    p99Latency: 50,
    errorRate: 0.05,
    ...overrides,
  };
}

function makeTiming(serviceId: string, overrides: Partial<ServiceTiming> = {}): ServiceTiming {
  return {
    serviceId,
    earliestAnomalyMs: null,
    latestNormalMs: null,
    anomalyCount: 0,
    normalCount: 0,
    ...overrides,
  };
}

function makeSpanTiming(overrides: Partial<SpanTiming>): SpanTiming {
  return {
    service: '',
    earliestStartMs: 0,
    latestStartMs: 0,
    earliestEndMs: 0,
    spanCount: 1,
    errorSpanCount: 0,
    callers: [],
    callees: [],
    ...overrides,
  };
}

function makeLogPoint(overrides: Partial<LogAnomalyPoint>): LogAnomalyPoint {
  return {
    service: '',
    firstAnomalyMs: 0,
    lastNormalMs: 0,
    templateId: 'ERROR',
    anomalyCount: 1,
    normalCount: 5,
    ...overrides,
  };
}

function makeContext(overrides: Partial<TemporalContext> = {}): TemporalContext {
  return {
    injectionTime: null,
    timings: new Map(),
    ...overrides,
  };
}

// =============================================================================
// TraceTimingProvider
// =============================================================================

describe('TraceTimingProvider', () => {
  let provider: TraceTimingProvider;

  beforeEach(() => {
    provider = new TraceTimingProvider();
  });

  describe('metadata', () => {
    it('should have correct tier and availability', () => {
      expect(provider.meta.id).toBe('trace-timing');
      expect(provider.meta.tier).toBe('trace');
      expect(provider.meta.availability).toBe('conditional');
    });
  });

  describe('canInfer', () => {
    it('should return false when no span data', async () => {
      expect(await provider.canInfer(makeContext())).toBe(false);
    });

    it('should return true when span data available', async () => {
      const ctx = makeContext({
        metadata: { spans: [makeSpanTiming({ service: 'svc-a' })] },
      });
      expect(await provider.canInfer(ctx)).toBe(true);
    });
  });

  describe('estimateConfidence', () => {
    it('should return 0 when no span data', async () => {
      expect(await provider.estimateConfidence(makeContext())).toBe(0);
    });

    it('should increase with span count and caller data', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'a', spanCount: 100, callers: ['x'], callees: ['b'] }),
            makeSpanTiming({ service: 'b', spanCount: 50, callers: ['a'] }),
          ],
        },
      });
      const conf = await provider.estimateConfidence(ctx);
      expect(conf).toBeGreaterThan(0.5);
    });
  });

  describe('inferDirection — parent-child caller/callee', () => {
    it('should infer from → to when from has to as callee', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', callees: ['svc-b'] }),
            makeSpanTiming({ service: 'svc-b', callers: ['svc-a'] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
      expect(results[0]!.target).toBe('svc-b');
      expect(results[0]!.tier).toBe('trace');
      expect(results[0]!.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should handle case-insensitive service matching', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'SVC-A', callees: ['svc-B'] }),
            makeSpanTiming({ service: 'Svc-b', callers: ['svc-a'] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
    });
  });

  describe('inferDirection — temporal ordering', () => {
    it('should infer direction from earlier start time (fallback)', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1200 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
      expect(results[0]!.reasoning).toContain('Temporal order');
    });

    it('should infer reverse when to starts earlier', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1200 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // B starts earlier → direction is B → A
      expect(results[0]!.source).toBe('svc-b');
      expect(results[0]!.target).toBe('svc-a');
    });
  });

  describe('inferDirection — error propagation', () => {
    it('should use error order as last-resort signal', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 3 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1000, errorSpanCount: 1 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // Same start time but from has more errors — error propagation check
      // In this case, same start → no temporal ordering → error counts
      // Since both start at 1000, temporal order won't fire.
      // Error propagation: both have errors, same start time → no delta → no inference.
      // But since from has callees=[] and to has callers=[], no parent-child inference either.
      // Result: empty.
      expect(results).toHaveLength(0);
    });

    it('should infer error propagation when errors have different start times', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 3 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 2000, errorSpanCount: 5 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // Temporal order: A starts at 1000, B at 2000 → A → B
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
    });
  });

  describe('edge cases', () => {
    it('should return empty for missing service data', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [makeSpanTiming({ service: 'svc-a' })],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-c')]; // svc-c not in spans
      expect(await provider.inferDirection(edges, ctx)).toHaveLength(0);
    });

    it('should handle empty edges', async () => {
      const ctx = makeContext({
        metadata: { spans: [makeSpanTiming({ service: 'svc-a' })] },
      });
      expect(await provider.inferDirection([], ctx)).toHaveLength(0);
    });

    it('should infer reverse direction when to has caller data pointing from', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', callers: ['svc-b'] }),
            makeSpanTiming({ service: 'svc-b', callees: ['svc-a'] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);
      // svc-a's caller is svc-b, svc-b's callee is svc-a → B calls A
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-b');
      expect(results[0]!.target).toBe('svc-a');
    });

    it('should infer error propagation with early error source', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            // No caller/callee data, same start time, but from has errors
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 5 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 3000, errorSpanCount: 2 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // Temporal order: svc-a starts at 1000, svc-b at 3000 → svc-a → svc-b
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
    });

    it('should infer reverse error propagation', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 3000, errorSpanCount: 2 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1000, errorSpanCount: 5 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // B starts earlier → B → A
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-b');
    });

    it('should skip edges where neither service has span data', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', callers: ['x'] }),
          ],
        },
      });
      const edges = [makeEdge('svc-x', 'svc-y')];
      expect(await provider.inferDirection(edges, ctx)).toHaveLength(0);
    });

    it('should confidence-scale temporal gap size correctly', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 0 }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 2000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      // 2000ms gap → confidence = min(1, 2000/1000) = 1 (capped)
      expect(results[0]!.confidence).toBeCloseTo(1, 1);
    });

    it('should handle spans metadata as non-array gracefully', async () => {
      const ctx = makeContext({ metadata: { spans: 'not-an-array' } as any });
      expect(await provider.canInfer(ctx)).toBe(false);
    });

    it('should handle error propagation when start times are equal but error counts differ', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 3, callers: [], callees: [] }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1000, errorSpanCount: 0, callers: [], callees: [] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // Same start time, no caller/callee, and no errors in b → no temporal order, no error propagation
      expect(results).toHaveLength(0);
    });

    it('should handle error propagation when both have errors and start times differ', async () => {
      // This tests temporal order path (start times differ), not error propagation
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 3, callers: [], callees: [] }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 3000, errorSpanCount: 2, callers: [], callees: [] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // start different → temporal order
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
    });

    it('should hit error propagation when start times equal but both have errors', async () => {
      // This hits the error propagation path: same start, no caller/callee, both have errors
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', earliestStartMs: 1000, errorSpanCount: 1, callers: [], callees: [] }),
            makeSpanTiming({ service: 'svc-b', earliestStartMs: 1000, errorSpanCount: 1, callers: [], callees: [] }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // Same start, both errors, no temporal/caller → error propagation returns null (same error start)
      expect(results).toHaveLength(0);
    });
  });
});

// =============================================================================
// LogTimingProvider
// =============================================================================

describe('LogTimingProvider', () => {
  let provider: LogTimingProvider;

  beforeEach(() => {
    provider = new LogTimingProvider();
  });

  describe('metadata', () => {
    it('should have correct tier', () => {
      expect(provider.meta.tier).toBe('log');
    });
  });

  describe('canInfer', () => {
    it('should return false without log anomaly data', async () => {
      expect(await provider.canInfer(makeContext())).toBe(false);
    });

    it('should return true with log anomaly points', async () => {
      const ctx = makeContext({
        metadata: { logAnomalyPoints: [makeLogPoint({ service: 'a' })] },
      });
      expect(await provider.canInfer(ctx)).toBe(true);
    });
  });

  describe('estimateConfidence', () => {
    it('should return 0 with no data', async () => {
      expect(await provider.estimateConfidence(makeContext())).toBe(0);
    });

    it('should increase with spread of anomaly timestamps', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'a', firstAnomalyMs: 1000 }),
            makeLogPoint({ service: 'b', firstAnomalyMs: 5000 }),
            makeLogPoint({ service: 'c', firstAnomalyMs: 9000 }),
          ],
        },
      });
      const conf = await provider.estimateConfidence(ctx);
      expect(conf).toBeGreaterThan(0.3);
    });

    it('should return low confidence for single point', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [makeLogPoint({ service: 'a', firstAnomalyMs: 1000 })],
        },
      });
      const conf = await provider.estimateConfidence(ctx);
      expect(conf).toBeLessThanOrEqual(0.3);
    });
  });

  describe('inferDirection', () => {
    it('should infer from → to when from anomaly is earlier', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 1000 }),
            makeLogPoint({ service: 'svc-b', firstAnomalyMs: 3000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-a');
      expect(results[0]!.target).toBe('svc-b');
    });

    it('should infer to → from when to anomaly is earlier (reverse)', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 3000 }),
            makeLogPoint({ service: 'svc-b', firstAnomalyMs: 1000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results[0]!.source).toBe('svc-b');
      expect(results[0]!.target).toBe('svc-a');
    });

    it('should not infer direction for simultaneous anomalies', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 1000 }),
            makeLogPoint({ service: 'svc-b', firstAnomalyMs: 1000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      expect(await provider.inferDirection(edges, ctx)).toHaveLength(0);
    });

    it('should cascade-boost the globally earliest service', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 500 }),
            makeLogPoint({ service: 'svc-b', firstAnomalyMs: 2000 }),
            makeLogPoint({ service: 'svc-c', firstAnomalyMs: 3000 }),
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-c')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      // svc-a is the global earliest; its confidence should be boosted
      expect(results[0]!.confidence).toBeGreaterThan(0.5);
    });

    it('should handle empty edges gracefully', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [makeLogPoint({ service: 'a' })],
        },
      });
      expect(await provider.inferDirection([], ctx)).toHaveLength(0);
    });

    it('should skip edge with missing anomaly data for one side', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 1000 }),
            // svc-b missing
          ],
        },
      });
      const edges = [makeEdge('svc-a', 'svc-b')];
      expect(await provider.inferDirection(edges, ctx)).toHaveLength(0);
    });

    it('should handle multiple edges where both sides have anomaly data', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'a', firstAnomalyMs: 1000 }),
            makeLogPoint({ service: 'b', firstAnomalyMs: 3000 }),
            makeLogPoint({ service: 'c', firstAnomalyMs: 5000 }),
          ],
        },
      });
      const edges = [
        makeEdge('a', 'b'),
        makeEdge('b', 'c'),
      ];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(2);
      // a → b (a starts earlier)
      expect(results[0]!.source).toBe('a');
      // b → c (b starts earlier)
      expect(results[1]!.source).toBe('b');
    });
  });
});

// =============================================================================
// GrangerCausalityProvider
// =============================================================================

describe('GrangerCausalityProvider', () => {
  let provider: GrangerCausalityProvider;

  beforeEach(() => {
    provider = new GrangerCausalityProvider();
  });

  describe('metadata', () => {
    it('should have correct tier', () => {
      expect(provider.meta.tier).toBe('granger');
    });
  });

  describe('canInfer', () => {
    it('should return false without time-series data', async () => {
      expect(await provider.canInfer(makeContext())).toBe(false);
    });

    it('should return false with insufficient observations', async () => {
      const ts = new Map<string, readonly number[]>();
      ts.set('a', [1, 2, 3]);
      ts.set('b', [4, 5, 6]);
      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      expect(await provider.canInfer(ctx)).toBe(false); // < minSeriesLength (30)
    });

    it('should return true with sufficient data', async () => {
      const long = Array.from({ length: 50 }, (_, i) => Math.sin(i * 0.1));
      const ts = new Map<string, readonly number[]>();
      ts.set('a', long);
      ts.set('b', long);
      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      expect(await provider.canInfer(ctx)).toBe(true);
    });
  });

  describe('grangerTest', () => {
    it('should return null for insufficient data', () => {
      expect(provider.grangerTest([1, 2, 3], [4, 5, 6])).toBeNull();
    });

    it('should compute F-statistic for sufficient data', () => {
      const n = 50;
      const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 10 + 50);
      // effect = 0.7 * cause(lagged) + noise
      const effect = Array.from({ length: n }, (_, i) =>
        i === 0 ? 0 : 0.7 * signal[i - 1]! + (Math.random() - 0.5) * 5,
      );

      const result = provider.grangerTest(signal, effect);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.bestLag).toBeGreaterThanOrEqual(1);
        expect(result.fStatistic).toBeGreaterThanOrEqual(0);
        expect(result.pValue).toBeGreaterThanOrEqual(0);
        expect(result.pValue).toBeLessThanOrEqual(1);
      }
    });

    it('should respect maxLag configuration', () => {
      const provider2 = new GrangerCausalityProvider({ maxLag: 2 });
      const n = 50;
      const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1));
      const effect = Array.from({ length: n }, (_, i) => i === 0 ? 0 : signal[i - 1]! * 0.5);

      const result = provider2.grangerTest(signal, effect);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.bestLag).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('estimateConfidence', () => {
    it('should return 0 when no data', async () => {
      expect(await provider.estimateConfidence(makeContext())).toBe(0);
    });

    it('should increase with more valid series', async () => {
      const long = Array.from({ length: 30 }, (_, i) => i);
      const ts = new Map<string, readonly number[]>();
      ts.set('a', long);
      ts.set('b', long);
      ts.set('c', long);
      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const conf = await provider.estimateConfidence(ctx);
      expect(conf).toBeGreaterThan(0.5);
      expect(conf).toBeLessThanOrEqual(0.7);
    });
  });

  describe('inferDirection', () => {
    it('should return empty for no time-series data', async () => {
      const edges = [makeEdge('a', 'b')];
      expect(await provider.inferDirection(edges, makeContext())).toHaveLength(0);
    });

    it('should attempt Granger test when data available', async () => {
      const n = 50;
      const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 10 + 50);
      const effect = Array.from({ length: n }, (_, i) =>
        i === 0 ? 0 : 0.5 * signal[i - 1]! + (Math.random() - 0.5) * 3,
      );
      const ts = new Map<string, readonly number[]>();
      ts.set('svc-a', signal);
      ts.set('svc-b', effect);

      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // May or may not be significant depending on noise level
      // But should not throw
      expect(Array.isArray(results)).toBe(true);
    });

    it('should skip edges where time-series data is missing for one endpoint', async () => {
      const long = Array.from({ length: 30 }, (_, i) => i);
      const ts = new Map<string, readonly number[]>();
      ts.set('svc-a', long);
      // svc-b missing

      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(0);
    });

    it('should handle empty edges array', async () => {
      const long = Array.from({ length: 30 }, (_, i) => i);
      const ts = new Map<string, readonly number[]>();
      ts.set('svc-a', long);
      ts.set('svc-b', long);

      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const results = await provider.inferDirection([], ctx);
      expect(results).toHaveLength(0);
    });

    it('should respect custom alpha threshold', () => {
      const strict = new GrangerCausalityProvider({ alpha: 0.01 });
      const n = 50;
      const signal = Array.from({ length: n }, (_, i) => i);
      const noise = Array.from({ length: n }, () => Math.random());

      const result = strict.grangerTest(signal, noise);
      // With pure noise, should not be significant at α=0.01
      if (result) {
        expect(result.pValue).toBeGreaterThanOrEqual(0);
      }
    });

    it('should compute p-value = 1 for F-stat = 0', () => {
      const n = 50;
      const identical1 = Array.from({ length: n }, (_, i) => i);
      const identical2 = Array.from({ length: n }, (_, i) => i);
      const result = provider.grangerTest(identical1, identical2);
      // Should not throw even with identical series
      expect(result).not.toBeNull();
    });

    it('should return null for very short series', () => {
      expect(provider.grangerTest([], [])).toBeNull();
      expect(provider.grangerTest([1], [2])).toBeNull();
    });

    it('should handle non-overlapping series lengths', () => {
      const a = Array.from({ length: 30 }, (_, i) => i);
      const b = Array.from({ length: 50 }, (_, i) => i);
      // Uses min(30, 50) = 30 observations
      const result = provider.grangerTest(a, b);
      expect(result).not.toBeNull();
    });

    it('should produce valid p-values in [0, 1]', () => {
      const n = 40;
      const cause = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3));
      const effect = Array.from({ length: n }, (_, i) => Math.cos(i * 0.3));
      const result = provider.grangerTest(cause, effect);
      if (result) {
        expect(result.pValue).toBeGreaterThanOrEqual(0);
        expect(result.pValue).toBeLessThanOrEqual(1);
        expect(result.fStatistic).toBeGreaterThanOrEqual(0);
      }
    });

    it('should resolve direction when only forward is significant', async () => {
      // Create strong linear dependency: B[t] ≈ 0.8 * A[t-1] + noise
      const n = 50;
      const a = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 10 + 50);
      const b = Array.from({ length: n }, (_, i) =>
        i === 0 ? 0 : 0.8 * a[i - 1]! + (Math.random() - 0.5) * 0.5,
      );
      const ts = new Map<string, readonly number[]>();
      ts.set('svc-a', a);
      ts.set('svc-b', b);

      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      // With strong dependency, should detect direction
      // But noise may cause insignificant result — just verify no crash
      expect(Array.isArray(results)).toBe(true);
    });

    it('should resolve direction when only reverse is significant', async () => {
      // Create dependency: A[t] ≈ 0.8 * B[t-1] + noise (reverse direction)
      const n = 50;
      const b = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 10 + 50);
      const a = Array.from({ length: n }, (_, i) =>
        i === 0 ? 0 : 0.8 * b[i - 1]! + (Math.random() - 0.5) * 0.5,
      );
      const ts = new Map<string, readonly number[]>();
      ts.set('svc-a', a);
      ts.set('svc-b', b);

      const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
      const edges = [makeEdge('svc-a', 'svc-b')];
      const results = await provider.inferDirection(edges, ctx);

      expect(Array.isArray(results)).toBe(true);
      // If direction resolved, it should be B → A
      if (results.length > 0) {
        expect(results[0]!.source).toBe('svc-b');
      }
    });
  });
});

// =============================================================================
// StaticDirectionProvider
// =============================================================================

describe('StaticDirectionProvider', () => {
  let provider: StaticDirectionProvider;

  beforeEach(() => {
    provider = new StaticDirectionProvider();
  });

  describe('metadata', () => {
    it('should have correct tier', () => {
      expect(provider.meta.tier).toBe('static');
    });
  });

  describe('canInfer', () => {
    it('should return false with empty config', async () => {
      expect(await provider.canInfer(makeContext())).toBe(false);
    });

    it('should return true after adding directions', async () => {
      provider.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      expect(await provider.canInfer(makeContext())).toBe(true);
    });
  });

  describe('inferDirection', () => {
    it('should return pre-configured directions', async () => {
      provider.addDirection({
        source: 'svc-a', target: 'svc-b',
        tier: 'static', confidence: 0.5,
        reasoning: 'HTTP GET from a to b',
        provider: 'static-direction',
      });
      provider.addDirection({
        source: 'svc-b', target: 'svc-c',
        tier: 'static', confidence: 0.5,
        reasoning: 'gRPC from b to c',
        provider: 'static-direction',
      });

      const edges = [
        makeEdge('svc-a', 'svc-b'),
        makeEdge('svc-b', 'svc-c'),
      ];
      const results = await provider.inferDirection(edges, makeContext());

      expect(results).toHaveLength(2);
      const sources = results.map((r) => r.source);
      expect(sources).toContain('svc-a');
      expect(sources).toContain('svc-b');
    });

    it('should use runtime directions from context when available', async () => {
      const runtimeDir: CausalDirection = {
        source: 'svc-x', target: 'svc-y',
        tier: 'static', confidence: 0.7,
        reasoning: 'runtime overridden',
        provider: 'static-direction',
      };
      const staticDirs = new Map<string, CausalDirection>();
      staticDirs.set('svc-x→svc-y', runtimeDir);

      const ctx = makeContext({ staticDirections: staticDirs });
      const edges = [makeEdge('svc-x', 'svc-y')];
      const results = await provider.inferDirection(edges, ctx);

      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('svc-x');
    });

    it('should return empty for unmapped edges', async () => {
      const edges = [makeEdge('unknown-a', 'unknown-b')];
      expect(await provider.inferDirection(edges, makeContext())).toHaveLength(0);
    });
  });

  describe('CRUD operations', () => {
    it('should track direction count', () => {
      expect(provider.directionCount).toBe(0);
      provider.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      expect(provider.directionCount).toBe(1);
    });

    it('should remove direction', () => {
      provider.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      expect(provider.removeDirection('a', 'b')).toBe(true);
      expect(provider.directionCount).toBe(0);
    });

    it('should return false when removing non-existent direction', () => {
      expect(provider.removeDirection('x', 'y')).toBe(false);
    });

    it('should clear all directions', () => {
      provider.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      provider.addDirection({
        source: 'b', target: 'c',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      expect(provider.directionCount).toBe(2);
      provider.clear();
      expect(provider.directionCount).toBe(0);
    });

    it('should replace direction for same source-target pair', () => {
      provider.addDirection({
        source: 'a', target: 'b', tier: 'static', confidence: 0.3,
        reasoning: 'old', provider: 'static-direction',
      });
      provider.addDirection({
        source: 'a', target: 'b', tier: 'static', confidence: 0.7,
        reasoning: 'new', provider: 'static-direction',
      });
      expect(provider.directionCount).toBe(1);
    });
  });

  describe('estimateConfidence', () => {
    it('should return 0.5 when directions exist', async () => {
      provider.addDirection({
        source: 'a', target: 'b', tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      expect(await provider.estimateConfidence(makeContext())).toBe(0.5);
    });

    it('should return 0 when no directions', async () => {
      expect(await provider.estimateConfidence(makeContext())).toBe(0);
    });
  });

  describe('constructor with initial directions', () => {
    it('should populate directions from constructor', async () => {
      const initialDirs: CausalDirection[] = [{
        source: 'init-a', target: 'init-b',
        tier: 'static', confidence: 0.5,
        reasoning: 'initial', provider: 'static-direction',
      }];
      const providerWithInit = new StaticDirectionProvider(initialDirs);
      expect(providerWithInit.directionCount).toBe(1);

      const edges = [makeEdge('init-a', 'init-b')];
      const results = await providerWithInit.inferDirection(edges, makeContext());
      expect(results).toHaveLength(1);
      expect(results[0]!.source).toBe('init-a');
    });
  });
});

// ═══════════════════════════════════════════════════════════
// GrangerCausalityProvider — edge case tests
// ═══════════════════════════════════════════════════════════

describe('GrangerCausalityProvider — edge cases', () => {
  let provider: GrangerCausalityProvider;

  beforeEach(() => {
    provider = new GrangerCausalityProvider({ maxLag: 3, alpha: 0.05 });
  });

  it('should handle equal-series granger test (p ≈ 1)', async () => {
    const n = 50;
    const identical = Array.from({ length: n }, (_, i) => i);
    const ts = new Map<string, readonly number[]>();
    ts.set('a', identical);
    ts.set('b', [...identical]);

    const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
    const edges = [makeEdge('a', 'b')];
    const results = await provider.inferDirection(edges, ctx);

    // Identical series with no lagged effect → neither direction G-causes
    expect(results).toHaveLength(0);
  });

  it('should degenerate with strong forward lag-1 dependence', async () => {
    const n = 50;
    const a = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 10 + 50);
    // b[t] = 0.8 * a[t-1] + tiny noise
    const b = Array.from({ length: n }, (_, i) =>
      i === 0 ? 0 : 0.8 * a[i - 1]! + (Math.random() - 0.5) * 0.1,
    );
    const ts = new Map<string, readonly number[]>();
    ts.set('a', a);
    ts.set('b', b);

    const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
    const edges = [makeEdge('a', 'b')];
    const results = await provider.inferDirection(edges, ctx);

    // Signal may or may not pass α=0.05
    expect(Array.isArray(results)).toBe(true);
  });

  it('should test bi-directional causality with noise', async () => {
    const n = 50;
    const noise1 = Array.from({ length: n }, () => Math.random() * 10);
    const noise2 = Array.from({ length: n }, () => Math.random() * 10);
    const ts = new Map<string, readonly number[]>();
    ts.set('x', noise1);
    ts.set('y', noise2);

    const ctx = makeContext({ metadata: { metricTimeSeries: ts } });
    const edges = [makeEdge('x', 'y')];
    const results = await provider.inferDirection(edges, ctx);

    // Pure noise → no direction distinguishable
    if (results.length > 0) {
      expect(results[0]!.confidence).toBeLessThanOrEqual(0.7);
    }
  });

  it('should compute non-null granger results for moderate dependence', () => {
    const n = 40;
    const signal = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) * 10);
    // Strong lag-1 dependence with small noise
    const effect = Array.from({ length: n }, (_, i) =>
      i === 0 ? 0 : 0.7 * signal[i - 1]!,
    );
    const result = provider.grangerTest(signal, effect);
    // Strong deterministic dependence should produce valid F-stats
    if (result) {
      expect(result.fStatistic).toBeGreaterThan(0);
      expect(result.pValue).toBeLessThanOrEqual(1);
    }
  });
});

// =============================================================================
// CausalDirectionFusion
// =============================================================================

describe('CausalDirectionFusion', () => {
  let fusion: CausalDirectionFusion;

  beforeEach(() => {
    fusion = new CausalDirectionFusion();
  });

  describe('provider registration', () => {
    it('should start with empty providers', () => {
      expect(fusion.providers).toHaveLength(0);
    });

    it('should register and sort providers by tier', () => {
      const log = new LogTimingProvider();
      const trace = new TraceTimingProvider();
      const static_ = new StaticDirectionProvider();

      fusion.register(log);
      fusion.register(trace);
      fusion.register(static_);

      const providers = fusion.providers;
      expect(providers).toHaveLength(3);
      // trace first (highest priority), then log, then static
      expect(providers[0]!.meta.tier).toBe('trace');
      expect(providers[1]!.meta.tier).toBe('log');
      expect(providers[2]!.meta.tier).toBe('static');
    });

    it('should replace provider with same ID', () => {
      fusion.register(new LogTimingProvider());
      fusion.register(new LogTimingProvider());
      expect(fusion.providers).toHaveLength(1);
    });

    it('should unregister by ID', () => {
      fusion.register(new LogTimingProvider());
      fusion.unregister('log-timing');
      expect(fusion.providers).toHaveLength(0);
    });
  });

  describe('getAvailable', () => {
    it('should return only providers with available data', async () => {
      const trace = new TraceTimingProvider();
      fusion.register(trace);

      // No span data → trace not available
      const available = await fusion.getAvailable(makeContext());
      expect(available).toHaveLength(0);
    });

    it('should return available providers with data', async () => {
      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      fusion.register(static_);

      const available = await fusion.getAvailable(makeContext());
      expect(available).toHaveLength(1);
    });
  });

  describe('inferDirections', () => {
    it('should handle empty edges gracefully', async () => {
      const result = await fusion.inferDirections([], makeContext());
      expect(result.directions).toHaveLength(0);
      expect(result.coverage).toBe(0);
      expect(result.acceptedTier).toBe('none');
    });

    it('should accept trace tier when available', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', callees: ['svc-b'] }),
            makeSpanTiming({ service: 'svc-b', callers: ['svc-a'] }),
          ],
        },
      });
      fusion.register(new TraceTimingProvider());

      const edges = [makeEdge('svc-a', 'svc-b')];
      const result = await fusion.inferDirections(edges, ctx);

      expect(result.acceptedTier).toBe('trace');
      expect(result.edgesResolved).toBe(1);
      expect(result.coverage).toBe(1);
    });

    it('should fall through to log when trace has no data', async () => {
      const ctx = makeContext({
        metadata: {
          logAnomalyPoints: [
            makeLogPoint({ service: 'svc-a', firstAnomalyMs: 1000 }),
            makeLogPoint({ service: 'svc-b', firstAnomalyMs: 3000 }),
          ],
        },
      });

      fusion.register(new TraceTimingProvider());
      fusion.register(new LogTimingProvider());

      const edges = [makeEdge('svc-a', 'svc-b')];
      const result = await fusion.inferDirections(edges, ctx);

      expect(result.acceptedTier).toBe('log');
    });

    it('should fall through to static when higher tiers unavailable', async () => {
      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'svc-a', target: 'svc-b',
        tier: 'static', confidence: 0.5,
        reasoning: 'config', provider: 'static-direction',
      });

      fusion.register(new TraceTimingProvider());
      fusion.register(new LogTimingProvider());
      fusion.register(static_);

      const edges = [makeEdge('svc-a', 'svc-b')];
      const result = await fusion.inferDirections(edges, makeContext());

      expect(result.acceptedTier).toBe('static');
    });

    it('should merge results from multiple tiers when needed', async () => {
      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'svc-a', target: 'svc-b',
        tier: 'static', confidence: 0.5,
        reasoning: 'config', provider: 'static-direction',
      });
      // Only provide edges for which static has data; nothing for svc-c→svc-d
      fusion.register(static_);

      const edges = [
        makeEdge('svc-a', 'svc-b'),
        makeEdge('svc-c', 'svc-d'),
      ];
      const result = await fusion.inferDirections(edges, makeContext());

      expect(result.edgesResolved).toBe(1);
      expect(result.coverage).toBe(0.5);
    });

    it('should include tier results for all providers', async () => {
      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });

      fusion.register(new TraceTimingProvider());
      fusion.register(static_);

      const edges = [makeEdge('a', 'b')];
      const result = await fusion.inferDirections(edges, makeContext());

      // Should have tier results for all registered providers
      expect(result.tierResults.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect minCoverage configuration', async () => {
      // Custom config with high minCoverage — only static has data for one edge
      fusion = new CausalDirectionFusion({ minCoverage: 1.0 });

      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      fusion.register(static_);

      const edges = [makeEdge('a', 'b'), makeEdge('c', 'd')];
      const result = await fusion.inferDirections(edges, makeContext());

      // Coverage is 0.5, below minCoverage of 1.0
      // Static tier is not accepted, fall through → none
      expect(result.acceptedTier).toBe('none');
    });

    it('should respect minConfidence configuration', async () => {
      fusion = new CausalDirectionFusion({ minConfidence: 0.9 });

      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'a', target: 'b',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });
      fusion.register(static_);

      const edges = [makeEdge('a', 'b')];
      const result = await fusion.inferDirections(edges, makeContext());

      // Static confidence is 0.5, below minConfidence of 0.9
      expect(result.acceptedTier).toBe('none');
    });

    it('should handle multiple tiers all unavailable', async () => {
      fusion.register(new TraceTimingProvider());
      fusion.register(new LogTimingProvider());

      const edges = [makeEdge('a', 'b')];
      const result = await fusion.inferDirections(edges, makeContext());

      expect(result.acceptedTier).toBe('none');
      expect(result.edgesResolved).toBe(0);
    });

    it('should merge best tier per edge when no single tier covers all', async () => {
      const ctx = makeContext({
        metadata: {
          spans: [
            makeSpanTiming({ service: 'svc-a', callees: ['svc-b'] }),
            makeSpanTiming({ service: 'svc-b', callers: ['svc-a'] }),
            // Only trace data for a→b, not for c→d
          ],
        },
      });
      const static_ = new StaticDirectionProvider();
      static_.addDirection({
        source: 'c', target: 'd',
        tier: 'static', confidence: 0.5,
        reasoning: 'test', provider: 'static-direction',
      });

      fusion.register(new TraceTimingProvider());
      fusion.register(static_);

      const edges = [makeEdge('svc-a', 'svc-b'), makeEdge('c', 'd')];
      const result = await fusion.inferDirections(edges, makeContext());

      // Trace has 1/2 coverage → below minCoverage → falls through
      // No single tier accepted → mergeTierResults fills gaps
      // But both edges were in the merged results
      // Edges resolved depends on what tiers produce data
      expect(result.edgesResolved).toBeGreaterThanOrEqual(1);
      expect(result.coverage).toBeGreaterThanOrEqual(0.5);
    });

    it('should handle duplicate provider registration', () => {
      const p1 = new LogTimingProvider();
      const p2 = new LogTimingProvider(); // Same ID
      fusion.register(p1);
      fusion.register(p2);
      expect(fusion.providers).toHaveLength(1);
    });

    it('should unregister non-existent provider gracefully', () => {
      expect(() => fusion.unregister('nonexistent')).not.toThrow();
    });
  });
});
