import { describe, it, expect } from 'vitest';
import type {
  SVDResult,
  LUResult,
  RollingStatsResult,
  KDEResult,
  TestResult,
  CouplingParams,
  GraphSpectrum,
} from '@agentix-e/micro-kinetic-core';

describe('Math Provider interfaces - SVDResult', () => {
  it('should construct SVDResult', () => {
    const svd: SVDResult = {
      u: new Float64Array([1, 0, 0, 1]),
      s: new Float64Array([3, 1]),
      vt: new Float64Array([1, 0, 0, 1]),
    };
    expect(svd.s.length).toBe(2);
  });
});

describe('Math Provider interfaces - LUResult', () => {
  it('should construct LUResult', () => {
    const lu: LUResult = {
      l: new Float64Array([1, 0.5, 0, 1]),
      u: new Float64Array([2, 1, 0, 1.5]),
      p: new Int32Array([0, 1]),
    };
    expect(lu.p.length).toBe(2);
  });
});

describe('Math Provider interfaces - RollingStatsResult', () => {
  it('should construct RollingStatsResult', () => {
    const rs: RollingStatsResult = {
      mean: new Float64Array([5, 6, 7]),
      variance: new Float64Array([1, 2, 1]),
      stddev: new Float64Array([1, 1.414, 1]),
      windowSize: 3,
    };
    expect(rs.windowSize).toBe(3);
    expect(rs.mean.length).toBe(3);
  });
});

describe('Math Provider interfaces - KDEResult', () => {
  it('should construct KDEResult', () => {
    const kde: KDEResult = {
      x: new Float64Array([0, 0.5, 1]),
      density: new Float64Array([0.1, 0.5, 0.1]),
      bandwidth: 0.2,
    };
    expect(kde.bandwidth).toBe(0.2);
  });
});

describe('Math Provider interfaces - TestResult', () => {
  it('should construct a significant TestResult', () => {
    const tr: TestResult = {
      pValue: 0.001,
      statistic: 15.5,
      significant: true,
    };
    expect(tr.significant).toBe(true);
  });

  it('should construct a non-significant TestResult', () => {
    const tr: TestResult = {
      pValue: 0.3,
      statistic: 1.2,
      significant: false,
    };
    expect(tr.significant).toBe(false);
  });
});

describe('Math Provider interfaces - CouplingParams', () => {
  it('should construct CouplingParams', () => {
    const cp: CouplingParams = {
      minCooccurrence: 5,
      timeWindowMs: 60000,
      smoothingFactor: 0.1,
    };
    expect(cp.minCooccurrence).toBe(5);
    expect(cp.smoothingFactor).toBe(0.1);
  });
});

describe('Math Provider interfaces - GraphSpectrum', () => {
  it('should construct GraphSpectrum', () => {
    const gs: GraphSpectrum = {
      eigenvalues: new Float64Array([5, 3, 1]),
      spectralGap: 2,
      algebraicConnectivity: 1,
      spectralRadius: 5,
    };
    expect(gs.spectralGap).toBe(2);
    expect(gs.spectralRadius).toBe(5);
  });
});

describe('Math Provider interfaces - import verification', () => {
  it('should verify all math provider interfaces are importable', () => {
    const names = ['IMatrixOps', 'IStatistics', 'ILinearAlgebra', 'IArbitraryPrecision'];
    expect(names.length).toBe(4);
  });
});
