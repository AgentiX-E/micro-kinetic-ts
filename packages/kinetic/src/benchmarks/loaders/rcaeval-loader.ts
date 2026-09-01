/**
 * RCAEval benchmark loader.
 *
 * RCAEval is the primary AIOps benchmark dataset with 735 cases across
 * 3 suites (RE1: metrics-only, RE2: metrics+logs+traces, RE3: full multimodal).
 *
 * Dataset format per case directory:
 *   {benchmark}_{service}_{fault}_{instance}/
 *     ├── metrics.json    — [{timestamp, value, metric_name}] per service
 *     ├── inject_time.txt — single Unix timestamp (seconds)
 *     ├── logs.csv        — timestamp,service,message (RE2/RE3 only; no level
 *     │                      column — severity is derived from the message)
 *     ├── traces.csv      — trace_id,service,duration,status,parent_span (RE2/RE3 only)
 *     └── ground_truth.json — {root_cause_service, root_cause_metric}
 *
 * @module benchmarks/loaders/rcaeval-loader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
  TraceActivityCounts,
} from '@agentix-e/micro-kinetic-core';

import type {
  BenchmarkCase,
  BenchmarkGroundTruth,
  BenchmarkLogEntry,
  BenchmarkSuite,
  BenchmarkTraceSpan,
  RCAEvalCase,
  RCAEvalSuite,
} from './types.js';

// ── RCAEval Loader ────────────────────────────────────────

/**
 * Loader for RCAEval benchmark datasets.
 *
 * Parses the RCAEval directory structure and converts raw data
 * into the unified BenchmarkCase format understood by the runner.
 */

/**
 * Matches the LEVEL token inside a Spring Boot full-log-line preamble, e.g.
 *
 *   2024-12-07 17:19:30.573  INFO 1 --- [Thread-5] o.s.i.endpoint... : msg
 *
 * TrainTicket's logs.csv `message` field is the COMPLETE logback line (date,
 * time, level, pid, thread, logger, message), not just the message body. The
 * actual severity is this level token; keyword matching on the whole line is
 * fooled by benign words in the body such as `errorLogger` / `errorChannel`.
 *
 * Only the five levels representable as a `BenchmarkLogEntry` level are
 * matched; `TRACE` (below DEBUG) is intentionally NOT captured here and falls
 * through to the keyword derivation, since TRACE lines are noise regardless.
 */
const SPRING_BOOT_LEVEL_RE =
  /^\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\s+(DEBUG|INFO|WARN|ERROR|FATAL)\b/;

/**
 * Extract the explicit level from a Spring Boot full-log-line preamble, or
 * undefined when the message does not begin with the logback timestamp pattern.
 *
 * @param message - The raw log message text.
 * @returns The level token (DEBUG/INFO/WARN/ERROR/FATAL), or undefined.
 */
export function extractSpringBootLevel(message: string): BenchmarkLogEntry['level'] | undefined {
  const match = SPRING_BOOT_LEVEL_RE.exec(message);
  return match ? (match[1] as BenchmarkLogEntry['level']) : undefined;
}

/**
 * Normalise a raw log line into a `BenchmarkLogEntry` severity level.
 *
 * RCAEval's logs.csv has NO level/severity column — each row is just
 * `timestamp, service, message` (paper §3.4), and the root cause of a
 * code-level fault (RE3) is diagnosed from the STACK TRACES / error text in
 * the message. When an explicit level column IS present it takes precedence;
 * otherwise the severity is derived from message keywords (case-insensitive).
 *
 * ## Spring Boot preamble (TrainTicket)
 *
 * TrainTicket's `message` is the full logback line, so the actual level lives
 * in the preamble (`2024-12-07 17:19:30.573  INFO 1 --- [...]`). Keyword
 * matching on the whole line would mislabel an INFO line mentioning
 * `errorChannel` / `errorLogger` as ERROR (benchmark #226). The preamble level
 * therefore takes precedence over keyword derivation when present.
 *
 * @param explicitLevel - Uppercased explicit level from a level/severity
 *   column, or '' when the column is absent.
 * @param message - The raw log message text.
 * @returns A normalised `BenchmarkLogEntry` level.
 */
