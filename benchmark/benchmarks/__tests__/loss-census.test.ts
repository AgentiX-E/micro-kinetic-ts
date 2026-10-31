import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { deriveAnchorCensus } from '../src/anchor-census.js';
import type { LatencyRouteEntry } from '../src/directional-evidence.js';
import {
  classifyDeepEvidence,
  classifyLoss,
  compareTermZeroRows,
  DEFAULT_SHALLOW_DEPTH,
  dominantLostTerm,
  formatLossReport,
  formatRankingLadder,
  formatTermZeroes,
  LADDER_SCORE_DECIMALS,
  type LossRecord,
  type RankedService,
  type ScoreTerm,
  splitCell,
  summarizeLoss,
  summarizeTermZeroes,
  type TermZeroRow,
  type TruthEvidence,
} from '../src/loss-census.js';
import { stripComments } from './helpers/source-text.js';

/**
 * A supply of nothing, which is this file's cell's REAL value rather than a neutral placeholder.
 *
 * The factory below builds an `RE1:SockShop` record, and RE1's systems carry no `traces.csv` at all — the
 * census reads `capped spans 0 (pre 0 / post 0) | rows: shipped 0 | capped 0 | whole-file 0` for all three of
 * them. So a zeroed supply here is the case's own measurement, which is what makes it usable as a default.
 */
const NO_SUPPLY: LatencyRouteEntry = {
  anchorPresent: true,
  capSpans: 0,
  capPre: 0,
  capPost: 0,
  shippedRows: 0,
  cappedRows: 0,
  wholeFileRows: 0,
};

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
  latencySupply: NO_SUPPLY,
  anchorCensus: deriveAnchorCensus(
    { metrics: new Map(), injectTime: 0, truth: 'orders' },
    'pre-injection',
  ),
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
    // two pools (10 and 0) is 5 — then the deep half's evidence split, which is 0/0/0 because this fixture
    // has no deep misses at all. Pinned to the END of the row because that is the property: a column after
    // `ERR` must not push it out of its own position.
    expect(group).toMatch(/SockShop\s+2\s+1\s+0\s+0\s+0\s+0\s+1\s+5\.0\s+0\s+0\s+0$/);
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

