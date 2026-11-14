/**
 * How much of a corpus can state the level test's precondition at all.
 *
 * ## Why this exists
 *
 * `docs/transient-guard-test.md` records three refused arms on one axis, and every one of them was read
 * by comparing two whole-corpus rates. That is enough to REFUSE an arm and it is not enough to READ one:
 * `levelPermanence` returns `undefined` whenever the injection boundary cannot be placed, and its caller
 * then falls back to the shipped endpoint statistic — so **two configurations that differ only in
 * `transientGuardTest` are byte-identical on every such case**. A population where that fallback covers
 * the whole corpus produces an arm that measures zero, and a zero of that shape is indistinguishable from
 * "the level test agreed with the endpoint test on everything", which is a very different statement.
 *
 * The immediate case was the FSE'26 half, whose census row declared the whole axis unreachable with the
 * justification *"that corpus carries no injection boundary in the units this test splits on"* — a corpus
 * fact asserted in a comment and never measured, while the loader rebuilds every series' timestamps and
 * forwards the case's own `injectTimeMs`, which are exactly the statistic's two inputs. This module exists
 * so the answer is printed by the run that needs it, on whichever corpus it runs, instead of being
 * re-asserted.
 *
 * ## What it counts
 *
 * Per case, a boundary is PLACEABLE when any channel the engine would read can be split: the case knows
 * its injection time, at least one series carries timestamps aligned with its samples, and both sides of
 * the boundary hold the three-sample floor. The three refusals live in {@link injectionSplitIndex} — the
 * estimator's own precondition, imported rather than retyped, because a census with its own copy of a
 * threshold answers a slightly different question than the estimator it claims to describe.
 *
 * The runner hands this module a COMPACT projection per case rather than the cases themselves, on the
 * rule `summariseFailedEdgeCoverage` in the same file records: a case's series are large and are released
 * after scoring, so anything retained past the loop has to be a projection of the two facts it needs.
 *
 * @module benchmarks/fse26-boundary-census
 */

import type { MetricMap } from '@agentix-e/micro-kinetic-core';
import { injectionSplitIndex } from '../../packages/tree/src/index.js';

/**
 * The two facts the summary needs about one case.
 *
 * `injectTime > 0` is stated separately from `placeable` because the two failures are not the same
 * question: a corpus can know every injection time and still place none (series with no timestamps), and
 * a reader of a zero needs to tell that apart from a corpus that knows no injection times at all.
 */
export interface BoundaryObservation {
  /** The case's injection time in epoch milliseconds (`0` = unknown). */
  readonly injectTime: number;
  /** Whether any channel can be split at that boundary. */
  readonly placeable: boolean;
}

/** What a corpus can say about the level test, counted over its cases. */
export interface BoundaryCensus {
  /** Cases examined. */
  readonly cases: number;
  /** Cases whose injection time is known (`> 0`). */
  readonly withInjectionTime: number;
  /** Cases where at least one channel can be split at that boundary. */
  readonly placeable: number;
  /** Cases that know an injection time but whose channels still cannot be split. */
  readonly injectionTimeButNoSplit: number;
}

/**
 * Whether any channel in a case can be split at its injection boundary.
 *
 * @param metrics - The case's metric map, keyed by service then by label.
 * @param injectTimeMs - The case's injection time in epoch milliseconds (`0` = unknown).
 * @returns `true` when at least one series passes {@link injectionSplitIndex}.
 */
export function boundaryPlaceable(metrics: MetricMap, injectTimeMs: number): boolean {
  if (!(injectTimeMs > 0)) return false;
  for (const series of metrics.values()) {
    for (const channel of series) {
      if (
        injectionSplitIndex(channel.timestamps, channel.values.length, injectTimeMs) !== undefined
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Count a corpus's cases by what they can say about the level test.
 *
 * @param observations - One projection per case, in load order.
 * @returns The totals, with zeroes for an empty corpus.
 */
export function summariseBoundaryCensus(
  observations: readonly BoundaryObservation[],
): BoundaryCensus {
  let withInjectionTime = 0;
  let placeable = 0;
  let injectionTimeButNoSplit = 0;
  for (const observation of observations) {
    if (observation.injectTime > 0) withInjectionTime++;
    if (observation.placeable) placeable++;
    else if (observation.injectTime > 0) injectionTimeButNoSplit++;
  }
  return { cases: observations.length, withInjectionTime, placeable, injectionTimeButNoSplit };
}

/**
 * Render the census as one line, in the runner's own census idiom.
 *
 * Names all four counts rather than a ratio: the whole point is to separate the two ways a case can fail
 * to be placeable, and a percentage collapses them.
 *
 * @param census - The counted totals.
 * @returns A single line, without a trailing newline.
 */
export function formatBoundaryCensus(census: BoundaryCensus): string {
  return (
    `[guard] boundary placeable=${census.placeable}/${census.cases} ` +
    `injectTime=${census.withInjectionTime} noSplit=${census.injectionTimeButNoSplit}`
  );
}
