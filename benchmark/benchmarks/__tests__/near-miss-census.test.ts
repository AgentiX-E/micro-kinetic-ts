/**
 * The near-miss census: what a `Top@1` miss is worth, and the three ways a table like this goes wrong.
 *
 * The corpus total cannot say which half of a miss class to spend the next arm on, so the census splits it — and
 * every split below is pinned against the defect it prevents rather than against a shape:
 *
 * - **the margin is measured to the TRUTH, not to the runner-up.** When the answer sits at rank 4, the gap to
 *   rank 2 describes a different case. A fixture whose truth is at rank 3 is therefore read with a margin that no
 *   gap-between-the-first-two could reproduce, so a regression to the wrong subtrahend is red rather than
 *   plausible.
 * - **a ratio with a non-positive denominator is `unmeasurable`, not zero.** Dividing by a negative winner flips
 *   the sign of every gap, so the fixture carries a negative-score case whose band would otherwise read as the
 *   widest one.
 * - **the artifact is allowed to be wrong about itself.** A row whose depth points past its own order is counted
 *   as `inconsistent` and reported, because an instrument that drops the evidence of its own defect is the failure
 *   §315 recorded for the promotion census.
 *
 * The winner table's ordering is pinned with a TIE in it: two services winning the same number of cases must print
 * in name order, or two runs over one artifact print two different tables and a document quoting the second looks
 * like a changed corpus.
 */

import { describe, expect, it } from 'vitest';

import {
  censusNearMisses,
  formatCensusRow,
  formatNearMissCensus,
  formatNearMissRow,
  MARGIN_BANDS,
  marginBand,
  NEAR_MISS_RANKS,
  TIE_BREAK_SHARE,
  toNearMiss,
} from '../src/near-miss-census.js';
import type { DepthRow } from '../src/ranking-depth.js';

/**
 * A depth row with a controlled order.
 *
 * @param depth - Zero-based index of the first accepted candidate, or null when absent.
 * @param top - The order, as `[service, score]` pairs. Defaults to a four-deep descending order.
 * @param accepted - The corpus's label set.
 * @param faultType - The family the row belongs to.
 * @param datapack - The case id.
 * @returns The row.
 */
function depthRow(
  depth: number | null,
  top: readonly (readonly [string, number | null])[] = [
    ['a', 4],
    ['b', 3],
    ['c', 2],
    ['d', 1],
    ['e', 0.5],
  ],
  accepted: readonly string[] = ['b'],
  faultType = 'F',
  datapack = 'case',
): DepthRow {
  return { datapack, faultType, accepted, depth, candidates: top.length, top };
}

describe('marginBand', () => {
  it('reads a null margin as unmeasurable rather than as the tightest band', () => {
    // The distinction is load-bearing: `unmeasurable` is excluded from the tie share, so a case whose score
    // surface could not be divided must not be counted as evidence that the class is a tie-break class.
    expect(marginBand(null)).toBe('unmeasurable');
  });

  it('reads NaN as unmeasurable, because a comparison against NaN is false for every ceiling', () => {
    expect(marginBand(Number.NaN)).toBe('unmeasurable');
  });

  it.each([
    [0, 'under-1pct'],
    [0.0099, 'under-1pct'],
    // The boundary belongs to the WIDER band: `0.01 < 0.02`, so a margin of exactly one percent is reported where
    // the reader comparing it to a two-percent rule will find it.
    [0.01, 'under-2pct'],
    [0.0199, 'under-2pct'],
    [0.02, 'under-5pct'],
    [0.05, 'under-10pct'],
    [0.1, 'under-20pct'],
    [0.2, 'at-least-20pct'],
    [5, 'at-least-20pct'],
  ] as const)('puts %s in %s', (margin, band) => {
    expect(marginBand(margin)).toBe(band);
  });

  it('reads a negative margin as unmeasurable, because it is a contradiction and not a gap', () => {
    // A negative margin means the truth outscored the winner, which a sorted order cannot produce. Filing it in
    // the widest band would report a broken row as a case with no tie-break potential — a claim about the corpus
    // when the defect is in the artifact. And the alternative, the tightest band, is what the first draft did:
    // `-0.3 < 0.01` matched it, so a broken row read as the strongest possible tie-break evidence.
    expect(marginBand(-0.3)).toBe('unmeasurable');
  });
});

