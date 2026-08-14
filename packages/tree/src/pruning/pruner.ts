/**
 * TreePruner — collision tree fault propagation graph pruner.
 *
 * Implements the IRCAEngine interface, mapping Deng Yu's collision tree
 * pruning theory to AIOps root cause analysis.
 *
 * ## Algorithm (Deng Yu Mapping)
 *
 * 1. **Cycle Detection**: Enumerate all simple cycles in the fault
 *    propagation graph using Johnson's algorithm. Each cycle corresponds
 *    to a closed-loop collision trajectory C in the BBGKY hierarchy.
 *
 * 2. **Contribution Computation**: For each cycle C, compute:
 *      w(C) = ∏_{e∈C} propagationWeight(e)
 *    This is the collision cross-section product.
 *
 * 3. **Pruning**: For each cycle, remove the weakest edge (smallest
 *    propagation weight). This discards the least-probable collision
 *    trajectory and preserves the dominant fault-propagation paths.
 *
 * 4. **Tree RCA**: On the resulting acyclic tree, perform bottom-up
 *    anomaly score accumulation in O(V+E) time.
 *
 * ## Critical Load Theorem
 *
 * Deng Yu proved: if systemLoad < λ_critical, then Σw(C) ≤ K×ε.
 * This guarantees that in rarefied (low-load) regimes, residual
 * cycle contribution is bounded below the prune threshold.
 *
 * @module pruning/pruner
 */

import {
  DEFAULT_RCA_OPTIONS,
  invariant,
  invariantPositiveInt,
  invariantRange,
  type DetectedCycle,
  type FaultPropagationGraph,
  type MetricMap,
  type PrunedEdgeRecord,
  type PrunedTree,
  type RCAEngineOptions,
  type RootCauseResult,
  type ServiceCallGraph,
  type ServiceId,
  type ServiceNode,
  type TreeNodeScore,
} from '@agentix-e/micro-kinetic-core';

import { aggregateFaultEnergy, type FaultGraphEdge } from '../causal/collision-aggregator.js';
import type { TopologyFaultGraphConfig } from '../causal/topology-fault-graph.js';
import { buildTopologyFaultGraph } from '../causal/topology-fault-graph.js';
import { JohnsonCycleDetector, cycleKey } from '../graph/cycle-detector.js';
import { CollisionContributionAnalyzer, buildEdgeWeightMap } from './contribution.js';

/**
 * Options for TreePruner construction.
 * Extends the core RCAEngineOptions with pruner-specific settings.
 */
export interface TreePrunerOptions extends RCAEngineOptions {
  /** 1-hop decay factor α ∈ (0, 1]. Default: 0.8 */
  readonly decayAlpha: number;
  /** 2-hop coupling coefficient β ∈ [0, 1]. Default: 0.3 */
  readonly decayBeta: number;
  /** Whether to use 2-hop decay model (default: 1-hop) */
  readonly useTwoHopDecay: boolean;
  /** Maximum number of cycles to enumerate */
  readonly maxCycles: number;
  /**
   * Enable Boltzmann Q(f,f) collision energy aggregation (I8-P3).
   * When disabled, the engine falls back to raw anomaly scores
   * with no collision type amplification in ranking.
   * Default: true (collision aggregation enabled).
   */
  readonly enableCollisionAggregation: boolean;
  /**
   * Weight of the source-likelihood signal in root-cause ranking.
   *
   * The ranking combines a node's self-anomaly with a dataset-agnostic
   * causality prior: a service whose anomaly ONSET precedes its causal
   * neighbours' is more likely to be the fault source (cause precedes
   * effect — Deng Yu's mean free time τ). A higher weight favours the
   * source over a larger downstream symptom. `0` disables the signal
   * (pure self-anomaly ranking). Default: 1.0.
   */
  readonly sourceWeight: number;
}

const DEFAULT_TREE_PRUNER_OPTIONS: TreePrunerOptions = {
  ...DEFAULT_RCA_OPTIONS,
  decayAlpha: 0.8,
  decayBeta: 0.3,
  useTwoHopDecay: false,
  maxCycles: 10_000,
  enableCollisionAggregation: true,
  sourceWeight: 1.0,
};

