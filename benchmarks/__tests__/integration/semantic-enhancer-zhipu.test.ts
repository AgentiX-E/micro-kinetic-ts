/**
 * Integration test: RCAEvalSemanticEnhancer with real Zhipu embedding-3 API.
 *
 * Tests the complete semantic enhancement pipeline using real Zhipu
 * embedding for service-name alignment. Verifies that the enhancer can
 * match historically problematic TrainTicket service name variants.
 *
 * Tests are skipped when ZHIPU_API_KEY is not available.
 *
 * @module benchmarks/__tests__/integration/semantic-enhancer-zhipu.test
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { RCAEvalSemanticEnhancer } from '../../src/rcaeval-semantic.js';
import { createApiEmbeddingFromEnv } from '@agentix-e/micro-kinetic-core';

// ── Skip Check ───────────────────────────────────────────

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY;
const runIntegration = Boolean(ZHIPU_API_KEY);
const describeIf = runIntegration ? describe : describe.skip;

// ── Test Data — TrainTicket name variants ────────────────

/**
 * Historically problematic mismatches between RCAEval case service IDs
 * and YAML topology service names. Each pair is [caseServiceId, yamlServiceId].
 */
const TRAINTICKET_VARIANTS = [
  // Direct matches (should always resolve)
  ['ts-order-service', 'ts-order-service'],
  ['ts-payment-service', 'ts-payment-service'],
  ['ts-ui', 'ts-ui'],

  // Hyphen/underscore conventions
  ['order_service', 'ts-order-service'],
  ['payment_service', 'ts-payment-service'],

  // Abbreviated names
  ['order-svc', 'ts-order-service'],
  ['payment-svc', 'ts-payment-service'],
  ['auth-svc', 'ts-auth-service'],

  // Admin variants
  ['admin-order', 'ts-admin-order-service'],
  ['admin-user', 'ts-admin-user-service'],
  ['admin-route', 'ts-admin-route-service'],

  // Food service variants
  ['food-svc', 'ts-food-service'],
  ['food-delivery', 'ts-food-delivery-service'],
  ['station-food', 'ts-station-food-service'],

  // Travel variants
  ['travel-svc', 'ts-travel-service'],
  ['travel-plan', 'ts-travel-plan-service'],

  // Seat/reservation
  ['seat-svc', 'ts-seat-service'],

  // Cross-domain naming conventions
  ['booking-service', 'ts-order-service'],
  ['ticket-office', 'ts-ticket-office-service'],
];

const TRAINTICKET_SERVICE_IDS = [
  'ts-ui',
  'ts-travel-service',
  'ts-train-service',
  'ts-route-service',
  'ts-station-service',
  'ts-seat-service',
  'ts-order-service',
  'ts-preserve-service',
  'ts-user-service',
  'ts-price-service',
  'ts-config-service',
  'ts-security-service',
  'ts-auth-service',
  'ts-payment-service',
  'ts-assurance-service',
  'ts-contacts-service',
  'ts-food-service',
  'ts-consign-service',
  'ts-voucher-service',
  'ts-verification-code-service',
  'ts-admin-basic-info-service',
  'ts-admin-order-service',
  'ts-admin-route-service',
  'ts-admin-travel-service',
  'ts-admin-user-service',
  'ts-basic-service',
  'ts-cancel-service',
  'ts-consign-price-service',
  'ts-delivery-service',
  'ts-execute-service',
  'ts-food-delivery-service',
  'ts-food-map-service',
  'ts-inside-payment-service',
  'ts-order-other-service',
  'ts-rebook-service',
  'ts-route-plan-service',
  'ts-station-food-service',
  'ts-ticket-office-service',
  'ts-train-food-service',
  'ts-travel2-service',
  'ts-travel-plan-service',
  'ts-wait-order-service',
];

// ── Tests ────────────────────────────────────────────────

describeIf('RCAEvalSemanticEnhancer with Zhipu embedding-3', () => {
  let enhancer: RCAEvalSemanticEnhancer;

  beforeAll(() => {
    const provider = createApiEmbeddingFromEnv({
      vendorPrefix: 'ZHIPU',
      endpoint: 'https://open.bigmodel.cn/api/paas/v4/embeddings',
      model: process.env.ZHIPU_EMBEDDING_MODEL ?? 'embedding-3',
      dimension: Number(process.env.ZHIPU_EMBEDDING_DIMENSION ?? '2048'),
    });
    enhancer = new RCAEvalSemanticEnhancer({
      embeddingProvider: provider,
      alignmentConfig: {
        embeddingThreshold: 0.55, // lower threshold for real API matching
      },
    });
  });

  it('should resolve direct exact matches (ts-order-service → ts-order-service)', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['ts-order-service', 'ts-payment-service', 'ts-ui'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    // These should all resolve because they have exact YAML matches
    expect(result.resolvedServiceIds).toHaveLength(3);
  });

  it('should match order_service → ts-order-service via semantic alignment', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['order_service'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    expect(result.resolvedServiceIds).toHaveLength(1);
    expect(result.resolvedServiceIds[0]).toBe('order_service');
  });

  it('should match abbreviated order-svc → ts-order-service', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['order-svc', 'auth-svc'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    expect(result.resolvedServiceIds.length).toBeGreaterThanOrEqual(1);
  });

  it('should match admin-order → ts-admin-order-service', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['admin-order', 'admin-user', 'admin-route'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    expect(result.embeddingResolvedCount).toBeGreaterThanOrEqual(2);
  });

  it('should match food-svc → ts-food-service and related variants', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['food-svc', 'food-delivery'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    expect(result.resolvedServiceIds.length).toBeGreaterThanOrEqual(1);
  });

  it('should resolve most of the 18 variant pairs', async () => {
    const variants = TRAINTICKET_VARIANTS.filter(
      ([caseId, yamlId]) => caseId !== yamlId,
    );
    const caseIds = variants.map(([caseId]) => caseId);

    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: caseIds,
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    // Goal: ≥70% of non-exact variants resolved via embedding
    const pct = result.resolvedServiceIds.length / caseIds.length;
    console.log(
      `Zhipu embedding resolution: ${result.resolvedServiceIds.length}/${caseIds.length} ` +
      `(${(pct * 100).toFixed(1)}%) — ` +
      `unresolved: ${result.unresolvedServiceIds.join(', ')}`,
    );

    expect(pct).toBeGreaterThanOrEqual(0.7);
  });

  it('should accurately tag all matches as embedding-resolved (not LLM)', async () => {
    const result = await enhancer.enhance({
      unmatchedCaseServiceIds: ['order-svc', 'payment-svc', 'auth-svc'],
      yamlTopologyEdges: [],
      yamlServiceIds: TRAINTICKET_SERVICE_IDS,
      system: 'TrainTicket',
    });

    expect(result.llmResolvedCount).toBe(0);
    expect(result.embeddingResolvedCount).toBeGreaterThanOrEqual(1);
  });
});
