/**
 * The board's metric contract, computed from a per-case verdict file.
 *
 * ## Why this is a module and not a table in a document
 *
 * `sota-comparison.md` §0c-vii compares this project against the official RCABench leaderboard on `Top@1` and
 * could go no further, because the numbers it had were ones it had typed. The board publishes **six** metrics
 * per algorithm — `Top@1`, `Top@3`, `Top@5`, `MRR`, `Avg@3`, `Avg@5` — and a comparison that fills two cells and
 * leaves four empty is a comparison whose shape was chosen by which columns were cheap to transcribe. Iteration
 * 303 recorded that failure mode once already, in `fse26-per-case.ts`: a reporting width became available to a
 * later argument as a method bound. The cure is the same one: make the numbers an ARTEFACT that is recomputed,
 * so a reader can re-derive every cell from a file they can also re-derive.
 *
 * ## The two things the board does not publish, and how this module settles them
 *
 * **`Avg@k` has no published definition.** The board prints `avg@3` and `avg@5` beside `top@1`, `top@3` and
 * `top@5` and never says what it means. Three readings are plausible — the hit rate at k (which is what this
 * repository's own `computeAvgAtKMultiLabel` computes, and which equals `Top@k`), average precision at k, and the
 * mean of `Top@1..k` — and the board's own arithmetic excludes two of them. Under mean-of-`Top@j` both middles are
 * recoverable: `Top@2 = 3·Avg@3 − Top@1 − Top@3` and `Top@4 = 5·Avg@5 − Top@1 − Top@2 − Top@3 − Top@5`. A
 * cumulative rate is monotone in k, so each implied middle must sit between its neighbours, and **all 24 published
 * rows satisfy all four bounds** (`board-metrics.test.ts` asserts it as data, and asserts that a row with
 * `avg5 = top5` — the hit-rate reading — fails it). Under average precision `Avg@5` could never exceed `MRR`,
 * and `MicroDig`'s `0.7011` against its `MRR` of `0.6361` excludes that too. So `Avg@k` here is the mean of
 * `Top@1..k`, and the choice is stated with the evidence that fixes it rather than assumed.
 *
 * **`MRR`'s denominator is not published either.** This module computes `(1/N)·Σ 1/rank` over every case in the
 * corpus, a miss charging `0` — the standard reading. The alternative (a mean over the cases that were found)
 * would RISE whenever the engine answered less often, which is the one behaviour a rank metric must not reward.
 * The convention is printed on the same line as the value, so a reader cannot take the figure for the other one.
 *
 * ## What the module refuses to do
 *
 * It will not read a rank off the five-wide `ranked` prefix. `truthRank` is the position over the WHOLE order the
 * run computed, and `MRR` read from a prefix caps every deep answer at `1/5 = 0.2`: on this corpus that turns a
 * rank-40 answer into a rank-5 one and raises `MRR` by `0.175` on that case. So a row without `truthRank` and
 * `pool` is refused by line rather than scored, and a row whose two columns disagree — `truthRank` inside the
 * prefix, pointing at a service the prefix does not place there — is refused as a row assembled from two orders.
 *
 * And {@link compareToBoard} refuses a difference across two populations or two scopes. The board scores nine
 * algorithms over all 1 422 cases and three over the held-out 296, and a table that differences the 296 against
 * our 1 422 is the denominator error the section exists to prevent. The refusal is code because the caution was
 * prose, and prose is what rotted.
 *
 * @module benchmarks/board-metrics
 */

import type { PerCaseVerdict } from './fse26-per-case.js';

/** One leaderboard's own metadata: what it scored, on which revision. */
export interface BoardBenchmark {
  /** The board's identifier for the benchmark, as its `data.json` spells it. */
  readonly id: string;
  /** The board's display title. */
  readonly title: string;
  /** Cases the benchmark declares in total. */
  readonly datasetCases: number;
  /** Cases the benchmark puts in its training split. */
  readonly trainCases: number;
  /** Cases the benchmark holds out. */
  readonly testCases: number;
  /** The pinned dataset revision — a sha256 — that makes the population reproducible. */
  readonly datasetRevision: string;
}

