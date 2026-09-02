import type { CallEdge, FaultLogEntry, ServiceId } from '@agentix-e/micro-kinetic-core';
import {
  computeDeepestExceptions,
  computeLogNoveltyScores,
  computeLogScores,
  computeRiseScores,
  computeTopoSourceScores,
  computeTraceActivityScores,
  gatedRiseContribution,
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
  deepestExceptionClass?: string,
): FaultLogEntry {
  return { service, level, timestamp, isLogicException, deepestExceptionClass };
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

  it('falls back to weight 0 when propagationWeights is shorter than edges', () => {
    // A caller passing a weight array shorter than the edge list must not crash:
    // the missing weight defaults to 0, so the child is treated as unexplained.
    const edges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const weights = new Float64Array([0.5]); // only one weight for two edges
    const anomaly = new Map<ServiceId, number>([
      ['a', 0.8],
      ['b', 0.6],
      ['c', 0.5],
    ]);

    const scores = computeTopoSourceScores(edges, weights, anomaly);

    // b explained by a: 0.5 × 0.8 = 0.4 → 1 − 0.4 = 0.6.
    expect(scores.get('b')).toBeCloseTo(0.6, 10);
    // c's parent edge (b→c) has no weight → explanation 0 → score 1.
    expect(scores.get('c')).toBe(1);
  });
});

describe('computeRiseScores', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  function dm(head: number[], tail: number[]): { label: string; head: number[]; tail: number[] } {
    return { label: 'workload', head, tail };
  }

  it('scores a rise (tail > head) high and a collapse (tail < head) low', () => {
    const metrics = new Map([
      ['a', dm([0.4, 0.4, 0.4], [1.4, 1.4, 1.4])], // rise 0.4 -> 1.4
      ['b', dm([3.5, 3.6, 3.7], [0.05, 0.05, 0.05])], // collapse 3.6 -> 0.05
    ]);
    const scores = computeRiseScores(metrics, nodes);

    expect(scores.get('a')).toBeCloseTo(1.4 / (0.4 + 1.4), 10); // ~0.778
    expect(scores.get('b')).toBeCloseTo(0.05 / (3.6 + 0.05), 10); // ~0.0137
  });

  it('scores an unchanged metric 0.5 and a missing metric 0.5 (neutral)', () => {
    const metrics = new Map([['a', dm([1.0, 1.0], [1.0, 1.0])]]);
    const scores = computeRiseScores(metrics, nodes);

    expect(scores.get('a')).toBeCloseTo(0.5, 10);
    expect(scores.get('b')).toBe(0.5); // missing -> neutral
    expect(scores.get('c')).toBe(0.5);
  });

  it('returns an empty map for undefined metrics or empty nodeIds', () => {
    expect(computeRiseScores(undefined, nodes).size).toBe(0);
    expect(computeRiseScores(new Map(), new Set()).size).toBe(0);
  });

  it('treats a zero denominator (both means zero) as neutral 0.5', () => {
    const metrics = new Map([['a', dm([0, 0], [0, 0])]]);
    const scores = computeRiseScores(metrics, nodes);
    expect(scores.get('a')).toBe(0.5);
  });
});

describe('gatedRiseContribution', () => {
  it('always rewards a rise, regardless of the log gate', () => {
    expect(gatedRiseContribution(0.75, false)).toBeCloseTo(0.5, 10); // 2*(0.75-0.5)
    expect(gatedRiseContribution(0.75, true)).toBeCloseTo(0.5, 10);
    expect(gatedRiseContribution(1.0, true)).toBeCloseTo(1.0, 10);
  });

  it('penalises a silent collapse (no logic exception) but neutralises a logic-exception collapse', () => {
    expect(gatedRiseContribution(0.25, false)).toBeCloseTo(-0.5, 10); // 2*(0.25-0.5)
    expect(gatedRiseContribution(0.25, true)).toBe(0); // source crash -> neutral
    expect(gatedRiseContribution(0.0, false)).toBeCloseTo(-1.0, 10);
    expect(gatedRiseContribution(0.0, true)).toBe(0);
  });

  it('is neutral at direction 0.5', () => {
    expect(gatedRiseContribution(0.5, false)).toBe(0);
    expect(gatedRiseContribution(0.5, true)).toBe(0);
  });
});

