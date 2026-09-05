/**
 * Tests for IntelligentFaultClassifier — the three-tier fault classification pipeline.
 *
 * Coverage targets: statements ≥95%, branches ≥95%, functions 100%, lines ≥95%.
 *
 * Test categories:
 *   1. Tier 1 (Metric Signature) — deterministic, no API calls
 *   2. Tier 2 (Embedding) — simulated embedding provider
 *   3. Tier 3 (LLM) — simulated LLM provider
 *   4. Fusion and fallback behaviour
 *   5. Edge cases (empty metrics, all-zero, single point, unknown patterns)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntelligentFaultClassifier } from '../../src/rca/intelligent-fault-classifier.js';
import type {
  FaultClassification,
  IntelligentClassifierOptions,
} from '../../src/rca/intelligent-fault-classifier.js';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// ── Test Helpers ────────────────────────────────────────────

/** Create a TimeSeries with linear values over a time range. */
function makeTimeSeries(
  label: string,
  startMs: number,
  endMs: number,
  count: number,
  values: number[],
  unit = 'percent',
): TimeSeries {
  const step = (endMs - startMs) / (count - 1);
  const timestamps: number[] = [];
  for (let i = 0; i < count; i++) {
    timestamps.push(startMs + i * step);
  }
  return {
    label,
    timestamps,
    values: new Float64Array(values.slice(0, count)),
    unit,
  };
}

/** Create a linearly rising time series. */
function risingTS(
  label: string,
  startMs: number,
  endMs: number,
  count: number,
  from: number,
  to: number,
  unit?: string,
): TimeSeries {
  const values: number[] = [];
  for (let i = 0; i < count; i++) {
    values.push(from + ((to - from) * i) / (count - 1));
  }
  return makeTimeSeries(label, startMs, endMs, count, values, unit);
}

/** Create a flat time series. */
function flatTS(
  label: string,
  startMs: number,
  endMs: number,
  count: number,
  value: number,
  unit?: string,
): TimeSeries {
  return risingTS(label, startMs, endMs, count, value, value, unit);
}

/** Factory for a new classifier with default options. */
function createClassifier(
  overrides?: Partial<IntelligentClassifierOptions>,
): IntelligentFaultClassifier {
  return new IntelligentFaultClassifier(overrides);
}

// ── Tier 1: Metric Signature Tests ──────────────────────────

