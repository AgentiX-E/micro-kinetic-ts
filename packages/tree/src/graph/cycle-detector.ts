/**
 * JohnsonCycleDetector — Johnson's all-simple-cycles algorithm.
 *
 * ## Deng Yu Kinetic Theory Mapping
 *
 * In Deng Yu's collision tree theory, **cycles in a fault propagation graph
 * correspond to closed-loop collision trajectories** in the BBGKY hierarchy.
 * The key insight: in the rarefied gas (low system load) limit, the total
 * contribution of closed loops vanishes:
 *
 *   Σ_{cycles C} w(C) → 0  as systemLoad → 0
 *
 * This provides a mathematically rigorous justification for cycle pruning
 * in AIOps root cause analysis — cycles removed by the pruner are exactly
 * those whose collision contribution falls below ε.
 *
 * ## Algorithm Complexity
 *
 * Johnson's algorithm runs in O((V + E) × C) time, where C is the number
 * of simple cycles. For sparse microservice graphs, C is typically small.
 *
 * ## Steps
 * 1. **Tarjan SCC decomposition** — partition the graph into strongly
 *    connected components. Cycles can only exist within SCCs.
 * 2. **Johnson enumeration per SCC** — for each SCC with ≥ 2 nodes,
 *    enumerate all simple cycles using blocked-set DFS.
 *
 * @module graph/cycle-detector
 */

import {
  type DetectedCycle,
  type ServiceId,
  invariant,
  invariantPositiveInt,
} from '@agentix-e/micro-kinetic-core';

/** Adjacency list representation. */
type AdjacencyList = Map<ServiceId, ServiceId[]>;

/**
 * Options controlling Johnson cycle detection behavior.
 */
export interface JohnsonCycleOptions {
  /** Maximum number of cycles to enumerate (safety bound). */
  readonly maxCycles: number;
  /** Maximum length (nodes) of a cycle to consider. */
  readonly maxCycleLength: number;
}

const DEFAULT_JOHNSON_OPTIONS: JohnsonCycleOptions = {
  maxCycles: 10_000,
  maxCycleLength: 100,
};

/**
 * Build an adjacency list from a list of edges.
 *
 * @param edges - Directed edges as [from, to] pairs
 * @returns Adjacency list for forward traversal
 * @internal
 */
export function buildAdjacencyList(
  edges: ReadonlyArray<readonly [ServiceId, ServiceId]>,
): AdjacencyList {
  const adj: AdjacencyList = new Map();
  for (const [u, v] of edges) {
    let neighbors = adj.get(u);
    if (!neighbors) {
      neighbors = [];
      adj.set(u, neighbors);
    }
    neighbors.push(v);
    // ensure v exists even if no outgoing edges
    if (!adj.has(v)) {
      adj.set(v, []);
    }
  }
  return adj;
}

/**
 * Tarjan's strongly connected components algorithm.
 *
 * @param adjacency - Forward adjacency list
 * @returns Array of SCCs, each is a list of node IDs
 * @internal
 */
export function tarjanSCC(adjacency: AdjacencyList): ServiceId[][] {
  const nodes = Array.from(adjacency.keys());
  const index = new Map<ServiceId, number>();
  const lowlink = new Map<ServiceId, number>();
  const onStack = new Set<ServiceId>();
  const stack: ServiceId[] = [];
  const sccs: ServiceId[][] = [];

  let currentIndex = 0;

  function strongConnect(v: ServiceId): void {
    index.set(v, currentIndex);
    lowlink.set(v, currentIndex);
    currentIndex++;
    stack.push(v);
    onStack.add(v);

    const neighbors = adjacency.get(v)!;
    for (const w of neighbors) {
      if (!index.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, index.get(w)!));
      }
    }

    if (lowlink.get(v) === index.get(v)) {
      const scc: ServiceId[] = [];
      let w: ServiceId;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      sccs.push(scc);
    }
  }

  for (const v of nodes) {
    if (!index.has(v)) {
      strongConnect(v);
    }
  }

  return sccs;
}

/**
 * Build a subgraph adjacency restricted to nodes in a given SCC.
 *
 * @internal
 */
function buildSCCAdjacency(adjacency: AdjacencyList, sccNodes: ServiceId[]): AdjacencyList {
  const sccSet = new Set(sccNodes);
  const subAdj: AdjacencyList = new Map();
  for (const u of sccNodes) {
    const neighbors = adjacency.get(u)!.filter((w) => sccSet.has(w));
    subAdj.set(u, neighbors);
  }
  return subAdj;
}

/**
 * Enumerate all simple cycles in a strongly connected component
 * using Johnson's blocked-set DFS algorithm.
 *
 * @param sccAdj - Adjacency list restricted to this SCC
 * @param options - Detection options
 * @returns Array of node paths forming simple cycles
 * @internal
 */
