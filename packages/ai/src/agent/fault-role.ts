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

/** Whether the service carries a logic exception (it threw on bad input). */
function hasLogicException(id: ServiceId, graph: FaultPropagationGraph): boolean {
  return graph.deepestExceptions?.has(id) ?? false;
}

/**
 * Classify a service's fault role from graph structure:
 * - `symptom`: it carries a logic exception (it threw while processing bad
 *   input) — the source is an upstream producer, not this service.
 * - `silent-source-candidate`: it has no logic exception but a DIRECT
 *   downstream neighbour does — it may be producing the bad input the symptom
 *   throws on.
 * - `unclassified`: neither (a healthy, connectivity-only, or multi-hop-upstream
 *   service; the stepwise walk reaches deeper sources one hop at a time).
 */
export function classifyFaultRole(serviceId: ServiceId, graph: FaultPropagationGraph): FaultRole {
  if (hasLogicException(serviceId, graph)) return 'symptom';
  const downstream = downstreamNeighbors(serviceId, graph.callGraph);
  if (downstream.some((d) => hasLogicException(d, graph))) return 'silent-source-candidate';
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
    const exception = graph.deepestExceptions?.get(serviceId) ?? 'a logic exception';
    return `SYMPTOM: throws ${exception} = received bad input; the root cause is an UPSTREAM producer, not this service.`;
  }
  if (role === 'silent-source-candidate') {
    const symptoms = downstreamNeighbors(serviceId, graph.callGraph).filter((d) =>
      hasLogicException(d, graph),
    );
    return `SILENT SOURCE candidate: no exception, but downstream ${symptoms.join(
      ',',
    )} throws; this service may be producing the bad input.`;
  }
  return undefined;
}
