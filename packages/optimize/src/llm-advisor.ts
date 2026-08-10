/**
 * LLM Advisor: DeepSeek Chain-of-Thought ranking for uncertainty resolution.
 *
 * When the GP surrogate has high variance (σ² too large to converge),
 * the LLM advisor provides heuristic ranking of unexplored configurations
 * based on RCA domain knowledge and experiment history.
 *
 * Cost budget: ≤ 2 calls per optimization cycle, ~$0.05/call.
 * Fallback: on API error or rate limit, returns uniform ranking (no-op).
 * Cache: 24-hour in-memory cache to avoid redundant API calls.
 *
 * API key: read from process.env.DEEPSEEK_API_KEY at runtime.
 * Never hardcoded.  Never committed.  .env file is in .gitignore.
 */

import type { SystemContext } from './types.js';
import type { RCAConfiguration } from './config-space.js';

// ── Types ──

export interface ExperimentRecord {
  readonly config: RCAConfiguration;
  readonly accuracy: number;
}

export interface RankResult {
  /** Indices into the candidates array, sorted best-first */
  readonly ranking: readonly number[];
  /** Human-readable reasoning from the LLM */
  readonly reasoning: string;
  /** LLM's self-reported confidence [0, 1] */
  readonly confidence: number;
  /** Was this result from cache? */
  readonly fromCache: boolean;
}

export interface LLMAdvisorOptions {
  /** DeepSeek API base URL */
  readonly apiBase: string;
  /** Model name */
  readonly model: string;
  /** Maximum API calls per optimization cycle */
  readonly maxCallsPerCycle: number;
  /** Cache TTL in milliseconds (default: 24 hours) */
  readonly cacheTTL: number;
  /** Callback for progress logging (injectable for testing) */
  readonly onProgress?: (msg: string) => void;
}

// ── Cache entry ──

interface CacheEntry {
  readonly ranking: readonly number[];
  readonly reasoning: string;
  readonly confidence: number;
  readonly timestamp: number;
}

// ── Defaults ──

const DEFAULTS: LLMAdvisorOptions = {
  apiBase: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  maxCallsPerCycle: 2,
  cacheTTL: 24 * 60 * 60 * 1000, // 24 hours
};

// ── Prompt template ──

const SYSTEM_PROMPT = `You are an RCA (Root Cause Analysis) optimization advisor for microservice fault diagnosis.

You analyze experiment results from a configurable pipeline with parameters:
- baselineStrategy: how anomaly baselines are computed (q25, sliding-window, auto)
- correlationMethod: statistical correlation for edge weights (pearson, spearman)
- propagationMode: how child contributions aggregate (additive, multiplicative)
- enableCollisionAggregation: use Boltzmann Q(f,f) collision energy
- useTemporalCausality: use timing signals for edge direction
- decayAlpha: propagation depth sensitivity (0.5=favor leaf, 0.95=favor root)
- pruneEpsilon: cycle pruning threshold (smaller=keep more cycles)
- temporalBonus: timing signal weight in edge computation
- defaultWeight: uncorrelated edge fallback weight
- childContributionCap: maximum child contribution per node

Given the experiment history and candidate configurations, rank the candidates
by predicted accuracy improvement.  Consider:
1. Graph structure: dense graphs need higher pruneEpsilon, hubs need multiplicative propagation
2. Metric profiles: high spike-dominance favors q25 baseline, CV measures favor sliding-window
3. Trace coverage: high coverage reduces need for temporal causality
4. Degradation patterns: gradual faults need lower decayAlpha (propagate to root)

Output ONLY a JSON object: {"ranking": [candidate_index_0, ...], "reasoning": "...", "confidence": 0.XX}`;

// ── Implementation ──

export class LLMAdvisor {
  private readonly options: LLMAdvisorOptions;
  private readonly cache = new Map<string, CacheEntry>();
  private callCount = 0;

  constructor(options?: Partial<LLMAdvisorOptions>) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Current call count for this cycle */
  get callsThisCycle(): number {
    return this.callCount;
  }

  /** Reset cycle counter */
  resetCycle(): void {
    this.callCount = 0;
  }

  /**
   * Rank candidate configurations using CoT reasoning.
   * Falls back to uniform ranking when API is unavailable or budget exhausted.
   */
  async rank(
    history: readonly ExperimentRecord[],
    candidates: readonly RCAConfiguration[],
    context: SystemContext,
  ): Promise<RankResult> {
    // Budget check
    if (this.callCount >= this.options.maxCallsPerCycle) {
      return this.uniformRank(candidates, 'Budget exhausted');
    }

    // Cache check
    const cacheKey = this.computeCacheKey(history, candidates, context);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.options.cacheTTL) {
      return {
        ranking: cached.ranking,
        reasoning: cached.reasoning,
        confidence: cached.confidence,
        fromCache: true,
      };
    }

