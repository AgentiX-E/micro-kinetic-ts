/**
 * Root-cause reranker interface — a bounded, evidence-grounded LLM re-ranking
 * pass over the deterministic ranker's top-K candidates (GALA+ / RCLAgent
 * style).
 *
 * The deterministic ranker produces the candidate list; the reranker re-orders
 * it using ONLY per-candidate *evidence pointers* (metric shift, deepest-cause
 * log template, adjacency path), never the raw graph. This keeps the LLM call
 * bounded (≤2 rounds, top-K only) and grounded (no hallucinated topology), and
 * makes the fallback trivial: on any error the deterministic order is returned
 * unchanged.
 *
 * @module ai/interfaces
 */

import type { FaultRole } from '../agent/fault-role.js';

/**
 * Per-candidate evidence the reranker reasons over.
 *
 * Every field is optional except `serviceId`: the reranker must degrade
 * gracefully as evidence becomes sparse (e.g. TrainTicket RE3 has no source
 * exception, so `deepestLogException` is absent for the source).
 */
export interface CandidateEvidence {
  /** Topology service ID (the stable identity used throughout the pipeline). */
  readonly serviceId: string;
  /** Human-readable service name, when it differs from the ID. */
  readonly name?: string;
  /** Min-max-normalized anomaly score in [0, 1]. */
  readonly anomalyScore?: number;
  /** The metric that drove the anomaly score (e.g. "cpu", "workload"). */
  readonly dominantMetric?: string;
  /**
   * Compact metric-shift signature: head/tail samples of the dominant metric,
   * e.g. "head=[0.4,0.4,…] tail=[1.4,1.4,…]". Reveals rise vs collapse.
   */
  readonly metricShift?: string;
  /** Raw feature-score decomposition (deviation/trend/cv/burst/rise/drop). */
  readonly breakdown?: {
    readonly deviation: number;
    readonly trend: number;
    readonly cv: number;
    readonly burst: number;
    readonly riseRatio: number;
    readonly dropRatio: number;
    readonly baselineMean: number;
  };
  /** Deepest `Caused by:` exception class of the service's error logs. */
  readonly deepestLogException?: string;
  /** Count of post-injection ERROR/FATAL log lines (log signal). */
  readonly logVolume?: number;
  /** Compact adjacency summary, e.g. "upstream=[a,b] downstream=[c]". */
  readonly adjacency?: string;
  /**
   * Deterministic fault role (symptom vs silent-source candidate), derived
   * from graph structure. Populated by the investigator's evidence builder to
   * counter the model's "biggest anomaly = root cause" prior on wrong-value
   * faults. Absent for the single-shot reranker (which ranks by other signals).
   */
  readonly faultRole?: FaultRole;
  /**
   * Concise natural-language interpretation of the fault role, spelling out the
   * causal chain (e.g. "SYMPTOM: throws X = received bad input; walk upstream").
   * Absent when the role is `unclassified` or the field is not populated.
   */
  readonly interpretation?: string;
}

/**
 * A re-ranking request: the candidate list plus optional system context.
 */
export interface RerankRequest {
  /** Top-K candidates from the deterministic ranker, in their current order. */
  readonly candidates: readonly CandidateEvidence[];
  /** Optional free-text system context (system name, fault suite). */
  readonly context?: string;
}

/**
 * Result of a re-ranking pass.
 */
export interface RerankResult {
  /** Service IDs in the NEW ranked order (a permutation of the input). */
  readonly order: readonly string[];
  /** The model's free-text reasoning, when available. */
  readonly reasoning?: string;
}

/**
 * Root-cause reranker contract.
 *
 * Implementations are expected to be STATELESS and bounded: one `rerank` call
 * maps a candidate list to a re-ordered list, and never mutates inputs.
 */
export interface IRootCauseReranker {
  /** Provider/model identifier for logging. */
  readonly modelId: string;
  /**
   * Re-rank the given candidates into a new order.
   *
   * @param request - The candidates and optional context.
   * @returns The re-ordered service-ID list. Implementations MUST return a
   *   permutation of the input candidate IDs (never drop or invent IDs), and
   *   fall back to the input order on any failure.
   */
  rerank(request: RerankRequest): Promise<RerankResult>;
}
