import { describe, expect, it } from 'vitest';

import {
  RESOURCE_FAULT_TYPES,
  analyzeRoutingProbe,
  engineMargin,
  prismMargin,
  regressionCellKey,
  type RoutingProbeRecord,
} from '../../../src/benchmarks/leaderboard/routing-probe.js';

/** Build a minimal routing-probe record with sensible defaults. */
function record(
  overrides: Partial<RoutingProbeRecord> & { truth: string; cell: string; faultType: string },
): RoutingProbeRecord {
  return {
    caseId: overrides.caseId ?? `${overrides.cell}/${overrides.faultType}/${overrides.truth}`,
    cell: overrides.cell,
    faultType: overrides.faultType,
    truth: overrides.truth,
    engineTop1: overrides.engineTop1,
    engineTop1Score: overrides.engineTop1Score,
    engineTop2: overrides.engineTop2,
    engineTop2Score: overrides.engineTop2Score,
    prismTop1: overrides.prismTop1,
    prismTop1Score: overrides.prismTop1Score,
    prismTop2: overrides.prismTop2,
    prismTop2Score: overrides.prismTop2Score,
  };
}

describe('regressionCellKey', () => {
  it('joins the system cell and fault type', () => {
    expect(regressionCellKey('RE1:SockShop', 'cpu')).toBe('RE1:SockShop/cpu');
  });
});

describe('RESOURCE_FAULT_TYPES', () => {
  it('contains the internal resource channels', () => {
    expect(RESOURCE_FAULT_TYPES.has('cpu')).toBe(true);
    expect(RESOURCE_FAULT_TYPES.has('mem')).toBe(true);
    expect(RESOURCE_FAULT_TYPES.has('disk')).toBe(true);
    expect(RESOURCE_FAULT_TYPES.has('delay')).toBe(false);
    expect(RESOURCE_FAULT_TYPES.has('socket')).toBe(false);
  });
});

describe('engineMargin / prismMargin', () => {
  it('computes top1 minus top2 when both scores exist', () => {
    const r = record({
      cell: 'RE1:SockShop',
      faultType: 'cpu',
      truth: 'a',
      engineTop1Score: 1.0,
      engineTop2Score: 0.4,
      prismTop1Score: 0.8,
      prismTop2Score: 0.3,
    });
    expect(engineMargin(r)).toBeCloseTo(0.6);
    expect(prismMargin(r)).toBeCloseTo(0.5);
  });

  it('returns undefined when a second score is missing', () => {
    const r = record({
      cell: 'RE1:SockShop',
      faultType: 'cpu',
      truth: 'a',
      engineTop1Score: 1.0,
      prismTop1Score: 0.8,
    });
    expect(engineMargin(r)).toBeUndefined();
    expect(prismMargin(r)).toBeUndefined();
  });
});

