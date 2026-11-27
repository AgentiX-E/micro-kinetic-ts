import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CORPUS_WALL_CLOCK_OFFSET_MS,
  censusCaseLogs,
  epochFieldToMs,
  levelOf,
  levelWordOfPlainLine,
  linesOf,
  parseLogLine,
  parseLogsJson,
  readCaseLogs,
  renderLogCensus,
  toCaseLogs,
  type CaseLogs,
} from '../src/cloudopsbench-logs.js';

/**
 * The wall clock an instant lands on, written the way `alert.json` writes it.
 *
 * @param iso - A real instant, with its zone.
 * @returns `<YYYY-MM-DD HH:MM:SS>`, UTC and NOT local — the corpus's wall clock is stated as if it were UTC, and
 *   a test that formatted in the runner's zone would pass in UTC+8 and fail in CI.
 */
const wall = (iso: string): string =>
  new Date(Date.parse(iso) + CORPUS_WALL_CLOCK_OFFSET_MS)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

describe('CORPUS_WALL_CLOCK_OFFSET_MS', () => {
  it('is the eight hours the corpus was collected in', () => {
    expect(CORPUS_WALL_CLOCK_OFFSET_MS).toBe(8 * 60 * 60 * 1000);
  });

  it('puts a +08:00 stamp, a Z stamp and an epochSecond on ONE wall clock', () => {
    // The three forms the same case writes, all the same instant: 2026-05-18T13:54:34Z. The parser states the
    // instant; the offset is the bridge's, applied once in `parseLogsJson`.
    const prefixed = parseLogLine(
      '2026-05-18T21:54:34.027884427+08:00 {"instant":{"epochSecond":1779112474,"nanoOfSecond":27884427},"level":"INFO","message":"AdService starting."}',
    );
    const zoned = parseLogLine('2026-05-18T13:54:34.027Z\tinfo\tFLAG: --concurrency="0"');
    const epoch = parseLogLine(
      '{"instant":{"epochSecond":1779112474,"nanoOfSecond":27800000},"message":"x"}',
    );
    expect(wall('2026-05-18T13:54:34.027Z')).toBe('2026-05-18 21:54:34');
    expect(prefixed.timestampMs).toBe(Date.parse('2026-05-18T13:54:34.027Z'));
    expect(zoned.timestampMs).toBe(Date.parse('2026-05-18T13:54:34.027Z'));
    expect(epoch.timestampMs).toBe(Date.parse('2026-05-18T13:54:34.027Z'));

    // And the bridge lands all three on the wall clock `alert.json` states, so `injectTimeMs` filters on the same
    // axis instead of eight hours away.
    const read = parseLogsJson(
      JSON.stringify({
        a: [
          '2026-05-18T21:54:34.027884427+08:00 {"instant":{"epochSecond":1779112474,"nanoOfSecond":27884427},"level":"INFO","message":"one"}',
          '2026-05-18T13:54:34.027Z\tinfo\ttwo',
        ],
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    for (const one of read.value.byService.get('a')!) {
      expect(one.timestampMs).toBe(Date.parse('2026-05-18T21:54:34.027Z'));
    }
  });
});

describe('parseLogLine', () => {
  const at = '2026-05-18T21:54:28.430462584+08:00';

  it('takes the prefix as the stamp and the JSON message as the message', () => {
    const one = parseLogLine(
      `${at} {"severity":"info","message":"Profiler disabled.","hostname":"currencyservice-5bc9dbdf66-shr96"}`,
    );
    expect(one).toEqual({
      timestampMs: Date.parse('2026-05-18T13:54:28.430Z'),
      message: 'Profiler disabled.',
      level: 'INFO',
    });
  });

  it('reads log4j severity from `level` and keeps the message', () => {
    const one = parseLogLine(
      `${at} {"instant":{"epochSecond":1779112468,"nanoOfSecond":430462584},"level":"error","message":"boom"}`,
    );
    expect(one.level).toBe('ERROR');
    expect(one.message).toBe('boom');
  });

  it('reads a millisecond `time` and a fractional-second `timestamp` as the same instant', () => {
    const ms = parseLogLine('{"time":1779112468429,"severity":"info","message":"a"}');
    const seconds = parseLogLine(
      '{"timestamp":1779112471.8259418,"severity":"INFO","message":"b"}',
    );
    expect(ms.timestampMs).toBe(1779112468429);
    // `toBeCloseTo` and not `toBe`: 1 779 112 471 825.9418 has more digits than a double carries, and an exact
    // literal here is a lint error AND a claim the runtime cannot honour.
    expect(seconds.timestampMs).toBeCloseTo(1779112471825.94, 1);
  });

  it('reads an ISO `timestamp` field when no prefix and no numeric field is present', () => {
    const one = parseLogLine(
      '{"timestamp":"2026-05-18T13:59:57.327036352Z","message":"Tracing disabled."}',
    );
    expect(one.timestampMs).toBe(Date.parse('2026-05-18T13:59:57.327Z'));
  });

  it('prefers the prefix over a body stamp, because the prefix is the collector\u2019s own', () => {
    const one = parseLogLine(
      '2026-05-18T21:59:57.327170413+08:00 {"timestamp":"2020-01-01T00:00:00Z","message":"Tracing disabled."}',
    );
    expect(one.timestampMs).toBe(Date.parse('2026-05-18T13:59:57.327Z'));
  });

  it('keeps a plain line as its own message and dates it from the prefix', () => {
    const one = parseLogLine(`${at} info: Microsoft.Hosting.Lifetime[14]`);
    expect(one.message).toBe('info: Microsoft.Hosting.Lifetime[14]');
    expect(one.level).toBe('INFO');
    expect(one.timestampMs).toBe(Date.parse('2026-05-18T13:54:28.430Z'));
  });

  it('keeps a Kubernetes error line as ERROR, because that is the only place those faults are stated', () => {
    const one = parseLogLine(
      `${at} Error: Error from server (BadRequest): container "server" in pod "adservice-7b5ff9bbd7-r2s5r" is waiting to start: trying and failing to pull image`,
    );
    expect(one.level).toBe('ERROR');
    expect(one.timestampMs).not.toBeNull();
  });

  it('reports a line with no stamp at all as undated rather than dating it at zero', () => {
    const one = parseLogLine('Error: Error from server (BadRequest): pod is waiting to start');
    expect(one.timestampMs).toBeNull();
    expect(one.level).toBe('ERROR');
  });

  it('falls back to the whole line when a body announces JSON and is not', () => {
    const one = parseLogLine(`${at} {not json at all`);
    expect(one.message).toBe('{not json at all');
    expect(one.timestampMs).toBe(Date.parse('2026-05-18T13:54:28.430Z'));
  });

  it('carries no timestamp when the line is JSON without any stamp field', () => {
    const one = parseLogLine('{"severity":"info","message":"no stamp here"}');
    expect(one.timestampMs).toBeNull();
    expect(one.message).toBe('no stamp here');
  });

  it('refuses an `instant` whose epochSecond no instant can be, rather than dating it', () => {
    // The same magnitude guard the numeric fields use, applied to log4j's own field: a `null` here falls through to
    // the next source, which is the prefix — and a line with neither is undated rather than dated in 1970.
    expect(parseLogLine('{"instant":{"epochSecond":1}}').timestampMs).toBeNull();
    expect(parseLogLine('{"instant":{"epochSecond":0,"nanoOfSecond":5}}').timestampMs).toBeNull();
  });

  it('dates an `instant` with no nanoOfSecond at its whole second', () => {
    expect(parseLogLine('{"instant":{"epochSecond":1779112547}}').timestampMs).toBe(1779112547000);
  });

  it('keeps the whole line as the message when the body states no message field', () => {
    const one = parseLogLine('{"severity":"error","stack":"at Foo.bar(Foo.java:1)"}');
    expect(one.message).toBe('{"severity":"error","stack":"at Foo.bar(Foo.java:1)"}');
    expect(one.level).toBe('ERROR');
  });
});

describe('epochFieldToMs', () => {
  it('reads seconds and milliseconds by magnitude, not by service', () => {
    expect(epochFieldToMs(1779112471.8259418)).toBeCloseTo(1779112471825.94, 1);
    expect(epochFieldToMs(1779112468429)).toBe(1779112468429);
  });

  it('refuses a value no instant can be, rather than dating it in 1970 or in 58000', () => {
    expect(epochFieldToMs(0)).toBeNull();
    expect(epochFieldToMs(-1)).toBeNull();
    expect(epochFieldToMs(Number.NaN)).toBeNull();
    expect(epochFieldToMs(Number.POSITIVE_INFINITY)).toBeNull();
    // 1e9 seconds is 2001-09-09; 1e11 ms is 1973-03-03. Both outside the corpus's decade.
    expect(epochFieldToMs(1)).toBeNull();
    expect(epochFieldToMs(1e13)).toBeNull();
  });
});

describe('levelOf', () => {
  it('maps every word the corpus writes, in either case', () => {
    expect(levelOf('info')).toBe('INFO');
    expect(levelOf('INFO')).toBe('INFO');
    expect(levelOf('debug')).toBe('DEBUG');
    expect(levelOf('trace')).toBe('DEBUG');
    expect(levelOf('warning')).toBe('WARN');
    expect(levelOf('warn')).toBe('WARN');
    expect(levelOf('error')).toBe('ERROR');
    expect(levelOf('fatal')).toBe('FATAL');
    expect(levelOf('critical')).toBe('FATAL');
    expect(levelOf(' panic ')).toBe('FATAL');
  });

  it('answers INFO for a word it does not know, and for no word at all', () => {
    expect(levelOf(undefined)).toBe('INFO');
    expect(levelOf('')).toBe('INFO');
    expect(levelOf('severity-not-stated')).toBe('INFO');
  });
});

describe('levelWordOfPlainLine', () => {
  it('finds the colon form, the tab form, and answers undefined for neither', () => {
    expect(levelWordOfPlainLine('info: Microsoft.Hosting.Lifetime[14]')).toBe('info');
    expect(levelWordOfPlainLine('Error: Error from server (BadRequest)')).toBe('Error');
    expect(levelWordOfPlainLine('info\tFLAG: --concurrency="0"')).toBe('info');
    expect(levelWordOfPlainLine('FLAG: --concurrency="0"')).toBe('FLAG');
    expect(levelWordOfPlainLine('no head word here')).toBeUndefined();
  });
});

describe('linesOf', () => {
  it('splits the newline-joined string TrainTicket writes', () => {
    expect(linesOf('a\nb\nc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a list as it is', () => {
    expect(linesOf(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('refuses a value that is neither form, and a list holding a non-string', () => {
    expect(linesOf(42)).toBeNull();
    expect(linesOf({ a: 1 })).toBeNull();
    expect(linesOf(['a', 42])).toBeNull();
  });
});

describe('parseLogsJson', () => {
  it('resolves an unstamped line from the SAME service\u2019s previous stamp, never another\u2019s', () => {
    const read = parseLogsJson(
      JSON.stringify({
        a: ['2026-05-18T21:00:00+08:00 first', 'second has no stamp'],
        b: ['third has no stamp'],
      }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const a = read.value.byService.get('a')!;
    expect(a.map((one) => one.message)).toEqual(['first', 'second has no stamp']);
    expect(a[1]!.timestampMs).toBe(a[0]!.timestampMs);
    // `b` opens with an unstamped line, so it cannot be dated — and a cross-service carry would have dated it.
    expect(read.value.byService.get('b')).toBeUndefined();
    expect(read.value.undated).toBe(1);
    expect(read.value.rows).toBe(3);
  });

  it('counts every line it read, including the ones it could not date', () => {
    const read = parseLogsJson(JSON.stringify({ a: ['no stamp', 'still none'] }));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.rows).toBe(2);
    expect(read.value.undated).toBe(2);
    expect(read.value.byService.size).toBe(0);
  });

  it('drops blank lines without counting them as rows', () => {
    const read = parseLogsJson(
      JSON.stringify({ a: ['2026-05-18T21:00:00+08:00 one', '', '   ', 'two'] }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.rows).toBe(2);
    expect(read.value.byService.get('a')!.length).toBe(2);
  });

  it('reads an empty service (TrainTicket writes `nacos: ""`) as no lines, not as a refusal', () => {
    const read = parseLogsJson(
      JSON.stringify({ nacos: '', other: ['2026-05-18T21:00:00+08:00 x'] }),
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.byService.has('nacos')).toBe(false);
    expect(read.value.byService.get('other')!.length).toBe(1);
  });

  it('answers an empty table for `{}`, which is a file that held nothing', () => {
    const read = parseLogsJson('{}');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.byService.size).toBe(0);
    expect(read.value.rows).toBe(0);
  });

  it('strips the BOM the corpus writes', () => {
    const read = parseLogsJson('\ufeff{"a":["2026-05-18T21:00:00+08:00 x"]}');
    expect(read.ok).toBe(true);
  });

  it('refuses text that is not JSON, an array, and a scalar', () => {
    expect(parseLogsJson('not json').ok).toBe(false);
    expect(parseLogsJson('[]').ok).toBe(false);
    expect(parseLogsJson('42').ok).toBe(false);
    expect(parseLogsJson('null').ok).toBe(false);
  });

  it('refuses a service whose value is neither a string nor a list of strings, naming it', () => {
    const read = parseLogsJson(JSON.stringify({ a: 42 }));
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.reason).toContain('"a"');
  });
});

describe('toCaseLogs', () => {
  const parsed = parseLogsJson(
    JSON.stringify({
      adservice: [
        '2026-05-18T21:00:00+08:00 {"level":"INFO","message":"before"}',
        '2026-05-18T22:00:00+08:00 java.lang.NullPointerException: boom',
        '2026-05-18T22:00:01+08:00 org.springframework.web.client.HttpServerErrorException: 500',
      ],
    }),
  );

  it('flags the logic and HTTP exceptions with the RCAEval classifiers, not a second set', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = toCaseLogs(parsed.value, Date.parse('2026-05-18T21:30:00Z'));
    const [before, logic, http] = out.entries;
    expect(before!.isLogicException).toBe(false);
    expect(logic!.isLogicException).toBe(true);
    expect(http!.isHttpException).toBe(true);
  });

  it('counts the entries at or after the injection, and only those', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = toCaseLogs(parsed.value, Date.parse('2026-05-18T21:30:00Z'));
    expect(out.entries.length).toBe(3);
    expect(out.atOrAfterInjection).toBe(2);
    expect(out.rows).toBe(3);
  });

  it('treats an unknown injection as no filter rather than as epoch zero', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toCaseLogs(parsed.value, 0).atOrAfterInjection).toBe(0);
  });

  it('carries the service each line belongs to', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const out = toCaseLogs(parsed.value, 0);
    expect(out.entries.every((one) => one.service === 'adservice')).toBe(true);
  });
});

describe('the census the runner prints beside the arm', () => {
  const withLines = (rows: number, post: number): CaseLogs => ({
    entries: Array.from({ length: rows }, (_, index) => ({
      timestamp: index,
      service: 'a',
      message: 'm',
      level: 'INFO' as const,
    })),
    rows,
    undated: 0,
    atOrAfterInjection: post,
  });

  it('separates "not asked", "asked and absent", and "asked and empty"', () => {
    // The three states are the difference between an arm that was not run, a corpus that moved, and a case that had
    // nothing to say. A census that summed them would report all three as zero coverage.
    const census = censusCaseLogs([undefined, null, withLines(0, 0), withLines(4, 2)]);
    expect(census.cases).toBe(4);
    expect(census.notAsked).toBe(1);
    expect(census.absent).toBe(1);
    expect(census.populated).toBe(1);
    expect(census.rows).toBe(4);
    expect(census.entries).toBe(4);
    expect(census.atOrAfterInjection).toBe(2);
  });

  it('counts the cases whose logs carry no line at or after the injection', () => {
    // The four TrainTicket cases whose sparse logs predate their own window, and `trainticket/performance/23` whose
    // alert is a day after its logs, land here — and they are the reason the bridge counts instead of shifting.
    const census = censusCaseLogs([withLines(3, 0), withLines(3, 1), withLines(5, 5)]);
    expect(census.casesWithNoPostOnsetLine).toBe(1);
    expect(census.populated).toBe(3);
  });

  it('says "not read" rather than a table of zeroes when no case was asked', () => {
    // The word is the whole point: `0 rows` reads the same for an arm that was not run and a file that was empty,
    // which is how the claim "this corpus carries no log artefact" survived three iterations.
    const text = renderLogCensus(censusCaseLogs([undefined, undefined]));
    expect(text).toContain('log artefact              not read');
    expect(text).not.toContain('rows');
    expect(text).toContain('--logs');
  });

  it('states all four case states separately in a mixed census', () => {
    const text = renderLogCensus(
      censusCaseLogs([undefined, null, withLines(0, 0), withLines(7, 3)]),
    );
    expect(text).toContain('log artefact              read');
    expect(text).toMatch(/cases 1 populated \/ 1 absent \/ 1 empty \/ 1 not asked/);
    expect(text).toContain('rows 7');
    expect(text).toContain('entries 7');
    expect(text).toMatch(/at or after injection 3/);
  });

  it('renders a read census with its four counts', () => {
    const text = renderLogCensus(censusCaseLogs([withLines(10, 4), withLines(2, 0)]));
    expect(text).toContain('log artefact              read');
    expect(text).toMatch(/rows 12/);
    expect(text).toMatch(/entries 12/);
    expect(text).toMatch(/at or after injection 4/);
    expect(text).toMatch(/no post-onset line 1 of 2/);
  });
});

describe('readCaseLogs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cob-logs-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('answers null when the file is absent — a different statement from a file that held nothing', () => {
    expect(readCaseLogs(join(dir, 'logs.json'), 0)).toBeNull();
  });

  it('answers an empty entry list for an empty object', () => {
    const path = join(dir, 'logs.json');
    writeFileSync(path, '{}');
    const out = readCaseLogs(path, 0);
    expect(out).not.toBeNull();
    expect(out!.entries).toEqual([]);
  });

  it('throws on a file it cannot read, naming the path — silence would drop a whole service', () => {
    const path = join(dir, 'logs.json');
    writeFileSync(path, '{"a": 42}');
    expect(() => readCaseLogs(path, 0)).toThrow(/logs\.json/);
    expect(() => readCaseLogs(path, 0)).toThrow(/"a"/);
  });

  it('reads a real-shaped file end to end', () => {
    const path = join(dir, 'logs.json');
    writeFileSync(
      path,
      JSON.stringify({
        frontend: [
          '2026-05-18T21:55:17.438895611+08:00 {"severity":"debug","message":"request started"}',
          '2026-05-18T21:57:40.000000000+08:00 {"severity":"error","message":"java.lang.IllegalStateException: bad"}',
        ],
      }),
    );
    const out = readCaseLogs(path, Date.parse('2026-05-18T21:57:32Z'));
    expect(out!.entries.length).toBe(2);
    expect(out!.atOrAfterInjection).toBe(1);
    expect(out!.entries[1]!.isLogicException).toBe(true);
  });
});
