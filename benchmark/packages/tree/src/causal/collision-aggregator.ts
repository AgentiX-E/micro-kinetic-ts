/**
 * Collision Node Fault Aggregator — Boltzmann Q(f,f) nonlinear fault aggregation.
 *
 * ## Deng Yu Collision Tree Theory
 *
 * In Deng Yu's kinetic framework, a fault propagation graph is a deterministic
 * reaction system. Each node experiences fault energy (anomaly signal) from
 * two sources:
 *
 *   1. **Local anomaly** — self-generated fault signal from metrics deviation
 *   2. **Collision gain** — aggregate of incoming fault energy from upstream
 *      neighbors, nonlinearly amplified by the Boltzmann collision operator Q(f,f)
 *
 * The total fault energy at node v is:
 *
 *   E(v) = α · A_local(v) + (1-α) · Q(f,f)(v)
 *
 * where:
 *   - A_local(v): local anomaly score ∈ [0, 1]
 *   - α: local-vs-aggregate weighting coefficient
 *   - Q(f,f)(v) = Σ_{parents p} w(p→v) · E(p) · Φ(collisionType(v))
 *
 * ### Collision Type Amplification Φ(c)
 *
 * | Type       | Condition                  | Φ   | Interpretation                    |
 * |------------|----------------------------|-----|-----------------------------------|
 * | bottleneck | inDegree ≥ 3 AND C_v ≤ 0.5| 1.5 | Faults pile up, cannot drain fast  |
 * | fan-in     | inDegree ≥ 3              | 1.2 | Multiple faults converge           |
 * | cycle      | v is in any detected cycle | 1.8 | Self-reinforcing feedback loop     |
 * | chain      | inDegree ≤ 2              | 1.0 | Linear propagation, no amplification |
 *
 * ### Boltzmann Collision Operator
 *
 * In the kinetic wave equation, the collision operator Q(f,f) captures how
 * fault particles interact at a node. For each node v with incoming edges
 * from parents P(v):
 *
 *   Q(f,f)(v) = 1 - ∏_{p∈P(v)} (1 - w(p→v) · E(p))
 *
 * This is the probability that AT LEAST ONE incoming fault triggers a
 * fault at v, assuming independent failure probabilities. The product
 * form aligns with Deng Yu's rarefied gas approximation for collision
 * integration.
 *
 * With collision type amplification:
 *
 *   Q(f,f)(v) = Φ(v) · [1 - ∏_{p∈P(v)} (1 - w(p→v) · E(p))]^{1/Φ(v)}
 *
 * where the exponent 1/Φ redistributes the amplified energy.
 *
 * @module causal/collision-aggregator
 */

import type { ServiceId } from '@agentix-e/micro-kinetic-core';

/**
 * Collision type classification for a node in the fault graph.
 */
export type CollisionType = 'chain' | 'fan-in' | 'bottleneck' | 'cycle';

/**
 * Edge in the fault propagation graph.
 */
export interface FaultGraphEdge {
  /** Source (parent) service */
  from: ServiceId;
  /** Target (child) service */
  to: ServiceId;
  /** Propagation weight ∈ [0, 1] */
  weight: number;
}

/**
 * Node in the fault propagation graph with aggregated energy.
 */
export interface CollisionNode {
  /** Service identifier */
  serviceId: ServiceId;
  /** Local anomaly score ∈ [0, 1] */
  localScore: number;
  /** Incoming edges (parents → this node) */
  incomingEdges: readonly FaultGraphEdge[];
  /** Detected cycles this node participates in */
  cycleCount: number;
  /** Whether this node has been processed for energy */
  processed: boolean;
}

/**
 * Result of collision aggregation for a single node.
 */
export interface CollisionResult {
  /** Service identifier */
  serviceId: ServiceId;
  /** Local anomaly score */
  localScore: number;
  /** Collision type classification */
  collisionType: CollisionType;
  /** Boltzmann collision operator value Q(f,f)(v) ∈ [0, 1] */
  collisionGain: number;
  /** Total fault energy E(v) ∈ [0, 1] */
  totalEnergy: number;
  /** Number of incoming edges */
  inDegree: number;
  /** Contribution ratio: collision / local */
  ratioContrib: number;
}

/**
 * Configuration for the collision aggregator.
 */
export interface CollisionAggregatorConfig {
  /**
   * Local-vs-aggregate weighting coefficient α ∈ [0, 1].
   * Higher α: fault energy is dominated by local anomaly.
   * Lower α: fault energy is dominated by incoming collision gain.
   *
   * Default: 0.4 (lean toward aggregate — RCA prioritizes propagation)
   */
  alpha: number;

  /**
   * Bottleneck capacity threshold C_v.
   * A node is bottleneck if inDegree ≥ 3 AND its outgoing-to-incoming
   * edge ratio ≤ this threshold.
   *
   * Default: 0.5
   */
  bottleneckCapacity: number;

  /**
   * Fan-in degree threshold.
   * A node is fan-in type if inDegree ≥ this value (and not bottleneck).
   *
   * Default: 3
   */
  fanInThreshold: number;
}

