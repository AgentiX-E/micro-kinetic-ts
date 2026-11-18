import { describe, expect, it } from 'vitest';

import type {
  CandidateFingerprint,
  PublishedCandidate,
} from '../../packages/ai/src/agent/index.js';
import { DEFAULT_NOMINATION_OPTIONS } from '../../packages/ai/src/agent/index.js';
import { DEFAULT_FINGERPRINT_OPTIONS } from '../src/agentic-fingerprint.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import {
  engineOrderOf,
  formatNominationRecord,
  formatNominationRefusals,
  formatNominationTable,
  formatPromotionReadout,
  formatPromotionTable,
  oracleTop1,
  parseNominationRecords,
  scoreNomination,
  spreadOrdersOf,
  type NominationRecord,
} from '../src/agentic-nomination.js';
import { DEFAULT_FINGERPRINT_TOP_K } from '../src/fse26-cli.js';

function candidate(service: string, rank: number, score: number): CandidateFingerprint {
  return { service, rank, score, channels: [] };
}

function oneCase(
  datapack: string,
  accepted: readonly string[],
  services: readonly string[],
): HeadroomCase {
  return {
    datapack,
    faultType: 'PodKill',
    accepted,
    candidates: services.map((service, index) => candidate(service, index, 1 - index * 0.1)),
  };
}

function record(
  datapack: string,
  ranking: readonly string[],
  extra: Partial<NominationRecord> = {},
): NominationRecord {
  return {
    datapack,
    model: 'deepseek-chat',
    protocol: 1,
    digest: '0123456789abcdef',
    ranking,
    ms: 900,
    promptTokens: 2000,
    completionTokens: 40,
    ...extra,
  };
}

const population: readonly HeadroomCase[] = [
  oneCase('case-a', ['b'], ['a', 'b', 'c']),
  oneCase('case-b', ['a'], ['a', 'b', 'c']),
  oneCase('case-c', ['c'], ['a', 'b', 'c']),
];

describe('engineOrderOf', () => {
  it('reads the posterior in rank order', () => {
    expect(engineOrderOf(population[0]!.candidates)).toEqual(['a', 'b', 'c']);
  });
});

describe('formatNominationRecord / parseNominationRecords', () => {
  it('round-trips a record byte for byte', () => {
    const text = formatNominationRecord(record('case-a', ['b', 'a']));
    const parsed = parseNominationRecords(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.records.get('case-a')).toEqual(record('case-a', ['b', 'a']));
  });

  it('omits malformed when the reply was readable, and keeps it when it was not', () => {
    expect(formatNominationRecord(record('case-a', []))).not.toContain('malformed');
    const broken = formatNominationRecord(
      record('case-a', [], { malformed: 'the reply is not JSON' }),
    );
    expect(broken).toContain('"malformed":"the reply is not JSON"');
  });

  it('ignores blank lines and accepts an empty file', () => {
    const parsed = parseNominationRecords('\n\n');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.records.size).toBe(0);
  });

  it('refuses a line that is not JSON, not an object, or missing a field', () => {
    for (const text of [
      '{',
      '[1,2]',
      '{"digest":"x","protocol":1,"ranking":[],"ms":1,"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","protocol":1,"ranking":[],"ms":1,"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","ranking":[],"ms":1,"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","protocol":1,"ms":1,"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","protocol":1,"ranking":[1],"ms":1,"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","protocol":1,"ranking":[],"promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","protocol":1,"ranking":[],"ms":"1","promptTokens":1,"completionTokens":1}',
      '{"datapack":"a","digest":"x","protocol":1,"ranking":[],"malformed":7,"ms":1,"promptTokens":1,"completionTokens":1}',
    ]) {
      const parsed = parseNominationRecords(text);
      expect(parsed.ok, text).toBe(false);
    }
  });

  it('reports the line number of the first defect', () => {
    const parsed = parseNominationRecords(
      '{"datapack":"a","digest":"x","protocol":1,"ranking":[],"ms":1,"promptTokens":1,"completionTokens":1}\n{oops}\n',
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.why).toBe('line 2: not JSON');
  });
});

