/**
 * A delta between two artifacts is only a measurement when the two artifacts agree on everything else.
 *
 * This file is the fence around the mistake that ran for three iterations: a **236-case "model drift"** that was
 * nothing of the kind. The 2026-11-22 artifact ran `gate contrast, fallback engine` with the resolvers on and settled
 * **287 of its 532 sampled cases without the model**; the 2026-11-25 artifact ran all three off and answered every case
 * from the model. Both were called "the free arm". 186 of the 244-case gap was never a model answer, and the two
 * fields that separate them — `fallback` and `resolve` — were absent from the record written to make comparisons safe.
 *
 * So the tests come in three groups: the record has to name those fields, the comparison has to refuse files that
 * differ outside the axis, and the statistics have to agree with the figures this programme already published.
 */

import { describe, expect, it } from 'vitest';

import {
  armTokensOf,
  comparisonRefusal,
  erfc,
  formatComparison,
  formatP,
  mcnemarAsymptotic,
  mcnemarExact,
  pairedComparisonOf,
} from '../src/arm-comparison.js';
import { runMetadataOf, type RunMetadata } from '../src/run-metadata.js';

/** A metadata record with every field at its default, for the refusals to move one at a time. */
function meta(overrides: Partial<RunMetadata> = {}): RunMetadata {
  return {
    model: 'deepseek-chat',
    startedAt: '2026-11-25T00:35:25.000Z',
    endedAt: '2026-11-25T01:31:07.000Z',
    durationSeconds: 3_342,
    cases: 532,
    budget: { maxRounds: 6, maxToolCalls: 10 },
    arms: 'free',
    revision: '3a1f333',
    ...overrides,
  };
}

describe('mcnemar', () => {
  it('reproduces the figures this programme published', () => {
    // 22 against 14 is the free repeat of 11-25 read against 11-24; `sota-comparison.md` §20 quotes p = 0.243, which
    // is the continuity-corrected chi-square. Both forms are reported so a reader can reconcile the two.
    expect(mcnemarAsymptotic(22, 14)).toBeCloseTo(0.243, 3);
    // 16 against 30 is the schedule arm against the same night's control, quoted at p = 0.054.
    expect(mcnemarAsymptotic(16, 30)).toBeCloseTo(0.055, 3);
    // 245 against 9 is the drift that was not one.
    expect(mcnemarAsymptotic(245, 9)).toBeLessThan(0.001);
    expect(mcnemarExact(245, 9)).toBeLessThan(0.001);
  });

  it('agrees with the asymptotic form where the discordant count is large', () => {
    // The two forms converge as the discordant count grows, which is the only regime in which quoting either is safe.
    expect(mcnemarExact(120, 100)).toBeCloseTo(mcnemarAsymptotic(120, 100), 2);
  });

  it('is symmetric, because a two-sided test cannot care which file is named first', () => {
    expect(mcnemarExact(39, 11)).toBeCloseTo(mcnemarExact(11, 39), 12);
    expect(mcnemarAsymptotic(39, 11)).toBeCloseTo(mcnemarAsymptotic(11, 39), 12);
  });

  it('reads no discordant pair as no evidence rather than as certainty', () => {
    // `2 · P(X ≤ 0)` with n = 0 is 1, and a test that returned 0 here would call every identical pair significant.
    expect(mcnemarExact(0, 0)).toBe(1);
    expect(mcnemarAsymptotic(0, 0)).toBe(1);
  });

  it('refuses counts that are not counts', () => {
    expect(() => mcnemarExact(1.5, 2)).toThrow(/integers/);
    expect(() => mcnemarExact(-1, 2)).toThrow(/negative/);
  });
});

