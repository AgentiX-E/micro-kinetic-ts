import { describe, it, expect, vi } from 'vitest';

vi.mock('numpy-ts', () => {
  class NDArray {
    data: Float64Array;
    flags = { C_CONTIGUOUS: true };
    _shape: number[];
    constructor(data: Float64Array, shape?: number[]) { this.data = data; this._shape = shape || [data.length]; }
    tolist(): number[] { return Array.from(this.data); }
    copy() { return new NDArray(new Float64Array(this.data), this._shape); }
    reshape(shape: number[]) { return new NDArray(this.data, shape); }
  }
  function array(data: Float64Array | number[]) {
    return new NDArray(data instanceof Float64Array ? data : new Float64Array(data), [data.length]);
  }
  function polyfit(x: NDArray, y: NDArray): NDArray {
    const xd = x.data; const yd = y.data; const n = xd.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    for (let i = 0; i < n; i++) {
      const xi = xd[i]!, yi = yd[i]!;
      sx += xi; sy += yi; sxy += xi * yi; sx2 += xi * xi;
    }
    const denom = n * sx2 - sx * sx;
    const slope = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom;
    const intercept = Math.abs(denom) < 1e-12 ? 0 : (sy * sx2 - sx * sxy) / denom;
    return new NDArray(new Float64Array([slope, intercept]), [2]);
  }
  function polyval(coeffs: NDArray, x: NDArray): NDArray {
    const c = coeffs.data; const xd = x.data;
    const result = new Float64Array(xd.length);
    for (let i = 0; i < xd.length; i++) {
      let val = 0;
      for (let j = 0; j < c.length; j++) val += (c[j] ?? 0) * Math.pow(xd[i]!, c.length - 1 - j);
      result[i] = val;
    }
    return new NDArray(result);
  }
  return { array, polyfit, polyval, NDArray, default: { array, polyfit, polyval, NDArray } };
});

import { registerCuttingFactories, AdaptiveWindowCutter, InductionProver } from '@agentix-e/micro-kinetic-cutting';
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import type { IContainer } from '@agentix-e/micro-kinetic-core';

describe('registerCuttingFactories', () => {
  it('registers CUTTING_ENGINE and CONVERGENCE_PROVER tokens', () => {
    const container = new Container();
    registerCuttingFactories(container);
    expect(container.has(DI_TOKENS.CUTTING_ENGINE)).toBe(true);
    expect(container.has(DI_TOKENS.CONVERGENCE_PROVER)).toBe(true);
  });

  it('resolves CUTTING_ENGINE as AdaptiveWindowCutter', () => {
    const container = new Container();
    registerCuttingFactories(container);
    const engine = container.resolve(DI_TOKENS.CUTTING_ENGINE);
    expect(engine).toBeDefined();
    expect(typeof engine.segment).toBe('function');
  });

  it('resolves CONVERGENCE_PROVER as InductionProver', () => {
    const container = new Container();
    registerCuttingFactories(container);
    const prover = container.resolve(DI_TOKENS.CONVERGENCE_PROVER);
    expect(prover).toBeDefined();
    expect(typeof prover.prove).toBe('function');
  });

  it('does not overwrite existing', () => {
    const container = new Container();
    container.register(DI_TOKENS.CUTTING_ENGINE, (c: IContainer) => ({ __custom: true }));
    registerCuttingFactories(container);
    expect((container.resolve(DI_TOKENS.CUTTING_ENGINE) as any).__custom).toBe(true);
  });

  it('custom factory context', () => {
    const container = new Container();
    const customEngine = new AdaptiveWindowCutter();
    const customProver = new InductionProver();
    registerCuttingFactories(container, {
      cuttingEngineFactory: () => customEngine,
      convergenceProverFactory: () => customProver,
    });
    expect(container.resolve(DI_TOKENS.CUTTING_ENGINE)).toBe(customEngine);
    expect(container.resolve(DI_TOKENS.CONVERGENCE_PROVER)).toBe(customProver);
  });

  it('registers as singletons', () => {
    const container = new Container();
    registerCuttingFactories(container);
    const e1 = container.resolve(DI_TOKENS.CUTTING_ENGINE);
    const e2 = container.resolve(DI_TOKENS.CUTTING_ENGINE);
    expect(e1).toBe(e2);
  });
});
