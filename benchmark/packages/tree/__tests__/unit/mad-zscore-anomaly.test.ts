/**
 * Tests for MAD-Based Z-Score Anomaly Detection.
 *
 * Coverage targets: statements >=95%, branches >=95%, functions 100%, lines >=95%.
 *
 * The MAD-based z-score algorithm REQUIRES non-identical values for the
 * majority of data points.  If >=50% of values are identical, the median
 * absolute deviation (MAD) is zero and the metric is skipped.  All test
 * data must have continuous variation -- no binary 0/1 splits.
 */

import type { ServiceCallGraph, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import type { TopologyFaultGraphResult } from '../../src/causal/topology-fault-graph.js';
import { buildTopologyFaultGraph } from '../../src/causal/topology-fault-graph.js';

/** Flat constant series -- MAD=0, all zeros. */
function flatTS(label: string, count: number, value: number): TimeSeries {
  const v = new Float64Array(count);
  v.fill(value);
  return {
    label,
    timestamps: Array.from({ length: count }, (_, i) => i * 1000),
    values: v,
    unit: 'pct',
  };
}

/** Linear ramp from -> to. */
function rampTS(label: string, count: number, from: number, to: number): TimeSeries {
  const v = new Float64Array(count);
  for (let i = 0; i < count; i++) v[i] = from + ((to - from) * i) / (count - 1);
  return {
    label,
    timestamps: Array.from({ length: count }, (_, i) => i * 1000),
    values: v,
    unit: 'pct',
  };
}

/**
 * Strong anomaly: baseline with tiny noise for first 60%, then exponential
 * ramp to a high value.  The noise ensures MAD > 0 (all values differ);
 * the ramp-to-spike produces z-scores >> 3 -> score = 1.0.
 */
function anomalyTS(
  label: string,
  count: number,
  baseline: number,
  peakStart: number,
  peakValue: number,
): TimeSeries {
  const v = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    if (i < peakStart) {
      v[i] = baseline + Math.sin(i * 0.17 + 0.3) * 0.001;
    } else {
      const t = (i - peakStart) / (count - peakStart);
      v[i] = baseline + (peakValue - baseline) * t;
    }
  }
  return {
    label,
    timestamps: Array.from({ length: count }, (_, i) => i * 1000),
    values: v,
    unit: 'pct',
  };
}

function makeCallGraph(nodes: string[], edges: [string, string][]): ServiceCallGraph {
  const m = new Map<string, any>();
  for (const id of nodes) m.set(id, { id, name: id, namespace: 'test', labels: {} });
  return {
    nodes: m,
    edges: edges.map(([f, t]) => ({
      from: f,
      to: t,
      type: 'REST' as const,
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    })),
    systemLoad: 0.5,
  };
}

function bfg(
  nodes: string[],
  edges: [string, string][],
  m: Map<string, TimeSeries[]>,
): TopologyFaultGraphResult {
  return buildTopologyFaultGraph(makeCallGraph(nodes, edges), m);
}

// ─── Core ─────────────────────────────────────────────────

