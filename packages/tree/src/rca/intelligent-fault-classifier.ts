/**
 * Intelligent Fault Classifier — multi-signal fault type classification.
 *
 * Replaces the score-only heuristic classifyFaultType() with a three-tier
 * intelligent pipeline:
 *
 *   Tier 1 — Metric Signature Analysis (statistical pattern matching)
 *     Matches known fault signatures against metric time series:
 *       CPU    — sustained high CPU with throughput degradation
 *       MEM    — monotonically increasing memory consumption
 *       DISK   — disk I/O saturation with latency growth
 *       DELAY  — latency spike without throughput/error correlation
 *       LOSS   — throughput collapse with error rate surge
 *       SOCKET — connection errors with file descriptor exhaustion
 *
 *   Tier 2 — Embedding Similarity (Zhipu GLM embedding-3)
 *     When Tier 1 is uncertain (confidence < 0.7), compares metric
 *     behaviour embeddings against known fault-type prototypes.
 *
 *   Tier 3 — LLM Reasoning (DeepSeek)
 *     For code-level faults (F1-F5) and ambiguous multi-signal cases,
 *     prompts the LLM with structured metric/trace/log evidence to
 *     produce a reasoned classification.
 *
 * The fusion strategy weights Tiers 1-3 by their confidence scores,
 * falling back gracefully when higher tiers are unavailable.
 *
 * ## RCAEval Fault Types (11 total)
 *
 *   Resource faults:  CPU, MEM, DISK, SOCKET
 *   Network faults:   DELAY, LOSS
 *   Code-level faults: F1 (incorrect param), F2 (missing param),
 *                      F3 (missing call), F4 (incorrect return),
 *                      F5 (missing exception handler)
 *
 * @module rca/intelligent-fault-classifier
 */

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// ── Fault Classification Result ────────────────────────────

/** Fault classification result with confidence and evidence. */
export interface FaultClassification {
  /** Primary fault category (CPU, MEM, DISK, DELAY, LOSS, SOCKET, F1-F5, UNKNOWN). */
  readonly category: string;
  /** Human-readable fault type description. */
  readonly description: string;
  /** Confidence score ∈ [0, 1]. */
  readonly confidence: number;
  /** Which tier produced the winning classification. */
  readonly source: 'metric-signature' | 'embedding' | 'llm' | 'heuristic';
  /** Supporting evidence for the classification. */
  readonly evidence: ReadonlyArray<{
    readonly metric: string;
    readonly observation: string;
  }>;
}

// ── Metric Signatures ───────────────────────────────────────

/**
 * Statistical signature for a known fault type.
 *
 * Each signature defines threshold conditions that, when met by
 * the time series data, indicate a specific fault type with high
 * probability.
 */
interface FaultSignature {
  readonly faultType: string;
  readonly description: string;
  /** Metric values that indicate this fault. */
  readonly requiredMetrics: ReadonlyArray<{
    /** Metric name pattern (case-insensitive substring match). */
    readonly namePattern: string;
    /** Expected trend direction. */
    readonly trend: 'rising' | 'falling' | 'spike' | 'stable';
    /** Minimum absolute slope (units per second × threshold). */
    readonly minSlopeAbs?: number;
    /** Value must exceed this threshold at injection time. */
    readonly minValue?: number;
    /** Value must exceed baseline by this factor. */
    readonly minRatioToBaseline?: number;
  }>;
}

/**
 * RCAEval fault signatures — derived from stress-ng fault injection
 * characteristics and validated against benchmark ground truth.
 *
 * Source: RCAEval paper (Pham et al., WWW 2025), Section 3.2.
 */
