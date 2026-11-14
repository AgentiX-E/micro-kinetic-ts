/**
 * TreeRCAEngine — polynomial-time root cause analysis on pruned trees.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * After collision tree pruning removes closed-loop collision trajectories,
 * the residual fault propagation structure is an **acyclic tree**. On trees,
 * root cause analysis is solvable in **polynomial time** O(V + E), whereas
 * general graph RCA is **NP-hard** (equivalent to minimum feedback vertex
 * set with constraints).
 *
 * This is the central complexity result from the collision tree model:
 *
 *   RCA(Cyclic Graph)  →  NP-hard
 *   RCA(Pruned Tree)   →  O(V + E)
 *
 * ## Algorithm
 *
 * **Bottom-Up Score Accumulation**:
 *
 * 1. **Topological sort** the tree from leaves to root
 * 2. **Leaf nodes** contribute their own anomaly score
 * 3. **Internal nodes** accumulate:
 *
 *    score(v) = anomaly(v) + Σ_{child c} [score(c) × w(v→c) × δ(latency)]
 *
 *    where:
 *    - `w(v→c)` is the propagation weight of edge v→c
 *    - `δ(latency)` is the time-delay decay factor = exp(-latency / τ)
 *
 * 4. **Rank** nodes by descending score → Top-K root causes
 *
 * This mirrors the kinetic energy cascade: energy flows from root
 * (source of fault) downward to leaves (observable symptoms), with
 * attenuation at each collision step.
 *
 * @module rca/tree-rca
 */

import {
  type CallEdge,
  type FaultType,
  type PrunedTree,
  type RootCauseResult,
  type ServiceId,
  invariant,
  invariantPositiveInt,
  invariantRange,
} from '@agentix-e/micro-kinetic-core';

import { boundToConfidence, estimateErrorBound } from './confidence.js';

/**
 * Options for TreeRCAEngine.
 */
export interface TreeRCAOptions {
  /** 1-hop decay factor α ∈ (0, 1] for latency attenuation */
  readonly decayAlpha: number;
  /** Time constant τ (ms) for exponential decay */
  readonly tauMs: number;
  /** Default Top-K */
  readonly defaultTopK: number;
}

const DEFAULT_TREE_RCA_OPTIONS: TreeRCAOptions = {
  decayAlpha: 0.8,
  tauMs: 1000,
  defaultTopK: 10,
};

/**
 * Accumulated score for a node during bottom-up traversal.
 */
interface NodeAccumulator {
  /** The node's own anomaly score */
  anomalyScore: number;
  /** Score accumulated from children */
  childPropagationScore: number;
  /** Total RCA score */
  totalScore: number;
  /** Max depth to farthest descendant leaf */
  depth: number;
}

/**
 * TreeRCAEngine — performs polynomial-time RCA on a pruned tree.
 *
 * ## Deng Yu Mapping
 *
 * - **Leaf nodes** → observable symptoms (outgoing collision products)
 * - **Root node** → original fault source (incoming collision particle)
 * - **Bottom-up accumulation** → kinetic energy integration along
 *   collision tree branches
 * - **Latency decay** → quantum mechanical amplitude decay in the
 *   kinetic wave collision term
 *
 * @example
 * ```typescript
 * const engine = new TreeRCAEngine();
 * const results = engine.analyze(prunedTree, anomalyScores, topK);
 * ```
 */
export class TreeRCAEngine {
  private readonly options: TreeRCAOptions;

  constructor(options?: Partial<TreeRCAOptions>) {
    this.options = { ...DEFAULT_TREE_RCA_OPTIONS, ...options };
    invariantRange(this.options.decayAlpha, 0, 1, 'decayAlpha');
    invariantPositiveInt(this.options.defaultTopK, 'defaultTopK');
  }