/** One algorithm's row, as the board publishes it. */
export interface BoardEntry {
  /** The board's slug for the algorithm. */
  readonly algorithm: string;
  /** The board's display name for the algorithm. */
  readonly displayName: string;
  /** `all` for the whole corpus, `test` for the held-out split. Never mixed in a comparison. */
  readonly scope: 'all' | 'test';
  /** Cases this row was scored on. */
  readonly cases: number;
  /** `Top@1` as a rate. */
  readonly top1: number;
  /** `Top@3` as a rate. */
  readonly top3: number;
  /** `Top@5` as a rate. */
  readonly top5: number;
  /** `MRR` as the mean of `1/rank` over this row's cases. */
  readonly mrr: number;
  /** `Avg@3` — the mean of `Top@1..3`, per the definition recovered above. */
  readonly avg3: number;
  /** `Avg@5` — the mean of `Top@1..5`. */
  readonly avg5: number;
  /** Mean wall-clock seconds per case, the only cost the board publishes. */
  readonly secondsPerCase: number;
  /** Cases the algorithm failed on outright. */
  readonly algorithmErrors: number;
  /** Cases whose ranking carried the same service twice before deduplication. */
  readonly duplicateRankings: number;
  /** Cases the algorithm returned no ranking for; `null` when the row does not carry the counter. */
  readonly emptyRankings: number | null;
}

/** The leaderboard artifact this module pins. */
export interface BoardArtifact {
  /** `schema_version` from the artifact. */
  readonly schemaVersion: number;
  /** `generated_at`, verbatim. */
  readonly generatedAt: string;
  /** Where the artifact was read from, so a re-read is a fetch and not a search. */
  readonly source: string;
  /** The two benchmarks it publishes. */
  readonly benchmarks: readonly {
    readonly benchmark: BoardBenchmark;
    readonly entries: readonly BoardEntry[];
  }[];
}

/**
 * RCABench's official leaderboard, transcribed from `data.json` and pinned by revision.
 *
 * The entry order is **the artifact's order, which is not a ranking**: `MicroDig` comes first on the FSE board
 * and its `Top@1` (`0.5148`) is *below* `MicroRCA`'s (`0.5260`). A document that re-sorts these rows is
 * publishing a claim the board did not make, so the order is preserved here and the sorting happens at the
 * point of presentation, where it is visible.
 */
