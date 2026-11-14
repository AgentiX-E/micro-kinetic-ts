import { describe, expect, it } from 'vitest';

import type { CandidateFingerprint } from '../../packages/ai/src/agent/index.js';
import type { HeadroomCase } from '../src/agentic-headroom.js';
import {
  engineOrderOf,
  formatNominationRecord,
  formatNominationRefusals,
  formatNominationTable,
  oracleTop1,
  parseNominationRecords,
  scoreNomination,
  type NominationRecord,
} from '../src/agentic-nomination.js';

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
