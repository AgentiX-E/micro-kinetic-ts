/**
 * Standalone evaluation metrics for benchmark scoring.
 *
 * Implements standard information retrieval and RCA-specific metrics:
 * - Avg@K: Percentage of cases where the correct root cause appears in Top-K.
 * - Precision@K / Recall@K / F1: Standard IR metrics for ranked results.
 * - MRR: Mean Reciprocal Rank, standard for ranking quality.
 * - LA (Location Accuracy): Predicted service matches ground truth.
 * - TA (Type Accuracy): Predicted fault type matches ground truth.
 *
 * @module benchmarks/runners/metrics
 */

import type { RootCauseResult } from '@agentix-e/micro-kinetic-core';

// ── Avg@K ─────────────────────────────────────────────────

/**
 * Average accuracy at K: proportion of cases where the actual root cause
 * appears within the top-K predictions.
 *
 * @param predicted - Ordered list of predicted service IDs (best first).
 * @param actual - The ground truth service ID.
 * @param k - The cutoff rank.
 * @returns 1 if actual is in first K predictions, 0 otherwise.
 */
export function avgAtK(predicted: readonly string[], actual: string, k: number): number {
  if (k <= 0 || predicted.length === 0) return 0;
  const topK = predicted.slice(0, k);
  return topK.includes(actual) ? 1 : 0;
}

/**
 * Aggregate Avg@K across multiple cases.
 *
 * @param predictionsPerCase - List of predictions for each case.
 * @param truths - Corresponding ground truth service IDs.
 * @param k - The cutoff rank.
 * @returns Average accuracy across all cases (0-1).
 */
export function computeAvgAtK(
  predictionsPerCase: ReadonlyArray<readonly string[]>,
  truths: readonly string[],
  k: number,
): number {
  if (predictionsPerCase.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < predictionsPerCase.length; i++) {
    correct += avgAtK(predictionsPerCase[i]!, truths[i]!, k);
  }
  return correct / predictionsPerCase.length;
}

// ── Precision@K ───────────────────────────────────────────

/**
 * Precision at K: proportion of top-K predictions that are correct.
 * For single-label RCA, precision@K = 1/K if actual is in top-K, else 0.
 *
 * @param predictions - Root cause result list (ranked).
 * @param truth - Ground truth service ID.
 * @param k - Cutoff rank.
 * @returns Precision value (0-1).
 */
export function computePrecisionAtK(
  predictions: ReadonlyArray<RootCauseResult>,
  truth: string,
  k: number,
): number {
  if (k <= 0 || predictions.length === 0) return 0;
  const topK = predictions.slice(0, k);
  const correct = topK.filter((p) => p.serviceId === truth).length;
  return correct / k;
}

// ── Recall@K ──────────────────────────────────────────────

/**
 * Recall at K: proportion of all correct items found in top-K.
 * For single root cause, recall@K = 1 if actual is in top-K, else 0.
 *
 * @param predictions - Root cause result list (ranked).
 * @param truths - All ground truth service IDs (typically one).
 * @param k - Cutoff rank.
 * @returns Recall value (0-1).
 */
export function computeRecallAtK(
  predictions: ReadonlyArray<RootCauseResult>,
  truths: readonly string[],
  k: number,
): number {
  if (k <= 0 || predictions.length === 0 || truths.length === 0) return 0;
  const topK = predictions.slice(0, k);
  const found = topK.filter((p) => truths.includes(p.serviceId)).length;
  return found / truths.length;
}

// ── F1 Score ──────────────────────────────────────────────

/**
 * Compute F1 score from precision and recall.
 *
 * @param precision - Precision value (0-1).
 * @param recall - Recall value (0-1).
 * @returns F1 score (0-1).
 */
export function computeF1Score(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

// ── MRR (Mean Reciprocal Rank) ────────────────────────────

/**
 * Compute Mean Reciprocal Rank across multiple cases.
 *
 * MRR = (1/N) * Σ 1/rank_i, where rank_i is the position of the
 * first correct prediction (1-based), or 0 if not found.
 *
 * @param predictionsPerCase - Predictions for each case.
 * @param truth - Ground truth service ID.
 * @returns MRR value (0-1).
 */
export function computeMRR(
  predictions: ReadonlyArray<RootCauseResult>,
  truth: string,
): number {
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i]!.serviceId === truth) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * Aggregate MRR across multiple cases.
 *
 * @param predictionsPerCase - List of predictions for each case.
 * @param truths - Corresponding ground truth service IDs.
 * @returns Average MRR across all cases (0-1).
 */
export function computeAggregateMRR(
  predictionsPerCase: ReadonlyArray<readonly RootCauseResult[]>,
  truths: readonly string[],
): number {
  if (predictionsPerCase.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < predictionsPerCase.length; i++) {
    sum += computeMRR(predictionsPerCase[i]!, truths[i]!);
  }
  return sum / predictionsPerCase.length;
}

