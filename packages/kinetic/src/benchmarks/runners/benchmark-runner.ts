/**
 * Benchmark Runner — executes RCA engine against benchmark suites.
 *
 * Orchestrates the full RCA pipeline against benchmark datasets and
 * computes standard evaluation metrics: Avg@K, Location Accuracy,
 * Type Accuracy, per-fault-type breakdown, and composite scores.
 *
 * Supports three output formats: text (human-readable), JSON (structured),
 * and HTML (interactive report).
 *
 * @module benchmarks/runners/benchmark-runner
 */

import {
  DI_TOKENS,
  type FaultType,
  type IContainer,
  type IFaultClassifier,
  type IRCAEngine,
  type RootCauseResult,
  bestHypothesisToFaultType,
} from '@agentix-e/micro-kinetic-core';

import type { TimeSeries, TraceSpan } from '@agentix-e/micro-kinetic-core';

import type { BenchmarkSuite } from '../loaders/types.js';

import { computeAvgAtK, computeTA } from './metrics.js';

import type { TrainingExample } from '../../signals/weight-calibrator.js';
import { WeightCalibrator } from '../../signals/weight-calibrator.js';

/**
 * Pick the time series with the largest RELATIVE change (max/min ratio,
 * symmetric) from a service's metrics.
 *
 * The anomaly scorer is relative (log10 of max/baseline), so a metric whose
 * absolute range is small but whose relative swing is huge (a counter going
 * 0 → N) drives the score far more than a memory metric whose absolute range
 * is millions of bytes but whose relative swing is only ~2x. Picking by raw
 * value range therefore hid the metric that actually produced the anomaly.
 * Used by the failure diagnostics to surface the fault signature when the
 * ground-truth metric name is absent (e.g. RCAEval RE3's generic f1..f5).
 *
 * @internal
 */
function pickDominantMetric(series: readonly TimeSeries[] | undefined): TimeSeries | undefined {
  if (!series || series.length === 0) return undefined;
  let best: TimeSeries | undefined;
  let bestRatio = -Infinity;
  for (const ts of series) {
    const values = ts.values;
    if (values.length < 2) continue;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // Symmetric relative swing; guard min == 0 (a flat/idle counter).
    const denom = min > 0 ? min : max > 0 ? 1e-9 : 0;
    const ratio = denom > 0 ? Math.max(max / denom, denom / max) : 0;
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = ts;
    }
  }
  return best;
}

// ── Runner Types ──────────────────────────────────────────

/** Per-fault-type accuracy breakdown. */
export interface FaultTypeMetric {
  /** Total cases of this fault type. */
  readonly cases: number;
  /** Number of correctly identified cases (Avg@5). */
  readonly correct: number;
  /** Accuracy (0-1). */
  readonly accuracy: number;
}

/** A case that failed analysis. */
export interface FailedCase {
  /** Case identifier. */
  readonly caseId: string;
  /** Expected ground truth service ID. */
  readonly expectedService: string;
  /** Expected ground truth fault type. */
  readonly expectedFaultType: string;
  /** Actual top prediction (if any). */
  readonly actualTop?: string;
  /** Actual predicted fault type (if any). */
  readonly actualFaultType?: string;
  /** Error reason. */
  readonly reason: string;
  /** Per-case diagnostics (anomaly scores, predictions). */
  readonly diag?: {
    readonly gtAnomaly: number;
    readonly maxAnomaly: number;
    readonly topK: readonly {
      readonly serviceId: string;
      readonly confidence: number;
      readonly depth: number;
    }[];
    readonly gtInGraph: boolean;
    readonly edges: number;
    /** Ground-truth metric name (root_cause_metric or dominant metric). */
    readonly gtMetric?: string;
    /** Head/tail of the ground-truth metric time series (fault signature). */
    readonly gtMetricHead?: readonly number[];
    readonly gtMetricTail?: readonly number[];
    /** The GT's ACTUAL driving metric (highest feature-weighted deviation). */
    readonly gtDominantLabel?: string;
    readonly gtDominantHead?: readonly number[];
    readonly gtDominantTail?: readonly number[];
    /** Metrics discarded by the transient-spike guard (GT / top-1 service). */
    readonly gtTransientSkipped?: readonly string[];
    readonly top1TransientSkipped?: readonly string[];
    /** Top-3 services by raw anomaly score, for noise/symptom inspection. */
    readonly topAnomaly?: readonly { serviceId: string; score: number }[];
    /** Signature of the top-1 anomaly service's dominant metric. */
    readonly top1MetricLabel?: string;
    readonly top1MetricHead?: readonly number[];
    readonly top1MetricTail?: readonly number[];
    /**
     * Anomaly ONSET indices for the ground-truth service and the top-1
     * anomaly service, to validate whether the source (GT) changed EARLIER
     * than the symptom (top-1). If so, the onset-ordering signal can separate
     * them; if not, the onset detection needs work before re-enabling it.
     */
    readonly gtOnset?: number;
    readonly topOnset?: number;
    /**
     * Injection-anchored onset DELAYS (ms after inject_time) for the GT and
     * the top-1 anomaly service (-1 = undetermined). These reveal whether the
     * temporal causal signal placed the source EARLIER than the symptom.
     */
    readonly gtInjectDelay?: number;
    readonly topInjectDelay?: number;
    /**
     * The three auxiliary ranking signals (log volume, collision ratio, and
     * topological source) for the GT and the top-1 anomaly service, so the
     * benchmark artifacts can reveal whether each signal is helping or hurting
     * source/symptom separation. Absent when the signal is disabled or the
     * case carried no relevant data.
     */
    readonly gtLogScore?: number;
    readonly topLogScore?: number;
    readonly gtRatioContrib?: number;
    readonly topRatioContrib?: number;
    readonly gtTopoSource?: number;
    readonly topTopoSource?: number;
    /**
     * Raw feature-score decomposition of the GT / top-1 anomaly service's
     * dominant metric (deviation / trend / cv / burst / riseRatio / dropRatio
     * / baselineMean). Preformatted for the failure diagnostic — reveals WHY
     * one metric out-ranked another (the component that dominates), which a
     * single scalar anomaly cannot.
     */
    readonly gtBreakdown?: string;
    readonly top1Breakdown?: string;
  };
}

