import { describe, expect, it } from 'vitest';

import {
  avgAtK,
  compareToBoard,
  compareToBoardBest,
  computeBoardMetrics,
  formatBoardMetrics,
  formatBoardTable,
  formatPairedAtDepth,
  pairedTopAt,
  RCABENCH_LEADERBOARD,
  topAt,
  topRate,
} from '../src/board-metrics.js';
import type { PerCaseVerdict } from '../src/fse26-per-case.js';

/**
 * A verdict row built from the four facts the metric layer needs and nothing else.
 *
 * @param truthRank - The accepted answer's best rank over the WHOLE order, `0` when it was not ranked.
 * @param pool - The width of the order the run computed.
 * @param accepted - The corpus's label set.
 * @param ranked - The published prefix, which must agree with `truthRank` where the two overlap.
 * @returns One row.
 */
const row = (
  truthRank: number,
  pool: number,
  accepted: readonly string[] = ['a'],
  ranked: readonly string[] = ['a', 'b', 'c', 'd', 'e'],
): PerCaseVerdict => ({
  datapack: `case-${truthRank}-${pool}`,
  faultType: 'X',
  accepted,
  ranked,
  truthRank,
  pool,
});

/** `n` rows all answered at `rank`, so an average over them is arithmetic a reader can do by hand. */
const many = (n: number, rank: number, pool = 50): PerCaseVerdict[] =>
  Array.from({ length: n }, (_, i) => ({
    datapack: `case-${i}`,
    faultType: 'X',
    accepted: ['a'],
    ranked:
      rank >= 1 && rank <= 5
        ? ['x', 'y', 'z', 'w', 'v'].map((v, j) => (j === rank - 1 ? 'a' : v))
        : ['x', 'y', 'z', 'w', 'v'],
    truthRank: rank,
    pool,
  }));

