/**
 * The H7 reading: three walks of one chain, and the censuses that say what the swap opened.
 *
 * The fixtures are built through `buildContainmentRow` for the reason the replay's are: the property under test is
 * that a dump row carries its own input, and a hand-written chain would test this module against a shape the
 * builder might never write.
 *
 * @module benchmarks/__tests__/containment-surprise-study
 */

import { describe, expect, it } from 'vitest';

import { failureEdgeKey } from '../../packages/tree/src/index.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';
import { readSurprise, surpriseVerdict } from '../src/containment-surprise-study.js';

/** Latency says nothing; the whole-channel measurement says the callee is far out. */
function silentLatency(
  overrides: Partial<BuildContainmentRowInput> = {},
): BuildContainmentRowInput {
  return {
    datapack: 'dp',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    minCalleeExcursion: 0.1,
    depth: 5,
    edges: [{ from: 'a', to: 'b' }],
    excursions: new Map([
      ['a', 0],
      ['b', 0],
    ]),
    surprises: new Map([
      ['a', 0],
      ['b', Math.log(7)],
    ]),
    failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
    failureFlows: undefined,
    failingEdges: undefined,
    attribution: 'shape',
    scope: 'adjacent',
    fusionOrder: ['a', 'b'],
    publishedOrder: ['a', 'b'],
    ...overrides,
  };
}

/** A row as the dump would hold it, with the shipped top-1 that its own chain produces. */
function rowOf(overrides: Partial<BuildContainmentRowInput> = {}): ContainmentCaseRow {
  const built = buildContainmentRow(silentLatency(overrides));
  return { ...built, shippedTop1: 'a' };
}

/** An accepted set for one case. */
function accepted(
  ...entries: readonly (readonly [string, readonly string[]])[]
): Map<string, readonly string[]> {
  return new Map(entries);
}

