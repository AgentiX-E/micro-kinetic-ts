import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ARM_METRICS,
  compareArms,
  parseArmBaseline,
  ranksToReading,
  renderArmComparison,
  strictDominance,
  type ArmBaseline,
  type ArmReading,
} from '../src/cloudopsbench-arm-baseline.js';

const reading = (over: Partial<ArmReading> = {}): ArmReading => ({
  arm: 'shipped',
  weight: 0,
  gate: 0,
  jurisdiction: 'tail',
  cases: 156,
  at1: 80,
  at3: 110,
  at5: 129,
  ...over,
});

const baselineOf = (arms: readonly ArmReading[]): ArmBaseline => ({
  corpus: 'LLM4Ops/Cloud-OpsBench',
  revision: 'main@3b7c1e9',
  arms,
});

const json = (arms: readonly ArmReading[]): string => JSON.stringify(baselineOf(arms));

describe('ranksToReading', () => {
  it('counts a null rank as outside every threshold, never as first', () => {
    const one = ranksToReading('arm', { weight: 0.1, gate: 0, jurisdiction: 'tail' }, [
      1,
      3,
      5,
      6,
      null,
    ]);
    expect(one).toEqual({
      arm: 'arm',
      weight: 0.1,
      gate: 0,
      jurisdiction: 'tail',
      cases: 5,
      at1: 1,
      at3: 2,
      at5: 3,
    });
  });

  it('is monotone in the threshold, because the thresholds are nested', () => {
    const one = ranksToReading(
      'arm',
      { weight: 1, gate: 0, jurisdiction: 'tail' },
      [2, 4, 7, 1, 2],
    );
    expect(one.at1).toBeLessThanOrEqual(one.at3);
    expect(one.at3).toBeLessThanOrEqual(one.at5);
    expect(one.at5).toBeLessThanOrEqual(one.cases);
  });

  it('reads an empty population as zero cases rather than refusing, so the caller decides', () => {
    const one = ranksToReading('arm', { weight: 0, gate: 0, jurisdiction: 'tail' }, []);
    expect(one.cases).toBe(0);
    expect(one.at1).toBe(0);
  });

  it('carries the RESOLVED configuration, not a copy of a flag', () => {
    const one = ranksToReading(
      'arm',
      { weight: 0.05, gate: 0.02, jurisdiction: 'everywhere' },
      [1],
    );
    expect([one.weight, one.gate, one.jurisdiction]).toEqual([0.05, 0.02, 'everywhere']);
  });
});

describe('parseArmBaseline', () => {
  it('reads a well-formed file', () => {
    const parsed = parseArmBaseline(json([reading()]));
    expect(parsed.corpus).toBe('LLM4Ops/Cloud-OpsBench');
    expect(parsed.arms).toHaveLength(1);
  });

  it('refuses a corpus that is not owner/name, so a reading cannot be attributed to the wrong corpus', () => {
    expect(() =>
      parseArmBaseline(JSON.stringify({ corpus: 'Cloud-OpsBench', revision: 'x', arms: [] })),
    ).toThrow(/`corpus` must be `owner\/name`/);
  });

  it('refuses a revision that names nothing', () => {
    expect(() =>
      parseArmBaseline(JSON.stringify({ corpus: 'a/b', revision: '', arms: [reading()] })),
    ).toThrow(/`revision` must name what was measured/);
  });

  it('refuses an empty arm list, which would compare equal to every run', () => {
    expect(() => parseArmBaseline(json([]))).toThrow(/compares equal to nothing/);
  });

  it('refuses a file whose `arms` is not a list', () => {
    expect(() =>
      parseArmBaseline(JSON.stringify({ corpus: 'a/b', revision: 'r', arms: 3 })),
    ).toThrow(/compares equal to nothing/);
  });

  it('refuses an arm with no name', () => {
    expect(() => parseArmBaseline(json([reading({ arm: '' })]))).toThrow(/needs a name/);
  });

  it('refuses two arms with one name, because the comparison is keyed on it', () => {
    expect(() => parseArmBaseline(json([reading(), reading()]))).toThrow(/named twice/);
  });

  it('refuses a non-finite weight', () => {
    expect(() => parseArmBaseline(json([reading({ weight: Number.NaN })]))).toThrow(
      /non-finite weight or gate/,
    );
  });

  it('refuses a non-finite gate', () => {
    expect(() => parseArmBaseline(json([reading({ gate: Number.POSITIVE_INFINITY })]))).toThrow(
      /non-finite weight or gate/,
    );
  });

  it('refuses an arm with no jurisdiction word', () => {
    expect(() => parseArmBaseline(json([reading({ jurisdiction: '' })]))).toThrow(
      /names no jurisdiction/,
    );
  });

  it('refuses a reading of zero cases', () => {
    expect(() => parseArmBaseline(json([reading({ cases: 0, at1: 0, at3: 0, at5: 0 })]))).toThrow(
      /scored 0 cases/,
    );
  });

  it('refuses a fractional case count', () => {
    expect(() => parseArmBaseline(json([reading({ cases: 15.5 })]))).toThrow(/scored 15.5 cases/);
  });

  it('refuses a count above the population', () => {
    expect(() => parseArmBaseline(json([reading({ at5: 157 })]))).toThrow(/not a count within 156/);
  });

  it('refuses a negative count', () => {
    expect(() => parseArmBaseline(json([reading({ at1: -1 })]))).toThrow(/not a count within 156/);
  });

  it('refuses a non-integer count', () => {
    expect(() => parseArmBaseline(json([reading({ at3: 1.5 })]))).toThrow(/not a count within 156/);
  });

  it('refuses a reading whose thresholds are not nested, which no ranking can produce', () => {
    expect(() => parseArmBaseline(json([reading({ at1: 100, at3: 99 })]))).toThrow(
      /which is not nested/,
    );
  });
});