describe('scoreNomination', () => {
  const records = new Map<string, NominationRecord>([
    ['case-a', record('case-a', ['b'])],
    ['case-b', record('case-b', [])],
    // `['c']`, not `['c', 'a']`: naming the engine's leader second would hand it the same promotion it is being
    // displaced from, and the fusion would then be right to leave it where it is. A nomination is an opinion about
    // position, so the services it does not name earn nothing from it.
    ['case-c', record('case-c', ['c'])],
  ]);

  it('is the engine at weight zero', () => {
    const outcome = scoreNomination(population, records, { strategy: 'rrf', weight: 0 });
    expect(outcome.top1).toBeCloseTo(1 / 3, 10);
    expect(outcome.moved).toBe(0);
    expect(outcome.cases).toBe(3);
  });

  it('moves the cases the model ranked, and only those', () => {
    const fused = scoreNomination(population, records, { strategy: 'rrf', weight: 1 });
    expect(fused.ranked).toBe(2);
    expect(fused.declined).toBe(1);
    expect(fused.top1).toBeCloseTo(1, 10);
    expect(fused.moved).toBe(2);
  });

  it('counts a refused nomination by family and keeps the engine answer', () => {
    const withGhost = new Map(records);
    withGhost.set('case-c', record('case-c', ['ghost']));
    const outcome = scoreNomination(population, withGhost, { strategy: 'rrf', weight: 1 });
    expect(outcome.refused['unknown-candidate']).toBe(1);
    expect(outcome.ranked).toBe(1);
    // case-a was repaired and case-b was already right under the engine; case-c kept its (wrong) engine answer.
    expect(outcome.correct).toBe(2);
  });

  it('counts a duplicate rather than reading it at first sight', () => {
    const withDup = new Map(records);
    withDup.set('case-c', record('case-c', ['c', 'c']));
    const outcome = scoreNomination(population, withDup, { strategy: 'rrf', weight: 1 });
    expect(outcome.refused['duplicate-candidate']).toBe(1);
  });

  it('keeps a case with no record in the denominator', () => {
    const partial = new Map([['case-a', record('case-a', ['b'])]]);
    const outcome = scoreNomination(population, partial, { strategy: 'rrf', weight: 1 });
    expect(outcome.missing).toBe(2);
    expect(outcome.cases).toBe(3);
    // case-a repaired, case-b already right under the engine, case-c unreachable without a record.
    expect(outcome.correct).toBe(2);
  });

  it('counts an unreadable reply as unreadable, not as an abstention', () => {
    const broken = new Map(records);
    broken.set('case-c', record('case-c', [], { malformed: 'the reply is not JSON' }));
    const outcome = scoreNomination(population, broken, { strategy: 'rrf', weight: 1 });
    expect(outcome.unreadable).toBe(1);
    expect(outcome.declined).toBe(1);
  });

  it('counts the cases no arm could have reached', () => {
    const absent = [oneCase('case-z', ['not-present'], ['a', 'b'])];
    const outcome = scoreNomination(absent, new Map(), { strategy: 'rrf', weight: 1 });
    expect(outcome.truthAbsent).toBe(1);
    expect(outcome.top1).toBe(0);
  });

  it('records correct answers per fault family', () => {
    const outcome = scoreNomination(population, records, { strategy: 'rrf', weight: 1 });
    expect(outcome.byFamily).toEqual({ PodKill: 3 });
  });

  it('is zero-rated on an empty population rather than NaN', () => {
    const outcome = scoreNomination([], new Map(), { strategy: 'rrf', weight: 1 });
    expect(outcome.top1).toBe(0);
    expect(outcome.cases).toBe(0);
  });
});