describe('computeBoardMetrics — the six numbers the board publishes', () => {
  it('counts Top@k from truthRank, over the whole order rather than the published prefix', () => {
    // Five cases answered at ranks 1..5 and one at rank 9. A reader of `ranked` alone cannot see the ninth, and
    // that is precisely why the count comes from truthRank: Top@10 of this corpus is 6, not 5.
    const verdicts = [
      ...many(1, 1),
      ...many(1, 2),
      ...many(1, 3),
      ...many(1, 4),
      ...many(1, 5),
      ...many(1, 9),
    ];
    const metrics = computeBoardMetrics(verdicts, 10);
    expect(topAt(metrics, 1)).toBe(1);
    expect(topAt(metrics, 3)).toBe(3);
    expect(topAt(metrics, 5)).toBe(5);
    expect(topAt(metrics, 9)).toBe(6);
  });

  it('reports a rate that is the count over the cases, so the percentage can be re-derived', () => {
    const metrics = computeBoardMetrics([...many(3, 1), ...many(1, 4)], 5);
    expect(metrics.cases).toBe(4);
    expect(topAt(metrics, 1)).toBe(3);
    expect(topRate(metrics, 1)).toBeCloseTo(0.75, 12);
    expect(topRate(metrics, 4)).toBeCloseTo(1, 12);
  });

  it('computes MRR as the mean of 1/rank over EVERY case, so a miss charges zero', () => {
    // 1/1 + 1/2 + 1/4 + 0 over four cases. The absent case is in the denominator: a mean over the found cases
    // would be 0.5833 and would rise whenever the engine abstained more often, which is the defect this
    // convention exists to avoid.
    const metrics = computeBoardMetrics(
      [...many(1, 1), ...many(1, 2), ...many(1, 4), ...many(1, 0)],
      5,
    );
    expect(metrics.mrr).toBeCloseTo((1 + 0.5 + 0.25 + 0) / 4, 12);
    expect(metrics.absent).toBe(1);
  });

  it('counts an unranked truth as absent rather than as rank zero, and keeps it out of Top@k', () => {
    const metrics = computeBoardMetrics([...many(2, 1), ...many(1, 0)], 5);
    expect(metrics.absent).toBe(1);
    expect(topAt(metrics, 1)).toBe(2);
    expect(topRate(metrics, 1)).toBeCloseTo(2 / 3, 12);
  });

  it('reports the pool widths it was given, because a miss and an omission are different failures', () => {
    const metrics = computeBoardMetrics(
      [row(1, 49), row(0, 50, ['a'], ['b', 'c', 'd', 'e', 'f'])],
      5,
    );
    expect(metrics.minPool).toBe(49);
    expect(metrics.maxPool).toBe(50);
  });

  it('saturates at 1 for a depth wider than every pool, and says so rather than inventing cases', () => {
    const metrics = computeBoardMetrics([...many(2, 1, 49)], 80);
    expect(topAt(metrics, 49)).toBe(2);
    expect(topAt(metrics, 50)).toBe(2);
    expect(topRate(metrics, 80)).toBe(1);
  });

  it('is exact on a rank the published five-wide prefix cannot hold', () => {
    // The failure this forbids: reading MRR off `ranked` caps every deep answer at 1/5 = 0.2 and turns a
    // rank-40 answer into a rank-5 one, which raises MRR by 0.175 per case.
    const metrics = computeBoardMetrics([...many(1, 40)], 50);
    expect(metrics.mrr).toBeCloseTo(1 / 40, 12);
    expect(topAt(metrics, 5)).toBe(0);
    expect(topAt(metrics, 40)).toBe(1);
  });

  it('counts a rank deeper than the tabulated ladder as a miss at every rung, not as an absence', () => {
    // The two facts are different and only one of them is a finding about the corpus: a rank-40 answer under a
    // five-rung table is a miss the ladder cannot see, while an unranked answer is a candidate the deduction
    // removed. `absent` stays 0 here, which is what says so.
    const metrics = computeBoardMetrics([...many(1, 40)], 5);
    expect(topAt(metrics, 5)).toBe(0);
    expect(metrics.absent).toBe(0);
    expect(metrics.mrr).toBeCloseTo(1 / 40, 12);
  });
});

describe('avgAtK — the definition the board does not print', () => {
  it('is the mean of Top@1..k, not the hit rate at k', () => {
    // Truth at ranks 1 and 3 of two cases: Top@1 = 0.5, Top@2 = 0.5, Top@3 = 1. Avg@3 is then
    // (0.5 + 0.5 + 1) / 3 = 0.6667. A hit rate at 3 would be 1.0, and the board's own table is never that.
    const metrics = computeBoardMetrics([...many(1, 1), ...many(1, 3)], 5);
    expect(avgAtK(metrics, 1)).toBeCloseTo(0.5, 12);
    expect(avgAtK(metrics, 3)).toBeCloseTo((0.5 + 0.5 + 1) / 3, 12);
    expect(avgAtK(metrics, 5)).toBeCloseTo((0.5 + 0.5 + 1 + 1 + 1) / 5, 12);
  });

  it('is the top rate itself when every published value is equal', () => {
    // MicroHECL's published row: 0.5148 at every depth and an Avg@5 of 0.5148. Under mean-of-Top@j that is
    // forced; under any definition mixing depths it would be a coincidence.
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    expect(avgAtK(metrics, 5)).toBeCloseTo(1, 12);
    expect(avgAtK(metrics, 5)).toBeCloseTo(topRate(metrics, 5), 12);
  });

  it('is below Top@k whenever the head is weaker than the depth, which is the normal shape', () => {
    const metrics = computeBoardMetrics([...many(1, 1), ...many(1, 5)], 5);
    expect(avgAtK(metrics, 5)).toBeLessThan(topRate(metrics, 5));
    expect(avgAtK(metrics, 5)).toBeCloseTo((0.5 + 0.5 + 0.5 + 0.5 + 1) / 5, 12);
  });
});

