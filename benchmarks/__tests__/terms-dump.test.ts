/**
 * The term dump's FORMAT, pinned — because two runners write it and two scripts read it.
 *
 * `scripts/terms-oracle.py` re-scores a dump at any weight vector and `scripts/terms-fit.py`
 * measures what is left in the weights at all. Both treat `contribution = weight × slope` as exact,
 * so every property asserted here is one of theirs:
 *
 * - `null` and `0` are DIFFERENT. A term whose source did not carry a candidate has no slope, and a
 *   dump that wrote `0` would let a screen claim it could promote a candidate on evidence the engine
 *   never collected. The round-trip test is what keeps that a property of the file rather than of the
 *   writer's intention.
 * - The ranking is written WHOLE. A dump of the reported top five could only report promotions it was
 *   unable to make, so the candidate count is asserted against the ranking it was handed.
 * - Constructing a dump TRUNCATES it. An append across two dispatches into one path is a plausible
 *   number rather than an error — the failure mode this repository has paid for most often.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RootCauseResult } from '../../packages/core/src/index.js';
import { TermDump, parseTermsDump, readTermsDump } from '../src/terms-dump.js';

/**
 * A `RootCauseResult` carrying only the fields the dump reads.
 *
 * @param serviceId - The ranked service.
 * @param score - The `finalScore` the sort used, or `undefined` for a producer that omits it.
 * @param terms - The term breakdown, or `undefined` for a producer that omits it.
 * @returns The result, structurally complete for this consumer.
 */
function result(
  serviceId: string,
  score?: number,
  terms?: ReadonlyArray<{ name: string; weight?: number; slope?: number }>,
): RootCauseResult {
  return {
    serviceId,
    faultType: 'unknown',
    confidence: 0,
    rank: 1,
    finalScore: score,
    terms,
  } as unknown as RootCauseResult;
}

/** One dump path inside a fresh temporary directory. */
function freshPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'terms-dump-')), 'terms.ndjson');
}

describe('the term dump', () => {
  it('writes one line per case, with the shape the screen reads', () => {
    const path = freshPath();
    const dump = new TermDump(path);
    dump.record({
      datapack: 'c1',
      faultType: 'Kill',
      accepted: ['mysql', 'ts-order-service'],
      ranking: [
        result('mysql', 6.25, [
          { name: 'selfAnomalyLog1p', weight: 1, slope: 0.25 },
          { name: 'podState', weight: 8, slope: 0.75 },
        ]),
        result('ts-order-service', 2.5, [{ name: 'selfAnomalyLog1p', weight: 1, slope: 0.5 }]),
      ],
    });

    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({
      datapack: 'c1',
      faultType: 'Kill',
      accepted: ['mysql', 'ts-order-service'],
      candidates: [
        {
          id: 'mysql',
          score: 6.25,
          terms: [
            ['selfAnomalyLog1p', 1, 0.25],
            ['podState', 8, 0.75],
          ],
        },
        { id: 'ts-order-service', score: 2.5, terms: [['selfAnomalyLog1p', 1, 0.5]] },
      ],
    });
  });

  it('writes null for a factor the term never had, and never a zero', () => {
    // The distinction the screens depend on: a gated weight is `0` and re-weightable; an unmeasured
    // slope is `null` and is not. Collapsing them would make the screen claim a promotion it could
    // not make.
    const path = freshPath();
    new TermDump(path).record({
      datapack: 'c1',
      faultType: 'Delay',
      accepted: ['a'],
      ranking: [result('a', 1, [{ name: 'lat', weight: null, slope: null } as never])],
    });
    const [candidate] = JSON.parse(readFileSync(path, 'utf8')).candidates;
    expect(candidate.terms).toEqual([['lat', null, null]]);
  });

  it('records a producer that reports no score or no terms without inventing either', () => {
    const path = freshPath();
    new TermDump(path).record({
      datapack: 'c1',
      faultType: 'Delay',
      accepted: ['a'],
      ranking: [result('a')],
    });
    const [candidate] = JSON.parse(readFileSync(path, 'utf8')).candidates;
    expect(candidate.score).toBeNull();
    expect(candidate.terms).toEqual([]);
  });

  it('counts what it wrote, so a dispatch can state what its artifact holds', () => {
    const path = freshPath();
    const dump = new TermDump(path);
    expect(dump.summary()).toEqual({ path, cases: 0, candidates: 0 });
    dump.record({
      datapack: 'c1',
      faultType: 'Kill',
      accepted: ['a'],
      ranking: [result('a'), result('b')],
    });
    dump.record({ datapack: 'c2', faultType: 'Kill', accepted: ['a'], ranking: [result('a')] });
    expect(dump.summary()).toEqual({ path, cases: 2, candidates: 3 });
  });

  it('appends across cases, in the order they were recorded', () => {
    const path = freshPath();
    const dump = new TermDump(path);
    for (const datapack of ['c3', 'c1', 'c2']) {
      dump.record({ datapack, faultType: 'Kill', accepted: ['a'], ranking: [result('a')] });
    }
    const order = readFileSync(path, 'utf8')
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line).datapack);
    expect(order).toEqual(['c3', 'c1', 'c2']);
  });

  it('TRUNCATES on construction, so two dispatches cannot read as one run', () => {
    // The defect this forbids: a second dispatch into an existing path would double every case, and
    // the artifact would still parse, still be complete, and be wrong by a factor no number states.
    const path = freshPath();
    writeFileSync(path, 'stale line\n');
    expect(existsSync(path)).toBe(true);
    const dump = new TermDump(path);
    expect(readFileSync(path, 'utf8')).toBe('');
    expect(dump.summary().cases).toBe(0);
  });
});

