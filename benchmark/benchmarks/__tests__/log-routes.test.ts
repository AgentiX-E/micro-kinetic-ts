/**
 * The log channel's four ways to read zero, and the gate that decides three of them.
 *
 * ## The question this instrument answers
 *
 * `logWeight` is **1.0**, the largest weight in the ranking, and on RCAEval its input is an **empty map**: the
 * rendered census reads `INPUT_MAP_EMPTY(logScores)` on **719 of 735 cases**. `docs/loss-decomposition.md` §8.5
 * states the question and leaves it open — *"why is the tier empty, which is a question for the loader"* — and
 * that is what this module answers, because the tier can be empty for four reasons a single number cannot tell
 * apart:
 *
 * 1. the case has no `logs.csv` at all (RE1's three systems);
 * 2. the file was read and carried no row above the severity bar the loader retains;
 * 3. rows were retained and the mode's **source-signature gate** admits none of them;
 * 4. rows were admitted and every emitter is outside the call graph.
 *
 * The fourth state — the map is populated and the entry is zero — is the LOSS census's to see (`VALUE_ZERO`), and
 * the two instruments are the two halves of one attribution. They also **cross-check each other**: this module
 * can say the tier SHOULD be populated, and a run whose loss census says `INPUT_MAP_EMPTY` for that same case is
 * then contradicting a measured input rather than merely reporting a zero.
 *
 * ## Why the gate is imported rather than re-implemented
 *
 * The mode's admission rule lives in `packages/tree`'s `computeLogScores`, and a census that re-spelled it would
 * be a second answer to the same question — the defect this repository has repaired three times
 * (`--log-signal-mode` accepting two of six modes; the latency views spelled at three call sites; the log
 * vocabulary owned by two runners). So the rule is exported as a pure function, the scorer calls it, and this
 * module calls **the same function**.
 *
 * @module benchmarks/__tests__/log-routes
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { logLineAdmittedByMode } from '../../packages/tree/src/pruning/ranking-signals.js';
import {
  deriveLogRoute,
  formatLogRoutes,
  LOG_ROUTE_TOP_CLASSES,
  logChannelVerdict,
  summarizeLogRoutes,
  type LogRouteCensus,
} from '../src/log-route.js';

import type { FaultLogEntry } from '../../packages/core/src/interfaces/rca-engine.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string): string => readFileSync(resolve(HERE, '..', rel), 'utf8');

/** One retained ERROR row, with the two classification flags the loader sets. */
const row = (
  service: string,
  extra: { logic?: boolean; http?: boolean; level?: string; message?: string } = {},
): FaultLogEntry =>
  ({
    timestamp: 1_700_000_000_000,
    level: extra.level ?? 'ERROR',
    service,
    // A helper that built an INCONSISTENT row would make every arm using it test a state this pipeline cannot
    // produce: `isLogicException` is defined as the taxonomy's `logic`, so the default text follows the flag.
    // The disagreement arm below builds its rows by hand for exactly that reason.
    message:
      extra.message ?? (extra.logic === true ? 'java.lang.NullPointerException: default' : 'm'),
    isLogicException: extra.logic ?? false,
    isHttpException: extra.http ?? false,
  }) as unknown as FaultLogEntry;

