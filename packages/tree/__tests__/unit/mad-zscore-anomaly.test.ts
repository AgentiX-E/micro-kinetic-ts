/**
 * Tests for MAD-Based Z-Score Anomaly Detection.
 *
 * Validates the new computeAnomalyFeatures() algorithm that replaces
 * the max-ratio approach with robust Median Absolute Deviation (MAD)
 * z-scores.
 *
 * Coverage targets: statements ≥95%, branches ≥95%, functions 100%,
 * lines ≥95%.
 *
 * Mathematical basis:
 *   z_i = 0.6745 × (x_i − median) / MAD
 *   anomaly = clamp(max_i |z_i| / 3, 0, 1)
 */

import type { ServiceCallGraph, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import type { TopologyFaultGraphResult } from '../../src/causal/topology-fault-graph.js';
import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';

// ── Test Helpers ────────────────────────────────────────────

function flatTS(label: string, count: number, value: number): TimeSeries {
  const timestamps: number[] = [];
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    timestamps.push(i * 1000);
    values[i] = value;
  }
  return { label, timestamps, values, unit: 'percent' };
}

function spikeTS(
  label: string,
  count: number,
  baseline: number,
  spikePoint: number,
  spikeValue: number,
): TimeSeries {
  const timestamps: number[] = [];
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    timestamps.push(i * 1000);
    values[i] = i >= spikePoint ? spikeValue : baseline;
  }
  return { label, timestamps, values, unit: 'percent' };
}

function risingTS(label: string, count: number): TimeSeries {
  const timestamps: number[] = [];
  const values = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    timestamps.push(i * 1000);
    values[i] = 0.1 + (0.8 * i) / count;
  }
  return { label, timestamps, values, unit: 'percent' };
}

function makeCallGraph(nodeIds: string[], edges: [string, string][]): ServiceCallGraph {
  const nodes = new Map<string, any>();
  for (const id of nodeIds) {
    nodes.set(id, { id, name: id, namespace: 'test', labels: {} });
  }
  const callEdges = edges.map(([from, to]) => ({
    from,
    to,
    type: 'REST' as const,
    callRate: 100,
    p99Latency: 50,
    errorRate: 0.01,
  }));
  return { nodes, edges: callEdges, systemLoad: 0.5 };
}

function buildFaultGraph(
  nodeIds: string[],
  edges: [string, string][],
  metricsMap: Map<string, TimeSeries[]>,
): TopologyFaultGraphResult {
  const cg = makeCallGraph(nodeIds, edges);
  return buildTopologyFaultGraph(cg, metricsMap);
}

// ── Core Algorithm Tests ────────────────────────────────────