describe('computeBoardMetrics — refusals', () => {
  it('refuses an empty corpus rather than reporting zero', () => {
    expect(() => computeBoardMetrics([], 5)).toThrow(/no cases/);
  });

  it('refuses a depth that is not a positive integer', () => {
    const verdicts = many(1, 1);
    for (const depth of [0, -1, 1.5, Number.NaN]) {
      expect(() => computeBoardMetrics(verdicts, depth)).toThrow(/depth/);
    }
  });

  it('refuses a row from before the rank column existed, because MRR cannot be re-derived from five', () => {
    const legacy: PerCaseVerdict = {
      datapack: 'c',
      faultType: 'X',
      accepted: ['a'],
      ranked: ['a'],
    };
    expect(() => computeBoardMetrics([legacy], 5)).toThrow(/truthRank/);
  });

  it('refuses a row with no pool, because "ranked ninth" and "not ranked" would read the same', () => {
    const noPool: PerCaseVerdict = {
      datapack: 'c',
      faultType: 'X',
      accepted: ['a'],
      ranked: ['a'],
      truthRank: 1,
    };
    expect(() => computeBoardMetrics([noPool], 5)).toThrow(/pool/);
  });

  it('refuses a rank beyond the pool the row declares', () => {
    expect(() => computeBoardMetrics([row(9, 5, ['a'], ['b'])], 9)).toThrow(/beyond/);
  });

  it('refuses a rank inside the prefix whose service the prefix does not place there', () => {
    // `truthRank` 2 with `ranked` starting `b, c` says the accepted answer is at position 2, and the row's own
    // prefix says a service that is not accepted sits there. One of the two columns came from another order.
    expect(() => computeBoardMetrics([row(2, 10, ['a'], ['b', 'c', 'd', 'e', 'f'])], 5)).toThrow(
      /position 2/,
    );
  });

  it('refuses an empty accepted set, which is a corpus defect and not a miss', () => {
    expect(() => computeBoardMetrics([row(1, 10, [])], 5)).toThrow(/accepted/);
  });

  it('refuses a prefix that names one service twice', () => {
    expect(() => computeBoardMetrics([row(1, 10, ['a'], ['a', 'a', 'b'])], 5)).toThrow(/twice/);
  });
});

describe('RCABENCH_LEADERBOARD — the board, pinned', () => {
  const fse = RCABENCH_LEADERBOARD.benchmarks[0]!;
  const ops = RCABENCH_LEADERBOARD.benchmarks[1]!;

  it('pins the schema, the generation instant and both dataset revisions', () => {
    expect(RCABENCH_LEADERBOARD.schemaVersion).toBe(2);
    expect(RCABENCH_LEADERBOARD.generatedAt).toBe('2026-08-06T09:27:47.557644Z');
    expect(fse.benchmark.datasetRevision).toMatch(/^[0-9a-f]{64}$/);
    expect(ops.benchmark.datasetRevision).toMatch(/^[0-9a-f]{64}$/);
  });

  it('carries twelve entries per board, nine scored over the whole population', () => {
    for (const board of RCABENCH_LEADERBOARD.benchmarks) {
      expect(board.entries).toHaveLength(12);
      expect(board.entries.filter((entry) => entry.scope === 'all')).toHaveLength(9);
      expect(board.entries.filter((entry) => entry.scope === 'test')).toHaveLength(3);
    }
    expect(fse.benchmark.datasetCases).toBe(1422);
    expect(ops.benchmark.datasetCases).toBe(500);
  });

  it('states the population every entry was scored on, so a mixed table cannot be built by accident', () => {
    for (const board of RCABENCH_LEADERBOARD.benchmarks) {
      for (const entry of board.entries) {
        expect(entry.cases).toBe(
          entry.scope === 'all' ? board.benchmark.datasetCases : board.benchmark.testCases,
        );
      }
    }
  });

  it('carries the order the board publishes, which is not its own ranking', () => {
    // The artifact's order is `microdig` first and `microrca` second, and `MicroDig`'s `Top@1` is the LOWER of the
    // two — so the sequence is not a ranking, and a document that re-sorts it is publishing a claim the board did
    // not make. Pinned as data: a later re-read either reproduces this sequence or fails this test.
    expect(fse.entries.map((entry) => entry.displayName).slice(0, 5)).toEqual([
      'MicroDig',
      'MicroRCA',
      'Nezha',
      'SimpleRCA',
      'BARO',
    ]);
    expect(fse.entries[0]!.top1).toBeLessThan(fse.entries[1]!.top1);
    expect(ops.entries[0]!.displayName).toBe('ShapleyIQ');
  });

  it('carries the process-quality counters, because an empty ranking is not a wrong one', () => {
    const baro = fse.entries.find((entry) => entry.algorithm === 'baro')!;
    expect(baro.duplicateRankings).toBe(1421);
    expect(baro.emptyRankings).toBe(1);
    const nezha = fse.entries.find((entry) => entry.algorithm === 'nezha')!;
    expect(nezha.emptyRankings).toBe(127);
    const art = fse.entries.find((entry) => entry.algorithm === 'art')!;
    expect(art.algorithmErrors).toBe(2);
  });
});