function johnsonEnumerateCycles(
  sccAdj: AdjacencyList,
  options: JohnsonCycleOptions,
): ServiceId[][] {
  const nodes = Array.from(sccAdj.keys());
  const cycles: ServiceId[][] = [];
  const blocked = new Map<ServiceId, boolean>();
  const blockDependencies = new Map<ServiceId, Set<ServiceId>>();

  // minimum start node index for each iteration
  let startIdx = 0;

  while (startIdx < nodes.length && cycles.length < options.maxCycles) {
    const startNode = nodes[startIdx]!;

    // Only consider the subgraph of nodes with index >= startIdx
    // (this ensures each cycle is reported exactly once)
    const subgraphNodes = new Set<ServiceId>(
      nodes.filter((n) => {
        const ni = nodes.indexOf(n);
        return ni >= startIdx;
      }),
    );

    // Reset blocked state for this start-node iteration
    blocked.clear();
    blockDependencies.clear();
    for (const n of sccAdj.keys()) {
      blocked.set(n, false);
      blockDependencies.set(n, new Set());
    }

    const stack: ServiceId[] = [];

    function unblock(node: ServiceId): void {
      blocked.set(node, false);
      const deps = blockDependencies.get(node);
      if (deps) {
        const depsList = Array.from(deps);
        blockDependencies.set(node, new Set());
        for (const w of depsList) {
          if (blocked.get(w)) {
            unblock(w);
          }
        }
      }
    }

    function circuit(v: ServiceId): boolean {
      let foundCycle = false;
      stack.push(v);
      blocked.set(v, true);

      const neighbors = sccAdj.get(v)!;
      for (const w of neighbors) {
        if (w === startNode && cycles.length < options.maxCycles) {
          // Found a cycle
          const cycle = [...stack];
          if (cycle.length <= options.maxCycleLength) {
            cycles.push(cycle);
          }
          foundCycle = true;
        } else if (!blocked.get(w)) {
          if (circuit(w)) {
            foundCycle = true;
          }
        }
      }

      if (foundCycle) {
        unblock(v);
      } else {
        for (const w of neighbors) {
          const deps = blockDependencies.get(w);
          if (deps) {
            deps.add(v);
          }
        }
      }

      stack.pop();
      return foundCycle;
    }

    circuit(startNode);

    // Remove startNode from further consideration
    sccAdj.delete(startNode);
    for (const [node, neighbors] of sccAdj) {
      sccAdj.set(
        node,
        neighbors.filter((n) => n !== startNode),
      );
    }

    startIdx++;
  }

  return cycles;
}

/**
 * JohnsonCycleDetector — enumerates all simple cycles in a directed graph.
 *
 * Maps to Deng Yu's closed-loop collision trajectory enumeration
 * in the collision tree expansion of the BBGKY hierarchy.
 *
 * @example
 * ```typescript
 * const detector = new JohnsonCycleDetector();
 * const cycles = detector.detect([
 *   ['A', 'B'], ['B', 'C'], ['C', 'A'], ['B', 'D'],
 * ]);
 * console.log(cycles); // [{ nodePath: ['A', 'B', 'C'], ... }]
 * ```
 */
export class JohnsonCycleDetector {
  private readonly options: JohnsonCycleOptions;

  constructor(options?: Partial<JohnsonCycleOptions>) {
    this.options = { ...DEFAULT_JOHNSON_OPTIONS, ...options };
  }

  /**
   * Detect all simple cycles in a directed graph.
   *
   * **Invariant preconditions:**
   * - `edges` must be non-empty
   * - Each edge must be a [from, to] pair of non-empty strings
   *
   * @param edges - Directed edges as [from, to] pairs
   * @returns Array of detected cycles (without contribution yet)
   */
  detect(edges: ReadonlyArray<readonly [ServiceId, ServiceId]>): DetectedCycle[] {
    invariant(edges.length > 0, 'edges must be non-empty');
    invariantPositiveInt(this.options.maxCycles, 'maxCycles');

    const adjacency = buildAdjacencyList(edges);
    const sccs = tarjanSCC(adjacency);

    const allCycles: ServiceId[][] = [];

    for (const scc of sccs) {
      // Cycles can only exist in SCCs with ≥ 2 nodes
      if (scc.length < 2) continue;

      const sccAdj = buildSCCAdjacency(adjacency, scc);
      const sccCycles = johnsonEnumerateCycles(sccAdj, this.options);
      allCycles.push(...sccCycles);

      if (allCycles.length >= this.options.maxCycles) break;
    }

    // Convert to DetectedCycle (contribution = 0 initially, set later)
    return allCycles.map((nodePath) => ({
      nodePath,
      contribution: 0,
      significant: false,
    }));
  }

  /**
   * Detect cycles and classify them by significance based on
   * pre-computed contributions.
   *
   * @param edges - Directed edges as [from, to] pairs
   * @param contributions - Map from cycle key to contribution weight
   * @param threshold - Significance threshold ε
   */
  detectWithContributions(
    edges: ReadonlyArray<readonly [ServiceId, ServiceId]>,
    contributions: ReadonlyMap<string, number>,
    threshold: number,
  ): DetectedCycle[] {
    const nodePaths = this.detect(edges).map((c) => c.nodePath);

    return nodePaths.map((nodePath) => {
      const key = cycleKey(nodePath);
      const contrib = contributions.get(key) ?? 0;
      return {
        nodePath,
        contribution: contrib,
        significant: contrib >= threshold,
      };
    });
  }
}

/**
 * Generate a canonical cycle key from a node path.
 * Rotates to lexicographically smallest rotation.
 *
 * @internal
 */
export function cycleKey(nodePath: readonly ServiceId[]): string {
  if (nodePath.length === 0) return '';
  const n = nodePath.length;
  let bestStart = 0;
  for (let i = 1; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const a = nodePath[(i + j) % n]!;
      const b = nodePath[(bestStart + j) % n]!;
      if (a < b) {
        bestStart = i;
        break;
      }
      if (a > b) break;
    }
  }
  const rotated: ServiceId[] = [];
  for (let i = 0; i < n; i++) {
    rotated.push(nodePath[(bestStart + i) % n]!);
  }
  return rotated.join('→');
}