export const RCABENCH_LEADERBOARD: BoardArtifact = {
  schemaVersion: 2,
  generatedAt: '2026-08-06T09:27:47.557644Z',
  source: 'https://operationspai.github.io/rcabench-leaderboard/data.json',
  benchmarks: [
    {
      benchmark: {
        id: 'fse-rcabench-fault-service-seed42',
        title: 'FSE RCABench',
        datasetCases: 1422,
        trainCases: 1126,
        testCases: 296,
        datasetRevision: '588165081264b3de851b7b3b7ec59d27a5258107ad04c56d8c1c3f2a5ff76da7',
      },
      entries: [
        {
          algorithm: 'microdig',
          displayName: 'MicroDig',
          scope: 'all',
          cases: 1422,
          top1: 0.5147679324894515,
          top3: 0.7489451476793249,
          top5: 0.7848101265822784,
          mrr: 0.6360753912441687,
          avg3: 0.6472105016408815,
          avg5: 0.7011251758087201,
          secondsPerCase: 16.0239,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'microrca',
          displayName: 'MicroRCA',
          scope: 'all',
          cases: 1422,
          top1: 0.5260196905766527,
          top3: 0.6012658227848101,
          top5: 0.709563994374121,
          mrr: 0.6087705211650357,
          avg3: 0.5663384903891234,
          avg5: 0.619268635724332,
          secondsPerCase: 9.6311,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'nezha',
          displayName: 'Nezha',
          scope: 'all',
          cases: 1422,
          top1: 0.5014064697609001,
          top3: 0.70042194092827,
          top5: 0.7151898734177216,
          mrr: 0.5971050164088143,
          avg3: 0.6190811064228785,
          avg5: 0.6575246132208157,
          secondsPerCase: 13.9018,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 127,
        },
        {
          algorithm: 'simplerca',
          displayName: 'SimpleRCA',
          scope: 'all',
          cases: 1422,
          top1: 0.3319268635724332,
          top3: 0.7130801687763713,
          top5: 0.8945147679324894,
          mrr: 0.5410689170182853,
          avg3: 0.5389123300515705,
          avg5: 0.6682137834036567,
          secondsPerCase: 0.8717,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: null,
        },
        {
          algorithm: 'baro',
          displayName: 'BARO',
          scope: 'all',
          cases: 1422,
          top1: 0.4120956399437412,
          top3: 0.5970464135021097,
          top5: 0.6983122362869199,
          mrr: 0.538337625827888,
          avg3: 0.5126582278481013,
          avg5: 0.5791842475386779,
          secondsPerCase: 0.607,
          algorithmErrors: 0,
          duplicateRankings: 1421,
          emptyRankings: 1,
        },
        {
          algorithm: 'microhecl',
          displayName: 'MicroHECL',
          scope: 'all',
          cases: 1422,
          top1: 0.5147679324894515,
          top3: 0.5147679324894515,
          top5: 0.5147679324894515,
          mrr: 0.5147679324894515,
          avg3: 0.5147679324894515,
          avg5: 0.5147679324894515,
          secondsPerCase: 9.5615,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'shapleyiq',
          displayName: 'ShapleyIQ',
          scope: 'all',
          cases: 1422,
          top1: 0.3129395218002813,
          top3: 0.5021097046413502,
          top5: 0.6680731364275668,
          mrr: 0.4614623789678894,
          avg3: 0.40600093764650724,
          avg5: 0.4950773558368494,
          secondsPerCase: 17.9857,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'causalrca',
          displayName: 'CausalRCA',
          scope: 'all',
          cases: 1422,
          top1: 0.17369901547116737,
          top3: 0.36146272855133615,
          top5: 0.45639943741209565,
          mrr: 0.3223587869820737,
          avg3: 0.2876230661040788,
          avg5: 0.349507735583685,
          secondsPerCase: 682.5617,
          algorithmErrors: 0,
          duplicateRankings: 1422,
          emptyRankings: 0,
        },
        {
          algorithm: 'microrank',
          displayName: 'MicroRank',
          scope: 'all',
          cases: 1422,
          top1: 0.1350210970464135,
          top3: 0.3206751054852321,
          top5: 0.45358649789029537,
          mrr: 0.298590778698893,
          avg3: 0.23699015471167373,
          avg5: 0.31167369901547115,
          secondsPerCase: 10.0165,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'eadro',
          displayName: 'Eadro',
          scope: 'test',
          cases: 296,
          top1: 0.09797297297297297,
          top3: 0.2702702702702703,
          top5: 0.40878378378378377,
          mrr: 0.1978603603603605,
          avg3: 0.1801801801801802,
          avg5: 0.2533783783783784,
          secondsPerCase: 3.4964,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'diagfusion',
          displayName: 'DiagFusion',
          scope: 'test',
          cases: 296,
          top1: 0.02027027027027027,
          top3: 0.20945945945945946,
          top5: 0.4358108108108108,
          mrr: 0.1408220720720721,
          avg3: 0.09459459459459459,
          avg5: 0.21216216216216216,
          secondsPerCase: 2.661,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'art',
          displayName: 'ART',
          scope: 'test',
          cases: 296,
          top1: 0.02364864864864865,
          top3: 0.06418918918918919,
          top5: 0.09797297297297297,
          mrr: 0.04740990990990991,
          avg3: 0.0427927927927928,
          avg5: 0.060810810810810814,
          secondsPerCase: 5.2499,
          algorithmErrors: 2,
          duplicateRankings: 0,
          emptyRankings: 2,
        },
      ],
    },
    {
      benchmark: {
        id: 'ops-lite-fault-service-seed42',
        title: 'OPS-Lite',
        datasetCases: 500,
        trainCases: 400,
        testCases: 100,
        datasetRevision: '5d4d3960446408a6e43ea87c51a255aa7a39d43a1db6aeb731cf20b18f4fb7cd',
      },
      entries: [
        {
          algorithm: 'shapleyiq',
          displayName: 'ShapleyIQ',
          scope: 'all',
          cases: 500,
          top1: 0.35,
          top3: 0.592,
          top5: 0.704,
          mrr: 0.5049850382083287,
          avg3: 0.4666666666666666,
          avg5: 0.55,
          secondsPerCase: 10.1466,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'simplerca',
          displayName: 'SimpleRCA',
          scope: 'all',
          cases: 500,
          top1: 0.334,
          top3: 0.532,
          top5: 0.648,
          mrr: 0.4406000000000002,
          avg3: 0.428,
          avg5: 0.5064,
          secondsPerCase: 0.68,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: null,
        },
        {
          algorithm: 'baro',
          displayName: 'BARO',
          scope: 'all',
          cases: 500,
          top1: 0.282,
          top3: 0.412,
          top5: 0.48,
          mrr: 0.36256269461532625,
          avg3: 0.3499999999999999,
          avg5: 0.39719999999999994,
          secondsPerCase: 0.43,
          algorithmErrors: 3,
          duplicateRankings: 383,
          emptyRankings: 43,
        },
        {
          algorithm: 'causalrca',
          displayName: 'CausalRCA',
          scope: 'all',
          cases: 500,
          top1: 0.22,
          top3: 0.358,
          top5: 0.432,
          mrr: 0.33368423757536025,
          avg3: 0.3006666666666667,
          avg5: 0.3456,
          secondsPerCase: 1255.7063,
          algorithmErrors: 0,
          duplicateRankings: 419,
          emptyRankings: 5,
        },
        {
          algorithm: 'nezha',
          displayName: 'Nezha',
          scope: 'all',
          cases: 500,
          top1: 0.248,
          top3: 0.346,
          top5: 0.354,
          mrr: 0.2966666666666667,
          avg3: 0.3086666666666667,
          avg5: 0.3268,
          secondsPerCase: 13.3342,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 102,
        },
        {
          algorithm: 'microrca',
          displayName: 'MicroRCA',
          scope: 'all',
          cases: 500,
          top1: 0.094,
          top3: 0.302,
          top5: 0.464,
          mrr: 0.2649853654060454,
          avg3: 0.20266666666666666,
          avg5: 0.29,
          secondsPerCase: 6.5167,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 4,
        },
        {
          algorithm: 'microrank',
          displayName: 'MicroRank',
          scope: 'all',
          cases: 500,
          top1: 0.076,
          top3: 0.314,
          top5: 0.426,
          mrr: 0.25509136578371133,
          avg3: 0.19733333333333336,
          avg5: 0.2772,
          secondsPerCase: 6.8785,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 24,
        },
        {
          algorithm: 'microhecl',
          displayName: 'MicroHECL',
          scope: 'all',
          cases: 500,
          top1: 0.072,
          top3: 0.182,
          top5: 0.216,
          mrr: 0.1327524531024532,
          avg3: 0.13133333333333333,
          avg5: 0.16319999999999998,
          secondsPerCase: 6.611,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'eadro',
          displayName: 'Eadro',
          scope: 'test',
          cases: 100,
          top1: 0.05,
          top3: 0.17,
          top5: 0.26,
          mrr: 0.11566666666666664,
          avg3: 0.10333333333333335,
          avg5: 0.152,
          secondsPerCase: 1.3442,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'microdig',
          displayName: 'MicroDig',
          scope: 'all',
          cases: 500,
          top1: 0.022,
          top3: 0.126,
          top5: 0.264,
          mrr: 0.10118968253968262,
          avg3: 0.072,
          avg5: 0.1316,
          secondsPerCase: 10.473,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'diagfusion',
          displayName: 'DiagFusion',
          scope: 'test',
          cases: 100,
          top1: 0.01,
          top3: 0.1,
          top5: 0.3,
          mrr: 0.08466666666666667,
          avg3: 0.043333333333333335,
          avg5: 0.11800000000000002,
          secondsPerCase: 1.5542,
          algorithmErrors: 0,
          duplicateRankings: 0,
          emptyRankings: 0,
        },
        {
          algorithm: 'art',
          displayName: 'ART',
          scope: 'test',
          cases: 100,
          top1: 0.05,
          top3: 0.09,
          top5: 0.17,
          mrr: 0.08350000000000002,
          avg3: 0.06666666666666667,
          avg5: 0.10200000000000001,
          secondsPerCase: 3.5344,
          algorithmErrors: 3,
          duplicateRankings: 0,
          emptyRankings: 3,
        },
      ],
    },
  ],
};

