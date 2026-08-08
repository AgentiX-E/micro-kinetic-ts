/**
 * Synthetic benchmark data generator.
 *
 * Generates realistic benchmark data matching the RCAEval schema for
 * testing the RCA engine without requiring actual benchmark datasets.
 *
 * Supports 6 fault types with realistic metric patterns:
 *   - CPU fault: Gradual CPU spike (sigmoid/saturation curve)
 *   - MEM fault: Memory leak pattern (linear growth with noise)
 *   - DISK fault: Disk I/O saturation (step function with oscillations)
 *   - DELAY fault: Network latency injection (exponential spike)
 *   - LOSS fault: Packet loss (random drops with threshold)
 *   - SOCKET fault: Socket exhaustion (sawtooth with accumulative drops)
 *
 * Uses numpy-ts patterns for random number generation (np.random)
 * and linear spacing (np.linspace) where applicable.
 *
 * @module benchmarks/synthetic/data-generator
 */

import type {
  CallEdge,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';

import type { BenchmarkCase, BenchmarkSuite } from '../loaders/types.js';

// ── Math Helpers (numpy-ts-like) ─────────────────────────

/** Simple seeded random number generator (Linear Congruential Generator). */
class Random {
  private seed: number;

  constructor(seed?: number) {
    this.seed = seed ?? Date.now();
  }

  /** Generate a random number in [0, 1). */
  random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }

  /** Generate a random number from normal distribution (Box-Muller). */
  normal(mean = 0, stdDev = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.random();
    while (v === 0) v = this.random();
    return mean + stdDev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  /** Generate random integer in [min, max]. */
  randInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  /** Pick a random element from an array. */
  choice<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.random() * arr.length)]!;
  }
}

/** linspace: returns n evenly spaced values from start to end (inclusive). */
function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const result: number[] = [];
  const step = (end - start) / (n - 1);
  for (let i = 0; i < n; i++) {
    result.push(start + step * i);
  }
  return result;
}

/**
 * Add Gaussian noise to an array.
 * @param values - Original values to modify in-place.
 * @param noiseRatio - Standard deviation as fraction of range.
 * @param rng - Random number generator.
 */
function addNoise(values: Float64Array, noiseRatio: number, rng: Random): void {
  const range = max(values) - min(values);
  const stdDev = range * noiseRatio;
  for (let i = 0; i < values.length; i++) {
    values[i]! += rng.normal(0, stdDev);
  }
}

function min(arr: Float64Array | number[]): number {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! < m) m = arr[i]!;
  }
  return m;
}

function max(arr: Float64Array | number[]): number {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]! > m) m = arr[i]!;
  }
  return m;
}

// ── Synthetic Benchmark Generator ─────────────────────────

/** Service names for synthetic benchmarks. */
const SERVICE_NAMES = [
  'frontend',
  'cartservice',
  'productcatalog',
  'checkoutservice',
  'paymentservice',
  'shippingservice',
  'emailservice',
  'currencyservice',
  'recommendationservice',
  'adservice',
  'redis-cache',
  'rabbitmq',
  'postgres',
  'elasticsearch',
  'kafka-broker',
];

/** Metric names per category. */
const METRIC_CATEGORIES: Record<string, string[]> = {
  CPU: ['cpu_usage_percent', 'cpu_throttle_percent'],
  MEMORY: ['memory_rss_bytes', 'memory_working_set_bytes', 'memory_page_faults'],
  DISK: ['disk_read_iops', 'disk_write_iops', 'disk_utilization_percent'],
  NETWORK_DELAY: ['network_latency_ms', 'request_duration_ms', 'tcp_retransmit_rate'],
  NETWORK_LOSS: ['packet_loss_rate', 'connection_error_rate', 'timeout_rate'],
  SOCKET: ['socket_count', 'file_descriptor_count', 'connection_pool_size'],
};

/** Number of timestamps per time series. */
const NUM_TIMESTAMPS = 200;

/** Duration in milliseconds. */
const DURATION_MS = 600_000; // 10 minutes

/**
 * Generator for synthetic benchmark data matching RCAEval format.
 *
 * Creates realistic metric patterns with fault injections to test
 * the RCA engine's ability to identify root causes.
 */
export class SyntheticBenchmarkGenerator {
  private readonly rng: Random;

  constructor(seed?: number) {
    this.rng = new Random(seed);
  }

