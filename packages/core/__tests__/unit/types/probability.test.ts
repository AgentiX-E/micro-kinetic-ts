import { describe, it, expect } from 'vitest';
import type {
  ProbabilityDistribution,
  ConfidenceInterval,
  HypothesisTestResult,
  LinearRegressionResult,
} from '@agentix-e/micro-kinetic-core';

describe('Probability types - ProbabilityDistribution', () => {
  it('should accept a normal distribution', () => {
    const dist: ProbabilityDistribution = {
      family: 'normal',
      parameters: { mean: 0, stddev: 1 },
    };
    expect(dist.family).toBe('normal');
    expect(dist.parameters.mean).toBe(0);
  });

  it('should accept an exponential distribution', () => {
    const dist: ProbabilityDistribution = {
      family: 'exponential',
      parameters: { rate: 0.5 },
    };
    expect(dist.family).toBe('exponential');
  });

  it('should accept a poisson distribution', () => {
    const dist: ProbabilityDistribution = {
      family: 'poisson',
      parameters: { lambda: 3 },
    };
    expect(dist.family).toBe('poisson');
  });

  it('should accept an empirical distribution', () => {
    const dist: ProbabilityDistribution = {
      family: 'empirical',
      parameters: { count: 100 },
    };
    expect(dist.family).toBe('empirical');
  });

  it('should accept a kernel-density distribution', () => {
    const dist: ProbabilityDistribution = {
      family: 'kernel-density',
      parameters: { bandwidth: 0.1 },
    };
    expect(dist.family).toBe('kernel-density');
  });
});

describe('Probability types - ConfidenceInterval', () => {
  it('should accept a 95% confidence interval', () => {
    const ci: ConfidenceInterval = {
      estimate: 10,
      lower: 8,
      upper: 12,
      confidenceLevel: 0.95,
    };
    expect(ci.estimate).toBe(10);
    expect(ci.lower).toBeLessThan(ci.upper);
  });

  it('should accept a 99% confidence interval', () => {
    const ci: ConfidenceInterval = {
      estimate: 50,
      lower: 45,
      upper: 55,
      confidenceLevel: 0.99,
    };
    expect(ci.confidenceLevel).toBe(0.99);
  });
});

describe('Probability types - HypothesisTestResult', () => {
  it('should accept a rejected hypothesis', () => {
    const result: HypothesisTestResult = {
      testName: 'chi-squared',
      statistic: 12.5,
      pValue: 0.001,
      rejected: true,
      significanceLevel: 0.05,
    };
    expect(result.rejected).toBe(true);
    expect(result.pValue).toBeLessThan(result.significanceLevel);
  });

  it('should accept a non-rejected hypothesis', () => {
    const result: HypothesisTestResult = {
      testName: 'Kolmogorov-Smirnov',
      statistic: 0.1,
      pValue: 0.3,
      rejected: false,
      significanceLevel: 0.05,
    };
    expect(result.rejected).toBe(false);
  });
});

describe('Probability types - LinearRegressionResult', () => {
  it('should accept a valid LinearRegressionResult', () => {
    const result: LinearRegressionResult = {
      slope: 2.5,
      intercept: 1.0,
      rSquared: 0.95,
      standardError: 0.1,
      pValue: 0.001,
    };
    expect(result.slope).toBe(2.5);
    expect(result.rSquared).toBe(0.95);
  });

  it('should accept result with poor fit', () => {
    const result: LinearRegressionResult = {
      slope: 0.01,
      intercept: 5,
      rSquared: 0.1,
      standardError: 2.0,
      pValue: 0.8,
    };
    expect(result.rSquared).toBe(0.1);
    expect(result.pValue).toBeGreaterThan(0.05);
  });
});
