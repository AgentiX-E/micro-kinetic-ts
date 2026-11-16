/**
 * The failure-flow order: a candidate whose interface is failing, while none of its own calls are, may not be
 * outranked by the caller those failures were reported against.
 *
 * ## Why the latency pass is not enough
 *
 * The containment order (`pruning/containment-order.ts`) reads one instrument: how far each candidate's latency
 * left the band it occupied while nothing was wrong. Iteration 289 measured that instrument's ceiling on the
 * FSE'26 corpus: of 82 cases whose truth is published SECOND behind its own caller, only **34** carry that
 * signature at all. **41** have both candidates inside their bands — the classic error-shaped fault (a replaced
 * status code, an aborted request) moves no latency percentile — and the remaining seven have no direct edge or
 * the wrong excursion ordering. A delay instrument cannot repair a case in which nothing was delayed.
 *
 * ## The second instrument, and why it is relational in the same way
 *
 * The failed-call channel was already in the engine as a TERM: `computeFailedEdgeScores` charges every failing
 * edge to its CALLEE, so the service whose interface is failing collects the evidence. A term is
 * candidate-local, and the question this pass has to answer is relational: *of these two candidates, which one
 * is the source?* The answer the channel can give is a flow:
 *
 *     incoming(v)  = Σ max(0, failed − baseline) over edges  c → v     — v's interface failing
 *     outgoing(v)  = Σ max(0, failed − baseline) over edges  v → d     — v's own calls failing
 *     unexplained(v) = max(0, incoming(v) − outgoing(v))
 *
 * A source's incoming rise is its own: nothing it calls is failing. A VICTIM's incoming rise is produced by the
 * same calls it makes — that is what propagation IS — so its outgoing rise cancels it. On a chain `c → a → b`
 * with the fault at `b`, `a` reports failures inbound (from `c`) and outbound (to `b`) in the same counts and
 * nets zero, while `b` nets its entire rise. That is the asymmetry this pass reads, and it is read on BOTH
 * candidates, never on one.
 *
 * ## What this pass refuses to do
 *
 * - A pair with no direct call edge is left alone: the flow says nothing about two services that do not call
 *   each other.
 * - A pair whose own edge carried **no rise** is left alone however asymmetric the flows are. When one conduit
 *   carries the whole failure count — `c → a → b` with 203 failures on both hops — the asymmetry is an artefact
 *   of where the chain ends, not evidence about either end. This refusal is the measured arm's single
 *   regression in 711 cases (`docs/containment-order.md` §5).
 * - A pair whose two unexplained flows are EQUAL is left alone: the comparison is strict, and equality is the
 *   channel saying it cannot tell the two apart.
 * - A candidate the channel did not measure is read as zero unexplained rise, which is the same refusal the
 *   gate makes: an absent measurement is not a measured zero, and it cannot promote anything on its own.
 *
 * One adjacent sweep, no backtracking, scores never read — the same shape as the latency pass, for the same
 * reason: the claim is about the ORDER the fusion published, and a full re-sort on either instrument alone is a
 * different (and measured-worse) ranker.
 *
 * @module pruning/failure-containment
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

/** One counted rise from the failed-call channel, after the score's own filters. */
export interface FailedEdgeRise {
  /** The service that made the failing calls. */
  readonly caller: ServiceId;
  /** The service those calls were made against. */
  readonly callee: ServiceId;
  /** Net rise, i.e. `max(0, failed − baseline)` — already clamped and above the record floor. */
  readonly rise: number;
}

/** How many net failed calls a service's interfaces reported, in each direction. */
export interface FailureFlow {
  /** Net rises on edges whose CALLEE is this service: its interface failing. */
  readonly incoming: number;
  /** Net rises on edges whose CALLER is this service: its own calls failing. */
  readonly outgoing: number;
}

/**
 * The edge key this module's set and the containment pass's own set both use.
 *
 * Exported rather than spelled at each site so a caller building a `failingEdges` set cannot disagree with the
 * pass reading it about what a key is — a disagreement that would silently disable the rule.
 *
 * @param from - The caller.
 * @param to - The callee.
 * @returns A key unique to the ordered pair.
 */
export function failureEdgeKey(from: ServiceId, to: ServiceId): string {
  return `${from}\u0000${to}`;
}

/**
 * The per-service flow, from the counted rises.
 *
 * A MEASUREMENT, not a decision: it is built from the same rows the failed-edge term's scores are built from,
 * before any of that term's rules decide which charges to drop, because whether a charge is credited is a
 * property of the term's configuration and what the interfaces did is a property of the case.
 *
 * @param rows - The counted rises, in edge order.
 * @returns One entry per service the channel measured. A service absent from the map was not measured.
 */