/**
 * TreePruner — implements IRCAEngine for collision tree RCA.
 *
 * This is the primary engine for root cause analysis using
 * Deng Yu's collision tree pruning methodology.
 *
 * @example
 * ```typescript
 * const pruner = new TreePruner();
 * const graph = pruner.buildFaultGraph(callGraph, metrics);
 * const results = await pruner.analyze(graph, 10);
 * ```
 */
export class TreePruner {
  private readonly options: TreePrunerOptions;
  private readonly cycleDetector: JohnsonCycleDetector;
  private readonly topologyConfig?: Partial<TopologyFaultGraphConfig>;

  constructor(
    options?: Partial<TreePrunerOptions>,
    topologyConfig?: Partial<TopologyFaultGraphConfig>,
  ) {
    this.options = { ...DEFAULT_TREE_PRUNER_OPTIONS, ...options };
    this.topologyConfig = topologyConfig;
    invariantRange(this.options.pruneEpsilon, 0, 1, 'pruneEpsilon');
    invariantRange(this.options.criticalLoadThreshold, 0, 1, 'criticalLoadThreshold');
    invariantPositiveInt(this.options.defaultTopK, 'defaultTopK');
    invariantPositiveInt(this.options.maxPropagationDepth, 'maxPropagationDepth');

    this.cycleDetector = new JohnsonCycleDetector({
      maxCycles: this.options.maxCycles,
    });
  }

  /**
   * Build a fault propagation graph from the service call graph
   * and time-series metrics.
   *
   * ### Computation:
   *
   * 1. **Propagation weights**: For each edge (from → to), compute
   *    the propagation probability as the Pearson correlation between
   *    the anomaly score of the source and target services.
   *
   *    p(from, to) = |corr(anomaly_from, anomaly_to)|
   *
   * 2. **Anomaly scores**: For each service, compute the normalized
   *    anomaly score as the maximum metric deviation from baseline.
   *
   *    anomaly(s) = max(0, min(1, max_i |metric_i - baseline_i| / baseline_i))
   *
   * 3. **Prune threshold**: Set to ε = pruneEpsilon from options.
   *
   * ### Invariants
   * - callGraph must have at least one node and one edge
   * - metrics must have entries for all services in the call graph
   *
   * @param callGraph - Service call graph with topology
   * @param metrics - Time series metrics keyed by service ID
   * @returns Fault propagation graph ready for analysis
   */
  buildFaultGraph(callGraph: ServiceCallGraph, metrics: MetricMap): FaultPropagationGraph {
    invariant(callGraph.nodes.size > 0, 'callGraph must have at least one node');
    invariant(callGraph.edges.length > 0, 'callGraph must have at least one edge');
    invariant(metrics.size > 0, 'metrics must be non-empty');

    // Build topology-preserving fault graph with Pearson cross-service correlation.
    // Unlike the legacy chronological propagation tree, this preserves the YAML
    // topology edges and computes real cross-service correlation for edge weights.
    const topoResult = buildTopologyFaultGraph(callGraph, metrics, this.topologyConfig);
    const { anomalyScores, anomalyOnsetTimes, propagationWeights } = topoResult;

    // Use the original call graph (topology-preserving), not a synthetic star-tree.
    // The call graph's edges reflect the actual service dependency topology from
    // YAML configs + semantic enhancement.
    const topologyGraph = callGraph;

    // Detect cycles using topology edges
    const edgePairs = topologyGraph.edges.map(
      (e) => [e.from, e.to] as readonly [ServiceId, ServiceId],
    );
    const cycles = this.cycleDetector.detect(edgePairs);

    // Compute cycle contributions with adaptive or fixed decayAlpha
    const effectiveAlpha = topoResult.computedDecayAlpha;
    const analyzer = new CollisionContributionAnalyzer(topologyGraph.edges, propagationWeights, {
      alpha: effectiveAlpha,
      beta: this.options.decayBeta,
    });

    const contributions = this.options.useTwoHopDecay
      ? analyzer.computeAllTwoHopContributions(cycles)
      : analyzer.computeAllContributions(cycles);

    let totalCycleContribution = 0;
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      const contrib = contributions.get(key) ?? 0;
      totalCycleContribution += contrib;
    }

