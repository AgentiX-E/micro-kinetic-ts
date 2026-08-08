/**
 * Tests for MAD-Based Z-Score Anomaly Detection.
 *
 * Coverage targets: statements ≥95%, branches ≥95%, functions 100%,
 * lines ≥95%.
 *
 * The MAD-based z-score algorithm requires non-zero variance so that
 * the Median Absolute Deviation (MAD) is > 0.  A minimum of 50%+1
 * non-identical values ensures the median deviation is non-zero.
 */

import { describe, it, expect } from 'vitest';
import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';
import type { TopologyFaultGraphResult } from '../../src/causal/topology-fault-graph.js';
import type { ServiceCallGraph, TimeSeries } from '@agentix-e/micro-kinetic-core';

// ── Helpers ────────────────────────────────────────────────

function flatTS(label: string, count: number, value: number): TimeSeries {
  const v = new Float64Array(count);
  v.fill(value);
  return { label, timestamps: Array.from({ length: count }, (_, i) => i * 1000), values: v, unit: 'pct' };
}

function rampTS(label: string, count: number, from: number, to: number): TimeSeries {
  const v = new Float64Array(count);
  for (let i = 0; i < count; i++) v[i] = from + ((to - from) * i) / (count - 1);
  return { label, timestamps: Array.from({ length: count }, (_, i) => i * 1000), values: v, unit: 'pct' };
}

function spikeTS(label: string, count: number, baseline: number, spikeRatio: number, spikeValue: number): TimeSeries {
  const v = new Float64Array(count);
  const start = Math.floor(count * (1 - spikeRatio));
  for (let i = 0; i < count; i++) v[i] = i >= start ? spikeValue : baseline;
  return { label, timestamps: Array.from({ length: count }, (_, i) => i * 1000), values: v, unit: 'pct' };
}

function strongSpikeTS(label: string, count: number): TimeSeries {
  return spikeTS(label, count, 0.1, 0.5, 100);
}

function makeCallGraph(nodes: string[], edges: [string, string][]): ServiceCallGraph {
  const m = new Map<string, any>();
  for (const id of nodes) m.set(id, { id, name: id, namespace: 'test', labels: {} });
  return {
    nodes: m,
    edges: edges.map(([f, t]) => ({ from: f, to: t, type: 'REST' as const, callRate: 100, p99Latency: 50, errorRate: 0.01 })),
    systemLoad: 0.5,
  };
}

function buildFG(nodes: string[], edges: [string, string][], m: Map<string, TimeSeries[]>): TopologyFaultGraphResult {
  return buildTopologyFaultGraph(makeCallGraph(nodes, edges), m);
}

// ── Core ───────────────────────────────────────────────────

