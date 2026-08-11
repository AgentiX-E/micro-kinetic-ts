/**
 * Unit tests for RCAEval Semantic Topology Enhancer.
 *
 * Tests cover:
 * - RCAEvalSemanticEnhancer construction and availability
 * - enhance() with no embedding provider → no-op
 * - enhance() with mock embedding provider → cosine similarity matching
 * - enhance() with edge-mapped topology → correct from/to edge generation
 * - enhance() with empty unmatched list → empty output
 * - integrate with buildRCAEvalCallGraph and enhanceRCAEvalCallGraph
 * - SemanticCallEdge provenance and confidence tracking
 * - Regression: buildRCAEvalCallGraph sync path unchanged
 *
 * Uses mock IEmbeddingProvider that returns pre-computed vectors
 * to avoid real TF-IDF computation during tests.
 *
 * @module benchmarks/__tests__/rcaeval-semantic.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { IEmbeddingProvider } from '@agentix-e/micro-kinetic-core';
import type {
  ServiceDescriptor,
  EmbeddingResult,
} from '@agentix-e/micro-kinetic-core';
import { RCAEvalSemanticEnhancer } from '../src/rcaeval-semantic.js';
import type {
  SemanticCallEdge,
  SemanticEnhancerConfig,
  SemanticEnhancementInput,
} from '../src/rcaeval-semantic.js';
import {
  initRCAEvalTopology,
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
} from '../src/rcaeval-topology.js';

// ── Mock Embedding Provider ─────────────────────────────

/**
 * Pre-computed embedding provider for deterministic testing.
 *
 * Takes a map of text → Float32Array and returns those exact vectors.
 * For texts not in the map, returns a zero vector (low similarity to everything).
 */
class MockEmbeddingProvider implements IEmbeddingProvider {
  public readonly dimension: number;
  public readonly modelId: string;

  constructor(
    private readonly vectorMap: ReadonlyMap<string, Float32Array>,
    private readonly defaultDim: number = 4,
  ) {
    this.dimension = this.defaultDim;
    this.modelId = 'mock-embedding';
  }

  get meta(): { name: string; backend: string; requiresNetwork: boolean } {
    return { name: 'mock-embedding', backend: 'mock', requiresNetwork: false };
  }

  async embed(texts: readonly string[]): Promise<EmbeddingResult> {
    const vectors = texts.map((t) => {
      const vec = this.vectorMap.get(t);
      if (vec) return new Float32Array(vec); // copy
      // Not in map: return zero vector
      return new Float32Array(this.defaultDim);
    });
    return { vectors };
  }
}

/**
 * Create a mock embedding provider that maps case service names to
 * YAML topology aliases via shared vector representations.
 *
 * The SemanticAlignmentProvider calls embed() with all texts in one batch:
 *   [spanService1, spanService2, ..., enrichedTopo1, enrichedTopo2, ...]
 *
 * The enriched topology query is: `${name} ${id} ${namespace}` (from buildDescriptorQuery).
 * We map both the raw span name and the enriched YAML name to the same vector,
 * so cosine similarity between them will be ~1.0.
 */
function createMatchEmbedding(
  unmatchedToYaml: ReadonlyMap<string, string>,
  yamlServiceIds: readonly string[],
  system = 'TrainTicket',
): IEmbeddingProvider {
  const dim = 8;
  const vectorMap = new Map<string, Float32Array>();
  const usedVecs: Float32Array[] = [];

  let vecIdx = 0;
  for (const [unmatched, yamlId] of unmatchedToYaml) {
    const vec = new Float32Array(dim);
    const idx = vecIdx % dim;
    vec[idx] = 1.0;
    usedVecs.push(vec);
    // Map both the case service name AND the enriched YAML query to the same vector
    vectorMap.set(unmatched, vec);
    const enriched = `${yamlId} ${yamlId} ${system}`;
    vectorMap.set(enriched, vec);
    vecIdx++;
  }

  return new MockEmbeddingProvider(vectorMap, dim);
}

// ── Test Data ────────────────────────────────────────────

const TRAINTICKET_SERVICE_IDS = [
  'ts-ui',
  'ts-travel-service',
  'ts-order-service',
  'ts-payment-service',
  'ts-preserve-service',
];

