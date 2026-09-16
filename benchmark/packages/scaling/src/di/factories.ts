/**
 * Dependency Injection factories for the scaling package.
 *
 * Registers BBGKY hierarchy and Boltzmann-Grad scaling analysis
 * components in the DI container.
 *
 * @module scaling/di/factories
 */

import type { IContainer } from '@agentix-e/micro-kinetic-core';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { HierarchyBuilder } from '../bbgky/hierarchy-builder.js';
import { HierarchyTruncator } from '../bbgky/truncator.js';
import { FaultProbabilityAsymptotics } from '../boltzmann-grad/fault-probability.js';
import { BoltzmannGradAnalyzer } from '../boltzmann-grad/scaling-analyzer.js';

/**
 * Register all scaling package components in the DI container.
 *
 * @param container - The DI container to register with
 */
export function registerScalingFactories(container: IContainer): void {
  // ── BBGKY Components ──────────────────────────────────
  container.register(Symbol.for('micro-kinetic:HierarchyBuilder'), () => new HierarchyBuilder());

  container.register(DI_TOKENS.HIERARCHY_TRUNCATOR, () => new HierarchyTruncator());

  // ── Boltzmann-Grad Components ─────────────────────────
  container.register(
    DI_TOKENS.SCALING_ANALYZER,
    (c) =>
      new BoltzmannGradAnalyzer(
        c.resolve<HierarchyBuilder>(Symbol.for('micro-kinetic:HierarchyBuilder')),
        c.resolve<HierarchyTruncator>(DI_TOKENS.HIERARCHY_TRUNCATOR),
      ),
  );

  // Register fault probability as a standalone service
  container.register(
    Symbol.for('micro-kinetic:FaultProbabilityAsymptotics'),
    () => new FaultProbabilityAsymptotics(),
  );
}
