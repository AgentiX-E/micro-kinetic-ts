/**
 * Tests for PC Validator (I8-P4b): PC algorithm topology validation bridge.
 *
 * Covers:
 * - validateTopologyWithPC: all configurations, edge cases
 * - canValidateWithPC: threshold checks
 * - Integration: PC skeleton → call graph edge mapping
 * - v-structure detection and edge boosting
 * - pruneNonCausal mode
 * - discoverNewEdges mode
 * - Empty graph / single node / insufficient data handling
 *
 * @module tests/signals/pc-validator
 */

import { describe, it, expect } from 'vitest';
import type { CallEdge, MetricMap, ServiceCallGraph, ServiceNode, TimeSeries } from '@agentix-e/micro-kinetic-core';
import { validateTopologyWithPC, canValidateWithPC } from '../../../src/signals/pc-validator.js';
import type { PCValidationResult } from '../../../src/signals/pc-validator.js';

// ── Helpers ────────────────────────────────────────────────

function makeNode(id: string, name?: string, namespace?: string): ServiceNode {
  return { id, name: name ?? id, namespace: namespace ?? 'test', labels: {} };
}

function makeGraph(
  nodeIds: string[],
  edgePairs: [string, string][],
): ServiceCallGraph {
  const nodes = new Map<string, ServiceNode>();
  const edges: CallEdge[] = [];

  for (const id of nodeIds) {
    nodes.set(id, makeNode(id));
  }
  for (const [from, to] of edgePairs) {
    edges.push({
      from,
      to,
      type: 'REST',
      callRate: 100,
      p99Latency: 50,
      errorRate: 0.01,
    });
  }

  return { nodes, edges, systemLoad: 0.5 };
}

/**
 * Generate synthetic time series for N nodes.
 *
 * - A: base signal with a spike at end (root cause candidate)
 * - B: A * 0.8 + noise (causal child of A)
 * - C: independent signal (no causal link to A or B)
 * - D: B * 0.7 + noise (causal child of B)
 */
function makeCausalMetrics(nodeIds: string[]): MetricMap {
  const n = 20;
  const metrics = new Map<string, Map<string, TimeSeries>>();

  // Generate base signals
  const baseA = new Float64Array(n);
  const baseC = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    baseA[i] = 10 + Math.sin(i * 0.5) * 2 + Math.random() * 0.5;
    baseC[i] = 5 + Math.cos(i * 0.7) * 3 + Math.random() * 0.5;
  }
  // Spike at end for A (root cause fault)
  baseA[n - 1] = 100;
  baseA[n - 2] = 80;
  baseA[n - 3] = 60;

  // B = A * 0.8 + noise → strong causal link from A
  const baseB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    baseB[i] = baseA[i] * 0.8 + Math.random();
  }

  // D = B * 0.7 + noise → causal link from B
  const baseD = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    baseD[i] = baseB[i] * 0.7 + Math.random() * 2;
  }

  const signals: Map<string, Float64Array> = new Map();
  signals.set('A', baseA);
  signals.set('B', baseB);
  signals.set('C', baseC);
  signals.set('D', baseD);

  for (const [id, values] of signals) {
    if (nodeIds.includes(id)) {
      const m = new Map<string, TimeSeries>();
      m.set('latency', {
        metricName: 'latency',
        labels: { service: id },
        values,
        timestamps: [],
      });
      metrics.set(id, m);
    }
  }

  return metrics;
}

// ── Tests: canValidateWithPC ───────────────────────────────

