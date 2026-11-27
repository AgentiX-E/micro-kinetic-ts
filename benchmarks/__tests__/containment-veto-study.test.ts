/**
 * The H8 reading: the record read at case scope, and the bound the whole axis is spending against.
 *
 * The fixtures are built through `buildContainmentRow` for the reason the replay's and the surprise's are: the
 * property under test is that a dump row carries its own input, and a hand-written chain would test this module
 * against a shape the builder might never write.
 *
 * One fixture needs care. The residual is CROSS-FITTED, so a three-case corpus has no prior at all and the arm is
 * the shipped arm by construction — which is worth one test, and is not worth the rest. `fitCorpus` therefore
 * builds a corpus large enough for both halves to reach the residual module's population floor with a positive
 * coupling in each: twelve cases per half where both ends are out of band and twelve where neither is. That is
 * `ρ = 0.5 − 0.25 = 0.25` on both halves, above the shipped threshold of zero, and it is the smallest corpus in
 * which the arm's mechanism can fire at all.
 *
 * @module benchmarks/__tests__/containment-veto-study
 */

import { describe, expect, it } from 'vitest';

import { failureEdgeKey } from '../../packages/tree/src/index.js';
import { foldOf } from '../src/containment-gate.js';
import {
  buildContainmentRow,
  type BuildContainmentRowInput,
} from '../src/containment-row-build.js';
import type { ContainmentCaseRow } from '../src/containment-rows.js';
import { readVeto, sweepReach, vetoVerdict } from '../src/containment-veto-study.js';

