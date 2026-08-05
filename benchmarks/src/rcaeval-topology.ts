/**
 * RCAEval topology adapter — bridges the YAML-driven topology system
 * into the benchmark pipeline.
 *
 * Replaces the hardcoded TypeScript edge arrays (ONLINEBOUTIQUE_EDGES,
 * SOCKSHOP_EDGES, TRAINTICKET_EDGES) with YAML config files loaded
 * through StaticTopologyProvider.
 *
 * Architecture:
 *   1. initRCAEvalTopology() — loads all YAML configs once (async)
 *   2. buildRCAEvalCallGraph() — sync lookup into pre-loaded registry
 *   3. Fallback: ring-connect for unmatched services ensures engine completeness
 *
 * The topology registry is globally cached after initialization so each
 * benchmark call is a fast O(1) map lookup — no file I/O on the hot path.
 *
 * @module benchmarks/rcaeval-topology
 */

import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ServiceCallGraph,
  ServiceNode,
  CallEdge,
  ServiceId,
} from '@agentix-e/micro-kinetic-core';
import { StaticTopologyProvider } from '@agentix-e/micro-kinetic-causal';

// ── Topology Registry ─────────────────────────────────────

/**
 * System name → pre-loaded topology graph.
 *
 * Each entry is the full static topology for a benchmark system
 * (OnlineBoutique, SockShop, TrainTicket). At query time, we
 * filter edges to only include services present in the current case.
 */
interface TopologyRegistry {
  /** System name → pre-loaded topology edges (full set, unfiltered by case). */
  readonly edgeMaps: ReadonlyMap<string, readonly CallEdge[]>;
  readonly initialized: boolean;
}

let _registry: TopologyRegistry = {
  edgeMaps: new Map(),
  initialized: false,
};

/**
 * Path to topology config directory relative to the project root.
 */
const TOPOLOGY_CONFIG_DIR = 'configs/topology';

// ── System Name Mapping ──────────────────────────────────

/**
 * Map RCAEval case system codes to topology config file names.
 *
 * The system code is extracted from case IDs (e.g., "re1ob_..." → "ob").
 *
 * Case IDs use: ob, ss, tt
 * Config files: onlineboutique.yaml, sockshop.yaml, trainticket.yaml
 */
const SYSTEM_TO_CONFIG_FILE: Readonly<Record<string, string>> = {
  'ob': 'onlineboutique.yaml',
  'OnlineBoutique': 'onlineboutique.yaml',
  'ss': 'sockshop.yaml',
  'SockShop': 'sockshop.yaml',
  'tt': 'trainticket.yaml',
  'TrainTicket': 'trainticket.yaml',
};

const SYSTEM_CODE_TO_NAME: Readonly<Record<string, string>> = {
  'ob': 'OnlineBoutique',
  'ss': 'SockShop',
  'tt': 'TrainTicket',
};

// ── System Identification ─────────────────────────────────

/**
 * Map case ID to benchmark system name.
 *
 * The system code (ob/ss/tt) is independent of the suite number (RE1/RE2/RE3).
 * Each suite has cases from all three benchmark systems. The naming convention is:
 *   re{suite_number}{system_code}_{service}_{fault}_{instance}
 *
 * We extract the system code from position: re{N}{SYS}...
 */
export function identifyBenchmarkSystem(
  caseId: string,
): 'OnlineBoutique' | 'SockShop' | 'TrainTicket' | null {
  const lower = caseId.toLowerCase();
  const sysMatch = lower.match(/^re\d(ob|ss|tt)/);
  if (sysMatch) {
    const sysCode = sysMatch[1]!;
    return (SYSTEM_CODE_TO_NAME[sysCode] as
      | 'OnlineBoutique'
      | 'SockShop'
      | 'TrainTicket'
      | undefined) ?? null;
  }

  // Fallback heuristic for non-standard naming
  if (lower.includes('_ob_'))
    return 'OnlineBoutique';
  if (lower.includes('_ss_'))
    return 'SockShop';
  if (lower.includes('_tt_'))
    return 'TrainTicket';
  return null;
}

// ── Initialization ───────────────────────────────────────

