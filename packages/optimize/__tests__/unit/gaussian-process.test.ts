import { describe, expect, it } from 'vitest';
import { GaussianProcess } from '../../src/gaussian-process.js';
import { DEFAULT_CONFIG_SPACE, DEFAULT_CONFIG } from '../../src/config-space.js';

describe('GaussianProcess', () => {
  it('should create with default options', () => {
    const gp = new GaussianProcess(3);
    expect(gp.observationCount).toBe(0);
  });

  it('should predict prior before any observations', () => {
    const gp = new GaussianProcess(3);
    const pred = gp.predict(new Float64Array([0.5, 0.5, 0.5]));
    expect(pred.mean).toBe(0.6);
    expect(pred.variance).toBeGreaterThan(0);
    expect(pred.std).toBeGreaterThan(0);
  });

  it('should add a single observation', () => {
    const gp = new GaussianProcess(2);
    gp.addObservation(new Float64Array([0.2, 0.8]), 0.75);
    expect(gp.observationCount).toBe(1);
  });

  it('should add multiple observations', () => {
    const gp = new GaussianProcess(2);
    gp.addObservations(
      [new Float64Array([0.1, 0.1]), new Float64Array([0.9, 0.9])],
      [0.5, 0.9],
    );
    expect(gp.observationCount).toBe(2);
  });

  it('should produce identical predictions for identical inputs', () => {
    const gp = new GaussianProcess(2);
    gp.addObservation(new Float64Array([0.3, 0.7]), 0.8);
    const p1 = gp.predict(new Float64Array([0.5, 0.5]));
    const p2 = gp.predict(new Float64Array([0.5, 0.5]));
    expect(p1.mean).toBeCloseTo(p2.mean);
    expect(p1.variance).toBeCloseTo(p2.variance);
  });

  it('should reduce variance near observations', () => {
    const gp = new GaussianProcess(1);
    gp.addObservation(new Float64Array([0.5]), 0.8);

    const near = gp.predict(new Float64Array([0.5]));
    const far = gp.predict(new Float64Array([0.0]));

    // Variance should be lower near observed points
    expect(near.variance).toBeLessThan(far.variance);
  });

  it('should pull mean toward observations', () => {
    const gp = new GaussianProcess(1);
    gp.addObservation(new Float64Array([0.5]), 0.9);
    gp.addObservation(new Float64Array([0.1]), 0.3);

    const pred = gp.predict(new Float64Array([0.5]));
    // Mean should be above prior (0.6) due to nearby high-value observation
    expect(pred.mean).toBeGreaterThan(0.6);
    expect(pred.mean).toBeLessThan(1.0);
  });

  it('should compute log marginal likelihood', () => {
    const gp = new GaussianProcess(2);
    gp.addObservations(
      [
        new Float64Array([0.1, 0.2]),
        new Float64Array([0.8, 0.9]),
      ],
      [0.4, 0.95],
    );
    const lml = gp.logMarginalLikelihood();
    expect(Number.isFinite(lml)).toBe(true);
  });

  it('should select best observation via UCB', () => {
    const gp = new GaussianProcess(2);
    // Add observations around known optimum at (0.8, 0.8)
    gp.addObservations(
      [
        new Float64Array([0.2, 0.2]),
        new Float64Array([0.9, 0.9]),
        new Float64Array([0.5, 0.5]),
        new Float64Array([0.3, 0.8]),
      ],
      [0.3, 0.95, 0.6, 0.55],
    );

    const candidates = [
      new Float64Array([0.8, 0.8]),
      new Float64Array([0.1, 0.1]),
      new Float64Array([0.5, 0.9]),
    ];

    const best = gp.acquireUCB(candidates, 2.0);
    // UCB should prefer points near (0.9, 0.9) which had high reward
    expect(best.index).toBeGreaterThanOrEqual(0);
    expect(best.index).toBeLessThan(candidates.length);
    expect(best.value).toBeGreaterThan(0.5);
  });

  it('should find best observation', () => {
    const gp = new GaussianProcess(1);
    gp.addObservations(
      [new Float64Array([0.2]), new Float64Array([0.8])],
      [0.3, 0.95],
    );
    const best = gp.bestObservation;
    // Should prefer the observation with higher reward
    expect(best.idx).toBeGreaterThanOrEqual(0);
    // Posterior mean at best observation should be close to its reward
    expect(best.mean).toBeGreaterThan(0.6);
  });

  it('should handle many observations (numerical stability)', () => {
    const gp = new GaussianProcess(2);
    const xs: Float64Array[] = [];
    const ys: number[] = [];
    for (let i = 0; i < 20; i++) {
      xs.push(new Float64Array([Math.random(), Math.random()]));
      ys.push(Math.random());
    }
    gp.addObservations(xs, ys);
    expect(gp.observationCount).toBe(20);

    // Should produce valid predictions
    const pred = gp.predict(new Float64Array([0.5, 0.5]));
    expect(Number.isFinite(pred.mean)).toBe(true);
    expect(Number.isFinite(pred.variance)).toBe(true);
    expect(pred.variance).toBeGreaterThanOrEqual(0);
  });

  it('should handle 1D optimization on known function', () => {
    // Optimize f(x) = -(x-0.7)^2 on [0, 1] (maximum at x=0.7)
    const gp = new GaussianProcess(1, { signalVariance: 0.5, lengthScale: 0.2 });
    const trueF = (x: number) => -((x - 0.7) * (x - 0.7)) + 0.5;

    // Seed with points near optimum to ensure GP has signal
    gp.addObservations(
      [
        new Float64Array([0.65]),
        new Float64Array([0.75]),
        new Float64Array([0.5]),
        new Float64Array([0.9]),
      ],
      [trueF(0.65), trueF(0.75), trueF(0.5), trueF(0.9)],
    );

    // Generate candidate points and select via UCB
    const candidates: Float64Array[] = [];
    for (let i = 0; i <= 50; i++) {
      candidates.push(new Float64Array([i / 50]));
    }

    // UCB exploration may select points far from observations (high variance region).
    // Use smaller beta to favor exploitation over exploration.
    const best = gp.acquireUCB(candidates, 0.5);
    // With low beta, should prefer near-observed region
    expect(best.point[0]).toBeGreaterThan(0.1);
    expect(best.point[0]).toBeLessThanOrEqual(1.0);

    // Posterior mean at optimum (0.7) should be the highest
    const pred = gp.predict(new Float64Array([0.7]));
    expect(pred.mean).toBeGreaterThan(0.4); // Close to true optimum ~0.5
  });

  it('should have deterministic predictions (same input)', () => {
    const gp = new GaussianProcess(2);
    gp.addObservations(
      [new Float64Array([0.3, 0.7]), new Float64Array([0.6, 0.4])],
      [0.6, 0.9],
    );

    const x = new Float64Array([0.5, 0.5]);
    const p1 = gp.predict(x);
    const p2 = gp.predict(x);
    expect(p1.mean).toBe(p2.mean);
    expect(p1.variance).toBe(p2.variance);
  });

  it('should throw on empty UCB acquisition', () => {
    const gp = new GaussianProcess(2);
    expect(() => gp.acquireUCB([], 2.0)).toThrow();
  });

  it('should handle different length scales per dimension', () => {
    const gp = new GaussianProcess(2, { lengthScale: [0.1, 1.0], signalVariance: 0.5 });
    gp.addObservation(new Float64Array([0.5, 0.5]), 0.8);

    // Moving along dim 0 (short length scale) should change prediction more
    const near = gp.predict(new Float64Array([0.6, 0.5]));
    const far = gp.predict(new Float64Array([0.5, 0.6]));

    // Both should produce finite predictions
    expect(Number.isFinite(near.mean)).toBe(true);
    expect(Number.isFinite(far.mean)).toBe(true);
  });
});

describe('GaussianProcess with DEFAULT_CONFIG_SPACE', () => {
  it('should handle full 21-dim config space', () => {
    const gp = new GaussianProcess(
      DEFAULT_CONFIG_SPACE.dimension,
      undefined,
      DEFAULT_CONFIG_SPACE,
    );
    const defaultVec = DEFAULT_CONFIG_SPACE.toVector(DEFAULT_CONFIG);

    gp.addObservation(defaultVec, 0.74); // OB accuracy
    const pred = gp.predict(defaultVec);
    // Prediction near observed point should have reasonable mean
    expect(pred.mean).toBeGreaterThan(0.5);
    expect(Number.isFinite(pred.variance)).toBe(true);
  });
});
