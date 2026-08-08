import { describe, it, expect } from 'vitest';
import { WaveCascadeModel } from '../../../src/cascade/cascade-model.js';
import type { ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

// ── Test Helpers ────────────────────────────────────────────

function makeNode(id: string): ServiceNode {
  return { id, name: `Service ${id}`, namespace: 'default', labels: {} };
}

function makeServiceGraph(serviceIds: string[], edges: CallEdge[] = []): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, makeNode(id));
  }
  return { nodes, edges, systemLoad: 0.5 };
}

function makeEdge(from: string, to: string, callRate = 100, p99Latency = 100, errorRate = 0.01): CallEdge {
  return { from, to, type: 'REST', callRate, p99Latency, errorRate };
}

// ── simulateCascade ─────────────────────────────────────────

describe('WaveCascadeModel.simulateCascade', () => {
  /** 5-node graph with source='svc-a', normal parameters */
  const fiveNodeGraph = makeServiceGraph(
    ['svc-a', 'svc-b', 'svc-c', 'svc-d', 'svc-e'],
    [
      makeEdge('svc-a', 'svc-b', 100),
      makeEdge('svc-b', 'svc-c', 80),
      makeEdge('svc-c', 'svc-d', 60),
      makeEdge('svc-d', 'svc-e', 40),
    ],
  );

  const run = (graph = fiveNodeGraph, src = 'svc-a') =>
    new WaveCascadeModel().simulateCascade(src, graph);

  // ── Normal: 5-node, source='svc-a' ────────────────────────

  describe('five-node graph, source=svc-a, normal params', () => {
    const result = run();

    it('should set sourceServiceId to svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have propagationDistance >= 0', () => {
      expect(result.propagationDistance).toBeGreaterThanOrEqual(0);
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should include all five services in intensityTrajectories', () => {
      expect(result.intensityTrajectories.size).toBe(5);
    });

    it('should have svc-a trajectory', () => {
      expect(result.intensityTrajectories.has('svc-a')).toBe(true);
    });

    it('should have svc-b trajectory', () => {
      expect(result.intensityTrajectories.has('svc-b')).toBe(true);
    });

    it('should have svc-c trajectory', () => {
      expect(result.intensityTrajectories.has('svc-c')).toBe(true);
    });

    it('should have svc-d trajectory', () => {
      expect(result.intensityTrajectories.has('svc-d')).toBe(true);
    });

    it('should have svc-e trajectory', () => {
      expect(result.intensityTrajectories.has('svc-e')).toBe(true);
    });

    it('should give each service a time series with at least one point', () => {
      for (const [, traj] of result.intensityTrajectories) {
        expect(traj.length).toBeGreaterThan(0);
      }
    });

    it('should have dissipated property as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should have timeToPeak >= 0', () => {
      expect(result.timeToPeak).toBeGreaterThanOrEqual(0);
    });

    it('should have source initial intensity = 1', () => {
      const traj = result.intensityTrajectories.get('svc-a')!;
      expect(traj[0]!.intensity).toBe(1);
    });

    it('should have non-source initial intensity = 0', () => {
      const traj = result.intensityTrajectories.get('svc-b')!;
      expect(traj[0]!.intensity).toBe(0);
    });
  });

  // ── Edge: Very long decay (may not dissipate) ─────────────

  describe('very long decay time', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [
      makeEdge('svc-a', 'svc-b', 100),
    ]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 600000, // very slow decay
      cascadeThreshold: 0.01,
      timeHorizon: 5000,  // short horizon
    });

    it('should have dissipated as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should include both services', () => {
      expect(result.intensityTrajectories.size).toBe(2);
    });
  });

  // ── Edge: Cascade persists to end (not dissipated) ────────

  describe('non-dissipating cascade', () => {
    const isolated = makeServiceGraph(['svc-a']);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', isolated, {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 900000,  // very slow decay
      cascadeThreshold: 0.02,
      timeHorizon: 5000,  // very short horizon
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have dissolved as boolean', () => {
      expect(typeof result.dissipated).toBe('boolean');
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });
  });

  // ── Edge: call without params (undefined params) ──────────

  describe('undefined params', () => {
    const graph = makeServiceGraph(['svc-a']);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, undefined);

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have intensityTrajectories size 1', () => {
      expect(result.intensityTrajectories.size).toBe(1);
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });
  });

  describe('isolated source node', () => {
    const isolated = makeServiceGraph(['svc-only']);
    const result = run(isolated, 'svc-only');

    it('should have sourceServiceId svc-only', () => {
      expect(result.sourceServiceId).toBe('svc-only');
    });

    it('should have intensityTrajectories size 1', () => {
      expect(result.intensityTrajectories.size).toBe(1);
    });

    it('should have propagationDistance 0', () => {
      expect(result.propagationDistance).toBe(0);
    });

    it('should have peakIntensity 1', () => {
      expect(result.peakIntensity).toBe(1);
    });
  });

  // ── Edge: Fully connected graph ───────────────────────────

  describe('fully connected graph', () => {
    const fullyConnected = makeServiceGraph(['a', 'b', 'c'], [
      makeEdge('a', 'b', 100), makeEdge('b', 'a', 100),
      makeEdge('a', 'c', 100), makeEdge('c', 'a', 100),
      makeEdge('b', 'c', 100), makeEdge('c', 'b', 100),
    ]);
    const result = run(fullyConnected, 'a');

    it('should include all 3 services', () => {
      expect(result.intensityTrajectories.size).toBe(3);
    });

    it('should have sourceServiceId a', () => {
      expect(result.sourceServiceId).toBe('a');
    });

    it('should have propagationDistance as number', () => {
      expect(typeof result.propagationDistance).toBe('number');
    });
  });

  // ── Edge: Max coupling (1.0) ──────────────────────────────

  describe('max coupling 1.0', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [
      makeEdge('svc-a', 'svc-b', 1000),
    ]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 1.0,
      propagationSpeed: 1.0,
      decayTimeConstant: 60000,
      cascadeThreshold: 0.1,
      timeHorizon: 60000,
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should have peakIntensity in [0, 1]', () => {
      expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
      expect(result.peakIntensity).toBeLessThanOrEqual(1);
    });

    it('should include both services', () => {
      expect(result.intensityTrajectories.size).toBe(2);
    });
  });

  // ── Edge: Zero coupling (0.0) ─────────────────────────────

  describe('zero coupling 0.0', () => {
    const graph = makeServiceGraph(['svc-a', 'svc-b'], [
      makeEdge('svc-a', 'svc-b', 100),
    ]);
    const model = new WaveCascadeModel();
    const result = model.simulateCascade('svc-a', graph, {
      couplingStrength: 0.0,
      propagationSpeed: 1.0,
      decayTimeConstant: 60000,
      cascadeThreshold: 0.1,
      timeHorizon: 60000,
    });

    it('should have sourceServiceId svc-a', () => {
      expect(result.sourceServiceId).toBe('svc-a');
    });

    it('should keep svc-b intensity near 0 (no coupling)', () => {
      const traj = result.intensityTrajectories.get('svc-b')!;
      const maxB = Math.max(...traj.map(t => t.intensity));
      expect(maxB).toBe(0);
    });
  });

  // ── Error: Nonexistent source ─────────────────────────────

  describe('error cases', () => {
    it('should throw for nonexistent source', () => {
      const graph = makeServiceGraph(['svc-a']);
      const model = new WaveCascadeModel();
      expect(() => model.simulateCascade('svc-unknown', graph)).toThrow();
    });

    it('should throw for empty graph', () => {
      const empty: ServiceCallGraph = { nodes: new Map(), edges: [], systemLoad: 0.5 };
      const model = new WaveCascadeModel();
      expect(() => model.simulateCascade('svc-a', empty)).toThrow();
    });
  });
});

