import type { MetricMap, ServiceCallGraph, TimeSeries } from '@agentix-e/micro-kinetic-core';
import type { ContextBenchmark, SystemContext } from './types.js';

/**
 * Extract system-level context features from a service call graph and metric data.
 *
 * These features form the input vector x for meta-learning and Gaussian Process
 * surrogate modeling.  All features are normalized to [0,1] or unitless ratios
 * to ensure numerical stability in kernel computations.
 */
export function extractSystemContext(
  callGraph: ServiceCallGraph,
  metrics: MetricMap,
): SystemContext {
  // ── Graph topology features ──
  const serviceCount = callGraph.nodes.size;
  const edgeCount = callGraph.edges.length;
  const maxPossibleEdges = serviceCount * (serviceCount - 1);
  const graphDensity = maxPossibleEdges > 0 ? edgeCount / maxPossibleEdges : 0;

  // Out-degree CV: high → hub-dominated; low → uniform
  const outDegrees = new Map<string, number>();
  for (const nodeId of callGraph.nodes.keys()) {
    outDegrees.set(nodeId, 0);
  }
  for (const edge of callGraph.edges) {
    const current = outDegrees.get(edge.from) ?? 0;
    outDegrees.set(edge.from, current + 1);
  }
  const degreeCV = computeCV(Array.from(outDegrees.values()));

  // Maximum propagation depth via BFS from roots (in-degree = 0)
  const inDegree = new Map<string, number>();
  for (const nodeId of callGraph.nodes.keys()) {
    inDegree.set(nodeId, 0);
  }
  for (const edge of callGraph.edges) {
    const current = inDegree.get(edge.to) ?? 0;
    inDegree.set(edge.to, current + 1);
  }
  const roots: string[] = [];
  for (const [nodeId, deg] of inDegree) {
    if (deg === 0) roots.push(nodeId);
  }
  const maxDepth = computeMaxDepth(callGraph, roots);

  // Trace coverage: fraction of edges from trace-validated sources.
  // RCAEval: RE1 has 0 trace data; RE2/RE3 add trace spans.
  let tracedEdges = 0;
  for (const edge of callGraph.edges) {
    // CallEdge type field is present but trace validation indicator
    // must be inferred.  All edges in RE1 are static + semantic;
    // RE2/RE3 add trace-derived edges.
    if (edge.callRate > 0 && edge.p99Latency > 0) {
      // Latency data suggests trace instrumentation
      tracedEdges++;
    }
  }
  const traceCoverage = edgeCount > 0 ? tracedEdges / edgeCount : 0;

  // ── Metric features ──
  const cvValues: number[] = [];
  let spikeTotal = 0;
  let spikeCount = 0;

  for (const [, seriesArray] of metrics) {
    for (const ts of seriesArray) {
      if (ts.values.length < 2) continue;
      const cv = computeCVForTimeSeries(ts);
      cvValues.push(cv);

      spikeTotal++;
      if (isSpikeDominated(ts)) spikeCount++;
    }
  }

  const metricCV = cvValues.length > 0 ? mean(cvValues) : 0;
  const spikeDominanceRatio = spikeTotal > 0 ? spikeCount / spikeTotal : 0;

  // ── Anomaly concentration (requires anomaly scores) ──
  // Computed externally and passed in; default to 0 when unavailable.
  // The extractor is called before anomaly scores exist, so this
  // feature is updated post-hoc by the benchmark runner.
  const anomalyConcentration = 0;

  // ── RCAEval metadata features ──
  const systemLoad = callGraph.systemLoad;
  const faultTypeCount = 0; // Filled by benchmark runner
  const avgCasesPerType = 0; // Filled by benchmark runner

  return {
    serviceCount,
    graphDensity: clamp(graphDensity, 0, 1),
    degreeCV: clamp(degreeCV, 0, 10),
    maxDepth: clamp(maxDepth, 0, 50),
    traceCoverage: clamp(traceCoverage, 0, 1),
    metricCV: clamp(metricCV, 0, 10),
    spikeDominanceRatio: clamp(spikeDominanceRatio, 0, 1),
    anomalyConcentration: clamp(anomalyConcentration, 0, 1),
    systemLoad: clamp(systemLoad, 0, 1),
    faultTypeCount,
    avgCasesPerType,
  };
}

