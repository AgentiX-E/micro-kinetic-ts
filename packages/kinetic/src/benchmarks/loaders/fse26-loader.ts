/**
 * FSE'26 RCABench loader.
 *
 * RCABench (arXiv:2510.04711, "Rethinking the Evaluation of Microservice RCA
 * with a Fault Propagation-Aware Benchmark") is the fault-propagation-aware
 * benchmark published at FSE'26. It contains 1,430 validated failure cases
 * collected on Train Ticket (50+ microservices), covering 25 fault types
 * across 6 categories (pod kill, resource stress, HTTP fault, network fault,
 * time skew/DNS, JVM fault), with dynamic workloads and hierarchical
 * ground-truth labels. The 11 SOTA models re-evaluated on it average only
 * 0.21 Top@1 (best 0.37), making it the hardest public RCA target.
 *
 * ## Data contract
 *
 * Each case is a directory of Parquet files (the `absolute_anomaly` artifact,
 * 13.4 GB) that a Python/polars bridge (`scripts/fse26_convert.py`) converts
 * into a single normalised JSON document per datapack. This loader consumes
 * that JSON — NOT the Parquet directly — mirroring the RCAEval/AIOps2025
 * loaders' "JSON in, BenchmarkCase out" contract. The bridge performs all
 * Parquet-specific work (unit normalisation, column renaming, normal/abnormal
 * concatenation); this loader is a pure structural transform that maps the
 * normalised JSON to the unified {@link BenchmarkCase} format.
 *
 * ## Normalised JSON schema (per datapack, emitted by the bridge)
 *
 * ```json
 * {
 *   "datapack": "ts5-ts-order-service-stress-svfvxk",
 *   "faultType": "CPUStress",
 *   "groundTruthServices": ["ts-order-service"],
 *   "injectTimeMs": 1757000000000,
 *   "metrics": {
 *     "ts-order-service": [
 *       { "metric": "container.cpu.usage", "timestamps": [1756998000000], "values": [0.1] }
 *     ]
 *   },
 *   "traces": [
 *     { "traceId": "abc", "spanId": "s1", "parentSpanId": "s0", "service": "ts-order-service",
 *       "operationName": "GET /orders", "startTime": 1756998000000, "duration": 12.5, "status": "OK" }
 *   ],
 *   "logs": [
 *     { "timestamp": 1756998000000, "service": "ts-order-service", "level": "ERROR", "message": "..." }
 *   ]
 * }
 * ```
 *
 * All timestamps are Unix milliseconds, all durations milliseconds, log levels
 * are already upper-cased, and trace status is already normalised to OK/ERROR
 * by the bridge. Service names are used directly as service IDs (FSE'26 names
 * are already unique, so no semantic alignment is needed, unlike RCAEval).
 *
 * ## Ground truth
 *
 * Non-network faults carry a single label — the injected service. Network
 * faults (`NetworkDelay`/`NetworkLoss`/…, injected on an EDGE) carry TWO valid
 * labels: the injection point's `source_service` and `target_service`, both of
 * which the benchmark accepts. The loader emits both via
 * `BenchmarkGroundTruth.serviceIds`.
 *
 * @module benchmarks/loaders/fse26-loader
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
  BenchmarkTraceSpan,
} from './types.js';

import {
  classifyLogLevel,
  extractDeepestExceptionClass,
  isLogicExceptionMessage,
  isStackTraceMessage,
} from './rcaeval-loader.js';

// ── Train Ticket static topology ─────────────────────────

/**
 * Static Train Ticket service dependency graph (caller → callees), ported
 * verbatim from the RCABench platform's `predefined_dependency()` so the
 * loader reconstructs the SAME topology the benchmark's own evaluator uses.
 * Trace-derived edges are layered on top; this static map fills the gaps that
 * a single case's trace sample may not exercise (rare branches, message-queue
 * hops, the MySQL data plane).
 */
