/**
 * The resolution floor, pinned to the arithmetic it claims to be.
 *
 * A sweep is a statement about the interval above its own smallest point. This module computes that
 * interval's true origin: for one term, the smallest weight (added to its shipped value) at which the term can
 * recover ANY missed case. Below it the term is provably a no-op, whatever the corpus; above it the response is
 * whatever the sweep says.
 *
 * The tests are written against the ways a plausible implementation reports a floor the engine would never
 * honour:
 *
 * - counting a case the run already answers — a hit cannot be "recovered", and including it would put the floor
 *   at 0 on any corpus with a hit in it;
 * - counting a term that pays the LEADER more than the truth — that case is unreachable at every positive
 *   weight, and averaging it in would drag the floor down to a number no weight can act at;
 * - letting a tie count — at exactly `gap / Δslope` the two candidates are level, and the engine's sort is
 *   stable, so the truth stays second: the reading has to be a strict inequality or the floor is one tick low;
 * - using the FIRST accepted candidate rather than the BEST-scoring one, which inflates the gap and therefore
 *   the floor whenever a case declares two endpoints and only one of them is close.
 */

import { evaluateWeights } from '../src/term-weight-screen.js';
import type { ParsedTermCandidate, ParsedTermCase, TermDumpTriple } from '../src/terms-dump.js';
import type { ResolutionReading, ResolutionRequest } from '../src/weight-resolution.js';
import {
  DEFAULT_RESOLUTION_WEIGHTS,
  formatResolutionReport,
  parseResolutionArgs,
  resolutionOf,
  resolutionTable,
  termsOf,
} from '../src/weight-resolution.js';

/** One candidate, scored from its triples so the fixture is exact by construction. */
function candidate(
  id: string,
  triples: ReadonlyArray<readonly [string, number, number]>,
): ParsedTermCandidate {
  const terms: TermDumpTriple[] = triples.map(
    ([name, weight, slope]) => [name, weight, slope] as const,
  );
  let score = 0;
  for (const [, weight, slope] of triples) score += weight * slope;
  return { id, score, terms };
}

/** One case with a single accepted answer. */
function kase(
  datapack: string,
  accepted: readonly string[],
  candidates: readonly ParsedTermCandidate[],
  faultType = 'HTTPRequestDelay',
): ParsedTermCase {
  return { datapack, faultType, accepted: [...accepted], candidates };
}

/**
 * A miss `probe` can recover at exactly `gap / d`, and nothing else can.
 *
 * `leader` scores `gap` above `truth` on a term both carry equally, so only `probe` moves anything.
 */
function recoverable(datapack: string, gap: number, d: number): ParsedTermCase {
  return kase(
    datapack,
    ['truth'],
    [
      candidate('leader', [
        ['neutral', 1, 10],
        ['probe', 0, 1],
      ]),
      candidate('truth', [
        ['neutral', 1, 10 - gap],
        ['probe', 0, 1 + d],
      ]),
    ],
  );
}

/** A hit: the leader IS the accepted answer. */
function hit(datapack: string): ParsedTermCase {
  return kase(
    datapack,
    ['truth'],
    [
      candidate('truth', [
        ['neutral', 1, 10],
        ['probe', 0, 1],
      ]),
      candidate('symptom', [
        ['neutral', 1, 9],
        ['probe', 0, 9],
      ]),
    ],
  );
}

const WEIGHTS = [0.25, 0.5, 1] as const;

