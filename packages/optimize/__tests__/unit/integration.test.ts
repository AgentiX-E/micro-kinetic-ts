import { describe, expect, it } from 'vitest';
import {
  configToPrunerOptions,
  configToTopologyConfig,
  createEngineWithConfig,
  createDefaultEngine,
} from '../../src/integration.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import { DEFAULT_CONFIG } from '../../src/config-space.js';

describe('configToPrunerOptions', () => {
  it('should map decayAlpha', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, decayAlpha: 0.9 },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.decayAlpha).toBe(0.9);
  });

  it('should map pruneEpsilon', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, pruneEpsilon: 0.005 },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.pruneEpsilon).toBe(0.005);
  });

  it('should map enableCollisionAggregation', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, enableCollisionAggregation: false },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.enableCollisionAggregation).toBe(false);
  });

  it('should set criticalLoadThreshold to 0.7', () => {
    const opts = configToPrunerOptions(DEFAULT_CONFIG);
    expect(opts.criticalLoadThreshold).toBe(0.7);
  });

  it('should default missing riseWeight and traceWeight to 0', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      ranking: {
        sourceWeight: 0,
        temporalWeight: 0,
        collisionWeight: 0,
        topoWeight: 0,
        logWeight: 1.0,
      },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.riseWeight).toBe(0);
    expect(opts.traceWeight).toBe(0);
  });
});

describe('configToTopologyConfig', () => {
  it('should map temporalBonus', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, temporalBonus: 0.25 },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.temporalBonus).toBe(0.25);
  });

  it('should map defaultWeight', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, defaultWeight: 0.1 },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.defaultWeight).toBe(0.1);
  });

  it('should map baselineStrategy', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, baselineStrategy: 'q25' },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.baselineStrategy).toBe('q25');
  });

  it('should map correlationMethod', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, correlationMethod: 'spearman' },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.correlationMethod).toBe('spearman');
  });

  it('should map useTemporalCausality', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, useTemporalCausality: false },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.useTemporalCausality).toBe(false);
  });

  it('should always set minDataPoints to 3', () => {
    const tc = configToTopologyConfig(DEFAULT_CONFIG);
    expect(tc.minDataPoints).toBe(3);
  });

  it('should always set adaptiveDecay to true', () => {
    const tc = configToTopologyConfig(DEFAULT_CONFIG);
    expect(tc.adaptiveDecay).toBe(true);
  });
});

describe('createEngineWithConfig', () => {
  it('should create a TreePruner with custom config', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: {
        ...DEFAULT_CONFIG.continuous,
        decayAlpha: 0.92,
        pruneEpsilon: 0.0001,
      },
    };
    const engine = createEngineWithConfig(cfg);
    expect(engine).toBeDefined();
    // Should not throw
    expect(() => engine).not.toThrow();
  });

  it('should create with DEFAULT_CONFIG', () => {
    const engine = createEngineWithConfig(DEFAULT_CONFIG);
    expect(engine).toBeDefined();
  });
});

describe('createDefaultEngine', () => {
  it('should create engine without throwing', () => {
    const engine = createDefaultEngine();
    expect(engine).toBeDefined();
  });
});