describe('oracleTop1', () => {
  it('counts the cases whose posterior holds an accepted answer', () => {
    expect(oracleTop1(population)).toBe(3);
    expect(oracleTop1([oneCase('x', ['ghost'], ['a'])])).toBe(0);
  });
});

describe('formatNominationTable', () => {
  it('prints a header, an oracle row and one row per arm', () => {
    const outcome = scoreNomination(population, new Map(), { strategy: 'rrf', weight: 0.5 });
    const table = formatNominationTable([outcome], 3, 3);
    const lines = table.split('\n');
    expect(lines[0]).toContain('arm');
    expect(lines[0]).toContain('strategy');
    expect(lines[1]).toContain('oracle');
    expect(lines[1]).toContain('100.0%');
    expect(lines[2]).toContain('nominate');
    expect(lines[2]).toContain('rrf');
    expect(lines[2]).toContain('0.50');
    expect(lines).toHaveLength(3);
  });

  it('does not divide by zero on an empty population', () => {
    const outcome = scoreNomination([], new Map(), { strategy: 'rrf', weight: 1 });
    expect(formatNominationTable([outcome], 0, 0)).toContain('0.0%');
  });
});

describe('formatNominationRefusals', () => {
  it('says so when no arm was scored', () => {
    expect(formatNominationRefusals([])).toBe('refusals: no arm was scored');
  });

  it('prints every family, including the ones at zero, and states where a refused case went', () => {
    const outcome = scoreNomination(population, new Map(), { strategy: 'rrf', weight: 1 });
    const text = formatNominationRefusals([outcome]);
    expect(text).toContain('refusals: 0');
    expect(text).toContain('unknown-candidate');
    expect(text).toContain('duplicate-candidate');
    expect(text).toContain('denominator stays the corpus');
  });

  it('divides a non-zero tally by its own total', () => {
    const withGhost = new Map([['case-a', record('case-a', ['ghost'])]]);
    const outcome = scoreNomination(population, withGhost, { strategy: 'rrf', weight: 1 });
    expect(formatNominationRefusals([outcome])).toContain('100.0% of refusals');
  });
});

/** A case whose scores are stated, so a gate can be reasoned about arithmetically. */
function scoredCase(
  datapack: string,
  accepted: readonly string[],
  rows: readonly (readonly [string, number])[],
): HeadroomCase {
  return {
    datapack,
    faultType: 'PodKill',
    accepted,
    candidates: rows.map(([service, score], index) => candidate(service, index, score)),
  };
}

/**
 * Four cases covering one outcome each, on a population whose own width is three.
 *
 * Every case's top two are `0.02` apart. The population's spread is `1.00 - 0.50 = 0.50`, which puts the ratio at
 * `0.04` and outside a `0.03` band: **on the population's own scores the gate promotes nothing.** The gate's
 * spread comes from {@link SPREAD}, whose fourth candidate scores `0.00` and makes the spread `1.00` — a ratio of
 * `0.02`, inside the band. So the two fixtures below differ only in which artifact the denominator came from, and
 * that is the point: the ratio is a property of the artifact, and `docs/agentic-promotion-gate.md` §3 records what
 * happens when a reader assumes otherwise.
 */
const GATED: readonly HeadroomCase[] = [
  // The engine is wrong and the model's first choice is the truth: a fix.
  scoredCase(
    'g-fix',
    ['b'],
    [
      ['a', 1.0],
      ['b', 0.98],
      ['c', 0.5],
    ],
  ),
  // The engine is right and the model argues with it: a break.
  scoredCase(
    'g-break',
    ['a'],
    [
      ['a', 1.0],
      ['b', 0.98],
      ['c', 0.5],
    ],
  ),
  // Wrong either way, so the override is free rather than earned.
  scoredCase(
    'g-neutral',
    ['z'],
    [
      ['a', 1.0],
      ['b', 0.98],
      ['c', 0.5],
    ],
  ),
  // The band is not where the gate looks for this one: the engine has decided.
  scoredCase(
    'g-decided',
    ['a'],
    [
      ['a', 5.0],
      ['b', 1.0],
      ['c', 0.5],
    ],
  ),
];

