import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FaultClassifierContext, FaultTypeHypothesis, IFaultClassifier, ILLMFaultClassifier, IStatisticalAnalyzer } from '@agentix-e/micro-kinetic-core';
import type { TimeSeries } from '@agentix-e/micro-kinetic-core';
import { PyramidFaultClassifier } from '../../../src/classifiers/pyramid-classifier.js';

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
  return { serviceId, metricNames: [] };
}

function makeHypothesis(
  category: string,
  confidence: number,
  method: 'rule' | 'statistical' | 'llm',
): FaultTypeHypothesis {
  return {
    category,
    confidence,
    evidence: [`test-${category}`],
    method,
    severity: 'major',
  };
}

// ── Mocks ─────────────────────────────────────────────────

function createMockRuleEngine(confidences: Record<string, number>): IFaultClassifier {
  return {
    method: 'rule',
    classify: vi.fn(() =>
      Object.entries(confidences).map(([cat, conf]) =>
        makeHypothesis(cat, conf, 'rule'),
      ),
    ),
  };
}

function createMockStatAnalyzer(confidences: Record<string, number>): IStatisticalAnalyzer {
  return {
    method: 'statistical',
    extractFeatures: vi.fn(),
    classify: vi.fn(() =>
      Object.entries(confidences).map(([cat, conf]) =>
        makeHypothesis(cat, conf, 'statistical'),
      ),
    ),
  };
}

function createMockLLMClassifier(): ILLMFaultClassifier {
  return {
    method: 'llm',
    classify: vi.fn(() => [makeHypothesis('UNKNOWN', 0, 'llm')]),
    classifyWithContext: vi.fn(() =>
      Promise.resolve([makeHypothesis('MEM', 0.9, 'llm')]),
    ),
  };
}

// ── Tests — PyramidFaultClassifier ────────────────────────

describe('PyramidFaultClassifier', () => {
  let ruleEngine: IFaultClassifier;
  let statAnalyzer: IStatisticalAnalyzer;
  let llmClassifier: ILLMFaultClassifier;

  beforeEach(() => {
    ruleEngine = createMockRuleEngine({});
    statAnalyzer = createMockStatAnalyzer({});
    llmClassifier = createMockLLMClassifier();
  });

  describe('synchronous classify', () => {
    it('should return rule results when confidence >= threshold', () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.85 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = pyramid.classify([makeSeries('cpu', [0.9])], makeContext());
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.method).toBe('rule');
    });

    it('should fall back to statistics when rule confidence is low', () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.3 });
      statAnalyzer = createMockStatAnalyzer({ MEM: 0.75 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = pyramid.classify([makeSeries('heap', [100, 110])], makeContext());
      expect(result[0]!.category).toBe('MEM');
      expect(result[0]!.method).toBe('statistical');
    });

    it('should merge results when both layers are low confidence', () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.3 });
      statAnalyzer = createMockStatAnalyzer({ DISK: 0.4 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = pyramid.classify([makeSeries('metric', [0.5])], makeContext());
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect maxHypotheses config', () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.3, MEM: 0.3, DISK: 0.3, DELAY: 0.3, LOSS: 0.3 });
      statAnalyzer = createMockStatAnalyzer({ SOCKET: 0.4 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier, {
        maxHypotheses: 2,
      });
      const result = pyramid.classify([makeSeries('m', [0.5])], makeContext());
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('async classify (three-layer)', () => {
    it('should return rule results when confidence is high', async () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.9 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = await pyramid.classifyAsync([makeSeries('cpu', [0.9])], makeContext());
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.method).toBe('rule');
    });

    it('should fall back to stats when rule is low', async () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.3 });
      statAnalyzer = createMockStatAnalyzer({ DISK: 0.8 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = await pyramid.classifyAsync([makeSeries('iops', [100])], makeContext());
      expect(result[0]!.category).toBe('DISK');
      expect(result[0]!.method).toBe('statistical');
    });

    it('should call LLM when both layers are low confidence', async () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.2 });
      statAnalyzer = createMockStatAnalyzer({ CPU: 0.3 });
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = await pyramid.classifyAsync([makeSeries('unknown', [0.5])], makeContext());
      expect(llmClassifier.classifyWithContext).toHaveBeenCalled();
      expect(result[0]!.method).toBe('llm');
    });

    it('should handle LLM failure gracefully', async () => {
      ruleEngine = createMockRuleEngine({ CPU: 0.2 });
      statAnalyzer = createMockStatAnalyzer({ DISK: 0.3 });
      llmClassifier.classifyWithContext = vi.fn(() => Promise.reject(new Error('API error')));
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      const result = await pyramid.classifyAsync([makeSeries('x', [0.5])], makeContext());
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('method identifier', () => {
    it('should return pyramid', () => {
      const pyramid = new PyramidFaultClassifier(ruleEngine, statAnalyzer, llmClassifier);
      expect(pyramid.method).toBe('pyramid');
    });
  });
});