export function failureFlows(rows: readonly FailedEdgeRise[]): Map<ServiceId, FailureFlow> {
  const flows = new Map<ServiceId, FailureFlow>();
  for (const row of rows) {
    const up = flows.get(row.callee);
    flows.set(row.callee, {
      incoming: (up?.incoming ?? 0) + row.rise,
      outgoing: up?.outgoing ?? 0,
    });
    // The caller may be the same service as the callee in a self-call, which the ledger has already dropped, so
    // the two writes below cannot land on the same entry for one row.
    const down = flows.get(row.caller);
    flows.set(row.caller, {
      incoming: down?.incoming ?? 0,
      outgoing: (down?.outgoing ?? 0) + row.rise,
    });
  }
  return flows;
}

/**
 * The incoming rise no outgoing rise explains.
 *
 * Clamped at zero because the quantity is a statement about evidence, not a penalty: a service whose own calls
 * fail more than its interface does is not "negatively explained", and letting the number go negative would
 * make one comparison of two arbitrary magnitudes decide a pair.
 *
 * @param flow - The service's flow, or `undefined` when the channel did not measure it.
 * @returns The unexplained rise, in failed calls.
 */
export function unexplainedFailures(flow: FailureFlow | undefined): number {
  if (flow === undefined) return 0;
  const residual = flow.incoming - flow.outgoing;
  return residual > 0 ? residual : 0;
}

/** What {@link applyFailureContainment} needs. */
export interface FailureContainmentInput<T> {
  /** The ranked candidates, best first, exactly as the fusion left them. */
  readonly ranking: readonly T[];
  /** The flow map from {@link failureFlows}. Empty or absent means the pass is a no-op. */
  readonly flows: ReadonlyMap<ServiceId, FailureFlow> | undefined;
  /**
   * The edges that carried a net rise, keyed by {@link failureEdgeKey}, valued by that rise.
   *
   * Not derivable from `flows`: a service's incoming rise says nothing about WHICH caller reported it, and the
   * rule requires the pair's own edge to be among the failing ones. The VALUE is what makes the degenerate relay
   * recognisable — see {@link applyFailureContainment}.
   */
  readonly failingEdges: ReadonlyMap<string, number> | undefined;
}

/** The minimum of a candidate and its rank, as the pass reads them. */
interface RankedService {
  readonly service: ServiceId;
}

/**
 * Invert adjacent caller/callee pairs whose unexplained failure flows are out of order.
 *
 * A pair is inverted when the higher candidate calls the lower one, that edge carried a net rise, and the lower
 * candidate's unexplained flow is strictly greater than the higher one's. The two comparisons are the same
 * quantity in the same unit on the two candidates, so no margin exists to tune and none is offered.
 *
 * @param input - The published ranking, the flows, and the set of edges that failed.
 * @returns The same candidates in the same order, with the qualified adjacent pairs inverted.
 */
export function applyFailureContainment<T extends RankedService>(
  input: FailureContainmentInput<T>,
): T[] {
  const order = [...input.ranking];
  const flows = input.flows;
  const failingEdges = input.failingEdges;
  if (order.length < 2 || flows === undefined || flows.size === 0) return order;
  if (failingEdges === undefined || failingEdges.size === 0) return order;

  for (let i = 0; i + 1 < order.length; i++) {
    const upper = order[i]!;
    const lower = order[i + 1]!;
    const rise = failingEdges.get(failureEdgeKey(upper.service, lower.service));
    if (rise === undefined || rise <= 0) continue;
    const lowerFlow = flows.get(lower.service);
    const upperFlow = flows.get(upper.service);
    if (!(unexplainedFailures(lowerFlow) > unexplainedFailures(upperFlow))) continue;
    // The DEGENERATE RELAY. When every failure the callee saw arrived on this one edge, every failure the caller
    // reported left on it, and the caller's own incoming count is that same number, the three accounts are one
    // account: a single count travelling down a chain. The residual asymmetry the rule reads is then an artefact
    // of where the chain stops rather than a statement about either end, and the pair is refused. Measured: this
    // is the whole of the arm's one regression, and refusing it costs none of the gains that carry a gradient.
    if (
      lowerFlow !== undefined &&
      upperFlow !== undefined &&
      lowerFlow.incoming === rise &&
      upperFlow.outgoing === rise &&
      upperFlow.incoming === rise
    ) {
      continue;
    }
    order[i] = lower;
    order[i + 1] = upper;
  }
  return order;
}
