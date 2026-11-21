/**
 * Unit tests for the trace rule's candidate vector.
 *
 * `riserVectorOf` answers one question about one service: what evidence existed beside the rise itself? It exists
 * because the rule's five wrong votes on TrainTicket RE3 are not rank-structured — the rank histogram reads
 * `atMax=2/2, rank2-3=0/0, rank4-10=3/0, rank11+=15/13` — so the separator between a riser that is a SOURCE and
 * one that is a VICTIM has to be a property of the candidate, not of where the ranking put it.
 *
 * Every case below pins one distinction the vector must keep rather than one value it must produce, because the
 * distinctions are what the census reads:
 *
 * - "no span measurement at all" is absent, while "the service emitted no spans" is two measured zeros;
 * - a ratio whose denominator is zero is UNDEFINED, not zero — `growth = 0` reads as "flat", which is a
 *   different claim from "nothing to divide";
 * - a failed-edge array that is absent says nothing, while an array with no row for the service says zero.
 *
 * @module __tests__/unit/runners/riser-vector
 */

import { describe, expect, it } from 'vitest';

import { riserVectorOf } from '../../../src/benchmarks/runners/riser-vector.js';

describe('riserVectorOf', () => {
  it('reports nothing when the case carries no span counts — the trace file was never read', () => {
    expect(riserVectorOf('ts-auth-service', {})).toBeUndefined();
    expect(riserVectorOf('ts-auth-service', { traceActivity: new Map() })).toBeUndefined();
  });

  it('reports the rise as counts and as a ratio', () => {
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 1770, post: 2480 }]]),
    });

    expect(vector).toEqual({
      service: 'ts-auth-service',
      pre: 1770,
      post: 2480,
      // 2480 / 1770, the quantity the rule's `riseThreshold` is compared against.
      growth: 2480 / 1770,
    });
  });

  it('reads a service missing from a non-empty count map as two measured ZEROS, not as unmeasured', () => {
    // The file was read and every span was counted, so a service with no row emitted no spans. Reporting this as
    // absent would make the census unable to say "the truth was silent" — which on the blocking cell is the
    // finding, not the noise.
    const vector = riserVectorOf('ts-unknown', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
    });

    expect(vector).toEqual({ service: 'ts-unknown', pre: 0, post: 0 });
  });

  it('leaves the ratio UNDEFINED when the pre-injection count is zero', () => {
    // A ratio with a zero denominator does not exist. Filling in 0 would read as "did not rise", and 1 as "flat";
    // both are claims about a measurement nobody took.
    const vector = riserVectorOf('ts-late', {
      traceActivity: new Map([['ts-late', { pre: 0, post: 40 }]]),
    });

    expect(vector).toEqual({ service: 'ts-late', pre: 0, post: 40 });
    expect(vector).not.toHaveProperty('growth');
  });

  it('reports nothing about failures when the case carries no failed-edge array', () => {
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
    });

    expect(vector).not.toHaveProperty('failedIn');
    expect(vector).not.toHaveProperty('failedOut');
  });

  it('reports zero failures for a service the array does not name, once the array exists', () => {
    // The loader emits a row for every edge with a post-injection failure, so an array that names other
    // services is a measurement of zero for this one. Absent the array, the same silence means nothing.
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
      failedTraceEdges: [{ caller: 'ts-ui', callee: 'ts-route', failed: 9, baseline: 0 }],
    });

    expect(vector?.failedIn).toBe(0);
    expect(vector?.failedOut).toBe(0);
  });

  it('charges failures to the CALLEE as `failedIn` and to the CALLER as `failedOut`', () => {
    // The direction is the whole point of the array: a broken service is what its callers log errors ABOUT, so
    // the failures a service RECEIVES name it, and the failures it reports name its callee.
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
      failedTraceEdges: [
        { caller: 'ts-ui', callee: 'ts-auth-service', failed: 12, baseline: 0 },
        { caller: 'ts-route', callee: 'ts-auth-service', failed: 5, baseline: 2 },
        { caller: 'ts-auth-service', callee: 'ts-train', failed: 7, baseline: 0 },
      ],
    });

    // Inbound: 12 − 0 and 5 − 2. Outbound: 7 − 0.
    expect(vector?.failedIn).toBe(15);
    expect(vector?.failedOut).toBe(7);
  });

  it('subtracts the baseline, so a dependency that was already broken is not this fault signature', () => {
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
      failedTraceEdges: [{ caller: 'ts-ui', callee: 'ts-auth-service', failed: 4, baseline: 4 }],
    });

    expect(vector?.failedIn).toBe(0);
  });

  it('clamps at zero, because a broken edge that recovered is not evidence against its callee', () => {
    // The kernel inserts both rows — `failed` is post-injection and `baseline` pre-injection — and a negative
    // difference would otherwise enter the sum as a PENALTY inside a quantity documented as a count of failures.
    expect(
      riserVectorOf('ts-auth-service', {
        traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
        failedTraceEdges: [{ caller: 'ts-ui', callee: 'ts-auth-service', failed: 1, baseline: 6 }],
      })?.failedIn,
    ).toBe(0);
  });

  it('counts a self-edge on both sides, because both statements about it are true', () => {
    // `caller === callee` is kept by the loader and filtered only where a direction is required
    // (`computeEdgeLatencyScores`). A service failing on itself is its own inbound and its own outbound failure,
    // and dropping one side here would make the vector depend on which way the edge was written.
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
      failedTraceEdges: [
        { caller: 'ts-auth-service', callee: 'ts-auth-service', failed: 3, baseline: 0 },
      ],
    });

    expect(vector?.failedIn).toBe(3);
    expect(vector?.failedOut).toBe(3);
  });

  it('ignores edges that touch neither side of the candidate', () => {
    const vector = riserVectorOf('ts-auth-service', {
      traceActivity: new Map([['ts-auth-service', { pre: 10, post: 20 }]]),
      failedTraceEdges: [{ caller: 'ts-ui', callee: 'ts-train', failed: 40, baseline: 0 }],
    });

    expect(vector?.failedIn).toBe(0);
    expect(vector?.failedOut).toBe(0);
  });
});
