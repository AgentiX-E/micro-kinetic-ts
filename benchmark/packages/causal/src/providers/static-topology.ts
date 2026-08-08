/**
 * Static topology provider — reads service call graphs from YAML configuration files.
 *
 * Implements ITopologyProvider using pre-defined topology YAML files that are
 * fully decoupled from any specific benchmark dataset. The provider parses
 * the YAML schema and constructs ServiceCallGraph instances with services,
 * edges, and metadata.
 *
 * Provider characteristics:
 * - method: 'static' (pre-configured topology)
 * - baseConfidence: 0.9 (human-authored topology, high confidence)
 * - availability: 'conditional' (requires config files to exist)
 *
 * The YAML format is generic — each system defines its own services, edges,
 * and labels. No benchmark-specific identifiers appear in the schema.
 *
 * @module causal/providers/static-topology
 */

import type {
  CallEdge,
  EdgeType,
  ITopologyProvider,
  ServiceCallGraph,
  ServiceNode,
  TopologyDiscoveryContext,
  TopologyProviderMeta,
} from '@agentix-e/micro-kinetic-core';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

// ── YAML Schema Types ────────────────────────────────────

/**
 * Shape of a topology YAML file (version 1.0).
 *
 * Fully decoupled from any benchmark dataset — services and edges
 * are defined with generic identifiers and metadata.
 */
interface TopologyYaml {
  version: string;
  system: string;
  description: string;
  source?: string;
  services: Array<{
    id: string;
    namespace: string;
    labels: Record<string, string>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    callRate: number;
    p99Latency: number;
    errorRate: number;
  }>;
}

// ── Edge Type Normalization ──────────────────────────────

/** Map YAML edge type strings to EdgeType union. */
function normalizeEdgeType(raw: string): EdgeType {
  const lower = raw.toLowerCase().trim();
  switch (lower) {
    case 'grpc':
      return 'gRPC';
    case 'rest':
      return 'REST';
    case 'mq':
    case 'rabbitmq':
    case 'kafka':
      return 'MQ';
    case 'callback':
      return 'CALLBACK';
    case 'async':
      return 'ASYNC';
    default:
      return 'REST';
  }
}

// ── Provider Implementation ──────────────────────────────

/**
 * Static topology provider backed by YAML configuration files.
 *
 * Reads pre-defined topology definitions from a config directory.
 * Each YAML file describes one system's services and call edges.
 * The provider matches discovered service IDs to the topology
 * schema, applying the known edges where applicable.
 *
 * Usage:
 * ```typescript
 * const provider = new StaticTopologyProvider('./configs/topology');
 * const graph = await provider.discover({ knownServiceIds, namespace: 'train-ticket' });
 * ```
 */
export class StaticTopologyProvider implements ITopologyProvider {
  /** Provider metadata for fusion weighting. */
  public readonly meta: TopologyProviderMeta = {
    id: 'static-yaml-topology',
    description: 'Static topology from YAML configuration files (dataset-agnostic)',
    method: 'static',
    baseConfidence: 0.9,
    availability: 'conditional',
  };

  /** Cached topology YAML entries, keyed by system name (lowercase). */
  private readonly cache = new Map<string, TopologyYaml>();

  /** Directory containing topology YAML files. */
  private readonly configDir: string;

  /**
   * @param configDir - Directory path containing *.yaml topology config files.
   */
  constructor(configDir: string) {
    this.configDir = configDir;
  }

  // ── ITopologyProvider Interface ────────────────────────

  /**
   * Check whether this provider has any valid config files.
   */
  async isAvailable(): Promise<boolean> {
    try {
      this.loadAll();
      return this.cache.size > 0;
    } catch {
      return false;
    }
  }

