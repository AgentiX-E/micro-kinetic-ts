import { describe, expect, it } from 'vitest';

import type { EliminationClaim } from '../../packages/ai/src/agent/index.js';

import type { HeadroomCase } from '../src/agentic-headroom.js';
import { nullReadingOf, swapTopTwo } from '../src/agentic-null-model.js';

function candidate(service: string, rank: number) {
  return { service, rank, score: 1 - rank / 10, channels: [] };
}

/** One case over `services`, with `accepted` as the truth set. */
function study(services: readonly string[], accepted: readonly string[]): HeadroomCase {
  return {
    datapack: 'dp-1',
    faultType: 'ContainerKill',
    accepted: [...accepted],
    candidates: services.map((service, rank) => candidate(service, rank)),
  };
}

function claim(remove: string, keep: string): EliminationClaim {
  return {
    remove,
    keep,
    because: { channel: 'latency', statistic: 'post', observed: 9, band: [1, 2] },
  };
}

describe('nullReadingOf', () => {
  it('states nothing about an empty reading, and divides by nothing', () => {
    // The zero-variance case is not a hypothetical: a corpus whose truth set is empty gives every claim a
    // probability of zero, and a z computed as `0 / 0` would be the one number in this module that is not a fact.
    expect(nullReadingOf([], [])).toEqual({
      claims: 0,
      hits: 0,
      expected: 0,
      variance: 0,
      z: 0,
      promotingRank1: 0,
      swappingTopTwo: 0,
      outside: 0,
    });
    const empty = study(['a', 'b', 'c', 'd', 'e'], []);
    expect(nullReadingOf([empty], [{ datapack: 'dp-1', claims: [claim('a', 'b')] }])).toMatchObject(
      {
        claims: 1,
        hits: 0,
        expected: 0,
        z: 0,
      },
    );
  });

  it('reads a hit as one over the size of the pool the null draws from', () => {
    // Four candidates remain after the removal, one of them is the truth, so the null gives this claim a 25 %
    // chance. The expectation is per claim, from that claim's own pool — a corpus with wider candidate lists must
    // not make the same model look sharper.
    const cases = [study(['a', 'b', 'c', 'd', 'e'], ['c'])];
    const reading = nullReadingOf(cases, [{ datapack: 'dp-1', claims: [claim('a', 'b')] }]);
    expect(reading).toMatchObject({ claims: 1, hits: 0, expected: 0.25, variance: 0.1875 });
    expect(reading.z).toBeCloseTo(-0.5773502691896257, 12);
  });

  it('reads a hit as a positive deviation and an over-hit as a large one', () => {
    const cases = [study(['a', 'b', 'c', 'd', 'e'], ['b'])];
    const one = nullReadingOf(cases, [{ datapack: 'dp-1', claims: [claim('a', 'b')] }]);
    expect(one.hits).toBe(1);
    expect(one.z).toBeCloseTo(0.75 / Math.sqrt(0.1875), 12);
    const five = nullReadingOf(cases, [
      {
        datapack: 'dp-1',
        claims: [
          claim('a', 'b'),
          claim('a', 'b'),
          claim('a', 'b'),
          claim('a', 'b'),
          claim('a', 'b'),
        ],
      },
    ]);
    expect(five.hits).toBe(5);
    expect(five.expected).toBeCloseTo(1.25, 12);
    expect(five.z).toBeCloseTo(3.75 / Math.sqrt(0.9375), 12);
  });

  it('counts the constant, content-free choices separately from the hits', () => {
    // These two counters are what make "the model reasoned" falsifiable: an arm whose claims are almost all
    // "remove rank 0, keep rank 1" is a one-line function, whatever its accuracy turns out to be.
    const cases = [study(['a', 'b', 'c', 'd', 'e'], ['b'])];
    const reading = nullReadingOf(cases, [
      { datapack: 'dp-1', claims: [claim('a', 'b'), claim('a', 'c'), claim('b', 'd')] },
    ]);
    expect(reading.promotingRank1).toBe(1);
    expect(reading.swappingTopTwo).toBe(1);
  });

  it('counts a claim naming a service the engine never presented as outside the pool', () => {
    const cases = [study(['a', 'b'], ['b'])];
    const reading = nullReadingOf(cases, [{ datapack: 'dp-1', claims: [claim('a', 'stranger')] }]);
    expect(reading).toMatchObject({ claims: 0, outside: 1 });
  });

  it('counts every claim of an unknown datapack as outside, rather than dropping it', () => {
    // A replay that silently discards its unreadable records improves by shrinking its own denominator, which is
    // the failure mode `replayOf` was built to make visible; this module must not reintroduce it.
    const cases = [study(['a', 'b'], ['b'])];
    const reading = nullReadingOf(cases, [
      { datapack: 'dp-missing', claims: [claim('a', 'b'), claim('a', 'b')] },
    ]);
    expect(reading).toMatchObject({ claims: 0, outside: 2 });
  });

  it('reads a case with a single candidate as having no pool to draw from', () => {
    const cases = [study(['a'], ['a'])];
    const reading = nullReadingOf(cases, [{ datapack: 'dp-1', claims: [claim('a', 'b')] }]);
    expect(reading).toMatchObject({ claims: 0, outside: 1 });
    const self = nullReadingOf(
      [study(['a'], ['a'])],
      [{ datapack: 'dp-1', claims: [claim('a', 'a')] }],
    );
    expect(self).toMatchObject({ claims: 0, outside: 1 });
  });

  it('sums per-claim variances rather than averaging percentages', () => {
    // Two cases with different pool sizes: the variance must be the sum of the two Bernoulli variances, or a
    // reading over mixed-width candidate lists would understate its own standard error.
    const wide = study(['a', 'b', 'c', 'd', 'e'], ['c']);
    const narrow: HeadroomCase = {
      datapack: 'dp-2',
      faultType: 'ContainerKill',
      accepted: ['y'],
      candidates: [candidate('x', 0), candidate('y', 1)],
    };
    const reading = nullReadingOf(
      [wide, narrow],
      [
        { datapack: 'dp-1', claims: [claim('a', 'b')] },
        { datapack: 'dp-2', claims: [claim('x', 'y')] },
      ],
    );
    expect(reading.claims).toBe(2);
    expect(reading.expected).toBeCloseTo(0.25 + 1, 12);
    expect(reading.variance).toBeCloseTo(0.1875, 12);
    expect(reading.z).toBeCloseTo((1 - 1.25) / Math.sqrt(0.1875), 12);
  });
});

