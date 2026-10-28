import { describe, expect, it } from 'vitest';
import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import {
  accumulateTraceVote,
  createTraceVoteCensus,
  formatTraceVoteLine,
} from '../src/trace-vote-census.js';

/**
 * The trace-vote census.
 *
 * The term pays a BINARY unit to the unique service whose span count rose while its peers held or fell. Two
 * measurements of it disagree — the term-gap census reads it as the largest cost on the blocking cell, a removal
 * arm reads the pin as worth ten cases over the suite — and both are consistent, because a term that wins more
 * than it loses can still be the term that loses the specific cases a reader is staring at. What separates them
 * is WHICH votes are wrong, which is what this census counts.
 */

const prediction = (over: Partial<CasePrediction> = {}): CasePrediction => ({
  caseId: 'c1',
  truth: 'ts-src',
  top1: 'ts-src',
  correct: true,
  ...over,
});

describe('the trace-vote census', () => {
  it('counts a vote for the ground truth as a HIT, whether or not it decided the case', () => {
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: 'ts-src' }));

    expect(census).toEqual({
      cases: 1,
      votes: 1,
      hits: 1,
      decisive: 0,
      abstained: 0,
      atMaximum: 0,
      nearTop: 0,
      mid: 0,
      tail: 0,
      unranked: 1,
    });
  });

  it('separates a wrong vote the ranking OVERRULED from one that became the top-1', () => {
    // The difference between misleading and deciding. A vote for `ts-other` on a case the engine then got right
    // anyway cost nothing; the same vote on a case it got wrong IS the miss.
    const census = createTraceVoteCensus();
    accumulateTraceVote(
      census,
      prediction({ top1: 'ts-src', correct: true, traceVote: 'ts-other' }),
    );
    accumulateTraceVote(
      census,
      prediction({ top1: 'ts-other', correct: false, traceVote: 'ts-other' }),
    );

    expect(census.votes).toBe(2);
    expect(census.hits).toBe(0);
    expect(census.decisive).toBe(1);
  });

  it('counts an abstention apart, so a term that did not speak is not reported as wrong', () => {
    // `traceWeight = 0` on every suite but RE3, and the rule abstains by construction when zero or several
    // risers qualify. "The term was silent" and "the term was wrong" are different findings with the same count.
    const census = createTraceVoteCensus();
    accumulateTraceVote(
      census,
      prediction({ correct: false, top1: 'ts-other', traceVote: undefined }),
    );

    expect(census.abstained).toBe(1);
    expect(census.votes).toBe(0);
    const line = formatTraceVoteLine(census)!;
    expect(line).toContain('votes=0');
    expect(line).toContain('abstained=1');
    expect(line).not.toContain('wrong=');
  });

  it('prints the hit share over the VOTES, not over the cases — an abstention is not a miss', () => {
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: 'ts-src' }));
    accumulateTraceVote(
      census,
      prediction({ top1: 'ts-other', correct: false, traceVote: 'ts-other' }),
    );
    accumulateTraceVote(census, prediction({ traceVote: undefined }));

    // Two votes, one hit: 50.0% of the votes, and 33.3% of the cases would have been a different number about a
    // different question.
    expect(formatTraceVoteLine(census)).toContain('cases=3 votes=2 hits=1 (50.0%)');
    expect(formatTraceVoteLine(census)).toContain('abstained=1 | wrong=1 decisive=1');
  });

  it('is silent for a cell that was never run, rather than printing a share of zero', () => {
    expect(formatTraceVoteLine(createTraceVoteCensus())).toBeUndefined();
  });

  it('counts a vote that landed on the cell MAXIMUM apart — the one condition the leader mask can act on', () => {
    // The refinement this instrument exists to price. `traceSkipsLeader` withholds the unit from the candidate
    // holding the cell's largest self-anomaly, so a vote at rank 1 is the only vote the mask can ever see: this
    // count is what separates "the mask never fires" from "it fires and decides nothing", which the nine-cell
    // arm cannot — a null result and an inert mechanism print the same zeros.
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: 'ts-src', traceVoteRank: 1 }));

    expect(census.atMaximum).toBe(1);
    expect(census.nearTop).toBe(0);
    expect(census.mid).toBe(0);
    expect(census.tail).toBe(0);
    expect(formatTraceVoteLine(census)).toContain('atMax=1');
  });

  it('partitions the votes by anomaly rank without losing one: 1 | 2-3 | 4-10 | 11+', () => {
    // A partition rather than a mean, deliberately: a mean rank hides the shape (one vote at the maximum and
    // nineteen at rank 30 has the same mean as twenty at rank 16) and the shape is the whole question. The
    // edges are the ones a reader already uses — the maximum, a shortlist of three, a top-ten.
    const census = createTraceVoteCensus();
    for (const rank of [1, 2, 3, 4, 10, 11, 40]) {
      accumulateTraceVote(census, prediction({ traceVote: 'ts-other', traceVoteRank: rank }));
    }

    expect(census.votes).toBe(7);
    expect(census.atMaximum).toBe(1);
    expect(census.nearTop).toBe(2);
    expect(census.mid).toBe(2);
    expect(census.tail).toBe(2);
    expect(census.atMaximum + census.nearTop + census.mid + census.tail).toBe(census.votes);
    expect(formatTraceVoteLine(census)).toContain('atMax=1 rank2-3=2 rank4-10=2 rank11+=2');
  });

  it('reports a vote whose rank was never measured as unranked, not as a tail vote', () => {
    // The distinction every census here keeps: "the vote went nowhere near the top" and "nobody measured where
    // the vote went" are different findings, and the second must not be counted as the first.
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: 'ts-other', traceVoteRank: undefined }));

    expect(census.votes).toBe(1);
    expect(census.unranked).toBe(1);
    expect(census.tail).toBe(0);
    const line = formatTraceVoteLine(census)!;
    expect(line).toContain('unranked=1');
    expect(line).not.toContain('atMax=');
  });

  it('prints the rank buckets only when it saw votes, so an abstaining cell gains no field', () => {
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: undefined }));

    expect(formatTraceVoteLine(census)).not.toContain('atMax');
  });

  it('prints a zero share without dividing by zero when every case abstained', () => {
    const census = createTraceVoteCensus();
    accumulateTraceVote(census, prediction({ traceVote: undefined }));

    expect(formatTraceVoteLine(census)).toContain('hits=0 (0.0%)');
  });
});
