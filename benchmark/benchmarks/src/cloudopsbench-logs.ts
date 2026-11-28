/**
 * The Cloud-OpsBench log bridge — the artefact the corpus has and this repository said it did not.
 *
 * `cloudopsbench-suite.ts` declares, in a comment a reader would take as a census, that this corpus "publishes a
 * metric table and an anomaly window" and carries no log. Iteration 372 counted the corpus instead:
 * **`raw_data/logs.json` exists in 754 of 754 case directories**, 2.41 GB in total, and it is the only evidence the
 * 584 cases without `metrics.csv` have. The declaration was wrong, and it was wrong in the direction that made the
 * log channel silent on a corpus whose own labels are log-first.
 *
 * ## The two facts that make this a bridge rather than a `JSON.parse`
 *
 * **1. The shape is not one shape.** Four forms share the file, and they differ inside one case:
 *
 * | form | example | count over the corpus |
 * | --- | --- | ---: |
 * | prefix + log4j JSON | `2026-05-18T21:54:34.027884427+08:00 {"instant":{"epochSecond":1779112473,…}}` | 1 539 |
 * | prefix + service JSON | `2026-05-18T21:54:28.430462584+08:00 {"severity":"info","message":"Profiler disabled."}` | ~24 000 |
 * | prefix + plain text | `2026-05-18T21:54:30.825153680+08:00 info: Microsoft.Hosting.Lifetime[14]` | ~2 900 |
 * | bare text with its own stamp | `2026-05-18T13:54:27.193748Z\tinfo\tFLAG: --concurrency="0"` | ~700 |
 *
 * and, on TrainTicket, the value is a single newline-joined **string** rather than a list — 22 421 service entries
 * are strings and 8 206 are lists, so a reader that assumed one would return nothing on a whole system.
 *
 * **2. The clock is offset by eight hours, and the offset is invisible.** `alert.json` states
 * `2026-05-18 21:57:32`, and `metrics.csv` states `2026-05-18 21:55:47`: both are UTC+8 wall-clock readings that
 * `readTimeCell` parses as UTC, so the metric path is self-consistent. Every log stamp states a **real instant** —
 * `+08:00` in the prefix, `Z` on the proxy lines, `epochSecond` in log4j — so parsed naively it lands eight hours
 * BEFORE the window the engine filters against, every line is dropped by `log.timestamp < injectTimeMs`, the log
 * signal reads zero, and nothing reports it. Measured over the 156 scorable cases: the median gap between the log
 * stamps and the alert window is **-7.99 h** (88 codedefect, 29 performance, 47 trainticket-performance), which is
 * what {@link CORPUS_WALL_CLOCK_OFFSET_MS} adds back.
 *
 * The offset is a declared constant and not an inferred per-case shift because the inference is measurable and
 * wrong: four TrainTicket cases carry 1–7 log lines that sit 45 min before their own window, and one
 * (`trainticket/performance/23`) states an alert window a day after its logs. A median-shift reader would move
 * those four onto the window and manufacture evidence; a constant leaves them where the corpus put them, and
 * {@link LogCensus.beforeWindow} counts them so the reader can see it.
 *
 * @module benchmarks/src/cloudopsbench-logs
 */

import { existsSync, readFileSync } from 'node:fs';

import {
  isHttpExceptionMessage,
  isLogicExceptionMessage,
} from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import type { BenchmarkLogEntry } from '../../packages/kinetic/src/benchmarks/loaders/types.js';

/**
 * The corpus's wall clock, as an offset to ADD to a real instant to reach the axis `alert.json` states.
 *
 * `+08:00`, because the corpus was collected in UTC+8: `alert.json` states `21:57:32` for an event whose log
 * stamps — `21:57:32+08:00`, `13:57:32Z`, `epochSecond 1789… ` all three — land on `13:57:32 UTC`. Adding this
 * to the parsed instant reproduces the wall clock `readTimeCell` produces, which is the only axis the engine's
 * `injectTimeMs` is expressed in.
 */
export const CORPUS_WALL_CLOCK_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The five levels `BenchmarkLogEntry` admits. */
export type CorpusLogLevel = BenchmarkLogEntry['level'];

/** An ISO-8601 instant followed by the rest of the line, which is how two of the four forms begin. */
const PREFIXED_INSTANT = /^\s*(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))\s+([\s\S]*)$/;

