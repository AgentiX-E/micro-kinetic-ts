import { describe, expect, it } from 'vitest';

import type {
  CandidateFingerprint,
  ChannelFingerprint,
  EliminationClaim,
} from '../../packages/ai/src/agent/index.js';
import {
  ORDINARY_RATE,
  citationCensusOf,
  formatCitationCensus,
} from '../src/agentic-citation-census.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';

function channel(label: string, rate: number): ChannelFingerprint {
  return { label, pre: 0, post: 1, band: [0, 0.5], rate };
}

function candidate(service: string, channels: readonly ChannelFingerprint[]): CandidateFingerprint {
  return { service, rank: 0, score: 1, channels };
}

function oneCase(datapack: string, candidates: readonly CandidateFingerprint[]): HeadroomCase {
  return { datapack, faultType: 'CPUStress', accepted: ['truth'], candidates };
}

function claim(remove: string, keep: string, label: string): EliminationClaim {
  return {
    remove,
    keep,
    because: { channel: label, statistic: 'post', observed: 1, band: [0, 0.5] },
  };
}

// `error` and `cpu` are on both rows; `latency` only on the eliminated one, which is the shape a claim takes when
// it cites the truth's own decisive channel against a symptom that never reported it.
const CASE = oneCase('ts0-cpu-aaa', [
  candidate('truth', [channel('error', 0), channel('latency', 0.9), channel('cpu', 0.5)]),
  candidate('symptom', [channel('error', 0.1), channel('cpu', 0.02)]),
]);

describe('citationCensusOf', () => {
  it('counts the three ways a claim can fail to be comparable, exclusively', () => {
    const claims = new Map<string, readonly EliminationClaim[]>([
      [
        'ts0-cpu-aaa',
        [
          // comparable: both rows carry `error`
          claim('truth', 'symptom', 'error'),
          // the eliminated row carries nothing called `nobody`: fabrication
          claim('truth', 'symptom', 'nobody'),
          // `latency` is on the eliminated row only, and the kept row never printed it
          claim('truth', 'symptom', 'latency'),
          // a candidate outside the posterior is a different mistake again, not a channel one
          claim('ghost', 'symptom', 'error'),
        ],
      ],
    ]);
    const census = citationCensusOf([CASE], claims);
    expect(census.claims).toBe(4);
    expect(census.absent).toBe(1);
    expect(census.unshared).toBe(1);
    expect(census.unknownCandidate).toBe(1);
    expect(census.comparable).toBe(1);
  });

  it('reads the rate off the eliminated row, not off the kept one', () => {
    // The claim is about what the ELIMINATED candidate read; the kept row's rate is the rival's argument, not this
    // one's. Reading the wrong side would make a rare channel look ordinary whenever its rival swings.
    const claims = new Map<string, readonly EliminationClaim[]>([
      ['ts0-cpu-aaa', [claim('truth', 'symptom', 'error')]],
    ]);
    const census = citationCensusOf([CASE], claims);
    expect(census.meanRate).toBe(0);
    expect(census.ordinary).toBe(0);
  });

  it('buckets a cited channel as ordinary at the stated rate and above', () => {
    // The bar is a half: a channel that leaves its fault-free band more often than not is describing its own habit.
    const bar = oneCase('ts1-cpu-bbb', [
      candidate('a', [channel('latency', ORDINARY_RATE)]),
      candidate('b', [channel('latency', 0.1)]),
    ]);
    const justBelow = oneCase('ts2-cpu-ccc', [
      candidate('a', [channel('latency', ORDINARY_RATE - 0.01)]),
      candidate('b', [channel('latency', 0.1)]),
    ]);
    const atTheBar = citationCensusOf(
      [bar],
      new Map([['ts1-cpu-bbb', [claim('a', 'b', 'latency')]]]),
    );
    expect(atTheBar).toMatchObject({ claims: 1, comparable: 1, ordinary: 1 });
    expect(atTheBar.meanRate).toBeCloseTo(ORDINARY_RATE, 12);
    const below = citationCensusOf(
      [justBelow],
      new Map([['ts2-cpu-ccc', [claim('a', 'b', 'latency')]]]),
    );
    expect(below).toMatchObject({ comparable: 1, ordinary: 0 });
  });

  it('reports the mean rate over the comparable claims only, so a fabrication cannot move it', () => {
    const claims = new Map<string, readonly EliminationClaim[]>([
      ['ts0-cpu-aaa', [claim('symptom', 'truth', 'error'), claim('symptom', 'truth', 'nobody')]],
    ]);
    const census = citationCensusOf([CASE], claims);
    expect(census.comparable).toBe(1);
    expect(census.meanRate).toBeCloseTo(0.1, 12);
  });

  it('keeps the most-cited labels, ties broken by label, and no more than asked', () => {
    const claims = new Map<string, readonly EliminationClaim[]>([
      [
        'ts0-cpu-aaa',
        [
          claim('truth', 'symptom', 'error'),
          claim('symptom', 'truth', 'error'),
          claim('symptom', 'truth', 'cpu'),
        ],
      ],
    ]);
    expect(citationCensusOf([CASE], claims).labels).toEqual([
      { label: 'error', claims: 2 },
      { label: 'cpu', claims: 1 },
    ]);
    expect(citationCensusOf([CASE], claims, 1).labels).toEqual([{ label: 'error', claims: 2 }]);
    expect(citationCensusOf([CASE], claims, 0).labels).toEqual([]);
  });

  it('skips a claim about a case outside the population it was asked to score', () => {
    // A file scored against the wrong population must not contribute a number to the right one.
    const claims = new Map<string, readonly EliminationClaim[]>([
      ['ts0-cpu-aaa', [claim('truth', 'symptom', 'error')]],
      ['ts9-gone-zzz', [claim('truth', 'symptom', 'error')]],
    ]);
    expect(citationCensusOf([CASE], claims).claims).toBe(1);
  });

  it('is empty when the file holds no claim about any case in the population', () => {
    const census = citationCensusOf([CASE], new Map());
    expect(census).toMatchObject({ claims: 0, comparable: 0, ordinary: 0 });
    expect(Number.isNaN(census.meanRate)).toBe(true);
  });
});