const TRAIN_TICKET_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  'ts-ui-dashboard': [
    'ts-voucher-service',
    'ts-travel-plan-service',
    'ts-execute-service',
    'ts-news-service',
    'ts-ticket-office-service',
    'ts-gateway-service',
  ],
  'ts-admin-basic-info-service': [
    'ts-config-service',
    'ts-contacts-service',
    'ts-price-service',
    'ts-station-service',
    'ts-train-service',
  ],
  'ts-admin-order-service': ['ts-order-other-service', 'ts-order-service'],
  'ts-admin-route-service': ['ts-route-service', 'ts-station-service'],
  'ts-admin-travel-service': [
    'ts-route-service',
    'ts-station-service',
    'ts-train-service',
    'ts-travel2-service',
    'ts-travel-service',
  ],
  'ts-admin-user-service': ['ts-user-service'],
  'ts-auth-service': ['ts-verification-code-service'],
  'ts-basic-service': [
    'ts-price-service',
    'ts-route-service',
    'ts-station-service',
    'ts-train-service',
  ],
  'ts-cancel-service': [
    'ts-inside-payment-service',
    'ts-notification-service',
    'ts-order-other-service',
    'ts-order-service',
    'ts-user-service',
  ],
  'ts-consign-service': ['ts-consign-price-service'],
  'ts-execute-service': ['ts-order-other-service', 'ts-order-service'],
  'ts-food-delivery-service': ['ts-station-food-service', 'ts-rabbitmq'],
  'ts-food-service': [
    'ts-station-food-service',
    'ts-train-food-service',
    'ts-travel-service',
    'ts-rabbitmq',
  ],
  'ts-inside-payment-service': ['ts-order-other-service', 'ts-order-service', 'ts-payment-service'],
  'ts-order-other-service': ['ts-station-service'],
  'ts-order-service': ['ts-station-service'],
  'ts-preserve-other-service': [
    'ts-assurance-service',
    'ts-basic-service',
    'ts-consign-service',
    'ts-contacts-service',
    'ts-food-service',
    'ts-order-other-service',
    'ts-seat-service',
    'ts-security-service',
    'ts-station-service',
    'ts-travel2-service',
    'ts-user-service',
  ],
  'ts-preserve-service': [
    'ts-assurance-service',
    'ts-basic-service',
    'ts-consign-service',
    'ts-contacts-service',
    'ts-food-service',
    'ts-order-service',
    'ts-seat-service',
    'ts-security-service',
    'ts-station-service',
    'ts-travel-service',
    'ts-user-service',
    'ts-rabbitmq',
  ],
  'ts-rebook-service': [
    'ts-inside-payment-service',
    'ts-order-other-service',
    'ts-order-service',
    'ts-route-service',
    'ts-seat-service',
    'ts-train-service',
    'ts-travel2-service',
    'ts-travel-service',
  ],
  'ts-route-plan-service': ['ts-route-service', 'ts-travel2-service', 'ts-travel-service'],
  'ts-seat-service': ['ts-config-service', 'ts-order-other-service', 'ts-order-service'],
  'ts-security-service': ['ts-order-other-service', 'ts-order-service'],
  'ts-travel2-service': [
    'ts-basic-service',
    'ts-route-service',
    'ts-seat-service',
    'ts-train-service',
  ],
  'ts-travel-plan-service': [
    'ts-route-plan-service',
    'ts-seat-service',
    'ts-train-service',
    'ts-travel2-service',
    'ts-travel-service',
  ],
  'ts-travel-service': [
    'ts-basic-service',
    'ts-route-service',
    'ts-seat-service',
    'ts-train-service',
  ],
  'ts-user-service': ['ts-auth-service'],
  loadgenerator: ['ts-ui-dashboard'],
};

/**
 * Services that connect to the MySQL data plane. Every one of these emits
 * `→ mysql` in the static graph (the database is a shared dependency the
 * traces do not surface as a distinct span parent).
 */
const MYSQL_CONNECTED_SERVICES: readonly string[] = [
  'ts-assurance-service',
  'ts-auth-service',
  'ts-config-service',
  'ts-consign-price-service',
  'ts-consign-service',
  'ts-contacts-service',
  'ts-delivery-service',
  'ts-food-delivery-service',
  'ts-food-service',
  'ts-inside-payment-service',
  'ts-notification-service',
  'ts-order-other-service',
  'ts-order-service',
  'ts-payment-service',
  'ts-price-service',
  'ts-route-service',
  'ts-security-service',
  'ts-station-food-service',
  'ts-station-service',
  'ts-train-food-service',
  'ts-train-service',
  'ts-travel2-service',
  'ts-travel-service',
  'ts-user-service',
  'ts-wait-order-service',
];

// ── Raw bridge types ─────────────────────────────────────

/** A normalised metric time series (service-scoped) from the bridge JSON. */
interface FSE26MetricSeries {
  readonly metric: string;
  readonly timestamps: readonly number[];
  readonly values: readonly number[];
}

/** A normalised trace span from the bridge JSON. */
interface FSE26TraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly service: string;
  readonly operationName: string;
  readonly startTime: number;
  readonly duration: number;
  readonly status: 'OK' | 'ERROR';
}

/** A normalised log entry from the bridge JSON. */
interface FSE26LogEntry {
  readonly timestamp: number;
  readonly service: string;
  readonly level: string;
  readonly message: string;
}