const DEFAULT_CONFIG: CollisionAggregatorConfig = {
  alpha: 0.4,
  bottleneckCapacity: 0.5,
  fanInThreshold: 3,
};

/**
 * Build a map of incoming edges per node.
 *
 * @param allEdges - All edges in the fault graph
 * @returns Map from nodeId → incoming edges
 */
export function buildIncomingEdgeMap(
  allEdges: readonly FaultGraphEdge[],
): Map<ServiceId, FaultGraphEdge[]> {
  const map = new Map<ServiceId, FaultGraphEdge[]>();
  for (const e of allEdges) {
    const list = map.get(e.to);
    if (list) {
      list.push(e);
    } else {
      map.set(e.to, [e]);
    }
  }
  return map;
}

/**
 * Classify the collision type for a node.
 *
 * @param inDegree - Number of incoming edges
 * @param outDegree - Number of outgoing edges
 * @param cycleCount - How many cycles this node is involved in
 * @param config - Aggregator configuration
 * @returns Collision type classification
 */
export function classifyCollisionType(
  inDegree: number,
  outDegree: number,
  cycleCount: number,
  config: CollisionAggregatorConfig = DEFAULT_CONFIG,
): CollisionType {
  // Cycle takes precedence — self-reinforcing feedback
  if (cycleCount > 0) return 'cycle';

  // Bottleneck: many inputs, few outputs
  if (inDegree >= config.fanInThreshold) {
    const capacity = outDegree / Math.max(1, inDegree);
    if (capacity <= config.bottleneckCapacity) return 'bottleneck';
    return 'fan-in';
  }

  return 'chain';
}

/**
 * Compute the Boltzmann collision operator Q(f,f)(v).
 *
 * Given parent nodes with known energies and edge weights, compute:
 *
 *   Q(f,f)(v) = Φ(c) · [1 - ∏_{p∈P(v)} (1 - w(p→v) · E(p))]^{1/Φ(c)}
 *
 * where:
 *   - P(v): set of parent nodes with known energy
 *   - w(p→v): propagation weight on edge p→v
 *   - E(p): total fault energy of parent p
 *   - Φ(c): collision type amplification factor
 *
 * @param incomingEdges - Incoming edges (each has weight + parent energy)
 * @param parentEnergies - Map from parent ServiceId to its total energy E(p)
 * @param collisionType - Collision type classification
 * @returns Q(f,f)(v) ∈ [0, 1]
 */
export function computeBoltzmannCollisionGain(
  incomingEdges: readonly FaultGraphEdge[],
  parentEnergies: ReadonlyMap<ServiceId, number>,
  collisionType: CollisionType,
): number {
  if (incomingEdges.length === 0) return 0;

  // Compute the product ∏(1 - w·E) for all parents with known energy
  let product = 1.0;
  let effectiveParentCount = 0;

  for (const edge of incomingEdges) {
    const parentEnergy = parentEnergies.get(edge.from);
    if (parentEnergy !== undefined && parentEnergy > 0) {
      product *= 1 - edge.weight * parentEnergy;
      effectiveParentCount++;
    }
  }

  // If no parents have energy, collision gain is zero
  if (effectiveParentCount === 0) return 0;

  // Base collision probability: at least one incoming fault triggers
  const baseGain = 1 - product;

  // Collision type amplification Φ
  const phi = getCollisionAmplification(collisionType);

  // Deng Yu Q(f,f) with collision type amplification
  // Q = Φ · baseGain^{1/Φ} — the exponent redistributes amplified energy
  return phi * Math.pow(baseGain, 1 / phi);
}

/**
 * Get the amplification factor Φ for each collision type.
 */
function getCollisionAmplification(type: CollisionType): number {
  switch (type) {
    case 'cycle':
      return 1.8;
    case 'bottleneck':
      return 1.5;
    case 'fan-in':
      return 1.2;
    case 'chain':
      return 1.0;
  }
}

/**
 * Aggregate fault energy for a single node using the collision tree model.
 *
 * E(v) = α · A_local(v) + (1-α) · Q(f,f)(v)
 *
 * @param node - The collision node
 * @param parentEnergies - Known energies of parent nodes
 * @param config - Aggregator configuration
 * @returns Collision result with total energy
 */
export function aggregateCollisionEnergy(
  node: CollisionNode,
  parentEnergies: ReadonlyMap<ServiceId, number>,
  config: CollisionAggregatorConfig = DEFAULT_CONFIG,
): CollisionResult {
  const inDegree = node.incomingEdges.length;
  const outDegree = 0; // Computed externally; not needed for this node
  const collisionType = classifyCollisionType(inDegree, outDegree, node.cycleCount, config);

  const collisionGain = computeBoltzmannCollisionGain(
    node.incomingEdges,
    parentEnergies,
    collisionType,
  );

  const totalEnergy = config.alpha * node.localScore + (1 - config.alpha) * collisionGain;

  return {
    serviceId: node.serviceId,
    localScore: node.localScore,
    collisionType,
    collisionGain,
    totalEnergy: Math.min(1, Math.max(0, totalEnergy)),
    inDegree,
    ratioContrib: node.localScore > 0 ? collisionGain / (node.localScore + collisionGain) : 0,
  };
}

