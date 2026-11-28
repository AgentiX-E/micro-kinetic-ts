/**
 * What a `Top@1` miss is worth, and what it is made of — read from the order alone.
 *
 * ## Why the average cannot answer this
 *
 * `Top@1` is `81.29 %` and `Top@3` is `86.36 %` over the 1 422 RCABench cases, so **72 of the 266 misses sit
 * at rank 2 or 3**. Those are not the same defect as a truth the engine placed 31st, and they are not the same
 * defect as each other: a case whose two top scores differ by half a percent is a TIE-BREAK question, and a case
 * whose winner leads by a third is a MISSING-EVIDENCE question. A corpus average over 1 422 cases cannot carry
 * that distinction, and every plan written off the average has spent an arm on the wrong half.
 *
 * This module is the reading that separates them, and it does so with one rule: **everything it reports is a
 * function of the depth row**, which is the artifact the engine already writes (`--depth-out`). It reads no
 * graph, no label, and no second run, so a number here cannot be an accident of data some other tool happened to
 * load.
 *
 * ## The three questions, and why each is asked this way
 *
 * 1. **How far behind.** `depth` is the zero-based index of the first accepted candidate; this module reports it
 *    as a one-based `rank`, because a reader comparing it to `Top@5` is counting from one.
 * 2. **How far behind in SCORE.** The margin is `(winner - truth) / winner` — against the **truth**, not against
 *    the runner-up. When the truth sits at rank 4 the gap to rank 2 says nothing about the case; the gap to the
 *    answer is the quantity a tie-break rule would have to close. `winner <= 0` makes the ratio meaningless
 *    (a negative denominator flips the sign), so those rows are reported as `unmeasurable` rather than folded in
 *    at zero.
 * 3. **Who wins instead.** A census of the winner's NAME, because the reading a plan needs is not "how many" but
 *    "how few". On this corpus three services account for more than half of the near misses, and a class that
 *    concentrated is a class with a mechanism — which is a different next iteration than a class that is diffuse.
 *
 * ## What this module refuses to be
 *
 * **The winner table is a description, not a feature.** A count of how often one service wins across the corpus
 * is computed WITH the labels of every other case, so it cannot be an input to a per-case operator: a rule that
 * read it would be reading the test set. The table exists to say which mechanism to go and look for, and the
 * documents that consume it must name a per-case observable instead — for the observer class that is the call
 * graph's fan-out, which `docs/topo-closure.md` measured and refused as an aggregate.
 *
 * **The band ceilings are report cut-points, not decision rules.** Nothing in this repository acts on
 * `under-2pct`; the boundaries are round numbers chosen so two runs' tables diff line by line, in the same
 * discipline `ORDINARY_RATE` is held to in `agentic-citation-census.ts`.
 *
 * @module benchmarks/near-miss-census
 */

import { compareCasePaths } from '../../packages/kinetic/src/benchmarks/case-order.js';

import { type DepthRow } from './ranking-depth.js';

/**
 * The ranks a `Top@5` presentation can still repair, as one-based positions.
 *
 * Four and not five: `Top@5` already contains rank 5, so a case whose first accepted candidate is at rank 5 is a
 * `Top@5` HIT and is not a near miss for the published window. The window is `rank <= 5`, which is `depth <= 4`.
 *
 * The upper bound is also the boundary of this module's claim: a case at rank 6 is a case no re-ranking OF THE
 * PUBLISHED FIVE can reach, and folding it in would let a wider presentation's benefit be read as a tie-break's.
 */
export const NEAR_MISS_RANKS = [2, 3, 4, 5] as const;

/** One of {@link NEAR_MISS_RANKS}. */
export type NearMissRank = (typeof NEAR_MISS_RANKS)[number];

/**
 * How far behind the winner the truth's own score was, as a share of the winner.
 *
 * The bands are exhaustive and ordered; {@link marginBand} returns `at-least-20pct` for every margin a firm
 * `>= 0.20` cannot be distinguished from, which includes the unbounded tail.
 *
 * A NEGATIVE margin (the truth outscored the winner) is `unmeasurable` and not a band, because it is not a gap:
 * a sorted order cannot produce one, so the row is a contradiction in the artifact — the same family as a depth
 * that points past its own order. Filing it in the widest band would report a broken row as a case with no
 * tie-break potential, which is a claim about the corpus rather than about the artifact.
 */