describe("the board's own arithmetic decides what Avg@k means", () => {
  /**
   * Every published row implies a `Top@2` and a `Top@4` if — and only if — `Avg@k` is the mean of `Top@1..k`.
   *
   * The board prints `avg@3`, `avg@5`, `top@1`, `top@3` and `top@5` and never prints a definition. The two
   * middles are therefore recoverable: `Top@2 = 3·Avg@3 − Top@1 − Top@3` and
   * `Top@4 = 5·Avg@5 − Top@1 − Top@2 − Top@3 − Top@5`. A cumulative rate is monotone in k, so both implied
   * values must sit between their neighbours. Any other reading of `Avg@k` — the hit rate at k, average
   * precision, precision@k — either contradicts a published `Top@k` outright or fails this bound, and the test
   * reports which.
   */
  it('implies a monotone Top@2 and Top@4 for all twenty-four published rows', () => {
    const checked: string[] = [];
    for (const board of RCABENCH_LEADERBOARD.benchmarks) {
      for (const entry of board.entries) {
        const top2 = 3 * entry.avg3 - entry.top1 - entry.top3;
        const top4 = 5 * entry.avg5 - entry.top1 - top2 - entry.top3 - entry.top5;
        expect(top2, `${entry.displayName} Top@2`).toBeGreaterThanOrEqual(entry.top1 - 1e-9);
        expect(top2, `${entry.displayName} Top@2`).toBeLessThanOrEqual(entry.top3 + 1e-9);
        expect(top4, `${entry.displayName} Top@4`).toBeGreaterThanOrEqual(entry.top3 - 1e-9);
        expect(top4, `${entry.displayName} Top@4`).toBeLessThanOrEqual(entry.top5 + 1e-9);
        expect(entry.avg3, `${entry.displayName} Avg@3 vs Avg@5`).toBeLessThanOrEqual(
          entry.avg5 + 1e-9,
        );
        checked.push(entry.displayName);
      }
    }
    expect(checked).toHaveLength(24);
  });

  it('is falsified by a row whose Avg@5 is its own Top@5, which is the reading this test rejects', () => {
    // Same real row as MicroDig, with `avg5` replaced by `top5`. The implied Top@4 then exceeds Top@5 by
    // construction, so the bound fails — which is what makes the test above a test rather than a tautology.
    const microDig = RCABENCH_LEADERBOARD.benchmarks[0]!.entries.find(
      (entry) => entry.algorithm === 'microdig',
    )!;
    const asHitRate = { ...microDig, avg3: microDig.top3, avg5: microDig.top5 };
    const top2 = 3 * asHitRate.avg3 - asHitRate.top1 - asHitRate.top3;
    expect(top2).toBeGreaterThan(asHitRate.top3 + 1e-9);
  });
});