export function classifyLogLevel(
  explicitLevel: string,
  message: string,
): BenchmarkLogEntry['level'] {
  if (explicitLevel === 'ERROR' || explicitLevel === 'FATAL') return explicitLevel;
  if (explicitLevel === 'WARN' || explicitLevel === 'DEBUG' || explicitLevel === 'INFO') {
    return explicitLevel;
  }

  // Spring Boot full-log-line: trust the preamble's explicit level, not the
  // message body (which may mention "error" in a benign word).
  const springLevel = extractSpringBootLevel(message);
  if (springLevel) return springLevel;

  // No (or unrecognised) explicit level → derive from the message text.
  const lower = message.toLowerCase();
  if (/(fatal|panic|traceback|stack ?trace)/.test(lower)) return 'FATAL';
  if (/(error|exception|failed|failure)/.test(lower)) return 'ERROR';
  if (/(warn|warning)/.test(lower)) return 'WARN';
  return 'INFO';
}

/**
 * Header aliases for the trace span's SERVICE column. RCAEval stores the
 * service under `container_name` (the log header is `timestamp, container_name,
 * message`) or Jaeger `serviceName`, NOT the snake_case `service` the original
 * parser assumed. The alias set is the SAME comprehensive list tryLoadLogs uses
 * so logs and traces resolve the service identically.
 */
const SERVICE_COLUMN_ALIASES = new Set([
  'service',
  'servicename',
  'service_name',
  'service_id',
  'serviceid',
  'svc',
  'svcname',
  'svc_name',
  'app',
  'application',
  'app_name',
  'pod',
  'pod_name',
  'container',
  'container_name',
  'instance',
  'component',
  'source',
  'source_service',
  'name',
]);

/**
 * Normalise a trace span's raw start-time cells to Unix milliseconds.
 *
 * Jaeger traces.csv carries BOTH `startTimeMillis` (milliseconds, ~1.7e12) and
 * `startTime` (microseconds, ~1.7e15). Prefer `startTimeMillis` (already ms);
 * otherwise `startTime`/`start_time` are microseconds and must be divided by
 * 1000. A bare `timestamp` column is magnitude-inferred: >1e15 is nanoseconds
 * (÷1e6); anything else is already milliseconds.
 */
function normalizeTraceStartTimeMs(row: Record<string, string>): number {
  if (row.startTimeMillis !== undefined && row.startTimeMillis !== '') {
    return parseInt(row.startTimeMillis, 10);
  }
  if (row.startTime !== undefined && row.startTime !== '') {
    return Math.floor(parseInt(row.startTime, 10) / 1000);
  }
  if (row.start_time !== undefined && row.start_time !== '') {
    return Math.floor(parseInt(row.start_time, 10) / 1000);
  }
  if (row.timestamp !== undefined && row.timestamp !== '') {
    const ts = parseInt(row.timestamp, 10);
    if (ts > 1e15) return Math.floor(ts / 1e6); // ns → ms
    return ts; // already ms
  }
  return 0;
}

/**
 * Header aliases for the trace span's ERROR-INDICATOR column. RCAEval stores
 * the failure signal as a RESPONSE CODE (`response_code`/`status_code`/HTTP
 * status), not an explicit `status` flag.
 */
const STATUS_COLUMN_ALIASES = new Set([
  'status',
  'statuscode',
  'status_code',
  'httpstatus',
  'http_status',
  'http_status_code',
  'httpstatuscode',
  'responsecode',
  'response_code',
  'code',
]);

/**
 * Normalise a trace span's status/response-code value to `'OK' | 'ERROR'`.
 *
 * Treats explicit error markers (`error`/`failed`/`true`/`1`) and HTTP 4xx/5xx
 * response codes as ERROR; anything else (absent, `ok`, 2xx/3xx) is OK.
 *
 * @param value - Raw status/response-code cell value, or undefined.
 * @returns The normalised span status.
 */
export function normalizeSpanStatus(value: string | undefined): 'OK' | 'ERROR' {
  if (value === undefined || value === '') return 'OK';
  const v = value.trim().toLowerCase();
  if (v === 'error' || v === 'failed' || v === 'failure' || v === 'true' || v === '1') {
    return 'ERROR';
  }
  // HTTP status code: 4xx (client error) and 5xx (server error) are failures.
  if (/^[45]\d\d$/.test(v)) return 'ERROR';
  return 'OK';
}

