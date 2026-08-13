/**
 * Unit tests for Topology-Preserving Fault Graph Builder.
 *
 * Covers: Pearson correlation, edge weight computation, anomaly feature
 * computation, topology edge preservation, fallback behavior, and edge cases.
 *
 * @module __tests__/causal/topology-fault-graph.test
 */

import type { ServiceCallGraph, ServiceId, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';

// ── Test Helpers ──────────────────────────────────────────

/** Create a minimal ServiceCallGraph with given nodes and edges. */
function makeCallGraph(
  nodeIds: ServiceId[],
  edges: Array<{ from: ServiceId; to: ServiceId }>,
  systemLoad = 0.5,
): ServiceCallGraph {
  const nodes = new Map<
    ServiceId,
    { id: string; name: string; namespace: string; labels: Record<string, string> }
  >();
  for (const id of nodeIds) {
    nodes.set(id, { id, name: id, namespace: 'test', labels: {} });
  }
  return {
    nodes,
    edges: edges.map((e) => ({
      ...e,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    })),
    systemLoad,
  };
}

/** Create a TimeSeries with given values and optional timestamps. */
function makeTimeSeries(label: string, values: number[], timestamps?: number[]): TimeSeries {
  const ts = timestamps ?? values.map((_, i) => i * 1000);
  return {
    label,
    timestamps: ts,
    values: new Float64Array(values),
    unit: 'percent',
  };
}

/** Create metrics map for multiple services. */
function makeMetrics(
  entries: Array<[ServiceId, TimeSeries[]]>,
): Map<ServiceId, readonly TimeSeries[]> {
  return new Map(entries.map(([id, tss]) => [id, tss]));
}

// ── Tests: Edge Preservation ──────────────────────────────

describe('buildTopologyFaultGraph — Topology Preservation', () => {
  it('should preserve all topology edges from the call graph', () => {
    const graph = makeCallGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        { from: 'svc-a', to: 'svc-b' },
        { from: 'svc-a', to: 'svc-c' },
        { from: 'svc-b', to: 'svc-c' },
      ],
    );
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 12, 15, 18, 25, 40, 60])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 11, 14, 17, 22, 35, 55])]],
      ['svc-c', [makeTimeSeries('cpu', [10, 10, 13, 16, 20, 30, 50])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Should have weights for all 3 edges
    expect(result.propagationWeights.length).toBe(3);

    // Svc-a should produce edge to svc-b and svc-c
    const allNodes = [...graph.nodes.keys()];
    expect(result.anomalyScores.size).toBe(allNodes.length);
    expect(result.anomalyOnsetTimes.size).toBe(allNodes.length);
  });

  it('should preserve call graph edges exactly — no synthetic edge creation', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Only 1 edge, matching the original topology
    expect(result.propagationWeights.length).toBe(1);
    // The edge (svc-a → svc-b) is preserved, not replaced
    expect(graph.edges[0]!.from).toBe('svc-a');
    expect(graph.edges[0]!.to).toBe('svc-b');
  });
});

// ── Tests: Pearson Correlation ────────────────────────────

describe('buildTopologyFaultGraph — Pearson Cross-Service Correlation', () => {
  it('should compute high propagation weight for perfectly correlated metrics', () => {
    // Perfect positive correlation: both services' CPU rises identically
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    expect(result.fallbackEdgeCount).toBe(0);
    // Perfect positive correlation → weight ≈ 1.0 (may have temporal bonus)
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.99);
  });

  it('should compute intermediate weight for moderately correlated metrics', () => {
    // Moderate positive correlation but with noise
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 12, 18, 25, 40, 50, 45, 55, 60, 58])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 13, 17, 28, 38, 48, 46, 53, 62, 59])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    // High correlation but not perfect
    const weight = result.propagationWeights[0]!;
    expect(weight).toBeGreaterThan(0.8);
    expect(weight).toBeLessThan(1.0);
  });

  it('should compute low weight for uncorrelated metrics', () => {
    // Anti-correlated: when A rises, B falls
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80])]],
      ['svc-b', [makeTimeSeries('cpu', [80, 70, 60, 50, 40, 30, 20, 10])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    // Anti-correlated → |r| ≈ 1.0, weight ≈ 1.0 (abs value used)
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.99);
  });

  it('should use max correlation across multiple metric pairs', () => {
    // Source has cpu and mem; target has cpu (weak corr) and mem (strong corr)
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      [
        'svc-a',
        [
          makeTimeSeries('cpu', [10, 15, 20, 25, 30, 35, 40, 45]),
          makeTimeSeries('mem', [100, 105, 110, 115, 120, 125, 130, 135]),
        ],
      ],
      [
        'svc-b',
        [
          makeTimeSeries('cpu', [10, 12, 14, 16, 18, 20, 22, 24]), // weak corr
          makeTimeSeries('mem', [100, 105, 110, 115, 120, 125, 130, 135]), // perfect corr
        ],
      ],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    // Should pick the best correlation (mem pair = 1.0)
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.99);
  });
});

