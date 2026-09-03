/**
 * TopologyFusion orchestrator — multi-source topology discovery with confidence-weighted merging.
 *
 * Combines results from multiple ITopologyProvider instances:
 *   1. StaticTopologyProvider — pre-authored YAML configs (confidence 0.9)
 *   2. SemanticAlignmentProvider — embedding/LLM service name matching (confidence 0.8)
 *   3. TraceTopologyProvider — span parent-child edges from trace data (confidence 0.95)
 *
 * Each provider returns a partial graph; fusion merges edges with confidence-weighted
 * priority. Highest-confidence edge for each (from, to) pair wins. Unmatched services
 * are ring-connected to ensure engine completeness.
 *
 * The orchestrator is fully dataset-decoupled — it works with any ITopologyProvider
 * without knowledge of benchmark-specific formats.
 *
 * @module causal/orchestrators/topology-fusion
 */

import type {
  CallEdge,
  EdgeType,
  ITopologyProvider,
  ServiceCallGraph,
  ServiceNode,
  TopologyDiscoveryContext,
} from '@agentix-e/micro-kinetic-core';

// ── Fusion Result ────────────────────────────────────────

/**
 * Enriched edge with fusion confidence metadata.
 */
export interface FusedEdge extends CallEdge {
  /** Which provider contributed this edge. */
  readonly providerId: string;
  /** Confidence score from the winning provider (0-1). */
  readonly fusedConfidence: number;
  /** Human-readable provenance chain. */
  readonly provenance: string;
}

/**
 * Result of a topology fusion operation.
 */
export interface TopologyFusionResult {
  /** The fused service call graph. */
  readonly graph: ServiceCallGraph;
  /** Total number of fused edges (excluding ring-connect). */
  readonly fusedEdgeCount: number;
  /** Edges contributed by each provider (providerId → count). */
  readonly providerContributions: ReadonlyMap<string, number>;
  /** Number of ring-connect edges added for unmatched services. */
  readonly ringConnectCount: number;
  /** Total confidence score across all edges. */
  readonly totalConfidence: number;
  /** Average confidence per fused edge (0-1). */
  readonly averageConfidence: number;
}

// ── Config ────────────────────────────────────────────────

/**
 * Configuration for topology fusion.
 */
export interface TopologyFusionConfig {
  /** Providers ordered by priority (highest confidence first). */
  readonly providers: readonly ITopologyProvider[];
  /** Whether to ring-connect unmatched services (default: true). */
  readonly ringConnectUnmatched: boolean;
  /** Edge type for ring-connect edges (default: REST). */
  readonly ringConnectType: EdgeType;
  /** Minimum confidence to accept a provider edge (default: 0). */
  readonly minEdgeConfidence: number;
}

export const DEFAULT_TOPOLOGY_FUSION_CONFIG: Omit<TopologyFusionConfig, 'providers'> =
  Object.freeze({
    ringConnectUnmatched: true,
    ringConnectType: 'REST' as const,
    minEdgeConfidence: 0,
  });

// ── Orchestrator ─────────────────────────────────────────

/**
 * Topology fusion orchestrator.
 *
 * Usage:
 * ```typescript
 * const fusion = new TopologyFusion({
 *   providers: [traceProvider, staticProvider, semanticProvider],
 * });
 * const result = await fusion.discover({ knownServiceIds: [...] });
 * ```
 */
export class TopologyFusion {
  private readonly config: TopologyFusionConfig;

  constructor(config: TopologyFusionConfig) {
    this.config = {
      ...DEFAULT_TOPOLOGY_FUSION_CONFIG,
      ...config,
    };
  }

  /**
   * Registered providers in their priority order.
   */
  get providers(): readonly ITopologyProvider[] {
    return this.config.providers;
  }

  // ── Discovery ─────────────────────────────────────────