    // Classify cycles with significance
    const classifiedCycles: DetectedCycle[] = [];
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      const contrib = contributions.get(key) ?? 0;
      classifiedCycles.push({
        nodePath: cycle.nodePath,
        contribution: contrib,
        significant: contrib >= this.options.pruneEpsilon,
      });
    }

    // ── Collision Node Fault Aggregation (Deng Yu Boltzmann Q(f,f)) ──────────
    // When enableCollisionAggregation is off, skip aggregation and use raw
    // anomaly scores for all nodes. This enables apples-to-apples ablation
    // comparison against the baseline (no collision enhancement).
    let collisionEnergy: Map<
      ServiceId,
      {
        totalEnergy: number;
        collisionType: string;
        collisionGain: number;
      }
    >;

    if (this.options.enableCollisionAggregation) {
      // Build cycle membership map for collision type classification
      const cycleMembership = new Map<ServiceId, number>();
      for (const cycle of cycles) {
        for (const nodeId of cycle.nodePath) {
          cycleMembership.set(nodeId, (cycleMembership.get(nodeId) ?? 0) + 1);
        }
      }

      // Convert call graph edges to FaultGraphEdge format for aggregator
      const faultEdges: FaultGraphEdge[] = topologyGraph.edges.map((e, i) => ({
        from: e.from,
        to: e.to,
        weight: propagationWeights[i] ?? 0.5,
      }));

      collisionEnergy = new Map(
        Array.from(
          aggregateFaultEnergy(faultEdges, anomalyScores, cycleMembership, {
            alpha: 0.4,
            bottleneckCapacity: 0.5,
            fanInThreshold: 3,
          }).entries(),
        ).map(([id, r]) => [
          id,
          {
            totalEnergy: r.totalEnergy,
            collisionType: r.collisionType,
            collisionGain: r.collisionGain,
          },
        ]),
      );
    } else {
      // Collision disabled: each node gets its raw anomaly score as energy,
      // with default 'chain' type (no amplification).
      collisionEnergy = new Map();
      for (const [nodeId, score] of anomalyScores) {
        collisionEnergy.set(nodeId, {
          totalEnergy: score,
          collisionType: 'chain',
          collisionGain: 0,
        });
      }
    }

    return {
      callGraph: topologyGraph,
      propagationWeights,
      anomalyScores,
      anomalyOnsetTimes,
      detectedCycles: classifiedCycles,
      totalCycleContribution,
      pruneThreshold: this.options.pruneEpsilon,
      collisionEnergy,
    };
  }

  /**
   * Perform root cause analysis on the fault propagation graph.
   *
   * ### Algorithm Steps:
   *
   * 1. **Cycle Detection → Pruning**: If cycles are already detected
   *    in the graph, use them. Otherwise detect fresh. Prune every
   *    cycle (significant or not) by breaking its weakest edge.
   *
   * 2. **Tree RCA**: On the pruned acyclic tree, accumulate anomaly
   *    scores bottom-up and rank root cause candidates.
   *
   * 3. **Top-K**: Return the top K results sorted by RCA score.
   *
   * ### Deng Yu Mapping
   *
   * The pruning step corresponds to removing closed-loop collision
   * trajectories. Breaking the weakest collision cross-section edge in
   * each cycle discards the least-probable trajectory while preserving the
   * dominant fault-propagation paths — a valid approximation in the
   * rarefied gas limit. Previously cycles with w(C) ≥ ε threw
   * `GraphCycleError`, which made the engine unusable on dense real-world
   * topologies (e.g. TrainTicket's 68-node, 267-edge graph) where feedback
   * loops are inherent, so every cycle is now pruned uniformly.
   *
   * @param graph - Fault propagation graph
   * @param topK - Number of top results to return (default from options)
   * @returns Ranked root cause results
   */
  analyze(graph: FaultPropagationGraph, topK?: number): RootCauseResult[] {
    const k = topK ?? this.options.defaultTopK;
    invariantPositiveInt(k, 'topK');

    // Prune ALL cycles — significant and insignificant alike. Breaking the
    // weakest edge in every cycle keeps dense topologies analyzable; throwing
    // on significant cycles previously returned "no prediction" for the whole
    // TrainTicket benchmark.
    const allCycles = graph.detectedCycles;
    const prunedTree = pruneCycles(graph, allCycles.length > 0 ? allCycles : undefined);

    // Perform tree RCA on the pruned tree with collision energy
    const results = performTreeRCA(
      prunedTree,
      graph.anomalyScores,
      graph.anomalyOnsetTimes,
      graph.callGraph.nodes,
      graph.propagationWeights,
      k,
      this.options,
      graph.collisionEnergy,
    );

    return results;
  }

  /**
   * Compute the upper bound on total cycle contribution given
   * the current system load.
   *
   * ### Critical Load Theorem (Deng Yu)
   *
   * If systemLoad < λ_critical:
   *
   *   Σw(C) ≤ K × ε
   *
   * where K is the kinetic constant and ε is the prune threshold.
   *
   * The bound increases with system load:
   *
   *   bound = systemLoad × K_0 / λ_critical
   *
   * where K_0 = ε × (1 + systemLoad).
   *
   * @param graph - Fault propagation graph
   * @returns Upper bound on total cycle contribution
   */
  getCycleContributionBound(graph: FaultPropagationGraph): number {
    const load = graph.callGraph.systemLoad;
    invariantRange(load, 0, 1, 'systemLoad');

    if (load >= this.options.criticalLoadThreshold) {
      // Above critical load: bound grows rapidly (system is dense)
      return load * this.options.pruneEpsilon * 2;
    }

    // Below critical load: bounded by K×ε (rarefied regime)
    const K0 = this.options.pruneEpsilon * (1 + load);
    return (load / this.options.criticalLoadThreshold) * K0;
  }

  /**
   * Get the current prune epsilon threshold.
   */
  get pruneEpsilon(): number {
    return this.options.pruneEpsilon;
  }
}

