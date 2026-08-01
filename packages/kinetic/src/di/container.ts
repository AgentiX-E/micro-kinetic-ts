/**
 * Global DI Container — assembles all sub-package implementations.
 *
 * This is the central assembly point for the AIOps-Kinetic framework.
 * It registers all engine implementations from the sub-packages into
 * the AgentiX-E DI container, wiring up cross-package dependencies.
 *
 * === Deng Yu Kinetic Theory Mapping ===
 *
 * The DI wiring assembles the complete kinetic theory pipeline:
 *   Collision Tree → Cutting Algorithm → Stosszahlansatz →
 *   BBGKY Hierarchy → Boltzmann-Grad Limit → Wave Kinetics
 *
 * === Registration Layout ===
 *
 *   Math Backends:
 *     MATRIX_OPS           → NumpyTsMatrixOps (numpy-ts)
 *     LINEAR_ALGEBRA        → UbiqueLinearAlgebra (ubique/WASM)
 *     STATISTICS            → StatisticsProvider (simple-statistics)
 *     ARBITRARY_PRECISION   → DecimalProvider (decimal.js)
 *
 *   Engines:
 *     RCA_ENGINE            → TreePruner (collision tree pruning)
 *     ROOT_CAUSE_RANKER     → TreeRCAEngine (tree-based ranking)
 *     CUTTING_ENGINE        → AdaptiveWindowCutter (chronic fault)
 *     CONVERGENCE_PROVER    → InductionProver (inductive proof)
 *     DENOISE_ENGINE        → StossDenoiser (coupling sparsity)
 *     INDEPENDENCE_CHECKER  → IndependenceChecker (statistical test)
 *     SCALING_ANALYZER      → BoltzmannGradAnalyzer (fault prob.)
 *     HIERARCHY_TRUNCATOR   → HierarchyTruncator (BBGKY cutoff)
 *     WAVE_PROPAGATION      → WaveCascadeModel (WKE simulator)
 *     CASCADE_SIMULATOR     → PropagationSimulator (MC ensemble)
 *     CORRELATION_DECAY     → CorrelationDecay (spectral gap)
 *
 * @module di/container
 */

import {
  Container,
  DI_TOKENS,
  type IContainer,
  invariant,
} from '@agentix-e/micro-kinetic-core';