describe('erfc', () => {
  it('is 1 at zero and symmetric about it', () => {
    expect(erfc(0)).toBeCloseTo(1, 7);
    expect(erfc(-1)).toBeCloseTo(2 - erfc(1), 7);
  });

  it('matches the tabulated values the tail depends on', () => {
    expect(erfc(1)).toBeCloseTo(0.157_299, 6);
    expect(erfc(2)).toBeCloseTo(0.004_677_7, 7);
  });
});

describe('paired comparison', () => {
  it('counts the 2 × 2 over the cases both files carry', () => {
    const first = [
      { datapack: 'a', correct: true },
      { datapack: 'b', correct: true },
      { datapack: 'c', correct: false },
      { datapack: 'd', correct: false },
    ];
    const second = [
      { datapack: 'a', correct: true },
      { datapack: 'b', correct: false },
      { datapack: 'c', correct: true },
      { datapack: 'd', correct: false },
    ];
    const counts = pairedComparisonOf(first, second);
    expect(counts.shared).toBe(4);
    expect(counts.bothRight).toBe(1);
    expect(counts.firstOnly).toBe(1);
    expect(counts.secondOnly).toBe(1);
    expect(counts.delta).toBe(0);
    // One case each way is the null, and the two-sided exact p is 1 rather than 0.5.
    expect(counts.pExact).toBe(1);
  });

  it('refuses two files that do not cover the same cases, and names one of them', () => {
    // A delta over the intersection would be a movement on a denominator neither file states — the defect that made
    // 344's decomposition unreadable.
    expect(() =>
      pairedComparisonOf(
        [{ datapack: 'a', correct: true }],
        [
          { datapack: 'a', correct: true },
          { datapack: 'b', correct: true },
        ],
      ),
    ).toThrow(/only in the second.*`b`/);
    expect(() =>
      pairedComparisonOf(
        [
          { datapack: 'a', correct: true },
          { datapack: 'b', correct: true },
        ],
        [{ datapack: 'a', correct: true }],
      ),
    ).toThrow(/only in the first/);
  });

  it('refuses a repeated case, because the last row would win by a rule no artifact states', () => {
    expect(() =>
      pairedComparisonOf(
        [
          { datapack: 'a', correct: true },
          { datapack: 'a', correct: false },
        ],
        [{ datapack: 'a', correct: true }],
      ),
    ).toThrow(/appears twice/);
  });

  it('refuses a `correct` that is not a boolean', () => {
    // A truthy string would be read as a hit, and an artifact with one would report a precision it never measured.
    expect(() =>
      pairedComparisonOf(
        [{ datapack: 'a', correct: 'yes' as unknown as boolean }],
        [{ datapack: 'a', correct: true }],
      ),
    ).toThrow(/non-boolean/);
  });

  it('refuses an empty artifact, because an empty file measures nothing', () => {
    expect(() => pairedComparisonOf([], [])).toThrow(/no rows/);
  });
});

describe('arm tokens', () => {
  it('reads `free` as no flags at all', () => {
    expect([...armTokensOf('free').entries()]).toEqual([]);
    expect([...armTokensOf('').entries()]).toEqual([]);
  });

  it('splits the `+`-joined record into the flags it names', () => {
    expect([...armTokensOf('gate=contrast+fallback=engine+resolve=edge-novel').entries()]).toEqual([
      ['gate', 'contrast'],
      ['fallback', 'engine'],
      ['resolve', 'edge-novel'],
    ]);
  });

  it('refuses a part that is not a flag', () => {
    expect(() => armTokensOf('gate')).toThrow(/name=value/);
    expect(() => armTokensOf('a=b=c')).toThrow(/name=value/);
    // A part with no name is the spelling that would otherwise enter the map under the empty string and never be
    // compared with anything.
    expect(() => armTokensOf('=contrast')).toThrow(/name=value/);
  });
});

