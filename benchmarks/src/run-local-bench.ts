/**
 * Local full RCAEval benchmark — validates topology correctness end-to-end.
 *
 * Generates synthetic metric data using REAL benchmark service names,
 * runs per-system per-fault-type benchmarks through the CollisionTreeRCAEngine
 * with real call graphs, and reports results in the industry-standard format.
 *
 * Usage:
 *   pnpm exec tsx benchmarks/src/run-local-bench.ts
 *
 * @module benchmarks/run-local-bench
 */

import { Container, DI_TOKENS } from '../../packages/core/src/index.js';
import { BenchmarkRunner } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';
import type { BenchmarkCase, BenchmarkSuite } from '../../packages/kinetic/src/benchmarks/loaders/types.js';
import { RegexFaultClassifier, DEFAULT_CLASSIFICATION_RULES } from '../../packages/core/src/index.js';
import { TreePruner } from '../../packages/tree/src/pruning/pruner.js';
import { TreeRCAEngine } from '../../packages/tree/src/rca/tree-rca.js';
import { NumpyTsMatrixOps } from '../../packages/tree/src/math/numpy-provider.js';
import { buildRCAEvalCallGraph } from './rcaeval-topology.js';
import type { ServiceCallGraph, ServiceNode, TimeSeries, MetricMap } from '../../packages/core/src/index.js';

// ── Per-benchmark service name lists ─────────────────────

const BENCHMARK_SERVICES: Record<string, string[]> = {
  OnlineBoutique: [
    'frontend', 'adservice', 'cartservice', 'checkoutservice',
    'currencyservice', 'emailservice', 'paymentservice',
    'productcatalogservice', 'recommendationservice', 'shippingservice',
  ],
  SockShop: [
    'front-end', 'catalogue', 'carts', 'orders', 'user',
    'payment', 'shipping', 'queue-master',
  ],
  TrainTicket: [
    'ts-ui', 'ts-travel-service', 'ts-train-service', 'ts-route-service',
    'ts-station-service', 'ts-seat-service', 'ts-order-service',
    'ts-preserve-service', 'ts-user-service', 'ts-price-service',
    'ts-config-service', 'ts-security-service', 'ts-auth-service',
    'ts-payment-service', 'ts-assurance-service', 'ts-contacts-service',
    'ts-food-service', 'ts-consign-service', 'ts-voucher-service',
    'ts-verification-code-service', 'ts-basic-service', 'ts-cancel-service',
    'ts-rebook-service', 'ts-execute-service', 'ts-travel2-service',
    'ts-admin-order-service', 'ts-admin-route-service', 'ts-admin-travel-service',
    'ts-admin-user-service', 'ts-admin-basic-info-service',
  ],
};

const FAULT_TYPES = ['cpu', 'mem', 'disk', 'delay', 'loss'];

// ── Synthetic Metric Generator ───────────────────────────

function generateTimestamps(count: number): number[] {
  const ts: number[] = [];
  let base = 1685000000;
  for (let i = 0; i < count; i++) {
    ts.push(base + i * 60);
  }
  return ts;
}

function generateServiceMetrics(
  serviceName: string,
  timestamps: number[],
  injectIdx: number,
  faultType: string,
  isFaulty: boolean,
): TimeSeries[] {
  const series: TimeSeries[] = [];
  const n = timestamps.length;

  // Each service gets 3-5 metric series
  const metricCount = 3 + (serviceName.length % 3);
  const metricNames = [
    `${faultType}_usage`, 'latency_p99', 'throughput',
    'error_rate', 'memory_used',
  ];

  for (let m = 0; m < Math.min(metricCount, metricNames.length); m++) {
    const values = new Float64Array(n);
    const baseline = isFaulty ? 0.15 : 0.05;

    for (let i = 0; i < n; i++) {
      if (isFaulty && i >= injectIdx) {
        // Fault injection: values spike
        const severity = 0.6 + 0.3 * Math.random();
        values[i] = baseline + severity * (1 - baseline);
      } else {
        values[i] = baseline + 0.1 * Math.random();
      }
    }

    series.push({
      label: metricNames[m]!,
      values,
      timestamps,
      unit: m === 0 ? 'percent' : m === 1 ? 'ms' : 'count',
    });
  }

  return series;
}