/** One engine's contract numbers, accumulated over a verdict file. */
export interface BoardMetrics {
  /** How many cases the file held — the denominator of every rate below. */
  readonly cases: number;
  /** The deepest `k` {@link counts} answers, so `counts[k - 1]` is `Top@k`. */
  readonly maxDepth: number;
  /** `Top@k` as a COUNT, one entry per `k` from 1 to `maxDepth`. */
  readonly counts: readonly number[];
  /** The mean of `1/rank` over every case, a miss charging 0. */
  readonly mrr: number;
  /** Cases whose accepted answer was not in the order at all. */
  readonly absent: number;
  /** The narrowest order the run computed. */
  readonly minPool: number;
  /** The widest order the run computed. */
  readonly maxPool: number;
}

/** One metric, ours beside the board's, differenced on the same population. */
export interface MetricDelta {
  /** The board's name for the metric. */
  readonly metric: string;
  /** This engine's value. */
  readonly ours: number;
  /** The board row's value. */
  readonly board: number;
  /** `ours − board` in percentage points, which is the unit the documents use. */
  readonly deltaPp: number;
  /**
   * This engine's numerator, so the rate can be re-derived.
   *
   * Absent for `Avg@k`: that metric is a mean of rates, so it has no count of cases behind it and writing one
   * would put a number where an absence belongs — the defect this repository's per-case format was built to stop.
   */
  readonly oursCount?: number;
  /** The board row's numerator on the same rule. */
  readonly boardCount?: number;
}

