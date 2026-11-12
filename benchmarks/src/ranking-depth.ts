/**
 * Where the answer sits in the FULL order: the instrument that splits a miss into "ranked too low" and
 * "not ranked at all".
 *
 * ## Why the published five cannot answer this
 *
 * `Top@1` is 75.46 % and `Top@5` is 87.83 % over these 1 422 cases, so 176 misses sit somewhere below the answer
 * the run printed. Every one of the remaining 173 has no accepted service in the reported five at all, and those
 * two families are not the same defect:
 *
 * - **deep** — the graph carries the service and the score put it below five others. A re-ranking can reach it,
 *   and the depth says how much presentation a re-ranker would need (a top-5 fingerprint cannot promote a
 *   candidate it was never shown).
 * - **absent** — no accepted service appears anywhere in the order. No re-ranking, at any width, can recover it;
 *   the loss is upstream of scoring and is a graph, label or extraction question.
 *
 * The distinction decides which axis the next iteration spends on, and it is invisible in every published
 * average. So the runner can write it, per case, as a few hundred bytes: the first-hit depth, the candidate
 * count, and the head of the order with the scores the sort actually used.
 *
 * ## Why the head carries scores and not just names
 *
 * A depth answers "how far down". The margin between the first two scores answers "how close was the ranking to
 * getting it right", which is what a tie-break premise is a claim about: a rule that only fires when two
 * candidates are within a few percent has to be checkable against the margins that actually occur. Writing the
 * names alone would force that check to re-run the engine.
 *
 * ## Why the ladder is cumulative and includes the absent census
 *
 * `recall@K` is monotone by construction, so a non-monotone table is a bug rather than a reading. And the misses
 * at the last rung are exactly the union of "deeper than the ladder" and "absent", which partitions the
 * population — an instrument that reports only one half would make the other look like headroom.
 *
 * @module benchmarks/ranking-depth
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import type { RootCauseResult } from '../../packages/core/src/index.js';

/**
 * The rungs the ladder reports.
 *
 * Five and fewer are the depths a shipped `Top@5` could ever reorder; 8/10/15/20 are the depths a wider
 * presentation would have to carry to matter. Twenty is the widest: a fingerprint of twenty candidates × eight
 * channels is ~6 400 tokens, which is four times the three-round budget `docs/agentic-layer-plan.md` prices, so a
 * case that first appears beyond it is one no bounded presentation can reach.
 */
export const DEPTH_LADDER = [1, 2, 3, 5, 8, 10, 15, 20] as const;

/** The widest rung {@link DEPTH_LADDER} reports, and how much of the order a row carries. */
export const DEPTH_TOP_LIMIT = 20;

/** One case's first-hit depth beside the head of the order that produced it. */
export interface DepthRow {
  /** The case directory's name — the corpus's stable id. */
  readonly datapack: string;
  /** The corpus's fault type for the case. */
  readonly faultType: string;
  /** The accepted services, in the corpus's order and never truncated. */
  readonly accepted: readonly string[];
  /** Zero-based index of the first accepted candidate in the full order, or null when none appears. */
  readonly depth: number | null;
  /** How many candidates the full order carried, so a depth can be read against its own denominator. */
  readonly candidates: number;
  /** The head of the order, best first, as `[serviceId, finalScore]` with null for an unpopulated score. */
  readonly top: readonly (readonly [string, number | null])[];
}

/** One rung of the cumulative ladder. */
export interface LadderStep {
  /** The rung: a case whose depth is below this is a hit. */
  readonly k: number;
  /** Cases whose first accepted candidate is within the first `k`. */
  readonly hits: number;
  /** The population, the same at every rung. */
  readonly cases: number;
  /** `hits / cases`, and `0` on an empty population rather than `NaN`. */
  readonly share: number;
}

/** What a dump wrote, beside the two counts that make a truncated run visible. */
export interface DepthSummary {
  readonly path: string;
  readonly cases: number;
  readonly candidates: number;
  /** Cases with no accepted service anywhere in the order. */
  readonly absent: number;
  /** The deepest first-hit depth written, or null when every case was absent. */
  readonly deepest: number | null;
}

/**
 * Zero-based position of the first accepted candidate in a ranking.
 *
 * @param ranking - The engine's order, best first.
 * @param accepted - The corpus's accepted services for the case.
 * @returns The index of the first accepted candidate, or null when none appears.
 */
export function firstHitDepth(
  ranking: readonly RootCauseResult[],
  accepted: readonly string[],
): number | null {
  const wanted = new Set(accepted);
  for (let index = 0; index < ranking.length; index += 1) {
    if (wanted.has(ranking[index]!.serviceId)) return index;
  }
  return null;
}

/**
 * Render one row as a single JSON line, **without** its newline.
 *
 * Field order is fixed rather than spread, so a diff between two runs is a diff of values.
 *
 * @param row - The case's depth record.
 * @returns The JSON text of one line.
 */
export function formatDepthRow(row: DepthRow): string {
  return JSON.stringify({
    datapack: row.datapack,
    faultType: row.faultType,
    accepted: [...row.accepted],
    depth: row.depth,
    candidates: row.candidates,
    top: row.top.map(([serviceId, score]) => [serviceId, score]),
  });
}

/**
 * The cumulative recall ladder, one step per rung.
 *
 * @param rows - The population's depth rows.
 * @returns One step per {@link DEPTH_LADDER} rung, in ascending order.
 */
export function recallLadder(rows: readonly DepthRow[]): LadderStep[] {
  return DEPTH_LADDER.map((k) => {
    const hits = rows.filter((row) => row.depth !== null && row.depth < k).length;
    const cases = rows.length;
    return { k, hits, cases, share: cases === 0 ? 0 : hits / cases };
  });
}

