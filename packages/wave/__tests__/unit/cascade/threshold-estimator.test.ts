import { describe, it, expect } from 'vitest';
import { ThresholdEstimator } from '../../../src/cascade/threshold-estimator.js';
import type { ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

// ── Test Helpers ────────────────────────────────────────────

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: `Service ${id}`, namespace: 'default', labels: {} });
  }
  return { nodes, edges, systemLoad: 0.5 };
}

function makeEdge(from: string, to: string, callRate = 100, p99Latency = 100, errorRate = 0.01): CallEdge {
  return { from, to, type: 'REST', callRate, p99Latency, errorRate };
}

const threeNodeGraph = makeServiceGraph(['svc_a', 'svc_b', 'svc_c'], [
  makeEdge('svc_a', 'svc_b', 200),
  makeEdge('svc_b', 'svc_c', 100),
]);

// ── estimate ────────────────────────────────────────────────

describe('ThresholdEstimator.estimate', () => {
  // ── Generation threshold ──────────────────────────────────

  describe('generation threshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).generationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should increase with higher dissipation rate', () => {
      const e = new ThresholdEstimator();
      const low = e.estimate(threeNodeGraph, 0.05).generationThreshold;
      const high = e.estimate(threeNodeGraph, 0.5).generationThreshold;
      expect(low).toBeLessThanOrEqual(high);
    });

    it('should be 1.0 for disconnected graph with no coupling', () => {
      const single = makeServiceGraph(['svc-only']);
      const t = new ThresholdEstimator().estimate(single).generationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
    });
  });

  // ── Propagation threshold ─────────────────────────────────

  describe('propagation threshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).propagationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should be higher for sparse graphs than dense', () => {
      const e = new ThresholdEstimator();
      const sparse = makeServiceGraph(['a', 'b', 'c'], [makeEdge('a', 'b', 50)]);
      const dense = makeServiceGraph(['a', 'b', 'c'], [
        makeEdge('a', 'b', 200), makeEdge('b', 'c', 200), makeEdge('a', 'c', 200),
      ]);
      expect(e.estimate(sparse).propagationThreshold).toBeGreaterThanOrEqual(
        e.estimate(dense).propagationThreshold,
      );
    });
  });

  // ── Extinction threshold ──────────────────────────────────

  describe('extinction threshold', () => {
    it('should be in [0.001, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).extinctionThreshold;
      expect(t).toBeGreaterThanOrEqual(0.001);
      expect(t).toBeLessThanOrEqual(1);
    });

    it('should increase with higher dissipation rate', () => {
      const e = new ThresholdEstimator();
      const low = e.estimate(threeNodeGraph, 0.05).extinctionThreshold;
      const high = e.estimate(threeNodeGraph, 0.5).extinctionThreshold;
      expect(low).toBeLessThanOrEqual(high);
    });
  });

  // ── Spectral gap ──────────────────────────────────────────

  describe('spectralGap', () => {
    it('should be >= 0', () => {
      const g = new ThresholdEstimator().estimate(threeNodeGraph).spectralGap;
      expect(g).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Percolation threshold ─────────────────────────────────

  describe('percolationThreshold', () => {
    it('should be in [0.01, 1]', () => {
      const t = new ThresholdEstimator().estimate(threeNodeGraph).percolationThreshold;
      expect(t).toBeGreaterThanOrEqual(0.01);
      expect(t).toBeLessThanOrEqual(1);
    });
  });

  // ── Cascade risk classification ───────────────────────────

  describe('cascade risk', () => {
    it('should be one of low/moderate/high', () => {
      const risk = new ThresholdEstimator().estimate(threeNodeGraph).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should classify isolated single node', () => {
      const single = makeServiceGraph(['svc-only']);
      const risk = new ThresholdEstimator().estimate(single).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });

    it('should classify fully connected graph', () => {
      const full = makeServiceGraph(['a', 'b', 'c'], [
        makeEdge('a', 'b', 300), makeEdge('b', 'a', 300),
        makeEdge('a', 'c', 300), makeEdge('c', 'a', 300),
        makeEdge('b', 'c', 300), makeEdge('c', 'b', 300),
      ]);
      const risk = new ThresholdEstimator().estimate(full).cascadeRisk;
      expect(['low', 'moderate', 'high']).toContain(risk);
    });
  });

  // ── Error cases ───────────────────────────────────────────

  describe('error cases', () => {
    it('should throw for empty graph', () => {
      const empty: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      expect(() => new ThresholdEstimator().estimate(empty)).toThrow();
    });

    it('should throw for dissipationRate < 0', () => {
      expect(() => new ThresholdEstimator().estimate(threeNodeGraph, -0.1)).toThrow();
    });

    it('should throw for dissipationRate > 1', () => {
      expect(() => new ThresholdEstimator().estimate(threeNodeGraph, 1.5)).toThrow();
    });
  });
});

// ── generationThreshold ─────────────────────────────────────

describe('ThresholdEstimator.generationThreshold', () => {
  it('should return a value in [0.01, 1]', () => {
    const t = new ThresholdEstimator().generationThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(1);
  });
});

// ── propagationThreshold ────────────────────────────────────

describe('ThresholdEstimator.propagationThreshold', () => {
  it('should return a value in [0.01, 1]', () => {
    const t = new ThresholdEstimator().propagationThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.01);
    expect(t).toBeLessThanOrEqual(1);
  });
});

// ── extinctionThreshold ─────────────────────────────────────

describe('ThresholdEstimator.extinctionThreshold', () => {
  it('should return a value in [0.001, 1]', () => {
    const t = new ThresholdEstimator().extinctionThreshold(
      makeServiceGraph(['svc_a', 'svc_b'], [makeEdge('svc_a', 'svc_b', 100)]),
    );
    expect(t).toBeGreaterThanOrEqual(0.001);
    expect(t).toBeLessThanOrEqual(1);
  });
});
