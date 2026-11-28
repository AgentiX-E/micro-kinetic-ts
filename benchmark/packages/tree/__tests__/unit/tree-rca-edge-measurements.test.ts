/**
 * A tree edge carries no weight and no latency of its own: both live in `allEdges`, indexed by the ordered
 * pair, with `propagationWeights[i]` aligned to `allEdges[i]`.
 *
 * That is an alignment the signature states and nothing enforced. `edgeWeightMap.get(key)!` and
 * `edgeLatencyMap.get(key)!` are compiler-level promises, not runtime ones, so a tree edge the caller's
 * `allEdges` does not contain produced `undefined`, then `undefined × score × decay = NaN`, and the NaN
 * travelled: `childContrib` NaN → `totalScore` NaN → `confidence` NaN on the emitted row, with
 * `invariantRange(score, 0, 1)` reporting "in range" because NaN answers `false` to both comparisons. (That
 * last part is now fixed in `invariantRange`; this file pins the layer above it, where the actual cause is.)
 *
 * The failure a caller would see without these guards is a `NaN` confidence on an otherwise plausible
 * ranking — no exception, no message, and the score that produced it already mixed into the sort. The
 * guards turn it into a named edge at the boundary, which is the only place the caller can act.
 */

import type { CallEdge, PrunedTree, ServiceId, TreeNodeScore } from '@agentix-e/micro-kinetic-core';
import { KineticValidationError } from '@agentix-e/micro-kinetic-core';
import { TreeRCAEngine } from '@agentix-e/micro-kinetic-tree';
import { describe, expect, it } from 'vitest';

function makeEdge(from: string, to: string, p99Latency = 10): CallEdge {
  return { from, to, type: 'REST', callRate: 1, p99Latency, errorRate: 0 };
}

function makeTree(nodeIds: string[], edges: CallEdge[]): PrunedTree {
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
    edges,
    rootCauseScores: new Map(),
    prunedEdges: [],
    cyclesPruned: 0,
    contributionRemoved: 0,
  };
}

const SCORES = new Map<ServiceId, number>([
  ['a', 1],
  ['b', 0.5],
]);

describe('TreeRCAEngine — a tree edge must be measurable from allEdges', () => {
  it('rejects a tree edge that allEdges does not contain, naming it', () => {
    const engine = new TreeRCAEngine();
    const tree = makeTree(['a', 'b'], [makeEdge('a', 'b')]);

    // `allEdges` empty while the tree has an edge: the weight lookup misses and the score would be NaN.
    const run = (): unknown => engine.analyze(tree, SCORES, new Float64Array(0), [], 3);

    expect(run).toThrow(KineticValidationError);
    expect(run).toThrow(/a→b/);
  });

  it('rejects a tree edge whose propagation weight is not finite', () => {
    const engine = new TreeRCAEngine();
    const tree = makeTree(['a', 'b'], [makeEdge('a', 'b')]);
    const allEdges = [makeEdge('a', 'b')];

    // A weights array shorter than `allEdges` is the realistic form of this: the caller aligned two arrays
    // of different lengths and the trailing entry reads as `undefined`.
    const run = (): unknown => engine.analyze(tree, SCORES, new Float64Array(0), allEdges, 3);

    expect(run).toThrow(KineticValidationError);
    expect(run).toThrow(/a→b/);
  });

  it('rejects a tree edge whose p99Latency is NaN, which would make the decay factor NaN', () => {
    const engine = new TreeRCAEngine();
    const tree = makeTree(['a', 'b'], [makeEdge('a', 'b')]);
    const allEdges = [makeEdge('a', 'b', Number.NaN)];

    expect(() => engine.analyze(tree, SCORES, new Float64Array([1]), allEdges, 3)).toThrow(
      KineticValidationError,
    );
  });

  it('accepts an aligned, finite input, so the guards cannot fire on valid data', () => {
    const engine = new TreeRCAEngine();
    const tree = makeTree(['a', 'b'], [makeEdge('a', 'b')]);
    const allEdges = [makeEdge('a', 'b')];
    const results = engine.analyze(tree, SCORES, new Float64Array([1]), allEdges, 3);

    expect(results.length).toBe(2);
    for (const r of results) expect(Number.isFinite(r.confidence)).toBe(true);
  });

  it('accepts allEdges that carry edges the tree does not, because pruning removes edges', () => {
    // The subset direction is the normal one: `allEdges` is the pre-pruning graph. Only a tree edge MISSING
    // from `allEdges` is an error, and a guard that required equality would reject every real tree.
    const engine = new TreeRCAEngine();
    const tree = makeTree(['a', 'b'], [makeEdge('a', 'b')]);
    const allEdges = [makeEdge('a', 'b'), makeEdge('b', 'c')];
    const results = engine.analyze(tree, SCORES, new Float64Array([1, 1]), allEdges, 3);

    expect(results.map((r) => r.serviceId).sort()).toEqual(['a', 'b']);
  });
});
