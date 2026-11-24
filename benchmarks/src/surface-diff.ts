/**
 * Two surfaces of the same corpus, compared case by case.
 *
 * ## Why this module exists, and what it replaces
 *
 * Every weight change in this programme has been priced on ONE surface: the engine's own Top@1. That is enough to
 * say a candidate is better and not enough to ship it, because the published surface is not the engine's — it is the
 * arm's answer, moved by two local rules (the first hop and the engine-certainty guard) whose inputs include the
 * engine's order. A candidate that repairs three engine cases can therefore leave the published 1 328 untouched, and
 * the only way to know which happened is to run the SAME join twice and subtract.
 *
 * The subtraction is not a detail to be eyeballed from two reports. A repair and a break are different findings: a
 * repair names a case the pipeline can now answer, a break names one it can no longer answer, and a net delta hides
 * both. The two most expensive mistakes in this repository's history were a net figure quoted without its breaks and
 * a denominator quoted without its population, so this module reports the two populations separately, refuses two
 * files whose case sets differ rather than scoring the intersection, and refuses a duplicated id rather than letting
 * the second row overwrite the first.
 *
 * ## Why the folds are assigned here rather than read
 *
 * The published read of a candidate is a held-out one: each fold must be able to disagree with the other. The fold of
 * a case is a function of its fault type and of its position within that family (`foldOf`), and the position is not
 * in any artifact — it is the order the corpus walk produced. Recomputing it here from the sorted ids is the only
 * way two surfaces can be compared on the SAME fold assignment, which is what makes "positive in both folds" a
 * statement about the corpus rather than about the order two files happened to be written in.
 *
 * @module benchmarks/surface-diff
 */

import { foldOf } from './channel-split.js';

/** One case on one surface: the answer the pipeline published, and whether it was accepted. */
export interface SurfaceRow {
  /** The case id, which is what the two files are joined on. */
  readonly datapack: string;
  /** The service the surface answered, or `null` when it declined to answer. */
  readonly answer: string | null;
  /** Whether that answer is in the case's accepted set. The surface's own verdict, not a re-derivation. */
  readonly correct: boolean;
}

/** Which direction a case moved. */
export type FlipKind = 'repair' | 'break';

/** One case whose verdict differs between the two surfaces. */
export interface SurfaceFlip {
  /** The case id. */
  readonly datapack: string;
  /** The answer the first surface published. */
  readonly before: string | null;
  /** The answer the second surface published. */
  readonly after: string | null;
  /** `repair` when the second surface is right where the first was wrong; `break` for the reverse. */
  readonly kind: FlipKind;
}

/** The comparison, with the two populations kept apart. */
export interface SurfaceDiff {
  /** How many cases both surfaces carry. */
  readonly cases: number;
  /** Hits on the first surface. */
  readonly beforeHits: number;
  /** Hits on the second surface. */
  readonly afterHits: number;
  /** Cases that moved from wrong to right, sorted by id. */
  readonly repairs: readonly SurfaceFlip[];
  /** Cases that moved from right to wrong, sorted by id. */
  readonly breaks: readonly SurfaceFlip[];
}

/**
 * The fold a case belongs to, as a function of the corpus.
 *
 * @param faultTypeById - Every case's fault type, which is what `foldOf` hashes.
 * @returns A function that answers the fold of an id it was given and raises on one it was not.
 */
export function foldAssignment(
  faultTypeById: ReadonlyMap<string, string>,
): (datapack: string) => 0 | 1 {
  // Sorted by the default comparator, which is UTF-16 code-unit order — the repository's one order convention. An
  // explicit comparator would carry an equality arm that no caller can reach (the ids are unique), and a branch that
  // cannot be reached is a line no test can measure: the sort is spelled this way so the coverage claim stays honest.
  const ids = [...faultTypeById.keys()].sort();
  const seen = new Map<string, number>();
  const foldById = new Map<string, 0 | 1>();
  for (const id of ids) {
    const faultType = faultTypeById.get(id)!;
    if (faultType === '') {
      throw new Error(`case ${id} has no fault type, so its fold cannot be assigned`);
    }
    const index = seen.get(faultType) ?? 0;
    seen.set(faultType, index + 1);
    foldById.set(id, foldOf(faultType, index));
  }
  return (datapack) => {
    const fold = foldById.get(datapack);
    if (fold === undefined) {
      throw new Error(`case ${datapack} is not in the fold assignment`);
    }
    return fold;
  };
}

/** Raise a refusal that names the line and the field, since a wrong read is silent otherwise. */
function refuse(line: number, field: string, detail: string): never {
  throw new Error(`surface-diff: line ${line} has no usable ${field} — ${detail}`);
}

/**
 * Read one surface row from parsed JSON.
 *
 * Every field is refused rather than defaulted: a missing `correct` read as `false` would score a hit as a miss, and
 * a string `"true"` read as truthy would score a miss as a hit. Neither failure is visible in a count.
 *
 * @param raw - The parsed JSON value.
 * @param line - Its 1-based line number, for the refusal.
 * @returns The row.
 */
export function parseSurfaceLine(raw: unknown, line: number): SurfaceRow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    refuse(line, 'object', `expected a JSON object, got ${describe(raw)}`);
  }
  const record = raw as Record<string, unknown>;
  const datapack = record['datapack'];
  if (typeof datapack !== 'string' || datapack === '') {
    refuse(line, 'datapack', 'expected a non-empty string');
  }
  const answer = record['answer'];
  if (answer !== null && typeof answer !== 'string') {
    refuse(line, 'answer', 'expected a string or null');
  }
  const correct = record['correct'];
  if (typeof correct !== 'boolean') {
    refuse(line, 'correct', 'expected a boolean');
  }
  return { datapack, answer: answer as string | null, correct };
}

