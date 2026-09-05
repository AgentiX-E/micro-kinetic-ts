import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FaultClassifierContext, FaultTypeHypothesis, ILLMFaultClassifier } from '@agentix-e/micro-kinetic-core';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';

// Mock fetch globally for LLM classifier tests
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

// Dynamic import so mocks are in place before module loads
let LLMFaultClassifier: typeof import('../../../src/classifiers/llm-classifier.js').LLMFaultClassifier;

beforeEach(async () => {
  // Set env for API key
  process.env['DEEPSEEK_API_KEY'] = 'sk-test-key';
  vi.resetModules();
  const mod = await import('../../../src/classifiers/llm-classifier.js');
  LLMFaultClassifier = mod.LLMFaultClassifier;
  mockFetch.mockReset();
});

afterEach(() => {
  delete process.env['DEEPSEEK_API_KEY'];
});

// ── Helpers ───────────────────────────────────────────────

function makeSeries(label: string, values: number[]): TimeSeries {
  return {
    label,
    values: new Float64Array(values),
    timestamps: values.map((_, i) => 1000 + i * 60),
    unit: 'count',
  };
}

function makeContext(serviceId = 'svc_a'): FaultClassifierContext {
  return {
    serviceId,
    metricNames: ['cpu_usage', 'memory_used'],
  };
}

function makePriorHypotheses(): FaultTypeHypothesis[] {
  return [
    { category: 'CPU', confidence: 0.4, evidence: ['cpu_usage elevated'], method: 'rule', severity: 'major' },
    { category: 'MEM', confidence: 0.5, evidence: ['monotonic heap growth'], method: 'statistical', severity: 'major' },
  ];
}

// ── Tests — LLMFaultClassifier ────────────────────────────

describe('LLMFaultClassifier', () => {
  it('should throw when DEEPSEEK_API_KEY is not set', async () => {
    delete process.env['DEEPSEEK_API_KEY'];
    vi.resetModules();
    const mod = await import('../../../src/classifiers/llm-classifier.js');
    expect(() => new mod.LLMFaultClassifier()).toThrow('DEEPSEEK_API_KEY');
  });

  it('should construct successfully when API key is set', () => {
    const classifier = new LLMFaultClassifier();
    expect(classifier.method).toBe('llm');
  });

  it('should accept custom config', () => {
    const classifier = new LLMFaultClassifier({
      model: 'deepseek-reasoner',
      maxTokens: 1024,
      temperature: 0.3,
    });
    expect(classifier.method).toBe('llm');
  });

  describe('classify (sync)', () => {
    it('should return UNKNOWN placeholder for sync classify', () => {
      const classifier = new LLMFaultClassifier();
      const result = classifier.classify([makeSeries('cpu', [0.9])], makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
      expect(result[0]!.method).toBe('llm');
    });
  });

  describe('classifyWithContext', () => {
    it('should call DeepSeek API with structured prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '[{"category":"MEM","confidence":0.85,"evidence":["heap growing"],"severity":"major"}]' } }],
        }),
      });

      const classifier = new LLMFaultClassifier();
      const result = await classifier.classifyWithContext(
        [makeSeries('heap_used', [100, 120, 150, 200])],
        makeContext(),
        makePriorHypotheses(),
      );

      expect(result[0]!.category).toBe('MEM');
      expect(result[0]!.confidence).toBe(0.85);
      expect(result[0]!.method).toBe('llm');
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it('should pass prior hypotheses in the prompt', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '[{"category":"CPU","confidence":0.7,"evidence":["prior aligned"],"severity":"major"}]' } }],
        }),
      });

      const classifier = new LLMFaultClassifier();
      const result = await classifier.classifyWithContext(
        [makeSeries('cpu_usage', [0.9])],
        makeContext(),
        makePriorHypotheses(),
      );

      expect(result[0]!.category).toBe('CPU');
    });

    it('should throw on API error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const classifier = new LLMFaultClassifier();
      await expect(
        classifier.classifyWithContext(
          [makeSeries('heap', [100, 150])],
          makeContext(),
          makePriorHypotheses(),
        ),
      ).rejects.toThrow('Network error');
    });

    it('should throw on non-200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const classifier = new LLMFaultClassifier();
      await expect(
        classifier.classifyWithContext(
          [makeSeries('heap', [100, 150])],
          makeContext(),
          makePriorHypotheses(),
        ),
      ).rejects.toThrow('DeepSeek API error 401');
    });

    it('should fall back to prior on JSON parse error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'invalid json here' } }],
        }),
      });

      const classifier = new LLMFaultClassifier();
      const result = await classifier.classifyWithContext(
        [makeSeries('heap', [100, 150])],
        makeContext(),
        makePriorHypotheses(),
      );

      expect(result.some((h) => h.category === 'MEM')).toBe(true);
    });

    it('should handle LLM response with code fence', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: '```json\n[{"category":"DISK","confidence":0.9,"evidence":["high I/O"],"severity":"critical"}]\n```' } }],
        }),
      });

      const classifier = new LLMFaultClassifier();
      const result = await classifier.classifyWithContext(
        [makeSeries('disk', [500, 100])],
        makeContext(),
        [],
      );

      expect(result[0]!.category).toBe('DISK');
      expect(result[0]!.confidence).toBe(0.9);
    });

    it('should handle fetch abort from timeout', async () => {
      mockFetch.mockImplementationOnce(() => {
        throw new DOMException('The operation was aborted', 'AbortError');
      });

      const classifier = new LLMFaultClassifier({ timeoutMs: 1 });
      await expect(
        classifier.classifyWithContext(
          [makeSeries('x', [1])],
          makeContext(),
          [],
        ),
      ).rejects.toThrow();
    });
  });
});
