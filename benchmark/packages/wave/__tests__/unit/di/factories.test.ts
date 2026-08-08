import { describe, it, expect } from 'vitest';
import { registerWaveFactories } from '../../../src/di/factories.js';
import { DI_TOKENS, Container } from '@agentix-e/micro-kinetic-core';

// ── Token Registration ──────────────────────────────────────

describe('registerWaveFactories — token registration', () => {
  const container = new Container();
  registerWaveFactories(container);

  it('should register WAVE_PROPAGATION_MODEL', () => {
    expect(container.has(DI_TOKENS.WAVE_PROPAGATION_MODEL)).toBe(true);
  });

  it('should register CASCADE_SIMULATOR', () => {
    expect(container.has(DI_TOKENS.CASCADE_SIMULATOR)).toBe(true);
  });

  it('should register CORRELATION_DECAY_ESTIMATOR', () => {
    expect(container.has(DI_TOKENS.CORRELATION_DECAY_ESTIMATOR)).toBe(true);
  });

  it('should register ThresholdEstimator symbol', () => {
    const token = Symbol.for('micro-kinetic:ThresholdEstimator');
    expect(container.has(token)).toBe(true);
  });

  it('should register exactly 4 tokens', () => {
    expect(container.size).toBe(4);
  });
});

// ── Token Resolution ────────────────────────────────────────

describe('registerWaveFactories — token resolution', () => {
  const container = new Container();
  registerWaveFactories(container);

  it('should resolve WAVE_PROPAGATION_MODEL to an object with simulateCascade', () => {
    const instance = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);
    expect(typeof instance.simulateCascade).toBe('function');
  });

  it('should resolve CASCADE_SIMULATOR to an object with simulate', () => {
    const instance = container.resolve(DI_TOKENS.CASCADE_SIMULATOR);
    expect(typeof instance.simulate).toBe('function');
  });

  it('should resolve CASCADE_SIMULATOR to an object with simulateEnsemble', () => {
    const instance = container.resolve(DI_TOKENS.CASCADE_SIMULATOR);
    expect(typeof instance.simulateEnsemble).toBe('function');
  });

  it('should resolve CORRELATION_DECAY_ESTIMATOR to an object with estimateDecay', () => {
    const instance = container.resolve(DI_TOKENS.CORRELATION_DECAY_ESTIMATOR);
    expect(typeof instance.estimateDecay).toBe('function');
  });

  it('should resolve ThresholdEstimator to an object with estimate', () => {
    const instance = container.resolve(Symbol.for('micro-kinetic:ThresholdEstimator'));
    expect(typeof instance.estimate).toBe('function');
  });

  it('should resolve ThresholdEstimator to an object with generationThreshold', () => {
    const instance = container.resolve(Symbol.for('micro-kinetic:ThresholdEstimator'));
    expect(typeof instance.generationThreshold).toBe('function');
  });

  it('should resolve ThresholdEstimator to an object with propagationThreshold', () => {
    const instance = container.resolve(Symbol.for('micro-kinetic:ThresholdEstimator'));
    expect(typeof instance.propagationThreshold).toBe('function');
  });

  it('should resolve ThresholdEstimator to an object with extinctionThreshold', () => {
    const instance = container.resolve(Symbol.for('micro-kinetic:ThresholdEstimator'));
    expect(typeof instance.extinctionThreshold).toBe('function');
  });

  it('should resolve CORRELATION_DECAY_ESTIMATOR to an object with fitDecay', () => {
    const instance = container.resolve(DI_TOKENS.CORRELATION_DECAY_ESTIMATOR);
    expect(typeof instance.fitDecay).toBe('function');
  });

  it('should return the same WAVE_PROPAGATION_MODEL instance on re-resolve (singleton)', () => {
    const a = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);
    const b = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);
    expect(a).toBe(b);
  });
});

// ── Error Cases ─────────────────────────────────────────────

describe('registerWaveFactories — error cases', () => {
  it('should throw when re-registering on the same container', () => {
    const c = new Container();
    registerWaveFactories(c);
    expect(() => registerWaveFactories(c)).toThrow();
  });
});
