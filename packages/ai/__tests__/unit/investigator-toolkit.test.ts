/**
 * Unit tests for the graph-guided investigator toolkit (GALA+ phase-III).
 *
 * Covers the pure evidence builder, the adjacency summary, and the closed tool
 * surface (candidate listing, evidence lookup, upstream/downstream navigation,
 * and the hop budget). No network — the toolkit is deterministic over a fault
 * propagation graph.
 *
 * @module ai/__tests__/unit/investigator-toolkit
 */

import type { FaultPropagationGraph } from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import {
  GraphInvestigatorToolkit,
  buildAdjacency,
  buildCandidateEvidence,
} from '../../src/agent/investigator-toolkit.js';

// ── Helpers ───────────────────────────────────────────────

function graph(): FaultPropagationGraph {
  return {
    callGraph: {
      nodes: new Map([
        ['src', { id: 'src', name: 'auth', namespace: 'ns', labels: {} }],
        ['mid', { id: 'mid', name: 'order', namespace: 'ns', labels: {} }],
        ['leaf', { id: 'leaf', name: 'user', namespace: 'ns', labels: {} }],
      ]),
      // src → mid → leaf (a chain).
      edges: [
        { from: 'src', to: 'mid', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
        { from: 'mid', to: 'leaf', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
      ],
      systemLoad: 0.5,
    },
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map([
      ['src', 0.3],
      ['mid', 1.0],
      ['leaf', 0.9],
    ]),
    dominantMetrics: new Map([
      ['src', { label: 'workload', head: [0.4, 0.4], tail: [1.4, 1.4], transientSkipped: [] }],
      ['mid', { label: 'cpu', head: [3.5, 3.6], tail: [0.05, 0.05], transientSkipped: [] }],
    ]),
    deepestExceptions: new Map([['leaf', 'MalformedJwtException']]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

// ── buildAdjacency ────────────────────────────────────────

describe('buildAdjacency', () => {
  it('summarises upstream and downstream neighbours', () => {
    const g = graph();
    expect(buildAdjacency('mid', g.callGraph)).toBe('upstream=[src] downstream=[leaf]');
    expect(buildAdjacency('src', g.callGraph)).toBe('downstream=[mid]');
    expect(buildAdjacency('leaf', g.callGraph)).toBe('upstream=[mid]');
  });

  it('returns undefined for a node with no edges', () => {
    const g = graph();
    g.callGraph.edges = [];
    expect(buildAdjacency('src', g.callGraph)).toBeUndefined();
  });
});

// ── buildCandidateEvidence ────────────────────────────────

describe('buildCandidateEvidence', () => {
  it('builds a full evidence block with metric shift and exception', () => {
    const g = graph();
    const e = buildCandidateEvidence('src', g);
    expect(e.serviceId).toBe('src');
    expect(e.name).toBe('auth');
    expect(e.anomalyScore).toBe(0.3);
    expect(e.dominantMetric).toBe('workload');
    expect(e.metricShift).toBe('head=[0.4,0.4] tail=[1.4,1.4]');
    expect(e.adjacency).toBe('downstream=[mid]');
  });

  it('omits the metric shift when the service has no dominant metric', () => {
    const g = graph();
    const e = buildCandidateEvidence('leaf', g);
    expect(e.dominantMetric).toBeUndefined();
    expect(e.metricShift).toBeUndefined();
    expect(e.deepestLogException).toBe('MalformedJwtException');
  });
});

// ── GraphInvestigatorToolkit ──────────────────────────────

describe('GraphInvestigatorToolkit', () => {
  it('lists the seed candidates as evidence blocks', () => {
    const toolkit = new GraphInvestigatorToolkit(graph(), ['mid', 'leaf']);
    const candidates = toolkit.getCandidates();
    expect(candidates.map((c) => c.serviceId)).toEqual(['mid', 'leaf']);
    expect(candidates[0]!.dominantMetric).toBe('cpu');
  });

  it('returns evidence for a known service and null for an unknown one', () => {
    const toolkit = new GraphInvestigatorToolkit(graph(), ['mid']);
    expect(toolkit.getEvidence('src')).not.toBeNull();
    expect(toolkit.getEvidence('ghost')).toBeNull();
  });

  it('navigates upstream and downstream deterministically', () => {
    const toolkit = new GraphInvestigatorToolkit(graph(), ['mid']);
    expect(toolkit.getUpstream('mid')).toEqual(['src']);
    expect(toolkit.getDownstream('mid')).toEqual(['leaf']);
    expect(toolkit.getUpstream('src')).toEqual([]);
    expect(toolkit.getDownstream('leaf')).toEqual([]);
  });

  it('tracks the hop budget and never goes negative', () => {
    const toolkit = new GraphInvestigatorToolkit(graph(), ['mid'], 2);
    expect(toolkit.remainingHops()).toBe(2);
    expect(toolkit.consumeHop()).toBe(true);
    expect(toolkit.remainingHops()).toBe(1);
    expect(toolkit.consumeHop()).toBe(true);
    expect(toolkit.remainingHops()).toBe(0);
    expect(toolkit.consumeHop()).toBe(false); // budget exhausted
    expect(toolkit.remainingHops()).toBe(0);
  });

  it('clamps a negative maxHops to zero', () => {
    const toolkit = new GraphInvestigatorToolkit(graph(), ['mid'], -1);
    expect(toolkit.maxHops).toBe(0);
    expect(toolkit.remainingHops()).toBe(0);
    expect(toolkit.consumeHop()).toBe(false);
  });
});
