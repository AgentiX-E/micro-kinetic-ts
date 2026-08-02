/**
 * Layer 3 — DeepSeek LLM-based fault classifier (fallback only).
 *
 * Invoked only when Layer 1 (regex rules) and Layer 2 (statistical
 * analysis) produce low-confidence or ambiguous results. The LLM
 * receives multi-modal context — time-series statistics, prior
 * hypotheses, log entries, trace spans, and service topology — and
 * produces refined fault type hypotheses with human-readable reasoning.
 *
 * Security: The DeepSeek API key is loaded from the environment variable
 * DEEPSEEK_API_KEY (via .env file). It is NEVER hardcoded or committed.
 *
 * @module classifiers/llm-classifier
 */

import type {
  FaultClassifierContext,
  FaultTypeHypothesis,
  ILLMFaultClassifier,
} from '@agentix-e/micro-kinetic-core';

import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// ── Types ─────────────────────────────────────────────────

/** Configuration for the LLM classifier. */
export interface LLMClassifierConfig {
  /** DeepSeek API endpoint. */
  readonly apiEndpoint: string;
  /** Model name to use. */
  readonly model: string;
  /** Maximum tokens in the response. */
  readonly maxTokens: number;
  /** Temperature for response variability (0 = deterministic). */
  readonly temperature: number;
  /** Request timeout in milliseconds. */
  readonly timeoutMs: number;
}

/** Default DeepSeek configuration. */
export const DEFAULT_LLM_CONFIG: LLMClassifierConfig = {
  apiEndpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',
  maxTokens: 512,
  temperature: 0,
  timeoutMs: 10000,
};

// ── Implementation ────────────────────────────────────────

/**
 * LLM-based fault type classifier (Layer 3).
 *
 * Uses the DeepSeek API with a structured prompt that includes:
 * - Prior hypotheses from Layer 1 and Layer 2
 * - Statistical summaries of time-series data
 * - Optional log/trace/topology context
 *
 * The LLM is instructed to return a JSON array of hypotheses
 * with confidence scores and supporting evidence.
 */
export class LLMFaultClassifier implements ILLMFaultClassifier {
  readonly method = 'llm' as const;
  private readonly config: LLMClassifierConfig;
  private readonly apiKey: string;

