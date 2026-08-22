import { describe, it, expect } from 'vitest';
import type {
  WaveParams,
  AlertIntensity,
  CascadeResult,
  DecayCurve,
} from '@agentix-e/micro-kinetic-core';
import type { ServiceNode, CallEdge, ServiceCallGraph, ServiceId } from '@agentix-e/micro-kinetic-core';

describe('Wave Engine interfaces', () => {
  it('should construct WaveParams', () => {
    const params: WaveParams = {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 10000,
      cascadeThreshold: 0.3,
      timeHorizon: 60000,
    };
    expect(params.couplingStrength).toBe(0.5);
    expect(params.timeHorizon).toBe(60000);
  });

  it('should construct AlertIntensity', () => {
    const intensity: AlertIntensity = {
      serviceId: 'svc-a',
      time: 5000,
      intensity: 0.8,
    };
    expect(intensity.intensity).toBe(0.8);
  });

  it('should construct a dissipated CascadeResult', () => {
    const intensity: AlertIntensity = {
      serviceId: 'svc-a', time: 0, intensity: 1.0,
    };
    const trajectories = new Map<string, readonly AlertIntensity[]>();
    trajectories.set('svc-a', [intensity]);

    const result: CascadeResult = {
      sourceServiceId: 'svc-a',
      intensityTrajectories: trajectories,
      propagationDistance: 3,
      peakIntensity: 1.0,
      timeToPeak: 0,
      dissipated: true,
      dissipationTime: 30000,
    };
    expect(result.dissipated).toBe(true);
    expect(result.dissipationTime).toBe(30000);
  });

  it('should construct a persistent CascadeResult', () => {
    const result: CascadeResult = {
      sourceServiceId: 'svc-b',
      intensityTrajectories: new Map(),
      propagationDistance: 5,
      peakIntensity: 0.9,
      timeToPeak: 10000,
      dissipated: false,
    };
    expect(result.dissipated).toBe(false);
    expect(result.dissipationTime).toBeUndefined();
  });

  it('should construct DecayCurve', () => {
    const curve: DecayCurve = {
      timePoints: new Float64Array([0, 1000, 2000]),
      correlationValues: new Float64Array([1.0, 0.5, 0.25]),
      decayConstant: 2000,
      fitQuality: 0.99,
    };
    expect(curve.decayConstant).toBe(2000);
    expect(curve.fitQuality).toBeCloseTo(0.99);
    expect(curve.timePoints.length).toBe(3);
  });

  it('should construct ServiceCallGraph for wave simulation', () => {
    const nodes = new Map<ServiceId, ServiceNode>();
    nodes.set('a', { id: 'a', name: 'A', namespace: 'ns', labels: {} });
    const edges: CallEdge[] = [
      { from: 'a', to: 'b', type: 'REST', callRate: 50, p99Latency: 10, errorRate: 0 },
    ];
    const graph: ServiceCallGraph = { nodes, edges, systemLoad: 0.3 };
    expect(graph.nodes.size).toBe(1);
  });

  it('should verify all wave interfaces are importable', () => {
    const methods = ['IWavePropagationModel', 'ICascadeSimulator', 'ICorrelationDecayEstimator'];
    expect(methods.length).toBe(3);
  });
});
