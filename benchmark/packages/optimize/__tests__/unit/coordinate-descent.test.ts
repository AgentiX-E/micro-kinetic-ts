import { describe, expect, it } from 'vitest';

import { coordinateDescent } from '../../src/coordinate-descent.js';

describe('coordinateDescent', () => {
  it('maximizes a convex quadratic from a non-optimal start', async () => {
    // f(x) = -(x0 - 0.7)^2 - (x1 - 0.3)^2, maximized at (0.7, 0.3) with f=0.
    const oracle = async (x: Float64Array) => -((x[0]! - 0.7) ** 2) - (x[1]! - 0.3) ** 2;
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0, 0]),
      stepSizes: new Float64Array([0.5, 0.5]),
      maxRounds: 20,
      minStep: 1e-4,
      shrinkFactor: 0.5,
    });

    expect(result.best[0]).toBeCloseTo(0.7, 2);
    expect(result.best[1]).toBeCloseTo(0.3, 2);
    expect(result.bestScore).toBeCloseTo(0, 2);
    // Must strictly improve over the initial point (f(0,0) = -0.58).
    expect(result.bestScore).toBeGreaterThan(-0.1);
  });

  it('never returns worse than the initial point (monotone improvement)', async () => {
    // A flat landscape: any move is a no-op, so the initial point is kept.
    const oracle = async () => 1.0;
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0.4, 0.6]),
      stepSizes: new Float64Array([0.2, 0.2]),
      maxRounds: 3,
      minStep: 1e-6,
    });

    expect(result.best[0]).toBeCloseTo(0.4, 6);
    expect(result.best[1]).toBeCloseTo(0.6, 6);
    expect(result.bestScore).toBe(1.0);
  });

  it('respects per-dimension bounds', async () => {
    // Maximize f(x) = x, which wants to push x to +inf — but the upper bound
    // clamps the search to 0.8.
    const oracle = async (x: Float64Array) => x[0]!;
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0]),
      stepSizes: new Float64Array([1.0]),
      lower: new Float64Array([0]),
      upper: new Float64Array([0.8]),
      maxRounds: 5,
      minStep: 1e-3,
    });

    expect(result.best[0]).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(result.best[0]).toBeCloseTo(0.8, 2);
  });

  it('stops early when all steps fall below minStep', async () => {
    let calls = 0;
    const oracle = async (x: Float64Array) => {
      calls++;
      return -((x[0]! - 0.5) ** 2);
    };
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0.5]),
      stepSizes: new Float64Array([0.4]),
      maxRounds: 100, // would never hit this bound
      minStep: 0.1, // after one shrink (0.4 -> 0.2), still >= 0.1; second shrink 0.1...
      shrinkFactor: 0.5,
    });

    // The step sequence is 0.4, 0.2, 0.1, ... — after the sweep where step <
    // minStep the loop stops, so rounds < maxRounds.
    expect(result.rounds).toBeLessThan(100);
    expect(result.evaluations).toBe(calls);
    expect(result.bestScore).toBeCloseTo(0, 3);
  });

  it('tracks per-dimension history and evaluation count', async () => {
    const oracle = async (x: Float64Array) => -((x[0]! - 1) ** 2);
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0]),
      stepSizes: new Float64Array([0.5]),
      maxRounds: 2,
      minStep: 1e-9,
    });

    // history: one entry per (round, dim) = 2 entries for 2 rounds × 1 dim.
    expect(result.history.length).toBe(2);
    expect(result.evaluations).toBeGreaterThanOrEqual(1 + result.history.length);
    // First dimension step improved (moved from 0 toward 1).
    expect(result.best[0]).toBeGreaterThan(0);
  });

  it('rejects mismatched stepSizes length', async () => {
    const oracle = async () => 0;
    await expect(
      coordinateDescent(oracle, {
        initial: new Float64Array([0, 0]),
        stepSizes: new Float64Array([0.5]), // length mismatch
      }),
    ).rejects.toThrow(/stepSizes/);
  });

  it('rejects mismatched lower and upper bound lengths', async () => {
    const oracle = async () => 0;
    await expect(
      coordinateDescent(oracle, {
        initial: new Float64Array([0, 0]),
        stepSizes: new Float64Array([0.5, 0.5]),
        lower: new Float64Array([0]), // length mismatch
      }),
    ).rejects.toThrow(/lower/);
    await expect(
      coordinateDescent(oracle, {
        initial: new Float64Array([0, 0]),
        stepSizes: new Float64Array([0.5, 0.5]),
        upper: new Float64Array([1]), // length mismatch
      }),
    ).rejects.toThrow(/upper/);
  });

  it('clamps an out-of-bounds initial point into bounds', async () => {
    // Initial below lower and above upper must be clamped before searching;
    // f(x) = x wants to move up, but the upper bound caps the search.
    const oracle = async (x: Float64Array) => x[0]!;
    const below = await coordinateDescent(oracle, {
      initial: new Float64Array([-5]), // below lower 0
      stepSizes: new Float64Array([1.0]),
      lower: new Float64Array([0]),
      upper: new Float64Array([0.5]),
      maxRounds: 2,
      minStep: 1e-9,
    });
    expect(below.best[0]).toBeGreaterThanOrEqual(0);
    expect(below.best[0]).toBeLessThanOrEqual(0.5 + 1e-9);

    // Initial ABOVE the upper bound: clamp to upper, then the +step move is a
    // no-op (already at the ceiling) so the point stays at upper.
    const above = await coordinateDescent(oracle, {
      initial: new Float64Array([9]), // above upper 0.5
      stepSizes: new Float64Array([1.0]),
      lower: new Float64Array([0]),
      upper: new Float64Array([0.5]),
      maxRounds: 1,
      minStep: 1e-9,
    });
    expect(above.best[0]).toBeCloseTo(0.5, 6);
  });

  it('uses default termination controls and bounds when omitted', async () => {
    // Omit maxRounds/minStep/shrinkFactor/lower/upper entirely to exercise the
    // `?? DEFAULT_*` fallbacks. A flat landscape means every move is a no-op,
    // so the search runs its full default budget without error.
    const oracle = async () => 0.5;
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array([0.2]),
      stepSizes: new Float64Array([0.4]),
    });

    // Defaults: maxRounds=10, minStep=1e-3, shrink=0.5 → terminates normally.
    expect(result.bestScore).toBe(0.5);
    expect(result.best[0]).toBeCloseTo(0.2, 6);
    expect(result.rounds).toBeGreaterThanOrEqual(1);
  });

  it('handles an empty search space', async () => {
    const oracle = async () => 42;
    const result = await coordinateDescent(oracle, {
      initial: new Float64Array(0),
      stepSizes: new Float64Array(0),
    });
    expect(result.best).toHaveLength(0);
    expect(result.bestScore).toBe(42);
    expect(result.rounds).toBe(0);
  });
});
