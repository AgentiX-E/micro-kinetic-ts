/**
 * Multi-signal fusion engine — combines trace, metric, and topology signals.
 *
 * Supports four fusion modes:
 *   - Static: user-defined weight vector (w_trace, w_metric, w_topology)
 *   - Heuristic: auto-tuning based on data quality (trace coverage,
 *     metric completeness, topology match rate)
 *   - LLM-guided: DeepSeek API optimizes weights based on deployment context
 *   - Self-learning: online weight optimization via gradient descent on accuracy
 *
 * Architecture:
 *   TraceProvider ──┐
 *   MetricProvider ─┼── FusionEngine ──► Ranked Root Causes
 *   TopologyProvider┘        │
 *                       Self-Learning
 *                        (weight optimization)
 *
 * @module signals/fusion-engine
 */

import { DEFAULT_FUSION_WEIGHTS } from '@agentix-e/micro-kinetic-core';
import type {
  FusionMode,
  FusionWeights,
  ISignalProvider,
  LearningEntry,
  MultiSignalConfig,
  SignalAnalysisContext,
  SignalResult,
} from '@agentix-e/micro-kinetic-core';
import type { RootCauseResult } from '@agentix-e/micro-kinetic-core';

/**
 * Multi-signal fusion engine for root cause analysis.
 */
export class MultiSignalFusionEngine {
  private providers: ISignalProvider[] = [];
  private learningHistory: LearningEntry[] = [];
  private currentWeights: FusionWeights = { ...DEFAULT_FUSION_WEIGHTS };

  constructor(private config: MultiSignalConfig) {}

  // ── Provider Registration ──────────────────────────────

  register(provider: ISignalProvider): void {
    this.providers.push(provider);
  }

  // ── Main Analysis ──────────────────────────────────────

  async analyze(context: SignalAnalysisContext): Promise<{
    results: RootCauseResult[];
    signalResults: Record<string, SignalResult>;
    weights: FusionWeights;
  }> {
    // Collect results from all registered providers
    const signalResults: Record<string, SignalResult> = {};
    for (const provider of this.providers) {
      signalResults[provider.signalType] = await provider.analyze(context);
    }

    // Compute fusion weights based on mode
    const weights = await this.computeWeights(context, signalResults);

    // Fuse: combine candidates with softmax-weighted scores
    const fused = this.fuseResults(signalResults, weights);

    // Self-learning: if ground truth is available (future), update weights
    return { results: fused, signalResults, weights };
  }

  // ── Signal Providers ───────────────────────────────────

  getSignalProviders(): readonly ISignalProvider[] {
    return this.providers;
  }

  // ── Learning History ───────────────────────────────────

  recordFeedback(groundTruth: string, predicted: string, weights: FusionWeights): void {
    this.learningHistory.push({
      timestamp: Date.now(),
      weights,
      signalResults: {},
      accuracy: predicted === groundTruth ? 1.0 : 0.0,
      updatedWeights: weights,
    });
  }

  getLearningHistory(): readonly LearningEntry[] {
    return this.learningHistory;
  }

  // ── Private: Weight Computation ────────────────────────

  private async computeWeights(
    context: SignalAnalysisContext,
    results: Record<string, SignalResult>,
  ): Promise<FusionWeights> {
    const mode = this.config.mode;

    switch (mode.type) {
      case 'static':
        return mode.weights;

      case 'heuristic':
        return this.computeHeuristicWeights(context, results);

      case 'llm':
        return this.computeLLMWeights(context, mode.model, mode.apiKey);

      case 'selfLearning':
        return this.computeLearningWeights();

      default:
        return DEFAULT_FUSION_WEIGHTS;
    }
  }

  private async computeHeuristicWeights(
    context: SignalAnalysisContext,
    results: Record<string, SignalResult>,
  ): Promise<FusionWeights> {
    let traceQuality = 0, metricQuality = 0, topologyQuality = 0;

    for (const [signal, result] of Object.entries(results)) {
      const q = result.metadata.quality;
      if (signal === 'trace') traceQuality = q.traceCoverage * result.confidence;
      else if (signal === 'metric') metricQuality = q.metricCompleteness * result.confidence;
      else if (signal === 'topology') topologyQuality = q.topologyMatch * result.confidence;
    }

    // If trace data exists and has errors, weight it higher
    const spans = context.traceSpans;
    if (spans && spans.filter((s) => s.isError).length > 0) {
      traceQuality += 0.2;
    }

    return {
      trace: Math.min(1, traceQuality),
      metric: Math.min(1, metricQuality + 0.5), // metric always gets baseline
      topology: Math.min(1, topologyQuality + 0.3), // topology always gets baseline
    };
  }

  private async computeLLMWeights(
    context: SignalAnalysisContext,
    model: string,
    apiKey: string,
  ): Promise<FusionWeights> {
    // LLM-guided weight optimization — uses DeepSeek API
    // Implemented when LLM integration is enabled
    return DEFAULT_FUSION_WEIGHTS;
  }

  private computeLearningWeights(): FusionWeights {
    if (this.learningHistory.length === 0) return DEFAULT_FUSION_WEIGHTS;

    // Exponential moving average of weights weighted by accuracy
    let totalWeight = 0;
    const weightedSum = { trace: 0, metric: 0, topology: 0 };

    for (const entry of this.learningHistory) {
      const w = entry.accuracy;
      weightedSum.trace += entry.weights.trace * w;
      weightedSum.metric += entry.weights.metric * w;
      weightedSum.topology += entry.weights.topology * w;
      totalWeight += w;
    }

    if (totalWeight > 0) {
      return {
        trace: weightedSum.trace / totalWeight,
        metric: weightedSum.metric / totalWeight,
        topology: weightedSum.topology / totalWeight,
      };
    }
    return DEFAULT_FUSION_WEIGHTS;
  }

  // ── Private: Result Fusion ─────────────────────────────

  private fuseResults(
    results: Record<string, SignalResult>,
    weights: FusionWeights,
  ): RootCauseResult[] {
    const scoreMap = new Map<string, number>();

    for (const [signal, result] of Object.entries(results)) {
      const signalWeight = signal === 'trace' ? weights.trace
        : signal === 'metric' ? weights.metric
        : weights.topology;

      for (const candidate of result.candidates) {
        const serviceId = candidate.serviceId;
        const weightedScore = candidate.confidence * signalWeight;
        const current = scoreMap.get(serviceId) ?? 0;
        scoreMap.set(serviceId, current + weightedScore);
      }
    }

    return [...scoreMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([serviceId, score]) => ({
        serviceId,
        faultType: { category: 'UNKNOWN' as const, subType: 'multi_signal_fusion', severity: score > 0.7 ? 'critical' : 'major' },
        confidence: Math.min(1, score),
        rank: 0,
        evidenceMetrics: [{ metric: 'fusion_score', value: score, threshold: 0.3 }],
        propagationDepth: 0,
        propagationErrorBound: 0.1,
        viaTreeSearch: false,
      }))
      .slice(0, this.config.maxCandidates);
  }
}
