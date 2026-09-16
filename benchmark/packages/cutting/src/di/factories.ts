/**
 * DI Factory registrations for the cutting package.
 *
 * Registers the cutting engine and convergence prover implementations
 * into the AgentiX-E DI container, following the factory pattern
 * defined in the core package.
 *
 * ## Registration Pattern
 *
 * Each factory function receives the DI container and returns an
 * instance. This follows the AgentiX-E pattern:
 *
 *   ```typescript
 *   container.register(DI_TOKENS.CUTTING_ENGINE, createCuttingEngine);
 *   container.register(DI_TOKENS.CONVERGENCE_PROVER, createConvergenceProver);
 *   ```
 *
 * ## Usage
 *
 * ```typescript
 * import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
 * import { registerCuttingFactories } from '@agentix-e/micro-kinetic-cutting';
 *
 * const container = new Container();
 * registerCuttingFactories(container);
 *
 * const cutter = container.resolve(DI_TOKENS.CUTTING_ENGINE);
 * ```
 *
 * @module di/factories
 */

import type { IContainer } from '@agentix-e/micro-kinetic-core';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';

import { InductionProver } from '../convergence/induction-prover.js';
import { AdaptiveWindowCutter } from '../segmentation/adaptive-cutter.js';

/**
 * Context for cutting factory registration.
 * Allows passing configuration options at registration time.
 */
export interface CuttingFactoryContext {
  /** Factory for the cutting engine (defaults to AdaptiveWindowCutter) */
  cuttingEngineFactory?: (container: IContainer) => AdaptiveWindowCutter;
  /** Factory for the convergence prover */
  convergenceProverFactory?: (container: IContainer) => InductionProver;
}

/**
 * Register all cutting-related factories into the DI container.
 *
 * Registers:
 *   - DI_TOKENS.CUTTING_ENGINE → AdaptiveWindowCutter
 *   - DI_TOKENS.CONVERGENCE_PROVER → InductionProver
 *
 * @param container - The DI container instance
 * @param context - Optional factory context for customization
 */
export function registerCuttingFactories(
  container: IContainer,
  context?: CuttingFactoryContext,
): void {
  // Register cutting engine (adaptive window cutter)
  const cuttingFactory =
    context?.cuttingEngineFactory ?? ((c: IContainer) => new AdaptiveWindowCutter(c));

  if (!container.has(DI_TOKENS.CUTTING_ENGINE)) {
    container.register(DI_TOKENS.CUTTING_ENGINE, cuttingFactory);
  }

  // Register convergence prover (induction-based)
  const proverFactory =
    context?.convergenceProverFactory ?? ((c: IContainer) => new InductionProver(c));

  if (!container.has(DI_TOKENS.CONVERGENCE_PROVER)) {
    container.register(DI_TOKENS.CONVERGENCE_PROVER, proverFactory);
  }
}
