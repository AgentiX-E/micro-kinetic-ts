/**
 * @agentix-e/micro-kinetic-wave
 *
 * Wave kinetic equation-based alert cascade propagation package.
 *
 * Applies Deng Yu's wave turbulence theory to AIOps alert propagation:
 * - Discretized WKE for simulating alert intensity cascades
 * - Monte Carlo ensemble simulation for statistical analysis
 * - Correlation decay estimation from graph spectral properties
 * - Threshold estimation for cascade initiation/propagation/extinction
 *
 * ## Deng Yu's Theorems Applied
 *
 * 1. **Wave Kinetic Equation (WKE)**
 *    ∂_t n(k) = ∫ T(k,k₁,k₂)[n₁n₂ - n_k(n₁+n₂)] dk₁dk₂
 *    Describes the statistical energy cascade in wave systems.
 *    In AIOps: how alert "energy" propagates through services.
 *
 * 2. **Correlation Decay Theorem**
 *    C(t) = C₀ × exp(-t/τ) where τ = 1/spectralGap
 *    The spectral gap determines how fast the system decorrelates.
 *
 * 3. **Threshold Analysis**
 *    Critical coupling and intensity thresholds determine whether
 *    a localized alert becomes a system-wide cascade wave.
 *
 * ## Components
 * - **WaveCascadeModel**: WKE-based cascade simulation
 * - **PropagationSimulator**: Monte Carlo ensemble simulator
 * - **CorrelationDecay**: Exponential decay curve estimation
 * - **ThresholdEstimator**: Generation/propagation/extinction thresholds
 *
 * @packageDocumentation
 */

// ── Cascade Components ────────────────────────────────────
export { WaveCascadeModel } from './cascade/cascade-model.js';
export { PropagationSimulator } from './cascade/propagation-simulator.js';
export { ThresholdEstimator } from './cascade/threshold-estimator.js';
export type { WaveThresholds } from './cascade/threshold-estimator.js';

// ── Correlation Decay ─────────────────────────────────────
export { CorrelationDecay } from './correlation-decay.js';

// ── DI ───────────────────────────────────────────────────
export { registerWaveFactories } from './di/factories.js';
