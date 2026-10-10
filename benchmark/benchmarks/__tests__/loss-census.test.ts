import { describe, expect, it } from 'vitest';

import {
  classifyLoss,
  DEFAULT_SHALLOW_DEPTH,
  formatLossReport,
  formatRankingLadder,
  LADDER_SCORE_DECIMALS,
  type LossRecord,
  type RankedService,
  splitCell,
  summarizeLoss,
} from '../src/loss-census.js';

/** A ladder entry, with the sort key defaulted to something monotone. */
const entry = (
  serviceId: string,
  finalScore: number,
  extra: Partial<RankedService> = {},
): RankedService => ({ serviceId, confidence: 0, finalScore, depth: 0, ...extra });

const record = (over: Partial<LossRecord> = {}): LossRecord => ({
  caseId: 'c',
  cell: 'RE1:SockShop',
  faultType: 'cpu',
  truth: 'orders',
  predicted: 'carts',
  correct: false,
  pool: 10,
  truthInGraph: true,
  truthRank: 2,
  ...over,
});

describe('formatRankingLadder — the printed number IS the sort key', () => {
  it('prints the score the order came from, and it DECREASES with rank', () => {
    // Hand-built so that the display confidence rises where the sort key falls: `confidence` folds in
    // depth and error-bound penalties, so it need not be monotone in rank, and a reader checking the line
    // against itself must be checking the value that produced the order.
    const ladder = [
      entry('a', 3.2, { confidence: 0.11, depth: 0 }),
      entry('b', 3.1, { confidence: 0.98, depth: 0 }),
      entry('c', 2.4, { confidence: 0.2, depth: 1 }),
      entry('d', 1.0, { confidence: 0.29, depth: 2 }),
    ];
    const line = formatRankingLadder(ladder);
    const printed = [...line.matchAll(/\(([-0-9.]+),d(\d+)\)/g)].map((m) => Number(m[1]));
    expect(printed).toEqual([3.2, 3.1, 2.4, 1.0]);
    for (let i = 1; i < printed.length; i++) {
      expect(printed[i]!, `${i}th score must not exceed the one before it`).toBeLessThanOrEqual(
        printed[i - 1]!,
      );
    }
    // And the display value is nowhere on the line, so a reader cannot mistake it for the score.
    expect(line).not.toContain('0.11');
    expect(line).not.toContain('0.98');
  });

  it('prints `-` for a score the artifact does not carry, rather than substituting another quantity', () => {
    // The rule, stated as a value: a missing sort key is reported as missing. Falling back to `confidence`
    // would put a number in the score's position that the order did not come from — unverifiable by
    // construction, and indistinguishable from a measurement.
    const line = formatRankingLadder([
      { serviceId: 'a', confidence: 0.77, depth: 0 },
      entry('b', 1.5, { depth: 2 }),
    ]);
    expect(line).toBe('    Top-K: a(-,d0) | b(1.500,d2)');
  });

  it('renders an empty list as an empty ladder rather than throwing', () => {
    expect(formatRankingLadder([])).toBe('    Top-K: ');
  });

  it('uses the declared precision, so the number of decimals is a named fact', () => {
    const line = formatRankingLadder([entry('a', 1 / 3)]);
    expect(line).toBe(`    Top-K: a(${(1 / 3).toFixed(LADDER_SCORE_DECIMALS)},d0)`);
    expect(LADDER_SCORE_DECIMALS).toBe(3);
  });
});

describe('classifyLoss — a miss is retrieval or reranking, and never both', () => {
  it('names a correct case CORRECT regardless of rank', () => {
    expect(classifyLoss(record({ correct: true, truthRank: 1 }))).toBe('CORRECT');
  });

  it('names a truth the ranking never surfaces RETRIEVAL, whether or not the graph holds it', () => {
    // The pool is the set the engine RANKED, so absence is decided by the rank. A truth the graph holds and
    // the ranking never surfaces is still one no ranking of that pool could have returned — and the record
    // does not carry the pruner's scored set, so calling that case a defect would assert more than was
    // measured. It is reported as a mechanism instead; see `summarizeLoss`.
    expect(classifyLoss(record({ truthInGraph: false, truthRank: undefined }))).toBe('RETRIEVAL');
    expect(classifyLoss(record({ truthInGraph: true, truthRank: undefined }))).toBe('RETRIEVAL');
  });

  it('splits reranking at the shallow depth, INCLUSIVELY at the boundary', () => {
    expect(classifyLoss(record({ truthRank: 2 }), 5)).toBe('RERANK_SHALLOW');
    expect(classifyLoss(record({ truthRank: 5 }), 5)).toBe('RERANK_SHALLOW');
    expect(classifyLoss(record({ truthRank: 6 }), 5)).toBe('RERANK_DEEP');
  });

  it('defaults the shallow depth to the recorded top-K', () => {
    expect(DEFAULT_SHALLOW_DEPTH).toBe(5);
    expect(classifyLoss(record({ truthRank: 5 }))).toBe('RERANK_SHALLOW');
  });

  it('treats a truth at rank 1 that is NOT the prediction as shallow reranking, not as correct', () => {
    // `correct` is the authority on correctness; a rank of 1 that disagrees with it is a contradiction in
    // the record, and this arm pins which of the two the classifier believes.
    expect(classifyLoss(record({ correct: false, truthRank: 1 }))).toBe('RERANK_SHALLOW');
  });

  it('names a case whose analysis threw ENGINE_ERROR, and the flag outranks every other field', () => {
    // There is no ranking to be retrieved from or reranked in, so `truthInGraph` would be a claim about a
    // graph that was never built. The flag is checked FIRST so a record that also claims correctness cannot
    // hide an engine failure behind it.
    expect(classifyLoss(record({ errored: true, truthInGraph: false, truthRank: undefined }))).toBe(
      'ENGINE_ERROR',
    );
    expect(classifyLoss(record({ errored: true, correct: true, truthRank: 1 }))).toBe(
      'ENGINE_ERROR',
    );
    expect(classifyLoss(record({ errored: false, truthRank: 2 }))).toBe('RERANK_SHALLOW');
  });
});