/** Result of running a single benchmark suite. */
export interface RunResult {
  /** Suite name. */
  readonly suiteName: string;
  /** Total cases run. */
  readonly totalCases: number;
  /** Average accuracy at Top-1. */
  readonly avgTop1: number;
  /** Average accuracy at Top-3. */
  readonly avgTop3: number;
  /** Average accuracy at Top-5. */
  readonly avgTop5: number;
  /** Location accuracy (predicted service matches ground truth). */
  readonly locationAccuracy: number;
  /** Type accuracy (predicted fault type matches ground truth). */
  readonly typeAccuracy: number;
  /** Per-fault-type breakdown. */
  readonly perFaultType: Map<string, FaultTypeMetric>;
  /** Cases that failed. */
  readonly failures: readonly FailedCase[];
  /** Total execution time in milliseconds. */
  readonly duration: number;
}

/** Complete benchmark report across all suites. */
export interface CompleteBenchmarkReport {
  /** Individual suite results. */
  readonly suiteResults: readonly RunResult[];
  /** Aggregated total cases. */
  readonly totalCases: number;
  /** Aggregated Avg@1. */
  readonly aggregateAvgTop1: number;
  /** Aggregated Avg@5. */
  readonly aggregateAvgTop5: number;
  /** Aggregated location accuracy. */
  readonly aggregateLA: number;
  /** Aggregated type accuracy. */
  readonly aggregateTA: number;
  /** Total failures across all suites. */
  readonly totalFailures: number;
  /** Total execution time in milliseconds. */
  readonly totalDuration: number;
  /** Timestamp of the report. */
  readonly timestamp: string;
}

// ── Benchmark Runner ──────────────────────────────────────

/**
 * Benchmark Runner — executes RCA analysis on benchmark suites.
 *
 * Uses the DI container to resolve the RCA engine and runs
 * benchmark cases, tracking accuracy metrics and generating reports.
 *
 * @example
 * ```typescript
 * const container = createDefaultContainer();
 * const runner = new BenchmarkRunner(container);
 * const result = runner.runSuite(mySuite);
 * const report = runner.generateReport([result], 'json');
 * ```
 */
/**
 * Trace topology validation options for BenchmarkRunner (I9).
 */
export interface TraceValidationOptions {
  /** Enable trace-based topology validation. Default: false. */
  enabled: boolean;
  /** Prune edges not observed in any trace span. Default: true. */
  pruneUnobserved?: boolean;
  /** Discover new edges from trace parent→child patterns. Default: true. */
  discoverNewEdges?: boolean;
  /** Minimum call frequency to keep an edge. Default: 1. */
  minCallFrequency?: number;
  /** Trace spans from the anomaly period. */
  spans: readonly TraceSpan[];
}

export class BenchmarkRunner {
  private readonly container: IContainer;
  private readonly classifier: IFaultClassifier | undefined;

  /** Trace topology validation options (I9). */
  private readonly traceOptions?: {
    readonly enabled: boolean;
    readonly pruneUnobserved: boolean;
    readonly discoverNewEdges: boolean;
    readonly minCallFrequency: number;
    readonly spans: readonly TraceSpan[];
  };
  /** Online weight calibrator for self-evolving RCA (I10). */
  private readonly calibrator: WeightCalibrator;
  /**
   * Whether to forward the case's fault injection time to the RCA engine.
   *
   * The fault injection time (`benchCase.injectTime`) anchors the engine's
   * temporal causal onset signal — the same "detected anomaly / alert time"
   * input that the RCAEval framework passes to every published baseline. Set
   * to `false` to measure the engine's performance WITHOUT that signal, i.e.
   * the production-transferable, dataset-decoupled number.
   */
  private readonly useInjectTime: boolean;

