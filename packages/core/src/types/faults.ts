/**
 * Fault and root cause analysis types.
 *
 * @module types/faults
 */

/** Severity level of a fault. */
export type FaultSeverity = 'critical' | 'major' | 'minor' | 'warning' | 'info';

import type { TimeSeries } from './time-series.js';

/** Categories of fault types for classification. */
export type FaultCategory =
  | 'CPU'
  | 'MEMORY'
  | 'MEM'
  | 'DISK'
  | 'NETWORK_DELAY'
  | 'NETWORK_LOSS'
  | 'SOCKET'
  | 'DELAY'
  | 'LOSS'
  | 'JVM_GC'
  | 'JVM_OOM'
  | 'CONNECTION_POOL'
  | 'MEMORY_LEAK'
  | 'DATA_SKEW'
  | 'CODE_ERROR'
  | 'MISCONFIGURATION'
  | 'DNS_FAILURE'
  | 'UNKNOWN';

/** Type identifier for a specific fault. */
export interface FaultType {
  readonly category: FaultCategory;
  readonly subType: string;
  readonly severity: FaultSeverity;
}

/** Indicator of chronic (slow-degrading) fault behavior. */
export interface ChronicFaultIndicator {
  /** The metric showing degradation */
  readonly metric: string;
  /** Estimated degradation rate (e.g., 1 KB/s for memory leak) */
  readonly degradationRate: number;
  /** Correlation coefficient with time (0-1) */
  readonly temporalCorrelation: number;
  /** Whether this indicator shows monotonic degradation */
  readonly isMonotonic: boolean;
}

/** A single root cause analysis result. */
export interface RootCauseResult {
  /** Service identified as root cause */
  readonly serviceId: string;
  /** Fault type classification */
  readonly faultType: FaultType;
  /** Confidence score (0-1) */
  readonly confidence: number;
  /** Rank in Top-K results (1-based) */
  readonly rank: number;
  /**
   * The raw ranking score this result was ordered by, in the (log-space)
   * `finalScore` produced by the tree pruner:
   *
   *   finalScore(v) = log1p(selfAnomaly(v)) + Σ signalWeight × signal(v)
   *
   * Unlike `confidence` — which folds in propagation-depth and error-bound
   * penalties for display — `finalScore` is the exact value the sort uses, so
   * the gap between two candidates' `finalScore` values is the engine's true
   * ranking margin. It is only populated by the tree pruner; other producers
   * (log/trace/fusion providers) leave it `undefined`.
   */
  readonly finalScore?: number;
  /**
   * The NAMED contributions that sum to {@link finalScore}, as the producer computed them.
   *
   * ## Why a score needs its own breakdown
   *
   * `finalScore` is a sum, so it can say that one candidate outranked another and never which of the thirteen
   * terms did it. That is the difference between knowing a ranker lost and knowing what it lost on — and it is
   * not recoverable downstream: a reader given `finalScore` and the graph would have to re-implement the sum
   * to take it apart, which is the second implementation of a quantity this project treats as a defect.
   *
   * So the breakdown comes from the ONE place that knows it, and it carries an invariant that makes it
   * checkable rather than merely informative: **the contributions sum exactly to `finalScore`**, term for term,
   * in the order the formula states them. A breakdown that does not add up is a description of a different
   * score, and the fence asserts the identity instead of trusting the two to stay in step.
   *
   * Populated by the tree pruner only; other producers leave it `undefined`, for the same reason they leave
   * `finalScore` unset — they do not compute this sum.
   */
  readonly terms?: readonly ScoreTerm[];
  /** Time of root cause event (Unix ms) */
  readonly timestamp?: number;
  /** Supporting evidence metrics */
  readonly evidenceMetrics: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly threshold: number;
  }>;
  /** Propagation depth from root to first observable symptom */
  readonly propagationDepth: number;
  /** The error bound at this propagation depth */
  readonly propagationErrorBound: number;
  /** Whether this result was found via tree search (vs full graph) */
  readonly viaTreeSearch: boolean;
}