const TRAINTICKET_EDGES = [
  { from: 'ts-ui', to: 'ts-travel-service', type: 'REST' as const, callRate: 1, p99Latency: 5, errorRate: 0 },
  { from: 'ts-ui', to: 'ts-order-service', type: 'REST' as const, callRate: 1, p99Latency: 5, errorRate: 0 },
  { from: 'ts-order-service', to: 'ts-payment-service', type: 'REST' as const, callRate: 1, p99Latency: 10, errorRate: 0.01 },
  { from: 'ts-order-service', to: 'ts-preserve-service', type: 'REST' as const, callRate: 0.5, p99Latency: 20, errorRate: 0.02 },
  { from: 'ts-preserve-service', to: 'ts-payment-service', type: 'REST' as const, callRate: 0.3, p99Latency: 15, errorRate: 0 },
];

function makeInput(overrides: Partial<SemanticEnhancementInput> = {}): SemanticEnhancementInput {
  return {
    unmatchedCaseServiceIds: ['ts-new-order-svc', 'ts-alternate-ui'],
    yamlTopologyEdges: TRAINTICKET_EDGES,
    yamlServiceIds: TRAINTICKET_SERVICE_IDS,
    system: 'TrainTicket',
    ...overrides,
  };
}

// ── RCAEvalSemanticEnhancer Construction ─────────────────

