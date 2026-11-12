/**
 * The depth instrument: where the answer sits in the FULL order, not in the reported five.
 *
 * Every published number in this suite is `Top@1` or `Top@5`, so a case the engine gets wrong splits into two
 * families that look identical in an average and are completely different problems:
 *
 * - the answer is **in the ranking, deeper than five** — a ranking defect, and its size bounds what any
 *   re-ranking of the reported five could ever recover;
 * - the answer is **not in the ranking at all** — the graph does not carry that service, so no ordering of the
 *   candidates can reach it and the defect is upstream of scoring.
 *
 * The tests below pin the arithmetic that separates them, because the split decides which axis the next
 * iteration spends on. Getting it wrong in the safe direction (calling a deep case absent) would retire the
 * ranking axis that still has room; getting it wrong in the other direction would spend a model arm on cases no
 * re-ranking can fix.
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { RootCauseResult } from '../../packages/core/src/index.js';
import {
  DEPTH_LADDER,
  DEPTH_TOP_LIMIT,
  DepthDump,
  firstHitDepth,
  formatDepthLadder,
  formatDepthRow,
  parseDepthDump,
  readDepthDump,
  recallLadder,
  type DepthRow,
} from '../src/ranking-depth.js';

/**
 * A `RootCauseResult` carrying only the fields the instrument reads.
 *
 * @param serviceId - The ranked service.
 * @param finalScore - The score the sort used, or `undefined` for a producer that omits one.
 * @returns A result object with the fields the depth instrument is allowed to see.
 */
function ranked(serviceId: string, finalScore?: number): RootCauseResult {
  return {
    serviceId,
    faultType: 'unknown',
    confidence: 0,
    rank: 1,
    ...(finalScore === undefined ? {} : { finalScore }),
  } as unknown as RootCauseResult;
}

describe('firstHitDepth', () => {
  it('reports 0 when the top candidate is accepted', () => {
    expect(firstHitDepth([ranked('a'), ranked('b')], ['a'])).toBe(0);
  });

  it('reports the index of the FIRST accepted candidate, counting from zero', () => {
    expect(firstHitDepth([ranked('a'), ranked('b'), ranked('c')], ['c'])).toBe(2);
  });

  it('takes the earliest of several accepted services rather than their set order', () => {
    const order = [ranked('a'), ranked('b'), ranked('c')];
    // `c` precedes `b` in the label set but not in the ranking; the ranking decides.
    expect(firstHitDepth(order, ['c', 'b'])).toBe(1);
  });

  it('reports null when no accepted service appears — the case no re-ranking can reach', () => {
    expect(firstHitDepth([ranked('a'), ranked('b')], ['z'])).toBeNull();
  });

  it('reports null for an empty ranking and for an empty label set', () => {
    expect(firstHitDepth([], ['a'])).toBeNull();
    expect(firstHitDepth([ranked('a')], [])).toBeNull();
  });

  it('does not read past the first hit, so a duplicate label cannot inflate the depth', () => {
    expect(firstHitDepth([ranked('a'), ranked('a')], ['a'])).toBe(0);
  });
});

describe('recallLadder', () => {
  /** Four cases: depth 0, depth 2, depth 6, and one absent. */
  function population(): DepthRow[] {
    return [row('c0', 0), row('c2', 2), row('c6', 6), row('absent', null)];
  }

  /**
   * A row with the given depth.
   *
   * @param datapack - The case id.
   * @param depth - The first-hit depth, or null.
   * @returns A row the ladder can read.
   */
  function row(datapack: string, depth: number | null): DepthRow {
    return {
      datapack,
      faultType: 'NetworkDelay',
      accepted: ['a'],
      depth,
      candidates: 9,
      top: [['a', 1]],
    };
  }

  it('counts cumulatively: a case at depth 0 is a hit at every rung', () => {
    const ladder = recallLadder(population());
    const at1 = ladder.find((step) => step.k === 1)!;
    const at3 = ladder.find((step) => step.k === 3)!;
    const at8 = ladder.find((step) => step.k === 8)!;
    expect(at1.hits).toBe(1);
    expect(at3.hits).toBe(2);
    expect(at8.hits).toBe(3);
  });

  it('reports every rung of the ladder, in ascending order, over the same denominator', () => {
    const ladder = recallLadder(population());
    expect(ladder.map((step) => step.k)).toEqual([...DEPTH_LADDER]);
    for (const step of ladder) expect(step.cases).toBe(4);
  });

  it('never counts an absent case, at any rung', () => {
    const ladder = recallLadder(population());
    expect(ladder.every((step) => step.hits <= 3)).toBe(true);
  });

  it('separates absent from deep at the last rung, so the two families partition the population', () => {
    const rows = population();
    const last = recallLadder(rows).at(-1)!;
    const absent = rows.filter((entry) => entry.depth === null).length;
    const deep = rows.filter((entry) => entry.depth !== null && entry.depth >= last.k).length;
    expect(last.hits + absent + deep).toBe(rows.length);
  });

  it('is monotone: a wider rung cannot hit fewer cases', () => {
    const ladder = recallLadder(population());
    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index]!.hits).toBeGreaterThanOrEqual(ladder[index - 1]!.hits);
    }
  });

  it('reports a share that is the ratio of hits to cases, and 0 rather than NaN on an empty population', () => {
    expect(recallLadder(population()).find((step) => step.k === 1)!.share).toBeCloseTo(0.25, 10);
    expect(recallLadder([]).every((step) => step.share === 0)).toBe(true);
    expect(recallLadder([]).every((step) => step.cases === 0)).toBe(true);
  });
});

