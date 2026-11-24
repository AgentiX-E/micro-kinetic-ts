import { describe, expect, it } from 'vitest';

import {
  diffSurfaces,
  foldAssignment,
  formatSurfaceDiff,
  parseSurfaceLine,
  renderSurfaceLine,
  type SurfaceRow,
} from '../src/surface-diff.js';

/** A surface row that answered `answer` and scored `correct`. */
function row(datapack: string, answer: string | null, correct: boolean): SurfaceRow {
  return { datapack, answer, correct };
}

describe('parsing one surface row', () => {
  it('reads the three fields the comparison needs', () => {
    expect(parseSurfaceLine({ datapack: 'c1', answer: 'svc', correct: true }, 3)).toEqual(
      row('c1', 'svc', true),
    );
  });

  it('keeps a null answer distinct from an empty one', () => {
    expect(parseSurfaceLine({ datapack: 'c1', answer: null, correct: false }, 1).answer).toBeNull();
  });

  it('refuses a row that is not an object, rather than reading fields off it', () => {
    for (const raw of [null, undefined, 7, 'c1', [], true]) {
      expect(() => parseSurfaceLine(raw, 4)).toThrow(/line 4.*object/);
    }
  });

  it('refuses a missing or empty datapack, because a row without an id cannot be matched', () => {
    expect(() => parseSurfaceLine({ answer: 'svc', correct: true }, 2)).toThrow(/datapack/);
    expect(() => parseSurfaceLine({ datapack: '', answer: 'svc', correct: true }, 2)).toThrow(
      /datapack/,
    );
    expect(() => parseSurfaceLine({ datapack: 42, answer: 'svc', correct: true }, 2)).toThrow(
      /datapack/,
    );
  });

  it('refuses an answer that is neither a string nor null', () => {
    expect(() => parseSurfaceLine({ datapack: 'c1', answer: 3, correct: true }, 2)).toThrow(
      /answer/,
    );
    expect(() => parseSurfaceLine({ datapack: 'c1', correct: true }, 2)).toThrow(/answer/);
  });

  it('refuses a non-boolean verdict, because a truthy string would score as a hit', () => {
    expect(() => parseSurfaceLine({ datapack: 'c1', answer: null, correct: 'yes' }, 2)).toThrow(
      /correct/,
    );
    expect(() => parseSurfaceLine({ datapack: 'c1', answer: null }, 2)).toThrow(/correct/);
  });

  it('round-trips through the line it renders', () => {
    const original = row('ts0-mysql-loss-1', 'mysql', true);
    expect(parseSurfaceLine(JSON.parse(renderSurfaceLine(original)), 1)).toEqual(original);
  });

  it('renders one line with no newline, so a writer owns the separator', () => {
    expect(renderSurfaceLine(row('c1', null, false))).not.toContain('\n');
  });
});

describe('the comparison of two surfaces', () => {
  it('reports no movement when the two surfaces agree', () => {
    const one = [row('a', 'x', true), row('b', 'y', false)];
    const diff = diffSurfaces(one, one);
    expect(diff.cases).toBe(2);
    expect(diff.beforeHits).toBe(1);
    expect(diff.afterHits).toBe(1);
    expect(diff.repairs).toEqual([]);
    expect(diff.breaks).toEqual([]);
  });

  it('names a case that moved from wrong to right as a repair, carrying both answers', () => {
    const diff = diffSurfaces([row('a', 'x', false)], [row('a', 'y', true)]);
    expect(diff.repairs).toEqual([{ datapack: 'a', before: 'x', after: 'y', kind: 'repair' }]);
    expect(diff.breaks).toEqual([]);
    expect(diff.afterHits - diff.beforeHits).toBe(1);
  });

  it('names a case that moved from right to wrong as a break', () => {
    const diff = diffSurfaces([row('a', 'x', true)], [row('a', 'y', false)]);
    expect(diff.breaks).toEqual([{ datapack: 'a', before: 'x', after: 'y', kind: 'break' }]);
    expect(diff.repairs).toEqual([]);
  });

  it('does not count a case whose answer changed but whose verdict did not', () => {
    const diff = diffSurfaces([row('a', 'x', true)], [row('a', 'z', true)]);
    expect(diff.repairs).toEqual([]);
    expect(diff.breaks).toEqual([]);
    expect(diff.afterHits).toBe(1);
  });

  it('matches cases by id, so the two files need not be in the same order', () => {
    const diff = diffSurfaces(
      [row('a', 'x', false), row('b', 'y', true)],
      [row('b', 'y', true), row('a', 'z', true)],
    );
    expect(diff.repairs.map((one) => one.datapack)).toEqual(['a']);
  });

  it('sorts its flips by id, so two runs print the same list', () => {
    const diff = diffSurfaces(
      [row('c', 'x', false), row('a', 'x', false), row('b', 'x', false)],
      [row('a', 'y', true), row('c', 'y', true), row('b', 'y', true)],
    );
    expect(diff.repairs.map((one) => one.datapack)).toEqual(['a', 'b', 'c']);
  });

  it('refuses two files with different case sets, naming the difference rather than scoring one side', () => {
    expect(() => diffSurfaces([row('a', 'x', true)], [])).toThrow(
      /1 in the first file.*0 in the second/,
    );
    expect(() => diffSurfaces([], [row('a', 'x', true)])).toThrow(
      /0 in the first file.*1 in the second/,
    );
  });

  it('names an id that only one side carries', () => {
    expect(() =>
      diffSurfaces([row('a', 'x', true), row('b', 'x', true)], [row('a', 'x', true)]),
    ).toThrow(/b/);
    expect(() =>
      diffSurfaces([row('a', 'x', true)], [row('a', 'x', true), row('c', 'x', true)]),
    ).toThrow(/c/);
  });

  it('counts the ids it did not print, so a refusal stays one line without hiding its size', () => {
    const first = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => row(id, 'x', true));
    let message = '';
    try {
      diffSurfaces(first, []);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('… and 2 more');
  });

  it('refuses a duplicated id inside one file, because the second row would be silently dropped', () => {
    expect(() =>
      diffSurfaces([row('a', 'x', true), row('a', 'y', true)], [row('a', 'x', true)]),
    ).toThrow(/twice/);
    expect(() =>
      diffSurfaces([row('a', 'x', true)], [row('a', 'x', true), row('a', 'y', true)]),
    ).toThrow(/twice/);
  });

  it('measures an empty corpus as zero rather than as a division by zero', () => {
    const diff = diffSurfaces([], []);
    expect(diff).toMatchObject({ cases: 0, beforeHits: 0, afterHits: 0 });
    expect(formatSurfaceDiff(diff)).toContain('0 cases');
  });
});