describe('computeDeepestExceptions', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  it('returns the rarest deepest exception class per service', () => {
    const logs = [
      // 'a' emits only MalformedJwtException (df=1, rarest).
      makeLog('a', 'ERROR', 100, true, 'MalformedJwtException'),
      makeLog('a', 'ERROR', 101, true, 'MalformedJwtException'),
      // 'b' and 'c' both emit the ubiquitous HttpServerErrorException (df=2).
      makeLog('b', 'ERROR', 100, true, 'HttpServerErrorException'),
      makeLog('c', 'ERROR', 100, true, 'HttpServerErrorException'),
    ];
    const result = computeDeepestExceptions(logs, nodes, 0);

    expect(result.get('a')).toBe('MalformedJwtException');
    expect(result.get('b')).toBe('HttpServerErrorException');
    expect(result.get('c')).toBe('HttpServerErrorException');
  });

  it('ties on rarity by per-service count, then lexicographic order', () => {
    const logs = [
      makeLog('a', 'ERROR', 100, true, 'ZetaException'),
      makeLog('a', 'ERROR', 101, true, 'ZetaException'),
      makeLog('a', 'ERROR', 102, true, 'AlphaException'), // df=1, count=1 → loses
    ];
    const result = computeDeepestExceptions(logs, nodes, 0);
    expect(result.get('a')).toBe('ZetaException'); // df=1 for both, higher count wins
  });

  it('breaks a full tie (same df and count) lexicographically', () => {
    const logs = [
      makeLog('a', 'ERROR', 100, true, 'BetaException'),
      makeLog('a', 'ERROR', 101, true, 'AlphaException'), // same df=1, count=1
    ];
    const result = computeDeepestExceptions(logs, nodes, 0);
    expect(result.get('a')).toBe('AlphaException'); // lexicographically smaller
  });

  it('counts FATAL lines the same as ERROR lines', () => {
    const logs = [makeLog('a', 'FATAL', 100, true, 'NullPointerException')];
    const result = computeDeepestExceptions(logs, nodes, 0);
    expect(result.get('a')).toBe('NullPointerException');
  });

  it('ignores connectivity errors, non-node services, and pre-inject lines', () => {
    const logs = [
      makeLog('a', 'ERROR', 100, false, 'ConnectionException'), // not logic
      makeLog('a', 'ERROR', 50, true, 'NullPointerException'), // pre-inject
      makeLog('ghost', 'ERROR', 100, true, 'TypeError'), // not in graph
    ];
    const result = computeDeepestExceptions(logs, nodes, 75);
    expect(result.size).toBe(0);
  });

  it('falls back to "Unknown" for logic lines with no deepest class', () => {
    const logs = [makeLog('a', 'ERROR', 100, true, undefined)];
    const result = computeDeepestExceptions(logs, nodes, 0);
    expect(result.get('a')).toBe('Unknown');
  });

  it('returns an empty map for undefined logs or empty nodeIds', () => {
    expect(computeDeepestExceptions(undefined, nodes, 0).size).toBe(0);
    expect(computeDeepestExceptions([], new Set(), 0).size).toBe(0);
  });

  it('ignores non-ERROR/FATAL lines when computing deepest exceptions', () => {
    // Only ERROR/FATAL lines carry a fault signature; WARN/INFO lines must be
    // skipped rather than polluting the rarest-class selection.
    const logs = [
      makeLog('a', 'WARN', 100, true, 'NullPointerException'), // skipped
      makeLog('b', 'ERROR', 100, true, 'TypeError'),
    ];
    const result = computeDeepestExceptions(logs, nodes, 0);

    expect(result.size).toBe(1);
    expect(result.get('a')).toBeUndefined();
    expect(result.get('b')).toBe('TypeError');
  });
});

