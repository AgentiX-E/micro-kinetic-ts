/**
 * RCAEval Semantic Topology Enhancer — bridges SemanticAlignmentProvider
 * into the benchmark pipeline to resolve unmatched service names via
 * embedding-based cosine similarity and LLM fallback.
 *
 * Architecture:
 *   1. Exact match (existing) — YAML topology edges whose from/to exactly
 *      match case service IDs. Covers ~56% of TrainTicket services.
 *   2. Semantic match (this module) — for services NOT matched in step 1,
 *      uses TF-IDF embedding cosine similarity to find the best-matching
 *      YAML topology service. If confidence is below threshold, falls back
 *      to LLM semantic inference (DeepSeek, $0.02/day budget).
 *   3. Ring-connect (existing) — only for services that also failed
 *      semantic matching.
 *
 * The enhancer is fully dataset-decoupled: it knows nothing about
 * benchmark-specific formats, only that it receives case service IDs
 * and topology edges with service names from the YAML registry.
 *
 * @module benchmarks/rcaeval-semantic
 */

import type {
  IEmbeddingProvider,
  ILLMProvider,
  SemanticAlignmentConfig,
} from '@agentix-e/micro-kinetic-ai';
import { SemanticAlignmentProvider } from '@agentix-e/micro-kinetic-ai';
import type { CallEdge, ServiceDescriptor } from '@agentix-e/micro-kinetic-core';

// ── Enhanced Edge ─────────────────────────────────────────

/**
 * Extended CallEdge carrying provenance metadata from semantic alignment.
 *
 * Distinguishable from exact YAML matches and ring-connect fallbacks
 * via `_diag_source` diagnostic labels.
 */
export interface SemanticCallEdge extends CallEdge {
  /** Provenance: 'exact-yaml' | 'semantic-embedding' | 'semantic-llm' | 'ring-connect' */
  readonly source: 'exact-yaml' | 'semantic-embedding' | 'semantic-llm' | 'ring-connect';
  /** Confidence score from the matching method (1.0 for exact, 0-1 for semantic). */
  readonly matchConfidence: number;
}

// ── Enhancer Input/Output ─────────────────────────────────

/**
 * Input to the semantic enhancer.
 */
export interface SemanticEnhancementInput {
  /** Case service IDs that were NOT matched by exact YAML lookup. */
  readonly unmatchedCaseServiceIds: readonly string[];
  /** All YAML topology edges for this system (full set, unfiltered). */
  readonly yamlTopologyEdges: readonly CallEdge[];
  /** All YAML topology service IDs (from/to names in the edge set). */
  readonly yamlServiceIds: readonly string[];
  /** System name for diagnostic labels. */
  readonly system: string;
}

/**
 * Output of semantic enhancement.
 */
export interface SemanticEnhancementOutput {
  /** New edges discovered via semantic alignment. */
  readonly edges: readonly SemanticCallEdge[];
  /** Count of services resolved by embedding (not LLM). */
  readonly embeddingResolvedCount: number;
  /** Count of services resolved by LLM fallback. */
  readonly llmResolvedCount: number;
  /** Count of services that remain unresolved after semantic matching. */
  readonly stillUnmatchedCount: number;
  /** Which case service IDs are now connected (via semantic edges). */
  readonly resolvedServiceIds: readonly string[];
  /** Which case service IDs remain unmatched. */
  readonly unresolvedServiceIds: readonly string[];
  /** Average confidence across all semantic matches. */
  readonly averageConfidence: number;
}

// ── Configuration ─────────────────────────────────────────

/**
 * Configuration for the semantic enhancer.
 */
export interface SemanticEnhancerConfig {
  /** Embedding provider (default: none — no semantic enhancement). */
  readonly embeddingProvider?: IEmbeddingProvider;
  /** LLM provider for fallback (default: none). */
  readonly llmProvider?: ILLMProvider;
  /** Alignment config overrides. */
  readonly alignmentConfig?: Partial<SemanticAlignmentConfig>;
}

// ── Enhancer ──────────────────────────────────────────────

/**
 * Enhances unmatched benchmark services with semantic topology edges.
 *
 * Usage:
 * ```typescript
 * const enhancer = new RCAEvalSemanticEnhancer({
 *   embeddingProvider: new TfIdfEmbeddingProvider(),
 *   llmProvider: deepSeekProvider,
 * });
 *
 * const result = enhancer.enhance({
 *   unmatchedCaseServiceIds: ['ts-weird-name-svc'],
 *   yamlTopologyEdges: trainTicketEdges,
 *   yamlServiceIds: trainTicketServiceIds,
 *   system: 'TrainTicket',
 * });
 * ```
 */
export class RCAEvalSemanticEnhancer {
  private readonly alignmentProvider: SemanticAlignmentProvider | null;
  private readonly embedProvider: IEmbeddingProvider | null;
  private readonly hasEmbedding: boolean;