  /**
   * Perform root cause analysis on a pruned tree.
   *
   * **Invariant preconditions:**
   * - tree must have at least one node
   * - every edge must connect two nodes of `tree.nodes` (see {@link assertEdgeEndpointsAreNodes})
   * - every tree edge must appear in `allEdges` with a finite weight and p99 latency (see
   *   {@link assertTreeEdgesAreMeasurable}); `allEdges` may contain edges the tree does not
   * - anomalyScores must cover all nodes in the tree
   * - topK must be ≥ 1
   *
   * @param tree - Pruned fault propagation tree
   * @param anomalyScores - Per-node anomaly scores
   * @param propagationWeights - Flattened edge propagation weights
   * @param allEdges - Original edges (for weight lookup)
   * @param topK - Number of top results (default from options)
   * @returns Ranked root cause candidates
   */
  analyze(
    tree: PrunedTree,
    anomalyScores: ReadonlyMap<ServiceId, number>,
    propagationWeights: Float64Array,
    allEdges: readonly CallEdge[],
    topK?: number,
  ): RootCauseResult[] {
    const k = topK ?? this.options.defaultTopK;
    invariant(tree.nodes.size > 0, 'tree must have at least one node');
    invariantPositiveInt(k, 'topK');
    assertEdgeEndpointsAreNodes(tree);

    // Step 1: Build graph structure
    const { reverseAdj, forwardAdj, inDegree } = buildTreeStructure(tree.edges, tree.nodes);

    // Step 2: Topological sort (leaves → root)
    const topoOrder = topologicalSort(forwardAdj, reverseAdj, inDegree);

    // Step 3: Bottom-up accumulation
    const accumulators = new Map<ServiceId, NodeAccumulator>();
    for (const nodeId of tree.nodes.keys()) {
      accumulators.set(nodeId, {
        anomalyScore: anomalyScores.get(nodeId)!,
        childPropagationScore: 0,
        totalScore: 0,
        depth: 0,
      });
    }

    // Build weight and latency lookup maps from original edges (O(E) once, O(1) access)
    const edgeWeightMap = new Map<string, number>();
    const edgeLatencyMap = new Map<string, number>();
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i]!;
      const key = `${e.from}→${e.to}`;
      edgeWeightMap.set(key, propagationWeights[i]!);
      edgeLatencyMap.set(key, e.p99Latency);
    }

    assertTreeEdgesAreMeasurable(tree, edgeWeightMap, edgeLatencyMap);

    for (const nodeId of topoOrder) {
      const acc = accumulators.get(nodeId)!;

      const nodeAnomaly = anomalyScores.get(nodeId)!;

      // Accumulate from children (outgoing edges in propagation direction)
      const children = forwardAdj.get(nodeId)!;
      let childContribRaw = 0;
      let maxChildScore = 0;
      let maxChildDepth = 0;

      for (const childId of children) {
        const childAcc = accumulators.get(childId)!;
        const edgeKey = `${nodeId}→${childId}`;

        const weight = edgeWeightMap.get(edgeKey)!;

        // Latency decay: δ = exp(−latency_avg / τ)
        const avgLatency = edgeLatencyMap.get(edgeKey)!;
        const latencyDecay = Math.exp(-avgLatency / this.options.tauMs);

        // Raw weighted child contribution (uncapped, not normalised by
        // child count).  Multiple high-score children are a strong signal
        // that this node is the propagation root, not the leaf.
        childContribRaw += childAcc.totalScore * weight * latencyDecay;

        if (childAcc.totalScore > maxChildScore) {
          maxChildScore = childAcc.totalScore;
        }

        if (childAcc.depth + 1 > maxChildDepth) {
          maxChildDepth = childAcc.depth + 1;
        }
      }

      // ── Child Contribution Cap (Deng Yu Collision Bound) ──────
      // Instead of normalising by children count (which makes ALL
      // nodes along a propagation chain converge to the same score),
      // cap child contribution at the maximum anomaly in the
      // subtree.  This preserves the multi-child propagation signal
      // for root causes while preventing deep ancestors from
      // accumulating infinite scores.
      //
      //   childContrib = min(raw_contrib, max(anomaly(v), max_child)) × decayAlpha
      //
      // A root cause with 5 anomalous children (all 0.9) gets:
      //   raw = 5 × 0.9 × 0.5 = 2.25, cap = 0.9, contrib = 0.72
      // A symptom with 1 weak child (0.3) gets:
      //   raw = 1 × 0.3 × 0.5 = 0.15, cap = 0.6, contrib = 0.12
      let childContrib = childContribRaw;
      const cap = Math.max(nodeAnomaly, maxChildScore);
      if (childContrib > cap) childContrib = cap;
      childContrib *= this.options.decayAlpha;

      acc.anomalyScore = nodeAnomaly;
      acc.childPropagationScore = childContrib;
      // Multiplicative propagation: child contribution amplifies the
      // node's own anomaly score rather than adding to it.  This
      // prevents a service with moderate anomaly but many children
      // from outranking one with high anomaly but no children.
      //
      //   additive:  cart(0.85) + childContrib(0.15) = 1.00 = root(1.00)  → tie
      //   mult:      cart(0.85) × (1+0.15) = 0.98  <  root(1.00)          → correct
      acc.totalScore = Math.min(1, nodeAnomaly * (1 + childContrib));
      acc.depth = maxChildDepth;

      accumulators.set(nodeId, acc);
    }

    // Step 4: Rank and produce results
    return rankAndProduceResults(accumulators, tree, k, this.options);
  }

  /**
   * Rank nodes by RCA score and produce RootCauseResult[].
   *
   * @param accumulators - Node score accumulators
   * @param k - Top-K to return
   * @returns Ranked root cause candidates
   */
  rank(
    accumulators: ReadonlyMap<ServiceId, NodeAccumulator>,
    k: number,
  ): ReadonlyMap<ServiceId, number> {
    invariantPositiveInt(k, 'k');

    const ranked = new Map<ServiceId, number>();
    const entries = Array.from(accumulators.entries()).sort(
      (a, b) => b[1].totalScore - a[1].totalScore,
    );

    for (let i = 0; i < Math.min(k, entries.length); i++) {
      const [nodeId, acc] = entries[i]!;
      ranked.set(nodeId, acc.totalScore);
    }

    return ranked;
  }
}