// ── Tree package (collision tree RCA) ─────────────────────
import { NumpyTsMatrixOps } from '@agentix-e/micro-kinetic-tree';
import { UbiqueLinearAlgebra } from '@agentix-e/micro-kinetic-tree';
import { TreePruner } from '@agentix-e/micro-kinetic-tree';
import { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';

// ── Cutting package (chronic fault detection) ─────────────
import { AdaptiveWindowCutter } from '@agentix-e/micro-kinetic-cutting';
import { InductionProver } from '@agentix-e/micro-kinetic-cutting';

// ── Noise package (Stosszahlansatz denoising) ─────────────
import { StossDenoiser } from '@agentix-e/micro-kinetic-noise';
import { IndependenceChecker } from '@agentix-e/micro-kinetic-noise';
import { DecimalProvider } from '@agentix-e/micro-kinetic-noise';
import { StatisticsProvider } from '@agentix-e/micro-kinetic-noise';
import { CouplingSparsityAnalyzer } from '@agentix-e/micro-kinetic-noise';

// ── Scaling package (BBGKY + Boltzmann-Grad) ─────────────
import { HierarchyTruncator } from '@agentix-e/micro-kinetic-scaling';
import { BoltzmannGradAnalyzer } from '@agentix-e/micro-kinetic-scaling';
import { HierarchyBuilder } from '@agentix-e/micro-kinetic-scaling';

// ── Wave package (cascade propagation) ────────────────────
import { WaveCascadeModel } from '@agentix-e/micro-kinetic-wave';
import { PropagationSimulator } from '@agentix-e/micro-kinetic-wave';
import { CorrelationDecay } from '@agentix-e/micro-kinetic-wave';

// ── Defaults ──────────────────────────────────────────────
import { DEFAULTS } from './defaults.js';

/**
 * Create the default DI container with all engine implementations
 * registered and cross-package dependencies wired up.
 *
 * This is the one-shot function that assembles the complete
 * AIOps-Kinetic runtime. After calling this function, all
 * engines are available for resolution via their DI tokens.
 *
 * @returns Fully assembled DI container
 *
 * @example
 * ```typescript
 * import { createDefaultContainer } from '@agentix-e/micro-kinetic';
 * import { DI_TOKENS } from '@agentix-e/micro-kinetic-core';
 *
 * const container = createDefaultContainer();
 * const rcaEngine = container.resolve(DI_TOKENS.RCA_ENGINE);
 * ```
 */
export function createDefaultContainer(): IContainer {
  const container = new Container();

  // ── Step 1: Math backends (leaf dependencies, no dependencies) ──

  // NumpyTsMatrixOps — collision cross-section spectral analysis
  container.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());

  // UbiqueLinearAlgebra — Boltzmann equation solver
  container.register(DI_TOKENS.LINEAR_ALGEBRA, () => new UbiqueLinearAlgebra());

  // StatisticsProvider — statistical computations (independence tests, MI, regression)
  container.register(DI_TOKENS.STATISTICS, () => new StatisticsProvider());

  // DecimalProvider — arbitrary precision for decomposition error computation
  container.register(DI_TOKENS.ARBITRARY_PRECISION, () => new DecimalProvider());

  // ── Step 2: Engine components (may depend on math backends) ──

  // RCA Engine — collision tree pruning for root cause analysis
  container.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());

  // Root Cause Ranker — tree-based bottom-up score accumulation
  container.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());

  // Cutting Engine — adaptive window cutter for chronic fault detection
  container.register(DI_TOKENS.CUTTING_ENGINE, () => new AdaptiveWindowCutter());

  // Convergence Prover — inductive proof of global convergence
  container.register(DI_TOKENS.CONVERGENCE_PROVER, () => new InductionProver());

  // Independence Checker — Stosszahlansatz independence test (depends on STATISTICS)
  container.register(
    DI_TOKENS.INDEPENDENCE_CHECKER,
    (c) => new IndependenceChecker(
      c.resolve<StatisticsProvider>(DI_TOKENS.STATISTICS),
    ),
  );

  // Denoise Engine — coupling sparsity-based alert denoising
  // (depends on IndependenceChecker and CouplingSparsityAnalyzer)
  container.register(
    DI_TOKENS.DENOISE_ENGINE,
    (c) => {
      const couplingAnalyzer = new CouplingSparsityAnalyzer(
        c.resolve<StatisticsProvider>(DI_TOKENS.STATISTICS),
      );
      return new StossDenoiser(
        couplingAnalyzer,
        c.resolve<IndependenceChecker>(DI_TOKENS.INDEPENDENCE_CHECKER),
      );
    },
  );

  // Hierarchy Truncator — BBGKY truncation order finder
  container.register(DI_TOKENS.HIERARCHY_TRUNCATOR, () => new HierarchyTruncator());

  // Scaling Analyzer — BBGKY + Boltzmann-Grad fault probability
  // (depends on HierarchyBuilder and HierarchyTruncator)
  container.register(
    DI_TOKENS.SCALING_ANALYZER,
    (c) => {
      const hierarchyBuilder = new HierarchyBuilder();
      return new BoltzmannGradAnalyzer(
        hierarchyBuilder,
        c.resolve<HierarchyTruncator>(DI_TOKENS.HIERARCHY_TRUNCATOR),
      );
    },
  );

  // Wave Propagation Model — discretized WKE cascade simulator
  container.register(DI_TOKENS.WAVE_PROPAGATION_MODEL, () => new WaveCascadeModel());

  // Cascade Simulator — Monte Carlo ensemble propagation
  // (depends on WaveCascadeModel)
  container.register(
    DI_TOKENS.CASCADE_SIMULATOR,
    (c) => new PropagationSimulator(
      c.resolve<WaveCascadeModel>(DI_TOKENS.WAVE_PROPAGATION_MODEL),
    ),
  );

  // Correlation Decay Estimator — spectral gap-based decay curve
  container.register(DI_TOKENS.CORRELATION_DECAY_ESTIMATOR, () => new CorrelationDecay());

  // ── Step 3: Internal helpers (not exposed via DI_TOKENS) ──

  // CouplingSparsityAnalyzer — coupling matrix builder (internal dependency)
  container.register(
    Symbol.for('micro-kinetic:CouplingSparsityAnalyzer'),
    (c) => new CouplingSparsityAnalyzer(
      c.resolve<StatisticsProvider>(DI_TOKENS.STATISTICS),
    ),
  );

  // HierarchyBuilder — BBGKY hierarchy builder (internal dependency)
  container.register(
    Symbol.for('micro-kinetic:HierarchyBuilder'),
    () => new HierarchyBuilder(),
  );

  return container;
}