describe('the log channel: four ways to read zero, and the gate that decides three', () => {
  it('counts each level, so a zero is attributable rather than merely reported', () => {
    const logs = [
      row('a', { logic: true }),
      row('a'),
      row('b', { http: true }),
      row('b', { logic: true }),
      row('c', { logic: false, http: false }),
    ];
    const e = deriveLogRoute(logs, new Set(['b']), 'count', 9);
    expect(e.mode).toBe('count');
    expect(e.rowsRead).toBe(9);
    expect(e.retained).toBe(5);
    // `count` admits ONLY self-caused logic exceptions — two of the five, on services `a` and `b`.
    expect(e.admitted).toBe(2);
    // …and only `b` is a graph node here, so one of the two is off the graph and cannot be scored.
    expect(e.admittedInGraph).toBe(1);
    expect(e.emitters).toBe(1);
  });

  it('reads the SAME gate the scorer reads, under every mode', () => {
    // The mode is a property of the RULE, so the census and the scorer must agree row by row; this is the
    // assertion that would fail if the census grew its own copy of the admission rule.
    const logs = [row('a', { logic: true }), row('a', { http: true }), row('a')];
    for (const mode of ['count', 'logicHttp', 'all'] as const) {
      const e = deriveLogRoute(logs, new Set(['a']), mode, 3);
      expect(e.admitted, `mode ${mode}`).toBe(
        logs.filter((l) => logLineAdmittedByMode(mode, l)).length,
      );
    }
    // …and the gate really does differ between modes, so the loop above is not vacuous.
    expect(deriveLogRoute(logs, new Set(['a']), 'count', 3).admitted).toBe(1);
    expect(deriveLogRoute(logs, new Set(['a']), 'all', 3).admitted).toBe(3);
  });

  it('is total over an empty corpus, and over an empty graph', () => {
    expect(deriveLogRoute([], new Set(['a']), 'count', 0)).toMatchObject({
      rowsRead: 0,
      retained: 0,
      admitted: 0,
      admittedInGraph: 0,
      emitters: 0,
    });
    expect(deriveLogRoute([row('a', { logic: true })], new Set(), 'count', 1).admittedInGraph).toBe(
      0,
    );
  });

  it('separates "no file" from "read and nothing above the bar", and treats FATAL as ERROR', () => {
    // `undefined` is the shape a case with no `logs.csv` presents; `rowsRead > 0` beside `retained === 0` is a
    // file that WAS read and carried nothing above the severity bar. The census must count those apart, because
    // the first is a corpus property and the second is the bar — and `logChannelVerdict` names a different
    // mechanism for each.
    expect(deriveLogRoute(undefined, new Set(['a']), 'count', 0)).toMatchObject({
      rowsRead: 0,
      retained: 0,
      admitted: 0,
    });
    const info = [row('a', { logic: true, level: 'INFO' })];
    expect(deriveLogRoute(info, new Set(['a']), 'count', 4)).toMatchObject({
      rowsRead: 4,
      retained: 0,
      admitted: 0,
    });
    // FATAL is retained and admitted exactly as ERROR is — the bar is two levels, not one.
    const fatal = [row('a', { logic: true, level: 'FATAL' })];
    expect(deriveLogRoute(fatal, new Set(['a']), 'count', 1)).toMatchObject({
      retained: 1,
      admitted: 1,
    });

    // The census counts the two states apart: a file READ with nothing above the bar is not a case without a
    // file, and only the first of them is the corpus's fault rather than the bar's.
    const census = summarizeLogRoutes([
      deriveLogRoute(undefined, new Set(), 'count', 0),
      deriveLogRoute(info, new Set(['a']), 'count', 4),
    ]);
    expect(census.cases).toBe(2);
    expect(census.casesWithoutRows).toBe(1);
    expect(census.rowsRead).toBe(4);
    expect(census.casesRetaining).toBe(0);
    expect(logChannelVerdict(census)).toContain('NO ERROR ROWS');
    // …and a population whose ONE retained row is admitted reads LIVE, so the arm above is not the residue.
    expect(
      logChannelVerdict(summarizeLogRoutes([deriveLogRoute(fatal, new Set(['a']), 'count', 1)])),
    ).toContain('LIVE');
  });
});

