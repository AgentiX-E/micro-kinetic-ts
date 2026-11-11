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
import { TermDump } from '../src/terms-dump.js';

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
