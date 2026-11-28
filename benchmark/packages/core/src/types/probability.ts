/**
 * Probability and statistics types for kinetic theory computations.
 *
 * @module types/probability
 */

/** A probability distribution descriptor. */
export interface ProbabilityDistribution {
  /** Distribution family */
  readonly family: 'normal' | 'exponential' | 'poisson' | 'empirical' | 'kernel-density';
  /** Parameters (family-dependent) */
  readonly parameters: Readonly<Record<string, number>>;
}

/** Confidence interval for a point estimate. */
export interface ConfidenceInterval {
  /** Point estimate (e.g., mean) */
  readonly estimate: number;
  /** Lower bound */
  readonly lower: number;
  /** Upper bound */
  readonly upper: number;
  /** Confidence level (e.g., 0.95) */
  readonly confidenceLevel: number;
}

/** Result of a statistical hypothesis test. */
export interface HypothesisTestResult {
  /** Test statistic name (e.g., "chi-squared", "Kolmogorov-Smirnov") */
  readonly testName: string;
  /** Computed test statistic value */
  readonly statistic: number;
  /** p-value */
  readonly pValue: number;
  /** Whether the null hypothesis is rejected at α level */
  readonly rejected: boolean;
  /** Significance level α */
  readonly significanceLevel: number;
}

/** Result of a linear regression. */
export interface LinearRegressionResult {
  /** Slope (β₁) */
  readonly slope: number;
  /** Intercept (β₀) */
  readonly intercept: number;
  /** R² goodness of fit */
  readonly rSquared: number;
  /** Standard error of the estimate */
  readonly standardError: number;
  /** p-value for slope significance */
  readonly pValue: number;
}
