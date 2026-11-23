/**
 * The retrieval block's tests.
 *
 * The instrument's job is to say which of four failures a miss is, and the tests are written to keep the four apart
 * rather than to check a count: a truth at rank 1 with a wrong answer is a PRECEDENCE failure, a truth at rank 3 is a
 * REASONING failure, a truth at rank 6 is a BREADTH failure and a truth never ranked is a POOL failure. Collapsing any
 * two of them into "a miss" is what makes a budget buy the wrong thing, which is the mistake this file exists to
 * prevent.
 */

import { describe, expect, it } from 'vitest';

import {
  SEED_WIDTH,
  censusRetrieval,
  classifyMiss,
  formatRetrievalReport,
  gapSeparability,
  rankOfTruth,
  wideningCurve,
  type RetrievalCase,
} from '../src/retrieval-block.js';

/** A case with the truth at `rank` in an otherwise ordinary ranking. */
function retrievalCase(rank: number | null, overrides: Partial<RetrievalCase> = {}): RetrievalCase {
  const ranked = Array.from({ length: 8 }, (_, index) => `svc-${index + 1}`);
  const position = rank === null ? -1 : rank - 1;
  if (position >= 0) ranked[position] = 'truth';
  return {
    datapack: 'case',
    truth: ['truth'],
    ranked,
    scores: ranked.map((_, index) => 10 - index),
    correct: false,
    ...overrides,
  };
}

describe('where the truth sits', () => {
  it('reports a 1-based rank for the truth', () => {
    expect(rankOfTruth(retrievalCase(3))).toBe(3);
  });

  it('reports the BEST rank of a multi-service truth, not the first name', () => {
    // A case that says `truth` at rank 6 and `other` at rank 2 has been retrieved: any labelled name is an answer.
    const one = retrievalCase(6);
    const ranked = one.ranked.map((id, index) => (index === 1 ? 'other' : id));
    expect(rankOfTruth({ ...one, ranked, truth: ['truth', 'other'] })).toBe(2);
  });

  it('reports null when no labelled service is a candidate at all', () => {
    expect(rankOfTruth(retrievalCase(null))).toBeNull();
  });
});

describe('which of the four failures a miss is', () => {
  it('calls a correct answer a hit whatever the ranking says', () => {
    expect(classifyMiss(retrievalCase(7, { correct: true }))).toBe('hit');
  });

  it('calls a truth at rank 1 with a wrong answer a PRECEDENCE failure', () => {
    expect(classifyMiss(retrievalCase(1))).toBe('lost-at-the-rank-one');
  });

  it('calls a truth inside the seed a REASONING failure', () => {
    for (const rank of [2, 3, 4, 5])
      expect(classifyMiss(retrievalCase(rank))).toBe('seen-but-lost');
  });

  it('calls a truth beyond the seed a BREADTH failure', () => {
    for (const rank of [6, 22, 44]) {
      expect(classifyMiss(retrievalCase(rank))).toBe('retrieval-block');
    }
  });

  it('calls a truth never ranked a POOL failure, not a breadth one', () => {
    expect(classifyMiss(retrievalCase(null))).toBe('absent');
  });

  it('moves the boundary with the seed width rather than assuming five', () => {
    // The rule is "inside the seed", not "within five": a corpus whose arm is shown twenty candidates has a
    // different reasoning population, and the instrument must read the arm's width rather than this repository's.
    expect(classifyMiss(retrievalCase(12), 20)).toBe('seen-but-lost');
    expect(classifyMiss(retrievalCase(12), 5)).toBe('retrieval-block');
    expect(SEED_WIDTH).toBe(5);
  });
});