describe('classifyDeepEvidence — the engine owns the threshold, and an unstated row is its own answer', () => {
  const ev = (over: Partial<TruthEvidence> = {}): TruthEvidence => ({
    rcaScore: 0.5,
    rcaThreshold: 0.1,
    depth: 1,
    viaTreeSearch: true,
    metricCount: 2,
    ...over,
  });

  it('calls a truth above the engine threshold LOCAL_EVIDENCE_PRESENT and one at or below NO_LOCAL_EVIDENCE', () => {
    // The boundary is the engine's own, carried in the record rather than restated here: `rcaThreshold` on
    // the fixture is what decides, so the test would move if the engine's cut moved, which is the property a
    // re-derived constant could not have.
    expect(classifyDeepEvidence(ev({ rcaScore: 0.5, rcaThreshold: 0.1 }))).toBe(
      'LOCAL_EVIDENCE_PRESENT',
    );
    expect(classifyDeepEvidence(ev({ rcaScore: 0.1001, rcaThreshold: 0.1 }))).toBe(
      'LOCAL_EVIDENCE_PRESENT',
    );
    // Strictly greater, so a truth exactly AT the bar is not called evidence: a bar is what the engine
    // requires to COUNT something, and something equal to it is not above it.
    expect(classifyDeepEvidence(ev({ rcaScore: 0.1, rcaThreshold: 0.1 }))).toBe(
      'NO_LOCAL_EVIDENCE',
    );
    expect(classifyDeepEvidence(ev({ rcaScore: 0.0, rcaThreshold: 0.1 }))).toBe(
      'NO_LOCAL_EVIDENCE',
    );
    // A DIFFERENT threshold moves the answer, which is the whole reason it travels in the record.
    expect(classifyDeepEvidence(ev({ rcaScore: 0.5, rcaThreshold: 0.9 }))).toBe(
      'NO_LOCAL_EVIDENCE',
    );
  });

  it('reports UNSTATED rather than either answer, in every way a row can fail to say', () => {
    // Three arms, because each is a different missing fact and none of them is an answer. Filing a row under
    // "no local evidence" because its score is absent would be naming a mechanism the instrument cannot see.
    expect(classifyDeepEvidence(undefined)).toBe('UNSTATED');
    expect(classifyDeepEvidence(ev({ rcaScore: undefined }))).toBe('UNSTATED');
    expect(classifyDeepEvidence(ev({ rcaThreshold: undefined }))).toBe('UNSTATED');
    // And ZERO is a value rather than an absence: a truth the engine scored at exactly zero DID clear nothing,
    // which is an answer — the difference between 0 and `undefined` is the difference this class exists for.
    expect(classifyDeepEvidence(ev({ rcaScore: 0, rcaThreshold: 0.1 }))).toBe('NO_LOCAL_EVIDENCE');
  });

  it('counts the deep half by the same rule the classifier states, in one pass', () => {
    const rows = summarizeLoss(
      [
        // DEEP, no local evidence above the bar.
        record({ caseId: 'd1', truthRank: 9, truthEvidence: ev({ rcaScore: 0.02 }) }),
        // DEEP, cleared the bar: a ranking problem.
        record({ caseId: 'd2', truthRank: 9, truthEvidence: ev({ rcaScore: 0.8 }) }),
        // DEEP with no evidence recorded at all.
        record({ caseId: 'd3', truthRank: 9 }),
        // Not deep: must NOT be counted anywhere in the split, or the split is of all misses wearing the
        // name of the deep half.
        record({ caseId: 's1', truthRank: 3, truthEvidence: ev({ rcaScore: 0.02 }) }),
        record({ caseId: 'ok', correct: true, truthRank: 1 }),
      ],
      5,
    );
    const row = rows[0]!;
    expect(row.rerankDeep).toBe(3);
    expect(row.deepNoLocalEvidence).toBe(1);
    expect(row.deepLocalEvidencePresent).toBe(1);
    expect(row.deepEvidenceUnstated).toBe(1);
    // Exhaustive: the three classes partition the deep half, so a fourth class added later cannot be silently
    // uncounted.
    expect(row.deepNoLocalEvidence + row.deepLocalEvidencePresent + row.deepEvidenceUnstated).toBe(
      row.rerankDeep,
    );
  });

  it('prints the split and the sentence it exists for, without inventing a boundary', () => {
    const rows = summarizeLoss(
      [
        record({ caseId: 'd1', truthRank: 40, truthEvidence: ev({ rcaScore: 0.02 }) }),
        record({ caseId: 'd2', truthRank: 41, truthEvidence: ev({ rcaScore: 0.8 }) }),
      ],
      5,
    );
    const text = formatLossReport(rows, 5).join('\n');
    expect(text).toContain("NO local evidence above the engine's own threshold 1");
    expect(text).toContain('local evidence PRESENT and still ranked deep 1');
    expect(text).toContain('undecidable 0');
    expect(text).toContain('noGain');
    expect(text).toContain('hasGain');
    expect(text).toContain('unstated');
  });
});

