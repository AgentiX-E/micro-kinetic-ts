/**
 * The channel split's own tests.
 *
 * The number this module publishes is a HELD-OUT reading, so the properties asserted here are the ones that make
 * it one: the folds are fixed before any number is seen, the parameter is picked on one fold and read once on the
 * other, and a peak that does not survive the swap is reported as a failure rather than as a parameter.
 */

import { describe, expect, it } from 'vitest';

import type { ChannelDeparture } from '../src/channel-kind.js';
import {
  MIN_CHANNEL_GAIN,
  correctUnder,
  crossValidate,
  foldOf,
  resolvedUnder,
  stableHash,
  toSplitCase,
  type Profiles,
  type SplitCase,
} from '../src/channel-split.js';

/** A case with everything the resolver reads, and no profile attached yet. */
function splitCase(overrides: Partial<SplitCase> = {}): SplitCase {
  return {
    datapack: 'case-a',
    faultType: 'HTTPResponseReplaceCode',
    truth: ['front'],
    answer: 'deep',
    entry: 'front',
    entryChildErrors: 0,
    belowFails: false,
    answerSurprise: 900,
    novelCaller: null,
    novelRise: null,
    ...overrides,
  };
}

/** A mutable profile map, which is what a builder needs and what a `Profiles` reader accepts. */
function mutableProfiles(): Map<string, Map<string, ChannelDeparture>> {
  return new Map();
}

/** A profile map carrying one case's one service. */
function profilesOf(caseId: string, service: string, departure: ChannelDeparture): Profiles {
  const profiles = mutableProfiles();
  profiles.set(caseId, new Map([[service, departure]]));
  return profiles;
}

/** The traffic-shaped profile the axis exists for: no work of its own, a loud retry storm. */
const TRAFFIC_SHAPED: ChannelDeparture = { resource: 5, traffic: 900, other: null };

describe('the fold a case lands in', () => {
  it('is a function of the family and the index, and of nothing else', () => {
    expect(stableHash('HTTPResponseReplaceCode')).toBe(stableHash('HTTPResponseReplaceCode'));
    expect(foldOf('NetworkDelay', 3)).toBe(foldOf('NetworkDelay', 3));
  });

  it('splits a family evenly rather than by hash alone', () => {
    // Parity alone would put a family with an odd hash entirely in one fold if the index happened to correlate
    // with the family's ordering; the XOR makes both folds carry every family.
    const folds = Array.from({ length: 10 }, (_, index) => foldOf('NetworkDelay', index));
    expect(folds.filter((fold) => fold === 0)).toHaveLength(5);
    expect(folds.filter((fold) => fold === 1)).toHaveLength(5);
  });

  it('is not the same for every family, because a fold that is the same split twice measures nothing', () => {
    const families = ['NetworkDelay', 'PodFailure', 'HTTPResponseReplaceCode', 'ContainerKill'];
    const signatures = families.map((family) =>
      [0, 1, 2, 3].map((index) => foldOf(family, index)).join(''),
    );
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });
});

describe('what the rule does to one case', () => {
  it('leaves the answer alone when no profile was measured for it', () => {
    expect(resolvedUnder(splitCase(), new Map(), 200)).toBe('deep');
  });

  it('reads a case with no answer as nothing to rename, rather than as a service called "null"', () => {
    expect(
      resolvedUnder(splitCase({ answer: null }), profilesOf('case-a', 'deep', TRAFFIC_SHAPED), 200),
    ).toBe(null);
  });

  it('names the front door when the answer’s departure is traffic-shaped', () => {
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', TRAFFIC_SHAPED), 200)).toBe(
      'front',
    );
  });

  it('leaves the answer alone when the answer did work of its own', () => {
    const worked: ChannelDeparture = { resource: 900, traffic: 950, other: null };
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', worked), 200)).toBe('deep');
  });

  it('reads the bar it was given rather than a constant, so a sweep is one grid and one function', () => {
    const mild: ChannelDeparture = { resource: 50, traffic: 900, other: null };
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', mild), 200)).toBe('front');
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', mild), 10)).toBe('deep');
  });

  it('is the shipped rule plus nothing when the bar is absent', () => {
    // `null` is the disabled state the resolver ships with until the cross-validation passes, and it must be
    // byte-for-byte the behaviour of iterations 324–327: a disabled axis that still renamed one case would be
    // the defect this whole pre-registration exists to avoid.
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', TRAFFIC_SHAPED), null)).toBe(
      'deep',
    );
  });

  it('does not rescue a case whose premise says the failure travelled below the door', () => {
    const travelled = splitCase({ belowFails: true });
    expect(resolvedUnder(travelled, profilesOf('case-a', 'deep', TRAFFIC_SHAPED), 200)).toBe(
      'deep',
    );
  });

  it('lets the witness speak alone, because that is the order the shipped resolver returns in', () => {
    // A case with both a witness and a traffic-shaped answer: `applyResolver` returns on the witness, so a pricing
    // that let the front door read again would be pricing a resolver this repository does not ship.
    const both = splitCase({ novelCaller: 'mid', novelRise: 40 });
    expect(resolvedUnder(both, profilesOf('case-a', 'deep', TRAFFIC_SHAPED), 200)).toBe('mid');
  });

  it('counts against the truth rather than the change', () => {
    const rows = [
      splitCase({ datapack: 'a', truth: ['front'] }),
      splitCase({ datapack: 'b', truth: ['deep'] }),
      splitCase({ datapack: 'c', truth: ['front'], answer: 'other' }),
    ];
    const profiles: Profiles = new Map(
      ['a', 'b', 'c'].map((id) => [id, new Map([['deep', TRAFFIC_SHAPED]])]),
    );
    expect(correctUnder(rows, profiles, null)).toBe(1);
    expect(correctUnder(rows, profiles, 200)).toBe(1);
  });
});

