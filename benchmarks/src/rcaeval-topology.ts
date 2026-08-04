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
 * TrainTicket call graph (41 microservices).
 *
 * Architecture: https://github.com/FudanSELab/train-ticket
 *
 * The system is a train ticket booking platform with three layers:
 *   UI Layer: ts-ui (web frontend)
 *   Gateway Layer: ts-gateway (API gateway, auth, routing)
 *   Business Layer: ~35 domain services + admin services
 *
 * Key dependency patterns:
 *   ts-ui → ALL business services (via gateway)
 *   ts-order-service → ts-travel-service, ts-price-service, etc.
 *   ts-admin-* → ts-auth, ts-user-service (authorized access)
 *   ts-preserve-service → ts-seat-service, ts-train-service
 *   Infrastructure: ts-verification-code, ts-voucher, ts-consign, etc.
 */
const TRAINTICKET_EDGES: ReadonlyArray<[string, string]> = [
  // ── UI → Core business services ─────────────────────────
  ['ts-ui', 'ts-travel-service'],
  ['ts-ui', 'ts-train-service'],
  ['ts-ui', 'ts-route-service'],
  ['ts-ui', 'ts-station-service'],
  ['ts-ui', 'ts-seat-service'],
  ['ts-ui', 'ts-order-service'],
  ['ts-ui', 'ts-preserve-service'],
  ['ts-ui', 'ts-user-service'],
  ['ts-ui', 'ts-price-service'],
  ['ts-ui', 'ts-config-service'],
  ['ts-ui', 'ts-security-service'],
  ['ts-ui', 'ts-auth-service'],
  ['ts-ui', 'ts-payment-service'],
  ['ts-ui', 'ts-assurance-service'],
  ['ts-ui', 'ts-contacts-service'],
  ['ts-ui', 'ts-food-service'],
  ['ts-ui', 'ts-consign-service'],
  ['ts-ui', 'ts-voucher-service'],
  ['ts-ui', 'ts-verification-code-service'],
  ['ts-ui', 'ts-basic-service'],
  ['ts-ui', 'ts-cancel-service'],
  ['ts-ui', 'ts-rebook-service'],
  ['ts-ui', 'ts-execute-service'],
  ['ts-ui', 'ts-travel2-service'],
  ['ts-ui', 'ts-route-plan-service'],
  ['ts-ui', 'ts-travel-plan-service'],
  ['ts-ui', 'ts-ticket-office-service'],
  ['ts-ui', 'ts-inside-payment-service'],
  ['ts-ui', 'ts-order-other-service'],
  ['ts-ui', 'ts-wait-order-service'],
  ['ts-ui', 'ts-food-map-service'],
  ['ts-ui', 'ts-train-food-service'],
  ['ts-ui', 'ts-station-food-service'],
  ['ts-ui', 'ts-food-delivery-service'],
  ['ts-ui', 'ts-consign-price-service'],
  ['ts-ui', 'ts-delivery-service'],
  // ── Admin services → auth + target ─────────────────────
  ['ts-admin-basic-info-service', 'ts-auth-service'],
  ['ts-admin-basic-info-service', 'ts-basic-service'],
  ['ts-admin-order-service', 'ts-auth-service'],
  ['ts-admin-order-service', 'ts-order-service'],
  ['ts-admin-route-service', 'ts-auth-service'],
  ['ts-admin-route-service', 'ts-route-service'],
  ['ts-admin-travel-service', 'ts-auth-service'],
  ['ts-admin-travel-service', 'ts-travel-service'],
  ['ts-admin-user-service', 'ts-auth-service'],
  ['ts-admin-user-service', 'ts-user-service'],
  // ── Order flow ──────────────────────────────────────────
  ['ts-order-service', 'ts-travel-service'],
  ['ts-order-service', 'ts-user-service'],
  ['ts-order-service', 'ts-price-service'],
  ['ts-order-service', 'ts-station-service'],
  ['ts-order-service', 'ts-assurance-service'],
  ['ts-order-service', 'ts-payment-service'],
  // ── Preserve/booking flow ───────────────────────────────
  ['ts-preserve-service', 'ts-train-service'],
  ['ts-preserve-service', 'ts-route-service'],
  ['ts-preserve-service', 'ts-travel-service'],
  ['ts-preserve-service', 'ts-seat-service'],
  ['ts-preserve-service', 'ts-station-service'],
  ['ts-preserve-service', 'ts-price-service'],
  // ── Travel/Train/Route interdependency ──────────────────
  ['ts-travel-service', 'ts-train-service'],
  ['ts-travel-service', 'ts-route-service'],
  ['ts-travel-service', 'ts-station-service'],
  ['ts-train-service', 'ts-route-service'],
  ['ts-train-service', 'ts-station-service'],
  ['ts-travel2-service', 'ts-train-service'],
  ['ts-travel2-service', 'ts-route-service'],
  ['ts-travel2-service', 'ts-station-service'],
  // ── Food delivery chain ────────────────────────────────
  ['ts-food-service', 'ts-station-food-service'],
  ['ts-food-service', 'ts-train-food-service'],
  ['ts-food-service', 'ts-food-delivery-service'],
  ['ts-food-map-service', 'ts-station-food-service'],
  ['ts-food-map-service', 'ts-train-food-service'],
  // ── Consign/delivery chain ──────────────────────────────
  ['ts-consign-service', 'ts-consign-price-service'],
  ['ts-consign-service', 'ts-delivery-service'],
  // ── Payment chain ───────────────────────────────────────
  ['ts-payment-service', 'ts-inside-payment-service'],
  ['ts-payment-service', 'ts-voucher-service'],
  // ── Supporting services ─────────────────────────────────
  ['ts-execute-service', 'ts-order-service'],
  ['ts-cancel-service', 'ts-order-service'],
  ['ts-cancel-service', 'ts-payment-service'],
  ['ts-rebook-service', 'ts-order-service'],
  ['ts-rebook-service', 'ts-travel-service'],
  ['ts-route-plan-service', 'ts-route-service'],
  ['ts-route-plan-service', 'ts-train-service'],
  ['ts-travel-plan-service', 'ts-travel-service'],
  ['ts-travel-plan-service', 'ts-train-service'],
  ['ts-ticket-office-service', 'ts-order-service'],
  ['ts-ticket-office-service', 'ts-seat-service'],
  ['ts-order-other-service', 'ts-order-service'],
  ['ts-wait-order-service', 'ts-order-service'],
  ['ts-wait-order-service', 'ts-seat-service'],
  // ── Infrastructure → auth, config ──────────────────────
  ['ts-contacts-service', 'ts-user-service'],
  ['ts-assurance-service', 'ts-order-service'],
  ['ts-verification-code-service', 'ts-user-service'],
  ['ts-voucher-service', 'ts-order-service'],
  ['ts-basic-service', 'ts-config-service'],
  ['ts-config-service', 'ts-station-service'],
];