export type MarginBand =
  | 'under-1pct'
  | 'under-2pct'
  | 'under-5pct'
  | 'under-10pct'
  | 'under-20pct'
  | 'at-least-20pct'
  | 'unmeasurable';

/**
 * The exclusive upper ceiling of each BOUNDED band.
 *
 * `at-least-20pct` is absent by construction, and that absence is the point: it is the tail, so giving it a
 * ceiling would mean writing `Infinity` and then a `find` whose every term is false, followed by a `??` fallback
 * that no input can reach — a branch nothing measures, which is the shape the de-gamification pass exists to
 * remove. The chain in {@link marginBand} therefore reads the finite ceilings and ends on a `return` that a
 * margin of `0.2` reaches.
 *
 * Written as a record rather than as an if-chain's literals so a new band is a compile error in every consumer
 * instead of a silent fall-through to the last branch — the shape that made the census's own outcome vocabulary
 * misalign when a fifteenth outcome was added (`docs/closed-axes-register.md` §315).
 */
export const MARGIN_BAND_CEILINGS: Readonly<
  Record<Exclude<MarginBand, 'unmeasurable' | 'at-least-20pct'>, number>
> = {
  'under-1pct': 0.01,
  'under-2pct': 0.02,
  'under-5pct': 0.05,
  'under-10pct': 0.1,
  'under-20pct': 0.2,
};

/** The bands in report order, tightest first. */
export const MARGIN_BANDS: readonly MarginBand[] = [
  'under-1pct',
  'under-2pct',
  'under-5pct',
  'under-10pct',
  'under-20pct',
  'at-least-20pct',
  'unmeasurable',
];

/**
 * The tie-break share at which the census calls the near-miss class a TIE-BREAK class rather than a
 * missing-evidence class.
 *
 * A half, and the choice is stated rather than fitted: a tie-break rule can only close a gap that is small
 * relative to the scores it compares, so if most near misses are not small gaps then the axis has nothing to act
 * on and the correct next iteration is evidence rather than arithmetic. Anything at or above a half makes
 * "arithmetic" the reading; below it, "evidence".
 */
export const TIE_BREAK_SHARE = 0.5;

/** One case that `Top@1` missed while `Top@5` held it. */
export interface NearMiss {
  /** The case directory's name — the corpus's stable id. */
  readonly datapack: string;
  readonly faultType: string;
  /** Where the first accepted candidate sits, one-based. Always one of {@link NEAR_MISS_RANKS}. */
  readonly rank: NearMissRank;
  /** The service the engine answered with. */
  readonly winner: string;
  /** The service the engine should have answered with — the first accepted candidate in its own order. */
  readonly truth: string;
  /** `(winner - truth) / winner`, or null when the winner's score makes the ratio meaningless. */
  readonly margin: number | null;
  readonly band: MarginBand;
  /** How many services the corpus accepts for this case; a two-sided fault is a different question. */
  readonly acceptedSize: number;
}

/** One service and how many near misses it wins. */
export interface WinnerCount {
  readonly service: string;
  readonly cases: number;
  /** `cases / nearMisses`, or `0` on an empty population rather than `NaN`. */
  readonly share: number;
}

/** One fault family and how many near misses it contributes, split by the two rank halves. */
export interface FamilyCount {
  readonly faultType: string;
  /** Rank 2: one place away. The population a tie-break is for. */
  readonly rank2: number;
  /** Ranks 3–5: inside the published window but further down. */
  readonly rank3to5: number;
  readonly cases: number;
}

