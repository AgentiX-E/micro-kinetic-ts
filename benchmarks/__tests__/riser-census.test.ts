/**
 * The trace-riser census.
 *
 * Two things are under test and they fail in different ways. The ATTRIBUTION must walk the trace rule's guards in
 * the rule's own order, so a wrong vote is charged to the condition that actually rejected the truth; and the
 * four buckets must partition the wrong votes, with `truthQualified` pinned at zero as the invariant that ties
 * this census to the rule it describes.
 *
 * The RENDERING is tested because it is what the artifact carries: a missing measurement has to print as `-`
 * rather than as zero, and the truth's vector must appear only when it differs from the vote's.
 *
 * @module __tests__/riser-census
 */

import { describe, expect, it } from 'vitest';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateRiser,
  createRiserCensus,
  formatRiserCaseLine,
  formatRiserCensusLine,
} from '../src/riser-census.js';

/** A case with a vote on `ts-other` against a truth of `ts-src`, which is the shape of every miss. */
const miss = (over: Partial<CasePrediction> = {}): CasePrediction => ({
  caseId: 'c1',
  truth: 'ts-src',
  top1: 'ts-other',
  correct: false,
  traceVote: 'ts-other',
  traceRiser: {
    vote: {
      service: 'ts-other',
      pre: 1770,
      post: 2480,
      growth: 2480 / 1770,
      failedIn: 0,
      failedOut: 18,
    },
    truth: { service: 'ts-src', pre: 310, post: 502, growth: 502 / 310, failedIn: 3, failedOut: 0 },
  },
  ...over,
});

describe('the riser census', () => {
  it('counts a vote for the truth as a hit and attributes nothing', () => {
    const census = createRiserCensus();
    accumulateRiser(census, miss({ traceVote: 'ts-src', top1: 'ts-src', correct: true }));

    expect(census).toEqual({
      votes: 1,
      hits: 1,
      truthUnmeasured: 0,
      truthBelowPre: 0,
      truthBelowRise: 0,
      truthQualified: 0,
    });
  });

  it('skips a case with no vote, because a term that did not speak has not been wrong', () => {
    const census = createRiserCensus();
    accumulateRiser(census, miss({ traceVote: undefined }));

    expect(census.votes).toBe(0);
    expect(census.hits).toBe(0);
    expect(formatRiserCensusLine(census)).toBeUndefined();
  });

  it('charges a miss to the PRE guard when the truth never reached the rule window', () => {
    // 310 spans is below the rule's `minPreCount`, so the truth was never a candidate — the vote was not a
    // judgement about it. This is the guard the rule's own documentation expects to bind on TrainTicket, whose
    // fleets differ by an order of magnitude in traffic.
    const census = createRiserCensus();
    accumulateRiser(census, miss());

    expect(census.truthBelowPre).toBe(1);
    expect(census.truthBelowRise).toBe(0);
  });

  it('charges a miss to the RISE guard when the truth was inside the window but flat', () => {
    const census = createRiserCensus();
    accumulateRiser(
      census,
      miss({
        traceRiser: {
          vote: { service: 'ts-other', pre: 1770, post: 2480, growth: 2480 / 1770 },
          truth: { service: 'ts-src', pre: 900, post: 906, growth: 906 / 900 },
        },
      }),
    );

    expect(census.truthBelowPre).toBe(0);
    expect(census.truthBelowRise).toBe(1);
  });

  it('charges a truth inside the window with NO measurable rise to the RISE guard as well', () => {
    // A hand-built record can carry a window-passing count and no ratio. It cannot arise from `riserVectorOf`
    // (pre >= 500 implies pre > 0 implies a ratio), and the census still has to be total over it rather than
    // crashing or silently counting it as qualified.
    const census = createRiserCensus();
    accumulateRiser(
      census,
      miss({
        traceRiser: {
          vote: { service: 'ts-other', pre: 1770, post: 2480, growth: 2480 / 1770 },
          truth: { service: 'ts-src', pre: 900, post: 1200 },
        },
      }),
    );

    expect(census.truthBelowRise).toBe(1);
    expect(census.truthQualified).toBe(0);
  });

  it('reports a miss whose truth carries no span measurement as unmeasured, not as a guard', () => {
    const census = createRiserCensus();
    accumulateRiser(census, miss({ traceRiser: undefined }));

    expect(census.truthUnmeasured).toBe(1);
    expect(census.truthBelowPre).toBe(0);
    expect(census.truthBelowRise).toBe(0);
  });

  it('counts a truth that passes BOTH guards in the invariant bucket, which the artifact must print as zero', () => {
    // Reachable only from a hand-built record — the rule would have made this truth a candidate, so either it
    // would have been the vote or the vote would not exist. Keeping the bucket countable is what makes the
    // zero on the artifact a measurement rather than a claim the code cannot express.
    const census = createRiserCensus();
    accumulateRiser(
      census,
      miss({
        traceRiser: {
          vote: { service: 'ts-other', pre: 1770, post: 2480, growth: 2480 / 1770 },
          truth: { service: 'ts-src', pre: 1900, post: 3100, growth: 3100 / 1900 },
        },
      }),
    );

    expect(census.truthQualified).toBe(1);
    expect(formatRiserCensusLine(census)).toContain('truth-qualified=1');
  });

  it('renders the totals as four exclusive buckets beside the hit count, with the rule own thresholds', () => {
    const census = createRiserCensus();
    accumulateRiser(census, miss());
    accumulateRiser(census, miss({ traceVote: 'ts-src', top1: 'ts-src', correct: true }));

    // The labels carry the SHIPPED thresholds, imported from the rule: 500 and 1.15 today, and whatever the rule
    // says after a change — a hardcoded label would name a guard the rule no longer has.
    expect(formatRiserCensusLine(census)).toBe(
      '[trace-riser] total votes=2 hits=1 wrong=1 | truth-unmeasured=0 truth-pre<500=1 ' +
        'truth-rise<1.15=0 truth-qualified=0',
    );
  });
});

