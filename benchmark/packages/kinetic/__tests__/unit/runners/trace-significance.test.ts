/**
 * Unit tests for the trace candidate's scale-free significance.
 *
 * `traceSignificanceOf` answers the question four refused refinements left standing: at what magnitude did this
 * service's span count move, measured against the movement the fleet itself would have produced? The ratio the
 * rule reads cannot answer it — 17% at 1 800 spans and 17% at 12 000 are the same number and nothing like the same
 * event — so every test below pins a property of the normalisation rather than a value it happens to produce:
 *
 * - a service that follows the fleet EXACTLY has `z = 0`, whatever the drift is;
 * - a single measured service cannot be its own anomaly, so a one-service population is also `z = 0`;
 * - the drift is the pre-WEIGHTED median, so many tiny services cannot outvote the traffic between them;
 * - a service with no baseline has no `z` — it is absent, not zero, because `post - 0` over `sqrt(0)` is not a
 *   quantity;
 * - the population is the RANKING's population, so a service the call graph does not carry moves nothing.
 *
 * @module __tests__/unit/runners/trace-significance
 */

import { describe, expect, it } from 'vitest';

import { traceSignificanceOf } from '../../../src/benchmarks/runners/trace-significance.js';

const nodes = (...ids: string[]): ReadonlySet<string> => new Set(ids);