describe('formatCitationCensus', () => {
  it('says nothing was cited rather than printing zeroes over an empty denominator', () => {
    const lines = formatCitationCensus(citationCensusOf([CASE], new Map()));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('none');
  });

  it('prints the shares against the claim count, so the three refusals add to the whole', () => {
    const claims = new Map<string, readonly EliminationClaim[]>([
      [
        'ts0-cpu-aaa',
        [
          claim('truth', 'symptom', 'error'),
          claim('truth', 'symptom', 'latency'),
          claim('truth', 'symptom', 'nobody'),
          claim('truth', 'symptom', 'another'),
        ],
      ],
    ]);
    const lines = formatCitationCensus(citationCensusOf([CASE], claims));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('4 claims');
    expect(lines[0]).toContain('25.0 %');
    expect(lines[1]).toContain('mean fault-free rate of a cited channel 0.00');
    expect(lines[1]).toContain('most cited: error ×1');
  });

  it('names a service outside the posterior only when one was named', () => {
    const outside = new Map<string, readonly EliminationClaim[]>([
      ['ts0-cpu-aaa', [claim('ghost', 'symptom', 'error')]],
    ]);
    expect(formatCitationCensus(citationCensusOf([CASE], outside))[0]).toContain(
      'outside the posterior',
    );
    const inside = new Map<string, readonly EliminationClaim[]>([
      ['ts0-cpu-aaa', [claim('truth', 'symptom', 'error')]],
    ]);
    expect(formatCitationCensus(citationCensusOf([CASE], inside))[0]).not.toContain(
      'outside the posterior',
    );
  });
});