/**
 * Known context values for benchmark-verified systems.
 * Used to validate the extractor produces correct values.
 */
export const BENCHMARK_CONTEXTS: readonly ContextBenchmark[] = [];

// ── Internal helpers ──

/** Compute coefficient of variation: σ / |μ| */
function computeCV(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  if (avg === 0) return 0;
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance) / Math.abs(avg);
}

/** Compute CV for a TimeSeries based on its values */
function computeCVForTimeSeries(ts: TimeSeries): number {
  const n = ts.values.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ts.values[i]!;
  const avg = sum / n;
  if (avg === 0) return 0;
  let varianceSum = 0;
  for (let i = 0; i < n; i++) varianceSum += (ts.values[i]! - avg) ** 2;
  return Math.sqrt(varianceSum / (n - 1)) / Math.abs(avg);
}

/** Detect spike-dominated metric: >30% of values exceed 0.8×max */
function isSpikeDominated(ts: TimeSeries): boolean {
  const n = ts.values.length;
  if (n < 3) return false;
  let maxVal = -Infinity;
  for (let i = 0; i < n; i++) {
    if (ts.values[i]! > maxVal) maxVal = ts.values[i]!;
  }
  const threshold = maxVal * 0.8;
  let spikeCount = 0;
  for (let i = 0; i < n; i++) {
    if (ts.values[i]! >= threshold) spikeCount++;
  }
  return spikeCount / n > 0.3;
}

/** Mean of number array */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Clamp value to [min, max] */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Compute maximum graph depth via BFS from root nodes.
 * Depth = longest simple path from any root to any leaf.
 */
function computeMaxDepth(callGraph: ServiceCallGraph, roots: string[]): number {
  if (roots.length === 0) return 0;

  // Build forward adjacency
  const forwardAdj = new Map<string, string[]>();
  for (const nodeId of callGraph.nodes.keys()) {
    forwardAdj.set(nodeId, []);
  }
  for (const edge of callGraph.edges) {
    const list = forwardAdj.get(edge.from);
    if (list) list.push(edge.to);
  }

  let maxDepth = 0;
  const visited = new Set<string>();

  for (const root of roots) {
    const depth = bfsMaxDepth(root, forwardAdj, visited);
    if (depth > maxDepth) maxDepth = depth;
  }

  return maxDepth;
}

/** BFS from a single root to find max depth */
function bfsMaxDepth(
  root: string,
  forwardAdj: Map<string, string[]>,
  visited: Set<string>,
): number {
  const localVisited = new Set<string>();
  const queue: Array<{ node: string; depth: number }> = [{ node: root, depth: 0 }];
  let maxDepth = 0;

  while (queue.length > 0) {
    const { node, depth } = queue.shift()!;
    if (localVisited.has(node)) continue;
    localVisited.add(node);
    visited.add(node);

    if (depth > maxDepth) maxDepth = depth;

    const children = forwardAdj.get(node) ?? [];
    for (const child of children) {
      if (!localVisited.has(child)) {
        queue.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return maxDepth;
}

/**
 * Type-safe approximate-close matcher for benchmark context validation.
 * Use `expectCloseTo(actual, expected, tolerance)` in tests.
 */
export interface CloseToMatcher {
  readonly __brand: 'CloseToMatcher';
}

class CloseToPrimitive implements CloseToMatcher {
  readonly __brand = 'CloseToMatcher' as const;
  constructor(
    readonly value: number,
    readonly tolerance: number = 0.1,
  ) {}
}

export function expectCloseTo(
  actual: number,
  expected: number | CloseToMatcher,
  tolerance?: number,
): boolean {
  if (expected instanceof CloseToPrimitive) {
    return (
      Math.abs(actual - expected.value) / Math.max(1, Math.abs(expected.value)) <=
      expected.tolerance
    );
  }
  const tol = tolerance ?? 0.1;
  const relError = Math.abs(actual - expected) / Math.max(1, Math.abs(expected));
  return relError <= tol;
}

expectCloseTo.primitive = (value: number, tolerance?: number): CloseToMatcher =>
  new CloseToPrimitive(value, tolerance);
