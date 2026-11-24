/**
 * The retrieval block's instrument.
 *
 * ## What this measures, and why it is a join rather than an experiment
 *
 * 135 of 1 422 cases are answered wrongly on the shipping surface. The question a ranking answer has to ask first is
 * whether the engine ever ranked the truth high enough to be shown: `SEED_WIDTH` is the width such a pipeline would
 * show, so a case whose truth sits at rank 6–44 is beyond it, and no width narrower than that rank can put it in front
 * of a reader. The classification below is computed from two artifacts that were already paid for — the engine's
 * ranked candidates with their scores, and the arm's answers — so the count is reproducible in one command and costs
 * nothing.
 *
 * ## What these classes are NOT, on the shipped configuration
 *
 * They are not a statement about what the model read. The shipped arm is **free**: its artifact carries
 * `seeded: false` on all 1 422 answer rows, so no candidate list was handed to it at all, and the model's evidence is
 * its own tool output. A class read from the engine's rank therefore describes the **pipeline's** reach — what a
 * seeded arm *would* have been shown — and reading it as `the model was shown this and missed it` is a claim about a
 * prompt that never existed. `reachCensusOf` below measures the arm's own reach from the `calls` column, and
 * `formatReachCensus` prints which configuration each reading was taken on, so the two questions cannot be confused
 * silently. The distinction is worth 102 cases: three quarters of the arm's misses never queried the causal service
 * at all, which no seed width describes.
 *
 * ## Why the classes are five and not two
 *
 * "Wrong" hides four different failures, and they need different instruments:
 *
 * * `lost-at-the-rank-one` — the engine was right and the pipeline moved the answer away. That is a **precedence**
 *   question and it is already priced (§331, §332).
 * * `seen-but-lost` — the truth was in the seed and the model did not take it. That is a **reasoning** question.
 * * `retrieval-block` — the truth was never shown. That is a **breadth** question, and it is the only one of the
 *   four that widening the seed can move.
 * * `absent` — the truth is not among the engine's candidates at all. That is a **pool** question, one level below
 *   breadth.
 *
 * A single "misses" number cannot say which of the four a budget would buy, which is why every earlier plan that
 * priced "the misses" over-paid: it averaged four questions into one price.
 *
 * @module benchmarks/retrieval-block
 */

/**
 * The number of candidates a SEEDED pipeline shows the arm.
 *
 * A width an experiment would set, not one the product uses: the shipped arm is free, and its artifact says so on
 * every row (`seeded: false`). Reading this constant as "what the model saw" is the error the module docblock above
 * records, and it is the reason {@link formatReachCensus} prints the seed state beside every reading taken here.
 */
export const SEED_WIDTH = 5;

/** Where a case's truth sits in the engine's own ranking. */
export type MissClass =
  'hit' | 'lost-at-the-rank-one' | 'seen-but-lost' | 'retrieval-block' | 'absent';

/** One case, in the fields this instrument reads. */
export interface RetrievalCase {
  readonly datapack: string;
  /** The labelled services, any of which is a correct answer. */
  readonly truth: readonly string[];
  /** Candidate ids, best first, as the engine ranked them. */
  readonly ranked: readonly string[];
  /** Scores aligned with {@link ranked}; used only for the gap between the top two. */
  readonly scores: readonly number[];
  /** Whether the shipped surface answered this case correctly. */
  readonly correct: boolean;
}

/** The corpus split by where the truth sat. */
export interface RetrievalCensus {
  readonly cases: number;
  readonly hit: number;
  readonly lostAtTheRankOne: number;
  readonly seenButLost: number;
  readonly retrievalBlock: number;
  readonly absent: number;
  /** The misses: every case that is not a hit. */
  readonly misses: number;
  /** The rank of the truth among the misses, ascending; `null` when it was never ranked. */
  readonly ranks: readonly (number | null)[];
}

/**
 * The truth's best rank in the engine's ranking, 1-based, or `null` when no labelled service is a candidate.
 *
 * The BEST rank rather than the first: a multi-service truth is satisfied by any of its names, and a case whose
 * second truth name is rank 3 has been retrieved even if the first is rank 9.
 *
 * @param one - The case.
 * @returns The rank, or `null`.
 */
