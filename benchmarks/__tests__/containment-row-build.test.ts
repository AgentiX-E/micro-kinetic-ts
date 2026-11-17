/**
 * The row builder: two arms from one fusion order, and a replay that either matches the published ranking or
 * says so.
 *
 * @module benchmarks/__tests__/containment-row-build.test
 */

import { describe, expect, it } from 'vitest';

import { failureEdgeKey } from '../../packages/tree/src/index.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';

/** A minimal input: one edge, two candidates, one of which is far outside its band. */
function input(overrides: Partial<BuildContainmentRowInput> = {}): BuildContainmentRowInput {
  return {
    datapack: 'dp',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    edges: [{ from: 'frontend', to: 'cart' }],
    excursions: new Map([
      ['frontend', 0],
      ['cart', 2],
    ]),
    failedInterfaces: new Map([[failureEdgeKey('frontend', 'cart'), 4]]),
    failureFlows: undefined,
    failingEdges: undefined,
    attribution: 'shape',
    fusionOrder: ['frontend', 'cart'],
    publishedOrder: ['cart', 'frontend'],
    ...overrides,
  };
}

describe('buildContainmentRow', () => {
  it('inverts the pair in both arms and replays the published order exactly', () => {
    const row = buildContainmentRow(input());
    expect(row.replay).toBe('identical');
    expect(row.fusionTop1).toBe('frontend');
    expect(row.gatedTop1).toBe('cart');
    expect(row.ungatedTop1).toBe('cart');
    expect(row.shippedTop1).toBe('cart');
    expect(row.pairs).toEqual([
      {
        upper: 'frontend',
        lower: 'cart',
        decision: 'inverted',
        upperExcursion: 0,
        lowerExcursion: 2,
      },
    ]);
  });

  it('records a mismatch instead of throwing, so the instrument can be audited', () => {
    const row = buildContainmentRow(input({ publishedOrder: ['frontend', 'cart'] }));
    expect(row.replay).toBe('differs');
    // The row still describes what the sweep did: a refusal to publish would delete the evidence that the
    // observation and the decision disagree.
    expect(row.gatedTop1).toBe('cart');
  });

  it('marks the replay unavailable when the pass could not speak, rather than claiming a match', () => {
    const row = buildContainmentRow(
      input({ excursions: new Map(), publishedOrder: ['frontend', 'cart'] }),
    );
    expect(row.replay).toBe('unavailable');
    expect(row.pairs).toEqual([]);
    expect(row.ungatedPairs).toEqual([]);
  });

  it('marks the replay unavailable when the case carried no edge', () => {
    const row = buildContainmentRow(input({ edges: [] }));
    expect(row.replay).toBe('unavailable');
  });

  it('keeps the two arms apart: no failed interface stops the shipped arm and not the refused one', () => {
    const row = buildContainmentRow(
      input({ failedInterfaces: new Map(), publishedOrder: ['frontend', 'cart'] }),
    );
    expect(row.pairs[0]!.decision).toBe('no-failed-interface');
    expect(row.ungatedPairs[0]!.decision).toBe('inverted');
    expect(row.gatedTop1).toBe('frontend');
    expect(row.ungatedTop1).toBe('cart');
    expect(row.replay).toBe('identical');
  });

  it('treats an ABSENT failed-interface map as the measured "nothing failed" record', () => {
    // `undefined` is the refused arm's input, so a case with no failed-call channel must still supply an empty
    // record — otherwise the shipped arm would silently become the arm §12 refuses.
    const row = buildContainmentRow(
      input({ failedInterfaces: undefined, publishedOrder: ['frontend', 'cart'] }),
    );
    expect(row.pairs[0]!.decision).toBe('no-failed-interface');
    expect(row.replay).toBe('identical');
  });

  it('leaves a pair with no call edge out of both traces', () => {
    const row = buildContainmentRow(
      input({
        edges: [{ from: 'cart', to: 'frontend' }],
        publishedOrder: ['frontend', 'cart'],
      }),
    );
    expect(row.pairs).toEqual([]);
    expect(row.ungatedPairs).toEqual([]);
    // The edges are non-empty, so the pass could speak — it simply found nothing to say.
    expect(row.replay).toBe('identical');
  });

  it('carries an unmeasured side as absent, never as zero', () => {
    const row = buildContainmentRow(
      input({
        excursions: new Map([['cart', 2]]),
        publishedOrder: ['frontend', 'cart'],
      }),
    );
    expect(row.pairs[0]).toEqual({
      upper: 'frontend',
      lower: 'cart',
      decision: 'unmeasured',
      lowerExcursion: 2,
    });
    expect(row.pairs[0]).not.toHaveProperty('upperExcursion');
  });

  it('carries a missing LOWER side as absent too, so the omission is not one-sided', () => {
    // An implementation that carried the upper side unconditionally would pass every other fixture; the two
    // directions of the absence are what make the row a measurement rather than a shape.
    const row = buildContainmentRow(
      input({
        excursions: new Map([['frontend', 2]]),
        publishedOrder: ['frontend', 'cart'],
      }),
    );
    expect(row.pairs[0]).toEqual({
      upper: 'frontend',
      lower: 'cart',
      decision: 'unmeasured',
      upperExcursion: 2,
    });
    expect(row.pairs[0]).not.toHaveProperty('lowerExcursion');
  });

  it('treats an absent excursion map as an empty one rather than as a crash', () => {
    const row = buildContainmentRow(input({ excursions: undefined }));
    expect(row.replay).toBe('unavailable');
    expect(row.pairs).toEqual([]);
  });

  it('reports a case with no candidates as null tops rather than empty strings', () => {
    const row = buildContainmentRow(
      input({ fusionOrder: [], publishedOrder: [], excursions: new Map(), edges: [] }),
    );
    expect(row.fusionTop1).toBeNull();
    expect(row.gatedTop1).toBeNull();
    expect(row.ungatedTop1).toBeNull();
    expect(row.shippedTop1).toBeNull();
  });

  it('carries the band width and the margin so a reader can re-derive the excursion', () => {
    const row = buildContainmentRow(input({ sigma: 4, margin: 0.25 }));
    expect(row.sigma).toBe(4);
    expect(row.margin).toBe(0.25);
  });

  it('replays the failure-flow pass, so a flow-reordered case reads as identical', () => {
    // `cart` nets an unexplained inbound rise and `frontend` does not, so the flow pass promotes the callee —
    // which is what the engine published, and the replay has to reproduce it to claim `identical`.
    const row = buildContainmentRow(
      input({
        publishedOrder: ['cart', 'frontend'],
        failureFlows: new Map([
          ['frontend', { knownIn: 0, knownOut: 9, novelIn: 0, novelOut: 0 }],
          ['cart', { knownIn: 9, knownOut: 0, novelIn: 0, novelOut: 0 }],
        ]),
        failingEdges: new Map([[failureEdgeKey('frontend', 'cart'), { rise: 9, novel: 0 }]]),
      }),
    );
    expect(row.replay).toBe('identical');
  });

  it('stores the sweep s input beside its decisions, so the walk can be repeated from the file', () => {
    const row = buildContainmentRow(input({ attribution: 'counts' }));
    expect(row.chain).toEqual({
      order: ['frontend', 'cart'],
      edges: [['frontend', 'cart']],
      excursions: { frontend: 0, cart: 2 },
      failedInterfaces: { 'frontend\u0000cart': 4 },
      // An absent flow map is written as an empty one: `applyFailureContainment` treats the two as the same
      // measurement, and a `null` here would be a third state the replay would have to invent a meaning for.
      flows: {},
      failingEdges: {},
      attribution: 'counts',
    });
  });

  it('keeps the containment requirement and the flow requirement apart', () => {
    // Two maps, two passes, one letter of difference in their names: `failedInterfaces` counts failed calls on
    // an interface and licenses an INVERSION, `failingEdges` counts a rise of a shape on an edge and licenses a
    // FLOW promotion. A builder that swapped them would replay the shipped arm differently, which is the only
    // reason this is checkable at all — so it is checked here rather than trusted.
    const row = buildContainmentRow(
      input({
        failedInterfaces: new Map([[failureEdgeKey('frontend', 'cart'), 7]]),
        failingEdges: new Map([[failureEdgeKey('frontend', 'cart'), { rise: 2, novel: 1 }]]),
      }),
    );
    expect(row.chain!.failedInterfaces).toEqual({ 'frontend\u0000cart': 7 });
    expect(row.chain!.failingEdges).toEqual({ 'frontend\u0000cart': { rise: 2, novel: 1 } });
  });

  it('carries no chain at all when the input has no excursion map', () => {
    // The chain is the SWEEP's input, and a case the profile could not speak about still has an order and no
    // excursions: the field records what there was, including nothing.
    const row = buildContainmentRow(input({ excursions: undefined }));
    expect(row.chain!.excursions).toEqual({});
    expect(row.replay).toBe('unavailable');
  });
});