  /**
   * @param container - DI container with at least RCA_ENGINE registered.
   * @param classifier - Optional fault type classifier. When provided, the runner
   *                     enriches each engine prediction with a classifier-generated
   *                     faultType based on per-service metric data, enabling
   *                     meaningful Type Accuracy (TA) computation.
   * @param traceValidation - Optional trace topology validation (I9). When enabled,
   *                          the runner first augments the call graph using distributed
   *                          trace span data to prune noise edges and discover missing
   *                          causal links.
   * @param calibrator - Optional pre-trained weight calibrator (self-evolving RCA).
   * @param useInjectTime - Forward the fault injection time to the engine (default
   *                        true, matching the RCAEval baseline protocol).
   */
  constructor(
    container: IContainer,
    classifier?: IFaultClassifier,
    traceValidation?: TraceValidationOptions,
    calibrator?: WeightCalibrator,
    useInjectTime = true,
  ) {
    this.container = container;
    this.classifier = classifier;
    this.calibrator = calibrator ?? new WeightCalibrator();
    this.useInjectTime = useInjectTime;
    this.traceOptions = traceValidation?.enabled
      ? {
          enabled: true,
          pruneUnobserved: traceValidation.pruneUnobserved ?? true,
          discoverNewEdges: traceValidation.discoverNewEdges ?? true,
          minCallFrequency: traceValidation.minCallFrequency ?? 1,
          spans: traceValidation.spans,
        }
      : undefined;
  }

  /**
   * Run a single benchmark suite and return metrics.
   *
   * @param suite - The benchmark suite to run.
   * @returns RunResult with all computed metrics.
   */
  async runSuite(suite: BenchmarkSuite): Promise<RunResult> {
    const startTime = Date.now();
    const engine = this.container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);
    const topK = 5;

    // Collect all predictions and ground truths
    const predictions: RootCauseResult[] = [];
    const truthServiceIds: string[] = [];
    const truthFaultTypes: string[] = [];
    const failures: FailedCase[] = [];
    // Full ranked service-ID list per case (for correct Avg@K computation).
    // Aligned with `predictions` and `truthServiceIds` by push order.
    const caseRankedPredictions: string[][] = [];

    // Per-fault-type tracking
    const faultTypeTracker = new Map<string, { cases: number; correct: number }>();

