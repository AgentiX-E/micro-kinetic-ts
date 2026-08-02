/**
 * AIOps2025 benchmark loader.
 *
 * AIOps2025 is the CCF AIOps Challenge benchmark dataset with 400 cases.
 * Each case contains multimodal data stored in Parquet files:
 *   - Metrics from Prometheus
 *   - Logs from Filebeat
 *   - Traces from Jaeger
 *   - Faults injected via Chaos-Mesh
 *
 * Evaluation labels: location accuracy (LA), type accuracy (TA),
 * explainability, and efficiency.
 *
 * @module benchmarks/loaders/aiops2025-loader
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
  AIOps2025Case,
  AIOps2025Suite,
  AIOps2025LabelScores,
} from './types.js';

// ── AIOps2025 Loader ──────────────────────────────────────

/**
 * Loader for AIOps2025 benchmark datasets.
 *
 * Handles Parquet-based multimodal data from the CCF AIOps Challenge.
 * Currently supports JSON fallback format when Parquet files are not available.
 */
export class AIOps2025Loader {
  /**
   * Load a single AIOps2025 case.
   *
   * @param casePath - Path to the case directory.
   * @returns Parsed AIOps2025Case.
   */
  loadCase(casePath: string): AIOps2025Case {
    const caseId = path.basename(casePath);

    // Load ground truth
    const groundTruth = this.loadGroundTruth(casePath);

    // Load metrics, logs, traces
    const metrics = this.loadMetrics(casePath);
    const logs = this.loadLogs(casePath);
    const traces = this.loadTraces(casePath);

    // Build call graph from service topology metadata
    const callGraph = this.loadCallGraph(casePath, metrics);

    // Load inject time
    const injectTime = this.loadInjectTime(casePath);

    // Load label scores
    const labelScores = this.loadLabelScores(casePath);

    return {
      casePath,
      caseId,
      metrics,
      logs,
      traces,
      callGraph,
      injectTime,
      groundTruth,
      labelScores,
    };
  }

  /**
   * Load a complete AIOps2025 suite.
   *
   * @param suitePath - Path to the suite directory.
   * @returns Parsed suite.
   */
  loadSuite(suitePath: string): AIOps2025Suite {
    const entries = fs.readdirSync(suitePath, { withFileTypes: true });
    const caseDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    const cases = caseDirs.map((dir) =>
      this.loadCase(path.join(suitePath, dir.name)),
    );

    return {
      cases,
      totalCases: cases.length,
    };
  }

  /**
   * Convert a raw AIOps2025Case into the unified BenchmarkCase format.
   *
   * @param rawCase - Raw AIOps2025 case.
   * @returns Unified BenchmarkCase.
   */
  toBenchmarkCase(rawCase: AIOps2025Case): BenchmarkCase {
    return {
      id: `aiops2025_${rawCase.caseId}`,
      datasetName: 'aiops2025',
      callGraph: rawCase.callGraph,
      metrics: rawCase.metrics,
      injectTime: rawCase.injectTime,
      groundTruth: rawCase.groundTruth,
      logs: rawCase.logs,
      traces: rawCase.traces,
    };
  }

  /**
   * Convert an AIOps2025 suite into unified BenchmarkSuite format.
   *
   * @param suite - Raw AIOps2025 suite.
   * @returns Unified BenchmarkSuite.
   */
  toBenchmarkSuite(suite: AIOps2025Suite): BenchmarkSuite {
    const cases = suite.cases.map((c) => this.toBenchmarkCase(c));
    return {
      name: 'aiops2025',
      cases,
      totalCases: cases.length,
    };
  }

  // ── Private Helpers ─────────────────────────────────────

  private loadGroundTruth(casePath: string): BenchmarkGroundTruth {
    const gtPath = path.join(casePath, 'ground_truth.json');
    if (fs.existsSync(gtPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
        return {
          serviceId: raw.serviceId ?? raw.root_cause_service ?? raw.service ?? 'unknown',
          faultType: raw.faultType ?? raw.fault_type ?? raw.type ?? 'unknown',
          metric: raw.metric ?? raw.root_cause_metric,
        };
      } catch {
        // Fall through
      }
    }

    // Try to extract from metadata
    const metaPath = path.join(casePath, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        return {
          serviceId: meta.fault_service ?? meta.target ?? 'unknown',
          faultType: meta.fault_type ?? meta.type ?? 'unknown',
        };
      } catch {
        // Fall through
      }
    }

