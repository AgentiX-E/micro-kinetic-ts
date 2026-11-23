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
  MIN_SEPARATION_PRECISION,
  SYMPTOM_GRID,
  correctUnder,
  crossValidate,
  crossValidateConditioned,
  foldOf,
  gateHolds,
  resolvedUnder,
  separationOf,
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

/** A departure with the three non-symptom channels given and both symptom columns empty by default. */
function departure(
  resource: number | null,
  traffic: number | null,
  other: number | null,
  symptomRise: number | null = null,
): ChannelDeparture {
  return { resource, traffic, other, symptom: null, symptomRise };
}

/** The traffic-shaped profile the axis exists for: no work of its own, a loud retry storm. */
const TRAFFIC_SHAPED: ChannelDeparture = departure(5, 900, null);

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
    const worked: ChannelDeparture = departure(900, 950, null);
    expect(resolvedUnder(splitCase(), profilesOf('case-a', 'deep', worked), 200)).toBe('deep');
  });

  it('reads the bar it was given rather than a constant, so a sweep is one grid and one function', () => {
    const mild: ChannelDeparture = departure(50, 900, null);
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
        new Map([['deep', worked ? departure(900, 950, null) : TRAFFIC_SHAPED]]),
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
      if (kept >= 3) thinner.set(id, new Map([['deep', departure(900, 950, null)]]));
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
      profiles.set(datapack, new Map([['deep', departure(work, 900, null)]]));
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
    // Neither side carries a measurement: a refusal, which is what the resolver reads it as rather than as quiet.
    expect(
      toSplitCase(armRow({ answer: null, rawSurprise: null, priorSurprise: null })).answerSurprise,
    ).toBeNull();
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

describe('the population the front door’s rule addresses', () => {
  it('holds for a case whose premise is satisfied and whose answer moved past the threshold', () => {
    expect(gateHolds(splitCase())).toBe(true);
  });

  it('refuses a case the premise refuses, clause by clause', () => {
    // Every clause is a different mistake, and a population table that included one of these cases would be stating
    // the rule's reach over cases it never speaks about.
    expect(gateHolds(splitCase({ belowFails: true }))).toBe(false);
    expect(gateHolds(splitCase({ entryChildErrors: 1 }))).toBe(false);
    expect(gateHolds(splitCase({ entry: 'deep' }))).toBe(false);
    expect(gateHolds(splitCase({ answer: null }))).toBe(false);
    expect(gateHolds(splitCase({ entryChildErrors: null }))).toBe(false);
  });

  it('refuses a case whose answer did not move, which is the threshold rather than the premise', () => {
    expect(gateHolds(splitCase({ answerSurprise: 300 }))).toBe(false);
    expect(gateHolds(splitCase({ answerSurprise: 301 }))).toBe(true);
    expect(gateHolds(splitCase({ answerSurprise: null }))).toBe(false);
  });

  it('refuses a case a witness already settled, because the front door never reads it', () => {
    expect(gateHolds(splitCase({ novelCaller: 'mid', novelRise: 12 }))).toBe(false);
  });
});

describe('the conditioned rule, priced on both folds and swapped', () => {
  /**
   * The corpus 329 exists for: every case is addressed by the rule, two thirds of them are wrong answers
   * (repairable) and one third are right ones (at risk), and the two populations differ ONLY in the error rate the
   * answer carries. Two thirds rather than a half because the wrong/right split must not track the fold's parity —
   * a fixture whose populations fall into different folds measures the folds rather than the rule.
   */
  function twoPopulations(count: number): {
    rows: SplitCase[];
    profiles: Map<string, Map<string, ChannelDeparture>>;
  } {
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < count; index += 1) {
      const datapack = `case-${index}`;
      const wrong = index % 3 !== 0;
      rows.push(splitCase({ datapack, truth: wrong ? ['front'] : ['deep'] }));
      // The repairable population's answer is failing through (a rewritten response code); the at-risk
      // population's is merely slow (a delay), which is the shape 328 could not tell apart.
      profiles.set(datapack, new Map([['deep', departure(5, 900, null, wrong ? 0.4 : 0)]]));
    }
    return { rows, profiles };
  }

  /** How many rows a predicate selects, per fold. */
  function perFold(
    rows: readonly SplitCase[],
    keep: (one: SplitCase) => boolean,
  ): [number, number] {
    const steps: [number, number] = [0, 0];
    rows.forEach((one, index) => {
      if (keep(one)) {
        const familyIndex = rows
          .slice(0, index)
          .filter((o) => o.faultType === one.faultType).length;
        steps[foldOf(one.faultType, familyIndex)] += 1;
      }
    });
    return steps;
  }

  it('repairs what the pooled bar also repairs, and breaks none of what it broke', () => {
    // This is the whole claim of 329 in one assertion: the conditioned rule keeps the repairs and refuses the harm.
    const { rows, profiles } = twoPopulations(24);
    const pooled = crossValidate(rows, profiles, [750]);
    const conditioned = crossValidateConditioned(rows, profiles, [750], [0.01]);
    expect(pooled.sweep[0]!.breaks).toBeGreaterThan(0);
    expect(conditioned.cells[0]!.repairs).toBe(pooled.sweep[0]!.repairs);
    expect(conditioned.cells[0]!.breaks).toBe(0);
  });

  it('selects a cell per fold and reads it once on the other, in both directions', () => {
    const { rows, profiles } = twoPopulations(24);
    const repairable = perFold(rows, (one) => !one.truth.includes('deep'));
    const report = crossValidateConditioned(rows, profiles, [200, 750], [0.01, 0.05]);
    expect(report.sizes[0] + report.sizes[1]).toBe(rows.length);
    expect(report.selected[0].kappa).toBe(report.selected[1].kappa);
    expect(report.selected[0].floor).toBe(report.selected[1].floor);
    expect(report.heldOut[0]).toBe(report.mixed[0] + repairable[0]);
    expect(report.heldOut[1]).toBe(report.mixed[1] + repairable[1]);
    expect(report.passes).toBe(true);
  });

  it('sweeps every cell of both grids, in a fixed order', () => {
    const { rows, profiles } = twoPopulations(6);
    const report = crossValidateConditioned(rows, profiles, [30, 200], [0.01, 0.05]);
    expect(report.cells.map((one) => `${one.kappa}/${one.floor}`)).toEqual([
      '30/0.01',
      '30/0.05',
      '200/0.01',
      '200/0.05',
    ]);
  });

  it('refuses a reading whose two folds choose floors more than one step apart', () => {
    // The second coordinate's guard: a selection over thirty cells needs a stability test that scales with it, and
    // a floor that moves with the fold is a floor fitted to the fold. Fold 0 carries at-risk answers whose error rate
    // rose slightly, so it must clear a HIGH floor to spare them; fold 1 carries none, so it takes the lowest floor
    // that repairs its cases.
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < 60; index += 1) {
      const datapack = `case-${index}`;
      const fold = foldOf('HTTPResponseReplaceCode', index);
      const wrong = index % 3 !== 0;
      rows.push(splitCase({ datapack, truth: wrong ? ['front'] : ['deep'] }));
      const rise = wrong ? (fold === 0 ? 0.4 : 0.001) : fold === 0 ? 0.02 : 0;
      profiles.set(datapack, new Map([['deep', departure(5, 900, null, rise)]]));
    }
    const report = crossValidateConditioned(
      rows,
      profiles,
      [750],
      [0.0001, 0.001, 0.01, 0.05, 0.1],
    );
    expect(report.selected[0].floor).toBeGreaterThan(report.selected[1].floor);
    expect(report.passes).toBe(false);
  });

  it('reads an empty corpus as no reading rather than as a perfect one', () => {
    const report = crossValidateConditioned([], new Map(), [750], [0.01]);
    expect(report.sizes).toEqual([0, 0]);
    expect(report.passes).toBe(false);
  });
});

