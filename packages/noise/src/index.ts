/**
 * @agentix-e/micro-kinetic-noise
 *
 * Stosszahlansatz-based alert denoising package.
 *
 * Applies Deng Yu's rigorous proof of the Stosszahlansatz
 * (Molecular Chaos Hypothesis) to AIOps alert noise reduction.
 *
 * ## Deng Yu's Theorem
 * In a large system with sparse coupling, most alert pairs
 * are statistically independent. The joint distribution
 * factorizes with error bounded by K/N → 0 as N → ∞.
 *
 * This provides a mathematically-justified threshold for
 * suppressing coincidental (non-causal) alerts.
 *
 * ## Components
 * - **CouplingSparsityAnalyzer**: Builds the N×N coupling matrix
 *   from mutual information between alert time series
 * - **IndependenceChecker**: Tests Stosszahlansatz independence
 *   using decomposition error and Hoeffding's D
 * - **StossDenoiser**: Classifies alerts as true, coincidental,
 *   or grouped alarms based on coupling sparsity
 * - **DecimalProvider**: Arbitrary precision math for MI computation
 * - **StatisticsProvider**: Statistical operations via simple-statistics
 *
 * @packageDocumentation
 */

// ── Math Providers ────────────────────────────────────────
export { DecimalProvider } from './math/decimal-provider.js';
export { StatisticsProvider } from './math/statistics-provider.js';

// ── Stosszahlansatz Components ────────────────────────────
export { CouplingSparsityAnalyzer } from './stoss/coupling-analyzer.js';
export { StossDenoiser } from './stoss/denoiser.js';
export { IndependenceChecker } from './stoss/independence-checker.js';

// ── DI ───────────────────────────────────────────────────
export { registerNoiseFactories } from './di/factories.js';
