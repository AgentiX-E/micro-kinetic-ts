import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  composeArmVerdicts,
  parseArmAnswers,
  promoteAnswer,
  readArmAnswers,
  summariseComposition,
} from '../src/arm-order.js';
import type { DepthRow } from '../src/ranking-depth.js';

/**
 * One depth row, which is the engine's own full order for a case.
 *
 * @param datapack - The case id.
 * @param order - The full order, best first.
 * @param accepted - The corpus's label set.
 * @param candidates - How wide the order was; defaults to its length, which is the untruncated dump.
 * @returns One row.
 */
const depthRow = (
  datapack: string,
  order: readonly string[],
  accepted: readonly string[],
  candidates: number = order.length,
): DepthRow => ({
  datapack,
  faultType: 'X',
  accepted,
  depth:
    order.findIndex((name) => accepted.includes(name)) < 0
      ? null
      : order.findIndex((name) => accepted.includes(name)),
  candidates,
  top: order.map((name, index) => [name, 1 - index / 100] as const),
});

/** The five-name order most tests use: `a` is the engine's head and the truth. */
const HEAD_FIRST = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

describe('promoteAnswer', () => {
  it('leaves the order untouched when the answer is already first', () => {
    expect(promoteAnswer([...HEAD_FIRST], 'a')).toEqual([...HEAD_FIRST]);
  });

  it('promotes a name from the middle and keeps every other name in its relative order', () => {
    expect(promoteAnswer([...HEAD_FIRST], 'c')).toEqual(['c', 'a', 'b', 'd', 'e', 'f']);
  });

  it('promotes a name from the tail', () => {
    expect(promoteAnswer([...HEAD_FIRST], 'f')).toEqual(['f', 'a', 'b', 'c', 'd', 'e']);
  });

  it('prepends a name the order did not carry, so the arm can name what the pool excluded', () => {
    expect(promoteAnswer([...HEAD_FIRST], 'z')).toEqual(['z', 'a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('refuses an order that names a service twice, because a position would stop being a position', () => {
    expect(() => promoteAnswer(['a', 'b', 'a'], 'b')).toThrow(/names a twice/);
  });

  it('names the case it was given when it refuses', () => {
    expect(() => promoteAnswer(['a', 'a'], 'b', 'row 7 (ts0-x)')).toThrow(/^row 7 \(ts0-x\)/);
  });

  it('refuses an empty answer, which is a stop rather than a name', () => {
    expect(() => promoteAnswer([...HEAD_FIRST], '')).toThrow(/settled on nothing/);
  });
});

describe('composeArmVerdicts', () => {
  it('refuses an engine population with no rows, because an average over none is not zero', () => {
    expect(() => composeArmVerdicts([], [{ datapack: 'd', answer: 'a' }])).toThrow(
      /engine order held no cases/,
    );
  });

  it('refuses an arm population with no rows', () => {
    expect(() => composeArmVerdicts([depthRow('d', [...HEAD_FIRST], ['a'])], [])).toThrow(
      /arm answered no cases/,
    );
  });

  it('composes a sample rather than refusing it, because a dispatch may state one', () => {
    const engine = [
      depthRow('one', [...HEAD_FIRST], ['a']),
      depthRow('two', [...HEAD_FIRST], ['a']),
    ];
    const rows = composeArmVerdicts(engine, [{ datapack: 'two', answer: 'b' }]);
    expect(rows.map((row) => row.verdict.datapack)).toEqual(['two']);
  });

  it('composes the sample in the engine file order, not the arm file order', () => {
    const engine = [
      depthRow('one', [...HEAD_FIRST], ['a']),
      depthRow('two', [...HEAD_FIRST], ['a']),
      depthRow('three', [...HEAD_FIRST], ['a']),
    ];
    const rows = composeArmVerdicts(engine, [
      { datapack: 'three', answer: 'a' },
      { datapack: 'one', answer: 'a' },
    ]);
    expect(rows.map((row) => row.verdict.datapack)).toEqual(['one', 'three']);
  });

  it('refuses a case the arm answered and the engine did not score', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['a'])];
    const answers = [
      { datapack: 'one', answer: 'a' },
      { datapack: 'ghost', answer: 'a' },
    ];
    expect(() => composeArmVerdicts(engine, answers)).toThrow(
      /1 arm answer\(s\) name a case the engine did not score \(for example `ghost`\)/,
    );
  });

  it('refuses two answer rows for one case, because one of them would be dropped silently', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['a'])];
    const answers = [
      { datapack: 'one', answer: 'a' },
      { datapack: 'one', answer: 'b' },
    ];
    expect(() => composeArmVerdicts(engine, answers)).toThrow(/two answers for one case/);
  });

  it('refuses a truncated order, because the composed rank would then be a prefix reading', () => {
    const engine = [depthRow('one', ['a', 'b'], ['a'], 49)];
    expect(() => composeArmVerdicts(engine, [{ datapack: 'one', answer: 'b' }])).toThrow(
      /carries 2 of its own 49 candidates/,
    );
  });

  it('carries the corpus facts through unchanged', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['a', 'b'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'b' }]);
    expect(row!.verdict.datapack).toBe('one');
    expect(row!.verdict.faultType).toBe('X');
    expect(row!.verdict.accepted).toEqual(['a', 'b']);
  });

  it('publishes the arm answer first and the engine order behind it', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['a'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'd' }]);
    expect(row!.verdict.ranked).toEqual(['d', 'a', 'b', 'c', 'e']);
  });

  it('truncates the published prefix to five while ranking over the whole order', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['f'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'a' }]);
    expect(row!.verdict.ranked).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(row!.verdict.truthRank).toBe(6);
    expect(row!.verdict.pool).toBe(6);
  });

  it('keeps the truth where it was when the arm answers the engine head', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['b'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'a' }]);
    expect(row!.verdict.truthRank).toBe(2);
    expect(row!.promotedFrom).toBe('head');
    expect(row!.engineAnswerRank).toBe(1);
  });

  it('pushes the truth one deeper when the arm promotes a wrong name from above it', () => {
    // `d` (wrong) sat BELOW the truth `b`, so removing it does not move `b` but prepending does.
    const engine = [depthRow('one', [...HEAD_FIRST], ['b'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'd' }]);
    expect(row!.verdict.truthRank).toBe(3);
    expect(row!.promotedFrom).toBe('order');
  });

  it('leaves the truth where it was when the arm promotes a wrong name from BELOW it', () => {
    // `c` (wrong) sat below the truth `b`: removing it shifts `b` nowhere, prepending shifts it back.
    const engine = [depthRow('one', [...HEAD_FIRST], ['e'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'b' }]);
    expect(row!.verdict.truthRank).toBe(5);
  });

  it('scores an answer the pool excluded at rank one and widens the pool by one', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['b'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'z' }]);
    expect(row!.promotedFrom).toBe('outside');
    expect(row!.engineAnswerRank).toBe(0);
    expect(row!.verdict.truthRank).toBe(3);
    expect(row!.verdict.pool).toBe(7);
  });

  it('scores a correct answer the pool excluded at rank one', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['z'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'z' }]);
    expect(row!.verdict.truthRank).toBe(1);
    expect(row!.verdict.pool).toBe(7);
  });

  it('reports an absent truth as rank zero, which is a fact about the corpus and not a miss', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['nope'])];
    const [row] = composeArmVerdicts(engine, [{ datapack: 'one', answer: 'a' }]);
    expect(row!.verdict.truthRank).toBe(0);
  });

  it('refuses an order that names a service twice, naming the case', () => {
    const engine = [depthRow('one', ['a', 'a', 'b'], ['a'])];
    expect(() => composeArmVerdicts(engine, [{ datapack: 'one', answer: 'b' }])).toThrow(
      /row 1 \(one\): names a twice/,
    );
  });

  it('refuses an empty answer, naming the case', () => {
    const engine = [depthRow('one', [...HEAD_FIRST], ['a'])];
    expect(() => composeArmVerdicts(engine, [{ datapack: 'one', answer: '' }])).toThrow(
      /row 1 \(one\): the arm settled on nothing/,
    );
  });

  it('composes every case it was given, in the engine file order', () => {
    const engine = [
      depthRow('one', [...HEAD_FIRST], ['a']),
      depthRow('two', [...HEAD_FIRST], ['b']),
    ];
    const rows = composeArmVerdicts(engine, [
      { datapack: 'two', answer: 'a' },
      { datapack: 'one', answer: 'b' },
    ]);
    expect(rows.map((row) => row.verdict.datapack)).toEqual(['one', 'two']);
  });
});

