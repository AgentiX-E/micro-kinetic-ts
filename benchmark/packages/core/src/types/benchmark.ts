/**
 * Benchmark and validation types.
 *
 * Defines the data model for RCAEval (735 cases), AIOps2025 (400 cases),
 * and RCA100 (103 cases) benchmark datasets.
 *
 * @module types/benchmark
 */

/** Identifier for a benchmark dataset. */
export type BenchmarkDatasetId =
  'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3' | 'aiops2025' | 'rca100';

/** A single benchmark test case. */
export interface BenchmarkCase {
  /** Unique case ID within the dataset */
  readonly caseId: string;
  /** Which dataset this belongs to */
  readonly datasetId: BenchmarkDatasetId;
  /** Microservice system name (e.g. "Online Boutique") */
  readonly systemName: string;
  /** Injected fault type */
  readonly faultType: string;
  /** Ground truth: service ID of actual root cause */
  readonly groundTruthServiceId: string;
  /** Ground truth: metric that indicates the fault */
  readonly groundTruthMetric?: string;
  /** Anomaly detection timestamp (Unix ms) */
  readonly anomalyTimestamp: number;
  /** Fault injection timestamp (Unix ms) */
  readonly injectTimestamp: number;
  /** Metrics data (service ID → time series) */
  readonly metrics: Record<
    string,
    {
      readonly timestamps: readonly number[];
      readonly values: readonly number[];
      readonly metricName: string;
    }
  >;
  /** Log entries if available */
  readonly logs?: ReadonlyArray<{
    readonly timestamp: number;
    readonly serviceId: string;
    readonly level: string;
    readonly message: string;
  }>;
  /** Trace spans if available */
  readonly traces?: ReadonlyArray<{
    readonly traceId: string;
    readonly spanId: string;
    readonly parentSpanId?: string;
    readonly serviceId: string;
    readonly operationName: string;
    readonly startTime: number;
    readonly duration: number;
    readonly status: 'OK' | 'ERROR';
  }>;
}

/** Top-K accuracy results for a benchmark run. */
export interface AvgAtK {
  /** Average accuracy at K=1 */
  readonly avgAt1: number;
  /** Average accuracy at K=3 */
  readonly avgAt3: number;
  /** Average accuracy at K=5 */
  readonly avgAt5: number;
}

/** Per-fault-type accuracy breakdown. */
export interface FaultTypeAccuracy {
  readonly faultType: string;
  readonly totalCases: number;
  readonly correctAt5: number;
  readonly accuracy: number;
}

/** Location accuracy and type accuracy (AIOps2025 metrics). */
export interface LA_TA_Scores {
  /** Location accuracy: predicted component matches ground truth */
  readonly locationAccuracy: number;
  /** Type accuracy: predicted fault type matches ground truth */
  readonly typeAccuracy: number;
  /** Explainability: evidence point coverage ratio */
  readonly explainability: number;
  /** Efficiency: penalty for overly long reasoning traces */
  readonly efficiency: number;
  /** Composite score: (0.4×LA + 0.4×TA + 0.1×Exp + 0.1×Eff) × 100 */
  readonly compositeScore: number;
}

/** Entity, fault, and process scores (RCA100 metrics). */
export interface EntityFaultProcessScores {
  /** Entity localization score */
  readonly entityScore: number;
  /** Fault identification score */
  readonly faultScore: number;
  /** Reasoning process score */
  readonly processScore: number;
  /** Composite score: (0.4×Entity + 0.3×Fault + 0.3×Process) × 100 */
  readonly compositeScore: number;
}

/** Complete benchmark run result. */
export interface BenchmarkResult {
  /** Dataset identifier */
  readonly datasetId: BenchmarkDatasetId;
  /** Total test cases run */
  readonly totalCases: number;
  /** Passed cases count */
  readonly passedCases: number;
  /** Top-K accuracy metrics */
  readonly avgAtK: AvgAtK;
  /** Per-fault-type accuracy breakdown */
  readonly perFaultType: readonly FaultTypeAccuracy[];
  /** AIOps2025-specific scores (only for aiops2025 dataset) */
  readonly laTaScores?: LA_TA_Scores;
  /** RCA100-specific scores (only for rca100 dataset) */
  readonly efpScores?: EntityFaultProcessScores;
  /** Execution time in milliseconds */
  readonly executionTimeMs: number;
  /** Memory peak in bytes */
  readonly memoryPeakBytes: number;
  /** Timestamp of benchmark run (ISO 8601) */
  readonly runTimestamp: string;
  /** Version of the library tested */
  readonly libraryVersion: string;
}