describe('compareToBoard — the denominator rule, as code', () => {
  const microRca = RCABENCH_LEADERBOARD.benchmarks[0]!.entries.find(
    (entry) => entry.algorithm === 'microrca',
  )!;

  it('differences the five metrics the board publishes against ours on the same population', () => {
    // Ours: every case answered first.
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    const deltas = compareToBoard(metrics, microRca);
    expect(deltas.map((delta) => delta.metric)).toEqual([
      'Top@1',
      'Top@3',
      'Top@5',
      'MRR',
      'Avg@3',
      'Avg@5',
    ]);
    const top1 = deltas[0]!;
    expect(top1.ours).toBeCloseTo(1, 12);
    expect(top1.board).toBeCloseTo(0.5260196905766527, 12);
    expect(top1.deltaPp).toBeCloseTo(47.39803, 4);
    expect(top1.oursCount).toBe(1422);
    expect(top1.boardCount).toBe(748);
  });

  it('refuses a row scored on a different number of cases', () => {
    const metrics = computeBoardMetrics(many(1421, 1), 5);
    expect(() => compareToBoard(metrics, microRca)).toThrow(/1 421 .*1 422|denominator/);
  });

  it('refuses a row scored on the held-out 296, because mixing the scopes is the error the caution names', () => {
    const eadro = RCABENCH_LEADERBOARD.benchmarks[0]!.entries.find(
      (entry) => entry.algorithm === 'eadro',
    )!;
    const metrics = computeBoardMetrics(many(296, 1), 5);
    expect(() => compareToBoard(metrics, eadro)).toThrow(/scope/);
  });
});

describe('compareToBoardBest — the reference is per metric, because the field is not one row', () => {
  const fse = RCABENCH_LEADERBOARD.benchmarks[0]!;
  const whole = fse.entries.filter((entry) => entry.scope === 'all');

  it('names a different holder for different metrics, which is why one row is the wrong reference', () => {
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    const deltas = compareToBoardBest(metrics, whole);
    expect(deltas.map((delta) => [delta.metric, delta.holder])).toEqual([
      ['Top@1', 'MicroRCA'],
      ['Top@3', 'MicroDig'],
      ['Top@5', 'SimpleRCA'],
      ['MRR', 'MicroDig'],
      ['Avg@3', 'MicroDig'],
      ['Avg@5', 'MicroDig'],
    ]);
  });

  it('takes the maximum of the column, not of the table', () => {
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    const deltas = compareToBoardBest(metrics, whole);
    const top5 = deltas.find((delta) => delta.metric === 'Top@5')!;
    // SimpleRCA's 89.45 % is the best `Top@5` on the board and is NOT its best `Top@1` (33.19 %), so a
    // comparison that took the top-1 leader as the reference would report +19.19 pp instead of +10.59 pp here.
    expect(top5.board).toBeCloseTo(0.8945147679324894, 12);
    expect(top5.deltaPp).toBeCloseTo(10.5485232, 6);
  });

  it('refuses an empty field, a held-out row, and a row from another population', () => {
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    expect(() => compareToBoardBest(metrics, [])).toThrow(/no rows/);
    const eadro = fse.entries.find((entry) => entry.algorithm === 'eadro')!;
    expect(() => compareToBoardBest(metrics, [eadro])).toThrow(/scope/);
    const other = { ...whole[0]!, cases: 1419 };
    expect(() => compareToBoardBest(metrics, [other])).toThrow(/denominator/);
  });
});

