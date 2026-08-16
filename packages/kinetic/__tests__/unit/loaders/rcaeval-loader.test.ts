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

import { RCAEvalLoader } from '../../../src/benchmarks/loaders/rcaeval-loader.js';

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
