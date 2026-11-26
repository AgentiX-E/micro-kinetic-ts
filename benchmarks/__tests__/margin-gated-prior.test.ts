/**
 * Unit tests for the margin-gated label prior: the arm that lets an external term speak only where the ranking has room.
 *
 * Every reading here has a way of being silently wrong, and each is asserted by name: a prior that includes the case
 * it scores (a leak), a prior smoothed by a constant instead of `1/V` (a floor that depends on pool size), a gate read
 * from the gated score (the arm deciding whether the arm runs), a margin taken from the wrong pair of candidates, and
 * a case with no label counted as a zero-frequency observation.
 *
 * @module benchmarks/__tests__/margin-gated-prior
 */

import { describe, expect, it } from 'vitest';

import type { FlagCandidate, FlagCase } from '../src/dual-family-membership.js';
import {
  gatedPriorArm,
  labelPrior,
  PRIOR_ARMS,
  topMargin,
  type PriorScope,
} from '../src/margin-gated-prior.js';

/**
 * A candidate; `member` is irrelevant here and fixed, so a test never states it.
 *
 * @param serviceId - Its id.
 * @param score - Its score.
 * @returns The candidate.
 */
function candidate(serviceId: string, score: number): FlagCandidate {
  return { serviceId, score, dual: 0, member: false };
}

/**
 * A case.
 *
 * @param caseId - Its id.
 * @param cell - Its cell.
 * @param order - Its ranking.
 * @param accepted - Its accepted root causes.
 * @returns The case.
 */
function flagCase(
  caseId: string,
  cell: string,
  order: readonly FlagCandidate[],
  accepted?: readonly string[],
): FlagCase {
  return { caseId, cell, accepted: accepted ?? [order[order.length - 1]!.serviceId], order };
}