  /**
   * Discover service call graph from YAML topology files.
   *
   * Matching strategy (no dataset coupling):
   * 1. Load all YAML files from config directory
   * 2. For each known service ID, try to match against YAML service definitions
   * 3. If a namespace hint is provided, filter by matching namespace
   * 4. Add all matching edges where both endpoints are in knownServiceIds
   * 5. Ring-connect any unmatched services for completeness
   */
  async discover(context: TopologyDiscoveryContext): Promise<ServiceCallGraph> {
    // Ensure configs are loaded
    this.loadAll();

    const { knownServiceIds, namespace } = context;
    const lowerIds = new Set(knownServiceIds.map((s) => s.toLowerCase().trim()));

    // Find applicable YAML configs
    const applicableConfigs = this.findApplicableConfigs(knownServiceIds, namespace);

    if (applicableConfigs.length === 0) {
      return this.emptyGraph(knownServiceIds, namespace);
    }

    // Build service nodes from YAML definitions
    const nodes = new Map<string, ServiceNode>();
    const allMatchedYamlServices = new Set<string>();

    for (const config of applicableConfigs) {
      for (const svc of config.services) {
        const yamlId = svc.id.toLowerCase().trim();
        // If namespace matches or no namespace filter, include the service
        if (lowerIds.has(yamlId) || knownServiceIds.includes(svc.id)) {
          if (!nodes.has(svc.id)) {
            nodes.set(svc.id, {
              id: svc.id,
              name: svc.labels.description ?? svc.id,
              namespace: svc.namespace,
              labels: {
                ...svc.labels,
                _topology_system: config.system,
                _topology_source: config.source ?? 'yaml-config',
              },
            });
            allMatchedYamlServices.add(yamlId);
          }
        }
      }
    }

    // Build edges from YAML definitions
    const edges: CallEdge[] = [];
    const edgeKeySet = new Set<string>();

    for (const config of applicableConfigs) {
      for (const edge of config.edges) {
        const fromKey = edge.from.toLowerCase().trim();
        const toKey = edge.to.toLowerCase().trim();

        // Only add edges where both endpoints are in known services
        if (lowerIds.has(fromKey) && lowerIds.has(toKey)) {
          const key = `${fromKey}→${toKey}`;
          if (!edgeKeySet.has(key)) {
            edgeKeySet.add(key);
            edges.push({
              from: this.resolveServiceId(edge.from, knownServiceIds),
              to: this.resolveServiceId(edge.to, knownServiceIds),
              type: normalizeEdgeType(edge.type),
              callRate: edge.callRate,
              p99Latency: edge.p99Latency,
              errorRate: edge.errorRate,
            });
          }
        }
      }
    }

    // Ring-connect any services not covered by known topology
    this.ringConnectUnmatched(nodes, edges, knownServiceIds);

    return {
      nodes,
      edges,
      systemLoad: 0.5,
    };
  }

  /**
   * Force reload of all YAML files (clears cache).
   */
  public reload(): void {
    this.cache.clear();
    this.loadAll();
  }

  /**
   * Number of loaded topology configs.
   */
  public get configCount(): number {
    this.loadAll();
    return this.cache.size;
  }

  // ── Private Helpers ────────────────────────────────────