/** `severity`/`level` words as the corpus writes them, lower- or upper-case. */
const LEVEL_WORDS: ReadonlyMap<string, CorpusLogLevel> = new Map([
  ['trace', 'DEBUG'],
  ['debug', 'DEBUG'],
  ['info', 'INFO'],
  ['information', 'INFO'],
  ['notice', 'INFO'],
  ['warn', 'WARN'],
  ['warning', 'WARN'],
  ['error', 'ERROR'],
  ['err', 'ERROR'],
  ['fatal', 'FATAL'],
  ['critical', 'FATAL'],
  ['crit', 'FATAL'],
  ['panic', 'FATAL'],
]);

/**
 * One log line, before it is known which service it belongs to.
 *
 * `null` for the timestamp is a real state — a bare `Error: …` line inside a list carries no stamp — and it is
 * resolved by inheritance from the previous line of the SAME service, never from another service: the corpus
 * interleaves services, so a cross-service carry would date one service's line with another's clock.
 */
export interface RawLogLine {
  /**
   * The instant the line states, in Unix milliseconds on the instant's own axis, or `null` when it states none.
   *
   * Deliberately NOT the corpus wall clock: this parser knows nothing about how the corpus was collected, and the
   * offset is applied once, in {@link parseLogsJson}, so a reader of one line can compare it with the ISO string it
   * came from.
   */
  readonly timestampMs: number | null;
  readonly message: string;
  readonly level: CorpusLogLevel;
}

/**
 * A line whose instant is KNOWN — what {@link LogsParse} carries, as distinct from what {@link parseLogLine}
 * returns.
 *
 * The distinction is the point of the type: a bridge that carried `timestampMs | null` past the inheritance step
 * would need a `?? 0` at every consumer, and an epoch-zero stamp is before every window — so the line would be
 * silently dropped by the engine's filter rather than refused by the bridge.
 */
export interface DatedLogLine {
  readonly timestampMs: number;
  readonly message: string;
  readonly level: CorpusLogLevel;
}

/** What one `logs.json` yielded. */
export interface LogsParse {
  /** Lines per service, in file order, timestamps already resolved by inheritance. */
  readonly byService: ReadonlyMap<string, readonly DatedLogLine[]>;
  /** Lines read, before inheritance dropped an undatable one. */
  readonly rows: number;
  /** Lines that carried no stamp and had no earlier stamped line in their own service. Counted, never guessed. */
  readonly undated: number;
}

/** A parse outcome: the table, or the field that refused it. */
export type LogsRead =
  | { readonly ok: true; readonly value: LogsParse }
  | { readonly ok: false; readonly reason: string };

/**
 * Read one epoch value whose unit the corpus does not state.
 *
 * `currencyservice` writes `"time": 1779112468429` (milliseconds) and `emailservice` writes
 * `"timestamp": 1779112471.8259418` (seconds). Both are the same instant, and a reader that assumed one unit dates
 * half the corpus in 1970 or in the year 58 000. The threshold is 1e11: a millisecond value for any instant after
 * 1973 exceeds it and a second value for any instant before 5138 does not, so the test separates the two by four
 * orders of magnitude rather than by a guess about which service wrote the line.
 *
 * @param value - The numeric field.
 * @returns Wall-clock milliseconds, or `null` when the value is not a plausible instant.
 */
export function epochFieldToMs(value: number): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const ms = value > 1e11 ? value : value * 1000;
  // The corpus spans 2025–2026; anything outside 2001–2100 is a unit a reader guessed wrong, and returning it
  // would put the line on the wrong side of every injection window.
  if (ms < 978_307_200_000 || ms > 4_102_444_800_000) return null;
  return ms;
}

/**
 * Read the level a line states, or `INFO` when it states none.
 *
 * `INFO` rather than an error: a plain business line (`Order Create Fail`) is information about traffic and the two
 * signals that read logs both filter on `ERROR`/`FATAL`, so the default cannot manufacture a vote.
 *
 * @param word - The `severity`/`level` field, already stringified.
 * @returns The level.
 */
export function levelOf(word: string | undefined): CorpusLogLevel {
  if (word === undefined) return 'INFO';
  return LEVEL_WORDS.get(word.trim().toLowerCase()) ?? 'INFO';
}