describe('whether the conditioning column separates the two populations', () => {
  /** A corpus with `repairable` wrong answers and `safe` right ones, both addressed by the rule. */
  function populations(
    repairable: number,
    safe: number,
    rise: (wrong: boolean, index: number) => number | null,
  ): { rows: SplitCase[]; profiles: Map<string, Map<string, ChannelDeparture>> } {
    const rows: SplitCase[] = [];
    const profiles = mutableProfiles();
    for (let index = 0; index < repairable + safe; index += 1) {
      const datapack = `case-${index}`;
      const wrong = index < repairable;
      rows.push(splitCase({ datapack, truth: wrong ? ['front'] : ['deep'] }));
      profiles.set(datapack, new Map([['deep', departure(5, 900, null, rise(wrong, index))]]));
    }
    return { rows, profiles };
  }

  it('reads the population sizes the rule addresses, not the whole corpus', () => {
    const { rows, profiles } = populations(4, 6, () => 0.4);
    const reading = separationOf(rows, profiles, 750, [0.01]);
    expect(reading.reachableTotal).toBe(4);
    expect(reading.atRiskTotal).toBe(6);
  });

  it('counts a case the premise refuses in neither population', () => {
    const { rows, profiles } = populations(2, 2, () => 0.4);
    rows.push(splitCase({ datapack: 'outside', belowFails: true }));
    profiles.set('outside', new Map([['deep', departure(5, 900, null, 0.4)]]));
    const reading = separationOf(rows, profiles, 750, [0.01]);
    expect(reading.reachableTotal + reading.atRiskTotal).toBe(4);
  });

  it('reports the precision each floor reaches, and calls the column separable when one clears the bar', () => {
    const { rows, profiles } = populations(3, 12, (wrong) => (wrong ? 0.4 : 0));
    const reading = separationOf(rows, profiles, 750, [0.01]);
    expect(reading.readings[0]).toEqual({
      floor: 0.01,
      reachable: 3,
      atRisk: 0,
      precision: 1,
    });
    expect(reading.separable).toBe(true);
    expect(reading.best!.floor).toBe(0.01);
  });

  it('refuses a column whose two populations are equally likely to clear it', () => {
    // The 328 situation, restated: the condition holds on both populations, so it separates nothing and no sweep
    // may be run on it however the bar is chosen.
    const { rows, profiles } = populations(3, 12, () => 0.4);
    const reading = separationOf(rows, profiles, 750, [0.01]);
    expect(reading.readings[0]!.precision).toBeCloseTo(3 / 15, 10);
    expect(reading.readings[0]!.precision!).toBeLessThan(MIN_SEPARATION_PRECISION);
    expect(reading.separable).toBe(false);
  });

  it('never reads an unmeasured error rate as a quiet one', () => {
    // `null` is the producer's refusal: a case whose error-rate family the corpus does not carry must not be counted
    // as a case the condition rejects on the merits, which would make the column look sharper than it is.
    const { rows, profiles } = populations(2, 2, () => null);
    const reading = separationOf(rows, profiles, 750, [0.01]);
    expect(reading.readings[0]).toEqual({ floor: 0.01, reachable: 0, atRisk: 0, precision: null });
    expect(reading.best).toBeNull();
    expect(reading.separable).toBe(false);
  });

  it('takes the best floor rather than the first, and the default floor grid is the registered one', () => {
    const { rows, profiles } = populations(3, 12, (wrong) => (wrong ? 0.4 : 0.005));
    const reading = separationOf(rows, profiles, 750);
    expect(reading.readings.map((one) => one.floor)).toEqual([...SYMPTOM_GRID]);
    // At 0.01 all three repairable cases clear it and none of the safe ones do — and at 0.05 the same, so the tie
    // goes to the smaller floor rather than to the sharper column.
    expect(reading.best!.floor).toBe(0.01);
    expect(reading.readings.map((one) => one.precision)).toEqual([3 / 15, 3 / 15, 1, 1, 1]);
  });

  it('admits nothing for a case the profile map does not carry, rather than reading it as a conduit', () => {
    // A profile join miss is an ABSENT measurement: a rule that read it as "no work of its own" would fire on every
    // row of an artifact priced against a corpus walked from a different directory.
    const rows = [splitCase({ datapack: 'missing', truth: ['front'] })];
    const reading = separationOf(rows, new Map(), 750, [0.01]);
    expect(reading.reachableTotal).toBe(1);
    expect(reading.readings[0]).toEqual({ floor: 0.01, reachable: 0, atRisk: 0, precision: null });
  });

  it('prices the condition at the bar it is given, rather than at a bar it chose', () => {
    const { rows, profiles } = populations(3, 0, () => 0.4);
    const worked: Profiles = new Map(
      [...(profiles as Map<string, Map<string, ChannelDeparture>>)].map(([id]) => [
        id,
        new Map([['deep', departure(900, 900, null, 0.4)]]),
      ]),
    );
    expect(separationOf(rows, worked, 750, [0.01]).reachableTotal).toBe(3);
    expect(separationOf(rows, worked, 750, [0.01]).readings[0]!.reachable).toBe(0);
  });
});