  constructor(config: SemanticEnhancerConfig = {}) {
    this.hasEmbedding = Boolean(config.embeddingProvider);
    this.embedProvider = config.embeddingProvider ?? null;

    if (config.embeddingProvider) {
      this.alignmentProvider = new SemanticAlignmentProvider(
        config.embeddingProvider,
        config.llmProvider ?? null,
        {
          ...config.alignmentConfig,
          embeddingThreshold: config.alignmentConfig?.embeddingThreshold ?? 0.6,
          llmThreshold: config.alignmentConfig?.llmThreshold ?? 0.5,
        },
      );
    } else {
      this.alignmentProvider = null;
    }
  }

  /**
   * Whether semantic enhancement is available (embedding provider is configured).
   */
  get isAvailable(): boolean {
    return this.alignmentProvider !== null && this.hasEmbedding;
  }

  // ── Enhancement ───────────────────────────────────────

  /**
   * Enhance unmatched services with semantic topology edges.
   *
   * Workflow:
   * 1. Convert YAML topology services → ServiceDescriptor[]
   * 2. Call SemanticAlignmentProvider.align(unmatched, descriptors)
   * 3. For each matched service, create edges inferred from its alias' topology
   * 4. Return enhanced edge set + statistics
   */
  async enhance(input: SemanticEnhancementInput): Promise<SemanticEnhancementOutput> {
    if (input.unmatchedCaseServiceIds.length === 0) {
      return {
        edges: [],
        embeddingResolvedCount: 0,
        llmResolvedCount: 0,
        stillUnmatchedCount: 0,
        resolvedServiceIds: [],
        unresolvedServiceIds: [],
        averageConfidence: 0,
      };
    }

    if (!this.alignmentProvider) {
      // No embedding provider → all unmatched
      return {
        edges: [],
        embeddingResolvedCount: 0,
        llmResolvedCount: 0,
        stillUnmatchedCount: input.unmatchedCaseServiceIds.length,
        resolvedServiceIds: [],
        unresolvedServiceIds: [...input.unmatchedCaseServiceIds],
        averageConfidence: 0,
      };
    }

    // Phase 1: Align unmatched case services → YAML topology services
    const yamlDescriptors = this.buildServiceDescriptors(input.yamlServiceIds, input.system);
    const alignment = await this.alignmentProvider.align(
      input.unmatchedCaseServiceIds,
      yamlDescriptors,
    );

    // Phase 2: Create topology edges for aligned services
    const yamlEdgeMap = this.buildEdgeMap(input.yamlTopologyEdges);
    const edges: SemanticCallEdge[] = [];
    const resolved = new Set<string>();
    let embeddingResolved = 0;
    let llmResolved = 0;

    for (const svcId of input.unmatchedCaseServiceIds) {
      const matched = alignment.matches.get(svcId);
      if (!matched) continue;

      // Determine source: check if this was a low-confidence match that needed LLM
      const isLLM = this.isLLMResolved(svcId, alignment.lowConfidence);

      if (isLLM) {
        llmResolved++;
      } else {
        embeddingResolved++;
      }

      // Find all edges where the matched YAML alias is the source
      const aliasEdges = yamlEdgeMap.get(matched) ?? [];
      for (const edge of aliasEdges) {
        edges.push({
          from: svcId, // use the CASE service id as the node
          to: edge.to,
          type: edge.type,
          callRate: edge.callRate,
          p99Latency: edge.p99Latency,
          errorRate: edge.errorRate,
          source: isLLM ? 'semantic-llm' : 'semantic-embedding',
          matchConfidence: this.getConfidence(svcId, alignment.lowConfidence),
        });
      }

      // Also find edges where the matched alias is the target
      for (const [fromAlias, outgoing] of yamlEdgeMap) {
        for (const edge of outgoing) {
          if (edge.to === matched) {
            edges.push({
              from: edge.from,
              to: svcId, // use the CASE service id as the node
              type: edge.type,
              callRate: edge.callRate,
              p99Latency: edge.p99Latency,
              errorRate: edge.errorRate,
              source: isLLM ? 'semantic-llm' : 'semantic-embedding',
              matchConfidence: this.getConfidence(svcId, alignment.lowConfidence),
            });
          }
        }
      }

      resolved.add(svcId);
    }

    const stillUnmatched = input.unmatchedCaseServiceIds.filter((s) => !resolved.has(s));

    // ── Phase 3: Pairwise semantic edge discovery ──────────
    // For services that cannot be matched to any YAML entry,
    // compute pairwise embedding similarity to discover
    // propagation edges without relying on YAML topology.
    // This prevents ring-connecting (which uses default weights
    // with no Pearson correlation signal) for semantically
    // related services — the root cause of TrainTicket 0% accuracy.
    if (stillUnmatched.length >= 2 && this.alignmentProvider) {
      const pairwiseEdges = await this.discoverPairwiseEdges(
        stillUnmatched,
        input.system,
        yamlEdgeMap,
      );
      for (const edge of pairwiseEdges) {
        edges.push(edge);
      }
    }

    const avgConf =
      edges.length > 0 ? edges.reduce((sum, e) => sum + e.matchConfidence, 0) / edges.length : 0;

    return {
      edges,
      embeddingResolvedCount: embeddingResolved,
      llmResolvedCount: llmResolved,
      stillUnmatchedCount: stillUnmatched.length,
      resolvedServiceIds: [...resolved],
      unresolvedServiceIds: stillUnmatched,
      averageConfidence: avgConf,
    };
  }

