/**
 * What `logs.csv` actually says, and what it costs to keep saying it.
 *
 * Two defects lived in the same reader and both were silent:
 *
 * 1. The file was split on `,` with no notion of quoting, so a QUOTED message —
 *    every JSON line SockShop and OnlineBoutique emit — was cut at its first
 *    comma and handed the tail to columns that do not exist. No throw, no
 *    warning: the log channels simply ranked on a prefix of the message.
 * 2. The file was decoded whole, so every cell was a slice of one string the
 *    size of the file. The handful of exception names a run keeps per case held
 *    that string alive for the rest of the process — 1395 MB across one 90-case
 *    cell, measured after the cases were dropped and the collector was run.
 *
 * @module __tests__/unit/loaders/rcaeval-log-fidelity.test
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RCAEvalLoader,
  extractDeepestExceptionClass,
  extractExceptionNames,
  isHttpExceptionMessage,
  isLogicExceptionMessage,
} from '../../../src/benchmarks/loaders/rcaeval-loader.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rcaeval-log-fidelity-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/** Write a minimally valid case directory around the given `logs.csv` text. */
function writeCase(logs: string, name = 're2ob_cartservice_cpu_1'): string {
  const casePath = path.join(tempDir, name);
  fs.mkdirSync(casePath, { recursive: true });
  fs.writeFileSync(
    path.join(casePath, 'metrics.json'),
    JSON.stringify({ cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] }),
  );
  fs.writeFileSync(path.join(casePath, 'inject_time.txt'), '1700000000');
  fs.writeFileSync(
    path.join(casePath, 'ground_truth.json'),
    JSON.stringify({ root_cause_service: 'cartservice', root_cause_metric: 'cpu' }),
  );
  fs.writeFileSync(path.join(casePath, 'logs.csv'), logs);
  return casePath;
}

/**
 * The collector, acquired the only way an unrelaunched process can: `globalThis.gc`
 * is undefined without `--expose-gc`, which is exactly the hole that once made a
 * "collect every 10 cases" loop collect nothing while still printing progress.
 */
const collectGarbage: () => void = (() => {
  const native = (globalThis as { gc?: () => void }).gc;
  if (typeof native === 'function') return native;
  setFlagsFromString('--expose_gc');
  const fromContext = runInNewContext('gc') as unknown;
  return typeof fromContext === 'function' ? (fromContext as () => void) : () => {};
})();

/** What the heap holds once everything unreachable has been taken. */
function retainedBytes(): number {
  collectGarbage();
  collectGarbage();
  return process.memoryUsage().heapUsed;
}

describe('logs.csv fidelity', () => {
  it('keeps a quoted message whole, commas included', () => {
    const logs = [
      'timestamp,container_name,message',
      '1705595459,front-end,"Posting Address: {""number"":""123"",""city"":""Paris""}"',
    ].join('\n');

    const entries = new RCAEvalLoader().loadCase(writeCase(logs)).logs!;

    expect(entries).toHaveLength(1);
    expect(entries[0]!.message).toBe('Posting Address: {"number":"123","city":"Paris"}');
    expect(entries[0]!.service).toBe('front-end');
    expect(entries[0]!.timestamp).toBe(1_705_595_459_000);
  });

  /*
   * The consequence that matters: the exception class sits AFTER a comma in the
   * message. A comma-blind reader loses it, the entry stays INFO, and the log
   * channel reports "no exception evidence" for a case whose evidence is in the
   * file verbatim.
   */
  it('derives the severity and the exception class from text that follows a comma', () => {
    const logs = [
      'timestamp,container_name,message',
      '1705595459,cartservice,"2024-01-18 12:00:00,123 ERROR 1 --- [o-1] c.Foo : boom java.lang.IllegalStateException: x"',
    ].join('\n');

    const entries = new RCAEvalLoader().loadCase(writeCase(logs)).logs!;

    expect(entries[0]!.level).toBe('ERROR');
    expect(entries[0]!.deepestExceptionClass).toBe('IllegalStateException');
  });

  it('keeps a quoted message that spans newlines as ONE entry', () => {
    const logs = [
      'timestamp,container_name,message',
      '1705595459,cartservice,"Caused by: java.lang.IllegalStateException: boom\n\tat a.B(A.java:1)"',
      '1705595460,cartservice,plain',
    ].join('\n');

    const entries = new RCAEvalLoader().loadCase(writeCase(logs)).logs!;

    expect(entries).toHaveLength(2);
    expect(entries[0]!.message).toContain('\tat a.B(A.java:1)');
    expect(entries[1]!.message).toBe('plain');
  });

  it('reads a quoted service name without shifting the message column', () => {
    const logs = ['timestamp,container_name,message', '1705595459,"cart,db",ok'].join('\n');

    const entries = new RCAEvalLoader().loadCase(writeCase(logs)).logs!;

    expect(entries[0]!.service).toBe('cart,db');
    expect(entries[0]!.message).toBe('ok');
  });
});