describe('splitCell', () => {
  it('splits at the first colon', () => {
    expect(splitCell('RE3:TrainTicket')).toEqual(['RE3', 'TrainTicket']);
  });

  it('refuses a key that does not declare both halves, rather than guessing one', () => {
    for (const bad of ['RE1', ':OnlineBoutique', 'RE1:', '']) {
      expect(splitCell(bad), bad).toEqual(['unrecognised', 'unrecognised']);
    }
  });
});

describe('summarizeLoss — the counts, and the denominator beside them', () => {
  const rows = summarizeLoss(
    [
      // two correct
      record({ caseId: '1', correct: true, truthRank: 1, pool: 8 }),
      record({ caseId: '2', correct: true, truthRank: 1, pool: 12 }),
      // one retrieval miss the graph never held
      record({ caseId: '3', truthInGraph: false, truthRank: undefined, pool: 10 }),
      // two shallow, one deep, one unranked
      record({ caseId: '4', truthRank: 2, pool: 10 }),
      record({ caseId: '5', truthRank: 4, pool: 14 }),
      record({ caseId: '6', truthRank: 9, pool: 20 }),
      // ... and one the graph holds but the ranking never surfaces
      record({ caseId: '7', truthInGraph: true, truthRank: undefined, pool: 16 }),
      // one engine error, whose pool is zero because no graph was built
      record({ caseId: '8', errored: true, truthInGraph: false, truthRank: undefined, pool: 0 }),
      // another group
      record({ caseId: '9', cell: 'RE3:TrainTicket', truthRank: 3, pool: 42 }),
    ],
    5,
  );

  it('groups by cell and orders deterministically', () => {
    expect(rows.map((r) => `${r.suite}/${r.system}`)).toEqual(['RE1/SockShop', 'RE3/TrainTicket']);
  });

  it('counts every class and totals the group', () => {
    const [re1, re3] = rows;
    expect(re1).toMatchObject({
      cases: 8,
      correct: 2,
      engineError: 1,
      retrieval: 2,
      retrievalNotInGraph: 1,
      retrievalNotRanked: 1,
      rerankShallow: 2,
      rerankDeep: 1,
    });
    expect(re3).toMatchObject({ cases: 1, correct: 0, rerankShallow: 1, poolMedian: 42 });
    // The classes partition the group: every case is in exactly one. And the two retrieval mechanisms are a
    // partition OF the retrieval half, which is why they are counted rather than classified.
    for (const r of rows) {
      expect(r.correct + r.engineError + r.retrieval + r.rerankShallow + r.rerankDeep).toBe(
        r.cases,
      );
      expect(r.retrievalNotInGraph + r.retrievalNotRanked).toBe(r.retrieval);
    }
  });

  it('reports the MEDIAN pool, not the mean, so one huge system cannot move it', () => {
    // Hand-computed: pools 0, 8, 10, 10, 12, 14, 16, 20 -> the mean of the two middles, 11.
    // The 0 belongs to the engine-error case and is not an outlier to be trimmed: dropping it would raise
    // the median of a population that really contains a case with no candidates.
    expect(rows[0]!.poolMedian).toBe(11);
  });

  it('takes the SINGLE middle for an odd count, which is the arm one case cannot reach', () => {
    // Hand-computed: pools 10, 20, 30 -> the second of three is 20. Stated separately from the even arm
    // because the two are different expressions and a population of one hides the difference.
    const row = summarizeLoss(
      [
        record({ caseId: 'a', pool: 10 }),
        record({ caseId: 'b', pool: 20 }),
        record({ caseId: 'c', pool: 30 }),
      ],
      5,
    )[0]!;
    expect(row.poolMedian).toBe(20);
  });

  it('takes the mean of the two middles for an even count', () => {
    const row = summarizeLoss(
      [record({ caseId: 'a', pool: 10 }), record({ caseId: 'b', pool: 20 })],
      5,
    )[0]!;
    expect(row.poolMedian).toBe(15);
  });

  it('summarises an empty corpus to no rows, and a zero pool to zero rather than NaN', () => {
    expect(summarizeLoss([], 5)).toEqual([]);
    expect(summarizeLoss([record({ pool: 0 })], 5)[0]!.poolMedian).toBe(0);
  });

  it('files a case whose cell is unrecognised under its own row rather than joining another', () => {
    const row = summarizeLoss([record({ cell: 'RE1' })], 5)[0]!;
    expect(row).toMatchObject({ suite: 'unrecognised', system: 'unrecognised' });
  });
});

