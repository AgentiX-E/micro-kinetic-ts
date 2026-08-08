import { describe, it, expect } from 'vitest';
import { registerNoiseFactories } from '../../../src/di/factories.js';
import { DI_TOKENS, Container } from '@agentix-e/micro-kinetic-core';

describe('registerNoiseFactories', () => {
  it('should register ARBITRARY_PRECISION in container', () => {
    const container = new Container();
    registerNoiseFactories(container);
    expect(container.has(DI_TOKENS.ARBITRARY_PRECISION)).toBe(true);
  });

  it('should register STATISTICS in container', () => {
    const container = new Container();
    registerNoiseFactories(container);
    expect(container.has(DI_TOKENS.STATISTICS)).toBe(true);
  });

  it('should register DENOISE_ENGINE in container', () => {
    const container = new Container();
    registerNoiseFactories(container);
    expect(container.has(DI_TOKENS.DENOISE_ENGINE)).toBe(true);
  });

  it('should register INDEPENDENCE_CHECKER in container', () => {
    const container = new Container();
    registerNoiseFactories(container);
    expect(container.has(DI_TOKENS.INDEPENDENCE_CHECKER)).toBe(true);
  });

  it('should register CouplingSparsityAnalyzer symbol in container', () => {
    const container = new Container();
    registerNoiseFactories(container);
    expect(container.has(Symbol.for('micro-kinetic:CouplingSparsityAnalyzer'))).toBe(true);
  });

  it('should resolve ARBITRARY_PRECISION to DecimalProvider', () => {
    const container = new Container();
    registerNoiseFactories(container);
    const instance = container.resolve(DI_TOKENS.ARBITRARY_PRECISION);
    expect(instance).toBeDefined();
    expect(typeof instance.multiply).toBe('function');
    expect(typeof instance.ln).toBe('function');
  });

  it('should resolve STATISTICS to StatisticsProvider', () => {
    const container = new Container();
    registerNoiseFactories(container);
    const instance = container.resolve(DI_TOKENS.STATISTICS);
    expect(instance).toBeDefined();
    expect(typeof instance.rollingStats).toBe('function');
    expect(typeof instance.kde).toBe('function');
  });

  it('should resolve DENOISE_ENGINE to StossDenoiser', () => {
    const container = new Container();
    registerNoiseFactories(container);
    const instance = container.resolve(DI_TOKENS.DENOISE_ENGINE);
    expect(instance).toBeDefined();
    expect(typeof instance.denoise).toBe('function');
    expect(typeof instance.computeCouplingSparsity).toBe('function');
  });

  it('should resolve INDEPENDENCE_CHECKER to IndependenceChecker', () => {
    const container = new Container();
    registerNoiseFactories(container);
    const instance = container.resolve(DI_TOKENS.INDEPENDENCE_CHECKER);
    expect(instance).toBeDefined();
    expect(typeof instance.testIndependence).toBe('function');
  });

  it('should resolve CouplingSparsityAnalyzer', () => {
    const container = new Container();
    registerNoiseFactories(container);
    const instance = container.resolve(Symbol.for('micro-kinetic:CouplingSparsityAnalyzer'));
    expect(instance).toBeDefined();
    expect(typeof instance.computeCouplingSparsity).toBe('function');
  });
});
