/**
 * Unit tests for the ReAct investigator's pure core (GALA+ phase-III).
 *
 * Covers the system prompt, the JSON response parser (Action/Answer/invalid),
 * and the action executor over a mock toolkit. No network.
 *
 * @module ai/__tests__/unit/agent-core
 */

import { describe, expect, it } from 'vitest';
import {
  buildSystemPrompt,
  executeAction,
  parseAgentResponse,
} from '../../src/agent/agent-core.js';
import type { InvestigatorToolkit } from '../../src/agent/investigator-toolkit.js';

// ── Helpers ───────────────────────────────────────────────

function mockToolkit(): InvestigatorToolkit {
  return {
    maxHops: 6,
    getCandidates: () => [{ serviceId: 'sym', anomalyScore: 1.0 }],
    getEvidence: (id) => (id === 'sym' ? { serviceId: id, dominantMetric: 'cpu' } : null),
    getUpstream: (id) => (id === 'sym' ? ['src'] : []),
    getDownstream: () => [],
    remainingHops: () => 6,
    consumeHop: () => true,
  };
}

// ── buildSystemPrompt ─────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('lists the tools and the fault model and the JSON contract', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('get_evidence');
    expect(p).toContain('get_upstream');
    expect(p).toContain('get_downstream');
    expect(p).toContain('MalformedJwtException');
    expect(p).toContain('"action"');
    expect(p).toContain('"answer"');
  });

  it('teaches the token/JWT semantic chain to the auth producer', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('MALFORMED TOKEN');
    expect(p).toContain('AUTHENTICATION service');
    expect(p).toContain('JsonMappingException');
    expect(p).toContain('conclude the upstream producer');
  });

  it('warns against the anomaly-magnitude prior and trusts the fault role', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('LARGEST anomaly is usually the SYMPTOM');
    expect(p).toContain('highest-anomaly service');
    expect(p).toContain('faultRole');
    expect(p).toContain('silent-source-candidate');
  });
});

// ── parseAgentResponse ────────────────────────────────────

describe('parseAgentResponse', () => {
  it('parses a clean action', () => {
    const step = parseAgentResponse('{"action": "get_upstream", "serviceId": "sym"}');
    expect(step).toEqual({ kind: 'action', action: { tool: 'get_upstream', serviceId: 'sym' } });
  });

  it('normalises camelCase and spaced tool names', () => {
    expect(parseAgentResponse('{"action": "getUpstream", "serviceId": "x"}')).toEqual({
      kind: 'action',
      action: { tool: 'get_upstream', serviceId: 'x' },
    });
    expect(parseAgentResponse('{"action": "get evidence", "serviceId": "x"}')).toEqual({
      kind: 'action',
      action: { tool: 'get_evidence', serviceId: 'x' },
    });
    expect(parseAgentResponse('{"action": "getDownstream", "serviceId": "x"}')).toEqual({
      kind: 'action',
      action: { tool: 'get_downstream', serviceId: 'x' },
    });
  });

  it('rejects an unknown tool and an empty service id', () => {
    expect(parseAgentResponse('{"action": "delete_service", "serviceId": "x"}')).toEqual({
      kind: 'invalid',
    });
    expect(parseAgentResponse('{"action": "get_evidence", "serviceId": ""}')).toEqual({
      kind: 'invalid',
    });
  });

  it('parses an answer and clamps confidence to [0, 1]', () => {
    const step = parseAgentResponse(
      '{"answer": {"rootCause": "src", "confidence": 0.8, "reasoning": "bad token"}}',
    );
    expect(step).toEqual({
      kind: 'answer',
      answer: { rootCause: 'src', confidence: 0.8, reasoning: 'bad token' },
    });
    expect(
      parseAgentResponse('{"answer": {"rootCause": "src", "confidence": 1.7, "reasoning": "r"}}'),
    ).toMatchObject({ kind: 'answer', answer: { confidence: 1 } });
    expect(
      parseAgentResponse('{"answer": {"rootCause": "src", "confidence": -0.2, "reasoning": "r"}}'),
    ).toMatchObject({ kind: 'answer', answer: { confidence: 0 } });
  });

  it('defaults a missing confidence to 0', () => {
    const step = parseAgentResponse('{"answer": {"rootCause": "src", "reasoning": "r"}}');
    expect(step).toMatchObject({ kind: 'answer', answer: { rootCause: 'src', confidence: 0 } });
  });

  it('rejects an answer missing the root cause or reasoning', () => {
    expect(parseAgentResponse('{"answer": {"confidence": 0.5, "reasoning": "r"}}')).toEqual({
      kind: 'invalid',
    });
    expect(parseAgentResponse('{"answer": {"rootCause": "src"}}')).toEqual({ kind: 'invalid' });
  });

  it('extracts a JSON object from a code fence or prose preamble', () => {
    expect(
      parseAgentResponse('```json\n{"action": "get_evidence", "serviceId": "a"}\n```'),
    ).toEqual({ kind: 'action', action: { tool: 'get_evidence', serviceId: 'a' } });
    expect(
      parseAgentResponse('I will inspect: {"action": "get_evidence", "serviceId": "a"} done.'),
    ).toEqual({ kind: 'action', action: { tool: 'get_evidence', serviceId: 'a' } });
  });

  it('returns invalid for empty, garbage, or non-object JSON', () => {
    expect(parseAgentResponse('')).toEqual({ kind: 'invalid' });
    expect(parseAgentResponse('not json at all')).toEqual({ kind: 'invalid' });
    expect(parseAgentResponse('[1,2,3]')).toEqual({ kind: 'invalid' });
    expect(parseAgentResponse('{"answer": 42}')).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for an unclosed brace or a balanced-but-invalid object', () => {
    expect(parseAgentResponse('{"action": "get_evidence"')).toEqual({ kind: 'invalid' });
    expect(parseAgentResponse('{action: get_evidence}')).toEqual({ kind: 'invalid' });
  });

  it('skips escaped characters inside a JSON string during the scan', () => {
    // A prose preamble forces the balanced-object scan, which must not treat an
    // escaped quote/backslash inside the reasoning string as the object's end.
    const step = parseAgentResponse(
      'note: {"answer": {"rootCause": "src", "reasoning": "a \\"quoted\\" b", "confidence": 0.5}}',
    );
    expect(step).toMatchObject({ kind: 'answer', answer: { rootCause: 'src' } });
  });
});

// ── executeAction ─────────────────────────────────────────

describe('executeAction', () => {
  it('executes each tool and returns the observation as JSON', () => {
    const tk = mockToolkit();
    expect(executeAction({ tool: 'get_upstream', serviceId: 'sym' }, tk)).toBe('["src"]');
    expect(executeAction({ tool: 'get_downstream', serviceId: 'sym' }, tk)).toBe('[]');
    expect(executeAction({ tool: 'get_evidence', serviceId: 'sym' }, tk)).toContain(
      '"dominantMetric":"cpu"',
    );
  });

  it('serialises a null evidence lookup as "null"', () => {
    const tk = mockToolkit();
    expect(executeAction({ tool: 'get_evidence', serviceId: 'ghost' }, tk)).toBe('null');
  });
});
