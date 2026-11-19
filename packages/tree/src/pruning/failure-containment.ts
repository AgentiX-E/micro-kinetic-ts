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
 * is the source?* The answer the channel can give is a flow, and the flow is a 2×2 — a direction and a KIND of
 * evidence:
 *
 *                        the edge carried the shape before      the shape is new
 *     edge  c → v        knownIn(v)   — v's own interface      novelOut(c) — c sent a corrupted request
 *     edge  v → d        knownOut(v)  — v's own calls failing  novelOut(v) — v sent a corrupted request
 *
 *     unexplained(v) = max(0, knownIn(v) + novelOut(v) − knownOut(v))        ('shape' attribution)
 *     unexplained(v) = max(0, knownIn(v) + novelIn(v) − knownOut(v) − novelOut(v))   ('counts')
 *
 * A source's inbound rise is its own: nothing it calls is failing. A VICTIM's inbound rise is produced by the
 * same calls it makes — that is what propagation IS — so its outbound rise cancels it. On a chain `c → a → b`
 * with the fault at `b`, `a` reports failures inbound (from `c`) and outbound (to `b`) in the same counts and
 * nets zero, while `b` nets its entire rise. That is the asymmetry this pass reads, and it is read on BOTH
 * candidates, never on one.
 *
 * ## Why the KIND of evidence exists (iteration 290)
 *
 * The one-dimensional form above has a blind spot the full-corpus readback named: a CALLER that corrupts its
 * request — a replaced method, a rewritten path — makes its callee reject a shape the callee has never been
 * asked for. Every COUNT of that failure still lands on the callee, so the callee nets the whole rise and the
 * pass promotes a victim, which is exactly the two `HTTPRequestReplaceMethod` losses §10.3 recorded.
 *
 * The counts cannot separate the two cases because the counts are correct. What separates them is the REQUEST
 * SHAPE: a callee that broke fails the requests it has always served, while a caller that corrupted its request
 * emits a shape the edge never carried. Charging those to the caller (`novelOut`) instead of to the callee
 * (`knownIn`) is the whole of the 'shape' attribution, and on every case whose failures all arrive on shapes the
 * baseline carried it reduces EXACTLY to the one-dimensional form — measured on the FSE'26 families that inject
 * at the callee: `response-replace-code`, `response-replace-body` and `response-abort` produced `0` novel
 * failures across every sampled case, while the request-corruption families produced thousands.
 *
 * `'counts'` is therefore not a fallback but the 289 rule kept reachable, so the attribution can be ablated on
 * ONE cache: it charges every counted rise where the count says it lands.
 *
 * ## What this pass refuses to do
 *
 * - A pair with no direct call edge is left alone: the flow says nothing about two services that do not call
 *   each other.
 * - A pair whose own edge carried **no rise** is left alone however asymmetric the flows are. When one conduit
 *   carries the whole failure count — `c → a → b` with 203 failures on both hops — the asymmetry is an artefact
 *   of where the chain ends, not evidence about either end. This refusal is the measured arm's single
 *   regression in 711 cases (`docs/containment-order.md` §10.4).
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
  /**
   * The part of {@link rise} whose request shape the edge had never carried before the injection.
   *
   * Never greater than {@link rise}: the channel reports novelty as a SUBSET of what it counted, and a producer
   * that disagreed would otherwise let one failure explain two directions.
   */
  readonly novel: number;
}

/** One failing edge, as the pair rule reads it. */
export interface FailingEdge {
  /** Total net rise on the edge — what makes it a failing edge at all. */
  readonly rise: number;
  /** The novel-shape part of {@link rise}. */
  readonly novel: number;
}

/** How many net failed calls a service's interfaces reported, split by direction and by kind of evidence. */
export interface FailureFlow {
  /** Rise on edges INTO this service that carried a shape the edge had always carried: its interface failing. */
  readonly knownIn: number;
  /** Rise on edges OUT OF this service that carried a known shape: its own calls failing. */
  readonly knownOut: number;
  /** Rise on edges INTO this service that carried a shape the edge had never carried: someone else's request. */
  readonly novelIn: number;
  /** Rise on edges OUT OF this service that carried a novel shape: this service's own requests malformed. */
  readonly novelOut: number;
}

