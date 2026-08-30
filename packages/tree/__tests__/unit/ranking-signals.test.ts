import type { CallEdge, FaultLogEntry, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  computeLogNoveltyScores,
  computeLogScores,
  computeTopoSourceScores,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 };
}

function makeLog(
  service: string,
  level: string,
  timestamp = 0,
  isLogicException = true,
): FaultLogEntry {
  return { service, level, timestamp, isLogicException };
}

describe('computeLogScores', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  it('counts only ERROR/FATAL logic-exception lines and max-normalises', () => {
    const logs = [
      makeLog('a', 'ERROR'),
      makeLog('a', 'ERROR'),
      makeLog('a', 'FATAL'),
      makeLog('b', 'ERROR'),
      makeLog('b', 'INFO'), // ignored
      makeLog('c', 'DEBUG'), // ignored
    ];
    const scores = computeLogScores(logs, nodes, 0);

    // a has 3 logic errors (max → 1), b has 1 (→ 1/3), c has 0 (→ 0).
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

  it('filters out logic-exception lines emitted BEFORE the injection time', () => {
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

  it('returns an empty map when errors are connectivity, not logic', () => {
    // A resource/network cascade (RE2) floods ERROR lines with CONNECTIVITY
    // exceptions (isLogicException=false). The signal must stay neutral so
    // max-count does not boost the symptom service instead of the source.
    const logs = [
      makeLog('a', 'ERROR', 0, false),
      makeLog('a', 'ERROR', 0, false),
      makeLog('b', 'ERROR', 0, false),
    ];
    expect(computeLogScores(logs, nodes, 0).size).toBe(0);
  });

  it('counts only logic exceptions, ignoring connectivity cascade noise', () => {
    // A code-level fault's SOURCE (a) floods logic exceptions while a SYMPTOM
    // (b) floods connectivity exceptions. Only a's logic errors count, so a
    // scores 1 and b (connectivity-only) is excluded entirely.
    const logs = [
      makeLog('a', 'ERROR', 0, true), // logic — source
      makeLog('a', 'ERROR', 0, true), // logic — source
      makeLog('b', 'ERROR', 0, false), // connectivity — symptom noise
      makeLog('b', 'ERROR', 0, false),
      makeLog('b', 'ERROR', 0, false),
    ];
    const scores = computeLogScores(logs, nodes, 0);

    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
    expect(scores.get('c')).toBe(0);
  });
});

describe('computeLogNoveltyScores', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  function noveltyLog(
    service: string,
    deepestClass: string,
    count: number,
    isLogicException = true,
  ): FaultLogEntry[] {
    return Array.from({ length: count }, () => ({
      service,
      level: 'ERROR',
      timestamp: 0,
      isLogicException,
      deepestExceptionClass: deepestClass,
    }));
  }

  it('a rare (df=1) root cause out-ranks a common (df=2) one at equal volume', () => {
    // 'a' emits a unique exception (NullPointerException, df=1); 'b' and 'c'
    // both emit IllegalArgumentException (df=2). In count mode all three tie at
    // 1; novelty mode weights the rare class higher.
    const logs = [
      ...noveltyLog('a', 'NullPointerException', 1),
      ...noveltyLog('b', 'IllegalArgumentException', 1),
      ...noveltyLog('c', 'IllegalArgumentException', 1),
    ];
    const scores = computeLogNoveltyScores(logs, nodes, 0);

    expect(scores.get('a')).toBeCloseTo(1, 10);
    expect(scores.get('b')).toBeLessThan(1);
    expect(scores.get('c')).toBeLessThan(1);
    // b and c share the same class → identical (lower) score.
    expect(scores.get('b')).toBeCloseTo(scores.get('c')!, 10);
  });

  it('the source (rare logic) beats symptoms sharing a non-logic wrapper', () => {
    // Source 'a' emits a rare logic exception; symptoms 'b'/'c' flood the
    // HttpServerErrorException wrapper (isLogicException=false). Only 'a'
    // passes the logic gate, so it scores 1 and the symptoms 0.
    const logs = [
      ...noveltyLog('a', 'IllegalArgumentException', 2, true),
      ...noveltyLog('b', 'HttpServerErrorException', 5, false),
      ...noveltyLog('c', 'HttpServerErrorException', 5, false),
    ];
    const scores = computeLogNoveltyScores(logs, nodes, 0);

    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
    expect(scores.get('c')).toBe(0);
  });

  it('stays neutral on a pure connectivity cascade (RE2 safety)', () => {
    const logs = [
      ...noveltyLog('a', 'ConnectException', 3, false),
      ...noveltyLog('b', 'SocketTimeoutException', 3, false),
      {
        service: 'c',
        level: 'INFO',
        timestamp: 0,
        isLogicException: true,
        deepestExceptionClass: 'NullPointerException',
      }, // non-error level — skipped
    ];
    expect(computeLogNoveltyScores(logs, nodes, 0).size).toBe(0);
  });

  it('filters by membership and injection time like count mode', () => {
    const logs = [
      {
        service: 'a',
        level: 'ERROR',
        timestamp: 300,
        isLogicException: true,
        deepestExceptionClass: 'NullPointerException',
      }, // post-inject
      {
        service: 'ghost',
        level: 'ERROR',
        timestamp: 300,
        isLogicException: true,
        deepestExceptionClass: 'NullPointerException',
      }, // not in graph
      {
        service: 'b',
        level: 'ERROR',
        timestamp: 100,
        isLogicException: true,
        deepestExceptionClass: 'NullPointerException',
      }, // pre-inject
    ];
    const scores = computeLogNoveltyScores(logs, nodes, 200);

    expect(scores.get('ghost')).toBeUndefined();
    expect(scores.get('a')).toBe(1);
    expect(scores.get('b')).toBe(0);
  });

  it('falls back to a shared "Unknown" class when deepestExceptionClass is absent', () => {
    // Two services emit logic exceptions with no deepest class → both share
    // the "Unknown" class (df=2), so they tie at 1 after max-normalisation.
    const logs = [
      { service: 'a', level: 'ERROR', timestamp: 0, isLogicException: true },
      { service: 'b', level: 'ERROR', timestamp: 0, isLogicException: true },
    ];
    const scores = computeLogNoveltyScores(logs, nodes, 0);

    expect(scores.get('a')).toBeCloseTo(1, 10);
    expect(scores.get('b')).toBeCloseTo(1, 10);
    expect(scores.get('c')).toBe(0);
  });

  it('counts FATAL lines identically to ERROR lines', () => {
    const logs = [
      {
        service: 'a',
        level: 'FATAL',
        timestamp: 0,
        isLogicException: true,
        deepestExceptionClass: 'NullPointerException',
      },
    ];
    const scores = computeLogNoveltyScores(logs, nodes, 0);
    expect(scores.get('a')).toBe(1);
  });

  it('returns an empty map for absent or empty logs', () => {
    expect(computeLogNoveltyScores(undefined, nodes, 0).size).toBe(0);
    expect(computeLogNoveltyScores([], nodes, 0).size).toBe(0);
  });

  it('computeLogScores dispatches to novelty mode', () => {
    const logs = [
      ...noveltyLog('a', 'NullPointerException', 1),
      ...noveltyLog('b', 'IllegalArgumentException', 1),
      ...noveltyLog('c', 'IllegalArgumentException', 1),
    ];
    const viaDispatch = computeLogScores(logs, nodes, 0, 'novelty');
    const direct = computeLogNoveltyScores(logs, nodes, 0);

    expect(viaDispatch).toEqual(direct);
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