describe('the retained rows\u2019 own taxonomy, because "the gate admits none" has two causes', () => {
  it('counts the four kinds with the LOADER\u2019s classifier, so a bucket is not a second opinion', () => {
    // The distinction this exists for: a gate that refuses TRANSPORT noise is doing its job, and one that refuses
    // a whitelist-missed logic exception is a bug. `docs/re3-log-ceiling.md` measured the taxonomy on RE3's 90
    // cases and falsified the LLM-headroom hypothesis there; RE2's 270 cases have never been classified, and they
    // are where 180 of the 210 gate-blind cases live.
    const logs = [
      row('a', { logic: true, message: 'java.lang.NullPointerException: Cannot invoke ...' }),
      row('a', { message: 'java.lang.NumberFormatException: For input string: ""' }),
      row('b', { message: 'java.net.ConnectException: Connection refused' }),
      row('b', { message: 'order create failed, retrying' }),
    ];
    const e = deriveLogRoute(logs, new Set(['a', 'b']), 'count', 4);
    expect(e.retainedByKind).toEqual({ logic: 1, propagated: 1, unclassified: 1, none: 1 });
    // Only the logic row is admitted by `count`, which is what makes the taxonomy an EXPLANATION of the zero
    // rather than a second count of it.
    expect(e.admitted).toBe(1);
  });

  it('detects a stored flag that disagrees with the taxonomy — the pipeline defect this can catch', () => {
    // `isLogicException` is DEFINED as the taxonomy's `logic`, so a disagreement means the flag was written by
    // something other than the classifier that reads it — a stale cache, a second mapping, a widened field.
    const agreeing = [row('a', { logic: true, message: 'NullPointerException' })];
    expect(deriveLogRoute(agreeing, new Set(['a']), 'count', 1).flagDisagreements).toBe(0);
    const disagreeing = [
      row('a', { logic: true, message: 'java.lang.NumberFormatException: For input string: ""' }),
      row('a', { logic: false, message: 'java.lang.NullPointerException' }),
    ];
    expect(deriveLogRoute(disagreeing, new Set(['a']), 'count', 2).flagDisagreements).toBe(2);
    // …and the verdict puts it ABOVE every corpus explanation, because no corpus can cause it.
    const stale = summarizeLogRoutes([deriveLogRoute(disagreeing, new Set(['a']), 'count', 2)]);
    expect(logChannelVerdict(stale)).toContain('STALE FLAGS');
    expect(logChannelVerdict(stale)).toContain('DEFECT');
    expect(
      logChannelVerdict(summarizeLogRoutes([deriveLogRoute(agreeing, new Set(['a']), 'count', 1)])),
    ).not.toContain('STALE FLAGS');
  });
});