/** Format a count the way every document in this repository spells one. */
function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** Format a rate as a percentage with two decimals. */
function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

/** Refuse a depth that is not a positive integer, naming the value rather than coercing it. */
function depthOf(depth: number, field: string): number {
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error(`${field}: depth must be a positive integer, got ${String(depth)}`);
  }
  return depth;
}

/**
 * Accumulate the board's six metrics from a verdict file.
 *
 * @param verdicts - The rows, in any order. Their `truthRank` is read at the FULL depth of the run, so `Top@k`
 *   and `MRR` are exact for every `k` and not only up to the five-wide published prefix.
 * @param maxDepth - The deepest `k` to tabulate, a positive integer.
 * @returns The counts, the MRR and the pool census.
 * @throws Error when the corpus is empty, a row was written before the rank columns existed, a rank exceeds the
 *   pool the row declares, a rank inside the prefix disagrees with the prefix, an accepted set is empty, or a
 *   prefix names one service twice.
 */
export function computeBoardMetrics(
  verdicts: readonly PerCaseVerdict[],
  maxDepth: number,
): BoardMetrics {
  depthOf(maxDepth, 'maxDepth');
  if (verdicts.length === 0) {
    throw new Error(
      'board metrics: the verdict file held no cases, and an average over none is not zero',
    );
  }
  const counts: number[] = Array.from({ length: maxDepth }, () => 0);
  let reciprocal = 0;
  let absent = 0;
  let minPool = Number.POSITIVE_INFINITY;
  let maxPool = 0;
  for (const [index, verdict] of verdicts.entries()) {
    const where = `row ${index + 1} (${verdict.datapack})`;
    if (verdict.truthRank === undefined) {
      // Not a formatting complaint: a row without `truthRank` was written before the column existed, and its
      // `ranked` is a five-wide prefix. Reading MRR off that prefix caps every deep answer at 0.2.
      throw new Error(
        `${where} carries no truthRank, so its rank is only known to a depth of five`,
      );
    }
    if (verdict.pool === undefined) {
      throw new Error(
        `${where} carries no pool, so "ranked ninth" and "not ranked" would read the same`,
      );
    }
    if (verdict.accepted.length === 0) {
      throw new Error(`${where} has an empty accepted set: that is a corpus defect, not a miss`);
    }
    const seen = new Set<string>();
    for (const service of verdict.ranked) {
      if (seen.has(service)) {
        throw new Error(
          `${where} names ${service} twice in its ranking, so a position is not a position`,
        );
      }
      seen.add(service);
    }
    if (verdict.truthRank > verdict.pool) {
      throw new Error(
        `${where} claims truthRank ${verdict.truthRank} in a pool of ${verdict.pool}, which is beyond its own order`,
      );
    }
    if (verdict.truthRank >= 1 && verdict.truthRank <= verdict.ranked.length) {
      const at = verdict.ranked[verdict.truthRank - 1]!;
      if (!verdict.accepted.includes(at)) {
        throw new Error(
          `${where} says the accepted answer sits at position ${verdict.truthRank} and its own prefix puts ${at} ` +
            'there, so the two columns came from two orders',
        );
      }
    }
    if (verdict.truthRank === 0) {
      absent++;
    } else {
      reciprocal += 1 / verdict.truthRank;
      // A cumulative ladder, climbed once: `Top@k` is monotone by definition, and recomputing each rung from
      // scratch is how two rungs of the same ladder come to disagree. A rank deeper than the table's last rung
      // adds to nothing — it is a miss at every depth tabulated, which is a fact and not an absence.
      if (verdict.truthRank <= maxDepth) {
        for (let depth = verdict.truthRank; depth <= maxDepth; depth++) counts[depth - 1]! += 1;
      }
    }
    minPool = Math.min(minPool, verdict.pool);
    maxPool = Math.max(maxPool, verdict.pool);
  }
  return {
    cases: verdicts.length,
    maxDepth,
    counts,
    mrr: reciprocal / verdicts.length,
    absent,
    minPool,
    maxPool,
  };
}

