/**
 * The three latency views, held to the ONE thing they decide that is not the `lat` term: whether the
 * failed-edge DIRECTION term can act at all.
 *
 * ## The claim this file makes executable
 *
 * `docs/fse26-discriminator-verdict.md` §24 states two things about the golden corpus, and both are load-bearing
 * enough that leaving them as prose has already cost a wrong inference once:
 *
 * 1. The `shipped` view — the composition the nine published cells ranked with — **cannot produce a single
 *    `edgeLatency` row**, because it scales an already-millisecond start time by 1000 a second time, so every span
 *    lands after the anchor and no edge has a pre-injection mean. `toEngineDirectionalInputs` emits a row only when
 *    BOTH sides exist.
 * 2. Therefore the direction gate's SECOND half has no value on every published cell, so a weight above zero there
 *    is a no-op — and an unchanged nine-cell reading from that configuration is a statement about the CODE being
 *    neutral, never about the TERM being safe.
 *
 * Statement 1 is asserted here on the assembler's own output, and statement 2 by feeding that output to the
 * ENGINE's predicate. No fixture on disk and no mock: `deriveLatencyViews` is the function `assembleRCAEvalCase`
 * calls, and `admitsFailedEdgeTerm` is the function `analyze()` calls.
 *
 * @module benchmarks/__tests__/latency-views
 */

import {
  admitsFailedEdgeTerm,
  FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

import type { BenchmarkTraceSpan } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { deriveLatencyViews } from '../src/rcaeval-corpus.js';

const DURATION = 'http.server.request.duration';

/** One span of a two-service call, in the units `BenchmarkTraceSpan` declares: Unix MILLISECONDS. */
function span(
  spanId: string,
  parentSpanId: string,
  service: string,
  startTime: number,
  duration: number,
): BenchmarkTraceSpan {
  return {
    traceId: 't1',
    spanId,
    parentSpanId,
    service,
    operationName: 'op',
    startTime,
    duration,
    status: 'OK',
  };
}

/** An anchor, and a call that straddles it: 10 ms before, 3000 ms after. The rise is 300. */
const ANCHOR = 1_700_000_000_000;
const STRADDLING: readonly BenchmarkTraceSpan[] = [
  span('p1', '', 'caller', ANCHOR - 600, 5),
  span('c1', 'p1', 'callee', ANCHOR - 500, 10),
  span('p2', '', 'caller', ANCHOR + 500, 5),
  span('c2', 'p2', 'callee', ANCHOR + 600, 3000),
];

describe('deriveLatencyViews — the shipped view cannot produce a row', () => {
  it('emits NOTHING for the shipped view even though the spans straddle the anchor', () => {
    // The defect, as behaviour rather than as a comment: the same span list that yields a row under `capped`
    // yields none under `shipped`, and the difference is the start-time unit alone. If someone repairs the
    // published composition, this test goes red — which is exactly what the record requires, because that repair
    // moves a published number and has to be measured rather than slipped in.
    const { views } = deriveLatencyViews(STRADDLING, ANCHOR, []);
    expect(views.shipped).toEqual([]);
    expect(views.capped).toHaveLength(1);
  });

  it('emits the row the repaired unit earns, with both means', () => {
    const { views } = deriveLatencyViews(STRADDLING, ANCHOR, []);
    expect(views.capped[0]).toEqual({
      caller: 'caller',
      callee: 'callee',
      preMeanMs: 10,
      postMeanMs: 3000,
    });
  });

  it('passes the whole-file derivation through untouched, because it is the caller’s', () => {
    const wholeFile = [{ caller: 'caller', callee: 'callee', preMeanMs: 10, postMeanMs: 3000 }];
    const { views } = deriveLatencyViews(STRADDLING, ANCHOR, wholeFile);
    expect(views['whole-file']).toEqual(wholeFile);
  });

  it('counts the cap’s sides, so a view that is empty has a stated reason', () => {
    const { capSides } = deriveLatencyViews(STRADDLING, ANCHOR, []);
    // Two spans on each side of the anchor, in the same list that yields no SHIPPED row: the cap is not what
    // empties that view — the unit is. A reader who met the empty array alone would blame the truncation, which
    // is the explanation `latency-routes` exists to separate from this one.
    expect(capSides).toEqual({ spans: 4, pre: 2, post: 2 });
  });
});

describe('the direction gate’s verdict, per corpus view', () => {
  it('CANNOT fire on the shipped view — the gate’s second half has no value', () => {
    // The link the record needs: the assembler's output handed to the ENGINE's own predicate.
    const { views } = deriveLatencyViews(STRADDLING, ANCHOR, []);
    const rise = views.shipped.find((row) => row.callee === 'callee')?.postMeanMs;
    expect(rise).toBeUndefined();
    expect(admitsFailedEdgeTerm(DURATION, undefined)).toBe(false);
    expect(admitsFailedEdgeTerm(DURATION, rise)).toBe(false);
  });

  it('CAN fire on the capped view, because the rise clears the measured floor', () => {
    const { views } = deriveLatencyViews(STRADDLING, ANCHOR, []);
    const row = views.capped.find((one) => one.callee === 'callee');
    expect(row).toBeDefined();
    const rise = row!.postMeanMs / row!.preMeanMs;
    expect(rise).toBeGreaterThanOrEqual(FAILED_EDGE_RANK_ONE_LAT_RISE_FLOOR);
    expect(admitsFailedEdgeTerm(DURATION, rise)).toBe(true);
    // …and the metric half still has to hold: the same enormous rise on a resource series is refused.
    expect(admitsFailedEdgeTerm('container_cpu_usage_seconds_total', rise)).toBe(false);
  });
});
