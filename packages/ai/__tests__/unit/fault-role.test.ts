/**
 * Unit tests for the deterministic fault-role classifier (GALA+ phase-III).
 *
 * The classifier is the fix for the observed TT RE3 failure: the agent answers
 * the SYMPTOM (largest anomaly + the only logic exception) instead of walking
 * upstream to the SILENT source (no exception, modest rise). `classifyFaultRole`
 * tags each service from graph structure alone, and `buildFaultRoleInterpretation`
 * spells out the causal chain so the evidence builder can inject it next to the
 * raw numbers.
 *
 * @module ai/__tests__/unit/fault-role
 */

import type {
  FaultPropagationGraph,
  ServiceCallGraph,
  ServiceId,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';
import {
  buildFaultRoleInterpretation,
  classifyFaultRole,
  downstreamNeighbors,
  upstreamNeighbors,
} from '../../src/agent/fault-role.js';

// ── Helpers ───────────────────────────────────────────────

function node(id: ServiceId, name: string) {
  return { id, name, namespace: 'ns', labels: {} };
}

function callGraph(edges: Array<[string, string]>): ServiceCallGraph {
  const ids = new Set<string>();
  for (const [f, t] of edges) {
    ids.add(f);
    ids.add(t);
  }
  return {
    nodes: new Map([...ids].map((id) => [id, node(id, id)])),
    edges: edges.map(([from, to]) => ({
      from,
      to,
      type: 'REST',
      callRate: 1,
      p99Latency: 1,
      errorRate: 0,
    })),
    systemLoad: 0.5,
  } as ServiceCallGraph;
}

/** auth → order, with `order` throwing a logic exception (TT RE3 shape). */
function directGraph(): FaultPropagationGraph {
  return {
    callGraph: callGraph([['auth', 'order']]),
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map([
      ['auth', 0.3],
      ['order', 1.0],
    ]),
    dominantMetrics: new Map(),
    deepestExceptions: new Map([['order', 'MalformedJwtException']]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

/** gateway → auth → order, with `order` throwing (deeper chain). */
function deepGraph(): FaultPropagationGraph {
  return {
    callGraph: callGraph([
      ['gateway', 'auth'],
      ['auth', 'order'],
    ]),
    propagationWeights: new Float64Array(0),
    anomalyScores: new Map([
      ['gateway', 0.1],
      ['auth', 0.3],
      ['order', 1.0],
    ]),
    dominantMetrics: new Map(),
    deepestExceptions: new Map([['order', 'MalformedJwtException']]),
    anomalyOnsetTimes: new Map(),
    injectTimeMs: 0,
  } as unknown as FaultPropagationGraph;
}

// ── upstreamNeighbors / downstreamNeighbors ───────────────

describe('upstreamNeighbors / downstreamNeighbors', () => {
  it('returns the callers and callees of a service', () => {
    const g = directGraph();
    expect(upstreamNeighbors('order', g.callGraph)).toEqual(['auth']);
    expect(downstreamNeighbors('auth', g.callGraph)).toEqual(['order']);
    expect(upstreamNeighbors('auth', g.callGraph)).toEqual([]);
    expect(downstreamNeighbors('order', g.callGraph)).toEqual([]);
  });
});

// ── classifyFaultRole ─────────────────────────────────────

describe('classifyFaultRole', () => {
  it('tags a service with a logic exception as the symptom', () => {
    expect(classifyFaultRole('order', directGraph())).toBe('symptom');
  });

  it('tags the silent upstream producer of a symptom as a source candidate', () => {
    expect(classifyFaultRole('auth', directGraph())).toBe('silent-source-candidate');
  });

  it('leaves a service two hops upstream of the symptom unclassified', () => {
    // gateway → auth → order; gateway's direct downstream (auth) does not throw.
    expect(classifyFaultRole('gateway', deepGraph())).toBe('unclassified');
  });

  it('still tags an entry-point symptom (no upstream) as a symptom', () => {
    const g = directGraph();
    g.callGraph = callGraph([['order', 'auth']]); // order is now upstream of auth
    (g as { deepestExceptions?: Map<string, string> }).deepestExceptions = new Map([
      ['auth', 'MalformedJwtException'],
    ]);
    expect(classifyFaultRole('auth', g)).toBe('symptom');
  });

  it('returns unclassified for a service with no exception and no symptom downstream', () => {
    const g = directGraph();
    (g as { deepestExceptions?: Map<string, string> }).deepestExceptions = new Map();
    expect(classifyFaultRole('auth', g)).toBe('unclassified');
    expect(classifyFaultRole('order', g)).toBe('unclassified');
  });

  it('returns unclassified when the graph carries no exceptions at all', () => {
    const g = directGraph();
    delete (g as { deepestExceptions?: unknown }).deepestExceptions;
    expect(classifyFaultRole('order', g)).toBe('unclassified');
  });
});

// ── buildFaultRoleInterpretation ──────────────────────────

describe('buildFaultRoleInterpretation', () => {
  it('spells out the upstream walk for a symptom', () => {
    const g = directGraph();
    const text = buildFaultRoleInterpretation('order', 'symptom', g);
    expect(text).toContain('SYMPTOM');
    expect(text).toContain('MalformedJwtException');
    expect(text).toContain('UPSTREAM');
  });

  it('names the downstream symptom for a silent source candidate', () => {
    const g = directGraph();
    const text = buildFaultRoleInterpretation('auth', 'silent-source-candidate', g);
    expect(text).toContain('SILENT SOURCE');
    expect(text).toContain('order');
  });

  it('returns undefined for an unclassified service', () => {
    expect(buildFaultRoleInterpretation('auth', 'unclassified', directGraph())).toBeUndefined();
  });

  it('degrades gracefully when a symptom has no recorded exception', () => {
    const g = directGraph();
    delete (g as { deepestExceptions?: unknown }).deepestExceptions;
    const text = buildFaultRoleInterpretation('order', 'symptom', g);
    expect(text).toContain('a logic exception');
  });
});
