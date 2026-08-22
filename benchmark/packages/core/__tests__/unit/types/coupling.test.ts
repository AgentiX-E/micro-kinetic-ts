import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BBGKY_OPTIONS,
} from '@agentix-e/micro-kinetic-core';
import type {
  MicroserviceState,
  BBGKYState,
  BBGKYHierarchy,
  BoltzmannGradResult,
  BBGKYOptions,
} from '@agentix-e/micro-kinetic-core';

describe('Coupling types - MicroserviceState', () => {
  it('should accept a valid MicroserviceState', () => {
    const state: MicroserviceState = {
      serviceId: 'svc-a',
      timestamp: 1000000,
      faultProbability: 0.1,
      anomalyScore: 0.8,
      trafficRps: 500,
    };
    expect(state.serviceId).toBe('svc-a');
    expect(state.faultProbability).toBe(0.1);
    expect(state.trafficRps).toBe(500);
  });

  it('should handle extreme values', () => {
    const state: MicroserviceState = {
      serviceId: 'svc-zero',
      timestamp: 0,
      faultProbability: 0,
      anomalyScore: 0,
      trafficRps: 0,
    };
    expect(state.faultProbability).toBe(0);
    expect(state.trafficRps).toBe(0);
  });
});

describe('Coupling types - BBGKYState', () => {
  it('should accept a first-order BBGKYState', () => {
    const state: BBGKYState = {
      order: 1,
      serviceIds: ['svc-a'],
      correlationEnergy: 0.5,
      tensor: new Float64Array([0.5]),
      isSignificant: true,
    };
    expect(state.order).toBe(1);
    expect(state.isSignificant).toBe(true);
  });

  it('should accept a second-order pairwise BBGKYState', () => {
    const state: BBGKYState = {
      order: 2,
      serviceIds: ['svc-a', 'svc-b'],
      correlationEnergy: 0.3,
      tensor: new Float64Array(4),
      isSignificant: true,
    };
    expect(state.order).toBe(2);
    expect(state.serviceIds.length).toBe(2);
  });

  it('should accept an insignificant BBGKYState', () => {
    const state: BBGKYState = {
      order: 3,
      serviceIds: ['a', 'b', 'c'],
      correlationEnergy: 0.001,
      tensor: new Float64Array(27),
      isSignificant: false,
    };
    expect(state.isSignificant).toBe(false);
  });
});

describe('Coupling types - BBGKYHierarchy', () => {
  it('should accept a valid BBGKYHierarchy', () => {
    const state1: BBGKYState = {
      order: 1, serviceIds: ['a'], correlationEnergy: 0.5,
      tensor: new Float64Array([0.5]), isSignificant: true,
    };
    const hierarchy: BBGKYHierarchy = {
      systemSize: 10,
      states: [state1],
      truncationOrder: 2,
      energyRatios: [0.02],
      truncationError: 0.01,
    };
    expect(hierarchy.systemSize).toBe(10);
    expect(hierarchy.truncationOrder).toBe(2);
    expect(hierarchy.states.length).toBe(1);
  });

  it('should handle multiple states', () => {
    const s1: BBGKYState = {
      order: 1, serviceIds: ['a'], correlationEnergy: 1.0,
      tensor: new Float64Array([1]), isSignificant: true,
    };
    const s2: BBGKYState = {
      order: 2, serviceIds: ['a', 'b'], correlationEnergy: 0.01,
      tensor: new Float64Array(4), isSignificant: false,
    };
    const hierarchy: BBGKYHierarchy = {
      systemSize: 2,
      states: [s1, s2],
      truncationOrder: 2,
      energyRatios: [0.01],
      truncationError: 0.01,
    };
    expect(hierarchy.states.length).toBe(2);
    expect(hierarchy.states[0].order).toBe(1);
    expect(hierarchy.states[1].order).toBe(2);
  });
});

describe('Coupling types - BoltzmannGradResult', () => {
  it('should accept a dilute regime result', () => {
    const result: BoltzmannGradResult = {
      serviceCount: 100,
      impactRadius: 0.01,
      impactDensity: 0.01,
      faultProbabilityFirstOrder: 0.01,
      faultProbabilitySecondOrder: 0.0001,
      faultProbabilityAsymptotic: 0.01,
      inBoltzmannGradRegime: true,
      regime: 'dilute',
    };
    expect(result.regime).toBe('dilute');
    expect(result.inBoltzmannGradRegime).toBe(true);
  });

  it('should accept a dense regime result', () => {
    const result: BoltzmannGradResult = {
      serviceCount: 10,
      impactRadius: 0.5,
      impactDensity: 2.5,
      faultProbabilityFirstOrder: 0.8,
      faultProbabilitySecondOrder: 0.6,
      faultProbabilityAsymptotic: 1.0,
      inBoltzmannGradRegime: false,
      regime: 'dense',
    };
    expect(result.regime).toBe('dense');
    expect(result.inBoltzmannGradRegime).toBe(false);
  });

  it('should accept a transition regime result', () => {
    const result: BoltzmannGradResult = {
      serviceCount: 50,
      impactRadius: 0.1,
      impactDensity: 0.5,
      faultProbabilityFirstOrder: 0.2,
      faultProbabilitySecondOrder: 0.05,
      faultProbabilityAsymptotic: 0.3,
      inBoltzmannGradRegime: false,
      regime: 'transition',
    };
    expect(result.regime).toBe('transition');
  });
});

describe('Coupling types - DEFAULT_BBGKY_OPTIONS', () => {
  it('should export DEFAULT_BBGKY_OPTIONS', () => {
    expect(DEFAULT_BBGKY_OPTIONS).toBeDefined();
  });

  it('should have maxOrder = 5', () => {
    expect(DEFAULT_BBGKY_OPTIONS.maxOrder).toBe(5);
  });

  it('should have truncationEta = 0.01', () => {
    expect(DEFAULT_BBGKY_OPTIONS.truncationEta).toBe(0.01);
  });

  it('should have correct shape', () => {
    expect(DEFAULT_BBGKY_OPTIONS).toHaveProperty('maxOrder');
    expect(DEFAULT_BBGKY_OPTIONS).toHaveProperty('truncationEta');
  });
});
