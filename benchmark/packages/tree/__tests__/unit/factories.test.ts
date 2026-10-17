import {
  createConfidenceEstimator,
  createNumpyTsMatrixOps,
  createTreePruner,
  createTreeRCAEngine,
  createUbiqueLinearAlgebra,
  registerTreeModule,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';
// TreeRCAEngine is the type createTreeRCAEngine declares; the IRootCauseRanker
// contract does not cover its PrunedTree-based analyze()/rank() signatures.
import type {
  IContainer,
  ILinearAlgebra,
  IMatrixOps,
  IRCAEngine,
} from '@agentix-e/micro-kinetic-core';
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import type { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';

describe('Factory functions', () => {
  let container: IContainer;

  beforeEach(() => {
    container = new Container();
  });

  describe('createTreePruner', () => {
    it('returns a TreePruner instance', () => {
      const pruner = createTreePruner(container);
      expect(pruner).toBeDefined();
      expect(typeof pruner.buildFaultGraph).toBe('function');
      expect(typeof pruner.analyze).toBe('function');
    });
  });

  describe('createTreeRCAEngine', () => {
    it('returns a TreeRCAEngine instance', () => {
      const engine = createTreeRCAEngine(container);
      expect(engine).toBeDefined();
      expect(typeof engine.analyze).toBe('function');
      expect(typeof engine.rank).toBe('function');
    });
  });

  describe('createConfidenceEstimator', () => {
    it('returns a ConfidenceEstimator instance', () => {
      const estimator = createConfidenceEstimator(container);
      expect(estimator).toBeDefined();
      expect(typeof estimator.estimateErrorBound).toBe('function');
      expect(typeof estimator.computeConfidence).toBe('function');
    });
  });

  describe('createNumpyTsMatrixOps', () => {
    it('returns a NumpyTsMatrixOps instance', () => {
      const ops = createNumpyTsMatrixOps(container);
      expect(ops).toBeDefined();
      expect(typeof ops.multiply).toBe('function');
      expect(typeof ops.eigenvalues).toBe('function');
    });
  });

  describe('createUbiqueLinearAlgebra', () => {
    it('returns a UbiqueLinearAlgebra instance', () => {
      const alg = createUbiqueLinearAlgebra(container);
      expect(alg).toBeDefined();
      expect(typeof alg.solve).toBe('function');
      expect(typeof alg.lu).toBe('function');
    });
  });
});

describe('registerTreeModule', () => {
  it('registers all DI tokens', () => {
    const container = new Container();
    registerTreeModule(container);
    expect(container.has(DI_TOKENS.MATRIX_OPS)).toBe(true);
    expect(container.has(DI_TOKENS.LINEAR_ALGEBRA)).toBe(true);
    expect(container.has(DI_TOKENS.RCA_ENGINE)).toBe(true);
    expect(container.has(DI_TOKENS.ROOT_CAUSE_RANKER)).toBe(true);
  });

  it('resolves MATRIX_OPS to correct type', () => {
    const container = new Container();
    registerTreeModule(container);
    const ops = container.resolve<IMatrixOps>(DI_TOKENS.MATRIX_OPS);
    expect(ops).toBeDefined();
    expect(typeof ops.multiply).toBe('function');
    expect(typeof ops.eigenvalues).toBe('function');
    expect(typeof ops.svd).toBe('function');
  });

  it('resolves LINEAR_ALGEBRA to correct type', () => {
    const container = new Container();
    registerTreeModule(container);
    const alg = container.resolve<ILinearAlgebra>(DI_TOKENS.LINEAR_ALGEBRA);
    expect(alg).toBeDefined();
    expect(typeof alg.solve).toBe('function');
    expect(typeof alg.lu).toBe('function');
    expect(typeof alg.inverse).toBe('function');
    expect(typeof alg.det).toBe('function');
  });

  it('resolves RCA_ENGINE to correct type', () => {
    const container = new Container();
    registerTreeModule(container);
    const engine = container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);
    expect(engine).toBeDefined();
    expect(typeof engine.buildFaultGraph).toBe('function');
    expect(typeof engine.analyze).toBe('function');
  });

  it('resolves ROOT_CAUSE_RANKER to correct type', () => {
    const container = new Container();
    registerTreeModule(container);
    const ranker = container.resolve<TreeRCAEngine>(DI_TOKENS.ROOT_CAUSE_RANKER);
    expect(ranker).toBeDefined();
    expect(typeof ranker.analyze).toBe('function');
    expect(typeof ranker.rank).toBe('function');
  });

  it('throws if container is null', () => {
    expect(() => registerTreeModule(null as unknown as IContainer)).toThrow();
  });

  it('returns singletons (same instance on repeated resolve)', () => {
    const container = new Container();
    registerTreeModule(container);
    const ops1 = container.resolve(DI_TOKENS.MATRIX_OPS);
    const ops2 = container.resolve(DI_TOKENS.MATRIX_OPS);
    expect(ops1).toBe(ops2);
  });
});