describe('the UNCLASSIFIED bucket, by class name — the headroom question, answered without guessing', () => {
  // 8,482 of TrainTicket RE3's 12,313 retained rows are `unclassified`: they name an exception class the
  // whitelist does not know and the propagated pattern does not match, and no mode except `all` admits them.
  // Whether a whitelist extension has headroom is a question about WHICH CLASSES those rows name, and no artifact
  // could answer it — the census counted the bucket and stopped. This is the missing half.
  it('records the DEEPEST class of every unclassified row, and only those rows', () => {
    const entry = deriveLogRoute(
      [
        // Unclassified: token-validation classes the whitelist does not carry (the TrainTicket shape).
        row('ts-a', { message: 'org.springframework.security.MalformedJwtException: bad token' }),
        row('ts-a', {
          message: 'org.springframework.security.MalformedJwtException: bad token again',
        }),
        row('ts-a', { message: 'com.acme.TokenException: expired' }),
        // A LOGIC row is another bucket; its class must not leak into this one.
        row('ts-a', { message: 'java.lang.NullPointerException: nope', logic: true }),
      ],
      new Set(['ts-a']),
      'count',
      4,
    );

    expect([...entry.unclassifiedClasses.entries()].sort()).toEqual([
      ['MalformedJwtException', 2],
      ['TokenException', 1],
    ]);
    expect(entry.retainedByKind.logic).toBe(1);
  });

  it('reads the DEEPEST name, because a wrapper is every victim\u2019s signature', () => {
    // The head class is what every downstream symptom shares; the fault's own class sits in the `Caused by:` tail.
    // A census that read the HEAD would rank wrappers and say the bucket is homogeneous, which is the opposite of
    // the question it is asked.
    const entry = deriveLogRoute(
      [
        row('ts-a', {
          message: 'ConnectException: refused\n\tat x\nCaused by: com.acme.BoomError: kaboom',
        }),
      ],
      new Set(['ts-a']),
      'count',
      1,
    );

    expect([...entry.unclassifiedClasses.keys()]).toEqual(['BoomError']);
  });

  it('files a row that names no class in its deepest clause under a NAME, never by dropping it', () => {
    // A bucket whose parts do not sum to its size is the defect this repository keeps finding: the row is
    // unclassified because the class regex matched somewhere, and the census must account for it even when the
    // `Caused by:` tail carries no class at all.
    const entry = deriveLogRoute(
      [row('ts-a', { message: 'java.lang.OutOfMemoryError at x, Caused by: nothing at all' })],
      new Set(['ts-a']),
      'count',
      1,
    );

    expect(entry.retainedByKind.unclassified).toBe(1);
    expect([...entry.unclassifiedClasses.entries()]).toEqual([['(unnamed)', 1]]);
  });

  it('treats a row with NO message as carrying no class, rather than throwing on it', () => {
    // The assembly's `message` is optional: a row that never had one is `none` in the taxonomy and contributes
    // nothing to the histogram. A census that dereferenced it would crash the run on a corpus this pipeline can
    // really produce.
    const bare = { ...row('ts-a'), message: undefined } as unknown as FaultLogEntry;
    const entry = deriveLogRoute([bare], new Set(['ts-a']), 'count', 1);

    expect(entry.retainedByKind.none).toBe(1);
    expect(entry.unclassifiedClasses.size).toBe(0);
  });

  it('aggregates across cases into a bounded, deterministic top list', () => {
    const one = deriveLogRoute(
      [
        row('ts-a', { message: 'MalformedJwtException: a' }),
        row('ts-a', { message: 'MalformedJwtException: b' }),
      ],
      new Set(['ts-a']),
      'count',
      2,
    );
    const two = deriveLogRoute(
      [
        row('ts-a', { message: 'TokenException: c' }),
        row('ts-a', { message: 'ConnectException: d' }),
        row('ts-a', { message: 'ZoinksError: e' }),
      ],
      new Set(['ts-a']),
      'count',
      3,
    );
    const census = summarizeLogRoutes([one, two]);

    // Count descending, then NAME ascending — a tie broken by insertion order would make the line depend on case
    // order, and two runs of the same corpus would print different censuses.
    expect(census.unclassifiedClasses).toEqual([
      { name: 'MalformedJwtException', count: 2 },
      { name: 'ConnectException', count: 1 },
      { name: 'TokenException', count: 1 },
      { name: 'ZoinksError', count: 1 },
    ]);
  });

  it('bounds the list, so a pathological corpus cannot print a thousand names', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row('ts-a', { message: `Unique${i}Error: x` }),
    );
    const census = summarizeLogRoutes([
      deriveLogRoute(rows, new Set(['ts-a']), 'count', rows.length),
    ]);

    expect(census.unclassifiedClasses.length).toBe(LOG_ROUTE_TOP_CLASSES);
    expect(census.unclassifiedClasses[0]!.name).toBe('Unique0Error');
  });

  it('prints the classes on the artifact, and prints nothing when the bucket is empty', () => {
    const census = summarizeLogRoutes([
      deriveLogRoute(
        [row('ts-a', { message: 'MalformedJwtException: a' })],
        new Set(['ts-a']),
        'count',
        1,
      ),
    ]);
    expect(
      formatLogRoutes(census, 'TT').some(
        (line) => line.includes('unclassified classes') && line.includes('MalformedJwtException'),
      ),
    ).toBe(true);
    const empty = summarizeLogRoutes([deriveLogRoute([], new Set(['ts-a']), 'count', 0)]);
    expect(formatLogRoutes(empty, 'TT').some((line) => line.includes('unclassified classes'))).toBe(
      false,
    );
  });
});