    for (const benchCase of suite.cases) {
      // Scoped before try so catch block can access diagnostic data
      let gtAnomaly = 0;
      let maxAnomaly = 0;
      let effectiveCallGraph = benchCase.callGraph;
      let topPredictions: Array<{ serviceId: string; confidence: number; depth: number }> = [];
      try {
        // ── Trace Topology Validation (I9) ──
        if (this.traceOptions?.enabled) {
          const { validateTopologyWithTraces } = await import('../../signals/trace-validator.js');
          // Prefer per-case traces (benchCase.traces) when present — they
          // describe the actual fault-period call flow for THIS case. Fall
          // back to the constructor-level spans for synthetic cases that
          // carry no per-case trace data.
          const spans = benchCase.traces ?? this.traceOptions.spans;
          const traceResult = validateTopologyWithTraces(benchCase.callGraph, spans, {
            minCallFrequency: this.traceOptions.minCallFrequency,
            discoverNewEdges: this.traceOptions.discoverNewEdges,
            pruneUnobserved: this.traceOptions.pruneUnobserved,
          });
          effectiveCallGraph = traceResult.refinedGraph;
        }

        const faultGraph = engine.buildFaultGraph(effectiveCallGraph, benchCase.metrics, {
          injectTimeMs: this.useInjectTime ? benchCase.injectTime : 0,
          logs: benchCase.logs,
          traces: benchCase.traceErrors,
        });
        const results = await engine.analyze(faultGraph, topK);

        // Capture the full ranked service-ID list for correct Avg@K.
        caseRankedPredictions.push(results.slice(0, topK).map((r) => r.serviceId));

        // ── Diagnostic snapshot for failing cases ──────────────────
        gtAnomaly = faultGraph.anomalyScores.get(benchCase.groundTruth.serviceId) ?? 0;
        maxAnomaly = Math.max(...faultGraph.anomalyScores.values());
        topPredictions = results.slice(0, topK).map((r) => ({
          serviceId: r.serviceId,
          confidence: r.confidence,
          depth: r.propagationDepth,
        }));

        // Capture the ground-truth metric signature (name + head/tail) so the
        // benchmark artifacts can reveal whether the fault manifests as a rise
        // or a drop, and whether it is the largest deviation in the system.
        //
        // RE3 cases carry generic fault labels (f1..f5) with no root_cause_metric,
        // so we pick the GT's most-deviating metric by value range instead of
        // relying on the (often absent) ground-truth metric name.
        const gtMetricName = benchCase.groundTruth.metric;
        const gtMetricSeries = benchCase.metrics.get(benchCase.groundTruth.serviceId);
        const gtTs =
          (gtMetricName ? gtMetricSeries?.find((ts) => ts.label === gtMetricName) : undefined) ??
          pickDominantMetric(gtMetricSeries);
        const gtMetricHead = gtTs ? Array.from(gtTs.values).slice(0, 6) : [];
        const gtMetricTail = gtTs ? Array.from(gtTs.values).slice(-4) : [];
        // The GT's ACTUAL driving metric (the one computeAnomalyFeatures scored)
        // — reveals whether the fault signal was discarded by a guard (e.g. the
        // transient-spike guard) rather than being genuinely small. This is
        // distinct from the root_cause_metric label above, which for RE3's
        // generic f1..f5 labels is often absent or misleading.
        const gtDominant = faultGraph.dominantMetrics?.get(benchCase.groundTruth.serviceId);
        const gtDominantLabel = gtDominant?.label ?? '';
        const gtDominantHead = gtDominant?.head ?? [];
        const gtDominantTail = gtDominant?.tail ?? [];
        const gtTransientSkipped = gtDominant?.transientSkipped ?? [];
        // Top-3 services by raw anomaly score (post-normalization) to expose
        // whether the max is the injected fault, a consistent symptom, or noise.
        const topAnomaly = [...faultGraph.anomalyScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([serviceId, score]) => ({ serviceId, score }));
        // Signature of the top-anomaly service's ACTUAL driving metric — the
        // one computeAnomalyFeatures selected as the highest feature-weighted
        // deviation — to reveal whether the "max" is a near-zero-baseline
        // artifact or a real symptom. (A separate ratio heuristic used to pick
        // this, but it could point at an idle metric the guards already
        // skipped, which was misleading.)
        const top1Dominant = faultGraph.dominantMetrics?.get(topAnomaly[0]?.serviceId ?? '');
        const top1MetricLabel = top1Dominant?.label ?? '';
        const top1MetricHead = top1Dominant?.head ?? [];
        const top1MetricTail = top1Dominant?.tail ?? [];
        const top1TransientSkipped = top1Dominant?.transientSkipped ?? [];
        // Raw feature-score decomposition of the GT and top-1 anomaly service's
        // dominant metric — reveals the component (deviation/trend/cv/burst)
        // that makes a symptom out-rank the source.
        const gtBreakdown = formatBreakdown(gtDominant?.breakdown);
        const top1Breakdown = formatBreakdown(top1Dominant?.breakdown);
        // Onset indices for the GT vs the top-anomaly service, to validate
        // whether the source changed earlier than the symptom.
        const gtOnset = faultGraph.anomalyOnsetTimes.get(benchCase.groundTruth.serviceId);
        const topOnset = faultGraph.anomalyOnsetTimes.get(topAnomaly[0]?.serviceId ?? '');
        // Injection-anchored onset delays (ms after inject_time) for the same
        // pair — the temporal causal signal's actual input.
        const gtInjectDelay = faultGraph.postInjectOnsetDelays?.get(
          benchCase.groundTruth.serviceId,
        );
        const topInjectDelay = faultGraph.postInjectOnsetDelays?.get(
          topAnomaly[0]?.serviceId ?? '',
        );
        // The three auxiliary ranking signals for the GT and top-1 anomaly
        // service — log volume, collision ratio, and topological source. These
        // reveal whether each signal is helping (GT > symptom) or hurting
        // (symptom > GT) the source/symptom separation.
        const gtLogScore = faultGraph.logScores?.get(benchCase.groundTruth.serviceId);
        const topLogScore = faultGraph.logScores?.get(topAnomaly[0]?.serviceId ?? '');
        const gtRatioContrib = faultGraph.collisionEnergy?.get(
          benchCase.groundTruth.serviceId,
        )?.ratioContrib;
        const topRatioContrib = faultGraph.collisionEnergy?.get(
          topAnomaly[0]?.serviceId ?? '',
        )?.ratioContrib;
        const gtTopoSource = faultGraph.topoScores?.get(benchCase.groundTruth.serviceId);
        const topTopoSource = faultGraph.topoScores?.get(topAnomaly[0]?.serviceId ?? '');

        // ── Enrich predictions with classifier-generated fault types ──
        const enrichedResults = this.classifier
          ? results.map((r) => this.enrichPrediction(r, benchCase.metrics))
          : results;
        const enrichedTop = enrichedResults[0];

        // Track prediction
        predictions.push(
          enrichedTop ?? {
            serviceId: '',
            faultType: { category: 'UNKNOWN', subType: '', severity: 'info' },
            confidence: 0,
            rank: 0,
            evidenceMetrics: [],
            propagationDepth: 0,
            propagationErrorBound: 0,
            viaTreeSearch: false,
          },
        );
        truthServiceIds.push(benchCase.groundTruth.serviceId);
        truthFaultTypes.push(benchCase.groundTruth.faultType);

        // Check correctness
        const faultTypeKey = benchCase.groundTruth.faultType;
        let tracker = faultTypeTracker.get(faultTypeKey);
        if (!tracker) {
          tracker = { cases: 0, correct: 0 };
          faultTypeTracker.set(faultTypeKey, tracker);
        }
        tracker.cases++;

        // Check if correct at Top-1 (the ground-truth service is the single
        // highest-ranked prediction). This value feeds perFaultType.accuracy,
        // which is reported as AC@1 and must therefore be Top-1, NOT Top-K.
        const top1Service = results[0]?.serviceId;
        if (top1Service === benchCase.groundTruth.serviceId) {
          tracker.correct++;
        } else if (enrichedTop) {
          failures.push({
            caseId: benchCase.id,
            expectedService: benchCase.groundTruth.serviceId,
            expectedFaultType: benchCase.groundTruth.faultType,
            actualTop: enrichedTop.serviceId,
            actualFaultType: formatFaultType(enrichedTop.faultType),
            reason: `Top prediction "${enrichedTop.serviceId}" does not match ground truth "${benchCase.groundTruth.serviceId}"`,
            diag: {
              gtAnomaly: gtAnomaly,
              maxAnomaly: maxAnomaly,
              topK: topPredictions,
              gtInGraph: effectiveCallGraph.nodes.has(benchCase.groundTruth.serviceId),
              edges: effectiveCallGraph.edges.length,
              gtMetric: gtMetricName ?? gtTs?.label ?? '',
              gtMetricHead,
              gtMetricTail,
              gtDominantLabel,
              gtDominantHead,
              gtDominantTail,
              gtTransientSkipped,
              top1TransientSkipped,
              topAnomaly,
              top1MetricLabel,
              top1MetricHead,
              top1MetricTail,
              gtOnset,
              topOnset,
              gtInjectDelay,
              topInjectDelay,
              gtLogScore,
              topLogScore,
              gtRatioContrib,
              topRatioContrib,
              gtTopoSource,
              topTopoSource,
              gtBreakdown,
              top1Breakdown,
            },
          });
        } else {
          failures.push({
            caseId: benchCase.id,
            expectedService: benchCase.groundTruth.serviceId,
            expectedFaultType: benchCase.groundTruth.faultType,
            reason: 'No predictions generated',
          });
        }
      } catch (err) {
        // Keep index alignment with truthServiceIds for this failed case.
        caseRankedPredictions.push([]);
        failures.push({
          caseId: benchCase.id,
          expectedService: benchCase.groundTruth.serviceId,
          expectedFaultType: benchCase.groundTruth.faultType,
          reason:
            err instanceof Error
              ? `${err.message}\n${err.stack?.split('\n')[1]?.trim() ?? ''}`
              : String(err),
          diag: {
            gtAnomaly: gtAnomaly,
            maxAnomaly: maxAnomaly,
            topK: topPredictions,
            gtInGraph: effectiveCallGraph.nodes.has(benchCase.groundTruth.serviceId),
            edges: effectiveCallGraph.edges.length,
          },
        });
      }
    }