describe('formatBoardMetrics / formatBoardTable', () => {
  const metrics = computeBoardMetrics([...many(3, 1), ...many(1, 3), ...many(1, 0)], 5);

  it('prints the counts beside the rates at every requested depth', () => {
    const text = formatBoardMetrics(metrics, [1, 3, 5]);
    expect(text).toContain('cases 5');
    expect(text).toContain('Top@1 3 60.00%');
    expect(text).toContain('Top@3 4 80.00%');
    expect(text).toContain('Top@5 4 80.00%');
    expect(text).toContain('absent 1');
  });

  it('prints MRR with its convention in the same line, so the figure cannot be read as a mean over hits', () => {
    const text = formatBoardMetrics(metrics, [1]);
    expect(text).toMatch(/MRR\s+0\.\d+\s+\(1\/rank over all 5 cases, a miss scoring 0\)/);
  });

  it('writes no seconds per case for our row, because the verdict file carries none', () => {
    // The board's column is the algorithm's own `average_algorithm_seconds`. Ours is not in the verdict file, and a
    // `0.0` in that cell would be an absence printed as a measurement — one that reads as infinitely fast.
    const table = formatBoardTable(
      computeBoardMetrics(many(1422, 1), 5),
      RCABENCH_LEADERBOARD.benchmarks[0]!,
    );
    const ours = table.split('\n')[1]!;
    expect(ours.trim().endsWith('\u2014')).toBe(true);
    expect(ours).not.toMatch(/0\.0$/);
  });

  it('lays the board out one row per algorithm with ours first', () => {
    const mine = computeBoardMetrics(many(1422, 1), 5);
    const table = formatBoardTable(mine, RCABENCH_LEADERBOARD.benchmarks[0]!);
    const lines = table.split('\n');
    expect(lines[0]).toContain('algorithm');
    expect(lines[1]).toContain('this engine');
    expect(table).toContain('MicroRCA');
    // Twelve board rows plus a header, ours and a trailing newline: nothing is silently dropped.
    expect(lines.filter((one) => one.trim() !== '')).toHaveLength(14);
    expect(table).toContain('DiagFusion');
    // The population travels with the scope, so the three held-out rows cannot be read as whole-corpus ones.
    expect(table).toContain('test (296)');
    expect(table).toContain('all (1 422)');
  });
});

describe('pairedTopAt', () => {
  /** Four cases, each with a hand-picked pair of ranks, so every cell of the 2 × 2 is reachable by hand. */
  const pair = (): { control: PerCaseVerdict[]; arm: PerCaseVerdict[] } => ({
    control: [row(1, 50), row(3, 50), row(1, 50), row(3, 50)],
    arm: [row(1, 50), row(1, 50), row(2, 50), row(5, 50)],
  });

  /** The same four cases with their datapacks named, so a refusal can name one. */
  const named = (ranks: readonly number[]): PerCaseVerdict[] =>
    ranks.map((rank, index) => ({
      datapack: ['a', 'b', 'c', 'd'][index]!,
      faultType: 'X',
      accepted: ['a'],
      ranked: ['a', 'b', 'c', 'd', 'e'],
      truthRank: rank,
      pool: 50,
    }));

  it('counts a repair, a break and an unchanged case at rank one', () => {
    const { control, arm } = pair();
    const counts = pairedTopAt(
      named(control.map((r) => r.truthRank!)),
      named(arm.map((r) => r.truthRank!)),
      1,
    );
    expect(counts.shared).toBe(4);
    expect(counts.bothRight).toBe(1);
    expect(counts.secondOnly).toBe(1);
    expect(counts.firstOnly).toBe(1);
    expect(counts.delta).toBe(0);
  });

  it('reads a different 2 × 2 at a different rung of the same two files', () => {
    const control = [1, 3, 1, 3];
    const arm = [1, 1, 2, 5];
    const counts = pairedTopAt(named(control), named(arm), 3);
    expect(counts.bothRight).toBe(3);
    expect(counts.firstOnly).toBe(1);
    expect(counts.secondOnly).toBe(0);
    expect(counts.delta).toBe(-1);
  });

  it('refuses a rung that is not a positive integer', () => {
    expect(() => pairedTopAt(named([1]), named([1]), 0)).toThrow(/paired Top@k depth/);
  });

  it('refuses a control row from before the rank columns, naming it', () => {
    const control: PerCaseVerdict[] = [
      { datapack: 'a', faultType: 'X', accepted: ['a'], ranked: ['a', 'b', 'c', 'd', 'e'] },
    ];
    expect(() => pairedTopAt(control, named([1]), 1)).toThrow(
      /control row 1 \(a\) carries no truthRank/,
    );
  });

  it('refuses an arm row from before the rank columns, naming it', () => {
    const arm: PerCaseVerdict[] = [
      { datapack: 'a', faultType: 'X', accepted: ['a'], ranked: ['a', 'b', 'c', 'd', 'e'] },
    ];
    expect(() => pairedTopAt(named([1]), arm, 1)).toThrow(/arm row 1 \(a\) carries no truthRank/);
  });

  it('refuses two files that do not cover the same cases', () => {
    expect(() => pairedTopAt(named([1, 1]), named([1]), 1)).toThrow(/do not cover the same cases/);
  });
});

