import { describe, expect, it } from 'vitest';
import { extractSystemContext, expectCloseTo } from '../../src/context-extractor.js';
import type { MetricMap, ServiceCallGraph, ServiceNode, CallEdge, TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeNode(id: string, namespace: string): ServiceNode {
  return { id, name: id, namespace, labels: {} };
}

function makeEdge(
  from: string,
  to: string,
  opts?: Partial<Pick<CallEdge, 'callRate' | 'p99Latency'>>,
): CallEdge {
  return {
    from,
    to,
    type: 'REST',
    callRate: opts?.callRate ?? 0,
    p99Latency: opts?.p99Latency ?? 0,
    errorRate: 0,
  };
}

function makeGraph(
  nodes: ServiceNode[],
  edges: CallEdge[],
  systemLoad = 0.5,
): ServiceCallGraph {
  const nodeMap = new Map<string, ServiceNode>();
  for (const n of nodes) nodeMap.set(n.id, n);
  return { nodes: nodeMap, edges, systemLoad };
}

function makeTS(label: string, values: number[]): TimeSeries {
  return {
    label,
    values: new Float64Array(values),
    timestamps: new Float64Array(values.map((_, i) => i * 1000)),
  };
}

function makeMetrics(
  entries: Array<[string, Array<{ label: string; values: number[] }>]>,
): MetricMap {
  const map = new Map<string, readonly TimeSeries[]>();
  for (const [svc, series] of entries) {
    map.set(svc, series.map((s) => makeTS(s.label, s.values)));
  }
  return map;
}

describe('extractSystemContext', () => {
  it('serviceCount', () => {
    const g = makeGraph([makeNode('A', 't'), makeNode('B', 't')], [makeEdge('A', 'B')]);
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.serviceCount).toBe(2);
  });

  it('graphDensity chain (2/6=0.333)', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't')],
      [makeEdge('A', 'B'), makeEdge('B', 'C')],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.graphDensity).toBeCloseTo(2 / 6, 3);
  });

  it('graphDensity fully connected', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't')],
      [
        makeEdge('A', 'B'), makeEdge('A', 'C'),
        makeEdge('B', 'A'), makeEdge('B', 'C'),
        makeEdge('C', 'A'), makeEdge('C', 'B'),
      ],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.graphDensity).toBeCloseTo(1.0, 3);
  });

  it('graphDensity empty graph', () => {
    const ctx = extractSystemContext(makeGraph([], []), makeMetrics([]));
    expect(ctx.graphDensity).toBe(0);
    expect(ctx.serviceCount).toBe(0);
  });

  it('degreeCV hub', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't'), makeNode('D', 't')],
      [
        makeEdge('A', 'B'), makeEdge('A', 'C'), makeEdge('A', 'D'), makeEdge('B', 'C'),
      ],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.degreeCV).toBeCloseTo(Math.sqrt(2), 2);
  });

  it('degreeCV zero uniform', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't')],
      [makeEdge('A', 'B'), makeEdge('B', 'A')],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.degreeCV).toBe(0);
  });

  it('maxDepth chain', () => {
    const g = makeGraph(
      [makeNode('R', 't'), makeNode('M', 't'), makeNode('L', 't')],
      [makeEdge('R', 'M'), makeEdge('M', 'L')],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.maxDepth).toBe(2);
  });

  it('maxDepth multi-branch', () => {
    const g = makeGraph(
      [makeNode('R', 't'), makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't'), makeNode('D', 't')],
      [makeEdge('R', 'A'), makeEdge('R', 'B'), makeEdge('A', 'C'), makeEdge('C', 'D')],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.maxDepth).toBe(3);
  });

  it('maxDepth zero with cycles', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't')],
      [makeEdge('A', 'B'), makeEdge('B', 'A')],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.maxDepth).toBe(0);
  });

  it('traceCoverage from latency', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't')],
      [
        makeEdge('A', 'B', { callRate: 100, p99Latency: 50 }),
        makeEdge('B', 'A'),
      ],
    );
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.traceCoverage).toBeCloseTo(0.5, 3);
  });

  it('metricCV from data', () => {
    const g = makeGraph([makeNode('A', 't')], []);
    const m = makeMetrics([['A', [{ label: 'cpu', values: [10, 20, 30, 40, 50] }]]]);
    const ctx = extractSystemContext(g, m);
    // mean=30, var=250, sigma=15.81, CV=0.527
    expect(ctx.metricCV).toBeCloseTo(15.81 / 30, 2);
  });

  it('metricCV zero constant', () => {
    const g = makeGraph([makeNode('A', 't')], []);
    const m = makeMetrics([['A', [{ label: 'cpu', values: [5, 5, 5, 5] }]]]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.metricCV).toBeCloseTo(0, 5);
  });

  it('spike detection', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't')],
      [],
    );
    const m = makeMetrics([
      ['A', [{ label: 'cpu', values: [30, 32, 31, 150, 160, 170, 175, 180, 178, 182] }]],
      ['B', [{ label: 'cpu', values: [10, 45, 80, 20, 95, 35, 70, 55, 40, 65] }]],
      ['C', [{ label: 'mem', values: [5, 25, 15, 45, 35, 55, 10, 60, 30, 50] }]],
    ]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.spikeDominanceRatio).toBeCloseTo(1 / 3, 3);
  });

  it('spikeRatio zero with uniform', () => {
    const g = makeGraph([makeNode('A', 't'), makeNode('B', 't')], []);
    const m = makeMetrics([
      ['A', [{ label: 'cpu', values: [10, 40, 70, 25, 55, 85, 15, 95, 60, 30] }]],
      ['B', [{ label: 'mem', values: [15, 50, 75, 20, 45, 80, 35, 65, 90, 40] }]],
    ]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.spikeDominanceRatio).toBe(0);
  });

  it('empty metrics ok', () => {
    const g = makeGraph([makeNode('A', 't')], [makeEdge('A', 'A')]);
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.metricCV).toBe(0);
    expect(ctx.spikeDominanceRatio).toBe(0);
  });

  it('systemLoad passthrough', () => {
    const g = makeGraph([makeNode('A', 't')], [], 0.75);
    const ctx = extractSystemContext(g, makeMetrics([]));
    expect(ctx.systemLoad).toBe(0.75);
  });

  it('all features clamped', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't')],
      [
        makeEdge('A', 'B', { callRate: 1e9, p99Latency: 1e9 }),
        makeEdge('B', 'A', { callRate: 1e9, p99Latency: 1e9 }),
      ],
      2.0,
    );
    const m = makeMetrics([['A', [{ label: 'cpu', values: [1, 1e6, 1] }]]]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.graphDensity).toBeGreaterThanOrEqual(0);
    expect(ctx.graphDensity).toBeLessThanOrEqual(1);
    expect(ctx.traceCoverage).toBeGreaterThanOrEqual(0);
    expect(ctx.traceCoverage).toBeLessThanOrEqual(1);
    expect(ctx.spikeDominanceRatio).toBeGreaterThanOrEqual(0);
    expect(ctx.spikeDominanceRatio).toBeLessThanOrEqual(1);
    expect(ctx.systemLoad).toBeGreaterThanOrEqual(0);
    expect(ctx.systemLoad).toBeLessThanOrEqual(1);
    expect(ctx.anomalyConcentration).toBeGreaterThanOrEqual(0);
    expect(ctx.anomalyConcentration).toBeLessThanOrEqual(1);
  });

  it('deterministic', () => {
    const g = makeGraph(
      [makeNode('A', 't'), makeNode('B', 't'), makeNode('C', 't')],
      [makeEdge('A', 'B'), makeEdge('B', 'C'), makeEdge('A', 'C')],
    );
    const m = makeMetrics([
      ['A', [{ label: 'cpu', values: [10, 20, 30] }]],
      ['B', [{ label: 'cpu', values: [5, 15, 25] }]],
      ['C', [{ label: 'cpu', values: [1, 2, 3] }]],
    ]);
    const c1 = extractSystemContext(g, m);
    const c2 = extractSystemContext(g, m);
    expect(c1.serviceCount).toBe(c2.serviceCount);
    expect(c1.graphDensity).toBe(c2.graphDensity);
    expect(c1.degreeCV).toBe(c2.degreeCV);
    expect(c1.maxDepth).toBe(c2.maxDepth);
  });

  it('all-zero values no div/0', () => {
    const g = makeGraph([makeNode('A', 't')], []);
    const m = makeMetrics([['A', [{ label: 'zero', values: [0, 0, 0, 0, 0] }]]]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.metricCV).toBe(0);
    expect(Number.isFinite(ctx.spikeDominanceRatio)).toBe(true);
  });

  it('short series (len 2)', () => {
    const g = makeGraph([makeNode('A', 't')], []);
    const m = makeMetrics([['A', [{ label: 'short', values: [10, 100] }]]]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.spikeDominanceRatio).toBe(0);
  });

  it('single value', () => {
    const g = makeGraph([makeNode('A', 't')], []);
    const m = makeMetrics([['A', [{ label: 's', values: [5] }]]]);
    const ctx = extractSystemContext(g, m);
    expect(ctx.metricCV).toBe(0);
  });
});

describe('expectCloseTo', () => {
  it('within tolerance', () => {
    expect(expectCloseTo(0.18, 0.174, 0.05)).toBe(true);
  });

  it('outside tolerance', () => {
    expect(expectCloseTo(0.30, 0.174, 0.05)).toBe(false);
  });

  it('with primitive matcher', () => {
    const m = expectCloseTo.primitive(0.174, 0.1);
    expect(expectCloseTo(0.18, m)).toBe(true);
    expect(expectCloseTo(0.30, m)).toBe(false);
  });

  it('zero denominator ok', () => {
    expect(expectCloseTo(0.005, 0, 0.01)).toBe(true);
    expect(expectCloseTo(0.05, 0, 0.01)).toBe(false);
  });
});
