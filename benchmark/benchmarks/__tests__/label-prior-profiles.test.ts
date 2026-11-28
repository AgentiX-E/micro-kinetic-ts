/**
 * The label prior's construction: pooling, leave-one-out, and the two label rules.
 *
 * The arithmetic the engine does with a profile is pinned in `packages/tree/__tests__/unit/label-prior.test.ts`.
 * What is pinned HERE is where the profile comes from, because that is the half a cell table cannot audit: a pool
 * that included the case it scores, or a history whose size is not the number of incidents it holds, produces a
 * perfectly well-formed prior and a reading that is hindsight.
 *
 * @module __tests__/label-prior-profiles
 */

import { describe, expect, it } from 'vitest';

import {
  buildSystemHistories,
  buildSystemLabelPrior,
  priorExcludingTruth,
  withLabelPrior,
  type LabelledCase,
} from '../src/label-prior-profiles.js';

function labelled(caseId: string, system: string, accepted: readonly string[]): LabelledCase {
  return { caseId, system, accepted };
}

describe('buildSystemHistories', () => {
  it('counts each system separately', () => {
    const histories = buildSystemHistories([
      labelled('1', 'shop', ['a']),
      labelled('2', 'shop', ['a']),
      labelled('3', 'shop', ['b']),
      labelled('4', 'ticket', ['c']),
    ]);
    expect(histories.get('shop')?.counts.get('a')).toBe(2);
    expect(histories.get('shop')?.counts.get('b')).toBe(1);
    expect(histories.get('shop')?.labelled).toBe(3);
    expect(histories.get('ticket')?.labelled).toBe(1);
  });

  it('counts a multi-label case ONCE, against its primary label', () => {
    // A network fault injected on an edge has two accepted answers. Counting the case once per accepted service
    // would make the history larger than the number of incidents it holds — which is the denominator `p` divides
    // by — so the rule is one incident, one answer, in the corpus's own order.
    const histories = buildSystemHistories([labelled('1', 'shop', ['a', 'b'])]);
    expect(histories.get('shop')?.labelled).toBe(1);
    expect(histories.get('shop')?.counts.get('a')).toBe(1);
    expect(histories.get('shop')?.counts.get('b')).toBeUndefined();
  });

  it('skips a case with no accepted answer instead of counting it as a zero', () => {
    const histories = buildSystemHistories([
      labelled('1', 'shop', []),
      labelled('2', 'shop', ['a']),
    ]);
    expect(histories.get('shop')?.labelled).toBe(1);
    expect([...(histories.get('shop')?.counts.keys() ?? [])]).toEqual(['a']);
  });

  it('reports nothing for a population with no labels at all', () => {
    expect([...buildSystemHistories([labelled('1', 'shop', [])])]).toEqual([]);
  });
});