/*
 * A RELAYED exception is not a THROWN exception.
 *
 * Faithfully parsed, SockShop's `front-end` logs the response body it received
 * from its upstream:
 *
 * ```
 * Order response: {"statusCode":500,"body":{"exception":"java.lang.IllegalStateException",
 *                                         "message":"Unable to create order ..."}}
 * ```
 *
 * The class name in that line belongs to `orders`, and it is a serialized VALUE
 * — a field of a JSON document — not a frame of `front-end`'s own stack. Reading
 * it as front-end's own exception is what the log signal did once the message
 * stopped being truncated at the first comma: 290–746 "self-caused logic
 * exceptions" appeared on `front-end` in a single case, `front-end` took the
 * log score of every SockShop cell, and RE3:SockShop fell 11.1 points.
 *
 * The discriminator is the character AFTER the class name, which is the one
 * thing a serializer must add and a Java/Python `toString()` must not: a quote.
 * `IllegalStateException: boom` is a thrown exception; `"IllegalStateException"`
 * is a string in a document.
 */
describe('a serialized exception is not a thrown exception', () => {
  const relayed =
    'Order response: {"statusCode":500,"body":{"timestamp":1732386116876,"status":500,' +
    '"error":"Internal Server Error","exception":"java.lang.IllegalStateException",' +
    '"message":"Unable to create order due to unspecified IO error."}}';

  it('does not count a class name that sits inside a serialized value as a logic exception', () => {
    expect(isLogicExceptionMessage(relayed)).toBe(false);
  });

  it('does not name a serialized class as the deepest exception', () => {
    expect(extractDeepestExceptionClass(relayed)).toBeUndefined();
  });

  it('does not sample a serialized class into the exception census', () => {
    expect(extractExceptionNames(relayed)).toEqual([]);
  });

  it('does not read a serialized HTTP exception as the emitter observing a status', () => {
    expect(
      isHttpExceptionMessage('{"status":503,"exception":"HttpServerErrorException","body":""}'),
    ).toBe(false);
  });

  it('reads a single-quoted Python repr the same way it reads JSON', () => {
    expect(isLogicExceptionMessage("response = {'exception': 'ValueError'}")).toBe(false);
  });

  it('still counts an UNQUOTED occurrence in the same message as thrown', () => {
    const mixed =
      'Order response: {"exception":"java.lang.IllegalStateException"}' +
      ' caused locally by java.lang.IllegalStateException: boom';
    expect(isLogicExceptionMessage(mixed)).toBe(true);
    expect(extractDeepestExceptionClass(mixed)).toBe('IllegalStateException');
  });

  it('still counts a Java rendering of a thrown exception', () => {
    expect(isLogicExceptionMessage('java.lang.NullPointerException: null')).toBe(true);
    expect(extractExceptionNames('java.lang.NullPointerException: null')).toEqual([
      'NullPointerException',
    ]);
  });

  it('still counts a class name followed by a space or a stack frame', () => {
    expect(isLogicExceptionMessage('threw JsonMappingException while decoding')).toBe(true);
    expect(
      extractExceptionNames(
        'at org.springframework.web.client.DefaultResponseErrorHandler.handleError',
      ),
    ).toEqual(['handleError']);
  });
});

/*
 * An exception that blames I/O is not a programming error.
 *
 * This is the shape the SockShop cells turned on: `orders` answers every failed
 * call with Spring's dispatcher wrapper around
 * `IllegalStateException: Unable to create order due to unspecified IO error.`
 * The class is on the logic whitelist, the CAUSE is in the message, and the
 * service is a victim — so a rule that reads the class alone credits the victim
 * 5 times in `user_loss_1`, 373 in `payment_loss_1` and 145 in `carts_f1_3`.
 *
 * The wrapper is deliberately NOT the discriminator: every genuine RE3 source
 * exception arrives through the same `Servlet.service() … nested exception is`
 * text, so a clause matching that would suppress the very evidence the signal
 * exists for. The cause is the discriminator, and both directions are pinned.
 */