/**
 * Which reading of the flow decides a pair.
 *
 * - `'shape'` credits a novel-shape rise to the CALLER that produced the request, which is what makes the
 *   request-corruption family legible. The measured default.
 * - `'counts'` credits every counted rise where the count says it lands — the 289 rule. Kept as a switch so the
 *   two can be ablated on one cache, and so a caller can pin the older reading without re-cutting data.
 */
export type FailureAttribution = 'shape' | 'counts';

/** The attribution every caller gets unless it asks for the other one. */
export const DEFAULT_FAILURE_ATTRIBUTION: FailureAttribution = 'shape';

/**
 * Whether an untrusted value names a reading. Total, for parsers and for callers holding `string`.
 *
 * A flag that mapped an unknown spelling onto one of the two readings would silently publish a configuration
 * nobody asked for, and the two readings disagree by design — so the parser has to be able to tell "not a
 * reading" from "the other reading".
 *
 * @param value - Anything a boundary handed over.
 * @returns Whether it is one of the two readings.
 */
export function isFailureAttribution(value: unknown): value is FailureAttribution {
  return value === 'shape' || value === 'counts';
}

/**
 * How far through the order the containment rule may look for a pair to invert.
 *
 * The rule is the same in all three readings — a caller above its callee whose callee's failures the caller's
 * own calls do not account for — and only the POPULATION of pairs it may compare differs. The distinction is
 * not cosmetic: iteration 313 measured a partition that promoted every residual-positive candidate over every
 * other one and lost 107 `Top@1` against the control, with the losses landing in the four families whose ground
 * truth carries no failure record at all. A rule that only ever swaps a caller with its OWN callee is bound to
 * an edge the case measured; a rule that compares two candidates the case never related is not.
 *
 * - `'adjacent'` — neighbouring positions only, and the pair must share a failing edge. The engine default, and
 *   the traversal every published number on both halves was measured on.
 * - `'global'` — any caller/callee pair that shares a failing edge may be inverted, and the callee is lifted
 *   to immediately above its caller. Strictly more inversions than `'adjacent'`, and the reason it is a
 *   separate state is that adjacency is a property of the FUSION's order, not of the evidence: a correct
 *   inversion that the fusion placed 30 positions apart is invisible to the shipped pass.
 * - `'global-measured'` — `'global'`, and additionally NEITHER side may be a candidate the failure channel did
 *   not measure. `unexplainedFailures(undefined) = 0` otherwise reads an unmeasured candidate as a fully
 *   explained one, so the unguarded rule displaces a node it has no evidence about. The latency pass in
 *   {@link TreePruner} already refuses pairs on exactly this ground ("an unmeasured candidate read as a
 *   measured zero would invert on evidence nobody collected"); this state extends the same refusal to the
 *   failure channel, where it was missing.
 */
export type FailureContainmentScope = 'adjacent' | 'global' | 'global-measured';

/**
 * The scope every caller gets unless it asks for another one.
 *
 * `'adjacent'`, and it stays there in iteration 313 **because the wide state was measured on one corpus and not
 * on the other**. On the 1 422-case RCABench archive `'global-measured'` reads **1 156 → 1 186 `Top@1`**, 30
 * gained and none lost (`docs/failure-containment-reach.md`); on the RCAEval cells it has not been measured, and
 * that half DOES carry failed-call rows — `run-rcaeval.ts` attaches `failedTraceEdges` from a streaming pass over
 * `traces.csv` — and the two states were then measured there and agree case for case (735 cases, six protocols).
 * The arm therefore ships as a **stated flag**, never as a default: one option has one default and its owner is this
 * constant, so a runner-side second copy of it would be a number published under a name its owner does not hold.
 * The FSE'26 dispatch states `--failure-containment-scope global-measured` on the invocation it runs, which is why
 * its published cell is 1 186 and its artifact prints the token.
 *
 * This default moves the day a reading asks it to; nothing measured so far does. The guard is free on the archive
 * (the two wide states are byte-identical over 1 422 cases) and it refuses the one comparison the measurement calls
 * unsafe.
 */
export const DEFAULT_FAILURE_CONTAINMENT_SCOPE: FailureContainmentScope = 'adjacent';

/** Every scope, in the order the document reads them. */
export const FAILURE_CONTAINMENT_SCOPES: readonly FailureContainmentScope[] = [
  'adjacent',
  'global',
  'global-measured',
];