export function rankOfTruth(one: RetrievalCase): number | null {
  let best: number | null = null;
  for (let index = 0; index < one.ranked.length; index += 1) {
    if (!one.truth.includes(one.ranked[index]!)) continue;
    best = index + 1;
    break;
  }
  return best;
}

/**
 * Which of the four failures a case is, or a hit.
 *
 * @param one - The case.
 * @param seedWidth - How many candidates the arm was shown.
 * @returns The class.
 */
export function classifyMiss(one: RetrievalCase, seedWidth: number = SEED_WIDTH): MissClass {
  if (one.correct) return 'hit';
  const rank = rankOfTruth(one);
  if (rank === null) return 'absent';
  if (rank === 1) return 'lost-at-the-rank-one';
  if (rank <= seedWidth) return 'seen-but-lost';
  return 'retrieval-block';
}

/**
 * Ascending, with an unranked truth after every ranked one.
 *
 * A sentinel integer would sort correctly and would be indistinguishable from a rank of 2^53 − 1, which is the kind of
 * "cannot happen" this programme has already paid for once: the comparator states the order instead.
 *
 * @param a - A rank, or `null` when the truth was never ranked.
 * @param b - A rank, or `null`.
 * @returns The comparison.
 */
function byRank(a: number | null, b: number | null): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * The corpus, split.
 *
 * @param cases - Every case.
 * @param seedWidth - How many candidates the arm was shown.
 * @returns The census.
 */
export function censusRetrieval(
  cases: readonly RetrievalCase[],
  seedWidth: number = SEED_WIDTH,
): RetrievalCensus {
  let hit = 0;
  let lostAtTheRankOne = 0;
  let seenButLost = 0;
  let retrievalBlock = 0;
  let absent = 0;
  const ranks: (number | null)[] = [];
  for (const one of cases) {
    const kind = classifyMiss(one, seedWidth);
    if (kind === 'hit') hit += 1;
    else {
      ranks.push(rankOfTruth(one));
      if (kind === 'lost-at-the-rank-one') lostAtTheRankOne += 1;
      else if (kind === 'seen-but-lost') seenButLost += 1;
      else if (kind === 'retrieval-block') retrievalBlock += 1;
      else absent += 1;
    }
  }
  ranks.sort(byRank);
  return {
    cases: cases.length,
    hit,
    lostAtTheRankOne,
    seenButLost,
    retrievalBlock,
    absent,
    misses: cases.length - hit,
    ranks,
  };
}

/** One row of the widening curve. */
export interface WideningRow {
  readonly width: number;
  /** Cases whose truth is visible at this width, over the whole corpus. */
  readonly visible: number;
  /** Misses whose truth becomes visible at this width. */
  readonly missesCovered: number;
}

/**
 * How many misses a wider seed would put in front of the model.
 *
 * The curve is a property of the engine's ranking and the labels, so it says what breadth BUYS and never what the
 * model would do with it: a case that becomes visible is a case the model has a chance at, not a case it wins.
 *
 * @param cases - Every case.
 * @param widths - The widths to read, ascending; each must be at least one.
 * @returns One row per width.
 */
export function wideningCurve(
  cases: readonly RetrievalCase[],
  widths: readonly number[],
): WideningRow[] {
  return widths.map((width) => {
    let visible = 0;
    let missesCovered = 0;
    for (const one of cases) {
      const rank = rankOfTruth(one);
      if (rank === null || rank > width) continue;
      visible += 1;
      if (!one.correct) missesCovered += 1;
    }
    return { width, visible, missesCovered };
  });
}

/** One row of the separability sweep. */
export interface GapRow {
  readonly threshold: number;
  /** Cases the threshold fires on. */
  readonly fires: number;
  /** Of those, the ones that are retrieval blocks. */
  readonly captured: number;
  /** `captured / fires`, or `0` when the threshold fires on nothing. */
  readonly precision: number;
  /** `captured / retrievalBlock`, or `0` when the corpus holds none. */
  readonly recall: number;
}

