/**
 * The trace-share census.
 *
 * The axis this census measures is `growth / drift` — a candidate's rise in units of the fleet's own common-mode
 * move. Two properties are under test and they fail differently:
 *
 * - the ARITHMETIC must be a share and not a second ratio: a candidate that rises exactly as much as its fleet
 *   has not changed its share, and one that holds its count while the fleet collapses has changed it enormously;
 * - the ACCOUNTING must keep `withdrawn` and `surrendered` separate, because a floor that withdraws a wrong vote
 *   and a floor that withdraws a right one differ in nothing but that pair — the decision is their difference and
 *   a census that merged them could not state it.
 *
 * The third property is the one every census in this directory shares: a vote whose share cannot be MEASURED is
 * reported as unmeasured rather than as a zero, because "the evidence is absent" and "the evidence says no" are
 * the same number and different findings.
 *
 * @module __tests__/trace-share-census
 */

import { describe, expect, it } from 'vitest';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  TRACE_SHARE_FLOORS,
  accumulateTraceShare,
  createTraceShareCensus,
  formatTraceShareCensusLine,
  shareOf,
} from '../src/trace-share-census.js';

/**
 * A case whose trace rule voted for `vote`, with a fleet drift of `drift`.
 *
 * The vote's `growth` is what the rule read; the drift is what it did not. `truth` defaults to the vote, i.e. a
 * hit, because that is the side a floor can cost.
 */
const prediction = (
  growth: number,
  drift: number,
  over: Partial<CasePrediction> = {},
): CasePrediction => ({
  caseId: 'c1',
  truth: 'ts-src',
  top1: 'ts-src',
  correct: true,
  traceVote: 'ts-src',
  traceRiser: {
    vote: { service: 'ts-src', pre: 1800, post: Math.round(1800 * growth), growth },
    truth: { service: 'ts-src', pre: 1800, post: Math.round(1800 * growth), growth },
  },
  traceSignificance: { drift, ranked: [] },
  ...over,
});

describe('the share axis', () => {
  it('divides the rise by the fleet drift rather than re-reading the rise', () => {
    // The same 1.5x rise means two different things: on a fleet that collapsed to 8% it is a 19x share gain, on a
    // fleet that moved 1% it is a 1.5x share gain. One number in, two different statements out.
    expect(shareOf({ growth: 1.52, drift: 0.08 })).toBeCloseTo(19, 10);
    expect(shareOf({ growth: 1.52, drift: 1.01 })).toBeCloseTo(1.52 / 1.01, 12);
  });

  it('gives a service that holds its count while the fleet collapses a share gain of 1/drift', () => {
    // The TrainTicket signature: the source does not rise much, everything else stops. A ratio of 1.00 is the
    // WEAKEST reading on the absolute axis and the strongest one on this axis, which is the whole point.
    expect(shareOf({ growth: 1, drift: 0.09 })).toBeCloseTo(1 / 0.09, 10);
  });

  it('gives a service that rises exactly with its fleet a share of one', () => {
    expect(shareOf({ growth: 1.2, drift: 1.2 })).toBeCloseTo(1, 12);
  });

  it('refuses to divide by a drift of zero', () => {
    // A fleet that emitted nothing after the injection is not a yardstick; the share is undefined, not infinite.
    expect(shareOf({ growth: 1.5, drift: 0 })).toBeUndefined();
  });

  it('refuses a negative drift, which no count ratio can have', () => {
    expect(shareOf({ growth: 1.5, drift: -0.2 })).toBeUndefined();
  });
});