  /**
   * Generate a single RCAEval-format benchmark case with synthetic data.
   *
   * @param faultType - Fault type to inject (e.g., "CPU_HIGH").
   * @param numServices - Number of services in the call graph.
   * @returns A complete BenchmarkCase.
   */
  generateRCAEvalCase(faultType: string, numServices: number = 5): BenchmarkCase {
    const serviceNames = SERVICE_NAMES.slice(0, Math.min(numServices, SERVICE_NAMES.length));
    const actualServiceCount = Math.max(numServices, serviceNames.length);

    // Generate additional service names if needed
    const allServices = [...serviceNames];
    for (let i = allServices.length; i < actualServiceCount; i++) {
      allServices.push(`service_${i + 1}`);
    }

    // Select the faulty service (first service for deterministic behavior)
    const faultyService = allServices[0]!;

    // Build call graph
    const callGraph = this.generateCallGraph(allServices, false);

    // Generate timestamps
    const timestamps = this.generateTimestamps();
    const injectIndex = Math.floor(timestamps.length * 0.4); // Inject at 40%
    const injectTime = timestamps[injectIndex]!;

    // Generate metric data
    const metricMap = new Map<string, readonly TimeSeries[]>();
    for (const svc of allServices) {
      const isFaulty = svc === faultyService;
      metricMap.set(
        svc,
        this.generateServiceMetrics(svc, timestamps, injectIndex, faultType, isFaulty),
      );
    }

    return {
      id: `synthetic_${faultType}_${numServices}s`,
      datasetName: 'rcaeval-re1',
      callGraph,
      metrics: metricMap,
      injectTime,
      groundTruth: {
        serviceId: faultyService,
        faultType,
      },
    };
  }

  /**
   * Generate a complete synthetic RCAEval suite.
   *
   * @param suiteName - Suite identifier.
   * @param numCases - Number of cases to generate.
   * @returns A BenchmarkSuite.
   */
  generateRCAEvalSuite(suiteName: string, numCases: number): BenchmarkSuite {
    const faultTypes = ['CPU', 'MEM', 'DISK', 'DELAY', 'LOSS', 'SOCKET'];
    const cases: BenchmarkCase[] = [];

    for (let i = 0; i < numCases; i++) {
      const faultType = faultTypes[i % faultTypes.length]!;
      const numServices = 3 + (i % 5); // 3-7 services
      cases.push(this.generateRCAEvalCase(faultType, numServices));
    }

    return {
      name: suiteName,
      cases,
      totalCases: cases.length,
    };
  }

  // ── Fault Type Generators ──────────────────────────────

  /** Generate CPU fault pattern: gradual spike (saturation curve). */
  generateCPUFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;
    const baseline = 20 + this.rng.normal(0, 2);