describe('readSurprise', () => {
  it('counts the population it walked, and the rows it could not walk at all', () => {
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['a']]));
    expect(reading.cases).toBe(1);
    expect(reading.replayable).toBe(1);
    expect(reading.unmeasurable).toBe(0);
    expect(reading.disagreements).toBe(0);
    expect(reading.scored).toBe(1);
  });

  it('reads the three arms over the same population', () => {
    // The truth is the callee, which the fusion put second, latency could not separate, and the surprise map
    // promotes. So: fusion wrong, shipped wrong, surprise right — one gain and no loss.
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['b']]));
    expect(reading.arms.fusion.top1).toBe(0);
    expect(reading.arms.shipped.top1).toBe(0);
    expect(reading.arms.surprise.top1).toBe(1);
    expect(reading.arms.surprise.gains).toBe(1);
    expect(reading.arms.surprise.losses).toBe(0);
    expect(reading.moved).toBe(1);
  });

  it('counts a case the swap sells as a loss, not as a draw', () => {
    // The truth is the caller: the latency arm left it first, and the surprise map inverted it away.
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['a']]));
    expect(reading.arms.surprise.top1).toBe(0);
    expect(reading.arms.surprise.gains).toBe(0);
    expect(reading.arms.surprise.losses).toBe(1);
    expect(reading.moved).toBe(1);
  });

  it('separates the pairs the swap opened from the ones it simply walked, by the shipped reason', () => {
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['b']]));
    // The shipped walk examined the pair and refused it because the callee never left its band on latency;
    // that is the silence the second measurement breaks, and it is the census the report exists for. At the
    // shipped 0.1 floor a zero-excursion callee is named `callee-in-band`, not `not-larger`.
    expect(reading.opened['callee-in-band']).toBe(1);
    expect(reading.opened.unmeasured).toBe(0);
    expect(reading.decisions.inverted).toBe(1);
  });

  it('counts a pair the shipped walk never examined as opened, rather than dropping it', () => {
    // No interface failure means the shipped walk refuses the pair at the record and never reaches the inequality,
    // while the surprise arm refuses it there too — so nothing is opened and the census says so.
    const reading = readSurprise(
      [rowOf({ datapack: 'one', failedInterfaces: new Map() })],
      accepted(['one', ['b']]),
    );
    expect(reading.opened.inverted).toBe(0);
    expect(reading.opened['no-failed-interface']).toBe(0);
    expect(reading.decisions['no-failed-interface']).toBe(1);
  });

  it('counts an inversion the shipped walk never examined under `inverted`, because it has no reason to cite', () => {
    // Three candidates and two edges leaving the same caller. The shipped walk examines (a,b), refuses it, and
    // never reaches (a,c) because the next adjacency it sees is (b,c) — which carries no edge. The surprise arm
    // inverts (a,b), which brings a and c next to each other, and inverts that too. The second inversion has no
    // shipped verdict to cite, so it is counted under its own reason rather than attributed to one.
    const reading = readSurprise(
      [
        rowOf({
          datapack: 'one',
          edges: [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'c' },
          ],
          failedInterfaces: new Map([
            [failureEdgeKey('a', 'b'), 4],
            [failureEdgeKey('a', 'c'), 4],
          ]),
          excursions: new Map([
            ['a', 0],
            ['b', 0],
            ['c', 0],
          ]),
          surprises: new Map([
            ['a', 0],
            ['b', 3],
            ['c', 5],
          ]),
          fusionOrder: ['a', 'b', 'c'],
        }),
      ],
      accepted(['one', ['c']]),
    );
    expect(reading.opened['callee-in-band']).toBe(1);
    expect(reading.opened.inverted).toBe(1);
  });

  it('prices the shipped arm beside the fusion baseline, so the two ± are read on the same scale', () => {
    // The shipped walk inverts a pair the fusion left alone and the truth is the callee: a shipped GAIN. The
    // same row with the caller as the truth is a shipped LOSS. Both are counted, because an arm whose ± are
    // always zero is an arm the reading never actually compared.
    const gainsCase = rowOf({
      datapack: 'one',
      excursions: new Map([
        ['a', 0],
        ['b', 2],
      ]),
    });
    const gained = readSurprise([gainsCase], accepted(['one', ['b']]));
    expect(gained.arms.shipped.gains).toBe(1);
    expect(gained.arms.shipped.losses).toBe(0);

    const lostCase = rowOf({
      datapack: 'one',
      excursions: new Map([
        ['a', 0],
        ['b', 2],
      ]),
    });
    const lost = readSurprise([lostCase], accepted(['one', ['a']]));
    expect(lost.arms.shipped.gains).toBe(0);
    expect(lost.arms.shipped.losses).toBe(1);
  });

  it('walks a surprise map that inverts nothing, and reports the refusals rather than an empty census', () => {
    // Two edges leaving one caller, every channel inside its band: the arm examines both pairs and refuses both,
    // which is the `continue` branch of the opened census and the population that makes the census a census.
    const reading = readSurprise(
      [
        rowOf({
          datapack: 'one',
          edges: [
            { from: 'a', to: 'b' },
            { from: 'a', to: 'c' },
          ],
          failedInterfaces: new Map([
            [failureEdgeKey('a', 'b'), 4],
            [failureEdgeKey('a', 'c'), 4],
          ]),
          excursions: new Map([
            ['a', 0],
            ['b', 0],
            ['c', 0],
          ]),
          surprises: new Map([
            ['a', 0],
            ['b', 0],
            ['c', 0],
          ]),
          fusionOrder: ['a', 'b', 'c'],
        }),
      ],
      accepted(['one', ['a']]),
    );
    expect(reading.decisions['callee-in-band']).toBe(1);
    expect(reading.decisions.inverted).toBe(0);
    expect(reading.opened.inverted).toBe(0);
    expect(reading.moved).toBe(0);
  });

  it('counts a row whose chain carries no surprise map as unmeasurable, not as a case that failed', () => {
    const reading = readSurprise(
      [rowOf({ datapack: 'one', surprises: undefined }), rowOf({ datapack: 'two' })],
      accepted(['one', ['b']], ['two', ['b']]),
    );
    expect(reading.unmeasurable).toBe(1);
    expect(reading.scored).toBe(1);
    expect(reading.arms.surprise.top1).toBe(1);
  });

  it('does not count a row with no chain as unmeasurable, because there is nothing to walk either way', () => {
    const { chain: _dropped, ...withoutChain } = rowOf({ datapack: 'one' });
    const reading = readSurprise([withoutChain], accepted(['one', ['b']]));
    expect(reading.unmeasurable).toBe(0);
    expect(reading.replayable).toBe(0);
    expect(reading.scored).toBe(0);
  });

  it('counts a row whose shipped replay disagrees with the recorded answer', () => {
    const reading = readSurprise(
      [{ ...rowOf({ datapack: 'one' }), shippedTop1: 'b' }],
      accepted(['one', ['b']]),
    );
    expect(reading.disagreements).toBe(1);
  });

  it('skips a row whose arms published nothing, rather than scoring an empty answer as a miss', () => {
    // A case with no candidates has no head in any arm, and counting that as three wrong answers would make a
    // corpus's coverage look like a capability. It is walked (its chain exists) and then left out of the arms.
    const reading = readSurprise(
      [
        rowOf({
          datapack: 'one',
          edges: [],
          excursions: new Map(),
          surprises: new Map(),
          failedInterfaces: new Map(),
          fusionOrder: [],
        }),
      ],
      accepted(['one', ['a']]),
    );
    expect(reading.replayable).toBe(1);
    expect(reading.scored).toBe(0);
    expect(reading.arms.fusion.top1 + reading.arms.shipped.top1 + reading.arms.surprise.top1).toBe(
      0,
    );
  });

  it('carries the band width the run measured against, taken from the rows', () => {
    expect(readSurprise([rowOf({ datapack: 'one', sigma: 4 })], accepted()).sigma).toBe(4);
    expect(readSurprise([], accepted()).sigma).toBe(0);
  });
});