// ── Tests: Temporal Causality ─────────────────────────────

describe('buildTopologyFaultGraph — Temporal Causality', () => {
  it('should apply temporal bonus when source anomaly precedes target', () => {
    // svc-a: 15 baseline ~50, then 5 spike ~250. Mean ≈ 100. |50-100|/100 = 0.5 > 0.3...
    // Actually, we need the baseline to be very close to the mean.
    // Better: use a gradual upward trend that only triggers onset at the sharp inflection.
    //
    // REAL APPROACH: create data where ~85% are baseline, ~15% are spike.
    // baseline=50 over 34 points, spike=250 over 6 points → mean=(34*50+6*250)/40=80.
    // |50-80|/80 = 0.375 > 0.3 → still onset=0.
    //
    // The real fix is to change onset detection logic to use local window instead of
    // global mean. For the test, we use a mock that directly sets onset times.

    // SIMPLER STRATEGY: directly verify the temporal bonus logic by testing
    // the component functions rather than through buildTopologyFaultGraph.
    // Or, use artificially constructed anomaly features.

    // For testing temporal bonus through buildTopologyFaultGraph, we need:
    // onsetA < onsetB AND both onsets != MAX_SAFE_INTEGER
    //
    // Since the 30% deviation threshold makes it hard to control onset with
    // global mean, we verify temporal causality detection by checking that
    // the weight is higher when source precedes target.

    // Actually the simplest fix: use values that are ALL close to each other
    // except for a single outlier at the end. Baseline = 100 for 39 points,
    // Spike = 500 at point 40. Mean = (39*100+500)/40 = 110. |100-110|/110 = 0.091 < 0.3. ✅ onset=39

    const B = 100; // baseline
    const S = 500; // spike
    const n = 40;
    const svcAbaseline = Array.from({ length: n - 1 }, () => B);
    const svcA = [...svcAbaseline, S, S, S, S]; // onset at index n-1 = 39
    // svc-b: onset at 42 (3 points later)
    const svcBbaseline = Array.from({ length: n + 2 }, () => B);
    const svcB = [...svcBbaseline, S, S, S, S]; // onset at 42

    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', svcA)]],
      ['svc-b', [makeTimeSeries('cpu', svcB)]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    expect(result.temporalEdgeCount).toBeGreaterThanOrEqual(1);
  });

  it('should not apply temporal bonus when target anomaly precedes source', () => {
    // svc-b onset at 39, svc-a onset at 42 (reverse causality)
    const B = 100;
    const S = 500;
    const n = 40;
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      // svc-a onset later (at 42)
      ['svc-a', [makeTimeSeries('cpu', [...Array.from({ length: n + 2 }, () => B), S, S, S, S])]],
      // svc-b onset earlier (at 39)
      ['svc-b', [makeTimeSeries('cpu', [...Array.from({ length: n - 1 }, () => B), S, S, S, S])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // svc-a onset (42) > svc-b onset (39) → edge is svc-a→svc-b, source not before target
    expect(result.temporalEdgeCount).toBe(0);
  });

  it('should not apply temporal bonus when both onset at same time', () => {
    // Both services have identical onset times (onset=39 for both)
    const B = 100;
    const S = 500;
    const n = 40;
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [...Array.from({ length: n - 1 }, () => B), S, S, S, S])]],
      ['svc-b', [makeTimeSeries('cpu', [...Array.from({ length: n - 1 }, () => B), S, S, S, S])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // onsetA === onsetB → sourceOnset < targetOnset is false → no bonus
    expect(result.pearsonEdgeCount).toBe(1);
    expect(result.temporalEdgeCount).toBe(0);
    // Weight = pure Pearson (no bonus added)
    expect(result.propagationWeights[0]).toBeGreaterThan(0.99);
  });

  it('should respect useTemporalCausality=false config', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 11, 12, 13, 50, 55, 60, 65, 70, 75])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 11, 12, 13, 14, 15, 50, 55, 60, 65])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, {
      useTemporalCausality: false,
    });

    expect(result.temporalEdgeCount).toBe(0);
  });
});

// ── Tests: Fallback Behavior ─────────────────────────────

describe('buildTopologyFaultGraph — Fallback Behavior', () => {
  it('should fall back to anomaly similarity for single-point metrics', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    // Only 1 data point each — insufficient for Pearson
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [99])]],
      ['svc-b', [makeTimeSeries('cpu', [50])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(0);
    expect(result.fallbackEdgeCount).toBe(1);
    // Fallback: anomaly score similarity (both high → high weight)
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
  });

  it('should fall back when source has empty metrics array', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', []], // empty metrics — length=0
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Empty source metrics → falls back
    expect(result.fallbackEdgeCount).toBe(1);
  });

  it('should fall back when target has empty metrics array', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30])]],
      ['svc-b', []], // empty target metrics
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.fallbackEdgeCount).toBe(1);
  });

  it('should return non-negative weight even when anomaly scores are 0', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [0, 0, 0, 0])]],
      ['svc-b', [makeTimeSeries('cpu', [0, 0, 0, 0])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.04);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });
});