describe('formatPairedAtDepth', () => {
  /** The LLM arm's own 2 × 2 at rank 1, as the artifact reports it. */
  const head = {
    shared: 1422,
    onlyFirst: 0,
    onlySecond: 0,
    bothRight: 1148,
    firstOnly: 8,
    secondOnly: 179,
    delta: 171,
    pExact: 1e-40,
    pAsymptotic: 1e-40,
  };

  it('prints both counts, both rates, the discordant pair and the exact p', () => {
    expect(formatPairedAtDepth(head, 1, 'control', 'arm')).toBe(
      'Top@1  control 1 156 (81.29%)  -> arm 1 327 (93.32%)  +179 / -8  p exact < 0.001',
    );
  });

  it('prints a rung whose discordant pair is empty as two zeroes rather than dropping the row', () => {
    const still = { ...head, firstOnly: 0, secondOnly: 0, delta: 0, pExact: 1 };
    expect(formatPairedAtDepth(still, 5, 'control', 'arm')).toContain('+0 / -0');
  });

  it('pads a two-digit rung so the columns stay aligned', () => {
    expect(formatPairedAtDepth(head, 10, 'control', 'arm').startsWith('Top@10 control')).toBe(true);
  });
});

describe('formatBoardTable label', () => {
  /** One row of our own, on the board's own population. */
  const metrics = computeBoardMetrics(many(1422, 1), 5);
  const fse = RCABENCH_LEADERBOARD.benchmarks[0]!;

  it('prints the engine by default, which is the name every published table used', () => {
    expect(formatBoardTable(metrics, fse).split('\n')[1]!.startsWith('this engine ')).toBe(true);
  });

  it('prints the row under the name it is given, so an arm is not laid out as the engine', () => {
    const first = formatBoardTable(metrics, fse, 'this engine + the arm').split('\n')[1]!;
    expect(first.startsWith('this engine + the arm')).toBe(true);
    expect(first).toContain('all (1 422)');
  });
});

describe('formatBoardTable column width', () => {
  it('widens the name column to the longest name, so no cell after it moves', () => {
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    const table = formatBoardTable(
      metrics,
      RCABENCH_LEADERBOARD.benchmarks[0]!,
      'this engine + the arm',
    );
    const [header, ours] = table.split('\n');
    expect(header!.indexOf('scope')).toBe(ours!.indexOf('all (1 422)'));
    expect(ours!.startsWith('this engine + the arm all (1 422)')).toBe(true);
  });

  it('keeps the published width when the name is short enough to fit it', () => {
    const metrics = computeBoardMetrics(many(1422, 1), 5);
    const [header, ours] = formatBoardTable(metrics, RCABENCH_LEADERBOARD.benchmarks[0]!).split(
      '\n',
    );
    expect(header!.indexOf('scope')).toBe(ours!.indexOf('all (1 422)'));
  });
});