describe('swapTopTwo', () => {
  it('states nothing about an empty corpus', () => {
    expect(swapTopTwo([])).toEqual({ engine: 0, swapped: 0, cases: 0 });
  });

  it('reads the corpus before and after the constant swap', () => {
    // Two cases: one the engine gets right and the swap loses, one it gets wrong and the swap fixes. The point of
    // the pair is that the swap is a fixed rule — it cannot win more than it loses, and it says so in two numbers.
    const right = study(['a', 'b'], ['a']);
    const wrong = study(['a', 'b'], ['b']);
    expect(swapTopTwo([right])).toEqual({ engine: 1, swapped: 0, cases: 1 });
    expect(swapTopTwo([wrong])).toEqual({ engine: 0, swapped: 1, cases: 1 });
    expect(swapTopTwo([right, wrong])).toEqual({ engine: 1, swapped: 1, cases: 2 });
  });

  it('reads a case with one candidate as unchanged by the swap', () => {
    const single = study(['a'], ['a']);
    expect(swapTopTwo([single])).toEqual({ engine: 1, swapped: 1, cases: 1 });
  });

  it('reads a case with no candidates as counting neither side', () => {
    expect(swapTopTwo([study([], ['a'])])).toEqual({ engine: 0, swapped: 0, cases: 1 });
  });
});
