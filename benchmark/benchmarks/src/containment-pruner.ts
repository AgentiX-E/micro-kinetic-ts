/**
 * The QUIET engine: the same pruner with both relational passes off, used to recover the FUSION order.
 *
 * ## Why a second engine exists at all
 *
 * `TreePruner.analyze` runs two passes over the fusion's order before it returns — the containment order and the
 * failure-flow order — so the ranking a run publishes is two transformations past the order the sweep was given.
 * H2's population is the adjacent pairs of the order the FUSION produced, and observing the sweep from the
 * published ranking would describe a different population: on a case the flow pass reordered, a different set of
 * adjacencies altogether.
 *
 * The two switches are set through the same MAPPING the run uses rather than in a hand-written literal at the call
 * site. That is not tidiness: `packages/kinetic/__tests__/unit/construction-site-census.test.ts` classifies every
 * `new TreePruner(` in the repository, an authored literal is the shape that produced three consecutive
 * iterations' defects, and a construction the census cannot attribute is refused by name. Here the literal lives in
 * a function whose whole subject is the two flags it changes.
 *
 * ## What it does not change
 *
 * Nothing else. The signals, the weights, the profile, the topology config and the attribution are the run's own;
 * a case swept by this engine and by the shipped one differs only in whether the two relational passes have run,
 * which is exactly the difference the observation needs to be a measurement of the sweep.
 *
 * @module benchmarks/containment-pruner
 */

import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';

import type { Fse26EngineOptions } from './fse26-engine-options.js';

/**
 * The same configuration with both relational passes switched off.
 *
 * @param options - The run's engine options.
 * @returns A copy whose `signals` disable {@link TreePruner} containment and failure containment.
 */
export function quietEngineOptions(options: Fse26EngineOptions): Fse26EngineOptions {
  return {
    signals: {
      ...options.signals,
      containmentOrder: false,
      failureContainment: false,
    },
    topology: options.topology,
  };
}

/**
 * Build the pruner that publishes the FUSION order.
 *
 * Two arguments from one mapping, which is the only shape the construction census can attribute.
 *
 * @param options - The run's engine options.
 * @returns An engine whose `analyze` returns the fusion's order, unmodified by either relational pass.
 */
export function buildContainmentPruner(options: Fse26EngineOptions): TreePruner {
  return new TreePruner(options.signals, options.topology);
}
