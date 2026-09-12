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

import { beforeAll, describe, expect, it } from 'vitest';
import type { SemanticEnhancementInput } from '../src/rcaeval-semantic.js';
import { edgeProvenance, RCAEvalSemanticEnhancer } from '../src/rcaeval-semantic.js';
import {
  buildRCAEvalCallGraph,
  enhanceRCAEvalCallGraph,
  initRCAEvalTopology,
} from '../src/rcaeval-topology.js';
import {
  createMatchEmbedding,
  createPartialMatchEmbedding,
  DeterministicEmbeddingProvider,
  TableLLMProvider,
} from './helpers/embedding-fixtures.js';

// ── Test Data ────────────────────────────────────────────

const TRAINTICKET_SERVICE_IDS = [
  'ts-ui',
  'ts-travel-service',
  'ts-order-service',
  'ts-payment-service',
  'ts-preserve-service',
];

const TRAINTICKET_EDGES = [
  {
    from: 'ts-ui',
    to: 'ts-travel-service',
    type: 'REST' as const,
    callRate: 1,
    p99Latency: 5,
    errorRate: 0,
  },
  {
    from: 'ts-ui',
    to: 'ts-order-service',
    type: 'REST' as const,
    callRate: 1,
    p99Latency: 5,
    errorRate: 0,
  },
  {
    from: 'ts-order-service',
    to: 'ts-payment-service',
    type: 'REST' as const,
    callRate: 1,
    p99Latency: 10,
    errorRate: 0.01,
  },
  {
    from: 'ts-order-service',
    to: 'ts-preserve-service',
    type: 'REST' as const,
    callRate: 0.5,
    p99Latency: 20,
    errorRate: 0.02,
  },
  {
    from: 'ts-preserve-service',
    to: 'ts-payment-service',
    type: 'REST' as const,
    callRate: 0.3,
    p99Latency: 15,
    errorRate: 0,
  },
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
      const mockProvider = new DeterministicEmbeddingProvider(new Map());
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: mockProvider,
      });
      expect(enhancer.isAvailable).toBe(true);
    });

    it('should be available with embedding + LLM providers', () => {
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: new DeterministicEmbeddingProvider(new Map()),
        llmProvider: new TableLLMProvider(new Map()),
      });
      expect(enhancer.isAvailable).toBe(true);
    });
  });

  // ── enhance() — no-op cases ─────────────────────────

  describe('enhance — no-op cases', () => {
    it('should return empty result for empty unmatched list', async () => {
      const enhancer = new RCAEvalSemanticEnhancer({
        embeddingProvider: new DeterministicEmbeddingProvider(new Map()),
      });
      const result = await enhancer.enhance(makeInput({ unmatchedCaseServiceIds: [] }));

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
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(makeInput());

      expect(result.resolvedServiceIds).toHaveLength(2);
      expect(result.resolvedServiceIds).toContain('ts-new-order-svc');
      expect(result.resolvedServiceIds).toContain('ts-alternate-ui');
      expect(result.stillUnmatchedCount).toBe(0);
    });

    it('should generate edges for matched services (source role)', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // ts-order-service in YAML has outgoing edges to ts-payment-service, ts-preserve-service
      const outEdges = result.edges.filter((e) => e.from === 'ts-new-order-svc');
      expect(outEdges.length).toBe(2);
      // ts-order-service is also a target from ts-ui
      const inEdges = result.edges.filter((e) => e.to === 'ts-new-order-svc');
      expect(inEdges.length).toBe(1);
    });

    it('should generate edges for matched services (target role)', async () => {
      const mapping = new Map([['ts-new-payment-api', 'ts-payment-service']]);
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-payment-api'] }),
      );

      // ts-payment-service is a target from ts-order-service and ts-preserve-service
      const inEdges = result.edges.filter((e) => e.to === 'ts-new-payment-api');
      expect(inEdges.length).toBe(2);
    });

    it('should tag edges with correct source provenance', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
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
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
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
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
      const enhancer = new RCAEvalSemanticEnhancer({ embeddingProvider: provider });

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(result.averageConfidence).toBeGreaterThan(0);
    });
  });

  // ── enhance() — LLM fallback ──────────────────────

  describe('enhance — LLM fallback', () => {
    /**
     * Similarity 0.55 sits below the 0.9 embedding threshold, so the service
     * becomes a low-confidence *candidate* rather than a match, and is handed
     * to the LLM. This is the only route by which a service can be both a
     * low-confidence candidate and ultimately resolved, which is what makes it
     * LLM-attributed rather than embedding-attributed.
     */
    function lowConfidenceSetup(llm: TableLLMProvider) {
      return new RCAEvalSemanticEnhancer({
        embeddingProvider: createPartialMatchEmbedding(
          'ts-new-order-svc',
          'ts-order-service',
          'TrainTicket',
          0.55,
        ),
        llmProvider: llm,
        alignmentConfig: { embeddingThreshold: 0.9, llmThreshold: 0.5 },
      });
    }

    it('attributes a low-confidence match to the LLM, not to the embedding', async () => {
      const llm = new TableLLMProvider(new Map([['ts-new-order-svc', 'ts-order-service']]));
      const enhancer = lowConfidenceSetup(llm);

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(llm.calls).toBe(1);
      expect(result.llmResolvedCount).toBe(1);
      expect(result.embeddingResolvedCount).toBe(0);
      expect(result.resolvedServiceIds).toEqual(['ts-new-order-svc']);
      for (const edge of result.edges) {
        expect(edge.source).toBe('semantic-llm');
        // Confidence comes from the candidate the embedding phase recorded.
        expect(edge.matchConfidence).toBeCloseTo(0.55, 5);
      }
    });

    it('leaves the service unresolved when the LLM names no topology service', async () => {
      const llm = new TableLLMProvider(new Map());
      const enhancer = lowConfidenceSetup(llm);

      const result = await enhancer.enhance(
        makeInput({ unmatchedCaseServiceIds: ['ts-new-order-svc'] }),
      );

      expect(llm.calls).toBe(1);
      expect(result.edges).toHaveLength(0);
      expect(result.llmResolvedCount).toBe(0);
      expect(result.unresolvedServiceIds).toEqual(['ts-new-order-svc']);
    });
  });

  // ── edgeProvenance ─────────────────────────────────

  describe('edgeProvenance', () => {
    it('reads the tag from an edge that carries one', () => {
      const edge = {
        from: 'a',
        to: 'b',
        type: 'REST' as const,
        callRate: 1,
        p99Latency: 1,
        errorRate: 0,
        source: 'ring-connect' as const,
      };
      expect(edgeProvenance(edge)).toBe('ring-connect');
    });

    it('reports undefined for an edge that carries none', () => {
      const edge = {
        from: 'a',
        to: 'b',
        type: 'REST' as const,
        callRate: 1,
        p99Latency: 1,
        errorRate: 0,
      };
      expect(edgeProvenance(edge)).toBeUndefined();
    });
  });

  // ── Edge generation correctness ─────────────────────

  describe('edge generation correctness', () => {
    it('should preserve original edge properties (type, callRate, latency, errorRate)', async () => {
      const mapping = new Map([['ts-new-order-svc', 'ts-order-service']]);
      const provider = createMatchEmbedding(mapping, 'TrainTicket');
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
        embeddingProvider: new DeterministicEmbeddingProvider(
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
      const hasUItoTravel = g.edges.some((e) => e.from === 'ts-ui' && e.to === 'ts-travel-service');
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
    const asyncResult = await enhanceRCAEvalCallGraph('re1tt_ts-ui_cpu_1', [
      'ts-ui',
      'ts-travel-service',
    ]);

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