  // ── Phase 3 Implementation ──────────────────────────────

  /**
   * Discover pairwise semantic edges between unmatched services.
   *
   * Embeds all unmatched service names, computes pairwise cosine
   * similarity, and creates semantic call edges for pairs above
   * the similarity threshold.
   *
   * This fills the gap between YAML topology (exact matches) and
   * ring-connect (no propagation signal) with embedding-based
   * edges that carry propagation weights.
   *
   * Complexity: O(k²) pairwise comparisons for k services.
   * For TrainTicket (k≈23), this is ~253 comparisons.
   */
  private async discoverPairwiseEdges(
    unmatchedServices: string[],
    system: string,
    yamlEdgeMap: Map<string, SemanticCallEdge[]>,
  ): Promise<SemanticCallEdge[]> {
    if (!this.alignmentProvider) return [];

    const descriptors: ServiceDescriptor[] = unmatchedServices.map((id) => ({
      id,
      name: id,
      namespace: system,
      labels: {},
    }));

    const queryTexts = unmatchedServices.map((id) => [id, system].filter(Boolean).join(' '));

    if (!this.hasEmbedding) return [];

    // Compute pairwise cosine similarity via batch embedding
    const { vectors } = await this.embedProvider!.embed(queryTexts);
    if (!vectors || vectors.length < 2) return [];

    const edges: SemanticCallEdge[] = [];
    const SIMILARITY_THRESHOLD = 0.65;

    for (let i = 0; i < unmatchedServices.length; i++) {
      for (let j = i + 1; j < unmatchedServices.length; j++) {
        const similarity = this.cosineSimilarity(vectors[i]!, vectors[j]!);
        if (similarity < SIMILARITY_THRESHOLD) continue;

        const svcI = unmatchedServices[i]!;
        const svcJ = unmatchedServices[j]!;

        // Create bidirectional edges for high-similarity pairs
        edges.push({
          from: svcI,
          to: svcJ,
          type: 'REST',
          callRate: 100,
          p99Latency: similarity < 0.8 ? 150 : 50,
          errorRate: 0.01,
          source: 'semantic-embedding',
          matchConfidence: similarity,
        });

        edges.push({
          from: svcJ,
          to: svcI,
          type: 'REST',
          callRate: 100,
          p99Latency: similarity < 0.8 ? 150 : 50,
          errorRate: 0.01,
          source: 'semantic-embedding',
          matchConfidence: similarity,
        });
      }
    }

    return edges;
  }

  /**
   * Compute cosine similarity between two float vectors.
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom > 0 ? dot / denom : 0;
  }

  // ── Helpers ────────────────────────────────────────────

  /**
   * Build ServiceDescriptor array from YAML service IDs.
   */
  private buildServiceDescriptors(
    yamlServiceIds: readonly string[],
    system: string,
  ): ServiceDescriptor[] {
    return yamlServiceIds.map((id) => ({
      id,
      name: id,
      namespace: system,
      labels: [],
    }));
  }

  /**
   * Build a map from source service ID → outgoing edges.
   */
  private buildEdgeMap(edges: readonly CallEdge[]): Map<string, CallEdge[]> {
    const map = new Map<string, CallEdge[]>();
    for (const edge of edges) {
      const list = map.get(edge.from) ?? [];
      list.push(edge);
      map.set(edge.from, list);
    }
    return map;
  }

  /**
   * Check if a service was resolved via LLM (was in lowConfidence list).
   */
  private isLLMResolved(
    svcId: string,
    lowConfidence: readonly Array<{
      spanService: string;
      candidates: Array<{ topologyId: string; confidence: number }>;
    }>,
  ): boolean {
    return lowConfidence.some((lc) => lc.spanService === svcId && lc.candidates.length > 0);
  }

  /**
   * Extract confidence from alignment result for a service.
   */
  private getConfidence(
    svcId: string,
    lowConfidence: readonly Array<{
      spanService: string;
      candidates: Array<{ topologyId: string; confidence: number }>;
    }>,
  ): number {
    const lc = lowConfidence.find((l) => l.spanService === svcId);
    return lc?.candidates[0]?.confidence ?? 0.85;
  }
}