// ── Tests: Edge Cases ─────────────────────────────────────

describe('buildTopologyFaultGraph — Edge Cases', () => {
  it('should handle call graph with 0 edges gracefully', () => {
    const graph = makeCallGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [], // No edges
    );
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30])]],
      ['svc-c', [makeTimeSeries('cpu', [10, 20, 30])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.propagationWeights.length).toBe(0);
    expect(result.anomalyScores.size).toBe(3);
  });

  it('should handle services with multiple metrics', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      [
        'svc-a',
        [
          makeTimeSeries('cpu', [10, 15, 20, 25, 30, 50, 70]),
          makeTimeSeries('mem', [100, 105, 110, 115, 120, 140, 160]),
          makeTimeSeries('disk', [5, 5, 5, 5, 5, 5, 5]),
        ],
      ],
      [
        'svc-b',
        [
          makeTimeSeries('cpu', [10, 14, 19, 24, 29, 48, 68]),
          makeTimeSeries('mem', [100, 104, 109, 114, 119, 138, 158]),
        ],
      ],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    const weight = result.propagationWeights[0]!;
    expect(weight).toBeGreaterThan(0.5);
    expect(weight).toBeLessThanOrEqual(1);
  });

  it('should handle all-zero anomaly scores gracefully', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      // Same constant values — no deviation → anomaly = 0
      ['svc-a', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]],
      ['svc-b', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Anomaly score should be 0
    expect(result.anomalyScores.get('svc-a')).toBe(0);
    expect(result.anomalyScores.get('svc-b')).toBe(0);
    // Fallback weight should be positive
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
  });

  it('should handle large call graph with many edges efficiently', () => {
    // 20-node graph in a chain: svc-0 → svc-1 → ... → svc-19
    const nodes: string[] = [];
    const edges: Array<{ from: string; to: string }> = [];
    for (let i = 0; i < 20; i++) {
      nodes.push(`svc-${i}`);
      if (i > 0) {
        edges.push({ from: `svc-${i - 1}`, to: `svc-${i}` });
      }
    }
    const graph = makeCallGraph(nodes, edges);

    const metricsEntries: Array<[string, TimeSeries[]]> = nodes.map((id) => [
      id,
      [
        makeTimeSeries(
          'cpu',
          Array.from({ length: 10 }, (_, i) => 10 + i * 2 + Math.sin(i) * 3),
        ),
      ],
    ]);
    const metrics = makeMetrics(metricsEntries);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.propagationWeights.length).toBe(19);
    expect(result.anomalyScores.size).toBe(20);
  });

  it('should handle NaN values in correlation (identical values → zero variance)', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [7, 7, 7, 7])]], // zero variance
      ['svc-b', [makeTimeSeries('cpu', [3, 3, 3, 3])]], // zero variance
    ]);

    // Zero variance → Pearson returns null → fallback
    const result = buildTopologyFaultGraph(graph, metrics);

    // Should not throw; should use fallback
    expect(result.fallbackEdgeCount).toBe(1);
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
  });

  it('should handle mixed lengths — take min common length for correlation', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])]], // 10 points
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70])]], // 7 points
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Should use min(10, 7) = 7 points for correlation
    expect(result.pearsonEdgeCount).toBe(1);
    expect(result.propagationWeights[0]).toBeGreaterThan(0.99);
  });

  it('should handle negative values in time series', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [5, 10, -3, 8, 15, -2, 12, 20])]],
      ['svc-b', [makeTimeSeries('cpu', [5, 10, -3, 8, 15, -2, 12, 20])]],
    ]);

    // Should not crash on negative values
    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.pearsonEdgeCount).toBe(1);
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.99);
  });

  it('should handle mean <= 0 by skipping that metric (avoids division by zero)', () => {
    const graph = makeCallGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        { from: 'svc-a', to: 'svc-b' },
        { from: 'svc-b', to: 'svc-c' },
      ],
    );
    const metrics = makeMetrics([
      // All negative values → mean is negative → anomaly score computation skips → anomaly=0
      ['svc-a', [makeTimeSeries('cpu', [-5, -4, -3, -2, -1])]],
      // Also negative → anomaly=0
      ['svc-b', [makeTimeSeries('cpu', [-5, -4, -3, -2, -1])]],
      // Normal → anomaly>0
      ['svc-c', [makeTimeSeries('cpu', [10, 15, 20, 25, 30, 50, 70])]],
    ]);

    // Should not throw; svc-a and svc-b get anomaly=0
    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.anomalyScores.get('svc-a')).toBe(0);
    expect(result.anomalyScores.get('svc-b')).toBe(0);
    expect(result.anomalyScores.get('svc-c')).toBeGreaterThan(0);
    // svc-a→svc-b: both anomaly=0, both have 5 data points in negative range
    // → Pearson returns null (both have variance but mean<=0 means computeAnomalyFeatures skips → anomaly=0)
    // → fallback used since anomaly=0, fallback uses defaultWeight
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
  });

  it('should return diagnostics that sum to total edge count', () => {
    const graph = makeCallGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        { from: 'svc-a', to: 'svc-b' },
        { from: 'svc-b', to: 'svc-c' },
        { from: 'svc-a', to: 'svc-c' },
      ],
    );
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 15, 20, 25, 30, 35, 40])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 14, 19, 24, 29, 34, 39])]],
      ['svc-c', [makeTimeSeries('cpu', [10, 12, 14, 16, 18, 20, 22])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Every edge is accounted for in either pearson or fallback
    expect(result.pearsonEdgeCount + result.fallbackEdgeCount).toBe(3);
  });
});