/**
 * Parse one log line of any of the four forms.
 *
 * The precedence is stated rather than incidental: the **prefix** wins, because it is the only stamp the collector
 * wrote for every line of that form and the JSON body may repeat it with less precision; then `instant.epochSecond`
 * (log4j); then a numeric `time`/`timestamp`; then an ISO `timestamp` string.
 *
 * @param line - One element of a service's list, or one line of its newline-joined string.
 * @returns The line, with `timestampMs: null` when it states no instant.
 */
export function parseLogLine(line: string): RawLogLine {
  const prefixed = PREFIXED_INSTANT.exec(line);
  const body = prefixed === null ? line : prefixed[2]!;
  const prefixedMs = prefixed === null ? null : Date.parse(prefixed[1]!);
  const stamp = prefixedMs === null || Number.isNaN(prefixedMs) ? null : prefixedMs;

  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    let parsed: Record<string, unknown> | null = null;
    try {
      const raw = JSON.parse(trimmed) as unknown;
      if (typeof raw === 'object' && raw !== null) parsed = raw as Record<string, unknown>;
    } catch {
      // A body that announces itself as JSON and is not is text: the message is the line, and the prefix (when
      // there is one) still dates it. Refusing here would drop a line the corpus wrote.
    }
    if (parsed !== null) {
      const instant = parsed.instant as Record<string, unknown> | undefined;
      const instantMs =
        typeof instant?.epochSecond === 'number'
          ? epochFieldToMs(instant.epochSecond) === null
            ? null
            : instant.epochSecond * 1000 +
              // FLOOR and not round, so this reader agrees with `Date.parse` on the same instant: the prefix form
              // states `…034.027884427`, which `Date.parse` truncates to 027 ms, and an `instant` holding the same
              // nanosecond count must not land one millisecond later than the line beside it.
              (typeof instant.nanoOfSecond === 'number'
                ? Math.floor(instant.nanoOfSecond / 1e6)
                : 0)
          : null;
      const numericMs =
        typeof parsed.time === 'number'
          ? epochFieldToMs(parsed.time)
          : typeof parsed.timestamp === 'number'
            ? epochFieldToMs(parsed.timestamp)
            : null;
      const isoMs =
        typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN;
      const own = stamp ?? instantMs ?? numericMs ?? (Number.isNaN(isoMs) ? null : isoMs);
      const message = typeof parsed.message === 'string' ? parsed.message : trimmed;
      const level = levelOf(
        typeof parsed.severity === 'string'
          ? parsed.severity
          : typeof parsed.level === 'string'
            ? parsed.level
            : undefined,
      );
      return { timestampMs: own, message, level };
    }
  }

  return {
    timestampMs: stamp,
    message: trimmed,
    level: levelOf(levelWordOfPlainLine(trimmed)),
  };
}

/**
 * The severity word at the head of a plain line, when it has one.
 *
 * `info: Microsoft.Hosting.Lifetime[14]`, `2026-05-18T13:54:27.193748Z\tinfo\tFLAG: …` and
 * `Error: Error from server (BadRequest)` are the three shapes the corpus writes; the third is a STACK of
 * Kubernetes errors on the startup and infrastructure cases and is the only place those faults are stated, so a
 * reader that defaulted every plain line to `INFO` would zero the one signal those categories have.
 *
 * @param line - The line, prefix already removed.
 * @returns The word, or `undefined` when the head is not one.
 */
export function levelWordOfPlainLine(line: string): string | undefined {
  const head = /^([A-Za-z]+)\s*[:：]/.exec(line)?.[1];
  if (head !== undefined) return head;
  // The istio-proxy form: `<instant>\tinfo\tFLAG: …`, whose prefix is stripped before this is called.
  return /^([A-Za-z]+)\t/.exec(line)?.[1];
}

/**
 * Split one service's value into lines.
 *
 * TrainTicket writes one newline-joined string and Boutique writes a list; both are the same statement, and a
 * reader that took the string as a single line would produce one 7 MB `BenchmarkLogEntry` per TrainTicket service
 * whose message is a whole day of logs — a shape that parses, ranks and means nothing.
 *
 * @param value - The service's value, as the JSON states it.
 * @returns The lines, or `null` when the value is neither form.
 */
