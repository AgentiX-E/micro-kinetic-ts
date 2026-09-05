import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_SPACE, DEFAULT_CONFIG, rankingToVector } from '../../src/config-space.js';
import type { RCAConfiguration } from '../../src/config-space.js';

const RANKING_ZERO = {
  sourceWeight: 0,
  temporalWeight: 0,
  collisionWeight: 0,
  topoWeight: 0,
  logWeight: 0,
  traceWeight: 0,
};

describe('DEFAULT_CONFIG_SPACE', () => {
  it('correct dimension', () => {
    expect(DEFAULT_CONFIG_SPACE.dimension).toBe(22);
  });

  it('5 continuous params', () => {
    expect(DEFAULT_CONFIG_SPACE.continuous).toHaveLength(5);
  });

  it('6 ranking params', () => {
    expect(DEFAULT_CONFIG_SPACE.ranking).toHaveLength(6);
  });

  it('5 discrete params', () => {
    expect(DEFAULT_CONFIG_SPACE.discrete).toHaveLength(5);
  });

  it('round-trip default config', () => {
    const vec = DEFAULT_CONFIG_SPACE.toVector(DEFAULT_CONFIG);
    const restored = DEFAULT_CONFIG_SPACE.fromVector(vec);
    expect(restored.continuous.decayAlpha).toBeCloseTo(DEFAULT_CONFIG.continuous.decayAlpha);
    expect(restored.ranking.logWeight).toBeCloseTo(DEFAULT_CONFIG.ranking.logWeight);
    expect(restored.discrete.baselineStrategy).toBe(DEFAULT_CONFIG.discrete.baselineStrategy);
  });

  it('round-trip extreme config', () => {
    const extreme: RCAConfiguration = {
      continuous: { decayAlpha: 0.95, pruneEpsilon: 1e-2, temporalBonus: 0.3, defaultWeight: 0.2, childContributionCap: 2.0 },
      ranking: { sourceWeight: 3, temporalWeight: 3, collisionWeight: 3, topoWeight: 3, logWeight: 3, traceWeight: 3 },
      discrete: { baselineStrategy: 'q25', correlationMethod: 'spearman', propagationMode: 'multiplicative', enableCollisionAggregation: false, useTemporalCausality: false },
    };
    const restored = DEFAULT_CONFIG_SPACE.fromVector(DEFAULT_CONFIG_SPACE.toVector(extreme));
    expect(restored.discrete.baselineStrategy).toBe('q25');
    expect(restored.discrete.enableCollisionAggregation).toBe(false);
    expect(restored.ranking.sourceWeight).toBeCloseTo(3);
    expect(restored.ranking.logWeight).toBeCloseTo(3);
    expect(restored.ranking.traceWeight).toBeCloseTo(3);
  });

  it('round-trip another config', () => {
    const cfg: RCAConfiguration = {
      continuous: { decayAlpha: 0.6, pruneEpsilon: 1e-4, temporalBonus: 0.05, defaultWeight: 0.02, childContributionCap: 0.5 },
      ranking: { ...RANKING_ZERO, logWeight: 1.5 },
      discrete: { baselineStrategy: 'auto', correlationMethod: 'pearson', propagationMode: 'additive', enableCollisionAggregation: true, useTemporalCausality: true },
    };
    const restored = DEFAULT_CONFIG_SPACE.fromVector(DEFAULT_CONFIG_SPACE.toVector(cfg));
    expect(restored.discrete.baselineStrategy).toBe('auto');
    expect(restored.ranking.logWeight).toBeCloseTo(1.5);
  });

  it('sample uniform in bounds', () => {
    for (let i = 0; i < 50; i++) {
      const cfg = DEFAULT_CONFIG_SPACE.sampleUniform();
      expect(cfg.continuous.decayAlpha).toBeGreaterThanOrEqual(0.5);
      expect(cfg.continuous.decayAlpha).toBeLessThanOrEqual(0.95);
      expect(cfg.ranking.logWeight).toBeGreaterThanOrEqual(0);
      expect(cfg.ranking.logWeight).toBeLessThanOrEqual(3);
    }
  });

  it('Thompson sampling around center', () => {
    const samples = DEFAULT_CONFIG_SPACE.sampleThompson(new Float64Array(22).fill(0.5), new Float64Array(22).fill(0.01), 10, () => 0.5);
    expect(samples).toHaveLength(10);
    for (const s of samples) {
      expect(s[0]).toBeGreaterThanOrEqual(0);
      expect(s[0]).toBeLessThanOrEqual(1);
    }
  });

  it('Thompson sampling guards against rng returning 0 (Box-Muller log(0))', () => {
    const samples = DEFAULT_CONFIG_SPACE.sampleThompson(
      new Float64Array(22).fill(0.5),
      new Float64Array(22).fill(0.01),
      2,
      () => 0,
    );
    expect(samples).toHaveLength(2);
    for (const s of samples) {
      for (let i = 0; i < s.length; i++) {
        expect(Number.isFinite(s[i])).toBe(true);
        expect(s[i]).toBeGreaterThanOrEqual(0);
        expect(s[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rankingToVector defaults a missing traceWeight to 0', () => {
    const without = rankingToVector({
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 0,
    });
    const withZero = rankingToVector({
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 0,
      traceWeight: 0,
    });
    expect(without).toEqual(withZero);
    expect(without[5]).toBe(0);
  });

  it('decayAlpha unit mapping', () => {
    const p = DEFAULT_CONFIG_SPACE.continuous[0]!;
    expect(p.fromUnit(0)).toBeCloseTo(0.5);
    expect(p.fromUnit(1)).toBeCloseTo(0.95);
    expect(p.toUnit(0.5)).toBeCloseTo(0);
  });

  it('pruneEpsilon log mapping', () => {
    const p = DEFAULT_CONFIG_SPACE.continuous[1]!;
    expect(p.fromUnit(0)).toBeCloseTo(1e-5);
    expect(p.fromUnit(1)).toBeCloseTo(1e-2);
    expect(p.fromUnit(0.5)).toBeCloseTo(3.16e-4, 1e-5);
  });

  it('ranking weight linear mapping [0, 3]', () => {
    const p = DEFAULT_CONFIG_SPACE.ranking[4]!; // logWeight
    expect(p.name).toBe('logWeight');
    expect(p.fromUnit(0)).toBeCloseTo(0);
    expect(p.fromUnit(1)).toBeCloseTo(3);
    expect(p.toUnit(1.5)).toBeCloseTo(0.5);
  });

  it('traceWeight linear mapping [0, 3]', () => {
    const p = DEFAULT_CONFIG_SPACE.ranking[5]!; // traceWeight
    expect(p.name).toBe('traceWeight');
    expect(p.fromUnit(0)).toBeCloseTo(0);
    expect(p.fromUnit(1)).toBeCloseTo(3);
    expect(p.toUnit(1.5)).toBeCloseTo(0.5);
  });
});

describe('DEFAULT_CONFIG', () => {
  it('convertible to vector', () => {
    const vec = DEFAULT_CONFIG_SPACE.toVector(DEFAULT_CONFIG);
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('reasonable defaults', () => {
    expect(DEFAULT_CONFIG.continuous.decayAlpha).toBeGreaterThanOrEqual(0.5);
    expect(DEFAULT_CONFIG.discrete.baselineStrategy).toBe('auto');
    expect(DEFAULT_CONFIG.ranking.logWeight).toBe(1.0);
    expect(DEFAULT_CONFIG.ranking.sourceWeight).toBe(0);
  });
});