describe('a term that cannot reorder anything', () => {
  it('reports no floor when every candidate carries the same slope', () => {
    const flat = kase(
      'f',
      ['truth'],
      [
        candidate('leader', [
          ['neutral', 1, 10],
          ['probe', 0, 1],
        ]),
        candidate('truth', [
          ['neutral', 1, 9],
          ['probe', 0, 1],
        ]),
      ],
    );
    const reading = resolutionOf([flat], 'probe', WEIGHTS);
    expect(reading.floor).toBeNull();
    expect(reading.at).toBeNull();
    expect(reading.curve.map((point) => point.reachable)).toEqual([0, 0, 0]);
  });

  it('reports no floor for a term no candidate carries at all', () => {
    const absent = kase(
      'a',
      ['truth'],
      [candidate('leader', [['neutral', 1, 10]]), candidate('truth', [['neutral', 1, 9]])],
    );
    expect(resolutionOf([absent], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('ignores a case where the term pays the LEADER more, which no positive weight can fix', () => {
    // `probe` pays the leader 5 and the truth 1: raising the weight widens the deficit, so this case is
    // unreachable in the direction a revival moves and must not enter the minimum.
    const backwards = kase(
      'b',
      ['truth'],
      [
        candidate('leader', [
          ['neutral', 1, 10],
          ['probe', 0, 5],
        ]),
        candidate('truth', [
          ['neutral', 1, 9],
          ['probe', 0, 1],
        ]),
      ],
    );
    expect(resolutionOf([backwards], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('reports no floor when the case is already answered', () => {
    expect(resolutionOf([hit('h')], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('finds the leader when it is not the first candidate the dump lists', () => {
    // A dump whose candidates are not in score order is not hypothetical: the triples are emitted in the formula's
    // term order, and the sort that reads them is a separate pass. Taking `candidates[0]` as the leader would
    // compare the truth against whichever candidate happened to be written first.
    const unordered = kase(
      'u',
      ['low'],
      [
        candidate('low', [
          ['neutral', 1, 4],
          ['probe', 0, 1],
        ]),
        candidate('high', [
          ['neutral', 1, 10],
          ['probe', 0, 1],
        ]),
      ],
    );
    // gap 6 over Δslope 0: `probe` pays both equally, so the case is unreachable — but only if the leader was
    // found at all. A reader that compared against `low` would report a floor of 0 on a case where the truth is
    // the candidate it is already reading.
    expect(resolutionOf([unordered], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('skips a case with no candidates at all', () => {
    expect(resolutionOf([kase('empty', ['truth'], [])], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('reports no floor when the case declares no accepted candidate', () => {
    const orphan = kase(
      'o',
      [],
      [
        candidate('leader', [['neutral', 1, 10]]),
        candidate('other', [
          ['neutral', 1, 9],
          ['probe', 0, 4],
        ]),
      ],
    );
    expect(resolutionOf([orphan], 'probe', WEIGHTS).floor).toBeNull();
  });
});

describe('the floor itself', () => {
  it('is the weight at which the truth can tie the leader, which is gap over the slope difference', () => {
    // gap 1, Δslope 2 → 0.5. At 0.5 they are level; the engine's stable sort keeps the leader first.
    const reading = resolutionOf([recoverable('r', 1, 2)], 'probe', WEIGHTS);
    expect(reading.floor).toBe(0.5);
    expect(reading.at).toBe('r');
  });

  it('is strict, so the tie is NOT counted as a recovery', () => {
    const reading = resolutionOf([recoverable('r', 1, 2)], 'probe', [0.5, 1]);
    expect(reading.curve.map((point) => point.reachable)).toEqual([0, 1]);
  });

  it('is the MINIMUM over the corpus, and names the case that sets it', () => {
    const reading = resolutionOf(
      [recoverable('far', 4, 1), recoverable('near', 1, 2), recoverable('middle', 1, 1)],
      'probe',
      WEIGHTS,
    );
    expect(reading.floor).toBe(0.5);
    expect(reading.at).toBe('near');
  });

  it('breaks a tie on the floor by case id, so two runs name one case', () => {
    const reading = resolutionOf(
      [recoverable('zulu', 1, 1), recoverable('alpha', 1, 1)],
      'probe',
      WEIGHTS,
    );
    expect(reading.at).toBe('alpha');
  });

  it('uses the BEST-scoring accepted candidate, not the first one declared', () => {
    // `edge-a` is accepted and far behind; `edge-b` is accepted and level with the leader. A reader that took
    // the first accepted candidate would report a floor of 9 instead of 0.
    const edge = kase(
      'e',
      ['edge-a', 'edge-b'],
      [
        candidate('leader', [
          ['neutral', 1, 10],
          ['probe', 0, 1],
        ]),
        candidate('edge-a', [
          ['neutral', 1, 1],
          ['probe', 0, 1],
        ]),
        candidate('edge-b', [
          ['neutral', 1, 10],
          ['probe', 0, 1 + 9],
        ]),
      ],
    );
    expect(resolutionOf([edge], 'probe', WEIGHTS).floor).toBe(0);
  });

  it('keeps the accepted candidate it found when a LATER one is behind, rather than swapping on every pass', () => {
    // The mirror of the test above: the best accepted candidate is listed first, and the loop must not replace it
    // with the one behind. `edge-b` is the higher-slope candidate, so a reader that let the last one win would
    // report a floor of 1.875 against the 5 this corpus decides on.
    const ordered = kase(
      'o2',
      ['edge-a', 'edge-b'],
      [
        candidate('leader', [
          ['neutral', 1, 20],
          ['probe', 0, 1],
        ]),
        candidate('edge-a', [
          ['neutral', 1, 10],
          ['probe', 0, 3],
        ]),
        candidate('edge-b', [
          ['neutral', 1, 5],
          ['probe', 0, 9],
        ]),
      ],
    );
    expect(resolutionOf([ordered], 'probe', WEIGHTS).floor).toBe(5);
  });

  it('treats a candidate that never carried the term as slope 0 rather than skipping the case', () => {
    const partial = kase(
      'p',
      ['truth'],
      [
        candidate('leader', [
          ['neutral', 1, 10],
          ['probe', 0, 1],
        ]),
        candidate('truth', [['neutral', 1, 9]]),
      ],
    );
    // Δslope = 0 − 1 = −1, so the term pays the leader: unreachable.
    expect(resolutionOf([partial], 'probe', WEIGHTS).floor).toBeNull();
  });

  it('is a floor in the ADDED weight, which for a term shipped at 0 is the revival weight', () => {
    // The reading is computed from the slope difference alone, so a term shipped at 3 has the same floor as
    // one shipped at 0 — the number is about the term's shape, not its current setting.
    const shipped = kase(
      's',
      ['truth'],
      [
        candidate('leader', [
          ['neutral', 1, 10],
          ['probe', 3, 1],
        ]),
        candidate('truth', [
          ['neutral', 1, 3],
          ['probe', 3, 3],
        ]),
      ],
    );
    expect(resolutionOf([shipped], 'probe', WEIGHTS).floor).toBe(0.5);
  });
});

describe('what the floor does NOT claim', () => {
  it('is gain-free, not event-free: below the floor the term can still LOSE a case', () => {
    // The floor bounds what a term can pay, never what it can cost. Here `probe` pays the symptom nine times what
    // it pays the truth, so it overtakes the truth at δ > 0.125 — while the corpus's recovery floor is 1. A
    // reading that called the interval below the floor "empty" would describe a weight as safe because it is
    // small, which is the one thing this measurement is for.
    const vulnerable = kase(
      'v',
      ['truth'],
      [
        candidate('truth', [
          ['neutral', 1, 10],
          ['probe', 0, 1],
        ]),
        candidate('symptom', [
          ['neutral', 1, 9],
          ['probe', 0, 9],
        ]),
      ],
    );
    const cases = [vulnerable, recoverable('m', 1, 1)];
    expect(resolutionOf(cases, 'probe', WEIGHTS).floor).toBe(1);
    const before = evaluateWeights(cases, []).hits;
    const below = evaluateWeights(cases, [{ name: 'probe', weight: 0.5 }]).hits;
    expect(below).toBe(before - 1);
  });
});

describe('the reach curve', () => {
  it('is monotone, because a larger weight recovers every case a smaller one did', () => {
    const cases = [recoverable('a', 1, 1), recoverable('b', 2, 1), recoverable('c', 4, 1)];
    const reading = resolutionOf(cases, 'probe', [0.5, 1, 2, 3, 4, 5]);
    const reaches = reading.curve.map((point) => point.reachable);
    expect(reaches).toEqual([...reaches].sort((left, right) => left - right));
  });

  it('counts one case once however many candidates it has', () => {
    const reading = resolutionOf([recoverable('a', 1, 1)], 'probe', [2]);
    expect(reading.curve[0]!.reachable).toBe(1);
  });

  it('reports zero reach below the floor, which is what makes the floor a floor', () => {
    const reading = resolutionOf([recoverable('a', 1, 2)], 'probe', [0.1, 0.4, 0.49]);
    expect(reading.curve.every((point) => point.reachable === 0)).toBe(true);
  });

  it('carries the weights it was asked about, in the order it was asked', () => {
    const reading = resolutionOf([recoverable('a', 1, 1)], 'probe', [1, 2]);
    expect(reading.curve.map((point) => point.weight)).toEqual([1, 2]);
  });
});

describe('the request', () => {
  it('refuses a weight that is not positive, because a negative weight is a different question', () => {
    expect(() => resolutionOf([recoverable('a', 1, 1)], 'probe', [0, 1])).toThrow(
      'every weight must be a positive finite number',
    );
  });

  it('refuses a repeated weight, which would print one reading twice', () => {
    expect(() => resolutionOf([recoverable('a', 1, 1)], 'probe', [1, 1])).toThrow(
      'the weights must strictly ascend',
    );
  });

  it('refuses a descending list, which is a reading of nothing', () => {
    expect(() => resolutionOf([recoverable('a', 1, 1)], 'probe', [2, 1])).toThrow(
      'the weights must strictly ascend',
    );
  });

  it('refuses an empty weight list, because a curve with no points is not a reading', () => {
    expect(() => resolutionOf([recoverable('a', 1, 1)], 'probe', [])).toThrow(
      'at least one weight is required',
    );
  });

  it('refuses an empty term name', () => {
    expect(() => resolutionOf([recoverable('a', 1, 1)], '', [1])).toThrow('a term is required');
  });
});

describe('the table', () => {
  const cases = [recoverable('a', 1, 1), recoverable('b', 2, 1)];

  it('returns one reading per term, in the order asked', () => {
    const table = resolutionTable(cases, ['probe', 'neutral'], WEIGHTS);
    expect(table.map((reading) => reading.term)).toEqual(['probe', 'neutral']);
  });

  it('says nothing about a term that recovers nothing rather than dropping the row', () => {
    // A dropped row reads as "not asked"; a row with a null floor reads as "asked, and it cannot act".
    const table = resolutionTable(cases, ['neutral'], WEIGHTS);
    expect(table).toHaveLength(1);
    expect(table[0]!.floor).toBeNull();
  });
});

describe('the report', () => {
  const readings: ResolutionReading[] = resolutionTable(
    [recoverable('a', 1, 2), recoverable('b', 2, 1)],
    ['probe', 'neutral'],
    DEFAULT_RESOLUTION_WEIGHTS,
  );
  const request: ResolutionRequest = {
    cases: 91,
    refused: 2,
    baseline: 40,
    shipped: [
      { name: 'neutral', weight: 1 },
      { name: 'probe', weight: 0 },
    ],
  };

  it('states the population and the baseline before any row', () => {
    const text = formatResolutionReport(readings, request);
    expect(text).toContain('population: 91 cases scored, 2 refused');
    expect(text).toContain('baseline:   40 / 91 = 43.96%');
  });

  it('prints a floor in exponential form, because the interesting ones are 1e-3', () => {
    expect(formatResolutionReport(readings, request)).toContain('5.00e-1');
  });

  it('prints a dash for a term that cannot act, and says so in words', () => {
    const text = formatResolutionReport(readings, request);
    expect(text).toMatch(/neutral\s+-/);
    expect(text).toContain('cannot recover a missed case at any weight');
  });

  it('names the largest reach, which is the ceiling any gain on that term is bounded by', () => {
    expect(formatResolutionReport(readings, request)).toContain('ceiling');
  });

  it('prints the shipped weights so a floor can be read as an increment', () => {
    expect(formatResolutionReport(readings, request)).toContain('shipped:    neutral 1, probe 0');
  });

  it('names the ceilings heaviest first, so the term with the most headroom leads the line', () => {
    const two: ResolutionReading[] = [
      { term: 'small', floor: 1, at: 'a', curve: [{ weight: 2, reachable: 1 }] },
      { term: 'big', floor: 1, at: 'b', curve: [{ weight: 2, reachable: 5 }] },
    ];
    expect(formatResolutionReport(two, request)).toContain('ceiling: big 5, small 1');
  });

  it('prints a dash rather than NaN when the screen refused every case', () => {
    expect(formatResolutionReport([], { cases: 0, refused: 3, baseline: 0 })).toContain(
      '0 / 0 = -',
    );
  });
});

describe('naming the terms', () => {
  it('lists every term the dump records, each once, in first-appearance order', () => {
    const cases = [
      kase(
        'a',
        ['x'],
        [
          candidate('x', [
            ['alpha', 1, 1],
            ['beta', 0, 1],
          ]),
        ],
      ),
      kase(
        'b',
        ['x'],
        [
          candidate('x', [
            ['beta', 0, 2],
            ['gamma', 0, 1],
          ]),
        ],
      ),
    ];
    expect(termsOf(cases)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('returns nothing for a dump with no terms, rather than a row that cannot exist', () => {
    expect(termsOf([kase('a', ['x'], [candidate('x', [])])])).toEqual([]);
  });
});

describe('the arguments', () => {
  it('requires --terms', () => {
    expect(() => parseResolutionArgs([])).toThrow('--terms is required');
  });

  it('reads a comma-separated term list', () => {
    expect(parseResolutionArgs(['--terms', 'x.ndjson', '--names', 'prism,topo']).names).toEqual([
      'prism',
      'topo',
    ]);
  });

  it('defaults the names to every term recorded in the dump when none is given', () => {
    // The floor of a term nobody named is the one a reader cannot ask about, and the dump already says which
    // terms exist — so the default is "all of them" rather than a second list that can fall behind.
    expect(parseResolutionArgs(['--terms', 'x.ndjson']).names).toBeUndefined();
  });

  it('reads a comma-separated weight list as numbers', () => {
    expect(
      parseResolutionArgs(['--terms', 'x.ndjson', '--weights', '0.001,0.01,1']).weights,
    ).toEqual([0.001, 0.01, 1]);
  });

  it('defaults the weights to the shipped resolution grid', () => {
    expect(parseResolutionArgs(['--terms', 'x.ndjson']).weights).toEqual(
      DEFAULT_RESOLUTION_WEIGHTS,
    );
  });

  it('refuses a weight that is not a number', () => {
    expect(() => parseResolutionArgs(['--terms', 'x.ndjson', '--weights', 'a,b'])).toThrow(
      'a weight must be a finite number, got "a"',
    );
  });

  it('refuses a flag with no value instead of reading the next flag as one', () => {
    expect(() => parseResolutionArgs(['--terms'])).toThrow('--terms needs a path');
    expect(() => parseResolutionArgs(['--terms', 'x.ndjson', '--names'])).toThrow(
      '--names needs a comma-separated list',
    );
    expect(() => parseResolutionArgs(['--terms', 'x.ndjson', '--weights'])).toThrow(
      '--weights needs a comma-separated list',
    );
  });

  it('refuses a flag it does not know, so a typo is not silently ignored', () => {
    expect(() => parseResolutionArgs(['--terms', 'x.ndjson', '--nmaes', 'prism'])).toThrow(
      'unknown argument "--nmaes"',
    );
  });
});