/** `Top@k` as a count. */
export function topAt(metrics: BoardMetrics, k: number): number {
  return metrics.counts[depthOf(k, `Top@k depth`) - 1]!;
}

/** `Top@k` as a rate over the corpus. */
export function topRate(metrics: BoardMetrics, k: number): number {
  return topAt(metrics, k) / metrics.cases;
}

/**
 * `Avg@k` — the mean of `Top@1..k`.
 *
 * The definition is the one the board's own arithmetic pins (see this module's header), and it is computed from
 * the same counts as `Top@k` so the two can never disagree.
 */
export function avgAtK(metrics: BoardMetrics, k: number): number {
  const depth = depthOf(k, 'Avg@k depth');
  let sum = 0;
  for (let rung = 1; rung <= depth; rung++) sum += topRate(metrics, rung);
  return sum / depth;
}

/**
 * Difference this engine's contract against one board row.
 *
 * @param metrics - Ours, computed by {@link computeBoardMetrics}.
 * @param entry - The board row.
 * @returns Six deltas, in the order the board's own table prints its columns.
 * @throws Error when the row was scored on a different number of cases, or on a different scope.
 */
export function compareToBoard(metrics: BoardMetrics, entry: BoardEntry): readonly MetricDelta[] {
  if (entry.cases !== metrics.cases) {
    throw new Error(
      `board comparison: this run scored ${grouped(metrics.cases)} cases and ${entry.displayName} was scored on ` +
        `${grouped(entry.cases)}. A difference across two populations is a denominator error, not a delta`,
    );
  }
  if (entry.scope !== 'all') {
    throw new Error(
      `board comparison: ${entry.displayName} is scoped to \`${entry.scope}\` (${grouped(entry.cases)} cases), ` +
        'and a held-out split may not be differenced against a whole-corpus run',
    );
  }
  const rows: Array<[string, number, number, number | undefined, number | undefined]> = [
    [
      'Top@1',
      topRate(metrics, 1),
      entry.top1,
      topAt(metrics, 1),
      Math.round(entry.top1 * entry.cases),
    ],
    [
      'Top@3',
      topRate(metrics, 3),
      entry.top3,
      topAt(metrics, 3),
      Math.round(entry.top3 * entry.cases),
    ],
    [
      'Top@5',
      topRate(metrics, 5),
      entry.top5,
      topAt(metrics, 5),
      Math.round(entry.top5 * entry.cases),
    ],
    ['MRR', metrics.mrr, entry.mrr, undefined, undefined],
    ['Avg@3', avgAtK(metrics, 3), entry.avg3, undefined, undefined],
    ['Avg@5', avgAtK(metrics, 5), entry.avg5, undefined, undefined],
  ];
  return rows.map(([metric, ours, board, oursCount, boardCount]) => ({
    metric,
    ours,
    board,
    deltaPp: (ours - board) * 100,
    ...(oursCount === undefined ? {} : { oursCount }),
    ...(boardCount === undefined ? {} : { boardCount }),
  }));
}