describe('analyzeRoutingProbe', () => {
  it('returns a null frontier for empty input', () => {
    const analysis = analyzeRoutingProbe([]);
    expect(analysis.total).toBe(0);
    expect(analysis.baselineAccuracy).toBe(0);
    expect(analysis.unionRate).toBe(0);
    expect(analysis.bestZeroRegression).toBeNull();
    // References are still present.
    expect(analysis.rules.some((r) => r.name === 'always-engine')).toBe(true);
    expect(analysis.rules.some((r) => r.name === 'always-prism')).toBe(true);
  });

  it('aggregates disagreement statistics', () => {
    const records = [
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 's1',
        prismTop1: 'sX',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's2',
        engineTop1: 'sY',
        prismTop1: 's2',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's3',
        engineTop1: 's3',
        prismTop1: 's3',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's4',
        engineTop1: 'sW',
        prismTop1: 'sZ',
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    expect(analysis.total).toBe(4);
    expect(analysis.engineCorrect).toBe(2);
    expect(analysis.prismCorrect).toBe(2);
    expect(analysis.disagreement).toBe(3); // s1/sX, sY/s2, and sW/sZ (both wrong)
    expect(analysis.engineOnly).toBe(1);
    expect(analysis.prismOnly).toBe(1);
    expect(analysis.bothWrong).toBe(1);
    expect(analysis.union).toBe(3);
    expect(analysis.unionRate).toBeCloseTo(0.75);
  });

  it('routes the only-engines on clean margin separation to the union ceiling', () => {
    const records = [
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 's1',
        engineTop1Score: 1.0,
        engineTop2: 'other',
        engineTop2Score: 0.0,
        prismTop1: 'sX',
        prismTop1Score: 0.3,
        prismTop2: 'other2',
        prismTop2Score: 0.1,
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's2',
        engineTop1: 'sY',
        engineTop1Score: 0.6,
        engineTop2: 'other',
        engineTop2Score: 0.5,
        prismTop1: 's2',
        prismTop1Score: 0.9,
        prismTop2: 'other2',
        prismTop2Score: 0.2,
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's3',
        engineTop1: 's3',
        engineTop1Score: 0.8,
        engineTop2: 'other',
        engineTop2Score: 0.7,
        prismTop1: 's3',
        prismTop1Score: 0.8,
        prismTop2: 'other2',
        prismTop2Score: 0.7,
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's4',
        engineTop1: 'sW',
        engineTop1Score: 0.4,
        engineTop2: 'other',
        engineTop2Score: 0.3,
        prismTop1: 'sZ',
        prismTop1Score: 0.4,
        prismTop2: 'other2',
        prismTop2Score: 0.3,
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    // The margin threshold 1.0 routes the low-margin (uncertain-engine) case to
    // PRISM and keeps the confident engine case on the engine, reaching union.
    const marginRule = analysis.rules.find((r) => r.name === 'engine-margin<1.0000->prism');
    expect(marginRule).toBeDefined();
    expect(marginRule!.accuracy).toBeCloseTo(0.75);
    expect(marginRule!.regressingCells).toEqual([]);
    expect(analysis.bestZeroRegression!.accuracy).toBeCloseTo(0.75);
  });

  it('routes resource faults to PRISM via the fault-type prior', () => {
    const records = [
      // cpu: PRISM wins, engine loses.
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 'sX',
        prismTop1: 's1',
      }),
      // delay: engine wins, PRISM loses.
      record({
        cell: 'RE1:SockShop',
        faultType: 'delay',
        truth: 's2',
        engineTop1: 's2',
        prismTop1: 'sY',
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    const rule = analysis.rules.find((r) => r.name === 'resource-fault->prism');
    expect(rule).toBeDefined();
    expect(rule!.accuracy).toBeCloseTo(1.0);
    expect(rule!.regressingCells).toEqual([]);
  });

  it('excludes net-positive but regressing routers from the zero-regression frontier', () => {
    const records = [
      // Cell X (cpu): engine wins both, PRISM loses both.
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 'x1',
        engineTop1: 'x1',
        prismTop1: 'wrong',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 'x2',
        engineTop1: 'x2',
        prismTop1: 'wrong',
      }),
      // Cell Y (delay): PRISM wins all, engine loses all.
      ...Array.from({ length: 100 }, (_, i) =>
        record({
          cell: 'RE1:SockShop',
          faultType: 'delay',
          truth: `y${i}`,
          engineTop1: 'wrong',
          prismTop1: `y${i}`,
        }),
      ),
    ];
    const analysis = analyzeRoutingProbe(records);

    const alwaysPrism = analysis.rules.find((r) => r.name === 'always-prism')!;
    // Net-positive: 100/102 correct, but it regresses the cpu cell.
    expect(alwaysPrism.accuracy).toBeCloseTo(100 / 102);
    expect(alwaysPrism.regressingCells).toContain('RE1:SockShop/cpu');
    expect(analysis.zeroRegressionRules.some((r) => r.name === 'always-prism')).toBe(false);

    // The per-cell oracle routes cpu→engine and delay→prism, reaching 100%.
    const oracle = analysis.rules.find((r) => r.name === 'per-cell-oracle')!;
    expect(oracle.accuracy).toBeCloseTo(1.0);
    expect(oracle.regressingCells).toEqual([]);

    expect(analysis.bestZeroRegression!.name).toBe('per-cell-oracle');
    expect(analysis.bestZeroRegression!.accuracy).toBeCloseTo(1.0);
  });

  it('keeps the engine baseline for ties in the per-cell oracle', () => {
    const records = [
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 's1',
        prismTop1: 's1',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's2',
        engineTop1: 's2',
        prismTop1: 's2',
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    const oracle = analysis.rules.find((r) => r.name === 'per-cell-oracle')!;
    // Tie (2 engine == 2 prism) keeps the engine, which is correct on both.
    expect(oracle.accuracy).toBeCloseTo(1.0);
  });

  it('treats undefined engine margin as confident (never route away)', () => {
    const records = [
      // Single engine candidate (no top-2) → undefined margin → stay on engine.
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 's1',
        engineTop1Score: 0.9,
        prismTop1: 'sX',
        prismTop1Score: 0.5,
        prismTop2: 'other',
        prismTop2Score: 0.1,
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    // No engine margin was observed, so the sweep produced no engine-margin
    // rule; the baseline stays on the engine and is correct.
    expect(analysis.baselineAccuracy).toBeCloseTo(1.0);
    expect(analysis.rules.some((r) => r.name.startsWith('engine-margin<'))).toBe(false);
  });

  it('computes gain relative to the always-engine baseline', () => {
    const records = [
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's1',
        engineTop1: 's1',
        prismTop1: 's1',
      }),
      record({
        cell: 'RE1:SockShop',
        faultType: 'cpu',
        truth: 's2',
        engineTop1: 'sX',
        prismTop1: 's2',
      }),
    ];
    const analysis = analyzeRoutingProbe(records);
    const alwaysPrism = analysis.rules.find((r) => r.name === 'always-prism')!;
    const baseline = analysis.rules.find((r) => r.name === 'always-engine')!;
    expect(baseline.accuracy).toBeCloseTo(0.5);
    expect(alwaysPrism.accuracy).toBeCloseTo(1.0);
    expect(alwaysPrism.gain).toBeCloseTo(0.5);
  });
});
