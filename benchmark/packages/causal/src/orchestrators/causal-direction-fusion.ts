/**
 * Causal Direction Fusion — multi-tier direction inference orchestrator.
 *
 * Queries timing providers in priority order (trace → log → granger → static).
 * At each tier, checks whether the results meet minimum confidence and coverage
 * thresholds. Falls through to the next tier only when the current tier is
 * insufficient.
 *
 * Provider priority chain:
 *   1. TraceTimingProvider      (tier: 'trace',    confidence: 0.8-0.95)
 *   2. LogTimingProvider        (tier: 'log',      confidence: 0.4-0.85)
 *   3. GrangerCausalityProvider (tier: 'granger',  confidence: 0.3-0.7)
 *   4. StaticDirectionProvider  (tier: 'static',   confidence: 0.5)
 *
 * Falls through when:
 *   - Provider cannot infer (no data available)
 *   - Coverage is below minCoverage threshold
 *   - Average confidence is below minConfidence threshold
 *
 * The goal is to maximize the use of free, high-confidence signal sources
 * (traces, logs, statistics) before resorting to LLM-based fallback.
 *
 * @module causal/orchestrators/causal-direction-fusion
 */

import type {
  CallEdge,
  CausalDirection,
  CausalDirectionConfig,
  ConfidenceTier,
  ITimingProvider,
  ITimingProviderRegistry,
  TemporalContext,
} from '@agentix-e/micro-kinetic-core';
import { DEFAULT_CAUSAL_DIRECTION_CONFIG } from '@agentix-e/micro-kinetic-core';
import type { FusionResult, ProviderTierResult } from '../types/index.js';

/**
 * CausalDirectionFusion — multi-tier direction inference orchestrator.
 *
 * Manages a chain of ITimingProvider instances in priority order and
 * selects the best available direction inference for each edge.
 *
 * @example
 * ```typescript
 * const fusion = new CausalDirectionFusion();
 * fusion.register(new TraceTimingProvider());
 * fusion.register(new LogTimingProvider());
 * fusion.register(new GrangerCausalityProvider());
 * fusion.register(new StaticDirectionProvider(staticDirs));
 *
 * const result = await fusion.inferDirections(edges, temporalContext);
 * console.log(`Resolved ${result.edgesResolved}/${result.edgesTotal} edges via ${result.acceptedTier}`);
 * ```
 */
export class CausalDirectionFusion implements ITimingProviderRegistry {
  private readonly _providers: ITimingProvider[] = [];
  private readonly config: CausalDirectionConfig;

  constructor(config: Partial<CausalDirectionConfig> = {}) {
    this.config = { ...DEFAULT_CAUSAL_DIRECTION_CONFIG, ...config };
  }

  // ── ITimingProviderRegistry ────────────────────────────

  get providers(): readonly ITimingProvider[] {
    return this._providers;
  }

  register(provider: ITimingProvider): void {
    // Remove existing provider with same ID (replace)
    this.unregister(provider.meta.id);
    this._providers.push(provider);
    // Sort by tier priority: trace(0) → log(1) → granger(2) → static(3)
    this._providers.sort((a, b) => this.tierRank(a.meta.tier) - this.tierRank(b.meta.tier));
  }

  unregister(providerId: string): void {
    const idx = this._providers.findIndex((p) => p.meta.id === providerId);
    if (idx >= 0) {
      this._providers.splice(idx, 1);
    }
  }

  async getAvailable(context: TemporalContext): Promise<readonly ITimingProvider[]> {
    const available: ITimingProvider[] = [];
    for (const provider of this._providers) {
      if (await provider.canInfer(context)) {
        available.push(provider);
      }
    }
    return available;
  }

  // ── Inference ──────────────────────────────────────────

  /**
   * Run multi-tier direction inference for the given edges.
   *
   * Queries providers in priority order, falling through when
   * the current tier produces insufficient results.
   *
   * @param edges - Service call edges to resolve.
   * @param context - Temporal context with timing data.
   * @returns Fusion result with resolved directions.
   */
  async inferDirections(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<FusionResult> {
    const tierResults: ProviderTierResult[] = [];
    let acceptedTier: ConfidenceTier = 'none';
    let finalDirections: readonly CausalDirection[] = [];

    for (const provider of this._providers) {
      // Skip unavailable providers
      if (!(await provider.canInfer(context))) {
        tierResults.push({
          providerId: provider.meta.id,
          tier: provider.meta.tier,
          directions: [],
          confidence: 0,
        });
        continue;
      }

      const directions = await provider.inferDirection(edges, context);
      const confidence = await provider.estimateConfidence(context);
      const coverage = edges.length > 0 ? directions.length / edges.length : 0;

      tierResults.push({
        providerId: provider.meta.id,
        tier: provider.meta.tier,
        directions,
        confidence,
      });

      // Accept this tier if it meets the minimum criteria
      if (
        coverage >= this.config.minCoverage &&
        confidence >= this.config.minConfidence &&
        directions.length > 0
      ) {
        finalDirections = directions;
        acceptedTier = provider.meta.tier;
        break; // Stop at first acceptable tier
      }
    }

    // Edge merger: if no single tier fully covers the edges,
    // fill gaps from lower tiers but keep acceptedTier = 'none'
    if (acceptedTier === 'none') {
      finalDirections = this.mergeTierResults(tierResults, edges);
      // Keep acceptedTier = 'none' since no tier met the threshold
    }

    const edgesResolved = new Set(finalDirections.map((d) => `${d.source}→${d.target}`)).size;

    return {
      directions: finalDirections,
      acceptedTier,
      edgesResolved,
      edgesTotal: edges.length,
      coverage: edges.length > 0 ? edgesResolved / edges.length : 0,
      tierResults,
    };
  }

  // ── Private ────────────────────────────────────────────

  /**
   * Rank confidence tiers for priority ordering.
   * Lower rank = higher priority.
   */
  private tierRank(tier: ConfidenceTier): number {
    switch (tier) {
      case 'trace':
        return 0;
      case 'log':
        return 1;
      case 'granger':
        return 2;
      case 'static':
        return 3;
      case 'llm':
        return 4;
      case 'none':
        return 5;
    }
  }

  /**
   * Merge results from multiple tiers.
   *
   * For each edge, pick the highest-tier available direction.
   * Ties are broken by confidence within the same tier.
   */
  private mergeTierResults(
    tierResults: readonly ProviderTierResult[],
    _edges: readonly CallEdge[],
  ): readonly CausalDirection[] {
    // Build a map: edge_key → best (tier, direction)
    const bestPerEdge = new Map<string, { tier: ConfidenceTier; direction: CausalDirection }>();

    // Process tiers in priority order
    const sortedResults = [...tierResults].sort(
      (a, b) => this.tierRank(a.tier) - this.tierRank(b.tier),
    );

    for (const result of sortedResults) {
      for (const direction of result.directions) {
        const key = `${direction.source}→${direction.target}`;
        // `sortedResults` is already ordered by tier priority, so the first
        // direction for a key always carries the highest-priority tier. The
        // previous `|| tierRank(direction.tier) < tierRank(existing.tier)`
        // re-check was unreachable: well-formed providers emit `direction.tier`
        // equal to their `meta.tier`, so a later (lower-priority) result can
        // never outrank the already-stored one.
        if (!bestPerEdge.has(key)) {
          bestPerEdge.set(key, { tier: direction.tier, direction });
        }
      }
    }

    return [...bestPerEdge.values()].map((v) => v.direction);
  }
}
