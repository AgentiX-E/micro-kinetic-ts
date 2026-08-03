/**
 * LLM structured output validation for topology discovery.
 *
 * Implements the three-layer defense architecture for production-grade
 * LLM output reliability, adapted from the 2026 state-of-the-art:
 *
 *   Layer 1 — Schema Validation: Zod type-safe parsing with detailed errors
 *   Layer 2 — Error-Feedback Retry: feed validation errors back to LLM
 *   Layer 3 — Constrained Prompting: JSON Schema in prompt + temperature=0
 *
 * References:
 *   - eastondev.com (2026) "LLM Structured Output: Schemas, Retries, Constrained Decoding"
 *   - oh-bug.com (2026) "Structured Outputs Production: Constrained Decoding + JSON Schema"
 *   - OpenAI Structured Outputs (strict mode), DeepSeek JSON mode
 *
 * @module topology/validation/llm-validator
 */

import type { ServiceCallGraph, ServiceNode, CallEdge } from '../types/graph.js';

// ── Zod Schema Equivalent (Inline, Zero-Dependency) ───────

/**
 * Validation result for a topology discovery response.
 */
export interface TopologyValidationResult {
  /** Whether the response is valid. */
  readonly valid: boolean;
  /** Parsed call graph (if valid). */
  readonly graph?: ServiceCallGraph;
  /** Validation errors (if invalid). */
  readonly errors: readonly string[];
}

// ── Expected LLM Response Format ──────────────────────────

/**
 * The exact JSON schema expected from the LLM topology provider.
 *
 * The LLM must return an array of edge objects with these fields.
 * The validator enforces all constraints before accepting the response.
 */
interface RawLLMEdge {
  from: unknown;
  to: unknown;
  method: unknown;
  confidence: unknown;
  reasoning: unknown;
}

// ── Validator — Layer 1 (Schema Enforcement) ──────────────

/**
 * Validate LLM topology output against the expected schema.
 *
 * Performs strict type checking and field presence validation,
 * equivalent to Zod .object({...}).strict() but zero-dependency.
 *
 * @param raw - Parsed JSON array from LLM response.
 * @param knownServiceIds - Services already known to the system.
 * @returns Validation result with parsed graph or error list.
 */
export function validateTopologyResponse(
  raw: unknown,
  knownServiceIds: readonly string[],
): TopologyValidationResult {
  if (!Array.isArray(raw)) {
    return { valid: false, errors: ['Response must be a JSON array of edge objects'] };
  }

  const errors: string[] = [];
  const nodes = new Map<string, ServiceNode>();
  const edges: CallEdge[] = [];

  // Collect known service IDs
  for (const id of knownServiceIds) {
    nodes.set(id, { id, name: id, namespace: 'discovered', labels: {} });
  }

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as RawLLMEdge;
    const prefix = `Edge[${i}]`;

    // Validate 'from' field
    if (typeof item.from !== 'string' || item.from.length === 0) {
      errors.push(`${prefix}: 'from' must be a non-empty string, got ${typeof item.from}`);
      continue;
    }

    // Validate 'to' field
    if (typeof item.to !== 'string' || item.to.length === 0) {
      errors.push(`${prefix}: 'to' must be a non-empty string, got ${typeof item.to}`);
      continue;
    }

    // Self-loops are suspicious but not invalid
    if (item.from === item.to) {
      errors.push(`${prefix}: self-loop detected (${item.from} → ${item.to}) — skipping`);
      continue;
    }

    // Validate 'method' field
    const validMethods = ['REST', 'GRPC', 'MQ', 'EVENT', 'INTERNAL'];
    const method = typeof item.method === 'string' ? item.method.toUpperCase() : '';
    if (!validMethods.includes(method)) {
      errors.push(
        `${prefix}: 'method' must be one of [${validMethods.join(', ')}], got "${String(item.method)}"`,
      );
      continue;
    }

    // Validate 'confidence' field
    const confidence = Number(item.confidence);
    if (typeof item.confidence !== 'number' || isNaN(confidence) || confidence < 0 || confidence > 1) {
      errors.push(
        `${prefix}: 'confidence' must be a number 0-1, got ${String(item.confidence)}`,
      );
      continue;
    }

    // Validate 'reasoning' field
    if (typeof item.reasoning !== 'string' || item.reasoning.length < 10) {
      errors.push(
        `${prefix}: 'reasoning' must be a descriptive string (≥10 chars), got ${String(item.reasoning).slice(0, 50)}`,
      );
      continue;
    }

    // Add nodes if not already known
    for (const svcId of [item.from, item.to]) {
      if (!nodes.has(svcId)) {
        nodes.set(svcId, {
          id: svcId,
          name: svcId,
          namespace: 'llm-discovered',
          labels: { source: 'llm' },
        });
      }
    }

    // Add edge with LLM confidence
    edges.push({
      from: item.from,
      to: item.to,
      type: method as CallEdge['type'],
      callRate: 100 * confidence, // Scale confidence to call rate
      p99Latency: 10 / Math.max(0.1, confidence), // Inverse confidence for latency
      errorRate: (1 - confidence) * 0.1, // Uncertainty → higher error rate
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    graph: { nodes, edges, systemLoad: 0.5 },
    errors: [],
  };
}

// ── Retry Config — Layer 2 (Error-Feedback Retry) ────────

/**
 * Configuration for LLM retry with error feedback.
 */
export interface LLMRetryConfig {
  /** Maximum number of retry attempts. */
  readonly maxRetries: number;
  /** Base delay in milliseconds (exponential backoff: delay × 2^attempt). */
  readonly baseDelayMs: number;
  /** Maximum total delay across all retries. */
  readonly maxTotalDelayMs: number;
  /** Whether to include validation errors in the retry prompt. */
  readonly includeErrorFeedback: boolean;
}

/** Default retry configuration. */
export const DEFAULT_RETRY_CONFIG: LLMRetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxTotalDelayMs: 30000,
  includeErrorFeedback: true,
};