describe('priorExcludingTruth', () => {
  const histories = buildSystemHistories([
    labelled('1', 'shop', ['a']),
    labelled('2', 'shop', ['a']),
    labelled('3', 'shop', ['b']),
  ]);

  it('removes the case itself from its own history', () => {
    // The whole point of the construction: `p` estimates how often a service is the answer ELSEWHERE.
    const prior = priorExcludingTruth(histories, 'shop', 'a');
    expect(prior.counts.get('a')).toBe(1);
    expect(prior.counts.get('b')).toBe(1);
    expect(prior.labelled).toBe(2);
  });

  it('deletes the entry rather than storing a zero when the case was the only incident', () => {
    // A stored zero is not the same statement as an absent entry: the map means "has been the answer somewhere
    // else", and a zero would claim a measurement over a history that holds none.
    const thin = buildSystemHistories([labelled('1', 'shop', ['a'])]);
    const prior = priorExcludingTruth(thin, 'shop', 'a');
    expect(prior.counts.has('a')).toBe(false);
    expect(prior.labelled).toBe(0);
  });

  it('leaves the history whole when the corpus labels the case with nothing', () => {
    const prior = priorExcludingTruth(histories, 'shop', undefined);
    expect(prior.labelled).toBe(3);
    expect(prior.counts.get('a')).toBe(2);
  });

  it('honours a claim that the case belongs to a system whose history never recorded it', () => {
    // The contract the branch at `counts.get(truth) ?? 0` encodes, written out because nothing else states it: the
    // caller is trusted about MEMBERSHIP. `run-rcaeval` reads the history from the corpus's case directories and the
    // truth from the loader, and the two are different surfaces — so "this case's system is `shop`" and "`shop`'s
    // history holds this answer" are two assertions, and only the first one is the caller's to make.
    //
    // The consequence is asserted in full rather than left to the code: the COUNTS are untouched (deleting an
    // absent key is a no-op, which is the honest answer — the history never claimed this incident), and the
    // DENOMINATOR still drops by one (the caller said the incident is inside this system, so the population it was
    // drawn from is one smaller). A test that asserted only the first half would pass while the second half was a
    // silent `-0`.
    const prior = priorExcludingTruth(histories, 'shop', 'never-recorded');
    expect(prior.counts.get('a')).toBe(2);
    expect(prior.counts.get('b')).toBe(1);
    expect(prior.counts.has('never-recorded')).toBe(false);
    expect(prior.labelled).toBe(2);
  });

  it('reads a system the histories do not hold as an empty history rather than throwing', () => {
    // A corpus can carry a system whose only case is the one being scored, and a throw there would fail a run over a
    // corpus shape rather than over a defect.
    const prior = priorExcludingTruth(histories, 'unknown', 'a');
    expect(prior.labelled).toBe(0);
    expect(prior.counts.size).toBe(0);
  });
});

describe('buildSystemLabelPrior', () => {
  it('keys EVERY case, including the ones with no label and the ones alone in their system', () => {
    // The engine's own lookup is written as a total one (`!`), so a missing key would be a crash rather than a
    // fallback — and a fallback would be a silent "no history" where the truth is "a history of one".
    const cases = [
      labelled('1', 'shop', ['a']),
      labelled('2', 'shop', []),
      labelled('3', 'lonely', ['b']),
    ];
    const priors = buildSystemLabelPrior(cases);
    expect([...priors.keys()].sort()).toEqual(['1', '2', '3']);
    expect(priors.get('2')?.labelled).toBe(1);
    expect(priors.get('3')?.labelled).toBe(0);
  });

  it('agrees with the history-then-exclude path it is built from', () => {
    const cases = [labelled('1', 'shop', ['a']), labelled('2', 'shop', ['b'])];
    const histories = buildSystemHistories(cases);
    const priors = buildSystemLabelPrior(cases);
    expect(priors.get('1')).toEqual(priorExcludingTruth(histories, 'shop', 'a'));
    expect(priors.get('2')).toEqual(priorExcludingTruth(histories, 'shop', 'b'));
  });
});

describe('withLabelPrior', () => {
  it('attaches each profile to its own case and leaves the others untouched', () => {
    const priors = buildSystemLabelPrior([
      labelled('1', 'shop', ['a']),
      labelled('2', 'shop', ['b']),
    ]);
    const cases = [
      { id: '1', keep: 'one' },
      { id: '2', keep: 'two' },
    ];
    const attached = withLabelPrior(cases, priors);
    expect(attached[0]?.labelPrior).toBe(priors.get('1'));
    expect(attached[1]?.labelPrior).toBe(priors.get('2'));
    expect(attached[0]?.keep).toBe('one');
  });

  it('returns a case the map does not hold unchanged, by identity', () => {
    // Identity rather than deep equality: the shipped run must score the objects the loader built, and a copy that
    // happened to be equal would make "the suite carries no prior" unobservable to a caller holding a reference.
    const one = { id: 'missing' };
    expect(withLabelPrior([one], new Map())[0]).toBe(one);
  });
});