    // Normal services stay around baseline
    const normalCpu = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      normalCpu[i] = Math.max(0, Math.min(100, baseline + this.rng.normal(0, 2)));
    }

    // Faulty service: CPU grows from baseline to ~95% over time after injection
    const faultyCpu = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultyCpu[i]! = baseline + this.rng.normal(0, 2);
      } else {
        const progress = (i - injectIndex) / (n - injectIndex);
        // S-shaped saturation curve
        const saturation = 1 / (1 + Math.exp(-10 * (progress - 0.3)));
        faultyCpu[i]! = baseline + (95 - baseline) * saturation + this.rng.normal(0, 3);
      }
      faultyCpu[i] = Math.max(0, Math.min(100, faultyCpu[i]!));
    }

    return [
      {
        label: 'cpu_usage_percent',
        timestamps,
        values: faultyCpu,
        unit: 'percent',
      },
      {
        label: 'cpu_throttle_percent',
        timestamps,
        values: normalCpu,
        unit: 'percent',
      },
    ];
  }

  /** Generate MEM fault pattern: memory leak (linear growth with noise). */
  generateMEMFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;
    const baseline = 128 * 1024 * 1024; // 128 MB
    const leakRate = 0.5 * 1024 * 1024; // 0.5 MB per step

    // Faulty service: memory grows linearly after injection
    const faultyMem = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultyMem[i] = baseline + this.rng.normal(0, baseline * 0.02);
      } else {
        const steps = i - injectIndex;
        faultyMem[i] = baseline + leakRate * steps + this.rng.normal(0, baseline * 0.05);
      }
    }

    // Working set follows similar pattern
    const workingSet = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      workingSet[i] = faultyMem[i]! * (0.6 + this.rng.normal(0, 0.05));
    }

    return [
      {
        label: 'memory_rss_bytes',
        timestamps,
        values: faultyMem,
        unit: 'bytes',
      },
      {
        label: 'memory_working_set_bytes',
        timestamps,
        values: workingSet,
        unit: 'bytes',
      },
    ];
  }

  /** Generate DISK fault pattern: I/O saturation (step function). */
  generateDISKFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;
    const baselineRead = 100;
    const baselineWrite = 200;

    // Faulty service: disk I/O spikes after injection
    const faultyRead = new Float64Array(n);
    const faultyWrite = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultyRead[i] = baselineRead + this.rng.normal(0, 20);
        faultyWrite[i] = baselineWrite + this.rng.normal(0, 30);
      } else {
        const progress = (i - injectIndex) / (n - injectIndex);
        // Step function: ramps up and stays high
        const multiplier = progress < 0.2 ? 1 + 3 * (progress / 0.2) : 4;
        faultyRead[i] = baselineRead * multiplier + this.rng.normal(0, 50);
        faultyWrite[i] = baselineWrite * multiplier + this.rng.normal(0, 50);
      }
    }

    return [
      {
        label: 'disk_read_iops',
        timestamps,
        values: faultyRead,
        unit: 'iops',
      },
      {
        label: 'disk_write_iops',
        timestamps,
        values: faultyWrite,
        unit: 'iops',
      },
    ];
  }

  /** Generate DELAY fault pattern: network latency injection (exponential spike). */
  generateDELAYFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;

    // Faulty service: latency spikes exponentially
    const faultyLatency = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultyLatency[i]! = 5 + this.rng.normal(0, 1);
      } else {
        const progress = (i - injectIndex) / (n - injectIndex);
        // Exponential growth from 5ms to 500ms
        faultyLatency[i]! = 5 * Math.exp(4.6 * progress) + this.rng.normal(0, 50);
        faultyLatency[i] = Math.max(0, faultyLatency[i]!);
      }
    }

    // TCP retransmit rate also spikes
    const retransmit = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        retransmit[i]! = 0.001 + this.rng.normal(0, 0.0005);
      } else {
        const progress = (i - injectIndex) / (n - injectIndex);
        retransmit[i]! = 0.001 + 0.1 * Math.pow(progress, 2) + this.rng.normal(0, 0.01);
        retransmit[i] = Math.max(0, retransmit[i]!);
      }
    }

    return [
      {
        label: 'network_latency_ms',
        timestamps,
        values: faultyLatency,
        unit: 'ms',
      },
      {
        label: 'tcp_retransmit_rate',
        timestamps,
        values: retransmit,
        unit: 'rate',
      },
    ];
  }

  /** Generate LOSS fault pattern: packet loss (random drops). */
  generateLOSSFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;

    // Faulty service: packet loss rate jumps after injection
    const faultyLoss = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultyLoss[i]! = Math.max(0, this.rng.normal(0.001, 0.0005));
      } else {
        const progress = (i - injectIndex) / (n - injectIndex);
        const baseLoss = 0.05 + 0.15 * progress;
        // Oscillating packet loss pattern
        const oscillation = 0.02 * Math.sin(progress * 10 * Math.PI);
        faultyLoss[i]! = Math.max(
          0,
          Math.min(1, baseLoss + oscillation + this.rng.normal(0, 0.02)),
        );
      }
    }

    // Error rate also increases
    const errorRate = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        errorRate[i] = Math.max(0, this.rng.normal(0.01, 0.005));
      } else {
        errorRate[i] = Math.max(0, Math.min(1, faultyLoss[i]! * 2 + this.rng.normal(0, 0.03)));
      }
    }

    return [
      {
        label: 'packet_loss_rate',
        timestamps,
        values: faultyLoss,
        unit: 'rate',
      },
      {
        label: 'connection_error_rate',
        timestamps,
        values: errorRate,
        unit: 'rate',
      },
    ];
  }

  /** Generate SOCKET fault pattern: socket exhaustion (sawtooth pattern). */
  generateSOCKETFault(timestamps: number[], injectIndex: number): TimeSeries[] {
    const n = timestamps.length;
    const limit = 65536;

    // Faulty service: socket count grows to exhaustion
    const faultySocketCount = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      if (i < injectIndex) {
        faultySocketCount[i]! = 100 + this.rng.normal(0, 10);
      } else {
        const steps = i - injectIndex;
        // Sawtooth: accumulates and partially resets
        const baseGrowth = 500 * (steps / (n - injectIndex));
        const sawtooth = baseGrowth - 200 * Math.floor(baseGrowth / 300);
        faultySocketCount[i]! = 100 + sawtooth + this.rng.normal(0, 20);
        faultySocketCount[i] = Math.max(0, Math.min(limit, faultySocketCount[i]!));
      }
    }

    // File descriptor count follows similar pattern
    const fdCount = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      fdCount[i] = faultySocketCount[i]! * 1.5 + this.rng.normal(0, 50);
      fdCount[i] = Math.max(0, fdCount[i]!);
    }

    return [
      {
        label: 'socket_count',
        timestamps,
        values: faultySocketCount,
        unit: 'count',
      },
      {
        label: 'file_descriptor_count',
        timestamps,
        values: fdCount,
        unit: 'count',
      },
    ];
  }

  // ── Call Graph Generator ───────────────────────────────

  /**
   * Generate a service call graph.
   *
   * @param serviceNames - List of service IDs.
   * @param withCycles - Whether to include cyclic dependencies.
   * @returns ServiceCallGraph.
   */
  generateCallGraph(serviceNames: string[], withCycles: boolean): ServiceCallGraph {
    if (serviceNames.length === 0) {
      return {
        nodes: new Map(),
        edges: [],
        systemLoad: 0,
      };
    }

    const nodes = new Map<string, ServiceNode>();
    for (const svc of serviceNames) {
      nodes.set(svc, {
        id: svc,
        name: svc.replace(/-/g, ' ').replace(/_/g, ' '),
        namespace: 'synthetic',
        labels: { synthetic: 'true' },
      });
    }

    const edges: CallEdge[] = this.buildEdges(serviceNames, withCycles);

    return {
      nodes,
      edges,
      systemLoad: 0.3 + this.rng.random() * 0.4, // 0.3-0.7
    };
  }

  private buildEdges(serviceNames: string[], withCycles: boolean): CallEdge[] {
    const edges: CallEdge[] = [];

    if (serviceNames.length <= 1) return edges;

    // Build a chain: service[0] -> service[1] -> service[2] ...
    for (let i = 1; i < serviceNames.length; i++) {
      edges.push(createEdge(serviceNames[i - 1]!, serviceNames[i]!, this.rng));
    }

    // Add fan-out edges from service[0] to service[2..N]
    for (let i = 2; i < serviceNames.length; i++) {
      if (this.rng.random() < 0.5) {
        edges.push(createEdge(serviceNames[0]!, serviceNames[i]!, this.rng));
      }
    }

    // Optionally add a cycle (service[N-1] -> service[0])
    if (withCycles && serviceNames.length >= 3) {
      edges.push(createEdge(serviceNames[serviceNames.length - 1]!, serviceNames[0]!, this.rng));
    }

    return edges;
  }

  // ── Metric Generators ──────────────────────────────────

  private generateServiceMetrics(
    serviceName: string,
    timestamps: number[],
    injectIndex: number,
    faultType: string,
    isFaulty: boolean,
  ): TimeSeries[] {
    if (!isFaulty) {
      return this.generateNormalMetrics(timestamps);
    }

    switch (faultType.toUpperCase()) {
      case 'CPU':
      case 'CPU_HIGH':
        return this.generateCPUFault(timestamps, injectIndex);
      case 'MEM':
      case 'MEM_LEAK':
      case 'MEMORY_LEAK':
        return this.generateMEMFault(timestamps, injectIndex);
      case 'DISK':
      case 'DISK_IO':
        return this.generateDISKFault(timestamps, injectIndex);
      case 'DELAY':
      case 'NETWORK_DELAY':
        return this.generateDELAYFault(timestamps, injectIndex);
      case 'LOSS':
      case 'NETWORK_LOSS':
        return this.generateLOSSFault(timestamps, injectIndex);
      case 'SOCKET':
      case 'SOCKET_EXHAUSTION':
        return this.generateSOCKETFault(timestamps, injectIndex);
      default:
        return this.generateNormalMetrics(timestamps);
    }
  }

  private generateNormalMetrics(timestamps: number[]): TimeSeries[] {
    const n = timestamps.length;
    const cpuValues = new Float64Array(n);
    const memValues = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      cpuValues[i] = Math.max(0, Math.min(100, 30 + this.rng.normal(0, 3)));
      memValues[i] = 128 * 1024 * 1024 + this.rng.normal(0, 10 * 1024 * 1024);
    }

    return [
      {
        label: 'cpu_usage_percent',
        timestamps,
        values: cpuValues,
        unit: 'percent',
      },
      {
        label: 'memory_rss_bytes',
        timestamps,
        values: memValues,
        unit: 'bytes',
      },
    ];
  }

  private generateTimestamps(): number[] {
    const now = Date.now();
    const step = DURATION_MS / NUM_TIMESTAMPS;
    const stamps: number[] = [];
    for (let i = 0; i < NUM_TIMESTAMPS; i++) {
      stamps.push(now + i * step);
    }
    return stamps;
  }
}

// ── Edge Helpers ──────────────────────────────────────────

function createEdge(from: string, to: string, rng: Random): CallEdge {
  return {
    from,
    to,
    type: rng.choice<'REST' | 'gRPC' | 'MQ'>(['REST', 'gRPC', 'MQ']),
    callRate: 10 + rng.randInt(0, 90),
    p99Latency: 5 + rng.randInt(0, 45),
    errorRate: rng.random() * 0.05,
  };
}
