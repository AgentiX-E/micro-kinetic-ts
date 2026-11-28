/**
 * The excursion-licence reading: three arms over one chain, one rule moved.
 *
 * The fixtures are built through `buildContainmentRow`, for the reason the gate's and the veto's are: the property
 * under test is that a dump row carries its own input, and a hand-written chain would test this module against a
 * shape the builder might never write.
 *
 * @module benchmarks/__tests__/containment-excursion-license-study
 */

import { describe, expect, it } from 'vitest';

import { failureEdgeKey } from '../../packages/tree/src/index.js';
import {
  licenseVerdict,
  readExcursionLicense,
} from '../src/containment-excursion-license-study.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';

/** A case with one edge, both sides measured, and a silent interface record. */
function spec(overrides: Partial<BuildContainmentRowInput> = {}): BuildContainmentRowInput {
  return {
    datapack: 'dp',
    faultType: 'NetworkDelay',
    sigma: 3,
    margin: 0,
    minCalleeExcursion: 0.1,
    licenseByExcursion: false,
    depth: 5,
    edges: [{ from: 'a', to: 'b' }],
    excursions: new Map([
      ['a', 0],
      ['b', 2],
    ]),
    surprises: undefined,
    failedInterfaces: new Map(),
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
  const built = buildContainmentRow(spec(overrides));
  return { ...built, shippedTop1: 'a' };
}

function accepted(
  ...entries: readonly (readonly [string, readonly string[]])[]
): Map<string, readonly string[]> {
  return new Map(entries);
}

describe('readExcursionLicense', () => {
  it('counts the population and reproduces the shipped arm on a healthy dump', () => {
    const reading = readExcursionLicense(
      [rowOf({ datapack: 'one' }), rowOf({ datapack: 'two' })],
      accepted(['one', ['a']], ['two', ['a']]),
    );
    expect(reading.cases).toBe(2);
    expect(reading.replayable).toBe(2);
    expect(reading.scored).toBe(2);
    expect(reading.disagreements).toBe(0);
    expect(reading.arms.shipped.top1).toBe(2);
    expect(reading.arms.fusion.top1).toBe(2);
  });

  it('takes a gain where the record is silent and the callee is resolvably out of band', () => {
    // The published order is the fusion order (a first): the run had the record-only licence, so the silent pair
    // stayed un-inverted. The licensed arm inverts it and the truth is the callee — one gain over both baselines.
    const reading = readExcursionLicense(
      [rowOf({ datapack: 'target' })],
      accepted(['target', ['b']]),
    );
    expect(reading.arms.fusion.top1).toBe(0);
    expect(reading.arms.shipped.top1).toBe(0);
    expect(reading.arms.licensed.top1).toBe(1);
    expect(reading.arms.licensed.gains).toBe(1);
    expect(reading.arms.licensed.losses).toBe(0);
    expect(reading.decisions['excursion-licensed']).toBe(1);
    expect(reading.control['no-failed-interface']).toBe(1);
  });

  it('does not license a boundary-noise callee, whatever the arm', () => {
    const reading = readExcursionLicense(
      [
        rowOf({
          datapack: 'noise',
          excursions: new Map([
            ['a', 0],
            ['b', 0.05],
          ]),
        }),
      ],
      accepted(['noise', ['b']]),
    );
    expect(reading.arms.licensed.top1).toBe(0);
    expect(reading.decisions['callee-in-band']).toBe(1);
    expect(reading.decisions['excursion-licensed']).toBe(0);
  });

  it('keeps the failed-interface licence first when the record spoke', () => {
    const reading = readExcursionLicense(
      [
        {
          ...rowOf({
            datapack: 'licensed',
            failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
          }),
          shippedTop1: 'b',
        },
      ],
      accepted(['licensed', ['b']]),
    );
    expect(reading.arms.licensed.top1).toBe(1);
    expect(reading.decisions.inverted).toBe(1);
    expect(reading.decisions['excursion-licensed']).toBe(0);
  });

  it('prices a loss honestly when the truth is the caller and the arm inverts', () => {
    // Fusion answers right (truth = a); the licensed arm promotes b and is wrong. A loss against fusion must be
    // counted, not hidden behind the arm's top-1 — this is the check the standing bar reads.
    const reading = readExcursionLicense([rowOf({ datapack: 'loss' })], accepted(['loss', ['a']]));
    expect(reading.arms.fusion.top1).toBe(1);
    expect(reading.arms.licensed.top1).toBe(0);
    expect(reading.arms.licensed.losses).toBe(1);
  });

  it('counts a row with no chain as unwalkable and leaves it out of the arms', () => {
    const row = rowOf({ datapack: 'no-chain' });
    const reading = readExcursionLicense(
      [{ ...row, chain: undefined }],
      accepted(['no-chain', ['a']]),
    );
    expect(reading.cases).toBe(1);
    expect(reading.replayable).toBe(0);
    expect(reading.scored).toBe(0);
  });

  it('does not score a row whose arms published nothing', () => {
    const row = rowOf({ datapack: 'empty', fusionOrder: [], publishedOrder: [] });
    const reading = readExcursionLicense([row], accepted(['empty', ['a']]));
    expect(reading.replayable).toBe(1);
    expect(reading.scored).toBe(0);
  });

  it('leaves a row with no accepted answer out of the arms but keeps it in the census', () => {
    const reading = readExcursionLicense([rowOf({ datapack: 'x' })], new Map());
    expect(reading.scored).toBe(0);
    expect(reading.control['no-failed-interface']).toBe(1);
  });

  it('counts a disagreement when the shipped replay does not reproduce the recorded top-1', () => {
    const row = rowOf({ datapack: 'mismatch' });
    const reading = readExcursionLicense(
      [{ ...row, shippedTop1: 'b' }],
      accepted(['mismatch', ['b']]),
    );
    expect(reading.disagreements).toBe(1);
  });

  it('replays a row that states the licence ON under that licence', () => {
    // A dump written by the shipped engine carries the field; the shipped arm must walk the configuration the
    // run had, so it inverts the silent pair and agrees with a recorded callee-top-1.
    const built = buildContainmentRow(spec({ datapack: 'on', licenseByExcursion: true }));
    const row: ContainmentCaseRow = { ...built, shippedTop1: 'b' };
    const reading = readExcursionLicense([row], accepted(['on', ['b']]));
    expect(reading.disagreements).toBe(0);
    expect(reading.arms.shipped.top1).toBe(1);
    expect(reading.control['excursion-licensed']).toBe(1);
  });
});

describe('licenseVerdict', () => {
  const reading = (
    over: Partial<ReturnType<typeof readExcursionLicense>> = {},
  ): ReturnType<typeof readExcursionLicense> => ({
    cases: 1,
    replayable: 1,
    scored: 1,
    disagreements: 0,
    arms: {
      fusion: { top1: 0, gains: 0, losses: 0 },
      shipped: { top1: 0, gains: 0, losses: 0 },
      licensed: { top1: 1, gains: 1, losses: 0 },
    },
    decisions: {} as never,
    control: {} as never,
    ...over,
  });

  it('is unmeasured when no row carries a chain', () => {
    expect(licenseVerdict(reading({ replayable: 0 })).verdict).toBe('unmeasured');
  });

  it('is unmeasured when only some rows carry one', () => {
    expect(licenseVerdict(reading({ cases: 4, replayable: 3 })).verdict).toBe('unmeasured');
  });

  it('is unmeasured on a disagreement, because the chain is incomplete', () => {
    expect(licenseVerdict(reading({ disagreements: 1 })).verdict).toBe('unmeasured');
  });

  it('judges the licensed arm through the gate bar', () => {
    const good = licenseVerdict(reading(), {
      gains: 1,
      losses: 0,
      shippedTop1: 0,
    });
    expect(good.verdict).toBe('pass');
    const below = licenseVerdict(reading(), {
      gains: 30,
      losses: 0,
      shippedTop1: 0,
    });
    expect(below.verdict).toBe('fail');
  });
});
