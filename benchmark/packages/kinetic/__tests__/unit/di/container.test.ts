import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';

// ── Mock sub-package constructors ─────────────────────────
const mockInstances: Record<string, unknown> = {};

function makeMock<T>(name: string): { new(...args: unknown[]): T } {
  const ctor = vi.fn(function (this: unknown, ...args: unknown[]) {
    mockInstances[name] = this;
    return this;
  }) as unknown as { new(...args: unknown[]): T };
  return ctor;
}

vi.mock('@agentix-e/micro-kinetic-tree', () => ({
  NumpyTsMatrixOps: makeMock('NumpyTsMatrixOps'),
  UbiqueLinearAlgebra: makeMock('UbiqueLinearAlgebra'),
  TreePruner: makeMock('TreePruner'),
  TreeRCAEngine: makeMock('TreeRCAEngine'),
}));

vi.mock('@agentix-e/micro-kinetic-cutting', () => ({
  AdaptiveWindowCutter: makeMock('AdaptiveWindowCutter'),
  InductionProver: makeMock('InductionProver'),
}));

vi.mock('@agentix-e/micro-kinetic-noise', () => ({
  StossDenoiser: makeMock('StossDenoiser'),
  IndependenceChecker: makeMock('IndependenceChecker'),
  DecimalProvider: makeMock('DecimalProvider'),
  StatisticsProvider: makeMock('StatisticsProvider'),
  CouplingSparsityAnalyzer: makeMock('CouplingSparsityAnalyzer'),
}));

vi.mock('@agentix-e/micro-kinetic-scaling', () => ({
  HierarchyTruncator: makeMock('HierarchyTruncator'),
  BoltzmannGradAnalyzer: makeMock('BoltzmannGradAnalyzer'),
  HierarchyBuilder: makeMock('HierarchyBuilder'),
}));

vi.mock('@agentix-e/micro-kinetic-wave', () => ({
  WaveCascadeModel: makeMock('WaveCascadeModel'),
  PropagationSimulator: makeMock('PropagationSimulator'),
  CorrelationDecay: makeMock('CorrelationDecay'),
}));

import { createDefaultContainer } from '../../../src/di/container.js';