function generateCase(
  system: string,
  serviceIds: readonly string[],
  faultType: string,
  caseIndex: number,
): BenchmarkCase {
  const timestamps = generateTimestamps(60);
  const injectIdx = 24; // Inject at 40% mark
  const faultyService = serviceIds[caseIndex % serviceIds.length]!;

  const metrics = new Map<string, readonly TimeSeries[]>();
  for (const svc of serviceIds) {
    metrics.set(
      svc,
      generateServiceMetrics(svc, timestamps, injectIdx, faultType, svc === faultyService),
    );
  }

  const callGraph = buildRCAEvalCallGraph(
    `re1${system === 'OnlineBoutique' ? 'ob' : system === 'SockShop' ? 'ss' : 'tt'}_${faultyService}_${faultType}_${caseIndex + 1}`,
    serviceIds,
  );

  return {
    id: `local_${system}_${faultType}_${caseIndex}`,
    datasetName: 'rcaeval-re1',
    callGraph,
    metrics,
    injectTime: timestamps[injectIdx]! * 1000,
    groundTruth: {
      serviceId: faultyService,
      faultType,
    },
  };
}

// ── DI Assembly ───────────────────────────────────────────

function createContainer(): Container {
  const c = new Container();
  c.register(DI_TOKENS.MATRIX_OPS, () => new NumpyTsMatrixOps());
  c.register(DI_TOKENS.RCA_ENGINE, () => new TreePruner());
  c.register(DI_TOKENS.ROOT_CAUSE_RANKER, () => new TreeRCAEngine());
  return c;
}

// ── Main ──────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('Micro-Kinetic — Local Full RCAEval Benchmark (Real Topology)');
  console.log('═'.repeat(70));

  const container = createContainer();
  const classifier = new RegexFaultClassifier(DEFAULT_CLASSIFICATION_RULES);
  const runner = new BenchmarkRunner(container, classifier);
  const CASES_PER_TYPE = 20;

  for (const [system, serviceIds] of Object.entries(BENCHMARK_SERVICES)) {
    const firstId = system === 'OnlineBoutique' ? 're1ob' : system === 'SockShop' ? 're1ss' : 're1tt';
    const metaId = `${firstId}_${serviceIds[0]}_cpu_1`;

    // Verify topology builds correctly
    const testGraph = buildRCAEvalCallGraph(metaId, serviceIds);
    console.log(`\n${system}:  ${testGraph.nodes.size} nodes, ${testGraph.edges.length} edges`);

    // Run per-fault-type
    let header = '║ Method              | Metric |';
    for (const ft of FAULT_TYPES) header += ` ${ft.toUpperCase().padEnd(6)} |`;
    header += ' AVERAGE ║';
    console.log(`\n╔${'═'.repeat(80)}╗`);
    console.log(`║  ${system.padEnd(30)} RE1 (local synth)       Micro-Kinetic      ║`);
    console.log(`╠${'═'.repeat(80)}╣`);
    console.log(header);
    console.log(`╠${'═'.repeat(80)}╣`);

    const avgs: number[] = [];

    for (const ft of FAULT_TYPES) {
      const cases: BenchmarkCase[] = [];
      for (let i = 0; i < CASES_PER_TYPE; i++) {
        cases.push(generateCase(system, serviceIds, ft, i));
      }

      const suite: BenchmarkSuite = { name: `${system}-${ft}`, cases, totalCases: cases.length };
      const result = await runner.runSuite(suite);
      avgs.push(result.avgTop1);
    }

    // Print AC@1 row
    let row = '║ Micro-Kinetic       | AC@1   |';
    for (const v of avgs) row += ` ${(v * 100).toFixed(1).padStart(5)}% |`;
    const avg = avgs.reduce((s, v) => s + v, 0) / avgs.length;
    row += ` ${(avg * 100).toFixed(1).padStart(5)}% ║`;
    console.log(row);
    console.log(`╚${'═'.repeat(80)}╝`);
  }

  console.log('\n═'.repeat(70));
  console.log('Benchmark complete.');
}

main().catch((err) => {
  console.error('Local benchmark failed:', err);
  process.exit(1);
});