/** The full scored order, four wide. Identical to {@link GATED} except for the extra tail candidate. */
const SPREAD: ReadonlyMap<string, readonly PublishedCandidate[]> = new Map([
  [
    'g-fix',
    [
      { service: 'a', score: 1.0 },
      { service: 'b', score: 0.98 },
      { service: 'c', score: 0.5 },
      { service: 'd', score: 0.0 },
    ],
  ],
  [
    'g-break',
    [
      { service: 'a', score: 1.0 },
      { service: 'b', score: 0.98 },
      { service: 'c', score: 0.5 },
      { service: 'd', score: 0.0 },
    ],
  ],
  [
    'g-neutral',
    [
      { service: 'a', score: 1.0 },
      { service: 'b', score: 0.98 },
      { service: 'c', score: 0.5 },
      { service: 'd', score: 0.0 },
    ],
  ],
  [
    'g-decided',
    [
      { service: 'a', score: 5.0 },
      { service: 'b', score: 1.0 },
      { service: 'c', score: 0.5 },
      { service: 'd', score: 0.0 },
    ],
  ],
]);

const GATED_RECORDS = new Map<string, NominationRecord>([
  ['g-fix', record('g-fix', ['b'])],
  ['g-break', record('g-break', ['b'])],
  ['g-neutral', record('g-neutral', ['b'])],
  ['g-decided', record('g-decided', ['c'])],
]);