/** A case with one edge, both sides measured, and whatever record the caller asked for. */
function spec(overrides: Partial<BuildContainmentRowInput> = {}): BuildContainmentRowInput {
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

/** An accepted set for one case. */
function accepted(
  ...entries: readonly (readonly [string, readonly string[]])[]
): Map<string, readonly string[]> {
  return new Map(entries);
}

/**
 * The smallest corpus in which both halves of the residual fit positively.
 *
 * Names are taken in order and sorted into halves by the module's own hash, so the fixture cannot drift from the
 * cross-fitting rule: twenty-four per half, half of them with both ends out of band and half with neither.
 *
 * @returns The fitting corpus, every case answered `a` so that none of them enters the ceiling.
 */
function fitCorpus(): ContainmentCaseRow[] {
  const byFold: Record<'a' | 'b', ContainsFit[]> = { a: [], b: [] };
  for (let i = 0; byFold.a.length < 24 || byFold.b.length < 24; i++) {
    const datapack = `fit-${i}`;
    const fold = foldOf(datapack);
    if (byFold[fold].length >= 24) continue;
    byFold[fold].push({ datapack, out: byFold[fold].length % 2 === 0 });
  }
  return [...byFold.a, ...byFold.b].map((entry) =>
    rowOf({
      datapack: entry.datapack,
      excursions: new Map([
        ['a', entry.out ? 2 : 0],
        ['b', entry.out ? 2 : 0],
      ]),
    }),
  );
}

/** One generated fitting case, before it becomes a row. */
interface ContainsFit {
  readonly datapack: string;
  readonly out: boolean;
}

describe('readVeto', () => {
  it('counts the population, the record-free cases, and nothing it could not walk', () => {
    const reading = readVeto(
      [
        rowOf({ datapack: 'free', failedInterfaces: new Map() }),
        // This one's record licenses the inversion, so its recorded top-1 is the callee's — the same row with the
        // record removed would publish the caller, which is the difference the arm reads.
        {
          ...rowOf({
            datapack: 'kept',
            failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
          }),
          shippedTop1: 'b',
        },
      ],
      accepted(['free', ['a']], ['kept', ['a']]),
    );
    expect(reading.cases).toBe(2);
    expect(reading.replayable).toBe(2);
    expect(reading.scored).toBe(2);
    expect(reading.recordFree).toBe(1);
    expect(reading.disagreements).toBe(0);
  });

  it('is the shipped arm on a corpus too small to fit a prior, and says so through the refusals', () => {
    // Not a defect and not a pass: with no fitted edge the arm has nothing to say where the record is silent, so
    // it refuses for the reason the walk reports. A reading that counted these as losses would price a missing
    // prior as a wrong answer.
    const reading = readVeto(
      [rowOf({ datapack: 'free' }), rowOf({ datapack: 'free-2' })],
      accepted(['free', ['b']], ['free-2', ['b']]),
    );
    expect(reading.arms.veto.top1).toBe(reading.arms.shipped.top1);
    expect(reading.arms.veto.gains).toBe(reading.arms.shipped.gains);
    expect(reading.decisions['prior-absent']).toBe(2);
    expect(reading.decisions['record-silent']).toBe(0);
  });

  it('takes a gain where the record is silent and leaves the shipped arm where it was', () => {
    const corpus = fitCorpus();
    const target = rowOf({ datapack: 'target-free' });
    const acceptedCases = accepted(...corpus.map((row) => [row.datapack, ['a']] as const), [
      'target-free',
      ['b'],
    ]);
    const without = readVeto(corpus, acceptedCases);
    const with_ = readVeto([...corpus, target], acceptedCases);
    expect(with_.arms.veto.top1).toBe(without.arms.veto.top1 + 1);
    expect(with_.arms.shipped.top1).toBe(without.arms.shipped.top1);
    expect(with_.decisions['record-silent']).toBe(without.decisions['record-silent'] + 1);
  });

  it('keeps the veto on a case that recorded a failed call elsewhere, which is the arm\u2019s whole risk', () => {
    // The same pair, the same excursions, the same residual: only the record differs, and it is not silent. The
    // arm must not move, and the loss §299 recorded must not reappear.
    const corpus = fitCorpus();
    const target = rowOf({
      datapack: 'target-kept',
      failedInterfaces: new Map([[failureEdgeKey('b', 'a'), 4]]),
    });
    const acceptedCases = accepted(...corpus.map((row) => [row.datapack, ['a']] as const), [
      'target-kept',
      ['a'],
    ]);
    const without = readVeto(corpus, acceptedCases);
    const with_ = readVeto([...corpus, target], acceptedCases);
    expect(with_.arms.veto.top1).toBe(without.arms.veto.top1 + 1);
    expect(with_.arms.veto.losses).toBe(without.arms.veto.losses);
    expect(with_.decisions['no-failed-interface']).toBe(
      without.decisions['no-failed-interface'] + 1,
    );
  });

  it('counts the CONTROL\u2019s census too, which the three arms before this one never printed', () => {
    // A control with no census is a control a claim about it cannot be checked against, and that is exactly what
    // §301's `242` for the shipped walk was: a derivation, not a reading. Both walks must report, on the same
    // artifact, so that the next comparison is between two printed numbers.
    const reading = readVeto(
      [rowOf({ datapack: 'free' }), rowOf({ datapack: 'free-2' })],
      accepted(['free', ['b']], ['free-2', ['b']]),
    );
    expect(reading.control['no-failed-interface']).toBe(2);
    expect(reading.control['record-silent']).toBe(0);
    // The veto walk's own count of the same reason is zero here — the record is silent, so the pair is not refused
    // for it — which is the difference the two lines exist to show.
    expect(reading.decisions['no-failed-interface']).toBe(0);
  });

  it('prices the shipped arm too, so the two \u00b1 are read on the same scale', () => {
    // A record that licenses the inversion, and the callee as the truth: the fusion head is wrong, the shipped walk
    // is right. Without a case of this shape the shipped arm's `gains` is never incremented and the ceiling's
    // `shipped` column is never incremented either, which is how a counter can be 100 % covered and always zero.
    const reading = readVeto(
      [
        rowOf({
          datapack: 'licensed',
          failedInterfaces: new Map([[failureEdgeKey('a', 'b'), 4]]),
        }),
      ],
      accepted(['licensed', ['b']]),
    );
    expect(reading.arms.shipped.gains).toBe(1);
    expect(reading.ceiling.reachable).toBe(1);
    expect(reading.ceiling.shipped).toBe(1);
    expect(reading.ceiling.veto).toBe(1);
  });

  it('leaves a fusion miss whose truth is further down out of the bound entirely', () => {
    // Three candidates, the truth last: no sweep can reach it, and it belongs on neither side of the ceiling. A
    // reader that folded these into `unreachable` would report the rule's population as larger than it is.
    const reading = readVeto(
      [rowOf({ datapack: 'deep', fusionOrder: ['a', 'b', 'c'] })],
      accepted(['deep', ['c']]),
    );
    expect(reading.ceiling.atSecond).toBe(0);
    expect(reading.ceiling.reachable).toBe(0);
    expect(reading.ceiling.unreachable).toBe(0);
  });

  it('counts the family\u2019s bound on the population it can act on, and what each arm took of it', () => {
    const corpus = fitCorpus();
    const target = rowOf({ datapack: 'target-free' });
    const reading = readVeto(
      [...corpus, target],
      accepted(...corpus.map((row) => [row.datapack, ['a']] as const), ['target-free', ['b']]),
    );
    expect(reading.ceiling.reachable).toBe(1);
    expect(reading.ceiling.unreachable).toBe(0);
    expect(reading.ceiling.atSecond).toBe(1);
    expect(reading.ceiling.shipped).toBe(0);
    expect(reading.ceiling.veto).toBe(1);
  });

  it('counts a fusion miss the rule refuses as unreachable rather than folding it into the bound', () => {
    // The truth sits at position 1 and there is NO call edge between the two: every arm on this axis refuses it
    // for the same reason, so it belongs on the far side of the ceiling and not inside it.
    const reading = readVeto(
      [rowOf({ datapack: 'no-edge', edges: [] })],
      accepted(['no-edge', ['b']]),
    );
    expect(reading.ceiling.atSecond).toBe(1);
    expect(reading.ceiling.reachable).toBe(0);
    expect(reading.ceiling.unreachable).toBe(1);
  });

  it('does not score a row whose arms published nothing, rather than counting it as three wrong answers', () => {
    const reading = readVeto(
      [rowOf({ datapack: 'empty', fusionOrder: [], edges: [], excursions: new Map() })],
      accepted(['empty', ['a']]),
    );
    expect(reading.replayable).toBe(1);
    expect(reading.scored).toBe(0);
  });

  it('counts a row with no chain as unwalkable and leaves it out of the arms', () => {
    const chainless = { ...rowOf({ datapack: 'old' }), chain: undefined };
    const reading = readVeto([chainless], accepted(['old', ['a']]));
    expect(reading.cases).toBe(1);
    expect(reading.replayable).toBe(0);
    expect(reading.recordFree).toBe(0);
    expect(reading.scored).toBe(0);
  });
});

describe('sweepReach', () => {
  it('answers `not-second` for a case with no chain, an empty order, or a truth that is not second', () => {
    expect(sweepReach({ ...rowOf(), chain: undefined }, ['b'])).toBe('not-second');
    expect(sweepReach(rowOf({ fusionOrder: [], excursions: new Map() }), ['b'])).toBe('not-second');
    expect(sweepReach(rowOf({ fusionOrder: ['b', 'a'] }), ['b'])).toBe('not-second');
  });

  it('answers `unqualified` when the pair carries no call edge', () => {
    expect(sweepReach(rowOf({ edges: [] }), ['b'])).toBe('unqualified');
  });

  it('answers `unqualified` when one side was not measured, because absent is not zero', () => {
    expect(sweepReach(rowOf({ excursions: new Map([['b', 2]]) }), ['b'])).toBe('unqualified');
    expect(sweepReach(rowOf({ excursions: new Map([['a', 0]]) }), ['b'])).toBe('unqualified');
  });

  it('answers `unqualified` when the lower side is not further out by more than the margin', () => {
    expect(
      sweepReach(
        rowOf({
          excursions: new Map([
            ['a', 2],
            ['b', 2],
          ]),
        }),
        ['b'],
      ),
    ).toBe('unqualified');
    expect(
      sweepReach(
        rowOf({
          excursions: new Map([
            ['a', 0],
            ['b', 2],
          ]),
          margin: 2,
        }),
        ['b'],
      ),
    ).toBe('unqualified');
  });

  it('answers `qualified` for the one pair any arm on this axis can convert', () => {
    expect(sweepReach(rowOf(), ['b'])).toBe('qualified');
  });
});

describe('vetoVerdict', () => {
  const passing = readVeto(
    fitCorpus(),
    accepted(...fitCorpus().map((row) => [row.datapack, ['a']] as const)),
  );

  it('is unmeasured when no row carries a chain', () => {
    const chainless = { ...rowOf(), chain: undefined };
    expect(vetoVerdict(readVeto([chainless], accepted())).verdict).toBe('unmeasured');
  });

  it('is unmeasured when only some rows carry one, because the population would be undeclared', () => {
    const chainless = { ...rowOf({ datapack: 'old' }), chain: undefined };
    expect(vetoVerdict(readVeto([rowOf(), chainless], accepted())).verdict).toBe('unmeasured');
  });

  it('is unmeasured when the shipped replay does not reproduce the recorded top-1', () => {
    const broken = { ...rowOf({ datapack: 'dp' }), shippedTop1: 'b' };
    const reading = readVeto([broken], accepted(['dp', ['a']]));
    expect(reading.disagreements).toBe(1);
    expect(vetoVerdict(reading).verdict).toBe('unmeasured');
  });

  it('judges the arm through the same bar the gate and the term are judged by', () => {
    expect(vetoVerdict(passing, { gains: 0, losses: 0, shippedTop1: 0 }).verdict).toBe('pass');
    expect(vetoVerdict(passing, { gains: 10_000, losses: 0, shippedTop1: 0 })).toMatchObject({
      verdict: 'fail',
    });
    expect(vetoVerdict(passing, { gains: 0, losses: -1, shippedTop1: 0 }).verdict).toBe('fail');
    expect(vetoVerdict(passing, { gains: 0, losses: 0, shippedTop1: 10_000 }).verdict).toBe('fail');
  });
});