describe('the top margin', () => {
  it('is the gap between the first two candidates, not between the first and the last', () => {
    expect(topMargin([candidate('a', 2), candidate('b', 1.5), candidate('c', 0)])).toBeCloseTo(
      0.5,
      12,
    );
  });

  it('is infinite for a single candidate, because nothing can displace it', () => {
    expect(topMargin([candidate('a', 1)])).toBe(Number.POSITIVE_INFINITY);
    expect(topMargin([])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('the label prior', () => {
  const population = [
    flagCase('1', 's/c', [candidate('a', 3), candidate('b', 2)], ['a']),
    flagCase('2', 's/c', [candidate('a', 3), candidate('b', 2)], ['a']),
    flagCase('3', 's/c', [candidate('a', 3), candidate('b', 2)], ['b']),
  ];

  it('never counts the case it is scoring, so a case cannot inform its own prior', () => {
    // Case 1 excludes itself: one `a` and one `b` remain, and with `1/V = 0.5` and denominator 3 the two are equal.
    const prior = labelPrior(population, 'cell').get('1')!;
    expect(prior.get('a')).toBeCloseTo(prior.get('b')!, 12);
    // Case 3 excludes itself too: two `a` and no `b` remain, so `a` is favoured.
    const third = labelPrior(population, 'cell').get('3')!;
    expect(third.get('a')!).toBeGreaterThan(third.get('b')!);
  });

  it('smooths by one pseudo-count spread over the candidates, so the floor scales with the pool', () => {
    const narrow = [flagCase('x', 's/c', [candidate('a', 1), candidate('b', 0)], ['b'])];
    const wide = [
      flagCase(
        'x',
        's/c',
        [candidate('a', 1), ...Array.from({ length: 9 }, (_, i) => candidate(`f${i}`, 0))],
        ['b'],
      ),
    ];
    // One labelled neighbour is enough to be a pool; the unseen `a` must not read the same in both, because the same
    // pseudo-count over ten candidates is a smaller probability than over two.
    const narrowPrior = labelPrior(
      [...narrow, flagCase('y', 's/c', [candidate('a', 1), candidate('b', 0)], ['b'])],
      'cell',
    ).get('x')!;
    const widePrior = labelPrior(
      [...wide, flagCase('y', 's/c', [candidate('a', 1), candidate('b', 0)], ['b'])],
      'cell',
    ).get('x')!;
    expect(narrowPrior.get('a')!).toBeGreaterThan(widePrior.get('a')!);
  });

  it('pools by SYSTEM or by CELL, and the two differ exactly when a system carries two categories', () => {
    const twoCategories = [
      flagCase('1', 's/one', [candidate('a', 2), candidate('b', 1)], ['a']),
      flagCase('2', 's/two', [candidate('a', 2), candidate('b', 1)], ['b']),
    ];
    // By cell, case 2 has no neighbour at all: both candidates get the bare floor.
    const byCell = labelPrior(twoCategories, 'cell').get('2')!;
    expect(byCell.get('a')).toBeCloseTo(byCell.get('b')!, 12);
    // By system it learns from case 1, whose answer was `a`.
    const bySystem = labelPrior(twoCategories, 'system').get('2')!;
    expect(bySystem.get('a')!).toBeGreaterThan(bySystem.get('b')!);
  });

  it('ignores a neighbour with no accepted label instead of counting it as a zero', () => {
    const cases = [
      flagCase('1', 's/c', [candidate('a', 2), candidate('b', 1)], ['a']),
      {
        caseId: '2',
        cell: 's/c',
        accepted: [],
        order: [candidate('a', 2), candidate('b', 1)],
      } as FlagCase,
      flagCase('3', 's/c', [candidate('a', 2), candidate('b', 1)], ['a']),
    ];
    const prior = labelPrior(cases, 'cell').get('3')!;
    // Two labelled neighbours both said `a`; the unlabelled one changed nothing.
    expect(prior.get('a')!).toBeGreaterThan(prior.get('b')!);
  });

  it('pools a cell name with no separator by itself, so the system scope also works on an un-categorised corpus', () => {
    // `system` scope reads the part before the first `/`. A corpus that names no categories hands over a bare system
    // name, and that must pool that name rather than throw or silently pool everything.
    const cases = [
      flagCase('1', 'boutique', [candidate('a', 2), candidate('b', 1)], ['a']),
      flagCase('2', 'boutique', [candidate('a', 2), candidate('b', 1)], ['b']),
      flagCase('3', 'trainticket', [candidate('a', 2), candidate('b', 1)], ['b']),
    ];
    const prior = labelPrior(cases, 'system').get('2')!;
    // It learns from case 1 (same system, answer `a`) and NOT from case 3 (a different system, answer `b`).
    expect(prior.get('a')!).toBeGreaterThan(prior.get('b')!);
  });

  it('sums to one over a case’s own candidates', () => {
    const prior = labelPrior(population, 'cell').get('1')!;
    expect([...prior.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

describe('the gated arm', () => {
  it('is the identity at beta 0, so an arm reporting movement there is measuring its own bug', () => {
    const cases = [
      flagCase('1', 's/c', [candidate('w', 3), candidate('t', 2)], ['t']),
      flagCase('2', 's/c', [candidate('t', 3), candidate('w', 2)], ['t']),
      flagCase('3', 's/c', [candidate('t', 3), candidate('w', 2)], ['t']),
    ];
    const arm = gatedPriorArm(cases, { beta: 0, tau: 0, scope: 'cell' });
    expect(arm.correct).toEqual([false, true, true]);
  });

  it('does nothing at all when the margin is under tau, which is the whole point of the gate', () => {
    // A narrow head (0.01) and a prior that would clearly reorder it.
    const cases = [
      flagCase('1', 's/c', [candidate('w', 3), candidate('t', 2.99)], ['t']),
      flagCase('2', 's/c', [candidate('t', 3), candidate('w', 2)], ['t']),
      flagCase('3', 's/c', [candidate('t', 3), candidate('w', 2)], ['t']),
    ];
    const gated = gatedPriorArm(cases, { beta: 0.5, tau: 0.05, scope: 'cell' });
    const ungated = gatedPriorArm(cases, { beta: 0.5, tau: 0, scope: 'cell' });
    // Case 1's margin is 0.01, so the gate keeps it exactly where the engine put it.
    expect(gated.correct[0]).toBe(false);
    // Without the gate the same prior lifts the truth over the winner, which is what the gate is protecting against.
    expect(ungated.correct[0]).toBe(true);
  });

  it('lets the prior speak when the margin clears tau', () => {
    const cases = [
      flagCase('1', 's/c', [candidate('w', 3), candidate('t', 1)], ['t']),
      flagCase('2', 's/c', [candidate('t', 3), candidate('w', 1)], ['t']),
      flagCase('3', 's/c', [candidate('t', 3), candidate('w', 1)], ['t']),
    ];
    const arm = gatedPriorArm(cases, { beta: 2, tau: 0.05, scope: 'cell' });
    expect(arm.correct[0]).toBe(true);
  });

  it('reads the gate from the engine’s margin and not from the score it just gated', () => {
    // A case whose margin is just under tau. If the gate were computed after adding the prior, the prior's own
    // contribution could push the margin over the threshold and let itself in.
    const cases = [
      flagCase('1', 's/c', [candidate('w', 3), candidate('t', 2.96)], ['t']),
      flagCase('2', 's/c', [candidate('t', 3), candidate('w', 1)], ['t']),
      flagCase('3', 's/c', [candidate('t', 3), candidate('w', 1)], ['t']),
    ];
    expect(gatedPriorArm(cases, { beta: 3, tau: 0.05, scope: 'cell' }).correct[0]).toBe(false);
  });

  it('breaks a tie in the engine’s order rather than by service id', () => {
    const one = [flagCase('1', 's/c', [candidate('z', 3), candidate('a', 3)], ['a'])];
    // Both candidates are pooled identically (no neighbour), so the prior is uniform and the order must not move.
    expect(gatedPriorArm(one, { beta: 1, tau: 0, scope: 'cell' }).correct).toEqual([false]);
  });

  it('reports the cells it was given and nothing else', () => {
    const cases = [
      flagCase('1', 'a/one', [candidate('x', 2), candidate('y', 1)], ['y']),
      flagCase('2', 'b/two', [candidate('x', 2), candidate('y', 1)], ['x']),
    ];
    const arm = gatedPriorArm(cases, { beta: 0, tau: 0, scope: 'cell' });
    expect([...arm.cells.keys()].sort()).toEqual(['a/one', 'b/two']);
    expect(arm.cells.get('b/two')).toBe(1);
    expect(arm.overall).toBe(0.5);
  });

  it('answers NaN for an empty population instead of a rate it did not measure', () => {
    expect(gatedPriorArm([], { beta: 0.1, tau: 0, scope: 'cell' }).overall).toBeNaN();
  });
});

describe('the registered grid', () => {
  it('carries the null arm first, so a reader can tell an arm from its baseline', () => {
    expect(PRIOR_ARMS[0]).toEqual({ beta: 0, tau: 0, scope: 'system' });
  });

  it('prices at least one gated arm in each scope, since an ungated number is what the gate exists to replace', () => {
    const scopes: readonly PriorScope[] = ['system', 'cell'];
    for (const scope of scopes) {
      expect(PRIOR_ARMS.some((one) => one.scope === scope && one.tau > 0)).toBe(true);
    }
  });
});