/**
 * WHY a term contributed exactly zero — one value per mechanism the ranking formula actually has.
 *
 * The five are the point of recording one: a zero produced by any of them is the SAME NUMBER and a different
 * problem, and a table of contributions cannot separate them because a difference between two zeros is zero.
 *
 * The two `INPUT_*` members are deliberately NOT merged. "The graph does not carry this field at all" and "the
 * field is there and this candidate has no entry in it" send a reader to the same FIELD but to different ends of
 * it — an upstream producer that never emitted the tier, against a per-candidate measurement that is missing —
 * and a record that merges them cannot be split later without another run.
 */
export type TermZeroCause =
  /**
   * The term's configured weight is exactly 0.
   *
   * The contribution is 0 whatever the corpus says, so **nothing about the corpus can be inferred from it** —
   * this is a CONFIGURATION fact, and the work it implies is to a configuration rather than to the data.
   */
  | 'WEIGHT_ZERO'
  /** The weight is non-zero and the whole OPTIONAL source this term reads is ABSENT from the graph. */
  | 'INPUT_MAP_ABSENT'
  /** The weight is non-zero and the OPTIONAL source is present but carries no entry for this candidate. */
  | 'INPUT_ENTRY_ABSENT'
  /**
   * The weight and the input are both present, and a MASK inside the formula forced the contribution to 0.
   *
   * The named `mask` says which gate, and the value it overrode was NOT zero — so unlike `VALUE_ZERO` this is
   * evidence that arrived and was declined.
   */
  | 'MASKED'
  /**
   * The weight and the input are both present and no mask applies, so the value read is exactly 0.
   *
   * An absence of evidence for this term on this candidate.
   */
  | 'VALUE_ZERO';

/**
 * Whether a term's OPTIONAL source carried the candidate it was asked about.
 *
 * Three states rather than a boolean, because "absent" is two different facts about two different places.
 */
export type TermSourcePresence = 'PRESENT' | 'MAP_ABSENT' | 'ENTRY_ABSENT';

/**
 * One named contribution to a ranking score, already multiplied by its weight.
 *
 * The name is the formula's own word for the term, so a consumer can group, compare and report contributions
 * without a mapping table — and so a term added to the formula without a name here is a term the breakdown
 * cannot silently absorb into a total.
 */
export interface ScoreTerm {
  /** The term's name, as the ranking formula spells it. */
  readonly name: string;
  /** Its contribution to the total score, weight already applied. May be negative. */
  readonly contribution: number;
  /**
   * Present ONLY when `contribution === 0`, and then naming the mechanism that made it zero.
   *
   * Its ABSENCE is therefore information too: it says the term was live. Reporting a cause beside a non-zero
   * contribution would invite a reader to treat a term that decided something as a term that did not.
   */
  readonly cause?: TermZeroCause;
  /** For the two `INPUT_*` causes: the name of the OPTIONAL source, so the field is named. */
  readonly source?: string;
  /** For `MASKED`: the name of the gate that forced the zero, so the override is named. */
  readonly mask?: string;
}

/** Options for RCA engine configuration. */
export interface RCAEngineOptions {
  /** Pruning epsilon threshold for cycle contributions */
  readonly pruneEpsilon: number;
  /** Critical load threshold below which Σw(C) → 0 */
  readonly criticalLoadThreshold: number;
  /** Default Top-K value */
  readonly defaultTopK: number;
  /** Maximum propagation depth to explore */
  readonly maxPropagationDepth: number;
}

/** Default RCA engine options. */
export const DEFAULT_RCA_OPTIONS: RCAEngineOptions = {
  pruneEpsilon: 0.001,
  criticalLoadThreshold: 0.7,
  defaultTopK: 5,
  maxPropagationDepth: 10,
};

/** Mapping from service ID to its time series metrics. */
export type MetricMap = ReadonlyMap<string, readonly TimeSeries[]>;