describe('formatDepthLadder', () => {
  it('prints one line per rung, the absent census, and the beyond-the-last-rung count', () => {
    const rows: DepthRow[] = [
      { datapack: 'a', faultType: 'F', accepted: ['x'], depth: 0, candidates: 5, top: [['x', 1]] },
      { datapack: 'b', faultType: 'F', accepted: ['y'], depth: 4, candidates: 5, top: [['y', 1]] },
      { datapack: 'c', faultType: 'F', accepted: ['z'], depth: null, candidates: 5, top: [] },
      { datapack: 'd', faultType: 'F', accepted: ['w'], depth: 40, candidates: 60, top: [] },
    ];
    const text = formatDepthLadder(rows);
    // @1 -> 1 hit, @5 -> 2 hits, absent -> 1, beyond -> 1.
    expect(text).toContain('@1');
    expect(text).toContain('@5');
    expect(text).toMatch(/absent\s+1\b/);
    expect(text).toMatch(new RegExp(`beyond@${DEPTH_TOP_LIMIT}\\s+1\\b`));
    expect(text).toContain('cases=4');
  });

  it('prints a ladder over an EMPTY population without dividing by zero', () => {
    // A dispatch that downloaded no cases still prints a table, and `0/0` would render as `NaN%` in every rung —
    // a number that reads as a measurement of something.
    const text = formatDepthLadder([]);
    expect(text).toContain('cases=0');
    expect(text).not.toContain('NaN');
    expect(text).toContain('0.00%');
  });

  it('states the population size, so a ladder cannot be read as a share of an unstated denominator', () => {
    const text = formatDepthLadder([
      { datapack: 'a', faultType: 'F', accepted: ['x'], depth: 0, candidates: 1, top: [['x', 1]] },
    ]);
    expect(text).toContain('cases=1');
  });
});

describe('DepthDump', () => {
  it('truncates on construction, so two dispatches into one path cannot read as one run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depth-'));
    const path = join(dir, 'depth.ndjson');
    writeFileSync(path, '{"stale":true}\n');
    new DepthDump(path);
    expect(readFileSync(path, 'utf8')).toBe('');
  });

  it('writes one line per case, in the order it was handed them, and counts what it wrote', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depth-'));
    const path = join(dir, 'depth.ndjson');
    const dump = new DepthDump(path);
    dump.record({
      datapack: 'second',
      faultType: 'NetworkDelay',
      accepted: ['b'],
      ranking: [ranked('a', 2), ranked('b', 1)],
    });
    dump.record({
      datapack: 'first',
      faultType: 'NetworkDelay',
      accepted: ['a'],
      ranking: [ranked('a', 2)],
    });
    const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).datapack).toBe('second');
    expect(JSON.parse(lines[1]!).datapack).toBe('first');
    expect(dump.summary()).toEqual({ path, cases: 2, candidates: 3, absent: 0, deepest: 1 });
  });

  it('counts the absent cases in its own summary, because they are the family a re-ranking cannot reach', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depth-'));
    const dump = new DepthDump(join(dir, 'depth.ndjson'));
    dump.record({
      datapack: 'gone',
      faultType: 'F',
      accepted: ['z'],
      ranking: [ranked('a', 2), ranked('b', 1)],
    });
    expect(dump.summary().absent).toBe(1);
    expect(dump.summary().deepest).toBeNull();
  });

  it('carries the score through as null when the producer did not populate one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depth-'));
    const path = join(dir, 'depth.ndjson');
    const dump = new DepthDump(path);
    dump.record({
      datapack: 'd',
      faultType: 'F',
      accepted: ['a'],
      ranking: [ranked('a')],
    });
    const parsed = readDepthDump(path);
    expect(parsed[0]!.top[0]).toEqual(['a', null]);
  });
});