// ── computeDecayCurve ────────────────────────────────────────

describe('WaveCascadeModel.computeDecayCurve', () => {
  const graph = makeServiceGraph(['svc-a', 'svc-b', 'svc-c'], [
    makeEdge('svc-a', 'svc-b', 100),
    makeEdge('svc-b', 'svc-c', 50),
  ]);

  it('should have 100 time points', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.timePoints.length).toBe(100);
  });

  it('should have 100 correlation values', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.correlationValues.length).toBe(100);
  });

  it('should have decayConstant > 0', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.decayConstant).toBeGreaterThan(0);
  });

  it('should have fitQuality = 1.0 (theoretical)', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.fitQuality).toBe(1);
  });

  it('should have C(0) ≈ 1.0', () => {
    const curve = new WaveCascadeModel().computeDecayCurve(graph, 60000);
    expect(curve.correlationValues[0]).toBeCloseTo(1, 2);
  });

  it('should handle single-node graph', () => {
    const single = makeServiceGraph(['svc-only']);
    const curve = new WaveCascadeModel().computeDecayCurve(single, 60000);
    expect(curve.decayConstant).toBeGreaterThan(0);
  });

  it('should throw for timeHorizon <= 0', () => {
    const model = new WaveCascadeModel();
    const single = makeServiceGraph(['svc-a']);
    expect(() => model.computeDecayCurve(single, -100)).toThrow();
  });
});
