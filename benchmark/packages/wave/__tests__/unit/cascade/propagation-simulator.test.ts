import { describe, it, expect, vi } from 'vitest';
import { PropagationSimulator } from '../../../src/cascade/propagation-simulator.js';
import { WaveCascadeModel } from '../../../src/cascade/cascade-model.js';
import type { ServiceCallGraph, ServiceNode, CallEdge, WaveParams } from '@agentix-e/micro-kinetic-core';

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

const defaultParams: WaveParams = {
  couplingStrength: 0.3,
  propagationSpeed: 1.0,
  decayTimeConstant: 30000,
  cascadeThreshold: 0.1,
  timeHorizon: 30000,
};

const twoNodeGraph = makeServiceGraph(['svc_a', 'svc_b'], [
  makeEdge('svc_a', 'svc_b', 100),
]);

// ── simulate ────────────────────────────────────────────────

describe('PropagationSimulator.simulate', () => {
  it('should run a single cascade realization', () => {
    const result = new PropagationSimulator().simulate('svc_a', twoNodeGraph, defaultParams);
    expect(result.sourceServiceId).toBe('svc_a');
  });

  it('should include all services in trajectory', () => {
    const result = new PropagationSimulator().simulate('svc_a', twoNodeGraph, defaultParams);
    expect(result.intensityTrajectories.size).toBe(2);
  });

  it('should return a boolean dissipated', () => {
    const result = new PropagationSimulator().simulate('svc_a', twoNodeGraph, defaultParams);
    expect(typeof result.dissipated).toBe('boolean');
  });

  it('should return peakIntensity in [0, 1]', () => {
    const result = new PropagationSimulator().simulate('svc_a', twoNodeGraph, defaultParams);
    expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
    expect(result.peakIntensity).toBeLessThanOrEqual(1);
  });

  it('should throw for nonexistent source', () => {
    const graph = makeServiceGraph(['svc_a']);
    expect(() => new PropagationSimulator().simulate('svc_unknown', graph, defaultParams)).toThrow();
  });
});

// ── simulateEnsemble ────────────────────────────────────────

describe('PropagationSimulator.simulateEnsemble', () => {
  const runEnsemble = (size: number) =>
    new PropagationSimulator().simulateEnsemble('svc_a', twoNodeGraph, defaultParams, size);

  // ── Normal: ensembleSize = 10 ─────────────────────────────

  describe('size 10', () => {
    const result = runEnsemble(10);

    it('should produce meanCascade', () => {
      expect(result.meanCascade).toBeDefined();
    });

    it('should produce varianceField', () => {
      expect(result.varianceField).toBeDefined();
    });

    it('should produce confidenceIntervals', () => {
      expect(result.confidenceIntervals).toBeDefined();
    });

    it('should have correct sourceServiceId in mean', () => {
      expect(result.meanCascade.sourceServiceId).toBe('svc_a');
    });

    it('should have mean peakIntensity in [0, 1]', () => {
      expect(result.meanCascade.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.meanCascade.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should have varianceField per service', () => {
      expect(result.varianceField.size).toBeGreaterThan(0);
    });

    it('should have non-negative variances', () => {
      for (const [, v] of result.varianceField) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it('should have confidence intervals per service', () => {
      expect(result.confidenceIntervals.size).toBeGreaterThan(0);
    });

    it('should have lower <= upper in all CIs', () => {
      for (const [, ci] of result.confidenceIntervals) {
        expect(ci.lower).toBeLessThanOrEqual(ci.upper);
      }
    });
  });

  // ── Normal: ensembleSize = 50 ─────────────────────────────

  describe('size 50', () => {
    const result = runEnsemble(50);

    it('should produce meanCascade', () => {
      expect(result.meanCascade).toBeDefined();
    });

    it('should produce varianceField', () => {
      expect(result.varianceField).toBeDefined();
    });

    it('should produce confidenceIntervals', () => {
      expect(result.confidenceIntervals).toBeDefined();
    });

    it('should have correct sourceServiceId in mean', () => {
      expect(result.meanCascade.sourceServiceId).toBe('svc_a');
    });

    it('should have mean peakIntensity in [0, 1]', () => {
      expect(result.meanCascade.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.meanCascade.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should have varianceField with entries', () => {
      expect(result.varianceField.size).toBeGreaterThan(0);
    });

    it('should have confidenceIntervals with entries', () => {
      expect(result.confidenceIntervals.size).toBeGreaterThan(0);
    });
  });

  // ── Normal: ensembleSize = 35 (> 30 for t-distribution) ──

  describe('size 35 (t-dist normal approx)', () => {
    const result = runEnsemble(35);

    it('should produce meanCascade', () => {
      expect(result.meanCascade).toBeDefined();
    });

    it('should produce varianceField', () => {
      expect(result.varianceField).toBeDefined();
    });

    it('should produce confidenceIntervals', () => {
      expect(result.confidenceIntervals).toBeDefined();
    });

    it('should have correct sourceServiceId', () => {
      expect(result.meanCascade.sourceServiceId).toBe('svc_a');
    });
  });

  // ── Normal: ensembleSize = 3 (small ensemble) ────────────

  describe('size 3 (small ensemble)', () => {
    const result = runEnsemble(3);

    it('should produce all fields', () => {
      expect(result.meanCascade).toBeDefined();
      expect(result.varianceField).toBeDefined();
      expect(result.confidenceIntervals).toBeDefined();
    });

    it('should have confidence intervals per service', () => {
      expect(result.confidenceIntervals.size).toBeGreaterThan(0);
    });
  });

  // ── Custom model ───────────────────────────────────────

  describe('with custom WaveCascadeModel', () => {
    it('should use custom model', () => {
      const customModel = new WaveCascadeModel();
      const sim = new PropagationSimulator(customModel);
      const result = sim.simulate('svc_a', twoNodeGraph, defaultParams);
      expect(result.sourceServiceId).toBe('svc_a');
    });
  });

  // ── Normal: ensembleSize = 12 (df=11, lookup fallback) ───

  describe('size 12 (df=11, lookup fallback)', () => {
    const result = runEnsemble(12);

    it('should produce all fields', () => {
      expect(result.meanCascade).toBeDefined();
      expect(result.varianceField).toBeDefined();
      expect(result.confidenceIntervals).toBeDefined();
    });

    it('should have confidence intervals per service', () => {
      expect(result.confidenceIntervals.size).toBeGreaterThan(0);
    });
  });

  // ── Edge: Math.random returns 0 (while loop body) ────────

  describe('Math.random edge case', () => {
    it('should handle Math.random returning 0', () => {
      const originalRandom = Math.random;
      // Return 0 once to trigger the while loop body, then normal values
      let callCount = 0;
      Math.random = vi.fn(() => {
        callCount++;
        if (callCount === 1) return 0;
        return 0.5;
      });

      try {
        const result = new PropagationSimulator().simulateEnsemble('svc_a', twoNodeGraph, defaultParams, 5);
        expect(result.meanCascade).toBeDefined();
      } finally {
        Math.random = originalRandom;
      }
    });
  });

  it('should throw for nonexistent source in ensemble', () => {
    const graph = makeServiceGraph(['svc_a']);
    expect(() => new PropagationSimulator().simulateEnsemble('svc_unknown', graph, defaultParams, 5)).toThrow();
  });
});