describe('toNearMiss', () => {
  it('returns null for an absent row, a correct row, and a row deeper than the published five', () => {
    expect(toNearMiss(depthRow(null))).toBeNull();
    expect(toNearMiss(depthRow(0))).toBeNull();
    // Rank 6 is a case no re-ranking of the published five can reach, so folding it in would let a wider
    // presentation's benefit be read as a tie-break's.
    expect(toNearMiss(depthRow(5))).toBeNull();
  });

  it('converts the zero-based depth into the one-based rank a reader compares against Top@5', () => {
    expect(toNearMiss(depthRow(1))!.rank).toBe(2);
    expect(toNearMiss(depthRow(4))!.rank).toBe(5);
  });

  it('names the winner from the first entry and the truth from the depth', () => {
    const miss = toNearMiss(
      depthRow(
        2,
        [
          ['x', 9],
          ['y', 8],
          ['z', 7],
        ],
        ['z'],
      ),
    )!;
    expect(miss.winner).toBe('x');
    expect(miss.truth).toBe('z');
  });

  it('measures the margin against the TRUTH and not against the runner-up', () => {
    // Winner 9, runner-up 8, truth 3. Against the runner-up the gap would be 1/9 = 0.111; against the truth it is
    // 6/9 = 0.667. Only the second says how far the answer actually was.
    const miss = toNearMiss(
      depthRow(
        2,
        [
          ['x', 9],
          ['y', 8],
          ['z', 3],
        ],
        ['z'],
      ),
    )!;
    expect(miss.margin).toBeCloseTo(6 / 9, 12);
    expect(miss.band).toBe('at-least-20pct');
  });

  it('returns null when the order is shorter than the depth it claims', () => {
    // The row contradicts itself: depth 3 inside an order of two entries. It must not become a near miss whose
    // truth is `undefined`, so the census can count it as an inconsistent row instead.
    expect(
      toNearMiss(
        depthRow(3, [
          ['a', 4],
          ['b', 3],
        ]),
      ),
    ).toBeNull();
  });

  it('returns null when the order carries no winner at all', () => {
    expect(toNearMiss(depthRow(1, []))).toBeNull();
  });

  it.each([
    [
      'the winner score is null',
      [
        ['a', null],
        ['b', 3],
      ] as const,
    ],
    [
      'the truth score is null',
      [
        ['a', 4],
        ['b', null],
      ] as const,
    ],
    [
      'the winner score is zero',
      [
        ['a', 0],
        ['b', -1],
      ] as const,
    ],
    [
      'the winner score is negative',
      [
        ['a', -2],
        ['b', -3],
      ] as const,
    ],
  ])('carries a null margin when %s', (_label, top) => {
    const miss = toNearMiss(depthRow(1, top, ['b']))!;
    expect(miss.margin).toBeNull();
    expect(miss.band).toBe('unmeasurable');
  });

  it('carries the label set size, because a two-sided fault is a different question', () => {
    expect(toNearMiss(depthRow(1, undefined, ['b']))!.acceptedSize).toBe(1);
    expect(toNearMiss(depthRow(1, undefined, ['a', 'b']))!.acceptedSize).toBe(2);
  });
});