// ── Benchmark System Identification ───────────────────────

/** Map case ID prefix to benchmark system name. */
function identifyBenchmarkSystem(caseId: string): 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | null {
  const lower = caseId.toLowerCase();
  // Case IDs from RCAEvalLoader: re1ob, re2ss, re3tt (benchmark prefix only)
  // Also handle full dir names: re1ob_adservice_cpu_1, re2ss_carts_cpu_3, etc.
  if (lower.startsWith('re1ob') || lower.includes('_ob_') || (lower.includes('ob') && !lower.includes('ss') && !lower.includes('tt'))) return 'OnlineBoutique';
  if (lower.startsWith('re2ss') || lower.includes('_ss_') || (lower.includes('ss') && !lower.includes('ob') && !lower.includes('tt'))) return 'SockShop';
  if (lower.startsWith('re3tt') || lower.includes('_tt_') || (lower.includes('tt') && !lower.includes('ob') && !lower.includes('ss'))) return 'TrainTicket';
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
  let matchedEdgeCount = 0;

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
      matchedEdgeCount++;
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
    edges.push({
      from: serviceIds[0]!,
      to: serviceIds[0]!,
      type: 'INTERNAL',
      callRate: 1,
      p99Latency: 1,
      errorRate: 0,
    });
  }

  // ── Topology match diagnostics ─────────────────────────
  // Store matching stats for service name alignment audit
  const topologySvcNames = new Set<string>();
  for (const [f, t] of edgeMap) { topologySvcNames.add(f); topologySvcNames.add(t); }
  const matchedSvcCount = serviceIds.filter((s) => topologySvcNames.has(s)).length;

  for (const node of nodes.values()) {
    node.labels = {
      ...node.labels,
      '_diag_case': caseId,
      '_diag_system': system ?? 'unknown',
      '_diag_matched': String(matchedEdgeCount) + '/' + String(edgeMap.length),
      '_diag_svc_matched': String(matchedSvcCount) + '/' + String(serviceIds.length),
      '_diag_unconnected': String(unconnected.length),
    };
  }

  return { nodes, edges, systemLoad: 0.5 };
}
