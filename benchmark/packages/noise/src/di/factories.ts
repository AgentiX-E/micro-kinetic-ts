/**
 * Dependency Injection factories for the noise (denoising) package.
 *
 * Registers Stosszahlansatz-based denoising components
 * in the DI container using the core token registry.
 *
 * @module noise/di/factories
 */

import type { IContainer } from '@agentix-e/micro-kinetic-core';
import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import { DecimalProvider } from '../math/decimal-provider.js';
import { StatisticsProvider } from '../math/statistics-provider.js';
import { CouplingSparsityAnalyzer } from '../stoss/coupling-analyzer.js';
import { StossDenoiser } from '../stoss/denoiser.js';
import { IndependenceChecker } from '../stoss/independence-checker.js';

/**
 * Register all noise package components in the DI container.
 *
 * @param container - The DI container to register with
 */
export function registerNoiseFactories(container: IContainer): void {
  // ── Math Providers ────────────────────────────────────
  container.register(DI_TOKENS.ARBITRARY_PRECISION, () => new DecimalProvider());
  container.register(DI_TOKENS.STATISTICS, () => new StatisticsProvider());

  // ── Stosszahlansatz Components ────────────────────────
  container.register(
    DI_TOKENS.DENOISE_ENGINE,
    (c) =>
      new StossDenoiser(
        c.resolve<CouplingSparsityAnalyzer>(Symbol.for('micro-kinetic:CouplingSparsityAnalyzer')),
        c.resolve<IndependenceChecker>(DI_TOKENS.INDEPENDENCE_CHECKER),
      ),
  );

  container.register(
    DI_TOKENS.INDEPENDENCE_CHECKER,
    (c) => new IndependenceChecker(c.resolve<StatisticsProvider>(DI_TOKENS.STATISTICS)),
  );

  // Register the coupling analyzer as a named component
  container.register(
    Symbol.for('micro-kinetic:CouplingSparsityAnalyzer'),
    (c) => new CouplingSparsityAnalyzer(c.resolve<StatisticsProvider>(DI_TOKENS.STATISTICS)),
  );
}