/** The whole reading. */
export interface NearMissCensus {
  /** Every row the artifact carried, the denominator of every share below. */
  readonly cases: number;
  readonly correctAt1: number;
  /** Rows at rank 2–5. */
  readonly nearMisses: readonly NearMiss[];
  /** Rows whose first accepted candidate is deeper than the published five. */
  readonly deeperMisses: number;
  /** Rows with no accepted candidate anywhere in the order. */
  readonly absent: number;
  /**
   * Rows that contradict themselves: a depth inside the order that carries no candidate at that index.
   *
   * Counted rather than skipped, because a silent skip is an instrument that cannot report its own defect — the
   * rule `formatPromotionCensus` learned when a missing census key summed to `NaN` (§315).
   */
  readonly inconsistent: number;
  /** Near misses per rank, in {@link NEAR_MISS_RANKS} order. */
  readonly byRank: readonly { readonly rank: NearMissRank; readonly cases: number }[];
  /** Near misses per margin band, in {@link MARGIN_BANDS} order and including empty bands. */
  readonly byBand: readonly { readonly band: MarginBand; readonly cases: number }[];
  /** Winners, most frequent first, then by name so two runs over one artifact print one table. */
  readonly winners: readonly WinnerCount[];
  /** Families, most frequent first, then by name for the same reason. */
  readonly families: readonly FamilyCount[];
  /** `correctAt1 + nearMisses.length` over the population — the scoreboard a perfect tie-break would print. */
  readonly ceiling: { readonly cases: number; readonly share: number };
  /** Share of near misses at `under-2pct`. */
  readonly tieShare: number;
  /** {@link TIE_BREAK_SHARE}'s verdict for this artifact. */
  readonly verdict: 'tie-break' | 'evidence';
}

/**
 * The band a margin falls in.
 *
 * @param margin - `(winner - truth) / winner`, or null when the ratio was not measurable.
 * @returns The band, never undefined.
 */
export function marginBand(margin: number | null): MarginBand {
  // Three ways a margin is not a gap, and all three are the same answer: no ratio was formed. The third one —
  // a negative margin — is the artifact contradicting its own sort, and it was a live defect in this function's
  // first draft: `-0.3 < 0.01` matched the tightest band, so a broken row read as the strongest possible evidence
  // that the class is a tie-break class.
  if (margin === null || Number.isNaN(margin) || margin < 0) return 'unmeasurable';
  // Read from the ceilings rather than from literals, and `>` rather than `>=`: a margin of exactly one percent is
  // reported in the band the reader will compare it to, so a table's boundary cell is a property of the number
  // rather than of a rounding. Every arm below is reachable, which is what keeps the type from needing a sentinel.
  if (margin < MARGIN_BAND_CEILINGS['under-1pct']) return 'under-1pct';
  if (margin < MARGIN_BAND_CEILINGS['under-2pct']) return 'under-2pct';
  if (margin < MARGIN_BAND_CEILINGS['under-5pct']) return 'under-5pct';
  if (margin < MARGIN_BAND_CEILINGS['under-10pct']) return 'under-10pct';
  if (margin < MARGIN_BAND_CEILINGS['under-20pct']) return 'under-20pct';
  return 'at-least-20pct';
}

/**
 * Read one depth row as a near miss, or null when it is not one.
 *
 * @param row - The depth row.
 * @returns The near miss, or null for a row outside ranks 2–5.
 */
export function toNearMiss(row: DepthRow): NearMiss | null {
  if (row.depth === null || row.depth < 1 || row.depth > 4) return null;
  const winnerEntry = row.top[0];
  const truthEntry = row.top[row.depth];
  // A row whose depth points past its own order is inconsistent, and the census counts it as such rather than
  // minting a near miss whose truth is `undefined`: the population a plan is sized against must not include a
  // case the artifact cannot describe.
  if (winnerEntry === undefined || truthEntry === undefined) return null;
  const winnerScore = winnerEntry[1];
  const truthScore = truthEntry[1];
  // The ratio's denominator must be positive. A winner at or below zero is a score surface this share cannot
  // describe — dividing by it flips every sign — so the row is carried with a null margin instead of a number
  // that reads as a gap and is an artefact of the sign.
  const margin =
    winnerScore !== null && truthScore !== null && winnerScore > 0
      ? (winnerScore - truthScore) / winnerScore
      : null;
  return {
    datapack: row.datapack,
    faultType: row.faultType,
    rank: (row.depth + 1) as NearMissRank,
    winner: winnerEntry[0],
    truth: truthEntry[0],
    margin,
    band: marginBand(margin),
    acceptedSize: row.accepted.length,
  };
}

