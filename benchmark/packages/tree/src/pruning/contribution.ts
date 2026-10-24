/**
 * CollisionContributionAnalyzer — cycle collision contribution computation.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * In the BBGKY hierarchy, each closed-loop collision trajectory C has a
 * collision cross-section (contribution weight):
 *
 *   w(C) = ∏_{e ∈ C} σ(e)
 *
 * where σ(e) is the collision cross-section (propagation probability)
 * of edge e. Deng Yu proved that in the rarefied gas limit:
 *
 *   Σ_{cycles C} w(C) ≤ K × ε → 0  as systemLoad → 0
 *
 * This means cycles with w(C) < ε can be safely pruned from the fault
 * propagation graph without affecting RCA accuracy.
 *
 * ### 1-Hop Decay Model
 * Propagation probability decays by factor α per hop:
 *   p_hop1(e) = propagationWeight(e) × α
 * where α = exp(-latency / τ), τ is the decay time constant.
 *
 * ### 2-Hop Decay Model
 * Accounts for second-order neighbor effects:
 *   p_hop2(e) = p_hop1(e) + (1 - p_hop1(e)) × β × p_hop1(neighbor)
 * where β is the second-order coupling coefficient.
 *
 * @module pruning/contribution
 */

import {
  type CallEdge,
  type DetectedCycle,
  invariant,
  invariantNonEmpty,
  invariantRange,
  type ServiceId,
} from '@agentix-e/micro-kinetic-core';
import { cycleKey } from '../graph/cycle-detector.js';

/**
 * Parameters controlling decay behavior in the collision contribution model.
 */
export interface DecayParams {
  /** One-hop decay factor α ∈ (0, 1]. Default: 0.8 */
  readonly alpha: number;
  /** Two-hop coupling coefficient β ∈ [0, 1]. Default: 0.3 */
  readonly beta: number;
  /** Decay time constant τ (ms). Default: 1000 */
  readonly tauMs: number;
}

const DEFAULT_DECAY_PARAMS: DecayParams = {
  alpha: 0.8,
  beta: 0.3,
  tauMs: 1000,
};

/**
 * Edge weight lookup — maps (from, to) → propagation weight.
 */
export type EdgeWeightMap = Map<string, number>;

/**
 * Build an edge weight lookup from edges and propagation weights array.
 *
 * @param edges - Ordered list of call edges
 * @param weights - Propagation weights indexed by edge order
 * @returns Map from "from→to" key to weight
 */
export function buildEdgeWeightMap(
  edges: readonly CallEdge[],
  weights: Float64Array,
): EdgeWeightMap {
  invariant(edges.length > 0, 'edges must be non-empty');
  invariant(
    weights.length === edges.length,
    `propagationWeights length (${weights.length}) must match edges length (${edges.length})`,
  );

  const map: EdgeWeightMap = new Map();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]!;
    const key = `${e.from}→${e.to}`;
    map.set(key, weights[i]!);
  }
  return map;
}

/**
 * Look up the propagation weight for an edge (u, v) in the weight map.
 * Returns 0 if not found (edge doesn't exist in propagation graph).
 *
 * @internal
 */
function edgeWeight(weightMap: EdgeWeightMap, u: ServiceId, v: ServiceId): number {
  return weightMap.get(`${u}→${v}`) ?? 0;
}

/**
 * CollisionContributionAnalyzer — computes per-cycle collision contributions.
 *
 * Implements the product formula w(C) = ∏_{e∈C} propagationWeight(e)
 * with both 1-hop and 2-hop propagation probability decay models.
 *
 * ## Deng Yu Mapping
 *
 * - **w(C)**: The collision cross-section product for cycle C
 * - **1-hop decay**: Models direct binary collision between adjacent services
 * - **2-hop decay**: Incorporates ternary collision corrections per BBGKY
 */
export class CollisionContributionAnalyzer {
  private readonly params: DecayParams;
  private readonly weightMap: EdgeWeightMap;

  /**
   * @param edges - Ordered call edges
   * @param propagationWeights - Flattened propagation weights array
   * @param decayParams - Optional decay parameters
   */
  constructor(
    edges: readonly CallEdge[],
    propagationWeights: Float64Array,
    decayParams?: Partial<DecayParams>,
  ) {
    invariantNonEmpty(edges, 'edges');
    invariantNonEmpty(propagationWeights, 'propagationWeights');

    this.params = { ...DEFAULT_DECAY_PARAMS, ...decayParams };
    invariantRange(this.params.alpha, 0, 1, 'alpha');
    invariantRange(this.params.beta, 0, 1, 'beta');

    this.weightMap = buildEdgeWeightMap(edges, propagationWeights);
  }

