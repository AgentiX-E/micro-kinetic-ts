import { describe, expect, it } from 'vitest';

import { EMPTY_SELF_TIME_CENSUS, type SelfTimeCensus } from '../../packages/tree/src/index.js';

import { formatSelfTimeCensus } from '../src/self-time-census-report.js';

const CENSUS: SelfTimeCensus = {
  services: 200,
  withLatency: 50,
  withLevel: 40,
  undecided: 30,
  scored: 10,
  measuredZero: 4,
  channelsRefusedShort: 7,
  channelsRefusedIdle: 3,
};

describe('formatSelfTimeCensus', () => {
  it('prints every counter, prefixed so a workflow grep can find the line', () => {
    const line = formatSelfTimeCensus(CENSUS);

    expect(line.startsWith('[self-time] ')).toBe(true);
    for (const fragment of [
      'services=200',
      'withLatency=50',
      'withLevel=40',
      'undecided=30',
      'scored=10',
      'measuredZero=4',
      'channelsRefusedShort=7',
      'channelsRefusedIdle=3',
    ]) {
      expect(line).toContain(fragment);
    }
  });

  it('carries the SHARE each stage reached, because a count without its denominator is not a census', () => {
    // The number a reader needs is `scored/services`: how much of the corpus the term could see at all. The raw
    // counts are beside it so the loss can be attributed to a stage rather than merely observed.
    const line = formatSelfTimeCensus(CENSUS);

    expect(line).toContain('withLatency=50 (25.0%)');
    expect(line).toContain('withLevel=40 (20.0%)');
    expect(line).toContain('scored=10 (5.0%)');
  });

  it('prints a dash rather than 0.0 % over an empty population', () => {
    // `0/0` is not a measurement of zero: a corpus the term never saw and a corpus where it saw nothing have the
    // same numerator and different denominators, and only the second is evidence.
    const line = formatSelfTimeCensus(EMPTY_SELF_TIME_CENSUS);

    expect(line).toContain('withLatency=0 (  -)');
    expect(line).not.toContain('0.0%');
  });
});