describe('summariseComposition', () => {
  it('counts the three ways an answer can sit against the order', () => {
    const engine = [
      depthRow('one', [...HEAD_FIRST], ['a']),
      depthRow('two', [...HEAD_FIRST], ['a']),
      depthRow('three', [...HEAD_FIRST], ['a']),
    ];
    const rows = composeArmVerdicts(engine, [
      { datapack: 'one', answer: 'a' },
      { datapack: 'two', answer: 'c' },
      { datapack: 'three', answer: 'z' },
    ]);
    expect(summariseComposition(rows)).toEqual({
      cases: 3,
      alreadyFirst: 1,
      promotedFromOrder: 1,
      promotedFromOutside: 1,
    });
  });
});

describe('parseArmAnswers', () => {
  it('reads the two fields it needs and ignores the rest of the arm record', () => {
    const text = '{"datapack":"one","answer":"a","correct":true,"rounds":6}\n';
    expect(parseArmAnswers(text)).toEqual([{ datapack: 'one', answer: 'a' }]);
  });

  it('skips blank lines, which a truncated file must still be readable through', () => {
    const text = '{"datapack":"one","answer":"a"}\n\n';
    expect(parseArmAnswers(text)).toHaveLength(1);
  });

  it('refuses a line that is not JSON, by line number', () => {
    expect(() => parseArmAnswers('{"datapack":"one","answer":"a"}\nnot json\n')).toThrow(
      /line 2 is not JSON/,
    );
  });

  it('refuses a row without a datapack, by line number', () => {
    expect(() => parseArmAnswers('{"answer":"a"}\n')).toThrow(/line 1 carries no datapack/);
  });

  it('refuses a row without an answer, by line number', () => {
    expect(() => parseArmAnswers('{"datapack":"one"}\n')).toThrow(/line 1 carries no answer/);
  });

  it('refuses an answer that is not a string, rather than coercing one', () => {
    expect(() => parseArmAnswers('{"datapack":"one","answer":7}\n')).toThrow(
      /line 1 carries an answer that is not a string/,
    );
  });

  it('refuses a line that is a JSON array or a scalar', () => {
    expect(() => parseArmAnswers('[]\n')).toThrow(/line 1 is not a record/);
    expect(() => parseArmAnswers('7\n')).toThrow(/line 1 is not a record/);
    expect(() => parseArmAnswers('null\n')).toThrow(/line 1 is not a record/);
  });

  it('counts lines from one over the whole file, including the blanks it skipped', () => {
    expect(() => parseArmAnswers('\n\n{"datapack":1,"answer":"a"}\n')).toThrow(
      /line 3 carries no datapack/,
    );
  });
});