/**
 * Compute the dependency resolution order for collision energy propagation.
 *
 * In a directed fault graph, energy flows from root nodes (sources) toward
 * sink nodes (leaf services). We need a topological order to compute energies
 * iteratively: when processing node v, all its parents P(v) must already have
 * known energies.
 *
 * This function implements a DFS-based topological sort constrained to the
 * subgraph of nodes we care about.
 *
 * @param allEdges - All edges in the fault graph
 * @param nodeIds - Set of node IDs to include
 * @returns Topologically sorted node IDs (parents before children)
 */
export function computeTopologicalOrder(
  allEdges: readonly FaultGraphEdge[],
  nodeIds: ReadonlySet<ServiceId>,
): readonly ServiceId[] {
  // Build adjacency lists
  const children = new Map<ServiceId, ServiceId[]>();
  const inDegree = new Map<ServiceId, number>();

  for (const id of nodeIds) {
    children.set(id, []);
    inDegree.set(id, 0);
  }

  for (const e of allEdges) {
    if (nodeIds.has(e.from) && nodeIds.has(e.to)) {
      children.get(e.from)!.push(e.to);
      // Both endpoints are graph members, so `e.to` was initialised above.
      inDegree.set(e.to, inDegree.get(e.to)! + 1);
    }
  }

  // Kahn's algorithm: start with nodes having inDegree = 0
  const queue: ServiceId[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const result: ServiceId[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    // `node` and every `child` are graph members, so the adjacency and in-degree
    // lookups are always defined (both maps were pre-populated for all members).
    for (const child of children.get(node)!) {
      const newDeg = inDegree.get(child)! - 1;
      inDegree.set(child, newDeg);
      if (newDeg === 0) queue.push(child);
    }
  }

  return result;
}

/**
 * Aggregate fault energy across all nodes in a fault graph using
 * the Boltzmann collision operator.
 *
 * Algorithm:
 *   1. Build incoming edge map
 *   2. Classify each node's collision type (chain/fan-in/bottleneck/cycle)
 *   3. Topologically sort nodes (parents before children)
 *   4. For each node in order, compute Q(f,f) from known parent energies
 *   5. Return total energy map
 *
 * @param allEdges - All edges in the fault graph
 * @param localScores - Local anomaly score per service ∈ [0, 1]
 * @param cycleMembership - Per-service cycle count (how many cycles this node is in)
 * @param config - Aggregator configuration
 * @returns Map from serviceId to CollisionResult
 */
export function aggregateFaultEnergy(
  allEdges: readonly FaultGraphEdge[],
  localScores: ReadonlyMap<ServiceId, number>,
  cycleMembership: ReadonlyMap<ServiceId, number> = new Map(),
  config: CollisionAggregatorConfig = DEFAULT_CONFIG,
): ReadonlyMap<ServiceId, CollisionResult> {
  const incomingMap = buildIncomingEdgeMap(allEdges);
  const nodeIds = new Set(localScores.keys());

  // Build compute order (topological sort)
  const order = computeTopologicalOrder(allEdges, nodeIds);

  // Compute parent out-degree counts for bottleneck classification
  const outDegree = new Map<ServiceId, number>();
  for (const e of allEdges) {
    outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);
  }

  const parentEnergies = new Map<ServiceId, number>();
  const results = new Map<ServiceId, CollisionResult>();

  for (const serviceId of order) {
    // `order` is a subset of `localScores.keys()`, so the lookup is always defined.
    const localScore = localScores.get(serviceId)!;
    const incomingEdges = incomingMap.get(serviceId) ?? [];
    const od = outDegree.get(serviceId) ?? 0;
    const cycleCount = cycleMembership.get(serviceId) ?? 0;

    // Dynamically classify with actual out-degree
    const collisionType = classifyCollisionType(incomingEdges.length, od, cycleCount, config);

    const node: CollisionNode = {
      serviceId,
      localScore,
      incomingEdges,
      cycleCount,
      processed: false,
    };

    const result = aggregateCollisionEnergy(node, parentEnergies, config);
    // Override collision type with the one that used out-degree
    results.set(serviceId, {
      ...result,
      collisionType,
    });

    parentEnergies.set(serviceId, result.totalEnergy);
  }

  // Handle any nodes not in topological order (isolated or all-cyclic)
  for (const serviceId of nodeIds) {
    if (!results.has(serviceId)) {
      // `nodeIds` is derived from `localScores.keys()`, so the lookup is defined.
      const localScore = localScores.get(serviceId)!;
      const cycleCount = cycleMembership.get(serviceId) ?? 0;
      const collisionType = classifyCollisionType(0, 0, cycleCount, config);
      results.set(serviceId, {
        serviceId,
        localScore,
        collisionType,
        collisionGain: 0,
        totalEnergy: localScore,
        inDegree: 0,
        ratioContrib: 0,
      });
    }
  }

  return results;
}