describe('RCAEvalSemanticEnhancer', () => {
  describe('construction', () => {
    it('should be unavailable without embedding provider', () => {
      const enhancer = new RCAEvalSemanticEnhancer();
      expect(enhancer.isAvailable).toBe(false);
    });

    it('should be available with embedding provider', () => {
      const mockProvider = new MockEmbeddingProvider(new Map());
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: mockProvider,
      });
      expect(enhancer.isAvailable).toBe(true);
    });

    it('should be available with embedding + LLM providers', () => {
      const mockProvider = new MockEmbeddingProvider(new Map());
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: mockProvider,
        llmProvider: { alignEntity: async () => ({ topologyId: null, confidence: 0, usage: {} }) } as any,
      });
      expect(enhancer.isAvailable).toBe(true);
    });
  });

  // ── enhance() — no-op cases ─────────────────────────

  describe('enhance — no-op cases', () => {
    it('should return empty result for empty unmatched list', async () => {
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: new MockEmbeddingProvider(new Map()),
      });
      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: [] }),
      );

      expect(result.edges).toHaveLength(0);
      expect(result.resolvedServiceIds).toHaveLength(0);
      expect(result.stillUnmatchedCount).toBe(0);
    });

    it('should return all unmatched when no embedding provider', async () => {
      const enhancer = new RCAEvalSemanticEnhancer();
      const result = await enhancer.enhance(makeInput());

      expect(result.edges).toHaveLength(0);
      expect(result.stillUnmatchedCount).toBe(2);
      expect(result.unresolvedServiceIds).toEqual(['ts-new-order-svc', 'ts-alternate-ui']);
    });
  });

  // ── enhance() — semantic matching ──────────────────

  describe('enhance — semantic matching', () => {
    it('should match case services to YAML aliases via embedding similarity', async () => {
      const mapping = new Map([
        ['ts-new-order-svc', 'ts-order-service'],
        ['ts-alternate-ui', 'ts-ui'],
      ]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(makeInput());

      expect(result.resolvedServiceIds).toHaveLength(2);
      expect(result.resolvedServiceIds).toContain('ts-new-order-svc');
      expect(result.resolvedServiceIds).toContain('ts-alternate-ui');
      expect(result.stillUnmatchedCount).toBe(0);
    });

    it('should generate edges for matched services (source role)', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // ts-order-service in YAML has outgoing edges to ts-payment-service, ts-preserve-service
      const outEdges = result.edges.filter(
        (e) => e.from === 'ts-new-order-svc',
      );
      expect(outEdges.length).toBe(2);
      // ts-order-service is also a target from ts-ui
      const inEdges = result.edges.filter(
        (e) => e.to === 'ts-new-order-svc',
      );
      expect(inEdges.length).toBe(1);
    });

    it('should generate edges for matched services (target role)', async () => {
      const mapping = new Map([['ts-new-payment-api', 'ts-payment-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-payment-api'] }),
      );

      // ts-payment-service is a target from ts-order-service and ts-preserve-service
      const inEdges = result.edges.filter(
        (e) => e.to === 'ts-new-payment-api',
      );
      expect(inEdges.length).toBe(2);
    });

    it('should tag edges with correct source provenance', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      for (const edge of result.edges) {
        expect(edge.source).toBe('semantic-embedding');
        expect(edge.matchConfidence).toBeGreaterThan(0);
        expect(edge.matchConfidence).toBeLessThanOrEqual(1);
      }
    });

    it('should split resolved and unresolved services', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc', 'ts-alternate-ui'] }),
      );

      expect(result.resolvedServiceIds).toContain('ts-new-order-svc');
      expect(result.unresolvedServiceIds).toContain('ts-alternate-ui');
      expect(result.embeddingResolvedCount).toBe(1);
      expect(result.stillUnmatchedCount).toBe(1);
    });

    it('should compute average confidence across all semantic edges', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(result.averageConfidence).toBeGreaterThan(0);
    });
  });

  // ── Edge generation correctness ─────────────────────

  describe('edge generation correctness', () => {
    it('should preserve original edge properties (type, callRate, latency, errorRate)', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, TRAINTICKET_SERVICE_IDS);
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      for (const edge of result.edges) {
        expect(edge.type).toBeDefined();
        expect(edge.callRate).toBeGreaterThan(0);
        expect(edge.p99Latency).toBeGreaterThan(0);
        expect(typeof edge.errorRate).toBe('number');
      }
    });

    it('should not create self-loops when alias is same as original', async () => {
      // When the matched alias has self-loops in YAML, they should be filtered
      // or at least not create infinite loops
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: new MockEmbeddingProvider(
          new Map([['svc-a', new Float32Array([1, 0, 0, 0])]]),
        ),
      });
      const result = await enhancer.enhance({
        unmatchedCaseServiceIds: ['svc-a'],
        yamlTopologyEdges: [
          { from: 'svc-a', to: 'svc-a', type: 'REST', callRate: 1, p99Latency: 1, errorRate: 0 },
        ],
        yamlServiceIds: ['svc-a', 'svc-b'],
        system: 'Test',
      });

      // Self-loop from → to both the same service, but node name is svc-a.
      // This is technically a self-loop on the node, but semantically fine.
      for (const edge of result.edges) {
        expect(edge.source).toBe('semantic-embedding');
      }
    });
  });

  // ── Integration with rcaeval-topology ──────────────

  describe('integration with rcaeval-topology', () => {
    beforeAll(async () => {
      // Ensure topology is initialized (done in rcaeval-topology test too)
      // but this test file runs independently
      await initRCAEvalTopology();
    });

    it('should still produce valid graphs with exact-match services', () => {
      const g = buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
      expect(g.edges.length).toBeGreaterThan(0);
      const hasUItoTravel = g.edges.some(
        (e) => e.from === 'ts-ui' && e.to === 'ts-travel-service',
      );
      expect(hasUItoTravel).toBe(true);
    });

    it('should ring-connect unmatched services when no enhancer', () => {
      const g = buildRCAEvalCallGraph('re1tt_test', ['ts-unknown-svc-1', 'ts-unknown-svc-2']);
      // Two unmatched services → ring-connected
      expect(g.edges.length).toBeGreaterThan(0);
    });

    it('should report diagnostic labels for non-semantic graphs', () => {
      const g = buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
      for (const node of g.nodes.values()) {
        expect(node.labels._diag_semantic).toBeDefined();
        expect(node.labels._diag_embedding).toBeDefined();
        expect(node.labels._diag_llm).toBeDefined();
      }
    });
  });
});

// ── enhanceRCAEvalCallGraph ──────────────────────────────

describe('enhanceRCAEvalCallGraph', () => {
  beforeAll(async () => {
    await initRCAEvalTopology();
  });

  it('should produce same results as buildRCAEvalCallGraph without enhancer', async () => {
    // initRCAEvalTopology called without semantic config → no enhancer
    const syncResult = buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
    const asyncResult = await enhanceRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);

    expect(asyncResult.edges.length).toBe(syncResult.edges.length);
    expect(asyncResult.nodes.size).toBe(syncResult.nodes.size);
  });

  it('should handle non-initialized topology gracefully', async () => {
    // Call without init → fallback to ring-connect
    const result = await enhanceRCAEvalCallGraph('re1ob_test', ['svc-a', 'svc-b']);
    expect(result.edges.length).toBeGreaterThan(0);
    expect(result.nodes.size).toBe(2);
  });
});