  constructor(config?: Partial<LLMClassifierConfig>) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    const key = process.env['DEEPSEEK_API_KEY'];
    if (!key) {
      throw new Error(
        'DEEPSEEK_API_KEY environment variable is not set. ' +
        'Create a .env file with DEEPSEEK_API_KEY=sk-... or export it in your shell.',
      );
    }
    this.apiKey = key;
  }

  /**
   * Classify fault type using LLM reasoning.
   *
   * This is the simplified entry point (IFaultClassifier contract)
   * without multi-modal context.
   */
  classify(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
  ): FaultTypeHypothesis[] {
    // Synchronous fallback — the async version should be preferred.
    // This returns an UNKNOWN placeholder; callers should use classifyWithContext.
    return [
      {
        category: 'UNKNOWN',
        confidence: 0,
        evidence: ['LLM classification requires async classifyWithContext()'],
        method: 'llm',
        severity: 'info',
      },
    ];
  }

  /**
   * Classify with full multi-modal context and prior hypotheses.
   *
   * This is the primary entry point for Layer 3. It sends a structured
   * prompt to the DeepSeek API with all available context.
   */
  async classifyWithContext(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
    priorHypotheses: readonly FaultTypeHypothesis[],
    logs?: ReadonlyArray<{ readonly message: string; readonly level: string; readonly timestamp: number }>,
    traces?: ReadonlyArray<{ readonly service: string; readonly operationName: string; readonly duration: number; readonly status: string }>,
    topology?: { readonly nodes: ReadonlyMap<string, unknown>; readonly edges: ReadonlyArray<unknown> },
  ): Promise<FaultTypeHypothesis[]> {
    // Build the prompt
    const prompt = this.buildPrompt(
      metricSeries,
      context,
      priorHypotheses,
      logs,
      traces,
      topology,
    );

    // Call DeepSeek API
    const response = await this.callAPI(prompt);

    // Parse response
    return this.parseResponse(response, priorHypotheses);
  }

  // ── Prompt Construction ─────────────────────────────────

  /**
   * Build a structured prompt for the LLM.
   */
  private buildPrompt(
    metricSeries: readonly TimeSeries[],
    context: FaultClassifierContext,
    priorHypotheses: readonly FaultTypeHypothesis[],
    logs?: ReadonlyArray<{ readonly message: string; readonly level: string; readonly timestamp: number }>,
    traces?: ReadonlyArray<{ readonly service: string; readonly operationName: string; readonly duration: number; readonly status: string }>,
    topology?: { readonly nodes: ReadonlyMap<string, unknown>; readonly edges: ReadonlyArray<unknown> },
  ): string {
    const parts: string[] = [];

    parts.push('You are an AIOps fault classification expert. Analyze the following data and classify the most likely fault type.');
    parts.push('');
    parts.push('## Service Context');
    parts.push(`- Service ID: ${context.serviceId}`);
    parts.push(`- Available metrics: ${context.metricNames.join(', ') || 'none'}`);

    // Metric summaries
    if (metricSeries.length > 0) {
      parts.push('');
      parts.push('## Time-Series Statistics');
      parts.push('| Metric | Mean | StdDev | Points |');
      parts.push('|--------|------|--------|--------|');
      for (const s of metricSeries.slice(0, 10)) {
        const mean = s.values.reduce((a, b) => a + b, 0) / s.values.length;
        const variance = s.values.reduce((s, v) => s + (v - mean) ** 2, 0) / s.values.length;
        parts.push(`| ${s.label} | ${mean.toFixed(2)} | ${Math.sqrt(variance).toFixed(2)} | ${s.values.length} |`);
      }
      if (metricSeries.length > 10) {
        parts.push(`| ... +${metricSeries.length - 10} more | | | |`);
      }
    }

    // Prior hypotheses
    if (priorHypotheses.length > 0 && priorHypotheses[0]!.category !== 'UNKNOWN') {
      parts.push('');
      parts.push('## Prior Analysis (Layers 1 & 2)');
      for (const h of priorHypotheses.slice(0, 3)) {
        parts.push(`- ${h.category} (confidence: ${(h.confidence * 100).toFixed(1)}%, method: ${h.method})`);
        if (h.evidence.length > 0) parts.push(`  Evidence: ${h.evidence.join('; ')}`);
      }
    }

    // Logs summary
    if (logs && logs.length > 0) {
      parts.push('');
      parts.push('## Recent Logs (last 5)');
      for (const l of logs.slice(-5)) {
        parts.push(`- [${l.level}] ${l.message.slice(0, 120)}`);
      }
    }

    // Traces summary
    if (traces && traces.length > 0) {
      parts.push('');
      parts.push('## Trace Summary');
      const errorTraces = traces.filter((t) => t.status === 'ERROR').length;
      parts.push(`- Total spans: ${traces.length}`);
      parts.push(`- Error spans: ${errorTraces}`);
      if (errorTraces > 0) {
        const firstError = traces.find((t) => t.status === 'ERROR');
        if (firstError) parts.push(`- Example error: ${firstError.service}/${firstError.operationName} (${firstError.duration}ms)`);
      }
    }

    // Topology
    if (topology && topology.nodes.size > 0) {
      parts.push('');
      parts.push(`## Service Topology (${topology.nodes.size} nodes, ${topology.edges.length} edges)`);
    }

    // Classification instruction
    parts.push('');
    parts.push('## Fault Type Categories');
    parts.push('CPU, MEM, DISK, DELAY, LOSS, SOCKET, UNKNOWN');
    parts.push('');
    parts.push('Respond with a JSON array of hypotheses. Each hypothesis must have:');
    parts.push('- category: one of the categories above');
    parts.push('- confidence: number 0-1');
    parts.push('- evidence: array of strings explaining the reasoning');
    parts.push('- severity: "critical", "major", "minor", "warning", or "info"');
    parts.push('');
    parts.push('Example response:');
    parts.push('[{"category":"MEM","confidence":0.85,"evidence":["Monotonic heap growth detected","No GC activity observed"],"severity":"major"}]');
    parts.push('');
    parts.push('Respond ONLY with the JSON array, no other text.');

    return parts.join('\n');
  }

  // ── API Call ────────────────────────────────────────────

  /**
   * Call the DeepSeek API with a structured prompt.
   */
  private async callAPI(prompt: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`DeepSeek API error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = (await response.json()) as {
        choices: ReadonlyArray<{ message: { content: string } }>;
      };

      return data.choices[0]?.message.content ?? '';
    } finally {
      clearTimeout(timeout);
    }
  }

  // ── Response Parsing ────────────────────────────────────

  /**
   * Parse the LLM response into structured hypotheses.
   */
  private parseResponse(
    raw: string,
    priorHypotheses: readonly FaultTypeHypothesis[],
  ): FaultTypeHypothesis[] {
    // Extract JSON from response (may contain markdown code fences)
    let json = raw.trim();
    const jsonMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      json = jsonMatch[1]!.trim();
    }

    try {
      const parsed = JSON.parse(json) as unknown[];
      if (!Array.isArray(parsed)) {
        return this.fallbackToPrior(priorHypotheses);
      }

      const hypotheses: FaultTypeHypothesis[] = [];
      for (const item of parsed) {
        if (typeof item === 'object' && item !== null) {
          const h = item as Record<string, unknown>;
          hypotheses.push({
            category: String(h['category'] ?? 'UNKNOWN'),
            confidence: Math.min(1, Math.max(0, Number(h['confidence'] ?? 0))),
            evidence: Array.isArray(h['evidence'])
              ? h['evidence'].map(String)
              : [String(h['evidence'] ?? 'No evidence provided')],
            method: 'llm',
            severity: this.normalizeSeverity(String(h['severity'] ?? 'info')),
          });
        }
      }

      if (hypotheses.length === 0) {
        return this.fallbackToPrior(priorHypotheses);
      }

      return hypotheses.sort((a, b) => b.confidence - a.confidence);
    } catch {
      // JSON parse failed — fall back to prior hypotheses
      return this.fallbackToPrior(priorHypotheses);
    }
  }

  /**
   * Fall back to prior hypotheses wrapped as LLM method.
   */
  private fallbackToPrior(
    prior: readonly FaultTypeHypothesis[],
  ): FaultTypeHypothesis[] {
    if (prior.length === 0) {
      return [
        {
          category: 'UNKNOWN',
          confidence: 0,
          evidence: ['LLM response could not be parsed'],
          method: 'llm',
          severity: 'info',
        },
      ];
    }
    return prior.map((h) => ({ ...h, method: 'llm' as const }));
  }

  /**
   * Normalize a severity string to the expected union type.
   */
  private normalizeSeverity(
    raw: string,
  ): FaultTypeHypothesis['severity'] {
    const lower = raw.toLowerCase();
    if (lower === 'critical') return 'critical';
    if (lower === 'major') return 'major';
    if (lower === 'minor') return 'minor';
    if (lower === 'warning') return 'warning';
    return 'info';
  }
}
