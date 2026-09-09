/**
 * Unit tests for FSE26Loader and its pure transform helpers.
 *
 * Covers the static Train Ticket topology port, trace-edge derivation, call
 * graph assembly, metric-map conversion, multi-label ground-truth resolution,
 * and log classification reuse.
 *
 * @module __tests__/unit/loaders/fse26-loader.test
 */

import { describe, expect, it } from 'vitest';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { FSE26RawCase } from '../../../src/benchmarks/loaders/fse26-loader.js';
import {
  FSE26Loader,
  buildFSE26CallGraph,
  buildFSE26StaticEdges,
  buildFSE26TraceEdges,
  resolveFSE26GroundTruth,
  toFSE26LogEntry,
  toFSE26MetricMap,
} from '../../../src/benchmarks/loaders/fse26-loader.js';

// ── Fixtures ──────────────────────────────────────────────

function makeSpan(
  traceId: string,
  spanId: string,
  service: string,
  parentSpanId?: string,
): {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  service: string;
  operationName: string;
  startTime: number;
  duration: number;
  status: 'OK' | 'ERROR';
} {
  return {
    traceId,
    spanId,
    parentSpanId,
    service,
    operationName: 'GET /x',
    startTime: 1756998000000,
    duration: 12.5,
    status: 'OK',
  };
}

function makeRawCase(overrides: Partial<FSE26RawCase> = {}): FSE26RawCase {
  return {
    datapack: 'ts5-ts-order-service-stress-svfvxk',
    faultType: 'CPUStress',
    groundTruthServices: ['ts-order-service'],
    injectTimeMs: 1757000000000,
    metrics: {
      'ts-order-service': [
        { metric: 'container.cpu.usage', timestamps: [1, 2, 3], values: [0.1, 0.2, 0.3] },
      ],
      'ts-station-service': [
        { metric: 'container.cpu.usage', timestamps: [1, 2, 3], values: [0.0, 0.0, 0.1] },
      ],
    },
    ...overrides,
  };
}

// ── buildFSE26StaticEdges ─────────────────────────────────

