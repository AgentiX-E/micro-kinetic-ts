/**
 * Semantic alignment provider — maps unknown span service names to known topology IDs.
 *
 * Uses embedding-based cosine similarity as the primary matching mechanism (zero cost).
 * When confidence is low, falls back to LLM inference with 24h caching and daily cost cap.
 *
 * Architecture:
 *   Primary: Embedding cosine similarity (covers ~95% of cases, zero API cost)
 *   Fallback: LLM semantic matching (covers ~5% of edge cases, $0.02/day budget)
 *
 * The provider is fully dataset-decoupled — it works with any service name pairs
 * without knowledge of any specific benchmark format.
 *
 * @module ai/providers/semantic-alignment
 */

import type {
  AlignmentFallbackStrategy,
  EntityAlignmentResult,
  IEmbeddingProvider,
  ServiceDescriptor,
} from '../interfaces/embedding-provider.js';
import type { ILLMProvider } from '../interfaces/llm-provider.js';
import { cosineSimilarity } from '../utils/similarity.js';

// ── Configuration ────────────────────────────────────────

/**
 * Configuration for the semantic alignment provider.
 */
export interface SemanticAlignmentConfig {
  /** Minimum cosine similarity to accept an embedding match (default: 0.7). */
  readonly embeddingThreshold: number;
  /** Minimum confidence for LLM matches (default: 0.6). */
  readonly llmThreshold: number;
  /** Fallback strategy when no match is found (default: 'best-effort'). */
  readonly fallbackStrategy: AlignmentFallbackStrategy;
  /** Maximum daily LLM cost in USD (default: 0.02). */
  readonly dailyCostCapUSD: number;
  /** Cache TTL for LLM results in milliseconds (default: 24h). */
  readonly cacheTtlMs: number;
}

export const DEFAULT_SEMANTIC_ALIGNMENT_CONFIG: SemanticAlignmentConfig = Object.freeze({
  embeddingThreshold: 0.7,
  llmThreshold: 0.6,
  fallbackStrategy: 'best-effort' as const,
  dailyCostCapUSD: 0.02,
  cacheTtlMs: 24 * 60 * 60 * 1000,
});

// ── Cache Entry ──────────────────────────────────────────

interface LlmCacheEntry {
  result: string;
  confidence: number;
  timestamp: number;
}

// ── Provider Implementation ──────────────────────────────

/**
 * Semantic alignment provider for service name matching.
 *
 * Takes unknown span service names and maps them to known topology service IDs
 * using a two-tier strategy:
 *
 * 1. **Embedding primary** — compute cosine similarity between span service name
 *    and each topology service descriptor. Accept matches above embeddingThreshold.
 *    This handles ~95% of cases at zero cost.
 *
 * 2. **LLM fallback** — for low-confidence embedding matches, invoke LLM to resolve
 *    semantic aliases like "order-service" ↔ "purchase-handler". Results are cached
 *    for 24h to avoid duplicate calls.
 *
 * Usage:
 * ```typescript
 * const provider = new SemanticAlignmentProvider(tfidfEmbedding, llmProvider);
 * const result = await provider.align(spanServices, topologyDescriptors);
 * ```
 */
export class SemanticAlignmentProvider {
  /** Provider metadata for logging. */
  public readonly id = 'semantic-alignment';

  /** Accumulated LLM cost for the current day (resets on next day). */
  private dailyCost = 0;
  private currentDay = '';

  /** LLM result cache (serviceName → cache entry). */
  private readonly llmCache = new Map<string, LlmCacheEntry>();

  /**
   * @param embeddingProvider - Primary embedding provider (e.g., TF-IDF).
   * @param llmProvider - Optional LLM provider for fallback matching.
   * @param config - Alignment configuration.
   */
  constructor(
    private readonly embeddingProvider: IEmbeddingProvider,
    private readonly llmProvider: ILLMProvider | null = null,
    private readonly config: SemanticAlignmentConfig = DEFAULT_SEMANTIC_ALIGNMENT_CONFIG,
  ) {}

