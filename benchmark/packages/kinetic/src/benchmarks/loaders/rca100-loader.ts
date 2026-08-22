/**
 * RCA100 benchmark loader.
 *
 * RCA100 is the Tianchi AIOps Track benchmark with 103 cases.
 * Each case contains structured alert events and 6 modalities:
 *   - metrics, logs, traces, events, alerts, topology
 *
 * Ground truth uses a 4-layer format:
 *   L1: fault_type
 *   L2: target_entity (service/node)
 *   L3: causal_chain (ordered propagation path)
 *   L4: observability_checkpoints (evidence markers)
 *
 * Scoring: entity localization + fault identification + reasoning process
 *
 * @module benchmarks/loaders/rca100-loader
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
  BenchmarkAlert,
  BenchmarkCase,
  BenchmarkEvent,
  BenchmarkGroundTruth,
  BenchmarkLogEntry,
  BenchmarkSuite,
  BenchmarkTraceSpan,
  RCA100Case,
  RCA100GroundTruthLayers,
  RCA100Suite,
} from './types.js';

// ── RCA100 Loader ─────────────────────────────────────────

/**
 * Loader for RCA100 benchmark datasets.
 *
 * Handles the multi-modality data format from the Tianchi AIOps Track,
 * including 6 data modalities and 4-layer ground truth.
 */
export class RCA100Loader {
  /**
   * Load a single RCA100 case.
   *
   * @param casePath - Path to the case directory.
   * @returns Parsed RCA100Case.
   */
  loadCase(casePath: string): RCA100Case {
    const caseId = path.basename(casePath);

    // Load 4-layer ground truth
    const groundTruth = this.loadGroundTruth(casePath);

    // Load all data modalities
    const metrics = this.loadMetrics(casePath);
    const logs = this.loadLogs(casePath);
    const traces = this.loadTraces(casePath);
    const events = this.loadEvents(casePath);
    const alerts = this.loadAlerts(casePath);
    const topology = this.loadTopology(casePath);

    // Build call graph from topology
    const callGraph = this.buildCallGraphFromTopology(topology, metrics);

    // Load inject time from metadata or events
    const injectTime = this.loadInjectTime(casePath, events, alerts);

    return {
      casePath,
      caseId,
      metrics,
      logs,
      traces,
      events,
      alerts,
      topology,
      callGraph,
      injectTime,
      groundTruth,
    };
  }