export function linesOf(value: unknown): readonly string[] | null {
  if (typeof value === 'string') return value.split(/\r?\n/);
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const one of value) {
      if (typeof one !== 'string') return null;
      lines.push(one);
    }
    return lines;
  }
  return null;
}

/**
 * Parse one `raw_data/logs.json`.
 *
 * A value that is neither a string nor a list of strings REFUSES the file rather than being skipped: the corpus
 * writes one or the other everywhere, so a third form is a file this reader does not understand, and skipping it
 * would silently drop a service from a case whose whole point is which service spoke.
 *
 * @param text - The file's contents.
 * @returns The lines per service, or the reason the file was refused.
 */
export function parseLogsJson(text: string): LogsRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\ufeff/, ''));
  } catch (error) {
    return { ok: false, reason: `logs.json is not JSON (${(error as Error).message})` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: 'logs.json is not an object of service → lines' };
  }

  const byService = new Map<string, DatedLogLine[]>();
  let rows = 0;
  let undated = 0;
  for (const [service, value] of Object.entries(raw as Record<string, unknown>)) {
    const lines = linesOf(value);
    if (lines === null) {
      return {
        ok: false,
        reason: `logs.json: "${service}" is neither a string nor a list of strings`,
      };
    }
    const resolved: DatedLogLine[] = [];
    let carried: number | null = null;
    for (const line of lines) {
      if (line.trim() === '') continue;
      rows += 1;
      const one = parseLogLine(line);
      const own: number | null =
        one.timestampMs !== null ? one.timestampMs + CORPUS_WALL_CLOCK_OFFSET_MS : carried;
      // A line the collector wrote without a stamp inherits the last stamped line of ITS OWN service. A service
      // whose FIRST line is unstamped cannot be dated at all, and it is counted rather than dated at epoch zero:
      // an epoch-zero stamp is before every window, so the line would be dropped by the engine anyway — but a
      // reader could not tell that from a line the collector never dated.
      if (own === null) {
        undated += 1;
        continue;
      }
      carried = own;
      resolved.push({ timestampMs: own, message: one.message, level: one.level });
    }
    if (resolved.length > 0) byService.set(service, resolved);
  }
  return { ok: true, value: { byService, rows, undated } };
}

/** What one case's log bridge produced, beside the entries the engine consumes. */
export interface CaseLogs {
  /** The entries, one per dated line, ordered by service then time. */
  readonly entries: readonly BenchmarkLogEntry[];
  /** Lines read from the file. */
  readonly rows: number;
  /** Lines that could not be dated and were therefore not carried. */
  readonly undated: number;
  /** Entries stamped at or after the injection, i.e. the ones the engine's log signal may read. */
  readonly atOrAfterInjection: number;
}

/**
 * Turn a parsed log table into the entries `BenchmarkCase.logs` wants.
 *
 * The two exception flags are computed by the SAME classifiers the RCAEval path uses
 * ({@link isLogicExceptionMessage}, {@link isHttpExceptionMessage}) rather than by a second set of patterns: the
 * log signal's modes are defined in terms of those two predicates, so a corpus that classified its own lines by
 * different rules would make `logSignalMode` mean two things on two corpora.
 *
 * @param parsed - The parse outcome.
 * @param injectTimeMs - The case's injection time on the same wall-clock axis, or `0` when it has none.
 * @returns The entries and the census beside them.
 */
export function toCaseLogs(parsed: LogsParse, injectTimeMs: number): CaseLogs {
  const entries: BenchmarkLogEntry[] = [];
  let atOrAfterInjection = 0;
  for (const [service, lines] of parsed.byService) {
    for (const one of lines) {
      if (injectTimeMs > 0 && one.timestampMs >= injectTimeMs) atOrAfterInjection += 1;
      entries.push({
        timestamp: one.timestampMs,
        service,
        message: one.message,
        level: one.level,
        isLogicException: isLogicExceptionMessage(one.message),
        isHttpException: isHttpExceptionMessage(one.message),
      });
    }
  }
  return {
    entries,
    rows: parsed.rows,
    undated: parsed.undated,
    atOrAfterInjection,
  };
}