/**
 * One metric differenced against the best the FIELD publishes, and who publishes it.
 *
 * A comparison against a single row answers "are we ahead of MicroRCA", which is not the question a leaderboard
 * asks. The board's best `Top@1` is `MicroRCA`, its best `Top@5` is `SimpleRCA` and its best `MRR` is `MicroDig` —
 * three different algorithms — so a delta computed against one of them understates the field on one metric and
 * overstates it on another. This is the same row-level refusal as {@link compareToBoard} with the reference taken
 * per metric, so the reference is the one a reader would find by scanning the column.
 */
export interface FieldDelta extends MetricDelta {
  /** The board row that publishes the best value of this metric on the same population. */
  readonly holder: string;
}

/**
 * Difference this engine against the best published value of each metric, per metric.
 *
 * @param metrics - Ours.
 * @param entries - The board's rows. Every one must be scoped `all` and scored on our population.
 * @returns Six deltas, each naming the row that holds the best value.
 * @throws Error when no row is supplied, when a row scored a different population, or when a row is held-out.
 */
export function compareToBoardBest(
  metrics: BoardMetrics,
  entries: readonly BoardEntry[],
): readonly FieldDelta[] {
  if (entries.length === 0) {
    throw new Error(
      'board comparison: no rows were supplied, so there is no field to compare against',
    );
  }
  for (const entry of entries) {
    if (entry.scope !== 'all') {
      throw new Error(
        `board comparison: ${entry.displayName} is scoped to \`${entry.scope}\` (${grouped(entry.cases)} cases), ` +
          'and a held-out split may not be differenced against a whole-corpus run',
      );
    }
    if (entry.cases !== metrics.cases) {
      throw new Error(
        `board comparison: this run scored ${grouped(metrics.cases)} cases and ${entry.displayName} was scored ` +
          `on ${grouped(entry.cases)}. A difference across two populations is a denominator error, not a delta`,
      );
    }
  }
  const asked: Array<[string, number, (entry: BoardEntry) => number]> = [
    ['Top@1', topRate(metrics, 1), (entry) => entry.top1],
    ['Top@3', topRate(metrics, 3), (entry) => entry.top3],
    ['Top@5', topRate(metrics, 5), (entry) => entry.top5],
    ['MRR', metrics.mrr, (entry) => entry.mrr],
    ['Avg@3', avgAtK(metrics, 3), (entry) => entry.avg3],
    ['Avg@5', avgAtK(metrics, 5), (entry) => entry.avg5],
  ];
  return asked.map(([metric, ours, read]) => {
    const best = entries.reduce((leader, entry) => (read(entry) > read(leader) ? entry : leader));
    return {
      metric,
      ours,
      board: read(best),
      deltaPp: (ours - read(best)) * 100,
      holder: best.displayName,
    };
  });
}