describe('the share census', () => {
  it('is empty until a vote is folded in, and prints nothing at all', () => {
    const census = createTraceShareCensus();
    expect(census.measured).toBe(0);
    expect(census.unmeasured).toBe(0);
    expect(formatTraceShareCensusLine(census)).toBeUndefined();
  });

  it('counts a vote above every floor as a vote and a hit in every policy', () => {
    const census = createTraceShareCensus();
    // 1.52 / 0.08 = 19: above all four floors.
    accumulateTraceShare(census, prediction(1.52, 0.08));

    expect(census.measured).toBe(1);
    for (const policy of census.policies) {
      expect(policy).toEqual({ votes: 1, hits: 1, withdrawn: 0, surrendered: 0 });
    }
  });

  it('withdraws a vote below every floor and charges nothing to surrender', () => {
    const census = createTraceShareCensus();
    // A miss at share 1.26 — the shape of the five TrainTicket route votes.
    accumulateTraceShare(
      census,
      prediction(1.16, 0.92, { truth: 'ts-src', top1: 'ts-other', traceVote: 'ts-other' }),
    );
    const last = census.policies[census.policies.length - 1]!;

    expect(last.votes).toBe(0);
    expect(last.hits).toBe(0);
    expect(last.withdrawn).toBe(1);
    expect(last.surrendered).toBe(0);
  });

  it('charges a withdrawn HIT to surrendered, which is the cost of the floor', () => {
    const census = createTraceShareCensus();
    // A genuine hit whose share is only 1.5: the floor gives up a case here and takes one back elsewhere.
    accumulateTraceShare(census, prediction(1.5, 1.0));
    const last = census.policies[census.policies.length - 1]!;

    expect(last.withdrawn).toBe(1);
    expect(last.surrendered).toBe(1);
  });

  it('keeps a vote whose share EQUALS a floor, because a floor is inclusive', () => {
    const census = createTraceShareCensus();
    const floor = TRACE_SHARE_FLOORS[0]!;
    accumulateTraceShare(census, prediction(floor, 1));

    expect(census.policies[0]!.votes).toBe(1);
    expect(census.policies[0]!.withdrawn).toBe(0);
  });

  it('reports a vote with no significance measurement as unmeasured rather than as a zero share', () => {
    const census = createTraceShareCensus();
    accumulateTraceShare(census, prediction(1.5, 0.1, { traceSignificance: undefined }));

    expect(census.measured).toBe(0);
    expect(census.unmeasured).toBe(1);
    for (const policy of census.policies)
      expect(policy).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });
  });

  it('reports a vote with no riser growth as unmeasured, since the share has no numerator', () => {
    const census = createTraceShareCensus();
    accumulateTraceShare(
      census,
      prediction(1.5, 0.1, {
        traceRiser: { vote: { service: 'ts-src', pre: 0, post: 40 }, truth: undefined },
      }),
    );

    expect(census.unmeasured).toBe(1);
  });

  it('ignores a case the term did not vote on', () => {
    const census = createTraceShareCensus();
    accumulateTraceShare(census, prediction(1.5, 0.1, { traceVote: undefined }));

    expect(census.measured).toBe(0);
    expect(census.unmeasured).toBe(0);
  });

  it('gives every floor its own object, so one policy cannot move another', () => {
    const census = createTraceShareCensus();
    expect(new Set(census.policies).size).toBe(TRACE_SHARE_FLOORS.length);
  });

  it('prints one segment per floor with the net a selector would be read on', () => {
    const census = createTraceShareCensus();
    accumulateTraceShare(census, prediction(1.52, 0.08)); // 19.0 — above every floor
    accumulateTraceShare(
      census,
      prediction(1.16, 0.92, { truth: 'ts-src', top1: 'ts-other', traceVote: 'ts-other' }),
    ); // 1.26
    accumulateTraceShare(census, prediction(1.5, 1.0)); // 1.5 — withdrawn and surrendered at 2+

    const line = formatTraceShareCensusLine(census);
    expect(line).toContain('[trace-share]');
    expect(line).toContain('measured=3');
    expect(line).toContain('unmeasured=0');
    // Floor 2: the 1.26 vote is withdrawn, the 1.5 hit is withdrawn and surrendered, the 19.0 vote stands.
    // `net` is `withdrawn - surrendered` — the wrong votes the floor removes, i.e. the cases it could win —
    // so one removed miss against one given-up hit is `1` and reads as "no worse, one case moved".
    expect(line).toContain('f2 votes=1 hits=1 withdrawn=2 surrendered=1 net=1');
  });

  it('prints the floors in the declaration order so two runs are comparable', () => {
    const census = createTraceShareCensus();
    accumulateTraceShare(census, prediction(1.52, 0.08));
    const line = formatTraceShareCensusLine(census)!;

    const order = TRACE_SHARE_FLOORS.map((f) => line.indexOf(`f${String(f)} `));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