describe('the census', () => {
  const corpus: RetrievalCase[] = [
    retrievalCase(1, { datapack: 'a', correct: true }),
    retrievalCase(1, { datapack: 'b' }),
    retrievalCase(3, { datapack: 'c' }),
    retrievalCase(9, { datapack: 'd' }),
    retrievalCase(null, { datapack: 'e' }),
  ];

  it('counts the five classes and the misses', () => {
    const census = censusRetrieval(corpus);
    expect(census.cases).toBe(5);
    expect(census.hit).toBe(1);
    expect(census.misses).toBe(4);
    expect(census.lostAtTheRankOne).toBe(1);
    expect(census.seenButLost).toBe(1);
    expect(census.retrievalBlock).toBe(1);
    expect(census.absent).toBe(1);
  });

  it('sorts the misses’ ranks ascending with the unranked last', () => {
    expect(censusRetrieval(corpus).ranks).toEqual([1, 3, 9, null]);
  });

  it('orders two unranked truths after every ranked one, and each other, deterministically', () => {
    // The comparator's three null cases have to be REACHED, not merely written: a sentinel would sort correctly and
    // would also be a rank nobody can tell from a real one, which is why the order is stated.
    const two = censusRetrieval([
      retrievalCase(null, { datapack: 'x' }),
      retrievalCase(4, { datapack: 'y' }),
      retrievalCase(null, { datapack: 'z' }),
      retrievalCase(2, { datapack: 'w' }),
    ]);
    expect(two.ranks).toEqual([2, 4, null, null]);
  });

  it('adds up: the five classes cover the corpus', () => {
    const census = censusRetrieval(corpus);
    expect(
      census.hit +
        census.lostAtTheRankOne +
        census.seenButLost +
        census.retrievalBlock +
        census.absent,
    ).toBe(census.cases);
  });
});

describe('what breadth buys', () => {
  const corpus: RetrievalCase[] = [
    retrievalCase(1, { datapack: 'hit', correct: true }),
    retrievalCase(12, { datapack: 'block' }),
    retrievalCase(null, { datapack: 'absent' }),
  ];

  it('counts a case visible at a width once the width reaches its rank', () => {
    const rows = wideningCurve(corpus, [5, 12]);
    expect(rows[0]).toEqual({ width: 5, visible: 1, missesCovered: 0 });
    expect(rows[1]).toEqual({ width: 12, visible: 2, missesCovered: 1 });
  });

  it('never counts an unranked truth as visible at any width', () => {
    const rows = wideningCurve(corpus, [1000]);
    expect(rows[0]!.visible).toBe(2);
  });

  it('does not count a hit as a covered miss', () => {
    expect(wideningCurve(corpus, [1000])[0]!.missesCovered).toBe(1);
  });
});

describe('what a deployed rule can see', () => {
  /** Two cases: one undecided ranking whose truth is outside the seed, one decided ranking whose truth is inside. */
  function pair(): RetrievalCase[] {
    return [
      retrievalCase(9, { datapack: 'block', scores: [10, 9.9, 8, 7, 6, 5, 4, 3] }),
      retrievalCase(3, { datapack: 'seen', scores: [10, 2, 1, 0.5, 0.4, 0.3, 0.2, 0.1] }),
    ];
  }

  it('fires on an undecided ranking and captures the block', () => {
    const [row] = gapSeparability(pair(), [0.2]);
    expect(row!.fires).toBe(1);
    expect(row!.captured).toBe(1);
    expect(row!.precision).toBe(1);
    expect(row!.recall).toBe(1);
  });

  it('does not fire on a decided ranking, however wrong the answer is', () => {
    const [row] = gapSeparability(pair(), [0.0001]);
    expect(row!.fires).toBe(0);
    expect(row!.precision).toBe(0);
    expect(row!.recall).toBe(0);
  });

  it('skips a case whose scores cannot supply a gap rather than reading it as decided', () => {
    const one = { ...retrievalCase(9), scores: [10] };
    const [row] = gapSeparability([one], [1000]);
    expect(row!.fires).toBe(0);
  });

  it('reports zero recall when the corpus holds no retrieval block', () => {
    const [row] = gapSeparability([retrievalCase(2)], [1000]);
    expect(row!.recall).toBe(0);
    expect(row!.captured).toBe(0);
  });
});

describe('the report', () => {
  const corpus: RetrievalCase[] = [
    retrievalCase(1, { datapack: 'a', correct: true }),
    retrievalCase(9, { datapack: 'b' }),
  ];

  it('prints the census, the widening curve and the separability sweep', () => {
    const text = formatRetrievalReport(
      censusRetrieval(corpus),
      wideningCurve(corpus, [5, 22]),
      gapSeparability(corpus, [0.5]),
    );
    expect(text).toContain('2 cases, 1 hits, 1 misses');
    expect(text).toContain('retrieval block 1');
    expect(text).toContain('what breadth buys');
    expect(text).toContain('what a deployed rule can see');
    expect(text).toContain('1 of 1 misses (100.00 %)');
  });

  it('prints an empty corpus as zero rather than as a NaN', () => {
    const text = formatRetrievalReport(censusRetrieval([]), [], []);
    expect(text).toContain('0 cases, 0 hits, 0 misses');
    expect(text).toContain('0 of 0 misses (0.00 %)');
    expect(text).not.toContain('NaN');
  });
});
