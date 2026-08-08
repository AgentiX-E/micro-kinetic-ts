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

    // Build weight lookup map from original edges
    const weightMap = new Map<string, number>();
    for (let i = 0; i < allEdges.length; i++) {
      const e = allEdges[i]!;
      weightMap.set(`${e.from}→${e.to}`, propagationWeights[i]!);
    }

    for (const nodeId of topoOrder) {
      const acc = accumulators.get(nodeId)!;

      const nodeAnomaly = anomalyScores.get(nodeId)!;

      // Accumulate from children (outgoing edges in propagation direction)
      const children = forwardAdj.get(nodeId)!;
      let childContrib = 0;
      let totalChildWeight = 0;
      let maxChildDepth = 0;

      for (const childId of children) {
        const childAcc = accumulators.get(childId)!;

        const weight = weightMap.get(`${nodeId}→${childId}`)!;

        // Latency decay: δ = exp(-latency_avg / τ)
        const avgLatency = getAvgLatency(nodeId, childId, tree.edges);
        const latencyDecay = Math.exp(-avgLatency / this.options.tauMs);

        // Child contribution with decay weighting.
        // Sum weighted contributions, then normalise by total weight so that
        // a parent of N children with identical scores receives ≈ one child's
        // worth of contribution, not N×.  Without normalisation, deep-tree
        // ancestors accumulate dozens of propagated scores and drown out the
        // root-cause anomaly signal on large topologies (e.g. TrainTicket 80+
        // nodes → 0% AC@1).
        childContrib += childAcc.totalScore * weight * latencyDecay;
        totalChildWeight += weight * latencyDecay;

        if (childAcc.depth + 1 > maxChildDepth) {
          maxChildDepth = childAcc.depth + 1;
        }
      }

      // Normalise child contribution so it is bounded by the child scores,
      // then apply the global decay factor.
      if (totalChildWeight > 0) {
        childContrib = (childContrib / totalChildWeight) * this.options.decayAlpha;
      }

      acc.anomalyScore = nodeAnomaly;
      acc.childPropagationScore = childContrib;
      // Clamp totalScore to [0, 1] so downstream confidence estimators
      // (which assume probability-like semantics) don't reject the value.
      acc.totalScore = Math.min(1, nodeAnomaly + childContrib);
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
 * Build tree structure: adjacency maps and in-degrees.
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

  for (const edge of edges) {
    // Forward: parent → child (propagation direction)
    const fwList = forwardAdj.get(edge.from);
    if (fwList) fwList.push(edge.to);

    // Reverse: child → parent
    const revList = reverseAdj.get(edge.to);
    if (revList) revList.push(edge.from);

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
  for (const [nodeId, deg] of inDegree) {
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
      if (!visited.has(parent)) {
        // Check if all children of parent are processed
        const siblings = forwardAdj.get(parent)!;
        if (siblings.every((s) => visited.has(s))) {
          queue.push(parent);
        }
      }
    }
  }

  return order;
}

/**
 * Get the average latency for an edge.
 *
 * @internal
 */
function getAvgLatency(from: ServiceId, to: ServiceId, edges: readonly CallEdge[]): number {
  const edge = edges.find((e) => e.from === from && e.to === to);
  return edge!.p99Latency;
}

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
      faultType: classifyFaultType(acc.totalScore),
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

/**
 * Classify fault type based on total RCA score.
 *
 * @internal
 */
function classifyFaultType(score: number): FaultType {
  if (score >= 0.8) {
    return {
      category: 'CPU',
      subType: 'severe_anomaly',
      severity: 'critical',
    };
  }
  if (score >= 0.6) {
    return {
      category: 'MEMORY',
      subType: 'significant_anomaly',
      severity: 'major',
    };
  }
  if (score >= 0.4) {
    return {
      category: 'CODE_ERROR',
      subType: 'moderate_anomaly',
      severity: 'minor',
    };
  }
  return {
    category: 'UNKNOWN',
    subType: 'mild_anomaly',
    severity: 'warning',
  };
}