  /**
   * Discover the fused service call graph.
   *
   * Queries all registered providers, merges their results with
   * confidence-weighted priority, and ring-connects unmatched services.
   *
   * @param context - Discovery context with known service IDs.
   * @returns Fused topology result.
   */
  async discover(context: TopologyDiscoveryContext): Promise<TopologyFusionResult> {
    const providerResults = await this.queryAllProviders(context);

    // Phase 1: Merge edges with confidence-weighted priority
    const { edges: fusedEdges, contributions } = this.mergeEdges(providerResults);

    // Phase 2: Build the final graph with nodes and edges
    const nodes = new Map<string, ServiceNode>();
    for (const id of context.knownServiceIds) {
      nodes.set(id, {
        id,
        name: id,
        namespace: context.namespace ?? 'unknown',
        labels: {},
      });
    }

    // Phase 3: Ring-connect unmatched services
    let ringConnectCount = 0;
    if (this.config.ringConnectUnmatched) {
      const svcSet = new Set(context.knownServiceIds);
      const connectedSvcs = new Set<string>();
      for (const edge of fusedEdges) {
        connectedSvcs.add(edge.from);
        connectedSvcs.add(edge.to);
      }

      const unmatched: string[] = [];
      for (const svc of svcSet) {
        if (!connectedSvcs.has(svc)) unmatched.push(svc);
      }

      if (unmatched.length > 1) {
        // Ring-connect unmatched services: a → b → c → ... → a
        for (let i = 0; i < unmatched.length; i++) {
          const from = unmatched[i]!;
          const to = unmatched[(i + 1) % unmatched.length]!;
          // No `from === to` self-loop guard: `unmatched` is built from a Set of
          // unique service IDs and this loop only runs when `unmatched.length > 1`,
          // so `unmatched[i]` and `unmatched[(i+1) % length]` are always distinct.
          fusedEdges.push({
            from,
            to,
            type: this.config.ringConnectType,
            callRate: 1,
            p99Latency: 10,
            errorRate: 0,
            providerId: 'ring-connect',
            fusedConfidence: 0,
            provenance: 'ring-connect: unmatched service fallback',
          });
          ringConnectCount++;
        }
      }
    }

    // Compute statistics
    const totalConfidence = fusedEdges.reduce((sum, e) => sum + e.fusedConfidence, 0);
    const fusedEdgeCount = fusedEdges.length - ringConnectCount;

    return {
      graph: { nodes, edges: fusedEdges, systemLoad: 0 },
      fusedEdgeCount,
      providerContributions: contributions,
      ringConnectCount,
      totalConfidence,
      averageConfidence: fusedEdges.length > 0 ? totalConfidence / fusedEdges.length : 0,
    };
  }

  // ── Private Methods ────────────────────────────────────

  /**
   * Query all registered providers in parallel.
   */
  private async queryAllProviders(context: TopologyDiscoveryContext): Promise<
    Array<{
      provider: ITopologyProvider;
      graph: ServiceCallGraph;
    }>
  > {
    const results: Array<{
      provider: ITopologyProvider;
      graph: ServiceCallGraph;
    }> = [];

    // Query providers in parallel for performance
    const queries = this.config.providers.map(async (provider) => {
      try {
        const available = await provider.isAvailable();
        if (!available) return null;

        const graph = await provider.discover(context);
        return { provider, graph };
      } catch {
        // Provider throws → skip gracefully
        return null;
      }
    });

    const settled = await Promise.all(queries);
    for (const result of settled) {
      if (result) results.push(result);
    }

    return results;
  }

  /**
   * Merge edges from multiple providers with confidence-weighted priority.
   *
   * For each (from, to) pair, the edge with the highest provider confidence wins.
   * When two providers have the same confidence, the one earlier in the provider
   * list (higher priority) wins.
   */
  private mergeEdges(
    providerResults: Array<{
      provider: ITopologyProvider;
      graph: ServiceCallGraph;
    }>,
  ): {
    edges: FusedEdge[];
    contributions: Map<string, number>;
  } {
    const edgeMap = new Map<string, FusedEdge>();
    const contributions = new Map<string, number>();

    // Process providers in priority order (first = highest priority)
    for (const { provider, graph } of providerResults) {
      const confidence = provider.meta.baseConfidence;

      for (const edge of graph.edges) {
        const key = `${edge.from}→${edge.to}`;

        // Only add if no higher-confidence edge exists for this pair
        const existing = edgeMap.get(key);
        if (!existing || confidence > existing.fusedConfidence) {
          edgeMap.set(key, {
            ...edge,
            providerId: provider.meta.id,
            fusedConfidence: confidence,
            provenance: `${provider.meta.id} (confidence: ${confidence.toFixed(2)})`,
          });

          // Track contributions
          contributions.set(provider.meta.id, (contributions.get(provider.meta.id) ?? 0) + 1);
        }
      }
    }

    return { edges: Array.from(edgeMap.values()), contributions };
  }
}

// ── Factory Helpers ──────────────────────────────────────

/**
 * Create a TopologyFusion instance with trace + static + semantic providers.
 *
 * This is the recommended default setup for production use.
 */
export function createDefaultTopologyFusion(
  providers: readonly ITopologyProvider[],
): TopologyFusion {
  return new TopologyFusion({
    ...DEFAULT_TOPOLOGY_FUSION_CONFIG,
    providers: [...providers],
  });
}