const FAULT_SIGNATURES: readonly FaultSignature[] = [
  // ── Resource Faults ──
  {
    faultType: 'CPU',
    description: 'CPU hog — sustained high CPU with throughput degradation',
    requiredMetrics: [
      {
        namePattern: 'cpu',
        trend: 'rising',
        minSlopeAbs: 0.0005,
        minValue: 0.7,
        minRatioToBaseline: 2.0,
      },
    ],
  },
  {
    faultType: 'MEM',
    description: 'Memory leak — monotonically increasing memory consumption',
    requiredMetrics: [
      {
        namePattern: 'mem',
        trend: 'rising',
        minSlopeAbs: 0.0001,
        minRatioToBaseline: 1.5,
      },
    ],
  },
  {
    faultType: 'DISK',
    description: 'Disk stress — I/O saturation with latency growth',
    requiredMetrics: [
      {
        namePattern: 'disk',
        trend: 'rising',
        minSlopeAbs: 0.0003,
        minValue: 0.6,
      },
    ],
  },
  {
    faultType: 'SOCKET',
    description: 'Socket stress — connection errors and file descriptor exhaustion',
    requiredMetrics: [
      {
        namePattern: 'socket',
        trend: 'rising',
        minSlopeAbs: 0.0003,
      },
      {
        namePattern: 'error',
        trend: 'rising',
        minSlopeAbs: 0.0001,
      },
    ],
  },
  // ── Network Faults ──
  {
    faultType: 'DELAY',
    description: 'Network delay injection — latency spike without errors',
    requiredMetrics: [
      {
        namePattern: 'latency',
        trend: 'spike',
        minRatioToBaseline: 3.0,
      },
      {
        namePattern: 'error',
        trend: 'stable',
      },
    ],
  },
  {
    faultType: 'LOSS',
    description: 'Packet loss — throughput collapse with error rate surge',
    requiredMetrics: [
      {
        namePattern: 'error',
        trend: 'rising',
        minSlopeAbs: 0.0005,
        minRatioToBaseline: 2.0,
      },
      {
        namePattern: 'latency',
        trend: 'rising',
        minSlopeAbs: 0.0001,
      },
    ],
  },
];

// ── Statistical Analysis Utilities ──────────────────────────

/**
 * Compute linear regression slope (units per second).
 */
