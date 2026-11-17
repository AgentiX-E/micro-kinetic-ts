/**
 * The containment sweep's rows: one JSON line per case, carrying every adjacent pair the sweep examined.
 *
 * ## What this file is for
 *
 * H2 in the iteration-294 pre-registration asks whether the **factorisation residual** of a pair's out-of-band
 * indicators separates a propagating pair from a coincidental one:
 *
 *     ρ(a,b) = P(δa out of band ∧ δb out of band) − P(δa out of band) · P(δb out of band)
 *
 * ρ is a property of an EDGE over many observations, and no artifact this repository writes carries the
 * population it needs. The ranking ndjson records what a case ANSWERED; a pair that was never inverted leaves no
 * trace in an answer, and a pair whose inversion cancelled a later one leaves the trace of the cancellation
 * rather than of the examination. `inspectContainmentOrder` produces exactly the missing rows (iteration 294),
 * and this file is where a run writes them down.
 *
 * ## Why a dump and not a number
 *
 * ρ cannot be computed inside one run without deciding, at write time, what its population is: the residual is
 * an edge statistic, the label ("was this inversion a gain") is a case statistic, and the label only exists once
 * the case's accepted answers are beside it. Writing the rows keeps the two apart, lets the aggregation be a
 * local computation over one artifact, and lets a reader re-aggregate with a different population rule without
 * paying for a second corpus walk.
 *
 * ## Why the label is not in the file
 *
 * For the reason `agentic-fingerprint-file.ts` records: an arm that reads a measurement and a label in one
 * object can condition on the label by accident, and the failure is a suspiciously good number rather than a
 * stack trace. The accepted answers live in the run's per-case verdict file, and the two join on `datapack`.
 *
 * ## The arm difference is recorded, not reconstructed
 *
 * The shipped pass requires the pair's own interface to have carried a failed call (`failingEdges`); the arm
 * iteration 293 refused reads the excursions alone. Both sweeps are pure functions of one fusion order, so both
 * decisions are recorded per pair — and the difference between the two orders is what attributes an arm's move
 * to a pair rather than to a case. Recording only the shipped decision would make the refused arm unmeasurable
 * from the same bytes.
 *
 * @module benchmarks/containment-rows
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

import type { ContainmentDecision } from '../../packages/tree/src/index.js';

/** One adjacent pair that carried a call edge, and what the arm decided about it. */
export interface ContainmentPairRow {
  /** The candidate that sat higher in the arm's order when the pair was examined. */
  readonly upper: string;
  /** The candidate that sat lower. */
  readonly lower: string;
  /** The arm's decision. */
  readonly decision: ContainmentDecision;
  /** The upper candidate's excursion in band widths, when the profile could measure it. */
  readonly upperExcursion?: number | undefined;
  /** The lower candidate's excursion in band widths, when the profile could measure it. */
  readonly lowerExcursion?: number | undefined;
}

/**
 * Whether the observation replayed the production chain.
 *
 * The runner rebuilds the shipped order from the fusion order with the same two passes the pruner runs, and
 * compares the result against the ranking the engine actually published. `identical` is what makes the rows an
 * observation of the decision rather than a second computation near it; `differs` is recorded rather than thrown
 * because a mismatch is a measurement about the instrument, and a run that refused to publish would leave the
 * disagreement unreadable.
 */
export type ContainmentReplay = 'identical' | 'differs' | 'unavailable';

/** One case's sweep rows. */
export interface ContainmentCaseRow {
  /** The case directory's name — the key the per-case verdict file joins on. */
  readonly datapack: string;
  readonly faultType: string;
  /** Band half-width in robust standard deviations the run measured against, so a reader can re-derive. */
  readonly sigma: number;
  /** The margin the run applied, in band widths. `0` is the shipped strict comparison. */
  readonly margin: number;
  /** The first candidate of the fusion order the sweep was given, or `null` when the case had none. */
  readonly fusionTop1: string | null;
  /** The first candidate after the shipped sweep, before the failure-flow pass. */
  readonly gatedTop1: string | null;
  /** The first candidate after the refused arm's sweep, before the failure-flow pass. */
  readonly ungatedTop1: string | null;
  /** The first candidate the engine actually published, for the replay check. */
  readonly shippedTop1: string | null;
  readonly replay: ContainmentReplay;
  /**
   * The shipped arm's sweep: one row per adjacent pair it examined.
   *
   * The two arms' traces are stored SEPARATELY rather than as two decisions on one row, because they are two
   * different walks. The moment one arm inverts a pair the other leaves alone, the two scans are looking at
   * different adjacencies and the next rows describe different pairs — zipping them by index would pair a row
   * with a decision taken about a different pair, and nothing in the file would show it.
   */
  readonly pairs: readonly ContainmentPairRow[];
  /** The refused arm's sweep, over the same fusion order. */
  readonly ungatedPairs: readonly ContainmentPairRow[];
}

