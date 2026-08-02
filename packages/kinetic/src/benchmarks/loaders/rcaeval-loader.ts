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
 *     ├── logs.csv        — timestamp,service,message,level (RE2/RE3 only)
 *     ├── traces.csv      — trace_id,service,duration,status,parent_span (RE2/RE3 only)
 *     └── ground_truth.json — {root_cause_service, root_cause_metric}
 *
 * @module benchmarks/loaders/rcaeval-loader
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  ServiceCallGraph,
  ServiceNode,
  CallEdge,
  TimeSeries,
  MetricMap,
} from '@agentix-e/micro-kinetic-core';

import type {
  BenchmarkCase,
  BenchmarkSuite,
  BenchmarkGroundTruth,
  BenchmarkLogEntry,
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
export class RCAEvalLoader {
  /**
   * Load a single RCAEval case from a directory.
   *
   * @param casePath - Path to the case directory.
   * @returns Parsed RCAEvalCase structure.
   */
  loadCase(casePath: string): RCAEvalCase {
    const dirName = path.basename(casePath);
    const parsed = this.parseDirectoryName(dirName);

    // Load metrics JSON
    const metricsPath = path.join(casePath, 'metrics.json');
    const metrics = this.loadMetricsJson(metricsPath);

    // Load inject time
    const injectTimePath = path.join(casePath, 'inject_time.txt');
    const injectTime = this.loadInjectTime(injectTimePath);

    // Load ground truth
    const groundTruth = this.getGroundTruth(casePath, parsed);

    // Load optional multimodal data
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

    const cases = caseDirs.map((dir) =>
      this.loadCase(path.join(suitePath, dir.name)),
    );

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
          faultType: raw.root_cause_metric ?? raw.rootCauseMetric ?? raw.faultType ?? parsed?.fault ?? 'unknown',
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
  toBenchmarkCase(rawCase: RCAEvalCase, callGraph: ServiceCallGraph, suiteName: 'rcaeval-re1' | 'rcaeval-re2' | 'rcaeval-re3'): BenchmarkCase {
    const metricMap = this.buildMetricMap(rawCase.metrics);

    return {
      id: `${suiteName}_${rawCase.benchmark}_${rawCase.service}_${rawCase.fault}_${rawCase.instance}`,
      datasetName: suiteName,
      callGraph,
      metrics: metricMap,
      injectTime: rawCase.injectTime * 1000, // Convert seconds to ms
      groundTruth: rawCase.groundTruth,
      logs: rawCase.logs,
      traces: rawCase.traces,
    };
  }

  /**
   * Convert an entire RCAEval suite into unified BenchmarkSuite format.
   *
   * @param suite - Raw RCAEval suite.
   * @param callGraphs - Service call graphs for each benchmark system.
   * @returns Unified BenchmarkSuite.
   */
  toBenchmarkSuite(suite: RCAEvalSuite, callGraphs: Record<string, ServiceCallGraph>): BenchmarkSuite {
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
    const parts = dirName.split('_');
    if (parts.length < 4) {
      throw new Error(`Invalid RCAEval directory name: ${dirName}. Expected {benchmark}_{service}_{fault}_{instance}`);
    }
    const instance = parseInt(parts[parts.length - 1]!, 10);
    const fault = parts[parts.length - 2]!;
    const service = parts[parts.length - 3]!;
    const benchmark = parts.slice(0, parts.length - 3).join('_');

    return { benchmark, service, fault, instance };
  }

  private loadMetricsJson(metricsPath: string): Record<string, ReadonlyArray<RCAEvalMetricPoint>> {
    if (!fs.existsSync(metricsPath)) {
      throw new Error(`Metrics file not found: ${metricsPath}`);
    }
    const raw: Record<string, ReadonlyArray<RCAEvalMetricPoint>> = JSON.parse(
      fs.readFileSync(metricsPath, 'utf-8'),
    );
    return raw;
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

  private tryLoadLogs(casePath: string): ReadonlyArray<BenchmarkLogEntry> | undefined {
    const logsPath = path.join(casePath, 'logs.csv');
    if (!fs.existsSync(logsPath)) return undefined;

    try {
      const content = fs.readFileSync(logsPath, 'utf-8');
      return this.parseCSV(content).map((row) => ({
        timestamp: parseInt(row.timestamp ?? '0', 10),
        service: row.service ?? 'unknown',
        message: row.message ?? '',
        level: (row.level?.toUpperCase() as BenchmarkLogEntry['level']) ?? 'INFO',
      }));
    } catch {
      return undefined;
    }
  }

  private tryLoadTraces(casePath: string): ReadonlyArray<BenchmarkTraceSpan> | undefined {
    const tracesPath = path.join(casePath, 'traces.csv');
    if (!fs.existsSync(tracesPath)) return undefined;

    try {
      const content = fs.readFileSync(tracesPath, 'utf-8');
      return this.parseCSV(content).map((row) => ({
        traceId: row.trace_id ?? 'unknown',
        spanId: row.span_id ?? row.spanId ?? `${row.trace_id ?? 'unknown'}_${row.service ?? 'unknown'}`,
        parentSpanId: row.parent_span ?? row.parentSpanId ?? undefined,
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

  private parseCSV(content: string): Record<string, string>[] {
    const lines = content.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0]!.split(',').map((h) => h.trim());
    const rows: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]!.split(',').map((v) => v.trim());
      const row: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        row[headers[j]!] = values[j] ?? '';
      }
      rows.push(row);
    }

    return rows;
  }

  private buildMetricMap(
    rawMetrics: Record<string, ReadonlyArray<RCAEvalMetricPoint>>,
  ): MetricMap {
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
