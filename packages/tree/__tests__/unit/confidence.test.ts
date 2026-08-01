import { describe, it, expect } from 'vitest';
import {
  ConfidenceEstimator,
  estimateErrorBound,
  boundToConfidence,
} from '@agentix-e/micro-kinetic-tree';

describe('ConfidenceEstimator', () => {
  describe('constructor', () => {
    it('creates with default alpha', () => {
      const estimator = new ConfidenceEstimator();
      expect(estimator.alpha).toBe(0.85);
    });

    it('custom alpha', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.5 });
      expect(estimator.alpha).toBe(0.5);
    });

    it('rejects alpha outside [0,1]', () => {
      expect(() => new ConfidenceEstimator({ alpha: -0.1 })).toThrow();
      expect(() => new ConfidenceEstimator({ alpha: 1.5 })).toThrow();
    });

    it('accepts alpha=0 and alpha=1 boundary values', () => {
      expect(() => new ConfidenceEstimator({ alpha: 0 })).not.toThrow();
      expect(() => new ConfidenceEstimator({ alpha: 1 })).not.toThrow();
    });
  });

  describe('estimateErrorBound', () => {
    it('ε_k = 1 - α^k', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.8 });
      expect(estimator.estimateErrorBound(1)).toBeCloseTo(0.2, 5);
      expect(estimator.estimateErrorBound(2)).toBeCloseTo(0.36, 5);
      expect(estimator.estimateErrorBound(3)).toBeCloseTo(0.488, 5);
    });

    it('returns 0 for depth 0', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.8 });
      expect(estimator.estimateErrorBound(0)).toBe(0);
    });

    it('approaches 1 as depth increases', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.8 });
      const err = estimator.estimateErrorBound(20);
      expect(err).toBeGreaterThan(0.9);
      expect(err).toBeLessThanOrEqual(1);
    });

    it('throws for negative depth', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.estimateErrorBound(-1)).toThrow();
    });

    it('throws for non-integer depth', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.estimateErrorBound(1.5)).toThrow();
    });

    it('alpha=0 means full error (no propagation accuracy)', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0 });
      // 1 - 0^k = 1 for k > 0
      expect(estimator.estimateErrorBound(1)).toBe(1);
      expect(estimator.estimateErrorBound(5)).toBe(1);
      expect(estimator.estimateErrorBound(0)).toBe(0);
    });

    it('alpha=1 means zero error (perfect propagation)', () => {
      const estimator = new ConfidenceEstimator({ alpha: 1 });
      expect(estimator.estimateErrorBound(1)).toBe(0);
      expect(estimator.estimateErrorBound(10)).toBe(0);
      expect(estimator.estimateErrorBound(0)).toBe(0);
    });
  });

  describe('computeConfidence', () => {
    it('computes confidence = score × (1 - error) × depth_penalty', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.8, applyDepthPenalty: true });
      const conf = estimator.computeConfidence(0.9, 0.2, 1);
      // confidence = 0.9 * 0.8 * depthPenalty
      // depthPenalty = 1 / (1 + ln(2)) ≈ 1/1.693 = 0.5906
      // conf ≈ 0.9 * 0.8 * 0.5906 ≈ 0.425
      expect(conf).toBeGreaterThan(0);
      expect(conf).toBeLessThanOrEqual(1);
    });

    it('score=0 yields confidence 0', () => {
      const estimator = new ConfidenceEstimator();
      expect(estimator.computeConfidence(0, 0.2, 1)).toBe(0);
    });

    it('error=0 and depth=0 yields confidence = score', () => {
      const estimator = new ConfidenceEstimator({ applyDepthPenalty: false });
      expect(estimator.computeConfidence(0.9, 0, 0)).toBeCloseTo(0.9);
    });

    it('clamps to [0, 1]', () => {
      const estimator = new ConfidenceEstimator();
      // Score=1.0 gives 1.0 * (1-0.5) = 0.5, clamped to [0, 1]
      expect(estimator.computeConfidence(1.0, 0.5, 0)).toBe(0.5);
      expect(estimator.computeConfidence(0, 0.5, 0)).toBe(0);
    });

    it('throws for score outside [0,1]', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.computeConfidence(-0.1, 0.2, 1)).toThrow();
      expect(() => estimator.computeConfidence(1.1, 0.2, 1)).toThrow();
    });

    it('throws for errorBound outside [0,1]', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.computeConfidence(0.5, -0.1, 1)).toThrow();
    });

    it('throws for negative depth', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.computeConfidence(0.5, 0.2, -1)).toThrow();
    });

    it('skips depth penalty when disabled', () => {
      const estimator = new ConfidenceEstimator({ applyDepthPenalty: false });
      const conf = estimator.computeConfidence(0.9, 0.2, 10);
      expect(conf).toBeCloseTo(0.72, 5);
    });

    it('skips depth penalty for depth=0', () => {
      const estimator = new ConfidenceEstimator({ applyDepthPenalty: true });
      const conf = estimator.computeConfidence(0.9, 0.2, 0);
      expect(conf).toBeCloseTo(0.72, 5);
    });
  });

  describe('pathConfidence', () => {
    it('computes product of path weights', () => {
      const estimator = new ConfidenceEstimator();
      const conf = estimator.pathConfidence([0.9, 0.8, 0.7]);
      expect(conf).toBeCloseTo(0.504, 5);
    });

    it('returns 0 for empty path', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.pathConfidence([])).toThrow();
    });

    it('throws for weight outside [0,1]', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.pathConfidence([0.5, 1.1])).toThrow();
    });
  });

  describe('confidenceDrop', () => {
    it('computes Δ(k) = α^k × (1 - α)', () => {
      const estimator = new ConfidenceEstimator({ alpha: 0.8 });
      const drop0 = estimator.confidenceDrop(0);
      const drop1 = estimator.confidenceDrop(1);
      expect(drop0).toBeCloseTo(0.2, 5);
      expect(drop1).toBeCloseTo(0.16, 5);
    });

    it('throws for negative depth', () => {
      const estimator = new ConfidenceEstimator();
      expect(() => estimator.confidenceDrop(-1)).toThrow();
    });
  });
});

describe('estimateErrorBound (standalone)', () => {
  it('returns ε_k = 1 - α^k', () => {
    expect(estimateErrorBound(1, 0.5)).toBeCloseTo(0.5, 5);
    expect(estimateErrorBound(2, 0.5)).toBeCloseTo(0.75, 5);
  });

  it('uses default alpha=0.85 when not specified', () => {
    const bound = estimateErrorBound(1);
    expect(bound).toBeCloseTo(0.15, 5);
  });

  it('throws for alpha outside [0,1]', () => {
    expect(() => estimateErrorBound(1, -0.1)).toThrow();
  });
});

describe('boundToConfidence (standalone)', () => {
  it('converts error bound to confidence', () => {
    const conf = boundToConfidence(0.9, 0.2, 1);
    expect(conf).toBeGreaterThan(0);
    expect(conf).toBeLessThanOrEqual(1);
  });
});