    // API call
    this.callCount++;
    try {
      const result = await this.callLLM(history, candidates, context);
      this.cache.set(cacheKey, {
        ranking: result.ranking,
        reasoning: result.reasoning,
        confidence: result.confidence,
        timestamp: Date.now(),
      });
      return { ...result, fromCache: false };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.options.onProgress?.(`LLM advisor error: ${msg}`);
      return this.uniformRank(candidates, `API error: ${msg}`);
    }
  }

  /** Call the DeepSeek API */
  private async callLLM(
    history: readonly ExperimentRecord[],
    candidates: readonly RCAConfiguration[],
    context: SystemContext,
  ): Promise<Omit<RankResult, 'fromCache'>> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY not set in environment');
    }

    const userPrompt = this.buildPrompt(history, candidates, context);

    const response = await fetch(
      `${this.options.apiBase}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1024,
          response_format: { type: 'json_object' },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      readonly choices: readonly {
        readonly message: { readonly content: string };
      }[];
    };

    return this.parseResponse(data.choices[0]!.message.content, candidates.length);
  }

  /** Build the user prompt from experiment history and context */
  private buildPrompt(
    history: readonly ExperimentRecord[],
    candidates: readonly RCAConfiguration[],
    context: SystemContext,
  ): string {
    const lines: string[] = [];
    lines.push(`System context: ${context.serviceCount} services, density=${context.graphDensity.toFixed(3)}, CV=${context.metricCV.toFixed(3)}, traceCoverage=${context.traceCoverage.toFixed(2)}, maxDepth=${context.maxDepth}`);

    if (history.length > 0) {
      lines.push('\nExperiment history (config → accuracy):');
      for (let i = 0; i < history.length; i++) {
        const h = history[i]!;
        const c = h.config;
        lines.push(
          `  [${i}] ${c.discrete.baselineStrategy}/${c.discrete.correlationMethod}/` +
            `${c.discrete.propagationMode}/coll=${c.discrete.enableCollisionAggregation}/` +
            `temp=${c.discrete.useTemporalCausality}/α=${c.continuous.decayAlpha.toFixed(2)}/` +
            `ε=${c.continuous.pruneEpsilon.toExponential(1)} → ${(h.accuracy * 100).toFixed(1)}%`,
        );
      }
    } else {
      lines.push('\nNo experiment history yet — first iteration.');
    }

    lines.push('\nCandidates to rank:');
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]!;
      lines.push(
        `  [${i}] ${c.discrete.baselineStrategy}/${c.discrete.correlationMethod}/` +
          `${c.discrete.propagationMode}/coll=${c.discrete.enableCollisionAggregation}/` +
          `temp=${c.discrete.useTemporalCausality}/α=${c.continuous.decayAlpha.toFixed(2)}`,
      );
    }

    lines.push('\nRank these candidates. Output JSON only.');
    return lines.join('\n');
  }

  /** Parse LLM JSON response */
  private parseResponse(
    content: string,
    numCandidates: number,
  ): Omit<RankResult, 'fromCache'> {
    try {
      const json = JSON.parse(content) as {
        ranking: number[];
        reasoning: string;
        confidence: number;
      };

      // Validate ranking: must contain exactly all indices 0..n-1
      const sorted = [...json.ranking].sort((a, b) => a - b);
      const expected = Array.from({ length: numCandidates }, (_, i) => i);
      if (
        sorted.length !== numCandidates ||
        !sorted.every((v, i) => v === expected[i])
      ) {
        throw new Error(
          `Invalid ranking: expected [0..${numCandidates - 1}], got ${JSON.stringify(json.ranking)}`,
        );
      }

      return {
        ranking: json.ranking,
        reasoning: json.reasoning || 'No reasoning provided',
        confidence: Math.min(1, Math.max(0, json.confidence || 0.5)),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse LLM response: ${msg}`);
    }
  }

  /** Uniform fallback ranking */
  private uniformRank(
    candidates: readonly RCAConfiguration[],
    reason: string,
  ): RankResult {
    const ranking = Array.from({ length: candidates.length }, (_, i) => i);
    return {
      ranking,
      reasoning: reason,
      confidence: 0.0,
      fromCache: false,
    };
  }

  /** Simple cache key from input state */
  private computeCacheKey(
    history: readonly ExperimentRecord[],
    candidates: readonly RCAConfiguration[],
    context: SystemContext,
  ): string {
    const parts = [
      `n=${context.serviceCount}`,
      `d=${context.graphDensity.toFixed(3)}`,
      `tc=${context.traceCoverage.toFixed(2)}`,
      `h=${history.length}`,
      `c=${candidates.length}`,
    ];
    for (const h of history) {
      parts.push(
        `${h.config.continuous.decayAlpha.toFixed(2)}_${h.accuracy.toFixed(3)}`,
      );
    }
    return parts.join('|');
  }
}