/**
 * Render one engine's contract, one line per fact.
 *
 * @param metrics - Ours.
 * @param depths - The `k` values to tabulate, each a positive integer no deeper than the metrics.
 * @returns The text, ending in a newline.
 */
export function formatBoardMetrics(metrics: BoardMetrics, depths: readonly number[]): string {
  const lines: string[] = [
    `board metrics: cases ${grouped(metrics.cases)}, order ${grouped(metrics.minPool)}-${grouped(metrics.maxPool)} ` +
      `wide, absent ${grouped(metrics.absent)}`,
  ];
  for (const depth of depths) {
    lines.push(
      `  Top@${depth} ${grouped(topAt(metrics, depth))} ${pct(topRate(metrics, depth))}  ` +
        `Avg@${depth} ${pct(avgAtK(metrics, depth))}`,
    );
  }
  lines.push(
    `  MRR ${metrics.mrr.toFixed(4)} (1/rank over all ${grouped(metrics.cases)} cases, a miss scoring 0)`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * Render the comparison as a table: ours first, then every row of the board.
 *
 * The scope column carries the population as well as the scope — `all (1 422)` beside `test (296)` — because the
 * three held-out rows make this a mixed table, and the number a reader must not difference across is the one every
 * published table leaves in a separate caption. There is no separate cases column for the same reason: two places
 * to read the denominator is one place too many.
 *
 * @param metrics - Ours.
 * @param board - The board to lay out.
 * @returns A fixed-width table, one line per algorithm.
 */
export function formatBoardTable(
  metrics: BoardMetrics,
  board: BoardArtifact['benchmarks'][number],
): string {
  const line = (cells: readonly string[]): string =>
    [
      cells[0]!.padEnd(14),
      cells[1]!.padEnd(11),
      cells[2]!.padStart(8),
      cells[3]!.padStart(8),
      cells[4]!.padStart(8),
      cells[5]!.padStart(8),
      cells[6]!.padStart(8),
      cells[7]!.padStart(8),
      cells[8]!.padStart(8),
    ].join(' ');
  const population = (scope: string, cases: number): string => `${scope} (${grouped(cases)})`;
  const rows = [
    // The header is built by the same function as the rows, so a column cannot drift out of alignment when a
    // label changes width — which is how a percentage ends up under the wrong heading.
    line(['algorithm', 'scope', 'Top@1', 'Top@3', 'Top@5', 'MRR', 'Avg@3', 'Avg@5', 's/case']),
    line([
      'this engine',
      population('all', metrics.cases),
      pct(topRate(metrics, 1)),
      pct(topRate(metrics, 3)),
      pct(topRate(metrics, 5)),
      metrics.mrr.toFixed(4),
      pct(avgAtK(metrics, 3)),
      pct(avgAtK(metrics, 5)),
      // NOT a zero: this row's seconds per case are not in the verdict file, and the board's column is the
      // algorithm's own `average_algorithm_seconds`. A `0.0` here would be an absence reported as a measurement —
      // and a flattering one, since it would read as infinitely fast.
      '\u2014',
    ]),
    ...board.entries.map((entry) =>
      line([
        entry.displayName,
        population(entry.scope, entry.cases),
        pct(entry.top1),
        pct(entry.top3),
        pct(entry.top5),
        entry.mrr.toFixed(4),
        pct(entry.avg3),
        pct(entry.avg5),
        entry.secondsPerCase.toFixed(1),
      ]),
    ),
  ];
  return `${rows.join('\n')}\n`;
}