/**
 * Assert that every tree edge can be measured from the maps built over `allEdges`.
 *
 * ## Why the maps needed a guard at the call site
 *
 * `edgeWeightMap.get(key)!` and `edgeLatencyMap.get(key)!` are compile-time promises about a runtime map.
 * Both were used inside the accumulation loop, so a tree edge absent from `allEdges` — or a
 * `propagationWeights` array shorter than `allEdges` — produced `undefined`, and
 * `undefined × score × decay` produced `NaN`. From there it was arithmetic, not validation: `childContrib`
 * NaN, `totalScore` NaN, `confidence` NaN on the emitted row, and the ranking already sorted by the poison.
 *
 * `invariantRange` now rejects NaN (see `@agentix-e/micro-kinetic-core/utils/invariant`), which converts
 * that silent NaN into `Expected score in [0, 1], got NaN` — a true statement about a number that has
 * already lost the information the caller needs. This guard is the layer that still HAS the information: it
 * names the edge, at the boundary, before the arithmetic starts.
 *
 * The check is one-directional on purpose. `allEdges` is the pre-pruning graph, so it normally contains
 * edges the tree does not; requiring equality would reject every real tree.
 *
 * @param tree - The tree whose edges must be measurable.
 * @param edgeWeightMap - Propagation weight per ordered pair, built from `allEdges`.
 * @param edgeLatencyMap - p99 latency per ordered pair, built from `allEdges`.
 * @throws KineticValidationError naming the edge and the missing quantity.
 * @internal
 */
function assertTreeEdgesAreMeasurable(
  tree: PrunedTree,
  edgeWeightMap: ReadonlyMap<string, number>,
  edgeLatencyMap: ReadonlyMap<string, number>,
): void {
  for (const edge of tree.edges) {
    const key = `${edge.from}→${edge.to}`;
    invariant(
      Number.isFinite(edgeWeightMap.get(key)),
      `tree edge ${key} has no finite propagation weight in allEdges; ` +
        `propagationWeights must be aligned with allEdges, one entry per edge`,
    );
    invariant(
      Number.isFinite(edgeLatencyMap.get(key)),
      `tree edge ${key} has no finite p99Latency in allEdges, so its latency decay is undefined`,
    );
  }
}

