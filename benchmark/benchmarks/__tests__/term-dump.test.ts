import { describe, expect, it } from 'vitest';

import { corpusOf, parseAnswerLine, parseTermLine, type DumpRow } from '../src/term-dump.js';

const line = {
  datapack: 'ts0-svc-a-exception',
  candidates: [
    {
      id: 'svc-a',
      score: 2.5,
      terms: [
        ['selfAnomalyLog1p', 1, 0.5],
        ['rise', null, null],
      ],
    },
    { id: 'svc-b', score: 1, terms: [['selfAnomalyLog1p', 1, 0.25]] },
  ],
};

describe('the term dump reader', () => {
  it('reads a triple into a named weight and value, keeping a null pair null', () => {
    expect(parseTermLine(line, 1)).toEqual({
      datapack: 'ts0-svc-a-exception',
      candidates: [
        {
          id: 'svc-a',
          score: 2.5,
          terms: [
            { name: 'selfAnomalyLog1p', weight: 1, value: 0.5 },
            { name: 'rise', weight: null, value: null },
          ],
        },
        { id: 'svc-b', score: 1, terms: [{ name: 'selfAnomalyLog1p', weight: 1, value: 0.25 }] },
      ],
    });
  });

  it('keeps a weight of zero distinct from an unmeasured term', () => {
    const zero = {
      datapack: 'd',
      candidates: [{ id: 'a', score: 0, terms: [['source', 0, 0.8]] }],
    };
    expect(parseTermLine(zero, 1).candidates[0]!.terms[0]).toEqual({
      name: 'source',
      weight: 0,
      value: 0.8,
    });
  });

  it('refuses a line that is not an object', () => {
    expect(() => parseTermLine([], 7)).toThrow('line 7: a dump line is not an object');
    expect(() => parseTermLine(null, 7)).toThrow('line 7: a dump line is not an object');
  });

  it('refuses a line whose candidates is not an array', () => {
    expect(() => parseTermLine({ datapack: 'd', candidates: {} }, 3)).toThrow(
      'line 3: candidates is not an array',
    );
  });

  it('refuses a candidate with no name', () => {
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ score: 1, terms: [] }] }, 2),
    ).toThrow('line 2: a candidate id is not a non-empty string');
  });

  it('refuses a score that is not a finite number', () => {
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ id: 'a', score: '1', terms: [] }] }, 2),
    ).toThrow('line 2: the score of a is not a finite number');
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ id: 'a', score: Number.NaN, terms: [] }] }, 2),
    ).toThrow('line 2: the score of a is not a finite number');
  });

  it('refuses a term that is not a triple', () => {
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ id: 'a', score: 1, terms: [['x', 1]] }] }, 4),
    ).toThrow('line 4: a term is not a three-element array');
  });

  it('refuses a half-measured term, because the dump writes both halves or neither', () => {
    expect(() =>
      parseTermLine(
        { datapack: 'd', candidates: [{ id: 'a', score: 1, terms: [['x', 1, null]] }] },
        4,
      ),
    ).toThrow('line 4: the value of x is not a finite number');
    expect(() =>
      parseTermLine(
        { datapack: 'd', candidates: [{ id: 'a', score: 1, terms: [['x', null, 1]] }] },
        4,
      ),
    ).toThrow('line 4: the weight of x is not a finite number');
  });

  it('refuses a term list that is not a list', () => {
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ id: 'a', score: 1, terms: 'x' }] }, 9),
    ).toThrow("line 9: a candidate's terms is not an array");
  });

  it('refuses a datapack that is not named', () => {
    expect(() => parseTermLine({ candidates: [] }, 5)).toThrow(
      'line 5: a datapack is not a non-empty string',
    );
  });

  it('refuses a term whose name is not a string', () => {
    expect(() =>
      parseTermLine({ datapack: 'd', candidates: [{ id: 'a', score: 1, terms: [[7, 1, 1]] }] }, 6),
    ).toThrow('line 6: a term name is not a non-empty string');
  });
});

describe('the answers reader', () => {
  it('reads the accepted set of one case', () => {
    expect(parseAnswerLine({ datapack: 'd', truth: ['svc-a', 'svc-b'] }, 1)).toEqual({
      datapack: 'd',
      truth: ['svc-a', 'svc-b'],
    });
  });

  it('refuses an answer line whose truth is not an array', () => {
    expect(() => parseAnswerLine({ datapack: 'd', truth: 'svc-a' }, 2)).toThrow(
      'line 2: truth is not an array',
    );
  });

  it('refuses an accepted service that is not a name', () => {
    expect(() => parseAnswerLine({ datapack: 'd', truth: [1] }, 3)).toThrow(
      'line 3: an accepted service is not a non-empty string',
    );
  });

  it('refuses a line that is not an object', () => {
    expect(() => parseAnswerLine('d', 4)).toThrow('line 4: an answer line is not an object');
  });
});

describe('the join', () => {
  const rows: readonly DumpRow[] = [parseTermLine(line, 1)];

  it('attaches the accepted set by datapack', () => {
    const corpus = corpusOf(rows, new Map([['ts0-svc-a-exception', ['svc-b']]]));
    expect(corpus[0]!.truth).toEqual(['svc-b']);
    expect(corpus[0]!.candidates.length).toBe(2);
  });

  it('keeps a case the answers file does not mention, with an empty accepted set', () => {
    // Dropping it would shrink the denominator silently, which is the one failure a reading cannot show.
    const corpus = corpusOf(rows, new Map());
    expect(corpus.length).toBe(1);
    expect(corpus[0]!.truth).toEqual([]);
  });
});