  // ── Public API ─────────────────────────────────────────

  /**
   * Align unknown span service names to known topology service IDs.
   *
   * @param spanServices - Unknown service names from spans/traces.
   * @param topologyServices - Known topology service descriptors.
   * @returns EntityAlignmentResult with matches and low-confidence entries.
   */
  async align(
    spanServices: readonly string[],
    topologyServices: readonly ServiceDescriptor[],
  ): Promise<EntityAlignmentResult> {
    // Phase 1: Embedding-based matching (primary, zero cost)
    const embeddingResults = await this.alignByEmbedding(spanServices, topologyServices);

    // Separate high-confidence matches from low-confidence ones
    const matches = new Map<string, string>();
    const lowConfidence: Array<{
      spanService: string;
      candidates: Array<{ topologyId: string; confidence: number }>;
    }> = [];
    const remaining: string[] = [];

    for (const spanSvc of spanServices) {
      const result = embeddingResults.get(spanSvc);
      if (result && result.confidence >= this.config.embeddingThreshold) {
        matches.set(spanSvc, result.topologyId);
      } else {
        if (result) {
          lowConfidence.push({
            spanService: spanSvc,
            candidates: [{ topologyId: result.topologyId, confidence: result.confidence }],
          });
        }
        remaining.push(spanSvc);
      }
    }

    // Phase 2: LLM fallback (secondary, cost-controlled)
    if (this.llmProvider && remaining.length > 0 && this.withinBudget()) {
      const llmResults = await this.alignByLLM(remaining, topologyServices);

      for (const spanSvc of remaining) {
        const llmResult = llmResults.get(spanSvc);
        if (llmResult && llmResult.confidence >= this.config.llmThreshold) {
          matches.set(spanSvc, llmResult.topologyId);
        } else if (this.config.fallbackStrategy === 'best-effort' && llmResult) {
          // Best-effort: accept the top LLM candidate even if below threshold
          matches.set(spanSvc, llmResult.topologyId);
        }
      }
    }

    return { matches, lowConfidence };
  }

  /**
   * Total accumulated LLM cost for today.
   */
  get totalDailyCost(): number {
    this.rolloverDayCheck();
    return this.dailyCost;
  }

  /**
   * Reset the LLM result cache.
   */
  clearCache(): void {
    this.llmCache.clear();
  }

  /**
   * Check whether LLM provider is available.
   */
  get hasLLM(): boolean {
    return this.llmProvider !== null;
  }

  // ── Phase 1: Embedding Matching ────────────────────────

  /**
   * Match span service names against topology descriptors using cosine similarity.
   *
   * Strategy:
   * 1. Generate embeddings for all span names and topology descriptor names
   * 2. For each span name, find the topology descriptor with highest cosine similarity
   * 3. Return the best match with confidence = max cosine similarity
   */
  private async alignByEmbedding(
    spanServices: readonly string[],
    topologyServices: readonly ServiceDescriptor[],
  ): Promise<Map<string, { topologyId: string; confidence: number }>> {
    const result = new Map<string, { topologyId: string; confidence: number }>();

    if (spanServices.length === 0 || topologyServices.length === 0) {
      return result;
    }

    // Build enriched query strings for topology descriptors
    const topologyQueries = topologyServices.map((t) => this.buildDescriptorQuery(t));

    // Generate embeddings in a single batch
    const allTexts = [...spanServices, ...topologyQueries];
    const { vectors } = await this.embeddingProvider.embed(allTexts);

    const spanVectors = vectors.slice(0, spanServices.length);
    const topoVectors = vectors.slice(spanServices.length);

    // For each span service, find the topology descriptor with highest similarity
    for (let i = 0; i < spanServices.length; i++) {
      let bestIdx = -1;
      let bestSim = -1;

      for (let j = 0; j < topologyServices.length; j++) {
        const sim = cosineSimilarity(spanVectors[i]!, topoVectors[j]!);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = j;
        }
      }

      if (bestIdx >= 0) {
        result.set(spanServices[i]!, {
          topologyId: topologyServices[bestIdx]!.id,
          confidence: bestSim,
        });
      }
    }