describe('parseDepthDump', () => {
  it('round-trips a row, keeping depth null distinct from depth 0', () => {
    const text = [
      formatDepthRow({
        datapack: 'a',
        faultType: 'F',
        accepted: ['x'],
        depth: 0,
        candidates: 3,
        top: [['x', 1.5]],
      }),
      formatDepthRow({
        datapack: 'b',
        faultType: 'F',
        accepted: ['y'],
        depth: null,
        candidates: 3,
        top: [],
      }),
      '',
    ].join('\n');
    const rows = parseDepthDump(text);
    expect(rows.map((row) => row.depth)).toEqual([0, null]);
    expect(rows[0]!.top).toEqual([['x', 1.5]]);
  });

  it('skips blank lines rather than refusing a file that ends with a newline', () => {
    expect(parseDepthDump('\n\n')).toEqual([]);
  });

  it('refuses a line that is not JSON, naming the line', () => {
    expect(() => parseDepthDump('not json\n')).toThrow(/line 1 is not JSON/);
  });

  it('refuses an object that is not a row, and a missing datapack', () => {
    expect(() => parseDepthDump('[]\n')).toThrow(/not an object/);
    expect(() => parseDepthDump('{"faultType":"F"}\n')).toThrow(/datapack/);
    expect(() => parseDepthDump('{"datapack":"","faultType":"F"}\n')).toThrow(/datapack/);
  });

  it('refuses a depth that is neither a non-negative integer nor null', () => {
    const base = { datapack: 'a', faultType: 'F', accepted: [], candidates: 1, top: [] };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, depth: -1 })}\n`)).toThrow(/depth/);
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, depth: 1.5 })}\n`)).toThrow(/depth/);
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, depth: '0' })}\n`)).toThrow(/depth/);
  });

  it('refuses a candidate count that is not a non-negative integer, and a top list that is not a list', () => {
    const base = { datapack: 'a', faultType: 'F', accepted: [], depth: null, top: [] };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, candidates: -1 })}\n`)).toThrow(
      /candidates/,
    );
    expect(() =>
      parseDepthDump(`${JSON.stringify({ ...base, candidates: 1, top: {} })}\n`),
    ).toThrow(/top/);
  });

  it('refuses a top entry that is not a [service, score] pair of finite numbers', () => {
    const base = { datapack: 'a', faultType: 'F', accepted: [], depth: null, candidates: 1 };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, top: [['a']] })}\n`)).toThrow(/top/);
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, top: [['a', 'x']] })}\n`)).toThrow(
      /top/,
    );
  });

  it('refuses a top entry whose service is not a non-empty string', () => {
    const base = { datapack: 'a', faultType: 'F', accepted: [], depth: null, candidates: 1 };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, top: [[1, 0]] })}\n`)).toThrow(
      /top on line 1/,
    );
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, top: [['', 0]] })}\n`)).toThrow(
      /top on line 1/,
    );
  });

  it('refuses a faultType that is not a string rather than coercing it into a family name', () => {
    const base = { datapack: 'a', accepted: [], depth: null, candidates: 1, top: [] };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, faultType: 7 })}\n`)).toThrow(
      /faultType/,
    );
  });

  it('refuses an accepted list carrying a non-string', () => {
    const base = { datapack: 'a', faultType: 'F', depth: null, candidates: 1, top: [] };
    expect(() => parseDepthDump(`${JSON.stringify({ ...base, accepted: [1] })}\n`)).toThrow(
      /accepted/,
    );
  });

  it('reads a file and refuses a path that does not exist, rather than returning nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'depth-'));
    const path = join(dir, 'depth.ndjson');
    writeFileSync(
      path,
      `${formatDepthRow({
        datapack: 'a',
        faultType: 'F',
        accepted: ['x'],
        depth: 1,
        candidates: 2,
        top: [['x', 0]],
      })}\n`,
    );
    expect(readDepthDump(path)).toHaveLength(1);
    expect(existsSync(join(dir, 'nope.ndjson'))).toBe(false);
    expect(() => readDepthDump(join(dir, 'nope.ndjson'))).toThrow();
  });
});