describe('censusNearMisses', () => {
  it('reports an empty population as empty rather than as a perfect one', () => {
    const census = censusNearMisses([]);
    expect(census.cases).toBe(0);
    expect(census.ceiling).toEqual({ cases: 0, share: 0 });
    expect(census.tieShare).toBe(0);
    // No near-miss class means no verdict can be given, and `evidence` is the honest default: a rule acting on
    // arithmetic would be acting on nothing.
    expect(census.verdict).toBe('evidence');
    expect(census.byRank).toHaveLength(NEAR_MISS_RANKS.length);
    expect(census.byBand).toHaveLength(MARGIN_BANDS.length);
    expect(census.winners).toEqual([]);
    expect(census.families).toEqual([]);
  });

  it('partitions the population exactly once across correct, near, deep and absent', () => {
    const census = censusNearMisses([
      depthRow(0),
      depthRow(1),
      depthRow(2),
      depthRow(4),
      depthRow(5),
      depthRow(null),
    ]);
    expect(census.correctAt1).toBe(1);
    expect(census.nearMisses).toHaveLength(3);
    expect(census.deeperMisses).toBe(1);
    expect(census.absent).toBe(1);
    expect(census.correctAt1 + census.nearMisses.length + census.deeperMisses + census.absent).toBe(
      census.cases,
    );
  });

  it('counts a self-contradicting row as inconsistent and keeps it out of the near-miss class', () => {
    const census = censusNearMisses([
      depthRow(3, [
        ['a', 4],
        ['b', 3],
      ]),
      depthRow(1),
    ]);
    expect(census.inconsistent).toBe(1);
    expect(census.nearMisses).toHaveLength(1);
    // The partition still sums: the inconsistent row is neither correct nor near nor deep nor absent.
    expect(census.correctAt1 + census.nearMisses.length + census.deeperMisses + census.absent).toBe(
      census.cases - 1,
    );
  });

  it('reports every rank and every band, including the empty ones', () => {
    // A winner of 100 against a truth of 99 is a gap of one percent, the band the tie-break reading is about.
    const tight: readonly (readonly [string, number | null])[] = [
      ['a', 100],
      ['b', 99],
    ];
    const census = censusNearMisses([depthRow(1, tight), depthRow(1, tight)]);
    expect(census.byRank).toEqual([
      { rank: 2, cases: 2 },
      { rank: 3, cases: 0 },
      { rank: 4, cases: 0 },
      { rank: 5, cases: 0 },
    ]);
    // A band table whose rows depend on the data cannot be compared between two artifacts, so the empty bands are
    // carried at zero.
    expect(census.byBand.map((step) => step.band)).toEqual(MARGIN_BANDS);
    expect(census.byBand.find((step) => step.band === 'under-2pct')!.cases).toBe(2);
    expect(census.byBand.find((step) => step.band === 'at-least-20pct')!.cases).toBe(0);
  });

  it('orders the winner table by count and then by name, so two runs print one table', () => {
    const census = censusNearMisses([
      depthRow(1, [
        ['zulu', 4],
        ['b', 3],
      ]),
      depthRow(1, [
        ['alpha', 4],
        ['b', 3],
      ]),
      depthRow(1, [
        ['alpha', 4],
        ['b', 3],
      ]),
    ]);
    expect(census.winners.map((entry) => entry.service)).toEqual(['alpha', 'zulu']);
    expect(census.winners[0]!.cases).toBe(2);
    expect(census.winners[0]!.share).toBeCloseTo(2 / 3, 12);
    // The tie-break arm, which a table sorted only by count would leave to the map's insertion order: with one
    // case each, the names decide, and `zulu` was inserted first.
    const tied = censusNearMisses([
      depthRow(1, [
        ['zulu', 4],
        ['b', 3],
      ]),
      depthRow(1, [
        ['alpha', 4],
        ['b', 3],
      ]),
    ]);
    expect(tied.winners.map((entry) => entry.service)).toEqual(['alpha', 'zulu']);
  });

  it('splits each family into the one-place cases and the rest of the window', () => {
    const census = censusNearMisses([
      depthRow(1, undefined, ['b'], 'F', 'c1'),
      depthRow(1, undefined, ['b'], 'F', 'c2'),
      depthRow(3, undefined, ['b'], 'F', 'c3'),
      depthRow(1, undefined, ['b'], 'G', 'c4'),
    ]);
    expect(census.families).toEqual([
      { faultType: 'F', rank2: 2, rank3to5: 1, cases: 3 },
      { faultType: 'G', rank2: 1, rank3to5: 0, cases: 1 },
    ]);
  });

  it('orders families by count and then by name as well', () => {
    const census = censusNearMisses([
      depthRow(1, undefined, ['b'], 'Zeta', 'c1'),
      depthRow(1, undefined, ['b'], 'Alpha', 'c2'),
    ]);
    // Equal counts, so the names decide — the same tie-break the winner table keeps, for the same reason: a
    // table whose order depends on insertion would print differently for two artifacts that agree.
    expect(census.families.map((entry) => entry.faultType)).toEqual(['Alpha', 'Zeta']);
    const counted = censusNearMisses([
      depthRow(1, undefined, ['b'], 'Zeta', 'c1'),
      depthRow(1, undefined, ['b'], 'Zeta', 'c2'),
      depthRow(1, undefined, ['b'], 'Alpha', 'c3'),
    ]);
    expect(counted.families.map((entry) => entry.faultType)).toEqual(['Zeta', 'Alpha']);
  });

  it('reads the ceiling as the scoreboard a perfect tie-break would print', () => {
    const census = censusNearMisses([depthRow(0), depthRow(0), depthRow(1), depthRow(null)]);
    expect(census.ceiling.cases).toBe(3);
    expect(census.ceiling.share).toBeCloseTo(3 / 4, 12);
  });

  it('calls the class a tie-break class exactly at the half, and an evidence class below it', () => {
    const tie = depthRow(1, [
      ['a', 100],
      ['b', 99],
    ]);
    const wide = depthRow(1, [
      ['a', 100],
      ['b', 10],
    ]);
    // One of two is exactly the stated share.
    const atHalf = censusNearMisses([tie, wide]);
    expect(atHalf.tieShare).toBeCloseTo(TIE_BREAK_SHARE, 12);
    expect(atHalf.verdict).toBe('tie-break');
    // One of four is below it.
    const below = censusNearMisses([tie, wide, wide, wide]);
    expect(below.verdict).toBe('evidence');
    // Every case a tie is above it.
    expect(censusNearMisses([tie, tie]).verdict).toBe('tie-break');
  });

  it('leaves a case whose margin is unmeasurable out of the tie share', () => {
    const census = censusNearMisses([
      depthRow(1, [
        ['a', null],
        ['b', 3],
      ]),
      depthRow(1, [
        ['a', 4],
        ['b', 3],
      ]),
    ]);
    // Neither is under two percent, so the share is zero even though one of them has no measurable gap at all.
    expect(census.tieShare).toBe(0);
    expect(census.verdict).toBe('evidence');
  });
});