/**
 * Assert that every edge connects two nodes that the tree actually has.
 *
 * ## Why this is a check and not a `?.`
 *
 * The adjacency build below used to enforce this assumption in three places, three different ways:
 * a dangling SOURCE was skipped by `forwardAdj.get(...) &&`, a dangling TARGET was skipped by
 * `reverseAdj.get(...) &&`, and `inDegree.set(edge.to, inDegree.get(edge.to)! + 1)` was not guarded at
 * all — writing `NaN` under a key that is not a node. The unguarded write is what made the other two
 * matter: `topologicalSort` iterates `inDegree`, so the phantom key reached
 * `forwardAdj.get(nodeId)!.length`, and the engine died with
 * `TypeError: Cannot read properties of undefined (reading 'length')` — an internal helper's line
 * number, on input the caller can fix.
 *
 * The repair is a stated precondition rather than three defensive defaults, because the three defaults
 * disagreed with each other: "skip the edge" and "keep the edge with a `NaN` degree" are different
 * graphs, and neither is the graph the caller passed. A dangling endpoint is an INPUT ERROR; reporting
 * it as one is the only behaviour that leaves the engine's arithmetic meaningful.
 *
 * O(E), once per `analyze()` call, on a list the caller already materialised.
 *
 * @param tree - The tree whose edges are checked.
 * @throws KineticValidationError naming the offending edge when an endpoint is not a node.
 * @internal
 */
function assertEdgeEndpointsAreNodes(tree: PrunedTree): void {
  for (const edge of tree.edges) {
    const sourceIsNode = tree.nodes.has(edge.from);
    const targetIsNode = tree.nodes.has(edge.to);
    invariant(
      sourceIsNode && targetIsNode,
      `tree edge ${edge.from}→${edge.to} must connect two nodes of tree.nodes, but ` +
        `${sourceIsNode ? `target "${edge.to}"` : `source "${edge.from}"`} is not one`,
    );
  }
}

/**
 * Build tree structure: adjacency maps and in-degrees.
 *
 * Every endpoint is guaranteed by {@link assertEdgeEndpointsAreNodes}, which is why the three writes
 * below are unconditional: a `?.` here would be a second, contradiction-prone answer to a question the
 * caller has already been asked.
 *
 * Repeated records for one `(from, to)` pair are collapsed. A call graph is a SIMPLE graph — the count of
 * observations is already a field of the edge (`callRate`), so a second record for the same pair adds no
 * topology, only a second measurement of the same edge. Pushing both into `forwardAdj` made the bottom-up
 * accumulation add the child's contribution twice, and the child cap hid it only when the doubled sum
 * already exceeded the cap: below the cap, one edge scored `0.495` and two records for that same edge
 * scored `0.528`. `packages/tree/__tests__/unit/tree-rca-duplicate-edges.test.ts` holds both numbers.
 *
 * @internal
 */
function buildTreeStructure(edges: readonly CallEdge[], nodes: ReadonlyMap<string, unknown>) {
  const reverseAdj = new Map<ServiceId, string[]>();
  const forwardAdj = new Map<ServiceId, string[]>();
  const inDegree = new Map<ServiceId, number>();

  for (const nodeId of nodes.keys()) {
    reverseAdj.set(nodeId, []);
    forwardAdj.set(nodeId, []);
    inDegree.set(nodeId, 0);
  }

  const seen = new Set<string>();
  for (const edge of edges) {
    const pair = `${edge.from}→${edge.to}`;
    if (seen.has(pair)) continue;
    seen.add(pair);

    // Forward: parent → child (propagation direction)
    forwardAdj.get(edge.from)!.push(edge.to);

    // Reverse: child → parent
    reverseAdj.get(edge.to)!.push(edge.from);

    inDegree.set(edge.to, inDegree.get(edge.to)! + 1);
  }

  return { reverseAdj, forwardAdj, inDegree };
}

/**
 * Topological sort: process from leaves (out-degree = 0) to root.
 *
 * Uses Kahn's algorithm with out-degree (propagation children).
 * Leaves are nodes with no outgoing edges.
 *
 * @internal
 */