describe('the cross-validated reading', () => {
  /**
   * A corpus built so that ONE bar is right on BOTH folds, which is the only shape that may pass.
   *
   * Each fold carries twelve cases whose answer is traffic-shaped and whose truth is the entry, plus one case per
   * fold whose answer did real work and whose truth is the answer itself. The mild bar repairs the twelve and
   * spares the one; a bar of 1 repairs nothing.
   */
  function sharedPeak(): {
    rows: SplitCase[];
    profiles: Map<string, Map<string, ChannelDeparture>>;
  } {
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < 26; index += 1) {
      const datapack = `case-${index}`;
      const worked = index % 13 === 12;
      rows.push(splitCase({ datapack, truth: worked ? ['deep'] : ['front'] }));
      profiles.set(
        datapack,
        new Map([['deep', worked ? { resource: 900, traffic: 950, other: null } : TRAFFIC_SHAPED]]),
      );
    }
    return { rows, profiles };
  }

  it('picks a bar on one fold and reads it once on the other, in both directions', () => {
    const { rows, profiles } = sharedPeak();
    const report = crossValidate(rows, profiles, [1, 200]);
    expect(report.sizes[0] + report.sizes[1]).toBe(rows.length);
    expect(report.selected).toEqual([200, 200]);
    expect(report.heldOut[0]).toBe(report.mixed[0] + 12);
    expect(report.heldOut[1]).toBe(report.mixed[1] + 12);
    expect(report.passes).toBe(true);
  });

  it('reports the sweep for both folds, so a peak can be looked at rather than trusted', () => {
    const { rows, profiles } = sharedPeak();
    const report = crossValidate(rows, profiles, [1, 200]);
    expect(report.sweep.map((one) => one.kappa)).toEqual([1, 200]);
    expect(report.sweep[0]!.correct).toEqual(report.mixed);
  });

  it('counts what a bar BROKE against the shipped surface, and can report a negative reading', () => {
    // A case whose truth is the deep answer and whose departure is traffic-shaped: the bar renames it to the front
    // door and loses a case the shipped surface had right. A sweep that reported only its repairs would describe a
    // rule that never costs anything, which is not a rule this corpus has ever produced.
    const rows = [splitCase({ datapack: 'a', truth: ['deep'] })];
    const profiles = profilesOf('a', 'deep', TRAFFIC_SHAPED);
    const report = crossValidate(rows, profiles, [200]);
    expect(report.mixed[0] + report.mixed[1]).toBe(1);
    expect(report.sweep[0]!.breaks).toBe(1);
    expect(report.sweep[0]!.repairs).toBe(0);
    expect(Math.min(...report.deltas)).toBe(-1);
    expect(report.passes).toBe(false);
  });

  it('fails when the gain is under the registered minimum, even with both folds agreeing', () => {
    // A bar that repairs too few cases is a parameter, not a mechanism: the pre-registration demands ≥ 7 cases on
    // each fold, so a gain of 12 on one fold and 3 on the other is a failure by construction.
    const { rows, profiles } = sharedPeak();
    const thinner = new Map(profiles);
    let kept = 0;
    for (const [id, one] of profiles) {
      const shape = one.get('deep')!;
      if (shape.resource === 900) continue;
      if (kept >= 3)
        thinner.set(id, new Map([['deep', { resource: 900, traffic: 950, other: null }]]));
      kept += 1;
    }
    const report = crossValidate(rows, thinner, [1, 200], MIN_CHANNEL_GAIN);
    expect(report.deltas[0]).toBeGreaterThanOrEqual(0);
    expect(Math.min(...report.deltas)).toBeLessThan(MIN_CHANNEL_GAIN);
    expect(report.passes).toBe(false);
  });

  it('fails when the two folds choose bars more than one grid step apart', () => {
    // The signature this programme has refused twice: a peak that moves with the fold is a peak in the corpus.
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < 40; index += 1) {
      const datapack = `case-${index}`;
      const fold = foldOf('HTTPResponseReplaceCode', index);
      // Fold 0's answers did 20 units of work; fold 1's did 400. A bar of 30 repairs fold 0 and not fold 1; a bar
      // of 500 repairs fold 1 and not fold 0 — so each fold picks a different bar and neither survives the swap.
      const work = fold === 0 ? 20 : 400;
      rows.push(splitCase({ datapack, truth: ['front'] }));
      profiles.set(datapack, new Map([['deep', { resource: work, traffic: 900, other: null }]]));
    }
    const report = crossValidate(rows, profiles, [30, 200, 500]);
    expect(report.selected[0]).not.toBe(report.selected[1]);
    expect(report.passes).toBe(false);
  });

  it('reads an empty corpus as no reading rather than as a perfect one', () => {
    const report = crossValidate([], new Map(), [200]);
    expect(report.sizes).toEqual([0, 0]);
    expect(report.passes).toBe(false);
  });

  it('breaks a tie towards the smaller bar, so the same grid always reports the same selection', () => {
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < 8; index += 1) {
      const datapack = `case-${index}`;
      rows.push(splitCase({ datapack, truth: ['front'] }));
      profiles.set(datapack, new Map([['deep', TRAFFIC_SHAPED]]));
    }
    const report = crossValidate(rows, profiles, [30, 100]);
    expect(report.selected).toEqual([30, 30]);
  });
});