describe('the refusal', () => {
  it('passes two artifacts that differ only along the declared axis', () => {
    expect(
      comparisonRefusal(meta({ arms: 'free' }), meta({ arms: 'fleet=engine' }), ['fleet']),
    ).toBeNull();
    expect(
      comparisonRefusal(meta({ arms: 'gate=lag+onset=onset' }), meta({ arms: 'gate=lag' }), [
        'onset',
      ]),
    ).toBeNull();
  });

  it('refuses the configuration delta that was read as model drift', () => {
    // The exact pair: `free` against `gate=contrast+fallback=engine+resolve=edge-novel`. On 2026-11-25 this pair was
    // read as a 236-case drift in one arm. It is a difference of three decisions and the refusal says which.
    const refusal = comparisonRefusal(
      meta({ arms: 'gate=contrast+fallback=engine+resolve=edge-novel' }),
      meta({ arms: 'free' }),
      ['fleet'],
    );
    expect(refusal).toContain('`gate`');
    expect(refusal).toContain('`fallback`');
    expect(refusal).toContain('`resolve`');
    expect(refusal).toContain('outside the axis');
  });

  it('names a flag that is absent from one record as a difference rather than a default', () => {
    expect(
      comparisonRefusal(meta({ arms: 'fallback=engine' }), meta({ arms: 'free' }), ['fallback']),
    ).toBe(null);
    const refusal = comparisonRefusal(
      meta({ arms: 'fallback=engine' }),
      meta({ arms: 'free' }),
      [],
    );
    expect(refusal).toContain('`fallback`: `engine` vs `absent`');
    // And the mirror, because a refusal that only ever printed the absence on one side would be a refusal written
    // for one direction of the same comparison.
    expect(
      comparisonRefusal(meta({ arms: 'free' }), meta({ arms: 'fallback=engine' }), []),
    ).toContain('`fallback`: `absent` vs `engine`');
  });

  it('refuses two models, because a supplier renames a target without telling its callers', () => {
    expect(comparisonRefusal(meta({ model: 'a' }), meta({ model: 'b' }), [])).toContain(
      'model: `a` vs `b`',
    );
  });

  it('refuses two budgets, because a wider investigation sees more of the case', () => {
    expect(
      comparisonRefusal(meta({ budget: { maxRounds: 11, maxToolCalls: 10 } }), meta(), []),
    ).toContain('budget: 11 rounds / 10 calls vs 6 rounds / 10 calls');
  });

  it('refuses two artifacts that differ only in the transcript cap, unless the cap IS the axis', () => {
    // The cap is a harness setting: it decides what the model can still see, so a delta across it is the cap's. A
    // comparison that ignored it would publish the cap as the arm effect — the exact error iteration 346 made with a
    // gate, in a smaller field.
    const reference = { budget: { maxRounds: 6, maxToolCalls: 10, transcriptChars: 9_000 } };
    const capped = { budget: { maxRounds: 6, maxToolCalls: 10, transcriptChars: 900 } };
    expect(comparisonRefusal(meta(reference), meta(capped), ['transcript'])).toBeNull();
    expect(comparisonRefusal(meta(reference), meta(capped), [])).toContain(
      'transcript: 9000 chars vs 900 chars',
    );
    // And the cap does not license a budget difference: rounds still have to match.
    const wider = { budget: { maxRounds: 11, maxToolCalls: 10, transcriptChars: 900 } };
    expect(comparisonRefusal(meta(reference), meta(wider), ['transcript'])).toContain('budget:');
  });

  it('refuses two revisions, because the instruction is a function of the code', () => {
    expect(comparisonRefusal(meta({ revision: 'aaa' }), meta({ revision: 'bbb' }), [])).toContain(
      'revision: `aaa` vs `bbb`',
    );
    // A bisect is a legitimate experiment, and it declares the axis it is a bisect of.
    expect(
      comparisonRefusal(meta({ revision: 'aaa' }), meta({ revision: 'bbb' }), ['revision']),
    ).toBeNull();
    // An unrecorded revision is not a match: it is unknown, and unknown is refused by name.
    expect(comparisonRefusal(meta({ revision: null }), meta({ revision: null }), [])).toBeNull();
    expect(comparisonRefusal(meta({ revision: null }), meta({ revision: 'bbb' }), [])).toContain(
      '`unrecorded` vs `bbb`',
    );
    // Both sides of the same absence, because a message that named only the first side would leave a reader unable to
    // tell which file was the one that could not say.
    expect(comparisonRefusal(meta({ revision: 'aaa' }), meta({ revision: null }), [])).toContain(
      '`aaa` vs `unrecorded`',
    );
  });
});

