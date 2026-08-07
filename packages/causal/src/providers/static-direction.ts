/**
 * Static Direction Provider — pre-configured topology tier.
 *
 * Uses pre-configured service dependency directions from static
 * configuration sources (YAML topology files, K8s manifests, etc.)
 * to determine fault propagation direction.
 *
 * This is the fallback tier — it provides directions only for edges
 * that have been explicitly configured. Unlike trace-based inference,
 * static directions are pre-defined and cannot adapt to runtime
 * changes.
 *
 * Config format (YAML, dataset-agnostic):
 * ```yaml
 * directions:
 *   # Source → Target with reasoning
 *   - source: ts-ui
 *     target: ts-travel-service
 *     reasoning: "HTTP GET /travel from UI to travel service"
 *   - source: ts-order-service
 *     target: ts-payment-service
 *     reasoning: "gRPC grpc.ProcessPayment from order to payment service"
 * ```
 *
 * Cost: zero.
 * Accuracy: depends on configuration quality and completeness.
 *
 * @module causal/providers/static-direction
 */

import type {
  CallEdge,
  CausalDirection,
  ITimingProvider,
  TemporalContext,
  TimingProviderMeta,
} from '@agentix-e/micro-kinetic-core';

const STATIC_DIRECTION_META: TimingProviderMeta = {
  id: 'static-direction',
  description: 'Uses pre-configured service dependency directions from YAML topology files',
  tier: 'static',
  availability: 'conditional',
};

/**
 * StaticDirectionProvider — uses pre-configured direction mappings.
 *
 * Priority 4 in the causal direction detection chain. Provides
 * structurally informed directions from static topology configuration.
 */
export class StaticDirectionProvider implements ITimingProvider {
  readonly meta: TimingProviderMeta = STATIC_DIRECTION_META;
  private readonly directionMap: Map<string, Map<string, CausalDirection>>;

  /**
   * @param directions - Pre-configured causal directions (optional).
   *                     Can also be provided via TemporalContext at inference time.
   */
  constructor(directions: readonly CausalDirection[] = []) {
    this.directionMap = new Map();
    for (const d of directions) {
      this.addDirection(d);
    }
  }

  async inferDirection(
    edges: readonly CallEdge[],
    context: TemporalContext,
  ): Promise<readonly CausalDirection[]> {
    const results: CausalDirection[] = [];

    for (const edge of edges) {
      // Check runtime-provided static directions first (from context)
      const runtimeDir = context.staticDirections?.get(`${edge.from}→${edge.to}`);
      if (runtimeDir) {
        results.push({ ...runtimeDir, provider: 'static-direction' });
        continue;
      }

      // Check pre-configured direction map
      const dir = this.lookupDirection(edge.from, edge.to);
      if (dir) {
        results.push(dir);
      }
    }

    // Inject pre-configured directions from the map for edges that
    // weren't in the edge list but are in the static config
    const resultEdgeKeys = new Set(results.map((r) => `${r.source}→${r.target}`));
    for (const [source, targets] of this.directionMap) {
      for (const [target, direction] of targets) {
        const key = `${source}→${target}`;
        if (!resultEdgeKeys.has(key)) {
          // Check if this edge exists in the requested edge list
          const matchingEdge = edges.find(
            (e) =>
              e.from.toLowerCase() === source.toLowerCase() &&
              e.to.toLowerCase() === target.toLowerCase(),
          );
          if (matchingEdge) {
            results.push(direction);
          }
        }
      }
    }

    return results;
  }

  async canInfer(_context: TemporalContext): Promise<boolean> {
    return this.directionMap.size > 0;
  }

  async estimateConfidence(_context: TemporalContext): Promise<number> {
    // Static confidence is fixed at 0.5 — structurally informed but
    // not runtime-verified
    return this.directionMap.size > 0 ? 0.5 : 0;
  }

  /**
   * Add a pre-configured direction to the map.
   */
  addDirection(direction: CausalDirection): void {
    const sourceLower = direction.source.toLowerCase();
    if (!this.directionMap.has(sourceLower)) {
      this.directionMap.set(sourceLower, new Map());
    }
    this.directionMap.get(sourceLower)!.set(direction.target.toLowerCase(), {
      ...direction,
      tier: 'static',
    });
  }

  /**
   * Remove a pre-configured direction.
   */
  removeDirection(source: string, target: string): boolean {
    const sourceMap = this.directionMap.get(source.toLowerCase());
    if (!sourceMap) return false;
    return sourceMap.delete(target.toLowerCase());
  }

  /**
   * Get the number of pre-configured directions.
   */
  get directionCount(): number {
    let count = 0;
    for (const targets of this.directionMap.values()) {
      count += targets.size;
    }
    return count;
  }

  /**
   * Clear all pre-configured directions.
   */
  clear(): void {
    this.directionMap.clear();
  }

  // ── Private ────────────────────────────────────────────

  private lookupDirection(source: string, target: string): CausalDirection | null {
    const sourceMap = this.directionMap.get(source.toLowerCase());
    if (!sourceMap) return null;
    return sourceMap.get(target.toLowerCase()) ?? null;
  }
}
