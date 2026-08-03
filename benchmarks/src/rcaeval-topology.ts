/**
 * RCAEval benchmark system call graph definitions.
 *
 * Each RCAEval case belongs to one of three benchmark systems:
 * - OnlineBoutique (ob): Google Cloud microservices demo, ~10 services
 * - SockShop (ss): Weaveworks Sock Shop demo, ~11 services
 * - TrainTicket (tt): Fudan Train Ticket demo, ~40 services
 *
 * Call graphs are defined per the published architecture diagrams
 * of each system. The RCAEval dataset does not include topology
 * information per-case, so we reconstruct it from known service
 * dependencies.
 *
 * @module benchmarks/rcaeval-topology
 */

import type { ServiceCallGraph, ServiceNode, CallEdge } from '@agentix-e/micro-kinetic-core';

// ── OnlineBoutique (Google Cloud microservices-demo) ──────

/**
 * OnlineBoutique call graph.
 *
 * Architecture: https://github.com/GoogleCloudPlatform/microservices-demo
 *
 * Key dependencies:
 *   frontend → cartservice, checkoutservice, adservice, currencyservice,
 *              productcatalogservice, recommendationservice, shippingservice
 *   checkoutservice → cartservice, currencyservice, emailservice,
 *                     paymentservice, shippingservice
 *   recommendationservice → productcatalogservice
 */
const ONLINEBOUTIQUE_EDGES: ReadonlyArray<[string, string]> = [
  ['frontend', 'adservice'],
  ['frontend', 'cartservice'],
  ['frontend', 'checkoutservice'],
  ['frontend', 'currencyservice'],
  ['frontend', 'productcatalogservice'],
  ['frontend', 'recommendationservice'],
  ['frontend', 'shippingservice'],
  ['checkoutservice', 'cartservice'],
  ['checkoutservice', 'currencyservice'],
  ['checkoutservice', 'emailservice'],
  ['checkoutservice', 'paymentservice'],
  ['checkoutservice', 'shippingservice'],
  ['recommendationservice', 'productcatalogservice'],
];

// ── SockShop (Weaveworks microservices-demo) ──────────────

/**
 * SockShop call graph.
 *
 * Architecture: https://microservices-demo.github.io/
 *
 * Key dependencies:
 *   front-end → catalogue, carts, orders, user
 *   orders → payment, shipping, queue-master, carts
 *   carts → catalogue
 *   payment → (external payment gateway)
 */
const SOCKSHOP_EDGES: ReadonlyArray<[string, string]> = [
  ['front-end', 'catalogue'],
  ['front-end', 'carts'],
  ['front-end', 'orders'],
  ['front-end', 'user'],
  ['orders', 'payment'],
  ['orders', 'shipping'],
  ['orders', 'queue-master'],
  ['orders', 'carts'],
  ['carts', 'catalogue'],
  ['catalogue', 'catalogue-db'],
  ['user', 'user-db'],
  ['carts', 'carts-db'],
  ['orders', 'orders-db'],
];

// ── TrainTicket (Fudan microservices benchmark) ───────────

/**
 * TrainTicket call graph (subset of key services).
 *
 * Architecture: https://github.com/FudanSELab/train-ticket
 *
 * Key dependencies:
 *   ts-ui → ts-travel-service, ts-train-service, ts-route-service,
 *           ts-preserve-service, ts-order-service, ts-user-service,
 *           ts-price-service, ts-station-service
 *   ts-travel-service → ts-train-service, ts-route-service, ts-station-service
 *   ts-order-service → ts-travel-service, ts-user-service, ts-price-service
 *   ts-preserve-service → ts-train-service, ts-route-service, ts-travel-service
 */
const TRAINTICKET_EDGES: ReadonlyArray<[string, string]> = [
  ['ts-ui', 'ts-travel-service'],
  ['ts-ui', 'ts-train-service'],
  ['ts-ui', 'ts-route-service'],
  ['ts-ui', 'ts-preserve-service'],
  ['ts-ui', 'ts-order-service'],
  ['ts-ui', 'ts-user-service'],
  ['ts-ui', 'ts-price-service'],
  ['ts-ui', 'ts-station-service'],
  ['ts-ui', 'ts-seat-service'],
  ['ts-ui', 'ts-config-service'],
  ['ts-ui', 'ts-security-service'],
  ['ts-travel-service', 'ts-train-service'],
  ['ts-travel-service', 'ts-route-service'],
  ['ts-travel-service', 'ts-station-service'],
  ['ts-order-service', 'ts-travel-service'],
  ['ts-order-service', 'ts-user-service'],
  ['ts-order-service', 'ts-price-service'],
  ['ts-preserve-service', 'ts-train-service'],
  ['ts-preserve-service', 'ts-route-service'],
  ['ts-preserve-service', 'ts-travel-service'],
  ['ts-preserve-service', 'ts-seat-service'],
  ['ts-train-service', 'ts-route-service'],
  ['ts-train-service', 'ts-station-service'],
];