describe('the held-out folds of a comparison', () => {
  it('assigns the cases of one fault type to both folds in alternating order', () => {
    const types = new Map([
      ['a', 'NetworkLoss'],
      ['b', 'NetworkLoss'],
      ['c', 'NetworkLoss'],
      ['d', 'NetworkLoss'],
    ]);
    const fold = foldAssignment(types);
    const ids = ['a', 'b', 'c', 'd'];
    const folds = ids.map(fold);
    // Adjacent cases of one family never share a fold: that is what makes each fold a held-out half.
    expect(folds[0]).not.toBe(folds[1]);
    expect(folds[1]).not.toBe(folds[2]);
    expect(folds[2]).not.toBe(folds[3]);
  });

  it('assigns the same fold twice for the same corpus, whatever order the ids arrived in', () => {
    const forward = foldAssignment(
      new Map([
        ['a', 'NetworkLoss'],
        ['b', 'NetworkLoss'],
        ['c', 'ContainerKill'],
      ]),
    );
    const reversed = foldAssignment(
      new Map([
        ['c', 'ContainerKill'],
        ['b', 'NetworkLoss'],
        ['a', 'NetworkLoss'],
      ]),
    );
    for (const id of ['a', 'b', 'c']) expect(reversed(id)).toBe(forward(id));
  });

  it('refuses an id it was not given, rather than defaulting it into fold 0', () => {
    const fold = foldAssignment(new Map([['a', 'X']]));
    expect(() => fold('zzz')).toThrow(/zzz/);
  });

  it('refuses an empty fault type, which would hash one family for every case', () => {
    expect(() => foldAssignment(new Map([['a', '']]))).toThrow(/fault type/);
  });
});

describe('the report', () => {
  it('states both surfaces, the delta and the flip counts', () => {
    const diff = diffSurfaces(
      [row('a', 'x', false), row('b', 'y', true)],
      [row('a', 'z', true), row('b', 'w', false)],
    );
    const text = formatSurfaceDiff(diff);
    expect(text).toContain('1 / 2');
    expect(text).toContain('before 1');
    expect(text).toContain('after 1');
    expect(text).toContain('+0');
    expect(text).toMatch(/repairs 1/);
    expect(text).toMatch(/breaks 1/);
  });

  it('says so when no case moved, instead of printing an empty list', () => {
    const text = formatSurfaceDiff(diffSurfaces([row('a', 'x', true)], [row('a', 'x', true)]));
    expect(text).toContain('no case moved');
  });

  it('prints each flip with the two answers it names', () => {
    const text = formatSurfaceDiff(diffSurfaces([row('a', 'x', false)], [row('a', 'y', true)]));
    expect(text).toContain('a');
    expect(text).toContain('x');
    expect(text).toContain('y');
  });

  it('prints a per-fold delta when it is given the fold of each case', () => {
    const diff = diffSurfaces(
      [row('a', 'x', false), row('b', 'x', true)],
      [row('a', 'y', true), row('b', 'y', false)],
    );
    const fold = (id: string): 0 | 1 => (id === 'a' ? 0 : 1);
    const text = formatSurfaceDiff(diff, fold);
    expect(text).toMatch(/fold 0.*\+1/);
    expect(text).toMatch(/fold 1.*-1/);
  });
});