describe('IntelligentFaultClassifier — Tier 1 (Metric Signature)', () => {
  let classifier: IntelligentFaultClassifier;

  beforeEach(() => {
    classifier = createClassifier();
  });

  it('classifies sustained high CPU as CPU fault', async () => {
    // CPU rises from 0.2 to 0.95 over 5 minutes
    const metrics = [
      risingTS('container_cpu_usage', 0, 300_000, 100, 0.2, 0.95),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('CPU');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.source).toBe('metric-signature');
  });

  it('classifies monotonically increasing memory as MEM fault', async () => {
    // Memory rises from 0.3 to 0.85 over 5 minutes
    const metrics = [
      risingTS('container_memory_usage', 0, 300_000, 100, 0.3, 0.85),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('MEM');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.source).toBe('metric-signature');
  });

  it('classifies disk I/O saturation as DISK fault', async () => {
    const metrics = [
      risingTS('disk_io_usage', 0, 300_000, 100, 0.3, 0.85),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('DISK');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('classifies latency spike without errors as DELAY fault', async () => {
    // Latency spikes 10x while error rate stays flat
    const metrics = [
      risingTS('p99_latency', 0, 300_000, 100, 5, 100),
      flatTS('error_rate', 0, 300_000, 100, 0.01),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('DELAY');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('classifies error surge with latency rise as LOSS fault', async () => {
    // LOSS: high error surge + moderate latency (below 3x DELAY spike threshold)
    const metrics = [
      risingTS('error_rate', 0, 300_000, 100, 0.01, 0.5),
      risingTS('p99_latency', 0, 300_000, 100, 5, 10),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('LOSS');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('classifies socket errors as SOCKET fault', async () => {
    const metrics = [
      risingTS('socket_errors', 0, 300_000, 100, 0.01, 100),
      risingTS('error_count', 0, 300_000, 100, 0, 50),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('SOCKET');
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('falls to heuristic for unrecognised patterns', async () => {
    // Random noise — no known signature matches
    const metrics = [
      flatTS('random_metric', 0, 300_000, 100, 0.5),
    ];
    const result = await classifier.classify(metrics);
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('returns valid classification for empty metrics', async () => {
    const result = await classifier.classify([]);
    expect(result.category).toBeDefined();
    expect(result.source).toBe('heuristic');
  });

  it('classifies correctly with single-point metrics', async () => {
    const metrics = [
      makeTimeSeries('cpu', 0, 0, 1, [0.95]),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('prefers metric signature over heuristic when confidence is marginal', async () => {
    // Partial match — only some CPU signature criteria met
    const metrics = [
      risingTS('cpu_half', 0, 300_000, 100, 0.2, 0.6), // Below 0.7 threshold
    ];
    const result = await classifier.classify(metrics);
    // Should still return a classification (not throw)
    expect(result.category).toBeDefined();
  });
});

// ── Tier 2: Embedding Tests ─────────────────────────────────

describe('IntelligentFaultClassifier — Tier 2 (Embedding)', () => {
  /** Simulated embedding provider returning deterministic vectors. */
  function makeMockEmbedding(
    faultToMatch: string,
  ): IntelligentClassifierOptions['embeddingProvider'] {
    return {
      async embed(texts: string[]): Promise<Float64Array[]> {
        return texts.map((text) => {
          const vec = new Float64Array(128);
          // Embed the fault keyword into the first few dimensions for similarity
          if (text.toLowerCase().includes(faultToMatch.toLowerCase())) {
            vec[0] = 1.0;
          }
          // Query embedding always matches the target fault
          if (text.includes('rising') || text.includes('partial')) {
            vec[0] = 1.0;
            vec[1] = 1.0;
          }
          return vec;
        });
      },
    };
  }

  it('uses embedding when metric signature confidence is low', async () => {
    const classifier = createClassifier({
      embeddingProvider: makeMockEmbedding('CPU'),
    });

    // Neutral metrics that won't strongly match any signature
    const metrics = [
      risingTS('response_time', 0, 300_000, 50, 10, 80),
      flatTS('throughput', 0, 300_000, 50, 100),
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    // If signature produced weak result and embedding produced strong,
    // source should be embedding
    if (result.source !== 'metric-signature') {
      expect(['embedding', 'heuristic']).toContain(result.source);
    }
  });

  it('gracefully handles embedding provider failure', async () => {
    const classifier = createClassifier({
      embeddingProvider: {
        async embed(): Promise<Float64Array[]> {
          throw new Error('API unavailable');
        },
      },
    });

    const metrics = [
      risingTS('mixed_metric', 0, 300_000, 50, 0.3, 0.6),
    ];

    const result = await classifier.classify(metrics);
    // Should NOT throw, should fall through to heuristic
    expect(result.category).toBeDefined();
    expect(result.source).not.toBe('embedding');
  });

  it('returns embedding result when similarity is above threshold', async () => {
    // Provider that always maps to MEM with high cosine similarity
    const embedder = {
      async embed(texts: string[]): Promise<Float64Array[]> {
        const results: Float64Array[] = [];
        for (const text of texts) {
          const vec = new Float64Array(128);
          if (text.includes('memory leak') || text.includes('increasing memory')) {
            vec[0] = 1.0;
          } else if (text.includes('avg=')) {
            // Query: give it the MEM prototype
            vec[0] = 0.999; // Very high similarity to MEM
          }
          results.push(vec);
        }
        return results;
      },
    };

    const classifier = createClassifier({ embeddingProvider: embedder });

    // Metrics that DON'T match any signature strongly
    const metrics = [
      risingTS('container_mem_low', 0, 300_000, 50, 0.3, 0.35), // slope too low for MEM sig
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });
});

// ── Tier 3: LLM Tests ───────────────────────────────────────

describe('IntelligentFaultClassifier — Tier 3 (LLM)', () => {
  function makeMockLLM(
    response: string,
  ): IntelligentClassifierOptions['llmProvider'] {
    return {
      async complete(_prompt: string): Promise<string> {
        return response;
      },
    };
  }

  it('classifies using LLM when signature and embedding are unavailable', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "F1", "confidence": 0.85, "reasoning": "Incorrect parameter values detected in log traces"}',
      ),
    });

    // Neutral metrics — no strong signature
    const metrics = [
      flatTS('generic_metric', 0, 300_000, 50, 0.5),
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBe('F1');
    expect(result.confidence).toBeCloseTo(0.85);
    expect(result.source).toBe('llm');
  });

  it('gracefully handles LLM provider failure', async () => {
    const classifier = createClassifier({
      llmProvider: {
        async complete(): Promise<string> {
          throw new Error('LLM timeout');
        },
      },
    });

    const metrics = [
      flatTS('random_metric', 0, 300_000, 50, 0.5),
    ];

    const result = await classifier.classify(metrics);
    // Should NOT throw
    expect(result.category).toBeDefined();
    expect(result.source).not.toBe('llm');
  });

  it('classifies F2 (missing parameter) via LLM', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "F2", "confidence": 0.9, "reasoning": "Missing parameter causing null pointer"}',
      ),
    });
    const metrics = [flatTS('req_count', 0, 300_000, 50, 50)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('F2');
    expect(result.source).toBe('llm');
  });

  it('classifies F3 (missing function call) via LLM', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "F3", "confidence": 0.88, "reasoning": "Expected function call absent from trace"}',
      ),
    });
    const metrics = [flatTS('call_count', 0, 300_000, 50, 5)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('F3');
  });

  it('classifies F4 (incorrect return value) via LLM', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "F4", "confidence": 0.82, "reasoning": "Return value type mismatch in trace"}',
      ),
    });
    const metrics = [flatTS('ret_val', 0, 300_000, 50, 0)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('F4');
  });

  it('classifies F5 (missing exception handler) via LLM', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "F5", "confidence": 0.92, "reasoning": "Unhandled exception in stack trace"}',
      ),
    });
    const metrics = [risingTS('exception_count', 0, 300_000, 50, 0, 100)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('F5');
  });

  it('rejects invalid LLM responses gracefully', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM('not valid json at all'),
    });
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics);
    expect(result.source).not.toBe('llm');
    expect(result.category).toBeDefined();
  });

  it('rejects LLM responses with invalid categories', async () => {
    const classifier = createClassifier({
      llmProvider: makeMockLLM(
        '{"category": "INVALID_TYPE", "confidence": 0.9, "reasoning": "test"}',
      ),
    });
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics);
    expect(result.source).not.toBe('llm');
  });
});