/**
 * Read one case's `logs.json` off disk.
 *
 * `null` when the file is absent — a statement the caller must be able to tell from "the file held nothing", which
 * is `entries: []`. The corpus carries the file in all 754 directories, so absence is a corpus that moved rather
 * than a case that differs, and the runner reports it.
 *
 * @param path - The `raw_data/logs.json` path.
 * @param injectTimeMs - The case's injection time, for the post-injection census.
 * @returns The bridge outcome, or `null` when the file does not exist.
 * @throws When the file exists and cannot be read as an object of service → lines.
 */
export function readCaseLogs(path: string, injectTimeMs: number): CaseLogs | null {
  if (!existsSync(path)) return null;
  const parsed = parseLogsJson(readFileSync(path, 'utf8'));
  if (!parsed.ok) throw new Error(`${path}: ${parsed.reason}`);
  return toCaseLogs(parsed.value, injectTimeMs);
}

/** What an arm's log bridge covered, across the cases it scored. */
export interface LogCensus {
  /** Cases examined. */
  readonly cases: number;
  /** Cases the arm did not read a log artefact for — the metric-only arm. */
  readonly notAsked: number;
  /** Cases asked, and `raw_data/logs.json` was not there. The corpus carries it everywhere, so this is a move. */
  readonly absent: number;
  /** Cases whose file held at least one dated line. */
  readonly populated: number;
  /** Cases whose file existed and held no dated line — a file that said nothing. */
  readonly empty: number;
  /** Lines read across the arm. */
  readonly rows: number;
  /** Lines that carried no stamp and had no earlier stamped sibling. */
  readonly undated: number;
  /** Entries handed to the engine. */
  readonly entries: number;
  /** Entries the engine's `timestamp >= injectTimeMs` filter admits. */
  readonly atOrAfterInjection: number;
  /** Cases with entries but not one of them at or after the injection — the arm has nothing to read there. */
  readonly casesWithNoPostOnsetLine: number;
}

/**
 * Summarise an arm's log coverage.
 *
 * Every count is kept separate rather than summed, because the four states are four different statements: an arm
 * that was not run, a corpus that moved, a case whose file said nothing, and a case whose file said everything
 * before the fault. A single "coverage" percentage over them would answer none of the four.
 *
 * @param cases - One entry per scored case, in the runner's own order.
 * @returns The census.
 */
export function censusCaseLogs(cases: readonly (CaseLogs | null | undefined)[]): LogCensus {
  let notAsked = 0;
  let absent = 0;
  let populated = 0;
  let empty = 0;
  let rows = 0;
  let undated = 0;
  let entries = 0;
  let atOrAfterInjection = 0;
  let casesWithNoPostOnsetLine = 0;
  for (const one of cases) {
    if (one === undefined) {
      notAsked += 1;
      continue;
    }
    if (one === null) {
      absent += 1;
      continue;
    }
    if (one.entries.length === 0) {
      empty += 1;
      continue;
    }
    populated += 1;
    rows += one.rows;
    undated += one.undated;
    entries += one.entries.length;
    atOrAfterInjection += one.atOrAfterInjection;
    if (one.atOrAfterInjection === 0) casesWithNoPostOnsetLine += 1;
  }
  return {
    cases: cases.length,
    notAsked,
    absent,
    populated,
    empty,
    rows,
    undated,
    entries,
    atOrAfterInjection,
    casesWithNoPostOnsetLine,
  };
}

/**
 * Render a census as the lines the runner prints beside its arm.
 *
 * A not-asked arm prints `not read` and not a table of zeroes: the previous version of this corpus's doc block read
 * a zero the same way whether the bridge was off or the file was empty, which is how a claim of "no log artefact"
 * survived three iterations.
 *
 * @param census - The census.
 * @returns The block, newline-terminated.
 */
export function renderLogCensus(census: LogCensus): string {
  if (census.notAsked === census.cases) {
    return 'log artefact              not read (the metric-only arm; --logs attaches it)\n';
  }
  const lines = [
    'log artefact              read',
    `  cases ${census.populated} populated / ${census.absent} absent / ${census.empty} empty / ${census.notAsked} not asked`,
    `  rows ${census.rows} / entries ${census.entries} / undated ${census.undated}`,
    `  at or after injection ${census.atOrAfterInjection}`,
    `  no post-onset line ${census.casesWithNoPostOnsetLine} of ${census.populated}`,
  ];
  return `${lines.join('\n')}\n`;
}