/**
 * Detect whether a log message carries a stack-trace / exception signature —
 * the marker of a code-level fault (RCAEval RE3), as opposed to a plain
 * resource/network cascade (RE2) whose errors are "connection refused" /
 * "timeout" lines with no exception identity.
 *
 * The signature is BROAD: an exception class name (`\w+Exception`), a Java
 * stack frame (`at com.foo.Bar.baz(Bar.java:42)`), a `Caused by:` chain, or a
 * Python traceback. This is deliberately broad because benchmark #218 proved
 * that RE3 code-level faults log exception NAMES — not structural frames — in
 * their logs (RE3 SS/TT carried 0 `at …(file:line)` frames, yet their
 * exception names drove the TT RE3 +16.7 lift). A structural-frames-only
 * detector therefore erased the entire RE3 gain.
 *
 * KNOWN LIMITATION (the next discriminator must fix this): the broad
 * `\w+Exception` also matches CONNECTIVITY exception names (Spring's
 * `ConnectionException` / `SocketTimeoutException`) that resource-fault
 * CASCADES (RE2) log in the SYMPTOM services, which regresses SockShop RE2
 * (−10). The correct axis is exception SEMANTICS (logic vs connectivity), not
 * message shape — see `extractExceptionNames` for the sampling hook.
 *
 * This is independent of `classifyLogLevel`: a message can be ERROR without
 * being a stack trace (e.g. "connection refused"), and vice versa.
 *
 * @param message - The raw log message text.
 * @returns True when the message carries a stack-trace / exception signature.
 */
export function isStackTraceMessage(message: string): boolean {
  return (
    /traceback|stack ?trace/i.test(message) ||
    /Caused by:/.test(message) ||
    /\w+Exception\b/.test(message) ||
    /at\s+\S+\s*\([^)]*:\d+\)/.test(message) ||
    /File\s+"[^"]+",\s*line\s+\d+/i.test(message)
  );
}

/**
 * Extract the distinct exception/error TYPE names from a log message, in order
 * of first appearance. This is a DIAGNOSTIC hook for the log-signal gate: it
 * surfaces which exception classes actually appear in each system's error logs,
 * to discriminate LOGIC exceptions (a code-level fault's NullPointerException /
 * IllegalArgumentException / ArrayIndexOutOfBounds) from CONNECTIVITY
 * exceptions (a resource cascade's ConnectionException / SocketTimeoutException).
 *
 * Only the simple class name is returned — a qualified name such as
 * `java.lang.NullPointerException` or
 * `org.springframework.dao.QueryTimeoutException` yields
 * `NullPointerException` / `QueryTimeoutException` (the token ending in
 * `Exception` / `Error` / `Timeout` / `Failure`).
 *
 * @param message - The raw log message text.
 * @returns Distinct exception/error type names in order of first appearance.
 */