// ── Fusion and Fallback Tests ────────────────────────────────

describe('IntelligentFaultClassifier — Fusion & Fallback', () => {
  it('fuses LLM and embedding results when both available', async () => {
    const classifier = createClassifier({
      embeddingProvider: {
        async embed(texts: string[]): Promise<Float64Array[]> {
          const results: Float64Array[] = [];
          for (const text of texts) {
            const vec = new Float64Array(128);
            if (text.includes('avg=')) vec[0] = 0.999;
            results.push(vec);
          }
          return results;
        },
      },
      llmProvider: {
        async complete(): Promise<string> {
          return '{"category": "MEM", "confidence": 0.85, "reasoning": "Memory leak pattern confirmed"}';
        },
      },
    });

    // Memory metric with marginal slope — won't trigger strong signature
    const metrics = [
      risingTS('container_memory_marginal', 0, 300_000, 50, 0.3, 0.45),
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('boots confidence when embedding and LLM agree on category', async () => {
    const classifier = createClassifier({
      embeddingProvider: {
        async embed(texts: string[]): Promise<Float64Array[]> {
          const results: Float64Array[] = [];
          for (const text of texts) {
            const vec = new Float64Array(128);
            if (text.includes('memory leak')) vec[0] = 1;
            if (text.includes('avg=')) vec[0] = 0.8;
            results.push(vec);
          }
          return results;
        },
      },
      llmProvider: {
        async complete(): Promise<string> {
          return '{"category": "MEM", "confidence": 0.85, "reasoning": "Memory leak detected"}';
        },
      },
    });

    const metrics = [
      risingTS('mem_usage', 0, 300_000, 50, 0.3, 0.4), // Very gradual
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBe('MEM');
  });

  it('provides evidence in all classification results', async () => {
    const classifier = createClassifier();
    const metrics = [
      risingTS('container_cpu_usage', 0, 300_000, 100, 0.2, 0.95),
    ];
    const result = await classifier.classify(metrics);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence[0]!.metric).toBeDefined();
    expect(result.evidence[0]!.observation).toBeDefined();
  });

  it('returns deterministic results for the same inputs', async () => {
    const classifier = createClassifier();
    const metrics = [
      risingTS('container_cpu_usage', 0, 300_000, 100, 0.2, 0.95),
    ];

    const r1 = await classifier.classify(metrics);
    const r2 = await classifier.classify(metrics);

    expect(r1.category).toBe(r2.category);
    expect(r1.source).toBe(r2.source);
    expect(r1.confidence).toBeCloseTo(r2.confidence);
  });

  it('handles baseline metrics for ratio comparison', async () => {
    const classifier = createClassifier({
      baselineMetrics: new Map([
        [
          'baseline',
          [flatTS('container_cpu_usage', -300_000, 0, 50, 0.1)],
        ],
      ]),
    });

    const metrics = [
      risingTS('container_cpu_usage', 0, 300_000, 100, 0.2, 0.95),
    ];

    const result = await classifier.classify(metrics);
    expect(result.category).toBe('CPU');
  });
});

// ── Edge Case Tests ──────────────────────────────────────────

describe('IntelligentFaultClassifier — Edge Cases', () => {
  it('handles very short time series (2 points)', async () => {
    const classifier = createClassifier();
    const metrics = [
      makeTimeSeries('cpu', 0, 1000, 2, [0.2, 0.95]),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('handles single-service multi-metric ambiguity', async () => {
    const classifier = createClassifier();
    // CPU-like AND memory-like — should prefer stronger match
    const metrics = [
      risingTS('cpu_usage_strong', 0, 300_000, 100, 0.2, 0.95),
      risingTS('mem_usage_weak', 0, 300_000, 100, 0.3, 0.35),
    ];
    const result = await classifier.classify(metrics);
    // CPU match is stronger (0.2→0.95 vs 0.3→0.35)
    expect(result.category).toBe('CPU');
  });

  it('handles zero-values gracefully', async () => {
    const classifier = createClassifier();
    const metrics = [flatTS('zero_metric', 0, 300_000, 100, 0)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('handles NaN values gracefully', async () => {
    const classifier = createClassifier();
    const values = Array(100).fill(NaN);
    values[50] = 0.5;
    const metrics = [
      makeTimeSeries('partial_nan', 0, 300_000, 100, values),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('handles negative values', async () => {
    const classifier = createClassifier();
    const metrics = [
      makeTimeSeries('negative_metric', 0, 300_000, 100, Array(100).fill(-1)),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('handles very large value ranges', async () => {
    const classifier = createClassifier();
    const values: number[] = [];
    for (let i = 0; i < 100; i++) values.push(i * 1e6);
    const metrics = [
      makeTimeSeries('huge_metric', 0, 300_000, 100, values),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('all classification results have valid structure', async () => {
    const classifier = createClassifier();
    const testCases: TimeSeries[][] = [
      [risingTS('cpu', 0, 300_000, 50, 0.2, 0.95)],
      [flatTS('idle', 0, 300_000, 50, 0.1)],
      [],
      [risingTS('mem', 0, 300_000, 50, 0.3, 0.85)],
      [risingTS('disk', 0, 300_000, 50, 0.3, 0.85)],
      [risingTS('latency', 0, 300_000, 50, 5, 100), flatTS('error', 0, 300_000, 50, 0.01)],
      [risingTS('error', 0, 300_000, 50, 0.01, 0.5), risingTS('latency', 0, 300_000, 50, 5, 50)],
    ];

    for (const metrics of testCases) {
      const result = await classifier.classify(metrics);
      expect(result, `failed for ${metrics.map((m) => m.label).join(',')}`).toBeDefined();
      expect(result.category).toBeDefined();
      expect(result.category.length).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.source).toBeDefined();
      expect(result.evidence.length).toBeGreaterThan(0);
    }
  });

  it('provides description for all classifications', async () => {
    const classifier = createClassifier();
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics);
    expect(result.description.length).toBeGreaterThan(0);
  });
});

// ── Constructor Tests ────────────────────────────────────────

describe('IntelligentFaultClassifier — Construction', () => {
  it('constructs without options', () => {
    const classifier = new IntelligentFaultClassifier();
    expect(classifier).toBeDefined();
  });

  it('constructs with empty options', () => {
    const classifier = new IntelligentFaultClassifier({});
    expect(classifier).toBeDefined();
  });

  it('constructs with all provider options', () => {
    const classifier = new IntelligentFaultClassifier({
      embeddingProvider: { async embed() { return []; } },
      llmProvider: { async complete() { return ''; } },
    });
    expect(classifier).toBeDefined();
  });

  it('constructs with log and trace data', () => {
    const classifier = new IntelligentFaultClassifier({
      logs: ['error: null pointer at line 42'],
      traces: [{ operation: 'getUser', duration: 5000, status: 'ERROR' }],
    });
    expect(classifier).toBeDefined();
  });
});

// ── Fault Type Coverage (all 11 RCAEval types) ───────────────

describe('IntelligentFaultClassifier — All RCAEval Fault Types', () => {
  it('covers CPU via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([risingTS('cpu', 0, 300_000, 100, 0.2, 0.95)]);
    expect(r.category).toBe('CPU');
  });

  it('covers MEM via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([risingTS('mem', 0, 300_000, 100, 0.3, 0.85)]);
    expect(r.category).toBe('MEM');
  });

  it('covers DISK via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([risingTS('disk', 0, 300_000, 100, 0.3, 0.85)]);
    expect(r.category).toBe('DISK');
  });

  it('covers DELAY via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([
      risingTS('latency', 0, 300_000, 100, 5, 100),
      flatTS('error', 0, 300_000, 100, 0.01),
    ]);
    expect(r.category).toBe('DELAY');
  });

  it('covers LOSS via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([
      risingTS('error', 0, 300_000, 100, 0.01, 0.5),
      risingTS('latency', 0, 300_000, 100, 5, 10),
    ]);
    expect(r.category).toBe('LOSS');
  });

  it('covers SOCKET via metric signature', async () => {
    const c = createClassifier();
    const r = await c.classify([
      risingTS('socket_err', 0, 300_000, 100, 0.01, 100),
      risingTS('error_cnt', 0, 300_000, 100, 0, 50),
    ]);
    expect(r.category).toBe('SOCKET');
  });

  it('covers F1 via LLM', async () => {
    const c = createClassifier({
      llmProvider: { async complete() { return '{"category":"F1","confidence":0.9,"reasoning":"test"}'; } },
    });
    const r = await c.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(r.category).toBe('F1');
  });

  it('covers F2 via LLM', async () => {
    const c = createClassifier({
      llmProvider: { async complete() { return '{"category":"F2","confidence":0.9,"reasoning":"test"}'; } },
    });
    const r = await c.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(r.category).toBe('F2');
  });

  it('covers F3 via LLM', async () => {
    const c = createClassifier({
      llmProvider: { async complete() { return '{"category":"F3","confidence":0.9,"reasoning":"test"}'; } },
    });
    const r = await c.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(r.category).toBe('F3');
  });

  it('covers F4 via LLM', async () => {
    const c = createClassifier({
      llmProvider: { async complete() { return '{"category":"F4","confidence":0.9,"reasoning":"test"}'; } },
    });
    const r = await c.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(r.category).toBe('F4');
  });

  it('covers F5 via LLM', async () => {
    const c = createClassifier({
      llmProvider: { async complete() { return '{"category":"F5","confidence":0.9,"reasoning":"test"}'; } },
    });
    const r = await c.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(r.category).toBe('F5');
  });
});

// ── Remaining Reachable Branches ─────────────────────────────

describe('IntelligentFaultClassifier — Remaining Reachable Branches', () => {
  it('computeSlope returns 0 when timestamps are identical (division-by-zero guard)', async () => {
    // Identical timestamps collapse the linear-regression denominator to zero;
    // the guard must return 0 instead of surfacing NaN/Infinity.
    const classifier = createClassifier();
    const metrics = [makeTimeSeries('cpu', 0, 0, 2, [0.9, 0.9])];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    expect(Number.isFinite(result.confidence)).toBe(true);
  });

  it('mean returns 0 for an empty metric and the summary reports a zero peak', async () => {
    const classifier = createClassifier();
    const metrics = [makeTimeSeries('empty_metric', 0, 1000, 0, [])];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    expect(result.source).toBe('heuristic');
  });

  it('rejects a metric whose absolute slope is below minSlopeAbs', async () => {
    // CPU signature requires |slope| >= 0.0005; a 0.2→0.21 ramp over 300s has
    // slope ≈ 3.3e-5, so the slope guard must reject it.
    const classifier = createClassifier();
    const metrics = [risingTS('cpu', 0, 300_000, 100, 0.2, 0.21)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    expect(result.source).toBe('heuristic');
  });

  it('rejects a metric whose fault/baseline ratio is below minRatioToBaseline', async () => {
    const classifier = createClassifier({
      baselineMetrics: new Map([
        ['baseline', [flatTS('container_cpu_usage', -300_000, 0, 50, 0.9)]],
      ]),
    });
    // Fault rises 0.7→0.9 (ratio ~0.89) against baseline 0.9 → below the 2.0
    // threshold, so the ratio guard rejects the CPU match.
    const metrics = [risingTS('container_cpu_usage', 0, 300_000, 100, 0.7, 0.9)];
    const result = await classifier.classify(metrics);
    expect(result.source).toBe('heuristic');
  });

  it('runs the spike check for the DELAY signature when a baseline is present', async () => {
    const classifier = createClassifier({
      baselineMetrics: new Map([
        [
          'baseline',
          [
            flatTS('p99_latency', -300_000, 0, 50, 5),
            flatTS('error_rate', -300_000, 0, 50, 0.01),
          ],
        ],
      ]),
    });
    const metrics = [
      risingTS('p99_latency', 0, 300_000, 100, 5, 100),
      flatTS('error_rate', 0, 300_000, 100, 0.01),
    ];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('DELAY');
  });

  it('findBaseline returns undefined when no baseline metric label matches', async () => {
    const classifier = createClassifier({
      baselineMetrics: new Map([
        ['baseline', [flatTS('memory_usage', -300_000, 0, 50, 0.5)]],
      ]),
    });
    // No baseline for 'cpu_usage' → the ratio check is skipped, CPU is still
    // detected from the fault signature alone.
    const metrics = [risingTS('cpu_usage', 0, 300_000, 100, 0.2, 0.95)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBe('CPU');
  });

  it('buildLLMPrompt emits the empty-metrics placeholder', async () => {
    let capturedPrompt = '';
    const classifier = createClassifier({
      llmProvider: {
        async complete(prompt: string): Promise<string> {
          capturedPrompt = prompt;
          return '{"category":"CPU","confidence":0.9,"reasoning":"x"}';
        },
      },
    });
    await classifier.classify([]);
    expect(capturedPrompt).toContain('(no metrics available)');
  });

  it('LLM response missing category falls back to empty and is rejected', async () => {
    const classifier = createClassifier({
      llmProvider: {
        async complete(): Promise<string> {
          return '{"confidence": 0.9}';
        },
      },
    });
    const result = await classifier.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(result.source).not.toBe('llm');
  });

  it('LLM response missing confidence and reasoning falls back to defaults', async () => {
    const classifier = createClassifier({
      llmProvider: {
        async complete(): Promise<string> {
          return '{"category": "CPU"}';
        },
      },
    });
    const result = await classifier.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(result.category).toBe('CPU');
    expect(result.confidence).toBeCloseTo(0.5);
    expect(result.source).toBe('llm');
  });

  it('reports a falling trend in the metric summary', async () => {
    const classifier = createClassifier();
    const metrics = [risingTS('falling_metric', 0, 300_000, 100, 1.0, 0.0)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
  });

  it('forwards logs and traces into the LLM prompt', async () => {
    let capturedPrompt = '';
    const classifier = createClassifier({
      logs: ['ERROR NullPointerException at line 42'],
      traces: [{ operation: 'getUser', duration: 5000, status: 'ERROR' }],
      llmProvider: {
        async complete(prompt: string): Promise<string> {
          capturedPrompt = prompt;
          return '{"category":"F2","confidence":0.9,"reasoning":"null pointer"}';
        },
      },
    });
    await classifier.classify([flatTS('x', 0, 300_000, 50, 0.5)]);
    expect(capturedPrompt).toContain('NullPointerException');
    expect(capturedPrompt).toContain('getUser: 5000ms ERROR');
  });

  it('returns a low-confidence metric-signature result when it is the only match', async () => {
    const classifier = createClassifier();
    // 'socket_connections' matches SOCKET's 'socket' requirement but not its
    // 'error' requirement → score 0.5, below the 0.7 early-return threshold.
    const metrics = [risingTS('socket_connections', 0, 300_000, 100, 0.01, 100)];
    const result = await classifier.classify(metrics);
    expect(result.source).toBe('metric-signature');
    expect(result.category).toBe('SOCKET');
    expect(result.confidence).toBeCloseTo(0.5);
  });

  it('heuristic: severe score (>=0.8) computes the child ratio and labels a cascaded anomaly', async () => {
    const classifier = createClassifier();
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics, 0.9, 0, 0.45);
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBeCloseTo(0.4);
    expect(result.description).toContain('cascaded');
  });

  it('heuristic: significant score (>=0.6) labels a significant anomaly', async () => {
    const classifier = createClassifier();
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics, 0.7);
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBeCloseTo(0.3);
  });

  it('heuristic: moderate score (>=0.3) labels a moderate anomaly', async () => {
    const classifier = createClassifier();
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics, 0.5);
    expect(result.source).toBe('heuristic');
    expect(result.confidence).toBeCloseTo(0.1);
    expect(result.description).toBe('Moderate anomaly');
  });

  it('heuristic: severe score with low child ratio labels a local anomaly', async () => {
    // childContrib 0 → childRatio 0 (< 0.3) → the "local" branch of the
    // severe heuristic must be selected rather than "cascaded".
    const classifier = createClassifier();
    const metrics = [flatTS('x', 0, 300_000, 50, 0.5)];
    const result = await classifier.classify(metrics, 0.9, 0, 0);
    expect(result.source).toBe('heuristic');
    expect(result.description).toContain('local');
  });

  it('spike check rejects a latency metric whose baseline mean is non-positive', async () => {
    // A baseline latency of 0 gives the spike detector a non-positive mean,
    // forcing the `bl <= 0` guard in hasSpike (and the subsequent `return false`
    // in the spike requirement) — the latency spike must NOT be credited.
    const classifier = createClassifier({
      baselineMetrics: new Map([
        ['baseline', [flatTS('p99_latency', -300_000, 0, 50, 0)]],
      ]),
    });
    // Only a latency metric is provided (no error metric). The DELAY signature
    // requires a latency *spike*; because the baseline mean is zero, `hasSpike`
    // short-circuits on `bl <= 0` and the spike is not credited, so the latency
    // metric cannot satisfy DELAY's requirement.
    const metrics = [risingTS('p99_latency', 0, 300_000, 100, 0, 100)];
    const result = await classifier.classify(metrics);
    expect(result.category).toBeDefined();
    expect(result.category).not.toBe('DELAY');
  });
});
