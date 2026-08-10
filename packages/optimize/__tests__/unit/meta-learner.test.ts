import { describe, expect, it } from 'vitest';
import { MetaLearner } from '../../src/meta-learner.js';
import type { HistoricalRecord, HistoricalConfig } from '../../src/meta-learner.js';
import type { SystemContext } from '../../src/types.js';

function makeCtx(overrides?: Partial<SystemContext>): SystemContext {
  return {
    serviceCount: 10,
    graphDensity: 0.2,
    degreeCV: 0.5,
    maxDepth: 3,
    traceCoverage: 0,
    metricCV: 0.4,
    spikeDominanceRatio: 0.3,
    anomalyConcentration: 0.4,
    systemLoad: 0.5,
    faultTypeCount: 5,
    avgCasesPerType: 10,
    ...overrides,
  };
}

function makeCfg(overrides?: Partial<HistoricalConfig>): HistoricalConfig {
  return {
    baselineStrategy: 'auto',
    correlationMethod: 'pearson',
    propagationMode: 'additive',
    enableCollisionAggregation: true,
    useTemporalCausality: true,
    decayAlpha: 0.8,
    pruneEpsilon: 0.001,
    temporalBonus: 0.15,
    defaultWeight: 0.05,
    childContributionCap: 1.0,
    ...overrides,
  };
}

function makeRecord(
  overrides?: Partial<HistoricalRecord>,
): HistoricalRecord {
  return {
    system: 'test',
    suite: 'RE1',
    context: makeCtx(),
    config: makeCfg(),
    accuracy: 0.8,
    ...overrides,
  };
}

describe('MetaLearner', () => {
  it('should create with empty records', () => {
    const ml = new MetaLearner([]);
    expect(ml.recordCount).toBe(0);
    const pred = ml.predict(makeCtx());
    expect(pred.discrete.baselineStrategy).toBe('auto');
  });

  it('should predict from single record', () => {
    const rec = makeRecord({
      config: makeCfg({ baselineStrategy: 'q25', decayAlpha: 0.9 }),
    });
    const ml = new MetaLearner([rec]);

    const pred = ml.predict(makeCtx());
    expect(pred.discrete.baselineStrategy).toBe('q25');
    expect(pred.continuous.decayAlpha).toBeCloseTo(0.9);
  });

  it('should predict from multiple identical records', () => {
    const cfg = makeCfg({ baselineStrategy: 'sliding-window', decayAlpha: 0.85 });
    const recs = [makeRecord({ config: cfg }), makeRecord({ config: cfg })];
    const ml = new MetaLearner([recs[0]!, recs[1]!]);

    const pred = ml.predict(makeCtx());
    expect(pred.discrete.baselineStrategy).toBe('sliding-window');
    expect(pred.continuous.decayAlpha).toBeCloseTo(0.85);
  });

  it('should weigh by accuracy', () => {
    const high = makeRecord({
      system: 'A',
      context: makeCtx({ serviceCount: 12 }),
      config: makeCfg({ baselineStrategy: 'q25' }),
      accuracy: 0.95,
    });
    const low = makeRecord({
      system: 'B',
      context: makeCtx({ serviceCount: 13 }),
      config: makeCfg({ baselineStrategy: 'auto' }),
      accuracy: 0.30,
    });

    const ml = new MetaLearner([high, low]);
    const pred = ml.predict(makeCtx({ serviceCount: 12 }));

    // The closer AND higher-accuracy record should dominate
    expect(pred.discrete.baselineStrategy).toBe('q25');
  });

  it('should weigh by distance', () => {
    const near = makeRecord({
      system: 'A',
      context: makeCtx({ serviceCount: 10, graphDensity: 0.15 }),
      config: makeCfg({ propagationMode: 'multiplicative' }),
      accuracy: 0.5,
    });
    const far = makeRecord({
      system: 'B',
      context: makeCtx({ serviceCount: 100, graphDensity: 0.01 }),
      config: makeCfg({ propagationMode: 'additive' }),
      accuracy: 1.0,
    });

    const ml = new MetaLearner([near, far]);
    const pred = ml.predict(makeCtx({ serviceCount: 10, graphDensity: 0.15 }));

    // Near record should win despite lower accuracy
    expect(pred.discrete.propagationMode).toBe('multiplicative');
  });

  it('should default to k nearest', () => {
    const recs = [
      makeRecord({ system: 'S1', context: makeCtx({ serviceCount: 5 }), config: makeCfg({ baselineStrategy: 'auto' }) }),
      makeRecord({ system: 'S2', context: makeCtx({ serviceCount: 10 }), config: makeCfg({ baselineStrategy: 'q25' }) }),
      makeRecord({ system: 'S3', context: makeCtx({ serviceCount: 15 }), config: makeCfg({ baselineStrategy: 'sliding-window' }) }),
      makeRecord({ system: 'S4', context: makeCtx({ serviceCount: 20 }), config: makeCfg({ baselineStrategy: 'auto' }) }),
    ];
    const ml = new MetaLearner(recs, { k: 2 });

    const pred = ml.predict(makeCtx({ serviceCount: 11 }));
    // Two nearest should be S2 (10) and S3 (15), most common: q25 + sliding-window
    // Since weighted, whichever is closer matters. S2 distance = 1, S3 distance = 4.
    // S2 dominates → q25
    expect(pred.discrete.baselineStrategy).toBe('q25');
  });

  it('should handle boolean votes in discrete params', () => {
    const on = makeRecord({ config: makeCfg({ enableCollisionAggregation: true }) });
    const off = makeRecord({ config: makeCfg({ enableCollisionAggregation: false }) });
    const on2 = makeRecord({ config: makeCfg({ enableCollisionAggregation: true }) });

    const ml = new MetaLearner([on, off, on2]);
    const pred = ml.predict(makeCtx());
    // 2 true vs 1 false → true wins
    expect(pred.discrete.enableCollisionAggregation).toBe(true);
  });

  it('should produce deterministic predictions', () => {
    const recs = [makeRecord(), makeRecord({ system: 'B' })];
    const ml = new MetaLearner([recs[0]!, recs[1]!]);
    const p1 = ml.predict(makeCtx());
    const p2 = ml.predict(makeCtx());
    expect(p1.continuous.decayAlpha).toBe(p2.continuous.decayAlpha);
    expect(p1.discrete.baselineStrategy).toBe(p2.discrete.baselineStrategy);
  });

  it('should accept custom k', () => {
    const recs = [
      makeRecord({ system: 'A', config: makeCfg({ decayAlpha: 0.5 }) }),
      makeRecord({ system: 'B', config: makeCfg({ decayAlpha: 0.6 }) }),
      makeRecord({ system: 'C', config: makeCfg({ decayAlpha: 0.7 }) }),
    ];
    const ml = new MetaLearner([recs[0]!, recs[1]!, recs[2]!], { k: 1 });
    const pred = ml.predict(makeCtx());
    // k=1: should match the single nearest neighbor's config
    expect(pred.continuous.decayAlpha).toBeGreaterThanOrEqual(0.5);
    expect(pred.continuous.decayAlpha).toBeLessThanOrEqual(0.7);
  });
});