/**
 * Initialize the RCAEval topology registry from YAML config files.
 *
 * Must be called once before `buildRCAEvalCallGraph()`. Loads all three
 * system configs in parallel and caches the parsed graphs.
 *
 * Uses StaticTopologyProvider (built-in minimal YAML parser) — no external
 * YAML dependencies.
 *
 * @param configDir - Path to topology config directory (default: "configs/topology").
 *                    Resolved relative to the project root (via source file location).
 */
export async function initRCAEvalTopology(
  configDir: string = TOPOLOGY_CONFIG_DIR,
): Promise<void> {
  if (_registry.initialized) return;

  // Resolve relative to project root (this file lives in benchmarks/src/)
  const __sourceDir = dirname(fileURLToPath(import.meta.url));
  const configPath = resolve(__sourceDir, '..', '..', configDir);
  const provider = new StaticTopologyProvider(configPath);

  // Load all three system configs
  // We need to pre-load the full edge set. StaticTopologyProvider.discover()
  // filters edges by knownServiceIds, so we must pass a comprehensive list.
  // Strategy: discover with namespace=system + a large sentinel list of all
  // possible service IDs. The provider matches by case-insensitive overlap.
  // For benchmark usage, the YAML service IDs ARE the service names used in
  // cases (same naming convention). So we pass ALL service IDs from the YAML
  // and get back the full topology.

  // Actually, simpler: just read the YAML edges directly and bypass filtering.
  // We use the provider only for its YAML parsing; we cache the full edge arrays
  // independently so buildRCAEvalCallGraph can filter at case-level.

  const systems = ['OnlineBoutique', 'SockShop', 'TrainTicket'] as const;
  const edgeMaps = new Map<string, readonly CallEdge[]>();

  for (const system of systems) {
    try {
      // Collect all service names from the YAML config for this system
      const allServiceIds = collectServiceIds(configPath, system);
      const context = { knownServiceIds: allServiceIds, namespace: system };
      const graph = await provider.discover(context);
      edgeMaps.set(system, graph.edges);
    } catch {
      edgeMaps.set(system, []);
    }
  }

  _registry = { edgeMaps, initialized: true };
}

/**
 * Read service IDs from a YAML topology config file for a given system.
 *
 * We need the full list to pass to provider.discover() so it returns
 * all topology edges (not filtered by an empty knownServiceIds).
 */
