import { describe, it, expect } from 'vitest';
import {
  validateTopologyResponse,
  computeRetryDelay,
  buildTopologyPrompt,
  calibrateLLMConfidence,
  DEFAULT_RETRY_CONFIG,
} from '@agentix-e/micro-kinetic-core';

// ── validateTopologyResponse ──────────────────────────────

describe('validateTopologyResponse', () => {
  describe('valid inputs', () => {
    it('should accept a well-formed edge array', () => {
      const result = validateTopologyResponse(
        [
          {
            from: 'frontend',
            to: 'checkoutservice',
            method: 'REST',
            confidence: 0.92,
            reasoning: 'Frontend is the user-facing entry point that routes to checkout for order processing',
          },
        ],
        [],
      );
      expect(result.valid).toBe(true);
      expect(result.graph).toBeDefined();
      expect(result.graph!.edges).toHaveLength(1);
    });

    it('should accept REST method', () => {
      const result = validateTopologyResponse([{ from: 'a', to: 'b', method: 'REST', confidence: 0.8, reasoning: 'Test reasoning for REST edge validation with sufficient length.' }], []);
      expect(result.valid).toBe(true);
    });

    it('should accept gRPC method', () => {
      const result = validateTopologyResponse([{ from: 'a', to: 'b', method: 'gRPC', confidence: 0.8, reasoning: 'Test reasoning for gRPC edge validation with sufficient length.' }], []);
      expect(result.valid).toBe(true);
    });

    it('should accept MQ method', () => {
      const result = validateTopologyResponse([{ from: 'a', to: 'b', method: 'MQ', confidence: 0.8, reasoning: 'Test reasoning for MQ edge validation with sufficient length.' }], []);
      expect(result.valid).toBe(true);
    });

    it('should accept EVENT method', () => {
      const result = validateTopologyResponse([{ from: 'a', to: 'b', method: 'EVENT', confidence: 0.8, reasoning: 'Test reasoning for EVENT edge validation with sufficient length.' }], []);
      expect(result.valid).toBe(true);
    });

    it('should accept INTERNAL method via case normalization', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'internal', confidence: 0.5, reasoning: 'Internal loopback for health check purposes.' }],
        [],
      );
      expect(result.valid).toBe(true);
    });

    it('should auto-create nodes for unknown services', () => {
      const result = validateTopologyResponse(
        [{ from: 'svc_new', to: 'svc_other', method: 'REST', confidence: 0.9, reasoning: 'New service calling other service via REST API.' }],
        [],
      );
      expect(result.graph!.nodes.has('svc_new')).toBe(true);
      expect(result.graph!.nodes.has('svc_other')).toBe(true);
      expect(result.graph!.nodes.get('svc_new')!.namespace).toBe('llm-discovered');
    });

    it('should reuse known service nodes', () => {
      const result = validateTopologyResponse(
        [{ from: 'svc_a', to: 'svc_b', method: 'REST', confidence: 0.8, reasoning: 'svc_a calls svc_b for downstream processing.' }],
        ['svc_a'],
      );
      expect(result.graph!.nodes.get('svc_a')!.namespace).toBe('discovered');
      expect(result.graph!.nodes.get('svc_b')!.namespace).toBe('llm-discovered');
    });

    it('should scale confidence to call rate', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: 0.5, reasoning: 'Medium confidence edge from testing.' }],
        [],
      );
      const edge = result.graph!.edges[0]!;
      expect(edge.callRate).toBeCloseTo(50);
      expect(edge.errorRate).toBeCloseTo(0.05);
    });
  });

  describe('invalid inputs', () => {
    it('should reject non-array input', () => {
      const result = validateTopologyResponse('not an array', []);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('JSON array');
    });

    it('should reject edge with missing from', () => {
      const result = validateTopologyResponse(
        [{ from: '', to: 'b', method: 'REST', confidence: 0.5, reasoning: 'missing from field' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('from');
    });

    it('should reject edge with missing to', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: '', method: 'REST', confidence: 0.5, reasoning: 'missing to field test case' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('to');
    });

    it('should reject self-loop edges', () => {
      const result = validateTopologyResponse(
        [{ from: 'svc_a', to: 'svc_a', method: 'REST', confidence: 0.5, reasoning: 'self loop test case for validation' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('self-loop');
    });

    it('should reject invalid method', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'SOAP', confidence: 0.5, reasoning: 'invalid soap method test' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('method');
    });

    it('should reject confidence > 1', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: 1.5, reasoning: 'overconfident edge test' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('confidence');
    });

    it('should reject confidence < 0', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: -0.5, reasoning: 'negative confidence test' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('confidence');
    });

    it('should reject too-short reasoning', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: 0.5, reasoning: 'short' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('reasoning');
    });

    it('should reject non-numeric confidence', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: 'high', reasoning: 'non-numeric confidence' }],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('confidence');
    });

    it('should reject NaN confidence', () => {
      const result = validateTopologyResponse(
        [{ from: 'a', to: 'b', method: 'REST', confidence: NaN, reasoning: 'nan confidence test edge' }],
        [],
      );
      expect(result.valid).toBe(false);
    });

    it('should handle mixed valid/invalid edges', () => {
      const result = validateTopologyResponse(
        [
          { from: 'a', to: 'b', method: 'REST', confidence: 0.9, reasoning: 'valid edge with proper reasoning' },
          { from: 'c', to: 'd', method: 'INVALID', confidence: 0.5, reasoning: 'invalid method edge test' },
        ],
        [],
      );
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// ── computeRetryDelay ─────────────────────────────────────

describe('computeRetryDelay', () => {
  it('should return base delay for attempt 0', () => {
    const delay = computeRetryDelay(0, DEFAULT_RETRY_CONFIG);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1100);
  });

  it('should double for each attempt', () => {
    const d0 = computeRetryDelay(0, DEFAULT_RETRY_CONFIG);
    const d1 = computeRetryDelay(1, DEFAULT_RETRY_CONFIG);
    const d2 = computeRetryDelay(2, DEFAULT_RETRY_CONFIG);
    expect(d1).toBeGreaterThan(d0);
    expect(d2).toBeGreaterThan(d1);
  });

  it('should cap at maxTotalDelayMs', () => {
    const delay = computeRetryDelay(10, DEFAULT_RETRY_CONFIG);
    expect(delay).toBeLessThanOrEqual(DEFAULT_RETRY_CONFIG.maxTotalDelayMs);
  });

  it('should include jitter', () => {
    const delays = Array.from({ length: 10 }, () => computeRetryDelay(0, DEFAULT_RETRY_CONFIG));
    const allSame = delays.every((d) => d === delays[0]);
    expect(allSame).toBe(false); // Jitter causes variation
  });
});

// ── buildTopologyPrompt ───────────────────────────────────

describe('buildTopologyPrompt', () => {
  it('should include known service IDs', () => {
    const prompt = buildTopologyPrompt(['svc_a', 'svc_b']);
    expect(prompt).toContain('svc_a');
    expect(prompt).toContain('svc_b');
    expect(prompt).toContain('Known Services');
  });

  it('should include metric hints when provided', () => {
    const prompt = buildTopologyPrompt(
      ['svc_a'],
      { svc_a: ['cpu_usage', 'latency_p99'] },
    );
    expect(prompt).toContain('cpu_usage');
    expect(prompt).toContain('latency_p99');
  });

  it('should include JSON schema instructions', () => {
    const prompt = buildTopologyPrompt(['svc_a']);
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('from');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('reasoning');
  });

  it('should include inference rules', () => {
    const prompt = buildTopologyPrompt(['frontend', 'checkoutservice']);
    expect(prompt).toContain('Inference Rules');
    expect(prompt).toContain('frontend');
  });

  it('should handle empty service list', () => {
    const prompt = buildTopologyPrompt([]);
    expect(prompt).toContain('Known Services');
    expect(prompt.length).toBeGreaterThan(100);
  });
});

// ── calibrateLLMConfidence ────────────────────────────────

describe('calibrateLLMConfidence', () => {
  it('should heavily penalize low raw confidence', () => {
    const calibrated = calibrateLLMConfidence(0.3, 200);
    expect(calibrated).toBeLessThan(0.3);
    expect(calibrated).toBeLessThanOrEqual(0.15);
  });

  it('should apply moderate scaling to medium confidence', () => {
    const calibrated = calibrateLLMConfidence(0.7, 200);
    expect(calibrated).toBeGreaterThan(0.3);
    expect(calibrated).toBeLessThan(0.7);
  });

  it('should trust high confidence with long reasoning', () => {
    const calibrated = calibrateLLMConfidence(0.95, 200);
    expect(calibrated).toBeGreaterThan(0.7);
    expect(calibrated).toBeLessThanOrEqual(0.95);
  });

  it('should penalize short reasoning even with high confidence', () => {
    const calibrated = calibrateLLMConfidence(0.95, 30);
    expect(calibrated).toBeLessThan(calibrateLLMConfidence(0.95, 200));
  });

  it('should handle zero-length reasoning', () => {
    const calibrated = calibrateLLMConfidence(0.8, 0);
    expect(calibrated).toBeGreaterThanOrEqual(0);
    expect(calibrated).toBeLessThan(0.1);
  });
});