// ── Benchmark System Identification ───────────────────────

/** Map case ID prefix to benchmark system name. */
function identifyBenchmarkSystem(caseId: string): 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | null {
  const lower = caseId.toLowerCase();
  // Case IDs: re1ob_, re2ss_ss_carts, re3tt_, etc.
  if (lower.includes('_ob_') || lower.includes('ob_') && !lower.includes('_ss_') && !lower.includes('_tt_')) return 'OnlineBoutique';
  if (lower.includes('_ss_') || lower.includes('ss_')) return 'SockShop';
  if (lower.includes('_tt_') || lower.includes('tt_')) return 'TrainTicket';
  return null;
}

// ── Call Graph Builder ────────────────────────────────────

/**
 * Build the correct call graph for a benchmark case.
 *
 * Matches service IDs found in the case metrics to the known
 * benchmark topology. Services present in the case but not in
 * the topology get ring-connected edges to ensure the engine
 * can process them.
 *
 * @param caseId - RCAEval case identifier (e.g., re1ob_adservice_cpu_1)
 * @param serviceIds - Service IDs found in the case metrics
 * @returns ServiceCallGraph with real topology edges where known
 */
export function buildRCAEvalCallGraph(
  caseId: string,
  serviceIds: readonly string[],
): ServiceCallGraph {
  const system = identifyBenchmarkSystem(caseId);
  let edgeMap: ReadonlyArray<[string, string]> = [];

  if (system === 'OnlineBoutique') edgeMap = ONLINEBOUTIQUE_EDGES;
  else if (system === 'SockShop') edgeMap = SOCKSHOP_EDGES;
  else if (system === 'TrainTicket') edgeMap = TRAINTICKET_EDGES;

  const nodes = new Map<string, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: id, namespace: system ?? 'rca-eval', labels: {} });
  }

  const svcSet = new Set(serviceIds);
  const connectedSvcs = new Set<string>();
  const edges: CallEdge[] = [];

  // Add known topology edges (only if both services are in the case)
  for (const [from, to] of edgeMap) {
    if (svcSet.has(from) && svcSet.has(to)) {
      edges.push({
        from,
        to,
        type: 'REST',
        callRate: 100,
        p99Latency: 50,
        errorRate: 0.01,
      });
      connectedSvcs.add(from);
      connectedSvcs.add(to);
    }
  }

  // Ring-connect any services not covered by the known topology
  // so the engine always has at least one edge per service
  const unconnected = serviceIds.filter((s) => !connectedSvcs.has(s));

  if (unconnected.length === 1 && edges.length > 0) {
    // Single unconnected service: connect to first known service
    const firstConnected = [...connectedSvcs][0]!;
    edges.push({
      from: firstConnected,
      to: unconnected[0]!,
      type: 'INTERNAL',
      callRate: 1,
      p99Latency: 1,
      errorRate: 0,
    });
  } else if (unconnected.length > 1) {
    for (let i = 0; i < unconnected.length; i++) {
      const next = (i + 1) % unconnected.length;
      edges.push({
        from: unconnected[i]!,
        to: unconnected[next]!,
        type: 'INTERNAL',
        callRate: 1,
        p99Latency: 1,
        errorRate: 0,
      });
    }
    if (edges.length === unconnected.length && edges.length > 1) {
      // All services are unconnected — still need at least one edge per service
      // This is already satisfied by the ring above
    }
  } else if (edges.length === 0 && serviceIds.length > 0) {
    // No topology matches at all — fallback to ring
    edges.push({
      from: serviceIds[0]!,
      to: serviceIds[0]!,
      type: 'INTERNAL',
      callRate: 1,
      p99Latency: 1,
      errorRate: 0,
    });
  }

  return { nodes, edges, systemLoad: 0.5 };
}