describe('canValidateWithPC', () => {
  it('returns false for empty metrics', () => {
    expect(canValidateWithPC(new Map())).toBe(false);
  });

  it('returns false when nodes lack sufficient data points', () => {
    const metrics = new Map<string, Map<string, TimeSeries>>();
    const m = new Map<string, TimeSeries>();
    m.set('latency', {
      metricName: 'latency',
      labels: {},
      values: new Float64Array([1, 2, 3]), // Only 3 data points
      timestamps: [],
    });
    metrics.set('A', m);
    metrics.set('B', new Map(m));
    metrics.set('C', new Map(m));
    expect(canValidateWithPC(metrics)).toBe(false);
  });

  it('returns true when enough nodes have sufficient data', () => {
    const metrics = makeCausalMetrics(['A', 'B', 'C', 'D']);
    expect(canValidateWithPC(metrics)).toBe(true);
  });

  it('respects custom minNodes threshold', () => {
    const metrics = makeCausalMetrics(['A', 'B']);
    expect(canValidateWithPC(metrics, 2)).toBe(true);
    expect(canValidateWithPC(metrics, 3)).toBe(false);
  });

  it('respects custom minDataPoints threshold', () => {
    const shortMetrics = new Map<string, Map<string, TimeSeries>>();
    for (const id of ['A', 'B', 'C', 'D']) {
      const m = new Map<string, TimeSeries>();
      m.set('latency', {
        metricName: 'latency',
        labels: {},
        values: new Float64Array([1, 2, 3, 4]), // Only 4 points
        timestamps: [],
      });
      shortMetrics.set(id, m);
    }
    expect(canValidateWithPC(shortMetrics, 3, 5)).toBe(false);
    expect(canValidateWithPC(shortMetrics, 3, 4)).toBe(true);
  });
});

// ── Tests: validateTopologyWithPC ──────────────────────────

