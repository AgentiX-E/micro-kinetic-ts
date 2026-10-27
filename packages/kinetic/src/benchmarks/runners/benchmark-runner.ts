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
  type FaultPropagationGraph,
  type FaultType,
  type IContainer,
  type IFaultClassifier,
  type IRCAEngine,
  type RootCauseResult,
  type ServiceCallGraph,
  bestHypothesisToFaultType,
} from '@agentix-e/micro-kinetic-core';

import type { TimeSeries, TraceSpan } from '@agentix-e/micro-kinetic-core';

import type { BenchmarkCase, BenchmarkSuite } from '../loaders/types.js';

import { toFaultGraphOptions } from './fault-graph-options.js';
import { computeAvgAtK, computeTA } from './metrics.js';
import { caseWeightedMean } from './suite-accuracy.js';

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
  /** Cases whose FIRST-ranked service is the ground truth. */
  readonly correct: number;
  /** Top-1 accuracy (0-1). This is the column the RCAEval table prints as `AC@1`. */
  readonly accuracy: number;
  /**
   * Cases whose ground truth is anywhere in the first five ranked services — `Acc@5`, a DIAGNOSTIC.
   *
   * It is not `Avg@5`. RCAEval's `Avg@5` is `(1/5)·Σ_{k=1..5} Acc@k`, so a case at rank 3 contributes
   * `3/5` and a case at rank 1 contributes `1`; a hit-at-5 count is that sum's last term alone. The two
   * coincide only when every case that is inside five is at rank one, which is why the distinction has to
   * be a field name rather than a comment.
   */
  readonly top5Correct: number;
  /** `Acc@5` ratio (0-1): the share of cases with the truth inside the first five. */
  readonly acc5: number;
  /** RCAEval's `Avg@5`: the mean over cases of `(1/5)·Σ_{k=1..5} Acc@k` (0-1). */
  readonly avg5: number;

  /** Cases whose top-1 prediction names the ground-truth FAULT TYPE. */
  readonly typeCorrect: number;
  /** Fault-type accuracy of the top-1 prediction (0-1). */
  readonly typeAccuracy: number;
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
    /**
     * The truth's 1-based position in the FULL ranking, and how many candidates that ranking has.
     *
     * The two are what make a failure block answer the only question that decides whether a cell is winnable
     * by the engine's own criterion: is the truth BELOW the candidates that beat it, or merely outside the
     * printed top five? `gtAnomaly` and `maxAnomaly` bound the answer but cannot give it — a truth at rank 6
     * of 64 and a truth at rank 64 of 64 print identical blocks today, and they call for opposite fixes.
     *
     * Measured on RE3-TrainTicket (`docs/re3-quiet-truth.md`): 11 of 14 sampled misses have the truth below
     * EVERY candidate in the top five, and this pair is what says whether it is also below the rest.
     */
    readonly gtRank: number;
    readonly candidateCount: number;
    readonly topK: readonly {
      readonly serviceId: string;
      readonly confidence: number;
      /**
       * The raw ranking score this entry was ordered by.
       *
       * Carried because the ladder renders a RANKED list, and a ranked list that does not print its sort key
       * cannot be checked against itself: `confidence` folds in propagation-depth and error-bound penalties
       * for display and therefore need not decrease with rank, so a line printed from it reads as unsorted.
       */
      readonly finalScore?: number | undefined;
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
     * Trace span-activity rise signal diagnostics: the ground-truth service's
     * pre/post span counts and its rise ratio, plus the service with the
     * highest post/pre ratio (the signal's top candidate). Absent when the
     * case carried no trace-activity counts.
     */
    readonly gtTraceActivity?: { pre: number; post: number; ratio: number };
    readonly topTraceActivity?: { service: string; pre: number; post: number; ratio: number };
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

/** A single case's top-1 prediction, for downstream fusion analysis. */
export interface CasePrediction {
  /** Case identifier. */
  readonly caseId: string;
  /** Ground-truth service id. */
  readonly truth: string;
  /** The engine's top-1 prediction, or `undefined` when analysis threw. */
  readonly top1: string | undefined;
  /** Whether `top1` matches `truth`. */
  readonly correct: boolean;
  /**
   * The engine's top-2 prediction, or `undefined` when fewer than two
   * candidates were ranked. Used by routing analysis to measure the engine's
   * ranking margin.
   */
  readonly top2?: string | undefined;
  /** The engine's top-1 ranking `finalScore` (the raw sort value). */
  readonly top1Score?: number;
  /**
   * The engine's top-2 ranking `finalScore`, when a top-2 exists.
   */
  readonly top2Score?: number;
  /**
   * The ground truth's 1-based rank in the engine's FULL ranking, or `undefined` when the truth does not
   * appear in it at all.
   *
   * Full and not a top-K prefix, because a prefix cannot tell a truth at rank 6 from one at rank 40 — and
   * the whole difference between a RETRIEVAL problem and a RERANKING one is whether the truth appears
   * anywhere in the ranking at all. Recorded, not derived: the ranked list is the engine's own output and
   * this is where it is still in hand.
   */
  readonly truthRank?: number | undefined;
  /**
   * How many services the engine actually ranked: the size of the set `truthRank` indexes into.
   *
   * Not the graph's node count — the engine scores the graph it was handed, and that is the set a ranking
   * could have returned a member of. The denominator of the census, and the reason a retrieval count belongs
   * beside it: a truth outside this set cannot be returned by any ranking of it, however good, so the count
   * without the size would read as an engine miss.
   */
  readonly pool?: number;
  /**
   * Whether the engine threw before producing a ranking.
   *
   * Kept distinct from a miss, because a case whose analysis failed has no candidate pool to be inside or
   * outside of: reporting it as a truth absent from the pool would attribute an engine failure to the data.
   */
  readonly errored?: boolean;
  /**
   * The ground truth's OWN evidence, as the engine recorded it — present only when the truth appears in the
   * ranking, because a truth the ranking never surfaces has no score of its own to report.
   *
   * ## Why this is here rather than inferred
   *
   * `truthRank` says WHICH FAILURE a miss is (retrieval or reranking). It cannot say whether the truth was
   * rankable at all: a truth ranked 26th of 68 and a truth ranked 26th because nothing moved at its origin
   * are the same rank and completely different problems, and only one of them is a ranking problem. The
   * field that separates them is the truth's own local evidence, and the engine already computes it —
   * `rca_score`, the self-anomaly term of `finalScore(v) = log1p(selfAnomaly(v)) + Σ signalWeight × signal(v)`,
   * with the threshold it was judged against.
   *
   * **Read from the producer, not recomputed.** The threshold travels with the value so the boundary between
   * "no local evidence" and "local evidence, ranked deep" is the ENGINE'S OWN and not a constant invented
   * here: a re-derived copy of a threshold is the defect this repository keeps recording, and it would let a
   * change to the engine's own cut silently move a count that claims to be about it.
   */
  readonly truthEvidence?: TruthEvidence | undefined;
  /**
   * The WINNER's `finalScore` broken into its named terms.
   *
   * The other half of an attribution. "Which term did the truth lose on" is a question about a GAP, and a gap
   * has two sides: the truth's own breakdown (inside {@link truthEvidence}) says where it gained, and this says
   * where the candidate that beat it did. Recorded together because they are only meaningful together — a
   * breakdown of one side is a list of contributions to an unknown difference.
   *
   * Not part of `truthEvidence` deliberately: the winner is not evidence about the truth, and folding it there
   * would put a second candidate's scores under a name that promises they belong to the first.
   */
  readonly top1Terms?: readonly ScoreTerm[] | undefined;
}

/**
 * The ground truth's own score and the evidence the engine recorded for it, in the engine's own terms.
 *
 * Every field is copied from the truth's {@link RootCauseResult}: `rcaScore` and `rcaThreshold` out of its
 * `evidenceMetrics` (where `rca_score` carries the threshold it was judged against), `collisionGain` when the
 * collision term contributed, and the depth and search route the ranking reported. Nothing is recomputed and
 * nothing is defaulted — an absent metric stays absent, so "the engine did not report it" is distinguishable
 * from "the engine reported zero", which is the whole reason the split below can be trusted.
 */
export interface TruthEvidence {
  /** The truth's `rca_score`: the self-anomaly term of its `finalScore`. */
  readonly rcaScore?: number | undefined;
  /** The threshold `rca_score` was judged against, AS THE ENGINE RECORDED IT. */
  readonly rcaThreshold?: number | undefined;
  /** The truth's collision contribution, when the collision term produced one. */
  readonly collisionGain?: number | undefined;
  /** The truth's `finalScore` — the value the ranking sorted by — when the pruner produced one. */
  readonly finalScore?: number | undefined;
  /**
   * The truth's `finalScore` broken into its named terms, as the pruner emitted them.
   *
   * The field that answers the question a rank cannot: WHICH term the truth lost on. `rcaScore` says the origin
   * deviated; only the breakdown says whether the loss sits in the base term or somewhere a weight could move.
   * Read from the result rather than recomputed — `sumScoreTerms(terms) === finalScore` is an invariant the
   * producer's own fence asserts, so a second sum here would be a second implementation of a value the engine
   * already publishes, and it would agree with the first until one of them was edited.
   */
  readonly terms?: readonly ScoreTerm[] | undefined;
  /** The truth's propagation depth, as the ranking reported it. */
  readonly depth: number;
  /** Whether the ranking found the truth by tree search rather than in the full graph. */
  readonly viaTreeSearch: boolean;
  /** How many evidence metrics the engine recorded for the truth. Zero is a fact, not a missing measurement. */
  readonly metricCount: number;
}

/**
 * WHY a term contributed exactly zero — one value per mechanism the ranking formula actually has.
 *
 * A literal mirror of the core package's union of the same name, for the reason {@link TruthEvidence} gives
 * about the shape it is nested in: this project does not depend on the core package, so the members are copied
 * and the agreement of the two declarations is fenced by test rather than assumed.
 */
export type TermZeroCause =
  | 'WEIGHT_ZERO'
  | 'INPUT_MAP_ABSENT'
  | 'INPUT_MAP_EMPTY'
  | 'INPUT_ENTRY_ABSENT'
  | 'MASKED'
  | 'VALUE_ZERO';

/**
 * One named contribution to a ranking score, already multiplied by its weight.
 *
 * A literal mirror of the core package's `ScoreTerm`, for the reason {@link TruthEvidence} gives about the shape
 * it is nested in: this project does not depend on the core package, so the shape is copied and the agreement of
 * the two declarations is fenced by test rather than assumed.
 */
export interface ScoreTerm {
  /** The term's name, as the ranking formula spells it. */
  readonly name: string;
  /** Its contribution to the total score, weight already applied. May be negative. */
  readonly contribution: number;
  /** Present only when `contribution === 0`, naming the mechanism that made it zero. */
  readonly cause?: TermZeroCause;
  /** For every `INPUT_*` cause: the OPTIONAL source that was absent, so the field is named. */
  readonly source?: string;
  /** For `MASKED`: the gate that forced the zero. */
  readonly mask?: string;
}

/**
 * Extract the ground truth's own evidence from the ranking it appears in.
 *
 * **The precondition is real rather than defensive, and it is stated here because the obvious guards are arms no
 * input can reach.** Its only caller has already established `at >= 0` by finding the truth with `findIndex`, and
 * that same search makes `ranking[at]` a valid element — so an `at < 0` branch and a `ranking[at] === undefined`
 * branch would both be dead code, which the coverage gate then reports as uncovered arms (the lesson `median()` in
 * `benchmarks/src/loss-census.ts` records). The index assertion is therefore the whole guard, and it is the same
 * one `median()` uses on a sorted array whose non-emptiness its caller established.
 *
 * @param ranking - The engine's full ranked output.
 * @param at - The truth's 0-based index in `ranking`. MUST be `>= 0`, i.e. the truth IS in the ranking.
 * @returns The evidence recorded for the truth at that index.
 */
function truthEvidenceIn(ranking: readonly RootCauseResult[], at: number): TruthEvidence {
  const hit = ranking[at]!;
  const metric = (name: string): number | undefined =>
    hit.evidenceMetrics.find((m) => m.metric === name)?.value;
  const threshold = hit.evidenceMetrics.find((m) => m.metric === 'rca_score')?.threshold;
  return {
    rcaScore: metric('rca_score'),
    rcaThreshold: threshold,
    collisionGain: metric('collision_gain'),
    finalScore: hit.finalScore,
    // Copied through untouched: the breakdown is the producer's, and this record's job is to carry it rather
    // than to re-derive, re-name or re-sign any part of it.
    terms: hit.terms,
    depth: hit.propagationDepth,
    viaTreeSearch: hit.viaTreeSearch,
    metricCount: hit.evidenceMetrics.length,
  };
}

/**
 * One diagnosed case, handed to a {@link CaseDiagnosticSink}.
 *
 * Carries the three objects the engine produced and nothing else: the case it scored, the graph it
 * built, and the ranking it returned. A sink that needs a per-service magnitude re-derives it from
 * these, which is the point — a runner that pre-chewed them would be a second implementation of the
 * scoring it just delegated.
 */
export interface DiagnosedCaseRecord {
  readonly case: BenchmarkCase;
  /** The graph the engine built and ranked over — the input to every diagnostic. */
  readonly graph: FaultPropagationGraph;
  readonly ranking: readonly RootCauseResult[];
  /**
   * The call graph the engine consumed, AFTER any trace-topology refinement.
   *
   * Not `case.callGraph`: a runner with trace validation enabled prunes and discovers edges before
   * scoring, and a diagnostic that reported the pre-refinement graph would describe a topology the
   * ranking never saw.
   */
  readonly callGraph: ServiceCallGraph;
}

/**
 * A per-case hook, called once per SUCCESSFULLY diagnosed case.
 *
 * A case whose analysis threw is not handed over, because there is no graph and no ranking to
 * report — and a record with an empty graph would read, in every downstream analysis, as a case the
 * engine scored and got wrong rather than one it never scored.
 */
export type CaseDiagnosticSink = (record: DiagnosedCaseRecord) => void;

/** Result of running a single benchmark suite. */
export interface RunResult {
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
  /** Per-case top-1 predictions, aligned with case order. */
  readonly casePredictions: readonly CasePrediction[];
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
   * @param onDiagnosedCase - Optional per-case hook, handed the case, the graph the engine built and
   *   the ranking it returned. It is how a runner emits a diagnostic dump without owning the format:
   *   the assembler lives beside the dump's formatter, and this runner only forwards what it already
   *   has in hand.
   * @returns RunResult with all computed metrics.
   */
  async runSuite(suite: BenchmarkSuite, onDiagnosedCase?: CaseDiagnosticSink): Promise<RunResult> {
    const startTime = Date.now();
    const engine = this.container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);
    const topK = 5;
    /**
     * How many candidates the engine is asked to rank — the WHOLE candidate set, not the top five.
     *
     * `topK` above is the REPORTING width and stays 5: the metrics read prefixes of the ranking and the first
     * element, so widening the call cannot move them. But the loss census needs the truth's rank wherever it
     * falls and the size of the set it fell in, and neither survives a five-element slice: a truth at rank 6
     * is indistinguishable from one at rank 400, and the difference between those is most of a reranking
     * fix's value.
     *
     * Bounded by the graph the engine was handed rather than by a constant, because a constant is a silent
     * cap: the audit of this benchmark records telemetry exposing 12 to 70 services per system, and a hard
     * number above that would be correct today and quietly wrong the moment a system grew past it. `pool` in
     * each census record is what the engine actually ranked, so a shortfall is visible in the artifact rather
     * than inferred from the call.
     */
    const rankingCaptureDepth = (graph: { readonly nodes: ReadonlyMap<string, unknown> }): number =>
      Math.max(topK, graph.nodes.size);

    // Collect all predictions and ground truths
    const predictions: RootCauseResult[] = [];
    const truthServiceIds: string[] = [];
    const truthFaultTypes: string[] = [];
    const failures: FailedCase[] = [];
    // Full ranked service-ID list per case (for correct Avg@K computation).
    // Aligned with `predictions` and `truthServiceIds` by push order.
    const caseRankedPredictions: string[][] = [];
    // Per-case top-1 record (caseId / truth / top1), aligned with the cases,
    // for downstream fusion-ceiling analysis. Populated once per case — in the
    // success path and in the catch path — so the length always equals
    // `suite.cases.length`.
    const casePredictionRecords: CasePrediction[] = [];

    // Per-fault-type tracking
    // Four counters per fault type, because the table prints four rows. `correct` is Top-1,
    // `top5` is a hit anywhere in the first five (RCAEval's `Avg@5` numerator), and `type` is the
    // top-1 prediction naming the ground-truth fault type. They were one counter until the printed
    // `Avg@5`/`LA`/`TA` rows were found to be the `AC@1` column reprinted.
    const faultTypeTracker = new Map<
      string,
      { cases: number; correct: number; top5: number; avg5: number; type: number }
    >();

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

        const faultGraph = engine.buildFaultGraph(
          effectiveCallGraph,
          benchCase.metrics,
          toFaultGraphOptions(benchCase, this.useInjectTime ? benchCase.injectTime : 0),
        );
        const results = await engine.analyze(faultGraph, rankingCaptureDepth(effectiveCallGraph));

        // The diagnostic hook, after the ranking exists and before anything else touches the case:
        // what it is handed is what the engine just produced, not a copy that later steps may
        // enrich. Inside the `try` on purpose, so a case whose analysis threw is never reported as
        // one the engine scored.
        onDiagnosedCase?.({
          case: benchCase,
          graph: faultGraph,
          ranking: results,
          callGraph: effectiveCallGraph,
        });

        // Capture the full ranked service-ID list for correct Avg@K.
        caseRankedPredictions.push(results.slice(0, topK).map((r) => r.serviceId));

        // Per-case top-1 record for fusion analysis (success path).
        const caseTruth = benchCase.groundTruth.serviceId;
        const predTop1 = results[0]?.serviceId;
        // One search of the full ranking for both the truth's rank and its own evidence.
        const placement = truthPlacementIn(results, caseTruth);
        casePredictionRecords.push({
          caseId: benchCase.id,
          truth: caseTruth,
          top1: predTop1,
          correct: predTop1 !== undefined && predTop1 === caseTruth,
          top2: results[1]?.serviceId,
          top1Score: results[0]?.finalScore,
          top2Score: results[1]?.finalScore,
          // `findIndex` over the WHOLE ranked list, so a truth placed below the recorded top-K is still
          // ranked rather than reported as absent — the two are different failures and the census is what
          // tells them apart. `-1` becomes `undefined`, which the type distinguishes from rank 1.
          truthRank: placement.rank,
          pool: results.length,
          // The truth's OWN evidence, so a miss can say whether the origin deviated at all. A rank cannot:
          // rank 26 of 68 chosen because the other 25 moved and this one did not is a different problem
          // from rank 26 of 68 chosen between comparably-moving candidates, and only the second is a
          // ranking failure. Absent when the truth is not ranked, because then it has no score of its own.
          truthEvidence: placement.evidence,
          // And the winner's breakdown, so the two sides of the gap are recorded where both are still in
          // hand. Without it the census can say a case was lost and not what it was lost to.
          top1Terms: results[0]?.terms,
        });

        // ── Diagnostic snapshot for failing cases ──────────────────
        gtAnomaly = faultGraph.anomalyScores.get(benchCase.groundTruth.serviceId) ?? 0;
        maxAnomaly = Math.max(...faultGraph.anomalyScores.values());
        topPredictions = results.slice(0, topK).map((r) => ({
          serviceId: r.serviceId,
          confidence: r.confidence,
          // The value the ranking sorted by, carried so the rendered ladder can print the quantity its own
          // order came from. Without it the line shows `confidence` — which folds in depth and error-bound
          // penalties and therefore need not decrease with rank — so the printed numbers contradict the
          // order and no reader can check the line against itself.
          finalScore: r.finalScore,
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
        // Trace span-activity rise diagnostics: the GT's pre/post span counts
        // and rise ratio, plus the highest-ratio service (the signal's top
        // candidate). Only populated when the case carries trace-activity
        // counts; defensive against an empty map.
        let gtTraceActivity: { pre: number; post: number; ratio: number } | undefined;
        let topTraceActivity:
          { service: string; pre: number; post: number; ratio: number } | undefined;
        if (benchCase.traceActivity && benchCase.traceActivity.size > 0) {
          const gtCounts = benchCase.traceActivity.get(benchCase.groundTruth.serviceId);
          if (gtCounts) {
            gtTraceActivity = {
              pre: gtCounts.pre,
              post: gtCounts.post,
              ratio: traceActivityRiseRatio(gtCounts),
            };
          }
          let best: { service: string; pre: number; post: number; ratio: number } | undefined;
          for (const [service, counts] of benchCase.traceActivity) {
            const ratio = traceActivityRiseRatio(counts);
            if (!best || ratio > best.ratio) {
              best = { service, pre: counts.pre, post: counts.post, ratio };
            }
          }
          // The map is non-empty here (size > 0 guard above) and every ratio
          // is >= 0, so the first iteration always selects a winner.
          topTraceActivity = best;
        }

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
          tracker = { cases: 0, correct: 0, top5: 0, avg5: 0, type: 0 };
          faultTypeTracker.set(faultTypeKey, tracker);
        }
        tracker.cases++;

        // Check if correct at Top-1 (the ground-truth service is the single
        // highest-ranked prediction). This value feeds perFaultType.accuracy,
        // which is reported as AC@1 and must therefore be Top-1, NOT Top-K.
        const top1Service = results[0]?.serviceId;
        // The hit-at-5 share and the fault-type share are counted here, beside the Top-1 count and
        // from the same ranking, so the three printed rows describe one run rather than three passes.
        if (results.slice(0, 5).some((r) => r.serviceId === benchCase.groundTruth.serviceId)) {
          tracker.top5++;
        }
        // RCAEval's `Avg@5`: the mean of Acc@1..Acc@5 for THIS case, summed and divided by cases below.
        let accSum = 0;
        for (let k = 1; k <= 5; k++) {
          if (results.slice(0, k).some((r) => r.serviceId === benchCase.groundTruth.serviceId)) {
            accSum++;
          }
        }
        tracker.avg5 += accSum / 5;
        const topResult = results[0];
        if (topResult !== undefined && computeTA(topResult, faultTypeKey) === 1) {
          tracker.type++;
        }
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
              // `results` is the ranking the correctness checks above were counted from, so the rank and the
              // verdict are two readings of ONE array rather than two passes over the engine.
              gtRank: results.findIndex((r) => r.serviceId === benchCase.groundTruth.serviceId) + 1,
              candidateCount: results.length,
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
              gtTraceActivity,
              topTraceActivity,
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
        // Per-case top-1 record for fusion analysis (error path): analysis
        // threw before producing a ranking, so the prediction is undefined.
        casePredictionRecords.push({
          caseId: benchCase.id,
          truth: benchCase.groundTruth.serviceId,
          top1: undefined,
          correct: false,
          // No ranking exists and no graph was necessarily built, so the census must be able to say
          // "the engine failed" rather than filing this as a truth absent from a pool. The two are
          // different failures and only one of them is about the data.
          errored: true,
          pool: 0,
        });
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
            // No ranking exists on this path — the engine threw — so the rank is 0 and the denominator 0,
            // which the renderer prints as `ABSENT` rather than as a position. An errored case is not a
            // retrieval failure and must not be counted as one.
            gtRank: 0,
            candidateCount: 0,
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
        // `tracker.cases` is always ≥ 1 here — a tracker entry is created and
        // its `cases` incremented before it can appear in `faultTypeTracker`,
        // so the `cases > 0 ? … : 0` guard was unreachable dead code.
        accuracy: tracker.correct / tracker.cases,
        top5Correct: tracker.top5,
        acc5: tracker.top5 / tracker.cases,
        avg5: tracker.avg5 / tracker.cases,
        typeCorrect: tracker.type,
        typeAccuracy: tracker.type / tracker.cases,
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
      // Same invariant as above: a tracked fault type always has ≥1 case.
      perFaultAcc.set(ft, t.correct / t.cases);
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
      casePredictions: casePredictionRecords,
      duration,
    };
  }

  /**
   * Run all benchmark suites and produce a complete report.
   *
   * @param suites - Array of benchmark suites to run.
   * @returns CompleteBenchmarkReport with aggregated metrics.
   */
  /**
   * Fold these results' metric into one number, in the CASE-WEIGHTED convention.
   *
   * This class used to derive it in nine places: four in {@link runAll}, two in each of the three report
   * formatters. They all agreed, which is why they looked harmless — but they were nine copies of a fold
   * that the published table does NOT use (RCAEval's `AVERAGE` column is the unweighted mean over fault
   * types), and a copy that agrees today is a copy that can stop agreeing without anything failing. The
   * convention is now a CALL, so this file's choice is stated once and the arithmetic lives in one place.
   *
   * @param results - The per-suite results to fold.
   * @param pick - Which metric of a result to fold.
   * @returns The case-weighted mean, or `0` when no result carries a case.
   */
  private caseWeighted(results: readonly RunResult[], pick: (r: RunResult) => number): number {
    return caseWeightedMean(results.map((r) => ({ accuracy: pick(r), cases: r.totalCases })));
  }

  async runAll(suites: readonly BenchmarkSuite[]): Promise<CompleteBenchmarkReport> {
    const startTime = Date.now();
    const suiteResults: RunResult[] = [];

    for (const suite of suites) {
      const result = await this.runSuite(suite);
      suiteResults.push(result);
    }

    const totalCases = suiteResults.reduce((sum, r) => sum + r.totalCases, 0);
    const totalFailures = suiteResults.reduce((sum, r) => sum + r.failures.length, 0);

    // Case-weighted aggregates, and now NAMED as such by calling the owner's function for that
    // convention rather than re-deriving it here. This method's own summary reports it as weighted, so
    // the convention is not a defect — but it was a fourth hand-rolled implementation of the same
    // quantity, and a site that does not go through the owner is a site that can drift from it.
    const aggregateAvgTop1 = this.caseWeighted(suiteResults, (r) => r.avgTop1);
    const aggregateAvgTop5 = this.caseWeighted(suiteResults, (r) => r.avgTop5);
    const aggregateLA = this.caseWeighted(suiteResults, (r) => r.locationAccuracy);
    const aggregateTA = this.caseWeighted(suiteResults, (r) => r.typeAccuracy);

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
      const weightedAvg1 = this.caseWeighted(results, (r) => r.avgTop1);
      const weightedAvg5 = this.caseWeighted(results, (r) => r.avgTop5);
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

    const weightedAvg1 = this.caseWeighted(results, (r) => r.avgTop1);
    const weightedAvg5 = this.caseWeighted(results, (r) => r.avgTop5);

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
    const weightedAvg1 = this.caseWeighted(results, (r) => r.avgTop1);
    const weightedAvg5 = this.caseWeighted(results, (r) => r.avgTop5);

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
    // No `!this.classifier` guard here: `enrichPrediction` is a private helper
    // invoked only from the `this.classifier ? … : …` branch of `runSuite`, so
    // the classifier is always defined at this call site. The guard was
    // unreachable dead code.

    // Look up the predicted service's metric data
    const serviceMetrics = metrics.get(prediction.serviceId);
    if (!serviceMetrics || serviceMetrics.length === 0) return prediction;

    // Run classifier
    const hypotheses = this.classifier!.classify(serviceMetrics, {
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

/**
 * Where the ground truth sits in a full ranking, and what the engine recorded for it there.
 *
 * ONE search for two answers, deliberately. `rank` and `evidence` are both facts about the same element, and
 * a second `findIndex` for the second one would be a second implementation of "where is the truth" — the exact
 * shape this repository keeps recording, where two derivations of one quantity agree until one of them is
 * changed. Returning them together makes disagreement impossible rather than unlikely.
 *
 * `findIndex` over the recorded top-K PREFIX is not used: the difference between a truth at rank 6 and one
 * that never appears is the difference between a reranking failure and a retrieval one, and a prefix collapses
 * the two. `undefined` rather than `0` or `-1` for absence, so a caller cannot treat "absent" as a rank — the
 * engine's ranks start at 1 and a sentinel in that domain is a rank that does not exist.
 *
 * @param ranking - The engine's full ranked output.
 * @param truth - The ground-truth service id.
 * @returns The 1-based rank and the truth's own evidence, both absent when the truth is not ranked.
 */
function truthPlacementIn(
  ranking: readonly RootCauseResult[],
  truth: string,
): { rank?: number | undefined; evidence?: TruthEvidence | undefined } {
  const at = ranking.findIndex((r) => r.serviceId === truth);
  if (at < 0) return {};
  return { rank: at + 1, evidence: truthEvidenceIn(ranking, at) };
}

/**
 * Post/pre span-count rise ratio for the trace-activity signal. When the
 * pre-injection count is zero the ratio degenerates to the post count itself
 * (a service that emitted no spans before the fault and then went active is
 * the strongest possible riser).
 */
function traceActivityRiseRatio(counts: { pre: number; post: number }): number {
  return counts.pre > 0 ? counts.post / counts.pre : counts.post;
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
