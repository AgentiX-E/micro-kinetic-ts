/**
 * Unit tests for RCA100Loader.
 *
 * RCA100 is the Tianchi AIOps Track benchmark: six modalities, a four-layer
 * ground truth, and a topology file that doubles as the call graph. Every one of
 * those sources is optional, so the loader is mostly degradation logic — which
 * is exactly what these tests pin down. Fixtures are written to a temp
 * directory; nothing is mocked and no dataset is required.
 *
 * @module __tests__/unit/loaders/rca100-loader.test
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RCA100Loader } from '../../../src/benchmarks/loaders/rca100-loader.js';

// ── Helpers ───────────────────────────────────────────────

function writeJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath: string, data: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, data);
}

describe('RCA100Loader', () => {
  let tempDir: string;
  let loader: RCA100Loader;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rca100-test-'));
    loader = new RCA100Loader();
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
    it('derives the case id from the directory name and assembles all six modalities', () => {
      const dir = caseDir('case-0001');
      writeJson(path.join(dir, 'ground_truth.json'), { service: 'svc-a', fault_type: 'cpu' });
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 2, metric_name: 'cpu_usage' }],
      });
      writeJson(path.join(dir, 'logs.json'), [{ timestamp: 5, service: 'svc-a', message: 'm' }]);
      writeJson(path.join(dir, 'traces.json'), [{ traceId: 't1', service: 'svc-a' }]);
      writeJson(path.join(dir, 'events.json'), [{ id: 'e1', service: 'svc-a' }]);
      writeJson(path.join(dir, 'alerts.json'), [{ id: 'a1', service: 'svc-a' }]);
      writeJson(path.join(dir, 'topology.json'), { 'svc-a': ['svc-b'] });

      const loaded = loader.loadCase(dir);

      expect(loaded.casePath).toBe(dir);
      expect(loaded.caseId).toBe('case-0001');
      expect(loaded.metrics.size).toBe(1);
      expect(loaded.logs).toHaveLength(1);
      expect(loaded.traces).toHaveLength(1);
      expect(loaded.events).toHaveLength(1);
      expect(loaded.alerts).toHaveLength(1);
      expect([...loaded.callGraph.nodes.keys()]).toEqual(['svc-a', 'svc-b']);
    });

    it('returns empty modalities for a directory with no source files', () => {
      const loaded = loader.loadCase(caseDir('empty-case'));

      expect(loaded.metrics.size).toBe(0);
      expect(loaded.logs).toEqual([]);
      expect(loaded.traces).toEqual([]);
      expect(loaded.events).toEqual([]);
      expect(loaded.alerts).toEqual([]);
      expect(loaded.topology).toEqual({});
      expect(loaded.callGraph.nodes.size).toBe(0);
      expect(loaded.callGraph.edges).toEqual([]);
      expect(loaded.injectTime).toBe(0);
      expect(loaded.groundTruth).toEqual({ serviceId: 'unknown', faultType: 'unknown' });
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
    it('prefixes the id and forwards events, alerts and topology', () => {
      const dir = caseDir('case-7');
      writeJson(path.join(dir, 'events.json'), [{ id: 'e1' }]);
      writeJson(path.join(dir, 'topology.json'), { 'svc-a': ['svc-b'] });

      const converted = loader.toBenchmarkCase(loader.loadCase(dir));

      expect(converted.id).toBe('rca100_case-7');
      expect(converted.datasetName).toBe('rca100');
      expect(converted.events).toHaveLength(1);
      expect(converted.topologyGraph).toEqual({ 'svc-a': ['svc-b'] });
    });
  });

  describe('toBenchmarkSuite', () => {
    it('names the suite and counts the converted cases', () => {
      fs.mkdirSync(path.join(tempDir, 'case-a'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'case-b'), { recursive: true });

      const suite = loader.toBenchmarkSuite(loader.loadSuite(tempDir));

      expect(suite.name).toBe('rca100');
      expect(suite.totalCases).toBe(2);
      expect(suite.cases.map((c) => c.datasetName)).toEqual(['rca100', 'rca100']);
    });
  });

  // ── Ground truth ────────────────────────────────────────

  describe('groundTruth', () => {
    it('builds the four-layer block when causal_chain is present', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), {
        fault_type: 'cpu',
        target_entity: 'svc-a',
        causal_chain: ['svc-a', 'svc-b'],
        observability_checkpoints: ['cpu > 90'],
      });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('svc-a');
      expect(gt.faultType).toBe('cpu');
      expect(gt.rca100Layers).toEqual({
        faultType: 'cpu',
        targetEntity: 'svc-a',
        causalChain: ['svc-a', 'svc-b'],
        observabilityCheckpoints: ['cpu > 90'],
      });
    });

    it('reads the layer field aliases and defaults the optional ones', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), {
        causal_chain: ['svc-a'],
        faultType: 'mem',
        targetEntity: 'svc-b',
      });

      const layers = loader.loadCase(dir).groundTruth.rca100Layers!;

      expect(layers.faultType).toBe('mem');
      expect(layers.targetEntity).toBe('svc-b');
      expect(layers.observabilityCheckpoints).toEqual([]);
    });

    it('falls back through the layer field defaults when nothing is named', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), { causal_chain: [] });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('unknown');
      expect(gt.faultType).toBe('unknown');
      expect(gt.rca100Layers!.causalChain).toEqual([]);
      expect(gt.rca100Layers!.observabilityCheckpoints).toEqual([]);
    });

    it('wraps a non-array causal_chain into a single-element chain', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), {
        causal_chain: 'svc-a',
        target_entity: 'svc-a',
      });

      expect(loader.loadCase(dir).groundTruth.rca100Layers!.causalChain).toEqual(['svc-a']);
    });

    it.each([
      ['snake_case', { fault_type: 'cpu', service: 'svc-a' }],
      ['camelCase', { faultType: 'cpu', target_entity: 'svc-a' }],
      ['serviceId', { faultType: 'cpu', serviceId: 'svc-a' }],
    ])('reads the flat %s fallback chain when there is no causal_chain', (_label, payload) => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), payload);

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('svc-a');
      expect(gt.faultType).toBe('cpu');
      expect(gt.rca100Layers).toBeUndefined();
    });

    it('reads the metric and its alias', () => {
      const a = caseDir('gt-a');
      writeJson(path.join(a, 'ground_truth.json'), { service: 'svc', metric: 'cpu_usage' });
      const b = caseDir('gt-b');
      writeJson(path.join(b, 'ground_truth.json'), { service: 'svc', root_cause_metric: 'mem' });

      expect(loader.loadCase(a).groundTruth.metric).toBe('cpu_usage');
      expect(loader.loadCase(b).groundTruth.metric).toBe('mem');
    });

    it('defaults to "unknown" when ground_truth.json names nothing it knows', () => {
      const dir = caseDir('gt');
      writeJson(path.join(dir, 'ground_truth.json'), { unrelated: 1 });

      const gt = loader.loadCase(dir).groundTruth;

      expect(gt.serviceId).toBe('unknown');
      expect(gt.faultType).toBe('unknown');
      expect(gt.metric).toBeUndefined();
    });

    it('defaults to "unknown" when ground_truth.json is malformed', () => {
      const dir = caseDir('gt');
      writeText(path.join(dir, 'ground_truth.json'), '{oops');

      expect(loader.loadCase(dir).groundTruth.serviceId).toBe('unknown');
    });
  });

  // ── Metrics ─────────────────────────────────────────────

  describe('metrics', () => {
    it('prefers the metrics.json service map over the metrics/ directory', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-single': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });
      writeJson(path.join(dir, 'metrics', 'svc-dir.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-single']);
    });

    it('reads the metrics/ directory of per-service files when metrics.json yields nothing', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), { 'svc-empty': [] });
      writeJson(path.join(dir, 'metrics', 'svc-a.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);
      writeText(path.join(dir, 'metrics', 'notes.txt'), 'ignored');

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-a']);
    });

    it('skips malformed and empty files inside metrics/ and keeps the rest', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics', 'svc-a.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);
      writeText(path.join(dir, 'metrics', 'broken.json'), '{oops');
      writeJson(path.join(dir, 'metrics', 'empty.json'), []);

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-a']);
    });

    it('ignores a file named "metrics" that is not a directory', () => {
      const dir = caseDir('m');
      writeText(path.join(dir, 'metrics'), 'this is a file, not a directory');

      expect(loader.loadCase(dir).metrics.size).toBe(0);
    });

    it('ignores a metrics.json whose root is an array rather than a service map', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), [{ timestamp: 1, value: 1, metric_name: 'cpu' }]);

      expect(loader.loadCase(dir).metrics.size).toBe(0);
    });

    it('survives a malformed metrics.json and still reads the metrics/ directory', () => {
      const dir = caseDir('m');
      writeText(path.join(dir, 'metrics.json'), '[');
      writeJson(path.join(dir, 'metrics', 'svc-a.json'), [
        { timestamp: 1, value: 1, metric_name: 'cpu' },
      ]);

      expect([...loader.loadCase(dir).metrics.keys()]).toEqual(['svc-a']);
    });

    it('drops a null, scalar, empty or unlabelled service entry', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        nulls: null,
        scalars: [1, 2, 3],
        empty: [],
        unlabelled: [{ unrelated: true }],
        nested: { cpu: [1, 2] },
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
      expect(series[0]!.timestamps).toEqual([1000, 2000, 3000]);
      expect([...series[0]!.values]).toEqual([10, 20, 30]);
    });

    it('reads a {label, timestamps, values} array and defaults missing members', () => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [
          { label: 'cpu_usage', timestamps: [1], values: [1], unit: 'percent' },
          { label: 'bare' },
          { timestamps: 'nope', values: 5 },
        ],
      });

      const series = loader.loadCase(dir).metrics.get('svc-a')!;

      expect(series[0]!.unit).toBe('percent');
      expect(series[1]!).toMatchObject({ label: 'bare', timestamps: [], unit: 'count' });
      expect(series[2]!.label).toBe('unknown');
      expect(series[2]!.values).toHaveLength(0);
    });

    const unitCases: Array<[string, string]> = [
      ['cpu_usage', 'percent'],
      ['mem_used', 'bytes'],
      ['memory_free', 'bytes'],
      ['disk_io', 'iops'],
      ['latency_p99', 'ms'],
      ['request_delay', 'ms'],
      ['packet_loss', 'rate'],
      ['error_count', 'rate'],
      ['request_total', 'count'],
    ];

    it.each(unitCases)('infers the unit of %s as %s', (metricName, unit) => {
      const dir = caseDir('m');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: metricName }],
      });

      expect(loader.loadCase(dir).metrics.get('svc-a')![0]!.unit).toBe(unit);
    });
  });

  // ── Logs, traces, events, alerts ────────────────────────

  describe('logs', () => {
    it('reads logs.json with both field aliases and defaults the missing ones', () => {
      const dir = caseDir('l');
      writeJson(path.join(dir, 'logs.json'), [
        { timestamp: 1, service: 'svc-a', message: 'a', level: 'WARNING' },
        { timestamp: 2, serviceId: 'svc-b', message: 'b', level: 'critical' },
        {},
      ]);

      const logs = loader.loadCase(dir).logs;

      expect(logs[0]).toMatchObject({ timestamp: 1, service: 'svc-a', level: 'WARN' });
      expect(logs[1]).toMatchObject({ service: 'svc-b', level: 'FATAL' });
      expect(logs[2]).toMatchObject({ timestamp: 0, service: 'unknown', level: 'INFO' });
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

    it('returns no logs when logs.json is malformed or not an array, and there is no CSV', () => {
      const a = caseDir('l-a');
      writeText(path.join(a, 'logs.json'), '{oops');
      const b = caseDir('l-b');
      writeJson(path.join(b, 'logs.json'), { not: 'an array' });

      expect(loader.loadCase(a).logs).toEqual([]);
      expect(loader.loadCase(b).logs).toEqual([]);
    });
  });

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

      expect(loader.loadCase(dir).traces[0]).toEqual({
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

    it('reads the snake_case aliases, including parent_span', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [
        {
          trace_id: 't1',
          span_id: 's1',
          parent_span: 's0',
          serviceId: 'svc-a',
          operation: 'get',
          start_time: 100,
          duration: 5,
        },
      ]);

      const trace = loader.loadCase(dir).traces[0]!;

      expect(trace).toMatchObject({
        traceId: 't1',
        spanId: 's1',
        parentSpanId: 's0',
        service: 'svc-a',
        operationName: 'get',
        startTime: 100,
        duration: 5,
        status: 'OK',
      });
    });

    it('builds the derived span id from the RESOLVED trace id and service', () => {
      const dir = caseDir('t');
      writeJson(path.join(dir, 'traces.json'), [
        { trace_id: 't1', service: 'svc-a' },
        { trace_id: 't2', serviceId: 'svc-b' },
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

    it('returns no traces when traces.json is malformed or not an array', () => {
      const a = caseDir('t-a');
      writeText(path.join(a, 'traces.json'), '{oops');
      const b = caseDir('t-b');
      writeJson(path.join(b, 'traces.json'), 'not an array');

      expect(loader.loadCase(a).traces).toEqual([]);
      expect(loader.loadCase(b).traces).toEqual([]);
    });
  });

  describe('events', () => {
    it('reads events.json and normalises the severity', () => {
      const dir = caseDir('e');
      writeJson(path.join(dir, 'events.json'), [
        { event_id: 'e1', timestamp: 1, service: 'svc-a', event_type: 'restart', severity: 'CRIT' },
        { id: 'e2', timestamp: 2, serviceId: 'svc-b', type: 'scale', severity: 'major' },
      ]);

      const events = loader.loadCase(dir).events;

      expect(events[0]).toMatchObject({
        eventId: 'e1',
        service: 'svc-a',
        eventType: 'restart',
        severity: 'critical',
        description: '',
        tags: {},
      });
      expect(events[1]).toMatchObject({
        eventId: 'e2',
        service: 'svc-b',
        eventType: 'scale',
        severity: 'major',
      });
    });

    it.each([
      ['critical', 'critical'],
      ['crit', 'critical'],
      ['major', 'major'],
      ['minor', 'minor'],
      ['warning', 'warning'],
      ['warn', 'warning'],
      ['debug', 'info'],
    ])('normalises severity %s to %s', (raw, expected) => {
      const dir = caseDir('e');
      writeJson(path.join(dir, 'events.json'), [{ severity: raw }]);

      expect(loader.loadCase(dir).events[0]!.severity).toBe(expected);
    });

    it('derives the event id from the timestamp and service when no id is given', () => {
      const dir = caseDir('e');
      writeJson(path.join(dir, 'events.json'), [{ timestamp: 1700000000, service: 'svc-a' }]);

      expect(loader.loadCase(dir).events[0]!.eventId).toBe('1700000000_svc-a');
    });

    it('defaults every event field instead of emitting undefined', () => {
      const dir = caseDir('e');
      writeJson(path.join(dir, 'events.json'), [{}]);

      expect(loader.loadCase(dir).events[0]).toEqual({
        eventId: '0_unknown',
        timestamp: 0,
        service: 'unknown',
        eventType: 'unknown',
        severity: 'info',
        description: '',
        tags: {},
      });
    });

    it('returns no events when events.json is malformed or not an array', () => {
      const a = caseDir('e-a');
      writeText(path.join(a, 'events.json'), '{oops');
      const b = caseDir('e-b');
      writeJson(path.join(b, 'events.json'), 42);

      expect(loader.loadCase(a).events).toEqual([]);
      expect(loader.loadCase(b).events).toEqual([]);
    });
  });

  describe('alerts', () => {
    it('reads alerts.json and normalises the severity', () => {
      const dir = caseDir('a');
      writeJson(path.join(dir, 'alerts.json'), [
        {
          alert_id: 'a1',
          timestamp: 1,
          service: 'svc-a',
          alert_name: 'HighCpu',
          severity: 'critical',
          value: 95,
          threshold: 90,
        },
        { id: 'a2', name: 'Alias', serviceId: 'svc-b' },
      ]);

      const alerts = loader.loadCase(dir).alerts;

      expect(alerts[0]).toMatchObject({
        alertId: 'a1',
        alertName: 'HighCpu',
        severity: 'critical',
        value: 95,
        threshold: 90,
      });
      // Absent severity defaults to "warning" for alerts (unlike events -> "info").
      expect(alerts[1]).toMatchObject({
        alertId: 'a2',
        alertName: 'Alias',
        service: 'svc-b',
        severity: 'warning',
      });
    });

    it('defaults every alert field instead of emitting undefined', () => {
      const dir = caseDir('a');
      writeJson(path.join(dir, 'alerts.json'), [{}]);

      expect(loader.loadCase(dir).alerts[0]).toEqual({
        alertId: '0_unknown',
        timestamp: 0,
        service: 'unknown',
        alertName: 'unknown',
        severity: 'warning',
        value: 0,
        threshold: 0,
      });
    });

    it('returns no alerts when alerts.json is malformed or not an array', () => {
      const a = caseDir('a-a');
      writeText(path.join(a, 'alerts.json'), '{oops');
      const b = caseDir('a-b');
      writeJson(path.join(b, 'alerts.json'), false);

      expect(loader.loadCase(a).alerts).toEqual([]);
      expect(loader.loadCase(b).alerts).toEqual([]);
    });
  });

  // ── Topology and call graph ─────────────────────────────

  describe('topology', () => {
    it('keeps only the array-valued entries and stringifies their members', () => {
      const dir = caseDir('tp');
      writeJson(path.join(dir, 'topology.json'), {
        'svc-a': ['svc-b', 7],
        'svc-b': 'not an array',
        'svc-c': [],
      });

      expect(loader.loadCase(dir).topology).toEqual({ 'svc-a': ['svc-b', '7'], 'svc-c': [] });
    });

    it.each([
      ['a JSON array', [1, 2, 3]],
      ['a scalar', 42],
      ['null', null],
    ])('returns an empty topology for %s', (_label, payload) => {
      const dir = caseDir('tp');
      writeJson(path.join(dir, 'topology.json'), payload);

      expect(loader.loadCase(dir).topology).toEqual({});
    });

    it('returns an empty topology for a malformed file', () => {
      const dir = caseDir('tp');
      writeText(path.join(dir, 'topology.json'), '{oops');

      expect(loader.loadCase(dir).topology).toEqual({});
    });
  });

  describe('callGraph', () => {
    it('includes topology keys, their dependencies and the metric services, and edges from the topology', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'topology.json'), { 'svc-a': ['svc-b'] });
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-c': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect([...graph.nodes.keys()].sort()).toEqual(['svc-a', 'svc-b', 'svc-c']);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        from: 'svc-a',
        to: 'svc-b',
        type: 'REST',
        callRate: 100,
        p99Latency: 50,
        errorRate: 0.01,
      });
      expect(graph.systemLoad).toBe(0.5);
      expect(graph.nodes.get('svc-a')).toEqual({
        id: 'svc-a',
        name: 'svc-a',
        namespace: 'default',
        labels: {},
      });
    });

    it('chains the discovered services when the topology yields no edges', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
        'svc-b': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ from: 'svc-a', to: 'svc-b' });
    });

    it('emits no edges when there is only one discovered service', () => {
      const dir = caseDir('g');
      writeJson(path.join(dir, 'metrics.json'), {
        'svc-a': [{ timestamp: 1, value: 1, metric_name: 'cpu' }],
      });

      const graph = loader.loadCase(dir).callGraph;

      expect(graph.nodes.size).toBe(1);
      expect(graph.edges).toEqual([]);
    });

    it('emits no edges for an empty topology and no metrics', () => {
      const graph = loader.loadCase(caseDir('g')).callGraph;

      expect(graph.nodes.size).toBe(0);
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

    it('falls back to the earliest event timestamp when inject_time.txt is non-numeric', () => {
      const dir = caseDir('i');
      writeText(path.join(dir, 'inject_time.txt'), 'not a number');
      writeJson(path.join(dir, 'events.json'), [{ timestamp: 500 }, { timestamp: 300 }]);

      expect(loader.loadCase(dir).injectTime).toBe(300);
    });

    it('falls back to the earliest alert timestamp when there are no events', () => {
      const dir = caseDir('i');
      writeJson(path.join(dir, 'alerts.json'), [{ timestamp: 900 }, { timestamp: 700 }]);

      expect(loader.loadCase(dir).injectTime).toBe(700);
    });

    it('ignores zero timestamps, which carry no ordering information', () => {
      const dir = caseDir('i');
      writeJson(path.join(dir, 'alerts.json'), [{ timestamp: 0 }, { timestamp: 0 }]);

      expect(loader.loadCase(dir).injectTime).toBe(0);
    });

    it('returns 0 when there is no injection-time source at all', () => {
      expect(loader.loadCase(caseDir('i')).injectTime).toBe(0);
    });

    // `existsSync` is true for a directory too, so the read itself is what
    // throws. This pins the catch block that turns that into the fallback
    // rather than an exception escaping the loader.
    it('falls back to the event timestamps when inject_time.txt cannot be read as a file', () => {
      const dir = caseDir('i');
      fs.mkdirSync(path.join(dir, 'inject_time.txt'));
      writeJson(path.join(dir, 'events.json'), [{ timestamp: 4242 }]);

      expect(loader.loadCase(dir).injectTime).toBe(4242);
    });
  });
});
