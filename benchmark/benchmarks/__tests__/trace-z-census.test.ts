/**
 * Unit tests for the scale-free census.
 *
 * The census's value is the three distinctions it draws, and each one is a case below:
 *
 * - a truth that is LOUD (large `|z|`) but not the loudest is a different finding from a truth that is quiet, so
 *   `truth-loudest` and `truth-|z|>=3` are counted separately;
 * - an abstention is scored against the ENGINE's vote, so the same abstention counts as `withdrawn` when the engine
 *   was wrong and `surrendered` when it was right;
 * - a policy that finds TWO significant services abstains, because that is what the rule it replaces does — a policy
 *   that always named the loudest would be a different term.
 *
 * @module __tests__/trace-z-census
 */

import { describe, expect, it } from 'vitest';

import {
  accumulateTraceZ,
  createTraceZCensus,
  formatTraceZCaseLine,
  formatTraceZCensusLine,
  Z_SIGNIFICANT,
} from '../src/trace-z-census.js';

import type { CasePrediction } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import type {
  ServiceSignificance,
  TraceSignificance,
} from '../../packages/kinetic/src/benchmarks/runners/trace-significance.js';

/** One service's entry, with `expected` derived so a fixture cannot state an inconsistent triple. */
function entry(service: string, pre: number, post: number, drift: number): ServiceSignificance {
  const expected = pre * drift;
  return { service, pre, post, expected, z: (post - expected) / Math.sqrt(expected) };
}

/** A prediction carrying only the fields this census reads. */
function prediction(
  caseId: string,
  truth: string,
  axis: TraceSignificance | undefined,
  traceVote?: string,
): CasePrediction {
  return {
    caseId,
    truth,
    top1: undefined,
    correct: false,
    traceVote,
    traceSignificance: axis,
  } as unknown as CasePrediction;
}

/** An axis from explicit entries, with the truth's rank and entry derived the way the producer derives them. */
function axisOf(truth: string, entries: ServiceSignificance[], drift = 1): TraceSignificance {
  const ranked = [...entries].sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const own = ranked.find((e) => e.service === truth);
  if (own === undefined) return { drift, ranked };
  const louder = ranked.filter((e) => Math.abs(e.z) > Math.abs(own.z)).length;
  return { drift, ranked, truth: own, truthRank: 1 + louder };
}

describe('createTraceZCensus', () => {
  it('starts at zero and prints nothing — an empty cell is an absence, not a row of zeros', () => {
    const census = createTraceZCensus();
    expect(census.cases).toBe(0);
    expect(formatTraceZCensusLine(census)).toBeUndefined();
  });

  it('seeds every policy from one FROZEN zero, so an in-place fold cannot move the seed', () => {
    const census = createTraceZCensus();
    expect(Object.isFrozen(census.engine)).toBe(true);
    expect(Object.isFrozen(census.zUp)).toBe(true);
    expect(Object.isFrozen(census.zAbs)).toBe(true);
    expect(census.zUp).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });
  });
});