export function extractExceptionNames(message: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /\b[A-Za-z][\w]*(?:Exception|Error|Timeout|Failure)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(message)) !== null) {
    const name = match[0];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/**
 * Matches a (possibly fully-qualified) Java/Python exception class name such as
 * `java.lang.IllegalArgumentException`, `org.foo.MyError`, or `TypeError`.
 */
const EXCEPTION_CLASS_RE = /\b[A-Za-z_][\w.]*(?:Exception|Error|Throwable)\b/;

/**
 * Strip a qualified class name down to its simple name.
 *
 * `java.lang.IllegalArgumentException` → `IllegalArgumentException`; an
 * already-simple name such as `TypeError` is returned unchanged.
 */
function simpleClassName(qualified: string): string {
  const idx = qualified.lastIndexOf('.');
  return idx >= 0 ? qualified.slice(idx + 1) : qualified;
}

/**
 * Extract the simple class name of the DEEPEST exception in a log message's
 * `Caused by:` chain — the root cause that actually triggered the cascade.
 *
 * The head of a Java exception message is often a non-discriminative wrapper:
 * Spring's `HttpServerErrorException` is thrown by a CLIENT whenever an
 * upstream 5xx is received, so every downstream symptom logs it, while the
 * actual fault signature (e.g. `IllegalArgumentException`) lives in the LAST
 * `Caused by:` clause. Ranking on the deepest exception therefore separates the
 * source (rare, specific root cause) from the symptoms (shared wrapper).
 *
 * When there is no `Caused by:` chain, the leading exception of the message is
 * used — which degrades gracefully to the same value the count-mode whitelist
 * inspects.
 *
 * @param message - The raw log message text.
 * @returns The simple class name of the deepest exception, or undefined when
 *   the message carries no recognisable exception class.
 */
export function extractDeepestExceptionClass(message: string): string | undefined {
  const causedByIdx = message.lastIndexOf('Caused by:');
  const source = causedByIdx >= 0 ? message.slice(causedByIdx + 'Caused by:'.length) : message;
  const match = EXCEPTION_CLASS_RE.exec(source);
  return match ? simpleClassName(match[0]) : undefined;
}

/**
 * Names of SELF-CAUSED logic exceptions — the programming-error signatures of
 * a code-level fault (RCAEval RE3). These arise from an internal bug (a null
 * dereference, a bad argument, an invalid state, a malformed payload) and
 * therefore identify the SOURCE service, not a downstream symptom.
 */
const LOGIC_EXCEPTION_PATTERN =
  /(?:NullPointer|IllegalArgument|IllegalState|ArrayIndex|IndexOutOfBounds|ClassCast|ConcurrentModification|NumberFormat|Arithmetic|NoSuchElement|UnsupportedOperation|ClassNotFound|NoSuchMethod|NoSuchField|JsonMapping|JsonParse|JsonProcessing|HttpMessageNotReadable|MalformedJwt|AttributeError|TypeError|NameError|IndexError|ValueError|KeyError|ZeroDivisionError|TokenException)/i;

/**
 * Determine whether a log message is a SELF-CAUSED logic exception — the
 * signature of a code-level fault — as opposed to a PROPAGATED connectivity
 * exception (a resource/network cascade) or a non-error line.
 *
 * This is the causal discriminator behind the log signal (benchmark #219):
 *
 * - RE3 code-level faults flood LOGIC exceptions (NullPointerException,
 *   ConcurrentModificationException, JsonMappingException, AttributeError,
 *   TypeError, MalformedJwtException, …) in the SOURCE service.
 * - RE2 resource faults flood CONNECTIVITY exceptions (ConnectionException,
 *   SocketTimeoutException, MongoSocketException, UnknownHostException, …)
 *   in the SYMPTOM services — these are PROPAGATED, not self-caused.
 *
 * Counting only logic exceptions therefore points at the source for code-level
 * faults and stays neutral for resource cascades. A logic exception is a
 * programming error (null dereference / bad argument / invalid state /
 * malformed payload); a connectivity exception is an environmental condition
 * (unreachable dependency / timeout).
 *
 * @param message - The raw log message text.
 * @returns True when the message names a self-caused logic exception.
 */
export function isLogicExceptionMessage(message: string): boolean {
  return LOGIC_EXCEPTION_PATTERN.test(message);
}

export class RCAEvalLoader {
  /**
   * Raw header of the last logs.csv parsed (comma-joined column names).
   * Exposed for benchmark diagnostics — it reveals the ACTUAL column names of
   * the RCAEval log data, which is essential for correctly attributing log
   * lines to services (the `service` column has proven not to be the obvious
   * name).
   */
  lastLogHeader = '';

  /**
   * Raw header of the last traces.csv parsed (comma-joined column names).
   * Exposed for benchmark diagnostics — it reveals the ACTUAL column names of
   * the RCAEval trace data, which is essential for correctly attributing spans
   * to services (the trace columns are Jaeger camelCase, NOT the snake_case
   * `service`/`status` the original parser assumed).
   */
  lastTraceHeader = '';

  /**
   * Load a single RCAEval case from a directory.
   *
   * Uses defensive loading: if optional files are missing or malformed,
   * the case is still loaded with degraded data. Only fails if both
   * metrics.json and parseDirectoryName are unavailable (bare minimum).
   *
   * @param casePath - Path to the case directory.
   * @returns Parsed RCAEvalCase structure.
   */
  loadCase(casePath: string): RCAEvalCase {
    const dirName = path.basename(casePath);
    const parsed = this.parseDirectoryName(dirName);

    // Load metrics JSON (required)
    const metricsPath = path.join(casePath, 'metrics.json');
    const metrics = this.loadMetricsJson(metricsPath);

    // Load inject time (fall back to 0 if unavailable)
    const injectTime = this.tryLoadInjectTime(casePath);

    // Load ground truth
    const groundTruth = this.getGroundTruth(casePath, parsed);

    // Load optional multimodal data (defensive — returns undefined on failure)
    const logs = this.tryLoadLogs(casePath);
    const traces = this.tryLoadTraces(casePath);

    return {
      casePath,
      benchmark: parsed.benchmark,
      service: parsed.service,
      fault: parsed.fault,
      instance: parsed.instance,
      metrics,
      injectTime,
      groundTruth,
      logs,
      traces,
    };
  }

  /**
   * Load a complete RCAEval suite (RE1, RE2, or RE3).
   *
   * @param suitePath - Path to the suite directory.
   * @param suiteName - Suite identifier.
   * @returns Parsed suite.
   */
  loadSuite(suitePath: string, suiteName: 'RE1' | 'RE2' | 'RE3'): RCAEvalSuite {
    const entries = fs.readdirSync(suitePath, { withFileTypes: true });
    const caseDirs = entries
      .filter((e) => e.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));

    const cases = caseDirs.map((dir) => this.loadCase(path.join(suitePath, dir.name)));

    return {
      suiteName,
      cases,
      totalCases: cases.length,
    };
  }

  /**
   * Extract ground truth from a case directory.
   * Falls back to extracting from the directory name if no ground_truth.json exists.
   *
   * @param casePath - Path to the case directory.
   * @returns Ground truth information.
   */
  getGroundTruth(casePath: string): BenchmarkGroundTruth;
  getGroundTruth(casePath: string, parsed?: ParsedDirName): BenchmarkGroundTruth;
  getGroundTruth(casePath: string, parsed?: ParsedDirName): BenchmarkGroundTruth {
    const gtPath = path.join(casePath, 'ground_truth.json');

    if (fs.existsSync(gtPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
        return {
          serviceId: raw.root_cause_service ?? raw.rootCauseService ?? raw.service,
          faultType:
            raw.root_cause_metric ??
            raw.rootCauseMetric ??
            raw.faultType ??
            parsed?.fault ??
            'unknown',
          metric: raw.root_cause_metric ?? raw.rootCauseMetric,
        };
      } catch {
        // Fall through to directory name extraction
      }
    }

    // Extract from directory name: {benchmark}_{service}_{fault}_{instance}
    const info = parsed ?? this.parseDirectoryName(path.basename(casePath));
    return {
      serviceId: info.service,
      faultType: info.fault,
    };
  }

  /**
   * Convert a raw RCAEvalCase into the unified BenchmarkCase format.
   *
   * @param rawCase - Raw RCAEval case.
   * @param callGraph - Service call graph for this benchmark system.
   * @returns Unified BenchmarkCase.
   */
  toBenchmarkCase(
    rawCase: RCAEvalCase,
    callGraph: ServiceCallGraph,
    suiteName: 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3',
  ): BenchmarkCase {
    const metricMap = this.buildMetricMap(rawCase.metrics);

    return {
      id: `${suiteName}_${rawCase.benchmark}_${rawCase.service}_${rawCase.fault}_${rawCase.instance}`,
      datasetName: suiteName,
      callGraph,
      metrics: metricMap,
      injectTime: rawCase.injectTime * 1000, // Convert seconds to ms
      groundTruth: rawCase.groundTruth,
      logs: rawCase.logs,
      // Traces are consumed during topology augmentation (prior to this call);
      // storing them in BenchmarkCase wastes memory — RE2 has 270+ cases × 100K+
      // spans each.  Set to undefined so GC can reclaim after augmentation.
      traces: undefined,
    };
  }

  /**
   * Convert an entire RCAEval suite into unified BenchmarkSuite format.
   *
   * @param suite - Raw RCAEval suite.
   * @param callGraphs - Service call graphs for each benchmark system.
   * @returns Unified BenchmarkSuite.
   */
  toBenchmarkSuite(
    suite: RCAEvalSuite,
    callGraphs: Record<string, ServiceCallGraph>,
  ): BenchmarkSuite {
    const suiteNameMap: Record<string, 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3'> = {
      RE1: 'rcaeval-re1',
      RE2: 'rcaeval-re2',
      RE3: 'rcaeval-re3',
    };

    const datasetName = suiteNameMap[suite.suiteName] ?? 'rcaeval-re1';
    const cases = suite.cases.map((c) => {
      const graph = callGraphs[c.benchmark] ?? this.buildFallbackCallGraph(c);
      return this.toBenchmarkCase(c, graph, datasetName);
    });

    return {
      name: datasetName,
      cases,
      totalCases: cases.length,
    };
  }

  // ── Private Helpers ─────────────────────────────────────

  private parseDirectoryName(dirName: string): ParsedDirName {
    // Pattern: re{1-3}{ob|ss|tt}_{service}_{fault}_{instance}
    // Fault types include named (cpu, mem, disk, delay, loss, socket, network, error)
    // and RE3 generic labels (f1, f2, f3, f4, f5).
    const regexMatch = dirName.match(/^(re[123][a-z]{2})_(.+?)_([a-z][a-z0-9]+)_(\d+)$/i);
    if (regexMatch) {
      return {
        benchmark: regexMatch[1]!,
        service: regexMatch[2]!,
        fault: regexMatch[3]!.toLowerCase(),
        instance: parseInt(regexMatch[4]!, 10),
      };
    }

    // Fallback: simple underscore splitting for standard naming
    // Format: {benchmark}_{service}_{fault}_{instance}
    // where benchmark may contain underscores (e.g. re1ob, re2_ss_re)
    const parts = dirName.split('_');
    if (parts.length < 4) {
      throw new Error(
        `Invalid RCAEval directory name: ${dirName}. Expected {benchmark}_{service}_{fault}_{instance}`,
      );
    }
    const instance = parseInt(parts[parts.length - 1]!, 10);
    if (isNaN(instance)) {
      throw new Error(
        `Invalid RCAEval directory name: ${dirName}. Instance is not a number: ${parts[parts.length - 1]}`,
      );
    }
    const fault = parts[parts.length - 2]!;
    const service = parts[parts.length - 3]!;
    const benchmark = parts.slice(0, parts.length - 3).join('_');

    return { benchmark, service, fault, instance };
  }

  private loadMetricsJson(metricsPath: string): Record<string, ReadonlyArray<RCAEvalMetricPoint>> {
    if (!fs.existsSync(metricsPath)) {
      throw new Error(`Metrics file not found: ${metricsPath}`);
    }
    try {
      const raw: Record<string, ReadonlyArray<RCAEvalMetricPoint>> = JSON.parse(
        fs.readFileSync(metricsPath, 'utf-8'),
      );
      // Validate that the JSON has the expected structure (object with service keys)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length === 0) {
        throw new Error(`Metrics file ${metricsPath} is empty or has unexpected format`);
      }
      // Validate at least one service has metric points
      const validServiceCount = Object.values(raw).filter(
        (v) => Array.isArray(v) && v.length > 0,
      ).length;
      if (validServiceCount === 0) {
        throw new Error(`Metrics file ${metricsPath} has no valid service entries`);
      }
      return raw;
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error(`Metrics file ${metricsPath} is not valid JSON: ${err.message}`);
      }
      throw err;
    }
  }

  private loadInjectTime(injectTimePath: string): number {
    if (!fs.existsSync(injectTimePath)) {
      throw new Error(`Inject time file not found: ${injectTimePath}`);
    }
    const raw = fs.readFileSync(injectTimePath, 'utf-8').trim();
    const time = parseInt(raw, 10);
    if (isNaN(time)) {
      throw new Error(`Invalid inject time: ${raw}`);
    }
    return time;
  }

  private tryLoadInjectTime(casePath: string): number {
    const injectTimePath = path.join(casePath, 'inject_time.txt');
    if (!fs.existsSync(injectTimePath)) return 0;

    try {
      const raw = fs.readFileSync(injectTimePath, 'utf-8').trim();
      const time = parseInt(raw, 10);
      if (isNaN(time)) return 0;
      return time;
    } catch {
      return 0;
    }
  }

  private tryLoadLogs(casePath: string): ReadonlyArray<BenchmarkLogEntry> | undefined {
    const logsPath = path.join(casePath, 'logs.csv');
    if (!fs.existsSync(logsPath)) return undefined;

    try {
      const content = fs.readFileSync(logsPath, 'utf-8');
      const rows = this.parseCSV(content);
      if (rows.length === 0) return undefined;

      // RCAEval's logs.csv carries `timestamp, service, message` (paper §3.4)
      // with NO level/severity column — severity must be derived from the log
      // MESSAGE text (stack traces / error keywords). Detect columns flexibly
      // so both the original CSV layout and any Parquet-derived variant work.
      const header = Object.keys(rows[0]!);
      this.lastLogHeader = header.join(',');
      const tsCol = header.find((h) => ['timestamp', 'time', 'ts', 't'].includes(h.toLowerCase()));
      const svcCol = header.find((h) => SERVICE_COLUMN_ALIASES.has(h.toLowerCase()));
      const msgCol = header.find((h) =>
        ['message', 'msg', 'content', 'log', 'text', 'line'].includes(h.toLowerCase()),
      );
      const lvlCol = header.find((h) =>
        ['level', 'severity', 'log_level', 'loglevel'].includes(h.toLowerCase()),
      );

      return rows.map((row) => {
        const message = msgCol ? (row[msgCol] ?? '') : '';
        const explicitLevel = lvlCol ? (row[lvlCol] ?? '').toUpperCase() : '';
        const level = classifyLogLevel(explicitLevel, message);
        // RCAEval logs.csv timestamps are Unix SECONDS (same domain as
        // inject_time) but some cases carry NANOSECONDS (~1.7e18). The unified
        // BenchmarkCase carries time in MILLISECONDS, so magnitude-detect:
        // |ts| > 1e15 is nanoseconds → divide by 1e6 (ns→ms); otherwise treat
        // as seconds → multiply by 1000. This keeps the post-injection filter
        // (`timestamp >= injectTimeMs`) comparing like-for-like.
        const rawTs = tsCol ? parseInt(row[tsCol] ?? '0', 10) : 0;
        const timestampMs = Math.abs(rawTs) > 1e15 ? Math.floor(rawTs / 1e6) : rawTs * 1000;
        return {
          timestamp: timestampMs,
          service: svcCol ? (row[svcCol] ?? 'unknown') : 'unknown',
          message,
          level,
          isStackTrace: isStackTraceMessage(message),
          isLogicException: isLogicExceptionMessage(message),
          // Only error/fatal lines carry a root-cause exception worth ranking
          // on; INFO/WARN/DEBUG lines are skipped to avoid a regex pass over
          // the (dominant) non-error volume of large RE2/RE3 log files.
          deepestExceptionClass:
            level === 'ERROR' || level === 'FATAL'
              ? extractDeepestExceptionClass(message)
              : undefined,
        };
      });
    } catch {
      return undefined;
    }
  }

  private tryLoadTraces(
    casePath: string,
    maxSpans = 10_000,
  ): ReadonlyArray<BenchmarkTraceSpan> | undefined {
    const tracesPath = path.join(casePath, 'traces.csv');
    if (!fs.existsSync(tracesPath)) return undefined;

    try {
      // Read only the prefix needed for `maxSpans` data rows (plus the
      // header). Each CSV line is ~150–200 bytes; capping the read keeps a
      // multi-megabyte traces.csv from ever being fully loaded into memory.
      const maxBytes = (maxSpans + 1) * 256;
      const content = readFilePrefix(tracesPath, maxBytes);
      const rows = this.parseCSV(content, maxSpans);
      if (rows.length === 0) return undefined;

      // RCAEval traces.csv uses Jaeger CAMELCASE columns (traceId, spanId,
      // parentSpanId, serviceName, operationName, startTime, duration) — NOT
      // the snake_case `service`/`status`/`trace_id` the original parser
      // assumed. Detect the service and status columns by header alias (as
      // tryLoadLogs does), so spans are attributed to the right service and
      // the error response code is actually read.
      const header = Object.keys(rows[0]!);
      this.lastTraceHeader = header.join(',');
      const svcCol = header.find((h) => SERVICE_COLUMN_ALIASES.has(h.toLowerCase()));
      const statusCol = header.find((h) => STATUS_COLUMN_ALIASES.has(h.toLowerCase()));

      return rows.map((row) => {
        const service = svcCol ? (row[svcCol] ?? 'unknown') : 'unknown';
        return {
          traceId: row.trace_id ?? row.traceId ?? row.traceID ?? row.traceid ?? 'unknown',
          spanId:
            row.span_id ??
            row.spanId ??
            row.spanID ??
            row.spanid ??
            `${row.trace_id ?? 'unknown'}_${service}`,
          parentSpanId:
            row.parent_span ??
            row.parentSpanId ??
            row.parentSpanID ??
            row.parent_span_id ??
            row.parentSpan ??
            undefined,
          service,
          operationName: row.operation ?? row.operationName ?? 'unknown',
          startTime: normalizeTraceStartTimeMs(row),
          duration: parseInt(row.duration ?? '0', 10),
          status: normalizeSpanStatus(statusCol ? row[statusCol] : undefined),
        };
      });
    } catch {
      return undefined;
    }
  }

  /**
   * Load trace spans for a single case directory without re-reading metrics.
   *
   * RE2/RE3 traces.csv files are large (100K+ spans per case; TrainTicket
   * can exceed a million), so callers that need per-case traces for trace
   * topology augmentation should load them lazily (one case at a time) and
   * release them after use. `maxSpans` bounds the number of parsed spans so
   * a single case cannot OOM the heap — topology validation only needs
   * enough spans to confirm parent→child edges, not the full trace history.
   *
   * @param casePath - Path to the case directory.
   * @param maxSpans - Maximum spans to load (default 10000).
   * @returns Parsed trace spans, or undefined if traces.csv is absent.
   */
  loadTraces(casePath: string, maxSpans = 10_000): ReadonlyArray<BenchmarkTraceSpan> | undefined {
    return this.tryLoadTraces(casePath, maxSpans);
  }

  private parseCSV(content: string, maxRows?: number): Record<string, string>[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0]!.split(',').map((h) => h.trim());
    const rows: Record<string, string>[] = [];
    const limit = maxRows !== undefined ? Math.min(maxRows, lines.length - 1) : lines.length - 1;

    for (let i = 1; i <= limit; i++) {
      const values = lines[i]!.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]!] = values[j] ?? '';
      }
      rows.push(row);
    }

    return rows;
  }

  private buildMetricMap(rawMetrics: Record<string, ReadonlyArray<RCAEvalMetricPoint>>): MetricMap {
    const map = new Map<string, readonly TimeSeries[]>();

    for (const [serviceName, points] of Object.entries(rawMetrics)) {
      // Group points by metric_name
      const byMetric = new Map<string, { timestamps: number[]; values: number[] }>();
      for (const p of points) {
        let entry = byMetric.get(p.metric_name);
        if (!entry) {
          entry = { timestamps: [], values: [] };
          byMetric.set(p.metric_name, entry);
        }
        entry.timestamps.push(p.timestamp * 1000); // Convert to ms
        entry.values.push(p.value);
      }

      const timeSeries: TimeSeries[] = [];
      for (const [metricName, data] of byMetric) {
        // Sort by timestamp
        const sorted = data.timestamps.map((t, i) => ({ t, v: data.values[i]! }));
        sorted.sort((a, b) => a.t - b.t);

        timeSeries.push({
          label: metricName,
          timestamps: sorted.map((s) => s.t),
          values: new Float64Array(sorted.map((s) => s.v!)),
          unit: this.inferUnit(metricName),
        });
      }

      map.set(serviceName, timeSeries);
    }

    return map;
  }

  private inferUnit(metricName: string): string {
    const lower = metricName.toLowerCase();
    if (lower.includes('cpu')) return 'percent';
    if (lower.includes('mem') || lower.includes('memory')) return 'bytes';
    if (lower.includes('disk')) return 'iops';
    if (lower.includes('latency') || lower.includes('delay')) return 'ms';
    if (lower.includes('loss') || lower.includes('error')) return 'rate';
    return 'count';
  }

  private buildFallbackCallGraph(rawCase: RCAEvalCase): ServiceCallGraph {
    const serviceIds = Object.keys(rawCase.metrics);
    const nodes = new Map<string, ServiceNode>();
    for (const id of serviceIds) {
      nodes.set(id, {
        id,
        name: id,
        namespace: rawCase.benchmark,
        labels: {},
      });
    }

    const edges: CallEdge[] = [];
    if (serviceIds.length > 1) {
      // Create a simple chain: svc[0] -> svc[1] -> ... -> svc[N-1]
      for (let i = 1; i < serviceIds.length; i++) {
        edges.push({
          from: serviceIds[i - 1]!,
          to: serviceIds[i]!,
          type: 'REST',
          callRate: 100,
          p99Latency: 50,
          errorRate: 0.01,
        });
      }
    }

    return {
      nodes,
      edges,
      systemLoad: 0.5,
    };
  }
}