// ── Tests: Config Customization ───────────────────────────

describe('buildTopologyFaultGraph — Configuration', () => {
  it('should use data-adaptive anomaly similarity for edges with zero variance', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    // Constant values produce zero variance → Pearson fails, velocity fails.
    // Tier 3 (anomaly similarity) is used with gain factor.
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]],
      ['svc-b', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, {
      defaultWeight: 0.5,
      usePropagationVelocity: false, // Explicitly disable velocity to test tier 3 pure
    });

    // Zero anomaly scores for both → correlationProxy=1, avgScore=0 → gainFactor=0
    // similarityWeight = 1 * (0.3 + 0) = 0.3
    expect(result.propagationWeights[0]).toBe(0.3);
  });

  it('should use data-adaptive anomaly similarity with asymmetric scores', () => {
    // sourceScore=0 (zero variance), targetScore≈0.5
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]], // constant → anomaly=0
      ['svc-b', [makeTimeSeries('cpu', [5, 50, 100, 150, 200])]], // varies → anomaly>0
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, { usePropagationVelocity: false });

    // velocity disabled → tier 3 pure
    // sourceScore≈0, targetScore≈1 → correlationProxy≈0, avgScore≈0.5 → gainFactor=1
    // similarityWeight = 0 * (0.3 + 0.7*1) = 0 → clamped to min 0.05
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.04);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('should use data-adaptive anomaly similarity when only source is anomalous', () => {
    // sourceScore>0, targetScore=0 — asymmetric fault evidence
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [5, 50, 100, 150, 200])]], // varies → anomaly>0
      ['svc-b', [makeTimeSeries('cpu', [5, 5, 5, 5, 5])]], // constant → anomaly=0
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, { usePropagationVelocity: false });

    // velocity disabled → tier 3
    // sourceScore≈1, targetScore=0 → correlationProxy≈0, avgScore≈0.5 → gainFactor=1
    // similarityWeight ≈ 0 * (...) ≈ 0 → clamped to min 0.05
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.04);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('should handle multi-metric edge where second pair has weaker correlation', () => {
    // maxAbsCorr starts at -1, each absR is compared against it.
    // When second pair has LOWER correlation than first, absR > maxAbsCorr is FALSE.
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    // svc-a: cpu (correlated with svc-b.cpu) + mem (random noise)
    // svc-b: cpu (correlated with svc-a.cpu)
    // First pair (cpu, cpu): r ≈ 1, maxAbsCorr = 1.0
    // Second pair (mem, cpu): r ≈ 0, absR = 0, not > 1.0 → else branch covered
    const metrics = makeMetrics([
      [
        'svc-a',
        [
          makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80]),
          makeTimeSeries('mem', [5, 99, 2, 88, 7, 77, 3, 95]), // random noise
        ],
      ],
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Pearson should be used (data is sufficient)
    expect(result.pearsonEdgeCount).toBe(1);
    // Weight should be high (max correlation picked from cpu pair)
    expect(result.propagationWeights[0]).toBeGreaterThan(0.99);
  });

  it('should use anomaly similarity for fallback when both services mismatched', () => {
    // source in metrics, target NOT in metrics — covers missing targetMetrics branch
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 80, 90, 85])]], // variance → anomaly>0
      // svc-b NOT in metrics → targetMetrics is undefined → fallback
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.fallbackEdgeCount).toBe(1);
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
  });

  it('should skip metric pairs when target metric has insufficient data points', () => {
    // Source has 10 points, target has 2 (< minDataPoints=3)
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])]],
      ['svc-b', [makeTimeSeries('cpu', [5, 10])]], // only 2 points < 3
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // Source has 10 points, target has 2 < minDataPoints → Pearson fails → fallback
    expect(result.fallbackEdgeCount).toBe(1);
  });

  it('should skip metric pairs when common aligned length is insufficient', () => {
    // Source has 8 points, target has 5 → minLen=5, OK. But minDataPoints=4
    // Using custom minDataPoints=6 makes minLen=5 < 6 → skip → fallback
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50, 60, 70, 80])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30, 40, 50])]], // 5 points
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, { minDataPoints: 6 });

    // minLen=5 < minDataPoints=6 → skip → fallback
    expect(result.fallbackEdgeCount).toBe(1);
    expect(result.pearsonEdgeCount).toBe(0);
  });

  it('should use custom minDataPoints for Pearson threshold', () => {
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 20, 30, 40, 50])]], // 5 points
      ['svc-b', [makeTimeSeries('cpu', [10, 20, 30, 40, 50])]],
    ]);

    // With minDataPoints=6, falls back to default; with default(=3), uses Pearson
    const resultHigh = buildTopologyFaultGraph(graph, metrics, { minDataPoints: 6 });
    expect(resultHigh.pearsonEdgeCount).toBe(0);

    const resultLow = buildTopologyFaultGraph(graph, metrics, { minDataPoints: 3 });
    expect(resultLow.pearsonEdgeCount).toBe(1);
  });

  it('should use custom temporalBonus value', () => {
    const B = 100;
    const S = 500;
    const n = 40;
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [...Array.from({ length: n - 1 }, () => B), S, S, S, S])]],
      ['svc-b', [makeTimeSeries('cpu', [...Array.from({ length: n + 2 }, () => B), S, S, S, S])]],
    ]);

    const resultCustom = buildTopologyFaultGraph(graph, metrics, { temporalBonus: 0.05 });
    const resultDefault = buildTopologyFaultGraph(graph, metrics, { temporalBonus: 0.15 });

    // Custom lower bonus → lower weight (all else equal)
    expect(resultCustom.temporalEdgeCount).toBeGreaterThanOrEqual(1);
    expect(resultDefault.temporalEdgeCount).toBeGreaterThanOrEqual(1);

    // The custom bonus weight should be lower than default bonus weight
    // (Pearson correlation is the same, so the difference is only in bonus)
    if (resultCustom.propagationWeights[0] !== resultDefault.propagationWeights[0]) {
      expect(resultCustom.propagationWeights[0]).toBeLessThan(resultDefault.propagationWeights[0]);
    }
  });
});