describe('formatLossReport — the reading is the split, not the accuracy', () => {
  const rows = summarizeLoss(
    [
      record({ caseId: '1', correct: true, truthRank: 1 }),
      record({ caseId: '2', truthInGraph: false, truthRank: undefined }),
      record({ caseId: '3', truthRank: 3 }),
      record({ caseId: '4', truthRank: 40, pool: 42 }),
    ],
    5,
  );

  it('prints the split of the misses, and names retrieval as unrecoverable by ranking', () => {
    const text = formatLossReport(rows, 5).join('\n');
    expect(text).toContain('accuracy 25.0%');
    expect(text).toContain('of 3 misses');
    expect(text).toContain('RETRIEVAL 33.3%');
    expect(text).toContain('RERANKING 66.7%');
    expect(text).toContain('no ranking change can recover these');
    // The retrieval half names its own two mechanisms, because they have different owners.
    expect(text).toContain('1 were never a graph node and 0 a node the ranking does not surface');
    expect(text).toContain('shallow 33.3%');
    expect(text).toContain('deep 33.3%');
  });

  it('names the aggregation convention, because the published percentage is a DIFFERENT quantity', () => {
    // Two conventions, one noun, and they disagree on one of the three suites: this report weights every
    // case equally, while the published cell `AVERAGE` is the unweighted mean of the fault-type accuracies
    // (`docs/accuracy-aggregation.md`). Read side by side without a label, 78.10% here and 78.75% there look
    // like a regression. The label is the fix, and the assertion is that the label is PRESENT rather than
    // that the number is right — a number cannot assert its own unit.
    const text = formatLossReport(rows, 5).join('\n');
    expect(text).toContain('CASE-LEVEL');
    expect(text).toContain('unweighted mean of the');
    expect(text).toContain('docs/accuracy-aggregation.md');
    // And the suite where they part company is named with BOTH of its values, so a reader can tell which
    // one a quoted figure is rather than having to re-derive it.
    expect(text).toContain('RE3');
    expect(text).toContain('53.33%');
    expect(text).toContain('58.69%');
  });

  it('names the shallow depth it used, so the split is reproducible', () => {
    expect(formatLossReport(rows, 7)[0]).toContain('rank <= 7');
  });

  it('prints the engine-error count in its own column rather than folding it into a miss class', () => {
    const withError = summarizeLoss(
      [
        record({ caseId: '1', correct: true, truthRank: 1 }),
        record({ caseId: '2', errored: true, truthInGraph: false, truthRank: undefined, pool: 0 }),
      ],
      5,
    );
    const lines = formatLossReport(withError, 5);
    // Line 0 is the shallow-depth note; line 1 is the column header.
    expect(lines[1]).toContain('ERR');
    const group = lines.find((l) => l.includes('SockShop'))!;
    const total = lines.find((l) => l.includes('TOTAL'))!;
    // One engine error, one verdict of each: correct 1, every miss class 0, ERR 1, and the median of the
    // two pools (10 and 0) is 5.
    expect(group).toMatch(/SockShop\s+2\s+1\s+0\s+0\s+0\s+0\s+1\s+5\.0$/);
    expect(total).toMatch(/TOTAL\s+2\s+1\s+0\s+0\s+0\s+0\s+1$/);
    // The reading line must account for ALL misses: a line that reports RETRIEVAL and RERANKING only would
    // read 0% + 0% of one miss, which hides the engine failure rather than reporting it.
    expect(lines[lines.length - 1]).toContain('ENGINE ERROR 100.0%');
  });

  it('says a group with no misses has nothing to split rather than dividing by zero', () => {
    const none = summarizeLoss([record({ correct: true, truthRank: 1 })], 5);
    const text = formatLossReport(none, 5).join('\n');
    expect(text).toContain('of 0 misses');
    expect(text).toContain('RETRIEVAL n/a');
  });

  it('an empty corpus says so rather than printing a table of zeros', () => {
    expect(formatLossReport([], 5)).toEqual([
      'no cases found: nothing to census, and saying so beats printing a zero.',
    ]);
  });

  it('aligns its header and total rows with the columns the group rows use', () => {
    const lines = formatLossReport(rows, 5);
    const group = lines.find((l) => l.includes('SockShop'))!;
    const total = lines.find((l) => l.includes('TOTAL'))!;
    // The group row's first numeric column starts at the same offset as the total's.
    expect(group.indexOf('   4')).toBe(total.indexOf('   4'));
  });
});