function collectServiceIds(configDir: string, system: string): string[] {
  try {
    const { readFileSync, existsSync, readdirSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');

    if (!existsSync(configDir)) return [];

    const files = readdirSync(configDir).filter(
      (f: string) => f.endsWith('.yaml') || f.endsWith('.yml'),
    );

    for (const file of files) {
      const content = readFileSync(join(configDir, file), 'utf-8');
      // Quick extraction: find all `- id: XXX` lines under `services:`
      if (!content.toLowerCase().includes(`system: ${system.toLowerCase()}`) &&
          !content.toLowerCase().includes(`system: ${system.replace(/ /g, '-').toLowerCase()}`)) {
        // Check if file name matches system
        const fileNameBase = file.replace(/\.ya?ml$/, '').toLowerCase();
        const sysLower = system.toLowerCase();
        if (!fileNameBase.includes(sysLower.replace(/ /g, '-'))) continue;
      }

      // Extract service IDs from YAML
      const ids: string[] = [];
      let inServices = false;
      for (const line of content.split('\n')) {
        if (line.trim() === 'services:') { inServices = true; continue; }
        if (inServices && line.match(/^  - id:\s*/)) {
          const id = line.replace(/^  - id:\s*'?/, '').replace(/'?\s*$/, '').trim();
          ids.push(id);
        } else if (inServices && line.trim() === 'edges:') {
          break;
        }
      }
      if (ids.length > 0) return ids;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Check whether the topology registry has been initialized.
 */
export function isRCAEvalTopologyInitialized(): boolean {
  return _registry.initialized;
}

// ── Call Graph Builder ────────────────────────────────────

/**
 * Build the correct call graph for a benchmark case.
 *
 * Uses the pre-loaded topology registry (via initRCAEvalTopology()).
 * Falls back to ring-connect for services not in the known topology,
 * ensuring the collision tree engine always has at least one edge per service.
 *
 * This is the V2 replacement for the old hardcoded edge arrays.
 * The old function is kept as `buildRCAEvalCallGraphLegacy()` for backward
 * compatibility during migration.
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

  // Try YAML-driven topology if registry is initialized
  if (_registry.initialized && system) {
    return buildFromRegistry(system, caseId, serviceIds);
  }

  // Fallback: pure ring-connect (registry not initialized)
  return buildRingConnectOnly(system ?? 'rca-eval', caseId, serviceIds);
}

// ── Internal Builders ─────────────────────────────────────

/**
 * Build graph from the pre-loaded YAML topology registry.
 */
function buildFromRegistry(
  system: 'OnlineBoutique' | 'SockShop' | 'TrainTicket',
  caseId: string,
  serviceIds: readonly string[],
): ServiceCallGraph {
  const topologyEdges = _registry.edgeMaps.get(system) ?? [];
  const topologySvcNames = new Set<string>();

  // Collect known topology service names from edges
  for (const edge of topologyEdges) {
    topologySvcNames.add(edge.from);
    topologySvcNames.add(edge.to);
  }

  const nodes = buildNodes(serviceIds, system);
  const svcSet = new Set(serviceIds);
  const connectedSvcs = new Set<string>();
  const edges: CallEdge[] = [];
  let matchedEdgeCount = 0;

  // Match topology edges against this case's service set
  for (const edge of topologyEdges) {
    if (svcSet.has(edge.from) && svcSet.has(edge.to)) {
      edges.push({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        callRate: edge.callRate,
        p99Latency: edge.p99Latency,
        errorRate: edge.errorRate,
      });
      connectedSvcs.add(edge.from);
      connectedSvcs.add(edge.to);
      topologySvcNames.add(edge.from);
      topologySvcNames.add(edge.to);
      matchedEdgeCount++;
    }
  }

  // Ring-connect unmatched services
  const unconnected = serviceIds.filter((s) => !connectedSvcs.has(s));
  ringConnect(unconnected, connectedSvcs, edges);

  // Inject diagnostic labels
  annotateNodes(nodes, caseId, system, matchedEdgeCount, topologyEdges.length, serviceIds.length, unconnected.length);

  return { nodes, edges, systemLoad: 0.5 };
}

/**
 * Build a pure ring-connect graph (fallback when registry isn't initialized).
 */
function buildRingConnectOnly(
  namespace: string,
  caseId: string,
  serviceIds: readonly string[],
): ServiceCallGraph {
  const nodes = buildNodes(serviceIds, namespace);
  const edges: CallEdge[] = [];
  const unconnected = [...serviceIds];

  if (unconnected.length > 1) {
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
  } else if (unconnected.length === 1) {
    edges.push({
      from: unconnected[0]!,
      to: unconnected[0]!,
      type: 'INTERNAL',
      callRate: 1,
      p99Latency: 1,
      errorRate: 0,
    });
  }

  annotateNodes(nodes, caseId, namespace, 0, 0, serviceIds.length, unconnected.length);

  return { nodes, edges, systemLoad: 0.5 };
}

// ── Helpers ───────────────────────────────────────────────

function buildNodes(
  serviceIds: readonly string[],
  namespace: string,
): Map<ServiceId, ServiceNode> {
  const nodes = new Map<ServiceId, ServiceNode>();
  for (const id of serviceIds) {
    nodes.set(id, { id, name: id, namespace, labels: {} });
  }
  return nodes;
}

function ringConnect(
  unconnected: readonly string[],
  connectedSvcs: ReadonlySet<string>,
  edges: CallEdge[],
): void {
  if (unconnected.length === 0) return;

  if (unconnected.length === 1 && connectedSvcs.size > 0) {
    // Single unconnected: attach to first connected service
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
    // Ring-connect unmatched services
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
  }
}

function annotateNodes(
  nodes: Map<ServiceId, ServiceNode>,
  caseId: string,
  system: string,
  matchedEdgeCount: number,
  topologyEdgeCount: number,
  serviceCount: number,
  unconnectedCount: number,
): void {
  for (const node of nodes.values()) {
    node.labels = {
      ...node.labels,
      '_diag_case': caseId,
      '_diag_system': system,
      '_diag_matched': `${matchedEdgeCount}/${topologyEdgeCount}`,
      '_diag_svc_total': String(serviceCount),
      '_diag_unconnected': String(unconnectedCount),
      '_diag_source': _registry.initialized ? 'yaml-v2' : 'ring-connect-legacy',
    };
  }
}