describe('scoreNomination with a promotion gate', () => {
  it('refuses a threshold without the full scored order', () => {
    // A programming error, not a reading: the only other option is to take the spread from whatever width the
    // caller happened to hold, which is the defect this whole module is a correction of.
    expect(() =>
      scoreNomination(GATED, GATED_RECORDS, {
        strategy: 'rrf',
        weight: 0,
        promotion: { threshold: 0.03 },
      }),
    ).toThrow(TypeError);
    expect(() =>
      scoreNomination(GATED, GATED_RECORDS, {
        strategy: 'rrf',
        weight: 0,
        promotion: { threshold: 0.03 },
      }),
    ).toThrow(/spreadOrder/);
  });

  it('lets a null threshold run without one, because it looks at nothing', () => {
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: null },
    });
    expect(outcome.promotion?.census.off).toBe(4);
    expect(outcome.top1).toBeCloseTo(2 / 4, 10);
  });

  it('does not read the strategy or the weight on the gate path', () => {
    // One degree of freedom, stated twice: a gate described as an rrf arm at weight 0.5 must read exactly like one
    // described as rrf at weight 0, or the arm table would be reporting a fusion it never ran.
    const atZero = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: SPREAD,
    });
    const atHalf = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'borda',
      weight: 0.5,
      promotion: { threshold: 0.03 },
      spreadOrder: SPREAD,
    });
    expect(atHalf.correct).toBe(atZero.correct);
    expect(atHalf.moved).toBe(atZero.moved);
    expect(atHalf.promotion).toEqual(atZero.promotion);
  });

  it('classifies every override by what it was worth', () => {
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: SPREAD,
    });
    const tally = outcome.promotion;
    expect(tally).not.toBeNull();
    expect(tally?.band).toBe(3);
    expect(tally?.overrides).toBe(3);
    expect(tally?.fix).toBe(1);
    expect(tally?.breaks).toBe(1);
    expect(tally?.neutral).toBe(1);
    expect(tally?.orderMissing).toBe(0);
    expect(tally?.orderDisagreement).toBe(0);
    // The band's own base rate: two of the three cases in it are wrong under the engine.
    expect(tally?.engineWrongInBand).toBe(2);
    // One fix and one break cancel, and the neutral override changes nothing.
    expect(outcome.correct).toBe(2);
  });

  it('promotes nothing when the spread comes from the population instead of the full order', () => {
    // The same rule and the same cases, with the denominator taken from the three-wide population: every ratio is
    // 0.04 and the band is empty. Stating it as a test is the cheapest way to keep the substitution from returning.
    const narrowed = new Map<string, readonly PublishedCandidate[]>();
    for (const oneCase of GATED) {
      narrowed.set(
        oneCase.datapack,
        oneCase.candidates.map((row) => ({ service: row.service, score: row.score })),
      );
    }
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: narrowed,
    });
    expect(outcome.promotion?.band).toBe(0);
    expect(outcome.promotion?.overrides).toBe(0);
    expect(outcome.correct).toBe(2);
  });

  it('keeps the engine answer for a case with no full order, and says how many', () => {
    const holes = new Map(SPREAD);
    holes.delete('g-fix');
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: holes,
    });
    expect(outcome.promotion?.orderMissing).toBe(1);
    expect(outcome.promotion?.overrides).toBe(2);
    // g-fix kept its wrong engine answer, so the fix it would have earned is not counted.
    expect(outcome.promotion?.fix).toBe(0);
  });

  it('reports a full order that disagrees with the population, and promotes nothing on it', () => {
    // Two artifacts that disagree about a case's published ranking are two runs. Gating across them would measure
    // the join, so the case is counted and left alone rather than scored.
    const swapped = new Map(SPREAD);
    swapped.set('g-fix', [
      { service: 'b', score: 0.98 },
      { service: 'a', score: 1.0 },
      { service: 'c', score: 0.5 },
      { service: 'd', score: 0.0 },
    ]);
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: swapped,
    });
    expect(outcome.promotion?.orderDisagreement).toBe(1);
    expect(outcome.promotion?.overrides).toBe(2);
  });

  it('does not treat a tail difference as a disagreement, because the gate reads one candidate', () => {
    // Measured, not assumed: on the 1 422-case corpus the 50-wide order and the same run's 5-wide top five differ
    // on 17 cases — 15 first at position 5, 2 at position 4, none at position 1 or 2 — because a structural pass
    // permutes whatever list it is given, and a 50-wide list has candidates a 5-wide one does not. Requiring the
    // whole prefix would have thrown those 17 cases out of a gate that can read all of them.
    const tailDiffers = new Map(SPREAD);
    tailDiffers.set('g-fix', [
      { service: 'a', score: 1.0 },
      { service: 'b', score: 0.98 },
      { service: 'c', score: 0.5 },
      { service: 'targeted', score: 0.1 },
    ]);
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: tailDiffers,
    });
    expect(outcome.promotion?.orderDisagreement).toBe(0);
    expect(outcome.promotion?.overrides).toBe(3);
    expect(outcome.promotion?.fix).toBe(1);
  });

  it('reports no promotion tally at all when the arm is a fusion', () => {
    expect(
      scoreNomination(GATED, GATED_RECORDS, { strategy: 'rrf', weight: 0.5 }).promotion,
    ).toBeNull();
  });
});

describe('spreadOrdersOf', () => {
  it('transcribes the dump order rather than re-sorting it', () => {
    // The array order IS the engine's answer. Re-sorting by score reproduces the pre-pass engine, which on this
    // corpus is 1 073 answers against 1 141 — so a reader that sorted would be gating a different engine.
    const orders = spreadOrdersOf([
      {
        datapack: 'x',
        faultType: 'PodKill',
        accepted: ['b'],
        candidates: [
          { id: 'b', score: 0.98, terms: [] },
          { id: 'a', score: 1.0, terms: [] },
        ],
      },
    ]);
    expect(orders.get('x')?.map((row) => row.service)).toEqual(['b', 'a']);
  });

  it('refuses a candidate with no score instead of skipping it', () => {
    // Skipping would silently stretch the spread to whatever scored candidates remained, and the band would then
    // be a function of which rows the producer filled in.
    expect(() =>
      spreadOrdersOf([
        {
          datapack: 'x',
          faultType: 'PodKill',
          accepted: ['a'],
          candidates: [
            { id: 'a', score: 1.0, terms: [] },
            { id: 'b', score: null, terms: [] },
          ],
        },
      ]),
    ).toThrow(/no score/);
  });
});

