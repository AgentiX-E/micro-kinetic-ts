/**
 * Unit tests for RCAEval topology builder (identifyBenchmarkSystem).
 *
 * Verifies correct system identification for all 9 suite-system combinations
 * (RE1×{ob,ss,tt}, RE2×{ob,ss,tt}, RE3×{ob,ss,tt}).
 *
 * NOTE: This test file lives in benchmarks/__tests__/ because the topology
 * builder is part of the benchmarks package, not the kinetic package.
 *
 * @module benchmarks/__tests__/rcaeval-topology.test
 */

import { describe, it, expect } from 'vitest';
import { buildRCAEvalCallGraph } from '../src/rcaeval-topology.js';

// ── System Identification (full 3×3 matrix) ──────────────

describe('buildRCAEvalCallGraph — System Identification', () => {
  // RE1 cases
  it('re1ob_* → OnlineBoutique', () => {
    const g = buildRCAEvalCallGraph('re1ob_adservice_cpu_1', ['adservice', 'frontend', 'cartservice']);
    expect(g.nodes.get('adservice')?.labels._diag_system).toBe('OnlineBoutique');
    expect(g.edges.length).toBeGreaterThan(0);
  });

  it('re1ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re1ss_carts_cpu_1', ['front-end', 'carts']);
    expect(g.nodes.get('carts')?.labels._diag_system).toBe('SockShop');
  });

  it('re1tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re1tt_ts-ui_cpu_1', ['ts-ui', 'ts-travel-service']);
    expect(g.nodes.get('ts-ui')?.labels._diag_system).toBe('TrainTicket');
  });

  // RE2 cases (was bug: forced to SockShop)
  it('re2ob_* → OnlineBoutique (was forced to SockShop before fix)', () => {
    const g = buildRCAEvalCallGraph('re2ob_cartservice_cpu_1', ['frontend', 'cartservice', 'checkoutservice']);
    expect(g.nodes.get('cartservice')?.labels._diag_system).toBe('OnlineBoutique');
    // Verify OB-specific edges exist
    const hasCheckoutCart = g.edges.some(
      (e) => e.from === 'checkoutservice' && e.to === 'cartservice',
    );
    expect(hasCheckoutCart).toBe(true);
  });

  it('re2ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re2ss_orders_delay_1', ['orders', 'payment', 'shipping']);
    expect(g.nodes.get('orders')?.labels._diag_system).toBe('SockShop');
  });

  it('re2tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re2tt_ts-order-service_mem_1', ['ts-order-service', 'ts-payment-service']);
    expect(g.nodes.get('ts-order-service')?.labels._diag_system).toBe('TrainTicket');
  });

  // RE3 cases (was bug: forced to TrainTicket)
  it('re3ob_* → OnlineBoutique (was forced to TrainTicket before fix)', () => {
    const g = buildRCAEvalCallGraph('re3ob_paymentservice_mem_1', ['checkoutservice', 'paymentservice']);
    expect(g.nodes.get('checkoutservice')?.labels._diag_system).toBe('OnlineBoutique');
  });

  it('re3ss_* → SockShop', () => {
    const g = buildRCAEvalCallGraph('re3ss_catalogue_mem_1', ['catalogue', 'catalogue-db']);
    expect(g.nodes.get('catalogue')?.labels._diag_system).toBe('SockShop');
  });

  it('re3tt_* → TrainTicket', () => {
    const g = buildRCAEvalCallGraph('re3tt_ts-preserve-service_disk_1', ['ts-preserve-service', 'ts-seat-service']);
    expect(g.nodes.get('ts-seat-service')?.labels._diag_system).toBe('TrainTicket');
  });
});

// ── Edge cases ────────────────────────────────────────────

describe('buildRCAEvalCallGraph — Edge Cases', () => {
  it('should ring-connect unknown systems', () => {
    const g = buildRCAEvalCallGraph('unknown_case_1', ['svc_a', 'svc_b', 'svc_c']);
    expect(g.edges.length).toBe(3);
  });

  it('should handle no-match benchmark with single service', () => {
    const g = buildRCAEvalCallGraph('mystery_system', ['lone_svc']);
    expect(g.nodes.size).toBe(1);
    expect(g.edges.length).toBe(1);
  });

  it('should handle empty service list', () => {
    const g = buildRCAEvalCallGraph('re1ob_empty', []);
    expect(g.nodes.size).toBe(0);
    expect(g.edges.length).toBe(0);
  });

  it('should set correct diagnostic labels', () => {
    const g = buildRCAEvalCallGraph('re2ob_diag_test', ['frontend', 'cartservice']);
    for (const node of g.nodes.values()) {
      expect(node.labels._diag_system).toBe('OnlineBoutique');
      expect(node.labels._diag_matched).toBeDefined();
    }
  });
});
