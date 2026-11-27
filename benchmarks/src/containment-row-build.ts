/**
 * Build one case's containment-sweep row from the graph the engine built and the order its passes were given.
 *
 * ## Why the order has to come from the engine's own call
 *
 * The sweep's input is the order the FUSION published, and the published ranking is two permutations past it:
 * `analyze` runs the containment pass and then the failure-flow pass over the list the fusion produced. Observing
 * the sweep from the published ranking would observe a different population — and on a case the failure-flow pass
 * reordered, a different set of adjacencies altogether.
 *
 * This module used to take that order from a SECOND engine with both passes switched off, which is the defect
 * `docs/gate-replay.md` §9.6 records: two computations of one thing, and on the five cases where the difference
 * reached the head the artifact recorded an order the passes never saw. It is not a difference at all now —
 * `TreePruner.analyzeWithFusion` REPORTS the list its passes were given, and this builder takes that list.
 *
 * ## Two widths, one sweep
 *
 * The chain records the order at the WIDTH THE PASSES RAN AT, because that is what a replay needs: the wide
 * traversal lifts a callee to just above its caller to a fixed point, so the published head can come from any
 * depth. The pair rows are the head of the same sweep, `depth` positions wide, because ρ is fitted per edge over
 * the pairs a corpus examined and that population was measured at five.
 *
 * `recordWindow` is what keeps those two statements from becoming two walks: the sweep decides over the whole list
 * and the window limits only the RECORD, so the order that reaches the flow pass is the engine's own and the rows
 * are a stated prefix of its verdicts.
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
  type FailureContainmentScope,
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
  /** The band half-width the run measured against, in robust standard deviations. */
  readonly sigma: number;
  /** The margin the run applied, in band widths. */
  readonly margin: number;
  /**
   * How many candidates of the fusion order the PAIR ROWS describe, counting from the head.
   *
   * The sweep's population, and a configuration of the run like the margin: ρ is fitted per edge over the pairs a
   * corpus examined, so the number is written rather than implied by the rows' length — a longer case and a wider
   * window produce the same census, and a reader who inferred the width from `pairs.length` would infer a
   * different population for every graph shape.
   */
  readonly depth: number;
  /** The case's directed call edges. */
  readonly edges: readonly ContainmentEdge[];
  /** The per-service excursions, ABSENT when the run had no profile or the case no latency channel. */
  readonly excursions: ReadonlyMap<ServiceId, number> | undefined;
  /**
   * The per-service fault-free surprises, ABSENT when the run had no profile.
   *
   * The same case measured through every published channel instead of through the latency family, recorded beside
   * the excursion map so that the pass can be walked a second way from this file. It is a MEASUREMENT and not a
   * decision: no arm in this builder reads it, and the arm that does lives in `containment-replay.ts`.
   */
  readonly surprises: ReadonlyMap<ServiceId, number> | undefined;
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
  /**
   * How far the flow pass looked for a pair — the run's `failureContainmentScope`.
   *
   * REQUIRED, and required for the reason the engine's own options are: a builder that fell back to the engine's
   * default would write a configuration the dispatch never stated, and the replay would reproduce the dump's own
   * default rather than the run's answer. `docs/gate-replay.md` §8 is the measured cost of exactly that (`1 179`
   * against `1 186`).
   */
  readonly scope: FailureContainmentScope;
  /** The order the FUSION published, best first — the list the passes were GIVEN, at the width they ran at. */
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
  //
  // Both arms sweep the WHOLE order and record the head of it: the pass the run publishes is defined over the list
  // it was handed, and a window over the DECISIONS would be a different pass. `recordWindow` narrows the record
  // alone, so `gated.order` below is the engine's containment stage and not a five-wide imitation of it.
  const gated = inspectContainmentOrder({
    ranking,
    edges: input.edges,
    excursions,
    margin: input.margin,
    failingEdges: input.failedInterfaces ?? new Map<string, number>(),
    recordWindow: input.depth,
  });
  const ungated = inspectContainmentOrder({
    ranking,
    edges: input.edges,
    excursions,
    margin: input.margin,
    recordWindow: input.depth,
  });
  // The replay walks the SAME scope the run applied: `identical` is a statement about one configuration, and a
  // verdict produced at another one is a disagreement about the reader, not about the artifact.
  const replayed = applyFailureContainment({
    ranking: gated.order,
    flows: input.failureFlows,
    failingEdges: input.failingEdges,
    attribution: input.attribution,
    scope: input.scope,
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
    depth: input.depth,
    fusionTop1: head(input.fusionOrder),
    gatedTop1: head(gated.order.map((entry) => entry.service)),
    ungatedTop1: head(ungated.order.map((entry) => entry.service)),
    shippedTop1: head(input.publishedOrder),
    replay,
    pairs: toRows(gated),
    ungatedPairs: toRows(ungated),
    // The sweep's own input, written beside its decisions so that an arm nobody has swept yet can be walked
    // from this file. An ABSENT flow map and an EMPTY one are the same measurement — `applyFailureContainment`
    // says so ("empty or absent means the pass is a no-op") — which is why both are written as `{}`.
    chain: {
      order: input.fusionOrder,
      edges: input.edges.map((edge) => [edge.from, edge.to] as const),
      excursions: Object.fromEntries(input.excursions ?? []),
      // Absent rather than empty when the run had no profile: an empty map would say every candidate was measured
      // and none moved, which is exactly the reading `channelSurprise` refuses to make.
      ...(input.surprises === undefined ? {} : { surprises: Object.fromEntries(input.surprises) }),
      failedInterfaces: Object.fromEntries(input.failedInterfaces ?? []),
      flows: Object.fromEntries(input.failureFlows ?? []),
      failingEdges: Object.fromEntries(input.failingEdges ?? []),
      attribution: input.attribution,
      scope: input.scope,
    },
  };
}