describe('accumulateTraceZ', () => {
  it('ignores a case with no measurable axis', () => {
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'a', undefined));
    expect(census).toEqual(createTraceZCensus());
  });

  it('counts a truth that is loud but not the loudest apart from one that is loudest', () => {
    // `victim` rises at +126.5 and the truth falls at -9.1: both are significant, the truth is not the loudest.
    const axis = axisOf('source', [
      entry('source', 12000, 11000, 1),
      entry('victim', 1000, 5000, 1),
      entry('quiet', 1000, 1000, 1),
    ]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'source', axis));

    expect(census.cases).toBe(1);
    expect(census.truthMeasured).toBe(1);
    expect(census.truthLoudest).toBe(0);
    expect(census.truthFalling).toBe(1);
    expect(census.truthSignificant).toBe(1);
  });

  it('counts a rise as rising, a fall as falling, and neither for a truth exactly at the drift', () => {
    const rising = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    const falling = axisOf('a', [entry('a', 1000, 400, 1), entry('b', 1000, 1000, 1)]);
    const flat = axisOf('a', [entry('a', 1000, 1000, 1), entry('b', 1000, 1000, 1)]);

    expect(accumulateTraceZ(createTraceZCensus(), prediction('c', 'a', rising)).truthRising).toBe(
      1,
    );
    expect(accumulateTraceZ(createTraceZCensus(), prediction('c', 'a', falling)).truthFalling).toBe(
      1,
    );
    const neither = accumulateTraceZ(createTraceZCensus(), prediction('c', 'a', flat));
    expect(neither.truthRising).toBe(0);
    expect(neither.truthFalling).toBe(0);
  });

  it('leaves the truth counters alone when the truth is not in the population', () => {
    const axis = axisOf('absent', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c', 'absent', axis));

    expect(census.cases).toBe(1);
    expect(census.truthMeasured).toBe(0);
    expect(census.truthLoudest).toBe(0);
  });

  it('scores the engine vote as the control, and both policies against the same case', () => {
    // One service at +18.97 (unique and significant), so both policies vote for `a`, which is the truth.
    const axis = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'a', axis, 'b'));

    expect(census.engine).toEqual({ votes: 1, hits: 0, withdrawn: 0, surrendered: 0 });
    expect(census.zUp).toEqual({ votes: 1, hits: 1, withdrawn: 0, surrendered: 0 });
    expect(census.zAbs).toEqual({ votes: 1, hits: 1, withdrawn: 0, surrendered: 0 });
  });

  it('counts an abstention over a WRONG engine vote as withdrawn', () => {
    // Both services are significant, so both policies abstain — and the engine's unit was wrong.
    const axis = axisOf('truth', [
      entry('truth', 1000, 1000, 1),
      entry('loud-1', 1000, 5000, 1),
      entry('loud-2', 1000, 4000, 1),
    ]);
    const census = accumulateTraceZ(
      createTraceZCensus(),
      prediction('c1', 'truth', axis, 'loud-1'),
    );

    expect(census.zUp).toEqual({ votes: 0, hits: 0, withdrawn: 1, surrendered: 0 });
    expect(census.zAbs).toEqual({ votes: 0, hits: 0, withdrawn: 1, surrendered: 0 });
  });

  it('counts an abstention over a RIGHT engine vote as surrendered', () => {
    const axis = axisOf('loud-1', [
      entry('loud-1', 1000, 5000, 1),
      entry('loud-2', 1000, 4000, 1),
      entry('other', 1000, 1000, 1),
    ]);
    const census = accumulateTraceZ(
      createTraceZCensus(),
      prediction('c1', 'loud-1', axis, 'loud-1'),
    );

    expect(census.zUp).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 1 });
  });

  it('does not score an abstention when the engine never voted', () => {
    const axis = axisOf('truth', [entry('truth', 1000, 1000, 1), entry('b', 1000, 1000, 1)]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'truth', axis));

    expect(census.engine).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });
    expect(census.zUp).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });
  });

  it('abstains on a policy when two services are significant, and votes when exactly one is', () => {
    const two = axisOf('a', [
      entry('a', 1000, 1600, 1),
      entry('b', 1000, 1500, 1),
      entry('c', 1000, 1000, 1),
    ]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'a', two));
    expect(census.zUp.votes).toBe(0);

    const one = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    expect(accumulateTraceZ(createTraceZCensus(), prediction('c1', 'a', one)).zUp.votes).toBe(1);
  });

  it('separates the two policies on a case whose only significant service FELL', () => {
    // `zUp` sees nothing above +3 and abstains; `zAbs` sees the fall and votes. This is the five route misses in
    // miniature, and the difference between the two votes is the whole question the census exists to answer.
    const axis = axisOf('source', [
      entry('source', 12000, 11000, 1),
      entry('flat-1', 1000, 1000, 1),
      entry('flat-2', 1000, 1000, 1),
    ]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'source', axis));

    expect(census.zUp).toEqual({ votes: 0, hits: 0, withdrawn: 0, surrendered: 0 });
    expect(census.zAbs).toEqual({ votes: 1, hits: 1, withdrawn: 0, surrendered: 0 });
  });

  it('folds without mutating its input', () => {
    const before = createTraceZCensus();
    const axis = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    accumulateTraceZ(before, prediction('c1', 'a', axis, 'b'));

    expect(before.cases).toBe(0);
    expect(before.zUp.votes).toBe(0);
  });
});