describe('formatPromotionTable', () => {
  it('says so when no arm carried a gate', () => {
    const plain = scoreNomination(GATED, GATED_RECORDS, { strategy: 'rrf', weight: 0 });
    expect(formatPromotionTable([plain])).toBe('gate: no arm carried one');
  });

  it('prints the control and the treatment over one denominator', () => {
    const grid = [{ threshold: null as number | null }, { threshold: 0.03 }];
    const outcomes = grid.map((point) =>
      scoreNomination(GATED, GATED_RECORDS, {
        strategy: 'rrf',
        weight: 0,
        promotion: { threshold: point.threshold },
        spreadOrder: SPREAD,
      }),
    );
    const lines = formatPromotionTable(outcomes).split('\n');
    expect(lines[0]).toContain('gate');
    expect(lines[0]).toContain('band');
    expect(lines[1]).toContain('off');
    expect(lines[2]).toContain('0.030');
    // Both rows are over four cases: the control and the treatment are two numbers over one population.
    expect(lines[1]).toContain('4');
    expect(lines[2]).toContain('3');
  });
});

describe('formatPromotionReadout', () => {
  it('states the conditional precision over the overrides that changed an outcome', () => {
    const outcome = scoreNomination(GATED, GATED_RECORDS, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: SPREAD,
    });
    const text = formatPromotionReadout(outcome);
    expect(text).toContain('1 fix, 1 break, 1 neutral');
    expect(text).toContain('1/2 = 50.0%');
    expect(text).toContain('net 0');
  });

  it('declines to state a precision when no override changed an outcome', () => {
    const onlyNeutral = new Map(SPREAD);
    const neutralRecords = new Map([['g-neutral', record('g-neutral', ['b'])]]);
    const outcome = scoreNomination([GATED[2]!], neutralRecords, {
      strategy: 'rrf',
      weight: 0,
      promotion: { threshold: 0.03 },
      spreadOrder: onlyNeutral,
    });
    expect(formatPromotionReadout(outcome)).toContain('no precision to state');
  });

  it('says so when the arm carried no gate', () => {
    const plain = scoreNomination(GATED, GATED_RECORDS, { strategy: 'rrf', weight: 0 });
    expect(formatPromotionReadout(plain)).toBe('gate: this arm did not carry one');
  });
});

describe('the artifact and the prompt must agree about what is available', () => {
  it('ships the same channel budget on both sides of the join', () => {
    // THE CLASS GUARD for the defect `closed-axes-register.md` §309.2 records. There, the elimination
    // fingerprint's CANDIDATE width had two owners — the runner's flag and the builder's default — and the
    // builder's default silently outranked the flag, so `--fingerprint-top-k 20` wrote five candidates each and
    // the log printed the width it had asked for.
    //
    // The repair removed that owner. This test guards the one remaining pair of numbers that must agree for the
    // shipped configuration to be coherent: the channels the ARTIFACT carries and the channels the PROMPT shows.
    // If they drift, a prompt built at the default would silently show fewer channels than the artifact holds —
    // the same shape one field over, and silent in the same way.
    expect(DEFAULT_FINGERPRINT_OPTIONS.maxChannels).toBe(DEFAULT_NOMINATION_OPTIONS.maxChannels);
  });

  it('has exactly one owner for the candidate width, and it is the caller', () => {
    // The assertion the removal is worth: a `maxCandidates` reappearing in the artifact's defaults would recreate
    // the second owner, and it would do so without failing any test that builds a fingerprint.
    expect(Object.keys(DEFAULT_FINGERPRINT_OPTIONS)).not.toContain('maxCandidates');
    expect(DEFAULT_FINGERPRINT_TOP_K).toBe(DEFAULT_NOMINATION_OPTIONS.maxCandidates);
  });
});