describe('the report', () => {
  it('prints the 2 × 2, the delta and both p-values', () => {
    const counts = {
      shared: 532,
      onlyFirst: 0,
      onlySecond: 0,
      bothRight: 169,
      firstOnly: 245,
      secondOnly: 9,
      delta: -236,
      pExact: 0.000_1,
      pAsymptotic: 0.000_2,
    };
    const report = formatComparison('free 11-22', 'free 11-25', counts);
    expect(report).toContain('paired on 532 cases');
    expect(report).toContain('only free 11-22 245');
    expect(report).toContain('only free 11-25 9');
    expect(report).toContain('+9 - 245 = -236 cases (-44.36 pp)');
    expect(report).toContain('p exact < 0.001');
    expect(report).toContain('p asymptotic < 0.001');
  });

  it('formats a p that is not below the floor to three decimals', () => {
    expect(formatP(0.243)).toBe('0.243');
    expect(formatP(0.000_9)).toBe('< 0.001');
  });
});

describe('the record the comparison reads', () => {
  it('names `fallback` and `resolve`, the two flags whose absence cost a day', () => {
    const record = runMetadataOf({
      model: 'deepseek-chat',
      startedAt: '2026-11-22T23:46:44.000Z',
      endedAt: '2026-11-23T00:52:00.000Z',
      cases: 1_422,
      maxRounds: 6,
      maxToolCalls: 10,
      seed: 'none',
      gate: 'contrast',
      fallback: 'engine',
      resolve: 'edge-novel',
      schedule: 'none',
      fleetOrder: 'none',
      evidenceOrder: 'none',
      certaintyFloor: 0,
    });
    // The 2026-11-22 artifact's own banner reads `gate contrast, fallback engine`; before this change the record it
    // wrote beside 1 422 rows said only `gate=contrast`, and the resolvers were recorded nowhere at all.
    expect(record.arms).toBe('gate=contrast+fallback=engine+resolve=edge-novel');
  });

  it('records the revision, or says it could not', () => {
    const base = {
      model: 'm',
      startedAt: '2026-11-25T00:00:00.000Z',
      endedAt: '2026-11-25T00:00:01.000Z',
      cases: 1,
      maxRounds: 6,
      maxToolCalls: 10,
      seed: 'none' as const,
      gate: 'none',
      fallback: 'none' as const,
      resolve: 'none',
      schedule: 'none' as const,
      fleetOrder: 'none' as const,
      evidenceOrder: 'none' as const,
      certaintyFloor: 0,
    };
    expect(runMetadataOf(base).revision).toBeNull();
    expect(runMetadataOf({ ...base, revision: '3a1f333' }).revision).toBe('3a1f333');
  });

  it('keeps `free` for a run whose every flag is at its default, now that there are two more', () => {
    const base = {
      model: 'm',
      startedAt: '2026-11-25T00:00:00.000Z',
      endedAt: '2026-11-25T00:00:01.000Z',
      cases: 1,
      maxRounds: 6,
      maxToolCalls: 10,
      seed: 'none' as const,
      gate: 'none',
      fallback: 'none' as const,
      resolve: 'none',
      schedule: 'none' as const,
      fleetOrder: 'none' as const,
      evidenceOrder: 'none' as const,
      certaintyFloor: 0,
    };
    expect(runMetadataOf(base).arms).toBe('free');
  });
});