/**
 * Count a population's near misses and everything read off them.
 *
 * Every count comes from the rows alone, so `correctAt1 + nearMisses + deeperMisses + absent` is the population
 * exactly once. `inconsistent` is the exception and is reported beside them rather than inside the partition,
 * because it is a statement about the artifact instead of about the corpus.
 *
 * @param rows - The population's depth rows.
 * @returns The census.
 */
export function censusNearMisses(rows: readonly DepthRow[]): NearMissCensus {
  const nearMisses: NearMiss[] = [];
  let correctAt1 = 0;
  let deeperMisses = 0;
  let absent = 0;
  let inconsistent = 0;
  for (const row of rows) {
    if (row.depth === null) {
      absent += 1;
      continue;
    }
    if (row.depth === 0) {
      correctAt1 += 1;
      continue;
    }
    if (row.depth > 4) {
      deeperMisses += 1;
      continue;
    }
    const miss = toNearMiss(row);
    if (miss === null) {
      inconsistent += 1;
      continue;
    }
    nearMisses.push(miss);
  }

  const total = nearMisses.length;
  const byRank = NEAR_MISS_RANKS.map((rank) => ({
    rank,
    cases: nearMisses.filter((miss) => miss.rank === rank).length,
  }));

  // Empty bands are carried at zero rather than dropped: a table whose rows depend on the data cannot be
  // compared between two artifacts, and the reader of a tie-heavy corpus needs the tight bands visible even when
  // they are empty.
  const byBand = MARGIN_BANDS.map((band) => ({
    band,
    cases: nearMisses.filter((miss) => miss.band === band).length,
  }));

  const winnerTally = new Map<string, number>();
  for (const miss of nearMisses)
    winnerTally.set(miss.winner, (winnerTally.get(miss.winner) ?? 0) + 1);
  const winners = [...winnerTally.entries()]
    // No `total === 0` guard here, and its absence is a measurement rather than an omission: an entry exists only
    // because one miss incremented it, so `total >= 1` wherever this map body runs. A guard would be a branch no
    // input reaches — the shape the de-gamification pass removes, and the reason `formatCensusRow` keeps the
    // zero-denominator dash at the place a zero CAN occur.
    .map(([service, cases]) => ({ service, cases, share: cases / total }))
    // `compareCasePaths` on the name and not a locale comparison, so the table's order is a property of the
    // corpus rather than of the machine's ICU version — the same rule `summariseFamilies` follows.
    .sort(
      (left, right) => right.cases - left.cases || compareCasePaths(left.service, right.service),
    );

  const familyTally = new Map<string, { rank2: number; rank3to5: number }>();
  for (const miss of nearMisses) {
    const cell = familyTally.get(miss.faultType) ?? { rank2: 0, rank3to5: 0 };
    if (miss.rank === 2) cell.rank2 += 1;
    else cell.rank3to5 += 1;
    familyTally.set(miss.faultType, cell);
  }
  const families = [...familyTally.entries()]
    .map(([faultType, cell]) => ({
      faultType,
      rank2: cell.rank2,
      rank3to5: cell.rank3to5,
      cases: cell.rank2 + cell.rank3to5,
    }))
    .sort(
      (left, right) =>
        right.cases - left.cases || compareCasePaths(left.faultType, right.faultType),
    );

  const tieCases = nearMisses.filter((miss) => miss.band === 'under-2pct').length;
  const ceilingCases = correctAt1 + total;
  return {
    cases: rows.length,
    correctAt1,
    nearMisses,
    deeperMisses,
    absent,
    inconsistent,
    byRank,
    byBand,
    winners,
    families,
    ceiling: { cases: ceilingCases, share: rows.length === 0 ? 0 : ceilingCases / rows.length },
    tieShare: total === 0 ? 0 : tieCases / total,
    // An empty near-miss class has no verdict to give, and `evidence` is the honest default: a rule that acts on
    // arithmetic would be acting on nothing, while the evidence reading asks for an instrument instead of a
    // threshold.
    verdict: total > 0 && tieCases / total >= TIE_BREAK_SHARE ? 'tie-break' : 'evidence',
  };
}

/**
 * Render one near miss as a single JSON line, **without** its newline.
 *
 * Field order is fixed rather than spread, so a diff between two runs is a diff of values — the discipline
 * `formatDepthRow` keeps, and for the same reason: a per-case artifact is quoted in a document, and a reordered
 * key would read as a changed case.
 *
 * @param miss - The near miss.
 * @returns The JSON text of one line.
 */