describe('the log-route census, and the verdict its counts earn', () => {
  it('aggregates every level and names the mechanism, with exclusive strength-ordered arms', () => {
    const c = (over: Partial<LogRouteCensus> = {}): LogRouteCensus => ({
      cases: 1,
      casesWithoutRows: 0,
      rowsRead: 1,
      retained: 1,
      admitted: 1,
      admittedInGraph: 1,
      emitters: 1,
      casesRetaining: 1,
      casesAdmitting: 1,
      casesAdmittingInGraph: 1,
      retainedByKind: { logic: 1, propagated: 0, unclassified: 0, none: 0 },
      flagDisagreements: 0,
      // The unclassified bucket's COMPOSITION; empty here, because this block is about the four LEVELS and a
      // class histogram would be a second fixture to keep true.
      unclassifiedClasses: [],
      ...over,
    });
    // Arm 1: nothing was read at all — RE1's systems carry no `logs.csv`.
    expect(
      logChannelVerdict(
        c({
          cases: 375,
          casesWithoutRows: 375,
          rowsRead: 0,
          retained: 0,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesRetaining: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
    ).toContain('STARVED');
    // Arm 2: read, and nothing above the severity bar.
    expect(
      logChannelVerdict(
        c({
          rowsRead: 5_000,
          retained: 0,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesRetaining: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
    ).toContain('NO ERROR ROWS');
    // Arm 3: rows retained, and the MODE admits none of them — the gate is the mechanism.
    expect(
      logChannelVerdict(
        c({
          rowsRead: 5_000,
          retained: 9_228,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
    ).toContain('GATE BLIND');
    // Arm 4: admitted, and every emitter is outside the call graph.
    expect(
      logChannelVerdict(
        c({
          rowsRead: 5_000,
          retained: 9_228,
          admitted: 41,
          admittedInGraph: 0,
          emitters: 0,
          casesAdmitting: 1,
          casesAdmittingInGraph: 0,
        }),
      ),
    ).toContain('OFF GRAPH');
    // Arm 5: the residue — the tier should be populated.
    const live = logChannelVerdict(
      c({ rowsRead: 5_000, retained: 9_228, admitted: 41, admittedInGraph: 41, emitters: 7 }),
    );
    expect(live).toContain('LIVE');
    // Every arm names a MECHANISM rather than restating the zero, which is the property the latency census has.
    for (const v of [
      logChannelVerdict(
        c({
          casesWithoutRows: 1,
          rowsRead: 0,
          retained: 0,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesRetaining: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
      logChannelVerdict(
        c({
          rowsRead: 5,
          retained: 0,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesRetaining: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
      logChannelVerdict(
        c({
          rowsRead: 5,
          retained: 5,
          admitted: 0,
          admittedInGraph: 0,
          emitters: 0,
          casesAdmitting: 0,
          casesAdmittingInGraph: 0,
        }),
      ),
      logChannelVerdict(
        c({ rowsRead: 5, retained: 5, admitted: 5, admittedInGraph: 0, emitters: 0 }),
      ),
    ]) {
      expect(v).not.toMatch(/^UNKNOWN|^ZERO|^EMPTY$/);
    }
  });

  it('renders the census as the lines the artifact carries, from one renderer', () => {
    const census = summarizeLogRoutes([
      deriveLogRoute([row('a', { logic: true })], new Set(['a']), 'count', 4),
      deriveLogRoute([row('b', { http: true })], new Set(['b']), 'count', 6),
    ]);
    const lines = formatLogRoutes(census, 'OnlineBoutique');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('log-routes[OnlineBoutique]');
    // The counts a reader needs to attribute the zero, all on ONE line: what was read, kept, admitted, and how
    // much of it was even addressable.
    expect(lines[0]).toMatch(/read \d+/);
    expect(lines[0]).toMatch(/retained \d+/);
    expect(lines[0]).toMatch(/admitted \d+/);
    expect(lines[0]).toMatch(/in-graph \d+/);
    expect(lines[1]).toContain('VERDICT');
  });
});

describe('the admission rule has ONE owner, and the golden runner reports the census', () => {
  it('exports the gate and has the scorer call it, rather than each site spelling it', () => {
    const signals = read('../packages/tree/src/pruning/ranking-signals.ts');
    // The rule is a module-level pure function of (mode, row)…
    expect(signals).toMatch(
      /export function logLineAdmittedByMode\(\s*mode: LogSignalMode,\s*log: FaultLogEntry,?\s*\): boolean/,
    );
    // …the scorer calls it instead of carrying its own copy…
    expect(signals).toMatch(/if \(!logLineAdmittedByMode\(mode, log\)\) continue;/);
    // …and the local closure it replaced is gone, so a second spelling cannot survive beside it.
    expect(signals).not.toMatch(/const isSourceSignature = \(log: FaultLogEntry\): boolean =>/);
    // The package entry exposes it, because the benchmarks half is a DIFFERENT package.
    expect(read('../packages/tree/src/index.ts')).toMatch(/logLineAdmittedByMode,/);
  });

  it('prints the census on the half that decides, from the owner’s own renderer', () => {
    const golden = read('src/run-rcaeval.ts');
    expect(golden).toMatch(/formatLogRoutes\(/);
    // It is REPORTED, not merely typed — the state this repository's latency census was written against.
    expect(golden).toMatch(/reportLogRoutes\(/);
    // …and the runner does not re-render it: a second spelling is a second answer, and the verdict arms are the
    // renderer's to choose.
    expect(golden).not.toContain('log-routes[');
  });
});