/** What a dump wrote, for the run's own log line. */
export interface ContainmentRowsSummary {
  readonly path: string;
  readonly cases: number;
  readonly pairs: number;
  readonly ungatedPairs: number;
  readonly measuredPairs: number;
  readonly inverted: number;
  readonly invertedUngated: number;
  readonly noFailedInterface: number;
  readonly unmeasured: number;
  readonly notLarger: number;
  readonly replayIdentical: number;
  readonly replayDiffers: number;
  readonly replayUnavailable: number;
}

/**
 * A pair row as one JSON object, with the optional excursions PRESENT only when measured.
 *
 * The omission is the point: `{"upperExcursion": null}` would be read as a measurement of zero by every consumer
 * that does arithmetic on it, and the whole register's rule is that an unmeasured side is absent rather than
 * zero. `JSON.stringify` drops `undefined` values, so building the object with conditional spreads is what makes
 * that rule survive the serialisation boundary.
 *
 * @param row - The pair row.
 * @returns The serialisable object.
 */
function pairToJson(row: ContainmentPairRow): Record<string, unknown> {
  return {
    upper: row.upper,
    lower: row.lower,
    decision: row.decision,
    ...(row.upperExcursion === undefined ? {} : { upperExcursion: row.upperExcursion }),
    ...(row.lowerExcursion === undefined ? {} : { lowerExcursion: row.lowerExcursion }),
  };
}

/**
 * Render one case record as a single JSON line, **without** its newline.
 *
 * @param record - The case's sweep rows.
 * @returns The JSON text of one line.
 */
export function formatContainmentRow(record: ContainmentCaseRow): string {
  return JSON.stringify({
    datapack: record.datapack,
    faultType: record.faultType,
    sigma: record.sigma,
    margin: record.margin,
    fusionTop1: record.fusionTop1,
    gatedTop1: record.gatedTop1,
    ungatedTop1: record.ungatedTop1,
    shippedTop1: record.shippedTop1,
    replay: record.replay,
    pairs: record.pairs.map(pairToJson),
    ungatedPairs: record.ungatedPairs.map(pairToJson),
  });
}

/** The census fields, in the order every rendering writes them. */
const SUMMARY_FIELDS = [
  'pairs',
  'ungatedPairs',
  'measuredPairs',
  'inverted',
  'invertedUngated',
  'noFailedInterface',
  'unmeasured',
  'notLarger',
  'replayIdentical',
  'replayDiffers',
  'replayUnavailable',
] as const;

/** The census field each decision adds to. A `Record` over the union, so a new decision fails to compile. */
const DECISION_FIELD: Record<
  ContainmentDecision,
  'inverted' | 'noFailedInterface' | 'unmeasured' | 'notLarger'
> = {
  inverted: 'inverted',
  'no-failed-interface': 'noFailedInterface',
  unmeasured: 'unmeasured',
  'not-larger': 'notLarger',
};

/**
 * Append-only writer for the containment rows.
 *
 * Constructing it TRUNCATES the file, on the rule `TermDump` and `FingerprintDump` record: a dispatch that ran
 * twice into one path must not read as a single run with twice the cases, and the failure would be a plausible
 * number rather than an error.
 */
export class ContainmentRowDump {
  #cases = 0;
  #counts: Record<(typeof SUMMARY_FIELDS)[number], number> = {
    pairs: 0,
    ungatedPairs: 0,
    measuredPairs: 0,
    inverted: 0,
    invertedUngated: 0,
    noFailedInterface: 0,
    unmeasured: 0,
    notLarger: 0,
    replayIdentical: 0,
    replayDiffers: 0,
    replayUnavailable: 0,
  };

  /**
   * @param path - Where the ndjson is written.
   */
  constructor(readonly path: string) {
    writeFileSync(path, '');
  }

  /**
   * Write one case.
   *
   * The census counts DECISIONS rather than rows where it can: a pair contributes exactly one decision per arm,
   * so `inverted + noFailedInterface + unmeasured + notLarger` equals `pairs` for the shipped arm, and a census
   * that did not add up would be the first sign that a decision was dropped on the way out.
   *
   * @param record - The case's sweep rows.
   */
  record(record: ContainmentCaseRow): void {
    appendFileSync(this.path, `${formatContainmentRow(record)}\n`);
    this.#cases += 1;
    for (const pair of record.pairs) {
      this.#counts.pairs += 1;
      if (pair.upperExcursion !== undefined && pair.lowerExcursion !== undefined) {
        this.#counts.measuredPairs += 1;
      }
      this.#counts[DECISION_FIELD[pair.decision]] += 1;
    }
    this.#counts.ungatedPairs += record.ungatedPairs.length;
    for (const pair of record.ungatedPairs) {
      if (pair.decision === 'inverted') this.#counts.invertedUngated += 1;
    }
    if (record.replay === 'identical') this.#counts.replayIdentical += 1;
    else if (record.replay === 'differs') this.#counts.replayDiffers += 1;
    else this.#counts.replayUnavailable += 1;
  }

  /** What was written. */
  get summary(): ContainmentRowsSummary {
    return { path: this.path, cases: this.#cases, ...this.#counts };
  }
}

