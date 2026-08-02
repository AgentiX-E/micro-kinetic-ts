import { describe, it, expect } from 'vitest';
import { CorrelationDecay } from '../../src/correlation-decay.js';
import type { ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

// ── Test Helpers ────────────────────────────────────────────

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: `Service ${id}`, namespace: 'default', labels: {} });
  }
  return { nodes, edges, systemLoad: 0.5 };
}

function makeEdge(from: string, to: string, callRate = 100): CallEdge {
  return { from, to, type: 'REST', callRate, p99Latency: 100, errorRate: 0.01 };
}

/** 5-node chain graph */
const fiveNodeGraph = makeServiceGraph(
  ['svc-a', 'svc-b', 'svc-c', 'svc-d', 'svc-e'],
  [
    makeEdge('svc-a', 'svc-b', 100),
    makeEdge('svc-b', 'svc-c', 80),
    makeEdge('svc-c', 'svc-d', 60),
    makeEdge('svc-d', 'svc-e', 40),
  ],
);

// ── estimateDecay ───────────────────────────────────────────

describe('CorrelationDecay.estimateDecay', () => {
  // ── 5-node graph ──────────────────────────────────────────

  describe('five-node graph', () => {
    const result = new CorrelationDecay().estimateDecay(fiveNodeGraph, 60000);

    it('should have 200 timePoints', () => {
      expect(result.timePoints.length).toBe(200);
    });

    it('should have 200 correlationValues', () => {
      expect(result.correlationValues.length).toBe(200);
    });

    it('should have decayConstant > 0', () => {
      expect(result.decayConstant).toBeGreaterThan(0);
    });

    it('should have fitQuality = 1.0', () => {
      expect(result.fitQuality).toBe(1);
    });

    it('should have C(0) ≈ 1.0', () => {
      expect(result.correlationValues[0]).toBeCloseTo(1, 2);
    });

    it('should have C(∞) ≈ 0', () => {
      const last = result.correlationValues[result.correlationValues.length - 1]!;
      expect(last).toBeLessThan(0.1);
    });

    it('should have monotonically decreasing correlation', () => {
      for (let i = 1; i < result.correlationValues.length; i++) {
        expect(result.correlationValues[i]!).toBeLessThanOrEqual(result.correlationValues[i - 1]!);
      }
    });

    it('should have timePoints starting at 0', () => {
      expect(result.timePoints[0]).toBe(0);
    });

    it('should have timePoints ending at timeHorizon', () => {
      expect(result.timePoints[result.timePoints.length - 1]).toBe(60000);
    });
  });

  // ── Edge: Single-node graph ───────────────────────────────

  describe('single-node graph', () => {
    const result = new CorrelationDecay().estimateDecay(
      makeServiceGraph(['svc-only']),
      30000,
    );

    it('should have fitQuality = 1.0', () => {
      expect(result.fitQuality).toBe(1);
    });

    it('should have decayConstant > 0', () => {
      expect(result.decayConstant).toBeGreaterThan(0);
    });

    it('should have C(0) ≈ 1.0', () => {
      expect(result.correlationValues[0]).toBeCloseTo(1, 2);
    });
  });

  // ── Edge: Graph with edges to non-existent services ───────

  describe('graph with non-existent edge targets', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [
      makeEdge('svc-a', 'svc-b', 100),
    ]);
    graph.edges.push(makeEdge('svc-b', 'svc-nope', 50));
    const result = new CorrelationDecay().estimateDecay(graph, 60000);

    it('should have decayConstant > 0', () => {
      expect(result.decayConstant).toBeGreaterThan(0);
    });

    it('should have fitQuality = 1.0', () => {
      expect(result.fitQuality).toBe(1);
    });
  });

  describe('fully connected graph', () => {
    const full = makeServiceGraph(['a', 'b', 'c'], [
      makeEdge('a', 'b', 100), makeEdge('b', 'a', 100),
      makeEdge('a', 'c', 100), makeEdge('c', 'a', 100),
      makeEdge('b', 'c', 100), makeEdge('c', 'b', 100),
    ]);
    const result = new CorrelationDecay().estimateDecay(full, 60000);

    it('should have 200 timePoints', () => {
      expect(result.timePoints.length).toBe(200);
    });

    it('should have decayConstant > 0', () => {
      expect(result.decayConstant).toBeGreaterThan(0);
    });

    it('should have fitQuality = 1.0', () => {
      expect(result.fitQuality).toBe(1);
    });

    it('should have C(0) ≈ 1.0', () => {
      expect(result.correlationValues[0]).toBeCloseTo(1, 2);
    });
  });

  // ── Error cases ───────────────────────────────────────────

  describe('error cases', () => {
    it('should throw for empty graph', () => {
      const empty: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      expect(() => new CorrelationDecay().estimateDecay(empty, 60000)).toThrow();
    });

    it('should throw for negative timeHorizon', () => {
      const graph = makeServiceGraph(['svc-a']);
      expect(() => new CorrelationDecay().estimateDecay(graph, -100)).toThrow();
    });

    it('should throw for zero timeHorizon', () => {
      const graph = makeServiceGraph(['svc-a']);
      expect(() => new CorrelationDecay().estimateDecay(graph, 0)).toThrow();
    });
  });
});

