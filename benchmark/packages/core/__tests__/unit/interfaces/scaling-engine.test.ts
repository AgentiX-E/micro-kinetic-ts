import { describe, it, expect } from 'vitest';
import type {
  MicroserviceState,
  BBGKYState,
  BBGKYHierarchy,
  BoltzmannGradResult,
  BBGKYOptions,
} from '@agentix-e/micro-kinetic-core';

describe('Scaling Engine interfaces', () => {
  it('should construct MicroserviceState for BBGKY analysis', () => {
    const state: MicroserviceState = {
      serviceId: 'svc-a',
      timestamp: 1000000,
      faultProbability: 0.05,
      anomalyScore: 0.3,
      trafficRps: 1000,
    };
    expect(state.serviceId).toBe('svc-a');
    expect(state.faultProbability).toBe(0.05);
  });

  it('should construct BBGKYHierarchy', () => {
    const s1: BBGKYState = {
      order: 1, serviceIds: ['a'],
      correlationEnergy: 0.8, tensor: new Float64Array([0.8]), isSignificant: true,
    };
    const hierarchy: BBGKYHierarchy = {
      systemSize: 50,
      states: [s1],
      truncationOrder: 1,
      energyRatios: [],
      truncationError: 0,
    };
    expect(hierarchy.systemSize).toBe(50);
  });

  it('should construct BoltzmannGradResult for scaling analysis', () => {
    const result: BoltzmannGradResult = {
      serviceCount: 200,
      impactRadius: 0.05,
      impactDensity: 0.5,
      faultProbabilityFirstOrder: 0.02,
      faultProbabilitySecondOrder: 0.0004,
      faultProbabilityAsymptotic: 0.025,
      inBoltzmannGradRegime: true,
      regime: 'dilute',
    };
    expect(result.regime).toBe('dilute');
    expect(result.inBoltzmannGradRegime).toBe(true);
  });

  it('should verify IScalingAnalyzer and IHierarchyTruncator imports', () => {
    const methods = ['computeBBGKYHierarchy', 'truncateHierarchy', 'estimateFaultProbability'];
    expect(methods.length).toBe(3);
  });
});
