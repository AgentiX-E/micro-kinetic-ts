/**
 * @agentix-e/micro-kinetic-scaling
 *
 * BBGKY hierarchy and Boltzmann-Grad scaling analysis package.
 *
 * Applies Deng Yu's kinetic scaling theory to AIOps service scaling:
 * - BBGKY hierarchy for multi-service fault correlation
 * - Boltzmann-Grad limit for N → ∞ fault probability asymptotics
 *
 * ## Deng Yu's Theorems Applied
 *
 * 1. **BBGKY Truncation Theorem**
 *    Higher-order correlation energies decay exponentially:
 *    E_k / E_{k-1} ∝ (Nd²)^{k-1} / k!
 *    This justifies truncating the hierarchy to manageable order.
 *
 * 2. **Boltzmann-Grad Limit**
 *    As N → ∞, d → 0 with Nd² = constant:
 *    P_fault(N) = P₀ + A/N + B/N² + O(1/N³)
 *    This predicts how fault risk scales with system size.
 *
 * ## Components
 * - **HierarchyBuilder**: Builds k-service correlation tensors
 * - **HierarchyTruncator**: Finds optimal truncation order
 * - **BoltzmannGradAnalyzer**: Full scaling analysis engine
 * - **FaultProbabilityAsymptotics**: P_fault(N) asymptotic estimates
 *
 * @packageDocumentation
 */

// ── BBGKY Components ──────────────────────────────────────
export { HierarchyBuilder } from './bbgky/hierarchy-builder.js';
export { HierarchyTruncator } from './bbgky/truncator.js';

// ── Boltzmann-Grad Components ─────────────────────────────
export { BoltzmannGradAnalyzer } from './boltzmann-grad/scaling-analyzer.js';
export { FaultProbabilityAsymptotics } from './boltzmann-grad/fault-probability.js';
export type { FaultProbabilityEstimate } from './boltzmann-grad/fault-probability.js';

// ── DI ───────────────────────────────────────────────────
export { registerScalingFactories } from './di/factories.js';