export function formatNearMissRow(miss: NearMiss): string {
  return JSON.stringify({
    datapack: miss.datapack,
    faultType: miss.faultType,
    rank: miss.rank,
    winner: miss.winner,
    truth: miss.truth,
    margin: miss.margin,
    band: miss.band,
    acceptedSize: miss.acceptedSize,
  });
}

/**
 * One row of the report, padded so two runs' tables diff line by line.
 *
 * Exported because a width is a property of THIS function rather than of the table that calls it: a test can
 * assert the padded length directly instead of scraping the report, which is the difference between pinning an
 * alignment and pinning one rendering of it.
 *
 * `label` is padded to 26 because the longest fault family is `HTTPResponseReplaceMethod` at 25 characters, and
 * `cases` to six because a corpus can exceed 999 999 cases — a column that silently widens by one digit is how a
 * table stops being readable rather than wrong.
 *
 * @param label - The row's name.
 * @param cases - The count.
 * @param whole - The denominator the share is printed against.
 * @param split - Optional `[rank 2, ranks 3–5]` counts, appended as two extra columns for the family table.
 * @returns The row, with no trailing spaces.
 */
export function formatCensusRow(
  label: string,
  cases: number,
  whole: number,
  split?: readonly [number, number],
): string {
  // A `-` and not `0.00%` on an empty denominator: the share does not exist, and printing zero would claim that a
  // population which is not there scored nothing — the same distinction the ladder's `0/0` line keeps.
  const share = whole === 0 ? '     -' : `${((cases / whole) * 100).toFixed(2)}%`.padStart(6);
  const head = `  ${label.padEnd(26)}${String(cases).padStart(6)}  ${share}`;
  return split === undefined
    ? head
    : `${head}   ${String(split[0]).padStart(3)} ${String(split[1]).padStart(3)}`;
}

/**
 * Render the census as one table block, newline-separated with no trailing newline.
 *
 * Every data row goes through {@link formatCensusRow}, so the widths within a section are one decision rather than
 * one per call site. Shares are printed against the population they belong to — the rank rows against all cases,
 * the band and winner rows against the near-miss class — because one denominator for both is the defect that makes
 * a 5 % class look like a 30 % one.
 *
 * @param census - The census.
 * @returns The report text.
 */
export function formatNearMissCensus(census: NearMissCensus): string {
  const total = census.cases;
  const near = census.nearMisses.length;
  const lines: string[] = [
    `Near-miss census over the full order (cases=${total}):`,
    formatCensusRow('correct@1', census.correctAt1, total),
    formatCensusRow('near miss (rank 2-5)', near, total),
    ...census.byRank.map((step) => formatCensusRow(`  rank ${step.rank}`, step.cases, near)),
    formatCensusRow('deeper (rank >= 6)', census.deeperMisses, total),
    formatCensusRow('absent', census.absent, total),
  ];
  // Printed only when non-zero: a line that is always `0` trains a reader to skip the one row that would report a
  // broken artifact, so its absence is the statement that the artifact agreed with itself.
  if (census.inconsistent > 0) {
    lines.push(formatCensusRow('inconsistent', census.inconsistent, total));
  }
  lines.push(
    '',
    'margin of the truth behind the winner, as a share of the winner (of near misses):',
    ...census.byBand.map((step) => formatCensusRow(`  ${step.band}`, step.cases, near)),
    '',
    'the winner, most frequent first (of near misses):',
    ...census.winners.map((entry) => formatCensusRow(`  ${entry.service}`, entry.cases, near)),
    '',
    'family, most frequent first (of near misses; rank 2 | ranks 3-5):',
    ...census.families.map((entry) =>
      formatCensusRow(`  ${entry.faultType}`, entry.cases, near, [entry.rank2, entry.rank3to5]),
    ),
    '',
    `if every near miss became correct: ${census.ceiling.cases}/${total} = ` +
      `${(census.ceiling.share * 100).toFixed(2)}%`,
    `tie share (under-2pct): ${(census.tieShare * 100).toFixed(2)}% — verdict ${census.verdict}`,
  );
  return lines.join('\n');
}