describe('computeTraceActivityScores', () => {
  const nodes = new Set<ServiceId>(['a', 'b', 'c']);

  function countsOf(
    ...entries: Array<[string, { pre: number; post: number }]>
  ): Map<ServiceId, { pre: number; post: number }> {
    return new Map(entries);
  }

  it('returns an empty map for undefined or empty counts', () => {
    expect(computeTraceActivityScores(undefined, nodes).size).toBe(0);
    expect(computeTraceActivityScores(new Map(), nodes).size).toBe(0);
  });

  it('returns {svc: 1} for exactly one qualifying candidate (pre>=500, post>=1, ratio>=1.15)', () => {
    const counts = countsOf(['a', { pre: 500, post: 575 }]); // ratio 1.15
    const scores = computeTraceActivityScores(counts, nodes);

    expect(scores.get('a')).toBe(1);
    expect(scores.size).toBe(1);
  });

  it('returns an empty map when zero candidates qualify', () => {
    const counts = countsOf(
      ['a', { pre: 100, post: 100 }], // pre < 500
      ['b', { pre: 300, post: 100 }], // ratio < 1.15 and pre < 500
    );
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('returns an empty map when multiple candidates qualify', () => {
    const counts = countsOf(
      ['a', { pre: 500, post: 575 }], // ratio 1.15
      ['b', { pre: 1000, post: 1200 }], // ratio 1.2
    );
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('rejects a service with pre < minPreCount', () => {
    const counts = countsOf(['a', { pre: 499, post: 600 }]); // ratio > 1.15 but pre too low
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('rejects a service with post < minPostCount', () => {
    const counts = countsOf(['a', { pre: 500, post: 0 }]);
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('rejects a service with ratio < riseThreshold', () => {
    const counts = countsOf(['a', { pre: 500, post: 570 }]); // ratio 1.14 < 1.15
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('rejects a service with pre === 0 (division-by-zero guard)', () => {
    const counts = countsOf(['a', { pre: 0, post: 10 }]);
    expect(computeTraceActivityScores(counts, nodes).size).toBe(0);
  });

  it('rejects a zero-pre candidate even when minPreCount is lowered to 0', () => {
    // With minPreCount = 0, the `pre < minPreCount` filter no longer rejects a
    // pre === 0 service, so the explicit `pre <= 0` division-by-zero guard must
    // still drop it (post/pre would otherwise be Infinity).
    const counts = countsOf(['a', { pre: 0, post: 10 }]);
    const scores = computeTraceActivityScores(counts, nodes, { minPreCount: 0 });

    expect(scores.size).toBe(0);
  });

  it('rejects a service not in counts (not a member)', () => {
    const counts = countsOf(['a', { pre: 500, post: 575 }]);
    const scores = computeTraceActivityScores(counts, new Set<ServiceId>(['ghost']));
    expect(scores.size).toBe(0);
  });

  it('honours custom options overriding the defaults', () => {
    // Default riseThreshold 1.15 rejects ratio 1.0; a custom threshold accepts it.
    const counts = countsOf(['a', { pre: 2, post: 2 }]); // ratio 1.0, pre < 500
    const scores = computeTraceActivityScores(counts, nodes, {
      minPreCount: 1,
      minPostCount: 1,
      riseThreshold: 1.0,
    });

    expect(scores.get('a')).toBe(1);
    expect(scores.size).toBe(1);
  });

  it('votes for the unique riser when no logic-exception evidence (silent source)', () => {
    // A silent-source fault leaves no exception behind, so the trace-activity
    // signal is the ONLY lever and may vote for the unique significant riser.
    const counts = countsOf(['a', { pre: 500, post: 575 }]); // ratio 1.15
    const scores = computeTraceActivityScores(counts, nodes, undefined, false);

    expect(scores.get('a')).toBe(1);
    expect(scores.size).toBe(1);
  });

  it('suppresses the vote when logic-exception evidence is present (non-silent case)', () => {
    // When a logic exception exists anywhere in the graph, the case is NOT a
    // silent-source fault: the log signal already has discriminative evidence,
    // and the unique-riser heuristic misfires onto the wrong service for
    // exception-type resource faults (OB RE3 f4, RE2 TT mem). The signal must
    // defer to the log signal and stay neutral — even with a unique riser.
    const counts = countsOf(['a', { pre: 500, post: 575 }]); // unique riser
    const scores = computeTraceActivityScores(counts, nodes, undefined, true);

    expect(scores.size).toBe(0);
  });

  it('defaults the evidence gate to false (backward-compatible behaviour)', () => {
    // Callers that omit the gate keep the original silent-source vote, so
    // existing behaviour is unchanged unless the caller opts into suppression.
    const counts = countsOf(['a', { pre: 500, post: 575 }]);
    const scores = computeTraceActivityScores(counts, nodes);

    expect(scores.get('a')).toBe(1);
    expect(scores.size).toBe(1);
  });
});