describe('compareArms', () => {
  it('reports nothing when every recorded arm reads the same', () => {
    const comparison = compareArms(baselineOf([reading()]), [reading()]);
    expect(comparison.movements).toEqual([]);
    expect(comparison.absent).toEqual([]);
    expect(comparison.unexpected).toEqual([]);
  });

  it('reports each moved metric separately, so a trade is visible as a trade', () => {
    const comparison = compareArms(baselineOf([reading()]), [
      reading({ at1: 90, at3: 124, at5: 138 }),
    ]);
    expect(comparison.movements).toEqual([
      { arm: 'shipped', metric: 'at1', baseline: 80, actual: 90 },
      { arm: 'shipped', metric: 'at3', baseline: 110, actual: 124 },
      { arm: 'shipped', metric: 'at5', baseline: 129, actual: 138 },
    ]);
  });

  it('names an arm the run did not produce rather than skipping it', () => {
    const comparison = compareArms(baselineOf([reading(), reading({ arm: 'enrolled' })]), [
      reading(),
    ]);
    expect(comparison.absent).toEqual(['enrolled']);
  });

  it('names an arm the baseline does not record rather than comparing it to nothing', () => {
    const comparison = compareArms(baselineOf([reading()]), [
      reading(),
      reading({ arm: 'new-arm' }),
    ]);
    expect(comparison.unexpected).toEqual(['new-arm']);
  });

  it('throws on a population change, which is an announcement and not a regression', () => {
    expect(() => compareArms(baselineOf([reading()]), [reading({ cases: 155, at5: 128 })])).toThrow(
      /that is a different population, not a movement/,
    );
  });
});

describe('strictDominance', () => {
  it('holds when one arm is never worse and somewhere better', () => {
    expect(strictDominance(reading({ at3: 124, at5: 141 }), reading())).toBe(true);
  });

  it('fails when the arm is worse on the head, however much depth it gains', () => {
    expect(strictDominance(reading({ at1: 79, at3: 124, at5: 141 }), reading())).toBe(false);
  });

  it('fails when the two arms read identically, because nothing was bought', () => {
    expect(strictDominance(reading(), reading())).toBe(false);
  });

  it('reads every metric in the tuple, so a metric added to the reading is not silently ignored', () => {
    expect(ARM_METRICS).toEqual(['at1', 'at3', 'at5']);
  });
});

describe('renderArmComparison', () => {
  it('renders a signed delta per movement', () => {
    const text = renderArmComparison(compareArms(baselineOf([reading()]), [reading({ at1: 90 })]));
    expect(text).toContain('shipped at1: 80 -> 90 (+10)');
  });

  it('renders a negative delta without a plus sign', () => {
    const text = renderArmComparison(compareArms(baselineOf([reading()]), [reading({ at1: 79 })]));
    expect(text).toContain('shipped at1: 80 -> 79 (-1)');
  });

  it('renders absent and unrecorded arms', () => {
    const text = renderArmComparison(
      compareArms(baselineOf([reading(), reading({ arm: 'gone' })]), [reading({ arm: 'fresh' })]),
    );
    expect(text).toContain('arm absent                  gone');
    expect(text).toContain('arm unrecorded              fresh');
  });

  it('says so plainly when nothing moved', () => {
    const text = renderArmComparison(compareArms(baselineOf([reading()]), [reading()]));
    expect(text).toContain('every recorded arm reads the same');
  });
});

describe('the committed reading of the third corpus', () => {
  const recorded = (): ArmBaseline =>
    parseArmBaseline(
      readFileSync(new URL('../baselines/cloudopsbench-arms.json', import.meta.url), 'utf8'),
    );
  const arm = (name: string): ArmReading => {
    const found = recorded().arms.find((one) => one.arm === name);
    if (found === undefined) throw new Error(`no arm \`${name}\``);
    return found;
  };

  it('parses, so a hand edit cannot leave the file unreadable by the gate that uses it', () => {
    const parsed = recorded();
    expect(parsed.corpus).toBe('LLM4Ops/Cloud-OpsBench');
    expect(parsed.revision).toMatch(/^[0-9a-f]{8}$/);
    expect(parsed.arms).toHaveLength(4);
  });

  it('holds the pin to its contract: enrolling the prior moves the head by exactly zero', () => {
    // `tail` clamps the head of the order the engine would report without the prior, so this identity is a
    // property of the design rather than of this corpus. It is asserted here because a change to `pinHeadFirst`
    // or to the containment pass would break it silently — the number would just be different.
    expect(arm('enrolled').at1).toBe(arm('shipped-before-enrolment').at1);
  });

  it('records the enrolled arm as a strict improvement on the third corpus, not a trade', () => {
    expect(strictDominance(arm('enrolled'), arm('shipped-before-enrolment'))).toBe(true);
  });

  it('records the two summed arms as NOT dominated, so the trade cannot be tidied into a hierarchy', () => {
    // Both summed arms buy head accuracy this corpus measures and pay depth for it. If a later change makes
    // `enrolled` dominate them, that is a result worth announcing — and this assertion is what forces the
    // announcement instead of letting the table drift.
    expect(strictDominance(arm('enrolled'), arm('gate-0.02-everywhere-0.1'))).toBe(false);
    expect(strictDominance(arm('enrolled'), arm('gate-0.02-everywhere-0.05'))).toBe(false);
    expect(strictDominance(arm('gate-0.02-everywhere-0.1'), arm('enrolled'))).toBe(false);
  });

  it("keeps every arm on one population, which is the corpus's whole warning", () => {
    const cases = new Set(recorded().arms.map((one) => one.cases));
    expect([...cases]).toEqual([156]);
  });
});