  /**
   * Compute the raw collision contribution w(C) without decay.
   *
   *   w(C) = ∏_{e∈C} propagationWeight(e)
   *
   * @param cycle - The detected cycle
   * @returns Contribution value in [0, 1]
   */
  computeRawContribution(cycle: DetectedCycle): number {
    const path = cycle.nodePath;
    const n = path.length;
    if (n < 2) return 0;

    let contrib = 1.0;
    for (let i = 0; i < n; i++) {
      const u = path[i]!;
      const v = path[(i + 1) % n]!;
      const w = edgeWeight(this.weightMap, u, v);
      if (w === 0) return 0;
      contrib *= w;
    }
    return contrib;
  }

  /**
   * Compute the 1-hop decay contribution.
   *
   * Each edge weight is attenuated by the 1-hop decay factor α:
   *
   *   w₁(C) = ∏_{e∈C} (propagationWeight(e) × α)
   *
   * This models the exponential decay of propagation probability
   * as fault signals cross service boundaries. In Deng Yu's
   * kinetic theory, α corresponds to the mean free path attenuation
   * between particle collisions.
   *
   * @param cycle - The detected cycle
   * @returns 1-hop decay contribution
   */
  computeOneHopContribution(cycle: DetectedCycle): number {
    const raw = this.computeRawContribution(cycle);
    const n = cycle.nodePath.length;
    if (n === 0) return 0;
    return raw * Math.pow(this.params.alpha, n);
  }

  /**
   * Compute the 2-hop decay contribution.
   *
   * Incorporates second-order neighbor effects using the
   * coupling coefficient β:
   *
   *   w₂(C) = ∏_{e∈C} [p₁(e) + (1-p₁(e)) × β × avg(p₁(neighbor edges))]
   *
   * This corresponds to ternary collision corrections in the
   * BBGKY hierarchy, where each edge's propagation is influenced
   * by the correlation with its 2-hop neighborhood.
   *
   * @param cycle - The detected cycle
   * @returns 2-hop decay contribution
   */
  computeTwoHopContribution(cycle: DetectedCycle): number {
    const path = cycle.nodePath;
    const n = path.length;
    if (n < 2) return 0;

    let contrib = 1.0;
    for (let i = 0; i < n; i++) {
      const u = path[i]!;
      const v = path[(i + 1) % n]!;
      const w = edgeWeight(this.weightMap, u, v);
      if (w === 0) return 0;

      // 1-hop decay for this edge
      const p1 = w * this.params.alpha;

      // 2-hop correction: average 1-hop weight of v's outgoing neighbors
      const nextNode = path[(i + 2) % n]!;
      const neighborWeight = edgeWeight(this.weightMap, v, nextNode);
      const avgNeighbor = neighborWeight > 0 ? neighborWeight * this.params.alpha : 0;

      // 2-hop adjusted weight
      const p2 = p1 + (1 - p1) * this.params.beta * avgNeighbor;
      contrib *= p2;
    }

    return contrib;
  }

  /**
   * Compute contributions for all detected cycles using the 1-hop model.
   *
   * @param cycles - Detected cycles
   * @returns Map from cycle key to contribution weight
   */
  computeAllContributions(cycles: readonly DetectedCycle[]): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      result.set(key, this.computeOneHopContribution(cycle));
    }
    return result;
  }

  /**
   * Compute contributions for all cycles using the 2-hop model.
   */
  computeAllTwoHopContributions(cycles: readonly DetectedCycle[]): ReadonlyMap<string, number> {
    const result = new Map<string, number>();
    for (const cycle of cycles) {
      const key = cycleKey(cycle.nodePath);
      result.set(key, this.computeTwoHopContribution(cycle));
    }
    return result;
  }

  /**
   * Estimate the latency-based decay factor for an edge.
   *
   *   f(latency) = exp(-latency / τ)
   *
   * where τ is the decay time constant. This models how fault
   * signal strength attenuates over time as it propagates through
   * service calls with non-zero latency.
   *
   * Deng Yu mapping: quantum collision cross-section decay
   * in the kinetic wave equation.
   *
   * @param latencyMs - P99 call latency in milliseconds
   * @returns Decay factor in (0, 1]
   */
  latencyDecay(latencyMs: number): number {
    invariantRange(latencyMs, 0, Infinity, 'latencyMs');
    return Math.exp(-latencyMs / this.params.tauMs);
  }
}
