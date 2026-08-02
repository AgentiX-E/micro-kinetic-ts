/**
 * PyramidFaultClassifier — three-layer cascading fault classifier.
 *
 * Orchestrates Layer 1 (regex rules), Layer 2 (statistical analysis),
 * and Layer 3 (LLM agent) in a cascading confidence-threshold pipeline:
 *
 *   1. Layer 1 (rule engine, ~0.1ms) — always runs first.
 *      If confidence >= ruleThreshold, return immediately.
 *   2. Layer 2 (statistical, ~5ms) — runs if Layer 1 is below threshold.
 *      If combined confidence >= statThreshold, return.
 *   3. Layer 3 (LLM, ~500ms) — runs only if both layers are low-confidence.
 *      This is the slowest/most expensive path; invoked only for
 *      truly ambiguous cases.
 *
 * Each layer implements IFaultClassifier. The orchestrator is also
 * an IFaultClassifier, enabling transparent use in the benchmark pipeline.
 *
 * @module classifiers/pyramid-classifier
 */

import type {
  FaultClassifierContext,
  FaultTypeHypothesis,
  IFaultClassifier,
  ILLMFaultClassifier,
  IStatisticalAnalyzer,
} from '@agentix-e/micro-kinetic-core';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// ── Configuration ─────────────────────────────────────────

/** Configuration for the pyramid classifier orchestrator. */
export interface PyramidClassifierConfig {
  /** Layer 1 confidence threshold — below this, escalate to Layer 2. */
  readonly ruleThreshold: number;
  /** Layer 2 confidence threshold — below this, escalate to Layer 3. */
  readonly statisticalThreshold: number;
  /** Maximum number of hypotheses to return per layer. */
  readonly maxHypotheses: number;
}

/** Default pyramid configuration. */
export const DEFAULT_PYRAMID_CONFIG: PyramidClassifierConfig = {
  ruleThreshold: 0.7,
  statisticalThreshold: 0.6,
  maxHypotheses: 3,
};

// ── Implementation ────────────────────────────────────────

/**
 * Three-layer pyramid fault classifier.
 *
 * Composes RegexFaultClassifier (L1), StatisticalAnalyzer (L2),
 * and LLMFaultClassifier (L3) into a cascading pipeline.
 */
export class PyramidFaultClassifier implements IFaultClassifier {
  readonly method = 'pyramid' as IFaultClassifier['method'] & 'pyramid';

  private readonly config: PyramidClassifierConfig;
  private readonly ruleEngine: IFaultClassifier;
  private readonly statAnalyzer: IStatisticalAnalyzer;
  private readonly llmClassifier: ILLMFaultClassifier;

  constructor(
    ruleEngine: IFaultClassifier,
    statAnalyzer: IStatisticalAnalyzer,
    llmClassifier: ILLMFaultClassifier,
    config?: Partial<PyramidClassifierConfig>,
  ) {
    this.ruleEngine = ruleEngine;
    this.statAnalyzer = statAnalyzer;
    this.llmClassifier = llmClassifier;
    this.config = { ...DEFAULT_PYRAMID_CONFIG, ...config };
  }

  /**
   * Synchronous classify — uses only Layer 1 + Layer 2.
   *
   * LLM classification requires async context; use classifyAsync()
   * for the full three-layer pipeline with multi-modal data.
   */
  classify(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
  ): FaultTypeHypothesis[] {
    // Layer 1: Rule engine
    const ruleResults = this.ruleEngine.classify(metricSeries, context);
    const bestRule = ruleResults[0];
    if (bestRule && bestRule.confidence >= this.config.ruleThreshold) {
      return ruleResults.slice(0, this.config.maxHypotheses);
    }

    // Layer 2: Statistical analysis
    const statResults = this.statAnalyzer.classify(metricSeries, context);
    const bestStat = statResults[0];
    if (bestStat && bestStat.confidence >= this.config.statisticalThreshold) {
      return statResults.slice(0, this.config.maxHypotheses);
    }

    // Both layers low — return combined results, caller should use classifyAsync
    return this.mergeResults(ruleResults, statResults).slice(0, this.config.maxHypotheses);
  }

  /**
   * Async classify with all three layers.
   *
   * Runs Layer 1 → Layer 2 synchronously, then Layer 3 (LLM)
   * asynchronously if needed. Passes prior hypotheses to the LLM
   * for informed reasoning.
   */
  async classifyAsync(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
  ): Promise<FaultTypeHypothesis[]> {
    // Layer 1
    const ruleResults = this.ruleEngine.classify(metricSeries, context);
    const bestRule = ruleResults[0];
    if (bestRule && bestRule.confidence >= this.config.ruleThreshold) {
      return ruleResults.slice(0, this.config.maxHypotheses);
    }

    // Layer 2
    const statResults = this.statAnalyzer.classify(metricSeries, context);
    const bestStat = statResults[0];
    if (bestStat && bestStat.confidence >= this.config.statisticalThreshold) {
      return statResults.slice(0, this.config.maxHypotheses);
    }

    // Layer 3: LLM (with prior hypotheses)
    const priorHypotheses = this.mergeResults(ruleResults, statResults);
    try {
      const llmResults = await this.llmClassifier.classifyWithContext(
        metricSeries,
        context,
        priorHypotheses,
      );
      if (llmResults.length > 0 && llmResults[0]!.category !== 'UNKNOWN') {
        return llmResults.slice(0, this.config.maxHypotheses);
      }
    } catch {
      // LLM call failed — return prior results
    }

    return priorHypotheses.slice(0, this.config.maxHypotheses);
  }

  // ── Helpers ─────────────────────────────────────────────

  /**
   * Merge results from two layers, deduplicating by category
   * and preferring the higher confidence value.
   */
  private mergeResults(
    a: readonly FaultTypeHypothesis[],
    b: readonly FaultTypeHypothesis[],
  ): FaultTypeHypothesis[] {
    const merged = new Map<string, FaultTypeHypothesis>();

    for (const h of [...a, ...b]) {
      const existing = merged.get(h.category);
      if (!existing || h.confidence > existing.confidence) {
        merged.set(h.category, h);
      }
    }

    return [...merged.values()].sort((x, y) => y.confidence - x.confidence);
  }
}
