import { describe, expect, it } from 'vitest';

import type { CandidateFingerprint, EliminationClaim } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import {
  formatPreferenceCensus,
  keepRateOf,
  preferenceCensusOf,
} from '../src/agentic-preference-census.js';

function candidate(service: string): CandidateFingerprint {
  return { service, rank: 0, score: 1, channels: [] };
}

function oneCase(
  datapack: string,
  services: readonly string[],
  accepted: readonly string[],
): HeadroomCase {
  return { datapack, faultType: 'CPUStress', accepted, candidates: services.map(candidate) };
}

function keeps(service: string): readonly EliminationClaim[] {
  return [
    {
      remove: 'other',
      keep: service,
      because: { channel: 'cpu', statistic: 'post', observed: 1, band: [0, 1] },
    },
  ];
}

describe('keepRateOf', () => {
  it('is NaN rather than zero when nothing was presented', () => {
    // A zero would be the strongest claim the statistic can make ("it never confuses this one"), and an empty
    // denominator states nothing at all.
    expect(Number.isNaN(keepRateOf(0, 0))).toBe(true);
    expect(keepRateOf(0, 4)).toBe(0);
    expect(keepRateOf(3, 4)).toBeCloseTo(0.75, 12);
  });
});

describe('preferenceCensusOf', () => {
  // Two cases where `hub` is presented: in the first it is the source and the model does not name it, in the second
  // it is innocent and the model does. That is the corpus's shape in miniature.
  const population = [
    oneCase('ts0-a', ['hub', 'leaf'], ['hub']),
    oneCase('ts1-b', ['hub', 'leaf'], ['leaf']),
    oneCase('ts2-c', ['hub', 'leaf'], ['leaf']),
    oneCase('ts3-d', ['only'], ['only']),
  ];
  const claims = new Map<string, readonly EliminationClaim[]>([
    ['ts0-a', keeps('leaf')],
    ['ts1-b', keeps('hub')],
    ['ts2-c', keeps('hub')],
    // a case with no claims is not an answered case and must not enter the denominator
  ]);

  it('splits the cases a service was presented in by whether it is the source', () => {
    const census = preferenceCensusOf(population, claims);
    const hub = census.rows.find((row) => row.service === 'hub');
    expect(hub).toEqual({
      service: 'hub',
      whenTruth: 1,
      keptWhenTruth: 0,
      whenInnocent: 2,
      keptWhenInnocent: 2,
    });
    expect(census.cases).toBe(3);
  });

  it('calls a preference that is stronger when the service is innocent inverted', () => {
    expect(preferenceCensusOf(population, claims).inverted).toBe(true);
  });

  it('does not call a reader inverted', () => {
    const reading = new Map<string, readonly EliminationClaim[]>([
      ['ts0-a', keeps('hub')],
      ['ts1-b', keeps('leaf')],
      ['ts2-c', keeps('leaf')],
    ]);
    const census = preferenceCensusOf(population, reading);
    expect(census.rows.find((row) => row.service === 'hub')).toMatchObject({
      whenTruth: 1,
      keptWhenTruth: 1,
      whenInnocent: 2,
      keptWhenInnocent: 0,
    });
    expect(census.inverted).toBe(false);
  });

  it('reports the most-presented services, ties broken by name, and no more than asked', () => {
    const services = ['zulu', 'alpha', 'mike'];
    const wide = services.map((service, index) =>
      oneCase(`ts${String(index)}-x`, services, [service]),
    );
    const named = new Map<string, readonly EliminationClaim[]>([
      ['ts0-x', keeps('zulu')],
      ['ts1-x', keeps('zulu')],
      ['ts2-x', keeps('zulu')],
    ]);
    expect(preferenceCensusOf(wide, named).rows.map((row) => row.service)).toEqual([
      'alpha',
      'mike',
      'zulu',
    ]);
    expect(preferenceCensusOf(wide, named, 2).rows).toHaveLength(2);
    expect(preferenceCensusOf(wide, named, 0).rows).toEqual([]);
    expect(preferenceCensusOf(wide, named).namedServices).toBe(1);
  });

  it('ignores a claim that keeps a service the case never presented', () => {
    // A name outside the posterior cannot be a preference about the row, so it counts as a named service and not as
    // a preference for any candidate.
    const census = preferenceCensusOf(population, new Map([['ts0-a', keeps('ghost')]]));
    expect(census.namedServices).toBe(1);
    expect(census.rows.every((row) => row.keptWhenTruth === 0 && row.keptWhenInnocent === 0)).toBe(
      true,
    );
  });

  it('has nothing to say about a population with no answered case', () => {
    const census = preferenceCensusOf(population, new Map());
    expect(census).toMatchObject({ cases: 0, namedServices: 0, rows: [], inverted: false });
    expect(formatPreferenceCensus(census)).toEqual([]);
  });
});

describe('formatPreferenceCensus', () => {
  const population = [oneCase('ts0-a', ['hub', 'leaf'], ['hub'])];

  it('prints each half with its own denominator, so a reader can recompute the rate', () => {
    const lines = formatPreferenceCensus(
      preferenceCensusOf(population, new Map([['ts0-a', keeps('hub')]])),
    );
    expect(lines[0]).toContain('1 answered cases');
    expect(lines[0]).toContain('1 services named');
    expect(lines[1]).toContain('hub');
    expect(lines[1]).toContain('source   1/1');
    // `leaf` was never the source, so its source half has no denominator and prints as `-` rather than `0.0 %`.
    expect(lines[2]).toContain('leaf');
    expect(lines[2]).toContain('source   0/0   (     -)');
  });

  it('states the verdict in words when the preference is inverted, and not otherwise', () => {
    // One case where `hub` is the source and one where it is not, so both halves have a denominator and the verdict
    // is decidable. A service that is never the source states no verdict at all, which the row above already shows.
    const both = [oneCase('ts0-a', ['hub'], ['hub']), oneCase('ts1-b', ['hub'], ['leaf'])];
    // Both cases must be answered, or the half they would have contributed to is empty and the verdict is
    // undecidable rather than false.
    const inverted = formatPreferenceCensus(
      preferenceCensusOf(
        both,
        new Map([
          ['ts0-a', keeps('leaf')],
          ['ts1-b', keeps('hub')],
        ]),
      ),
    );
    expect(inverted.join('\n')).toContain('INVERTED');
    const read = formatPreferenceCensus(
      preferenceCensusOf(
        both,
        new Map([
          ['ts0-a', keeps('hub')],
          ['ts1-b', keeps('leaf')],
        ]),
      ),
    );
    expect(read.join('\n')).not.toContain('INVERTED');
  });
});
