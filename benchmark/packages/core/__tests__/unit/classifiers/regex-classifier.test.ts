import { describe, it, expect } from 'vitest';
import type { TimeSeries } from '../../../src/types/time-series.js';
import type { ClassificationRule, FaultClassifierContext } from '../../../src/interfaces/fault-classifier.js';
import {
  RegexFaultClassifier,
  DEFAULT_CLASSIFICATION_RULES,
  bestHypothesisToFaultType,
  hypothesisToFaultType,
} from '../../../src/utils/classifiers/regex-classifier.js';

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

// ── Tests — RegexFaultClassifier ──────────────────────────

describe('RegexFaultClassifier', () => {
  describe('with default rules', () => {
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);

    it('should classify CPU metrics', () => {
      const series = [makeSeries('cpu_usage_percent', [0.9, 0.95])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.method).toBe('rule');
      expect(result[0]!.confidence).toBeGreaterThan(0);
    });

    it('should classify MEM metrics', () => {
      const series = [makeSeries('memory_used_bytes', [0.8, 0.9, 0.95])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('MEM');
    });

    it('should classify DISK metrics', () => {
      const series = [makeSeries('disk_iops', [0.7, 0.8])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('DISK');
    });

    it('should classify DELAY metrics', () => {
      const series = [makeSeries('latency_p99', [500, 2000])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('DELAY');
    });

    it('should classify LOSS metrics', () => {
      const series = [makeSeries('error_rate', [0.01, 0.5])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('LOSS');
    });

    it('should classify SOCKET metrics', () => {
      const series = [makeSeries('tcp_connections', [100, 50])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('SOCKET');
    });

    it('should return UNKNOWN for unrecognized metrics', () => {
      const series = [makeSeries('custom_business_metric', [0.5])];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
      expect(result[0]!.confidence).toBe(0);
    });

    it('should return UNKNOWN for empty input', () => {
      const result = classifier.classify([], makeContext());
      expect(result[0]!.category).toBe('UNKNOWN');
    });
  });

  describe('vote aggregation', () => {
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);

    it('should accumulate evidence with same-category multi-series', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('cpu_temperature', [80]),
        makeSeries('cpu_throttle', [1]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.evidence).toHaveLength(3);
    });

    it('should update max confidence when subsequent series has higher rule confidence', () => {
      // Create a custom classifier with rules at different confidence levels
      const customRules: ClassificationRule[] = [
        { pattern: /cpu_a/, category: 'CPU', priority: 100, confidence: 0.3, description: 'low conf' },
        { pattern: /cpu_b/, category: 'CPU', priority: 99, confidence: 0.9, description: 'high conf' },
      ];
      const c = new RegexFaultClassifier(customRules);
      const series = [makeSeries('cpu_a', [0.9]), makeSeries('cpu_b', [0.9])];
      const result = c.classify(series, makeContext());
      // First match at 0.3, second at 0.9 — maxConfidence should be 0.9
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.confidence).toBeGreaterThan(0.85);
    });

    it('should rank hypotheses by confidence', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('cpu_temperature', [80]),
        makeSeries('memory_used', [0.7]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.category).toBe('CPU');
      expect(result[0]!.confidence).toBeGreaterThan(result[1]!.confidence);
      expect(result[1]!.category).toBe('MEM');
    });

    it('should include evidence in each hypothesis', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('memory_used', [0.7]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.evidence).toContain('cpu_usage');
      expect(result[1]!.evidence).toContain('memory_used');
    });
  });

  describe('severity inference', () => {
    const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);

    it('should return critical when all metrics point to one category', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('cpu_temp', [80]),
        makeSeries('cpu_freq', [2.4]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.severity).toBe('critical');
    });

    it('should return major when majority vote', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('cpu_temp', [80]),
        makeSeries('memory_used', [0.7]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.severity).toBe('major');
    });

    it('should handle mixed categories correctly', () => {
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('memory_used', [0.7]),
        makeSeries('disk_iops', [0.5]),
        makeSeries('latency_p99', [2000]),
      ];
      const result = classifier.classify(series, makeContext());
      // All tied — first by priority
      expect(result.length).toBe(4);
    });

    it('should return minor severity for low vote ratio', () => {
      // 1 CPU out of 5 → 0.2 vote ratio → minor
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('memory_used', [0.7]),
        makeSeries('disk_iops', [0.5]),
        makeSeries('latency_p99', [2000]),
        makeSeries('tcp_connections', [100]),
      ];
      const result = classifier.classify(series, makeContext());
      expect(result[0]!.severity).toBe('minor');
    });

    it('should return warning severity for very low vote ratio', () => {
      // 1 CPU out of 10 → 0.1 vote ratio → warning
      const series = [
        makeSeries('cpu_usage', [0.9]),
        makeSeries('memory_used', [0.7]),
        makeSeries('disk_iops', [0.5]),
        makeSeries('latency_p99', [2000]),
        makeSeries('tcp_connections', [100]),
        makeSeries('error_rate', [0.1]),
        makeSeries('jvm_gc_time', [50]),
        makeSeries('heap_used', [200]),
        makeSeries('connection_count', [10]),
        makeSeries('request_latency', [500]),
      ];
      const result = classifier.classify(series, makeContext());
      // CPU has only 1 vote out of 10 → voteRatio=0.1 → 'warning'
      const cpuHypothesis = result.find((h) => h.category === 'CPU');
      if (cpuHypothesis) {
        expect(cpuHypothesis.severity).toBe('warning');
      }
    });
  });

  describe('custom rules', () => {
    it('should accept custom rules via constructor', () => {
      const customRules: ClassificationRule[] = [
        {
          pattern: /gpu_memory_used/,
          category: 'GPU_MEM',
          priority: 100,
          confidence: 0.9,
          description: 'GPU memory utilization',
        },
        {
          pattern: /gpu_utilization/,
          category: 'GPU',
          priority: 100,
          confidence: 0.85,
          description: 'GPU core utilization',
        },
      ];
      const classifier = new RegexFaultClassifier(customRules);
      const result = classifier.classify(
        [makeSeries('gpu_memory_used', [0.95])],
        makeContext(),
      );
      expect(result[0]!.category).toBe('GPU_MEM');
    });

    it('should evaluate higher-priority rules first', () => {
      const customRules: ClassificationRule[] = [
        {
          pattern: /disk_cpu_io/,
          category: 'CPU',
          priority: 50,
          confidence: 0.5,
          description: 'Low-priority CPU rule',
        },
        {
          pattern: /disk_cpu_io/,
          category: 'DISK',
          priority: 100,
          confidence: 0.9,
          description: 'High-priority DISK rule',
        },
      ];
      const classifier = new RegexFaultClassifier(customRules);
      const result = classifier.classify(
        [makeSeries('disk_cpu_io', [0.9])],
        makeContext(),
      );
      expect(result[0]!.category).toBe('DISK');
    });
  });

  describe('method identifier', () => {
    it('should return rule as method', () => {
      const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
      expect(classifier.method).toBe('rule');
    });
  });
});

// ── Tests — hypothesisToFaultType ──────────────────────────

describe('hypothesisToFaultType', () => {
  it('should convert hypothesis to FaultType', () => {
    const h = { category: 'CPU', confidence: 0.9, evidence: ['cpu'], method: 'rule' as const, severity: 'major' as const };
    const ft = hypothesisToFaultType(h);
    expect(ft.category).toBe('CPU');
    expect(ft.severity).toBe('major');
    expect(ft.subType).toBe('');
  });
});

// ── Tests — bestHypothesisToFaultType ─────────────────────

describe('bestHypothesisToFaultType', () => {
  it('should return first hypothesis as FaultType', () => {
    const hypotheses = [
      { category: 'CPU', confidence: 0.9, evidence: ['cpu'], method: 'rule' as const, severity: 'major' as const },
      { category: 'MEM', confidence: 0.5, evidence: ['mem'], method: 'rule' as const, severity: 'minor' as const },
    ];
    const ft = bestHypothesisToFaultType(hypotheses);
    expect(ft.category).toBe('CPU');
  });

  it('should return UNKNOWN for empty array', () => {
    const ft = bestHypothesisToFaultType([]);
    expect(ft.category).toBe('UNKNOWN');
    expect(ft.severity).toBe('info');
  });
});