describe('surpriseVerdict', () => {
  it('is unmeasured when no row carries a chain', () => {
    const reading = readSurprise([], accepted());
    expect(surpriseVerdict(reading).verdict).toBe('unmeasured');
    expect(surpriseVerdict(reading).reason).toMatch(/no row carries a chain/);
  });

  it('is unmeasured when any row carries no surprise map', () => {
    const reading = readSurprise(
      [rowOf({ datapack: 'one', surprises: undefined })],
      accepted(['one', ['b']]),
    );
    expect(surpriseVerdict(reading).verdict).toBe('unmeasured');
    expect(surpriseVerdict(reading).reason).toMatch(/carry no surprise map/);
  });

  it('is unmeasured when the shipped replay disagrees with the recorded answer', () => {
    const reading = readSurprise(
      [{ ...rowOf({ datapack: 'one' }), shippedTop1: 'b' }],
      accepted(['one', ['b']]),
    );
    expect(surpriseVerdict(reading).verdict).toBe('unmeasured');
    expect(surpriseVerdict(reading).reason).toMatch(/do not replay the published top-1/);
  });

  it('judges the surprise arm and not the shipped one, with the same criterion', () => {
    // The shipped arm cannot pass the standing bar by definition — it IS the bar — so a verdict read from it would
    // be a comparison of one number with itself.
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['b']]));
    const judged = surpriseVerdict(reading, { gains: 1, losses: 0, shippedTop1: 0 });
    expect(judged.verdict).toBe('pass');
    expect(judged.reason).toMatch(/Top@1 1 > 0/);
  });

  it('fails on the standing criterion when the arm has not paid for itself', () => {
    const reading = readSurprise([rowOf({ datapack: 'one' })], accepted(['one', ['b']]));
    const judged = surpriseVerdict(reading);
    expect(judged.verdict).toBe('fail');
    expect(judged.reason).toMatch(/below the 15/);
  });
});
