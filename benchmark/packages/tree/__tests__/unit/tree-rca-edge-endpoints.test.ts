/**
 * The tree's edge endpoints are part of the engine's input contract, and until this file existed nothing
 * said so.
 *
 * `analyze()` documents three preconditions — a non-empty tree, scores covering every node, `topK >= 1` —
 * and checks all three. It then assumed a fourth without stating it: that every edge in `tree.edges` has
 * both endpoints among `tree.nodes`. That assumption was enforced UNEVENLY, in three places, three ways:
 *
 * - `forwardAdj.get(edge.from)?.push(...)` skipped a dangling SOURCE silently;
 * - `reverseAdj.get(edge.to)?.push(...)` skipped a dangling TARGET silently;
 * - `inDegree.set(edge.to, inDegree.get(edge.to)! + 1)` was UNGUARDED, so a dangling target wrote
 *   `undefined + 1 = NaN` under a key that is not a node at all.
 *
 * The two silent skips then conspired with the unguarded write: a `forwardAdj` miss leaves a node absent
 * from the map that `topologicalSort` iterates, and the sort dereferences `forwardAdj.get(nodeId)!.length`
 * on exactly that node. So the failure mode was not "a validation error naming the bad edge" — it was
 * `TypeError: Cannot read properties of undefined (reading 'length')`, thrown from an internal helper,
 * pointing at a line an operator cannot act on.
 *
 * These tests pin the contract the code needs rather than the accident it had: a dangling endpoint is an
 * INPUT ERROR and must be reported as one, naming the edge. Both directions are covered because the two
 * used to fail differently (`'length'` from the sort, `'every'` from the sibling check) — a single test
 * would have pinned one accident and missed the other.
 */

import type { CallEdge, PrunedTree, ServiceId, TreeNodeScore } from '@agentix-e/micro-kinetic-core';
import { KineticValidationError } from '@agentix-e/micro-kinetic-core';
import { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeEdge(from: string, to: string, p99Latency = 50): CallEdge {
  return { from, to, type: 'REST', callRate: 100, p99Latency, errorRate: 0.01 };
}

function makePrunedTree(nodeIds: string[], edges: [string, string][]): PrunedTree {
  const nodes = new Map<string, TreeNodeScore>();
  for (const id of nodeIds) {
    nodes.set(id, {
      nodeId: id,
      anomalyScore: 1,
      childPropagationScore: 0,
      totalScore: 1,
      depth: 0,
    });
  }
  return {
    nodes,
    edges: edges.map(([f, t]) => makeEdge(f, t)),
    rootCauseScores: new Map(),
    prunedEdges: [],
    cyclesPruned: 0,
    contributionRemoved: 0,
  };
}

const SCORES = new Map<ServiceId, number>([
  ['a', 1],
  ['b', 2],
]);

describe('TreeRCAEngine — edge endpoints are validated, not assumed', () => {
  it('rejects an edge whose TARGET is not a node, naming that edge', () => {
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(['a', 'b'], [['a', 'ghost']]);

    // Before the guard this was `TypeError: ... (reading 'length')` from `topologicalSort`: the unguarded
    // `inDegree` write had put the phantom key into the very map the sort iterates.
    const run = (): unknown => engine.analyze(tree, SCORES, new Float64Array([1]), tree.edges, 3);

    expect(run).toThrow(KineticValidationError);
    expect(run).toThrow(/a→ghost/);
  });

  it('rejects an edge whose SOURCE is not a node, naming that edge', () => {
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(['a', 'b'], [['ghost', 'a']]);

    // The other direction used to fail elsewhere and differently: `reverseAdj` kept the phantom as a parent,
    // and the sibling check dereferenced `forwardAdj.get('ghost')!.every`, giving `reading 'every'`.
    const run = (): unknown => engine.analyze(tree, SCORES, new Float64Array([1]), tree.edges, 3);

    expect(run).toThrow(KineticValidationError);
    expect(run).toThrow(/ghost→a/);
  });

  it('accepts a graph whose endpoints all exist, so the guard cannot fire on valid input', () => {
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(['a', 'b'], [['a', 'b']]);
    const results = engine.analyze(tree, SCORES, new Float64Array([1]), tree.edges, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.serviceId).sort()).toEqual(['a', 'b']);
  });

  it('accepts a self-edge, because a node is its own endpoint', () => {
    // The guard tests membership, not sameness: rejecting `a→a` would be a different rule and this one is
    // not entitled to it. Pinned so a later tightening cannot arrive silently.
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(['a', 'b'], [['a', 'a']]);
    const results = engine.analyze(tree, SCORES, new Float64Array([1]), tree.edges, 3);
    expect(results.map((r) => r.serviceId).sort()).toEqual(['a', 'b']);
  });

  it('rejects a dangling endpoint even when other edges are well formed', () => {
    // Ordering matters: the scan must not stop at the first valid edge.
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['b', 'ghost'],
      ],
    );
    expect(() => engine.analyze(tree, SCORES, new Float64Array([1, 1]), tree.edges, 3)).toThrow(
      /b→ghost/,
    );
  });

  it('accepts an edge list that is empty', () => {
    // The complement of the case above, and the reason the guard is a scan rather than an index check.
    const engine = new TreeRCAEngine();
    const tree = makePrunedTree(['a', 'b'], []);
    const results = engine.analyze(tree, SCORES, new Float64Array([]), tree.edges, 3);
    expect(results.map((r) => r.serviceId).sort()).toEqual(['a', 'b']);
  });
});