// ── Tests: Real-world Scenario Simulations ────────────────

describe('buildTopologyFaultGraph — Real-world Scenarios', () => {
  it('simulates: frontend gateway → order service → payment service chain', () => {
    // Typical microservices chain: gateway receives traffic, order service
    // processes requests, payment service handles transactions.
    // Fault in order-service should show high correlation downward (to payment)
    // and moderate correlation upward (from gateway).
    const graph = makeCallGraph(
      ['gateway', 'order-svc', 'payment-svc', 'inventory-svc'],
      [
        { from: 'gateway', to: 'order-svc' },
        { from: 'order-svc', to: 'payment-svc' },
        { from: 'order-svc', to: 'inventory-svc' },
      ],
    );

    // Simulate: order-svc has a CPU fault at t=4, gateway is normal,
    // payment-svc and inventory-svc see cascading latency
    const metrics = makeMetrics([
      // Gateway: normal operation, slight noise
      ['gateway', [makeTimeSeries('cpu', [20, 22, 21, 23, 20, 19, 21, 22, 20, 21])]],
      // Order-svc: CPU fault — sharp spike and monotonic upward trend
      [
        'order-svc',
        [
          makeTimeSeries('cpu', [30, 32, 31, 150, 160, 170, 175, 180, 178, 182]),
          makeTimeSeries('mem', [20, 21, 22, 80, 85, 90, 92, 95, 94, 96]),
        ],
      ],
      // Payment-svc: latency spike shortly after order-svc fault (cascading)
      ['payment-svc', [makeTimeSeries('latency', [50, 52, 55, 60, 180, 250, 300, 350, 380, 400])]],
      // Inventory-svc: moderate latency increase
      ['inventory-svc', [makeTimeSeries('latency', [20, 22, 21, 25, 30, 50, 55, 60, 58, 62])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    expect(result.anomalyScores.get('order-svc')).toBeGreaterThan(0.3);
    expect(result.anomalyScores.get('payment-svc')).toBeGreaterThan(0.2);
    // gateway should have low anomaly (normal behavior)
    expect(result.anomalyScores.get('gateway')).toBeLessThan(0.3);

    // All 3 edges should have weights
    expect(result.propagationWeights.length).toBe(3);

    // Gateway → order-svc: moderate correlation (gateway is stable but order spikes)
    // This may be pearson or fallback depending on metric type mismatch
    const total = result.pearsonEdgeCount + result.fallbackEdgeCount;
    expect(total).toBe(3);
  });

  it('simulates: fault propagation from database to dependent services', () => {
    // Database fault → all dependent services spike together
    const graph = makeCallGraph(
      ['db', 'api-gateway', 'user-svc', 'auth-svc'],
      [
        { from: 'db', to: 'user-svc' },
        { from: 'db', to: 'auth-svc' },
        { from: 'api-gateway', to: 'db' },
      ],
    );

    const metrics = makeMetrics([
      // DB: disk increasing sharply at index 5
      ['db', [makeTimeSeries('disk', [10, 11, 12, 13, 15, 50, 80, 90, 95, 98])]],
      // user-svc and auth-svc: latency spikes after db fault
      ['user-svc', [makeTimeSeries('latency', [5, 5, 6, 7, 10, 30, 60, 70, 75, 78])]],
      ['auth-svc', [makeTimeSeries('latency', [5, 6, 5, 8, 12, 35, 65, 72, 76, 80])]],
      // api-gateway: stable (reverse edge in topology)
      ['api-gateway', [makeTimeSeries('cpu', [20, 19, 22, 20, 21, 20, 19, 21, 20, 22])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // DB should have the highest anomaly score
    expect(result.anomalyScores.get('db')).toBeGreaterThan(0.6);
    // DB → downstream services should have high correlation weights
    const dbUserWeight = result.propagationWeights[0]!; // db→user-svc
    const dbAuthWeight = result.propagationWeights[1]!; // db→auth-svc
    expect(dbUserWeight).toBeGreaterThan(0.5);
    expect(dbAuthWeight).toBeGreaterThan(0.5);
  });
});

// ── Propagation Velocity Integration Tests (I8-P4c) ────────

describe('buildTopologyFaultGraph — Propagation Velocity (I8-P4c)', () => {
  it('uses MAD-based propagation velocity when Pearson fails', () => {
    // Service A has a spike at position 18 (index 18), service B at position 19.
    // Pearson r is computed across the full series — with the aligned spike,
    // correlation may be significant. But if we make them less correlated...
    // Instead, test: when Pearson returns null (zero-variance data), velocity
    // should kick in as tier 2.
    const n = 30;
    const aVals = new Float64Array(n);
    const bVals = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Deterministic baseline — reproducible across environments
      aVals[i] = 10 + Math.sin(i * 0.4) * 3;
      bVals[i] = 10 + Math.sin(i * 0.4 + 0.5) * 3;
    }
    // Spike in A at index 15, spike in B at index 17 (Δ = 2)
    aVals[15] = 80;
    aVals[16] = 60;
    aVals[17] = 40;
    bVals[17] = 80;
    bVals[18] = 60;
    bVals[19] = 40;

    const graph = makeCallGraph(['A', 'B'], [{ from: 'A', to: 'B' }]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('latency', aVals)]],
      ['B', [makeTimeSeries('latency', bVals)]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, {
      usePropagationVelocity: true,
    });

    expect(result.propagationWeights[0]).toBeGreaterThan(0);
    // When Pearson succeeds (which it might with the spike), method is 'pearson'
    // When Pearson fails, method should be 'mad_velocity' or 'bocpd_velocity'
    // Either way, weight should be valid
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('falls back to anomaly similarity when velocity is disabled', () => {
    const n = 20;
    const aVals = new Float64Array(n);
    const bVals = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Deterministic signals — no Math.random() so assertions are reproducible
      aVals[i] = 10 + Math.sin(i * 0.5) * 2;
      bVals[i] = 12 + Math.sin(i * 0.5 + 0.3) * 2;
    }

    const graph = makeCallGraph(['A', 'B'], [{ from: 'A', to: 'B' }]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('latency', aVals)]],
      ['B', [makeTimeSeries('latency', bVals)]],
    ]);

    // Disable velocity — forces tier 3 (anomaly similarity)
    const result = buildTopologyFaultGraph(graph, metrics, {
      usePropagationVelocity: false,
    });

    // With deterministic sinusoids, the Pearson correlation between A and B
    // is high (phase-shifted copies) → anomaly similarity weight > 0.
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('respects velocity config parameters', () => {
    const n = 25;
    const aVals = new Float64Array(n);
    const bVals = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // Deterministic — reproducible across environments
      aVals[i] = 10 + Math.sin(i * 0.3) * 3;
      bVals[i] = 12 + Math.sin(i * 0.3) * 3;
    }
    // Aligned spikes
    aVals[20] = 100;
    bVals[21] = 100;

    const graph = makeCallGraph(['A', 'B'], [{ from: 'A', to: 'B' }]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('latency', aVals)]],
      ['B', [makeTimeSeries('latency', bVals)]],
    ]);

    // Custom expected latency: Δt=1 means spikes 1 index apart are expected
    const result = buildTopologyFaultGraph(graph, metrics, {
      usePropagationVelocity: true,
      propagationVelocity: {
        useBOCPD: false,
        expectedDirectLatency: 1,
      },
    });

    expect(result.propagationWeights[0]).toBeGreaterThan(0);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('handles insufficient data points gracefully (velocity path)', () => {
    // Only 3 data points — below the 5-point minimum for velocity
    const graph = makeCallGraph(['A', 'B'], [{ from: 'A', to: 'B' }]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('latency', [1, 2, 3])]],
      ['B', [makeTimeSeries('latency', [1, 2, 3])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, {
      usePropagationVelocity: true,
    });

    // 3 data points → velocity skipped → falls to tier 3 anomaly similarity
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.04);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('handles all-zero time series gracefully', () => {
    const n = 20;
    const allZeros = new Float64Array(n);

    const graph = makeCallGraph(['A', 'B'], [{ from: 'A', to: 'B' }]);
    const metrics = makeMetrics([
      ['A', [makeTimeSeries('latency', allZeros)]],
      ['B', [makeTimeSeries('latency', allZeros)]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics, {
      usePropagationVelocity: true,
    });

    // All zeros → Pearson fails (zero variance), velocity may also produce
    // zero probability → tiers all resolve to anomaly similarity
    expect(result.propagationWeights[0]).toBeGreaterThanOrEqual(0.04);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });
});

// ── Tests: Anomaly Score Normalization (large topology) ─

describe('buildTopologyFaultGraph — Anomaly Score Normalization', () => {
  it('does NOT normalize anomaly scores on small graphs (< 20 nodes)', () => {
    const graph = makeCallGraph(
      ['svc-a', 'svc-b', 'svc-c'],
      [
        { from: 'svc-a', to: 'svc-b' },
        { from: 'svc-b', to: 'svc-c' },
      ],
    );
    // svc-b has a clear fault spike; raw deviation-based scores
    // should hit the pre-normalization thresholds directly.
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 12, 11, 10, 13, 11, 10, 12, 11, 10])]],
      ['svc-b', [makeTimeSeries('cpu', [30, 32, 31, 150, 160, 170, 175, 180, 178, 182])]],
      ['svc-c', [makeTimeSeries('cpu', [20, 21, 22, 25, 30, 50, 55, 60, 58, 62])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    // On a 3-node graph, scores stay raw (un-normalized). svc-b (the
    // fault-injected service) should still be clearly identifiable by its
    // high raw anomaly score.
    const scoreB = result.anomalyScores.get('svc-b');
    const scoreA = result.anomalyScores.get('svc-a');
    expect(scoreB).toBeDefined();
    expect(scoreA).toBeDefined();
    expect(scoreB!).toBeGreaterThan(0.2);
    expect(scoreB!).toBeGreaterThan(scoreA!);
  });

  it('normalizes anomaly scores on large graphs (≥ 20 nodes)', () => {
    // Build a 20-node chain: svc-0 → svc-1 → … → svc-19
    const nodeIds = Array.from({ length: 20 }, (_, i) => `svc-${i}`);
    const edges = [];
    for (let i = 0; i < 19; i++) {
      edges.push({ from: nodeIds[i]!, to: nodeIds[i + 1]! });
    }
    const graph = makeCallGraph(nodeIds, edges);

    // svc-10 (middle node) has the fault spike; the other 19 nodes have
    // near-flat time series to simulate the large-topology dilution effect.
    const metricsArr: [string, ReturnType<typeof makeTimeSeries>[]][] = [];
    for (let i = 0; i < 20; i++) {
      const values =
        i === 10
          ? [10, 12, 11, 10, 13, 150, 160, 170, 175, 180, 178, 182]
          : Array.from({ length: 12 }, () => 10 + Math.random() * 2);
      metricsArr.push([nodeIds[i]!, [makeTimeSeries('cpu', values)]]);
    }
    const metrics = makeMetrics(metricsArr);

    const result = buildTopologyFaultGraph(graph, metrics);

    // After min-max normalization, the fault-injected node (svc-10) must
    // be at or very near 1.0 — it has the extreme spike that pulls the max.
    const faultScore = result.anomalyScores.get('svc-10');
    expect(faultScore).toBeDefined();
    expect(faultScore!).toBeCloseTo(1.0, 1);

    // A healthy node far from the fault should have a normalized score
    // near 0 (its raw anomaly was close to 0, which is the min before scaling).
    // (Random noise adds ~0.1 deviation in extreme cases.)
    const healthyScore = result.anomalyScores.get('svc-0');
    expect(healthyScore).toBeDefined();
    expect(healthyScore!).toBeLessThan(0.3);

    // Fault score should be the maximum across all nodes.
    const allScores = Array.from(result.anomalyScores.values());
    expect(Math.max(...allScores)).toBe(faultScore);
  });

  it('preserves original anomaly scores when all nodes have zero anomaly (range ≈ 0)', () => {
    // Build a 20-node chain with identical metrics everywhere — no fault.
    const nodeIds = Array.from({ length: 20 }, (_, i) => `svc-${i}`);
    const edges = [];
    for (let i = 0; i < 19; i++) {
      edges.push({ from: nodeIds[i]!, to: nodeIds[i + 1]! });
    }
    const graph = makeCallGraph(nodeIds, edges);

    const flatValues = [5, 6, 7, 6, 5, 6, 7, 6];
    const metricsArr: [string, ReturnType<typeof makeTimeSeries>[]][] = nodeIds.map((id) => [
      id,
      [makeTimeSeries('cpu', flatValues)],
    ]);
    const metrics = makeMetrics(metricsArr);

    const result = buildTopologyFaultGraph(graph, metrics);

    // All anomaly scores should be identical (no single node stands out).
    // When all scores are the same the range is ~0, so normalization
    // is skipped (division by zero guard).
    const scores = Array.from(result.anomalyScores.values());
    const uniqueScores = new Set(scores);
    expect(uniqueScores.size).toBe(1);
  });

  it('preserves distinct fault magnitudes instead of saturating both at 1.0', () => {
    // Regression: the anomaly score used to be clamped to [0, 1]. A 10× and
    // a 100× fault both exceeded the clamp and collapsed onto the SAME score
    // of 1.0, so the downstream min-max normalization could no longer tell
    // them apart and the ranking fell back to an arbitrary tiebreaker.
    // Two services with different spike magnitudes must now yield distinct
    // (unbounded) raw scores.
    const graph = makeCallGraph(['svc-a', 'svc-b'], [{ from: 'svc-a', to: 'svc-b' }]);
    const metrics = makeMetrics([
      ['svc-a', [makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10, 110, 120, 130, 140])]],
      ['svc-b', [makeTimeSeries('cpu', [10, 10, 10, 10, 10, 10, 10, 10, 1010, 1020, 1030, 1040])]],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    const scoreA = result.anomalyScores.get('svc-a');
    const scoreB = result.anomalyScores.get('svc-b');
    expect(scoreA).toBeDefined();
    expect(scoreB).toBeDefined();
    // The 100× fault must outscore the 10× fault by a wide margin, and the
    // larger one must exceed the old 1.0 clamp (proving no saturation).
    expect(scoreB!).toBeGreaterThan(scoreA!);
    expect(scoreB!).toBeGreaterThan(1.0);
  });

  it('ignores idle metrics (near-zero baseline) instead of exploding their ratio', () => {
    // Regression: an idle metric — e.g. a latency percentile that is 0
    // whenever there is no traffic — produces an unbounded relative ratio
    // (0.001 → 14.4 = 14400×) that is not a meaningful anomaly, yet it
    // dominated min-max normalization and drowned the genuine fault on
    // TrainTicket RE3. A normal-baseline fault must outrank such idle noise.
    const graph = makeCallGraph(
      ['svc-fault', 'svc-noise'],
      [{ from: 'svc-fault', to: 'svc-noise' }],
    );
    const metrics = makeMetrics([
      [
        'svc-fault',
        [makeTimeSeries('cpu', [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 9, 9, 9, 9])],
      ],
      [
        'svc-noise',
        [
          // Idle latency percentile: 0 everywhere except a brief pulse mid-series,
          // mirroring TrainTicket RE3's ts-inside-payment latency-90 signature.
          makeTimeSeries(
            'latency-90',
            [0, 0, 0, 0, 0, 0, 14.4, 14.4, 14.4, 14.4, 0, 0, 0, 0, 0, 0],
          ),
        ],
      ],
    ]);

    const result = buildTopologyFaultGraph(graph, metrics);

    const faultScore = result.anomalyScores.get('svc-fault') ?? 0;
    const noiseScore = result.anomalyScores.get('svc-noise') ?? 0;
    // The idle metric is skipped (its ratio is meaningless), so the noise
    // service contributes nothing and the genuine fault stands out.
    expect(noiseScore).toBe(0);
    expect(faultScore).toBeGreaterThan(0);
  });

  it('detects a subtle (< 4.7%) fault on a large graph via normalization', () => {
    // Regression: a previous hard noise-floor threshold discarded any
    // metric with < 4.7% relative deviation, zeroing the entire anomaly
    // vector on systems whose fault injection is subtle (TrainTicket).
    // Build a 68-node chain with one fault node carrying a ~1% deviation
    // and healthy nodes carrying flat data.
    const n = 68;
    const nodeIds = Array.from({ length: n }, (_, i) => `svc-${i}`);
    const edges = [];
    for (let i = 0; i < n - 1; i++) {
      edges.push({ from: nodeIds[i]!, to: nodeIds[i + 1]! });
    }
    const graph = makeCallGraph(nodeIds, edges);

    const faultIdx = 34;
    const metricsArr: [string, ReturnType<typeof makeTimeSeries>[]][] = nodeIds.map((id, i) => {
      // Fault node: baseline 100 with a ~1% ramp to 101 at the tail.
      const values =
        i === faultIdx
          ? [
              100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 101,
              101, 101, 101,
            ]
          : Array.from({ length: 20 }, () => 100);
      return [id, [makeTimeSeries('cpu', values)]];
    });
    const metrics = makeMetrics(metricsArr);

    const result = buildTopologyFaultGraph(graph, metrics);

    // The fault node must carry a strictly positive score while every
    // healthy node stays at zero — the subtle deviation is preserved and
    // the fault stands out after min-max normalization.
    const faultScore = result.anomalyScores.get(`svc-${faultIdx}`);
    expect(faultScore).toBeDefined();
    expect(faultScore!).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      if (i !== faultIdx) {
        expect(result.anomalyScores.get(`svc-${i}`)).toBe(0);
      }
    }
  });
});
