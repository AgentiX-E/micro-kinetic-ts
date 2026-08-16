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
 * Normalise a raw log line into a `BenchmarkLogEntry` severity level.
 *
 * RCAEval's logs.csv has NO level/severity column — each row is just
 * `timestamp, service, message` (paper §3.4), and the root cause of a
 * code-level fault (RE3) is diagnosed from the STACK TRACES / error text in
 * the message. When an explicit level column IS present it takes precedence;
 * otherwise the severity is derived from message keywords (case-insensitive).
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

  // No (or unrecognised) explicit level → derive from the message text.
  const lower = message.toLowerCase();
  if (/(fatal|panic|traceback|stack ?trace)/.test(lower)) return 'FATAL';
  if (/(error|exception|failed|failure)/.test(lower)) return 'ERROR';
  if (/(warn|warning)/.test(lower)) return 'WARN';
  return 'INFO';
}

/**
 * Detect whether a log message carries a STACK-TRACE signature — the marker of
 * a code-level fault (RCAEval RE3), as opposed to a resource/network cascade
 * (RE2) whose errors are plain "connection refused" / "timeout" lines.
 *
 * A message is a stack trace when it contains a stack frame (`at
 * com.foo.Bar.baz(Bar.java:42)` or Python `File "x.py", line N`), a Java
 * exception class name (`NullPointerException`), a `Caused by:` chain, or a
 * `Traceback` / `stack trace` header.
 *
 * This is independent of `classifyLogLevel`: a message can be ERROR without
 * being a stack trace (e.g. "connection refused"), and vice versa.
 *
 * @param message - The raw log message text.
 * @returns True when the message looks like a stack trace.
 */
export function isStackTraceMessage(message: string): boolean {
  return (
    /traceback|stack ?trace/i.test(message) ||
    /Caused by:/.test(message) ||
    /\w+Exception\b/.test(message) ||
    /at\s+[\w.$]+\.[\w$]+\([^)]*:\d+\)/.test(message) ||
    /File\s+"[^"]+",\s*line\s+\d+/i.test(message)
  );
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
      const svcCol = header.find((h) =>
        [
          'service',
          'svc',
          'service_name',
          'service_id',
          'serviceid',
          'svc_name',
          'svcname',
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
        ].includes(h.toLowerCase()),
      );
      const msgCol = header.find((h) =>
        ['message', 'msg', 'content', 'log', 'text', 'line'].includes(h.toLowerCase()),
      );
      const lvlCol = header.find((h) =>
        ['level', 'severity', 'log_level', 'loglevel'].includes(h.toLowerCase()),
      );

      return rows.map((row) => {
        const message = msgCol ? (row[msgCol] ?? '') : '';
        const explicitLevel = lvlCol ? (row[lvlCol] ?? '').toUpperCase() : '';
        return {
          // RCAEval timestamps are Unix SECONDS (same domain as inject_time),
          // while the unified BenchmarkCase carries time in MILLISECONDS.
          // Convert to ms so the log signal's post-injection filter
          // (`timestamp >= injectTimeMs`) compares like-for-like.
          timestamp: (tsCol ? parseInt(row[tsCol] ?? '0', 10) : 0) * 1000,
          service: svcCol ? (row[svcCol] ?? 'unknown') : 'unknown',
          message,
          level: classifyLogLevel(explicitLevel, message),
          isStackTrace: isStackTraceMessage(message),
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
      return rows.map((row) => ({
        traceId: row.trace_id ?? 'unknown',
        spanId:
          row.span_id ?? row.spanId ?? `${row.trace_id ?? 'unknown'}_${row.service ?? 'unknown'}`,
        parentSpanId:
          row.parent_span ?? row.parentSpanId ?? row.parent_span_id ?? row.parentSpan ?? undefined,
        service: row.service ?? 'unknown',
        operationName: row.operation ?? row.operationName ?? 'unknown',
        startTime: parseInt(row.start_time ?? row.startTime ?? row.timestamp ?? '0', 10),
        duration: parseInt(row.duration ?? '0', 10),
        status: row.status === 'ERROR' ? 'ERROR' : 'OK',
      }));
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