function topologicalSort(
  forwardAdj: Map<ServiceId, string[]>,
  reverseAdj: Map<ServiceId, string[]>,
  inDegree: Map<ServiceId, number>,
): ServiceId[] {
  const order: ServiceId[] = [];

  // Leaves: nodes with no outgoing edges
  const queue: ServiceId[] = [];
  for (const [nodeId, _deg] of inDegree) {
    const outDegree = forwardAdj.get(nodeId)!.length;
    if (outDegree === 0) {
      queue.push(nodeId);
    }
  }

  const visited = new Set<ServiceId>();

  while (queue.length > 0) {
    const node = queue.shift()!;
    visited.add(node);
    order.push(node);

    // Process parents (nodes that point TO this node)
    const parents = reverseAdj.get(node)!;
    for (const parent of parents) {
      // `siblings.every` alone is the whole condition. It is true only for the LAST of a parent's children
      // to be processed — every earlier child is seen while at least one sibling is still unvisited — so
      // each parent is enqueued exactly once. The `!visited.has(parent)` guard that used to wrap this was
      // unreachable for the same reason, and was removed rather than covered: `buildTreeStructure`
      // collapses duplicate pairs, so a parent cannot appear twice in one `parents` list and be enqueued
      // twice either.
      const siblings = forwardAdj.get(parent)!;
      if (siblings.every((s) => visited.has(s))) {
        queue.push(parent);
      }
    }
  }

  return order;
}

/**
 * Classify fault type based on anomaly score, propagation depth,
 * and child contribution pattern.
 *
 * Uses a multi-dimensional heuristic that considers:
 * - Score magnitude → severity classification
 * - Propagation depth → distinguishes root vs. cascade
 * - Child contribution ratio → local anomaly vs. propagated symptom
 *
 * @param score - Total RCA score
 * @param depth - Propagation depth from farthest leaf
 * @param childContrib - Score contribution from children
 * @returns FaultType classification
 * @internal
 */
function classifyFaultType(score: number, depth = 0, childContrib = 0): FaultType {
  // Distinguish local root cause (low child contribution) from cascade effect (high)
  const childRatio = score > 0 ? childContrib / score : 0;
  const isLocalAnomaly = childRatio < 0.3;

  if (score >= 0.8) {
    return {
      category: isLocalAnomaly ? 'CPU' : 'MEMORY',
      subType: isLocalAnomaly ? 'severe_local_anomaly' : 'severe_cascaded_anomaly',
      severity: 'critical',
    };
  }
  if (score >= 0.6) {
    return {
      category: isLocalAnomaly ? 'MEMORY' : 'CONNECTION_POOL',
      subType: isLocalAnomaly ? 'significant_local_anomaly' : 'significant_cascaded_anomaly',
      severity: 'major',
    };
  }
  if (score >= 0.4) {
    return {
      category: 'CODE_ERROR',
      subType: depth > 2 ? 'deep_propagation_anomaly' : 'moderate_local_anomaly',
      severity: 'minor',
    };
  }
  return {
    category: 'UNKNOWN',
    subType: depth > 0 ? 'mild_propagation' : 'mild_local',
    severity: 'warning',
  };
}

/** Remove: replaced by pre-built edgeLatencyMap (O(1) vs O(E)). */

/**
 * Rank accumulators and produce RootCauseResult[].
 *
 * @internal
 */
function rankAndProduceResults(
  accumulators: ReadonlyMap<ServiceId, NodeAccumulator>,
  tree: PrunedTree,
  topK: number,
  options: TreeRCAOptions,
): RootCauseResult[] {
  const entries = Array.from(accumulators.entries()).sort(
    (a, b) => b[1].totalScore - a[1].totalScore,
  );

  const results: RootCauseResult[] = [];

  for (let i = 0; i < Math.min(topK, entries.length); i++) {
    const [nodeId, acc] = entries[i]!;

    // Estimate error bound at this node's depth
    const errorBound = estimateErrorBound(acc.depth, options.decayAlpha);

    // Compute confidence from score, depth, and error bound
    const confidence = boundToConfidence(acc.totalScore, errorBound, acc.depth);

    results.push({
      serviceId: nodeId,
      faultType: classifyFaultType(acc.totalScore, acc.depth, acc.childPropagationScore),
      confidence,
      rank: i + 1,
      evidenceMetrics: [
        {
          metric: 'anomaly_score',
          value: acc.anomalyScore,
          threshold: 0.3,
        },
        {
          metric: 'child_contribution',
          value: acc.childPropagationScore,
          threshold: 0.1,
        },
        {
          metric: 'total_rca_score',
          value: acc.totalScore,
          threshold: 0.5,
        },
      ],
      propagationDepth: acc.depth,
      propagationErrorBound: errorBound,
      viaTreeSearch: true,
    });
  }

  return results;
}