/**
 * Whether an untrusted value names a scope. Total, for parsers and for callers holding `string`.
 *
 * A parser that mapped an unknown spelling onto the default would publish an arm's numbers under the shipped
 * configuration's name, which is the one failure the record cannot detect after the fact.
 *
 * @param value - Anything a boundary handed over.
 * @returns Whether it is one of the three scopes.
 */
export function isFailureContainmentScope(value: unknown): value is FailureContainmentScope {
  return value === 'adjacent' || value === 'global' || value === 'global-measured';
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
 * property of the term's configuration and what the interfaces did is a property of the case. Both readings of
 * {@link FailureAttribution} are computable from this one object, which is why the switch needs no measurement
 * of its own.
 *
 * @param rows - The counted rises, in edge order.
 * @returns One entry per service the channel measured. A service absent from the map was not measured.
 */
export function failureFlows(rows: readonly FailedEdgeRise[]): Map<ServiceId, FailureFlow> {
  const flows = new Map<ServiceId, FailureFlow>();
  for (const row of rows) {
    const novel = Math.max(0, Math.min(row.novel, row.rise));
    const known = row.rise - novel;
    const into = flows.get(row.callee);
    flows.set(row.callee, {
      knownIn: (into?.knownIn ?? 0) + known,
      knownOut: into?.knownOut ?? 0,
      novelIn: (into?.novelIn ?? 0) + novel,
      novelOut: into?.novelOut ?? 0,
    });
    // The caller may be the same service as the callee in a self-call, which the ledger has already dropped, so
    // the two writes below cannot land on the same entry for one row.
    const out = flows.get(row.caller);
    flows.set(row.caller, {
      knownIn: out?.knownIn ?? 0,
      knownOut: (out?.knownOut ?? 0) + known,
      novelIn: out?.novelIn ?? 0,
      novelOut: (out?.novelOut ?? 0) + novel,
    });
  }
  return flows;
}

/**
 * The rise that is this service's own doing.
 *
 * Under `'shape'`, two kinds of evidence NET here, because they are the same claim about different interfaces:
 * what ARRIVED and failed on a request the edge had always carried (`knownIn`), and what LEFT in a shape nothing
 * had asked for before (`novelOut`). Both say "this service emits the failure". What it CALLS failing
 * (`knownOut`) is the propagation the residual exists to remove, and a request a callee rejected for its shape
 * never becomes evidence about the callee — that is the whole reason the novel rise is not in `knownIn`.
 *
 * Under `'counts'` the two kinds are not distinguished: every inbound count is the callee's, every outbound one
 * the caller's, and the residual is the 289 quantity.
 *
 * Clamped at zero because the quantity is a statement about evidence, not a penalty: a service whose own calls
 * fail more than its interface does is not "negatively explained", and letting the number go negative would
 * make one comparison of two arbitrary magnitudes decide a pair.
 *
 * @param flow - The service's flow, or `undefined` when the channel did not measure it.
 * @param attribution - Which reading to apply. Defaults to the measured one, `'shape'`.
 * @returns The unexplained rise, in failed calls.
 */
export function unexplainedFailures(
  flow: FailureFlow | undefined,
  attribution: FailureAttribution = DEFAULT_FAILURE_ATTRIBUTION,
): number {
  if (flow === undefined) return 0;
  const residual =
    attribution === 'counts'
      ? flow.knownIn + flow.novelIn - flow.knownOut - flow.novelOut
      : flow.knownIn + flow.novelOut - flow.knownOut;
  return residual > 0 ? residual : 0;
}

/** What {@link applyFailureContainment} needs. */
export interface FailureContainmentInput<T> {
  /** The ranked candidates, best first, exactly as the fusion left them. */
  readonly ranking: readonly T[];
  /** The flow map from {@link failureFlows}. Empty or absent means the pass is a no-op. */
  readonly flows: ReadonlyMap<ServiceId, FailureFlow> | undefined;
  /**
   * The edges that carried a net rise, keyed by {@link failureEdgeKey}.
   *
   * Not derivable from `flows`: a service's inbound rise says nothing about WHICH caller reported it, and the
   * rule requires the pair's own edge to be among the failing ones. The VALUE is what makes the degenerate relay
   * recognisable — see {@link applyFailureContainment}.
   */
  readonly failingEdges: ReadonlyMap<string, FailingEdge> | undefined;
  /** Which reading of the flow decides a pair. Absent means {@link DEFAULT_FAILURE_ATTRIBUTION}. */
  readonly attribution?: FailureAttribution;
  /** How far to look for a pair. Absent means {@link DEFAULT_FAILURE_CONTAINMENT_SCOPE}, the shipped traversal. */
  readonly scope?: FailureContainmentScope;
}

/** The minimum of a candidate and its rank, as the pass reads them. */
interface RankedService {
  readonly service: ServiceId;
}

/**
 * Invert caller/callee pairs whose unexplained failure flows are out of order.
 *
 * A pair is inverted when the higher candidate calls the lower one, that edge carried a net rise, and the lower
 * candidate's unexplained flow is strictly greater than the higher one's. The two comparisons are the same
 * quantity in the same unit on the two candidates, so no margin exists to tune and none is offered.
 *
 * @param input - The published ranking, the flows, the edges that failed, the reading to apply, and how far to
 *   look for a pair.
 * @returns The same candidates in the same order, with the qualified pairs inverted.
 */
export function applyFailureContainment<T extends RankedService>(
  input: FailureContainmentInput<T>,
): T[] {
  const order = [...input.ranking];
  const flows = input.flows;
  const failingEdges = input.failingEdges;
  const attribution = input.attribution ?? DEFAULT_FAILURE_ATTRIBUTION;
  if (order.length < 2 || flows === undefined || flows.size === 0) return order;
  if (failingEdges === undefined || failingEdges.size === 0) return order;
  const scope = input.scope ?? DEFAULT_FAILURE_CONTAINMENT_SCOPE;
  if (scope === 'adjacent') return invertAdjacent(order, flows, failingEdges, attribution);
  return liftCallers(order, flows, failingEdges, attribution, scope === 'global-measured');
}

/**
 * The shipped traversal: one forward pass over neighbouring positions.
 *
 * A swapped-down candidate is not re-examined, which is a property and not an oversight: the pass is stated as
 * "invert a qualified adjacent pair" and a second look would make one call invert a pair the caller never
 * described.
 *
 * @param order - The ranking, best first. Mutated.
 * @param flows - The per-service flow map.
 * @param failingEdges - The edges that carried a net rise.
 * @param attribution - Which reading decides a pair.
 * @returns The same array.
 */
function invertAdjacent<T extends RankedService>(
  order: T[],
  flows: ReadonlyMap<ServiceId, FailureFlow>,
  failingEdges: ReadonlyMap<string, FailingEdge>,
  attribution: FailureAttribution,
): T[] {
  for (let i = 0; i + 1 < order.length; i++) {
    const upper = order[i]!;
    const lower = order[i + 1]!;
    const edge = failingEdges.get(failureEdgeKey(upper.service, lower.service));
    if (edge === undefined) continue;
    if (!qualifies(upper.service, lower.service, flows, edge, attribution, false)) continue;
    order[i] = lower;
    order[i + 1] = upper;
  }
  return order;
}

/**
 * The wide traversal: every caller/callee pair that a failed edge relates, to a fixed point.
 *
 * The callee is lifted to IMMEDIATELY above its caller rather than to the front, so the pass states one thing —
 * "this callee's failures are not accounted for by this caller's own calls" — and never a second, larger one
 * ("and it outranks everything in between"), which is the claim iteration 313 measured at −107 `Top@1`. Two
 * candidates the case never related are never compared: the population of pairs is the failing edges, so the
 * pass can only move evidence about an interface, exactly as the shipped one can.
 *
 * Terminates because a pair that qualifies can only be lifted while its caller is above it, and a full pass
 * that moves nothing ends the loop; the bound on passes is the candidate count, which is what guarantees that
 * even a pathological cycle of qualifying pairs cannot spin.
 *
 * @param order - The ranking, best first. Mutated.
 * @param flows - The per-service flow map.
 * @param failingEdges - The edges that carried a net rise.
 * @param attribution - Which reading decides a pair.
 * @param requireMeasured - Whether a candidate the channel did not measure may take part in a pair.
 * @returns The same array.
 */
function liftCallers<T extends RankedService>(
  order: T[],
  flows: ReadonlyMap<ServiceId, FailureFlow>,
  failingEdges: ReadonlyMap<string, FailingEdge>,
  attribution: FailureAttribution,
  requireMeasured: boolean,
): T[] {
  const keys = [...failingEdges.keys()].sort();
  for (let pass = 0; pass <= order.length; pass++) {
    let moved = false;
    for (const key of keys) {
      const edge = failingEdges.get(key)!;
      const [caller, callee] = splitFailureEdgeKey(key);
      const at = new Map<ServiceId, number>();
      for (let i = 0; i < order.length; i++) at.set(order[i]!.service, i);
      const from = at.get(caller);
      const to = at.get(callee);
      if (from === undefined || to === undefined || to < from) continue;
      if (!qualifies(caller, callee, flows, edge, attribution, requireMeasured)) continue;
      const [lifted] = order.splice(to, 1);
      order.splice(from, 0, lifted!);
      moved = true;
    }
    if (!moved) break;
  }
  return order;
}

/**
 * The caller and callee an edge key names.
 *
 * The key is this module's own format, so the split is a property of the writer rather than a guess: a key with
 * no separator cannot have been produced by {@link failureEdgeKey}, and a reader that treated it as a pair would
 * be comparing two services an edge does not relate.
 *
 * @param key - A key from a `failingEdges` map.
 * @returns The pair, or two empty ids for a malformed key.
 */
function splitFailureEdgeKey(key: string): [ServiceId, ServiceId] {
  const parts = key.split('\u0000');
  return [(parts[0] ?? '') as ServiceId, (parts[1] ?? '') as ServiceId];
}

/**
 * Whether a pair is out of order.
 *
 * The one place the rule is written, so the three traversals cannot drift: a difference between them would
 * otherwise be a difference in the REFUSALS as well as in the reach, which is the confound the scope switch
 * exists to avoid.
 *
 * The DEGENERATE RELAY refusal: when every failure the callee saw arrived on this one edge, every failure the
 * caller reported left on it, and the caller's own inbound count is that same number, the three accounts are one
 * account — a single count travelling down a chain. The residual asymmetry the rule reads is then an artefact
 * of where the chain stops rather than a statement about either end, and the pair is refused.
 *
 * The test reads the flow in the SAME reading the rule used, and it compares the pair edge's own rise with its
 * novel part removed when that reading separates the two kinds — a count that arrived on a shape this edge had
 * never carried is not the same account as the ones that did, so the equality must not be satisfied by mixing
 * them.
 *
 * @param caller - The higher candidate.
 * @param callee - The lower candidate.
 * @param flows - The per-service flow map.
 * @param edge - The failing edge between them.
 * @param attribution - Which reading decides the pair.
 * @param requireMeasured - Whether an unmeasured candidate is refused outright.
 * @returns Whether the pair should be inverted.
 */
function qualifies(
  caller: ServiceId,
  callee: ServiceId,
  flows: ReadonlyMap<ServiceId, FailureFlow>,
  edge: FailingEdge,
  attribution: FailureAttribution,
  requireMeasured: boolean,
): boolean {
  if (edge.rise <= 0) return false;
  const upperFlow = flows.get(caller);
  const lowerFlow = flows.get(callee);
  if (requireMeasured && (upperFlow === undefined || lowerFlow === undefined)) return false;
  if (
    !(unexplainedFailures(lowerFlow, attribution) > unexplainedFailures(upperFlow, attribution))
  ) {
    return false;
  }
  const pairRise = attribution === 'counts' ? edge.rise : edge.rise - edge.novel;
  if (
    lowerFlow !== undefined &&
    upperFlow !== undefined &&
    pairRise > 0 &&
    relayEqualities(lowerFlow, upperFlow, pairRise, attribution)
  ) {
    return false;
  }
  return true;
}

/**
 * Whether the three accounts of a pair are one account.
 *
 * Split out only so the two readings can each state their own equalities in one place: a relay is the same
 * statement about known counts under either reading, and the novel-excluding quantities are what the `'shape'`
 * reading has to compare.
 */
function relayEqualities(
  lower: FailureFlow,
  upper: FailureFlow,
  rise: number,
  attribution: FailureAttribution,
): boolean {
  if (attribution === 'counts') {
    return (
      lower.knownIn + lower.novelIn === rise &&
      upper.knownOut + upper.novelOut === rise &&
      upper.knownIn + upper.novelIn === rise
    );
  }
  return lower.knownIn === rise && upper.knownOut === rise && upper.knownIn === rise;
}