// ── LA (Location Accuracy) ────────────────────────────────

/**
 * Location Accuracy: whether the predicted service matches the ground truth service.
 * Standard AIOps2025 metric. LA = 1 if serviceId matches, else 0.
 *
 * @param prediction - The RCA result to evaluate.
 * @param truthServiceId - The actual root cause service ID.
 * @returns Location accuracy score (0 or 1).
 */
export function computeLA(prediction: RootCauseResult, truthServiceId: string): number {
  return prediction.serviceId === truthServiceId ? 1 : 0;
}

/**
 * Aggregate Location Accuracy across multiple cases.
 *
 * @param predictions - RCA results, one per case.
 * @param truths - Ground truth service IDs.
 * @returns Average location accuracy (0-1).
 */
export function computeAggregateLA(
  predictions: ReadonlyArray<RootCauseResult>,
  truths: readonly string[],
): number {
  if (predictions.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (predictions[i]!.serviceId === truths[i]!) {
      correct++;
    }
  }
  return correct / predictions.length;
}

// ── TA (Type Accuracy) ────────────────────────────────────

/**
 * Type Accuracy: whether the predicted fault type matches the ground truth fault type.
 * Standard AIOps2025 metric. TA = 1 if fault type matches, else 0.
 *
 * Comparison is case-insensitive and normalizes separators (hyphens/underscores).
 *
 * @param prediction - The RCA result to evaluate.
 * @param truthFaultType - The actual injected fault type.
 * @returns Type accuracy score (0 or 1).
 */
export function computeTA(prediction: RootCauseResult, truthFaultType: string): number {
  const predType = normalizeFaultType(prediction.faultType);
  const truthType = normalizeFaultType(truthFaultType);
  return predType === truthType ? 1 : 0;
}

/**
 * Aggregate Type Accuracy across multiple cases.
 *
 * @param predictions - RCA results, one per case.
 * @param truthFaultTypes - Ground truth fault types.
 * @returns Average type accuracy (0-1).
 */
export function computeAggregateTA(
  predictions: ReadonlyArray<RootCauseResult>,
  truthFaultTypes: readonly string[],
): number {
  if (predictions.length === 0) return 0;
  let correct = 0;
  for (let i = 0; i < predictions.length; i++) {
    if (normalizeFaultType(predictions[i]!.faultType) === normalizeFaultType(truthFaultTypes[i]!)) {
      correct++;
    }
  }
  return correct / predictions.length;
}

// ── Fault Type Normalization ──────────────────────────────

/**
 * Normalize a fault type string for comparison.
 * Lowercases and replaces underscores/spaces with hyphens.
 *
 * @param raw - Raw fault type string or FaultType object.
 * @returns Normalized lowercase hyphenated string.
 */
function normalizeFaultType(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.toLowerCase().replace(/[_ ]/g, '-');
  }
  if (raw && typeof raw === 'object' && 'category' in (raw as Record<string, unknown>)) {
    const ft = raw as { category: string; subType?: string };
    const subType = ft.subType ? `-${ft.subType}` : '';
    return `${ft.category}${subType}`.toLowerCase().replace(/[_ ]/g, '-');
  }
  return String(raw).toLowerCase().replace(/[_ ]/g, '-');
}

// ── Composite Scores ──────────────────────────────────────

/**
 * Compute the AIOps2025 composite score from LA, TA, explainability, and efficiency.
 *
 * Formula: (0.4 × LA + 0.4 × TA + 0.1 × Exp + 0.1 × Eff) × 100
 *
 * @param la - Location accuracy (0-1).
 * @param ta - Type accuracy (0-1).
 * @param explainability - Explainability score (0-1).
 * @param efficiency - Efficiency score (0-1).
 * @returns Composite score (0-100).
 */
export function computeAIOps2025CompositeScore(
  la: number,
  ta: number,
  explainability: number,
  efficiency: number,
): number {
  return (0.4 * la + 0.4 * ta + 0.1 * explainability + 0.1 * efficiency) * 100;
}

/**
 * Compute the RCA100 composite score from entity, fault, and process scores.
 *
 * Formula: (0.4 × Entity + 0.3 × Fault + 0.3 × Process) × 100
 *
 * @param entityScore - Entity localization score (0-1).
 * @param faultScore - Fault identification score (0-1).
 * @param processScore - Reasoning process score (0-1).
 * @returns Composite score (0-100).
 */
export function computeRCA100CompositeScore(
  entityScore: number,
  faultScore: number,
  processScore: number,
): number {
  return (0.4 * entityScore + 0.3 * faultScore + 0.3 * processScore) * 100;
}