/** Refuses a value that is not a finite number, naming the field and the line. */
function finiteAt(value: unknown, field: string, line: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${field} on line ${line} is not a finite number: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Refuses a value that is not one of the four decisions. */
function decisionAt(value: unknown, field: string, line: number): ContainmentDecision {
  if (
    value === 'inverted' ||
    value === 'no-failed-interface' ||
    value === 'unmeasured' ||
    value === 'not-larger'
  ) {
    return value;
  }
  throw new Error(`${field} on line ${line} is not a containment decision: ${String(value)}`);
}

/** Refuses a value that is neither `null` nor a non-empty string. */
function serviceAt(value: unknown, field: string, line: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `${field} on line ${line} is neither null nor a service name: ${String(value)}`,
    );
  }
  return value;
}

/** Parses one pair row, refusing a side that is neither measured nor absent. */
function parsePair(raw: unknown, line: number): ContainmentPairRow {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`pair on line ${line} is not an object`);
  const pair = raw as Record<string, unknown>;
  if (typeof pair.upper !== 'string' || pair.upper === '') {
    throw new Error(`pair upper on line ${line} is not a non-empty string`);
  }
  if (typeof pair.lower !== 'string' || pair.lower === '') {
    throw new Error(`pair lower on line ${line} is not a non-empty string`);
  }
  const upperExcursion =
    pair.upperExcursion === undefined
      ? undefined
      : finiteAt(pair.upperExcursion, 'upperExcursion', line);
  const lowerExcursion =
    pair.lowerExcursion === undefined
      ? undefined
      : finiteAt(pair.lowerExcursion, 'lowerExcursion', line);
  if (upperExcursion !== undefined && upperExcursion < 0) {
    throw new Error(`upperExcursion on line ${line} is negative: ${upperExcursion}`);
  }
  if (lowerExcursion !== undefined && lowerExcursion < 0) {
    throw new Error(`lowerExcursion on line ${line} is negative: ${lowerExcursion}`);
  }
  return {
    upper: pair.upper,
    lower: pair.lower,
    decision: decisionAt(pair.decision, 'decision', line),
    ...(upperExcursion === undefined ? {} : { upperExcursion }),
    ...(lowerExcursion === undefined ? {} : { lowerExcursion }),
  };
}

/**
 * Read a dump back.
 *
 * Blank lines are skipped, so a file that ends with a newline is not an error; every other unrecognised shape is
 * refused by line number rather than defaulted. A zero or negative `sigma` is refused too: the excursion is
 * measured in band widths and a band of no width would make every row infinite.
 *
 * @param text - The ndjson contents.
 * @returns One record per non-blank line, in file order.
 * @throws Error when a line is not a record this module would have written.
 */
export function parseContainmentRows(text: string): ContainmentCaseRow[] {
  const records: ContainmentCaseRow[] = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.trim() === '') continue;
    const lineNumber = index + 1;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error(`line ${lineNumber} is not JSON`);
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      throw new Error(`line ${lineNumber} is not an object`);
    const record = raw as Record<string, unknown>;
    if (typeof record.datapack !== 'string' || record.datapack === '') {
      throw new Error(`datapack on line ${lineNumber} is not a non-empty string`);
    }
    if (typeof record.faultType !== 'string') {
      throw new Error(`faultType on line ${lineNumber} is not a string`);
    }
    const sigma = finiteAt(record.sigma, 'sigma', lineNumber);
    if (!(sigma > 0)) throw new Error(`sigma on line ${lineNumber} is not positive: ${sigma}`);
    const replay = record.replay;
    if (replay !== 'identical' && replay !== 'differs' && replay !== 'unavailable') {
      throw new Error(`replay on line ${lineNumber} is not a replay verdict: ${String(replay)}`);
    }
    if (!Array.isArray(record.pairs)) {
      throw new Error(`pairs on line ${lineNumber} is not an array`);
    }
    // The refused arm's trace is REQUIRED rather than optional: an absent one would read as "the arm examined
    // nothing", which is a measurement, while the truth would be that the run did not write it.
    if (!Array.isArray(record.ungatedPairs)) {
      throw new Error(`ungatedPairs on line ${lineNumber} is not an array`);
    }
    records.push({
      datapack: record.datapack,
      faultType: record.faultType,
      sigma,
      margin: finiteAt(record.margin, 'margin', lineNumber),
      fusionTop1: serviceAt(record.fusionTop1, 'fusionTop1', lineNumber),
      gatedTop1: serviceAt(record.gatedTop1, 'gatedTop1', lineNumber),
      ungatedTop1: serviceAt(record.ungatedTop1, 'ungatedTop1', lineNumber),
      shippedTop1: serviceAt(record.shippedTop1, 'shippedTop1', lineNumber),
      replay,
      pairs: record.pairs.map((pair: unknown) => parsePair(pair, lineNumber)),
      ungatedPairs: record.ungatedPairs.map((pair: unknown) => parsePair(pair, lineNumber)),
    });
  }
  return records;
}

/**
 * Read a dump from disk.
 *
 * @param path - The ndjson file.
 * @returns One record per case.
 */
export function readContainmentRows(path: string): ContainmentCaseRow[] {
  return parseContainmentRows(readFileSync(path, 'utf8'));
}