/**
 * Render the ladder, with the absent census and the count past the widest rung.
 *
 * The two miss families are printed after the ladder because they partition it: `hits@K + beyond@K + absent`
 * is the population at every rung, so a reader can add the line up instead of trusting it.
 *
 * @param rows - The population's depth rows.
 * @returns The table, newline-separated with no trailing newline.
 */
export function formatDepthLadder(rows: readonly DepthRow[]): string {
  const steps = recallLadder(rows);
  const cases = rows.length;
  const widest = DEPTH_TOP_LIMIT;
  const absent = rows.filter((row) => row.depth === null).length;
  const beyond = rows.filter((row) => row.depth !== null && row.depth >= widest).length;
  const percent = (value: number): string =>
    cases === 0 ? '  0.00%' : `${((value / cases) * 100).toFixed(2).padStart(6)}%`;
  const line = (label: string, value: number): string =>
    `  ${label.padEnd(11)}${String(value).padStart(5)}  ${percent(value)}`;
  return [
    `Ranking depth over the full order (cases=${cases}, ladder to @${widest}):`,
    ...steps.map((step) => line(`@${step.k}`, step.hits)),
    line(`beyond@${widest}`, beyond),
    line('absent', absent),
  ].join('\n');
}

/**
 * Append-only writer for the depth rows.
 *
 * Constructing it TRUNCATES the file: a dispatch that ran twice into one path must not read as one run with
 * twice the cases, which is the failure mode an append-only artifact produces — a plausible number rather than
 * an error.
 */
export class DepthDump {
  private caseCount = 0;

  private candidateCount = 0;

  private absentCount = 0;

  private deepestDepth: number | null = null;

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(readonly path: string) {
    writeFileSync(path, '');
  }

  /**
   * Write one case.
   *
   * @param entry - The case, its accepted answers, and the FULL order the engine produced.
   */
  record(entry: {
    readonly datapack: string;
    readonly faultType: string;
    readonly accepted: readonly string[];
    readonly ranking: readonly RootCauseResult[];
  }): void {
    const depth = firstHitDepth(entry.ranking, entry.accepted);
    const top = entry.ranking
      .slice(0, DEPTH_TOP_LIMIT)
      .map((result): readonly [string, number | null] => [
        result.serviceId,
        result.finalScore ?? null,
      ]);
    appendFileSync(
      this.path,
      `${formatDepthRow({
        datapack: entry.datapack,
        faultType: entry.faultType,
        accepted: entry.accepted,
        depth,
        candidates: entry.ranking.length,
        top,
      })}\n`,
    );
    this.caseCount += 1;
    this.candidateCount += entry.ranking.length;
    if (depth === null) this.absentCount += 1;
    else if (this.deepestDepth === null || depth > this.deepestDepth) this.deepestDepth = depth;
  }

  /**
   * What was written. Reported rather than assumed, so a dispatch can state that its artifact carries the cases
   * it claims to.
   *
   * @returns The path and the three counts a reader needs to check the table.
   */
  summary(): DepthSummary {
    return {
      path: this.path,
      cases: this.caseCount,
      candidates: this.candidateCount,
      absent: this.absentCount,
      deepest: this.deepestDepth,
    };
  }
}

/** Refuses a value that is not a non-negative integer, naming the field and line. */
function countAt(value: unknown, field: string, line: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} on line ${line} is not a non-negative integer`);
  }
  return value;
}

/** Refuses a depth that is not null and not a non-negative integer. */
function depthAt(value: unknown, line: number): number | null {
  if (value === null) return null;
  return countAt(value, 'depth', line);
}

/** Refuses an array carrying anything but non-empty strings. */
function stringsAt(value: unknown, field: string, line: number): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    throw new Error(`${field} on line ${line} is not an array of non-empty strings`);
  }
  return value as string[];
}

/** Refuses a head-of-order entry that is not a `[serviceId, score|null]` pair. */
function topAt(value: unknown, line: number): (readonly [string, number | null])[] {
  if (!Array.isArray(value)) throw new Error(`top on line ${line} is not an array`);
  return value.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`top on line ${line} carries an entry that is not a [service, score] pair`);
    }
    const [service, score] = entry as [unknown, unknown];
    if (typeof service !== 'string' || service === '') {
      throw new Error(`top on line ${line} carries a service that is not a non-empty string`);
    }
    if (score !== null && (typeof score !== 'number' || !Number.isFinite(score))) {
      throw new Error(`top on line ${line} carries a score that is neither null nor finite`);
    }
    return [service, score] as const;
  });
}

/**
 * Read a depth dump back.
 *
 * Blank lines are skipped, so a file that ends with a newline is not an error; every other unrecognised shape is
 * refused by line number, because a silently-coerced row would be counted at a different depth than the run
 * recorded and the ladder would be an average over two different questions.
 *
 * @param text - The ndjson contents.
 * @returns One row per non-blank line, in file order.
 * @throws Error when a line is not a row this module would have written.
 */
export function parseDepthDump(text: string): DepthRow[] {
  const rows: DepthRow[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${lineNumber} is not JSON`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`line ${lineNumber} is not an object`);
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.datapack !== 'string' || record.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    rows.push({
      datapack: record.datapack,
      faultType: record.faultType,
      accepted: stringsAt(record.accepted, `accepted on line ${lineNumber}`, lineNumber),
      depth: depthAt(record.depth, lineNumber),
      candidates: countAt(record.candidates, 'candidates', lineNumber),
      top: topAt(record.top, lineNumber),
    });
  }
  return rows;
}

/**
 * Read a depth dump from disk.
 *
 * @param path - The ndjson file.
 * @returns One row per case.
 */
export function readDepthDump(path: string): DepthRow[] {
  return parseDepthDump(readFileSync(path, 'utf8'));
}