describe('MAD Z-Score Anomaly Detection', () => {
  it('returns zero for constant metrics (MAD=0)', () => {
    const r = buildFG(['X'], [], new Map([['X', [flatTS('cpu', 100, 0.5)]]]));
    expect(r.anomalyScores.get('X')).toBe(0);
  });

  it('returns near-zero for sub-2-sigma fluctuation', () => {
    const v = new Float64Array(100);
    for (let i = 0; i < 100; i++) v[i] = 0.5 + (Math.sin(i * 0.15) * 0.001);
    const ts: TimeSeries = { label: 'cpu', timestamps: Array.from({ length: 100 }, (_, i) => i * 1000), values: v, unit: 'pct' };
    const r = buildFG(['X'], [], new Map([['X', [ts]]]));
    expect(r.anomalyScores.get('X')).toBeLessThan(0.2);
  });

  it('detects strong spike (50/50 ratio → MAD>0)', () => {
    const r = buildFG(['X'], [], new Map([['X', [strongSpikeTS('cpu', 100)]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.4);
  });

  it('detects onset at the spike boundary', () => {
    const r = buildFG(['X'], [], new Map([['X', [strongSpikeTS('cpu', 100)]]]));
    const onset = r.anomalyOnsetTimes.get('X')!;
    expect(onset).toBeGreaterThan(0);
    expect(onset).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('handles <3 data points', () => {
    for (const n of [1, 2]) {
      const v = new Float64Array(n);
      v.fill(0.5);
      const ts: TimeSeries = { label: 'x', timestamps: Array.from({ length: n }, (_, i) => i * 1000), values: v, unit: 'pct' };
      const r = buildFG(['X'], [], new Map([['X', [ts]]]));
      expect(r.anomalyScores.get('X')).toBe(0);
    }
  });

  it('handles undefined metrics', () => {
    const r = buildFG(['X'], [], new Map());
    expect(r.anomalyScores.get('X')).toBe(0);
    expect(r.anomalyOnsetTimes.get('X')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles all-zero values', () => {
    const r = buildFG(['X'], [], new Map([['X', [flatTS('x', 5, 0)]]]));
    expect(r.anomalyScores.get('X')).toBe(0);
  });

  it('detects negative-value spikes', () => {
    // -100 → 0 transition is still an anomaly (z-score magnitude)
    const r = buildFG(['X'], [], new Map([['X', [spikeTS('x', 100, -100, 0.5, 0)]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.3);
  });

  it('all scores ∈ [0,1]', () => {
    const cases = [
      [strongSpikeTS('a', 50)],
      [flatTS('b', 50, 0.5)],
      [rampTS('c', 50, 0.1, 0.9)],
      [flatTS('d', 50, 0), rampTS('e', 50, 1, 0)],
    ];
    for (const m of cases) {
      const r = buildFG(['X'], [], new Map([['X', m]]));
      const s = r.anomalyScores.get('X')!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ── Multi-Service Propagation ───────────────────────────────

describe('Multi-Service Z-Score Propagation', () => {
  it('ranks anomalous service above healthy ones', () => {
    const r = buildFG(['A', 'B'], [['A', 'B']], new Map([
      ['A', [strongSpikeTS('cpu', 100)]],
      ['B', [flatTS('cpu', 100, 0.1)]],
    ]));
    expect(r.anomalyScores.get('A')).toBeGreaterThan(r.anomalyScores.get('B')!);
  });

  it('computes valid propagation weights', () => {
    const r = buildFG(['A', 'B'], [['A', 'B']], new Map([
      ['A', [strongSpikeTS('cpu', 100)]],
      ['B', [rampTS('cpu', 100, 0.1, 0.9)]],
    ]));
    expect(r.propagationWeights.length).toBe(1);
    expect(r.propagationWeights[0]).toBeGreaterThanOrEqual(0);
    expect(r.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('ranks root cause highest in 3-service chain', () => {
    const r = buildFG(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']], new Map([
      ['A', [strongSpikeTS('cpu', 100)]],
      ['B', [flatTS('cpu', 100, 0.1)]],
      ['C', [flatTS('cpu', 100, 0.1)]],
    ]));
    const scores = ['A', 'B', 'C'].map((s) => r.anomalyScores.get(s)!);
    expect(Math.max(...scores)).toBe(r.anomalyScores.get('A'));
  });
});

// ── Large Topology Normalisation ────────────────────────────

describe('Large Topology Score Normalisation', () => {
  it('normalises for ≥ 20 nodes', () => {
    const N = 25;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);
    const mm = new Map<string, TimeSeries[]>();
    for (const id of ids) mm.set(id, [flatTS('m', 50, 0.1)]);
    mm.set('S5', [strongSpikeTS('x', 50)]);
    const r = buildFG(ids, edges, mm);
    for (const id of ids) {
      const s = r.anomalyScores.get(id)!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    const s5 = r.anomalyScores.get('S5')!;
    expect(s5).toBe(Math.max(...ids.map((id) => r.anomalyScores.get(id)!)));
  });

  it('handles all-flat large topology', () => {
    const N = 30;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);
    const mm = new Map<string, TimeSeries[]>();
    for (const id of ids) mm.set(id, [flatTS('m', 50, 0.5)]);
    const r = buildFG(ids, edges, mm);
    expect(r.anomalyScores.size).toBe(N);
    for (const id of ids) expect(r.anomalyScores.get(id)).toBe(0);
  });
});

// ── Edge Cases ──────────────────────────────────────────────

describe('Anomaly Detection Edge Cases', () => {
  it('handles 10K points', () => {
    const v = new Float64Array(10000);
    for (let i = 0; i < 5000; i++) v[i] = 0.1;
    for (let i = 5000; i < 10000; i++) v[i] = 100;
    const ts: TimeSeries = {
      label: 'long', timestamps: Array.from({ length: 10000 }, (_, i) => i * 100), values: v, unit: 'pct',
    };
    const r = buildFG(['X'], [], new Map([['X', [ts]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.4);
  });

  it('handles multi-metric services', () => {
    const r = buildFG(['X'], [], new Map([['X', [strongSpikeTS('a', 100), flatTS('b', 100, 0.1), rampTS('c', 100, 0.1, 0.9)]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0);
  });

  it('onset is finite when anomaly detected', () => {
    const r = buildFG(['X'], [], new Map([['X', [strongSpikeTS('x', 100)]]]));
    expect(r.anomalyOnsetTimes.get('X')).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('deterministic for same input', () => {
    const build = () => buildFG(['X'], [], new Map([['X', [strongSpikeTS('x', 50)]]]));
    expect(build().anomalyScores.get('X')).toBe(build().anomalyScores.get('X'));
  });

  it('handles NaN values gracefully', () => {
    const v = new Float64Array(100);
    for (let i = 0; i < 100; i++) v[i] = i === 50 ? NaN : 0.5 + (i * 0.01);
    const ts: TimeSeries = { label: 'n', timestamps: Array.from({ length: 100 }, (_, i) => i * 1000), values: v, unit: 'pct' };
    const r = buildFG(['X'], [], new Map([['X', [ts]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThanOrEqual(0);
  });
});

// ── Diagnostic Counters ─────────────────────────────────────

describe('Diagnostic Counter Integrity', () => {
  it('pearson + fallback = total edges', () => {
    const r = buildFG(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']], new Map([
      ['A', [strongSpikeTS('x', 100)]],
      ['B', [rampTS('x', 100, 0.1, 0.9)]],
      ['C', [flatTS('x', 100, 0.1)]],
    ]));
    expect(r.pearsonEdgeCount + r.fallbackEdgeCount).toBe(2);
  });

  it('all scores ∈ [0,1]', () => {
    const r = buildFG(['A', 'B'], [['A', 'B']], new Map([
      ['A', [strongSpikeTS('x', 50)]],
      ['B', [flatTS('x', 50, 0.1)]],
    ]));
    for (const [, s] of r.anomalyScores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