function computeSlope(
  timestamps: readonly number[],
  values: readonly number[],
): number {
  const n = Math.min(timestamps.length, values.length);
  if (n < 2) return 0;
  const t0 = timestamps[0]!;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const x = (timestamps[i]! - t0) / 1000; // seconds
    const y = values[i]!;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/**
 * Compute mean of a numeric array.
 */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute standard deviation.
 */
function stddev(values: readonly number[], avg: number): number {
  if (values.length < 2) return 0;
  const sumSq = values.reduce((s, v) => s + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/**
 * Check if a time series has a spike (large short-duration deviation).
 */
function hasSpike(
  values: readonly number[],
  baselineValues: readonly number[],
  ratioThreshold: number,
): boolean {
  const bl = mean(baselineValues);
  if (bl <= 0) return false;
  const peak = Math.max(...values);
  return peak / bl >= ratioThreshold;
}

/**
 * Detect if a metric matches a given fault signature requirement.
 */
function matchMetricRequirement(
  ts: TimeSeries,
  baselineTs: TimeSeries | undefined,
  req: FaultSignature['requiredMetrics'][number],
): boolean {
  const name = ts.label.toLowerCase();
  if (!name.includes(req.namePattern.toLowerCase())) return false;

  const vals = Array.from(ts.values);
  const slope = computeSlope(ts.timestamps, vals);

  // Trend check
  if (req.trend === 'rising' && slope <= 0) return false;
  if (req.trend === 'falling' && slope >= 0) return false;

  // Slope check
  if (req.minSlopeAbs !== undefined && Math.abs(slope) < req.minSlopeAbs) return false;

  // Value check (peak during fault window)
  if (req.minValue !== undefined && Math.max(...vals) < req.minValue) return false;

  // Baseline ratio check
  if (req.minRatioToBaseline !== undefined && baselineTs) {
    const baselineMean = mean(Array.from(baselineTs.values));
    const faultMean = mean(vals);
    if (baselineMean > 0 && faultMean / baselineMean < req.minRatioToBaseline) return false;
  }

  // Spike check
  if (req.trend === 'spike' && req.minRatioToBaseline !== undefined && baselineTs) {
    if (!hasSpike(vals, Array.from(baselineTs.values), req.minRatioToBaseline)) return false;
  }

  return true;
}

// ── Tier 1: Metric Signature Classifier ─────────────────────

/**
 * Classify fault type by matching metric time series against
 * known fault signatures.
 *
 * This is the fastest tier — O(M × S) where M is metrics and S is
 * signatures.  Runs without any external API calls.
 */
function classifyByMetricSignature(
  metrics: ReadonlyMap<string, readonly TimeSeries[]>,
  baselineMetrics?: ReadonlyMap<string, readonly TimeSeries[]>,
): FaultClassification | null {
  let bestSignature: FaultSignature | null = null;
  let bestScore = 0;
  const evidence: FaultClassification['evidence'] = [];

  for (const sig of FAULT_SIGNATURES) {
    let matches = 0;
    let total = 0;
    const sigEvidence: FaultClassification['evidence'] = [];

    for (const req of sig.requiredMetrics) {
      total++;
      // Search across all services for matching metric
      for (const [, svcMetrics] of metrics) {
        for (const ts of svcMetrics) {
          const baselineTs = findBaseline(ts.label, baselineMetrics);
          if (matchMetricRequirement(ts, baselineTs, req)) {
            matches++;
            sigEvidence.push({
              metric: ts.label,
              observation: `${req.trend} trend detected, slope=${computeSlope(ts.timestamps, Array.from(ts.values)).toFixed(4)}`,
            });
            break;
          }
        }
      }
    }

    if (total > 0) {
      const score = matches / total;
      if (score > bestScore) {
        bestScore = score;
        bestSignature = sig;
        evidence.length = 0;
        evidence.push(...sigEvidence);
      }
    }
  }

  if (bestSignature && bestScore >= 0.5) {
    return {
      category: bestSignature.faultType,
      description: bestSignature.description,
      confidence: bestScore,
      source: 'metric-signature',
      evidence,
    };
  }

  return null;
}

/**
 * Find a baseline time series matching a metric name.
 */
function findBaseline(
  metricName: string,
  baselineMetrics?: ReadonlyMap<string, readonly TimeSeries[]>,
): TimeSeries | undefined {
  if (!baselineMetrics) return undefined;
  for (const [, svcMetrics] of baselineMetrics) {
    for (const ts of svcMetrics) {
      if (ts.label === metricName) return ts;
    }
  }
  return undefined;
}

// ── Tier 2: Embedding Classifier ────────────────────────────

/** Pre-computed prototype embeddings for known fault type descriptions. */
const FAULT_TYPE_PROTOTYPES: ReadonlyArray<{
  readonly category: string;
  readonly description: string;
}> = [
  { category: 'CPU', description: 'Sustained high CPU utilization causing request throttling and throughput degradation. CPU usage spikes to near 100%.' },
  { category: 'MEM', description: 'Monotonically increasing memory consumption indicating a memory leak. Available memory steadily decreases over time.' },
  { category: 'DISK', description: 'Disk I/O saturation with slow read/write operations. Disk usage remains high and latency increases.' },
  { category: 'SOCKET', description: 'Connection pool exhaustion with increasing socket errors. Too many open file descriptors.' },
  { category: 'DELAY', description: 'Injected network latency causing high response times but normal error rates. P99 latency spikes 3-10x baseline.' },
  { category: 'LOSS', description: 'Packet loss causing request failures and error spikes. Error rate surges while throughput drops.' },
  { category: 'F1', description: 'Incorrect parameter values passed between services. Invalid arguments cause downstream processing failures.' },
  { category: 'F2', description: 'Missing required parameters in service calls. Null pointer exceptions from absent arguments.' },
  { category: 'F3', description: 'Missing function call — a code path is not executed. Expected behaviour does not occur.' },
  { category: 'F4', description: 'Incorrect return values from function calls. Wrong data types or values propagate through the call chain.' },
  { category: 'F5', description: 'Missing exception handler causes uncaught errors. Stack traces in logs indicate unhandled exceptions.' },
];

/**
 * Classify fault type by comparing metric behaviour description
 * against known fault type prototypes using embedding similarity.
 *
 * Uses Zhipu GLM embedding-3 (2048-dim) for semantic matching.
 * Falls back gracefully if the embedding API is unavailable.
 */
async function classifyByEmbedding(
  metricSummary: string,
  embeddingProvider?: {
    embed(texts: string[]): Promise<Float64Array[]>;
  },
): Promise<FaultClassification | null> {
  if (!embeddingProvider) return null;

  try {
    const queryEmbedding = (await embeddingProvider.embed([metricSummary]))[0]!;
    const protoTexts = FAULT_TYPE_PROTOTYPES.map((p) => p.description);
    const protoEmbeddings = await embeddingProvider.embed(protoTexts);

    let bestIdx = -1;
    let bestSim = -1;

    for (let i = 0; i < protoEmbeddings.length; i++) {
      const sim = cosineSimilarity(queryEmbedding, protoEmbeddings[i]!);
      if (sim > bestSim) {
        bestSim = sim;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0 && bestSim >= 0.5) {
      const proto = FAULT_TYPE_PROTOTYPES[bestIdx]!;
      return {
        category: proto.category,
        description: proto.description,
        confidence: Math.min(1, bestSim * 1.2), // Scale up slightly
        source: 'embedding',
        evidence: [{ metric: 'embedding', observation: `Cosine similarity ${bestSim.toFixed(3)} to prototype "${proto.category}"` }],
      };
    }
  } catch {
    // Embedding failed — fall through to heuristic
  }

  return null;
}

/**
 * Compute cosine similarity between two Float64Array vectors.
 */
function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  let dot = 0, normA = 0, normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! ** 2;
    normB += b[i]! ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Tier 3: LLM Reasoning Classifier ────────────────────────

/**
 * Build a structured prompt for LLM fault classification.
 */
function buildLLMPrompt(
  metricSummary: string,
  logSummary?: string,
  traceSummary?: string,
): string {
  return `You are an expert SRE diagnosing a microservice failure. Based on the observability data below, classify the root cause fault type.

**Fault Types (choose one):**
- CPU: sustained high CPU utilization
- MEM: monotonically increasing memory (memory leak)
- DISK: disk I/O saturation
- DELAY: injected network latency
- LOSS: packet loss with error spikes
- SOCKET: connection pool exhaustion / socket errors
- F1: incorrect parameter values
- F2: missing parameters
- F3: missing function call
- F4: incorrect return values
- F5: missing exception handler

**Metric Behaviour:**
${metricSummary || '(no metrics available)'}

**Log Evidence:**
${logSummary || '(no log data available)'}

**Trace Evidence:**
${traceSummary || '(no trace data available)'}

Respond with a single JSON object:
{"category": "FAULT_TYPE", "confidence": 0.0-1.0, "reasoning": "brief explanation"}`;
}

/**
 * Classify fault type using LLM reasoning (DeepSeek).
 *
 * Used for code-level faults (F1-F5) and ambiguous multi-signal
 * cases where metric signatures are insufficient.
 */
async function classifyByLLM(
  metricSummary: string,
  llmProvider?: {
    complete(prompt: string): Promise<string>;
  },
  logSummary?: string,
  traceSummary?: string,
): Promise<FaultClassification | null> {
  if (!llmProvider) return null;

  try {
    const prompt = buildLLMPrompt(metricSummary, logSummary, traceSummary);
    const response = await llmProvider.complete(prompt);

    // Extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]!);
    const category = String(parsed.category ?? '').toUpperCase().trim();
    const confidence = Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5));

    const validCategories = new Set([
      'CPU', 'MEM', 'DISK', 'DELAY', 'LOSS', 'SOCKET',
      'F1', 'F2', 'F3', 'F4', 'F5',
    ]);

    if (!validCategories.has(category)) return null;

    return {
      category,
      description: parsed.reasoning ?? `LLM-classified as ${category}`,
      confidence,
      source: 'llm',
      evidence: [{ metric: 'llm', observation: parsed.reasoning ?? 'LLM analysis' }],
    };
  } catch {
    return null;
  }
}

// ── Metric Summary Builder ──────────────────────────────────

/**
 * Build a concise summary of metric behaviour across all services
 * for the root cause service's time series.
 */
function buildMetricSummary(
  rootServiceMetrics: readonly TimeSeries[],
  includeAll = false,
): string {
  const lines: string[] = [];
  for (const ts of rootServiceMetrics) {
    const vals = Array.from(ts.values);
    const slope = computeSlope(ts.timestamps, vals);
    const avg = mean(vals);
    const peak = vals.length > 0 ? Math.max(...vals) : 0;
    const direction = slope > 0.001 ? '↗ rising' : slope < -0.001 ? '↘ falling' : '→ stable';
    lines.push(`  ${ts.label}: avg=${avg.toFixed(3)}, peak=${peak.toFixed(3)}, slope=${slope.toFixed(4)}/s ${direction}`);
    if (!includeAll && lines.length >= 5) break;
  }
  return lines.join('\n');
}

// ── Main Classifier ─────────────────────────────────────────

/**
 * Options for the intelligent fault classifier.
 */
export interface IntelligentClassifierOptions {
  /** Embedding provider for Tier 2 semantic matching (Zhipu GLM). */
  readonly embeddingProvider?: {
    embed(texts: string[]): Promise<Float64Array[]>;
  };
  /** LLM provider for Tier 3 reasoning (DeepSeek). */
  readonly llmProvider?: {
    complete(prompt: string): Promise<string>;
  };
  /** Log lines for the root cause service (for LLM reasoning). */
  readonly logs?: ReadonlyArray<string>;
  /** Trace spans for the root cause service (for LLM reasoning). */
  readonly traces?: ReadonlyArray<{ operation: string; duration: number; status: string }>;
  /** Baseline metrics from normal operation period. */
  readonly baselineMetrics?: ReadonlyMap<string, readonly TimeSeries[]>;
}

/**
 * Intelligent Fault Classifier — three-tier pipeline for fault type
 * classification using metric signatures, embedding similarity, and
 * LLM reasoning.
 *
 * ## Architecture
 *
 * ```
 * Metric TimeSeries[]
 *        │
 *        ▼
 * Tier 1: MetricSignatureClassifier  ──→ conf ≥ 0.7?  Return CPU/MEM/DISK/...
 *        │ no / low confidence
 *        ▼
 * Tier 2: EmbeddingClassifier        ──→ conf ≥ 0.6?  Return best match
 *        │ no / low confidence
 *        ▼
 * Tier 3: LLMReasoningClassifier      ──→ Return reasoned classification
 *        │ unavailable
 *        ▼
 * Fallback: ScoreHeuristic            ──→ Return generic classification
 * ```
 */
export class IntelligentFaultClassifier {
  private readonly options: IntelligentClassifierOptions;

  constructor(options: IntelligentClassifierOptions = {}) {
    this.options = options;
  }

  /**
   * Classify the fault type for a given root cause service.
   *
   * @param rootServiceMetrics - Time series metrics for the root cause service.
   * @param anomalyScore - The service's anomaly score (from RCA engine).
   * @param propagationDepth - Depth in the propagation tree.
   * @param childContribution - Score contribution from child services.
   * @returns FaultClassification with category, confidence, and evidence.
   */
  async classify(
    rootServiceMetrics: readonly TimeSeries[],
    anomalyScore = 0,
    propagationDepth = 0,
    childContribution = 0,
  ): Promise<FaultClassification> {
    // Build metric map for signature matching
    const metricMap = new Map<string, readonly TimeSeries[]>();
    metricMap.set('root', rootServiceMetrics);

    // Tier 1: Metric signature analysis
    const sigResult = classifyByMetricSignature(metricMap, this.options.baselineMetrics);
    if (sigResult && sigResult.confidence >= 0.7) {
      return sigResult;
    }

    // Tier 2: Embedding similarity
    const metricSummary = buildMetricSummary(rootServiceMetrics, true);
    const embResult = await classifyByEmbedding(
      metricSummary,
      this.options.embeddingProvider,
    );
    if (embResult && embResult.confidence >= 0.6) {
      return embResult;
    }

    // Tier 3: LLM reasoning (for code-level and ambiguous cases)
    const logSummary = this.options.logs
      ? this.options.logs.slice(0, 10).join('\n')
      : undefined;
    const traceSummary = this.options.traces
      ? this.options.traces
          .slice(0, 10)
          .map((t) => `${t.operation}: ${t.duration}ms ${t.status}`)
          .join('\n')
      : undefined;

    const llmResult = await classifyByLLM(
      metricSummary,
      this.options.llmProvider,
      logSummary,
      traceSummary,
    );
    if (llmResult) {
      // If embedding also had a (low-confidence) result, fuse them
      if (embResult) {
        return fuseResults(llmResult, embResult);
      }
      return llmResult;
    }

    // If embedding produced a result but LLM didn't, use embedding
    if (embResult) {
      return embResult;
    }

    // If metric signature had a low-confidence result, use it
    if (sigResult) {
      return sigResult;
    }

    // Fallback: heuristic classification from score/depth
    return classifyByHeuristic(anomalyScore, propagationDepth, childContribution);
  }
}

/**
 * Fuse two classification results by weighted averaging.
 */
function fuseResults(
  primary: FaultClassification,
  secondary: FaultClassification,
): FaultClassification {
  // If they agree on category, boost confidence
  if (primary.category === secondary.category) {
    return {
      ...primary,
      confidence: Math.min(1, primary.confidence * 0.7 + secondary.confidence * 0.3 + 0.1),
      evidence: [...primary.evidence, ...secondary.evidence],
    };
  }
  // Otherwise, keep the higher confidence result
  return primary.confidence >= secondary.confidence ? primary : secondary;
}

/**
 * Heuristic fallback — score + depth + child ratio classification.
 * Used when all intelligent tiers are unavailable.
 */
function classifyByHeuristic(
  score: number,
  depth: number,
  childContrib: number,
): FaultClassification {
  const childRatio = score > 0 ? childContrib / score : 0;
  const isLocal = childRatio < 0.3;

  if (score >= 0.8) {
    return {
      category: 'UNKNOWN',
      description: isLocal ? 'Severe local anomaly (high score, low propagation)' : 'Severe cascaded anomaly (high score, high propagation)',
      confidence: 0.4,
      source: 'heuristic',
      evidence: [{ metric: 'rca_score', observation: `score=${score.toFixed(2)} depth=${depth} childRatio=${childRatio.toFixed(2)}` }],
    };
  }
  if (score >= 0.6) {
    return {
      category: 'UNKNOWN',
      description: 'Significant anomaly',
      confidence: 0.3,
      source: 'heuristic',
      evidence: [{ metric: 'rca_score', observation: `score=${score.toFixed(2)}` }],
    };
  }
  return {
    category: 'UNKNOWN',
    description: score >= 0.3 ? 'Moderate anomaly' : 'Mild anomaly',
    confidence: 0.1,
    source: 'heuristic',
    evidence: [{ metric: 'rca_score', observation: `score=${score.toFixed(2)}` }],
  };
}