describe('createDefaultContainer', () => {
  let container: ReturnType<typeof createDefaultContainer>;

  beforeEach(() => {
    container = createDefaultContainer();
  });

  // ── has() — verify every DI_TOKEN is registered ─────────

  const mathTokens: [string, symbol][] = [
    ['MATRIX_OPS', DI_TOKENS.MATRIX_OPS],
    ['LINEAR_ALGEBRA', DI_TOKENS.LINEAR_ALGEBRA],
    ['STATISTICS', DI_TOKENS.STATISTICS],
    ['ARBITRARY_PRECISION', DI_TOKENS.ARBITRARY_PRECISION],
  ];

  const engineTokens: [string, symbol][] = [
    ['RCA_ENGINE', DI_TOKENS.RCA_ENGINE],
    ['ROOT_CAUSE_RANKER', DI_TOKENS.ROOT_CAUSE_RANKER],
    ['CUTTING_ENGINE', DI_TOKENS.CUTTING_ENGINE],
    ['CONVERGENCE_PROVER', DI_TOKENS.CONVERGENCE_PROVER],
    ['INDEPENDENCE_CHECKER', DI_TOKENS.INDEPENDENCE_CHECKER],
    ['DENOISE_ENGINE', DI_TOKENS.DENOISE_ENGINE],
    ['HIERARCHY_TRUNCATOR', DI_TOKENS.HIERARCHY_TRUNCATOR],
    ['SCALING_ANALYZER', DI_TOKENS.SCALING_ANALYZER],
    ['WAVE_PROPAGATION_MODEL', DI_TOKENS.WAVE_PROPAGATION_MODEL],
    ['CASCADE_SIMULATOR', DI_TOKENS.CASCADE_SIMULATOR],
    ['CORRELATION_DECAY_ESTIMATOR', DI_TOKENS.CORRELATION_DECAY_ESTIMATOR],
  ];

  describe('has() — Math backends', () => {
    for (const [name, token] of mathTokens) {
      it(`should register ${name}`, () => {
        expect(container.has(token)).toBe(true);
      });
    }
  });

  describe('has() — Engine components', () => {
    for (const [name, token] of engineTokens) {
      it(`should register ${name}`, () => {
        expect(container.has(token)).toBe(true);
      });
    }
  });

  // ── resolve() — verify resolution returns non-null instances ──

  describe('resolve() — Math backends', () => {
    it('should resolve MATRIX_OPS', () => {
      const instance = container.resolve(DI_TOKENS.MATRIX_OPS);
      expect(instance).toBeDefined();
    });

    it('should resolve LINEAR_ALGEBRA', () => {
      const instance = container.resolve(DI_TOKENS.LINEAR_ALGEBRA);
      expect(instance).toBeDefined();
    });

    it('should resolve STATISTICS', () => {
      const instance = container.resolve(DI_TOKENS.STATISTICS);
      expect(instance).toBeDefined();
    });

    it('should resolve ARBITRARY_PRECISION', () => {
      const instance = container.resolve(DI_TOKENS.ARBITRARY_PRECISION);
      expect(instance).toBeDefined();
    });
  });

  describe('resolve() — Engine components', () => {
    it('should resolve RCA_ENGINE', () => {
      const instance = container.resolve(DI_TOKENS.RCA_ENGINE);
      expect(instance).toBeDefined();
    });

    it('should resolve ROOT_CAUSE_RANKER', () => {
      const instance = container.resolve(DI_TOKENS.ROOT_CAUSE_RANKER);
      expect(instance).toBeDefined();
    });

    it('should resolve CUTTING_ENGINE', () => {
      const instance = container.resolve(DI_TOKENS.CUTTING_ENGINE);
      expect(instance).toBeDefined();
    });

    it('should resolve CONVERGENCE_PROVER', () => {
      const instance = container.resolve(DI_TOKENS.CONVERGENCE_PROVER);
      expect(instance).toBeDefined();
    });

    it('should resolve INDEPENDENCE_CHECKER', () => {
      const instance = container.resolve(DI_TOKENS.INDEPENDENCE_CHECKER);
      expect(instance).toBeDefined();
    });

    it('should resolve DENOISE_ENGINE', () => {
      const instance = container.resolve(DI_TOKENS.DENOISE_ENGINE);
      expect(instance).toBeDefined();
    });

    it('should resolve HIERARCHY_TRUNCATOR', () => {
      const instance = container.resolve(DI_TOKENS.HIERARCHY_TRUNCATOR);
      expect(instance).toBeDefined();
    });

    it('should resolve SCALING_ANALYZER', () => {
      const instance = container.resolve(DI_TOKENS.SCALING_ANALYZER);
      expect(instance).toBeDefined();
    });

    it('should resolve WAVE_PROPAGATION_MODEL', () => {
      const instance = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);
      expect(instance).toBeDefined();
    });

    it('should resolve CASCADE_SIMULATOR', () => {
      const instance = container.resolve(DI_TOKENS.CASCADE_SIMULATOR);
      expect(instance).toBeDefined();
    });

    it('should resolve CORRELATION_DECAY_ESTIMATOR', () => {
      const instance = container.resolve(DI_TOKENS.CORRELATION_DECAY_ESTIMATOR);
      expect(instance).toBeDefined();
    });
  });

  // ── Singleton behavior ──

  it('should return same instance for repeated resolve calls', () => {
    const a = container.resolve(DI_TOKENS.RCA_ENGINE);
    const b = container.resolve(DI_TOKENS.RCA_ENGINE);
    expect(a).toBe(b);
  });

  it('should return same instance for STATISTICS across dependencies', () => {
    const a = container.resolve(DI_TOKENS.STATISTICS);
    const b = container.resolve(DI_TOKENS.STATISTICS);
    expect(a).toBe(b);
  });

  // ── Internal helper tokens ──

  it('should register internal CouplingSparsityAnalyzer symbol', () => {
    expect(container.has(Symbol.for('micro-kinetic:CouplingSparsityAnalyzer'))).toBe(true);
  });

  it('should register internal HierarchyBuilder symbol', () => {
    expect(container.has(Symbol.for('micro-kinetic:HierarchyBuilder'))).toBe(true);
  });

  // ── Edge: tokens that should NOT be registered ──

  it('should not register BENCHMARK_LOADER', () => {
    expect(container.has(DI_TOKENS.BENCHMARK_LOADER)).toBe(false);
  });

  it('should not register RCA_PIPELINE', () => {
    expect(container.has(DI_TOKENS.RCA_PIPELINE)).toBe(false);
  });
});
