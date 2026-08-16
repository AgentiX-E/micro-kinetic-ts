import type { CallEdge, FaultLogEntry, ServiceId } from '@agentix-e/micro-kinetic-core';
import { computeLogScores, computeTopoSourceScores } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

function makeLog(
  service: string,
  level: string,
  timestamp = 0,
  isStackTrace = true,
): FaultLogEntry {
  return { service, level, timestamp, isStackTrace };
}

describe('computeLogScores', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  it('counts only ERROR/FATAL lines and max-normalises across services', () => {
    const logs = [
      makeLog('a', 'ERROR'),
      makeLog('a', 'ERROR'),
      makeLog('a', 'FATAL'),
      makeLog('b', 'ERROR'),
      makeLog('b', 'INFO'), // ignored
      makeLog('c', 'DEBUG'), // ignored
    ];
    const scores = computeLogScores(logs, nodes, 0);

    // a has 3 errors (max → 1), b has 1 (→ 1/3), c has 0 (→ 0).
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeCloseTo(1 / 3, 10);
    expect(scores.get('c')).toBe(0);
  });

  it('ignores log lines for services absent from the call graph', () => {
    const logs = [
      makeLog('a', 'ERROR'),
      makeLog('a', 'ERROR'),
      makeLog('ghost', 'ERROR'), // not in nodeIds — must be ignored
      makeLog('b', 'ERROR'),
    ];
    const scores = computeLogScores(logs, nodes, 0);

    expect(scores.get('ghost')).toBeUndefined();
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeCloseTo(0.5, 10);
  });

  it('filters out ERROR/FATAL lines emitted BEFORE the injection time', () => {
    const logs = [
      makeLog('a', 'ERROR', 100), // before injection — filtered
      makeLog('a', 'ERROR', 300), // after
      makeLog('b', 'ERROR', 200), // after
    ];
    const scores = computeLogScores(logs, nodes, 200);

    // Without the filter a would lead (2 vs 1). With it, a and b tie at 1.
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(1);
    expect(scores.get('c')).toBe(0);
  });

  it('scores a lone erroring service 1 against its silent peers', () => {
    // The code-level-fault signature: only the faulting service emits errors.
    const logs = [makeLog('a', 'ERROR'), makeLog('a', 'ERROR')];
    const scores = computeLogScores(logs, nodes, 0);

    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
    expect(scores.get('c')).toBe(0);
  });

  it('returns an empty map for absent or empty logs', () => {
    expect(computeLogScores(undefined, nodes, 0).size).toBe(0);
    expect(computeLogScores([], nodes, 0).size).toBe(0);
  });

  it('returns an empty map when no ERROR/FATAL line survives filtering', () => {
    // Only INFO/DEBUG and pre-injection lines → no signal.
    const logs = [
      makeLog('a', 'INFO'),
      makeLog('b', 'ERROR', 100), // before injection
    ];
    expect(computeLogScores(logs, nodes, 200).size).toBe(0);
  });

  it('returns an empty map when errors carry no stack-trace evidence', () => {
    // A resource/network cascade (e.g. RE2) floods ERROR lines without any
    // stack trace. The signal must stay neutral so max-count does not boost
    // the symptom service instead of the source.
    const logs = [
      makeLog('a', 'ERROR', 0, false),
      makeLog('a', 'ERROR', 0, false),
      makeLog('b', 'ERROR', 0, false),
    ];
    expect(computeLogScores(logs, nodes, 0).size).toBe(0);
  });

  it('fires when at least one error carries a stack-trace signature', () => {
    // A single stack trace (code-level fault) among the errors is enough to
    // un-gate the signal; the volume then points at the source.
    const logs = [
      makeLog('a', 'ERROR', 0, false), // cascade noise
      makeLog('a', 'ERROR', 0, true), // stack trace — code-level evidence
      makeLog('b', 'ERROR', 0, false),
    ];
    const scores = computeLogScores(logs, nodes, 0);

    // a has 2 errors (max → 1), b has 1 (→ 0.5).
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBeCloseTo(0.5, 10);
  });
});

describe('computeTopoSourceScores', () => {
  it('scores a source (no parent) as 1 and a child as 1 − parent explanation', () => {
    // Chain a → b: b's anomaly is explained by a, a has no parent.
    const edges = [makeEdge('a', 'b')];
    const weights = new Float64Array([0.5]);
    const anomaly = new Map<ServiceId, number>([
      ['a', 0.8],
      ['b', 0.6],
    ]);

    const scores = computeTopoSourceScores(edges, weights, anomaly);

    expect(scores.get('a')).toBe(1);
    // explanation = weight(a→b) × anomaly(a) = 0.5 × 0.8 = 0.4 → 1 − 0.4 = 0.6.
    expect(scores.get('b')).toBeCloseTo(0.6, 10);
  });

  it('takes the MAX parent explanation when a node has multiple parents', () => {
    const edges = [makeEdge('a', 'c'), makeEdge('b', 'c')];
    const weights = new Float64Array([0.3, 0.9]);
    const anomaly = new Map<ServiceId, number>([
      ['a', 0.5],
      ['b', 0.5],
      ['c', 0.7],
    ]);

    const scores = computeTopoSourceScores(edges, weights, anomaly);

    // explanation from a = 0.3×0.5 = 0.15, from b = 0.9×0.5 = 0.45 → max 0.45.
    expect(scores.get('c')).toBeCloseTo(1 - 0.45, 10);
    // a and b have no parents → 1.
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(1);
  });

  it('clamps the explanation to [0, 1] so a fully-explained child scores 0', () => {
    const edges = [makeEdge('a', 'b')];
    const weights = new Float64Array([1.0]);
    const anomaly = new Map<ServiceId, number>([
      ['a', 1.0],
      ['b', 1.0],
    ]);

    const scores = computeTopoSourceScores(edges, weights, anomaly);

    expect(scores.get('b')).toBe(0);
  });

  it('handles a node with no edges (isolated) as a source score of 1', () => {
    const scores = computeTopoSourceScores([], new Float64Array(0), new Map([['x', 0.9]]));
    expect(scores.get('x')).toBe(1);
  });
});
