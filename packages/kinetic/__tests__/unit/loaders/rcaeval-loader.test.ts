/**
 * Unit tests for RCAEvalLoader.
 *
 * Tests parseDirectoryName edge cases, defensive loading of RE2/RE3 data,
 * graceful degradation when files are missing, and the full loadCase flow.
 *
 * @module __tests__/unit/loaders/rcaeval-loader.test
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  RCAEvalLoader,
  classifyLogLevel,
  countTraceActivityByService,
  extractDeepestExceptionClass,
  extractExceptionNames,
  extractSpringBootLevel,
  isLogicExceptionMessage,
  isPropagatedExceptionMessage,
  isStackTraceMessage,
  normalizeSpanStatus,
} from '../../../src/benchmarks/loaders/rcaeval-loader.js';

// ── Helpers ───────────────────────────────────────────────

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'rcaeval-test-'));
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function createCaseDir(
  baseDir: string,
  dirName: string,
  options: {
    metrics?: Record<string, Array<{ timestamp: number; value: number; metric_name: string }>>;
    injectTime?: number;
    groundTruth?: Record<string, unknown>;
    logs?: string;
    traces?: string;
  } = {},
): string {
  const casePath = path.join(baseDir, dirName);
  fs.mkdirSync(casePath, { recursive: true });

  if (options.metrics) {
    writeJson(path.join(casePath, 'metrics.json'), options.metrics);
  }

  if (options.injectTime !== undefined) {
    fs.writeFileSync(path.join(casePath, 'inject_time.txt'), String(options.injectTime));
  }

  if (options.groundTruth) {
    writeJson(path.join(casePath, 'ground_truth.json'), options.groundTruth);
  }

  if (options.logs) {
    fs.writeFileSync(path.join(casePath, 'logs.csv'), options.logs);
  }

  if (options.traces) {
    fs.writeFileSync(path.join(casePath, 'traces.csv'), options.traces);
  }

  return casePath;
}

// ── Tests ─────────────────────────────────────────────────

describe('classifyLogLevel', () => {
  it('returns the explicit level when a recognised level column value is present', () => {
    expect(classifyLogLevel('ERROR', '')).toBe('ERROR');
    expect(classifyLogLevel('FATAL', '')).toBe('FATAL');
    expect(classifyLogLevel('WARN', '')).toBe('WARN');
    expect(classifyLogLevel('INFO', 'anything')).toBe('INFO');
  });

  it('derives FATAL from stack-trace / panic keywords in the message', () => {
    expect(classifyLogLevel('', 'Traceback (most recent call last)')).toBe('FATAL');
    expect(classifyLogLevel('', 'kernel panic at 0xdeadbeef')).toBe('FATAL');
  });

  it('derives ERROR from error/exception/failure keywords in the message', () => {
    expect(classifyLogLevel('', 'NullPointerException: null reference')).toBe('ERROR');
    expect(classifyLogLevel('', 'request failed with status 500')).toBe('ERROR');
    expect(classifyLogLevel('', 'an unexpected error occurred')).toBe('ERROR');
  });

  it('derives WARN from warning keywords', () => {
    expect(classifyLogLevel('', 'deprecation warning: use v2')).toBe('WARN');
  });

  it('defaults to INFO for benign messages', () => {
    expect(classifyLogLevel('', 'request completed in 12ms')).toBe('INFO');
    expect(classifyLogLevel('', 'cart GetCart called')).toBe('INFO');
  });

  it('prefers the Spring Boot preamble level over body keywords', () => {
    // The message body mentions "errorLogger"/"errorChannel" (benign), but the
    // preamble says INFO — the level must come from the preamble, not the body.
    const msg =
      '2024-12-07 17:19:30.573  INFO 1 --- [Thread-5] o.s.i.endpoint.EventDrivenConsumer : Removing {logging-channel-adapter:_org.springframework.integration.errorLogger} as a subscriber to the errorChannel channel';
    expect(classifyLogLevel('', msg)).toBe('INFO');
  });

  it('returns ERROR for a Spring Boot preamble ERROR line', () => {
    const msg =
      '2024-12-07 17:20:09.351 ERROR 1 --- [io-12031-exec-5] o.a.c.c.C.[.[.[/].[dispatcherServlet] : Servlet.service() for servlet';
    expect(classifyLogLevel('', msg)).toBe('ERROR');
  });

  it('returns WARN for a Spring Boot preamble WARN line', () => {
    const msg = '2024-12-07 17:20:09.351  WARN 1 --- [main] c.f.App : deprecated config';
    expect(classifyLogLevel('', msg)).toBe('WARN');
  });
});

describe('extractSpringBootLevel', () => {
  it('extracts the level token from a logback preamble', () => {
    expect(extractSpringBootLevel('2024-12-07 17:19:30.573  INFO 1 --- [t] l : m')).toBe('INFO');
    expect(extractSpringBootLevel('2024-12-07 17:20:09.351 ERROR 1 --- [t] l : m')).toBe('ERROR');
    expect(extractSpringBootLevel('2024-12-07 17:20:09.351  WARN 1 --- [t] l : m')).toBe('WARN');
    expect(extractSpringBootLevel('2024-12-07 17:20:09.351 DEBUG 1 --- [t] l : m')).toBe('DEBUG');
    expect(extractSpringBootLevel('2024-12-07 17:20:09.351 FATAL 1 --- [t] l : m')).toBe('FATAL');
  });

  it('handles comma-separated milliseconds and one-digit hours', () => {
    expect(extractSpringBootLevel('2024-12-07 7:20:09,351  INFO 1 --- [t] l : m')).toBe('INFO');
  });

  it('returns undefined when the message has no Spring Boot preamble', () => {
    expect(extractSpringBootLevel('NullPointerException: null reference')).toBeUndefined();
    expect(
      extractSpringBootLevel('org.springframework.web.client.HttpServerErrorException: 503'),
    ).toBeUndefined();
    expect(extractSpringBootLevel('')).toBeUndefined();
    // TRACE is below DEBUG and intentionally not captured.
    expect(extractSpringBootLevel('2024-12-07 17:20:09.351 TRACE 1 --- [t] l : m')).toBeUndefined();
  });
});

describe('isStackTraceMessage', () => {
  it('detects stack-trace and exception signatures (code-level fault markers)', () => {
    expect(isStackTraceMessage('at com.foo.Bar.baz(Bar.java:42)')).toBe(true);
    expect(isStackTraceMessage('File "/app/main.py", line 42, in handle')).toBe(true);
    expect(isStackTraceMessage('Traceback (most recent call last):')).toBe(true);
    // JavaScript stack frame (Node.js): `at Object.handler (/app/server.js:42:13)`
    expect(isStackTraceMessage('at Object.handler (/app/server.js:42:13)')).toBe(true);
    // Exception class names are the RE3 code-level signal (benchmark #218:
    // RE3 logs carry exception NAMES, not structural frames — the broad gate
    // is what drives the TT RE3 +16.7 lift).
    expect(isStackTraceMessage('NullPointerException: null reference')).toBe(true);
    expect(isStackTraceMessage('Caused by: java.lang.NullPointerException')).toBe(true);
    expect(isStackTraceMessage('RedisConnectionFailureException: connection refused')).toBe(true);
    expect(isStackTraceMessage('java.net.SocketTimeoutException: Read timed out')).toBe(true);
  });

  it('rejects resource/network cascade messages (no stack trace)', () => {
    expect(isStackTraceMessage('connection refused')).toBe(false);
    expect(isStackTraceMessage('upstream connect error or disconnect/reset')).toBe(false);
    expect(isStackTraceMessage('request timeout after 5000ms')).toBe(false);
    expect(isStackTraceMessage('conversion request successful')).toBe(false);
  });
});

describe('extractExceptionNames', () => {
  it('extracts distinct exception/error type names in order of appearance', () => {
    const msg = 'NullPointerException then SocketTimeoutException then NullPointerException again';
    expect(extractExceptionNames(msg)).toEqual(['NullPointerException', 'SocketTimeoutException']);
  });

  it('reduces qualified names to their simple class name', () => {
    expect(extractExceptionNames('java.lang.NullPointerException: null')).toEqual([
      'NullPointerException',
    ]);
    expect(extractExceptionNames('org.springframework.dao.QueryTimeoutException: timeout')).toEqual(
      ['QueryTimeoutException'],
    );
  });

  it('captures Error / Timeout / Failure suffixes too', () => {
    expect(extractExceptionNames('OutOfMemoryError at runtime')).toEqual(['OutOfMemoryError']);
    expect(extractExceptionNames('Read timed out')).toEqual([]);
    expect(extractExceptionNames('SocketTimeout: read')).toEqual(['SocketTimeout']);
  });

  it('returns an empty array when no exception type is present', () => {
    expect(extractExceptionNames('connection refused')).toEqual([]);
    expect(extractExceptionNames('request completed in 12ms')).toEqual([]);
  });
});

describe('isLogicExceptionMessage', () => {
  it('detects self-caused logic exceptions (code-level fault signatures)', () => {
    expect(isLogicExceptionMessage('java.lang.NullPointerException: null')).toBe(true);
    expect(isLogicExceptionMessage('IllegalArgumentException: invalid argument')).toBe(true);
    expect(isLogicExceptionMessage('ConcurrentModificationException at runtime')).toBe(true);
    expect(isLogicExceptionMessage('JsonMappingException: cannot deserialize')).toBe(true);
    expect(isLogicExceptionMessage("AttributeError: 'NoneType' object has no attribute")).toBe(
      true,
    );
    expect(isLogicExceptionMessage("TypeError: cannot read property 'foo' of undefined")).toBe(
      true,
    );
    expect(isLogicExceptionMessage('MalformedJwtException: invalid token')).toBe(true);
    expect(isLogicExceptionMessage('ArrayIndexOutOfBoundsException: index 5')).toBe(true);
  });

  it('rejects connectivity/IO exceptions (propagated cascade signatures)', () => {
    expect(isLogicExceptionMessage('RedisConnectionFailureException: connection refused')).toBe(
      false,
    );
    expect(isLogicExceptionMessage('java.net.SocketTimeoutException: Read timed out')).toBe(false);
    expect(isLogicExceptionMessage('UnknownHostException: host not found')).toBe(false);
    expect(isLogicExceptionMessage('MongoSocketReadException: read error')).toBe(false);
    expect(isLogicExceptionMessage('AmqpIOException: broken pipe')).toBe(false);
    expect(isLogicExceptionMessage('EOFException: unexpected end of stream')).toBe(false);
  });

  it('rejects non-exception and generic messages', () => {
    expect(isLogicExceptionMessage('connection refused')).toBe(false);
    expect(isLogicExceptionMessage('request completed in 12ms')).toBe(false);
    expect(isLogicExceptionMessage('ProcessingException: unexpected')).toBe(false);
  });

  it('rejects PROPAGATED empty-value parse failures (silent wrong-value symptoms)', () => {
    // A downstream wrapper parsing an EMPTY value the silent source emitted
    // throws IllegalArgumentException/NumberFormatException — these are
    // symptoms of a wrong-value fault, NOT self-caused programming errors.
    expect(isLogicExceptionMessage('IllegalArgumentException: Invalid UUID string: ')).toBe(false);
    expect(isLogicExceptionMessage('IllegalArgumentException: Invalid UUID string: ""')).toBe(
      false,
    );
    expect(isLogicExceptionMessage('NumberFormatException: For input string: ""')).toBe(false);
    expect(isLogicExceptionMessage('NumberFormatException: For input string: ')).toBe(false);
    expect(isLogicExceptionMessage('Cannot parse empty string')).toBe(false);
  });
});

describe('isPropagatedExceptionMessage', () => {
  it('flags empty-value parse failures as propagated symptoms', () => {
    expect(isPropagatedExceptionMessage('IllegalArgumentException: Invalid UUID string: ')).toBe(
      true,
    );
    expect(isPropagatedExceptionMessage('IllegalArgumentException: Invalid UUID string: ""')).toBe(
      true,
    );
    expect(isPropagatedExceptionMessage('NumberFormatException: For input string: ""')).toBe(true);
    expect(isPropagatedExceptionMessage('NumberFormatException: For input string: ')).toBe(true);
    expect(isPropagatedExceptionMessage('Cannot parse empty string')).toBe(true);
  });

  it('does NOT flag genuine self-caused logic errors as propagated', () => {
    expect(isPropagatedExceptionMessage('IllegalArgumentException: invalid argument')).toBe(false);
    expect(isPropagatedExceptionMessage('java.lang.NullPointerException: null')).toBe(false);
    expect(isPropagatedExceptionMessage('NumberFormatException: For input string: "42a"')).toBe(
      false,
    );
  });
});

describe('extractDeepestExceptionClass', () => {
  it('returns the leading exception when there is no Caused by chain', () => {
    expect(extractDeepestExceptionClass('java.lang.NullPointerException: null ref')).toBe(
      'NullPointerException',
    );
    expect(extractDeepestExceptionClass('IllegalArgumentException: invalid argument')).toBe(
      'IllegalArgumentException',
    );
  });

  it('returns the DEEPEST (last) exception in a Caused by chain', () => {
    // Spring wraps an upstream 5xx in HttpServerErrorException; the root cause
    // is the deepest clause.
    const msg =
      'HttpServerErrorException: 500 Internal Server Error Caused by: java.lang.IllegalArgumentException: bad value';
    expect(extractDeepestExceptionClass(msg)).toBe('IllegalArgumentException');
  });

  it('picks the LAST Caused by clause when the chain has multiple links', () => {
    const msg =
      'org.foo.WrapperException: wrapped Caused by: org.foo.MidException: mid Caused by: java.net.ConnectException: refused';
    expect(extractDeepestExceptionClass(msg)).toBe('ConnectException');
  });

  it('strips package qualifiers to the simple class name', () => {
    expect(
      extractDeepestExceptionClass('org.springframework.dao.QueryTimeoutException: timeout'),
    ).toBe('QueryTimeoutException');
  });

  it('recognises Error and Throwable suffixes', () => {
    expect(extractDeepestExceptionClass('java.lang.OutOfMemoryError: heap space')).toBe(
      'OutOfMemoryError',
    );
    expect(extractDeepestExceptionClass('Caused by: java.lang.AssertionError: fail')).toBe(
      'AssertionError',
    );
  });

  it('returns undefined when no exception class is present', () => {
    expect(extractDeepestExceptionClass('connection refused')).toBeUndefined();
    expect(extractDeepestExceptionClass('request completed in 12ms')).toBeUndefined();
    expect(extractDeepestExceptionClass('')).toBeUndefined();
  });
});

describe('RCAEvalLoader', () => {
  let loader: RCAEvalLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = new RCAEvalLoader();
    tempDir = createTempDir();
  });

  afterEach(() => {
    // Clean up temp dir
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  // ── parseDirectoryName (via loadCase) ──────────────────

  describe('parseDirectoryName (via loadCase)', () => {
    it('should parse standard RE1 case dir name', () => {
      const casePath = createCaseDir(tempDir, 're1ob_adservice_cpu_1', {
        metrics: { adservice: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'adservice', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re1ob');
      expect(result.service).toBe('adservice');
      expect(result.fault).toBe('cpu');
      expect(result.instance).toBe(1);
    });

    it('should parse RE2 case dir name (OnlineBoutique system)', () => {
      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re2ob');
      expect(result.service).toBe('cartservice');
      expect(result.fault).toBe('cpu');
      expect(result.instance).toBe(1);
    });

    it('should parse RE3 case dir name (TrainTicket system)', () => {
      const casePath = createCaseDir(tempDir, 're3tt_ts-travel-service_cpu_1', {
        metrics: {
          'ts-travel-service': [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }],
        },
        injectTime: 500,
        groundTruth: { root_cause_service: 'ts-travel-service', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re3tt');
      expect(result.service).toBe('ts-travel-service');
      expect(result.fault).toBe('cpu');
      expect(result.instance).toBe(1);
    });

    it('should parse RE2 SockShop case', () => {
      const casePath = createCaseDir(tempDir, 're2ss_carts_cpu_3', {
        metrics: { carts: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'carts', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re2ss');
      expect(result.service).toBe('carts');
      expect(result.fault).toBe('cpu');
      expect(result.instance).toBe(3);
    });

    it('should parse RE3 SockShop case (re3ss_*)', () => {
      const casePath = createCaseDir(tempDir, 're3ss_orders_delay_2', {
        metrics: { orders: [{ timestamp: 1000, value: 100, metric_name: 'latency_ms' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'orders', root_cause_metric: 'delay' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re3ss');
      expect(result.service).toBe('orders');
      expect(result.fault).toBe('delay');
      expect(result.instance).toBe(2);
    });

    it('should parse RE3 OnlineBoutique case (re3ob_*)', () => {
      const casePath = createCaseDir(tempDir, 're3ob_checkoutservice_mem_1', {
        metrics: { checkoutservice: [{ timestamp: 1000, value: 80, metric_name: 'mem_usage' }] },
        injectTime: 1000,
        groundTruth: { root_cause_service: 'checkoutservice', root_cause_metric: 'mem' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re3ob');
      expect(result.service).toBe('checkoutservice');
      expect(result.fault).toBe('mem');
      expect(result.instance).toBe(1);
    });

    it('should parse RE1 TrainTicket case (re1tt_*)', () => {
      const casePath = createCaseDir(tempDir, 're1tt_ts-ui_delay_1', {
        metrics: { 'ts-ui': [{ timestamp: 1000, value: 100, metric_name: 'response_time_ms' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'ts-ui', root_cause_metric: 'delay' },
      });
      const result = loader.loadCase(casePath);
      expect(result.benchmark).toBe('re1tt');
      expect(result.service).toBe('ts-ui');
      expect(result.fault).toBe('delay');
      expect(result.instance).toBe(1);
    });

    it('should handle fault type "network"', () => {
      const casePath = createCaseDir(tempDir, 're1ob_frontend_network_1', {
        metrics: { frontend: [{ timestamp: 1000, value: 100, metric_name: 'network_errors' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'frontend', root_cause_metric: 'network' },
      });
      const result = loader.loadCase(casePath);
      expect(result.fault).toBe('network');
    });

    it('should handle fault type "error"', () => {
      const casePath = createCaseDir(tempDir, 're2ob_paymentservice_error_1', {
        metrics: { paymentservice: [{ timestamp: 1000, value: 1, metric_name: 'error_rate' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'paymentservice', root_cause_metric: 'error' },
      });
      const result = loader.loadCase(casePath);
      expect(result.fault).toBe('error');
    });

    it('should parse dir names where service has underscores', () => {
      // Service name: front_end (simulated with actual dir name)
      const casePath = createCaseDir(tempDir, 're1ob_front_end_cpu_1', {
        metrics: { front_end: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'front_end', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.service).toBe('front_end');
      expect(result.fault).toBe('cpu');
      expect(result.instance).toBe(1);
    });

    it('should throw on invalid dir name (too few parts)', () => {
      const casePath = path.join(tempDir, 'bad_name');
      fs.mkdirSync(casePath, { recursive: true });
      writeJson(path.join(casePath, 'metrics.json'), {
        svc: [{ timestamp: 1, value: 1, metric_name: 'x' }],
      });
      fs.writeFileSync(path.join(casePath, 'inject_time.txt'), '100');

      expect(() => loader.loadCase(casePath)).toThrow(/Invalid RCAEval directory name/);
    });

    it('should handle numeric-only instance suffix', () => {
      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_42', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
      });
      const result = loader.loadCase(casePath);
      expect(result.instance).toBe(42);
    });
  });

  // ── Defensive Loading ───────────────────────────────────

  describe('defensive loading', () => {
    it('should load case without inject_time.txt (defaults to 0)', () => {
      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        // NO injectTime — omitted intentionally
        groundTruth: { root_cause_service: 'svc', root_cause_metric: 'cpu' },
      });
      const result = loader.loadCase(casePath);
      expect(result.injectTime).toBe(0);
    });

    it('should load case without ground_truth.json (falls back to dir name)', () => {
      const casePath = createCaseDir(tempDir, 're1ob_adservice_cpu_1', {
        metrics: { adservice: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        // NO groundTruth — falls back to dir name extraction
      });
      const result = loader.loadCase(casePath);
      expect(result.groundTruth.serviceId).toBe('adservice');
      expect(result.groundTruth.faultType).toBe('cpu');
    });

    it('should load case without logs.csv (logs=undefined, but case still loads)', () => {
      const casePath = createCaseDir(tempDir, 're2ob_cartservice_delay_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 100, metric_name: 'latency_ms' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'delay' },
        // NO logs — RE2 case without logs.csv should still load
      });
      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
      expect(result.logs).toBeUndefined();
      expect(result.benchmark).toBe('re2ob');
    });

    it('should load case without traces.csv (traces=undefined, but case still loads)', () => {
      const casePath = createCaseDir(tempDir, 're2ob_cartservice_delay_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 100, metric_name: 'latency_ms' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'delay' },
        // NO traces — RE2 case without traces.csv should still load
      });
      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
      expect(result.traces).toBeUndefined();
    });

    it('should load full RE2 case with metrics+logs+traces', () => {
      const logsContent = [
        'timestamp,service,message,level',
        '1000,cartservice,Request started,INFO',
        '1005,cartservice,Cart add failed,ERROR',
        '1010,checkoutservice,Checkout timeout,WARN',
      ].join('\n');

      const tracesContent = [
        'trace_id,service,duration,status,parent_span',
        'trace001,cartservice,150,OK,',
        'trace001,checkoutservice,2000,ERROR,trace001.1',
        'trace002,cartservice,120,OK,',
      ].join('\n');

      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: {
          cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }],
          checkoutservice: [{ timestamp: 1000, value: 30, metric_name: 'cpu_usage' }],
        },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'cpu' },
        logs: logsContent,
        traces: tracesContent,
      });

      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
      expect(result.logs).toBeDefined();
      expect(result.logs!.length).toBe(3);
      expect(result.logs![1]!.level).toBe('ERROR');
      expect(result.traces).toBeDefined();
      expect(result.traces!.length).toBe(3);
      expect(result.traces![1]!.status).toBe('ERROR');
      expect(result.traces![1]!.service).toBe('checkoutservice');
    });

    it('parses the ACTUAL camelCase traces.csv columns', () => {
      // RCAEval traces.csv uses Jaeger camelCase with an uppercase ID suffix
      // (traceID/spanID/parentSpanID) and a statusCode column, NOT the
      // snake_case trace_id/status the legacy parser assumed.
      const tracesContent = [
        'time,traceID,spanID,serviceName,methodName,operationName,parentSpanID,startTimeMillis,startTime,duration,statusCode',
        '1000,t1,s1,cartservice,GetCart,GetCart,,1000000,1000,150,200',
        '1001,t1,s2,checkoutservice,Checkout,Checkout,s1,1001000,1001,2000,500',
        '1002,t2,s3,cartservice,GetCart,GetCart,,1002000,1002,120,200',
      ].join('\n');

      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'cpu' },
        traces: tracesContent,
      });

      const result = loader.loadCase(casePath);
      // serviceName and statusCode are detected via header aliases.
      expect(result.traces).toBeDefined();
      expect(result.traces![1]!.service).toBe('checkoutservice');
      expect(result.traces![1]!.status).toBe('ERROR');
      expect(loader.lastTraceHeader).toBe(
        'time,traceID,spanID,serviceName,methodName,operationName,parentSpanID,startTimeMillis,startTime,duration,statusCode',
      );
    });

    it('loads traces independently via loadTraces (no metrics re-read)', () => {
      const tracesContent = [
        'trace_id,service,duration,status,parent_span',
        'trace001,cartservice,150,OK,',
        'trace001,checkoutservice,2000,ERROR,trace001.1',
      ].join('\n');

      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'cpu' },
        traces: tracesContent,
      });

      const traces = loader.loadTraces(casePath);
      expect(traces).toBeDefined();
      expect(traces!.length).toBe(2);
      expect(traces![1]!.status).toBe('ERROR');

      // Missing traces.csv → undefined
      const noTracePath = createCaseDir(tempDir, 're2ob_svc_mem_2', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
      });
      expect(loader.loadTraces(noTracePath)).toBeUndefined();
    });

    it('caps loadTraces at maxSpans', () => {
      const lines = ['trace_id,service,duration,status,parent_span'];
      for (let i = 0; i < 50; i++) {
        lines.push(`trace${i},svc${i},${100 + i},OK,`);
      }
      const tracesContent = lines.join('\n');

      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        groundTruth: { root_cause_service: 'cartservice', root_cause_metric: 'cpu' },
        traces: tracesContent,
      });

      // Default cap is 10000 → loads all 50
      expect(loader.loadTraces(casePath)!.length).toBe(50);
      // Explicit cap → loads only the first 5
      expect(loader.loadTraces(casePath, 5)!.length).toBe(5);
    });

    it('should handle malformed logs.csv gracefully', () => {
      const badLogs = 'garbage,nonsense,data\nmore,bad,stuff';

      const casePath = createCaseDir(tempDir, 're2ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        logs: badLogs,
      });

      // Should not throw — logs should be undefined (defensive)
      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
      // The CSV parser produces rows but with wrong column names
      // As long as no exception is thrown, defensive loading works
    });

    it('should handle malformed traces.csv gracefully', () => {
      const badTraces = 'junk,header,line\n1,2,3,4,5';

      const casePath = createCaseDir(tempDir, 're2ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        traces: badTraces,
      });

      // Should not throw — traces may be parsed with defaults, or undefined on error
      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
    });

    it('should handle nonexistent optional files without error', () => {
      const casePath = createCaseDir(tempDir, 're3tt_svc_disk_1', {
        metrics: { svc: [{ timestamp: 1000, value: 100, metric_name: 'disk_iops' }] },
        injectTime: 100,
      });

      // RE3 case with no logs.csv and no traces.csv — still loads
      const result = loader.loadCase(casePath);
      expect(result).toBeDefined();
      expect(result.logs).toBeUndefined();
      expect(result.traces).toBeUndefined();
    });
  });

  // ── loadMetricsJson ────────────────────────────────────

  describe('loadMetricsJson', () => {
    it('should load multi-service metrics', () => {
      const metrics = {
        adservice: [
          { timestamp: 1000, value: 50.5, metric_name: 'cpu_usage' },
          { timestamp: 2000, value: 55.0, metric_name: 'cpu_usage' },
        ],
        cartservice: [{ timestamp: 1000, value: 30.0, metric_name: 'mem_usage' }],
      };

      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_1', {
        metrics,
        injectTime: 100,
      });

      const result = loader.loadCase(casePath);
      expect(result.metrics).toBeDefined();
      expect(Object.keys(result.metrics)).toHaveLength(2);
      expect(result.metrics['adservice']).toBeDefined();
      expect(result.metrics['adservice']!.length).toBe(2);
      expect(result.metrics['adservice']![0]!.value).toBe(50.5);
      expect(result.metrics['adservice']![0]!.metric_name).toBe('cpu_usage');
    });

    it('should throw when metrics.json is missing', () => {
      const casePath = path.join(tempDir, 're1ob_svc_cpu_1');
      fs.mkdirSync(casePath, { recursive: true });
      fs.writeFileSync(path.join(casePath, 'inject_time.txt'), '100');

      expect(() => loader.loadCase(casePath)).toThrow(/Metrics file not found/);
    });
  });

  // ── getGroundTruth ─────────────────────────────────────

  describe('getGroundTruth', () => {
    it('should load ground truth from JSON file', () => {
      const casePath = createCaseDir(tempDir, 're1ob_adservice_cpu_1', {
        metrics: { adservice: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        groundTruth: { root_cause_service: 'adservice', root_cause_metric: 'cpu_saturation' },
      });
      const result = loader.loadCase(casePath);
      expect(result.groundTruth.serviceId).toBe('adservice');
      expect(result.groundTruth.faultType).toBe('cpu_saturation');
    });

    it('should extract ground truth from dir name when no JSON exists', () => {
      const casePath = createCaseDir(tempDir, 're1ob_cartservice_mem_3', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'mem_usage' }] },
        injectTime: 500,
        // NO groundTruth JSON
      });
      const result = loader.loadCase(casePath);
      expect(result.groundTruth.serviceId).toBe('cartservice');
      expect(result.groundTruth.faultType).toBe('mem');
    });

    it('should support rootCauseService and rootCauseMetric key variants', () => {
      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        groundTruth: { rootCauseService: 'svc-alt', rootCauseMetric: 'disk_full' },
      });
      const result = loader.loadCase(casePath);
      expect(result.groundTruth.serviceId).toBe('svc-alt');
      expect(result.groundTruth.faultType).toBe('disk_full');
    });

    it('should support "service" key as fallback for serviceId', () => {
      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
        groundTruth: { service: 'fallback-svc' },
      });
      const result = loader.loadCase(casePath);
      expect(result.groundTruth.serviceId).toBe('fallback-svc');
    });
  });

  // ── toBenchmarkCase ────────────────────────────────────

  describe('toBenchmarkCase', () => {
    it('should convert RCAEvalCase to BenchmarkCase', () => {
      const casePath = createCaseDir(tempDir, 're1ob_adservice_cpu_1', {
        metrics: {
          adservice: [
            { timestamp: 1000, value: 50, metric_name: 'cpu_usage' },
            { timestamp: 2000, value: 80, metric_name: 'cpu_usage' },
          ],
          cartservice: [{ timestamp: 1000, value: 30, metric_name: 'cpu_usage' }],
        },
        injectTime: 1640000000,
        groundTruth: { root_cause_service: 'adservice', root_cause_metric: 'cpu' },
      });

      const rawCase = loader.loadCase(casePath);
      const callGraph = {
        nodes: new Map([
          ['adservice', { id: 'adservice', name: 'adservice', namespace: 're1ob', labels: {} }],
          [
            'cartservice',
            { id: 'cartservice', name: 'cartservice', namespace: 're1ob', labels: {} },
          ],
        ]),
        edges: [
          {
            from: 'adservice',
            to: 'cartservice',
            type: 'REST' as const,
            callRate: 100,
            p99Latency: 50,
            errorRate: 0.01,
          },
        ],
        systemLoad: 0.5,
      };

      const benchCase = loader.toBenchmarkCase(rawCase, callGraph, 'rcaeval-re1');

      expect(benchCase.id).toBe('rcaeval-re1_re1ob_adservice_cpu_1');
      expect(benchCase.datasetName).toBe('rcaeval-re1');
      expect(benchCase.callGraph).toBe(callGraph);
      expect(benchCase.metrics.size).toBe(2);
      expect(benchCase.injectTime).toBe(1640000000 * 1000); // seconds → ms
      expect(benchCase.groundTruth.serviceId).toBe('adservice');
    });

    it('should handle rcaeval-re2 dataset name', () => {
      const casePath = createCaseDir(tempDir, 're2ob_cartservice_mem_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'mem_usage' }] },
        injectTime: 100,
      });

      const rawCase = loader.loadCase(casePath);
      const graph = {
        nodes: new Map([
          [
            'cartservice',
            { id: 'cartservice', name: 'cartservice', namespace: 're2ob', labels: {} },
          ],
        ]),
        edges: [],
        systemLoad: 0.5,
      };

      const benchCase = loader.toBenchmarkCase(rawCase, graph, 'rcaeval-re2');
      expect(benchCase.datasetName).toBe('rcaeval-re2');
    });

    it('should handle rcaeval-re3 dataset name', () => {
      const casePath = createCaseDir(tempDir, 're3tt_svc_disk_1', {
        metrics: { svc: [{ timestamp: 1000, value: 100, metric_name: 'disk_io' }] },
        injectTime: 100,
      });

      const rawCase = loader.loadCase(casePath);
      const graph = {
        nodes: new Map([['svc', { id: 'svc', name: 'svc', namespace: 're3tt', labels: {} }]]),
        edges: [],
        systemLoad: 0.5,
      };

      const benchCase = loader.toBenchmarkCase(rawCase, graph, 'rcaeval-re3');
      expect(benchCase.datasetName).toBe('rcaeval-re3');
    });
  });

  // ── loadSuite ──────────────────────────────────────────

  describe('loadSuite', () => {
    it('should load all cases from a suite directory', () => {
      const suitePath = path.join(tempDir, 'RE1');
      fs.mkdirSync(suitePath, { recursive: true });

      createCaseDir(suitePath, 're1ob_adservice_cpu_1', {
        metrics: { adservice: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
      });
      createCaseDir(suitePath, 're1ob_cartservice_mem_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'mem_usage' }] },
        injectTime: 200,
      });
      createCaseDir(suitePath, 're1ob_checkoutservice_delay_1', {
        metrics: { checkoutservice: [{ timestamp: 1000, value: 100, metric_name: 'latency_ms' }] },
        injectTime: 300,
      });

      const suite = loader.loadSuite(suitePath, 'RE1');
      expect(suite.suiteName).toBe('RE1');
      expect(suite.totalCases).toBe(3);
      expect(suite.cases.length).toBe(3);
      // Should be sorted alphabetically
      expect(suite.cases[0]!.service).toBe('adservice');
      expect(suite.cases[1]!.service).toBe('cartservice');
      expect(suite.cases[2]!.service).toBe('checkoutservice');
    });

    it('should handle empty suite directory', () => {
      const suitePath = path.join(tempDir, 'EMPTY');
      fs.mkdirSync(suitePath, { recursive: true });

      const suite = loader.loadSuite(suitePath, 'RE1');
      expect(suite.totalCases).toBe(0);
      expect(suite.cases.length).toBe(0);
    });

    it('should handle mixed RE2/RE3 multi-modal cases', () => {
      const suitePath = path.join(tempDir, 'RE2');
      fs.mkdirSync(suitePath, { recursive: true });

      createCaseDir(suitePath, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        logs: 'timestamp,service,message,level\n1000,cartservice,Test log,INFO',
        traces: 'trace_id,service,duration,status,parent_span\ntrace001,cartservice,150,OK,',
      });

      const suite = loader.loadSuite(suitePath, 'RE2');
      expect(suite.totalCases).toBe(1);
      expect(suite.cases[0]!.logs).toBeDefined();
      expect(suite.cases[0]!.traces).toBeDefined();
    });

    it('should convert log timestamps from seconds to milliseconds', () => {
      // Regression: the log signal's post-injection filter compares a log's
      // timestamp against the ms-scaled injectTime. The loader must convert
      // logs.csv timestamps (Unix seconds) to ms, matching the metric and
      // injectTime conversions, otherwise every log line predates the
      // ms-scaled injectTime and the log signal silently degrades to no data.
      const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        logs: 'timestamp,service,message,level\n1000,cartservice,Boom,ERROR',
      });

      const rawCase = loader.loadCase(casePath);

      expect(rawCase.logs).toBeDefined();
      expect(rawCase.logs![0]!.timestamp).toBe(1000 * 1000);
      // InjectTime stays in seconds on the raw case (converted later in
      // toBenchmarkCase), while the log timestamp is already in ms.
      expect(rawCase.injectTime).toBe(500);
    });

    it('derives the log level from the message when no level column exists', () => {
      // RCAEval logs.csv has only `timestamp, service, message` (paper §3.4) —
      // no level/severity column. The loader must derive severity from the
      // message text so the log signal can count post-injection error volume.
      const casePath = createCaseDir(tempDir, 're3ob_cartservice_f1_1', {
        metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
        injectTime: 500,
        logs: [
          'timestamp,service,message',
          '1000,cartservice,NullPointerException at com.cartservice.Checkout.checkout(Checkout.java:42)',
          '1001,cartservice,request completed',
        ].join('\n'),
      });

      const rawCase = loader.loadCase(casePath);

      expect(rawCase.logs).toBeDefined();
      expect(rawCase.logs![0]!.level).toBe('ERROR');
      expect(rawCase.logs![1]!.level).toBe('INFO');
      // The stack-trace and logic-exception signatures must be derived from the
      // message text too, so the log signal can count self-caused logic errors
      // (code-level evidence) and ignore connectivity cascade noise.
      expect(rawCase.logs![0]!.isStackTrace).toBe(true);
      expect(rawCase.logs![0]!.isLogicException).toBe(true);
      expect(rawCase.logs![1]!.isStackTrace).toBe(false);
      expect(rawCase.logs![1]!.isLogicException).toBe(false);
    });

    it('extracts the deepest Caused-by exception for ERROR lines only', () => {
      const casePath = createCaseDir(tempDir, 're3tt_ts-auth-service_f1_1', {
        metrics: {
          'ts-auth-service': [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }],
        },
        injectTime: 500,
        logs: [
          'timestamp,service,message',
          '1000,ts-auth-service,HttpServerErrorException: 500 Caused by: java.lang.IllegalArgumentException: bad token',
          '1001,ts-auth-service,request completed',
        ].join('\n'),
      });

      const rawCase = loader.loadCase(casePath);

      expect(rawCase.logs![0]!.level).toBe('ERROR');
      expect(rawCase.logs![0]!.deepestExceptionClass).toBe('IllegalArgumentException');
      // INFO lines carry no root-cause exception → undefined (and are skipped
      // by the extractor to avoid a regex pass over non-error volume).
      expect(rawCase.logs![1]!.level).toBe('INFO');
      expect(rawCase.logs![1]!.deepestExceptionClass).toBeUndefined();
    });
  });

  // ── toBenchmarkSuite ────────────────────────────────────

  describe('toBenchmarkSuite', () => {
    it('should convert RE1 suite to unified format', () => {
      const casePath = createCaseDir(tempDir, 're1ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
      });

      const rawCase = loader.loadCase(casePath);
      const suite = {
        suiteName: 'RE1' as const,
        cases: [rawCase],
        totalCases: 1,
      };

      const callGraphs = {
        re1ob: {
          nodes: new Map([['svc', { id: 'svc', name: 'svc', namespace: 're1ob', labels: {} }]]),
          edges: [],
          systemLoad: 0.5,
        },
      };

      const benchSuite = loader.toBenchmarkSuite(suite, callGraphs);
      expect(benchSuite.name).toBe('rcaeval-re1');
      expect(benchSuite.totalCases).toBe(1);
    });

    it('should convert RE2 suite to unified format', () => {
      const casePath = createCaseDir(tempDir, 're2ob_svc_cpu_1', {
        metrics: { svc: [{ timestamp: 1000, value: 50, metric_name: 'cpu_usage' }] },
        injectTime: 100,
      });

      const rawCase = loader.loadCase(casePath);
      const suite = {
        suiteName: 'RE2' as const,
        cases: [rawCase],
        totalCases: 1,
      };

      const callGraphs = {
        re2ob: {
          nodes: new Map([['svc', { id: 'svc', name: 'svc', namespace: 're2ob', labels: {} }]]),
          edges: [],
          systemLoad: 0.5,
        },
      };

      const benchSuite = loader.toBenchmarkSuite(suite, callGraphs);
      expect(benchSuite.name).toBe('rcaeval-re2');
    });

    it('should convert RE3 suite to unified format', () => {
      const casePath = createCaseDir(tempDir, 're3tt_svc_disk_1', {
        metrics: { svc: [{ timestamp: 1000, value: 100, metric_name: 'disk_io' }] },
        injectTime: 100,
      });

      const rawCase = loader.loadCase(casePath);
      const suite = {
        suiteName: 'RE3' as const,
        cases: [rawCase],
        totalCases: 1,
      };

      const callGraphs = {
        re3tt: {
          nodes: new Map([['svc', { id: 'svc', name: 'svc', namespace: 're3tt', labels: {} }]]),
          edges: [],
          systemLoad: 0.5,
        },
      };

      const benchSuite = loader.toBenchmarkSuite(suite, callGraphs);
      expect(benchSuite.name).toBe('rcaeval-re3');
    });
  });
});

describe('trace start-time normalization', () => {
  let loader: RCAEvalLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = new RCAEvalLoader();
    tempDir = createTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it('reads the startTimeMillis column directly as milliseconds (no ×1000)', () => {
    const tracesContent = [
      'traceId,spanId,serviceName,startTimeMillis,startTime,duration',
      't1,s1,svc-a,1700000000000,1700000000000000,100',
      't2,s2,svc-b,1700000001000,1700000001000000,200',
    ].join('\n');

    const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
      metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
      injectTime: 500,
      traces: tracesContent,
    });

    const result = loader.loadCase(casePath);
    expect(result.traces).toBeDefined();
    // startTimeMillis is already ms; the µs startTime column must be ignored.
    expect(result.traces![0]!.startTime).toBe(1700000000000);
    expect(result.traces![1]!.startTime).toBe(1700000001000);
  });

  it('divides a microsecond startTime fallback by 1000', () => {
    const tracesContent = [
      'traceId,spanId,serviceName,startTime,duration',
      't1,s1,svc-a,1700000000000000,100',
    ].join('\n');

    const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
      metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
      injectTime: 500,
      traces: tracesContent,
    });

    const result = loader.loadCase(casePath);
    expect(result.traces![0]!.startTime).toBe(1700000000000);
  });
});

describe('log timestamp normalization', () => {
  let loader: RCAEvalLoader;
  let tempDir: string;

  beforeEach(() => {
    loader = new RCAEvalLoader();
    tempDir = createTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it('converts nanosecond timestamps to ms and keeps seconds→ms', () => {
    const casePath = createCaseDir(tempDir, 're2ob_cartservice_cpu_1', {
      metrics: { cartservice: [{ timestamp: 1000, value: 80, metric_name: 'cpu_usage' }] },
      injectTime: 500,
      logs: [
        'timestamp,service,message,level',
        '1700000000000000000,cartservice,ns event,INFO',
        '1000,cartservice,second event,INFO',
      ].join('\n'),
    });

    const result = loader.loadCase(casePath);
    // Nanoseconds (~1.7e18) → milliseconds (~1.7e12).
    expect(result.logs![0]!.timestamp).toBe(1700000000000);
    // Seconds stay on the existing ×1000 path.
    expect(result.logs![1]!.timestamp).toBe(1000 * 1000);
  });
});

describe('countTraceActivityByService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ok */
    }
  });

  it('counts pre/post spans per service at the injection boundary', async () => {
    const tracesPath = path.join(tempDir, 'traces.csv');
    fs.writeFileSync(
      tracesPath,
      [
        'traceId,spanId,serviceName,startTimeMillis,duration',
        't1,s1,svc-a,500,10',
        't2,s2,svc-a,1500,10',
        't3,s3,svc-b,800,10',
        't4,s4,svc-b,1000,10',
        't5,s5,svc-b,2000,10',
      ].join('\n'),
    );

    const counts = await countTraceActivityByService(tracesPath, 1000);
    expect(counts.size).toBe(2);
    expect(counts.get('svc-a')).toEqual({ pre: 1, post: 1 });
    expect(counts.get('svc-b')).toEqual({ pre: 1, post: 2 });
  });

  it('returns an empty map when the traces file is missing', async () => {
    const counts = await countTraceActivityByService(path.join(tempDir, 'missing.csv'), 1000);
    expect(counts.size).toBe(0);
  });

  it('resolves a microsecond startTime column through the streaming path', async () => {
    // The streaming counter must divide the Jaeger `startTime` microseconds by
    // 1000 (1_000_000 us = 1000 ms), so a span at 1.5 s straddles the
    // injection boundary correctly.
    const tracesPath = path.join(tempDir, 'traces.csv');
    fs.writeFileSync(
      tracesPath,
      [
        'traceId,spanId,serviceName,startTime,duration',
        't1,s1,svc-a,1000000,10',
        't2,s2,svc-a,2000000,10',
      ].join('\n'),
    );

    const counts = await countTraceActivityByService(tracesPath, 1500);
    expect(counts.get('svc-a')).toEqual({ pre: 1, post: 1 });
  });

  it('resolves a nanosecond bare timestamp column through the streaming path', async () => {
    // A bare `timestamp` column above 1e15 is nanoseconds and is divided by
    // 1e6: 1.4e18 ns → 1.4e12 ms (pre), 1.6e18 ns → 1.6e12 ms (post) against
    // an injection time of 1.5e12 ms.
    const tracesPath = path.join(tempDir, 'traces.csv');
    fs.writeFileSync(
      tracesPath,
      [
        'traceId,spanId,serviceName,timestamp',
        't1,s1,svc-a,1400000000000000000',
        't2,s2,svc-a,1600000000000000000',
      ].join('\n'),
    );

    const counts = await countTraceActivityByService(tracesPath, 1500000000000);
    expect(counts.get('svc-a')).toEqual({ pre: 1, post: 1 });
  });
});

describe('normalizeSpanStatus', () => {
  it('maps explicit error markers to ERROR', () => {
    expect(normalizeSpanStatus('ERROR')).toBe('ERROR');
    expect(normalizeSpanStatus('error')).toBe('ERROR');
    expect(normalizeSpanStatus('failed')).toBe('ERROR');
    expect(normalizeSpanStatus('true')).toBe('ERROR');
    expect(normalizeSpanStatus('1')).toBe('ERROR');
  });

  it('maps HTTP 4xx/5xx response codes to ERROR', () => {
    expect(normalizeSpanStatus('500')).toBe('ERROR');
    expect(normalizeSpanStatus('404')).toBe('ERROR');
    expect(normalizeSpanStatus('503')).toBe('ERROR');
  });

  it('maps ok / 2xx / absent values to OK', () => {
    expect(normalizeSpanStatus(undefined)).toBe('OK');
    expect(normalizeSpanStatus('')).toBe('OK');
    expect(normalizeSpanStatus('OK')).toBe('OK');
    expect(normalizeSpanStatus('200')).toBe('OK');
    expect(normalizeSpanStatus('302')).toBe('OK');
  });
});