  /**
   * Load a complete RCA100 suite.
   *
   * @param suitePath - Path to the suite directory.
   * @returns Parsed suite.
   */
  loadSuite(suitePath: string): RCA100Suite {
    const entries = fs.readdirSync(suitePath, { withFileTypes: true });
    const caseDirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));

    const cases = caseDirs.map((dir) => this.loadCase(path.join(suitePath, dir.name)));

    return {
      cases,
      totalCases: cases.length,
    };
  }

  /**
   * Convert a raw RCA100Case into the unified BenchmarkCase format.
   *
   * @param rawCase - Raw RCA100 case.
   * @returns Unified BenchmarkCase.
   */
  toBenchmarkCase(rawCase: RCA100Case): BenchmarkCase {
    return {
      id: `rca100_${rawCase.caseId}`,
      datasetName: 'rca100',
      callGraph: rawCase.callGraph,
      metrics: rawCase.metrics,
      injectTime: rawCase.injectTime,
      groundTruth: rawCase.groundTruth,
      logs: rawCase.logs,
      traces: rawCase.traces,
      events: rawCase.events,
      alerts: rawCase.alerts,
      topologyGraph: rawCase.topology,
    };
  }

  /**
   * Convert an RCA100 suite into unified BenchmarkSuite format.
   *
   * @param suite - Raw RCA100 suite.
   * @returns Unified BenchmarkSuite.
   */
  toBenchmarkSuite(suite: RCA100Suite): BenchmarkSuite {
    const cases = suite.cases.map((c) => this.toBenchmarkCase(c));
    return {
      name: 'rca100',
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
        const layers: RCA100GroundTruthLayers | undefined = raw.causal_chain
          ? {
              faultType: raw.fault_type ?? raw.faultType ?? 'unknown',
              targetEntity: raw.target_entity ?? raw.targetEntity ?? raw.service ?? 'unknown',
              causalChain: Array.isArray(raw.causal_chain) ? raw.causal_chain : [raw.target_entity],
              observabilityCheckpoints: Array.isArray(raw.observability_checkpoints)
                ? raw.observability_checkpoints
                : [],
            }
          : undefined;

        return {
          serviceId:
            layers?.targetEntity ?? raw.service ?? raw.target_entity ?? raw.serviceId ?? 'unknown',
          faultType: layers?.faultType ?? raw.fault_type ?? raw.faultType ?? 'unknown',
          metric: raw.metric ?? raw.root_cause_metric,
          rca100Layers: layers,
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

    // Try metrics.json first (single file with all services)
    const singlePath = path.join(casePath, 'metrics.json');
    if (fs.existsSync(singlePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(singlePath, 'utf-8'));
        if (typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [serviceName, data] of Object.entries(raw)) {
            const series = this.parseMetricData(data);
            if (series.length > 0) {
              map.set(serviceName, series);
            }
          }
        }
      } catch {
        // Skip
      }

      if (map.size > 0) return map;
    }

    // Try metrics/ directory with per-service JSON files
    const metricsDir = path.join(casePath, 'metrics');
    if (fs.existsSync(metricsDir) && fs.statSync(metricsDir).isDirectory()) {
      const files = fs.readdirSync(metricsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const serviceName = file.replace('.json', '');
          const raw = JSON.parse(fs.readFileSync(path.join(metricsDir, file), 'utf-8'));
          const series = this.parseMetricData(raw);
          if (series.length > 0) {
            map.set(serviceName, series);
          }
        } catch {
          // Skip
        }
      }
    }

    return map;
  }

  private parseMetricData(data: unknown): TimeSeries[] {
    if (!data) return [];

    if (Array.isArray(data)) {
      // Array of metric points [{timestamp, value, metric_name}]
      if (data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
        const firstObj = data[0] as Record<string, unknown>;
        if ('metric_name' in firstObj) {
          return this.parseRCAEvalStyleMetrics(
            data as Array<{ timestamp: number; value: number; metric_name: string }>,
          );
        }
        if ('label' in firstObj) {
          return data.map((item: Record<string, unknown>) => ({
            label: String(item.label ?? 'unknown'),
            timestamps: Array.isArray(item.timestamps) ? (item.timestamps as number[]) : [],
            values: new Float64Array(Array.isArray(item.values) ? (item.values as number[]) : []),
            unit: String(item.unit ?? 'count'),
          }));
        }
      }
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
    return this.loadJSONArray<BenchmarkLogEntry>(
      casePath,
      'logs.json',
      (item: Record<string, unknown>) => ({
        timestamp: Number(item.timestamp ?? 0),
        service: String(item.service ?? item.serviceId ?? 'unknown'),
        message: String(item.message ?? ''),
        level: this.normalizeLogLevel(String(item.level ?? 'INFO')),
      }),
    );
  }

  private loadTraces(casePath: string): ReadonlyArray<BenchmarkTraceSpan> {
    return this.loadJSONArray<BenchmarkTraceSpan>(
      casePath,
      'traces.json',
      (item: Record<string, unknown>) => ({
        traceId: String(item.traceId ?? item.trace_id ?? 'unknown'),
        spanId: String(item.spanId ?? item.span_id ?? `${item.traceId}_${item.service}`),
        parentSpanId: (item.parentSpanId ?? item.parent_span) as string | undefined,
        service: String(item.service ?? item.serviceId ?? 'unknown'),
        operationName: String(item.operationName ?? item.operation ?? 'unknown'),
        startTime: Number(item.startTime ?? item.start_time ?? 0),
        duration: Number(item.duration ?? 0),
        status: String(item.status ?? 'OK').toUpperCase() === 'ERROR' ? 'ERROR' : 'OK',
      }),
    );
  }

  private loadEvents(casePath: string): ReadonlyArray<BenchmarkEvent> {
    return this.loadJSONArray<BenchmarkEvent>(
      casePath,
      'events.json',
      (item: Record<string, unknown>) => ({
        eventId: String(
          item.eventId ?? item.event_id ?? item.id ?? `${item.timestamp}_${item.service}`,
        ),
        timestamp: Number(item.timestamp ?? 0),
        service: String(item.service ?? item.serviceId ?? 'unknown'),
        eventType: String(item.eventType ?? item.event_type ?? item.type ?? 'unknown'),
        severity: this.normalizeSeverity(String(item.severity ?? 'info')),
        description: String(item.description ?? ''),
        tags: (item.tags ?? {}) as Readonly<Record<string, string>>,
      }),
    );
  }

  private loadAlerts(casePath: string): ReadonlyArray<BenchmarkAlert> {
    return this.loadJSONArray<BenchmarkAlert>(
      casePath,
      'alerts.json',
      (item: Record<string, unknown>) => ({
        alertId: String(
          item.alertId ?? item.alert_id ?? item.id ?? `${item.timestamp}_${item.service}`,
        ),
        timestamp: Number(item.timestamp ?? 0),
        service: String(item.service ?? item.serviceId ?? 'unknown'),
        alertName: String(item.alertName ?? item.alert_name ?? item.name ?? 'unknown'),
        severity: this.normalizeSeverity(String(item.severity ?? 'warning')),
        value: Number(item.value ?? 0),
        threshold: Number(item.threshold ?? 0),
      }),
    );
  }

  private loadTopology(casePath: string): Record<string, readonly string[]> {
    const topoPath = path.join(casePath, 'topology.json');
    if (!fs.existsSync(topoPath)) return {};

    try {
      const raw = JSON.parse(fs.readFileSync(topoPath, 'utf-8'));
      if (typeof raw === 'object' && !Array.isArray(raw)) {
        const result: Record<string, readonly string[]> = {};
        for (const [key, value] of Object.entries(raw)) {
          if (Array.isArray(value)) {
            result[key] = value.map(String);
          }
        }
        return result;
      }
    } catch {
      // Skip
    }

    return {};
  }

  private loadInjectTime(
    casePath: string,
    events: ReadonlyArray<BenchmarkEvent>,
    alerts: ReadonlyArray<BenchmarkAlert>,
  ): number {
    const timePath = path.join(casePath, 'inject_time.txt');
    if (fs.existsSync(timePath)) {
      try {
        const raw = fs.readFileSync(timePath, 'utf-8').trim();
        const time = parseInt(raw, 10);
        if (!isNaN(time)) return time * 1000;
      } catch {
        // Fall through
      }
    }

    // Use the earliest event or alert timestamp as inject time
    const allTimestamps = [
      ...events.map((e) => e.timestamp),
      ...alerts.map((a) => a.timestamp),
    ].filter(Boolean);

    if (allTimestamps.length > 0) {
      return Math.min(...allTimestamps);
    }

    return 0;
  }

  private buildCallGraphFromTopology(
    topology: Record<string, readonly string[]>,
    metrics: MetricMap,
  ): ServiceCallGraph {
    // Collect all nodes: from topology keys + metric services
    const allServiceIds = new Set<string>();
    for (const key of Object.keys(topology)) {
      allServiceIds.add(key);
      for (const dep of topology[key] ?? []) {
        allServiceIds.add(dep);
      }
    }
    for (const key of metrics.keys()) {
      allServiceIds.add(key);
    }

    const nodes = new Map<string, ServiceNode>();
    for (const id of allServiceIds) {
      nodes.set(id, {
        id,
        name: id,
        namespace: 'default',
        labels: {},
      });
    }

    // Build edges from topology (service → downstream services)
    const edges: CallEdge[] = [];
    for (const [fromId, downstreamIds] of Object.entries(topology)) {
      for (const toId of downstreamIds) {
        edges.push({
          from: fromId,
          to: toId,
          type: 'REST',
          callRate: 100,
          p99Latency: 50,
          errorRate: 0.01,
        });
      }
    }

    // If no topology edges, build chain from all services
    if (edges.length === 0 && allServiceIds.size > 1) {
      const ids = [...allServiceIds];
      for (let i = 1; i < ids.length; i++) {
        edges.push({
          from: ids[i - 1]!,
          to: ids[i]!,
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

  // ── Utility Methods ─────────────────────────────────────

  private loadJSONArray<T>(
    casePath: string,
    fileName: string,
    mapper: (item: Record<string, unknown>) => T,
  ): readonly T[] {
    const filePath = path.join(casePath, fileName);
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(raw)) {
        return raw.map((item: unknown) => mapper(item as Record<string, unknown>));
      }
    } catch {
      // Skip
    }

    return [];
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
      case 'DEBUG':
        return 'DEBUG';
      case 'INFO':
        return 'INFO';
      case 'WARN':
      case 'WARNING':
        return 'WARN';
      case 'ERROR':
        return 'ERROR';
      case 'FATAL':
      case 'CRITICAL':
        return 'FATAL';
      default:
        return 'INFO';
    }
  }

  private normalizeSeverity(severity: string): BenchmarkEvent['severity'] {
    const lower = severity.toLowerCase();
    if (lower === 'critical' || lower === 'crit') return 'critical';
    if (lower === 'major') return 'major';
    if (lower === 'minor') return 'minor';
    if (lower === 'warning' || lower === 'warn') return 'warning';
    return 'info';
  }
}
