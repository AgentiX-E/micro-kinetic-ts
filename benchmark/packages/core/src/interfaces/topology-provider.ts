/**
 * Topology discovery provider interface.
 *
 * Defines the contract for service call graph discovery in micro-kinetic.
 * Providers can source topology from static declarations (K8s manifests,
 * Docker Compose, Consul), dynamic observation (eBPF, Istio, APM traces),
 * or semantic inference (LLM-augmented). The topology discovery orchestrator
 * fuses multiple providers with confidence-weighted edge merging.
 *
 * Design follows the AgentiX-E pattern: interfaces in core, implementations
 * in node/cluster/federation layers. Providers are registered via DI tokens.
 *
 * @module interfaces/topology-provider
 */

import type { ServiceCallGraph } from '../types/graph.js';

// ── Provider Metadata ────────────────────────────────────

/**
 * Metadata about a topology provider for discovery and debugging.
 */
export interface TopologyProviderMeta {
  /** Unique provider identifier (e.g., "kubernetes", "ebpf", "llm-deepseek"). */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string;
  /** Discovery method category. */
  readonly method: 'static' | 'dynamic' | 'semantic';
  /** Base confidence weight for edges discovered by this provider (0-1). */
  readonly baseConfidence: number;
  /** Whether this provider is always enabled or conditionally available. */
  readonly availability: 'always' | 'conditional';
}

// ── Discovery Context ─────────────────────────────────────

/**
 * Context passed to topology providers during discovery.
 *
 * Enables providers to make informed decisions about which services
 * to analyze, which namespaces to scope, and what external hints
 * (e.g., infrastructure-as-code manifests) are available.
 */
export interface TopologyDiscoveryContext {
  /** Service IDs known to the system (may be empty for initial discovery). */
  readonly knownServiceIds: readonly string[];
  /** Namespace or cluster scope for discovery. */
  readonly namespace?: string;
  /** Arbitrary hints passed to providers (e.g., K8s API endpoint, config paths). */
  readonly hints?: Readonly<Record<string, string>>;
}

// ── Core Provider Interface ───────────────────────────────

/**
 * Topology discovery provider — discovers service call graph edges.
 *
 * Each provider implements a specific discovery method (static, dynamic,
 * or semantic) and returns a partial call graph with confidence-weighted
 * edges. The topology discovery orchestrator fuses multiple providers.
 *
 * Providers are registered via the DI container:
 * ```typescript
 * container.register(DI_TOKENS.TOPOLOGY_PROVIDER, () => new KubernetesProvider());
 * ```
 */
export interface ITopologyProvider {
  /** Provider metadata for fusion weighting and debugging. */
  readonly meta: TopologyProviderMeta;

  /**
   * Discover service topology from this provider's data source.
   *
   * @param context - Discovery context with known services and hints.
   * @returns Partial service call graph with provider-confident edges.
   *          May return an empty graph if no topology is discoverable.
   */
  discover(context: TopologyDiscoveryContext): Promise<ServiceCallGraph>;

  /**
   * Check whether this provider is available in the current environment.
   *
   * For conditional providers (e.g., eBPF requires Linux kernel ≥5.4,
   * K8s requires kubeconfig), this returns false if prerequisites aren't met.
   */
  isAvailable(): Promise<boolean>;
}

// ── LLM-Specific Provider Interface ───────────────────────

/**
 * Extended interface for LLM-based topology providers.
 *
 * LLM providers have additional requirements:
 * - Structured output validation (Zod schema)
 * - Error-feedback retry with exponential backoff
 * - Confidence calibration
 * - Cost tracking per inference call
 */
export interface ILLMTopologyProvider extends ITopologyProvider {
  readonly meta: TopologyProviderMeta & { method: 'semantic' };

  /**
   * Get the estimated cost of the next discovery call.
   * Helps callers implement cost control (e.g., skip if > budget).
   */
  estimateCost(context: TopologyDiscoveryContext): Promise<CostEstimate>;

  /**
   * Get the total cost incurred by this provider since initialization.
   */
  readonly totalCost: CostEstimate;

  /**
   * Reset cost counter (useful for billing periods).
   */
  resetCost(): void;
}

// ── Cost Tracking ─────────────────────────────────────────

/**
 * Cost estimate or actual cost for an LLM inference call.
 */
export interface CostEstimate {
  /** Input tokens consumed. */
  readonly inputTokens: number;
  /** Output tokens consumed. */
  readonly outputTokens: number;
  /** Estimated or actual cost in USD. */
  readonly costUSD: number;
  /** Provider model used. */
  readonly model: string;
}

// ── Edge Confidence ───────────────────────────────────────

/**
 * Per-edge confidence metadata attached by topology providers.
 *
 * Stored in the edge metadata to enable weighted fusion by the
 * topology discovery orchestrator.
 */
export interface EdgeConfidence {
  /** Which provider discovered this edge. */
  readonly providerId: string;
  /** Provider-assigned confidence (0-1). */
  readonly confidence: number;
  /** Human-readable reasoning for audit/debugging. */
  readonly reasoning: string;
}
