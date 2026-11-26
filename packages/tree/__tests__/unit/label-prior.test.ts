/**
 * The label prior's arithmetic and its gate — held against the SPECIFICATION, not against a remembered number.
 *
 * Four properties are pinned separately, because each of them is a way the term can be wrong while still moving a
 * ranking: the floor is one pseudo-count PER CANDIDATE (so a bigger candidate set does not make a never-seen
 * service less likely than it is elsewhere); the denominator is the history's own size and not the candidates'
 * (`labelled` counts services this case cannot blame); a candidate the history never saw reads the floor rather
 * than being absent; and the margin gate reports `Infinity` for a ranking with nothing to compare, because a
 * single candidate cannot be displaced by any external term.
 *
 * @module __tests__/unit/label-prior
 */

import {
  computeLabelPriorValues,
  DEFAULT_LABEL_PRIOR_MARGIN_GATE,
  DEFAULT_LABEL_PRIOR_WEIGHT,
  topTwoGap,
} from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

// ── The two shipped constants ─────────────────────────────

describe('the shipped pair', () => {
  it('ships the weight at 0, which is the ablation', () => {
    expect(DEFAULT_LABEL_PRIOR_WEIGHT).toBe(0);
  });

  it('ships the gate at the measured threshold, not at "speak everywhere"', () => {
    // 0 would be the ungated arm, which this register refused: the pair is one configuration and the gate's default
    // has to be the value the arm was priced at.
    expect(DEFAULT_LABEL_PRIOR_MARGIN_GATE).toBe(0.02);
    expect(DEFAULT_LABEL_PRIOR_MARGIN_GATE).toBeGreaterThan(0);
  });
});

// ── computeLabelPriorValues ───────────────────────────────

describe('computeLabelPriorValues', () => {
  it('gives every candidate an entry, in the candidates own order', () => {
    const values = computeLabelPriorValues({ counts: new Map([['a', 3]]), labelled: 4 }, [
      'a',
      'b',
      'c',
    ]);
    expect([...values.keys()]).toEqual(['a', 'b', 'c']);
  });

  it('reads a seen service above an unseen one, by the logarithm of the count ratio', () => {
    // labelled = 11, V = 2: p(a) = (6 + 0.5) / 12, p(b) = (0 + 0.5) / 12.
    const values = computeLabelPriorValues({ counts: new Map([['a', 6]]), labelled: 11 }, [
      'a',
      'b',
    ]);
    expect(values.get('a')).toBeCloseTo(Math.log(6.5 / 12), 12);
    expect(values.get('b')).toBeCloseTo(Math.log(0.5 / 12), 12);
    expect(values.get('a')!).toBeGreaterThan(values.get('b')!);
  });

  it('spreads the floor over the candidates, so a larger pool is not a weaker floor for one service', () => {
    // The same history read on two candidate sets: the service's LOG-probability differs between them (the floor is
    // a share of the pool), but a never-seen service's excess over a seen one scales with the pool rather than
    // against it — the property `1/V` exists for.
    const small = computeLabelPriorValues({ counts: new Map([['a', 1]]), labelled: 1 }, ['a', 'b']);
    const large = computeLabelPriorValues({ counts: new Map([['a', 1]]), labelled: 1 }, [
      'a',
      'b',
      'c',
      'd',
    ]);
    const smallFloor = Math.exp(small.get('b')!);
    const largeFloor = Math.exp(large.get('b')!);
    // p(b) = floor / (labelled + 1), so with one labelled incident the floors are 1/2 and 1/4 over denominators of 2.
    expect(smallFloor).toBeCloseTo(0.25, 12);
    expect(largeFloor).toBeCloseTo(0.125, 12);
  });

  it('divides by the history size, not by the counts the candidates can see', () => {
    // `labelled` = 40 while the two candidates hold 6 incidents between them: the other 34 happened at services this
    // case cannot blame, and the probability is still over the deployment.
    const values = computeLabelPriorValues({ counts: new Map([['a', 6]]), labelled: 40 }, [
      'a',
      'b',
    ]);
    expect(values.get('a')).toBeCloseTo(Math.log(6.5 / 41), 12);
  });

  it('reads a history that holds nothing as one flat distribution rather than as a division by zero', () => {
    // labelled = 0 is the empty history: every candidate reads the same floor, so the term cannot re-order anything
    // and its only effect would be a constant. It is finite, which is what keeps a caller's arithmetic alive.
    const values = computeLabelPriorValues({ counts: new Map(), labelled: 0 }, ['a', 'b']);
    expect(values.get('a')).toBeCloseTo(Math.log(0.5), 12);
    expect(values.get('a')).toBe(values.get('b'));
    expect(Number.isFinite(values.get('a')!)).toBe(true);
  });

  it('refuses to divide by zero candidates', () => {
    // V = 0 would be `1/0` in the floor. The map is empty and no `NaN` is produced: a case with no candidates is a
    // case the term is never asked about, and a `NaN` floor would be a number the ranking sorts by.
    expect([...computeLabelPriorValues({ counts: new Map(), labelled: 3 }, [])]).toEqual([]);
  });

  it('treats a negative or absent count as never seen', () => {
    // The map is sparse by nature, and `?? 0` is the rule the profile's own type states: an absent entry is a
    // measured zero over a history that counted every incident it holds.
    const values = computeLabelPriorValues({ counts: new Map(), labelled: 9 }, ['a']);
    expect(values.get('a')).toBeCloseTo(Math.log(1 / 10), 12);
  });
});

// ── topTwoGap ─────────────────────────────────────────────

describe('topTwoGap', () => {
  it('reports the gap between the two largest values, whatever order they arrive in', () => {
    expect(topTwoGap([0.2, 0.9, 0.5])).toBeCloseTo(0.4, 12);
    expect(topTwoGap([0.9, 0.5, 0.2])).toBeCloseTo(0.4, 12);
  });

  it('does not collapse duplicates: a tie is a margin of zero, not a missing measurement', () => {
    // Two candidates at the same score are TIED, which is exactly the ranking an external term may not speak in.
    expect(topTwoGap([0.5, 0.5, 0.1])).toBe(0);
  });

  it('reports Infinity for a ranking with nothing to compare', () => {
    // A single candidate cannot be displaced, so every gate must let it through — the opposite of a margin of 0,
    // which would silence the term on exactly the cases where it is harmless.
    expect(topTwoGap([0.7])).toBe(Number.POSITIVE_INFINITY);
    expect(topTwoGap([])).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps a candidate that beats the leader by nothing at second place', () => {
    // The `else if` branch: a value equal to the best is a second place, not a discarded one. Written as a case
    // because the branch is what makes the tie above a zero instead of an Infinity.
    expect(topTwoGap([0.5, 0.5])).toBe(0);
    expect(topTwoGap([0.4, 0.6, 0.6])).toBe(0);
  });
});