describe('buildFSE26StaticEdges', () => {
  it('emits caller→callee edges for present services only', () => {
    // Include mysql so the data-plane edges have both endpoints present.
    const edges = buildFSE26StaticEdges(['ts-order-service', 'ts-station-service', 'mysql']);
    const pairs = new Set(edges.map((e) => `${e.from}->${e.to}`));

    // ts-order-service → ts-station-service is a static edge.
    expect(pairs.has('ts-order-service->ts-station-service')).toBe(true);
    // mysql data plane: both are connected services.
    expect(pairs.has('ts-order-service->mysql')).toBe(true);
    expect(pairs.has('ts-station-service->mysql')).toBe(true);
  });

  it('omits edges whose either endpoint is absent', () => {
    const edges = buildFSE26StaticEdges(['ts-order-service']);
    // ts-ui-dashboard (absent) → ts-voucher-service (absent) must not appear,
    // nor any edge touching an absent service (e.g. → mysql, → ts-station-service).
    for (const e of edges) {
      expect(e.from === 'ts-ui-dashboard' || e.to === 'ts-voucher-service').toBe(false);
      expect(e.to === 'mysql').toBe(false);
      expect(e.to === 'ts-station-service').toBe(false);
    }
    // With only one present service and no present neighbour, no edge survives.
    expect(edges).toEqual([]);
  });

  it('omits self-calls and deduplicates', () => {
    const edges = buildFSE26StaticEdges(['ts-order-service', 'ts-station-service']);
    const keys = edges.map((e) => `${e.from}->${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.filter((k) => k.split('->')[0] === k.split('->')[1])).toEqual([]);
  });

  it('returns empty for an empty service set', () => {
    expect(buildFSE26StaticEdges([])).toEqual([]);
  });
});

// ── buildFSE26TraceEdges ──────────────────────────────────

describe('buildFSE26TraceEdges', () => {
  it('derives caller→callee edges from parent span relationships', () => {
    const spans = [
      makeSpan('t1', 's0', 'ts-ui-dashboard'),
      makeSpan('t1', 's1', 'ts-order-service', 's0'),
    ];
    const edges = buildFSE26TraceEdges(spans);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe('ts-ui-dashboard');
    expect(edges[0]!.to).toBe('ts-order-service');
  });

  it('excludes self-calls (same service on both ends)', () => {
    const spans = [
      makeSpan('t1', 's0', 'ts-order-service'),
      makeSpan('t1', 's1', 'ts-order-service', 's0'),
    ];
    expect(buildFSE26TraceEdges(spans)).toEqual([]);
  });

  it('ignores spans without a resolvable parent', () => {
    const spans = [
      makeSpan('t1', 's0', 'ts-order-service'),
      makeSpan('t1', 's1', 'ts-station-service', 'unknown-parent'),
    ];
    // The second span's parent id is not any span's id, so no edge.
    expect(buildFSE26TraceEdges(spans)).toEqual([]);
  });

  it('deduplicates repeated edges across traces', () => {
    const spans = [
      makeSpan('t1', 'a', 'ts-order-service'),
      makeSpan('t1', 'b', 'ts-station-service', 'a'),
      makeSpan('t2', 'c', 'ts-order-service'),
      makeSpan('t2', 'd', 'ts-station-service', 'c'),
    ];
    const edges = buildFSE26TraceEdges(spans);
    expect(edges).toHaveLength(1);
  });
});

// ── buildFSE26CallGraph ───────────────────────────────────

describe('buildFSE26CallGraph', () => {
  it('creates a node per service and merges static + trace edges', () => {
    const services = ['ts-ui-dashboard', 'ts-order-service', 'ts-station-service'];
    const traces = [
      makeSpan('t1', 's0', 'ts-ui-dashboard'),
      makeSpan('t1', 's1', 'ts-order-service', 's0'),
    ];
    const graph = buildFSE26CallGraph(services, traces);

    expect(graph.nodes.size).toBe(3);
    expect([...graph.nodes.keys()].sort()).toEqual([...services].sort());

    const pairs = new Set(graph.edges.map((e) => `${e.from}->${e.to}`));
    // Static: ui-dashboard → order-service is NOT static (ui-dashboard calls
    // voucher/travel/execute/news/ticket/gateway), but the trace edge adds it.
    expect(pairs.has('ts-ui-dashboard->ts-order-service')).toBe(true);
    // Static: order-service → station-service.
    expect(pairs.has('ts-order-service->ts-station-service')).toBe(true);
    expect(graph.systemLoad).toBe(0.5);
  });

  it('deduplicates trace edges that overlap static edges', () => {
    const services = ['ts-order-service', 'ts-station-service'];
    const traces = [
      makeSpan('t1', 'a', 'ts-order-service'),
      makeSpan('t1', 'b', 'ts-station-service', 'a'),
    ];
    const graph = buildFSE26CallGraph(services, traces);
    const keys = graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('handles absent traces gracefully', () => {
    const graph = buildFSE26CallGraph(['ts-order-service'], undefined);
    expect(graph.nodes.size).toBe(1);
    // With no present neighbour and no mysql node, no edge survives.
    expect(graph.edges).toEqual([]);
  });

  it('drops trace edges whose endpoint is not a present node', () => {
    // ts-ui-dashboard appears only in traces (not metrics); its fan-out edge
    // into ts-order-service must not survive the both-endpoints filter.
    const services = ['ts-order-service', 'ts-station-service'];
    const traces = [
      makeSpan('t1', 's0', 'ts-ui-dashboard'),
      makeSpan('t1', 's1', 'ts-order-service', 's0'),
    ];
    const graph = buildFSE26CallGraph(services, traces);
    const pairs = graph.edges.map((e) => `${e.from}->${e.to}`);
    expect(pairs).not.toContain('ts-ui-dashboard->ts-order-service');
  });
});

// ── toFSE26MetricMap ──────────────────────────────────────

describe('toFSE26MetricMap', () => {
  it('maps each (service, metric) pair to a TimeSeries with Float64Array', () => {
    const map = toFSE26MetricMap({
      'ts-order-service': [
        { metric: 'container.cpu.usage', timestamps: [1, 2], values: [0.1, 0.2] },
        { metric: 'container.memory.usage', timestamps: [1, 2], values: [5, 6] },
      ],
    });

    expect(map.size).toBe(1);
    const series = map.get('ts-order-service')!;
    expect(series).toHaveLength(2);
    expect(series[0]!.label).toBe('container.cpu.usage');
    expect(series[0]!.timestamps).toEqual([1, 2]);
    expect(series[0]!.values).toBeInstanceOf(Float64Array);
    expect([...series[0]!.values]).toEqual([0.1, 0.2]);
  });

  it('skips services with zero metric series', () => {
    const map = toFSE26MetricMap({ 'ts-empty': [] });
    expect(map.size).toBe(0);
  });

  it('returns an empty map for empty input', () => {
    expect(toFSE26MetricMap({}).size).toBe(0);
  });
});

// ── resolveFSE26GroundTruth ───────────────────────────────

describe('resolveFSE26GroundTruth', () => {
  it('resolves a single label without a serviceIds array', () => {
    const gt = resolveFSE26GroundTruth(makeRawCase({ groundTruthServices: ['ts-order-service'] }));
    expect(gt.serviceId).toBe('ts-order-service');
    expect(gt.serviceIds).toBeUndefined();
    expect(gt.faultType).toBe('CPUStress');
  });

  it('resolves a dual network label into serviceId + serviceIds', () => {
    const gt = resolveFSE26GroundTruth(
      makeRawCase({ groundTruthServices: ['ts-order-service', 'ts-station-service'] }),
    );
    expect(gt.serviceId).toBe('ts-order-service');
    expect(gt.serviceIds).toEqual(['ts-order-service', 'ts-station-service']);
  });

  it('falls back to unknown for an empty label set', () => {
    const gt = resolveFSE26GroundTruth(makeRawCase({ groundTruthServices: [] }));
    expect(gt.serviceId).toBe('unknown');
    expect(gt.serviceIds).toBeUndefined();
  });
});

// ── toFSE26LogEntry ───────────────────────────────────────

describe('toFSE26LogEntry', () => {
  it('maps an ERROR logic exception with stack-trace + deepest exception', () => {
    const entry = toFSE26LogEntry({
      timestamp: 1756998000000,
      service: 'ts-order-service',
      level: 'ERROR',
      message: 'NullPointerException: null at com.foo.Bar.run(Bar.java:42)',
    });
    expect(entry.level).toBe('ERROR');
    expect(entry.isStackTrace).toBe(true);
    expect(entry.isLogicException).toBe(true);
    expect(entry.deepestExceptionClass).toBe('NullPointerException');
  });

  it('classifies a connectivity exception as non-logic', () => {
    const entry = toFSE26LogEntry({
      timestamp: 1,
      service: 'ts-order-service',
      level: 'ERROR',
      message: 'ConnectionException: connect timed out',
    });
    expect(entry.level).toBe('ERROR');
    expect(entry.isStackTrace).toBe(true);
    expect(entry.isLogicException).toBe(false);
    expect(entry.deepestExceptionClass).toBe('ConnectionException');
  });

  it('defaults an unrecognised level to INFO', () => {
    const entry = toFSE26LogEntry({
      timestamp: 1,
      service: 'ts-order-service',
      level: 'TRACE',
      message: 'ordinary line',
    });
    expect(entry.level).toBe('INFO');
    expect(entry.isStackTrace).toBe(false);
    expect(entry.isLogicException).toBe(false);
  });
});

// ── FSE26Loader ───────────────────────────────────────────

describe('FSE26Loader', () => {
  it('toBenchmarkCase converts a raw case into a unified BenchmarkCase', () => {
    const loader = new FSE26Loader();
    const raw = makeRawCase({
      traces: [
        makeSpan('t1', 's0', 'ts-order-service'),
        makeSpan('t1', 's1', 'ts-station-service', 's0'),
      ],
      logs: [
        {
          timestamp: 1757000000000,
          service: 'ts-order-service',
          level: 'ERROR',
          message: 'NullPointerException: null',
        },
      ],
    });

    const bench = loader.toBenchmarkCase(raw);

    expect(bench.id).toBe('fse26_ts5-ts-order-service-stress-svfvxk');
    expect(bench.datasetName).toBe('fse26');
    expect(bench.injectTime).toBe(1757000000000);
    expect(bench.groundTruth.serviceId).toBe('ts-order-service');
    expect(bench.groundTruth.faultType).toBe('CPUStress');
    expect(bench.metrics.size).toBe(2);
    expect(bench.callGraph.nodes.size).toBe(2);
    expect(bench.logs).toHaveLength(1);
    expect(bench.logs![0]!.isLogicException).toBe(true);
    expect(bench.traces).toHaveLength(2);
    expect(bench.traces![0]!.status).toBe('OK');
  });

  it('does not add trace/log-only services as nodes', () => {
    const loader = new FSE26Loader();
    const raw = makeRawCase({
      // ts-ui-dashboard and ts-route-service appear only in traces/logs, not
      // metrics — they must NOT become rankable nodes.
      traces: [
        makeSpan('t1', 's0', 'ts-ui-dashboard'),
        makeSpan('t1', 's1', 'ts-order-service', 's0'),
      ],
      logs: [
        {
          timestamp: 1,
          service: 'ts-route-service',
          level: 'INFO',
          message: 'noop',
        },
      ],
    });

    const bench = loader.toBenchmarkCase(raw);
    expect(bench.callGraph.nodes.has('ts-ui-dashboard')).toBe(false);
    expect(bench.callGraph.nodes.has('ts-route-service')).toBe(false);
    expect(bench.callGraph.nodes.size).toBe(2);
    // A trace edge whose caller (ts-ui-dashboard) is trace-only must be dropped
    // — every surviving edge connects two rankable nodes.
    expect(
      bench.callGraph.edges.some((e) => e.from === 'ts-ui-dashboard' || e.to === 'ts-ui-dashboard'),
    ).toBe(false);
  });

  it('leaves logs and traces undefined when absent', () => {
    const loader = new FSE26Loader();
    const bench = loader.toBenchmarkCase(makeRawCase());
    expect(bench.logs).toBeUndefined();
    expect(bench.traces).toBeUndefined();
  });

  it('loadCase reads and parses the normalised case.json document', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fse26-loader-'));
    try {
      const raw = makeRawCase({ groundTruthServices: ['ts-order-service', 'ts-station-service'] });
      fs.writeFileSync(path.join(dir, 'case.json'), JSON.stringify(raw));

      const loader = new FSE26Loader();
      const loaded = loader.loadCase(dir);

      expect(loaded.datapack).toBe('ts5-ts-order-service-stress-svfvxk');
      expect(loaded.faultType).toBe('CPUStress');
      expect(loaded.groundTruthServices).toEqual(['ts-order-service', 'ts-station-service']);
      expect(loaded.injectTimeMs).toBe(1757000000000);
      expect(loaded.metrics['ts-order-service']).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