  /**
   * Load all .yaml/.yml files from the config directory.
   */
  private loadAll(): void {
    if (this.cache.size > 0) return; // Already loaded

    try {
      if (!existsSync(this.configDir)) return;

      // Read directory and parse YAML files
      const files = readdirSync(this.configDir).filter(
        (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
      );

      for (const file of files) {
        try {
          const content = readFileSync(join(this.configDir, file), 'utf-8');
          const config = this.parseYaml(content);
          if (config) {
            const key = config.system.toLowerCase().trim();
            this.cache.set(key, config);
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory may not exist or be inaccessible
    }
  }

  /**
   * Minimal YAML parser for topology config file format.
   *
   * Handles:
   * - Scalar strings (quoted and unquoted)
   * - Inline objects with { key: value }
   * - Sequences with [ item, item ]
   * - Simple indented mapping (2-space indent)
   * - Comments (#)
   *
   * This is intentionally minimal to avoid external YAML dependency.
   * The topology config format has a known, fixed schema.
   */
  private parseYaml(content: string): TopologyYaml | null {
    try {
      const lines = content.split('\n');
      const result: Partial<TopologyYaml> = {
        version: '1.0',
        system: '',
        description: '',
        services: [],
        edges: [],
      };

      let section: 'top' | 'services' | 'edges' = 'top';
      let i = 0;

      while (i < lines.length) {
        const line = lines[i]!;
        const trimmed = line.trim();

        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) {
          i++;
          continue;
        }

        if (section === 'top') {
          if (trimmed.startsWith('services:')) {
            section = 'services';
            i++;
            continue;
          }
          if (trimmed.startsWith('edges:')) {
            section = 'edges';
            i++;
            continue;
          }
          const colonIdx = trimmed.indexOf(':');
          if (colonIdx > 0) {
            const key = trimmed.substring(0, colonIdx).trim();
            const val = trimmed.substring(colonIdx + 1).trim();
            if (key === 'version') result.version = val;
            else if (key === 'system') result.system = val;
            else if (key === 'description') result.description = val;
            else if (key === 'source') result.source = val;
          }
        } else if (section === 'services') {
          if (trimmed.startsWith('edges:')) {
            section = 'edges';
            i++;
            continue;
          }
          if (trimmed.startsWith('-')) {
            const svc = this.parseServiceBlock(lines, i);
            if (svc) result.services!.push(svc);
          }
        } else if (section === 'edges') {
          if (trimmed.startsWith('-')) {
            const edge = this.parseInlineEdge(trimmed);
            if (edge) result.edges!.push(edge);
          }
        }
        i++;
      }

      if (!result.system || !result.services?.length) return null;
      return result as TopologyYaml;
    } catch {
      return null;
    }
  }

  /**
   * Parse a service definition block (indented under services:).
   */
  private parseServiceBlock(lines: string[], startIdx: number): TopologyYaml['services'][0] | null {
    const svc: Partial<TopologyYaml['services'][0]> = { labels: {} };
    let i = startIdx;
    const startIndent = lines[i]!.search(/\S/);

    const itemLine = lines[i]!.trim().replace(/^- /, '').replace(/^-\s*/, '');
    const itemColon = itemLine.indexOf(':');
    if (itemColon > 0) {
      const key = itemLine.substring(0, itemColon).trim();
      const val = itemLine.substring(itemColon + 1).trim();
      if (key === 'id') svc.id = val;
      else if (key === 'namespace') svc.namespace = val;
    }

    i++;
    while (i < lines.length) {
      const line = lines[i]!;
      const indent = line.search(/\S/);
      if (line.trim() === '' || indent < 0) {
        i++;
        continue;
      }
      if (indent <= startIndent && line.trim()) break; // Next item

      const trimmed = line.trim();
      if (trimmed.startsWith('labels:')) {
        // Parse labels as a sub-block
        i++;
        const svcIndent = lines[i - 1]!.search(/\S/);
        while (i < lines.length) {
          const ll = lines[i]!;
          const lIndent = ll.search(/\S/);
          if (lIndent <= svcIndent && ll.trim()) break;
          const lt = ll.trim();
          const lCol = lt.indexOf(':');
          if (lCol > 0) {
            const lk = lt.substring(0, lCol).trim();
            const lv = lt.substring(lCol + 1).trim();
            svc.labels![lk] = lv;
          }
          i++;
        }
        continue;
      }

      const colon = trimmed.indexOf(':');
      if (colon > 0) {
        const key = trimmed.substring(0, colon).trim();
        const val = trimmed.substring(colon + 1).trim();
        if (key === 'id') svc.id = val;
        else if (key === 'namespace') svc.namespace = val;
        else svc.labels![key] = val;
      }
      i++;
    }

    if (!svc.id || !svc.namespace) return null;
    return {
      id: svc.id,
      namespace: svc.namespace,
      labels: svc.labels ?? {},
    };
  }

  /**
   * Parse inline edge definition: `- { from: a, to: b, type: gRPC, ... }`.
   */
  private parseInlineEdge(trimmed: string): TopologyYaml['edges'][0] | null {
    // Remove `- ` prefix and braces
    let inner = trimmed.replace(/^-\s*/, '').replace(/^\{/, '').replace(/\}$/, '');

    const result: Record<string, string | number> = {};

    // Match key: value pairs (value may be quoted or unquoted)
    const kvRe = /(\w+):\s*(['"]?)([^,'"]*)\2/g;
    let match: RegExpExecArray | null;
    while ((match = kvRe.exec(inner)) !== null) {
      const key = match[1]!;
      const val = match[3]!;
      // Numeric values
      if (['callRate', 'p99Latency', 'errorRate'].includes(key)) {
        result[key] = parseFloat(val) || 0;
      } else {
        result[key] = val.trim();
      }
    }

    if (!result.from || !result.to) return null;

    return {
      from: String(result.from),
      to: String(result.to),
      type: String(result.type ?? 'REST'),
      callRate: Number(result.callRate ?? 100),
      p99Latency: Number(result.p99Latency ?? 50),
      errorRate: Number(result.errorRate ?? 0.01),
    };
  }

  // ── Service Discovery ──────────────────────────────────

  /**
   * Find YAML configs applicable to the given service IDs.
   *
   * Strategy: find the config where the maximum number of service IDs
   * match the YAML-defined services. No dataset-specific identifiers used.
   */
  private findApplicableConfigs(
    knownServiceIds: readonly string[],
    namespace?: string,
  ): TopologyYaml[] {
    const lowerIds = new Set(knownServiceIds.map((s) => s.toLowerCase().trim()));
    const results: TopologyYaml[] = [];

    // If namespace is specified, filter by namespace match
    if (namespace) {
      const nsLower = namespace.toLowerCase().trim();
      for (const config of this.cache.values()) {
        const matchedSvcs = config.services.filter((s) => lowerIds.has(s.id.toLowerCase().trim()));
        // Match if any service from this config is in the known set
        // AND the namespace matches
        const hasNsMatch = config.services.some(
          (s) => s.namespace.toLowerCase().trim() === nsLower,
        );
        if (matchedSvcs.length > 0 && hasNsMatch) {
          results.push(config);
        }
      }
      if (results.length > 0) return results;
    }

    // Without namespace: find best matching config by service overlap
    let bestScore = 0;
    let bestConfig: TopologyYaml | null = null;
    for (const config of this.cache.values()) {
      const yamlSvcs = new Set(config.services.map((s) => s.id.toLowerCase().trim()));
      let score = 0;
      for (const id of lowerIds) {
        if (yamlSvcs.has(id)) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestConfig = config;
      }
    }

    if (bestConfig) results.push(bestConfig);
    return results;
  }

  /**
   * Resolve a YAML service ID to an actual known service ID.
   * Handles case differences by matching against the known set.
   */
  private resolveServiceId(yamlId: string, knownIds: readonly string[]): string {
    const lower = yamlId.toLowerCase().trim();
    // Exact match first
    if (knownIds.includes(yamlId)) return yamlId;
    // Case-insensitive match
    const found = knownIds.find((id) => id.toLowerCase().trim() === lower);
    return found ?? yamlId;
  }

  // ── Graph Construction Helpers ─────────────────────────

  /**
   * Ring-connect services that have no edges in the topology.
   * Ensures every service in the graph has at least one edge
   * so the collision tree engine can process all services.
   */
  private ringConnectUnmatched(
    nodes: Map<string, ServiceNode>,
    edges: CallEdge[],
    knownServiceIds: readonly string[],
  ): void {
    const connected = new Set<string>();
    for (const e of edges) {
      connected.add(e.from.toLowerCase().trim());
      connected.add(e.to.toLowerCase().trim());
    }

    const unmatched = knownServiceIds.filter((id) => !connected.has(id.toLowerCase().trim()));

    if (unmatched.length === 1 && connected.size > 0) {
      const anchor = [...connected][0]!;
      edges.push({
        from: anchor,
        to: unmatched[0]!,
        type: 'REST',
        callRate: 1,
        p99Latency: 1,
        errorRate: 0,
      });
    } else if (unmatched.length > 1) {
      for (let i = 0; i < unmatched.length; i++) {
        const next = (i + 1) % unmatched.length;
        edges.push({
          from: unmatched[i]!,
          to: unmatched[next]!,
          type: 'REST',
          callRate: 1,
          p99Latency: 1,
          errorRate: 0,
        });
      }
    }
  }

  /**
   * Create an empty graph with just the known service nodes.
   */
  private emptyGraph(knownServiceIds: readonly string[], namespace?: string): ServiceCallGraph {
    const nodes = new Map<string, ServiceNode>();
    for (const id of knownServiceIds) {
      nodes.set(id, {
        id,
        name: id,
        namespace: namespace ?? 'unknown',
        labels: {},
      });
    }
    return { nodes, edges: [], systemLoad: 0 };
  }
}