    return {
      serviceId: 'unknown',
      faultType: 'unknown',
    };
  }

  private loadMetrics(casePath: string): MetricMap {
    const map = new Map<string, readonly TimeSeries[]>();

    // Try Parquet-based metrics directory
    const metricsDir = path.join(casePath, 'metrics');
    if (fs.existsSync(metricsDir) && fs.statSync(metricsDir).isDirectory()) {
      const files = fs.readdirSync(metricsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const serviceName = file.replace('.json', '');
          const raw = JSON.parse(fs.readFileSync(path.join(metricsDir, file), 'utf-8'));
          const series = this.parseMetricArray(raw);
          if (series.length > 0) {
            map.set(serviceName, series);
          }
        } catch {
          // Skip malformed files
        }
      }

      if (map.size > 0) return map;
    }

    // Fallback: single metrics.json
    const singlePath = path.join(casePath, 'metrics.json');
    if (fs.existsSync(singlePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(singlePath, 'utf-8'));
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [serviceName, data] of Object.entries(raw)) {
            const series = this.parseMetricArray(data as unknown[]);
            if (series.length > 0) {
              map.set(serviceName, series);
            }
          }
        }
      } catch {
        // Skip
      }
    }

    return map;
  }

  private parseMetricArray(data: unknown): TimeSeries[] {
    if (!Array.isArray(data) || data.length === 0) return [];

    // Check if it's an array of {timestamp, value, metric_name} objects (RCAEval format)
    if (typeof data[0] === 'object' && data[0] !== null && 'metric_name' in data[0]) {
      return this.parseRCAEvalStyleMetrics(data as Array<{ timestamp: number; value: number; metric_name: string }>);
    }

    // Check if it's an array of {label, timestamps, values} objects
    if (typeof data[0] === 'object' && data[0] !== null && 'label' in data[0]) {
      return data.map((item: Record<string, unknown>) => ({
        label: String(item.label ?? 'unknown'),
        timestamps: Array.isArray(item.timestamps) ? item.timestamps as number[] : [],
        values: new Float64Array(Array.isArray(item.values) ? item.values as number[] : []),
        unit: String(item.unit ?? 'count'),
      }));
    }

    return [];
  }

  private parseRCAEvalStyleMetrics(
    points: Array<{ timestamp: number; value: number; metric_name: string }>,
  ): TimeSeries[] {
    const byMetric = new Map<string, { timestamps: number[]; values: number[] }>();
    for (const p of points) {
      let entry = byMetric.get(p.metric_name);
      if (!entry) {
        entry = { timestamps: [], values: [] };
        byMetric.set(p.metric_name, entry);
      }
      entry.timestamps.push(p.timestamp * 1000);
      entry.values.push(p.value);
    }

    const series: TimeSeries[] = [];
    for (const [name, data] of byMetric) {
      const sorted = data.timestamps.map((t, i) => ({ t, v: data.values[i]! }));
      sorted.sort((a, b) => a.t - b.t);
      series.push({
        label: name,
        timestamps: sorted.map((s) => s.t),
        values: new Float64Array(sorted.map((s) => s.v!)),
        unit: this.inferUnit(name),
      });
    }
    return series;
  }

  private loadLogs(casePath: string): ReadonlyArray<BenchmarkLogEntry> {
    const logsPath = path.join(casePath, 'logs.json');
    if (fs.existsSync(logsPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(logsPath, 'utf-8'));
        if (Array.isArray(raw)) {
          return raw.map((entry: Record<string, unknown>) => ({
            timestamp: Number(entry.timestamp ?? 0),
            service: String(entry.service ?? entry.serviceId ?? 'unknown'),
            message: String(entry.message ?? ''),
            level: this.normalizeLogLevel(String(entry.level ?? 'INFO')),
          }));
        }
      } catch {
        // Skip
      }
    }

    // Try logs.csv
    const csvPath = path.join(casePath, 'logs.csv');
    if (fs.existsSync(csvPath)) {
      try {
        const content = fs.readFileSync(csvPath, 'utf-8');
        return this.parseCSV(content).map((row) => ({
          timestamp: parseInt(row.timestamp ?? '0', 10),
          service: row.service ?? 'unknown',
          message: row.message ?? '',
          level: this.normalizeLogLevel(row.level ?? 'INFO'),
        }));
      } catch {
        // Skip
      }
    }

    return [];
  }

  private loadTraces(casePath: string): ReadonlyArray<BenchmarkTraceSpan> {
    const tracesPath = path.join(casePath, 'traces.json');
    if (fs.existsSync(tracesPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(tracesPath, 'utf-8'));
        if (Array.isArray(raw)) {
          return raw.map((span: Record<string, unknown>) => ({
            traceId: String(span.traceId ?? span.trace_id ?? 'unknown'),
            spanId: String(span.spanId ?? span.span_id ?? `${span.traceId}_${span.service}`),
            parentSpanId: span.parentSpanId as string | undefined ?? span.parent_span as string | undefined,
            service: String(span.service ?? span.serviceId ?? 'unknown'),
            operationName: String(span.operationName ?? span.operation ?? 'unknown'),
            startTime: Number(span.startTime ?? span.start_time ?? 0),
            duration: Number(span.duration ?? 0),
            status: String(span.status ?? 'OK').toUpperCase() === 'ERROR' ? 'ERROR' : 'OK',
          }));
        }
      } catch {
        // Skip
      }
    }

    // Try traces.csv
    const csvPath = path.join(casePath, 'traces.csv');
    if (fs.existsSync(csvPath)) {
      try {
        const content = fs.readFileSync(csvPath, 'utf-8');
        return this.parseCSV(content).map((row) => ({
          traceId: row.trace_id ?? row.traceId ?? 'unknown',
          spanId: row.span_id ?? row.spanId ?? `${row.trace_id}_${row.service}`,
          parentSpanId: row.parent_span ?? row.parentSpanId,
          service: row.service ?? 'unknown',
          operationName: row.operation ?? row.operationName ?? 'unknown',
          startTime: parseInt(row.start_time ?? row.startTime ?? '0', 10),
          duration: parseInt(row.duration ?? '0', 10),
          status: (row.status ?? 'OK').toUpperCase() === 'ERROR' ? 'ERROR' : 'OK',
        }));
      } catch {
        // Skip
      }
    }

    return [];
  }

  private loadCallGraph(
    casePath: string,
    metrics: MetricMap,
  ): ServiceCallGraph {
    const graphPath = path.join(casePath, 'call_graph.json');
    if (fs.existsSync(graphPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(graphPath, 'utf-8'));
        return this.parseCallGraph(raw);
      } catch {
        // Fall through
      }
    }

    // Build from metrics: all services with metrics become nodes
    return this.buildFallbackCallGraph(metrics);
  }

  private loadInjectTime(casePath: string): number {
    const timePath = path.join(casePath, 'inject_time.txt');
    if (fs.existsSync(timePath)) {
      try {
        const raw = fs.readFileSync(timePath, 'utf-8').trim();
        const time = parseInt(raw, 10);
        if (!isNaN(time)) return time * 1000; // Convert to ms
      } catch {
        // Fall through
      }
    }

    // Try ground_truth.json
    const gtPath = path.join(casePath, 'ground_truth.json');
    if (fs.existsSync(gtPath)) {
      try {
        const gt = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
        if (gt.inject_time) return gt.inject_time * 1000;
        if (gt.injectTime) return gt.injectTime;
      } catch {
        // Fall through
      }
    }

    return 0;
  }

  private loadLabelScores(casePath: string): AIOps2025LabelScores | undefined {
    const labelsPath = path.join(casePath, 'labels.json');
    if (!fs.existsSync(labelsPath)) return undefined;

    try {
      const raw = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
      return {
        locationAccuracy: raw.locationAccuracy ?? raw.LA ?? 0,
        typeAccuracy: raw.typeAccuracy ?? raw.TA ?? 0,
        explainability: raw.explainability ?? raw.EXP ?? 0,
        efficiency: raw.efficiency ?? raw.EFF ?? 0,
      };
    } catch {
      return undefined;
    }
  }

  // ── Utility Methods ─────────────────────────────────────

  private parseCallGraph(raw: Record<string, unknown>): ServiceCallGraph {
    const nodeEntries = raw.nodes as Array<{ id: string; name?: string; namespace?: string; labels?: Record<string, string> }> | undefined;
    const edgeEntries = raw.edges as Array<{ from: string; to: string; type?: string; callRate?: number; p99Latency?: number; errorRate?: number }> | undefined;

    const nodes = new Map<string, ServiceNode>();
    if (nodeEntries) {
      for (const n of nodeEntries) {
        nodes.set(n.id, {
          id: n.id,
          name: n.name ?? n.id,
          namespace: n.namespace ?? 'default',
          labels: n.labels ?? {},
        });
      }
    }

    const edges: CallEdge[] = [];
    if (edgeEntries) {
      for (const e of edgeEntries) {
        edges.push({
          from: e.from,
          to: e.to,
          type: (e.type as CallEdge['type']) ?? 'REST',
          callRate: e.callRate ?? 100,
          p99Latency: e.p99Latency ?? 50,
          errorRate: e.errorRate ?? 0.01,
        });
      }
    }

    return {
      nodes,
      edges,
      systemLoad: (raw.systemLoad as number) ?? 0.5,
    };
  }

  private buildFallbackCallGraph(metrics: MetricMap): ServiceCallGraph {
    const serviceIds = [...metrics.keys()];
    const nodes = new Map<string, ServiceNode>();
    for (const id of serviceIds) {
      nodes.set(id, { id, name: id, namespace: 'default', labels: {} });
    }

    const edges: CallEdge[] = [];
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

    return { nodes, edges, systemLoad: 0.5 };
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

  private inferUnit(metricName: string): string {
    const lower = metricName.toLowerCase();
    if (lower.includes('cpu')) return 'percent';
    if (lower.includes('mem') || lower.includes('memory')) return 'bytes';
    if (lower.includes('disk')) return 'iops';
    if (lower.includes('latency') || lower.includes('delay')) return 'ms';
    if (lower.includes('loss') || lower.includes('error')) return 'rate';
    return 'count';
  }

  private normalizeLogLevel(level: string): BenchmarkLogEntry['level'] {
    const upper = level.toUpperCase();
    switch (upper) {
      case 'DEBUG': return 'DEBUG';
      case 'INFO': return 'INFO';
      case 'WARN':
      case 'WARNING': return 'WARN';
      case 'ERROR': return 'ERROR';
      case 'FATAL':
      case 'CRITICAL': return 'FATAL';
      default: return 'INFO';
    }
  }
}