    // Compute metrics
    const totalCases = suite.cases.length;

    // Avg@K — computed from the full ranked per-case lists captured during
    // analysis. Each list holds up to `topK` ranked service IDs; Top-1 uses
    // only the first element, Top-3/Top-5 use the corresponding prefix.
    const casePredictions: ReadonlyArray<readonly string[]> = caseRankedPredictions;

    const avgTop1 = computeAvgAtK(casePredictions, truthServiceIds, 1);
    const avgTop3 = computeAvgAtK(casePredictions, truthServiceIds, 3);
    const avgTop5 = computeAvgAtK(casePredictions, truthServiceIds, 5);

    // LA and TA
    let laCorrect = 0;
    let taCorrect = 0;
    for (let i = 0; i < predictions.length; i++) {
      if (predictions[i]!.serviceId === truthServiceIds[i]!) laCorrect++;
      taCorrect += computeTA(predictions[i]!, truthFaultTypes[i]!);
    }
    const locationAccuracy = predictions.length > 0 ? laCorrect / predictions.length : 0;
    const typeAccuracy = predictions.length > 0 ? taCorrect / predictions.length : 0;

    // Build per-fault-type map
    const perFaultType = new Map<string, FaultTypeMetric>();
    for (const [faultType, tracker] of faultTypeTracker) {
      perFaultType.set(faultType, {
        cases: tracker.cases,
        correct: tracker.correct,
        accuracy: tracker.cases > 0 ? tracker.correct / tracker.cases : 0,
      });
    }

    const duration = Date.now() - startTime;