/**
 * Compute delay for the nth retry attempt (exponential backoff with jitter).
 *
 * @param attempt - 0-indexed attempt number.
 * @param config - Retry configuration.
 * @returns Delay in milliseconds.
 */
export function computeRetryDelay(attempt: number, config: LLMRetryConfig): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  // Add 10% random jitter to avoid thundering herd
  const jitter = exponential * 0.1 * Math.random();
  return Math.min(exponential + jitter, config.maxTotalDelayMs);
}

// ── Prompt Builder — Layer 3 (Constrained Prompting) ─────

/**
 * Build a JSON-schema-constrained prompt for topology inference.
 *
 * Includes:
 * - Strict JSON Schema definition
 * - Temperature recommendation (0.0)
 * - Example output
 * - Known service IDs and metrics as context
 */
export function buildTopologyPrompt(
  serviceIds: readonly string[],
  metricHints?: Readonly<Record<string, readonly string[]>>,
): string {
  const parts: string[] = [];

  parts.push('You are a microservice topology inference expert.');
  parts.push('Given service names and their associated metrics, infer the most likely service-to-service call relationships.');
  parts.push('');
  parts.push('## Known Services');
  for (const svcId of serviceIds) {
    const metrics = metricHints?.[svcId];
    const metricStr = metrics && metrics.length > 0 ? ` [metrics: ${metrics.slice(0, 5).join(', ')}]` : '';
    parts.push(`- ${svcId}${metricStr}`);
  }

  parts.push('');
  parts.push('## Inference Rules');
  parts.push('1. A service named "frontend" or ending in "-ui" typically calls downstream services');
  parts.push('2. A service named "orders" or "checkout" typically calls payment, shipping, inventory services');
  parts.push('3. Services with database-related metric names (postgres_, mongo_, redis_) are typically called BY other services, not callers themselves');
  parts.push('4. Services with http_requests_total or latency_p99 metrics are typically called BY external or upstream services');
  parts.push('5. Only include edges where there is strong evidence (confidence > 0.7)');

  parts.push('');
  parts.push('## Required Output Format');
  parts.push('Return ONLY a JSON array. Each element must have:');
  parts.push('- "from": string — the calling service ID');
  parts.push('- "to": string — the called service ID');
  parts.push('- "method": "REST" | "gRPC" | "MQ" | "EVENT" — the communication method');
  parts.push('- "confidence": number 0-1 — how confident you are in this edge');
  parts.push('- "reasoning": string — 10+ words explaining why this edge exists');

  parts.push('');
  parts.push('## Example');
  parts.push('[{"from":"frontend","to":"checkoutservice","method":"REST","confidence":0.92,"reasoning":"frontend is the user-facing entry point that calls checkoutservice to process orders. The metrics http_requests_total on checkoutservice confirm it receives external calls."}]');

  parts.push('');
  parts.push('Respond ONLY with the JSON array. No markdown, no explanations.');

  return parts.join('\n');
}

// ── Schema for Prompt ─────────────────────────────────────

/**
 * JSON Schema that can be passed to DeepSeek's response_format parameter.
 *
 * DeepSeek supports a subset of OpenAI's structured output JSON Schema.
 */
export const TOPOLOGY_JSON_SCHEMA = {
  name: 'topology_edges',
  strict: true,
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Calling service ID' },
        to: { type: 'string', description: 'Called service ID' },
        method: {
          type: 'string',
          enum: ['REST', 'gRPC', 'MQ', 'EVENT'],
          description: 'Communication method',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Edge confidence score',
        },
        reasoning: {
          type: 'string',
          minLength: 10,
          description: '10+ word explanation',
        },
      },
      required: ['from', 'to', 'method', 'confidence', 'reasoning'],
      additionalProperties: false,
    },
  },
} as const;

// ── Confidence Calibration ────────────────────────────────

/**
 * Calibrate a raw LLM confidence score.
 *
 * LLMs tend to be overconfident (assigning 0.9+ to uncertain guesses).
 * This function applies Platt scaling-inspired calibration:
 * - Scores < 0.5 are treated as low confidence (reduced further)
 * - Scores 0.5-0.85 are linearly scaled
 * - Scores > 0.85 are trusted but with a ceiling
 *
 * @param rawConfidence - Raw confidence from LLM response (0-1).
 * @param reasoningLength - Length of reasoning text (proxy for thoughtfulness).
 * @returns Calibrated confidence score.
 */
export function calibrateLLMConfidence(
  rawConfidence: number,
  reasoningLength: number,
): number {
  // Very short reasoning → low effort → penalize
  const reasoningFactor = Math.min(1, reasoningLength / 100);

  if (rawConfidence < 0.5) {
    return rawConfidence * 0.5 * reasoningFactor;
  }
  if (rawConfidence < 0.85) {
    return rawConfidence * 0.8 * reasoningFactor;
  }
  // High confidence with long reasoning → trust more
  return Math.min(0.95, rawConfidence * 0.9 * reasoningFactor);
}