// ── Internal Types ────────────────────────────────────────

interface ParsedDirName {
  benchmark: string;
  service: string;
  fault: string;
  instance: number;
}

interface RCAEvalMetricPoint {
  timestamp: number;
  value: number;
  metric_name: string;
}

/**
 * Stream-scan the ENTIRE traces.csv and return per-service pre/post span
 * counts without retaining raw spans.
 *
 * Unlike tryLoadTraces (which uses readFilePrefix + maxSpans and therefore
 * truncates before the post-injection window), this reads the WHOLE file (up
 * to ~27MB / ~178k spans) so the trace-activity rise signal sees the full
 * post-injection window. Each span is reduced to its service id + start time
 * and discarded, collapsing ~178k spans to a handful of {pre, post} pairs.
 *
 * @param tracesPath - Absolute path to traces.csv.
 * @param injectTimeMs - Fault injection time in Unix milliseconds.
 * @returns A map from service id to {pre, post} span counts (empty on error).
 */
export async function countTraceActivityByService(
  tracesPath: string,
  injectTimeMs: number,
): Promise<ReadonlyMap<string, TraceActivityCounts>> {
  const counts = new Map<string, { pre: number; post: number }>();

  let content: string;
  try {
    content = await fs.promises.readFile(tracesPath, 'utf-8');
  } catch {
    return counts;
  }

  const lines = content.split('\n');
  if (lines.length < 2) return counts;

  // Same service-column extraction as tryLoadTraces: header alias detection,
  // falling back to 'unknown' when the column is absent or empty.
  const header = lines[0]!.split(',').map((h) => h.trim());
  const svcCol = header.find((h) => SERVICE_COLUMN_ALIASES.has(h.toLowerCase()));

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const values = line.split(',').map((v) => v.trim());
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]!] = values[j] ?? '';
    }

    const service = svcCol ? (row[svcCol] ?? 'unknown') : 'unknown';
    const startTimeMs = normalizeTraceStartTimeMs(row);

    const entry = counts.get(service) ?? { pre: 0, post: 0 };
    if (startTimeMs < injectTimeMs) entry.pre += 1;
    else entry.post += 1;
    counts.set(service, entry);
  }

  return counts;
}

/**
 * Read the first `maxBytes` bytes of a file as UTF-8.
 *
 * Used to load a bounded prefix of traces.csv so a multi-megabyte file is
 * never fully read into memory — the caller only needs enough rows for
 * topology validation, not the entire trace history.
 */
function readFilePrefix(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf-8', 0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}