describe('reading an artifact row as a case', () => {
  /** An artifact row, whose surprise is recorded per SIDE rather than for the settled answer. */
  function armRow(over: Partial<import('../src/channel-split.js').ArmRow> = {}) {
    return {
      datapack: 'case-a',
      faultType: 'HTTPResponseReplaceCode',
      truth: ['front'],
      answer: 'deep',
      entry: 'front',
      entryChildErrors: 0,
      belowFails: false,
      rawAnswer: 'deep',
      rawSurprise: 900,
      priorSurprise: 40,
      novelCaller: null,
      novelRise: null,
      ...over,
    };
  }

  it('reads the MODEL’s departure when the model’s answer is the one that stands', () => {
    expect(toSplitCase(armRow()).answerSurprise).toBe(900);
  });

  it('reads the PRIOR’s departure when a refusal settled on the prior', () => {
    // The case that shipped broken: with the per-side columns unread, every row's surprise was `undefined`, the
    // resolver narrowed it to a refusal on all 1 422 rows, and the sweep printed six identical rows that looked
    // like a refuted hypothesis instead of an unconnected instrument.
    const refused = armRow({ answer: 'front', entry: null, rawAnswer: 'deep', priorSurprise: 40 });
    expect(toSplitCase(refused).answerSurprise).toBe(40);
  });

  it('does not borrow the other side’s measurement when the settled side has none', () => {
    // The prior's surprise is about a DIFFERENT service, so substituting it would price the rule on a name the
    // answer did not settle on. A settled side with no measurement is a refusal, and it reads as one.
    expect(toSplitCase(armRow({ rawSurprise: null })).answerSurprise).toBeNull();
    // The one fallback that is not a substitution: a case with NO answer at all settles on nothing, and the prior's
    // reading is the only one its refusal could have been about.
    expect(
      toSplitCase(armRow({ answer: null, rawSurprise: 900, priorSurprise: 40 })).answerSurprise,
    ).toBe(40);
    expect(
      toSplitCase(armRow({ answer: null, rawSurprise: 900, priorSurprise: null })).answerSurprise,
    ).toBe(900);
  });

  it('refuses an artifact that carries neither column, rather than reading it as a refusal', () => {
    // A null and an absent key mean different things: the first is a measurement, the second is a schema the axis
    // was not written for. Reading the second as the first is how a whole sweep came to read nothing.
    const legacy = { ...armRow() } as Record<string, unknown>;
    delete legacy.rawSurprise;
    delete legacy.priorSurprise;
    expect(() => toSplitCase(legacy as never)).toThrow(/carries no surprise column/);
  });

  it('carries every column the rule reads straight through', () => {
    const one = toSplitCase(armRow({ novelCaller: 'mid', novelRise: 12 }));
    expect(one).toMatchObject({
      datapack: 'case-a',
      answer: 'deep',
      entry: 'front',
      belowFails: false,
      novelCaller: 'mid',
      novelRise: 12,
    });
  });
});