/** The normalised JSON document the bridge emits per datapack. */
export interface FSE26RawCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly groundTruthServices: readonly string[];
  readonly injectTimeMs: number;
  readonly metrics: Readonly<Record<string, readonly FSE26MetricSeries[]>>;
  readonly traces?: readonly FSE26TraceSpan[];
  readonly logs?: readonly FSE26LogEntry[];
}

// ── Pure transforms (TDD targets) ────────────────────────

/**
 * Append a directed call edge to `edges`, skipping self-calls and duplicates.
 *
 * Shared by the static-topology and trace-derived edge builders so the
 * self-call and de-duplication semantics are defined exactly once.
 */
function addDeduplicatedEdge(edges: CallEdge[], seen: Set<string>, from: string, to: string): void {
  if (from === to) return;
  const key = `${from}\u0000${to}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ from, to, type: 'REST', callRate: 100, p99Latency: 50, errorRate: 0.01 });
}

/**
 * Build the Train Ticket service dependency graph (caller → callee) from the
 * static topology, restricted to the services actually present in a case.
 *
 * Only edges whose BOTH endpoints are present services are emitted — a
 * dangling edge to a service without metric series would create a node the
 * engine cannot score. The MySQL data plane is included exactly like any other
 * service: `service → mysql` edges survive only when `mysql` itself is present
 * (it is a Train Ticket pod with its own metric series).
 *
 * @param serviceNames - The services observed in the case's metrics.
 * @returns A directed edge list (from = caller, to = callee), deduplicated.
 */
export function buildFSE26StaticEdges(serviceNames: readonly string[]): CallEdge[] {
  const present = new Set(serviceNames);
  const seen = new Set<string>();
  const edges: CallEdge[] = [];

  const push = (from: string, to: string): void => {
    if (!present.has(from) || !present.has(to)) return;
    addDeduplicatedEdge(edges, seen, from, to);
  };

  for (const [caller, callees] of Object.entries(TRAIN_TICKET_DEPENDENCIES)) {
    for (const callee of callees) push(caller, callee);
  }

  // MySQL data plane: each connected service depends on the shared database.
  for (const service of MYSQL_CONNECTED_SERVICES) {
    push(service, 'mysql');
  }

  return edges;
}

/**
 * Derive caller → callee call edges from trace span parent relationships.
 *
 * A span's `parentSpanId` links it to the span that invoked it; mapping each
 * span id and parent id to their services yields the observed call edges.
 * Self-calls (same service on both ends) are excluded, matching the platform.
 *
 * @param traces - The normalised trace spans of the case.
 * @returns A deduplicated directed edge list (from = parent service, to = child service).
 */
export function buildFSE26TraceEdges(traces: readonly FSE26TraceSpan[]): CallEdge[] {
  const serviceBySpan = new Map<string, string>();
  for (const span of traces) {
    if (span.spanId && span.service) serviceBySpan.set(span.spanId, span.service);
  }

  const seen = new Set<string>();
  const edges: CallEdge[] = [];
  for (const span of traces) {
    if (!span.parentSpanId) continue;
    const parentService = serviceBySpan.get(span.parentSpanId);
    if (!parentService) continue;
    addDeduplicatedEdge(edges, seen, parentService, span.service);
  }
  return edges;
}

/**
 * Assemble the case's service call graph from the static Train Ticket topology
 * layered with trace-derived edges.
 *
 * @param serviceNames - The services observed in the case.
 * @param traces - The normalised trace spans (optional, may be empty).
 * @returns A {@link ServiceCallGraph} with every observed service as a node.
 */
export function buildFSE26CallGraph(
  serviceNames: readonly string[],
  traces?: readonly FSE26TraceSpan[],
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  for (const name of serviceNames) {
    nodes.set(name, { id: name, name, namespace: 'default', labels: {} });
  }

  const present = new Set(serviceNames);
  const edges = [...buildFSE26StaticEdges(serviceNames), ...buildFSE26TraceEdges(traces ?? [])]
    // The static builder already drops edges with an absent endpoint; this
    // filter applies the same invariant to trace-derived edges, which may
    // reference trace-only services (e.g. the load generator) that have no
    // metric series and therefore no rankable node.
    .filter((edge) => present.has(edge.from) && present.has(edge.to));

  // Deduplicate across the two sources (trace edges may overlap static edges).
  const deduped = new Map<string, CallEdge>();
  for (const edge of edges) {
    deduped.set(`${edge.from}\u0000${edge.to}`, edge);
  }

  return { nodes, edges: [...deduped.values()], systemLoad: 0.5 };
}

/**
 * Convert the bridge's metric JSON into the engine's {@link MetricMap}.
 *
 * Each (service, metric) pair becomes one {@link TimeSeries}; the bridge
 * already emits timestamps in ascending order (it concatenates the normal then
 * abnormal windows, both sorted), so no re-sort is required here.
 *
 * @param metrics - The bridge's `metrics` object.
 * @returns A MetricMap keyed by service ID.
 */
export function toFSE26MetricMap(
  metrics: Readonly<Record<string, readonly FSE26MetricSeries[]>>,
): MetricMap {
  const map = new Map<string, readonly TimeSeries[]>();
  for (const [service, seriesList] of Object.entries(metrics)) {
    const series: TimeSeries[] = seriesList.map((s) => ({
      label: s.metric,
      timestamps: s.timestamps,
      values: new Float64Array(s.values),
      unit: 'count',
    }));
    if (series.length > 0) map.set(service, series);
  }
  return map;
}

/**
 * Resolve the case's ground-truth labels into a {@link BenchmarkGroundTruth}.
 *
 * FSE'26 network faults carry TWO valid labels (the injection point's source
 * and target service); every other fault carries exactly one. `serviceId` is
 * the first label and `serviceIds` is the complete accepted set.
 *
 * @param raw - The normalised raw case.
 * @returns The resolved ground truth.
 */
export function resolveFSE26GroundTruth(raw: FSE26RawCase): BenchmarkGroundTruth {
  const labels = raw.groundTruthServices;
  const serviceId = labels.length > 0 ? labels[0]! : 'unknown';
  return {
    serviceId,
    serviceIds: labels.length > 1 ? labels : undefined,
    faultType: raw.faultType,
  };
}

/**
 * Map a normalised bridge log entry to a {@link BenchmarkLogEntry}, reusing
 * the RCAEval loader's exception-semantics classifiers so FSE'26 logs feed the
 * same logic-exception / stack-trace signals.
 */
export function toFSE26LogEntry(entry: FSE26LogEntry): BenchmarkLogEntry {
  return {
    timestamp: entry.timestamp,
    service: entry.service,
    message: entry.message,
    level: classifyLogLevel(entry.level, entry.message),
    isStackTrace: isStackTraceMessage(entry.message),
    isLogicException: isLogicExceptionMessage(entry.message),
    deepestExceptionClass: extractDeepestExceptionClass(entry.message),
  };
}

// ── Loader ───────────────────────────────────────────────

/**
 * Loader for FSE'26 RCABench datasets.
 *
 * Consumes the normalised JSON emitted by the Parquet bridge and converts each
 * case into the unified {@link BenchmarkCase} format understood by the runner.
 */
export class FSE26Loader {
  /**
   * Load a single FSE'26 case from its normalised JSON document.
   *
   * @param casePath - Path to the case directory containing `case.json`.
   * @returns The parsed {@link FSE26RawCase}.
   */
  loadCase(casePath: string): FSE26RawCase {
    const raw = JSON.parse(
      fs.readFileSync(path.join(casePath, 'case.json'), 'utf-8'),
    ) as FSE26RawCase;
    return raw;
  }

  /**
   * Convert a normalised raw case into the unified {@link BenchmarkCase}.
   *
   * @param raw - The normalised raw case.
   * @returns The unified BenchmarkCase.
   */
  toBenchmarkCase(raw: FSE26RawCase): BenchmarkCase {
    const metrics = toFSE26MetricMap(raw.metrics);
    // Nodes are exactly the services with metric series (the engine can only
    // score services it has metrics for). Traces may reference other services
    // (e.g. the load generator), but those are dropped by the both-endpoints
    // edge filter, matching the RCAEval loader's metric-keyed convention.
    const serviceNames = [...metrics.keys()];

    const callGraph = buildFSE26CallGraph(serviceNames, raw.traces);

    const logs: ReadonlyArray<BenchmarkLogEntry> | undefined =
      raw.logs && raw.logs.length > 0 ? raw.logs.map(toFSE26LogEntry) : undefined;

    const traces: ReadonlyArray<BenchmarkTraceSpan> | undefined =
      raw.traces && raw.traces.length > 0
        ? raw.traces.map((s) => ({
            traceId: s.traceId,
            spanId: s.spanId,
            parentSpanId: s.parentSpanId,
            service: s.service,
            operationName: s.operationName,
            startTime: s.startTime,
            duration: s.duration,
            status: s.status,
          }))
        : undefined;

    return {
      id: `fse26_${raw.datapack}`,
      datasetName: 'fse26',
      callGraph,
      metrics,
      injectTime: raw.injectTimeMs,
      groundTruth: resolveFSE26GroundTruth(raw),
      logs,
      traces,
    };
  }
}
