/**
 * Build one case's containment-sweep row from the graph the engine built and the order the fusion published.
 *
 * ## Why the fusion order has to be re-derived
 *
 * The sweep's input is the order the FUSION published, and the runner no longer has it: `analyze` runs two
 * relational passes over that order before it returns, so the ranking a run publishes is the output of the
 * containment pass and not its input. Observing the sweep from the published ranking would therefore observe a
 * different population — and on a case the failure-flow pass reordered, a different set of adjacencies
 * altogether.
 *
 * The runner re-derives it with a second pruner that has both passes switched off, and this module takes that
 * order as an argument rather than computing it: a builder that owned the engine call could not be unit-tested
 * without a corpus, and the arithmetic here (two sweeps, one replay, one comparison) is exactly the part that has
 * to be checkable on fixtures.
 *
 * ## Why the replay is recorded rather than asserted
 *
 * The same two passes are applied here, in the same order, to the same input, and the result is compared against
 * the ranking the engine published. Recording the verdict instead of throwing on a mismatch is the difference
 * between an instrument that can be audited and one that can only be trusted: a `differs` count that is not zero
 * says the observation is describing something other than the decision, and a run that had refused to write would
 * leave that fact invisible.
 *
 * @module benchmarks/containment-row-build
 */

import type { ServiceId } from '../../packages/core/src/index.js';

import {
  applyFailureContainment,
  inspectContainmentOrder,
  type ContainmentEdge,
  type ContainmentSweep,
  type FailureAttribution,
} from '../../packages/tree/src/index.js';

import type {
  ContainmentCaseRow,
  ContainmentPairRow,
  ContainmentReplay,
} from './containment-rows.js';

/** Everything the builder reads, all of it already measured by the engine. */
export interface BuildContainmentRowInput {
  /** The case directory's name. */
  readonly datapack: string;
  readonly faultType: string;
  /** Band half-width in robust standard deviations the run measured against. */
  readonly sigma: number;
  /** The margin the run applied, in band widths. */
  readonly margin: number;
  /** The case's directed call edges. */
  readonly edges: readonly ContainmentEdge[];
  /** The per-service excursions, ABSENT when the run had no profile or the case no latency channel. */
  readonly excursions: ReadonlyMap<ServiceId, number> | undefined;
  /** The interfaces that reported more failed calls after the injection, when the case carried any. */
  readonly failedInterfaces: ReadonlyMap<string, number> | undefined;
  /** The flow map the failure-flow pass reads. */
  readonly failureFlows:
    | ReadonlyMap<
        ServiceId,
        {
          readonly knownIn: number;
          readonly knownOut: number;
          readonly novelIn: number;
          readonly novelOut: number;
        }
      >
    | undefined;
  /** The edges that carried a net rise, which the failure-flow pass requires. */
  readonly failingEdges:
    ReadonlyMap<string, { readonly rise: number; readonly novel: number }> | undefined;
  /** Which reading of the flow decides a pair. */
  readonly attribution: FailureAttribution;
  /** The order the FUSION published, best first. */
  readonly fusionOrder: readonly ServiceId[];
  /** The order the engine actually published, for the replay check. */
  readonly publishedOrder: readonly ServiceId[];
}

/** The first element of an order, or `null` when it is empty. */
function head(order: readonly string[]): string | null {
  return order.length === 0 ? null : order[0]!;
}

/**
 * Project a sweep's verdicts into rows, keeping the measured sides and dropping the unmeasured ones.
 *
 * @param sweep - One arm's sweep.
 * @returns One row per examined pair, in sweep order.
 */
function toRows(sweep: ContainmentSweep<{ readonly service: ServiceId }>): ContainmentPairRow[] {
  return sweep.verdicts.map((verdict) => ({
    upper: verdict.upper,
    lower: verdict.lower,
    decision: verdict.decision,
    ...(verdict.upperExcursion === undefined ? {} : { upperExcursion: verdict.upperExcursion }),
    ...(verdict.lowerExcursion === undefined ? {} : { lowerExcursion: verdict.lowerExcursion }),
  }));
}

/**
 * Build one case's row.
 *
 * The two arms are swept from the SAME fusion order and stored separately, because they are two walks: once one
 * arm inverts a pair the other refused, the two scans are looking at different adjacencies and their row `i`
 * describes two different pairs.
 *
 * @param input - The case's measurements.
 * @returns The row the dump stores.
 */
export function buildContainmentRow(input: BuildContainmentRowInput): ContainmentCaseRow {
  const ranking = input.fusionOrder.map((service) => ({ service }));
  const excursions = input.excursions ?? new Map<ServiceId, number>();
  // An EMPTY record rather than `undefined` for a case with no failed-call channel: `undefined` is the refused
  // arm (no requirement at all), while a case that measured "nothing failed" still requires the pair's interface
  // to be among the ones that did. See `docs/containment-order.md` §12.2.
  const gated = inspectContainmentOrder({
    ranking,
    edges: input.edges,
    excursions,
    margin: input.margin,
    failingEdges: input.failedInterfaces ?? new Map<string, number>(),
  });
  const ungated = inspectContainmentOrder({
    ranking,
    edges: input.edges,
    excursions,
    margin: input.margin,
  });
  const replayed = applyFailureContainment({
    ranking: gated.order,
    flows: input.failureFlows,
    failingEdges: input.failingEdges,
    attribution: input.attribution,
  }).map((entry) => entry.service);

  const replay: ContainmentReplay =
    excursions.size === 0 || input.edges.length === 0
      ? 'unavailable'
      : replayed.length === input.publishedOrder.length &&
          replayed.every((service, index) => service === input.publishedOrder[index])
        ? 'identical'
        : 'differs';

  return {
    datapack: input.datapack,
    faultType: input.faultType,
    sigma: input.sigma,
    margin: input.margin,
    fusionTop1: head(input.fusionOrder),
    gatedTop1: head(gated.order.map((entry) => entry.service)),
    ungatedTop1: head(ungated.order.map((entry) => entry.service)),
    shippedTop1: head(input.publishedOrder),
    replay,
    pairs: toRows(gated),
    ungatedPairs: toRows(ungated),
  };
}