/**
 * Prune insignificant cycles from the fault propagation graph.
 *
 * For each insignificant cycle, find the edge with the minimum
 * propagation weight and remove it. This breaks the cycle while
 * preserving the strongest fault propagation paths.
 *
 * Deng Yu mapping: removing the weakest collision cross-section edge
 * corresponds to discarding the least probable collision trajectory.
 *
 * @param graph - Fault propagation graph
 * @param cycles - Cycles to prune (defaults to all detected cycles)
 * @returns Pruned tree structure
 * @internal
 */
function pruneCycles(graph: FaultPropagationGraph, cycles?: readonly DetectedCycle[]): PrunedTree {
  const targetCycles = cycles ?? graph.detectedCycles;
  const weightMap = buildEdgeWeightMap(graph.callGraph.edges, graph.propagationWeights);

  // Track which edges are pruned
  const prunedEdgeSet = new Set<string>();
  const prunedEdges: PrunedEdgeRecord[] = [];

  for (const cycle of targetCycles) {
    // Find the weakest edge in this cycle
    let weakestEdge: [ServiceId, ServiceId] | null = null;
    let weakestWeight = Infinity;

    const path = cycle.nodePath;
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const u = path[i]!;
      const v = path[(i + 1) % n]!;
      const key = `${u}→${v}`;
      const w = weightMap.get(key) ?? 0;
      if (w < weakestWeight) {
        weakestWeight = w;
        weakestEdge = [u, v];
      }
    }

    if (weakestEdge) {
      const [from, to] = weakestEdge;
      const edgeKey = `${from}→${to}`;
      if (!prunedEdgeSet.has(edgeKey)) {
        prunedEdgeSet.add(edgeKey);
        prunedEdges.push({
          from,
          to,
          cycleId: cycleKey(cycle.nodePath),
          cycleContribution: cycle.contribution,
          marginBelowThreshold: graph.pruneThreshold - cycle.contribution,
        });
      }
    }
  }

  // Build remaining edges
  const remainingEdges = graph.callGraph.edges.filter((e) => {
    const key = `${e.from}→${e.to}`;
    return !prunedEdgeSet.has(key);
  });

  // Build initial node scores (just anomaly, no child propagation yet)
  const nodes = new Map<ServiceId, TreeNodeScore>();
  for (const [nodeId, _node] of graph.callGraph.nodes) {
    const anomalyScore = graph.anomalyScores.get(nodeId) ?? 0;
    nodes.set(nodeId, {
      nodeId,
      anomalyScore,
      childPropagationScore: 0,
      totalScore: anomalyScore,
      depth: 0,
    });
  }

  // Compute contributed removed
  let contributionRemoved = 0;
  for (const cycle of targetCycles) {
    contributionRemoved += cycle.contribution;
  }

  return {
    nodes,
    edges: remainingEdges,
    rootCauseScores: new Map(),
    prunedEdges,
    cyclesPruned: targetCycles.length,
    contributionRemoved,
  };
}