    // ── Self-Evolving Feedback Loop (I10) ──
    // Train the weight calibrator on this run's outcomes.
    // Closed-loop: each benchmark run feeds back into the RCA engine's
    // fusion weights, gradually converging toward optimal signal blending.
    const trainingExamples: TrainingExample[] = [];
    for (let i = 0; i < suite.cases.length; i++) {
      const benchCase = suite.cases[i]!;
      const predicted = predictions[i];
      trainingExamples.push({
        predictedService: predicted?.serviceId ?? '',
        groundTruthService: benchCase.groundTruth.serviceId,
        faultType: benchCase.groundTruth.faultType,
        predictedConfidence: predicted?.confidence ?? 0,
        collisionType: undefined, // Populated by the collision aggregator internally
        isCorrect: predicted?.serviceId === benchCase.groundTruth.serviceId,
      });
    }

    // Build per-fault-type accuracy map for specialized learning
    const perFaultAcc = new Map<string, number>();
    for (const [ft, t] of faultTypeTracker) {
      perFaultAcc.set(ft, t.cases > 0 ? t.correct / t.cases : 0);
    }

    this.calibrator.train(trainingExamples, perFaultAcc);

    return {
      suiteName: suite.name,
      totalCases,
      avgTop1,
      avgTop3,
      avgTop5,
      locationAccuracy,
      typeAccuracy,
      perFaultType,
      failures,
      duration,
    };
  }

  /**
   * Run all benchmark suites and produce a complete report.
   *
   * @param suites - Array of benchmark suites to run.
   * @returns CompleteBenchmarkReport with aggregated metrics.
   */
  async runAll(suites: readonly BenchmarkSuite[]): Promise<CompleteBenchmarkReport> {
    const startTime = Date.now();
    const suiteResults: RunResult[] = [];

    for (const suite of suites) {
      const result = await this.runSuite(suite);
      suiteResults.push(result);
    }

    const totalCases = suiteResults.reduce((sum, r) => sum + r.totalCases, 0);
    const totalFailures = suiteResults.reduce((sum, r) => sum + r.failures.length, 0);

    // Weighted aggregate metrics
    const aggregateAvgTop1 =
      totalCases > 0
        ? suiteResults.reduce((sum, r) => sum + r.avgTop1 * r.totalCases, 0) / totalCases
        : 0;
    const aggregateAvgTop5 =
      totalCases > 0
        ? suiteResults.reduce((sum, r) => sum + r.avgTop5 * r.totalCases, 0) / totalCases
        : 0;
    const aggregateLA =
      totalCases > 0
        ? suiteResults.reduce((sum, r) => sum + r.locationAccuracy * r.totalCases, 0) / totalCases
        : 0;
    const aggregateTA =
      totalCases > 0
        ? suiteResults.reduce((sum, r) => sum + r.typeAccuracy * r.totalCases, 0) / totalCases
        : 0;

    const totalDuration = Date.now() - startTime;

    return {
      suiteResults,
      totalCases,
      aggregateAvgTop1,
      aggregateAvgTop5,
      aggregateLA,
      aggregateTA,
      totalFailures,
      totalDuration,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get the internal weight calibrator for persistence / inspection (I10).
   *
   * Use this after benchmark runs to save learned weights:
   *   const json = runner.getCalibrator().toJSON();
   *   fs.writeFileSync('rca-weights.json', json);
   *
   * And later:
   *   const saved = WeightCalibrator.fromJSON(fs.readFileSync('rca-weights.json', 'utf8'));
   *   const runner = new BenchmarkRunner(c, undefined, undefined, saved);
   */
  getCalibrator(): WeightCalibrator {
    return this.calibrator;
  }

  // ── Report Generation ──────────────────────────────────

  /**
   * Generate a formatted report from benchmark results.
   *
   * @param results - Array of suite run results.
   * @param format - Output format: 'text', 'json', or 'html'.
   * @returns Formatted report string.
   */
  generateReport(results: readonly RunResult[], format: 'text' | 'json' | 'html'): string {
    switch (format) {
      case 'json':
        return this.generateJsonReport(results);
      case 'html':
        return this.generateHtmlReport(results);
      case 'text':
      default:
        return this.generateTextReport(results);
    }
  }

  private generateTextReport(results: readonly RunResult[]): string {
    const lines: string[] = [];
    lines.push('='.repeat(70));
    lines.push('  Micro-Kinetic Benchmark Report');
    lines.push('='.repeat(70));
    lines.push('');

    const totalCases = results.reduce((s, r) => s + r.totalCases, 0);
    const totalFailures = results.reduce((s, r) => s + r.failures.length, 0);

    for (const result of results) {
      lines.push(`  Suite: ${result.suiteName}`);
      lines.push(`  ──────────────────────────────────────────────────`);
      lines.push(`    Total Cases:      ${result.totalCases}`);
      lines.push(`    Avg@1:            ${(result.avgTop1 * 100).toFixed(1)}%`);
      lines.push(`    Avg@3:            ${(result.avgTop3 * 100).toFixed(1)}%`);
      lines.push(`    Avg@5:            ${(result.avgTop5 * 100).toFixed(1)}%`);
      lines.push(`    Location Accuracy: ${(result.locationAccuracy * 100).toFixed(1)}%`);
      lines.push(`    Type Accuracy:     ${(result.typeAccuracy * 100).toFixed(1)}%`);
      lines.push(`    Duration:          ${result.duration}ms`);
      lines.push('');

      // Per-fault-type breakdown
      if (result.perFaultType.size > 0) {
        lines.push('    Per-Fault-Type Accuracy:');
        for (const [faultType, metric] of result.perFaultType) {
          lines.push(
            `      ${faultType.padEnd(20)} ${metric.cases.toString().padStart(4)} cases  ${(metric.accuracy * 100).toFixed(1).padStart(6)}%`,
          );
        }
        lines.push('');
      }

      // Top failures
      if (result.failures.length > 0) {
        lines.push(`    Failures (${result.failures.length}):`);
        const topFailures = result.failures.slice(0, 5);
        for (const failure of topFailures) {
          lines.push(`      - ${failure.caseId}: ${failure.reason}`);
        }
        if (result.failures.length > 5) {
          lines.push(`      ... and ${result.failures.length - 5} more`);
        }
        lines.push('');
      }
    }

    lines.push('  SUMMARY');
    lines.push(`  ──────────────────────────────────────────────────`);
    lines.push(`    Total Cases:      ${totalCases}`);
    lines.push(`    Total Failures:   ${totalFailures}`);

    if (totalCases > 0) {
      const weightedAvg1 = results.reduce((s, r) => s + r.avgTop1 * r.totalCases, 0) / totalCases;
      const weightedAvg5 = results.reduce((s, r) => s + r.avgTop5 * r.totalCases, 0) / totalCases;
      lines.push(`    Weighted Avg@1:   ${(weightedAvg1 * 100).toFixed(1)}%`);
      lines.push(`    Weighted Avg@5:   ${(weightedAvg5 * 100).toFixed(1)}%`);
    }

    lines.push('');
    lines.push('='.repeat(70));

    return lines.join('\n');
  }

  private generateJsonReport(results: readonly RunResult[]): string {
    const totalCases = results.reduce((s, r) => s + r.totalCases, 0);
    const totalFailures = results.reduce((s, r) => s + r.failures.length, 0);

    const weightedAvg1 =
      totalCases > 0 ? results.reduce((s, r) => s + r.avgTop1 * r.totalCases, 0) / totalCases : 0;
    const weightedAvg5 =
      totalCases > 0 ? results.reduce((s, r) => s + r.avgTop5 * r.totalCases, 0) / totalCases : 0;

    const report = {
      timestamp: new Date().toISOString(),
      suites: results.map((r) => ({
        name: r.suiteName,
        totalCases: r.totalCases,
        avgTop1: r.avgTop1,
        avgTop3: r.avgTop3,
        avgTop5: r.avgTop5,
        locationAccuracy: r.locationAccuracy,
        typeAccuracy: r.typeAccuracy,
        duration: r.duration,
        perFaultType: Object.fromEntries([...r.perFaultType.entries()].map(([k, v]) => [k, v])),
        failures: r.failures.length,
        topFailures: r.failures.slice(0, 10).map((f) => ({
          caseId: f.caseId,
          expectedService: f.expectedService,
          actualTop: f.actualTop,
          reason: f.reason,
          diag: f.diag,
        })),
      })),
      summary: {
        totalCases,
        totalFailures,
        weightedAvgTop1: weightedAvg1,
        weightedAvgTop5: weightedAvg5,
      },
    };

    return JSON.stringify(report, null, 2);
  }

  private generateHtmlReport(results: readonly RunResult[]): string {
    const totalCases = results.reduce((s, r) => s + r.totalCases, 0);
    const totalFailures = results.reduce((s, r) => s + r.failures.length, 0);
    const weightedAvg1 =
      totalCases > 0 ? results.reduce((s, r) => s + r.avgTop1 * r.totalCases, 0) / totalCases : 0;
    const weightedAvg5 =
      totalCases > 0 ? results.reduce((s, r) => s + r.avgTop5 * r.totalCases, 0) / totalCases : 0;

    const suiteRows = results
      .map((r) => {
        const failureDetails = r.failures
          .slice(0, 5)
          .map((f) => `<li>${escapeHtml(f.caseId)}: ${escapeHtml(f.reason)}</li>`)
          .join('');

        const faultTypeRows = [...r.perFaultType.entries()]
          .map(
            ([ft, m]) =>
              `<tr><td>${escapeHtml(ft)}</td><td>${m.cases}</td><td>${(m.accuracy * 100).toFixed(1)}%</td></tr>`,
          )
          .join('');

        return `
      <div class="suite">
        <h2>${escapeHtml(r.suiteName)}</h2>
        <table>
          <tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Total Cases</td><td>${r.totalCases}</td></tr>
          <tr><td>Avg@1</td><td>${(r.avgTop1 * 100).toFixed(1)}%</td></tr>
          <tr><td>Avg@3</td><td>${(r.avgTop3 * 100).toFixed(1)}%</td></tr>
          <tr><td>Avg@5</td><td>${(r.avgTop5 * 100).toFixed(1)}%</td></tr>
          <tr><td>Location Accuracy</td><td>${(r.locationAccuracy * 100).toFixed(1)}%</td></tr>
          <tr><td>Type Accuracy</td><td>${(r.typeAccuracy * 100).toFixed(1)}%</td></tr>
          <tr><td>Duration</td><td>${r.duration}ms</td></tr>
        </table>
        <h3>Per-Fault-Type</h3>
        <table><tr><th>Fault Type</th><th>Cases</th><th>Accuracy</th></tr>${faultTypeRows}</table>
        <h3>Failures (${r.failures.length})</h3>
        <ul>${failureDetails}${r.failures.length > 5 ? `<li>... and ${r.failures.length - 5} more</li>` : ''}</ul>
      </div>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Micro-Kinetic Benchmark Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1000px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
  h1 { color: #333; border-bottom: 2px solid #4a90d9; padding-bottom: 10px; }
  h2 { color: #4a90d9; margin-top: 30px; }
  table { border-collapse: collapse; width: 100%; margin: 10px 0; background: white; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #4a90d9; color: white; }
  .suite { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
  .summary { background: #e8f4fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
  ul { margin: 5px 0; }
  li { margin: 3px 0; color: #c0392b; }
</style>
</head>
<body>
  <h1>Micro-Kinetic Benchmark Report</h1>
  <div class="summary">
    <h2>Summary</h2>
    <table>
      <tr><th>Metric</th><th>Value</th></tr>
      <tr><td>Total Cases</td><td>${totalCases}</td></tr>
      <tr><td>Total Failures</td><td>${totalFailures}</td></tr>
      <tr><td>Weighted Avg@1</td><td>${(weightedAvg1 * 100).toFixed(1)}%</td></tr>
      <tr><td>Weighted Avg@5</td><td>${(weightedAvg5 * 100).toFixed(1)}%</td></tr>
      <tr><td>Report Generated</td><td>${new Date().toISOString()}</td></tr>
    </table>
  </div>
  ${suiteRows}
</body>
</html>`;
  }

  // ── Classifier Integration ──────────────────────────────

  /**
   * Enrich an engine prediction with a classifier-generated fault type.
   *
   * Uses the service's metric data from the benchmark case to run the
   * fault classifier (Layer 1 regex + Layer 2 statistical). The resulting
   * FaultType replaces the engine's default fault type, enabling meaningful
   * Type Accuracy computation.
   *
   * Falls back to the original prediction's faultType if no classifier
   * is configured or if metric data is unavailable.
   *
   * @param prediction - The engine-generated prediction.
   * @param metrics - All per-service metrics from the benchmark case.
   * @returns A new prediction with classifier-enriched faultType.
   */
  private enrichPrediction(
    prediction: RootCauseResult,
    metrics: ReadonlyMap<string, readonly TimeSeries[]>,
  ): RootCauseResult {
    if (!this.classifier) return prediction;

    // Look up the predicted service's metric data
    const serviceMetrics = metrics.get(prediction.serviceId);
    if (!serviceMetrics || serviceMetrics.length === 0) return prediction;

    // Run classifier
    const hypotheses = this.classifier.classify(serviceMetrics, {
      serviceId: prediction.serviceId,
      metricNames: serviceMetrics.map((s) => s.label),
    });

    // Convert best hypothesis to FaultType
    const classifiedFaultType = bestHypothesisToFaultType(hypotheses);

    // Only override if classifier produced a non-UNKNOWN result
    if (classifiedFaultType.category !== 'UNKNOWN') {
      return {
        ...prediction,
        faultType: classifiedFaultType,
      };
    }

    return prediction;
  }
}

// ── Helpers ───────────────────────────────────────────────

function formatFaultType(ft: FaultType): string {
  if (ft.subType) {
    return `${ft.category}-${ft.subType}`;
  }
  return ft.category;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a metric's raw feature-score decomposition for the failure
 * diagnostic: `dev=0.54 trend=0.27 cv=0.08 burst=0 rise=2.50 drop=0.00 base=0.40`.
 * Returns '' when no breakdown is available (e.g. the service had no metric).
 */
function formatBreakdown(
  b:
    | {
        deviation: number;
        trend: number;
        cv: number;
        burst: number;
        riseRatio: number;
        dropRatio: number;
        baselineMean: number;
      }
    | undefined,
): string {
  if (!b) return '';
  return (
    `dev=${b.deviation.toFixed(3)} trend=${b.trend.toFixed(3)} cv=${b.cv.toFixed(3)}` +
    ` burst=${b.burst.toFixed(3)} rise=${b.riseRatio.toFixed(3)} drop=${b.dropRatio.toFixed(3)}` +
    ` base=${b.baselineMean.toFixed(3)}`
  );
}