    return result;
  }

  // ── Phase 2: LLM Fallback ──────────────────────────────

  /**
   * Match remaining span services using LLM semantic inference.
   *
   * Uses ILLMProvider's alignEntities method with 24h caching
   * to avoid duplicate LLM calls for the same service name.
   */
  private async alignByLLM(
    spanServices: readonly string[],
    topologyServices: readonly ServiceDescriptor[],
  ): Promise<Map<string, { topologyId: string; confidence: number }>> {
    const result = new Map<string, { topologyId: string; confidence: number }>();

    // Invariant: `alignByLLM` is only invoked from `align()` after the guard
    // `this.llmProvider && remaining.length > 0`, so the provider is non-null here.
    const llm = this.llmProvider!;

    for (const spanSvc of spanServices) {
      // Check cache first
      const cached = this.llmCache.get(spanSvc.toLowerCase());
      const now = Date.now();
      if (cached && now - cached.timestamp < this.config.cacheTtlMs) {
        if (cached.confidence >= this.config.llmThreshold) {
          result.set(spanSvc, {
            topologyId: cached.result,
            confidence: cached.confidence,
          });
        }
        continue;
      }

      // Invoke LLM
      try {
        const llmResult = await llm.alignEntity(
          spanSvc,
          topologyServices.map((t) => ({
            id: t.id,
            name: t.name,
            namespace: t.namespace,
            labels: t.labels ?? [],
          })),
        );

        if (llmResult.topologyId === null) {
          // No match found — skip
          continue;
        }

        // Track cost
        this.trackCost(llmResult.usage);

        // Cache result
        this.llmCache.set(spanSvc.toLowerCase(), {
          result: llmResult.topologyId,
          confidence: llmResult.confidence,
          timestamp: now,
        });

        // Check budget
        if (!this.withinBudget()) break;

        result.set(spanSvc, {
          topologyId: llmResult.topologyId,
          confidence: llmResult.confidence,
        });
      } catch {
        // LLM call failed — skip this service and continue
      }
    }

    return result;
  }

  // ── Helpers ────────────────────────────────────────────

  /**
   * Build an enriched query string for a topology descriptor.
   *
   * Combines id, name, namespace, and labels into a single string
   * for better embedding matching (e.g., "order-service" matches
   * "orderhandler" via shared "order" token).
   */
  private buildDescriptorQuery(desc: ServiceDescriptor): string {
    const parts: string[] = [desc.name, desc.id];
    if (desc.namespace) parts.push(desc.namespace);
    if (desc.labels?.length) parts.push(...desc.labels);
    return parts.join(' ');
  }

  // ── Budget Management ──────────────────────────────────

  /**
   * Check whether we're still within the daily cost budget.
   */
  private withinBudget(): boolean {
    this.rolloverDayCheck();
    return this.dailyCost < this.config.dailyCostCapUSD;
  }

  /**
   * Track LLM usage cost and rollover to new day if needed.
   */
  private trackCost(usage?: { promptTokens: number; completionTokens: number }): void {
    if (!usage) return;

    // DeepSeek pricing: ~$0.27/1M input, ~$1.10/1M output
    const inputCost = usage.promptTokens * (0.27 / 1_000_000);
    const outputCost = usage.completionTokens * (1.1 / 1_000_000);

    this.rolloverDayCheck();
    this.dailyCost += inputCost + outputCost;
  }

  /**
   * Reset cost counter if the day has changed.
   */
  private rolloverDayCheck(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDay) {
      this.dailyCost = 0;
      this.currentDay = today;
    }
  }
}
