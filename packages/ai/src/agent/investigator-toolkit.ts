/**
 * Deterministic, closed tool surface for the graph-guided root-cause
 * investigator (GALA+ phase-III).
 *
 * The toolkit exposes read-only actions over a {@link FaultPropagationGraph}:
 * the agent lists its seed candidates, reads one service's evidence, and
 * navigates the dependency graph upstream/downstream. Every action is a pure,
 * deterministic read — the agent can never fabricate a service or an edge, so
 * the LLM stays grounded in the real topology and the deterministic fallback
 * is trivial.
 *
 * @module ai/agent
 */

import type {
  FaultPropagationGraph,
  ServiceCallGraph,
  ServiceId,
} from '@agentix-e/micro-kinetic-core';
import type { CandidateEvidence } from '../interfaces/reranker.js';
import {
  buildFaultRoleInterpretation,
  classifyFaultRole,
  downstreamNeighbors,
  upstreamNeighbors,
} from './fault-role.js';

/**
 * Compact adjacency summary for a service: its upstream and downstream
 * neighbours in the call graph, e.g. `"upstream=[a,b] downstream=[c]"`.
 *
 * @param id - The service to summarise.
 * @param callGraph - The call graph.
 * @returns The summary, or undefined when the service has no neighbours.
 */
export function buildAdjacency(id: ServiceId, callGraph: ServiceCallGraph): string | undefined {
  const upstream = upstreamNeighbors(id, callGraph);
  const downstream = downstreamNeighbors(id, callGraph);
  if (upstream.length === 0 && downstream.length === 0) return undefined;
  const parts: string[] = [];
  if (upstream.length > 0) parts.push(`upstream=[${upstream.join(',')}]`);
  if (downstream.length > 0) parts.push(`downstream=[${downstream.join(',')}]`);
  return parts.join(' ');
}

/**
 * Build the per-service evidence block the LLM reasons over: the anomaly
 * score, dominant metric with its head/tail shift, the feature decomposition,
 * the deepest exception class, and the adjacency summary.
 *
 * @param serviceId - The service to describe.
 * @param graph - The fault propagation graph.
 * @returns The evidence block (with `serviceId` set; optional fields sparse).
 */
export function buildCandidateEvidence(
  serviceId: ServiceId,
  graph: FaultPropagationGraph,
): CandidateEvidence {
  const node = graph.callGraph.nodes.get(serviceId);
  const dominant = graph.dominantMetrics?.get(serviceId);
  const anomaly = graph.anomalyScores.get(serviceId);
  const faultRole = classifyFaultRole(serviceId, graph);

  return {
    serviceId,
    name: node?.name,
    anomalyScore: anomaly,
    dominantMetric: dominant?.label,
    metricShift:
      dominant && (dominant.head.length > 0 || dominant.tail.length > 0)
        ? `head=[${dominant.head.join(',')}] tail=[${dominant.tail.join(',')}]`
        : undefined,
    breakdown: dominant?.breakdown,
    deepestLogException: graph.deepestExceptions?.get(serviceId),
    adjacency: buildAdjacency(serviceId, graph.callGraph),
    faultRole,
    interpretation: buildFaultRoleInterpretation(serviceId, faultRole, graph),
  };
}

/**
 * The closed action surface an investigator agent can call.
 *
 * Every method is synchronous and side-effect-free except the hop accounting
 * (`consumeHop`), which is the agent loop's own budget, not a graph mutation.
 */
export interface InvestigatorToolkit {
  /** The total hop budget the agent is allowed. */
  readonly maxHops: number;
  /** The seed candidates (the deterministic top-K), as evidence blocks. */
  getCandidates(): readonly CandidateEvidence[];
  /** Full evidence for one service, or null when the service is unknown. */
  getEvidence(serviceId: ServiceId): CandidateEvidence | null;
  /** Services that CALL INTO `serviceId` (edge `from → serviceId`). */
  getUpstream(serviceId: ServiceId): readonly ServiceId[];
  /** Services that `serviceId` calls (edge `serviceId → to`). */
  getDownstream(serviceId: ServiceId): readonly ServiceId[];
  /** Hop budget remaining (never negative). */
  remainingHops(): number;
  /** Spend one hop; returns false when the budget is already exhausted. */
  consumeHop(): boolean;
}

/**
 * The default, graph-backed {@link InvestigatorToolkit}.
 */
export class GraphInvestigatorToolkit implements InvestigatorToolkit {
  public readonly maxHops: number;
  private readonly graph: FaultPropagationGraph;
  private readonly seeds: readonly ServiceId[];
  private hopsUsed = 0;

  /**
   * @param graph - The fault propagation graph to navigate.
   * @param seeds - The deterministic top-K service IDs (the agent's start point).
   * @param maxHops - The hop budget (≥ 0).
   */
  constructor(graph: FaultPropagationGraph, seeds: readonly ServiceId[], maxHops = 6) {
    this.graph = graph;
    this.seeds = seeds;
    this.maxHops = maxHops < 0 ? 0 : maxHops;
  }

  getCandidates(): readonly CandidateEvidence[] {
    return this.seeds.map((s) => buildCandidateEvidence(s, this.graph));
  }

  getEvidence(serviceId: ServiceId): CandidateEvidence | null {
    if (!this.graph.callGraph.nodes.has(serviceId)) return null;
    return buildCandidateEvidence(serviceId, this.graph);
  }

  getUpstream(serviceId: ServiceId): readonly ServiceId[] {
    const upstream: ServiceId[] = [];
    for (const e of this.graph.callGraph.edges) {
      if (e.to === serviceId) upstream.push(e.from);
    }
    return upstream;
  }

  getDownstream(serviceId: ServiceId): readonly ServiceId[] {
    const downstream: ServiceId[] = [];
    for (const e of this.graph.callGraph.edges) {
      if (e.from === serviceId) downstream.push(e.to);
    }
    return downstream;
  }

  remainingHops(): number {
    return this.maxHops - this.hopsUsed;
  }

  consumeHop(): boolean {
    if (this.hopsUsed >= this.maxHops) return false;
    this.hopsUsed += 1;
    return true;
  }
}