describe('MAD Z-Score Anomaly Detection', () => {
  it('returns zero score for constant flat metrics (no variability)', () => {
    const result = buildFaultGraph(['A'], [], new Map([['A', [flatTS('cpu', 100, 0.5)]]]));
    expect(result.anomalyScores.get('A')).toBeCloseTo(0, 2);
  });

  it('returns near-zero for tiny fluctuation relative to baseline', () => {
    // Small random noise around 0.5 — not anomalous
    const values = new Float64Array(100);
    for (let i = 0; i < 100; i++) values[i] = 0.5 + (Math.random() - 0.5) * 0.001;
    const ts: TimeSeries = {
      label: 'cpu',
      timestamps: Array.from({ length: 100 }, (_, i) => i * 1000),
      values,
      unit: 'percent',
    };
    const result = buildFaultGraph(['A'], [], new Map([['A', [ts]]]));
    expect(result.anomalyScores.get('A')).toBeLessThan(0.15);
  });

  it('detects strong isolated spike as anomaly', () => {
    const result = buildFaultGraph(
      ['A'],
      [],
      new Map([['A', [spikeTS('cpu', 100, 0.1, 90, 100)]]]),
    );
    const score = result.anomalyScores.get('A')!;
    expect(score).toBeGreaterThan(0.5);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('detects sustained gradual rise as anomaly', () => {
    const result = buildFaultGraph(['A'], [], new Map([['A', [risingTS('cpu_usage', 100)]]]));
    expect(result.anomalyScores.get('A')).toBeGreaterThan(0.2);
  });

  it('detects anomaly onset index for spike', () => {
    const result = buildFaultGraph(
      ['A'],
      [],
      new Map([['A', [spikeTS('cpu', 100, 0.1, 50, 100)]]]),
    );
    const onset = result.anomalyOnsetTimes.get('A')!;
    // Onset should be near the spike point (50) not at index 0
    expect(onset).toBeGreaterThan(0);
    expect(onset).toBeLessThan(60); // before or at the spike
  });

  it('handles fewer than 3 data points gracefully', () => {
    const ts1: TimeSeries = {
      label: 'x',
      timestamps: [0],
      values: new Float64Array([1]),
      unit: 'count',
    };
    const ts2: TimeSeries = {
      label: 'x',
      timestamps: [0, 1000],
      values: new Float64Array([1, 2]),
      unit: 'count',
    };
    const result1 = buildFaultGraph(['A'], [], new Map([['A', [ts1]]]));
    const result2 = buildFaultGraph(['A'], [], new Map([['A', [ts2]]]));
    expect(result1.anomalyScores.get('A')).toBe(0);
    expect(result2.anomalyScores.get('A')).toBe(0);
  });

  it('handles undefined service metrics', () => {
    const result = buildFaultGraph(['A'], [], new Map());
    expect(result.anomalyScores.get('A')).toBe(0);
    expect(result.anomalyOnsetTimes.get('A')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles all-zero metric values', () => {
    const ts: TimeSeries = {
      label: 'idle',
      timestamps: [0, 1000, 2000, 3000, 4000],
      values: new Float64Array([0, 0, 0, 0, 0]),
      unit: 'count',
    };
    const result = buildFaultGraph(['A'], [], new Map([['A', [ts]]]));
    expect(result.anomalyScores.get('A')).toBe(0);
  });

  it('handles negative values correctly', () => {
    const ts: TimeSeries = {
      label: 'delta',
      timestamps: Array.from({ length: 100 }, (_, i) => i * 1000),
      values: new Float64Array(100),
      unit: 'count',
    };
    for (let i = 0; i < 100; i++) ts.values[i] = i < 50 ? -0.1 : -100;
    const result = buildFaultGraph(['A'], [], new Map([['A', [ts]]]));
    expect(result.anomalyScores.get('A')).toBeGreaterThan(0.3);
  });

  it('returns valid [0,1] range for all scores', () => {
    const testCases = [
      [spikeTS('a', 50, 0.1, 40, 50)],
      [flatTS('b', 50, 0.5)],
      [risingTS('c', 50)],
      [flatTS('d', 50, 0), flatTS('e', 50, 1)],
    ];

    for (const metrics of testCases) {
      const result = buildFaultGraph(['X'], [], new Map([['X', metrics]]));
      const s = result.anomalyScores.get('X')!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ── Multi-Service Propagation Tests ─────────────────────────

describe('Multi-Service Z-Score Propagation', () => {
  it('gives higher score to the service with real anomaly', () => {
    // A calls B. A has a CPU spike, B has flat metrics.
    const result = buildFaultGraph(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [spikeTS('cpu', 100, 0.1, 50, 100)]],
        ['B', [flatTS('cpu', 100, 0.1)]],
      ]),
    );
    const scoreA = result.anomalyScores.get('A')!;
    const scoreB = result.anomalyScores.get('B')!;
    expect(scoreA).toBeGreaterThan(scoreB);
  });

  it('computes propagation weights for connected services', () => {
    const result = buildFaultGraph(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [spikeTS('cpu', 100, 0.1, 50, 100)]],
        ['B', [spikeTS('cpu', 100, 0.1, 55, 90)]],
      ]),
    );
    expect(result.propagationWeights.length).toBe(1);
    expect(result.propagationWeights[0]).toBeGreaterThan(0);
    expect(result.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('ranks anomaly scores correctly for 3-service chain', () => {
    // A → B → C, A has anomaly, B and C are normal
    const result = buildFaultGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
      new Map([
        ['A', [spikeTS('cpu', 100, 0.1, 50, 100)]],
        ['B', [flatTS('cpu', 100, 0.1)]],
        ['C', [flatTS('cpu', 100, 0.1)]],
      ]),
    );
    const scores = ['A', 'B', 'C'].map((s) => result.anomalyScores.get(s)!);
    // A should have the highest score
    expect(Math.max(...scores)).toBe(result.anomalyScores.get('A'));
  });
});

// ── Large Topology Normalisation Tests ──────────────────────

describe('Large Topology Score Normalisation', () => {
  it('normalises scores for graphs with ≥ 20 nodes', () => {
    const N = 25;
    const nodeIds: string[] = [];
    for (let i = 0; i < N; i++) nodeIds.push(`S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);

    const metricsMap = new Map<string, TimeSeries[]>();
    for (const id of nodeIds) {
      metricsMap.set(id, [flatTS('m', 50, 0.1 + Math.random() * 0.01)]);
    }
    // Inject a real anomaly in one service
    metricsMap.set('S5', [spikeTS('cpu', 50, 0.1, 25, 100)]);

    const result = buildFaultGraph(nodeIds, edges, metricsMap);

    // All scores should be within [0, 1]
    for (const id of nodeIds) {
      const s = result.anomalyScores.get(id)!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }

    // S5 should have the highest score after normalisation
    const s5 = result.anomalyScores.get('S5')!;
    const maxScore = Math.max(...nodeIds.map((id) => result.anomalyScores.get(id)!));
    expect(s5).toBe(maxScore);
  });

  it('handles all-identical scores in large topology', () => {
    const N = 30;
    const nodeIds: string[] = [];
    for (let i = 0; i < N; i++) nodeIds.push(`S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);

    const metricsMap = new Map<string, TimeSeries[]>();
    for (const id of nodeIds) {
      metricsMap.set(id, [flatTS('m', 50, 0.5)]);
    }

    const result = buildFaultGraph(nodeIds, edges, metricsMap);
    expect(result.anomalyScores.size).toBe(N);
    // All scores should be near zero since there's no anomaly
    for (const id of nodeIds) {
      expect(result.anomalyScores.get(id)).toBeCloseTo(0, 2);
    }
  });
});

// ── Edge Cases ──────────────────────────────────────────────

describe('Anomaly Detection Edge Cases', () => {
  it('handles very long time series (10K points)', () => {
    const values = new Float64Array(10000);
    for (let i = 0; i < 10000; i++) {
      values[i] = i < 5000 ? 0.1 : 100;
    }
    const ts: TimeSeries = {
      label: 'long_series',
      timestamps: Array.from({ length: 10000 }, (_, i) => i * 100),
      values,
      unit: 'percent',
    };
    const result = buildFaultGraph(['X'], [], new Map([['X', [ts]]]));
    expect(result.anomalyScores.get('X')).toBeGreaterThan(0.5);
  });

  it('handles multiple metrics per service', () => {
    const result = buildFaultGraph(
      ['A'],
      [],
      new Map([
        ['A', [spikeTS('cpu', 100, 0.1, 50, 100), flatTS('mem', 100, 0.3), risingTS('disk', 100)]],
      ]),
    );
    const score = result.anomalyScores.get('A')!;
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('onset index is not Int max when anomaly detected', () => {
    const result = buildFaultGraph(
      ['A'],
      [],
      new Map([['A', [spikeTS('cpu', 100, 0.1, 20, 100)]]]),
    );
    expect(result.anomalyOnsetTimes.get('A')).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('produces consistent results for same input', () => {
    const build = () =>
      buildFaultGraph(['X'], [], new Map([['X', [spikeTS('cpu', 50, 0.1, 25, 99)]]]));
    const r1 = build();
    const r2 = build();
    expect(r1.anomalyScores.get('X')).toBe(r2.anomalyScores.get('X'));
    expect(r1.anomalyOnsetTimes.get('X')).toBe(r2.anomalyOnsetTimes.get('X'));
  });

  it('handles NaN metric values gracefully', () => {
    const values = new Float64Array(100);
    for (let i = 0; i < 100; i++) values[i] = i === 50 ? NaN : 0.5;
    const ts: TimeSeries = {
      label: 'partial_nan',
      timestamps: Array.from({ length: 100 }, (_, i) => i * 1000),
      values,
      unit: 'count',
    };
    const result = buildFaultGraph(['A'], [], new Map([['A', [ts]]]));
    // Should not crash — NaN in sorted array should produce a valid score
    expect(result.anomalyScores.get('A')).toBeDefined();
    expect(result.anomalyScores.get('A')).toBeGreaterThanOrEqual(0);
  });
});

// ── Diagnostic Counters ─────────────────────────────────────

describe('Diagnostic Counter Integrity', () => {
  it('counts pearson and fallback edges correctly', () => {
    const result = buildFaultGraph(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
      new Map([
        ['A', [spikeTS('cpu', 100, 0.1, 50, 100)]],
        ['B', [spikeTS('cpu', 100, 0.1, 50, 90)]],
        ['C', [flatTS('cpu', 100, 0.1)]],
      ]),
    );
    expect(result.pearsonEdgeCount + result.fallbackEdgeCount).toBe(2);
    expect(result.temporalEdgeCount).toBeGreaterThanOrEqual(0);
  });

  it('scores are bounded [0,1] for all services', () => {
    const result = buildFaultGraph(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [spikeTS('x', 50, 0.1, 25, 100)]],
        ['B', [flatTS('x', 50, 0.1)]],
      ]),
    );
    for (const [, score] of result.anomalyScores) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
