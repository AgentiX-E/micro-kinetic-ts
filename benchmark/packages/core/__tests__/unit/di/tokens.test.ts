import { describe, it, expect } from 'vitest';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';

describe('DI_TOKENS', () => {
  it('should export DI_TOKENS', () => {
    expect(DI_TOKENS).toBeDefined();
    expect(typeof DI_TOKENS).toBe('object');
  });

  it('should have MATH backend tokens as Symbols', () => {
    expect(typeof DI_TOKENS.MATRIX_OPS).toBe('symbol');
    expect(typeof DI_TOKENS.STATISTICS).toBe('symbol');
    expect(typeof DI_TOKENS.LINEAR_ALGEBRA).toBe('symbol');
    expect(typeof DI_TOKENS.ARBITRARY_PRECISION).toBe('symbol');
  });

  it('should have ENGINE tokens as Symbols', () => {
    expect(typeof DI_TOKENS.RCA_ENGINE).toBe('symbol');
    expect(typeof DI_TOKENS.ROOT_CAUSE_RANKER).toBe('symbol');
    expect(typeof DI_TOKENS.CUTTING_ENGINE).toBe('symbol');
    expect(typeof DI_TOKENS.CONVERGENCE_PROVER).toBe('symbol');
    expect(typeof DI_TOKENS.DENOISE_ENGINE).toBe('symbol');
    expect(typeof DI_TOKENS.INDEPENDENCE_CHECKER).toBe('symbol');
    expect(typeof DI_TOKENS.SCALING_ANALYZER).toBe('symbol');
    expect(typeof DI_TOKENS.HIERARCHY_TRUNCATOR).toBe('symbol');
    expect(typeof DI_TOKENS.WAVE_PROPAGATION_MODEL).toBe('symbol');
    expect(typeof DI_TOKENS.CASCADE_SIMULATOR).toBe('symbol');
    expect(typeof DI_TOKENS.CORRELATION_DECAY_ESTIMATOR).toBe('symbol');
  });

  it('should have DATA and PIPELINE tokens as Symbols', () => {
    expect(typeof DI_TOKENS.BENCHMARK_LOADER).toBe('symbol');
    expect(typeof DI_TOKENS.RCA_PIPELINE).toBe('symbol');
  });

  it('should have expected number of tokens', () => {
    const keys = Object.keys(DI_TOKENS);
    // MATH: 4 + ENGINES: 11 + DATA: 1 + PIPELINE: 1 = 17
    expect(keys.length).toBe(23);
  });

  it('should have all Symbol.for tokens with micro-kinetic prefix', () => {
    const entries = Object.entries(DI_TOKENS);
    for (const [, sym] of entries) {
      const key = Symbol.keyFor(sym);
      expect(key).toBeDefined();
      expect(key).toMatch(/^micro-kinetic:/);
    }
  });

  it('should have all tokens be globally registered Symbols', () => {
    const entries = Object.entries(DI_TOKENS);
    for (const [, sym] of entries) {
      // Symbol.for creates global symbols; they should be retrievable
      expect(Symbol.for(Symbol.keyFor(sym)!)).toBe(sym);
    }
  });

  it('should iterate over all tokens via forEach', () => {
    let count = 0;
    Object.keys(DI_TOKENS).forEach((key) => {
      const token = DI_TOKENS[key as keyof typeof DI_TOKENS];
      expect(typeof token).toBe('symbol');
      count++;
    });
    expect(count).toBe(23);
  });

  it('should verify token names', () => {
    const names: Record<string, string> = {
      MATRIX_OPS: 'micro-kinetic:MatrixOps',
      STATISTICS: 'micro-kinetic:Statistics',
      LINEAR_ALGEBRA: 'micro-kinetic:LinearAlgebra',
      ARBITRARY_PRECISION: 'micro-kinetic:ArbitraryPrecision',
      RCA_ENGINE: 'micro-kinetic:RCAEngine',
      ROOT_CAUSE_RANKER: 'micro-kinetic:RootCauseRanker',
      CUTTING_ENGINE: 'micro-kinetic:CuttingEngine',
      CONVERGENCE_PROVER: 'micro-kinetic:ConvergenceProver',
      DENOISE_ENGINE: 'micro-kinetic:DenoiseEngine',
      INDEPENDENCE_CHECKER: 'micro-kinetic:IndependenceChecker',
      SCALING_ANALYZER: 'micro-kinetic:ScalingAnalyzer',
      HIERARCHY_TRUNCATOR: 'micro-kinetic:HierarchyTruncator',
      WAVE_PROPAGATION_MODEL: 'micro-kinetic:WavePropagationModel',
      CASCADE_SIMULATOR: 'micro-kinetic:CascadeSimulator',
      CORRELATION_DECAY_ESTIMATOR: 'micro-kinetic:CorrelationDecayEstimator',
      BENCHMARK_LOADER: 'micro-kinetic:BenchmarkLoader',
      RCA_PIPELINE: 'micro-kinetic:RCAPipeline',
    };
    for (const [key, expectedName] of Object.entries(names)) {
      const token = DI_TOKENS[key as keyof typeof DI_TOKENS];
      expect(Symbol.keyFor(token)).toBe(expectedName);
    }
  });
});