/**
 * Whether the gap between the top two candidates identifies a retrieval block.
 *
 * The bar is the only thing a DEPLOYED pipeline can read: it knows the engine's scores and not the truth. So a
 * widening rule has to be stated as "when the engine's own ranking is undecided, show it more", and this sweep prices
 * that sentence — what fraction of the corpus it touches against what fraction of the block it reaches.
 *
 * @param cases - Every case.
 * @param thresholds - The gaps to read, ascending.
 * @param seedWidth - How many candidates the arm was shown.
 * @returns One row per threshold.
 */
export function gapSeparability(
  cases: readonly RetrievalCase[],
  thresholds: readonly number[],
  seedWidth: number = SEED_WIDTH,
): GapRow[] {
  let block = 0;
  for (const one of cases) if (classifyMiss(one, seedWidth) === 'retrieval-block') block += 1;
  return thresholds.map((threshold) => {
    let fires = 0;
    let captured = 0;
    for (const one of cases) {
      if (one.scores.length < 2) continue;
      const gap = one.scores[0]! - one.scores[1]!;
      if (gap > threshold) continue;
      fires += 1;
      if (classifyMiss(one, seedWidth) === 'retrieval-block') captured += 1;
    }
    return {
      threshold,
      fires,
      captured,
      precision: fires === 0 ? 0 : captured / fires,
      recall: block === 0 ? 0 : captured / block,
    };
  });
}

/** The report, as one string so a caller cannot print half of it. */
export function formatRetrievalReport(
  census: RetrievalCensus,
  widening: readonly WideningRow[],
  gaps: readonly GapRow[],
  seedWidth: number = SEED_WIDTH,
): string {
  const share = (part: number, whole: number): string =>
    whole === 0 ? '0.00' : ((100 * part) / whole).toFixed(2);
  const lines: string[] = [];
  lines.push(
    `the corpus: ${census.cases} cases, ${census.hit} hits, ${census.misses} misses ` +
      `(seed width ${seedWidth})`,
  );
  lines.push(
    `  lost at the rank one ${census.lostAtTheRankOne}, seen but lost ${census.seenButLost}, ` +
      `retrieval block ${census.retrievalBlock}, absent ${census.absent}`,
  );
  lines.push('');
  lines.push('what breadth buys -- truth visible at each width');
  lines.push('  width  visible  misses covered');
  for (const row of widening) {
    lines.push(
      `  ${String(row.width).padStart(5)}  ${String(row.visible).padStart(7)}  ${String(row.missesCovered).padStart(14)}`,
    );
  }
  lines.push('');
  lines.push('what a deployed rule can see -- the gap between the top two candidates');
  lines.push('  threshold   fires  captured  precision  recall');
  for (const row of gaps) {
    lines.push(
      `  ${row.threshold.toFixed(3).padStart(9)}  ${String(row.fires).padStart(5)}  ` +
        `${String(row.captured).padStart(8)}  ${row.precision.toFixed(3).padStart(9)}  ` +
        `${row.recall.toFixed(3).padStart(6)}`,
    );
  }
  const block = census.retrievalBlock;
  lines.push('');
  lines.push(
    `the block is ${block} of ${census.misses} misses (${share(block, census.misses)} %), and it is the only ` +
      'one of the four a wider seed can reach',
  );
  return lines.join('\n');
}

// ── What the arm itself looked at ──

/**
 * One answer row, in the fields the reach census reads.
 *
 * The `calls` and `seeded` columns are the arm's own record of its investigation, and both are `null`-able on
 * purpose: an artifact written before a column existed does not make the reading zero, it makes it unmeasured.
 */
export interface ArmAnswer {
  /** Stable case id, carried so a refusal can name the row that produced it. */
  readonly datapack: string;
  /** The labelled services, any of which is a correct answer. */
  readonly truth: readonly string[];
  /** The services whose telemetry the arm queried, or `null` when the artifact does not record them. */
  readonly calls: readonly string[] | null;
  /** Whether the shipped surface answered the case correctly. */
  readonly correct: boolean;
  /** The artifact's own `seeded` flag, or `null` when it does not record one. */
  readonly seeded: boolean | null;
}

