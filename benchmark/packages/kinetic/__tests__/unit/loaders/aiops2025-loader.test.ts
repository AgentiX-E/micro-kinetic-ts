/**
 * Unit tests for AIOps2025Loader.
 *
 * The loader reads a case directory, so every branch is reachable from a
 * synthetic fixture — no dataset download and no mocks. The suite covers each
 * optional source in both directions (present and absent), the schema aliases
 * the CCF AIOps Challenge actually ships (camelCase and snake_case), and the
 * degradation paths that turn an unreadable file into a benign default.
 *
 * @module __tests__/unit/loaders/aiops2025-loader.test
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AIOps2025Loader } from '../../../src/benchmarks/loaders/aiops2025-loader.js';

// ── Helpers ───────────────────────────────────────────────

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

describe('AIOps2025Loader', () => {
  let tempDir: string;
  let loader: AIOps2025Loader;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aiops2025-test-'));
    loader = new AIOps2025Loader();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /** Create a case directory and return its path. */
  function caseDir(name: string): string {
    const dir = path.join(tempDir, name);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // ── loadCase ────────────────────────────────────────────

  describe('loadCase', () => {
    it('derives the case id from the directory name and assembles every section', () => {
      const dir = caseDir('case-0001');
      writeJson(path.join(dir, 'ground_truth.json'), { service: 'svc-a', fault_type: 'cpu' });
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 2, metric_name: 'cpu_usage' }],
      });
      writeJson(path.join(dir, 'logs.json'), [{ timestamp: 5, service: 'svc-a', message: 'm' }]);
      writeJson(path.join(dir, 'traces.json'), [{ traceId: 't1', service: 'svc-a' }]);

      const loaded = loader.loadCase(dir);

      expect(loaded.casePath).toBe(dir);
      expect(loaded.caseId).toBe('case-0001');
      expect(loaded.groundTruth.serviceId).toBe('svc-a');
      expect(loaded.metrics.size).toBe(1);
      expect(loaded.logs).toHaveLength(1);
      expect(loaded.traces).toHaveLength(1);
      expect(loaded.callGraph.nodes.size).toBe(1);
    });

    it('returns empty sections for a directory with no source files', () => {
      const loaded = loader.loadCase(caseDir('empty-case'));

      expect(loaded.metrics.size).toBe(0);
      expect(loaded.logs).toEqual([]);
      expect(loaded.traces).toEqual([]);
      expect(loaded.callGraph.nodes.size).toBe(0);
      expect(loaded.callGraph.edges).toEqual([]);
      expect(loaded.injectTime).toBe(0);
      expect(loaded.groundTruth).toEqual({ serviceId: 'unknown', faultType: 'unknown' });
      expect(loaded.labelScores).toBeUndefined();
    });
  });

  // ── loadSuite ───────────────────────────────────────────

  describe('loadSuite', () => {
    it('loads every visible directory in lexical order and skips files and dot/underscore dirs', () => {
      for (const name of ['case-b', 'case-a', '_scratch', '.hidden']) {
        fs.mkdirSync(path.join(tempDir, name), { recursive: true });
      }
      writeText(path.join(tempDir, 'README.md'), 'not a case');

      const suite = loader.loadSuite(tempDir);

      expect(suite.totalCases).toBe(2);
      expect(suite.cases.map((c) => c.caseId)).toEqual(['case-a', 'case-b']);
    });

    it('returns an empty suite for a directory with no case subdirectories', () => {
      const suite = loader.loadSuite(tempDir);

      expect(suite.cases).toEqual([]);
      expect(suite.totalCases).toBe(0);
    });
  });

  // ── toBenchmarkCase / toBenchmarkSuite ──────────────────

  describe('toBenchmarkCase', () => {
    it('prefixes the id and forwards every modality', () => {
      const dir = caseDir('case-7');
      writeJson(path.join(dir, 'ground_truth.json'), { service: 'svc-a', fault_type: 'cpu' });

      const converted = loader.toBenchmarkCase(loader.loadCase(dir));

      expect(converted.id).toBe('aiops2025_case-7');
      expect(converted.datasetName).toBe('aiops2025');
      expect(converted.groundTruth.serviceId).toBe('svc-a');
      expect(converted.injectTime).toBe(0);
    });
  });

  describe('toBenchmarkSuite', () => {
    it('names the suite and counts the converted cases', () => {
      fs.mkdirSync(path.join(tempDir, 'case-a'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'case-b'), { recursive: true });

      const suite = loader.toBenchmarkSuite(loader.loadSuite(tempDir));

      expect(suite.name).toBe('aiops2025');
      expect(suite.totalCases).toBe(2);
      expect(suite.cases.map((c) => c.datasetName)).toEqual(['aiops2025', 'aiops2025']);
    });
  });

  // ── Ground truth ────────────────────────────────────────

  describe('groundTruth', () => {
    it.each([
      ['camelCase', { serviceId: 'svc-a', faultType: 'cpu', metric: 'cpu_usage' }],
      ['snake_case', { root_cause_service: 'svc-a', fault_type: 'cpu', root_cause_metric: 'm' }],
      ['short aliases', { service: 'svc-a', type: 'cpu' }],
    ])('reads the %s field names', (_label, payload) => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), payload);

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('svc-a');
      expect(gt.faultType).toBe('cpu');
    });

    it('defaults both fields to "unknown" when ground_truth.json carries no known key', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), { unrelated: 1 });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('unknown');
      expect(gt.faultType).toBe('unknown');
    });

    it('falls back to metadata.json when ground_truth.json is malformed', () => {
      const dir = caseDir('gt');
      writeText(path.join(dir, 'ground_truth.json'), '{oops');
      writeJson(path.join(dir, 'metadata.json'), { fault_service: 'svc-b', fault_type: 'disk' });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('svc-b');
      expect(gt.faultType).toBe('disk');
    });

    it('reads the target/type aliases from metadata.json', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'metadata.json'), { target: 'svc-c', type: 'mem' });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('svc-c');
      expect(gt.faultType).toBe('mem');
    });

    it('defaults to "unknown" when metadata.json carries no known key either', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'metadata.json'), { unrelated: 1 });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('unknown');
      expect(gt.faultType).toBe('unknown');
    });

    it('defaults to "unknown" when metadata.json is malformed too', () => {
      const dir = caseDir('gt');
      writeText(path.join(dir, 'metadata.json'), 'not json at all');

      expect(loader.loadCase(dir).groundTruth.serviceId).toBe('unknown');
    });
  });

  // ── Metrics ─────────────────────────────────────────────

  describe('metrics', () => {
    it('reads a metrics/ directory of per-service JSON files', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics', 'svc-a.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);
      writeJson(path.join(dir, 'metrics', 'svc-b.json'), [
        { timestamp: 1, value: 1, metric_name: 'mem' },
      ]);
      writeText(path.join(dir, 'metrics', 'notes.txt'), 'ignored');

      const metrics = loader.loadCase(dir).metrics;

      expect([...metrics.keys()]).toEqual(['svc-a', 'svc-b']);
    });

    it('skips a malformed or empty per-service file and keeps the rest', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics', 'svc-a.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);
      writeText(path.join(dir, 'metrics', 'broken.json'), '{oops');
      writeJson(path.join(dir, 'metrics', 'empty.json'), []);

      const metrics = loader.loadCase(dir).metrics;

      expect([...metrics.keys()]).toEqual(['svc-a']);
    });

    it('falls through to metrics.json when every file in metrics/ is unusable', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics', 'empty.json'), []);
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-fallback': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const metrics = loader.loadCase(dir).metrics;

      expect([...metrics.keys()]).toEqual(['svc-fallback']);
    });

    it('ignores a file named "metrics" that is not a directory', () => {
      const dir = caseDir('m');
      writeText(path.join(dir, 'metrics'), 'this is a file, not a directory');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-a']);
    });

    it('ignores a metrics.json whose root is an array rather than a service map', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), [{ timestamp: 1, value: 1, metric_name: 'cpu' }]);

      expect(loader.loadCase(dir).metrics.size).toBe(0);
    });

    it('survives a malformed metrics.json', () => {
      const dir = caseDir('m');
      writeText(path.join(dir, 'metrics.json'), '[');

      expect(loader.loadCase(dir).metrics.size).toBe(0);
    });

    it('ignores a service whose entries are not parseable series', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        scalars: [1, 2, 3],
        objects: [{ unrelated: true }],
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-a']);
    });

    it('groups RCAEval-style points by metric name, converts seconds to ms, and sorts by time', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [
          { timestamp: 3, value: 30, metric_name: 'cpu_usage' },
          { timestamp: 1, value: 10, metric_name: 'cpu_usage' },
          { timestamp: 2, value: 20, metric_name: 'cpu_usage' },
        ],
      });

      const series = loader.loadCase(dir).metrics.get('svc-a')!;

      expect(series).toHaveLength(1);
      expect(series[0]!.label).toBe('cpu_usage');
      expect(series[0]!.timestamps).toEqual([1000, 2000, 3000]);
      expect([...series[0]!.values]).toEqual([10, 20, 30]);
    });

    it('reads a {label, timestamps, values} array and defaults missing members', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [
          { label: 'cpu_usage', timestamps: [1, 2], values: [1, 2], unit: 'percent' },
          { label: 'bare' },
          { timestamps: 'not an array', values: 5 },
        ],
      });

      const series = loader.loadCase(dir).metrics.get('svc-a')!;

      expect(series[0]!.unit).toBe('percent');
      expect(series[1]!.label).toBe('bare');
      expect(series[1]!.timestamps).toEqual([]);
      expect(series[1]!.unit).toBe('count');
      expect(series[2]!.label).toBe('unknown');
      expect(series[2]!.timestamps).toEqual([]);
      expect(series[2]!.values).toHaveLength(0);
    });

    it.each([
      ['cpu_usage', 'percent'],
      ['mem_used', 'bytes'],
      ['memory_free', 'bytes'],
      ['disk_io', 'iops'],
      ['latency_p99', 'ms'],
      ['request_delay', 'ms'],
      ['packet_loss', 'rate'],
      ['error_count', 'rate'],
      ['request_total', 'count'],
    ])('infers the unit of %s as %s', (metricName, unit) => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: metricName }],
      });

      expect(loader.loadCase(dir).metrics.get('svc-a')![0]!.unit).toBe(unit);
    });
  });

  // ── Logs ────────────────────────────────────────────────

  describe('logs', () => {
    it('reads logs.json with camelCase and snake_case field aliases', () => {
      const dir = caseDir('l');
      writeJson(path.join(dir, 'logs.json'), [
        { timestamp: 1, service: 'svc-a', message: 'a', level: 'WARNING' },
        { timestamp: 2, serviceId: 'svc-b', message: 'b', level: 'critical' },
        {},
      ]);

      const logs = loader.loadCase(dir).logs;

      expect(logs[0]).toMatchObject({ timestamp: 1, service: 'svc-a', level: 'WARN' });
      expect(logs[1]).toMatchObject({ service: 'svc-b', level: 'FATAL' });
      expect(logs[2]).toMatchObject({
        timestamp: 0,
        service: 'unknown',
        message: '',
        level: 'INFO',
      });
    });

    it('falls back to logs.csv when logs.json parses but is not an array', () => {
      const dir = caseDir('l');
      writeJson(path.join(dir, 'logs.json'), { not: 'an array' });
      writeText(
        path.join(dir, 'logs.csv'),
        ['timestamp,service,message,level', '10,svc-a,csv message,error'].join('\n'),
      );

      const logs = loader.loadCase(dir).logs;

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        timestamp: 10,
        service: 'svc-a',
        message: 'csv message',
        level: 'ERROR',
      });
    });

    it('falls back to logs.csv when logs.json is malformed', () => {
      const dir = caseDir('l');
      writeText(path.join(dir, 'logs.json'), '{oops');
      writeText(path.join(dir, 'logs.csv'), ['timestamp,service', '10,svc-a'].join('\n'));

      expect(loader.loadCase(dir).logs[0]!.service).toBe('svc-a');
    });

    it('defaults absent CSV columns instead of emitting undefined', () => {
      const dir = caseDir('l');
      writeText(path.join(dir, 'logs.csv'), ['service', 'svc-a'].join('\n'));

      expect(loader.loadCase(dir).logs[0]).toMatchObject({
        timestamp: 0,
        message: '',
        level: 'INFO',
      });
    });

    it('returns no logs for a header-only or single-line CSV', () => {
      const dir = caseDir('l');
      writeText(path.join(dir, 'logs.csv'), 'timestamp,service,message');

      expect(loader.loadCase(dir).logs).toEqual([]);
    });

    it.each([
      ['DEBUG', 'DEBUG'],
      ['info', 'INFO'],
      ['warn', 'WARN'],
      ['error', 'ERROR'],
      ['fatal', 'FATAL'],
      ['CRITICAL', 'FATAL'],
      ['trace', 'INFO'],
    ])('normalises log level %s to %s', (raw, expected) => {
      const dir = caseDir('l');
      writeJson(path.join(dir, 'logs.json'), [{ level: raw }]);

      expect(loader.loadCase(dir).logs[0]!.level).toBe(expected);
    });
  });

  // ── Traces ──────────────────────────────────────────────

  describe('traces', () => {
    it('reads traces.json with camelCase aliases', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [
        {
          traceId: 't1',
          spanId: 's1',
          parentSpanId: 's0',
          service: 'svc-a',
          operationName: 'get',
          startTime: 100,
          duration: 5,
          status: 'error',
        },
      ]);

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace).toEqual({
        traceId: 't1',
        spanId: 's1',
        parentSpanId: 's0',
        service: 'svc-a',
        operationName: 'get',
        startTime: 100,
        duration: 5,
        status: 'ERROR',
      });
    });

    it('reads traces.json with snake_case aliases', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [
        {
          trace_id: 't1',
          span_id: 's1',
          parent_span: 's0',
          service: 'svc-a',
          operation: 'get',
          start_time: 100,
          duration: 5,
          status: 'OK',
        },
      ]);

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace.traceId).toBe('t1');
      expect(trace.spanId).toBe('s1');
      expect(trace.parentSpanId).toBe('s0');
      expect(trace.operationName).toBe('get');
      expect(trace.status).toBe('OK');
    });

    it('builds the derived span id from the RESOLVED trace id and service', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [
        { trace_id: 't1', service: 'svc-a', duration: 1 },
        { trace_id: 't2', serviceId: 'svc-b', duration: 1 },
      ]);

      const traces = loader.loadCase(dir).traces;

      expect(traces[0]!.spanId).toBe('t1_svc-a');
      expect(traces[1]!.spanId).toBe('t2_svc-b');
    });

    it('defaults every optional span field instead of emitting undefined', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [{}]);

      expect(loader.loadCase(dir).traces[0]).toEqual({
        traceId: 'unknown',
        spanId: 'unknown_unknown',
        parentSpanId: undefined,
        service: 'unknown',
        operationName: 'unknown',
        startTime: 0,
        duration: 0,
        status: 'OK',
      });
    });

    it('falls back to traces.csv when traces.json parses but is not an array', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), { not: 'an array' });
      writeText(
        path.join(dir, 'traces.csv'),
        [
          'trace_id,span_id,parent_span,service,operation,start_time,duration,status',
          't1,s1,s0,svc-a,get,100,5,ERROR',
        ].join('\n'),
      );

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace).toMatchObject({
        traceId: 't1',
        spanId: 's1',
        parentSpanId: 's0',
        service: 'svc-a',
        operationName: 'get',
        startTime: 100,
        duration: 5,
        status: 'ERROR',
      });
    });

    it('builds the CSV span id from the RESOLVED trace id and service', () => {
      const dir = caseDir('t');
      writeText(
        path.join(dir, 'traces.csv'),
        ['traceId,service,duration', 't1,svc-a,5'].join('\n'),
      );

      expect(loader.loadCase(dir).traces[0]!.spanId).toBe('t1_svc-a');
    });

    it('falls back to traces.csv when traces.json is malformed', () => {
      const dir = caseDir('t');
      writeText(path.join(dir, 'traces.json'), '{oops');
      writeText(path.join(dir, 'traces.csv'), ['trace_id,service', 't1,svc-a'].join('\n'));

      expect(loader.loadCase(dir).traces[0]!.service).toBe('svc-a');
    });

    it('defaults absent CSV trace columns', () => {
      const dir = caseDir('t');
      writeText(path.join(dir, 'traces.csv'), ['service', 'svc-a'].join('\n'));

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace).toMatchObject({
        traceId: 'unknown',
        service: 'svc-a',
        operationName: 'unknown',
        startTime: 0,
        duration: 0,
        status: 'OK',
      });
    });
  });

  // ── Call graph ──────────────────────────────────────────

  describe('callGraph', () => {
    it('reads call_graph.json and defaults the optional edge and node fields', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'call_graph.json'), {
        nodes: [{ id: 'svc-a' }, { id: 'svc-b', name: 'B', namespace: 'ns', labels: { k: 'v' } }],
        edges: [{ from: 'svc-a', to: 'svc-b' }],
        systemLoad: 0.9,
      });

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.nodes.get('svc-a')).toEqual({
        id: 'svc-a',
        name: 'svc-a',
        namespace: 'default',
        labels: {},
      });
      expect(graph.nodes.get('svc-b')).toMatchObject({ name: 'B', namespace: 'ns' });
      expect(graph.edges[0]).toEqual({
        from: 'svc-a',
        to: 'svc-b',
        type: 'REST',
        callRate: 100,
        p99Latency: 50,
        errorRate: 0.01,
      });
      expect(graph.systemLoad).toBe(0.9);
    });

    it('honours explicit node and edge fields', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'call_graph.json'), {
        nodes: [],
        edges: [{ from: 'a', to: 'b', type: 'gRPC', callRate: 5, p99Latency: 7, errorRate: 0.5 }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.edges[0]).toMatchObject({
        type: 'gRPC',
        callRate: 5,
        p99Latency: 7,
        errorRate: 0.5,
      });
      // No systemLoad in the file -> the documented default.
      expect(graph.systemLoad).toBe(0.5);
    });

    it('defaults to an empty graph when call_graph.json omits nodes and edges', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'call_graph.json'), {});

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.nodes.size).toBe(0);
      expect(graph.edges).toEqual([]);
    });

    it('falls back to a graph built from the metric services when call_graph.json is malformed', () => {
      const dir = caseDir('g');
      writeText(path.join(dir, 'call_graph.json'), '{oops');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
        'svc-b': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect([...graph.nodes.keys()]).toEqual(['svc-a', 'svc-b']);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ from: 'svc-a', to: 'svc-b', type: 'REST' });
      expect(graph.systemLoad).toBe(0.5);
    });

    it('emits no edges when the fallback graph would have fewer than two nodes', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.nodes.size).toBe(1);
      expect(graph.edges).toEqual([]);
    });
  });

  // ── Injection time ──────────────────────────────────────

  describe('injectTime', () => {
    it('reads inject_time.txt as seconds and converts to milliseconds', () => {
      const dir = caseDir('i');
      writeText(path.join(dir, 'inject_time.txt'), '1700000000\n');

      expect(loader.loadCase(dir).injectTime).toBe(1700000000000);
    });

    it('ignores a non-numeric inject_time.txt and falls back to ground_truth.json seconds', () => {
      const dir = caseDir('i');
      writeText(path.join(dir, 'inject_time.txt'), 'not a number');
      writeJson(path.join(dir, 'ground_truth.json'), { inject_time: 1700000001 });

      expect(loader.loadCase(dir).injectTime).toBe(1700000001000);
    });

    it('takes an already-millisecond injectTime from ground_truth.json as-is', () => {
      const dir = caseDir('i');
      writeJson(path.join(dir, 'ground_truth.json'), { injectTime: 1700000002000 });

      expect(loader.loadCase(dir).injectTime).toBe(1700000002000);
    });

    it('returns 0 when ground_truth.json has no injection time', () => {
      const dir = caseDir('i');
      writeJson(path.join(dir, 'ground_truth.json'), { service: 'svc-a' });

      expect(loader.loadCase(dir).injectTime).toBe(0);
    });

    it('returns 0 when every injection-time source is unusable', () => {
      const dir = caseDir('i');
      writeText(path.join(dir, 'ground_truth.json'), '{oops');

      expect(loader.loadCase(dir).injectTime).toBe(0);
    });
  });

  // ── Label scores ────────────────────────────────────────

  describe('labelScores', () => {
    it('reads the camelCase accuracy fields', () => {
      const dir = caseDir('s');
      writeJson(path.join(dir, 'labels.json'), {
        locationAccuracy: 1,
        typeAccuracy: 0.5,
        explainability: 0.25,
        efficiency: 0.75,
      });

      expect(loader.loadCase(dir).labelScores).toEqual({
        locationAccuracy: 1,
        typeAccuracy: 0.5,
        explainability: 0.25,
        efficiency: 0.75,
      });
    });

    it('reads the short competition aliases', () => {
      const dir = caseDir('s');
      writeJson(path.join(dir, 'labels.json'), { LA: 1, TA: 2, EXP: 3, EFF: 4 });

      expect(loader.loadCase(dir).labelScores).toEqual({
        locationAccuracy: 1,
        typeAccuracy: 2,
        explainability: 3,
        efficiency: 4,
      });
    });

    it('defaults missing label fields to 0', () => {
      const dir = caseDir('s');
      writeJson(path.join(dir, 'labels.json'), {});

      expect(loader.loadCase(dir).labelScores).toEqual({
        locationAccuracy: 0,
        typeAccuracy: 0,
        explainability: 0,
        efficiency: 0,
      });
    });

    it('returns undefined for a malformed labels.json', () => {
      const dir = caseDir('s');
      writeText(path.join(dir, 'labels.json'), '{oops');

      expect(loader.loadCase(dir).labelScores).toBeUndefined();
    });
  });

  // ── CSV degradation ─────────────────────────────────────

  describe('CSV sources', () => {
    it('defaults the service when logs.csv has no service column', () => {
      const dir = caseDir('c');
      writeText(path.join(dir, 'logs.csv'), ['timestamp,message', '1,hello'].join('\n'));

      expect(loader.loadCase(dir).logs[0]).toMatchObject({
        timestamp: 1,
        service: 'unknown',
        message: 'hello',
      });
    });

    it('defaults the service when traces.csv has no service column', () => {
      const dir = caseDir('c');
      writeText(path.join(dir, 'traces.csv'), ['trace_id,duration', 't1,5'].join('\n'));

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace).toMatchObject({ traceId: 't1', service: 'unknown', duration: 5 });
      expect(trace.spanId).toBe('t1_unknown');
    });

    it('normalises a ragged row instead of leaking undefined into the entry', () => {
      const dir = caseDir('c');
      // Three headers, two cells: the absent cell must become a default.
      writeText(path.join(dir, 'logs.csv'), ['timestamp,service,message', '1,svc-a'].join('\n'));

      const log = loader.loadCase(dir).logs[0]!;

      expect(log).toMatchObject({ timestamp: 1, service: 'svc-a', message: '' });
      expect(Object.values(log).some((value) => value === undefined)).toBe(false);
    });
  });

  // ── Unreadable paths ────────────────────────────────────

  describe('unreadable source paths', () => {
    // `existsSync` is true for a directory too, so the read itself is what
    // throws. These pin the catch blocks that turn that into a benign default
    // rather than an exception escaping the loader.
    it('degrades to no logs when logs.csv cannot be read as a file', () => {
      const dir = caseDir('x');
      fs.mkdirSync(path.join(dir, 'logs.csv'));

      expect(loader.loadCase(dir).logs).toEqual([]);
    });

    it('degrades to no traces when traces.csv cannot be read as a file', () => {
      const dir = caseDir('x');
      fs.mkdirSync(path.join(dir, 'traces.csv'));

      expect(loader.loadCase(dir).traces).toEqual([]);
    });

    it('falls back to ground_truth.json when inject_time.txt cannot be read as a file', () => {
      const dir = caseDir('x');
      fs.mkdirSync(path.join(dir, 'inject_time.txt'));
      writeJson(path.join(dir, 'ground_truth.json'), { inject_time: 1700000001 });

      expect(loader.loadCase(dir).injectTime).toBe(1700000001000);
    });
  });
});