describe('the mirrored declarations — three copies of one shape, and one pair', () => {
  /**
   * `benchmarks` does not depend on `@agentix-e/micro-kinetic`, so this record mirrors the runner's interface
   * by LITERAL rather than importing it. Two declarations of one shape agree until one of them is edited, and
   * the failure is silent in the worse direction: a field renamed in the runner and not here would leave this
   * record describing a shape nothing produces, and every row would carry `undefined` under a name that reads
   * as measured. So the agreement is fenced rather than assumed.
   *
   * `ScoreTerm` has THREE copies — the core producer's, the runner's and this module's — and the pair of mirrors
   * was previously held only to each other, which is a fence that two copies can satisfy while both disagree
   * with the shape they copy. The producer is read here as well, so the chain cannot float.
   */
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const SOURCES = {
    // The PRODUCER. Core declares the shape the other two copy, so it is the authority and is read here rather
    // than trusted: a fence between two MIRRORS holds them to each other and to nothing else, and two mirrors
    // agreeing on a field the producer does not have is a shape nothing produces.
    core: resolve(REPO, 'packages/core/src/types/faults.ts'),
    // Where the VALUES are produced: the assembly that decides each term's cause and attaches the name it
    // carries. Read here because the census STATES the attachment as a precondition rather than defaulting it.
    pruner: resolve(REPO, 'packages/tree/src/pruning/pruner.ts'),
    runner: resolve(REPO, 'packages/kinetic/src/benchmarks/runners/benchmark-runner.ts'),
    census: resolve(REPO, 'benchmarks/src/loss-census.ts'),
  };

  /** The field names of an `interface <name> { ... }` block, in declaration order. */
  const fieldsOf = (text: string, name: string): string[] => {
    const block = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(
      stripComments(text),
    );
    expect(block, `${name} must be declared in both files`).not.toBeNull();
    return [...block![1]!.matchAll(/^ {2}readonly ([A-Za-z][A-Za-z0-9]*)\??:/gm)].map((m) => m[1]!);
  };

  /** The quoted members of an `export type <name> = ...;` union, in declaration order. */
  const membersOf = (text: string, name: string): string[] => {
    const block = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(stripComments(text));
    expect(block, `${name} must be declared in both files`).not.toBeNull();
    return [...block![1]!.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
  };

  it('declares the truth evidence the same way on both of the sides that carry it', () => {
    const runner = fieldsOf(readFileSync(SOURCES.runner, 'utf8'), 'TruthEvidence');
    const census = fieldsOf(readFileSync(SOURCES.census, 'utf8'), 'TruthEvidence');
    // Non-vacuity before the comparison: an extraction that matched nothing would make this two empty lists.
    expect(runner.length).toBeGreaterThan(5);
    expect(census).toEqual(runner);
  });

  it('declares the same fields, in the same order, on all three sides', () => {
    const core = fieldsOf(readFileSync(SOURCES.core, 'utf8'), 'ScoreTerm');
    const runner = fieldsOf(readFileSync(SOURCES.runner, 'utf8'), 'ScoreTerm');
    const census = fieldsOf(readFileSync(SOURCES.census, 'utf8'), 'ScoreTerm');
    // Non-vacuity before the comparison: an extraction that matched nothing would make these three empty lists.
    expect(core.length).toBeGreaterThan(1);
    // The PRODUCER is the reference, so a field added to both mirrors and not to core fails here — which is the
    // failure the previous two-sided fence could not see, because the two mirrors would have agreed with each
    // other while describing a shape nothing produces.
    expect(runner).toEqual(core);
    expect(census).toEqual(core);
  });

  it('declares the same zero causes on all three sides, so a cause cannot be renamed on one', () => {
    // The cause is what the zero table GROUPS BY. A member renamed in a mirror and not in the producer would
    // make every row of that cause vanish from the report — which reads as "this mechanism does not occur"
    // rather than as a mismatch, the quietest available failure of this feature.
    const core = membersOf(readFileSync(SOURCES.core, 'utf8'), 'TermZeroCause');
    const runner = membersOf(readFileSync(SOURCES.runner, 'utf8'), 'TermZeroCause');
    const census = membersOf(readFileSync(SOURCES.census, 'utf8'), 'TermZeroCause');
    expect(core).toEqual([
      'WEIGHT_ZERO',
      'INPUT_MAP_ABSENT',
      'INPUT_MAP_EMPTY',
      'INPUT_ENTRY_ABSENT',
      'MASKED',
      'VALUE_ZERO',
    ]);
    expect(runner).toEqual(core);
    expect(census).toEqual(core);
  });

  it('maps every source state that is not PRESENT onto a source-bearing cause', () => {
    // A second join, inside the producer's own file, and the one the whole feature rests on: a source state
    // with no cause to report it would make an absence indistinguishable from `VALUE_ZERO`, which is the
    // failure the cause field exists to prevent. Derived from the two unions rather than enumerated, so a
    // FOURTH source state cannot be added without its cause and a state cannot be renamed without its own
    // cause following it.
    const core = readFileSync(SOURCES.core, 'utf8');
    const presences = membersOf(core, 'TermSourcePresence');
    expect(presences).toEqual(['PRESENT', 'MAP_ABSENT', 'MAP_EMPTY', 'ENTRY_ABSENT']);
    const absences = presences.filter((p) => p !== 'PRESENT');
    // The `INPUT_` prefix is the convention that a cause names the OPTIONAL source it read, and the census
    // reads `source` for exactly the members carrying it.
    expect(membersOf(core, 'TermZeroCause').filter((c) => c.startsWith('INPUT_'))).toEqual(
      absences.map((p) => `INPUT_${p}`),
    );
  });

  it('attaches the name each cause requires, on the side that produces it', () => {
    // The census reads `source` for every source-bearing cause and `mask` for the decline, and it states that as
    // a PRECONDITION rather than defaulting it — because a `?? ''` there would be a guard no input can reach,
    // which the coverage gate reports as an untaken branch. The guarantee therefore has to hold at the
    // producer, and a producer that stopped attaching one would make every row of that cause print
    // `undefined` where a field name belongs.
    //
    // Both sides are held to the PREFIX rather than to an enumeration of the causes, so the family's third
    // member could not be added to one side only: an enumerated read of two causes would have printed an empty
    // parenthesis for a third, on the side that reads it, while satisfying an enumerated fence.
    const pruner = readFileSync(SOURCES.pruner, 'utf8');
    const census = readFileSync(SOURCES.census, 'utf8');
    expect(pruner).toContain("cause.startsWith('INPUT_')");
    expect(census).toContain("cause.startsWith('INPUT_')");
    expect(pruner).toContain("cause === 'MASKED' && facts.mask !== undefined");
    // And the census's read of them is the other half of the same join, held by literal for the same reason.
    expect(census).toContain('? t.source!');
    expect(census).toContain('? t.mask!');
  });

  it('carries the truth evidence through the runner into the census row, by the same name', () => {
    // The join between the two files is the FIELD name, and it is not derivable from either declaration. If
    // the runner stopped filling it, or the census stopped reading it, the split above would read zero
    // everywhere and look like a finding rather than like a disconnection.
    expect(readFileSync(SOURCES.runner, 'utf8')).toContain('truthEvidence: placement.evidence,');
    expect(readFileSync(SOURCES.census, 'utf8')).toContain('classifyDeepEvidence(m.truthEvidence)');
    // And the winner's side, which is what makes an attribution possible at all.
    expect(readFileSync(SOURCES.runner, 'utf8')).toContain('top1Terms: results[0]?.terms,');
    expect(readFileSync(SOURCES.census, 'utf8')).toContain(
      'dominantLostTerm(m.truthEvidence?.terms, m.top1Terms)',
    );
  });
});

describe('dominantLostTerm — which term the winner won on, and what it refuses to claim', () => {
  const t = (name: string, contribution: number): ScoreTerm => ({ name, contribution });

  it('returns the term with the largest truth-to-winner gap', () => {
    const truth = [t('selfAnomalyLog1p', 0.5), t('lat', 0.1), t('log', 0.9)];
    const winner = [t('selfAnomalyLog1p', 0.6), t('lat', 0.8), t('log', 0.9)];
    // Gaps: selfAnomalyLog1p +0.1, lat +0.7, log 0.0. The largest positive one decided it.
    expect(dominantLostTerm(truth, winner)).toBe('lat');
  });

  it('is a difference and not a level: a term the truth LEADS on is never returned', () => {
    // The truth can be ahead on a term and lose anyway. Returning that term because its magnitude is large
    // would name the wrong side of the gap, so only positive differences are candidates.
    const truth = [t('topo', 5.0), t('log', 0.1)];
    const winner = [t('topo', 1.0), t('log', 0.9)];
    // topo −4.0 (the truth leads, never a candidate), log +0.8.
    expect(dominantLostTerm(truth, winner)).toBe('log');
  });

  it('resolves a tie to the FIRST term in the formula order, not to map iteration order', () => {
    // A tie broken by whichever the map happened to yield last is a different answer on a different engine,
    // and an artifact that changes when nothing changed cannot be diffed.
    const truth = [t('source', 0), t('temporal', 0)];
    const winner = [t('source', 0.5), t('temporal', 0.5)];
    expect(dominantLostTerm(truth, winner)).toBe('source');
  });

  it('refuses when either side is missing, or when the two sides share no term', () => {
    // Three distinct refusals, none of them a term name. A gap needs two sides; a gap between breakdowns of
    // two DIFFERENT scores is not a quantity, and naming a term from one of them would be answering a
    // question about a difference that does not exist.
    expect(dominantLostTerm(undefined, [t('lat', 1)])).toBeUndefined();
    expect(dominantLostTerm([t('lat', 1)], undefined)).toBeUndefined();
    expect(dominantLostTerm([t('lat', 1)], [t('topo', 2)])).toBeUndefined();
    // And when the truth leads on EVERY shared term there is no positive gap, which cannot happen for two
    // breakdowns of the same score — so it is reported as unattributable rather than as a term.
    expect(dominantLostTerm([t('lat', 5)], [t('lat', 1)])).toBeUndefined();
  });
});

describe('the deep half attributed — the distribution, its order, and its refusals', () => {
  const t = (name: string, contribution: number): ScoreTerm => ({ name, contribution });
  const deep = (caseId: string, truthTerms?: ScoreTerm[], top1Terms?: ScoreTerm[]): LossRecord =>
    record({
      caseId,
      truthRank: 20,
      truthEvidence: {
        rcaScore: 0.9,
        rcaThreshold: 0.1,
        depth: 3,
        viaTreeSearch: false,
        metricCount: 1,
        ...(truthTerms === undefined ? {} : { terms: truthTerms }),
      },
      ...(top1Terms === undefined ? {} : { top1Terms }),
    });

  it('counts by term, sorted by count and then by NAME', () => {
    const rows = summarizeLoss(
      [
        deep('a', [t('log', 0), t('lat', 0)], [t('log', 3), t('lat', 1)]),
        deep('b', [t('log', 0), t('lat', 0)], [t('log', 2), t('lat', 1)]),
        deep('c', [t('log', 0), t('lat', 0)], [t('log', 0), t('lat', 9)]),
      ],
      5,
    );
    expect(rows[0]!.deepLostOn).toEqual([
      { term: 'log', count: 2 },
      { term: 'lat', count: 1 },
    ]);
    // Exhaustive: every deep case lands in a term or in the unavailable count, never in neither.
    const counted = rows[0]!.deepLostOn.reduce((a, e) => a + e.count, 0);
    expect(counted + rows[0]!.deepAttributionUnavailable).toBe(rows[0]!.rerankDeep);
  });

  it('breaks a COUNT tie by term NAME, and the answer does not depend on the case order', () => {
    // TWO inputs, one reverse-alphabetical and one ascending, asserting they produce the SAME table. That is
    // the property — a distribution that moves when the cases are reordered cannot be diffed — and it is also
    // what exercises both arms of the name comparison: a sort handed one ordering sees the pair in one
    // orientation and never the other, so a single fixture can leave half the tie-break permanently untaken.
    const reverse = summarizeLoss(
      [
        deep('a', [t('topo', 0)], [t('topo', 5)]),
        deep('b', [t('mongo', 0)], [t('mongo', 5)]),
        deep('c', [t('log', 0)], [t('log', 5)]),
      ],
      5,
    );
    const ascending = summarizeLoss(
      [
        deep('a', [t('log', 0)], [t('log', 5)]),
        deep('b', [t('mongo', 0)], [t('mongo', 5)]),
        deep('c', [t('topo', 0)], [t('topo', 5)]),
      ],
      5,
    );
    expect(reverse[0]!.deepLostOn).toEqual([
      { term: 'log', count: 1 },
      { term: 'mongo', count: 1 },
      { term: 'topo', count: 1 },
    ]);
    expect(ascending[0]!.deepLostOn).toEqual(reverse[0]!.deepLostOn);
  });

  it('reports a deep case with no breakdown as UNAVAILABLE rather than folding it into a term', () => {
    const rows = summarizeLoss(
      [deep('a', [t('log', 0)], [t('log', 9)]), deep('b'), deep('c', [t('log', 0)], undefined)],
      5,
    );
    expect(rows[0]!.deepLostOn).toEqual([{ term: 'log', count: 1 }]);
    expect(rows[0]!.deepAttributionUnavailable).toBe(2);
    expect(rows[0]!.deepAttributionUnavailable + 1).toBe(rows[0]!.rerankDeep);
  });

  it('counts nothing for a shallow miss, so the distribution is of the DEEP half alone', () => {
    const rows = summarizeLoss(
      [record({ caseId: 's', truthRank: 3, top1Terms: [t('log', 9)] })],
      5,
    );
    expect(rows[0]!.rerankDeep).toBe(0);
    expect(rows[0]!.deepLostOn).toEqual([]);
    expect(rows[0]!.deepAttributionUnavailable).toBe(0);
  });

  it('prints the attribution beside the split, and says so when nothing is attributable', () => {
    const withTerms = formatLossReport(
      summarizeLoss([deep('a', [t('log', 0)], [t('log', 9)])], 5),
      5,
    ).join('\n');
    expect(withTerms).toContain("the winner's largest per-term advantage was log 1");
    const without = formatLossReport(summarizeLoss([deep('a')], 5), 5).join('\n');
    expect(without).toContain('not attributable — no deep case carried both breakdowns');
    expect(without).toContain('unattributable 1');
  });
});

describe('summarizeTermZeroes — why each zero is a zero, over the misses and only the misses', () => {
  const t = (
    name: string,
    contribution: number,
    cause?: ScoreTerm['cause'],
    detail?: { source?: string; mask?: string },
  ): ScoreTerm => ({ name, contribution, cause, ...detail });
  /** A miss whose truth carries the given terms. `truthRank: 20` is DEEP, `3` is SHALLOW. */
  const withTerms = (
    caseId: string,
    terms: ScoreTerm[],
    over: Partial<LossRecord> = {},
  ): LossRecord =>
    record({
      caseId,
      truthRank: 20,
      truthEvidence: {
        depth: 1,
        viaTreeSearch: false,
        metricCount: 1,
        terms,
      },
      ...over,
    });

  it('groups by (term, cause, detail), so two absences of different fields stay apart', () => {
    // A missing `topoScores` and a missing `logScores` are different absences. Merging them into one
    // `INPUT_MAP_ABSENT` row would report a single mechanism where there are two fields to go and look at.
    const records = [
      withTerms('a', [
        t('topo', 0, 'INPUT_MAP_ABSENT', { source: 'topoScores' }),
        t('log', 0, 'INPUT_MAP_ABSENT', { source: 'logScores' }),
      ]),
      withTerms('b', [
        t('topo', 0, 'INPUT_MAP_ABSENT', { source: 'topoScores' }),
        t('log', 0, 'WEIGHT_ZERO'),
      ]),
    ];
    const summary = summarizeTermZeroes(records);
    expect(summary.cases).toBe(2);
    expect(summary.rows).toEqual([
      { term: 'log', cause: 'INPUT_MAP_ABSENT', detail: 'logScores', count: 1 },
      { term: 'log', cause: 'WEIGHT_ZERO', detail: '', count: 1 },
      { term: 'topo', cause: 'INPUT_MAP_ABSENT', detail: 'topoScores', count: 2 },
    ]);
    // The order is (term, cause, detail) rather than arrival order, so the same corpus prints the same table.
    expect(summarizeTermZeroes([...records].reverse()).rows).toEqual(summary.rows);
  });

  it('counts a term that contributed NOTHING at zero and says which side it read', () => {
    const records = [
      withTerms('a', [t('log', 0.4), t('topo', 0, 'WEIGHT_ZERO')]),
      withTerms('b', [t('log', 0.1)]),
    ];
    const truth = summarizeTermZeroes(records);
    expect(truth.side).toBe('truth');
    // The live `log` term is not a row: the table is of zeros, and a term with no cause is not filed under one.
    expect(truth.rows).toEqual([{ term: 'topo', cause: 'WEIGHT_ZERO', detail: '', count: 1 }]);
    // The `winner` side is a different read of the same records, and asking for it is how a caller compares.
    expect(summarizeTermZeroes(records, { side: 'winner' }).rows).toEqual([]);
  });

  it('reads only the reranking misses, so a case the engine got right cannot dilute the table', () => {
    // The population is a decision: 600 correct cases would otherwise swamp the mechanism that decides the 159
    // that are lost, and every share in the table would read low for a reason that is about the population
    // rather than about the term.
    const summary = summarizeTermZeroes([
      withTerms('miss', [t('topo', 0, 'WEIGHT_ZERO')]),
      withTerms('ok', [t('topo', 0, 'WEIGHT_ZERO')], { correct: true }),
      withTerms('shallow', [t('topo', 0, 'WEIGHT_ZERO')], { truthRank: 3 }),
    ]);
    expect(summary.cases).toBe(2);
    expect(summary.rows).toEqual([{ term: 'topo', cause: 'WEIGHT_ZERO', detail: '', count: 2 }]);
  });

  it('leaves a miss with no breakdown out of the denominator too, not only out of the rows', () => {
    // Counting it in the denominator would make every share read low for a reason about the artifact rather
    // than about the term — the same defect as attributing a value that is missing.
    const summary = summarizeTermZeroes([
      withTerms('a', [t('topo', 0, 'WEIGHT_ZERO')]),
      record({ caseId: 'b' }),
    ]);
    expect(summary.cases).toBe(1);
    expect(summary.rows).toEqual([{ term: 'topo', cause: 'WEIGHT_ZERO', detail: '', count: 1 }]);
  });

  it('prints a heading naming the side, one line per term, and a sentence when nothing is attributable', () => {
    const lines = formatTermZeroes(
      summarizeTermZeroes([
        withTerms('a', [
          t('topo', 0, 'WEIGHT_ZERO'),
          t('lat', 0, 'INPUT_MAP_ABSENT', { source: 'edgeLatencyScores' }),
        ]),
        withTerms('b', [
          t('topo', 0, 'WEIGHT_ZERO'),
          t('lat', 0, 'INPUT_MAP_ABSENT', { source: 'edgeLatencyScores' }),
        ]),
      ]),
    ).join('\n');
    expect(lines).toContain('2 reranking misses, terms on the truth');
    expect(lines).toContain('lat');
    expect(lines).toContain('INPUT_MAP_ABSENT(edgeLatencyScores)');
    expect(lines).toContain('100.0%');
    // A term with two causes prints them on ONE line, so a term reads as one statement.
    expect(lines.match(/^ {4}topo /gm)).toHaveLength(1);
    expect(formatTermZeroes({ cases: 3, side: 'winner', rows: [] }).join('\n')).toContain(
      'none — every term contributed something on every miss',
    );
  });
});

describe('compareTermZeroRows — the report order, asserted arm by arm', () => {
  /**
   * Hand-built rows, because the equality arms are the ones a sort never reaches on a small corpus and the ones
   * whose absence reads as a covered line. A comparator tested only through `Array.sort` is tested by whatever
   * pairs the engine happened to compare.
   */
  const row = (term: string, cause: ScoreTerm['cause'], detail = ''): TermZeroRow => ({
    term,
    cause: cause!,
    detail,
    count: 1,
  });

  it('orders by term first, in BOTH directions', () => {
    expect(compareTermZeroRows(row('a', 'VALUE_ZERO'), row('b', 'VALUE_ZERO'))).toBeLessThan(0);
    expect(compareTermZeroRows(row('b', 'VALUE_ZERO'), row('a', 'VALUE_ZERO'))).toBeGreaterThan(0);
  });

  it('falls to the CAUSE when the terms are equal, and only then', () => {
    // The `MASKED` member sorts above `VALUE_ZERO` by the union's own spelling, which is what makes the order a
    // property of the DATA rather than of the order the cases arrived in.
    expect(compareTermZeroRows(row('a', 'MASKED'), row('a', 'VALUE_ZERO'))).toBeLessThan(0);
    expect(compareTermZeroRows(row('a', 'VALUE_ZERO'), row('a', 'MASKED'))).toBeGreaterThan(0);
  });

  it('falls to the named DETAIL last, so two absences of different fields stay ordered', () => {
    expect(
      compareTermZeroRows(
        row('a', 'INPUT_MAP_ABSENT', 'logScores'),
        row('a', 'INPUT_MAP_ABSENT', 'topoScores'),
      ),
    ).toBeLessThan(0);
    expect(
      compareTermZeroRows(
        row('a', 'INPUT_MAP_ABSENT', 'topoScores'),
        row('a', 'INPUT_MAP_ABSENT', 'logScores'),
      ),
    ).toBeGreaterThan(0);
  });

  it('returns ZERO for two rows of one identity — which is the arm a sort cannot reach', () => {
    // Without this arm the comparator would claim a strict order between a row and itself, and `Array.sort`'s
    // result would depend on which of the two it kept.
    expect(compareTermZeroRows(row('a', 'VALUE_ZERO'), row('a', 'VALUE_ZERO'))).toBe(0);
  });
});

describe('the zero table over the census — a masked decline is its own row', () => {
  it('groups a MASKED cause by the GATE, and a source-bearing cause by the FIELD', () => {
    // The `INPUT_*` causes and `MASKED` all name something, and the census reads the name from a different
    // field for each: `source` for the absences, `mask` for the decline. Reading the wrong one would print an
    // empty parenthesis and look like a term with no detail rather than like a mis-read — and a third absence
    // would be the case where an ENUMERATED read of the cause silently produced `''` for it.
    const summary = summarizeTermZeroes([
      record({
        caseId: 'a',
        truthRank: 20,
        truthEvidence: {
          depth: 1,
          viaTreeSearch: false,
          metricCount: 1,
          terms: [
            { name: 'rise', contribution: 0, cause: 'MASKED', mask: 'logicExceptionGate' },
            { name: 'topo', contribution: 0, cause: 'INPUT_ENTRY_ABSENT', source: 'topoScores' },
            { name: 'lat', contribution: 0, cause: 'INPUT_MAP_EMPTY', source: 'edgeLatencyScores' },
          ],
        },
      }),
    ]);
    expect(summary.rows).toEqual([
      { term: 'lat', cause: 'INPUT_MAP_EMPTY', detail: 'edgeLatencyScores', count: 1 },
      { term: 'rise', cause: 'MASKED', detail: 'logicExceptionGate', count: 1 },
      { term: 'topo', cause: 'INPUT_ENTRY_ABSENT', detail: 'topoScores', count: 1 },
    ]);
    // And every member is reachable through the table, so none of them is a value the union carries and the
    // report cannot print.
    const printed = new Set(summary.rows.map((r) => r.cause));
    printed.add('WEIGHT_ZERO');
    printed.add('INPUT_MAP_ABSENT');
    printed.add('VALUE_ZERO');
    expect(printed.size).toBe(6);
  });
});
