/**
 * A call graph is a SIMPLE graph, and the engine's arithmetic has to agree.
 *
 * `CallGraph.edges` is a list of `{from, to, weight, p99Latency}` records. Nothing in the type or in the
 * corpora forbids the same `(from, to)` pair appearing twice, and the quantity that would make it
 * meaningful — an observation count — is already a field of the edge (`callRate`). A second record for the
 * same pair therefore carries NO new information about the topology; at most it carries a different
 * measurement of the same edge.
 *
 * `buildTreeStructure` nonetheless pushed both records into `forwardAdj`, so the child was visited twice by
 * the bottom-up accumulation:
 *
 *   childContribRaw += child.totalScore × weight × decay      (once per EDGE RECORD, not per child)
 *
 * The cap that follows (`min(raw, max(anomaly, maxChild))`) hides this whenever the duplicated sum already
 * exceeds the cap — which is why the shipped corpora, whose anomalies are large, never showed it. It does
 * not hide it below the cap, and below the cap the duplicate edge is worth a strictly higher score:
 *
 *   one edge    raw = 0.3 × 0.990 = 0.297  <  cap 0.4  →  total = 0.4 × (1 + 0.297 × 0.8) = 0.495
 *   two records raw = 0.3 × 0.990 × 2 = 0.594 ≥ cap 0.4 →  total = 0.4 × (1 + 0.400 × 0.8) = 0.528
 *
 * So the two tests below assert the rule the graph has, not the accident the code had: the number of
 * records for a pair is not part of the topology, and it may not be part of the score.
 */

import type { CallEdge, PrunedTree, ServiceId, TreeNodeScore } from '@agentix-e/micro-kinetic-core';
import { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeEdge(from: string, to: string, p99Latency = 10): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency, errorRate: 0 };
}

function makeTree(
  nodes: string[],
  pairs: [string, string][],
): { tree: PrunedTree; edges: CallEdge[] } {
  const edges = pairs.map(([f, t]) => makeEdge(f, t));
  const nodeMap = new Map<string, TreeNodeScore>();
  for (const id of nodes) {
    nodeMap.set(id, {
      nodeId: id,
      anomalyScore: 1,
      childPropagationScore: 0,
      totalScore: 1,
      depth: 0,
    });
  }
  return {
    tree: {
      nodes: nodeMap,
      edges,
      rootCauseScores: new Map(),
      prunedEdges: [],
      cyclesPruned: 0,
      contributionRemoved: 0,
    },
    edges,
  };
}

function totalOf(
  engine: TreeRCAEngine,
  nodes: string[],
  pairs: [string, string][],
  scores: Map<ServiceId, number>,
): Map<string, number> {
  const { tree, edges } = makeTree(nodes, pairs);
  const results = engine.analyze(
    tree,
    scores,
    new Float64Array(edges.length).fill(1),
    edges,
    nodes.length,
  );
  const out = new Map<string, number>();
  for (const r of results) {
    const metric = r.evidenceMetrics.find((m) => m.metric === 'total_rca_score');
    out.set(r.serviceId, metric?.value as number);
  }
  return out;
}

// Anomalies chosen so the duplicated sum lands BELOW the cap: this is the regime the shipped corpora never
// exercised, and it is the only regime where the defect is observable at all.
const LOW_SCORES = new Map<ServiceId, number>([
  ['P', 0.4],
  ['X', 0.3],
]);

describe('TreeRCAEngine — a duplicate edge record is not a second edge', () => {
  it('scores a parent identically whether its child edge is recorded once or twice', () => {
    const engine = new TreeRCAEngine();
    const once = totalOf(engine, ['P', 'X'], [['P', 'X']], LOW_SCORES);
    const twice = totalOf(
      engine,
      ['P', 'X'],
      [
        ['P', 'X'],
        ['P', 'X'],
      ],
      LOW_SCORES,
    );

    expect(twice.get('P')).toBe(once.get('P'));
  });

  it('keeps the leaked margin out of the result, not merely below the cap', () => {
    // Stated as a number as well as an equality: if a later change makes BOTH sides wrong in the same way,
    // the equality above still passes and this one does not.
    const engine = new TreeRCAEngine();
    const twice = totalOf(
      engine,
      ['P', 'X'],
      [
        ['P', 'X'],
        ['P', 'X'],
      ],
      LOW_SCORES,
    );
    expect(twice.get('P')).toBeCloseTo(0.49504, 5);
  });

  it('does not repeat a node in the ranking when the duplicate sits deeper', () => {
    // The duplicate also used to push the parent twice into the topological queue; the bottom-up update is
    // idempotent so nothing moved, but a repeated `order` entry is a graph the caller did not describe.
    const engine = new TreeRCAEngine();
    const scores = new Map<ServiceId, number>([
      ['A', 0.5],
      ['B', 0.4],
      ['C', 0.3],
    ]);
    const results = engine.analyze(
      makeTree(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['B', 'C'],
        ],
      ).tree,
      scores,
      new Float64Array(3).fill(1),
      makeTree(
        ['A', 'B', 'C'],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['B', 'C'],
        ],
      ).edges,
      5,
    );
    const ids = results.map((r) => r.serviceId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['A', 'B', 'C']);
  });

  it('still treats two DIFFERENT children as two contributions', () => {
    // The complement: deduplication must key on the pair, not on the parent. A fix that collapsed a parent's
    // children into a set of PARENTS would pass every test above and break this one.
    const engine = new TreeRCAEngine();
    const scores = new Map<ServiceId, number>([
      ['P', 0.4],
      ['X', 0.3],
      ['Y', 0.2],
    ]);
    const both = totalOf(
      engine,
      ['P', 'X', 'Y'],
      [
        ['P', 'X'],
        ['P', 'Y'],
      ],
      scores,
    );
    const one = totalOf(engine, ['P', 'X', 'Y'], [['P', 'X']], scores);
    expect(both.get('P')).toBeGreaterThan(one.get('P') as number);
  });
});