describe('the per-case line', () => {
  it('prints the vote vector and, on a miss, the truth beside it', () => {
    expect(formatRiserCaseLine(miss())).toBe(
      '[trace-riser] c1 MISS vote=ts-other pre=1770 growth=1.40 drift=- share=- failedIn=+0 failedOut=+18 ' +
        '|| truth=ts-src pre=310 growth=1.62 failedIn=+3 failedOut=+0',
    );
  });

  it('prints the vector ONCE on a hit, because the two sides are the same measurement', () => {
    // Printing it twice would read as two independent readings of two services that happen to agree.
    expect(formatRiserCaseLine(miss({ traceVote: 'ts-src', top1: 'ts-src', correct: true }))).toBe(
      '[trace-riser] c1 HIT vote=ts-src pre=1770 growth=1.40 drift=- share=- failedIn=+0 failedOut=+18',
    );
  });

  it('prints a measurement it does not have as `-`, never as zero', () => {
    expect(
      formatRiserCaseLine(
        miss({
          traceRiser: { vote: { service: 'ts-other', pre: 0, post: 40 }, truth: undefined },
        }),
      ),
    ).toBe(
      '[trace-riser] c1 MISS vote=ts-other pre=0 growth=- drift=- share=- failedIn=- failedOut=-',
    );
  });

  it('says nothing at all for a case with no vote', () => {
    expect(formatRiserCaseLine(miss({ traceVote: undefined }))).toBeUndefined();
  });

  it('prints the truth side when the record carries a truth but the vote is absent from the vector', () => {
    // The two fields are produced from one lookup, and this is the totality test for the renderer: a record with
    // an empty vote vector still names the case, the decision and the truth, rather than rendering half a line.
    const line = formatRiserCaseLine({
      caseId: 'c2',
      truth: 'ts-src',
      top1: 'ts-other',
      correct: false,
      traceVote: 'ts-other',
      traceRiser: {
        vote: undefined,
        truth: { service: 'ts-src', pre: 1200, post: 1900, growth: 1900 / 1200 },
      },
    });

    expect(line).toBe(
      '[trace-riser] c2 MISS vote=ts-other pre=- growth=- drift=- share=- failedIn=- failedOut=- ' +
        '|| truth=ts-src pre=1200 growth=1.58 failedIn=- failedOut=-',
    );
  });

  it('does not attach a truth side to a hit even when the record carries one', () => {
    expect(
      formatRiserCaseLine(
        miss({
          traceVote: 'ts-src',
          top1: 'ts-src',
          correct: true,
          traceRiser: {
            vote: { service: 'ts-src', pre: 1770, post: 2480, growth: 2480 / 1770 },
            truth: { service: 'ts-src', pre: 1770, post: 2480, growth: 2480 / 1770 },
          },
        }),
      ),
    ).toBe(
      '[trace-riser] c1 HIT vote=ts-src pre=1770 growth=1.40 drift=- share=- failedIn=- failedOut=-',
    );
  });

  it('prints the FLEET drift and the share beside the rise, because the rise alone cannot be read', () => {
    // The reading of iteration 152 in one line: 1.52 on a fleet that fell to 8% is a 19x share gain, and 1.16 on a
    // fleet that held is 1.26. Same column of rise values, opposite statements.
    const line = formatRiserCaseLine({
      caseId: 'c3',
      truth: 'ts-auth-service',
      top1: 'ts-auth-service',
      correct: true,
      traceVote: 'ts-auth-service',
      traceRiser: {
        vote: { service: 'ts-auth-service', pre: 1800, post: 2736, growth: 1.52 },
        truth: { service: 'ts-auth-service', pre: 1800, post: 2736, growth: 1.52 },
      },
      traceSignificance: { drift: 0.08, ranked: [] },
    });

    expect(line).toBe(
      '[trace-riser] c3 HIT vote=ts-auth-service pre=1800 growth=1.52 drift=0.08 share=19.00 failedIn=- failedOut=-',
    );
  });

  it('prints the share as `-` when the rise exists but the fleet has no drift to divide by', () => {
    const line = formatRiserCaseLine({
      caseId: 'c4',
      truth: 'ts-src',
      top1: 'ts-src',
      correct: true,
      traceVote: 'ts-src',
      traceRiser: {
        vote: { service: 'ts-src', pre: 100, post: 150, growth: 1.5 },
        truth: undefined,
      },
      traceSignificance: { drift: 0, ranked: [] },
    });

    // A fleet that emitted nothing after the injection is not a yardstick, so the quotient does not exist — and it
    // must not be printed as `0.00`, which would read as "the share collapsed".
    expect(line).toContain('growth=1.50 drift=0.00 share=-');
  });

  it('keeps a negative failure count negative if a malformed record carries one', () => {
    // `riserVectorOf` clamps at zero, so this cannot come from a case. The renderer is total over the record it
    // receives, and printing `+-1` for a negative would be a worse defect than the malformed record itself.
    expect(
      formatRiserCaseLine(
        miss({
          traceRiser: {
            vote: { service: 'ts-other', pre: 1770, post: 2480, growth: 2480 / 1770, failedIn: -1 },
            truth: undefined,
          },
        }),
      ),
    ).toBe(
      '[trace-riser] c1 MISS vote=ts-other pre=1770 growth=1.40 drift=- share=- failedIn=-1 failedOut=-',
    );
  });
});