describe('traceSignificanceOf', () => {
  it('reports nothing when the case carries no span counts', () => {
    expect(traceSignificanceOf({ nodeIds: nodes('a'), truth: 'a' })).toBeUndefined();
    expect(
      traceSignificanceOf({ traceActivity: new Map(), nodeIds: nodes('a'), truth: 'a' }),
    ).toBeUndefined();
  });

  it('reports nothing when no graph member carries a pre-injection baseline', () => {
    // The trace file exists and has spans — all of them after the injection. There is no rate to normalise against.
    const activity = new Map([['a', { pre: 0, post: 5000 }]]);
    expect(
      traceSignificanceOf({ traceActivity: activity, nodeIds: nodes('a'), truth: 'a' }),
    ).toBeUndefined();
  });

  it('reports nothing when the post-injection total is zero — there is no rate to normalise against', () => {
    const activity = new Map([
      ['a', { pre: 100, post: 0 }],
      ['b', { pre: 100, post: 0 }],
    ]);
    expect(
      traceSignificanceOf({ traceActivity: activity, nodeIds: nodes('a', 'b'), truth: 'a' }),
    ).toBeUndefined();
  });

  it('gives z = 0 to a service that follows the fleet exactly', () => {
    // Both doubled: the fleet's common mode is 2, so neither moved relative to the fleet.
    const activity = new Map([
      ['a', { pre: 1000, post: 2000 }],
      ['b', { pre: 1000, post: 2000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('a', 'b'),
      truth: 'a',
    });

    expect(axis?.drift).toBe(2);
    expect(axis?.ranked.map((e) => e.z)).toEqual([0, 0]);
    expect(axis?.truth?.z).toBe(0);
    expect(axis?.truthRank).toBe(1);
  });

  it('gives z = 0 to the only measured service — it is the whole fleet, so it cannot deviate from it', () => {
    const activity = new Map([['a', { pre: 1770, post: 2480 }]]);
    const axis = traceSignificanceOf({ traceActivity: activity, nodeIds: nodes('a'), truth: 'a' });

    expect(axis?.drift).toBe(2480 / 1770);
    expect(axis?.ranked[0]?.z).toBe(0);
  });

  it('measures a rise above the fleet in units of its own fluctuation', () => {
    // Drift is 1 (the two quiet services are flat and carry the median span), so the riser's expected count is its
    // own baseline and z = (3000 - 1000) / sqrt(1000).
    const activity = new Map([
      ['quiet-1', { pre: 5000, post: 5000 }],
      ['quiet-2', { pre: 5000, post: 5000 }],
      ['riser', { pre: 1000, post: 3000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('quiet-1', 'quiet-2', 'riser'),
      truth: 'riser',
    });

    expect(axis?.drift).toBe(1);
    const riser = axis?.ranked[0];
    expect(riser?.service).toBe('riser');
    expect(riser?.expected).toBe(1000);
    expect(riser?.z).toBeCloseTo(2000 / Math.sqrt(1000), 12);
    expect(axis?.truthRank).toBe(1);
  });

  it('measures a FALL as a negative z of the same magnitude — a deviation is two-sided', () => {
    // The five TrainTicket route misses are this shape: the truth's count went DOWN (0.82-0.94 on pre ~= 12 000)
    // while a mid-volume victim rose, so a rise-only axis cannot see them at all.
    const activity = new Map([
      ['quiet', { pre: 1000, post: 1000 }],
      ['source', { pre: 12000, post: 11000 }],
      ['victim', { pre: 1000, post: 1000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('quiet', 'source', 'victim'),
      truth: 'source',
    });

    const source = axis?.truth;
    expect(source?.expected).toBe(12000);
    expect(source?.z).toBeCloseTo(-1000 / Math.sqrt(12000), 12);
    // The largest |z| in the cell, because a thousand missing spans on a twelve-thousand baseline is loud — and
    // because the drift is an unweighted median, which the source cannot move however many spans it carries.
    expect(axis?.truthRank).toBe(1);
  });

  it('does not let the largest service define the fleet common mode', () => {
    // Four flat services hold the median at 1; the fifth carries 500x their traffic and halves. A volume ratio would
    // report 0.83 and normalise the fall to a third of its size; the median keeps it at 1 and the fall stays loud.
    const activity = new Map([
      ['small-1', { pre: 100, post: 100 }],
      ['small-2', { pre: 100, post: 100 }],
      ['small-3', { pre: 100, post: 100 }],
      ['small-4', { pre: 100, post: 100 }],
      ['huge', { pre: 50000, post: 25000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('small-1', 'small-2', 'small-3', 'small-4', 'huge'),
      truth: 'huge',
    });

    expect(axis?.drift).toBe(1);
    expect(axis?.truth?.expected).toBe(50000);
    expect(axis?.truth?.z).toBeCloseTo(-25000 / Math.sqrt(50000), 12);
  });

  it('orders by magnitude, then by sign, and keeps the population order between equals', () => {
    const activity = new Map([
      ['base', { pre: 10000, post: 10000 }],
      ['down', { pre: 1000, post: 400 }],
      ['up', { pre: 1000, post: 1600 }],
      ['tie-a', { pre: 1000, post: 1600 }],
      ['flat', { pre: 1000, post: 1000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('base', 'down', 'up', 'tie-a', 'flat'),
      truth: 'base',
    });

    // `up` and `tie-a` carry identical evidence and `up` comes first in the node set, so the sort's guaranteed
    // stability keeps that order; the rise precedes the equal fall because the sign arm precedes stability, and the
    // flat services close the list.
    expect(axis?.ranked.map((e) => e.service)).toEqual(['up', 'tie-a', 'down', 'base', 'flat']);
  });

  it('averages the two middle ratios when the population is even', () => {
    const activity = new Map([
      ['a', { pre: 100, post: 100 }],
      ['b', { pre: 100, post: 100 }],
      ['c', { pre: 100, post: 300 }],
      ['d', { pre: 100, post: 300 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('a', 'b', 'c', 'd'),
      truth: 'a',
    });

    // Ratios 1, 1, 3, 3: the textbook median of an even sample averages the two middle members.
    expect(axis?.drift).toBe(2);
  });

  it('leaves a service with no pre-injection baseline OUT of the population and out of the ranking', () => {
    const activity = new Map([
      ['quiet', { pre: 1000, post: 1000 }],
      ['cold-start', { pre: 0, post: 900 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('quiet', 'cold-start'),
      truth: 'cold-start',
    });

    expect(axis?.ranked.map((e) => e.service)).toEqual(['quiet']);
    // The truth is not in the population, so it has no place in the ordering — absent, not last.
    expect(axis?.truth).toBeUndefined();
    expect(axis?.truthRank).toBeUndefined();
  });

  it('leaves a graph member the count map does not name OUT of the population', () => {
    // The loader writes a row only for a service that appeared in a span, so a silent graph member is ABSENT from
    // the map rather than present with zeros — the difference between "emitted nothing" and "has no baseline".
    const activity = new Map([
      ['a', { pre: 1000, post: 1000 }],
      ['b', { pre: 1000, post: 1000 }],
      ['c', { pre: 1000, post: 1000 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('a', 'b', 'c', 'silent'),
      truth: 'silent',
    });

    expect(axis?.ranked.map((e) => e.service)).toEqual(['a', 'b', 'c']);
    expect(axis?.truth).toBeUndefined();
  });

  it('measures only the services the call graph carries', () => {
    // `outside` has counts but is not a graph member: it cannot be ranked, so it must not enter the drift either.
    // Were it counted, the median of ratios {1, 90} would be 45.5 and `a` would look like a 45x collapse.
    const activity = new Map([
      ['a', { pre: 1000, post: 1000 }],
      ['outside', { pre: 1000, post: 90000 }],
    ]);
    const axis = traceSignificanceOf({ traceActivity: activity, nodeIds: nodes('a'), truth: 'a' });

    expect(axis?.drift).toBe(1);
    expect(axis?.ranked.map((e) => e.service)).toEqual(['a']);
    expect(axis?.truth?.z).toBe(0);
  });

  it('shares a rank between services that are equally significant', () => {
    const activity = new Map([
      ['anchor-1', { pre: 1000, post: 1000 }],
      ['anchor-2', { pre: 1000, post: 1000 }],
      ['anchor-3', { pre: 1000, post: 1000 }],
      ['truth', { pre: 1000, post: 1600 }],
      ['twin', { pre: 1000, post: 1600 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes('anchor-1', 'anchor-2', 'anchor-3', 'truth', 'twin'),
      truth: 'truth',
    });

    expect(axis?.truth?.z).toBeCloseTo(600 / Math.sqrt(1000), 12);
    expect(axis?.truthRank).toBe(1);
  });

  it('ranks the truth behind every strictly louder service', () => {
    const activity = new Map([
      ['flat-1', { pre: 1000, post: 1000 }],
      ['flat-2', { pre: 1000, post: 1000 }],
      ['flat-3', { pre: 1000, post: 1000 }],
      ['flat-4', { pre: 1000, post: 1000 }],
      ['flat-5', { pre: 1000, post: 1000 }],
      ['flat-6', { pre: 1000, post: 1000 }],
      ['loudest', { pre: 1000, post: 5000 }],
      ['louder', { pre: 1000, post: 2000 }],
      ['truth', { pre: 1000, post: 1200 }],
    ]);
    const axis = traceSignificanceOf({
      traceActivity: activity,
      nodeIds: nodes(
        'flat-1',
        'flat-2',
        'flat-3',
        'flat-4',
        'flat-5',
        'flat-6',
        'loudest',
        'louder',
        'truth',
      ),
      truth: 'truth',
    });

    expect(axis?.drift).toBe(1);
    expect(axis?.ranked.slice(0, 3).map((e) => e.service)).toEqual(['loudest', 'louder', 'truth']);
    expect(axis?.truthRank).toBe(3);
  });
});