/**
 * Perform RCA on the pruned tree using bottom-up anomaly score accumulation.
 *
 * When collisionEnergy is provided, the Boltzmann Q(f,f) collision energy
 * replaces raw anomaly scores as the primary ranking signal, and collision
 * type classification (chain/fan-in/bottleneck/cycle) adjusts depth bonuses.
 *
 * Algorithm:
 * 1. Build adjacency from remaining edges
 * 2. Compute in-degree for each node
 * 3. Topological sort (leaves first)
 * 4. Bottom-up accumulation: leaf nodes contribute upward
 * 5. Top nodes get the highest scores → root cause candidates
 *
 * Time complexity: O(V + E)
 *
 * @internal
 */
function performTreeRCA(
  tree: PrunedTree,
  anomalyScores: ReadonlyMap<ServiceId, number>,
  anomalyOnsetTimes: ReadonlyMap<ServiceId, number>,
  allNodes: ReadonlyMap<ServiceId, ServiceNode>,
  propagationWeights: Float64Array,
  topK: number,
  options: TreePrunerOptions,
  collisionEnergy?: ReadonlyMap<
    ServiceId,
    { totalEnergy: number; collisionType: string; collisionGain: number }
  >,
): RootCauseResult[] {
  // Build adjacency from remaining edges
  const children = new Map<ServiceId, Array<{ child: ServiceId; weight: number }>>();

  for (const nodeId of allNodes.keys()) {
    children.set(nodeId, []);
  }

  for (let i = 0; i < tree.edges.length; i++) {
    const edge = tree.edges[i]!;
    const childList = children.get(edge.from);
    if (childList) {
      childList.push({
        child: edge.to,
        weight: propagationWeights[i]!,
      });
    }
  }

  // Topological sort: start with TRUE leaves (outDegree === 0).
  // inDegree counts incoming edges (parents); inDegree===0 means ROOT nodes.
  // We need nodes with NO children to propagate bottom-up.
  const leaves: ServiceId[] = [];
  for (const [nodeId, childList] of children) {
    if (childList.length === 0) {
      leaves.push(nodeId);
    }
  }

  // Fallback: if ring-connect edges create cycles with no true leaves,
  // fall back to nodes with the FEWEST children as starting points.
  if (leaves.length === 0) {
    let minChildren = Infinity;
    for (const [_nodeId, childList] of children) {
      if (childList.length < minChildren) minChildren = childList.length;
    }
    for (const [nodeId, childList] of children) {
      if (childList.length === minChildren) leaves.push(nodeId);
    }
  }

  // Bottom-up accumulation with BFS from leaves
  const scores = new Map<ServiceId, number>();
  // Self anomaly per node (mixedSelf) — the primary ranking signal. Kept
  // separate from `scores` (the accumulated totalScore) so the root cause
  // (the fault injection point) is ranked by its OWN deviation, not by the
  // anomaly its downstream children propagate back up to it.
  const selfScores = new Map<ServiceId, number>();
  const depths = new Map<ServiceId, number>();
  // Queue for bottom-up processing: process nodes when all parents processed
  // Actually, we process from leaf → root: initialize leaves, then propagate upward

  // Initialize all scores with collision energy when available,
  // falling back to raw anomaly scores otherwise.
  // Also track collision type for each node (for sort-time amplification).
  const collisionTypes = new Map<ServiceId, string>();
  for (const [nodeId] of allNodes) {
    const collisionResult = collisionEnergy?.get(nodeId);
    const ce = collisionResult?.totalEnergy;
    // Use collision energy only when it adds signal (> 0).
    // Falls back to raw anomaly score when totalEnergy is 0 or undefined.
    scores.set(
      nodeId,
      ce !== null && ce !== undefined && ce > 0 ? ce : (anomalyScores.get(nodeId) ?? 0),
    );
    collisionTypes.set(nodeId, collisionResult?.collisionType ?? 'chain');
    depths.set(nodeId, 0);
  }

  // Build reverse adjacency (parent → children)
  const reverseAdj = new Map<ServiceId, string[]>();
  for (const [nodeId] of allNodes) {
    reverseAdj.set(nodeId, []);
  }
  for (const edge of tree.edges) {
    const list = reverseAdj.get(edge.to);
    if (list) {
      list.push(edge.from);
    }
  }

  // Source-likelihood prior: the fraction of a node's causal neighbours
  // (children + parents in the pruned tree) whose anomaly onset is LATER
  // than its own. The fault source's disturbance precedes its neighbours'
  // (cause precedes effect — Deng Yu's mean free time τ), so a source has a
  // high score while a downstream symptom (whose parent changed first) or an
  // isolated noise service (random neighbour onsets) has a low score. Onset
  // indices are derived purely from each service's own time series, never
  // from dataset metadata such as inject_time.
  const sourceScores = new Map<ServiceId, number>();
  for (const [nodeId] of allNodes) {
    const myOnset = anomalyOnsetTimes.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
    let later = 0;
    let neighbours = 0;
    for (const { child } of children.get(nodeId) ?? []) {
      neighbours++;
      if ((anomalyOnsetTimes.get(child) ?? Number.MAX_SAFE_INTEGER) > myOnset) later++;
    }
    for (const parent of reverseAdj.get(nodeId) ?? []) {
      neighbours++;
      if ((anomalyOnsetTimes.get(parent) ?? Number.MAX_SAFE_INTEGER) > myOnset) later++;
    }
    sourceScores.set(nodeId, neighbours > 0 ? later / neighbours : 0);
  }

  // Topological order: use in-degree with reverse adjacency
  // Process from leaves upward
  const processQueue = [...leaves];
  const processed = new Set<ServiceId>();

  while (processQueue.length > 0) {
    const node = processQueue.shift()!;
    if (processed.has(node)) continue;
    processed.add(node);

    // Use collision-enhanced energy when available, falling back to raw anomaly.
    // Collision energy is the Boltzmann Q(f,f) aggregate of upstream fault signals,
    // which captures propagation dynamics that raw anomaly scores miss.
    const collisionResult = collisionEnergy?.get(node);
    const nodeEnergy = collisionResult?.totalEnergy ?? anomalyScores.get(node) ?? 0;
    const nodeAnomaly = anomalyScores.get(node) ?? 0;
    let childContrib = 0;
    let maxChildDepth = 0;

    // Accumulate from outgoing children
    const childList = children.get(node)!;
    for (const { child, weight } of childList) {
      const childScore = scores.get(child)!;
      const childDepth = depths.get(child)!;
      // Time-delay decay: each hop attenuates by α
      const latencyDecay = Math.pow(options.decayAlpha, 1);
      childContrib += childScore * weight * latencyDecay;
      if (childDepth + 1 > maxChildDepth) {
        maxChildDepth = childDepth + 1;
      }
    }

    // Fan-out dilution theorem (Deng Yu, 2024):
    // In a collision tree, a parent with N children receives anomaly
    // contributions from each child, but the total contribution is
    // attenuated by 1/N to prevent fan-out services (like API gateways
    // or frontends) from unfairly accumulating anomaly evidence from
    // the entire downstream graph.
    //
    // Without this normalization, a frontend with 7 downstream services
    // accumulates 7× more child contributions than a specific backend
    // service with only 1 downstream child, artificially boosting the
    // frontend's root cause score even when the fault originates in a
    // downstream service.
    const childCount = childList.length;
    const fanOutDilution = childCount > 0 ? 1 / childCount : 1;

    // Mix: collision energy (upstream-aware) + child contributions (downstream-aware)
    // Weight: α = 0.6 collision-driven, 0.4 raw-anomaly-driven for non-collision nodes
    // This prevents children from dominating the score of a deep bottleneck node
    // whose collision energy already captures upstream propagation.
    const isCollisionNode = collisionTypes.get(node) !== 'chain';
    const collisionWeight = isCollisionNode ? 0.7 : 0.5;
    const mixedSelf = collisionWeight * nodeEnergy + (1 - collisionWeight) * nodeAnomaly;
    const totalScore = mixedSelf + childContrib * fanOutDilution;
    scores.set(node, totalScore);
    // Rank by the node's OWN raw anomaly — the fault injection point has the
    // highest deviation. The collision energy (Q(f,f)) aggregates upstream
    // signals and amplifies convergence points (fan-in/bottleneck), which
    // would let a healthy convergence node outrank the true source, so it is
    // deliberately excluded from the primary ranking signal.
    selfScores.set(node, nodeAnomaly);
    depths.set(node, maxChildDepth);

    // Push parent nodes for processing
    const parents = reverseAdj.get(node)!;
    for (const p of parents) {
      if (!processed.has(p)) {
        // Check if all children of p have been processed. Guard against a
        // parent absent from the node map (a dangling edge endpoint) — skip
        // it rather than crashing the whole analysis.
        const pChildren = children.get(p);
        if (!pChildren) continue;
        const allProcessed = pChildren.every((c) => processed.has(c.child));
        if (allProcessed && !processQueue.includes(p)) {
          processQueue.push(p);
        }
      }
    }
  }

  // Compute final scores and rank
  const scoredNodes: Array<{
    serviceId: ServiceId;
    score: number;
    depth: number;
  }> = [];

  for (const [nodeId] of allNodes) {
    const selfScore = selfScores.get(nodeId)!;
    const depth = depths.get(nodeId)!;

    // Only include nodes with significant self anomaly
    if (selfScore > 0) {
      scoredNodes.push({ serviceId: nodeId, score: selfScore, depth });
    }
  }

  // Rank by self anomaly combined with a dataset-agnostic source-likelihood
  // prior. The root cause is the fault injection point — the service whose
  // OWN deviation is highest AND whose onset precedes its causal neighbours'.
  // A healthy parent must not accumulate its faulted children's anomaly
  // (childContrib) and outrank the actual source, and propagation DEPTH is
  // not used (RCAEval injects faults at arbitrary depths). The combination is
  // in LOG space so a strong source signal can overcome a moderately larger
  // symptom anomaly without unbounded amplification:
  //
  //   finalScore(v) = log(selfAnomaly(v)) + sourceWeight × sourceScore(v)
  //
  // When self anomalies are exactly equal (or sourceWeight = 0), the order is
  // settled deterministically by service id.
  const sourceWeight = options.sourceWeight;
  scoredNodes.sort((a, b) => {
    const aScore = Math.log(a.score) + sourceWeight * (sourceScores.get(a.serviceId) ?? 0);
    const bScore = Math.log(b.score) + sourceWeight * (sourceScores.get(b.serviceId) ?? 0);
    if (bScore !== aScore) return bScore - aScore;
    if (a.serviceId === b.serviceId) return 0;
    return a.serviceId < b.serviceId ? -1 : 1;
  });

  // Top-K results with collision type awareness
  const results: RootCauseResult[] = [];
  for (let i = 0; i < Math.min(topK, scoredNodes.length); i++) {
    const node = scoredNodes[i]!;
    const errorBound = estimatePropagationError(node.depth, options.decayAlpha);
    const cResult = collisionEnergy?.get(node.serviceId);
    const collisionType = cResult?.collisionType ?? 'chain';

    // Collision-enhanced severity: non-chain types suggest systemic impact
    let severityLabel = node.score > 0.7 ? 'critical' : node.score > 0.4 ? 'major' : 'minor';
    if (collisionType === 'cycle') severityLabel = 'critical';
    else if (collisionType === 'bottleneck' && severityLabel !== 'critical')
      severityLabel = 'major';

    results.push({
      serviceId: node.serviceId,
      faultType: {
        category: 'UNKNOWN',
        subType: `anomaly_propagation_${collisionType}`,
        severity: severityLabel as 'critical' | 'major' | 'minor',
      },
      confidence: computeConfidence(node.score, node.depth, errorBound),
      rank: i + 1,
      evidenceMetrics: [
        { metric: 'rca_score', value: node.score, threshold: 0.1 },
        ...(cResult
          ? [{ metric: 'collision_gain', value: cResult.collisionGain, threshold: 0.3 }]
          : []),
      ],
      propagationDepth: node.depth,
      propagationErrorBound: errorBound,
      viaTreeSearch: true,
    });
  }

  return results;
}

/**
 * Estimate propagation error after k hops.
 *
 * Error grows multiplicatively with each hop:
 *   ε_k = 1 - α^k
 *
 * where α is the 1-hop propagation accuracy.
 *
 * Deng Yu mapping: cumulative error bound in the BBGKY truncation.
 *
 * @internal
 */
function estimatePropagationError(depth: number, decayAlpha: number): number {
  return 1 - Math.pow(decayAlpha, Math.max(depth, 0));
}

/**
 * Compute confidence from score, depth, and error bound.
 *
 * confidence = score × (1 - errorBound)
 *
 * High score + low error = high confidence.
 *
 * @internal
 */
function computeConfidence(score: number, depth: number, errorBound: number): number {
  const depthPenalty = depth > 0 ? 1 / (1 + Math.log(depth + 1)) : 1;
  return Math.max(0, Math.min(1, score * (1 - errorBound) * depthPenalty));
}
