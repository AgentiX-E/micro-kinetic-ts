/**
 * The causal-depth slice's own tests.
 *
 * This module exists because two different quantities were both called "depth" in this repository, and the confusion
 * had a price: `ranking-depth.ts` measures where the truth sat in the ranking (a property of our answer), while the
 * leader's stratified table measures how far the fault sat from the entry (a property of the CASE). A rule about the
 * second cannot be bought with a dispatch that measures the first, so the properties asserted here are the ones that
 * keep the two apart: the depth is the SMALLEST distance over a possibly multi-service truth, a case the entry cannot
 * reach is named rather than dropped, and the table's shares are the reading and nothing else.
 */

import { describe, expect, it } from 'vitest';

import {
  causalDepthOf,
  formatSliceReport,
  sliceByCausalDepth,
  type SliceRow,
} from '../src/causal-depth-slice.js';
import { distancesFrom, type CallGraph } from '../src/channel-ancestry.js';

/** A chain entry -> mid -> deep, plus a sibling the entry also calls. */
const chain: CallGraph = {
  edges: [
    ['entry', 'sibling'],
    ['entry', 'mid'],
    ['mid', 'deep'],
  ],
};

/** One case's row, with everything the slice reads. */
function row(overrides: Partial<SliceRow> = {}): SliceRow {
  return {
    datapack: 'case-a',
    truth: ['mid'],
    answer: 'mid',
    ...overrides,
  };
}

describe('causalDepthOf', () => {
  it('reads the distance the entry needs to reach the truth', () => {
    const distances = distancesFrom(chain, 'entry');
    expect(causalDepthOf(distances, ['deep'])).toBe(2);
    expect(causalDepthOf(distances, ['sibling'])).toBe(1);
  });

  it('reads the SMALLEST distance when the truth names several services', () => {
    const distances = distancesFrom(chain, 'entry');
    // A multi-service truth is common in this corpus (`['mysql', 'ts-order-service']`), and the case is as shallow as
    // its easiest member: taking the deepest would move cases into the hard slice on the strength of one label.
    expect(causalDepthOf(distances, ['deep', 'mid'])).toBe(1);
    expect(causalDepthOf(distances, ['deep', 'sibling'])).toBe(1);
  });

  it('answers null when no member of the truth is reachable, rather than a large number', () => {
    const distances = distancesFrom(chain, 'entry');
    expect(causalDepthOf(distances, ['outside'])).toBeNull();
  });

  it('answers null for an empty truth, because there is no depth to read', () => {
    expect(causalDepthOf(distancesFrom(chain, 'entry'), [])).toBeNull();
  });
});

describe('sliceByCausalDepth', () => {
  it('tabulates every depth in ascending order with its own share', () => {
    const rows: readonly SliceRow[] = [
      row({ datapack: 'a', truth: ['deep'], answer: 'deep' }),
      row({ datapack: 'b', truth: ['mid'], answer: 'deep' }),
      row({ datapack: 'c', truth: ['mid'], answer: 'mid' }),
      row({ datapack: 'd', truth: ['entry'], answer: 'entry' }),
    ];
    const report = sliceByCausalDepth(rows, () => chain, 'entry');
    expect(report.readings).toEqual([
      { depth: 0, cases: 1, correct: 1, misses: 0, share: '100.00' },
      { depth: 1, cases: 2, correct: 1, misses: 1, share: '50.00' },
      { depth: 2, cases: 1, correct: 1, misses: 0, share: '100.00' },
    ]);
    expect(report.unattached).toEqual([]);
  });

  it('orders the table ascending even when the cases arrive out of order', () => {
    // Four depths, interleaved twice: the arrangement that makes the sort's descending arm actually run. Three keys
    // do not, because the insertion sort compares only ascending pairs at that size — so a two-key test would have
    // measured one arm and claimed the comparator.
    const deep: CallGraph = {
      edges: [
        ['entry', 's1'],
        ['s1', 's2'],
        ['s2', 's3'],
      ],
    };
    const order = ['entry', 's1', 's2', 's3', 'entry', 's1', 's2', 's3'];
    const rows: readonly SliceRow[] = order.map((service, index) =>
      row({ datapack: `c${index}`, truth: [service] }),
    );
    const depths = sliceByCausalDepth(rows, () => deep, 'entry').readings.map((one) => one.depth);
    expect(depths).toEqual([0, 1, 2, 3]);
  });

  it('counts a case whose answer is null as a miss, not as an absence', () => {
    const report = sliceByCausalDepth([row({ answer: null })], () => chain, 'entry');
    expect(report.readings[0]).toEqual({
      depth: 1,
      cases: 1,
      correct: 0,
      misses: 1,
      share: '0.00',
    });
  });

  it('counts a case as correct when the answer is any member of the truth', () => {
    const report = sliceByCausalDepth(
      [row({ truth: ['mid', 'deep'], answer: 'deep' })],
      () => chain,
      'entry',
    );
    expect(report.readings[0]!.correct).toBe(1);
  });

  it('names an unreachable case instead of dropping it, even when its answer is right', () => {
    const report = sliceByCausalDepth(
      [row({ datapack: 'orphan', truth: ['outside'], answer: 'outside' })],
      () => chain,
      'entry',
    );
    expect(report.readings).toEqual([]);
    // The row is not a reading and it is not a silence: `unattached` is what keeps a slice table from claiming a
    // denominator it does not have.
    expect(report.unattached).toEqual(['orphan']);
  });

  it('names the case whose graph is missing, because a slice table cannot read it either', () => {
    const report = sliceByCausalDepth(
      [row({ datapack: 'graphed' }), row({ datapack: 'graphless' })],
      (datapack) => (datapack === 'graphed' ? chain : null),
      'entry',
    );
    expect(report.readings).toHaveLength(1);
    expect(report.unattached).toEqual(['graphless']);
  });

  it('reports the population it read beside the slices, so a share has a denominator', () => {
    const rows: readonly SliceRow[] = [
      row({ datapack: 'a', answer: 'mid' }),
      row({ datapack: 'b', answer: null }),
      row({ datapack: 'c', truth: ['outside'] }),
    ];
    const report = sliceByCausalDepth(rows, () => chain, 'entry');
    expect(report.rows).toBe(3);
    expect(report.answered).toBe(1);
    expect(report.correct).toBe(1);
  });
});

describe('formatSliceReport', () => {
  it('renders one line per depth and a total that matches the arithmetic', () => {
    const report = sliceByCausalDepth(
      [
        row({ datapack: 'a', truth: ['deep'], answer: 'deep' }),
        row({ datapack: 'b', truth: ['mid'], answer: 'deep' }),
      ],
      () => chain,
      'entry',
    );
    const text = formatSliceReport(report, 'entry');
    expect(text).toContain('Causal depth from entry `entry` (cases=2, answered=2, correct=1)');
    // The whole line, not a fragment of it: a share that lands in the wrong column is the failure this guards.
    expect(text).toMatch(/^\s+1\s+1\s+0\s+1\s+0\.00$/m);
    expect(text).toMatch(/^\s+2\s+1\s+1\s+0\s+100\.00$/m);
  });

  it('says when there is nothing unattached rather than printing an empty list', () => {
    const report = sliceByCausalDepth([row()], () => chain, 'entry');
    expect(formatSliceReport(report, 'entry')).toContain('unattached 0');
  });

  it('counts unattached cases in the footer when there are some', () => {
    const report = sliceByCausalDepth([row({ truth: ['outside'] })], () => chain, 'entry');
    expect(formatSliceReport(report, 'entry')).toContain('unattached 1');
  });
});