describe('formatTraceZCaseLine', () => {
  it('prints nothing for a case with no axis', () => {
    expect(formatTraceZCaseLine(prediction('c1', 'a', undefined))).toBeUndefined();
  });

  it('prints the drift, the three loudest services, the truth and the engine verdict', () => {
    const axis = axisOf('source', [
      entry('source', 12000, 11000, 1),
      entry('victim', 1000, 5000, 1),
      entry('third', 1000, 1200, 1),
      entry('fourth', 1000, 1000, 1),
    ]);
    const line = formatTraceZCaseLine(
      prediction('ts-route-service_f2_2', 'source', axis, 'victim'),
    );

    expect(line).toBe(
      '[trace-z] ts-route-service_f2_2 drift=1.00 | ' +
        '1 victim +126.5 1000→5000 | 2 source -9.1 12000→11000 | 3 third +6.3 1000→1200 | ' +
        'truth=source z=-9.1 rank=2 | engine=victim MISS | zUp=- zAbs=-',
    );
  });

  it('says so when the truth is not in the population, rather than omitting the column', () => {
    const axis = axisOf('absent', [entry('a', 1000, 1000, 1), entry('b', 1000, 1000, 1)]);
    const line = formatTraceZCaseLine(prediction('c1', 'absent', axis));

    expect(line).toContain('truth-not-measured');
  });

  it('prints the engine as absent when it never voted, and the policies as absent when they abstain', () => {
    const axis = axisOf('a', [entry('a', 1000, 1000, 1), entry('b', 1000, 1000, 1)]);
    const line = formatTraceZCaseLine(prediction('c1', 'a', axis));

    expect(line).toContain('engine=-');
    expect(line).toContain('zUp=- zAbs=-');
  });

  it('marks a correct engine vote as a HIT', () => {
    const axis = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    const line = formatTraceZCaseLine(prediction('c1', 'a', axis, 'a'));

    expect(line).toContain('engine=a HIT');
    expect(line).toContain('zUp=a zAbs=a');
  });

  it('prints a two-decimal drift and a one-decimal signed z', () => {
    const axis = axisOf('a', [entry('a', 1000, 1600, 1.014), entry('b', 1000, 1014, 1.014)], 1.014);
    const line = formatTraceZCaseLine(prediction('c1', 'a', axis));

    expect(line).toContain('drift=1.01');
    expect(line).toMatch(/z=\+\d+\.\d/);
  });
});

describe('formatTraceZCensusLine', () => {
  it('states every counter, every policy, and the bar it used', () => {
    const axis = axisOf('a', [entry('a', 1000, 1600, 1), entry('b', 1000, 1000, 1)]);
    const census = accumulateTraceZ(createTraceZCensus(), prediction('c1', 'a', axis, 'a'));
    const line = formatTraceZCensusLine(census);

    expect(line).toBe(
      '[trace-z] total cases=1 truth-measured=1 truth-loudest=1 truth-rising=1 truth-falling=0 ' +
        `truth-|z|>=${String(Z_SIGNIFICANT)}=1 | engine votes=1 hits=1 withdrawn=0 surrendered=0 ` +
        '| zUp votes=1 hits=1 withdrawn=0 surrendered=0 | zAbs votes=1 hits=1 withdrawn=0 surrendered=0',
    );
  });
});