/**
 * The arm's own reach, over the answers it wrote.
 *
 * The three miss buckets are disjoint and exhaustive, which is the whole point: `queried` is a case the arm
 * investigated the causal service for and still got wrong, `unqueried` is a case it never looked at, and `unrecorded`
 * is a case whose artifact carries no call column. Collapsing the second into the first would report an absence as a
 * measurement; collapsing the third into either would report a population that was never seen.
 */
export interface ReachCensus {
  /** Answer rows read. */
  readonly cases: number;
  /** Rows whose `seeded` flag is `true` — the configuration this reading was taken on. */
  readonly seeded: number;
  /** Rows the surface answered correctly. */
  readonly hits: number;
  /** Rows it did not: `cases − hits`. */
  readonly misses: number;
  /** Misses whose truth the arm queried at least once. */
  readonly queried: number;
  /** Misses whose truth it never queried. */
  readonly unqueried: number;
  /** Misses with no `calls` column at all. */
  readonly unrecorded: number;
  /** Hits whose truth the arm queried — the control that keeps `queried` from being a constant. */
  readonly hitsQueried: number;
}

/**
 * Count what the arm looked at.
 *
 * @param answers - Every answer row.
 * @returns The census.
 */
export function reachCensusOf(answers: readonly ArmAnswer[]): ReachCensus {
  let seeded = 0;
  let hits = 0;
  let queried = 0;
  let unqueried = 0;
  let unrecorded = 0;
  let hitsQueried = 0;
  for (const one of answers) {
    if (one.seeded === true) seeded += 1;
    const asked = one.calls === null ? null : one.calls.some((name) => one.truth.includes(name));
    if (one.correct) {
      hits += 1;
      if (asked === true) hitsQueried += 1;
      continue;
    }
    if (asked === null) unrecorded += 1;
    else if (asked) queried += 1;
    else unqueried += 1;
  }
  return {
    cases: answers.length,
    seeded,
    hits,
    misses: answers.length - hits,
    queried,
    unqueried,
    unrecorded,
    hitsQueried,
  };
}

/**
 * Render the reach census, with the configuration it was read on.
 *
 * The share is over the CLASSIFIABLE misses rather than over all of them, and the line names that denominator, because
 * a percentage over a population of which part was never recorded is the defect this file's guard census was
 * introduced to stop.
 *
 * @param census - The census.
 * @returns Two or three lines.
 */
export function formatReachCensus(census: ReachCensus): string {
  const { cases, seeded, hits, misses, queried, unqueried, unrecorded, hitsQueried } = census;
  if (cases === 0) return 'arm reach: 0 cases';
  const classifiable = misses - unrecorded;
  const share = classifiable === 0 ? '0.00' : ((100 * unqueried) / classifiable).toFixed(2);
  const absent =
    unrecorded === 0
      ? ''
      : `, and ${String(unrecorded)} ${unrecorded === 1 ? 'row carries' : 'rows carry'} no call column`;
  const lines = [
    `arm reach: ${String(cases)} answers, ${String(hits)} hits (${String(hitsQueried)} of them queried the truth), ` +
      `${String(misses)} misses`,
    `  never queried the causal service: ${String(unqueried)} / ${String(classifiable)} classifiable misses ` +
      `(${share} %); the other ${String(queried)} queried it and still missed${absent}`,
  ];
  if (seeded === 0) {
    lines.push(
      "  the arm is free on every row (`seeded: false`), so the seed classes describe the PIPELINE's reach and not " +
        'what the model read',
    );
  } else if (seeded === cases) {
    lines.push(
      `  the arm was seeded on ${String(seeded)} of ${String(cases)} rows, so the seed classes describe what it was shown`,
    );
  } else {
    lines.push(
      `  the arm was seeded on ${String(seeded)} of ${String(cases)} rows: the seed classes describe two ` +
        'configurations at once',
    );
  }
  return lines.join('\n');
}
