import { describe, expect, it } from 'vitest';
import { LLMAdvisor } from '../../src/llm-advisor.js';
import type { SystemContext } from '../../src/types.js';
import type { RCAConfiguration } from '../../src/config-space.js';

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

function makeCfg(overrides?: Partial<RCAConfiguration['continuous'] & RCAConfiguration['discrete']>): RCAConfiguration {
  return {
    continuous: {
      decayAlpha: overrides?.decayAlpha ?? 0.8,
      pruneEpsilon: overrides?.pruneEpsilon ?? 0.001,
      temporalBonus: overrides?.temporalBonus ?? 0.15,
      defaultWeight: overrides?.defaultWeight ?? 0.05,
      childContributionCap: overrides?.childContributionCap ?? 1.0,
    },
    discrete: {
      baselineStrategy: (overrides as any)?.baselineStrategy ?? 'auto',
      correlationMethod: (overrides as any)?.correlationMethod ?? 'pearson',
      propagationMode: (overrides as any)?.propagationMode ?? 'additive',
      enableCollisionAggregation: (overrides as any)?.enableCollisionAggregation ?? true,
      useTemporalCausality: (overrides as any)?.useTemporalCausality ?? true,
    },
  };
}

describe('LLMAdvisor', () => {
  it('should create with default options', () => {
    const advisor = new LLMAdvisor();
    expect(advisor.callsThisCycle).toBe(0);
  });

  it('should fallback to uniform ranking when no API key', async () => {
    // Delete API key if set
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    const advisor = new LLMAdvisor();
    const result = await advisor.rank(
      [],
      [makeCfg(), makeCfg({ decayAlpha: 0.9 })],
      makeCtx(),
    );

    // Should get uniform ranking (no API call possible)
    expect(result.ranking).toHaveLength(2);
    expect(result.confidence).toBe(0);
    expect(result.fromCache).toBe(false);
    expect(result.reasoning).toContain('DEEPSEEK');

    // Restore
    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should respect max calls per cycle', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 2 });
    // First call: budget ok (but will fail on API since no key = fallback)
    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(1);

    // Second call
    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(2);

    // Third call: should be budget-exhausted fallback, callCount stays at 2
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const result = await advisor.rank([], [makeCfg(), makeCfg()], makeCtx());
    if (saved) process.env.DEEPSEEK_API_KEY = saved;

    expect(advisor.callsThisCycle).toBe(2);
    expect(result.reasoning).toContain('Budget exhausted');
  });

  it('should reset cycle counter', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 2 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    await advisor.rank([], [makeCfg()], makeCtx());
    expect(advisor.callsThisCycle).toBe(1);

    advisor.resetCycle();
    expect(advisor.callsThisCycle).toBe(0);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should provide consistent fallback output', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 5 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    // Multiple identical calls should return same ranking (fallback path)
    const r1 = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.74 }],
      [makeCfg()],
      makeCtx(),
    );
    const r2 = await advisor.rank(
      [{ config: makeCfg(), accuracy: 0.74 }],
      [makeCfg()],
      makeCtx(),
    );

    // Both should return uniform ranking with 0 confidence (fallback)
    expect(r1.confidence).toBe(0);
    expect(r2.confidence).toBe(0);
    expect(r1.ranking).toEqual(r2.ranking);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });

  it('should handle empty candidates gracefully', async () => {
    const advisor = new LLMAdvisor();
    const result = await advisor.rank([], [], makeCtx());
    expect(result.ranking).toHaveLength(0);
  });

  it('should handle large experiment history', async () => {
    const advisor = new LLMAdvisor({ maxCallsPerCycle: 10 });
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;

    const history = Array.from({ length: 20 }, (_, i) => ({
      config: makeCfg({ decayAlpha: 0.5 + i * 0.02 }),
      accuracy: 0.5 + i * 0.02,
    }));

    const result = await advisor.rank(history, [makeCfg(), makeCfg()], makeCtx());
    expect(result.ranking).toHaveLength(2);

    if (saved) process.env.DEEPSEEK_API_KEY = saved;
  });
});