describe('readArmAnswers', () => {
  it('reads an artifact off disk, which is the only way the workflow ever calls it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arm-order-'));
    const path = join(dir, 'query-agent.ndjson');
    writeFileSync(
      path,
      '{"datapack":"one","answer":"a","rounds":6}\n{"datapack":"two","answer":"b","rounds":0}\n',
    );
    expect(readArmAnswers(path)).toEqual([
      { datapack: 'one', answer: 'a' },
      { datapack: 'two', answer: 'b' },
    ]);
  });

  it('refuses a file that is not this format, rather than reading zero cases', () => {
    const dir = mkdtempSync(join(tmpdir(), 'arm-order-'));
    const path = join(dir, 'query-agent.ndjson');
    writeFileSync(path, 'datapack,answer\none,a\n');
    expect(() => readArmAnswers(path)).toThrow(/line 1 is not JSON/);
  });
});

describe('the depth identity', () => {
  /**
   * A promotion can only cost a case at rung `k` when the truth sat at EXACTLY `k` and the settled name was not
   * already above it: the composed order is the engine's order with one name lifted, so every name that the lift
   * passes over moves down by one and no other name moves at all. This checks that sentence against the order the
   * module actually builds, on cases chosen to hit both sides of the lift.
   */
  const cases: ReadonlyArray<{ order: string[]; accepted: string[]; answer: string }> = [
    // The answer sits BELOW the truth, so the lift passes over it and the truth moves down by one.
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['a'], answer: 'c' },
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['a'], answer: 'e' },
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['b'], answer: 'c' },
    // The answer is already ABOVE the truth, so the lift removes it from below and puts it back: nothing moves.
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['c'], answer: 'a' },
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['e'], answer: 'a' },
    // A name the pool did not carry is inserted above everything, so the truth moves down by one.
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['c'], answer: 'z' },
    // A truth the engine never ranked, and an answer that IS the truth.
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['z'], answer: 'b' },
    { order: ['a', 'b', 'c', 'd', 'e'], accepted: ['b'], answer: 'b' },
  ];

  it('matches the arithmetic prediction at every rung of every case', () => {
    for (const entry of cases) {
      const [row] = composeArmVerdicts(
        [depthRow('one', entry.order, entry.accepted)],
        [{ datapack: 'one', answer: entry.answer }],
      );
      const truth = entry.order.findIndex((name) => entry.accepted.includes(name)) + 1 || 0;
      const position = entry.order.indexOf(entry.answer) + 1 || null;
      for (let k = 1; k <= entry.order.length + 1; k++) {
        const observed =
          truth >= 1 &&
          truth <= k &&
          !(row!.verdict.truthRank! >= 1 && row!.verdict.truthRank! <= k);
        const predicted =
          truth === k &&
          !entry.accepted.includes(entry.answer) &&
          (position === null || position > truth);
        expect(
          observed,
          `${entry.order.join('')} ${entry.accepted.join('')} <- ${entry.answer} at k=${k}`,
        ).toBe(predicted);
      }
    }
  });
});