/**
 * The reader, which is the other half of the format's one owner.
 *
 * Two Python screens already read this file, so the shapes refused here are the shapes that would give them a
 * `weight` or a `slope` they treat as a measurement. A reader that coerced instead of refusing would let a screen
 * claim a promotion the engine never recorded.
 */
describe('reading a term dump back', () => {
  it('round-trips what the writer wrote, whole ranking and null factors included', () => {
    const path = freshPath();
    new TermDump(path).record({
      datapack: 'c1',
      faultType: 'Kill',
      accepted: ['a', 'b'],
      ranking: [
        result('w', 2.5, [
          { name: 'log', weight: 1, slope: 2 },
          { name: 'lat', weight: null as never, slope: null as never },
        ]),
        result('a', 1.5, [{ name: 'log', weight: 1, slope: 1 }]),
      ],
    });
    const cases = readTermsDump(path);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.accepted).toEqual(['a', 'b']);
    expect(cases[0]!.candidates.map((candidate) => candidate.id)).toEqual(['w', 'a']);
    expect(cases[0]!.candidates[0]!.score).toBe(2.5);
    expect(cases[0]!.candidates[0]!.terms).toEqual([
      ['log', 1, 2],
      ['lat', null, null],
    ]);
  });

  it('keeps a producer that recorded no score or no terms readable', () => {
    const path = freshPath();
    new TermDump(path).record({
      datapack: 'c1',
      faultType: 'Delay',
      accepted: ['a'],
      ranking: [result('a')],
    });
    const [candidate] = readTermsDump(path)[0]!.candidates;
    expect(candidate!.score).toBeNull();
    expect(candidate!.terms).toEqual([]);
  });

  it('skips blank lines, so a file with a trailing newline is not an error', () => {
    expect(parseTermsDump('\n\n')).toEqual([]);
    const line = JSON.stringify({
      datapack: 'c1',
      faultType: 'Kill',
      accepted: ['a'],
      candidates: [],
    });
    expect(parseTermsDump(`${line}\n\n`)).toHaveLength(1);
  });

  it.each([
    ['not JSON', 'oops', 'line 1 is not JSON'],
    ['a non-object line', '[]', 'line 1 is not an object'],
    [
      'an empty datapack',
      JSON.stringify({ datapack: '', faultType: 'Kill', accepted: [], candidates: [] }),
      'datapack on line 1 is not a non-empty string',
    ],
    [
      'a non-string faultType',
      JSON.stringify({ datapack: 'c', faultType: 1, accepted: [], candidates: [] }),
      'faultType on line 1 is not a string',
    ],
    [
      'an empty answer',
      JSON.stringify({ datapack: 'c', faultType: 'K', accepted: [''], candidates: [] }),
      'accepted on line 1 is not an array of non-empty strings',
    ],
    [
      'a missing candidate list',
      JSON.stringify({ datapack: 'c', faultType: 'K', accepted: [] }),
      'candidates on line 1 is not an array',
    ],
    [
      'a candidate that is not an object',
      JSON.stringify({ datapack: 'c', faultType: 'K', accepted: [], candidates: [3] }),
      'a candidate on line 1 is not an object',
    ],
    [
      'a candidate with no id',
      JSON.stringify({
        datapack: 'c',
        faultType: 'K',
        accepted: [],
        candidates: [{ id: '', terms: [] }],
      }),
      'a candidate id on line 1 is not a non-empty string',
    ],
    [
      'a candidate with no term list',
      JSON.stringify({ datapack: 'c', faultType: 'K', accepted: [], candidates: [{ id: 'a' }] }),
      'terms on candidate a of line 1 is not an array',
    ],
    [
      'a term list with a non-triple',
      JSON.stringify({
        datapack: 'c',
        faultType: 'K',
        accepted: [],
        candidates: [{ id: 'a', terms: [['log', 1]] }],
      }),
      'a term on line 1 is not a [name, weight, slope] triple',
    ],
    [
      'a term with no name',
      JSON.stringify({
        datapack: 'c',
        faultType: 'K',
        accepted: [],
        candidates: [{ id: 'a', terms: [['', 1, 1]] }],
      }),
      'a term name on line 1 is not a non-empty string',
    ],
    [
      'a weight that is neither null nor finite',
      JSON.stringify({
        datapack: 'c',
        faultType: 'K',
        accepted: [],
        candidates: [{ id: 'a', terms: [['log', 'x', 1]] }],
      }),
      'weight on line 1 is neither null nor a finite number',
    ],
    [
      'a score that is neither null nor finite',
      JSON.stringify({
        datapack: 'c',
        faultType: 'K',
        accepted: [],
        candidates: [{ id: 'a', score: 'NaN', terms: [] }],
      }),
      'score on candidate a on line 1 is neither null nor a finite number',
    ],
  ])('refuses %s, by line', (_label, text, message) => {
    expect(() => parseTermsDump(text)).toThrow(message);
  });
});
