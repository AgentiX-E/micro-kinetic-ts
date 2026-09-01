/**
 * Deterministic fault-role classification for the graph-guided investigator
 * (GALA+ phase-III).
 *
 * The ReAct agent fails on "wrong value" faults (TrainTicket RE3) because the
 * SYMPTOM carries the largest anomaly (a collapse) AND the only logic
 * exception, while the SOURCE is SILENT (no exception, a modest workload rise).
 * The frozen model's "biggest anomaly = root cause" prior — correct for the
 * resource faults of RE1/RE2 — then dominates, and it answers the symptom
 * instead of walking upstream. This module derives, from graph structure
 * alone, an explicit fault role per service (symptom vs silent-source
 * candidate) and a concise interpretation string that the evidence builder
 * injects next to the raw numbers, so the model sees the causal chain spelled
 * out rather than having to infer it from a 30-line system prompt.
 *
 * The symptom signal is deliberately NARROW: only BAD-INPUT exceptions
 * (token/JWT, JSON/serialization — matching the prompt's "Semantic clues")
 * mark a symptom. A source-side logic exception (NullPointerException,
 * IllegalArgumentException, …) is thrown by the SOURCE on its own bug, not by a
 * victim of bad upstream input — tagging it "symptom" would mislead the walk
 * upstream and regress the RE3 OnlineBoutique NPE cases.
 *
 * Everything here is pure and deterministic over a {@link FaultPropagationGraph},
 * so it is exhaustively unit-testable without a network.
 *
 * @module ai/agent/fault-role
 */

import type {
  FaultPropagationGraph,
  ServiceCallGraph,
  ServiceId,
} from '@agentix-e/micro-kinetic-core';

/** The deterministic fault role of a service, derived from graph structure. */
export type FaultRole = 'symptom' | 'silent-source-candidate' | 'unclassified';

/**
 * Exception-class substrings that mark a BAD-INPUT exception: thrown by a
 * SYMPTOM while it processes malformed output from an upstream producer. These
 * mirror the prompt's "Semantic clues" (token/JWT and JSON/serialization).
 * Source-side logic exceptions (NullPointerException, IllegalArgumentException,
 * …) are deliberately NOT listed — they are the source's own bug, not bad input.
 */
const BAD_INPUT_EXCEPTION_HINTS = [
  'jwt', // MalformedJwtException, ExpiredJwtException
  'token', // TokenException
  'json', // JsonMappingException, JsonParseException
  'mapping', // JsonMappingException
  'notreadable', // HttpMessageNotReadableException
  'httpmessage', // HttpMessageNotReadableException
  'deserializ', // JsonDeserializationException
  'unmarshal', // UnmarshalException
  'parse', // JsonParseException, ParseException
  'serializ', // SerializationException
] as const;

/** Whether the exception class marks a bad-input (upstream) exception. */
function isBadInputException(exceptionClass: string | undefined): boolean {
  if (!exceptionClass) return false;
  const lower = exceptionClass.toLowerCase();
  return BAD_INPUT_EXCEPTION_HINTS.some((h) => lower.includes(h));
}

/** Services that CALL INTO `id` (edge `from → id`). */
export function upstreamNeighbors(id: ServiceId, callGraph: ServiceCallGraph): ServiceId[] {
  const upstream: ServiceId[] = [];
  for (const e of callGraph.edges) {
    if (e.to === id) upstream.push(e.from);
  }
  return upstream;
}

/** Services that `id` calls (edge `id → to`). */
export function downstreamNeighbors(id: ServiceId, callGraph: ServiceCallGraph): ServiceId[] {
  const downstream: ServiceId[] = [];
  for (const e of callGraph.edges) {
    if (e.from === id) downstream.push(e.to);
  }
  return downstream;
}

/** Whether the service carries a bad-input exception (it threw on bad input). */
function hasBadInputException(id: ServiceId, graph: FaultPropagationGraph): boolean {
  return isBadInputException(graph.deepestExceptions?.get(id));
}

/**
 * Classify a service's fault role from graph structure:
 * - `symptom`: it carries a BAD-INPUT exception (it threw while processing
 *   malformed upstream output) — the source is an upstream producer, not this
 *   service.
 * - `silent-source-candidate`: it has no bad-input exception but a DIRECT
 *   downstream neighbour does — it may be producing the bad input the symptom
 *   throws on.
 * - `unclassified`: neither (healthy, a source-side logic exception like an
 *   NPE, or a multi-hop-upstream service reached one hop at a time).
 */
export function classifyFaultRole(serviceId: ServiceId, graph: FaultPropagationGraph): FaultRole {
  if (hasBadInputException(serviceId, graph)) return 'symptom';
  const downstream = downstreamNeighbors(serviceId, graph.callGraph);
  if (downstream.some((d) => hasBadInputException(d, graph))) return 'silent-source-candidate';
  return 'unclassified';
}

/**
 * Build the concise interpretation hint for a service's fault role, spelling
 * out the causal chain so the model does not have to infer it from the raw
 * anomaly score (which over-weights the symptom's collapse). Returns undefined
 * for `unclassified` (nothing to inject).
 */
export function buildFaultRoleInterpretation(
  serviceId: ServiceId,
  role: FaultRole,
  graph: FaultPropagationGraph,
): string | undefined {
  if (role === 'symptom') {
    const exception = graph.deepestExceptions?.get(serviceId) ?? 'a bad-input exception';
    return `SYMPTOM: throws ${exception} = received bad input; the root cause is an UPSTREAM producer, not this service.`;
  }
  if (role === 'silent-source-candidate') {
    const symptoms = downstreamNeighbors(serviceId, graph.callGraph).filter((d) =>
      hasBadInputException(d, graph),
    );
    return `SILENT SOURCE candidate: no exception, but downstream ${symptoms.join(
      ',',
    )} throws; this service may be producing the bad input.`;
  }
  return undefined;
}