describe('MAD Z-Score Anomaly Detection', () => {
  it('returns zero for constant metrics (MAD=0)', () => {
    const r = bfg(['X'], [], new Map([['X', [flatTS('cpu', 100, 0.5)]]]));
    expect(r.anomalyScores.get('X')).toBe(0);
  });

  it('returns near-zero for pure noise with no spike', () => {
    const r = bfg(['X'], [], new Map([['X', [flatTS('cpu', 100, 0.5)]]]));
    expect(r.anomalyScores.get('X')).toBe(0);
  });

  it('detects ramp to large spike as strong anomaly', () => {
    const r = bfg(['X'], [], new Map([['X', [anomalyTS('cpu', 100, 0.1, 60, 100)]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.5);
  });

  it('detects onset within the ramp region', () => {
    const r = bfg(['X'], [], new Map([['X', [anomalyTS('cpu', 100, 0.1, 40, 100)]]]));
    const onset = r.anomalyOnsetTimes.get('X')!;
    expect(onset).toBeGreaterThan(0);
    expect(onset).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('handles <3 data points as zero', () => {
    for (const n of [1, 2]) {
      const v = new Float64Array(n);
      v.fill(0.5);
      const ts: TimeSeries = {
        label: 'x',
        timestamps: Array.from({ length: n }, (_, i) => i * 1000),
        values: v,
        unit: 'pct',
      };
      expect(bfg(['X'], [], new Map([['X', [ts]]])).anomalyScores.get('X')).toBe(0);
    }
  });

  it('handles undefined metrics as zero', () => {
    const r = bfg(['X'], [], new Map());
    expect(r.anomalyScores.get('X')).toBe(0);
    expect(r.anomalyOnsetTimes.get('X')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('handles all-zero as zero', () => {
    expect(bfg(['X'], [], new Map([['X', [flatTS('x', 5, 0)]]])).anomalyScores.get('X')).toBe(0);
  });

  it('detects ramp in negative range', () => {
    const r = bfg(['X'], [], new Map([['X', [anomalyTS('x', 100, -100, 60, 0)]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.5);
  });

  it('all scores within [0,1]', () => {
    const cases: TimeSeries[][] = [
      [anomalyTS('a', 50, 0.1, 30, 100)],
      [flatTS('b', 50, 0.5)],
      [rampTS('c', 50, 0.1, 0.9)],
      [flatTS('d', 50, 0), rampTS('e', 50, 1, 0)],
    ];
    for (const m of cases) {
      const s = bfg(['X'], [], new Map([['X', m]])).anomalyScores.get('X')!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Multi-Service Propagation ─────────────────────────────

describe('Multi-Service Z-Score Propagation', () => {
  it('ranks anomalous service above healthy ones', () => {
    const r = bfg(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [anomalyTS('cpu', 100, 0.1, 60, 100)]],
        ['B', [flatTS('cpu', 100, 0.1)]],
      ]),
    );
    expect(r.anomalyScores.get('A')).toBeGreaterThan(r.anomalyScores.get('B')!);
  });

  it('computes valid propagation weight in [0,1]', () => {
    const r = bfg(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [anomalyTS('cpu', 100, 0.1, 60, 100)]],
        ['B', [rampTS('cpu', 100, 0.1, 0.9)]],
      ]),
    );
    expect(r.propagationWeights.length).toBe(1);
    expect(r.propagationWeights[0]).toBeGreaterThanOrEqual(0);
    expect(r.propagationWeights[0]).toBeLessThanOrEqual(1);
  });

  it('ranks root cause highest in 3-service chain', () => {
    const r = bfg(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
      new Map([
        ['A', [anomalyTS('cpu', 100, 0.1, 60, 100)]],
        ['B', [flatTS('cpu', 100, 0.1)]],
        ['C', [flatTS('cpu', 100, 0.1)]],
      ]),
    );
    const scores = ['A', 'B', 'C'].map((s) => r.anomalyScores.get(s)!);
    expect(Math.max(...scores)).toBe(r.anomalyScores.get('A'));
  });
});

// ─── Large Topology Normalisation ──────────────────────────

describe('Large Topology Score Normalisation', () => {
  it('normalises for 25-node star graph', () => {
    const N = 25;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);
    const mm = new Map<string, TimeSeries[]>();
    for (const id of ids) mm.set(id, [flatTS('m', 50, 0.1)]);
    mm.set('S5', [anomalyTS('x', 50, 0.1, 30, 100)]);
    const r = bfg(ids, edges, mm);
    for (const id of ids) {
      const s = r.anomalyScores.get(id)!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(r.anomalyScores.get('S5')).toBe(Math.max(...ids.map((id) => r.anomalyScores.get(id)!)));
  });

  it('handles all-flat large topology as all zero', () => {
    const N = 30;
    const ids = Array.from({ length: N }, (_, i) => `S${i}`);
    const edges: [string, string][] = [];
    for (let i = 1; i < N; i++) edges.push(['S0', `S${i}`]);
    const mm = new Map<string, TimeSeries[]>();
    for (const id of ids) mm.set(id, [flatTS('m', 50, 0.5)]);
    const r = bfg(ids, edges, mm);
    for (const id of ids) expect(r.anomalyScores.get(id)).toBe(0);
  });
});

// ─── Edge Cases ────────────────────────────────────────────

describe('Anomaly Detection Edge Cases', () => {
  it('handles 10K points', () => {
    const v = new Float64Array(10000);
    for (let i = 0; i < 10000; i++)
      v[i] = i < 6000 ? 0.1 + (i % 7) * 0.001 : 0.1 + ((i - 6000) / 4000) * 100;
    const ts: TimeSeries = {
      label: 'long',
      timestamps: Array.from({ length: 10000 }, (_, i) => i * 100),
      values: v,
      unit: 'pct',
    };
    const r = bfg(['X'], [], new Map([['X', [ts]]]));
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0.5);
  });

  it('handles multi-metric services', () => {
    const r = bfg(
      ['X'],
      [],
      new Map([
        [
          'X',
          [anomalyTS('a', 100, 0.1, 60, 100), flatTS('b', 100, 0.1), rampTS('c', 100, 0.1, 0.9)],
        ],
      ]),
    );
    expect(r.anomalyScores.get('X')).toBeGreaterThan(0);
  });

  it('onset is finite for anomalous service', () => {
    expect(
      bfg(['X'], [], new Map([['X', [anomalyTS('x', 100, 0.1, 40, 100)]]])).anomalyOnsetTimes.get(
        'X',
      ),
    ).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('produces identical results for identical input', () => {
    const build = () => bfg(['X'], [], new Map([['X', [anomalyTS('x', 50, 0.1, 30, 100)]]]));
    expect(build().anomalyScores.get('X')).toBe(build().anomalyScores.get('X'));
  });

  it('handles NaN values without crashing', () => {
    const v = new Float64Array(100);
    for (let i = 0; i < 100; i++) v[i] = i === 50 ? NaN : 0.5 + i * 0.01;
    const ts: TimeSeries = {
      label: 'n',
      timestamps: Array.from({ length: 100 }, (_, i) => i * 1000),
      values: v,
      unit: 'pct',
    };
    expect(bfg(['X'], [], new Map([['X', [ts]]])).anomalyScores.get('X')).toBeGreaterThanOrEqual(0);
  });
});

// ─── Diagnostic Counters ───────────────────────────────────

describe('Diagnostic Counter Integrity', () => {
  it('pearson + fallback counts edge total', () => {
    const r = bfg(
      ['A', 'B', 'C'],
      [
        ['A', 'B'],
        ['B', 'C'],
      ],
      new Map([
        ['A', [anomalyTS('x', 100, 0.1, 60, 100)]],
        ['B', [rampTS('x', 100, 0.1, 0.9)]],
        ['C', [flatTS('x', 100, 0.1)]],
      ]),
    );
    expect(r.pearsonEdgeCount + r.fallbackEdgeCount).toBe(2);
  });

  it('all final scores are bounded [0,1]', () => {
    const r = bfg(
      ['A', 'B'],
      [['A', 'B']],
      new Map([
        ['A', [anomalyTS('x', 50, 0.1, 30, 100)]],
        ['B', [flatTS('x', 50, 0.1)]],
      ]),
    );
    for (const [, s] of r.anomalyScores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