/** Render one row as a single line, so the writer owns the separator. */
export function renderSurfaceLine(row: SurfaceRow): string {
  return JSON.stringify({ datapack: row.datapack, answer: row.answer, correct: row.correct });
}

/** A value's type, for a refusal that says what it read instead of only what it wanted. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/** Index a surface by case id, refusing a duplicate rather than letting the last row win. */
function indexOf(rows: readonly SurfaceRow[], which: string): Map<string, SurfaceRow> {
  const index = new Map<string, SurfaceRow>();
  for (const row of rows) {
    if (index.has(row.datapack)) {
      throw new Error(`case ${row.datapack} appears twice in the ${which}`);
    }
    index.set(row.datapack, row);
  }
  return index;
}

/**
 * Compare two surfaces of the same corpus.
 *
 * @param before - The first surface, in any order.
 * @param after - The second surface, in any order.
 * @returns The two hit counts and the two flip populations, each sorted by id.
 */
export function diffSurfaces(
  before: readonly SurfaceRow[],
  after: readonly SurfaceRow[],
): SurfaceDiff {
  const first = indexOf(before, 'first file');
  const second = indexOf(after, 'second file');
  const onlyFirst = [...first.keys()].filter((id) => !second.has(id)).sort();
  const onlySecond = [...second.keys()].filter((id) => !first.has(id)).sort();
  if (onlyFirst.length > 0 || onlySecond.length > 0) {
    // A comparison over the intersection would report a delta on a population neither file states, which is the
    // denominator defect this programme has paid for: the count and the example ids are both printed.
    throw new Error(
      `the two surfaces cover different case sets — ${first.size} in the first file, ${second.size} in the ` +
        `second; only in the first: ${sampleOf(onlyFirst)}; only in the second: ${sampleOf(onlySecond)}`,
    );
  }

  const repairs: SurfaceFlip[] = [];
  const breaks: SurfaceFlip[] = [];
  let beforeHits = 0;
  let afterHits = 0;
  for (const id of [...first.keys()].sort()) {
    const one = first.get(id)!;
    const other = second.get(id)!;
    if (one.correct) beforeHits += 1;
    if (other.correct) afterHits += 1;
    if (one.correct === other.correct) continue;
    const flip: SurfaceFlip = {
      datapack: id,
      before: one.answer,
      after: other.answer,
      kind: other.correct ? 'repair' : 'break',
    };
    (other.correct ? repairs : breaks).push(flip);
  }
  return { cases: first.size, beforeHits, afterHits, repairs, breaks };
}

/** Up to five ids, with the remainder counted, so a refusal stays one readable line. */
function sampleOf(ids: readonly string[]): string {
  if (ids.length === 0) return '(none)';
  const head = ids.slice(0, 5).join(', ');
  return ids.length > 5 ? `${head} … and ${ids.length - 5} more` : head;
}

/**
 * A signed integer, so a delta reads as a movement rather than as a magnitude.
 *
 * Zero carries its sign too: `delta 0` reads as "not measured", while `delta +0` reads as "measured, no movement" —
 * and the whole point of printing a delta beside two populations is that the reader can tell those apart.
 */
function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

/** A rate over a population, with the population stated beside it. */
function rate(hits: number, cases: number): string {
  return cases === 0 ? '0.00 %' : `${((100 * hits) / cases).toFixed(2)} %`;
}

/**
 * Render the comparison.
 *
 * @param diff - The comparison.
 * @param foldOfCase - Optional fold assignment; when given, the delta is also printed per fold, because "positive in
 *   both folds" is the bar a weight change has to clear and a pooled delta cannot show it.
 * @returns The report, without a trailing newline.
 */
export function formatSurfaceDiff(
  diff: SurfaceDiff,
  foldOfCase?: (datapack: string) => 0 | 1,
): string {
  const lines: string[] = [
    `surface diff: ${diff.cases} cases, before ${diff.beforeHits} / ${diff.cases} ` +
      `(${rate(diff.beforeHits, diff.cases)}), after ${diff.afterHits} / ${diff.cases} ` +
      `(${rate(diff.afterHits, diff.cases)}), delta ${signed(diff.afterHits - diff.beforeHits)}`,
    `repairs ${diff.repairs.length}, breaks ${diff.breaks.length}`,
  ];
  if (diff.repairs.length === 0 && diff.breaks.length === 0) {
    lines.push('no case moved');
  } else {
    for (const flip of [...diff.repairs, ...diff.breaks]) {
      lines.push(`${flip.kind} ${flip.datapack}: ${String(flip.before)} -> ${String(flip.after)}`);
    }
  }
  if (foldOfCase !== undefined) {
    for (const fold of [0, 1] as const) {
      const repairs = diff.repairs.filter((flip) => foldOfCase(flip.datapack) === fold).length;
      const breaks = diff.breaks.filter((flip) => foldOfCase(flip.datapack) === fold).length;
      lines.push(`fold ${fold}: delta ${signed(repairs - breaks)} (${repairs} repairs, ${breaks} breaks)`);
    }
  }
  return lines.join('\n');
}