// ── fitDecay ────────────────────────────────────────────────

describe('CorrelationDecay.fitDecay', () => {
  it('should fit exponential decay to clean data', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000, 4000, 5000]);
    const tau = 2000;
    const correlationValues = new Float64Array(
      Array.from(timePoints, t => Math.exp(-t / tau)),
    );
    const result = new CorrelationDecay().fitDecay(timePoints, correlationValues);
    expect(result.fitQuality).toBeGreaterThan(0.5);
    expect(result.decayConstant).toBeGreaterThan(0);
  });

  it('should return fitQuality in [0, 1]', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000, 4000]);
    const correlationValues = new Float64Array([1.0, 0.6, 0.35, 0.2, 0.12]);
    const result = new CorrelationDecay().fitDecay(timePoints, correlationValues);
    expect(result.fitQuality).toBeGreaterThanOrEqual(0);
    expect(result.fitQuality).toBeLessThanOrEqual(1);
  });

  it('should handle noisy data without error', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000, 4000, 5000]);
    const tau = 2000;
    const correlationValues = new Float64Array(
      Array.from(timePoints, t => Math.exp(-t / tau) * (0.9 + 0.2 * Math.random())),
    );
    const result = new CorrelationDecay().fitDecay(timePoints, correlationValues);
    expect(result.fitQuality).toBeGreaterThan(0);
  });

  it('should return correct length in fitted correlationValues', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000]);
    const values = new Float64Array([1.0, 0.5, 0.25, 0.125]);
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.correlationValues.length).toBe(4);
  });

  it('should throw for mismatched array lengths', () => {
    const timePoints = new Float64Array([0, 1, 2]);
    const values = new Float64Array([1, 0.5]);
    expect(() => new CorrelationDecay().fitDecay(timePoints, values)).toThrow();
  });

  it('should throw for fewer than 2 data points', () => {
    const timePoints = new Float64Array([0]);
    const values = new Float64Array([1]);
    expect(() => new CorrelationDecay().fitDecay(timePoints, values)).toThrow();
  });

  it('should handle all-zero correlation values', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000]);
    const values = new Float64Array([0, 0, 0, 0]);
    // Should not throw — falls back to default decay
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.fitQuality).toBe(0);
  });

  it('should handle mostly zero values (fewer than 2 valid)', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000, 4000]);
    const values = new Float64Array([1.0, 0, 0, 0, 0]);
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.fitQuality).toBe(0);
  });

  it('should handle collinear time points (denom near zero)', () => {
    const timePoints = new Float64Array([5, 5, 5, 5]);
    const values = new Float64Array([1.0, 0.8, 0.6, 0.4]);
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.fitQuality).toBe(0);
  });

  it('should handle flat correlation values (slope zero)', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000]);
    const values = new Float64Array([0.5, 0.5, 0.5, 0.5]);
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.decayConstant).toBeGreaterThan(0);
    expect(result.fitQuality).toBeGreaterThanOrEqual(0);
  });

  it('should handle all-ones values (log zero, slope zero)', () => {
    const timePoints = new Float64Array([0, 1000, 2000, 3000, 4000]);
    const values = new Float64Array([1.0, 1.0, 1.0, 1.0, 1.0]);
    const result = new CorrelationDecay().fitDecay(timePoints, values);
    expect(result.decayConstant).toBeGreaterThan(0);
  });
});