describe('formatCensusRow', () => {
  it('pads every field to a fixed column so two runs diff line by line', () => {
    const plain = formatCensusRow('correct@1', 1156, 1422);
    expect(plain).toHaveLength(42);
    // Column boundaries rather than a literal string: a literal pins one rendering, and the property under test is
    // that the columns START where the next row's columns start.
    expect(plain.slice(0, 2)).toBe('  ');
    expect(plain.slice(2, 28)).toBe('correct@1'.padEnd(26));
    expect(plain.slice(28, 34)).toBe('  1156');
    expect(plain.slice(36)).toBe('81.29%');
  });

  it('pads a long label into the same width as a short one', () => {
    const short = formatCensusRow('absent', 3, 10);
    const long = formatCensusRow('HTTPResponseReplaceMethod', 4, 10);
    expect(short).toHaveLength(long.length);
    expect(long.startsWith('  HTTPResponseReplaceMethod')).toBe(true);
  });

  it('appends the family split as two more fixed columns', () => {
    const withSplit = formatCensusRow('F', 3, 10, [2, 1]);
    expect(withSplit).toHaveLength(52);
    expect(withSplit.endsWith('2   1')).toBe(true);
  });

  it('prints a dash rather than a zero on an empty denominator', () => {
    // The share does not exist; printing `0.00%` would claim a population that is not there scored nothing.
    const row = formatCensusRow('absent', 0, 0);
    expect(row).toHaveLength(42);
    expect(row.slice(28, 34)).toBe('     0');
    expect(row.slice(36)).toBe('     -');
  });
});