describe('an exception that blames an I/O cause is not self-caused', () => {
  const dispatcher =
    '2024-01-18 22:21:29.610 ERROR [orders,,,] 7 --- [p-nio-80-exec-6] o.a.c.c.C.[.[.[/].[dispatcherServlet]' +
    '    : Servlet.service() for servlet [dispatcherServlet] in context with path [] threw exception' +
    ' [Request processing failed; nested exception is java.lang.IllegalStateException:' +
    ' Unable to create order due to unspecified IO error.] with root cause';

  it('does not count a logic-class exception whose cause is an I/O error', () => {
    expect(isLogicExceptionMessage(dispatcher)).toBe(false);
  });

  it('still counts a programming error that arrives through the SAME wrapper', () => {
    const genuine = dispatcher.replace(
      'java.lang.IllegalStateException: Unable to create order due to unspecified IO error.',
      'java.lang.NullPointerException: null',
    );
    expect(isLogicExceptionMessage(genuine)).toBe(true);
  });

  it('still counts a logic exception whose message names no cause at all', () => {
    expect(isLogicExceptionMessage('java.lang.IllegalStateException: queue is full')).toBe(true);
  });

  it('does not read a connectivity cause phrased with a different verb', () => {
    expect(
      isLogicExceptionMessage(
        'IllegalStateException: payment failed because of a connection reset',
      ),
    ).toBe(false);
    expect(
      isLogicExceptionMessage('IllegalStateException: order failed, caused by socket timeout'),
    ).toBe(false);
  });

  it('does not count a timeout that the message states as the cause', () => {
    // The corpus's own phrasing, and the row that decided `payment_loss_1`: one
    // logic entry where every other service has none takes the whole log score
    // under `logNormalisation=max`.
    expect(
      isLogicExceptionMessage(
        'IllegalStateException: Unable to create order due to timeout from one of the services.',
      ),
    ).toBe(false);
  });

  it('still counts a bad argument whose message merely mentions a timeout', () => {
    expect(isLogicExceptionMessage('IllegalArgumentException: timeout must be positive')).toBe(
      true,
    );
    expect(isLogicExceptionMessage('IllegalStateException: order rejected: invalid timeout')).toBe(
      true,
    );
  });
});

describe('logs.csv retention', () => {
  /*
   * The regression guard for the second defect. A 17 MB log file is loaded, the
   * exception names the run tracks are extracted from it EXACTLY as the run does
   * (a `Set`, so one survivor per distinct name), and the case is dropped. What
   * must remain on the heap is the name — a few dozen bytes — not the document it
   * was cut out of.
   *
   * Measured both ways on this fixture: 17.02 MB retained when the names are
   * slices of a whole-file decode, 0.14 MB when each cell is decoded on its own.
   * The bound is half the file, which is far above the measurement's own noise
   * (V8 reports a live set that wanders by a couple of MB between collections)
   * and far below the defect, so the assertion can only pass for one of them.
   */
  it('does not let a name extracted from a message keep the log file alive', () => {
    const rows = ['timestamp,container_name,message'];
    // 140k rows × ~135 B ≈ 17 MB, every message quoted exactly as RCAEval writes
    // it and every row an ERROR line carrying a nameable exception, so the
    // extraction retains the maximum a run can.
    for (let i = 0; i < 140_000; i++) {
      rows.push(
        `1705595459,cartservice,"2024-01-18 12:00:00,${i} ERROR 1 --- [o-1] c.Foo : failed java.lang.IllegalStateException: row ${i}"`,
      );
    }
    const logs = rows.join('\n');
    const casePath = writeCase(logs);
    const fileBytes = Buffer.byteLength(logs);

    // The fixture text itself must not be part of the measurement.
    rows.length = 0;

    const before = retainedBytes();
    const names = new Set<string>();
    {
      const loaded = new RCAEvalLoader().loadCase(casePath).logs!;
      expect(loaded.length).toBe(140_000);
      for (const entry of loaded) {
        for (const name of extractExceptionNames(entry.message)) names.add(name);
      }
    }
    const after = retainedBytes();

    expect(fileBytes).toBeGreaterThan(16 * 1024 * 1024);
    expect([...names]).toEqual(['IllegalStateException']);
    expect(after - before).toBeLessThan(fileBytes / 2);
  });
});
