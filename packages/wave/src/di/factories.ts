/**
 * Dependency Injection factories for the wave (propagation) package.
 *
 * Registers wave kinetic equation-based cascade propagation
 * components in the DI container.
 *
 * @module wave/di/factories
 */

import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import type { IContainer } from '@agentix-e/micro-kinetic-core';
import { WaveCascadeModel } from '../cascade/cascade-model.js';
import { PropagationSimulator } from '../cascade/propagation-simulator.js';
import { ThresholdEstimator } from '../cascade/threshold-estimator.js';
import { CorrelationDecay } from '../correlation-decay.js';

/**
 * Register all wave package components in the DI container.
 *
 * @param container - The DI container to register with
 */
export function registerWaveFactories(container: IContainer): void {
  // ── Cascade Components ────────────────────────────────
  container.register(
    DI_TOKENS.WAVE_PROPAGATION_MODEL,
    () => new WaveCascadeModel(),
  );

  container.register(
    DI_TOKENS.CASCADE_SIMULATOR,
    (c) => new PropagationSimulator(
      c.resolve<WaveCascadeModel>(DI_TOKENS.WAVE_PROPAGATION_MODEL),
    ),
  );

  // ── Correlation Decay ─────────────────────────────────
  container.register(
    DI_TOKENS.CORRELATION_DECAY_ESTIMATOR,
    () => new CorrelationDecay(),
  );

  // ── Threshold Estimation ───────────────────────────────
  container.register(
    Symbol.for('micro-kinetic:ThresholdEstimator'),
    () => new ThresholdEstimator(),
  );
}