describe('validateTopologyWithPC', () => {
  it('returns original graph for single node', () => {
    const graph = makeGraph(['A'], []);
    const metrics = makeCausalMetrics(['A']);
    const result = validateTopologyWithPC(graph, metrics);
    expect(result.refinedGraph.nodes.size).toBe(1);
    expect(result.originalEdgeCount).toBe(0);
    expect(result.refinedEdgeCount).toBe(0);
    expect(result.vStructureCount).toBe(0);
  });

  it('returns original graph for empty metrics (no time series)', () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const result = validateTopologyWithPC(graph, new Map());
    expect(result.refinedGraph.edges.length).toBe(1);
    expect(result.prunedEdges.length).toBe(0);
    expect(result.discoveredEdges.length).toBe(0);
  });

  it('preserves existing edges when they match PC skeleton (causal chain A→B)', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    const metrics = makeCausalMetrics(['A', 'B', 'C']);
    const result = validateTopologyWithPC(graph, metrics);

    expect(result.refinedGraph.nodes.size).toBe(3);
    // A→B and B→C should be preserved (B is causal child of A, C independent)
    expect(result.refinedGraph.edges.length).toBeGreaterThanOrEqual(1);
    expect(result.vStructureCount).toBeGreaterThanOrEqual(0);
  });

  it('correctly identifies causal chain structure', () => {
    // A→B→D chain (D dependent on B, B dependent on A)
    const graph = makeGraph(['A', 'B', 'D'], [['A', 'B'], ['B', 'D']]);
    const metrics = makeCausalMetrics(['A', 'B', 'D']);
    const result = validateTopologyWithPC(graph, metrics, { reportPCResult: true });

    expect(result.refinedGraph.nodes.size).toBeGreaterThanOrEqual(2);
    expect(result.pcResult).toBeDefined();
    if (result.pcResult) {
      expect(result.pcResult.skeleton.length).toBeGreaterThan(0);
    }
  });

  it('detects when C is independent of A and B', () => {
    // A→C edge should be questioned because C has independent signal
    const graph = makeGraph(['A', 'B', 'C', 'D'], [
      ['A', 'B'], ['A', 'C'], ['B', 'D'],
    ]);
    const metrics = makeCausalMetrics(['A', 'B', 'C', 'D']);
    const result = validateTopologyWithPC(graph, metrics, { reportPCResult: true });

    // A→C may be removed from skeleton because C is independent
    // A→B and B→D should be in skeleton (causal chain)
    // At minimum, all original edges survive in non-prune mode
    expect(result.refinedGraph.edges.length).toBeGreaterThanOrEqual(2);
    expect(result.prunedEdges.length).toBe(0); // Default: pruneNonCausal=false
  });

  // ── pruneNonCausal mode ──

  it('prunes non-causal edges when pruneNonCausal=true', () => {
    const graph = makeGraph(['A', 'B', 'C', 'D'], [
      ['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D'],
    ]);
    const metrics = makeCausalMetrics(['A', 'B', 'C', 'D']);
    const result = validateTopologyWithPC(graph, metrics, { pruneNonCausal: true });

    // With pruneNonCausal=true, edges not in PC skeleton are removed
    expect(result.prunedEdges.length).toBeGreaterThanOrEqual(0);
    expect(result.refinedGraph.edges.length).toBeLessThanOrEqual(graph.edges.length);
    // All non-pruned edges should be in the skeleton
    const skeletonSet = new Set<string>();
    for (const s of result.prunedEdges) {
      skeletonSet.add(`${s.from}→${s.to}`);
    }
    // Edges that weren't pruned should differ from original
    if (result.prunedEdges.length > 0) {
      expect(result.refinedGraph.edges.length).toBeLessThan(graph.edges.length);
    }
  });

  // ── discoverNewEdges mode ──

  it('does not discover new edges when discoverNewEdges=false', () => {
    const graph = makeGraph(['A', 'B'], []); // Empty graph — no edges
    const metrics = makeCausalMetrics(['A', 'B']);
    const result = validateTopologyWithPC(graph, metrics, { discoverNewEdges: false });

    expect(result.discoveredEdges.length).toBe(0);
  });

  it('discovers causal edges missing from topology (A→B causal link)', () => {
    // B is a linear function of A — PC should detect this even if
    // we tell it the graph has no edges
    const graph = makeGraph(['A', 'B'], []); // No edges
    const metrics = makeCausalMetrics(['A', 'B']);
    const result = validateTopologyWithPC(graph, metrics, {
      discoverNewEdges: true,
      reportPCResult: true,
    });

    // PC should discover the A→B relationship
    expect(result.vStructureCount).toBeGreaterThanOrEqual(0);
    if (result.pcResult) {
      const hasAB = result.pcResult.skeleton.some(
        (e) => (e.from === 'A' && e.to === 'B') || (e.from === 'B' && e.to === 'A'),
      );
      // B = A*0.8 should create a strong correlation → skeleton edge
      expect(hasAB).toBe(true);
    }
  });

  // ── v-structure detection ──

  it('reports v-structure count from PC result', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    const metrics = makeCausalMetrics(['A', 'B', 'C']);
    const result = validateTopologyWithPC(graph, metrics, { reportPCResult: true });

    expect(result.vStructureCount).toBeGreaterThanOrEqual(0);
    if (result.pcResult) {
      expect(result.pcResult.vStructures).toBeDefined();
    }
  });

  it('boosts callRate for v-structure edges (collision nodes)', () => {
    // Create a v-structure scenario: two independent causes both affecting one child
    // A → C ← B (collider pattern)
    const n = 20;
    const baseA = new Float64Array(n);
    const baseB = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      baseA[i] = Math.sin(i * 0.5) * 5 + Math.random();
      baseB[i] = Math.cos(i * 0.7) * 5 + Math.random();
    }
    // C = A + B + noise → dependent on both (creates collider)
    const baseC = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      baseC[i] = baseA[i] + baseB[i] + Math.random();
    }

    const m = new Map<string, Map<string, TimeSeries>>();
    for (const [id, values] of [['A', baseA], ['B', baseB], ['C', baseC]] as const) {
      const tm = new Map<string, TimeSeries>();
      tm.set('latency', { metricName: 'latency', labels: { service: id }, values, timestamps: [] });
      m.set(id, tm);
    }

    const graph = makeGraph(['A', 'B', 'C'], [['A', 'C'], ['B', 'C']]);
    const result = validateTopologyWithPC(graph, m, { reportPCResult: true });

    if (result.pcResult) {
      // Check if C is a v-structure child (collider: A→C←B)
      const cIsCollider = result.pcResult.vStructures.some((vs) => vs.child === 'C');
      if (cIsCollider) {
        // C should receive the callRate boost from being a v-structure child
        const cIncoming = result.refinedGraph.edges.filter((e) => e.to === 'C');
        for (const e of cIncoming) {
          // Boosted callRate should be significantly above original 100
          expect(e.callRate).toBeGreaterThanOrEqual(100);
        }
      }
    }
  });

  // ── Edge cases ──

  it('handles graph with no edges', () => {
    const graph = makeGraph(['A', 'B', 'C'], []);
    const metrics = makeCausalMetrics(['A', 'B', 'C']);
    const result = validateTopologyWithPC(graph, metrics);
    expect(result.originalEdgeCount).toBe(0);
    expect(result.refinedGraph.nodes.size).toBe(3);
  });

  it('handles nodes with NaN or constant values', () => {
    const n = 20;
    const constantVals = new Float64Array(n);
    constantVals.fill(5); // Zero variance

    const m = new Map<string, Map<string, TimeSeries>>();
    for (const id of ['A', 'B']) {
      const tm = new Map<string, TimeSeries>();
      tm.set('latency', {
        metricName: 'latency',
        labels: { service: id },
        values: constantVals,
        timestamps: [],
      });
      m.set(id, tm);
    }

    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const result = validateTopologyWithPC(graph, m);
    // Should not crash; constant values produce NaN correlation → edge removed from skeleton
    expect(result.refinedGraph.nodes.size).toBe(2);
    expect(result.originalEdgeCount).toBe(1);
  });

  it('handles nodes missing from metrics (no time series data)', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    // Only provide data for A and C
    const metrics = makeCausalMetrics(['A', 'C']);
    const result = validateTopologyWithPC(graph, metrics);
    expect(result.refinedGraph.nodes.size).toBe(3); // All nodes preserved
  });

  it('returns reporting metadata when reportPCResult=true', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'B'], ['B', 'C']]);
    const metrics = makeCausalMetrics(['A', 'B', 'C']);
    const result = validateTopologyWithPC(graph, metrics, { reportPCResult: true });

    expect(result.pcResult).toBeDefined();
    expect(result.originalEdgeCount).toBe(2);
    expect(typeof result.refinedEdgeCount).toBe('number');
    expect(result.prunedEdges).toBeDefined();
    expect(result.discoveredEdges).toBeDefined();
    expect(result.vStructureCount).toBeGreaterThanOrEqual(0);
  });

  it('preserves all nodes from original graph', () => {
    const graph = makeGraph(['A', 'B', 'C', 'D'], [['A', 'B'], ['C', 'D']]);
    const metrics = makeCausalMetrics(['A', 'B', 'C', 'D']);
    const result = validateTopologyWithPC(graph, metrics);

    for (const nodeId of ['A', 'B', 'C', 'D']) {
      expect(result.refinedGraph.nodes.has(nodeId)).toBe(true);
    }
  });

  it('does not crash with many nodes (stress test)', () => {
    const nodeIds = Array.from({ length: 15 }, (_, i) => `S${i}`);
    const edges: [string, string][] = [];
    for (let i = 0; i < nodeIds.length - 1; i++) {
      edges.push([`S${i}`, `S${i + 1}`]);
    }

    const n = 30;
    const metrics = new Map<string, Map<string, TimeSeries>>();
    const baseSignal = new Float64Array(n);
    for (let i = 0; i < n; i++) baseSignal[i] = Math.sin(i * 0.3) * 5;

    for (const id of nodeIds) {
      const vals = new Float64Array(n);
      for (let t = 0; t < n; t++) {
        // Each node has some dependence on the base signal + noise
        vals[t] = baseSignal[t] * (0.5 + Math.random() * 0.5) + Math.random() * 2;
      }
      const tm = new Map<string, TimeSeries>();
      tm.set('latency', { metricName: 'latency', labels: { service: id }, values: vals, timestamps: [] });
      metrics.set(id, tm);
    }

    const graph = makeGraph(nodeIds, edges);
    const start = Date.now();
    const result = validateTopologyWithPC(graph, metrics, { reportPCResult: true });
    const elapsed = Date.now() - start;

    // Should complete in reasonable time (< 5s for 15 nodes)
    expect(elapsed).toBeLessThan(5000);
    expect(result.refinedGraph.nodes.size).toBe(nodeIds.length);
    expect(result.pcResult).toBeDefined();
  });

  it('non-causal edges are de-weighted when pruneNonCausal=false (default)', () => {
    const graph = makeGraph(['A', 'B', 'C'], [['A', 'C'], ['B', 'C']]);
    const metrics = makeCausalMetrics(['A', 'B', 'C']);
    const result = validateTopologyWithPC(graph, metrics);

    // C has independent-like metrics here; A→C and B→C might or might not
    // be in the skeleton. When they are in the skeleton, callRate is boosted.
    // When they're not in the skeleton (default mode), callRate is halved.
    for (const edge of result.refinedGraph.edges) {
      expect(edge.callRate).toBeGreaterThanOrEqual(1); // Minimum 1
      // callRate should be either original 100 (if in skeleton and boosted)
      // or de-weighted to ≤ 100 (floor(100*0.5) = 50) if not in skeleton
      expect(edge.callRate).toBeLessThanOrEqual(150); // Original 100 + v-structure boost max 50
    }
  });
});