describe('formatNearMissCensus', () => {
  const census = censusNearMisses([
    depthRow(0, undefined, ['a'], 'Good', 'c1'),
    depthRow(
      1,
      [
        ['a', 100],
        ['b', 99],
      ],
      ['b'],
      'Tight',
      'c2',
    ),
    depthRow(
      2,
      [
        ['a', 100],
        ['b', 50],
        ['c', 10],
      ],
      ['c'],
      'Deep',
      'c3',
    ),
    depthRow(null, undefined, ['a'], 'Gone', 'c4'),
    depthRow(
      1,
      [
        ['a', 100],
        ['b', 10],
      ],
      ['b'],
      'Wide',
      'c5',
    ),
  ]);

  it('prints the partition, the bands, the winners and the ceiling', () => {
    const text = formatNearMissCensus(census);
    expect(text).toContain('Near-miss census over the full order (cases=5):');
    expect(text).toContain('correct@1');
    expect(text).toContain('near miss (rank 2-5)');
    expect(text).toContain('rank 2');
    expect(text).toContain('rank 5');
    expect(text).toContain('deeper (rank >= 6)');
    expect(text).toContain('absent');
    expect(text).toContain('under-2pct');
    expect(text).toContain('at-least-20pct');
    expect(text).toContain('Deep');
    expect(text).toContain('if every near miss became correct: 4/5 = 80.00%');
    // One tie out of three near misses, which is below the stated half: the report's own verdict line.
    expect(text).toContain('tie share (under-2pct): 33.33% — verdict evidence');
  });

  it('omits the inconsistent row when the artifact agrees with itself', () => {
    // Its absence is the statement; a line that is always zero trains a reader to skip it.
    expect(formatNearMissCensus(census)).not.toContain('inconsistent');
  });

  it('prints the inconsistent row when there is one', () => {
    const broken = censusNearMisses([
      depthRow(3, [
        ['a', 4],
        ['b', 3],
      ]),
    ]);
    expect(formatNearMissCensus(broken)).toContain('inconsistent');
  });

  it('gives every row inside a section the same width', () => {
    // Sections are separated by blank lines, and the widths are per section: the family table carries two extra
    // columns, so a single width for the whole report would be a rendering defect rather than an alignment.
    const sections = formatNearMissCensus(census)
      .split('\n')
      .reduce<string[][]>(
        (groups, line) => {
          if (line === '') groups.push([]);
          else groups[groups.length - 1]!.push(line);
          return groups;
        },
        [[]],
      );
    for (const section of sections) {
      const rows = section.filter((line) => line.startsWith('  '));
      const widths = new Set(rows.map((line) => line.length));
      expect(widths.size).toBeLessThanOrEqual(1);
    }
  });
});

describe('formatNearMissRow', () => {
  it('writes the fields in a fixed order so a diff is a diff of values', () => {
    const miss = toNearMiss(
      depthRow(
        1,
        [
          ['a', 4],
          ['b', 3],
        ],
        ['b'],
        'F',
        'c1',
      ),
    )!;
    expect(formatNearMissRow(miss)).toBe(
      '{"datapack":"c1","faultType":"F","rank":2,"winner":"a","truth":"b",' +
        '"margin":0.25,"band":"at-least-20pct","acceptedSize":1}',
    );
  });

  it('writes an unmeasurable margin as null rather than dropping the key', () => {
    // A consumer reading `margin` must be able to tell "not measurable" from "the key is absent", and a dropped key
    // is the shape that made the promotion census sum `undefined` to NaN.
    const miss = toNearMiss(
      depthRow(
        1,
        [
          ['a', null],
          ['b', 3],
        ],
        ['b'],
      ),
    )!;
    expect(JSON.parse(formatNearMissRow(miss))).toMatchObject({
      margin: null,
      band: 'unmeasurable',
    });
  });
});
